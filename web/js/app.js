// App shell: data loading, live stream, routing, commands.
import { esc, icon, prefs } from './ui.js';
import { state, api, toast, actions, setRender } from './core.js';
import { homeView } from './views/home.js';
import { chargeView } from './views/charge.js';
import { tripsView, tripView } from './views/trips.js';
import { batteryView, tiresView } from './views/health.js';
import { driveView } from './views/drive.js';
import { carParkedView, carDrivingView } from './views/car.js';
import { setupView, loginView } from './views/setup.js';
import { releaseNotesView, alertsView } from './views/log.js';
import { signalSheet, sheetSignal } from './views/signal.js';

const root = document.getElementById('app');
const dock = document.getElementById('dock');

async function runCommand(btn) {
  const name = btn.dataset.cmd;
  const args = btn.dataset.args ? JSON.parse(btn.dataset.args) : {};
  if (btn.dataset.confirm && !window.confirm(btn.dataset.confirm)) return;
  btn.setAttribute('aria-busy', 'true');
  try {
    const r = await api(`/api/command/${name}`, { method: 'POST', body: { args } });
    toast(`${btn.dataset.label || name} sent${r.via ? ` · ${r.via.toUpperCase()}` : ''}`);
  } catch (err) {
    toast(`${btn.dataset.label || name} failed: ${err.message}`, true);
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

const isWide = () => window.innerWidth >= 1000 || new URLSearchParams(location.search).get('view') === 'car';
const driving = () => {
  const g = state.signals.Gear?.value;
  return g === 'ShiftStateD' || g === 'ShiftStateR' || g === 'ShiftStateN';
};

const TABS = [
  ['#/', 'car', 'Car'],
  ['#/charge', 'bolt', 'Charge'],
  ['#/trips', 'route', 'Trips'],
  ['#/health', 'pulse', 'Health'],
  ['#/drive', 'gauge', 'Drive'],
];

function route() {
  const h = location.hash || '#/';
  const [, path = '', id] = h.match(/^#\/([a-z]*)(?:\/(.+))?/) || [];
  return { path, id };
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(async () => {
    renderQueued = false;
    document.body.classList.toggle('hide-src', !prefs.sources);
    if (state.needLogin) {
      document.body.classList.remove('wide');
      dock.hidden = true;
      root.innerHTML = loginView();
      return;
    }
    if (!state.meta) return;
    const { path, id } = route();
    const wide = isWide();
    document.body.classList.toggle('wide', wide);
    dock.hidden = wide;
    let html;
    try {
      if (wide && path === '') html = driving() ? carDrivingView(state) : await carParkedView(state);
      else if (path === '') html = homeView(state);
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
    if (wide && path !== '') html = `<div class="car-nav"><a href="#/">← Dashboard</a></div>${html}`;
    if (state.sheet) html += signalSheet(state);
    document.body.classList.toggle('sheet-open', Boolean(state.sheet));
    // Live renders replace the DOM; keep keyboard focus on the same control inside the sheet.
    const focusKey = document.activeElement?.dataset?.fk;
    const sheetScroll = root.querySelector('.sheet')?.scrollTop || 0;
    const scroll = window.scrollY;
    root.innerHTML = html;
    window.scrollTo(0, scroll);
    const sheet = root.querySelector('.sheet');
    if (sheet) {
      sheet.scrollTop = sheetScroll;
      (root.querySelector(`[data-fk="${focusKey}"]`) || (focusKey ? null : sheet.querySelector('.sheet-x')))?.focus({ preventScroll: true });
    }
    const active = path || '';
    dock.innerHTML = TABS.map(([href, ic, label]) => {
      const on = (href === '#/' && active === '') || (href !== '#/' && href.slice(2) === active);
      return `<a class="tab${on ? ' on' : ''}" href="${href}"${on ? ' aria-current="page"' : ''}>${icon(ic, 20)}${label}</a>`;
    }).join('');
  });
}

root.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cmd]');
  if (btn) { e.preventDefault(); runCommand(btn); return; }
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
