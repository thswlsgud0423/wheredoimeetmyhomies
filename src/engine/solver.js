// Dijkstra over the travel graph: minutes from one person's home to every node.
import { flightMinutes, BOARD_MIN, ALIGHT_MIN } from './network.js';
import { haversine } from '../geo.js';

// Edge types stored in `via` for path reconstruction.
export const E = { START: 0, GROUND: 1, BOARD: 2, RIDE: 3, ALIGHT: 4, TO_AIRPORT: 5, FLIGHT: 6, FROM_AIRPORT: 7 };

// How a person moves, per map scale. Speeds are door-to-door averages (km/h).
export function profileFor(mode, tier, hasRail) {
  const city = tier === 'city';
  if (mode === 'walk') return { mode, land: 4.8, water: 0, detour: 1.25, rail: false, flights: false };
  if (mode === 'car') return { mode, land: city ? 24 : 80, water: city ? 0 : 22, detour: 1.3, rail: false, flights: !city };
  // public transport
  if (city) {
    return hasRail
      ? { mode, land: 4.8, water: 0, detour: 1.25, rail: true, flights: false }
      : { mode, land: 13, water: 0, detour: 1.3, rail: false, flights: false, busOnly: true };
  }
  return { mode, land: 75, water: 22, detour: 1.25, rail: false, flights: true };
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0], topK = k[0];
    const lastK = k.pop(), lastV = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    this.topKey = topK;
    return topV;
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export function solve(net, origin, profile, capMin = Infinity) {
  const { grid, N, S, A, total } = net;
  const { W, H, rowMeters } = grid;
  const land = grid.land;
  const time = new Float64Array(total).fill(Infinity);
  const prev = new Int32Array(total).fill(-1);
  const via = new Uint8Array(total);
  const landMpm = (profile.land * 1000) / 60 / profile.detour; // meters per minute
  const waterMpm = (profile.water * 1000) / 60 / profile.detour;
  const heap = new Heap();

  const start = nearestLand(grid, grid.cellOf(origin));
  // Small first step: from the exact door to the cell center.
  const c0 = grid.center(start);
  time[start] = haversine(origin, c0) / landMpm;
  via[start] = E.START;
  heap.push(time[start], start);

  const relax = (to, t, from, type) => {
    if (t < time[to]) { time[to] = t; prev[to] = from; via[to] = type; heap.push(t, to); }
  };

  while (heap.size) {
    const u = heap.pop();
    const tu = heap.topKey;
    if (tu > time[u]) continue; // stale
    if (tu > capMin) break;

    if (u < N) {
      const r = (u / W) | 0, c = u - r * W;
      const m = rowMeters[r];
      for (const [dc, dr, f] of DIRS) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
        const v = rr * W + cc;
        const isLand = !land || land[v];
        const mpm = isLand ? landMpm : waterMpm;
        if (!mpm) continue;
        relax(v, tu + (m * f) / mpm, u, E.GROUND);
      }
      if (profile.rail) {
        for (let k = net.cellStopStart[u]; k < net.cellStopStart[u + 1]; k++) {
          const s = net.cellStops[k];
          const sn = N + s;
          const walk = haversine(grid.center(u), [net.stops.lng[s], net.stops.lat[s]]) / landMpm;
          relax(sn, tu + walk + BOARD_MIN, u, E.BOARD);
        }
      }
      if (profile.flights) {
        const aps = net.cellAirport.get(u);
        if (aps) for (const a of aps) relax(N + S + a, tu, u, E.TO_AIRPORT);
      }
    } else if (u < N + S) {
      const s = u - N;
      const nx = net.stops.rideNext[s];
      if (nx >= 0) relax(N + nx, tu + net.stops.rideMin[s], u, E.RIDE);
      relax(net.stops.cell[s], tu + ALIGHT_MIN, u, E.ALIGHT);
    } else {
      const a = u - N - S;
      // Arriving here by FLIGHT means we can leave the airport; arriving from the
      // street means we can fly anywhere.
      if (via[u] === E.FLIGHT) {
        relax(net.apCell[a], tu, u, E.FROM_AIRPORT);
      } else {
        const ap = net.airports[a];
        for (let b = 0; b < A; b++) {
          if (b === a) continue;
          const fm = flightMinutes(ap, net.airports[b]);
          if (fm < Infinity) relax(N + S + b, tu + fm, u, E.FLIGHT);
        }
      }
    }
  }
  return { time, prev, via, start };
}

