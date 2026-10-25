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
  return `<div class="car3d ${cls}" data-car3d><span class="car3d-wordmark" aria-hidden="true">PLAID</span><div class="car3d-loading" role="status">Preparing your studio&hellip;</div></div>`;
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
  slot.querySelector('.car3d-loading')?.remove();
  const mode = MODES[data?.mode] ? data.mode : 'vehicle';
  slot.dataset.car3dMode = mode;
  viewer.update({ ...data, mode });
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
const MODES = {
  vehicle: { camera: [-0.92, 0.2, 0.62], lights: [1.35, 1.75, 1.0], exposure: 0.9 },
  charge: { camera: [-2.28, 0.24, 0.7], lights: [1.0, 2.45, 0.65], exposure: 0.92 },
  drive: { camera: [-1.52, 0.4, 0.58], lights: [1.2, 1.65, 1.45], exposure: 0.94 },
  health: { camera: [-0.56, 0.52, 0.5], lights: [1.5, 1.35, 1.1], exposure: 0.91 },
  trips: { camera: [-2.82, 0.3, 0.58], lights: [1.25, 1.7, 0.8], exposure: 0.89 },
  insights: { camera: [-0.72, 0.46, 0.52], lights: [1.4, 1.8, 0.85], exposure: 0.92 },
};
const VIEWS = {
  studio: [-0.92, 0.2, 0.62],
  side: [-Math.PI / 2, 0.12, 0.6],
  rear: [-2.55, 0.22, 0.64],
  top: [-Math.PI / 2, 1.08, 0.25],
};

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
    this.canvas.tabIndex = 0;
    this.canvas.dataset.fk = 'studio-orbit';
    this.canvas.setAttribute('aria-describedby', 'studio-help');
    this.labels = document.createElement('div');
    this.labels.className = 'car3d-labels';
    this.caption = document.createElement('div');
    this.caption.className = 'car3d-mode-caption';
    this.caption.setAttribute('aria-hidden', 'true');
    this.viewport = document.createElement('div');
    this.viewport.className = 'car3d-viewport';
    this.viewport.append(this.canvas, this.labels, this.caption);
    this.hint = document.createElement('div');
    this.hint.className = 'car3d-hint';
    this.hint.id = 'studio-help';
    this.hint.textContent = 'Drag to explore / arrow keys to orbit';
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.controls = document.createElement('div');
    this.controls.className = 'car3d-controls';
    this.controls.setAttribute('role', 'group');
    this.controls.setAttribute('aria-label', 'Vehicle camera');
    this.controls.innerHTML = `<div class="car3d-views">${[['studio', 'Studio'], ['side', 'Profile'], ['rear', 'Rear'], ['top', 'Top']].map(([view, label]) => `<button type="button" data-view="${view}" data-fk="studio-${view}" aria-pressed="${view === 'studio'}">${label}</button>`).join('')}</div><button type="button" class="car3d-overlay" data-fk="studio-labels" aria-pressed="true">Tire labels</button>`;
    this.controls.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      if (button.dataset.view) this.setView(button.dataset.view);
      else {
        const visible = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(visible));
        this.labels.classList.toggle('hide-tires', !visible);
      }
    });
    const credit = document.createElement('a');
    credit.className = 'car3d-credit';
    credit.href = '/models/LICENSE.txt';
    credit.target = '_blank';
    credit.rel = 'noopener';
    credit.textContent = '3D Hawk · CC BY 4.0';
    credit.title = 'Artist model: Model S Plaid 2021. Open-state telemetry is shown as labels.';
    this.el.append(this.viewport, this.hint, this.controls, credit);

    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
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
    this.scene.fog = new THREE.FogExp2(0x090c10, 0.045);
    this.key = new THREE.DirectionalLight(0xf4f7fa, 1.35);
    this.key.position.set(3, 6, 4);
    this.rim = new THREE.DirectionalLight(0x5aa9a2, 1.75);
    this.rim.position.set(-4, 3, -4);
    this.warm = new THREE.DirectionalLight(0xff824f, 1.0);
    this.warm.position.set(2, 2, 5);
    this.fill = new THREE.HemisphereLight(0x73868e, 0x090b0d, 0.42);
    this.scene.add(this.key, this.rim, this.warm, this.fill);
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
    this.target = new THREE.Vector3(-0.05, 0.62, 0);

    this.build(model);
    this.az = -0.92; // front-left three-quarter view
    this.el_ = 0.2;
    this.goalAz = this.az;
    this.goalEl = this.el_;
    this.goalTarget = this.target.clone();
    this.goalExposure = r.toneMappingExposure;
    this.goalLights = [this.key.intensity, this.rim.intensity, this.warm.intensity];
    this.vel = 0;
    this.touched = 0;
    this.mode = null;
    this.interacting = false;
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
    // The model is unrigged. These are intentionally schematic locations for the three
    // supported torque signals, not manufacturer-published physical motor coordinates.
    this.drivePos = {
      DiTorqueActualF: new T.Vector3(1.35, 0.34, 0),
      DiTorqueActualREL: new T.Vector3(-1.42, 0.34, -0.48),
      DiTorqueActualRER: new T.Vector3(-1.42, 0.34, 0.48),
    };
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.45)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
    const shadow = new T.Mesh(new T.PlaneGeometry(6.2, 2.9), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(-0.05, 0.002, 0);
    shadow.renderOrder = 1;
    this.scene.add(shadow);
    // The ground texture fades well before its geometry edge. That keeps the proving ground
    // embedded in the page atmosphere even when the low camera crops the plane.
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = floorCanvas.height = 256;
    const floorCtx = floorCanvas.getContext('2d');
    const floorFade = floorCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
    floorFade.addColorStop(0, 'rgba(17,23,27,0.98)');
    floorFade.addColorStop(0.5, 'rgba(17,23,27,0.88)');
    floorFade.addColorStop(0.72, 'rgba(17,23,27,0.58)');
    floorFade.addColorStop(0.88, 'rgba(17,23,27,0.2)');
    floorFade.addColorStop(0.97, 'rgba(17,23,27,0.03)');
    floorFade.addColorStop(1, 'rgba(17,23,27,0)');
    floorCtx.fillStyle = floorFade;
    floorCtx.fillRect(0, 0, 256, 256);
    const floorTexture = new T.CanvasTexture(floorCanvas);
    floorTexture.colorSpace = T.SRGBColorSpace;
    const floor = new T.Mesh(new T.CircleGeometry(6.2, 96), new T.MeshBasicMaterial({ map: floorTexture, transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.015;
    this.scene.add(floor);
    for (const radius of [3.25, 4.45]) {
      const ring = new T.Mesh(new T.RingGeometry(radius, radius + 0.014, 128), new T.MeshBasicMaterial({ color: radius < 3.5 ? 0x5aa9a2 : 0xff824f, transparent: true, opacity: radius < 3.5 ? 0.22 : 0.07, depthWrite: false, side: T.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.01;
      this.scene.add(ring);
    }
    this.buildProvingGround();
    this.buildModeGraphics();
  }

  buildProvingGround() {
    const T = THREE;
    const group = new T.Group();
    const fadedLines = (points, color, opacity) => {
      const geometry = new T.BufferGeometry().setFromPoints(points);
      const edge = new T.Color(0x11171b);
      const accent = new T.Color(color);
      const colors = [];
      for (const point of points) {
        const radius = Math.hypot(point.x, point.z);
        let strength = Math.max(0, Math.min(1, (5.5 - radius) / 1.9));
        strength = strength * strength * (3 - 2 * strength);
        const faded = edge.clone().lerp(accent, strength);
        colors.push(faded.r, faded.g, faded.b);
      }
      geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      return new T.LineSegments(geometry, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }));
    };
    const grid = [];
    for (const z of [-2.2, -1.45, 0, 1.45, 2.2]) {
      for (let x = -5.2; x < 5.2; x += 0.4) {
        grid.push(new T.Vector3(x, 0.006, z), new T.Vector3(Math.min(x + 0.4, 5.2), 0.006, z));
      }
    }
    for (let x = -5; x <= 5; x += 0.5) {
      const span = Number.isInteger(x) ? 0.34 : 0.17;
      grid.push(new T.Vector3(x, 0.007, -2.2 - span), new T.Vector3(x, 0.007, -2.2 + span));
      grid.push(new T.Vector3(x, 0.007, 2.2 - span), new T.Vector3(x, 0.007, 2.2 + span));
    }
    group.add(fadedLines(grid, 0x61747a, 0.2));

    const marks = [];
    for (let x = -4.6; x < 4.6; x += 0.8) {
      marks.push(new T.Vector3(x, 0.01, -2.72), new T.Vector3(x + 0.36, 0.01, -2.72));
    }
    for (const x of [X_REAR, 0, X_FRONT]) {
      marks.push(new T.Vector3(x, 0.012, -3.0), new T.Vector3(x, 0.012, -2.48));
      marks.push(new T.Vector3(x, 0.012, 2.48), new T.Vector3(x, 0.012, 3.0));
    }
    group.add(fadedLines(marks, 0xff824f, 0.38));
    this.scene.add(group);
    this.provingGround = group;
  }

  buildModeGraphics() {
    const T = THREE;
    const glow = (color, opacity = 0.85) => new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });

    this.chargeGroup = new T.Group();
    const chargeCurve = new T.CatmullRomCurve3([
      new T.Vector3(-4.8, 0.025, -2.4),
      new T.Vector3(-3.7, 0.04, -2.0),
      new T.Vector3(-2.75, 0.24, -1.35),
      this.portPos.clone(),
    ]);
    this.chargeGroup.add(new T.Mesh(new T.TubeGeometry(chargeCurve, 56, 0.024, 6, false), glow(0x63b9ae, 0.88)));
    const portHalo = new T.Mesh(new T.TorusGeometry(0.17, 0.025, 8, 36), glow(0xff824f, 0.95));
    portHalo.rotation.y = Math.PI / 2;
    portHalo.position.copy(this.portPos);
    this.chargeGroup.add(portHalo);
    for (const t of [0.08, 0.26, 0.44]) {
      const node = new T.Mesh(new T.SphereGeometry(0.045, 12, 8), glow(0x63b9ae, 0.9));
      node.position.copy(chargeCurve.getPoint(t));
      this.chargeGroup.add(node);
    }
    this.chargeGroup.visible = false;
    this.scene.add(this.chargeGroup);

    this.driveGroup = new T.Group();
    const drivePoints = [
      this.drivePos.DiTorqueActualF, this.drivePos.DiTorqueActualREL,
      this.drivePos.DiTorqueActualF, this.drivePos.DiTorqueActualRER,
      this.drivePos.DiTorqueActualREL, this.drivePos.DiTorqueActualRER,
    ].map((p) => p.clone());
    this.driveGroup.add(new T.LineSegments(
      new T.BufferGeometry().setFromPoints(drivePoints),
      new T.LineBasicMaterial({ color: 0x63b9ae, transparent: true, opacity: 0.62, depthWrite: false, depthTest: false }),
    ));
    for (const [field, pos] of Object.entries(this.drivePos)) {
      const material = glow(field === 'DiTorqueActualF' ? 0xff824f : 0x63b9ae);
      material.depthTest = false;
      const ring = new T.Mesh(new T.TorusGeometry(0.2, 0.025, 8, 36), material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(pos);
      ring.renderOrder = 3;
      this.driveGroup.add(ring);
    }
    this.driveGroup.visible = false;
    this.scene.add(this.driveGroup);

    this.healthGroup = new T.Group();
    this.healthMaterials = {};
    for (const [key, pos] of Object.entries(this.wheelPos)) {
      const material = glow(0x63b9ae, 0.7);
      const ring = new T.Mesh(new T.RingGeometry(0.28, 0.34, 44), material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pos.x, 0.018, pos.z);
      this.healthGroup.add(ring);
      this.healthMaterials[key] = material;
    }
    this.healthGroup.visible = false;
    this.scene.add(this.healthGroup);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.el.className = `car3d-stage mode-${mode}`;
    const config = MODES[mode];
    this.goalLights = config.lights;
    this.goalExposure = config.exposure;
    this.controls.querySelector('.car3d-overlay').hidden = !['vehicle', 'health'].includes(mode);
    this.controls.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
    if (this.interacting) this.pendingCamera = config.camera;
    else this.applyCamera(config.camera);
  }

  applyCamera(camera) {
    this.pendingCamera = null;
    this.vel = 0;
    this.goalAz = this.nearest(camera[0]);
    this.goalEl = camera[1];
    this.goalTarget.set(-0.05, camera[2], 0);
    this.updateFit(this.goalEl, this.goalTarget);
  }

  updateModeGraphics() {
    this.chargeGroup.visible = this.mode === 'charge' && this.charge === 'charging';
    this.driveGroup.visible = this.mode === 'drive';
    this.healthGroup.visible = this.mode === 'health';
    this.caption.textContent = {
      vehicle: 'MIDNIGHT PROVING GROUND · LIVE VEHICLE',
      charge: this.charge === 'charging' ? 'CHARGE PORT · ACTIVE ENERGY PATH' : 'CHARGE PORT · IDLE',
      drive: 'TRI-MOTOR · SIGNAL-BASED SCHEMATIC',
      health: 'TYRE PRESSURE · LIVE ANCHORS',
      trips: 'TRIP CONTEXT · ROUTE VIEW',
      insights: 'VEHICLE INTELLIGENCE · ANALYSIS VIEW',
    }[this.mode];
    this.caption.dataset.state = this.charge === 'charging' ? 'active' : 'idle';
    const warnings = this.tireWarningState();
    for (const key of Object.keys(this.healthMaterials)) {
      const { warn } = this.tireState(key, warnings);
      this.healthMaterials[key].color.setHex(warn ? 0xff824f : 0x63b9ae);
      this.healthMaterials[key].opacity = warn ? 0.98 : 0.68;
    }
  }

  tireWarningState() {
    const tires = new Set((this.data.leaks || []).filter((tire) => typeof tire === 'string').map((tire) => tire.toUpperCase()));
    const map = { front_left: 'FL', front_right: 'FR', rear_left: 'RL', rear_right: 'RR' };
    let unknown = false;
    for (const field of ['TpmsSoftWarnings', 'TpmsHardWarnings']) {
      const value = this.data.signals[field]?.value;
      if (value === true) {
        unknown = true;
      } else if (value && typeof value === 'object') {
        for (const [location, on] of Object.entries(value)) {
          if (on !== true) continue;
          const upper = location.toUpperCase();
          const tire = map[location.toLowerCase()] || (['FL', 'FR', 'RL', 'RR'].includes(upper) ? upper : null);
          if (tire) tires.add(tire);
          else unknown = true;
        }
      }
    }
    return { tires, unknown };
  }

  tireState(key, warnings = this.tireWarningState()) {
    const tire = key.toUpperCase();
    const pressure = psi(this.data.signals[`TpmsPressure${key}`]?.value);
    const target = this.data.targetPsi;
    const belowTarget = typeof target === 'number' && Number.isFinite(target) && pressure != null && pressure < target - 3;
    return { tire, pressure, warn: warnings.tires.has(tire) || belowTarget };
  }

  setView(view) {
    const preset = VIEWS[view];
    if (!preset) return;
    this.touched = Date.now();
    this.vel = 0;
    this.goalAz = this.nearest(preset[0]);
    this.goalEl = preset[1];
    this.goalTarget.set(this.target.x, preset[2], this.target.z);
    this.updateFit(this.goalEl, this.goalTarget);
    this.controls.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    this.frame();
  }

  manualOrbit(preserveAngles = false) {
    this.touched = Date.now();
    this.hint.hidden = true;
    // Direct manipulation owns the camera until another explicit mode/view choice.
    // Keyboard repeats preserve their angle goals so each press adds to queued intent.
    if (!preserveAngles) {
      this.goalAz = this.az;
      this.goalEl = this.el_;
    }
    this.goalTarget.copy(this.target);
    this.goalDist = this.dist;
    this.controls.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
  }

  bindInput() {
    let last = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.interacting = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.vel = 0;
      this.goalAz = this.az;
      this.goalEl = this.el_;
      this.manualOrbit();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last.x;
      const now = performance.now();
      this.az += dx * 0.009;
      this.goalAz = this.az;
      if (e.pointerType === 'mouse') this.el_ = Math.max(0.04, Math.min(1.18, this.el_ + (e.clientY - last.y) * 0.005));
      this.goalEl = this.el_;
      this.vel = this.reducedMotion.matches ? 0 : (dx * 0.009) / Math.max(now - last.t, 8) * 16;
      last = { x: e.clientX, y: e.clientY, t: now };
      this.touched = Date.now();
      this.frame();
    });
    const end = () => {
      last = null;
      this.interacting = false;
      if (this.pendingCamera) this.applyCamera(this.pendingCamera);
      else this.updateFit(this.goalEl, this.goalTarget);
      this.frame();
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('lostpointercapture', end);
    this.canvas.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'Home') { this.setView('studio'); return; }
      this.vel = 0;
      this.manualOrbit(true);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.goalAz += e.key === 'ArrowLeft' ? -0.2 : 0.2;
      else {
        this.goalEl = Math.max(0.04, Math.min(1.18, this.goalEl + (e.key === 'ArrowUp' ? 0.04 : -0.04)));
        this.updateFit(this.goalEl, this.goalTarget);
      }
      this.frame();
    });
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.viewport;
    if (w && h && (w !== this.viewportWidth || h !== this.viewportHeight)) {
      this.viewportWidth = w;
      this.viewportHeight = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.updateFit(this.goalEl, this.goalTarget);
      if (!this.dist) this.dist = this.goalDist;
    }
    // Reparenting the persistent stage can notify ResizeObserver without a size change.
    // It still needs one draw in its new slot, but setSize would clear a valid drawing buffer.
    this.frame();
  }

  updateFit(el = this.el_, target = this.target) {
    if (!this.camera.aspect || !this.viewport.clientWidth) return;
    // Fit against the active elevation. This keeps the silhouette cinematic while avoiding
    // roof/ground cropping when a mode or the top preset changes elevation.
    const corners = [];
    for (const x of [X_REAR, X_FRONT]) for (const y of [0, 1.45]) for (const z of [-1.0, 1.0]) corners.push(new THREE.Vector3(x, y, z));
    let worst = 0;
    const d0 = 10;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      this.place(a, d0, el, target);
      this.camera.updateMatrixWorld();
      for (const c of corners) {
        const p = c.clone().project(this.camera);
        worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
      }
    }
    this.goalDist = d0 * (worst / 0.86);
  }

  place(az, d, el = this.el_, target = this.target) {
    const c = this.camera;
    c.position.set(target.x + d * Math.cos(el) * Math.cos(az), target.y + d * Math.sin(el), target.z + d * Math.cos(el) * Math.sin(az));
    c.lookAt(target);
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
    const chargeState = cs.replace(/^DetailedChargeState/, '');
    this.charge = chargeState === 'Charging' ? 'charging' : chargeState === 'Disconnected' || !chargeState ? (v('ChargePortDoorOpen') ? 'open' : 'off') : 'plugged';
    this.setMode(data.mode);
    this.updateModeGraphics();
    // Turn to what changed unless someone turned the car by hand in the last 20 s.
    const focus = this.focus();
    if (focus !== this.lastFocus) {
      this.lastFocus = focus;
      if (this.mode === 'vehicle' && focus != null && Date.now() - this.touched > 20_000) {
        this.goalAz = this.nearest(focus);
        this.controls.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
      }
    }
    const aria = [`Model S, ${PAINTS[this.paintKey]?.name || ''}, registration DEVIL`, `${this.mode} view`];
    const open = PARTS.filter((k) => k !== 'ChargePort' && this.parts[k].goal);
    aria.push(open.length ? `open: ${open.join(', ')}` : 'all doors closed');
    if (this.charge !== 'off') aria.push(`charge port ${this.charge}`);
    if (this.mode === 'drive') aria.push('tri-motor telemetry shown at schematic anchors');
    if (this.mode === 'charge' && this.charge === 'charging') aria.push('energy path follows the charge-port anchor');
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
    const warnings = this.tireWarningState();
    const items = [];
    for (const k of ['Fl', 'Fr', 'Rl', 'Rr']) {
      const { tire, pressure: p, warn } = this.tireState(k, warnings);
      if (!warn && !['vehicle', 'health'].includes(this.mode)) continue;
      const html = this.mode === 'health' ? `<b>${tire}</b> &middot; ${num(p)} psi` : `<b>${num(p)}</b> psi`;
      items.push({ pos: this.wheelPos[k], html, cls: `tire${warn ? ' warn' : ''}`, label: `${tire} tyre ${num(p)} psi${warn ? ', warning' : ''}; open tyre health`, href: '#/health/tires', always: warn });
    }
    if (warnings.unknown) items.push({ pos: new THREE.Vector3(0, 1.65, 0), html: '<b>TPMS warning</b> &middot; wheel unspecified', cls: 'tire warn tpms-generic', label: 'TPMS warning, wheel unspecified; open tyre health', href: '#/health/tires', always: true });
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
    const showCharge = this.mode === 'charge' || (this.mode === 'vehicle' && this.charge !== 'off') || this.charge === 'open';
    if (showCharge) {
      items.push({
        pos: this.portPos,
        html: { charging: 'Charging &middot; energy path', plugged: 'Plugged in', open: 'Port open', off: 'Not charging' }[this.charge],
        cls: `port energy ${this.charge}`,
        label: `${this.charge === 'charging' ? 'Charging energy path' : 'Charge port'}; open charge`,
        href: '#/charge',
      });
    }
    if (this.mode === 'drive') {
      const motors = [
        ['DiTorqueActualF', 'Front', [0, -30]],
        ['DiTorqueActualREL', 'Rear left', [-70, 22]],
        ['DiTorqueActualRER', 'Rear right', [70, 62]],
      ];
      const values = motors.map(([field]) => {
        const value = v(field);
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
      });
      const complete = values.every((value) => value != null);
      const total = complete ? values.reduce((sum, value) => sum + Math.abs(value), 0) : 0;
      motors.forEach(([field, label, screenOffset], index) => {
        const value = values[index];
        const share = total && value != null ? `${Math.round((Math.abs(value) / total) * 100)}% share` : 'share unavailable';
        items.push({ pos: this.drivePos[field], screenOffset, html: `<b>${label}</b> &middot; ${share}`, cls: 'drive schematic', label: `${label} drive unit, ${share}; schematic anchor; open drive`, href: '#/drive', always: true });
      });
    }
    const html = items.map((it) => {
      const attrs = `${it.label ? ` aria-label="${esc(it.label)}"` : ''}${it.href ? ` href="${it.href}"` : ''}`;
      return it.href
        ? `<a class="car3d-tag car3d-tag-link ${it.cls}"${attrs}>${it.html}</a>`
        : `<span class="car3d-tag ${it.cls}"${attrs}>${it.html}</span>`;
    }).join('');
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
    if (this.reducedMotion.matches) {
      this.az = this.goalAz;
      this.el_ = this.goalEl;
      this.target.copy(this.goalTarget);
      this.dist = this.goalDist || this.dist;
      [this.key.intensity, this.rim.intensity, this.warm.intensity] = this.goalLights;
      this.renderer.toneMappingExposure = this.goalExposure;
      this.vel = 0;
    } else if (Math.abs(this.vel) > 0.0005 && Date.now() - this.touched < 2000) {
      this.az += this.vel;
      this.vel *= 0.92;
      this.goalAz = this.az;
      moving = true;
    } else if (Math.abs(this.goalAz - this.az) > 0.002) {
      this.az += (this.goalAz - this.az) * 0.08;
      moving = true;
    }
    if (Math.abs(this.goalEl - this.el_) > 0.0005) {
      this.el_ += (this.goalEl - this.el_) * 0.08;
      moving = true;
    }
    if (!this.reducedMotion.matches) {
      if (this.target.distanceToSquared(this.goalTarget) > 0.000001) {
        this.target.lerp(this.goalTarget, 0.08);
        moving = true;
      }
      if (this.goalDist && Math.abs(this.goalDist - this.dist) > 0.001) {
        this.dist += (this.goalDist - this.dist) * 0.08;
        moving = true;
      }
      [this.key, this.rim, this.warm].forEach((light, index) => {
        const goal = this.goalLights[index];
        if (Math.abs(goal - light.intensity) > 0.001) {
          light.intensity += (goal - light.intensity) * 0.08;
          moving = true;
        }
      });
      if (Math.abs(this.goalExposure - this.renderer.toneMappingExposure) > 0.0005) {
        this.renderer.toneMappingExposure += (this.goalExposure - this.renderer.toneMappingExposure) * 0.08;
        moving = true;
      }
    }
    const c = this.camera;
    this.place(this.az, this.dist);
    this.renderer.render(this.scene, c);
    // Tags follow their 3D anchor; ones on the far side of the car fade.
    const w = this.viewport.clientWidth;
    const h = this.viewport.clientHeight;
    const camDir = new THREE.Vector3().subVectors(c.position, this.target).setY(0).normalize();
    const driveBoxes = [];
    const clamp = (value, size, limit) => {
      const half = Math.min(size / 2, Math.max(0, limit / 2 - 8));
      return Math.max(8 + half, Math.min(limit - 8 - half, value));
    };
    [...this.labels.children].forEach((el, i) => {
      const it = this.items[i];
      if (!it) return;
      const p = it.pos.clone().project(c);
      const [dx = 0, dy = 0] = it.screenOffset || [];
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      let x = clamp(((p.x + 1) / 2) * w + dx, width, w);
      let y = clamp(((1 - p.y) / 2) * h + dy, height, h);
      if (it.cls.includes('drive')) {
        const overlaps = (cy) => driveBoxes.some((box) => x + width / 2 > box.left && x - width / 2 < box.right && cy + height / 2 > box.top && cy - height / 2 < box.bottom);
        if (overlaps(y)) {
          const gap = height + 8;
          const candidates = [clamp(y + gap, height, h), clamp(y - gap, height, h)];
          y = candidates.find((candidate) => !overlaps(candidate)) ?? y;
        }
        driveBoxes.push({ left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 });
      }
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      // Tyre tags show for the side of the car facing the camera (or the end, when seen head-on).
      const far = it.always ? false : it.cls.startsWith('tire')
        ? (Math.abs(camDir.z) > 0.3 ? it.pos.z * camDir.z < 0 : it.pos.x * camDir.x < 0)
        : new THREE.Vector3(it.pos.x, 0, it.pos.z).normalize().dot(camDir) < -0.1;
      el.classList.toggle('far', far);
      if (it.href) {
        el.tabIndex = far ? -1 : 0;
        el.style.pointerEvents = far ? 'none' : 'auto';
        el.setAttribute('aria-hidden', String(far));
      }
    });
    if (moving) this.frame();
  }
}
