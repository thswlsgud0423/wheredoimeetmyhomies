import './style.css';
import { createMap, setData, clearAll, beamFeatures, personMarker, maplibregl } from './map/scene.js';
import { makeIsoBuilder } from './map/iso.js';
import { createJourney } from './map/journey.js';
import { buildPlan } from './engine/plan.js';
import { MODES } from './engine/fairness.js';
import { deps, nearbyPlaces, reverseName } from './data/load.js';
import { createSetup, SAMPLES, COLORS } from './ui/setup.js';
import { createResults, renderIdeas, renderPoiFallback, placeTitle, seasonFor } from './ui/results.js';
import { createPlayer } from './ui/player.js';
import { fmtClock, fmtMinutes } from './geo.js';

const $ = (s) => document.querySelector(s);

// ---------- state ----------
const state = {
  mode: 'minimax',
  people: SAMPLES.seoul.people.map(([name, place, lng, lat], k) => ({ id: k, name, place, pos: [lng, lat], mode: 'transit', color: COLORS[k] })),
};
let plan = null;
let markers = [];
let journey = null;
let followIdx = -1;
let pickIdx = -1;
let runId = 0;

const { map, ready } = createMap($('#map'));
const player = createPlayer($('#player'));

// ---------- HUD: pipeline steps ----------
const STEPS = [
  ['friends', 'Friends'], ['reach', 'Reach'], ['overlap', 'Overlap'], ['score', 'Score'],
  ['spot', 'Fair spot'], ['travel', 'Journeys'], ['ideas', 'Ideas'],
];
$('#steps').innerHTML = STEPS.map(([k, l], i) => `<li data-k="${k}"><span>${i + 1}</span>${l}</li>`).join('');
function setStep(key) {
  const idx = STEPS.findIndex(([k]) => k === key);
  document.querySelectorAll('#steps li').forEach((li, i) => {
    li.classList.toggle('done', i < idx);
    li.classList.toggle('on', i === idx);
  });
}
setStep('friends');

