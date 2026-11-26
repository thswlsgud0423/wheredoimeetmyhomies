// MapLibre scene in a calm, light "Apple Maps" look, plus every overlay the app draws.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const EMPTY = { type: 'FeatureCollection', features: [] };
export const SOURCES = ['rail', 'airports', 'tree', 'iso', 'overlap', 'cands', 'routes', 'trail', 'pois'];
export const ACCENT = '#0a84ff';

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [16.37, 48.21],
    zoom: 1.6,
    pitch: 0,
    maxPitch: 70,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  const ready = new Promise((resolve) => {
    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      map.setSky({
        'sky-color': '#dfeaf7',
        'horizon-color': '#f4f6f9',
        'fog-color': '#f4f6f9',
        'sky-horizon-blend': 0.5,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.5,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.6, 9, 0],
      });
      paintBasemap(map);
      addLayers(map);
      resolve(map);
    });
  });
  return { map, ready };
}

// Soft land, light-blue water, green parks, warm highways, gray railways.
function paintBasemap(map) {
  const set = (id, prop, val) => { if (map.getLayer(id)) map.setPaintProperty(id, prop, val); };
  set('background', 'background-color', '#f2f1ed');
  set('water', 'fill-color', '#aad3ef');
  set('park', 'fill-color', '#d5ecc9');
  set('park', 'fill-opacity', 0.9);
  set('landcover_wood', 'fill-color', '#dcefd2');
  set('landuse_residential', 'fill-color', '#ecebe6');
  set('waterway', 'line-color', '#aad3ef');
  for (const id of ['highway_motorway_inner', 'highway_motorway_bridge_inner', 'tunnel_motorway_inner']) set(id, 'line-color', '#f8cf6a');
  for (const id of ['highway_motorway_casing', 'highway_motorway_bridge_casing', 'tunnel_motorway_casing']) set(id, 'line-color', '#e3ad3c');
  set('highway_motorway_subtle', 'line-color', '#f3c55b');
  set('highway_major_inner', 'line-color', '#ffffff');
  set('highway_major_subtle', 'line-color', '#ffffff');
  set('highway_major_casing', 'line-color', '#d9d6cf');
  set('highway_minor', 'line-color', '#ffffff');
  for (const id of ['railway', 'railway_transit', 'railway_service']) set(id, 'line-color', '#a4a8b0');
  if (map.getLayer('building')) map.setLayoutProperty('building', 'visibility', 'none');
  map.addLayer({
    id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
    paint: {
      'fill-extrusion-color': '#f1f0ec',
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['coalesce', ['get', 'render_height'], 8]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.8,
      'fill-extrusion-vertical-gradient': true,
    },
  }, 'airport');
}

// While routes are being explored, make the real network (highways, rail) stand out.
const savedWidths = new Map();
export function emphasizeNetwork(map, on) {
  const zw = (a, b) => ['interpolate', ['exponential', 1.4], ['zoom'], 4, a, 14, b];
  const wide = { highway_motorway_inner: zw(1.2, 6), highway_motorway_subtle: zw(1.2, 6), railway: zw(0.8, 3), railway_transit: zw(0.6, 2.5) };
  for (const [id, val] of Object.entries(wide)) {
    if (!map.getLayer(id)) continue;
    if (!savedWidths.has(id)) savedWidths.set(id, map.getPaintProperty(id, 'line-width'));
    map.setPaintProperty(id, 'line-width', on ? val : savedWidths.get(id));
  }
}

