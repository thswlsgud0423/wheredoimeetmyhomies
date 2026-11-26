// Cute little 3D travelers: a walking person, car, bus, subway/train/tram, plane and ferry.
// One shared three.js renderer draws every traveler into its own small canvas, so they work
// as ordinary map markers (also on the globe). The camera follows the map's pitch and bearing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const PX = 160; // drawing size of each traveler canvas (CSS size is set in style.css)
const R = Math.PI / 180;

let renderer = null;
function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(PX, PX, false);
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

const steps = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
steps.minFilter = steps.magFilter = THREE.NearestFilter;
steps.needsUpdate = true;
const mats = new Map();
const toon = (hex) => {
  const key = String(hex);
  if (!mats.has(key)) mats.set(key, new THREE.MeshToonMaterial({ color: new THREE.Color(hex), gradientMap: steps }));
  return mats.get(key);
};
const flat = (hex, opacity = 1) => new THREE.MeshBasicMaterial({ color: hex, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });

const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const box = (w, h, d, r = 0.12) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
const ball = (r) => new THREE.SphereGeometry(r, 20, 14);
const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 18);
const pill = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 16);

const SKIN = '#ffd9bd', HAIR = '#4b3527', GLASS = '#bfe4ff', DARK = '#2b2b30', WHITE = '#fbfbfd', BLUSH = '#ff9aa8';
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

// a pair of shiny eyes facing -Z (forward)
function face(g, { y, z, gap = 0.16, r = 0.065, cheeks = true }) {
  for (const s of [-1, 1]) {
    g.add(mesh(ball(r), flat(DARK), s * gap, y, z));
    g.add(mesh(ball(r * 0.35), flat('#ffffff'), s * gap - 0.02, y + r * 0.35, z - r * 0.8));
    if (cheeks) {
      const c = mesh(ball(r * 1.1), flat(BLUSH, 0.75), s * (gap + 0.13), y - r * 1.4, z + 0.03);
      c.scale.z = 0.4; g.add(c);
    }
  }
}

function shadow(w, d) {
  const m = mesh(new THREE.CircleGeometry(0.5, 28), flat('#000000', 0.16), 0, 0.01, 0);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, d, 1);
  return m;
}

// ---------- models (forward is -Z, ground is y = 0) ----------
function person(color) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(shadow(1.1, 1.0), body);
  body.add(mesh(pill(0.34, 0.32), toon(color), 0, 0.86, 0));
  const head = new THREE.Group();
  head.position.y = 1.58;
  head.add(mesh(ball(0.46), toon(SKIN)));
  const hair = mesh(new THREE.SphereGeometry(0.48, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), toon(HAIR));
  hair.rotation.x = 0.35; hair.position.set(0, 0.02, 0.04);
  head.add(hair);
  face(head, { y: -0.04, z: -0.42, gap: 0.15, r: 0.06 });
  body.add(head);
  body.add(mesh(box(0.46, 0.5, 0.26, 0.1), toon(shade(color, 0.75)), 0, 0.92, 0.36)); // backpack
  const limb = (x, y, len, mat) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(mesh(pill(0.11, len), mat, 0, -len / 2 - 0.06, 0));
    body.add(pivot);
    return pivot;
  };
  const legL = limb(-0.15, 0.55, 0.26, toon(DARK)), legR = limb(0.15, 0.55, 0.26, toon(DARK));
  const armL = limb(-0.42, 1.08, 0.3, toon(color)), armR = limb(0.42, 1.08, 0.3, toon(color));
  g.userData.anim = (t, kind) => {
    if (kind === 'done') { // happy jump + waving
      const j = Math.abs(Math.sin(t * 6));
      body.position.y = j * 0.35;
      armL.rotation.z = -2.5 + Math.sin(t * 12) * 0.3; armR.rotation.z = 2.5 - Math.sin(t * 12 + 1) * 0.3;
      armL.rotation.x = armR.rotation.x = 0;
      legL.rotation.x = legR.rotation.x = j * 0.3;
      head.rotation.y = 0;
      return;
    }
    if (kind === 'wait') { // idle, looking around
      body.position.y = Math.sin(t * 2.5) * 0.02;
      head.rotation.y = Math.sin(t * 1.3) * 0.6;
      armL.rotation.set(0, 0, -0.15); armR.rotation.set(0, 0, 0.15);
      legL.rotation.x = legR.rotation.x = 0;
      return;
    }
    const s = Math.sin(t * 11);
    body.position.y = Math.abs(Math.cos(t * 11)) * 0.08;
    legL.rotation.x = s * 0.7; legR.rotation.x = -s * 0.7;
    armL.rotation.set(-s * 0.7, 0, -0.12); armR.rotation.set(s * 0.7, 0, 0.12);
    head.rotation.y = 0;
  };
  g.scale.setScalar(1.5);
  return g;
}

