// Interactive 3D Model S built in code (no third-party model, so no asset license to worry about).
// The body is a loft of cross-sections along the car, sized to Tesla's published Model S dimensions
// (4970 mm long, 1964 mm wide without mirrors, 1431 mm tall, 2960 mm wheelbase). Doors, frunk,
// trunk and the charge port flap are cut out of that surface so they can open when the car says so.
// three.js loads only when a 3D slot is on screen; frames are drawn on demand, not in a loop.
import { render } from './core.js';
import { carTop, esc, num, psi } from './ui.js';

export const PAINTS = {
  red: { name: 'Ultra Red', color: 0x8f0d16, metalness: 0.35, roughness: 0.32 },
  white: { name: 'Pearl White', color: 0xe9ebee, metalness: 0.1, roughness: 0.28 },
  black: { name: 'Solid Black', color: 0x0b0c0e, metalness: 0.2, roughness: 0.3 },
  stealth: { name: 'Stealth Grey', color: 0x3a3d42, metalness: 0.45, roughness: 0.3 },
  silver: { name: 'Lunar Silver', color: 0x9da3a8, metalness: 0.7, roughness: 0.3 },
  blue: { name: 'Deep Blue', color: 0x14275a, metalness: 0.6, roughness: 0.3 },
};

let THREE = null;
let viewer = null;
let loading = null;
let failed = !hasWebGL();

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

// What a view puts where the car goes: an empty slot the live canvas moves into, or the flat
// top view when this browser can't draw WebGL.
export function car3dSlot(signals, leaks = [], cls = '') {
  if (failed) return `<div class="car3d-fallback">${carTop(signals, { leaks })}</div>`;
  return `<div class="car3d ${cls}" data-car3d></div>`;
}
export const car3dInfo = () => (failed ? 'Not available in this browser' : viewer ? viewer.info : 'Not loaded yet');

// Called after every render: moves the one live canvas into the new slot and updates the car.
export function mountCar3d(root, data) {
  const slot = root.querySelector('[data-car3d]');
  if (!slot || failed) return;
  if (!viewer) {
    loading ??= init().then(() => render(), (err) => { console.warn('[car3d]', err); failed = true; render(); });
    return;
  }
  if (viewer.el.parentNode !== slot) slot.appendChild(viewer.el);
  viewer.update(data);
}

async function init() {
  THREE = await import('/vendor/three/three.module.min.js');
  const { RoomEnvironment } = await import('/vendor/three/RoomEnvironment.js');
  viewer = new Viewer(RoomEnvironment);
  if (/debug3d/.test(location.search)) window.car3d = viewer;
}

// ---- Shape ---------------------------------------------------------------------------------

// Smooth curve through [x, y] keys (Catmull-Rom), flat beyond the ends.
function curve(keys) {
  return (x) => {
    if (x <= keys[0][0]) return keys[0][1];
    const n = keys.length - 1;
    if (x >= keys[n][0]) return keys[n][1];
    let i = 0;
    while (keys[i + 1][0] < x) i++;
    const [x0, y0] = keys[Math.max(i - 1, 0)];
    const [x1, y1] = keys[i];
    const [x2, y2] = keys[i + 1];
    const [x3, y3] = keys[Math.min(i + 2, n)];
    const t = (x - x1) / (x2 - x1);
    const m1 = ((y2 - y0) / (x2 - x0 || 1)) * (x2 - x1);
    const m2 = ((y3 - y1) / (x3 - x1 || 1)) * (x2 - x1);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * y2 + (t3 - t2) * m2;
  };
}

