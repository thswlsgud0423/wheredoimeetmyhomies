// Ties the engine together: pick the map scale, build the graph, run one
// Dijkstra per person, score candidate places in all three fairness modes.
import { haversine } from '../geo.js';
import { makeGrid, rasterizeLand } from './grid.js';
import { buildNetwork } from './network.js';
import { solve, reconstruct, profileFor } from './solver.js';
import { rank, stats } from './fairness.js';

export const TIERS = {
  city: { label: 'Within a city', cells: 200, cap: 300, slack: 10, padKm: 3, padFrac: 0.35 },
  region: { label: 'Between cities', cells: 220, cap: 1800, slack: 30, padKm: 60, padFrac: 0.3 },
  world: { label: 'Across countries', cells: 260, cap: 4320, slack: 90, padKm: 400, padFrac: 0.25 },
};

export function maxSpreadKm(people) {
  let m = 0;
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++)
      m = Math.max(m, haversine(people[i].pos, people[j].pos) / 1000);
  return m;
}

export function chooseTier(people) {
  const km = maxSpreadKm(people);
  return km < 45 ? 'city' : km < 900 ? 'region' : 'world';
}

export function areaFor(people, tier) {
  let lngs = people.map((p) => p.pos[0]);
  const lats = people.map((p) => p.pos[1]);
  // Use the narrower of "plain" or "wrapped across the antimeridian".
  const span = (ls) => Math.max(...ls) - Math.min(...ls);
  const wrapped = lngs.map((l) => (l < 0 ? l + 360 : l));
  if (span(wrapped) < span(lngs)) lngs = wrapped;
  let w = Math.min(...lngs), e = Math.max(...lngs);
  let s = Math.min(...lats), n = Math.max(...lats);
  const T = TIERS[tier];
  const midLat = (s + n) / 2;
  const kmLng = 111.32 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const spanKm = Math.max((e - w) * kmLng, (n - s) * 111.32);
  const padKm = Math.max(T.padKm, spanKm * T.padFrac);
  w -= padKm / kmLng; e += padKm / kmLng;
  s -= padKm / 111.32; n += padKm / 111.32;
  if (w >= 180) { w -= 360; e -= 360; }
  if (w < -180) { w += 360; e += 360; }
  return [w, Math.max(-75, s), Math.min(w + 360, e), Math.min(80, n)];
}

/**
 * people: [{ id, name, color, pos: [lng, lat], mode: 'transit'|'car'|'walk' }]
 * deps: { loadRail(bbox), loadAirports(), loadCities(), loadLand() } (async, may return null)
 */
export async function buildPlan(people, deps, onStage = () => {}) {
  const tier = chooseTier(people);
  const T = TIERS[tier];
  const bbox = areaFor(people, tier);
  onStage('area', { tier, bbox });

  const grid = makeGrid(bbox, T.cells);
  const notes = [];
  let lines = [];
  if (tier === 'city' && people.some((p) => p.mode === 'transit')) {
    onStage('rail');
    try { lines = (await deps.loadRail(grid.bbox)) || []; }
    catch (err) { notes.push(`Rail data unavailable (${err.message}); public transport uses an average bus speed.`); }
  }
  let airports = [];
  if (tier !== 'city') {
    onStage('land');
    const land = await deps.loadLand();
    if (land) grid.land = rasterizeLand(grid, land);
    airports = (await deps.loadAirports()) || [];
  }
  const net = buildNetwork(grid, { lines, airports });
  const hasRail = net.S > 0;
  if (tier === 'city' && !hasRail && people.some((p) => p.mode === 'transit') && !notes.length)
    notes.push('No rail lines found here; public transport uses an average bus speed.');

  // --- one search per person ---
  const runs = [];
  for (let i = 0; i < people.length; i++) {
    onStage('solve', { i, n: people.length });
    await tick();
    const profile = profileFor(people[i].mode, tier, hasRail);
    runs.push({ profile, ...solve(net, people[i].pos, profile, T.cap) });
  }

  // --- candidate meeting places ---
  onStage('candidates');
  const cands = await candidatesFor(tier, net, deps);
  for (const c of cands) {
    c.times = runs.map((r) => r.time[c.cell]);
    c.stats = stats(c.times);
  }
  const ranked = {};
  for (const m of ['equal', 'minimax', 'efficient']) ranked[m] = rank(cands, m, T.slack);

  // Minimax field (= when the last person can reach each cell): its contours are the overlap.
  const maxField = new Float32Array(grid.N);
  for (let i = 0; i < grid.N; i++) {
    let m = 0;
    for (const r of runs) m = Math.max(m, r.time[i]);
    maxField[i] = m;
  }

  const journeys = new Map();
  const journeyFor = (cand) => {
    if (!journeys.has(cand.id)) {
      journeys.set(cand.id, runs.map((r, i) => reconstruct(net, r, cand.cell, r.profile, tier)));
    }
    return journeys.get(cand.id);
  };

  return { tier, tierLabel: T.label, bbox, grid, net, runs, maxField, cands, ranked, notes, journeyFor, people };
}

async function candidatesFor(tier, net, deps) {
  const { grid } = net;
  const out = [];
  if (tier === 'city' && net.S > 0) {
    // Stations, merged across lines: same base name (before any bracket) within 600 m.
    const groups = new Map(); // base name -> [group]
    for (let s = 0; s < net.S; s++) {
      const name = net.stops.name[s];
      if (!name) continue;
      const base = name.split(/[(（]/)[0].trim() || name;
      const p = [net.stops.lng[s], net.stops.lat[s]];
      const list = groups.get(base) ?? [];
      groups.set(base, list);
      let g = list.find((x) => haversine([x.lng / x.n, x.lat / x.n], p) < 600);
      if (!g) { g = { name: base, nameEn: '', lng: 0, lat: 0, n: 0, lines: new Set() }; list.push(g); }
      if (!g.nameEn && net.stops.nameEn[s]) g.nameEn = net.stops.nameEn[s].split(/[(]/)[0].trim();
      g.lng += p[0]; g.lat += p[1]; g.n++;
      g.lines.add(net.stops.line[s]);
    }
    for (const g of [...groups.values()].flat()) {
      const pos = [g.lng / g.n, g.lat / g.n];
      out.push({ id: 'st:' + g.name + pos.join(), kind: 'station', name: g.name, nameEn: g.nameEn, pos, cell: grid.cellOf(pos), lines: [...g.lines].map((li) => net.lines[li]) });
    }
  } else if (tier === 'city') {
    const step = Math.max(2, Math.round(Math.sqrt(grid.N / 500)));
    for (let r = step >> 1; r < grid.H; r += step)
      for (let c = step >> 1; c < grid.W; c += step) {
        const cell = r * grid.W + c;
        out.push({ id: 'cell:' + cell, kind: 'area', name: '', pos: grid.center(cell), cell });
      }
  } else {
    const cities = (await deps.loadCities()) || [];
    for (const ct of cities) {
      const pos = [ct[3], ct[4]];
      if (!grid.contains(pos)) continue;
      const cell = grid.cellOf(pos);
      out.push({ id: 'city:' + ct[0] + ct[2], kind: 'city', name: ct[0], country: ct[1], iso: ct[2], pop: ct[5], capital: !!ct[6], pos, cell });
      if (out.length >= 900) break; // list is sorted by population
    }
  }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
