// App shell: data loading, live stream, routing.
import { esc, prefs } from './ui.js';
import { state, api, toast, actions, setRender } from './core.js';
import { homeView } from './views/home.js';
import { chargeView } from './views/charge.js';
import { tripsView, tripView } from './views/trips.js';
import { batteryView, tiresView } from './views/health.js';
import { driveView } from './views/drive.js';
import { carDrivingView } from './views/car.js';
import { setupView, loginView } from './views/setup.js';
import { releaseNotesView, alertsView } from './views/log.js';
import { signalSheet, sheetSignal } from './views/signal.js';
import { mountCar3d } from './car3d.js';
import { overviewGraphics } from './views/overview.js';
import { chapterFor, chapterLinks, experienceView } from './experience.js';

const root = document.getElementById('app');
const dock = document.getElementById('dock');
actions['chapter-data'] = () => root.querySelector('#chapter-data')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });

const isWide = () => window.innerWidth >= 1000 || new URLSearchParams(location.search).get('view') === 'car';
const driving = () => {
  const g = state.signals.Gear?.value;
  return g === 'ShiftStateD' || g === 'ShiftStateR' || g === 'ShiftStateN';
};

function route() {
  const h = location.hash || '#/';
  const [, path = '', id] = h.match(/^#\/([a-z]*)(?:\/(.+))?/) || [];
  return { path, id };
}

let renderQueued = false;
let renderGeneration = 0;
let previousChapter = null;
function render() {
  ++renderGeneration;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(async () => {
    renderQueued = false;
    const generation = renderGeneration;
    document.body.classList.toggle('hide-src', !prefs.sources);
    if (state.needLogin) {
      document.body.classList.remove('wide');
      document.body.classList.remove('immersive', 'glance-mode');
      dock.hidden = true;
      root.innerHTML = loginView();
      return;
    }
    if (!state.meta) return;
    const { path, id } = route();
    const wide = isWide();
    const glance = wide && path === '' && driving();
    document.body.classList.toggle('wide', wide);
    document.body.classList.add('immersive');
    document.body.classList.toggle('glance-mode', glance);
    dock.hidden = wide || glance;
    let html;
    try {
      if (glance) html = carDrivingView(state);
      else if (path === '') html = homeView(state);
      else if (path === 'insights') html = overviewGraphics(state);
      else if (path === 'charge') html = await chargeView(state);
      else if (path === 'trips') html = id ? await tripView(state, id) : await tripsView(state);
      else if (path === 'health') html = id === 'tires' ? await tiresView(state) : await batteryView(state);
      else if (path === 'drive') html = await driveView(state);
      else if (path === 'setup') html = await setupView(state);
      else if (path === 'updates') html = await releaseNotesView(state);
      else if (path === 'alerts') html = await alertsView(state);
      else html = homeView(state);
    } catch (err) {
      if (err.message === 'login required') return;
      html = `<div class="pn"><div class="k">Error</div><div>${esc(err.message)}</div></div>`;
    }
    // A slower fetch from the previous route must never overwrite the new chapter.
    if (generation !== renderGeneration) return;
    if (!glance) html = experienceView(html, state, path);
    if (state.sheet) html += signalSheet(state);
    document.body.classList.toggle('sheet-open', Boolean(state.sheet));
    // Live renders replace the DOM; preserve focus in signal sheets and the vehicle studio.
    const focusKey = document.activeElement?.dataset?.fk;
    const sheetScroll = root.querySelector('.sheet')?.scrollTop || 0;
    const scroll = window.scrollY;
    root.innerHTML = html;
    mountCar3d(root, { signals: state.signals, leaks: (state.cache.tires?.data?.leaks || []).map((l) => l.tire), paint: prefs.paint, targetPsi: state.meta.tire_target_psi, mode: chapterFor(path)?.mode || 'vehicle' });
    if (previousChapter !== path) {
      previousChapter = path;
      document.title = `Plaid / ${chapterFor(path)?.label || ({ setup: 'Setup', alerts: 'Alerts', updates: 'Software' }[path] || 'Vehicle')}`;
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) root.querySelector('.world-heading, .aux-heading')?.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, easing: 'ease-out' });
    }
    window.scrollTo(0, scroll);
    const sheet = root.querySelector('.sheet');
    if (sheet) {
      sheet.scrollTop = sheetScroll;
      (root.querySelector(`[data-fk="${focusKey}"]`) || (focusKey ? null : sheet.querySelector('.sheet-x')))?.focus({ preventScroll: true });
    } else if (focusKey) root.querySelector(`[data-fk="${focusKey}"]`)?.focus({ preventScroll: true });
    if (dock.dataset.chapter !== path) {
      dock.innerHTML = chapterLinks(path, true);
      dock.dataset.chapter = path;
    }
  });
}

root.addEventListener('click', (e) => {
  const act = e.target.closest('[data-action]');
  if (act && !['INPUT', 'SELECT'].includes(act.tagName)) { e.preventDefault(); actions[act.dataset.action]?.(act); }
});
root.addEventListener('keydown', (e) => {
  const el = e.target.closest('[role="button"][data-action]');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); actions[el.dataset.action]?.(el); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sheet) actions['sig-close']();
});
root.addEventListener('change', (e) => {
  const act = e.target.closest('[data-action]');
  if (act) actions[act.dataset.action]?.(act);
});
root.addEventListener('submit', async (e) => {
  if (e.target.id !== 'login') return;
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { passcode: new FormData(e.target).get('passcode') } });
    state.needLogin = false;
    await boot();
  } catch (err) {
    toast(err.message, true);
  }
});

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('signal', (e) => {
    const s = JSON.parse(e.data);
    state.signals[s.field] = { value: s.value, ts: s.ts, source: s.source };
    state.feed.unshift(s);
    state.feed.length = Math.min(state.feed.length, 40);
    sheetSignal(s);
    state.live = Date.now();
    throttledRender();
  });
  es.addEventListener('event', (e) => {
    const ev = JSON.parse(e.data);
    state.events.unshift(ev);
    toast(ev.title);
  });
  es.addEventListener('connectivity', (e) => { state.meta.telemetry = JSON.parse(e.data); });
  es.onerror = () => { state.live = 0; };
}

let last = 0;
let timer = null;
function throttledRender() {
  const wait = 1000 - (Date.now() - last);
  if (wait <= 0) { last = Date.now(); render(); return; }
  clearTimeout(timer);
  timer = setTimeout(() => { last = Date.now(); render(); }, wait);
}

async function boot() {
  const s = await api('/api/session');
  if (s.required && !s.authed) { state.needLogin = true; render(); return; }
  const st = await api('/api/state');
  Object.assign(state, { meta: st.meta, signals: st.signals, trip: st.trip, charge: st.charge });
  state.events = await api('/api/events').catch(() => []);
  connectStream();
  render();
  setInterval(async () => {
    const fresh = await api('/api/state').catch(() => null);
    if (fresh) Object.assign(state, { meta: fresh.meta, trip: fresh.trip, charge: fresh.charge });
    state.cache = {};
    render();
  }, 60_000);
}

setRender(render);
window.addEventListener('hashchange', () => { state.sheet = null; window.scrollTo(0, 0); render(); });
window.addEventListener('resize', render);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot().catch((err) => { if (err.message !== 'login required') root.innerHTML = `<div class="pn">Could not reach the server: ${esc(err.message)}</div>`; });