// Metres. x forward (front bumper +2.44, rear -2.53), y up, z to the car's right (driver side is -z).
const X_REAR = -2.53;
const X_FRONT = 2.44;
const AXLE = 1.48;
const WHEEL_R = 0.355;
const TRACK = 0.835;
const ARCH_R = 0.405;
const top = curve([[-2.53, 0.6], [-2.5, 0.8], [-2.44, 0.9], [-2.3, 0.985], [-2.12, 1.0], [-1.7, 1.14], [-1.2, 1.31], [-0.8, 1.395], [-0.3, 1.431], [0.15, 1.4], [0.55, 1.2], [0.95, 0.96], [1.5, 0.87], [2.0, 0.795], [2.28, 0.71], [2.4, 0.62], [2.44, 0.54]]);
const botBase = curve([[-2.53, 0.44], [-2.46, 0.3], [-2.2, 0.24], [-1.85, 0.165], [1.9, 0.15], [2.25, 0.2], [2.41, 0.3], [2.44, 0.42]]);
const belt = curve([[-2.53, 0.88], [-2.1, 0.995], [-1.0, 1.0], [0, 0.985], [0.95, 0.955], [2.44, 0.88]]);
const width = curve([[-2.53, 0.5], [-2.5, 0.72], [-2.42, 0.84], [-2.25, 0.92], [-2.0, 0.955], [-1.5, 0.98], [-0.6, 0.962], [0.4, 0.96], [1.4, 0.975], [1.95, 0.945], [2.2, 0.88], [2.36, 0.76], [2.44, 0.55]]);

function bottom(x) {
  let y = botBase(x);
  for (const a of [AXLE, -AXLE]) {
    const d = x - a;
    if (Math.abs(d) < ARCH_R) y = Math.max(y, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - d * d));
  }
  return y;
}

// Greenhouse = where the roofline is clearly above the beltline (windshield to rear glass).
const greenhouse = (x) => top(x) - belt(x) > 0.06;

// A point on the body. t runs around the cross-section: 0 bottom centre, ±0.12 bottom edge,
// ±0.52 shoulder (beltline), ±1 roof centre; negative t is the driver (-z) side. inset moves inward.
function point(x, t, inset = 0) {
  const side = t < 0 ? -1 : 1;
  const s = Math.abs(t);
  const w = width(x) - inset;
  const yt = top(x) - inset;
  const yb = bottom(x) + inset;
  const yBelt = Math.min(belt(x), yt - 0.03);
  let y;
  let z;
  if (s <= 0.12) {
    y = yb;
    z = (s / 0.12) * 0.8 * w;
  } else if (s <= 0.52) {
    const v = (s - 0.12) / 0.4;
    y = yb + v * (yBelt - yb);
    z = w * (v < 0.45 ? 0.8 + 0.2 * Math.sin((v / 0.45) * Math.PI / 2) : 1 - 0.07 * ((v - 0.45) / 0.55) ** 2);
  } else {
    // Shoulder to roof centre: quadratic curve with its knee at the roof edge (cabin) or at the
    // fender edge (hood and rear deck).
    const u = (s - 0.52) / 0.48;
    const g = Math.max(0, Math.min(1, (yt - yBelt) / 0.3));
    const az = 0.94 * w;
    const kz = az * 0.9 * (1 - g) + 0.55 * g;
    y = (1 - u) ** 2 * yBelt + 2 * u * (1 - u) * yt + u * u * yt;
    z = (1 - u) ** 2 * az + 2 * u * (1 - u) * kz;
  }
  return [x, y, z * side];
}

function normalAt(x, t) {
  const e = 0.002;
  const p = point(x, t);
  const px = point(x + e, t);
  const pt = point(x, t + (t < 0 ? -e : e));
  const a = [px[0] - p[0], px[1] - p[1], px[2] - p[2]];
  const b = [pt[0] - p[0], pt[1] - p[1], pt[2] - p[2]];
  let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Point it away from the car's centre line.
  const out = [0, p[1] - 0.7, p[2]];
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = n.map((v) => -v);
  const l = Math.hypot(...n) || 1;
  return n.map((v) => v / l);
}

