// Browser-side data loaders handed to the engine. Big files load only when needed.
import { fetchRail, overpass } from '../engine/transit.js';

const inside = (outer, inner) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

// Rail networks shipped with the app; anywhere else is fetched live from OpenStreetMap.
const BUNDLED = [
  { bbox: [126.55, 37.2, 127.35, 37.8], load: () => import('./seoul-rail.json') },
  { bbox: [16.0, 47.95, 16.75, 48.45], load: () => import('./vienna-rail.json') },
];

export const deps = {
  async loadRail(bbox) {
    const hit = BUNDLED.find((b) => inside(b.bbox, bbox));
    if (hit) return (await hit.load()).default.lines;
    const key = 'rail:' + bbox.map((v) => v.toFixed(2)).join(',');
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) return JSON.parse(cached);
    } catch { /* storage unavailable */ }
    const lines = await fetchRail(bbox, { timeoutMs: 45000 });
    try { sessionStorage.setItem(key, JSON.stringify(lines)); } catch { /* too big or blocked */ }
    return lines;
  },
  async loadAirports() { return (await import('./airports.json')).default; },
  async loadCities() { return (await import('./cities.json')).default; },
  async loadLand() {
    const [{ feature }, topo] = await Promise.all([
      import('topojson-client'),
      import('world-atlas/land-50m.json').then((m) => m.default),
    ]);
    return feature(topo, topo.objects.land).features[0].geometry;
  },
};

