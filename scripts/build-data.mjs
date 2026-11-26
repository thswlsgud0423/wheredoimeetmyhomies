// Rebuilds the bundled datasets in src/data/.
//   node scripts/build-data.mjs
// Sources: OurAirports (public domain), Natural Earth populated places (public domain),
// OpenStreetMap via Overpass (ODbL) for the bundled Seoul rail network.
import { writeFile, mkdir } from 'node:fs/promises';
import { fetchRail } from '../src/engine/transit.js';

const out = new URL('../src/data/', import.meta.url);
await mkdir(out, { recursive: true });

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function airports() {
  const text = await (await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv')).text();
  const [head, ...rows] = parseCsv(text);
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const list = rows
    .filter((r) => r[col.type] === 'large_airport' && r[col.scheduled_service] === 'yes' && r[col.iata_code])
    .map((r) => [
      r[col.iata_code], r[col.name], r[col.municipality], r[col.iso_country],
      +(+r[col.longitude_deg]).toFixed(4), +(+r[col.latitude_deg]).toFixed(4),
    ]);
  await writeFile(new URL('airports.json', out), JSON.stringify(list));
  console.log('airports', list.length);
}

async function cities() {
  const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
  const gj = await (await fetch(url)).json();
  const list = gj.features
    .map((f) => f.properties)
    .filter((p) => p.pop_max >= 50000 || /capital/i.test(p.featurecla))
    .sort((a, b) => b.pop_max - a.pop_max)
    .map((p) => [
      p.name, p.adm0name, p.iso_a2, +(+p.longitude).toFixed(4), +(+p.latitude).toFixed(4),
      p.pop_max, /Admin-0 capital/.test(p.featurecla) ? 1 : 0,
    ]);
  await writeFile(new URL('cities.json', out), JSON.stringify(list));
  console.log('cities', list.length);
}

async function seoulRail() {
  // Greater Seoul (Seoul, Incheon, inner Gyeonggi)
  const lines = await fetchRail([126.55, 37.2, 127.35, 37.8], { timeoutMs: 120000 });
  await writeFile(new URL('seoul-rail.json', out), JSON.stringify({ bbox: [126.55, 37.2, 127.35, 37.8], lines }));
  console.log('seoul lines', lines.length, 'stops', lines.reduce((s, l) => s + l.stops.length, 0));
}

// Bundled city rail networks (subway, S-Bahn, tram) so the default examples load instantly.
export const BUNDLED = {
  vienna: [16.0, 47.95, 16.75, 48.45],
};
async function bundledRail(name, bbox) {
  const lines = await fetchRail(bbox, { timeoutMs: 120000 });
  await writeFile(new URL(`${name}-rail.json`, out), JSON.stringify({ bbox, lines }));
  console.log(name, 'lines', lines.length, 'stops', lines.reduce((s, l) => s + l.stops.length, 0));
}

const only = process.argv[2];
if (only) await bundledRail(only, BUNDLED[only]);
else await Promise.all([airports(), cities(), seoulRail(), ...Object.entries(BUNDLED).map(([k, b]) => bundledRail(k, b))]);