// Parts cut out of the body. t ranges past 1 wrap over the roof to the driver side (t - 2).
const DOOR_T = [0.2, 0.79];
const PARTS = {
  DriverFront: { x: [-0.1, 0.93], t: [-DOOR_T[1], -DOOR_T[0]], hinge: 'front' },
  DriverRear: { x: [-1.03, -0.1], t: [-DOOR_T[1], -DOOR_T[0]], hinge: 'front' },
  PassengerFront: { x: [-0.1, 0.93], t: DOOR_T, hinge: 'front' },
  PassengerRear: { x: [-1.03, -0.1], t: DOOR_T, hinge: 'front' },
  TrunkFront: { x: [1.02, 2.31], t: [0.6, 1.4], hinge: 'rear' },
  TrunkRear: { x: [-2.47, -0.92], t: [0.62, 1.38], hinge: 'front-top' },
  ChargePort: { x: [-2.37, -2.25], t: [-0.47, -0.4], hinge: 'front', overlay: true },
};
const WINDOWS = { FdWindow: 'DriverFront', RdWindow: 'DriverRear', FpWindow: 'PassengerFront', RpWindow: 'PassengerRear' };
const wrapT = (t) => (t > 1 ? t - 2 : t);
const inPart = (x, t) => {
  for (const [k, p] of Object.entries(PARTS)) {
    if (p.overlay) continue;
    const tt = p.t[1] > 1 && t < 0 ? t + 2 : t;
    if (x > p.x[0] && x < p.x[1] && tt > p.t[0] && tt < p.t[1]) return k;
  }
  return null;
};