// Famous places near a point: real places in OpenStreetMap that have a Wikipedia article
// (landmarks, museums, palaces, parks, legendary cafés and restaurants), ranked by how much
// Wikipedia has to say about them, with a photo when there is one.
// Two sources, merged: Wikipedia's own geo search (fast, ~1 s) and OpenStreetMap objects that link
// to Wikipedia (slower, but it knows which ones are restaurants, cafés and parks).
export async function famousPlaces(pos, radius) {
  const [wiki, osm] = await Promise.all([wikiNearby(pos, radius), withTimeout(osmFamous(pos, radius), 8000, [])]);
  const seen = new Set();
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return [...osm, ...wiki]
    .filter((p) => {
      const keys = [p.name, p.nameEn, p.wiki].filter(Boolean).map(norm);
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 40);
}

const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

const NOT_A_SIGHT = /\b(court|regulator|bank|ministry|embassy|diplomatic|corporation|government|secretariat|agency|council|insurance|company|organi[sz]ation|office|headquarters|school|gymnasium|institute|research|universit|college|academy of sciences|station|crown|artifact|treasure|manuscript|painting|statue of|tomb of|archive|association|federation|party|newspaper|broadcaster|parliament building)/i;
function kindFrom(desc) {
  if (/restaurant|eatery|diner/i.test(desc)) return 'restaurant';
  if (/caf[eé]|coffee/i.test(desc)) return 'cafe';
  if (/bakery|patisserie|pastry|confection/i.test(desc)) return 'bakery';
  if (/\bmarket\b/i.test(desc)) return 'marketplace';
  if (/\bbar\b|pub\b|brewery/i.test(desc)) return 'bar';
  if (/museum/i.test(desc)) return 'museum';
  if (/gallery/i.test(desc)) return 'gallery';
  if (/park|garden/i.test(desc)) return 'park';
  if (/church|cathedral|basilica|temple|shrine|mosque|synagogue|abbey/i.test(desc)) return 'place_of_worship';
  if (/theat|opera|concert/i.test(desc)) return 'theatre';
  if (/tower|observation/i.test(desc)) return 'tower';
  if (/palace|castle|fortress|gate|ruins|historic|heritage/i.test(desc)) return 'historic';
  if (/shopping|department store|mall/i.test(desc)) return 'mall';
  return 'attraction';
}

async function wikiNearby(pos, radius) {
  const u = new URL('https://en.wikipedia.org/w/api.php');
  Object.entries({
    action: 'query', format: 'json', origin: '*', generator: 'geosearch',
    ggscoord: `${pos[1]}|${pos[0]}`, ggsradius: String(Math.min(10000, Math.round(radius))), ggslimit: '200',
    prop: 'coordinates|description|pageimages|info', coprop: 'type', colimit: 'max', pilimit: 'max', pithumbsize: '240',
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  try {
    const res = await fetch(u);
    if (!res.ok) return [];
    return Object.values((await res.json()).query?.pages || {})
      .filter((p) => p.coordinates?.[0]?.type === 'landmark' && !NOT_A_SIGHT.test(p.description || ''))
      .map((p) => ({
        name: p.title.replace(/,\s.*$/, ''), nameEn: '', kind: kindFrom(p.description || ''), cuisine: '', desc: p.description || '',
        lng: p.coordinates[0].lon, lat: p.coordinates[0].lat, size: p.length || 0, img: p.thumbnail?.source || '',
        wiki: `en:${p.title}`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, famous: true,
      }));
  } catch { return []; }
}

async function osmFamous(pos, radius) {
  let list = [];
  try { list = parseFamous(await overpass(famousQuery(pos, radius), { timeoutMs: 8000 })); }
  catch { return []; }
  const byLang = new Map();
  for (const p of list) {
    if (!byLang.has(p.lang)) byLang.set(p.lang, []);
    byLang.get(p.lang).push(p);
  }
  await Promise.all([...byLang].map(async ([lang, ps]) => {
    for (let k = 0; k < ps.length; k += 50) await enrich(lang, ps.slice(k, k + 50));
  }));
  return list.filter((p) => p.size > 0 && !NOT_A_SIGHT.test(p.desc || ''));
}

async function enrich(lang, ps) {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  Object.entries({
    action: 'query', format: 'json', origin: '*', redirects: '1', titles: ps.map((p) => p.title).join('|'),
    prop: 'info|pageimages|description', pithumbsize: '240', pilimit: 'max',
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  try {
    const q = (await (await fetch(u)).json()).query || {};
    const alias = new Map();
    for (const n of [...(q.normalized || []), ...(q.redirects || [])]) alias.set(n.from, n.to);
    const pages = new Map(Object.values(q.pages || {}).map((pg) => [pg.title, pg]));
    for (const p of ps) {
      let t = p.title;
      for (let k = 0; k < 3 && alias.has(t); k++) t = alias.get(t);
      const pg = pages.get(t);
      if (!pg || pg.missing !== undefined) continue;
      p.size = pg.length || 0;
      p.img = pg.thumbnail?.source || '';
      p.desc = pg.description || '';
      p.wiki = `${lang}:${t}`;
      p.url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`;
    }
  } catch { /* keep them unranked */ }
}

function famousQuery([lng, lat], radius) {
  const a = `(around:${Math.round(radius)},${lat},${lng})`;
  return `[out:json][timeout:40];(
nwr["wikipedia"]["tourism"~"^(attraction|museum|gallery|viewpoint|theme_park|zoo|aquarium)$"]${a};
nwr["wikipedia"]["historic"]["historic"!~"^(boundary_stone|milestone|wayside_cross|wayside_shrine|memorial|tomb)$"]${a};
nwr["wikipedia"]["amenity"~"^(place_of_worship|theatre|arts_centre|restaurant|cafe|bar|pub|biergarten|marketplace|food_court|ice_cream|concert_hall)$"]${a};
nwr["wikipedia"]["leisure"~"^(park|garden|water_park|stadium)$"]${a};
nwr["wikipedia"]["shop"~"^(department_store|mall|bakery|confectionery|pastry|chocolate)$"]${a};
nwr["wikipedia"]["man_made"~"^(tower|lighthouse)$"]${a};
);out center tags 600;`;
}

function parseFamous(json) {
  const out = [];
  for (const el of json.elements || []) {
    const t = el.tags || {};
    const m = /^([a-z-]{2,12}):(.+)$/.exec(t.wikipedia || '');
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!m || !t.name || lat == null || t.brand || t['brand:wikidata'] || /^(battlefield|boundary_stone)$/.test(t.historic || '')) continue;
    const kind = t.tourism || (t.historic && 'historic') || t.amenity || t.leisure || t.shop || t.man_made || 'place';
    out.push({ name: t.name, nameEn: t['name:en'] || '', kind, cuisine: t.cuisine || '', lng, lat, lang: m[1], title: m[2], size: 0, famous: true });
  }
  return out;
}

// Find a named place near the meeting point (for picks the model suggested from its own knowledge).
export async function locate(name, near, maxKm = 40) {
  try {
    const hits = await searchPlaces(name, near);
    const R = Math.PI / 180;
    const km = (a) => 6371 * Math.acos(Math.min(1, Math.sin(a[1] * R) * Math.sin(near[1] * R) + Math.cos(a[1] * R) * Math.cos(near[1] * R) * Math.cos((a[0] - near[0]) * R)));
    return hits.find((h) => km(h.pos) <= maxKm) || null;
  } catch { return null; }
}

// Place search (Photon, OpenStreetMap-based).
// Place search. Cities come first from the bundled list (instant, ranked by size), then
// OpenStreetMap (Photon): towns and districts anywhere, then addresses and venues near the map view.
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let cityIndex = null;
export async function searchCities(q, limit = 5) {
  const f = fold(q);
  if (f.length < 2) return [];
  cityIndex ??= (await deps.loadCities()).map((c) => ({ c, key: fold(c[0]) }));
  const hits = [];
  for (const { c, key } of cityIndex) {
    const rank = key === f ? 0 : key.startsWith(f) ? 1 : key.includes(' ' + f) ? 2 : -1;
    if (rank >= 0) hits.push({ rank, c });
  }
  hits.sort((a, b) => a.rank - b.rank || b.c[5] - a.c[5]);
  return hits.slice(0, limit).map(({ c }) => ({ name: c[0], sub: `City · ${c[1]}`, pos: [c[3], c[4]], kind: 'city' }));
}

function photonItem(f) {
  const p = f.properties;
  const sub = [p.city && p.city !== p.name ? p.city : '', p.state && p.state !== p.city && p.state !== p.name ? p.state : '', p.country].filter(Boolean).join(', ');
  return { name: p.name || p.street || sub, sub, pos: f.geometry.coordinates };
}
async function photon(params) {
  const u = new URL('https://photon.komoot.io/api/');
  for (const [k, v] of params) u.searchParams.append(k, v);
  const res = await fetch(u);
  if (!res.ok) return [];
  return (await res.json()).features.map(photonItem);
}

export async function searchPlaces(q, bias) {
  const near = bias ? [['lon', bias[0].toFixed(3)], ['lat', bias[1].toFixed(3)], ['location_bias_scale', '0.3']] : [];
  const [cities, places, local] = await Promise.all([
    searchCities(q).catch(() => []),
    // cities, towns, districts anywhere in the world (no location bias)
    photon([['q', q], ['limit', '5'], ['layer', 'city'], ['layer', 'district'], ['layer', 'locality'], ['layer', 'county'], ['layer', 'state']]).catch(() => []),
    // stations, streets, venues: prefer ones near what the map shows
    photon([['q', q], ['limit', '5'], ...near]).catch(() => []),
  ]);
  const out = [];
  const close = (a, b) => Math.abs(a[0] - b[0]) < 0.3 && Math.abs(a[1] - b[1]) < 0.3;
  for (const it of [...cities, ...places, ...local]) {
    if (out.some((o) => fold(o.name) === fold(it.name) && close(o.pos, it.pos))) continue;
    out.push(it);
    if (out.length >= 8) break;
  }
  return out;
}

export async function reverseName(pos) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${pos[0]}&lat=${pos[1]}`);
    const p = (await res.json()).features?.[0]?.properties;
    if (!p) return '';
    return [p.name || p.street || p.district, p.city || p.county].filter(Boolean).join(', ');
  } catch { return ''; }
}
