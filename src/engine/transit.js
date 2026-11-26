// Rail / subway network from OpenStreetMap (Overpass API).
// A "line" is one OSM route relation: an ordered list of stops.
//   { name, ref, route, colour, stops: [[lng, lat, name, nameEn], ...] }

export const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const RAIL_SPEED_KMH = { subway: 34, light_rail: 30, monorail: 30, train: 52, tram: 17 };

export function railQuery([w, s, e, n]) {
  const bb = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  return `[out:json][timeout:90];relation["route"~"^(subway|light_rail|train|monorail|tram)$"](${bb});out body;(node(r:"stop");node(r:"stop_entry_only");node(r:"stop_exit_only");node(r:"platform"););out body;`;
}

// Try each mirror in turn; public servers are often busy.
export async function overpass(query, { timeoutMs = 60000, signal, fetchImpl = fetch } = {}) {
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctl.signal,
      });
      const text = await res.text();
      if (!res.ok || text[0] !== '{') throw new Error(`${url}: HTTP ${res.status}`);
      return JSON.parse(text);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr ?? new Error('Overpass unavailable');
}

export function parseRail(json) {
  const nodes = new Map();
  for (const el of json.elements) if (el.type === 'node') nodes.set(el.id, el);
  const lines = [];
  for (const rel of json.elements) {
    if (rel.type !== 'relation') continue;
    const nodeMembers = rel.members.filter((m) => m.type === 'node' && nodes.has(m.ref));
    let picked = nodeMembers.filter((m) => m.role.startsWith('stop'));
    if (picked.length < 2) picked = nodeMembers.filter((m) => m.role === 'platform');
    const stops = [];
    for (const m of picked) {
      const n = nodes.get(m.ref);
      const t = n.tags || {};
      const prev = stops[stops.length - 1];
      if (prev && prev[0] === n.lon && prev[1] === n.lat) continue;
      stops.push([
        +n.lon.toFixed(6), +n.lat.toFixed(6),
        t.name || t['name:en'] || '', t['name:en'] || '',
      ]);
    }
    if (stops.length < 2) continue;
    const tg = rel.tags || {};
    lines.push({
      name: tg.name || tg.ref || 'Line',
      ref: tg.ref || '',
      route: tg.route,
      colour: tg.colour || tg.color || '',
      stops,
    });
  }
  return lines;
}

export async function fetchRail(bbox, opts) {
  return parseRail(await overpass(railQuery(bbox), opts));
}