function wheels(g, xs, zs, r = 0.26) {
  const list = [];
  for (const x of xs) for (const z of zs) {
    const w = mesh(cyl(r, 0.2), toon(DARK), x, r, z);
    w.rotation.z = Math.PI / 2;
    const hub = mesh(cyl(r * 0.45, 0.22), toon('#d9d9de'), 0, 0, 0);
    w.add(hub);
    g.add(w); list.push(w);
  }
  return list;
}

function car(color) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(shadow(1.7, 2.6), body);
  body.add(mesh(box(1.3, 0.55, 2.3, 0.25), toon(color), 0, 0.55, 0));
  body.add(mesh(box(1.08, 0.52, 1.2, 0.22), toon(GLASS), 0, 1.02, 0.12));
  body.add(mesh(box(1.12, 0.12, 1.18, 0.06), toon(color), 0, 1.3, 0.12));
  for (const s of [-1, 1]) { // headlight eyes
    body.add(mesh(ball(0.15), flat('#ffffff'), s * 0.36, 0.66, -1.12));
    body.add(mesh(ball(0.08), flat(DARK), s * 0.36, 0.68, -1.24));
    body.add(mesh(ball(0.09), flat(BLUSH, 0.8), s * 0.55, 0.5, -1.13));
  }
  body.add(mesh(box(0.5, 0.06, 0.06, 0.03), flat(DARK), 0, 0.42, -1.16)); // smile-ish bumper line
  const ws = wheels(g, [-0.62, 0.62], [-0.72, 0.72]);
  g.userData.anim = (t, kind) => {
    const go = kind !== 'done';
    body.position.y = go ? Math.abs(Math.sin(t * 9)) * 0.05 : Math.abs(Math.sin(t * 5)) * 0.18;
    body.rotation.z = go ? Math.sin(t * 4.5) * 0.03 : 0;
    if (go) ws.forEach((w) => { w.rotation.x = -t * 12; });
  };
  return g;
}

function bus(color) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(shadow(1.7, 3.6), body);
  body.add(mesh(box(1.35, 1.25, 3.2, 0.28), toon(WHITE), 0, 0.98, 0));
  body.add(mesh(box(1.38, 0.5, 3.22, 0.2), toon(color), 0, 0.6, 0));
  body.add(mesh(box(1.4, 0.42, 2.7, 0.14), toon(GLASS), 0, 1.25, 0.15));
  body.add(mesh(box(1.1, 0.5, 0.1, 0.05), toon(GLASS), 0, 1.2, -1.58));
  for (const s of [-1, 1]) {
    body.add(mesh(ball(0.1), flat(DARK), s * 0.26, 1.22, -1.66));
    body.add(mesh(ball(0.1), flat(BLUSH, 0.8), s * 0.48, 1.02, -1.62));
  }
  body.add(mesh(box(0.9, 0.18, 0.08, 0.04), toon(color), 0, 1.7, -1.55)); // route sign
  const ws = wheels(g, [-0.62, 0.62], [-1.05, 1.05], 0.28);
  g.userData.anim = (t) => {
    body.position.y = Math.abs(Math.sin(t * 7)) * 0.05;
    body.rotation.z = Math.sin(t * 3.5) * 0.025;
    ws.forEach((w) => { w.rotation.x = -t * 10; });
  };
  return g;
}

