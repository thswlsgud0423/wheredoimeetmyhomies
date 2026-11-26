// Small geometry helpers shared by the engine, the map and the build script.

export const EARTH_R = 6371008.8; // meters
export const EARTH_CIRC = 2 * Math.PI * 6378137; // web-mercator circumference
const RAD = Math.PI / 180;

export function haversine(a, b) {
  // a, b: [lng, lat] -> meters
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Web mercator in unit square: x 0..1 (west->east), y 0..1 (north->south).
export function lngToX(lng) { return (lng + 180) / 360; }
export function xToLng(x) { return x * 360 - 180; }
export function latToY(lat) {
  const s = Math.sin(lat * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export function yToLat(y) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

// Points along the great circle between a and b (for flight arcs).
export function greatCircle(a, b, n = 64) {
  const [l1, p1] = [a[0] * RAD, a[1] * RAD];
  const [l2, p2] = [b[0] * RAD, b[1] * RAD];
  const d = haversine(a, b) / EARTH_R;
  if (d < 1e-9) return [a, b];
  const out = [];
  let prevLng = a[0];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    let lng = Math.atan2(y, x) / RAD;
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD;
    // keep the line continuous across the antimeridian
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    out.push([lng, lat]);
  }
  return out;
}

export function lineLength(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += haversine(coords[i - 1], coords[i]);
  return s;
}

// Position at fraction f (0..1) along a polyline, plus heading in degrees.
export function along(coords, f) {
  if (coords.length === 1) return { pos: coords[0], heading: 0 };
  const total = lineLength(coords);
  let target = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i]);
    if (target <= seg || i === coords.length - 1) {
      const t = seg > 0 ? Math.min(1, target / seg) : 0;
      const a = coords[i - 1], b = coords[i];
      return {
        pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        heading: bearing(a, b),
      };
    }
    target -= seg;
  }
  return { pos: coords[coords.length - 1], heading: 0 };
}

export function bearing(a, b) {
  const p1 = a[1] * RAD, p2 = b[1] * RAD, dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

// Part of a polyline from its start up to fraction f.
export function sliceAlong(coords, f) {
  if (f <= 0) return [coords[0]];
  if (f >= 1) return coords.slice();
  const total = lineLength(coords);
  let target = f * total;
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i]);
    if (target <= seg) {
      const t = seg > 0 ? target / seg : 0;
      const a = coords[i - 1], b = coords[i];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      return out;
    }
    out.push(coords[i]);
    target -= seg;
  }
  return out;
}

// Chaikin smoothing so grid staircase paths look like roads.
export function smooth(coords, rounds = 2) {
  let pts = coords;
  for (let r = 0; r < rounds && pts.length > 2; r++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

export function fmtMinutes(min) {
  if (!isFinite(min)) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `${h}h ${r}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function fmtClock(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtKm(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
