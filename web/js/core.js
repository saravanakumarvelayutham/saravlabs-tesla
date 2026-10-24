// Shared client state and API helpers (kept apart from app.js so views can import them without a cycle).
let renderFn = () => {};
export const setRender = (fn) => { renderFn = fn; };
export const render = () => renderFn();
export const actions = {};

export const state = { meta: null, signals: {}, trip: null, charge: null, feed: [], cache: {}, events: [], sheet: null };

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/api/login')) {
    state.needLogin = true;
    render();
    throw new Error('login required');
  }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(json?.error || `HTTP ${res.status}`), { detail: json?.detail });
  return json;
}

// Cached fetch for view data; refreshed when older than maxAge.
export async function load(key, path, maxAge = 60_000) {
  const hit = state.cache[key];
  if (hit && Date.now() - hit.ts < maxAge) return hit.data;
  const data = await api(path);
  state.cache[key] = { ts: Date.now(), data };
  return data;
}
export const cached = (key) => state.cache[key]?.data;

export function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}


// For synchronous views: returns cached data now and fetches in the background when missing or stale.
const inflight = new Set();
export function useData(key, path, maxAge = 60_000) {
  const hit = state.cache[key];
  if ((!hit || Date.now() - hit.ts > maxAge) && !inflight.has(key)) {
    inflight.add(key);
    load(key, path, maxAge).then(render, () => {}).finally(() => inflight.delete(key));
  }
  return hit?.data ?? null;
}

export const sig = (f) => state.signals[f]?.value ?? null;
export const isDriving = () => ['ShiftStateD', 'ShiftStateR', 'ShiftStateN'].includes(sig('Gear'));
