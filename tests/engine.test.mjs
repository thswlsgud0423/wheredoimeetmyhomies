import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { feature } from 'topojson-client';
import { buildPlan, chooseTier } from '../src/engine/plan.js';
import { rank } from '../src/engine/fairness.js';

const json = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const seoul = await json('../src/data/seoul-rail.json');
const airports = await json('../src/data/airports.json');
const cities = await json('../src/data/cities.json');
const landTopo = JSON.parse(await readFile(new URL('../node_modules/world-atlas/land-50m.json', import.meta.url), 'utf8'));
const land = feature(landTopo, landTopo.objects.land).features[0].geometry;
const deps = {
  loadRail: async () => seoul.lines,
  loadAirports: async () => airports,
  loadCities: async () => cities,
  loadLand: async () => land,
};
const person = (name, lng, lat, mode = 'transit') => ({ name, pos: [lng, lat], mode });

test('fairness modes match the worked example', () => {
  const c = [
    { id: 'X', times: [60, 60, 60] },
    { id: 'Y', times: [50, 55, 55] },
    { id: 'Z', times: [10, 20, 90] },
  ];
  assert.equal(rank(c, 'equal')[0].id, 'X');
  assert.equal(rank(c, 'minimax')[0].id, 'Y');
  assert.equal(rank(c, 'efficient')[0].id, 'Z');
  // a perfectly equal but awful place is not eligible for "Equal"
  const c2 = [...c, { id: 'Far', times: [300, 300, 300] }];
  assert.equal(rank(c2, 'equal')[0].id, 'X');
});

test('Vienna: U-Bahn/tram trips, central station winner', async () => {
  const vienna = await json('../src/data/vienna-rail.json');
  const people = [
    person('Floridsdorf', 16.3977, 48.2566),
    person('Favoriten', 16.3779, 48.1749),
    person('Huetteldorf', 16.2614, 48.1973),
    person('Seestadt', 16.5078, 48.2262),
  ];
  assert.equal(chooseTier(people), 'city');
  const plan = await buildPlan(people, { ...deps, loadRail: async () => vienna.lines });
  for (const m of ['equal', 'minimax', 'efficient']) {
    const w = plan.ranked[m][0];
    console.log(`  ${m.padEnd(9)} ${w.name} ${w.times.map((t) => t.toFixed(0)).join('/')} min`);
    assert.equal(w.kind, 'station');
    assert.ok(w.stats.max < 60, 'nobody should need an hour inside Vienna');
  }
  const legs = plan.journeyFor(plan.ranked.equal[0]);
  console.log('  legs:', legs.map((ls) => ls.map((l) => l.mode + (l.line ? `(${l.line.ref || l.line.name})` : '')).join(' > ')).join(' | '));
  assert.ok(legs.flat().some((l) => ['subway', 'train', 'tram'].includes(l.mode)));
});

test('Seoul: subway trips, station winner, sensible times', async () => {
  const people = [
    person('Gangnam', 127.0276, 37.4979),
    person('Hongdae', 126.9237, 37.5563),
    person('Jamsil', 127.1001, 37.5133),
  ];
  assert.equal(chooseTier(people), 'city');
  const t0 = performance.now();
  const plan = await buildPlan(people, deps);
  console.log(`  seoul plan ${(performance.now() - t0).toFixed(0)} ms, ${plan.net.S} stops, ${plan.cands.length} stations`);
  for (const m of ['equal', 'minimax', 'efficient']) {
    const w = plan.ranked[m][0];
    console.log(`  ${m.padEnd(9)} ${w.name} ${w.times.map((t) => t.toFixed(0)).join('/')} min`);
    assert.equal(w.kind, 'station');
    assert.ok(w.stats.max < 70, 'nobody should need over 70 min inside Seoul');
  }
  const legs = plan.journeyFor(plan.ranked.minimax[0]);
  assert.equal(legs.length, 3);
  const modes = legs.flat().map((l) => l.mode);
  console.log('  legs:', legs.map((ls) => ls.map((l) => l.mode + (l.line ? `(${l.line.ref || l.line.name})` : '')).join(' > ')).join(' | '));
  assert.ok(modes.includes('subway') || modes.includes('train'));
  // Gangnam -> Hongdae by subway is ~35-45 min in reality
  const g = plan.runs[0].time[plan.grid.cellOf([126.9237, 37.5563])];
  console.log(`  Gangnam -> Hongdae ${g.toFixed(0)} min`);
  assert.ok(g > 25 && g < 60);
});

test('East Asia: flights between countries', async () => {
  const people = [
    person('Seoul', 126.978, 37.566),
    person('Tokyo', 139.692, 35.69),
    person('Taipei', 121.565, 25.033),
  ];
  assert.equal(chooseTier(people), 'world');
  const t0 = performance.now();
  const plan = await buildPlan(people, deps);
  console.log(`  east asia plan ${(performance.now() - t0).toFixed(0)} ms, ${plan.net.A} airports, ${plan.cands.length} cities`);
  for (const m of ['equal', 'minimax', 'efficient']) {
    const w = plan.ranked[m][0];
    console.log(`  ${m.padEnd(9)} ${w.name}, ${w.country} ${w.times.map((t) => (t / 60).toFixed(1)).join('/')} h`);
    assert.ok(w.stats.max < 12 * 60);
  }
  const legs = plan.journeyFor(plan.ranked.minimax[0]);
  console.log('  legs:', legs.map((ls) => ls.map((l) => l.mode).join(' > ')).join(' | '));
  assert.ok(legs.flat().some((l) => l.mode === 'flight'));
});

test('Europe: ground and flights mix', async () => {
  const people = [
    person('London', -0.1276, 51.5072),
    person('Berlin', 13.405, 52.52),
    person('Madrid', -3.7038, 40.4168),
    person('Rome', 12.4964, 41.9028, 'car'),
  ];
  const plan = await buildPlan(people, deps);
  const w = plan.ranked.minimax[0];
  console.log(`  europe minimax ${w.name} ${w.times.map((t) => (t / 60).toFixed(1)).join('/')} h`);
  assert.ok(w.stats.max < 15 * 60);
});

test('Across the antimeridian (Seoul, LA, Sydney)', async () => {
  const people = [person('Seoul', 126.978, 37.566), person('LA', -118.24, 34.05), person('Sydney', 151.21, -33.87)];
  const plan = await buildPlan(people, deps);
  const w = plan.ranked.minimax[0];
  console.log(`  pacific minimax ${w.name}, ${w.country} ${w.times.map((t) => (t / 60).toFixed(1)).join('/')} h`);
  assert.ok(Number.isFinite(w.stats.max));
});
