// MapLibre scene: dark globe, 3D buildings and every overlay the app draws.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const EMPTY = { type: 'FeatureCollection', features: [] };
export const SOURCES = ['rail', 'iso', 'overlap', 'cands', 'routes', 'trail', 'beam', 'pois'];

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: 'https://tiles.openfreemap.org/styles/dark',
    center: [127.0, 37.55],
    zoom: 1.6,
    pitch: 0,
    maxPitch: 75,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  const ready = new Promise((resolve) => {
    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      map.setSky({
        'sky-color': '#060a1a',
        'horizon-color': '#1b2a5a',
        'fog-color': '#0a1028',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.7,
        'fog-ground-blend': 0.4,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 10, 0],
      });
      tintBasemap(map);
      addLayers(map);
      resolve(map);
    });
  });
  return { map, ready };
}

function tintBasemap(map) {
  const set = (id, prop, val) => map.getLayer(id) && map.setPaintProperty(id, prop, val);
  set('background', 'background-color', '#0b0f1e');
  set('water', 'fill-color', '#070b18');
  // swap the flat buildings for extruded ones
  if (map.getLayer('building')) map.setLayoutProperty('building', 'visibility', 'none');
  map.addLayer({
    id: 'building-3d',
    type: 'fill-extrusion',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: 13,
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#1a2140', 60, '#2a3566', 200, '#3d4c8f'],
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['coalesce', ['get', 'render_height'], 8]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.85,
    },
  }, 'place_other');
}

function addLayers(map) {
  for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY });
  const before = 'place_other';

  map.addLayer({ id: 'rail-line', type: 'line', source: 'rail', paint: {
    'line-color': ['coalesce', ['get', 'colour'], '#7f8cff'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 3],
    'line-opacity': 0.35,
  } }, before);

  // isochrones: soft fill + wide blurred glow + crisp edge
  map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', paint: {
    'fill-color': ['get', 'color'], 'fill-opacity': 0.12,
  } }, before);
  map.addLayer({ id: 'iso-glow', type: 'line', source: 'iso', paint: {
    'line-color': ['get', 'color'], 'line-width': 9, 'line-blur': 7, 'line-opacity': 0.55,
  } }, before);
  map.addLayer({ id: 'iso-edge', type: 'line', source: 'iso', paint: {
    'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.95,
  } }, before);

  // the zone everyone can reach
  map.addLayer({ id: 'overlap-fill', type: 'fill-extrusion', source: 'overlap', paint: {
    'fill-extrusion-color': '#ffe27a',
    'fill-extrusion-height': ['get', 'h'],
    'fill-extrusion-opacity': 0.45,
  } });
  map.addLayer({ id: 'overlap-edge', type: 'line', source: 'overlap', paint: {
    'line-color': '#fff3b0', 'line-width': 2.5, 'line-blur': 1,
  } });

  map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.35,
    'line-dasharray': [1, 2],
  } });
  map.addLayer({ id: 'trail-glow', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': ['get', 'color'], 'line-width': 10, 'line-blur': 8, 'line-opacity': 0.6,
  } });
  map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': ['get', 'color'], 'line-width': 3.5,
  } });

  map.addLayer({ id: 'cands-dot', type: 'circle', source: 'cands', paint: {
    'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 7, 1, 2.5],
    'circle-color': ['interpolate', ['linear'], ['get', 'score'], 0, '#fff3a0', 0.25, '#ffb347', 0.6, '#ff5e7e', 1, '#5b3a8c'],
    'circle-opacity': ['get', 'alpha'],
    'circle-stroke-width': 0.5,
    'circle-stroke-color': '#000',
    'circle-stroke-opacity': ['get', 'alpha'],
  } });

  map.addLayer({ id: 'beam', type: 'fill-extrusion', source: 'beam', paint: {
    'fill-extrusion-color': ['get', 'color'],
    'fill-extrusion-height': ['get', 'h'],
    'fill-extrusion-base': ['get', 'b'],
    'fill-extrusion-opacity': 0.55,
  } });

  map.addLayer({ id: 'pois-dot', type: 'circle', source: 'pois', paint: {
    'circle-radius': 6, 'circle-color': '#7df9ff', 'circle-stroke-width': 2, 'circle-stroke-color': '#0b0f1e',
  } });
  map.addLayer({ id: 'pois-label', type: 'symbol', source: 'pois', layout: {
    'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top',
    'text-font': ['Noto Sans Regular'],
  }, paint: { 'text-color': '#d8fbff', 'text-halo-color': '#0b0f1e', 'text-halo-width': 1.5 } });
}

export function setData(map, id, data) {
  map.getSource(id)?.setData(data ?? EMPTY);
}

export function clearAll(map) {
  for (const id of SOURCES) setData(map, id, EMPTY);
}

// A light pillar over the meeting place, stacked rings fading upward.
export function beamFeatures(center, radiusM, heightM, color = '#ffe27a') {
  const features = [];
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const r = radiusM * (1 - i * 0.12);
    features.push({
      type: 'Feature',
      properties: { h: (heightM * (i + 1)) / rings, b: (heightM * i) / rings, color },
      geometry: { type: 'Polygon', coordinates: [circle(center, r)] },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function circle([lng, lat], r, n = 32) {
  const out = [];
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
  }
  return out;
}

export function personMarker(p, label) {
  const el = document.createElement('div');
  el.className = 'avatar';
  el.style.setProperty('--c', p.color);
  el.innerHTML = `<span class="avatar-emoji"><b>${label}</b></span><span class="avatar-name"></span>`;
  el.querySelector('.avatar-name').textContent = p.name;
  return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(p.pos);
}

export { maplibregl };
