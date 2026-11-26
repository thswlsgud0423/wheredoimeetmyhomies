// A square grid in web-mercator space covering the area around the friends.
// Every cell is a node of the travel graph; its value is "minutes to get here".
import { EARTH_CIRC, lngToX, latToY, xToLng, yToLat } from '../geo.js';

export function makeGrid(bbox, maxCells = 200) {
  const [w, s, e, n] = bbox;
  const x0 = lngToX(w), x1 = lngToX(e);
  const y0 = latToY(Math.min(n, 82)), y1 = latToY(Math.max(s, -78));
  const cell = Math.max(x1 - x0, y1 - y0) / maxCells;
  const W = Math.max(8, Math.ceil((x1 - x0) / cell));
  const H = Math.max(8, Math.ceil((y1 - y0) / cell));
  const rowMeters = new Float64Array(H);
  const rowLat = new Float64Array(H);
  for (let r = 0; r < H; r++) {
    const lat = yToLat(y0 + (r + 0.5) * cell);
    rowLat[r] = lat;
    rowMeters[r] = cell * EARTH_CIRC * Math.cos((lat * Math.PI) / 180);
  }
  const lngW = xToLng(x0);
  const grid = {
    W, H, N: W * H, x0, y0, cell, rowMeters, rowLat,
    land: null, // Uint8Array, 1 = land (null = treat everything as land)
    bbox: [xToLng(x0), yToLat(y0 + H * cell), xToLng(x0 + W * cell), yToLat(y0)],
    // grid coords (col, row as floats, 0..W / 0..H) <-> lng/lat
    toLngLat(c, r) { return [xToLng(x0 + c * cell), yToLat(y0 + r * cell)]; },
    fromLngLat([lng, lat]) {
      let L = lng;
      while (L < lngW - 180) L += 360; // same world copy as the grid
      while (L > lngW + 540) L -= 360;
      return [(lngToX(L) - x0) / cell, (latToY(lat) - y0) / cell];
    },
    // unwrapped projection (no world-copy adjustment), used by the rasterizer
    fromLngLat0([lng, lat]) {
      return [(lngToX(lng) - x0) / cell, (latToY(Math.max(-85, Math.min(85, lat))) - y0) / cell];
    },
    cellOf(p) {
      const [c, r] = grid.fromLngLat(p);
      const ci = Math.min(W - 1, Math.max(0, Math.floor(c)));
      const ri = Math.min(H - 1, Math.max(0, Math.floor(r)));
      return ri * W + ci;
    },
    center(i) { return grid.toLngLat((i % W) + 0.5, Math.floor(i / W) + 0.5); },
    contains(p) {
      const [c, r] = grid.fromLngLat(p);
      return c >= 0 && r >= 0 && c < W && r < H;
    },
  };
  return grid;
}

// Rasterize land polygons (GeoJSON geometry, lng/lat) onto the grid with an
// even-odd scanline fill at each row's center latitude.
export function rasterizeLand(grid, geometry) {
  const { W, H } = grid;
  const land = new Uint8Array(W * H);
  const rows = Array.from({ length: H }, () => []);
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const shifts = [-360, 0, 360];
  for (const poly of polys) {
    for (const ring of poly) {
      for (const shift of shifts) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = grid.fromLngLat0([ring[i][0] + shift, ring[i][1]]);
          const b = grid.fromLngLat0([ring[i + 1][0] + shift, ring[i + 1][1]]);
          if (Math.abs(ring[i][0] - ring[i + 1][0]) > 180) continue; // antimeridian seam
          const rMin = Math.max(0, Math.ceil(Math.min(a[1], b[1]) - 0.5));
          const rMax = Math.min(H - 1, Math.floor(Math.max(a[1], b[1]) - 0.5));
          for (let r = rMin; r <= rMax; r++) {
            const y = r + 0.5;
            if ((a[1] <= y) === (b[1] <= y)) continue;
            const t = (y - a[1]) / (b[1] - a[1]);
            rows[r].push(a[0] + t * (b[0] - a[0]));
          }
        }
      }
    }
  }
  for (let r = 0; r < H; r++) {
    const xs = rows[r].sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) land[r * W + c] = 1;
    }
  }
  return land;
}