// Coastal homes can fall in a "sea" cell of the coarse land mask: start on the closest land.
function nearestLand(grid, cell) {
  const { land, W, H } = grid;
  if (!land || land[cell]) return cell;
  const r0 = (cell / W) | 0, c0 = cell - r0 * W;
  for (let d = 1; d <= 4; d++)
    for (let dr = -d; dr <= d; dr++)
      for (let dc = -d; dc <= d; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r >= 0 && c >= 0 && r < H && c < W && land[r * W + c]) return r * W + c;
      }
  return cell;
}

// Turn the predecessor chain into a list of legs for one person.
export function reconstruct(net, result, target, profile, tier) {
  const { prev, via, time } = result;
  const chain = [];
  for (let n = target; n >= 0; n = prev[n]) {
    chain.push(n);
    if (chain.length > 1e5) break;
  }
  chain.reverse();
  const { N, S, grid } = net;
  const legs = [];
  const push = (mode, node, extra = {}) => {
    const last = legs[legs.length - 1];
    const p = net.nodeLngLat(node);
    if (last && last.mode === mode && last.lineIdx === extra.lineIdx && mode !== 'flight') {
      last.coords.push(p); last.end = time[node];
      if (extra.stopName) last.stopNames.push(extra.stopName);
      return;
    }
    const from = last ? last.coords[last.coords.length - 1] : p;
    legs.push({ mode, coords: last ? [from, p] : [p], start: last ? last.end : time[node], end: time[node], ...extra, stopNames: extra.stopName ? [extra.stopName] : [] });
  };
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i];
    const t = via[n];
    if (t === E.START) { legs.push({ mode: 'start', coords: [net.nodeLngLat(n)], start: 0, end: time[n], stopNames: [] }); continue; }
    if (t === E.GROUND) {
      const water = grid.land && !grid.land[n];
      push(water ? 'ferry' : groundMode(profile), n);
    } else if (t === E.BOARD) {
      push(groundMode(profile), n); // walk to the platform
      const s = n - N;
      const li = net.stops.line[s];
      legs.push({ mode: railMode(net.lines[li]), lineIdx: li, line: net.lines[li], coords: [net.nodeLngLat(n)], start: time[n], end: time[n], stopNames: [stopLabel(net, s)] });
    } else if (t === E.RIDE) {
      const s = n - N;
      push(railMode(net.lines[net.stops.line[s]]), n, { lineIdx: net.stops.line[s], stopName: stopLabel(net, s) });
    } else if (t === E.ALIGHT) {
      push(groundMode(profile), n);
    } else if (t === E.TO_AIRPORT) {
      // airport node sits at its true location; the ground leg already reached its cell
      push(groundMode(profile), n);
    } else if (t === E.FLIGHT) {
      const a = net.airports[n - N - S];
      const from = net.airports[prev[n] - N - S];
      legs.push({ mode: 'flight', coords: [net.nodeLngLat(prev[n]), net.nodeLngLat(n)], start: time[prev[n]], end: time[n], from: from, to: a, stopNames: [`${from[0]} ${from[2]}`, `${a[0]} ${a[2]}`] });
    } else if (t === E.FROM_AIRPORT) {
      push(groundMode(profile), n);
    }
  }
  // Merge the tiny "start" stub into the first real leg and relabel ground legs by length.
  const out = [];
  for (const leg of legs) {
    if (leg.mode === 'start') { out.push({ ...leg, mode: groundMode(profile) }); continue; }
    const last = out[out.length - 1];
    if (last && last.mode === leg.mode && leg.mode !== 'flight' && !leg.line && !last.line) {
      last.coords.push(...leg.coords.slice(1)); last.end = leg.end;
    } else out.push(leg);
  }
  return out
    .filter((l) => l.coords.length > 1 || l.end - l.start > 0.5)
    .map((l) => labelGround(l, profile, tier));
}

function stopLabel(net, s) {
  return net.stops.nameEn[s] ? `${net.stops.name[s]} (${net.stops.nameEn[s]})` : net.stops.name[s];
}

function groundMode(profile) {
  if (profile.mode === 'walk') return 'walk';
  if (profile.mode === 'car') return 'car';
  if (profile.busOnly) return 'bus';
  return 'ground';
}

function railMode(line) {
  return line.route === 'train' ? 'train' : line.route === 'tram' ? 'tram' : 'subway';
}

// Public-transport ground legs: walk if short, otherwise bus or train by distance.
function labelGround(leg, profile, tier) {
  if (leg.mode !== 'ground') return leg;
  let m = 0;
  for (let i = 1; i < leg.coords.length; i++) m += haversine(leg.coords[i - 1], leg.coords[i]);
  leg.meters = m;
  if (tier === 'city' || m < 2500) leg.mode = 'walk';
  else if (m < 60000) leg.mode = 'bus';
  else leg.mode = 'train';
  return leg;
}
