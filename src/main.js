import './style.css';
import {
  createMap, setData, clearAll, personMarker, placePin, maplibregl,
  emphasizeNetwork, showTreeUntil, treeOpacity,
} from './map/scene.js';
import { makeIsoBuilder } from './map/iso.js';
import { createJourney, prepareLegs } from './map/journey.js';
import { buildPlan } from './engine/plan.js';
import { routeTree } from './engine/tree.js';
import { MODES } from './engine/fairness.js';
import { deps, locate, reverseName } from './data/load.js';
import { createSetup, SAMPLES, COLORS, esc } from './ui/setup.js';
import { createResults, createPlans, placeTitle } from './ui/results.js';
import { loadGuide } from './data/guide.js';
import { createPlayer } from './ui/player.js';
import { fmtClock, fmtMinutes, haversine } from './geo.js';

const $ = (s) => document.querySelector(s);

// ---------- state ----------
const state = {
  mode: 'equal',
  people: SAMPLES.wien.people.map(([name, place, lng, lat], k) => ({ id: k, name, place, pos: [lng, lat], mode: 'transit', color: COLORS[k] })),
};
let plan = null;
let markers = [];
let pin = null;
let journey = null;
let followIdx = -1;
let pickIdx = -1;
let runId = 0;
let prefs = null;
let plansKey = '';

const { map, ready } = createMap($('#map'));
const player = createPlayer($('#player'));

// ---------- status pill ----------
const STEPS = [['friends', 'Add friends'], ['routes', 'Exploring every route'], ['meet', 'Fair meeting point'], ['travel', 'Everyone on the way'], ['plans', 'Plans']];
$('#steps').innerHTML = STEPS.map(([k]) => `<li data-k="${k}"></li>`).join('');
function setStep(key) {
  const idx = STEPS.findIndex(([k]) => k === key);
  document.querySelectorAll('#steps li').forEach((li, i) => {
    li.classList.toggle('done', i < idx);
    li.classList.toggle('on', i === idx);
  });
  $('#step-label').textContent = STEPS[idx][1];
}
setStep('friends');

