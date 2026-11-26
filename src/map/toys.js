// Small realistic 3D vehicles for travelers: car, city bus, subway / S-Bahn / train, tram, airliner, ferry.
// (People on foot are shown as a simple map pin, not a 3D model.)
// One shared three.js renderer draws every vehicle into its own small canvas, so they work as
// ordinary map markers (also on the globe). The camera follows the map's pitch and bearing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const PX = 176; // drawing size of each canvas (CSS size is set in style.css)
const R = Math.PI / 180;
export const ON_FOOT = new Set(['walk', 'wait', 'done']);

let renderer = null, envMap = null;
function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(PX, PX, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  return renderer;
}

// ---------- materials ----------
const cache = new Map();
const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const paint = (hex) => memo('paint' + hex, () => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.35, roughness: 0.32 }));
const satin = (hex) => memo('satin' + hex, () => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.1, roughness: 0.55 }));
const metal = (hex = '#c9ccd1') => memo('metal' + hex, () => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.85, roughness: 0.28 }));
const GLASS = new THREE.MeshStandardMaterial({ color: '#1b2430', metalness: 0.7, roughness: 0.08 });
const RUBBER = new THREE.MeshStandardMaterial({ color: '#1d1d1f', metalness: 0, roughness: 0.9 });
const DARK = new THREE.MeshStandardMaterial({ color: '#3a3a3c', metalness: 0.2, roughness: 0.7 });
const lamp = (hex) => memo('lamp' + hex, () => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.6, roughness: 0.3 }));

const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const rbox = (w, h, d, r = 0.1) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

// Side silhouette (pts: [forward, up] with forward > 0 toward the front) extruded across the width.
function profile(pts, width, bevel = 0.06) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // shape x -> -z (forward)
  return g;
}
// Flat outline in plan view (pts: [right, forward]) with a thickness, lying on the ground plane.
function plan(pts, thick) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // shape y -> -z (forward), depth -> up
  g.translate(0, -thick / 2, 0);
  return g;
}

function wheel(r, w) {
  const g = new THREE.Group();
  const tire = mesh(new THREE.CylinderGeometry(r, r, w, 24), RUBBER);
  const rim = mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 20), metal('#b8bcc2'));
  tire.rotation.z = rim.rotation.z = Math.PI / 2;
  g.add(tire, rim);
  return g;
}

// soft contact shadow
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.45)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function shadow(w, d, y = 0.01) {
  const m = mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), 0, y, 0);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, d, 1);
  return m;
}

// ---------- models: real proportions in meters, forward is -Z ----------
function car(color) {
  const g = new THREE.Group();
  const L = 4.5, W = 1.8;
  g.add(shadow(W * 1.5, L * 1.15));
  // lower body: bumper, hood, beltline, trunk
  g.add(mesh(profile([[2.25, 0.32], [2.3, 0.62], [2.05, 0.82], [0.95, 0.95], [-1.5, 0.98], [-2.2, 0.92], [-2.27, 0.55], [-2.2, 0.3]], W, 0.1), paint(color), 0, 0, 0));
  // greenhouse (glass) and roof
  g.add(mesh(profile([[0.95, 0.94], [0.05, 1.38], [-1.0, 1.38], [-1.65, 0.96]], W - 0.16, 0.05), GLASS));
  g.add(mesh(profile([[0.12, 1.36], [-0.98, 1.36], [-1.05, 1.42], [0.05, 1.42]], W - 0.2, 0.04), paint(color)));
  for (const s of [-1, 1]) {
    g.add(mesh(rbox(0.42, 0.1, 0.08, 0.03), lamp('#f5f7ff'), s * 0.62, 0.72, -2.27));
    g.add(mesh(rbox(0.38, 0.1, 0.06, 0.03), lamp('#d01a1a'), s * 0.62, 0.8, 2.24));
    g.add(mesh(rbox(0.1, 0.06, 0.18, 0.02), paint(color), s * (W / 2 + 0.03), 1.0, -0.6)); // mirrors
  }
  const wheels = [];
  for (const s of [-1, 1]) for (const z of [-1.4, 1.35]) {
    const w = wheel(0.34, 0.24); w.position.set(s * (W / 2 - 0.08), 0.34, z); g.add(w); wheels.push(w);
  }
  g.userData = { length: L, anim: (t) => wheels.forEach((w) => { w.rotation.x = -t * 14; }) };
  return g;
}

