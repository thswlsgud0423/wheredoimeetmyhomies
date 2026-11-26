// Browser-side data loaders handed to the engine. Big files load only when needed.
import { fetchRail, overpass, poiQuery, parsePois } from '../engine/transit.js';

const inside = (outer, inner) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

export const deps = {
  async loadRail(bbox) {
    const seoul = (await import('./seoul-rail.json')).default;
    if (inside(seoul.bbox, bbox)) return seoul.lines;
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

export async function nearbyPlaces(pos, radius) {
  try { return parsePois(await overpass(poiQuery(pos, radius), { timeoutMs: 25000 })); }
  catch { return []; }
}

// Place search (Photon, OpenStreetMap-based).
export async function searchPlaces(q, bias) {
  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', q);
  u.searchParams.set('limit', '6');
  if (bias) { u.searchParams.set('lon', bias[0].toFixed(3)); u.searchParams.set('lat', bias[1].toFixed(3)); }
  const res = await fetch(u);
  if (!res.ok) return [];
  const j = await res.json();
  return j.features.map((f) => {
    const p = f.properties;
    const sub = [p.city && p.city !== p.name ? p.city : '', p.state && p.state !== p.city ? p.state : '', p.country].filter(Boolean).join(', ');
    return { name: p.name || p.street || sub, sub, pos: f.geometry.coordinates };
  });
}

export async function reverseName(pos) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${pos[0]}&lat=${pos[1]}`);
    const p = (await res.json()).features?.[0]?.properties;
    if (!p) return '';
    return [p.name || p.street || p.district, p.city || p.county].filter(Boolean).join(', ');
  } catch { return ''; }
}
