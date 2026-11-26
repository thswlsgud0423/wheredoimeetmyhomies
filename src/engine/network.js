// The travel graph = grid cells + rail stops + airports.
// Node ids: [0, N) cells, [N, N+S) rail stops (one per line per stop), then airports.
import { haversine } from '../geo.js';
import { RAIL_SPEED_KMH } from './transit.js';

export const BOARD_MIN = 5.5;   // walk down to the platform + average wait
export const ALIGHT_MIN = 1.5;  // platform back to the street
const DWELL_MIN = 0.4;

export function buildNetwork(grid, { lines = [], airports = [] } = {}) {
  const N = grid.N;

  // --- rail ---
  const stopLng = [], stopLat = [], stopName = [], stopNameEn = [], stopLine = [], stopCell = [];
  const rideNext = []; // stop -> next stop on the same line (-1 at the end)
  const rideMin = [];  // minutes to ride to the next stop
  const lineInfo = [];
  for (const line of lines) {
    const inside = line.stops.filter((s) => grid.contains(s));
    if (inside.length < 2) continue;
    const li = lineInfo.length;
    lineInfo.push({ name: line.name, ref: line.ref, route: line.route, colour: line.colour });
    const speed = (RAIL_SPEED_KMH[line.route] ?? 32) * 1000 / 60; // m per minute
    // Keep consecutive in-grid runs only.
    let prevId = -1, prevStop = null;
    for (const s of line.stops) {
      if (!grid.contains(s)) { prevId = -1; prevStop = null; continue; }
      const id = stopLng.length;
      stopLng.push(s[0]); stopLat.push(s[1]); stopName.push(s[2]); stopNameEn.push(s[3] || '');
      stopLine.push(li); stopCell.push(grid.cellOf(s));
      rideNext.push(-1); rideMin.push(0);
      if (prevId >= 0) {
        rideNext[prevId] = id;
        rideMin[prevId] = (haversine(prevStop, s) * 1.1) / speed + DWELL_MIN;
      }
      prevId = id; prevStop = s;
    }
  }
  const S = stopLng.length;

  // cell -> stops (CSR) for boarding
  const cellStopStart = new Int32Array(N + 1);
  for (const c of stopCell) cellStopStart[c + 1]++;
  for (let i = 0; i < N; i++) cellStopStart[i + 1] += cellStopStart[i];
  const cellStops = new Int32Array(S);
  const fill = cellStopStart.slice(0, N);
  stopCell.forEach((c, s) => { cellStops[fill[c]++] = s; });

  // --- airports inside the grid ---
  const ap = airports.filter((a) => grid.contains([a[4], a[5]]));
  const A = ap.length;
  const apCell = ap.map((a) => grid.cellOf([a[4], a[5]]));
  // Coastal airports (Haneda, Incheon...) can fall in a "sea" cell of the coarse mask.
  if (grid.land) for (const c of apCell) grid.land[c] = 1;
  const cellAirport = new Map();
  apCell.forEach((c, k) => {
    if (!cellAirport.has(c)) cellAirport.set(c, []);
    cellAirport.get(c).push(k);
  });

  return {
    grid, N, S, A,
    stops: { lng: stopLng, lat: stopLat, name: stopName, nameEn: stopNameEn, line: stopLine, cell: stopCell, rideNext, rideMin },
    lines: lineInfo, cellStopStart, cellStops,
    airports: ap, apCell, cellAirport,
    total: N + S + A,
    nodeLngLat(id) {
      if (id < N) return grid.center(id);
      if (id < N + S) return [stopLng[id - N], stopLat[id - N]];
      const a = ap[id - N - S];
      return [a[4], a[5]];
    },
  };
}

// Door-to-door minutes for a flight between two airports, including airport time.
export function flightMinutes(a, b) {
  const km = haversine([a[4], a[5]], [b[4], b[5]]) / 1000;
  if (km < 250 || km > 15500) return Infinity;
  const domestic = a[3] === b[3];
  const before = domestic ? 60 : 105; // arrive early, security, boarding
  const after = domestic ? 25 : 45;   // deplane, passport control, bags
  const air = 30 + ((km * 1.05) / 840) * 60; // taxi/climb + cruise
  return before + air + after;
}