function train(color, kind) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(shadow(1.4, kind === 'tram' ? 3.0 : 4.4), body);
  const car = (z, len, lead) => {
    const c = new THREE.Group();
    c.position.z = z;
    c.add(mesh(box(1.2, 1.15, len, 0.3), toon(WHITE), 0, 0.82, 0));
    c.add(mesh(box(1.23, 0.32, len - 0.06, 0.12), toon(color), 0, 0.5, 0));
    c.add(mesh(box(1.24, 0.36, len - 0.5, 0.12), toon(GLASS), 0, 1.0, 0));
    c.add(mesh(box(1.22, 0.1, len - 0.1, 0.05), toon(color), 0, 1.36, 0));
    for (const zz of [-len / 2 + 0.45, len / 2 - 0.45]) c.add(mesh(box(0.9, 0.18, 0.4, 0.06), toon(DARK), 0, 0.17, zz));
    if (lead) {
      const nose = mesh(new THREE.SphereGeometry(0.6, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), toon(color), 0, 0.82, -len / 2 + 0.05);
      nose.rotation.x = -Math.PI / 2; nose.scale.set(1, 0.75, 0.95);
      c.add(nose);
      c.add(mesh(box(0.8, 0.34, 0.1, 0.05), toon(GLASS), 0, 1.05, -len / 2 - 0.2));
      face(c, { y: 0.78, z: -len / 2 - 0.42, gap: 0.2, r: 0.08 });
      if (kind !== 'subway') { // pantograph
        const p = mesh(box(0.06, 0.35, 0.5, 0.02), toon(DARK), 0, 1.58, -len / 2 + 0.9);
        p.rotation.x = 0.5; c.add(p);
      }
    }
    body.add(c);
    return c;
  };
  if (kind === 'tram') car(0, 2.7, true);
  else { car(-0.95, 2.1, true); car(1.25, 1.95, false); }
  g.userData.anim = (t) => {
    body.position.y = Math.abs(Math.sin(t * 8)) * 0.03;
    body.rotation.z = Math.sin(t * 3) * 0.02;
  };
  return g;
}

function plane(color) {
  const g = new THREE.Group();
  const air = new THREE.Group();
  air.position.y = 1.5;
  g.add(shadow(2.2, 1.6), air);
  air.add(mesh(pill(0.42, 1.7), toon(WHITE)).rotateX(Math.PI / 2));
  air.add(mesh(box(3.1, 0.12, 0.75, 0.06), toon(color), 0, -0.08, 0.05));
  air.add(mesh(box(1.2, 0.08, 0.4, 0.04), toon(color), 0, 0.12, 1.2));
  air.add(mesh(box(0.1, 0.65, 0.5, 0.05), toon(color), 0, 0.46, 1.15));
  for (const s of [-1, 1]) {
    const e = mesh(cyl(0.15, 0.5), toon('#c7c7cc'), s * 0.8, -0.28, -0.05);
    e.rotation.x = Math.PI / 2; air.add(e);
  }
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) air.add(mesh(ball(0.055), flat('#5ab0f0'), s * 0.4, 0.12, -0.5 + k * 0.32));
  face(air, { y: 0.1, z: -1.22, gap: 0.15, r: 0.07 });
  g.userData.anim = (t, kind) => {
    const flying = kind === 'flight';
    air.position.y = flying ? 1.5 + Math.sin(t * 2.4) * 0.1 : 0.45;
    air.rotation.z = flying ? Math.sin(t * 1.6) * 0.12 : 0;
    g.children[0].scale.setScalar(flying ? 0.75 : 1);
  };
  return g;
}