function bus(color) {
  const g = new THREE.Group();
  const L = 12, W = 2.55, H = 3.0;
  g.add(shadow(W * 1.4, L * 1.08));
  g.add(mesh(rbox(W, H - 0.35, L, 0.3), satin('#f4f5f7'), 0, 0.35 + (H - 0.35) / 2, 0));
  g.add(mesh(rbox(W + 0.02, 0.7, L - 0.1, 0.2), paint(color), 0, 0.75, 0)); // lower livery
  g.add(mesh(rbox(W + 0.03, 1.05, L - 1.6, 0.1), GLASS, 0, 2.0, 0.55)); // side windows
  g.add(mesh(rbox(W - 0.2, 1.5, 0.1, 0.1), GLASS, 0, 1.85, -L / 2 - 0.01)); // windscreen
  g.add(mesh(rbox(W - 0.6, 0.25, 0.08, 0.04), lamp('#ffb340'), 0, 2.78, -L / 2 - 0.02)); // destination sign
  g.add(mesh(rbox(1.6, 0.35, 2.2, 0.1), satin('#dfe1e5'), 0, H + 0.1, 2.5)); // roof unit
  for (const s of [-1, 1]) g.add(mesh(rbox(0.3, 0.12, 0.06, 0.03), lamp('#f5f7ff'), s * 0.9, 0.7, -L / 2 - 0.02));
  const wheels = [];
  for (const s of [-1, 1]) for (const z of [-3.6, 2.6]) {
    const w = wheel(0.5, 0.3); w.position.set(s * (W / 2 - 0.12), 0.5, z); g.add(w); wheels.push(w);
  }
  g.userData = { length: L, anim: (t) => wheels.forEach((w) => { w.rotation.x = -t * 9; }) };
  return g;
}

// One rail car. Lead cars get a sloped cab front.
function railCar(len, kind, color, lead) {
  const c = new THREE.Group();
  const W = kind === 'tram' ? 2.4 : 2.8, H = kind === 'tram' ? 3.2 : 3.5, floor = kind === 'tram' ? 0.35 : 0.9;
  const body = satin(kind === 'subway' ? '#d9dce1' : '#f2f3f5');
  const half = len / 2;
  if (lead) {
    const nose = kind === 'train' ? 2.2 : 0.8;
    c.add(mesh(profile([[half, floor], [half, floor + H * 0.45], [half - nose, floor + H], [-half, floor + H], [-half, floor]], W, 0.18), body));
    c.add(mesh(profile([[half + 0.02, floor + H * 0.47], [half - nose * 0.55 + 0.02, floor + H * 0.82], [half - nose * 0.75, floor + H * 0.82], [half - 0.15, floor + H * 0.47]], W - 0.5, 0.05), GLASS));
    for (const s of [-1, 1]) c.add(mesh(rbox(0.35, 0.14, 0.08, 0.03), lamp('#f5f7ff'), s * (W / 2 - 0.45), floor + 0.45, -half - 0.03));
  } else {
    c.add(mesh(rbox(W, H, len, 0.22), body, 0, floor + H / 2, 0));
  }
  // windows, livery stripe in the line colour, doors
  c.add(mesh(rbox(W + 0.02, H * 0.3, len - (lead ? 3.2 : 1.2), 0.08), GLASS, 0, floor + H * 0.62, lead ? 0.9 : 0));
  c.add(mesh(rbox(W + 0.03, H * 0.13, len - 0.3, 0.05), paint(color), 0, floor + H * 0.36, 0));
  const doors = Math.max(2, Math.round(len / 6));
  for (let k = 0; k < doors; k++) {
    const z = -half + (len / doors) * (k + 0.5) + (lead ? 0.6 : 0);
    for (const s of [-1, 1]) c.add(mesh(rbox(0.04, H * 0.72, 1.3, 0.02), paint(color), s * (W / 2 + 0.02), floor + H * 0.42, z));
  }
  if (kind !== 'tram') for (const z of [-half + 2.2, half - 2.2]) c.add(mesh(rbox(W - 0.4, 0.7, 2.6, 0.1), DARK, 0, 0.45, z)); // bogies
  if ((kind === 'train' || kind === 'tram') && lead) { // pantograph
    const arm = mesh(rbox(0.08, 0.08, 1.8, 0.03), metal(), 0, floor + H + 0.55, -half + 4.2);
    arm.rotation.x = 0.45; c.add(arm);
    c.add(mesh(rbox(1.4, 0.06, 0.12, 0.02), metal(), 0, floor + H + 0.9, -half + 3.4));
  }
  c.add(mesh(rbox(W - 0.6, 0.25, len * 0.5, 0.08), satin('#c4c7cc'), 0, floor + H + 0.12, 0.5)); // roof equipment
  return c;
}

