// Licensed, locally served Model S Plaid mesh; see web/models/LICENSE.txt.
// Telemetry annotations describe live state. The artist mesh has no verified door rig,
// so open panels are reported in labels rather than approximated by deforming geometry.
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
  const { GLTFLoader } = await import('/vendor/three/GLTFLoader.js');
  const { MeshoptDecoder } = await import('/vendor/three/meshopt_decoder.module.js');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync('/models/model-s-plaid.glb');
  viewer = new Viewer(RoomEnvironment, gltf.scene);
  if (/debug3d/.test(location.search)) window.car3d = viewer;
}

const X_REAR = -2.53;
const X_FRONT = 2.44;
const AXLE = 1.48;
const WHEEL_R = 0.355;
const TRACK = 0.835;
const PARTS = ['DriverFront', 'DriverRear', 'PassengerFront', 'PassengerRear', 'TrunkFront', 'TrunkRear', 'ChargePort'];
const WINDOWS = { FdWindow: 'DriverFront', RdWindow: 'DriverRear', FpWindow: 'PassengerFront', RpWindow: 'PassengerRear' };

function registrationTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  // Both plates share UVs that invert the source artwork vertically.
  ctx.translate(0, canvas.height);
  ctx.scale(1, -1);
  ctx.fillStyle = '#f4f5f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#142634';
  ctx.lineWidth = 10;
  ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
  ctx.fillStyle = '#102738';
  ctx.font = 'bold 176px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DEVIL', canvas.width / 2, canvas.height / 2 + 8, 800);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}

// ---- Viewer --------------------------------------------------------------------------------

class Viewer {
  constructor(RoomEnvironment, model) {
    this.el = document.createElement('div');
    this.el.className = 'car3d-stage';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.labels = document.createElement('div');
    this.labels.className = 'car3d-labels';
    this.hint = document.createElement('div');
    this.hint.className = 'car3d-hint';
    this.hint.textContent = 'Drag to turn';
    const credit = document.createElement('a');
    credit.className = 'car3d-credit';
    credit.href = '/models/LICENSE.txt';
    credit.target = '_blank';
    credit.rel = 'noopener';
    credit.textContent = '3D Hawk · CC BY 4.0';
    credit.title = 'Artist model: Model S Plaid 2021. Open-state telemetry is shown as labels.';
    this.el.append(this.canvas, this.labels, this.hint, credit);

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

    this.build(model);
    this.az = -0.92; // front-left three-quarter view
    this.el_ = 0.2;
    this.goalAz = this.az;
    this.vel = 0;
    this.touched = 0;
    this.data = null;
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  build(model) {
    const T = THREE;
    this.car = model;
    // Source uses +Z forward and +X left. Match the dashboard's +X forward frame.
    model.rotation.y = Math.PI / 2;
    this.paintMaterials = [];
    const replaced = new Map();
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const original = mesh.material;
      const name = original.name || '';
      if (/Pearl_White_Multi_Coat/.test(name)) {
        if (!replaced.has(original)) {
          const paint = new T.MeshPhysicalMaterial({ color: PAINTS.red.color, metalness: 0.35, roughness: 0.27, clearcoat: 1, clearcoatRoughness: 0.12, side: T.DoubleSide });
          replaced.set(original, paint);
          this.paintMaterials.push(paint);
        }
        mesh.material = replaced.get(original);
      } else if (/Rims/.test(name)) {
        original.color.setHex(0x34383e); original.metalness = 0.85; original.roughness = 0.3;
      } else if (/Windows/.test(name)) {
        original.color.setHex(0x0b121b); original.roughness = 0.12;
        original.opacity = 0.72; original.depthWrite = false;
      } else if (/ceramic_brake/.test(name)) {
        original.metalness = 0.7; original.roughness = 0.55;
      } else if (name === 'Philippine_License_Plate_Recovered') {
        original.map?.dispose();
        original.map = registrationTexture();
        original.map.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        original.color.setHex(0xffffff);
        original.roughness = 0.65;
        original.needsUpdate = true;
      }
    });
    // The replacement materials own their resources after the original ones are released.
    for (const original of replaced.keys()) original.dispose();
    model.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(model);
    const scale = (X_FRONT - X_REAR) / (box.max.x - box.min.x);
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    model.position.x += (X_FRONT + X_REAR) / 2 - (box.max.x + box.min.x) / 2;
    model.position.y -= box.min.y;
    model.position.z -= (box.max.z + box.min.z) / 2;
    this.scene.add(model);
    this.parts = Object.fromEntries(PARTS.map((name) => [name, { goal: 0 }]));
    this.wheelPos = {};
    for (const [k, x, z] of [['Fl', AXLE, -TRACK], ['Fr', AXLE, TRACK], ['Rl', -AXLE, -TRACK], ['Rr', -AXLE, TRACK]]) {
      this.wheelPos[k] = new T.Vector3(x, WHEEL_R * 0.35, z * 1.16);
    }
    this.portPos = new T.Vector3(-2.31, 0.95, -0.95);
    this.partPos = { TrunkFront: new T.Vector3(1.9, 1.3, 0), TrunkRear: new T.Vector3(-2.2, 1.55, 0) };
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.45)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
    const shadow = new T.Mesh(new T.PlaneGeometry(6.2, 2.9), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(-0.05, 0.002, 0);
    this.scene.add(shadow);
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
    for (const material of this.paintMaterials) {
      material.color.setHex(p.color);
      material.metalness = p.metalness;
      material.roughness = p.roughness;
    }
  }

  update(data) {
    this.data = data;
    const v = (f) => data.signals[f]?.value;
    this.setPaint(data.paint);
    const doors = v('DoorState') && typeof v('DoorState') === 'object' ? v('DoorState') : {};
    for (const k of PARTS) {
      if (k === 'ChargePort') this.parts[k].goal = v('ChargePortDoorOpen') === true ? 1 : 0;
      else this.parts[k].goal = doors[k] === true ? 1 : 0;
    }
    this.windows = {};
    for (const [f, door] of Object.entries(WINDOWS)) {
      this.windows[door] = /Open/.test(v(f) || '');
    }
    const cs = String(v('DetailedChargeState') || '');
    this.charge = /Charging/.test(cs) ? 'charging' : /Disconnected/.test(cs) || !cs ? (v('ChargePortDoorOpen') ? 'open' : 'off') : 'plugged';
    // Turn to what changed unless someone turned the car by hand in the last 20 s.
    const focus = this.focus();
    if (focus !== this.lastFocus) {
      this.lastFocus = focus;
      if (focus != null && Date.now() - this.touched > 20_000) this.goalAz = this.nearest(focus);
    }
    const aria = [`Model S, ${PAINTS[this.paintKey]?.name || ''}, registration DEVIL`];
    const open = PARTS.filter((k) => k !== 'ChargePort' && this.parts[k].goal);
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
