// "Every route": for each person, the union of their best routes to every candidate
// place, as short line pieces stamped with the minute they are reached (t0..t1).
// The map shows a piece once the clock passes t0, so routes grow along rail lines,
// roads and flight arcs exactly as fast as the person could travel them.
import { E } from './solver.js';
import { greatCircle } from '../geo.js';

export function routeTree(plan, limit = plan.tier === 'city' ? Infinity : 35) {
  const { net, runs, people } = plan;
  // targets: every candidate in a city; the best few per fairness mode elsewhere
  const ids = new Set();
  for (const m of Object.keys(plan.ranked)) plan.ranked[m].slice(0, limit).forEach((c) => ids.add(c.id));
  const cands = plan.cands.filter((c) => ids.has(c.id));
  const { N, S } = net;
  const features = [];
  const airports = new Set();
  runs.forEach((r, i) => {
    const color = people[i].color;
    const on = new Uint8Array(net.total);
    for (const c of cands) {
      if (!Number.isFinite(r.time[c.cell])) continue;
      for (let n = c.cell; n >= 0 && !on[n]; n = r.prev[n]) on[n] = 1;
    }
    for (let n = 0; n < net.total; n++) {
      if (!on[n]) continue;
      if (n >= N + S) airports.add(n - N - S);
      const p = r.prev[n];
      if (p < 0) continue;
      const via = r.via[n];
      const a = net.nodeLngLat(p), b = net.nodeLngLat(n);
      const t0 = r.time[p], t1 = r.time[n];
      if (via === E.FLIGHT) {
        // split the arc so it draws out over the flight instead of popping in
        const from = net.airports[p - N - S], to = net.airports[n - N - S];
        const domestic = from[3] === to[3];
        const s0 = t0 + (domestic ? 60 : 105), s1 = t1 - (domestic ? 25 : 45);
        const arc = greatCircle(a, b, 20);
        for (let k = 1; k < arc.length; k++) {
          features.push(piece([arc[k - 1], arc[k]], s0 + ((s1 - s0) * (k - 1)) / (arc.length - 1), 'flight', color, i));
        }
      } else if (via === E.RIDE) {
        features.push(piece([a, b], t0, 'rail', color, i));
      } else if (via === E.GROUND) {
        const water = net.grid.land && !net.grid.land[n];
        features.push(piece([a, b], t0, water ? 'ferry' : 'ground', color, i));
      }
      // board/alight/airport hops are a few meters: not drawn
    }
  });
  return {
    tree: { type: 'FeatureCollection', features },
    airports: {
      type: 'FeatureCollection',
      features: [...airports].map((a) => {
        const ap = net.airports[a];
        return { type: 'Feature', properties: { code: ap[0] }, geometry: { type: 'Point', coordinates: [ap[4], ap[5]] } };
      }),
    },
  };
}

function piece(coords, t0, kind, color, i) {
  return { type: 'Feature', properties: { t0, kind, color, i }, geometry: { type: 'LineString', coordinates: coords } };
}