let toastTimer = 0;
function toast(html, ms = 3000) {
  const t = $('#toast');
  t.innerHTML = html;
  t.hidden = false;
  t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function clock(min) {
  const c = $('#clock');
  if (min == null) { c.hidden = true; return; }
  c.hidden = false;
  c.textContent = fmtClock(min);
}

// ---------- camera ----------
function pad() {
  if (innerWidth < 820) return { top: 80, bottom: innerHeight * 0.5, left: 24, right: 24 };
  const plansOpen = !$('#plans').hidden;
  return { top: 90, bottom: 90, left: 420, right: plansOpen ? 420 : 70 };
}
// Far-apart points (other continents) can't share a flat box on a globe:
// look at their spherical middle from far away instead.
function frame(pts, opts = {}) {
  const R = Math.PI / 180;
  let x = 0, y = 0, z = 0;
  for (const [lng, lat] of pts) { x += Math.cos(lat * R) * Math.cos(lng * R); y += Math.cos(lat * R) * Math.sin(lng * R); z += Math.sin(lat * R); }
  const n = Math.hypot(x, y, z) / pts.length;
  if (pts.length > 1 && n < 0.9) {
    const center = [Math.atan2(y, x) / R, Math.atan2(z, Math.hypot(x, y)) / R];
    const { maxZoom, ...rest } = opts;
    map.flyTo({ center, zoom: innerWidth < 820 ? 0.9 : 1.6 + (n - 0.5), padding: pad(), ...rest, pitch: Math.min(rest.pitch ?? 0, 20) });
    return;
  }
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  pts.forEach((p) => b.extend(p));
  map.fitBounds(b, { padding: pad(), ...opts });
}

// ---------- friends on the map ----------
function drawPeople() {
  markers.forEach((m) => m.remove());
  markers = state.people.filter((p) => p.pos).map((p) => personMarker(p).addTo(map));
}
function fitPeople(opts = {}) {
  const pts = state.people.filter((p) => p.pos).map((p) => p.pos);
  if (pts.length) frame(pts, { maxZoom: 13, duration: 1600, ...opts });
}

const setup = createSetup($('#setup'), {
  state,
  onChange: () => { drawPeople(); fitPeople(); },
  onFind: () => find(),
  onPickOnMap: (i) => {
    pickIdx = i;
    map.getCanvas().style.cursor = 'crosshair';
    toast(`Click the map to set where <b>${esc(state.people[i].name)}</b> starts`, 5000);
  },
  getBias: () => map.getCenter().toArray(),
});

map.on('click', async (e) => {
  if (pickIdx < 0) return;
  const i = pickIdx;
  pickIdx = -1;
  map.getCanvas().style.cursor = '';
  const pos = e.lngLat.toArray();
  Object.assign(state.people[i], { pos, place: `${pos[1].toFixed(4)}, ${pos[0].toFixed(4)}` });
  setup.render(); drawPeople();
  const name = await reverseName(pos);
  if (name) { state.people[i].place = name; setup.render(); }
});

const results = createResults($('#results'), {
  onBack: () => backToSetup(),
  onMode: (m) => chooseMode(m),
  onSelect: (c) => selectPlace(c),
  onJourney: (same) => playJourneys(same),
  onPlans: () => openPlans(),
  onFollow: (i) => {
    followIdx = followIdx === i ? -1 : i;
    toast(followIdx < 0 ? 'Stopped following' : `Following <b>${esc(state.people[i].name)}</b>`, 1500);
  },
});
const plans = createPlans($('#plans'), {
  onClose: () => plans.close(),
  onShow: (it) => showSpot(it),
});

ready.then(() => { drawPeople(); fitPeople({ duration: 2500 }); });

// ---------- 1. compute, then explore every route ----------
async function find() {
  const my = ++runId;
  const people = state.people.filter((p) => p.pos).map((p) => ({ ...p }));
  if (people.length < 2) return;
  resetScene();
  $('#panel').scrollTo({ top: 0 });
  $('#setup').classList.add('busy');
  toast('Calculating travel times…', 8000);

  try {
    plan = await buildPlan(people, deps, (stage, info) => {
      if (stage === 'rail') toast('Loading rail lines from OpenStreetMap…', 15000);
      if (stage === 'land') toast('Loading coastlines and airports…');
      if (stage === 'solve') toast(`Calculating travel times · ${esc(people[info.i].name)} (${info.i + 1}/${info.n})`);
    });
  } catch (err) {
    toast(`Something went wrong: ${esc(err.message)}`, 6000);
    return;
  } finally {
    $('#setup').classList.remove('busy');
  }
  if (my !== runId) return;
  plan.people = people;
  plan.iso = makeIsoBuilder(plan);

  const chosen = {};
  for (const m of Object.keys(MODES)) chosen[m] = plan.ranked[m][0];
  const best = chosen[state.mode] || chosen.minimax;
  prefs = defaultPrefs();
  if (!best) {
    toast('No place everyone can reach. Try a different way to travel.', 6000);
    showResults(chosen);
    return;
  }

  drawNetwork();
  await exploreRoutes(my, best);
  if (my !== runId) return;

  showResults(chosen);
  await selectPlace(chosen[state.mode], { first: true });
  await wait(1800);
  if (my !== runId) return;
  await playJourneys(false);
  if (my !== runId) return;
  openPlans();
}

function showResults(chosen) {
  $('#setup').hidden = true;
  $('.brand').hidden = true;
  results.show({ plan, mode: state.mode, chosen, legs: null });
}

// Real network the routes run on: transit lines (city) or used airports (larger scales).
function drawNetwork() {
  const { tree, airports } = routeTree(plan);
  setData(map, 'tree', tree);
  showTreeUntil(map, -1);
  treeOpacity(map, 1);
  setData(map, 'airports', plan.tier === 'city' ? null : airports);
  if (plan.tier === 'city' && plan.net.S) {
    const seen = new Set();
    const features = [];
    plan.net.lines.forEach((l, li) => {
      const coords = [];
      for (let s = 0; s < plan.net.S; s++) if (plan.net.stops.line[s] === li) coords.push([plan.net.stops.lng[s], plan.net.stops.lat[s]]);
      const key = (l.ref || l.name) + coords.length;
      if (seen.has(key) || coords.length < 2) return;
      seen.add(key);
      features.push({ type: 'Feature', properties: { colour: l.colour || null }, geometry: { type: 'LineString', coordinates: coords } });
    });
    setData(map, 'rail', { type: 'FeatureCollection', features });
  }
  emphasizeNetwork(map, true);
}

async function exploreRoutes(my, best) {
  setStep('routes');
  const tStar = best.stats.max;
  const tEnd = tStar * 1.3;
  frame(plan.people.map((p) => p.pos), { pitch: plan.tier === 'world' ? 10 : 45, bearing: plan.tier === 'world' ? 0 : -12, duration: 1800, maxZoom: 12.5 });
  await wait(1500);
  if (my !== runId) return;

  let met = false, lastIso = 0;
  const draw = (f) => {
    const t = easeInOut(f) * tEnd;
    clock(t);
    showTreeUntil(map, t);
    const now = performance.now();
    if (now - lastIso > 60 || f >= 1) {
      lastIso = now;
      setData(map, 'iso', plan.iso.people(t));
      setData(map, 'overlap', t >= tStar ? plan.iso.overlap(t, 0) : null);
    }
    if (!met && t >= tStar) {
      met = true;
      toast(`Everyone can meet after <b>${fmtMinutes(tStar)}</b>`);
    } else if (met && t < tStar) met = false;
  };
  await player.play({ durationMs: plan.tier === 'city' ? 8000 : 9000, onFrame: draw, text: 'Routes spreading from everyone' });
}

// ---------- 2. the meeting point ----------
// Other places that are about as good: close in the ranking and in travel time, but not next door to each other.
function similarOptions(mode) {
  const ranked = plan.ranked[mode];
  if (!ranked.length) return [];
  const bestMax = ranked[0].stats.max;
  const slack = { city: 8, region: 25, world: 120 }[plan.tier];
  const gapKm = { city: 0.7, region: 20, world: 250 }[plan.tier];
  const out = [];
  for (const c of ranked) {
    if (out.length >= 8) break;
    if (c.stats.max > bestMax * 1.2 + slack) continue;
    if (out.some((o) => haversine(o.pos, c.pos) / 1000 < gapKm)) continue;
    out.push(c);
  }
  return out;
}

let optPins = [];
function showOptions(current) {
  const v = results.view;
  const list = similarOptions(v.mode);
  optPins.forEach((m) => m.remove());
  optPins = [];
  const bar = $('#options');
  if (list.length < 2) { bar.hidden = true; return; }
  const best = list[0];
  list.forEach((c, k) => {
    const el = document.createElement('div');
    el.className = 'opt-pin' + (c.id === current.id ? ' on' : '');
    el.style.animationDelay = `${k * 70}ms`;
    el.innerHTML = `<b>${k + 1}</b>${fmtMinutes(c.stats.max)}`;
    el.title = placeTitle(c);
    el.addEventListener('click', (e) => { e.stopPropagation(); selectPlace(c); });
    optPins.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(c.pos).addTo(map));
  });
  const diff = (c) => {
    if (c === best) return 'top pick';
    const d = Math.round(c.stats.max - best.stats.max);
    return d === 0 ? 'same time' : d < 0 ? `${-d} min shorter` : `+${d} min`;
  };
  bar.innerHTML = `<div class="opt-bar">
    <div class="opt-head"><b>${list.length} good options</b>similar travel times</div>
    ${list.map((c, k) => `<button class="opt ${c.id === current.id ? 'on' : ''}" data-id="${esc(c.id)}">
      <span class="opt-n">#${k + 1} · ${diff(c)}</span>
      <span class="opt-name">${esc(placeTitle(c))}</span>
      <small>${fmtMinutes(c.stats.max)} max · ±${fmtMinutes(c.stats.spread)}</small>
    </button>`).join('')}
  </div>`;
  bar.hidden = false;
  bar.onclick = (e) => {
    const b = e.target.closest('.opt');
    if (b) selectPlace(list.find((c) => c.id === b.dataset.id));
  };
  bar.querySelector('.opt.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function hideOptions() {
  optPins.forEach((m) => m.remove());
  optPins = [];
  $('#options').hidden = true;
}

function paintCandidates(mode) {
  const ranked = plan.ranked[mode];
  const top = new Set(ranked.slice(0, 5).map((c) => c.id));
  const ok = new Set(ranked.map((c) => c.id));
  setData(map, 'cands', {
    type: 'FeatureCollection',
    features: plan.cands.filter((c) => ok.has(c.id)).map((c) => ({
      type: 'Feature', properties: { top: top.has(c.id), alpha: top.has(c.id) ? 1 : 0.5 }, geometry: { type: 'Point', coordinates: c.pos },
    })),
  });
}

async function selectPlace(c, { first = false } = {}) {
  if (!c) return;
  stopJourney();
  player.stop();
  setStep('meet');
  emphasizeNetwork(map, false);
  const v = results.view;
  v.chosen[v.mode] = c;
  if (c.kind === 'area' && !c.name) c.name = (await reverseName(c.pos)) || 'Meeting spot';
  const legs = plan.journeyFor(c);
  results.update({ legs });

  pin?.remove();
  pin = placePin(c.pos, placeTitle(c)).addTo(map);
  setData(map, 'iso', null);
  setData(map, 'overlap', plan.iso.overlap(c.stats.max + 1, 0));
  showTreeUntil(map, Infinity);
  treeOpacity(map, 0.35);
  paintCandidates(v.mode);
  showOptions(c);
  prefetchPlaces(c);
  drawRoutes(legs);
  clock(null);
  $('#panel').scrollTo({ top: 0, behavior: first ? 'auto' : 'smooth' });

  const zoom = { city: 14.6, region: 8.5, world: 4.5 }[plan.tier];
  map.flyTo({ center: c.pos, zoom, pitch: plan.tier === 'world' ? 30 : 55, bearing: map.getBearing() + 25, duration: first ? 2400 : 1600, padding: pad(), essential: true });
  toast(`<b>${esc(placeTitle(c))}</b> · longest trip ${fmtMinutes(c.stats.max)}`);
  if (plans.isOpen) openPlans();
}

function drawRoutes(legs) {
  setData(map, 'routes', {
    type: 'FeatureCollection',
    features: legs.flatMap((ls, i) => prepareLegs(ls).map((l) => ({
      type: 'Feature', properties: { color: plan.people[i].color, kind: l.mode }, geometry: { type: 'LineString', coordinates: l.coords },
    }))),
  });
}

function chooseMode(m) {
  state.mode = m;
  results.view.mode = m;
  selectPlace(results.view.chosen[m]);
}

// ---------- 3. everyone travels ----------
async function playJourneys(sameArrival) {
  const v = results.view;
  const c = v.chosen[v.mode];
  stopJourney();
  setStep('travel');
  setData(map, 'overlap', null);
  setData(map, 'cands', null);
  optPins.forEach((m) => m.getElement().style.display = 'none');
  treeOpacity(map, 0.18);
  markers.forEach((m) => m.getElement().classList.add('faded'));
  journey = createJourney(map, plan.people, v.legs, { sameArrival });
  frame([...v.legs.flat().flatMap((l) => l.coords), c.pos], { pitch: plan.tier === 'world' ? 15 : 50, duration: 1500, maxZoom: 14 });
  await wait(1300);
  if (!journey) return;
  const total = journey.duration;
  const durationMs = Math.min(16000, Math.max(9000, total * 120));
  let lastCam = 0;
  await player.play({
    durationMs,
    text: sameArrival ? 'Arriving together' : 'Leaving together',
    onFrame: (f) => {
      if (!journey) return;
      const t = f * total;
      const states = journey.render(t);
      clock(t);
      if (followIdx >= 0 && states[followIdx] && performance.now() - lastCam > 120) {
        lastCam = performance.now();
        map.easeTo({ center: states[followIdx].pos, duration: 200, easing: (x) => x });
      }
    },
    onEnd: () => {
      toast(`Everyone made it to <b>${esc(placeTitle(c))}</b>`);
      map.flyTo({ center: c.pos, zoom: { city: 15.5, region: 9.5, world: 5.5 }[plan.tier], pitch: 58, bearing: map.getBearing() - 30, duration: 2200, padding: pad() });
    },
  });
}

function stopJourney() {
  journey?.destroy();
  journey = null;
  markers.forEach((m) => m.getElement().classList.remove('faded'));
}

function resetScene() {
  stopJourney();
  player.stop();
  clearAll(map);
  emphasizeNetwork(map, false);
  pin?.remove(); pin = null;
  hideOptions();
  plans.close();
  plansKey = '';
  clock(null);
}

function backToSetup() {
  runId++;
  resetScene();
  results.hide();
  $('#setup').hidden = false;
  $('.brand').hidden = false;
  setStep('friends');
  drawPeople();
  fitPeople();
}

// ---------- 4. what to do there (right panel) ----------
function defaultPrefs() {
  return { budget: 'Medium', vibes: ['Food', 'Cafés', 'Culture'] };
}

function openPlans() {
  const v = results.view;
  const c = v.chosen[v.mode];
  setStep('plans');
  if (plans.isOpen && plansKey === c.id) return; // already showing this place
  plansKey = c.id;
  plans.open(placeTitle(c), prefs, Date.now() + c.stats.max * 60000);
  prefetchPlaces(c).then((g) => { if (plansKey === c.id) plans.setGuide(g); });
}

async function showSpot(it) {
  if (!it) return;
  let pos = it.lng != null ? [it.lng, it.lat] : null;
  if (!pos) {
    const c = results.view.chosen[results.view.mode];
    toast(`Looking up <b>${esc(it.name)}</b>…`, 2000);
    const hit = await locate(it.name, c.pos, plan.tier === 'city' ? 10 : 40);
    if (!hit) { toast(`Couldn't find <b>${esc(it.name)}</b> on the map`, 2500); return; }
    pos = hit.pos;
  }
  setData(map, 'pois', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: it.name }, geometry: { type: 'Point', coordinates: pos } }] });
  map.flyTo({ center: pos, zoom: Math.max(map.getZoom(), 16), pitch: 55, duration: 1400, padding: pad() });
}

// Start reading the guides as soon as a spot is picked, so the list is ready when the trips end.
const placeCache = new Map();
function prefetchPlaces(c) {
  if (!placeCache.has(c.id)) {
    const p = loadGuide(c.pos, plan.tier).then((g) => {
      if (!g.items.length) placeCache.delete(c.id); // let a later try fetch again
      return g;
    });
    placeCache.set(c.id, p);
  }
  return placeCache.get(c.id);
}

// ---------- utils ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