function range(a, b, n) {
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}
const merge = (list, extra) => [...new Set([...list, ...extra].map((v) => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b);

// Grid surface over xs × ts. faceGroup(xc, tc) returns 0 paint, 1 glass, or -1 to leave a hole.
function surface(xs, ts, { inset = 0, offset = 0, faceGroup = () => 0, wrap = false, caps = false }) {
  const pos = [];
  for (const x of xs) {
    for (const t0 of ts) {
      const t = wrapT(t0);
      let p = point(x, t, inset);
      if (offset) { const n = normalAt(x, t); p = p.map((v, i) => v + n[i] * offset); }
      pos.push(...p);
    }
  }
  const nt = ts.length;
  const groups = [[], []];
  const cols = wrap ? nt : nt - 1;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % nt;
      const tc = wrap && j2 === 0 ? (ts[j] + 1) / 2 : (ts[j] + ts[j2]) / 2;
      const g = faceGroup((xs[i] + xs[i + 1]) / 2, wrapT(tc));
      if (g < 0) continue;
      const a = i * nt + j;
      const b = i * nt + j2;
      const c = (i + 1) * nt + j;
      const d = (i + 1) * nt + j2;
      groups[g].push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    for (const [i, flip] of [[0, true], [xs.length - 1, false]]) {
      const x = xs[i];
      const centre = pos.length / 3;
      pos.push(x + (flip ? -0.004 : 0.004), (top(x) + bottom(x)) / 2, 0);
      for (let j = 0; j < nt; j++) {
        const a = i * nt + j;
        const b = i * nt + ((j + 1) % nt);
        groups[0].push(...(flip ? [centre, a, b] : [centre, b, a]));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...groups[0], ...groups[1]]);
  geo.addGroup(0, groups[0].length, 0);
  geo.addGroup(groups[0].length, groups[1].length, 1);
  geo.computeVertexNormals();
  return geo;
}

const isGlass = (x, t) => Math.abs(t) > 0.53 && greenhouse(x);

// ---- Viewer --------------------------------------------------------------------------------

class Viewer {
  constructor(RoomEnvironment) {
    this.el = document.createElement('div');
    this.el.className = 'car3d-stage';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.labels = document.createElement('div');
    this.labels.className = 'car3d-labels';
    this.hint = document.createElement('div');
    this.hint.className = 'car3d-hint';
    this.hint.textContent = 'Drag to turn';
    this.el.append(this.canvas, this.labels, this.hint);

    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.info = `${r.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1'} · ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'renderer hidden'}`;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); failed = true; viewer = null; render(); });

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 4);
    this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
    this.target = new THREE.Vector3(-0.05, 0.62, 0);

    this.build();
    this.az = -0.72; // front-left three-quarter view
    this.el_ = 0.2;
    this.goalAz = this.az;
    this.vel = 0;
    this.touched = 0;
    this.data = null;
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  build() {
    const T = THREE;
    // Two-sided so an opened lid still draws when seen from underneath.
    this.paint = new T.MeshPhysicalMaterial({ color: PAINTS.red.color, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, side: T.DoubleSide });
    const glass = new T.MeshPhysicalMaterial({ color: 0x020304, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.55, side: T.DoubleSide });
    const dark = new T.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.95, side: T.DoubleSide });
    const mats = [this.paint, glass];
    this.glassMat = glass;
    this.noGlass = new T.MeshBasicMaterial({ visible: false });

    // Stations along the car and around each section, with every part edge included so cuts are clean.
    const edgesX = Object.values(PARTS).flatMap((p) => p.x);
    const xs = merge(range(X_REAR, X_FRONT, 150), [...edgesX, AXLE - ARCH_R, AXLE + ARCH_R, -AXLE - ARCH_R, -AXLE + ARCH_R]);
    const edgesT = Object.values(PARTS).flatMap((p) => p.t.map(wrapT));
    const ts = merge(range(-1, 1, 64), [...edgesT, -0.53, 0.53, -0.52, 0.52]).filter((t) => t > -1);
    const body = new T.Mesh(surface(xs, ts, { wrap: true, caps: true, faceGroup: (x, t) => (inPart(x, t) ? -1 : isGlass(x, t) ? 1 : 0) }), mats);
    const cabin = new T.Mesh(surface(range(X_REAR + 0.06, X_FRONT - 0.06, 80), range(-1, 1, 40).filter((t) => t > -1), { inset: 0.05, wrap: true, caps: true }), dark);
    this.car = new T.Group();
    this.car.add(body, cabin);

    // Wheel wells, so the arches don't show through to the other side.
    for (const a of [AXLE, -AXLE]) {
      const well = new T.Mesh(new T.BoxGeometry(ARCH_R * 2, 0.62, 1.42), dark);
      well.position.set(a, 0.42, 0);
      this.car.add(well);
    }

    // Opening parts, each in a pivot at its hinge. Panel gaps: each part is cut 4 mm smaller.
    this.parts = {};
    for (const [name, p] of Object.entries(PARTS)) {
      const gap = 0.004;
      const pxs = merge(range(p.x[0] + gap, p.x[1] - gap, 24), []);
      const pts = merge(range(p.t[0] + gap, p.t[1] - gap, 22), p.t[0] < 0.53 && p.t[1] > 0.53 ? [0.53] : p.t[0] < -0.53 && p.t[1] > -0.53 ? [-0.53] : []);
      const geo = surface(pxs, pts, { offset: p.overlay ? 0.003 : 0, faceGroup: (x, t) => (isGlass(x, t) ? 1 : 0) });
      const mesh = new T.Mesh(geo, p.overlay ? new T.MeshStandardMaterial({ color: 0x1a0306, roughness: 0.3, emissive: 0x000000 }) : mats);
      const side = Math.sign(wrapT((p.t[0] + p.t[1]) / 2)) || 1;
      let hinge;
      if (p.hinge === 'front') hinge = point(p.x[1], wrapT((p.t[0] + p.t[1]) / 2));
      else if (p.hinge === 'rear') hinge = point(p.x[0], 1);
      else hinge = point(p.x[1], 1);
      const pivot = new T.Group();
      pivot.position.set(...hinge);
      mesh.position.set(-hinge[0], -hinge[1], -hinge[2]);
      pivot.add(mesh);
      this.car.add(pivot);
      // Open angles: doors swing out about a vertical hinge, frunk and liftback rise.
      const axis = p.hinge === 'front' ? 'y' : 'z';
      const open = name === 'TrunkFront' ? 0.85 : name === 'TrunkRear' ? -1.05 : name === 'ChargePort' ? side * 1.3 : side * 0.95;
      this.parts[name] = { pivot, mesh, axis, open, amount: 0, goal: 0 };
    }
    this.port = this.parts.ChargePort.mesh.material;

    // Lights: thin emissive strips laid on the body.
    const lamp = (x0, x1, t0, t1, color, intensity) => {
      const m = new T.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.3 });
      for (const s of [1, -1]) this.car.add(new T.Mesh(surface(range(x0, x1, 10), range(t0 * s, t1 * s, 4).sort((a, b) => a - b), { offset: 0.002 }), m));
    };
    lamp(2.04, 2.36, 0.5, 0.555, 0xdfe9ff, 0.55);
    lamp(-2.47, -2.2, 0.41, 0.5, 0xc0101a, 0.8);

    // Door mirrors: body-colour shell on a black stalk, ahead of the front doors.
    for (const sd of [1, -1]) {
      const shell = new T.Mesh(new T.SphereGeometry(0.1, 24, 16), this.paint);
      shell.scale.set(0.8, 0.5, 1.0);
      shell.position.set(0.86, 1.01, sd * 0.99);
      const stalk = new T.Mesh(new T.BoxGeometry(0.06, 0.03, 0.12), new T.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.6 }));
      stalk.position.set(0.88, 0.99, sd * 0.91);
      this.car.add(shell, stalk);
    }

    // Wheels: tyre (lathe), dark five-spoke rim, hub.
    const tyreGeo = new T.LatheGeometry([[0.268, -0.118], [0.33, -0.133], [0.352, -0.112], [0.356, 0], [0.352, 0.112], [0.33, 0.133], [0.268, 0.118]].map(([a, b]) => new T.Vector2(a, b)), 48);
    tyreGeo.rotateX(Math.PI / 2);
    const tyre = new T.MeshStandardMaterial({ color: 0x111214, roughness: 0.85 });
    const rim = new T.MeshPhysicalMaterial({ color: 0x8a9097, metalness: 0.85, roughness: 0.28, clearcoat: 0.6 });
    const caliper = new T.MeshStandardMaterial({ color: 0x9a1b22, roughness: 0.5 });
    const wheel = () => {
      const g = new T.Group();
      g.add(new T.Mesh(tyreGeo, tyre));
      const barrel = new T.Mesh(new T.CylinderGeometry(0.268, 0.268, 0.22, 40, 1, true), rim);
      barrel.rotation.x = Math.PI / 2;
      g.add(barrel);
      const face = new T.Mesh(new T.CylinderGeometry(0.255, 0.255, 0.01, 40), new T.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.6 }));
      face.rotation.x = Math.PI / 2;
      face.position.z = -0.02;
      g.add(face);
      for (let i = 0; i < 5; i++) {
        const spoke = new T.Mesh(new T.BoxGeometry(0.05, 0.21, 0.03), rim);
        const a = (i / 5) * Math.PI * 2;
        spoke.position.set(Math.sin(a) * 0.15, Math.cos(a) * 0.15, 0.085);
        spoke.rotation.z = -a;
        g.add(spoke);
      }
      const hub = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.04, 24), rim);
      hub.rotation.x = Math.PI / 2;
      hub.position.z = 0.09;
      g.add(hub);
      const cal = new T.Mesh(new T.BoxGeometry(0.16, 0.09, 0.05), caliper);
      cal.position.set(0.13, 0.12, 0.02);
      g.add(cal);
      return g;
    };
    this.wheelPos = {};
    for (const [k, x, z] of [['Fl', AXLE, -TRACK], ['Fr', AXLE, TRACK], ['Rl', -AXLE, -TRACK], ['Rr', -AXLE, TRACK]]) {
      const w = wheel();
      w.position.set(x, WHEEL_R, z);
      if (z < 0) w.rotation.y = Math.PI;
      this.car.add(w);
      this.wheelPos[k] = new T.Vector3(x, WHEEL_R * 0.35, z * 1.16);
    }

    // Soft contact shadow.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const shadow = new T.Mesh(new T.PlaneGeometry(6.2, 2.9), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(-0.05, 0.002, 0);
    this.car.add(shadow);
    this.scene.add(this.car);
    this.portPos = new T.Vector3(...point(-2.31, -0.44)).add(new T.Vector3(0, 0.12, -0.12));
    this.partPos = { TrunkFront: new T.Vector3(1.9, 1.3, 0), TrunkRear: new T.Vector3(-2.2, 1.55, 0) };
  }

  bindInput() {
    let last = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.canvas.setPointerCapture(e.pointerId);
      this.vel = 0;
      this.touched = Date.now();
      this.hint.hidden = true;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last.x;
      const now = performance.now();
      this.az += dx * 0.009;
      this.goalAz = this.az;
      if (e.pointerType === 'mouse') this.el_ = Math.max(0.04, Math.min(0.7, this.el_ + (e.clientY - last.y) * 0.005));
      this.vel = (dx * 0.009) / Math.max(now - last.t, 8) * 16;
      last = { x: e.clientX, y: e.clientY, t: now };
      this.touched = Date.now();
      this.frame();
    });
    const end = () => { last = null; this.frame(); };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.el;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Fit: the closest distance at which the car's box stays inside 90% of the view from every
    // side, so turning it never crops it and the zoom doesn't pump as it turns.
    const corners = [];
    for (const x of [X_REAR, X_FRONT]) for (const y of [0, 1.45]) for (const z of [-1.0, 1.0]) corners.push(new THREE.Vector3(x, y, z));
    let worst = 0;
    const d0 = 10;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      this.place(a, d0);
      this.camera.updateMatrixWorld();
      for (const c of corners) {
        const p = c.clone().project(this.camera);
        worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
      }
    }
    this.dist = d0 * (worst / 0.9);
    this.frame();
  }

  place(az, d) {
    const c = this.camera;
    c.position.set(this.target.x + d * Math.cos(this.el_) * Math.cos(az), this.target.y + d * Math.sin(this.el_), this.target.z + d * Math.cos(this.el_) * Math.sin(az));
    c.lookAt(this.target);
  }

  setPaint(key) {
    const p = PAINTS[key] || PAINTS.red;
    if (this.paintKey === key) return;
    this.paintKey = key;
    this.paint.color.setHex(p.color);
    this.paint.metalness = p.metalness;
    this.paint.roughness = p.roughness;
  }

  update(data) {
    this.data = data;
    const v = (f) => data.signals[f]?.value;
    this.setPaint(data.paint);
    const doors = v('DoorState') && typeof v('DoorState') === 'object' ? v('DoorState') : {};
    for (const k of Object.keys(PARTS)) {
      if (k === 'ChargePort') this.parts[k].goal = v('ChargePortDoorOpen') === true ? 1 : 0;
      else this.parts[k].goal = doors[k] === true ? 1 : 0;
    }
    this.windows = {};
    for (const [f, door] of Object.entries(WINDOWS)) {
      this.windows[door] = /Open/.test(v(f) || '');
      // An open window drops its glass into the door, leaving the dark cabin showing.
      this.parts[door].mesh.material = [this.paint, this.windows[door] ? this.noGlass : this.glassMat];
    }
    const cs = String(v('DetailedChargeState') || '');
    this.charge = /Charging/.test(cs) ? 'charging' : /Disconnected/.test(cs) || !cs ? (v('ChargePortDoorOpen') ? 'open' : 'off') : 'plugged';
    const portColor = { charging: 0x2bd96b, plugged: 0x2f7dff, open: 0xdfe9ff, off: 0x000000 }[this.charge];
    this.port.emissive.setHex(portColor);
    this.port.emissiveIntensity = this.charge === 'off' ? 0 : 1.6;
    // Turn to what changed unless someone turned the car by hand in the last 20 s.
    const focus = this.focus();
    if (focus !== this.lastFocus) {
      this.lastFocus = focus;
      if (focus != null && Date.now() - this.touched > 20_000) this.goalAz = this.nearest(focus);
    }
    const aria = [`Model S, ${PAINTS[this.paintKey]?.name || ''}`];
    const open = Object.keys(PARTS).filter((k) => k !== 'ChargePort' && this.parts[k].goal);
    aria.push(open.length ? `open: ${open.join(', ')}` : 'all doors closed');
    if (this.charge !== 'off') aria.push(`charge port ${this.charge}`);
    this.canvas.setAttribute('aria-label', aria.join('; '));
    this.renderLabels();
    this.frame();
  }

  focus() {
    const p = this.parts;
    if (p.DriverFront.goal || p.DriverRear.goal || this.windows.DriverFront || this.windows.DriverRear) return -1.25;
    if (p.PassengerFront.goal || p.PassengerRear.goal || this.windows.PassengerFront || this.windows.PassengerRear) return 1.25;
    if (p.TrunkRear.goal) return -2.5;
    if (p.TrunkFront.goal) return -0.45;
    if (this.charge !== 'off') return -2.35;
    return null;
  }

  nearest(a) {
    const tau = Math.PI * 2;
    return a + Math.round((this.az - a) / tau) * tau;
  }

  renderLabels() {
    const v = (f) => this.data.signals[f]?.value;
    const leaks = this.data.leaks || [];
    const target = this.data.targetPsi;
    const items = [];
    for (const k of ['Fl', 'Fr', 'Rl', 'Rr']) {
      const p = psi(v(`TpmsPressure${k}`));
      const tire = k.toUpperCase();
      const low = leaks.includes(tire) || (target && p != null && p < target - 3);
      items.push({ pos: this.wheelPos[k], html: `<b>${num(p)}</b> psi`, cls: `tire${low ? ' warn' : ''}`, label: `${tire} tyre ${num(p)} psi` });
    }
    // One tag per side for doors and windows, so two open doors don't stack two tags.
    for (const [who, side] of [['Driver', -1], ['Passenger', 1]]) {
      const which = (open) => ['Front', 'Rear'].filter((p) => open(`${who}${p}`));
      const doors = which((k) => this.parts[k].goal);
      const wins = which((k) => this.windows[k] && !this.parts[k].goal);
      const say = (list, what) => (list.length === 2 ? `${what}s` : list.length ? `${list[0]} ${what.toLowerCase()}` : '');
      const txt = [say(doors, 'Door'), say(wins, 'Window')].filter(Boolean).join(', ');
      if (txt) items.push({ pos: new THREE.Vector3(-0.1, 1.05, side * 1.15), html: `${txt.charAt(0).toUpperCase()}${txt.slice(1)} open`, cls: 'open' });
    }
    if (this.parts.TrunkFront.goal) items.push({ pos: this.partPos.TrunkFront, html: 'Frunk open', cls: 'open' });
    if (this.parts.TrunkRear.goal) items.push({ pos: this.partPos.TrunkRear, html: 'Trunk open', cls: 'open' });
    if (this.charge !== 'off') items.push({ pos: this.portPos, html: { charging: 'Charging', plugged: 'Plugged in', open: 'Port open' }[this.charge], cls: `port ${this.charge}` });
    const html = items.map((it) => `<span class="car3d-tag ${it.cls}"${it.label ? ` aria-label="${esc(it.label)}"` : ''}>${it.html}</span>`).join('');
    // Rebuild only on change, so live updates don't reset the tags' fade.
    if (html !== this.labelHtml) { this.labels.innerHTML = html; this.labelHtml = html; }
    this.items = items;
  }

  frame() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    let moving = false;
    if (!this.el.isConnected || !this.dist) return;
    for (const p of Object.values(this.parts)) {
      const d = p.goal - p.amount;
      if (Math.abs(d) > 0.002) { p.amount += d * 0.12; moving = true; } else p.amount = p.goal;
      const ease = p.amount * p.amount * (3 - 2 * p.amount);
      p.pivot.rotation[p.axis] = p.open * ease;
    }
    if (Math.abs(this.vel) > 0.0005 && Date.now() - this.touched < 2000) {
      this.az += this.vel;
      this.vel *= 0.92;
      this.goalAz = this.az;
      moving = true;
    } else if (Math.abs(this.goalAz - this.az) > 0.002) {
      this.az += (this.goalAz - this.az) * 0.08;
      moving = true;
    }
    const c = this.camera;
    this.place(this.az, this.dist);
    this.renderer.render(this.scene, c);
    // Tags follow their 3D anchor; ones on the far side of the car fade.
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const camDir = new THREE.Vector3().subVectors(c.position, this.target).setY(0).normalize();
    [...this.labels.children].forEach((el, i) => {
      const it = this.items[i];
      if (!it) return;
      const p = it.pos.clone().project(c);
      el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -50%)`;
      // Tyre tags show for the side of the car facing the camera (or the end, when seen head-on).
      const far = it.cls.startsWith('tire')
        ? (Math.abs(camDir.z) > 0.3 ? it.pos.z * camDir.z < 0 : it.pos.x * camDir.x < 0)
        : new THREE.Vector3(it.pos.x, 0, it.pos.z).normalize().dot(camDir) < -0.1;
      el.classList.toggle('far', far);
    });
    if (moving) this.frame();
  }
}
