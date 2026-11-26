// Turns "minutes to each grid cell" into isochrone polygons with d3-contour.
import { contours } from 'd3-contour';

const NEVER = -1e9;

export function makeIsoBuilder(plan) {
  const { grid } = plan;
  const { W, H } = grid;
  const gen = contours().size([W, H]).smooth(true);
  // d3-contour keeps values >= threshold, so negate: -time >= -t  <=>  time <= t
  const neg = (field) => {
    const a = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) a[i] = Number.isFinite(field[i]) ? -field[i] : NEVER;
    return a;
  };
  const fields = plan.runs.map((r) => neg(r.time.subarray(0, grid.N)));
  const maxField = neg(plan.maxField);

  const toGeo = (multi) => multi.coordinates.map((poly) =>
    poly.map((ring) => ring.map(([c, r]) => grid.toLngLat(c, r))));

  const contourAt = (field, t) => {
    const [mp] = gen.thresholds([-t])(field);
    return mp && mp.coordinates.length ? { type: 'MultiPolygon', coordinates: toGeo(mp) } : null;
  };

  return {
    people(t) {
      const features = [];
      plan.people.forEach((p, i) => {
        const g = contourAt(fields[i], t);
        if (g) features.push({ type: 'Feature', properties: { color: p.color, i }, geometry: g });
      });
      return { type: 'FeatureCollection', features };
    },
    overlap(t, h) {
      const g = contourAt(maxField, t);
      return { type: 'FeatureCollection', features: g ? [{ type: 'Feature', properties: { h }, geometry: g }] : [] };
    },
  };
}