function addLayers(map) {
  for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY });
  const below = 'highway-name-path'; // keep overlays under street labels

  // transit network in neutral gray (city scale); routes are drawn on top in each friend's color
  map.addLayer({ id: 'rail-case', type: 'line', source: 'rail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 15, 7], 'line-opacity': 0.9,
  } }, below);
  map.addLayer({ id: 'rail-line', type: 'line', source: 'rail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': '#a9adb6',
    'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 15, 4],
    'line-opacity': 0.7,
  } }, below);

  // isochrones: very light tint + fine outline
  map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.06 } }, below);
  map.addLayer({ id: 'iso-edge', type: 'line', source: 'iso', paint: {
    'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.55,
  } }, below);

  // every route, growing with the clock (filtered by t0)
  map.addLayer({ id: 'tree-ground', type: 'line', source: 'tree', filter: ['all', ['in', ['get', 'kind'], ['literal', ['ground', 'ferry']]], ['<=', ['get', 't0'], -1]],
    layout: { 'line-cap': 'round' }, paint: {
      'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 14, 1.6], 'line-opacity': 0.45,
    } }, below);
  map.addLayer({ id: 'tree-rail', type: 'line', source: 'tree', filter: ['all', ['==', ['get', 'kind'], 'rail'], ['<=', ['get', 't0'], -1]],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
      'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.4, 15, 6], 'line-opacity': 0.85,
    } }, below);
  map.addLayer({ id: 'tree-flight', type: 'line', source: 'tree', filter: ['all', ['==', ['get', 'kind'], 'flight'], ['<=', ['get', 't0'], -1]],
    layout: { 'line-cap': 'round' }, paint: {
      'line-color': ['get', 'color'], 'line-width': 1.1, 'line-opacity': 0.5,
    } }, below);

  // the zone everyone can reach
  map.addLayer({ id: 'overlap-fill', type: 'fill', source: 'overlap', paint: { 'fill-color': ACCENT, 'fill-opacity': 0.16 } }, below);
  map.addLayer({ id: 'overlap-edge', type: 'line', source: 'overlap', paint: { 'line-color': ACCENT, 'line-width': 2 } }, below);

  map.addLayer({ id: 'cands-dot', type: 'circle', source: 'cands', paint: {
    'circle-radius': ['case', ['get', 'top'], 5, 2.5],
    'circle-color': ['case', ['get', 'top'], ACCENT, '#8e8e93'],
    'circle-opacity': ['get', 'alpha'],
    'circle-stroke-width': ['case', ['get', 'top'], 1.5, 0],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-opacity': ['get', 'alpha'],
  } });

  // chosen routes: Apple-style line with white casing; traveled part on top
  map.addLayer({ id: 'routes-case', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9,
  } });
  map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.35,
    'line-dasharray': ['case', ['==', ['get', 'kind'], 'walk'], ['literal', [0.5, 1.6]], ['literal', [1, 0]]],
  } });
  map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': ['get', 'color'], 'line-width': 4.5,
  } });

  map.addLayer({ id: 'airports-dot', type: 'circle', source: 'airports', paint: {
    'circle-radius': 3, 'circle-color': '#ffffff', 'circle-stroke-color': '#636366', 'circle-stroke-width': 1.2,
  } });
  map.addLayer({ id: 'airports-label', type: 'symbol', source: 'airports', minzoom: 2.5, layout: {
    'text-field': ['get', 'code'], 'text-size': 10, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'],
  }, paint: { 'text-color': '#3a3a3c', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } });

  map.addLayer({ id: 'pois-dot', type: 'circle', source: 'pois', paint: {
    'circle-radius': 7, 'circle-color': '#ff9f0a', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
  } });
  map.addLayer({ id: 'pois-label', type: 'symbol', source: 'pois', layout: {
    'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'],
  }, paint: { 'text-color': '#1c1c1e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
}

// Show route pieces reached by minute t.
export function showTreeUntil(map, t) {
  const f = (kinds) => ['all', ['in', ['get', 'kind'], ['literal', kinds]], ['<=', ['get', 't0'], t]];
  map.setFilter('tree-ground', f(['ground', 'ferry']));
  map.setFilter('tree-rail', f(['rail']));
  map.setFilter('tree-flight', f(['flight']));
}

export function treeOpacity(map, k) {
  map.setPaintProperty('tree-ground', 'line-opacity', 0.45 * k);
  map.setPaintProperty('tree-rail', 'line-opacity', 0.85 * k);
  map.setPaintProperty('tree-flight', 'line-opacity', 0.5 * k);
}

export function setData(map, id, data) {
  map.getSource(id)?.setData(data ?? EMPTY);
}

export function clearAll(map) {
  for (const id of SOURCES) setData(map, id, EMPTY);
}

export function personMarker(p) {
  const el = document.createElement('div');
  el.className = 'avatar';
  el.style.setProperty('--c', p.color);
  el.innerHTML = '<span class="avatar-dot"></span><span class="avatar-name"></span>';
  el.querySelector('.avatar-dot').textContent = p.name.slice(0, 1).toUpperCase();
  el.querySelector('.avatar-name').textContent = p.name;
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(p.pos);
}

export function placePin(pos, label) {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = '<div class="pin-head"><svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z"/></svg></div><div class="pin-stem"></div><div class="pin-label"></div>';
  el.querySelector('.pin-label').textContent = label;
  return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(pos);
}

export { maplibregl };
