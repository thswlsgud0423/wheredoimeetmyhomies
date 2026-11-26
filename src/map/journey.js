// Moves each friend's avatar along their legs: walk, bus, subway, train, car, ferry, flight.
import { along, sliceAlong, greatCircle, smooth } from '../geo.js';
import { setData, maplibregl } from './scene.js';
import { ICONS } from './icons.js';
import { createToys } from './toys.js';

export const MODE_ICON = ICONS;
export const MODE_NAME = {
  walk: 'Walk', bus: 'Bus', subway: 'Subway', train: 'Train', tram: 'Tram', car: 'Car', ferry: 'Ferry', flight: 'Flight',
};

// Prepare drawable legs: smoother ground paths and great-circle flights.
export function prepareLegs(legs) {
  return legs.map((l) => {
    let coords = l.coords;
    if (l.mode === 'flight') coords = greatCircle(coords[0], coords[coords.length - 1], 96);
    else if (!l.line && coords.length > 2) coords = smooth(coords, 2);
    let pre = 0, post = 0;
    if (l.mode === 'flight') {
      const domestic = l.from?.[3] === l.to?.[3];
      pre = domestic ? 60 : 105; post = domestic ? 25 : 45;
    }
    return { ...l, coords, pre, post };
  });
}

export function arrival(legs) {
  return legs.length ? legs[legs.length - 1].end : 0;
}

/**
 * Animate everyone at once. `clock` runs in trip minutes.
 * sameArrival: everyone arrives together (shows who must leave first).
 */
export function createJourney(map, people, legsPer, { sameArrival = false } = {}) {
  const prepared = legsPer.map(prepareLegs);
  const arrivals = prepared.map(arrival);
  const latest = Math.max(...arrivals);
  const offsets = arrivals.map((a) => (sameArrival ? latest - a : 0));

  setData(map, 'routes', {
    type: 'FeatureCollection',
    features: prepared.flatMap((legs, i) => legs.map((l) => ({
      type: 'Feature', properties: { color: people[i].color, kind: l.mode }, geometry: { type: 'LineString', coordinates: l.coords },
    }))),
  });

  const toys = createToys(map);
  const handles = [];
  const markers = people.map((p) => {
    const el = document.createElement('div');
    el.className = 'traveler';
    el.style.setProperty('--c', p.color);
    el.innerHTML = '<canvas class="toy"></canvas><span class="traveler-tag"></span>';
    const canvas = el.querySelector('canvas');
    canvas.width = canvas.height = toys.size;
    el.querySelector('.traveler-tag').textContent = p.name;
    handles.push(toys.add(p.color, canvas));
    return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(p.pos).addTo(map);
  });

  // what each person is doing at trip-minute `clock`
  function stateAt(i, clock) {
    const legs = prepared[i];
    const t = clock - offsets[i];
    if (t <= 0) return { pos: legs[0]?.coords[0] ?? people[i].pos, mode: 'wait', done: false, trail: [] };
    const trail = [];
    for (const l of legs) {
      if (t >= l.end) { trail.push(l.coords); continue; }
      if (t < l.start) break;
      const span = l.end - l.start;
      let f = span > 0 ? (t - l.start) / span : 1;
      let mode = l.mode;
      if (l.mode === 'flight' && span > 0) {
        const fly = span - l.pre - l.post;
        const tf = t - l.start - l.pre;
        if (tf < 0) { f = 0; mode = 'wait'; }
        else f = Math.min(1, tf / Math.max(1, fly));
        if (tf > fly) mode = 'wait';
      }
      const { pos, heading } = along(l.coords, f);
      trail.push(sliceAlong(l.coords, f));
      return { pos, heading, mode, leg: l, done: false, trail };
    }
    const last = legs[legs.length - 1];
    return { pos: last ? last.coords[last.coords.length - 1] : people[i].pos, mode: 'done', done: true, trail };
  }

  function render(clock) {
    const features = [];
    const states = people.map((p, i) => {
      const s = stateAt(i, clock);
      const m = markers[i];
      m.setLngLat(s.pos);
      const el = m.getElement();
      const kind = s.done ? 'done' : s.mode === 'wait' ? 'wait' : MODE_NAME[s.mode] ? s.mode : 'walk';
      handles[i].set({ kind, heading: s.heading, lineColor: s.leg?.line?.colour || '' });
      el.classList.toggle('done', s.done);
      // friends who made it stand in a little circle around the pin instead of on top of each other
      const a = (i / people.length) * Math.PI * 2 + 0.4;
      m.setOffset(s.done ? [Math.cos(a) * 40, Math.sin(a) * 26 + 6] : [0, 0]);
      el.classList.toggle('flying', kind === 'flight');
      for (const c of s.trail) if (c.length > 1) features.push({ type: 'Feature', properties: { color: p.color }, geometry: { type: 'LineString', coordinates: c } });
      return s;
    });
    setData(map, 'trail', { type: 'FeatureCollection', features });
    return states;
  }

  return {
    duration: latest,
    offsets,
    arrivals,
    render,
    destroy() {
      toys.destroy();
      markers.forEach((m) => m.remove());
      setData(map, 'trail', null);
      setData(map, 'routes', null);
    },
  };
}