let toastTimer = 0;
function toast(html, ms = 3200) {
  const t = $('#toast');
  t.innerHTML = html;
  t.hidden = false;
  t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function clock(min, label = 'reach after') {
  const c = $('#clock');
  if (min == null) { c.hidden = true; return; }
  c.hidden = false;
  c.querySelector('.clock-label').textContent = label;
  c.querySelector('.clock-time').textContent = fmtClock(min);
}

// ---------- friends on the map ----------
function drawPeople() {
  markers.forEach((m) => m.remove());
  markers = state.people.filter((p) => p.pos).map((p) => personMarker(p, p.name.slice(0, 1).toUpperCase()).addTo(map));
}
function fitPeople(opts = {}) {
  const pts = state.people.filter((p) => p.pos).map((p) => p.pos);
  if (!pts.length) return;
  frame(pts, { maxZoom: 13, duration: 1600, ...opts });
}
// Fit points on screen. Far-apart points (other continents) can't share a flat box on a
// globe, so look at their spherical middle from far away instead.
function frame(pts, opts = {}) {
  const R = Math.PI / 180;
  let x = 0, y = 0, z = 0;
  for (const [lng, lat] of pts) { x += Math.cos(lat * R) * Math.cos(lng * R); y += Math.cos(lat * R) * Math.sin(lng * R); z += Math.sin(lat * R); }
  const n = Math.hypot(x, y, z) / pts.length; // 1 = all together, ~0 = spread around the world
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

function pad() {
  const mobile = innerWidth < 820;
  return mobile ? { top: 90, bottom: innerHeight * 0.5, left: 30, right: 30 } : { top: 110, bottom: 90, left: 440, right: 60 };
}

const setup = createSetup($('#setup'), {
  state,
  onChange: () => { drawPeople(); fitPeople(); },
  onFind: () => find(),
  onPickOnMap: (i) => {
    pickIdx = i;
    map.getCanvas().style.cursor = 'crosshair';
    toast(`Click the map to set where <b>${state.people[i].name}</b> starts`, 5000);
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
  onFollow: (i) => { followIdx = followIdx === i ? -1 : i; toast(followIdx < 0 ? 'Stopped following' : `Following <b>${state.people[i].name}</b>`, 1500); },
  onIdeas: (prefs, out) => getIdeas(prefs, out),
});

ready.then(() => { drawPeople(); fitPeople({ duration: 2500 }); });

// ---------- the main flow ----------
async function find() {
  const my = ++runId;
  const people = state.people.filter((p) => p.pos).map((p) => ({ ...p }));
  if (people.length < 2) return;
  stopJourney();
  player.stop();
  clearAll(map);
  $('#panel').scrollTo({ top: 0 });
  $('#setup').classList.add('busy');
  setStep('reach');

  try {
    plan = await buildPlan(people, deps, (stage, info) => {
      if (stage === 'area') toast(`Scale: <b>${{ city: 'within a city', region: 'between cities', world: 'across countries' }[info.tier]}</b>`);
      if (stage === 'rail') toast('Loading rail lines from OpenStreetMap…', 8000);
      if (stage === 'land') toast('Loading coastlines and airports…');
      if (stage === 'solve') toast(`Computing travel times · ${people[info.i].name} (${info.i + 1}/${info.n})`);
    });
  } catch (err) {
    toast(`Something went wrong: ${err.message}`, 6000);
    $('#setup').classList.remove('busy');
    return;
  } finally {
    $('#setup').classList.remove('busy');
  }
  if (my !== runId) return;
  // people as the engine saw them (some may lack a location)
  plan.people = people;

  if (plan.tier === 'city' && plan.net.S) {
    const seen = new Set();
    setData(map, 'rail', {
      type: 'FeatureCollection',
      features: plan.net.lines.map((l, li) => {
        const coords = [];
        for (let s = 0; s < plan.net.S; s++) if (plan.net.stops.line[s] === li) coords.push([plan.net.stops.lng[s], plan.net.stops.lat[s]]);
        const key = (l.ref || l.name) + coords.length;
        if (seen.has(key) || coords.length < 2) return null;
        seen.add(key);
        return { type: 'Feature', properties: { colour: l.colour || null }, geometry: { type: 'LineString', coordinates: coords } };
      }).filter(Boolean),
    });
  }

  const chosen = {};
  for (const m of Object.keys(MODES)) chosen[m] = plan.ranked[m][0];
  if (!chosen.minimax) {
    toast('No place everyone can reach. Try a different way to travel.', 6000);
    results.show({ plan, mode: state.mode, chosen, legs: null, prefs: defaultPrefs([0, 0]) });
    $('#setup').hidden = true;
    return;
  }

  await expandIsochrones(my, chosen.minimax);
  if (my !== runId) return;
  await revealScores(my);
  if (my !== runId) return;

  $('#setup').hidden = true;
  results.show({ plan, mode: state.mode, chosen, legs: null, prefs: defaultPrefs(chosen[state.mode].pos) });
  await selectPlace(chosen[state.mode], { first: true });
}

const H = { city: 260, region: 9000, world: 60000 };

async function expandIsochrones(my, best) {
  const iso = makeIsoBuilder(plan);
  plan.iso = iso;
  const tStar = best.stats.max;
  const tEnd = tStar * 1.35;
  frame(plan.people.map((p) => p.pos), { pitch: plan.tier === 'world' ? 15 : 50, bearing: plan.tier === 'world' ? 0 : -18, duration: 1800, maxZoom: 12.5 });
  await wait(1200);
  if (my !== runId) return;

  let reached = false, lastDraw = 0;
  const draw = (f) => {
    const t = easeInOut(f) * tEnd;
    clock(t);
    const now = performance.now();
    if (now - lastDraw > 45 || f >= 1) {
      lastDraw = now;
      setData(map, 'iso', iso.people(t));
      setData(map, 'overlap', iso.overlap(t, H[plan.tier] * (0.5 + 0.5 * Math.min(1, (t - tStar) / (tEnd - tStar + 1e-9)))));
    }
    if (!reached && t >= tStar) {
      reached = true;
      setStep('overlap');
      toast(`💛 First overlap at <b>${fmtMinutes(tStar)}</b>: everyone can reach this zone`);
    } else if (reached && t < tStar) { reached = false; setStep('reach'); }
  };
  await player.play({ durationMs: plan.tier === 'city' ? 7000 : 8500, onFrame: draw, text: 'Isochrones growing' });
}

async function revealScores(my) {
  setStep('score');
  toast(`Scoring <b>${plan.cands.length}</b> candidate places in 3 fairness modes…`, 2000);
  for (let k = 1; k <= 12; k++) {
    if (my !== runId) return;
    paintCandidates(state.mode, k / 12);
    await wait(60);
  }
  await wait(500);
}

function paintCandidates(mode, alpha = 1) {
  const ranked = plan.ranked[mode];
  const pos = new Map(ranked.map((c, i) => [c.id, i / Math.max(1, ranked.length - 1)]));
  setData(map, 'cands', {
    type: 'FeatureCollection',
    features: plan.cands.filter((c) => c.stats && Number.isFinite(c.stats.max)).map((c) => ({
      type: 'Feature',
      properties: { score: pos.get(c.id) ?? 1, alpha: (pos.has(c.id) ? 0.9 : 0.25) * alpha },
      geometry: { type: 'Point', coordinates: c.pos },
    })),
  });
}

async function selectPlace(c, { first = false } = {}) {
  if (!c) return;
  stopJourney();
  setStep('spot');
  const v = results.view;
  v.chosen[v.mode] = c;
  if (c.kind === 'area' && !c.name) c.name = (await reverseName(c.pos)) || 'Meeting spot';
  const legs = plan.journeyFor(c);
  v.prefs.season = seasonFor(c.pos[1]);
  results.update({ legs, clearIdeas: true });
  setData(map, 'beam', beamFeatures(c.pos, { city: 45, region: 4000, world: 25000 }[plan.tier], H[plan.tier] * 4));
  setData(map, 'pois', null);
  // Settle the map: hide the big bubbles, keep a low glow of the zone everyone reaches in time.
  setData(map, 'iso', null);
  setData(map, 'overlap', plan.iso?.overlap(c.stats.max + 1, H[plan.tier] * 0.12));
  paintCandidates(v.mode);
  $('#panel').scrollTo({ top: 0, behavior: first ? 'auto' : 'smooth' });
  const zoom = { city: 15.2, region: 9, world: 5 }[plan.tier];
  map.flyTo({ center: c.pos, zoom, pitch: plan.tier === 'world' ? 40 : 62, bearing: map.getBearing() + 30, duration: first ? 2600 : 1800, padding: pad(), essential: true });
  toast(`${MODES[v.mode].icon} <b>${placeTitle(c)}</b> · longest trip ${fmtMinutes(c.stats.max)}`);
  clock(null);
}

function chooseMode(m) {
  state.mode = m;
  const v = results.view;
  v.mode = m;
  paintCandidates(m);
  selectPlace(v.chosen[m]);
}

async function playJourneys(sameArrival) {
  const v = results.view;
  const c = v.chosen[v.mode];
  stopJourney();
  setStep('travel');
  setData(map, 'iso', null);
  setData(map, 'overlap', null);
  setData(map, 'cands', null);
  journey = createJourney(map, plan.people, v.legs, { sameArrival });
  // frame all routes
  frame([...v.legs.flat().flatMap((l) => l.coords), c.pos], { pitch: plan.tier === 'world' ? 20 : 55, duration: 1500, maxZoom: 14 });
  await wait(1300);
  const total = journey.duration;
  const durationMs = Math.min(16000, Math.max(8000, total * 120));
  let lastCam = 0;
  await player.play({
    durationMs,
    text: sameArrival ? 'Everyone arrives together' : 'Everyone leaves together',
    onFrame: (f) => {
      if (!journey) return;
      const t = f * total;
      const states = journey.render(t);
      clock(t, 'trip time');
      if (followIdx >= 0 && states[followIdx] && performance.now() - lastCam > 120) {
        lastCam = performance.now();
        map.easeTo({ center: states[followIdx].pos, duration: 200, easing: (x) => x });
      }
    },
    onEnd: () => {
      toast(`🎉 Everyone made it to <b>${placeTitle(c)}</b>`);
      map.flyTo({ center: c.pos, zoom: { city: 16, region: 10, world: 6 }[plan.tier], pitch: 62, bearing: map.getBearing() - 40, duration: 2400, padding: pad() });
    },
  });
}

function stopJourney() {
  journey?.destroy();
  journey = null;
}

function backToSetup() {
  runId++;
  stopJourney();
  player.stop();
  clearAll(map);
  clock(null);
  results.hide();
  $('#setup').hidden = false;
  setStep('friends');
  drawPeople();
  fitPeople();
}

// ---------- ideas ----------
function defaultPrefs(pos) {
  return { season: seasonFor(pos[1]), budget: '$$ medium', lang: navigator.language?.startsWith('ko') ? '한국어' : 'English', vibes: ['🍜 Food'], notes: '' };
}

async function getIdeas(prefs, out) {
  const v = results.view;
  const c = v.chosen[v.mode];
  setStep('ideas');
  out.innerHTML = '<div class="loading"><span></span> Looking around the spot…</div>';
  const pois = await nearbyPlaces(c.pos, plan.tier === 'city' ? 700 : 2500);
  setData(map, 'pois', { type: 'FeatureCollection', features: [] });
  out.innerHTML = `<div class="loading"><span></span> Found ${pois.length} places nearby. Asking Claude for ideas…</div>`;
  const body = {
    tier: plan.tier,
    place: { name: placeTitle(c), country: c.country || '', lng: c.pos[0], lat: c.pos[1] },
    people: plan.people.map((p, i) => ({
      name: p.name,
      minutes: Math.round(c.times[i]),
      how: [...new Set((v.legs[i] || []).map((l) => l.mode))].join(' + ') || p.mode,
    })),
    prefs: { ...prefs, vibes: prefs.vibes.map((s) => s.replace(/^\S+\s/, '')) },
    pois: pois.slice(0, 80).map(({ name, nameEn, kind, cuisine }) => ({ name, nameEn, kind, cuisine })),
  };
  const show = (p) => {
    if (!p) return;
    setData(map, 'pois', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: p.name }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }] });
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16), pitch: 60, duration: 1400, padding: pad() });
  };
  try {
    const res = await fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error === 'no-key'
        ? 'AI ideas need an Anthropic API key (ANTHROPIC_API_KEY in .env). Meanwhile, here are real places near the spot:'
        : `AI ideas failed (${data.error || res.status}). Here are real places near the spot:`;
      renderPoiFallback(out, msg, pois, show);
      return;
    }
    renderIdeas(out, data, pois, show);
  } catch (err) {
    renderPoiFallback(out, `Could not reach the ideas service (${err.message}). Here are real places near the spot:`, pois, show);
  }
}

// ---------- utils ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
