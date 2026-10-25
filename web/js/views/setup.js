// Setup: connection status, Tesla account link, telemetry config, notifications, display prefs.
import { actions, api, load, render, state, toast } from '../core.js';
import { ago, esc, prefs } from '../ui.js';

export function loginView() {
  return `<form id="login" class="pn" style="margin-top:20vh;gap:14px">
    <div class="k">Model S Plaid</div>
    <div style="font-size:22px;font-weight:700">Enter your passcode</div>
    <label>Passcode<input name="passcode" type="password" autocomplete="current-password" required></label>
    <button class="bigbtn" type="submit">Unlock dashboard</button>
  </form>`;
}

const yes = (ok, text) => `<span class="mono" style="color:${ok ? 'var(--green)' : 'var(--amber)'}">${ok ? '●' : '○'} ${esc(text)}</span>`;

export async function setupView(state_) {
  const m = state_.meta;
  const push = await load('pushkey', '/api/push/key', 30_000);
  const tc = m.tesla_linked ? await load('tcfg', '/api/tesla/telemetry-config', 60_000).catch((e) => ({ error: e.message })) : null;
  const hist = await load('hist', '/api/tesla/cache?what=charging_history', 60_000).catch(() => null);
  const b = m.bridge;
  return `
    <div class="head"><div class="stack" style="gap:6px"><a class="k" href="#/">← Car</a><h1>Setup</h1></div></div>
    <div class="pn">
      <div class="k">Connections</div>
      <div class="list-row"><span>Data</span>${m.sample_mode ? yes(false, 'Sample mode (simulated)') : yes(Boolean(m.telemetry?.status === 'CONNECTED'), `Fleet Telemetry ${m.telemetry?.status || 'no connection event yet'}`)}</div>
      <div class="list-row"><span>Tesla account</span>${yes(m.tesla_linked, m.tesla_linked ? 'Linked' : m.tesla_configured ? 'Not linked' : 'Client ID/secret not set')}</div>
      <div class="list-row"><span>Garage Pi</span>${yes(b.online, b.online ? (b.car_in_range ? 'Online · car in range' : 'Online · car not in range') : b.last_seen ? `Last seen ${ago(b.last_seen)}` : 'Never connected')}</div>
      <div class="list-row"><span>Notifications</span>${yes(push.enabled, push.enabled ? `${push.subscriptions} device(s)` : 'VAPID keys not set')}</div>
      ${m.tesla_configured && !m.tesla_linked ? '<a class="bigbtn" href="/auth/login">Link Tesla account</a>' : ''}
    </div>
    <div class="pn">
      <div class="k">Notifications on this device</div>
      <div class="t">On iPhone, add this app to your Home Screen first (Share → Add to Home Screen); Safari only allows web push for Home Screen apps on iOS 16.4 and later.</div>
      <div class="row" style="gap:12px"><button class="bigbtn" data-action="push-enable" type="button">Enable alerts</button><button class="bigbtn ghost" data-action="push-test" type="button">Send test</button></div>
    </div>
    <div class="pn">
      <div class="k">Display</div>
      <label class="check"><input type="checkbox" data-action="toggle-sources" ${prefs.sources ? 'checked' : ''}> Show data-source chips</label>
      <label class="check"><input type="checkbox" data-action="toggle-maps" ${prefs.maps ? 'checked' : ''}> Map tiles behind trip routes</label>
      <div class="t">Tiles come from OpenStreetMap, so their servers see the area of each route you open. Off draws routes on the bare grid.</div>
      <label>Temperature<select data-action="temp-unit"><option value="F" ${prefs.temp === 'F' ? 'selected' : ''}>°F</option><option value="C" ${prefs.temp === 'C' ? 'selected' : ''}>°C</option></select></label>
    </div>
    ${m.tesla_linked ? `<div class="pn">
      <div class="k">Fleet Telemetry config</div>
      <div class="t">Sends the field list (with intervals) through tesla-http-proxy, which signs it with your virtual key. Afterwards wait for <span class="mono">synced: true</span>.</div>
      <button class="bigbtn" data-action="telemetry-apply" type="button">Send config to car</button>
      <pre>${esc(JSON.stringify(tc?.current ?? tc?.error ?? null, null, 2))}</pre>
      <details><summary class="k">Proposed config</summary><pre>${esc(JSON.stringify(tc?.proposed, null, 2))}</pre></details>
    </div>
    <div class="pn">
      <div class="k">Tesla charging_history (raw)</div>
      <div class="t">Tesla doesn't publish this response's format, so it's shown as received. Supercharger costs are read from it using the field names community clients report; if the Charging tab says records weren't read, this raw view shows what Tesla actually sent.</div>
      <button class="bigbtn ghost" data-action="refresh-history" type="button">Fetch now</button>
      <pre>${esc(hist ? JSON.stringify(hist, null, 2).slice(0, 4000) : 'Not fetched yet')}</pre>
    </div>` : ''}`;
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

Object.assign(actions, {
  'push-enable': async () => {
    try {
      const { publicKey, enabled } = await api('/api/push/key');
      if (!enabled) return toast('Server has no VAPID keys yet (npm run vapid).', true);
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('This browser has no web push. On iPhone, open the Home Screen app.', true);
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('Notifications were not allowed.', true);
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
      delete state.cache.pushkey;
      toast('Alerts enabled on this device');
      render();
    } catch (err) { toast(err.message, true); }
  },
  'push-test': async () => {
    try { const r = await api('/api/push/test', { method: 'POST' }); toast(r.skipped || `Sent to ${r.sent} device(s)`); } catch (err) { toast(err.message, true); }
  },
  'toggle-sources': (el) => { prefs.sources = el.checked; render(); },
  'toggle-maps': (el) => { prefs.maps = el.checked; render(); },
  'temp-unit': (el) => { prefs.temp = el.value; render(); },
  'telemetry-apply': async () => {
    try { await api('/api/tesla/telemetry-config', { method: 'POST' }); toast('Config sent. Check below for synced: true.'); delete state.cache.tcfg; render(); } catch (err) { toast(err.message, true); }
  },
  'refresh-history': async () => {
    try { await api('/api/tesla/refresh?what=charging_history', { method: 'POST' }); delete state.cache.hist; render(); } catch (err) { toast(err.message, true); }
  },
});