function train(color, kind) {
  const g = new THREE.Group();
  const cars = [[kind === 'tram' ? 14 : kind === 'subway' ? 16 : 19, true]]; // one car is enough to read as a train
  const gap = kind === 'tram' ? 0.15 : 0.6;
  const total = cars.reduce((s, [l]) => s + l, 0) + gap * (cars.length - 1);
  let z = -total / 2;
  for (const [len, lead] of cars) {
    const c = railCar(len, kind, color, lead);
    c.position.z = z + len / 2;
    g.add(c);
    z += len + gap;
  }
  g.add(shadow(4.2, total * 1.06));
  g.userData = { length: total, anim: () => {} };
  return g;
}

function plane(color) {
  const g = new THREE.Group();
  const air = new THREE.Group();
  g.add(shadow(22, 20), air);
  // fuselage: lathe profile (radius, along) from tail (-) to nose (+)
  const prof = [[0, -19], [0.5, -18.4], [1.3, -15], [1.95, -9], [2.0, 8], [1.85, 12.5], [1.4, 15.5], [0.75, 17.3], [0, 18.2]].map(([r, y]) => new THREE.Vector2(r, y));
  const fus = new THREE.LatheGeometry(prof, 28);
  fus.rotateX(-Math.PI / 2); // +y (nose) -> -z
  air.add(mesh(fus, satin('#f7f7f8')));
  air.add(mesh(profile([[16.6, 0.25], [15.8, 1.05], [15.0, 1.05], [16.0, 0.2]], 2.2, 0.04), GLASS, 0, 0.55, 0)); // cockpit
  air.add(mesh(rbox(0.08, 0.32, 24, 0.03), GLASS, 2.0, 0.55, -1.5)); // cabin windows (as a band)
  air.add(mesh(rbox(0.08, 0.32, 24, 0.03), GLASS, -2.0, 0.55, -1.5));
  air.add(mesh(rbox(0.06, 0.35, 30, 0.03), paint(color), 2.02, -0.05, -1));
  air.add(mesh(rbox(0.06, 0.35, 30, 0.03), paint(color), -2.02, -0.05, -1));
  // swept wings and engines
  for (const s of [-1, 1]) {
    const wing = plan([[0, 3.5], [s * 17, -4.5], [s * 17.4, -6.3], [s * 17, -6.6], [0, -3.8]], 0.45);
    air.add(mesh(wing, satin('#e9eaed'), 0, -0.9, 0));
    const tip = mesh(rbox(0.15, 1.6, 1.2, 0.05), paint(color), s * 17.2, -0.1, 5.9);
    tip.rotation.x = 0.3; air.add(tip); // winglet
    const eng = mesh(new THREE.CylinderGeometry(1.05, 0.85, 4.2, 22), satin('#dcdde0'), s * 6.2, -1.9, -0.6);
    eng.rotation.x = Math.PI / 2; air.add(eng);
    air.add(mesh(new THREE.CircleGeometry(0.85, 22), DARK, s * 6.2, -1.9, -2.72).rotateY(Math.PI));
    air.add(mesh(rbox(0.3, 1.0, 2.4, 0.1), satin('#e9eaed'), s * 6.2, -1.2, -0.2)); // pylon
    const stab = plan([[0, -13.5], [s * 6.5, -17.8], [s * 6.6, -19], [0, -18.5]], 0.25);
    air.add(mesh(stab, satin('#e9eaed'), 0, 0.6, 0));
  }
  // vertical tail in the friend's colour
  const fin = profile([[-12.8, 1.4], [-17.6, 8.6], [-19.6, 8.6], [-18.8, 1.4]], 0.35, 0.05);
  air.add(mesh(fin, paint(color)));
  g.userData = {
    length: 34,
    anim: (t, kind) => {
      const flying = kind === 'flight';
      air.position.y = flying ? 9 + Math.sin(t * 1.4) * 0.4 : 2.6;
      air.rotation.z = flying ? Math.sin(t * 0.9) * 0.06 : 0;
      g.children[0].material.opacity = flying ? 0.55 : 1;
    },
  };
  return g;
}