function ferry(color) {
  const g = new THREE.Group();
  const boat = new THREE.Group();
  g.add(shadow(1.8, 3.2), boat);
  boat.add(mesh(box(1.4, 0.6, 3.0, 0.3), toon(color), 0, 0.3, 0));
  boat.add(mesh(box(1.42, 0.14, 3.02, 0.07), toon(WHITE), 0, 0.62, 0));
  boat.add(mesh(box(1.0, 0.6, 1.5, 0.15), toon(WHITE), 0, 1.0, 0.25));
  boat.add(mesh(box(1.02, 0.2, 1.3, 0.08), toon(GLASS), 0, 1.06, 0.25));
  boat.add(mesh(cyl(0.18, 0.5), toon(color), 0, 1.5, 0.6));
  face(boat, { y: 0.38, z: -1.5, gap: 0.24, r: 0.08 });
  g.userData.anim = (t) => {
    boat.position.y = Math.sin(t * 2.2) * 0.06;
    boat.rotation.z = Math.sin(t * 1.7) * 0.07;
    boat.rotation.x = Math.sin(t * 2.2 + 1) * 0.03;
  };
  return g;
}

function build(kind, color, lineColor) {
  const sized = (g, s) => { g.scale.setScalar(s); return g; };
  switch (kind) {
    case 'car': return sized(car(color), 1.3);
    case 'bus': return sized(bus(color), 1.05);
    case 'subway': case 'train': return sized(train(lineColor || color, kind), 0.88);
    case 'tram': return sized(train(lineColor || color, kind), 1.1);
    case 'flight': return sized(plane(color), 1.15);
    case 'ferry': return sized(ferry(color), 1.15);
    default: return person(color);
  }
}

// ---------- the scene that draws all travelers ----------
export function createToys(map) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d2e0, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 7, 2);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const stage = new THREE.Group();
  scene.add(stage);

  const toys = [];
  let raf = 0, alive = true;
  const t0 = performance.now();

  function add(color, canvas) {
    const toy = { color, canvas, ctx: canvas.getContext('2d'), kind: '', key: '', model: null, models: new Map(), heading: 0, shown: 0, pop: 0 };
    toys.push(toy);
    return {
      set({ kind, heading, lineColor }) {
        const model = kind === 'wait' || kind === 'done' ? 'person' : kind;
        const key = model + (lineColor || '');
        if (key !== toy.key) {
          toy.key = key;
          if (!toy.models.has(key)) toy.models.set(key, build(model, color, lineColor));
          toy.model = toy.models.get(key);
          toy.pop = performance.now();
        }
        toy.kind = kind;
        if (heading != null && Number.isFinite(heading)) toy.heading = heading;
      },
    };
  }

  function frame() {
    raf = 0;
    if (!alive) return;
    const r = getRenderer();
    const t = (performance.now() - t0) / 1000;
    const el = Math.max(24, Math.min(62, 90 - map.getPitch())) * R;
    const dist = 8.6;
    cam.position.set(0, Math.sin(el) * dist + 0.6, Math.cos(el) * dist);
    cam.lookAt(0, 1.0, 0);
    const bearing = map.getBearing();
    for (const toy of toys) {
      if (!toy.model) continue;
      stage.clear();
      stage.add(toy.model);
      // turn smoothly toward the direction of travel (on screen)
      const want = -(toy.heading - bearing) * R;
      let d = want - toy.shown;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      toy.shown += d * 0.2;
      // standing people turn to face you; everything else faces where it is going
      toy.model.rotation.y = toy.kind === 'done' || toy.kind === 'wait' ? Math.PI + Math.sin(t * 0.8) * 0.3 : toy.shown;
      const p = Math.min(1, (performance.now() - toy.pop) / 380); // little pop when switching vehicle
      const s = p < 1 ? 0.55 + 0.45 * (1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2)) : 1;
      stage.scale.setScalar(s);
      toy.model.userData.anim?.(t, toy.kind);
      r.render(scene, cam);
      toy.ctx.clearRect(0, 0, PX, PX);
      toy.ctx.drawImage(r.domElement, 0, 0, PX, PX);
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