function ferry(color) {
  const g = new THREE.Group();
  const boat = new THREE.Group();
  g.add(shadow(12, 40), boat);
  const hull = plan([[-5, 15], [5, 15], [5, -10], [3.5, -15.5], [0, -18], [-3.5, -15.5], [-5, -10]], 3.2);
  boat.add(mesh(hull, satin('#1f3550'), 0, 1.2, 0));
  boat.add(mesh(plan([[-5.05, 15], [5.05, 15], [5.05, -10], [3.55, -15.5], [0, -18.05], [-3.55, -15.5], [-5.05, -10]], 0.5), satin('#f4f5f7'), 0, 3.0, 0));
  boat.add(mesh(rbox(9, 3.2, 20, 0.4), satin('#f7f7f8'), 0, 4.8, 2));
  boat.add(mesh(rbox(9.05, 1.0, 19, 0.2), GLASS, 0, 5.2, 2));
  boat.add(mesh(rbox(7, 2.6, 9, 0.4), satin('#f7f7f8'), 0, 7.6, -1));
  boat.add(mesh(rbox(7.05, 0.9, 8.6, 0.2), GLASS, 0, 7.9, -1));
  boat.add(mesh(new THREE.CylinderGeometry(1.0, 1.2, 3.2, 20), paint(color), 0, 9.6, 5));
  boat.add(mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.5, 20), DARK, 0, 11.1, 5));
  g.userData = {
    length: 34,
    anim: (t) => {
      boat.position.y = Math.sin(t * 1.6) * 0.15;
      boat.rotation.z = Math.sin(t * 1.2) * 0.03;
      boat.rotation.x = Math.sin(t * 1.6 + 1) * 0.012;
    },
  };
  return g;
}

// Each model is scaled so its length fills a similar part of the canvas.
const FIT = { car: 3.6, bus: 4.4, subway: 2.8, train: 3.0, tram: 2.6, flight: 5.0, ferry: 4.6 };
function build(kind, color, lineColor) {
  const make = { car: () => car(color), bus: () => bus(color), flight: () => plane(color), ferry: () => ferry(color) }[kind]
    || (() => train(lineColor || color, kind));
  const g = make();
  g.scale.setScalar((FIT[kind] || 4.5) / g.userData.length);
  return g;
}

// ---------- the scene that draws all vehicles ----------
export function createToys(map) {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 8, 3);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.35));
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
  const stage = new THREE.Group();
  scene.add(stage);

  const toys = [];
  let raf = 0, alive = true;
  const t0 = performance.now();

  function add(color, canvas) {
    const toy = { color, canvas, ctx: canvas.getContext('2d'), kind: '', key: '', model: null, models: new Map(), heading: 0, shown: null, fade: 0 };
    toys.push(toy);
    return {
      set({ kind, heading, lineColor }) {
        if (heading != null && Number.isFinite(heading)) toy.heading = heading;
        toy.kind = kind;
        if (ON_FOOT.has(kind)) {
          if (toy.model) { toy.model = null; toy.key = ''; toy.ctx.clearRect(0, 0, PX, PX); }
          return;
        }
        const key = kind + (lineColor || '');
        if (key !== toy.key) {
          toy.key = key;
          if (!toy.models.has(key)) toy.models.set(key, build(kind, color, lineColor));
          toy.model = toy.models.get(key);
          toy.fade = performance.now();
        }
      },
    };
  }

  function frame() {
    raf = 0;
    if (!alive) return;
    const r = getRenderer();
    scene.environment = envMap;
    const t = (performance.now() - t0) / 1000;
    const el = Math.max(28, Math.min(64, 90 - map.getPitch())) * R;
    const dist = 13;
    cam.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist);
    cam.lookAt(0, 0.35, 0);
    const bearing = map.getBearing();
    for (const toy of toys) {
      if (!toy.model) continue;
      stage.clear();
      stage.add(toy.model);
      // turn smoothly toward the direction of travel (on screen)
      const want = -(toy.heading - bearing) * R;
      if (toy.shown == null) toy.shown = want;
      const d = Math.atan2(Math.sin(want - toy.shown), Math.cos(want - toy.shown));
      toy.shown += d * 0.15;
      toy.model.rotation.y = toy.shown;
      toy.model.userData.anim?.(t, toy.kind);
      r.render(scene, cam);
      toy.ctx.clearRect(0, 0, PX, PX);
      toy.ctx.globalAlpha = Math.min(1, (performance.now() - toy.fade) / 250); // soft switch between vehicles
      toy.ctx.drawImage(r.domElement, 0, 0, PX, PX);
      toy.ctx.globalAlpha = 1;
    }
    stage.clear();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    add,
    size: PX,
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      toys.length = 0;
    },
  };
}
