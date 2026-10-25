// Drives the running e2e stack (started by run.sh) and checks every hop. Each check records
// what it saw, so the report is the evidence. Exits 1 if any check fails.
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { SIGNALS } from '../../server/signals.js';

const APP = 'http://127.0.0.1:18080';
const FAKES = 'http://127.0.0.1:18099';
const VIN = process.env.VIN;
const WORK = process.env.E2E_WORK;
const RESULTS = process.env.E2E_RESULTS;
const COMPOSE = process.env.E2E_COMPOSE.split(' ');
const CERTS = path.join(WORK, 'e2e-certs');
const env = Object.fromEntries(fs.readFileSync(path.join(WORK, '.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
async function check(group, name, fn) {
  const t0 = Date.now();
  try {
    const evidence = await fn();
    checks.push({ group, name, ok: true, evidence, ms: Date.now() - t0 });
    console.log(`PASS  ${group} · ${name}`);
  } catch (err) {
    checks.push({ group, name, ok: false, evidence: err.evidence ?? null, error: err.message, ms: Date.now() - t0 });
    console.log(`FAIL  ${group} · ${name}: ${err.message}`);
  }
}
function expect(cond, msg, evidence) {
  if (!cond) throw Object.assign(new Error(msg), { evidence });
}

let cookie = '';
async function api(p, opts = {}) {
  const res = await fetch(APP + p, {
    method: opts.method || 'GET',
    redirect: 'manual',
    headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, json, text };
}
const fakesLog = async () => (await fetch(`${FAKES}/log`)).json();
const compose = (...args) => spawnSync(COMPOSE[0], [...COMPOSE.slice(1), ...args], { encoding: 'utf8' });

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err.message; }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

// ---------- 1. Stack up ----------
await check('stack', 'app answers /healthz', () => waitFor(async () => (await api('/healthz')).json?.ok && 'ok', 90_000, 'app'));
await check('stack', 'fake Tesla/push endpoints up', () => waitFor(async () => (await fetch(`${FAKES}/subscription`)).ok && 'ok', 30_000, 'fakes'));
await check('stack', 'app connected to mosquitto', () => waitFor(async () => {
  const logs = compose('logs', '--no-color', 'app').stdout;
  return logs.match(/\[mqtt\] connected to .*/)?.[0];
}, 30_000, 'mqtt connect log line'));
await check('stack', 'fleet-telemetry started with the production config (+ test car CA)', () => waitFor(async () => {
  const logs = compose('logs', '--no-color', 'fleet-telemetry').stdout;
  const lines = logs.split('\n').filter((l) => /custom_ca_file_appened|mqtt|starting|server/i.test(l)).slice(0, 6);
  return logs.includes('custom_ca_file_appened') && lines;
}, 30_000, 'fleet-telemetry startup log'));

// ---------- 2. Login ----------
await check('app', 'wrong passcode is refused', async () => {
  const r = await api('/api/login', { method: 'POST', body: { passcode: 'nope' } });
  expect(r.status === 401, `status ${r.status}`, r.json);
  const s = await api('/api/state');
  expect(s.status === 401, `/api/state without session gave ${s.status}`);
  return { login: r.status, state_without_cookie: s.status };
});
await check('app', 'passcode login sets a session cookie', async () => {
  const r = await api('/api/login', { method: 'POST', body: { passcode: env.APP_PASSCODE } });
  expect(r.status === 200, `status ${r.status}`, r.json);
  cookie = r.headers.get('set-cookie').split(';')[0];
  const s = await api('/api/session');
  expect(s.json?.authed === true, 'not authed', s.json);
  return { set_cookie: r.headers.get('set-cookie').replace(/=[^;]+/, '=<redacted>'), session: s.json };
});

// ---------- 3. Tesla account link (OAuth code exchange) ----------
await check('tesla', 'OAuth login redirects to auth.tesla.com with the right parameters', async () => {
  const r = await api('/auth/login');
  const loc = new URL(r.headers.get('location'));
  expect(r.status === 302 && loc.origin === 'https://auth.tesla.com', `status ${r.status} → ${loc}`);
  const q = Object.fromEntries(loc.searchParams);
  expect(q.client_id === env.TESLA_CLIENT_ID && q.redirect_uri === env.TESLA_REDIRECT_URI && q.state, 'bad params', q);
  globalThis.oauthState = q.state;
  return { location: `${loc.origin}${loc.pathname}`, params: { ...q, state: '<random>' } };
});
await check('tesla', 'callback exchanges the code at fleet-auth and links the account', async () => {
  const bad = await api(`/auth/callback?code=e2e-code&state=wrong`);
  expect(bad.status === 400, `wrong state gave ${bad.status}`);
  const r = await api(`/auth/callback?code=e2e-code&state=${globalThis.oauthState}`);
  expect(r.status === 302 && r.headers.get('location') === '/#/setup', `status ${r.status}`, r.text);
  const st = await api('/api/tesla/status');
  expect(st.json?.linked === true, 'not linked', st.json);
  const tok = (await fakesLog()).filter((e) => e.kind === 'token');
  const t = tok.at(-1);
  expect(t.grant_type === 'authorization_code' && t.client_id === env.TESLA_CLIENT_ID && t.has_secret && t.audience === env.TESLA_AUDIENCE && t.redirect_uri === env.TESLA_REDIRECT_URI, 'token request params', t);
  return { wrong_state: bad.status, status: st.json, token_request_seen_by_fake_tesla: t };
});

// ---------- 4. Virtual key: public key endpoint + partner registration script ----------
await check('tesla', 'public key served at /.well-known and matches the proxy key', async () => {
  const r = await fetch(`${APP}/.well-known/appspecific/com.tesla.3p.public-key.pem`);
  const served = (await r.text()).trim();
  const file = fs.readFileSync(path.join(WORK, 'deploy/config/proxy/fleet-key-public.pem'), 'utf8').trim();
  expect(r.status === 200 && served === file, `status ${r.status}`, served);
  return { status: r.status, content_type: r.headers.get('content-type'), first_line: served.split('\n')[0] };
});
await check('tesla', 'scripts/register-partner.js gets a partner token and registers the domain', async () => {
  const r = compose('exec', '-T', 'app', 'node', 'scripts/register-partner.js', 'e2e.example.com');
  const log = await fakesLog();
  const reg = log.filter((e) => e.kind === 'partner_register').at(-1);
  const tok = log.filter((e) => e.kind === 'token' && e.grant_type === 'client_credentials').at(-1);
  const pub = fs.readFileSync(path.join(WORK, 'deploy/config/proxy/fleet-key-public.pem'), 'utf8').trim();
  expect(r.status === 0, `exit ${r.status}: ${r.stderr}`, r.stdout);
  expect(reg?.domain === 'e2e.example.com' && reg.served_key === pub, 'registration not seen or key mismatch', reg);
  return { exit: r.status, stdout: r.stdout.trim().split('\n').slice(-2), partner_token_request: tok, fake_tesla_fetched_public_key: reg.key_status };
});

// ---------- 5. Telemetry config: app -> tesla-http-proxy (TLS, pinned CA) -> signed JWS -> Fleet API ----------
let telemetryConfig;
await check('proxy', 'telemetry config goes through tesla-http-proxy over TLS and comes out signed', async () => {
  const r = await api('/api/tesla/telemetry-config', { method: 'POST' });
  expect(r.status === 200, `status ${r.status}`, r.json);
  const jws = (await fakesLog()).filter((e) => e.kind === 'telemetry_config_jws').at(-1);
  expect(jws, 'fake Fleet API never got fleet_telemetry_config_jws');
  telemetryConfig = await (await fetch(`${FAKES}/telemetry-config`)).json();
  const ca = fs.readFileSync(path.join(WORK, 'deploy/config/telemetry/ca.pem'), 'utf8');
  const pubDer = crypto.createPublicKey(fs.readFileSync(path.join(WORK, 'deploy/config/proxy/fleet-key-public.pem'))).export({ type: 'spki', format: 'der' });
  const pubRaw = pubDer.subarray(pubDer.length - 65); // uncompressed P-256 point
  const fields = Object.keys(telemetryConfig.fields);
  expect(jws.jws_header.alg === 'Tesla.SS256', `alg ${jws.jws_header.alg}`, jws);
  expect(telemetryConfig.iss === pubRaw.toString('base64'), 'iss is not our virtual public key', { iss: telemetryConfig.iss, ours: pubRaw.toString('base64') });
  expect(telemetryConfig.aud === 'com.tesla.fleet.TelemetryClient', `aud ${telemetryConfig.aud}`);
  expect(telemetryConfig.hostname === 'fleet-telemetry' && telemetryConfig.port === 443 && telemetryConfig.ca === ca, 'hostname/port/ca', { hostname: telemetryConfig.hostname, port: telemetryConfig.port });
  const streamed = Object.entries(SIGNALS).filter(([, sg]) => !sg.bleOnly).length; // BLE-only fields aren't in the config
  expect(fields.length === streamed, `field count ${fields.length} vs ${streamed}`);
  expect(JSON.stringify(jws.vins) === JSON.stringify([VIN]), 'vins', jws.vins);
  return { app_response: r.json, at_fake_fleet_api: { path: jws.path, vins: jws.vins, jws_header: jws.jws_header, aud: telemetryConfig.aud, iss_matches_virtual_key: true, hostname: telemetryConfig.hostname, port: telemetryConfig.port, ca_matches_file: true, fields: fields.length, alert_types: telemetryConfig.alert_types, signature_bytes: jws.signature_bytes } };
});
await check('proxy', 'reading the car\'s config back reports synced', async () => {
  const r = await api('/api/tesla/telemetry-config');
  expect(r.json?.current?.response?.synced === true, 'not synced', r.json?.current);
  return { synced: r.json.current.response.synced, errors: r.json.errors };
});
await check('proxy', 'charging history read goes through the proxy and is cached for the UI', async () => {
  const r = await api('/api/tesla/refresh?what=charging_history', { method: 'POST' });
  expect(r.status === 200 && r.json?.data?.response, `status ${r.status}`, r.json);
  const c = await api('/api/charging');
  // The record shape is the fake's guess (Tesla doesn't publish it); this checks the plumbing.
  expect(c.json?.tesla_history?.total_records === 1 && !c.json.tesla_history.sample, 'not in /api/charging', c.json?.tesla_history);
  return { refresh_status: r.status, tesla_history: c.json.tesla_history };
});

// ---------- 6. Push subscription ----------
await check('push', 'a push subscription is stored', async () => {
  const sub = await (await fetch(`${FAKES}/subscription`)).json();
  const r = await api('/api/push/subscribe', { method: 'POST', body: sub });
  const k = await api('/api/push/key');
  expect(r.status === 200 && k.json.enabled && k.json.subscriptions === 1 && k.json.publicKey === env.VAPID_PUBLIC_KEY, 'push key', k.json);
  return { push_key: { ...k.json, publicKey: `${k.json.publicKey.slice(0, 12)}…` }, endpoint: sub.endpoint };
});
await check('push', 'test notification is delivered, VAPID-signed and decryptable', async () => {
  const r = await api('/api/push/test', { method: 'POST' });
  expect(r.json?.sent === 1, 'sent', r.json);
  const p = await waitFor(async () => (await fakesLog()).find((e) => e.kind === 'push' && e.payload.tag === 'test'), 10_000, 'test push');
  expect(p.vapid_k === env.VAPID_PUBLIC_KEY, 'VAPID key differs');
  return { app: r.json, received: { ttl: p.ttl, vapid_sub: p.vapid_sub, payload: p.payload } };
});

// ---------- 7. Browser: PWA, service worker, live updates over SSE ----------
let browser, page, cdp;
const require = createRequire(import.meta.url);
await check('pwa', 'Chromium logs in through the PWA and registers the service worker', async () => {
  const { chromium } = require('playwright');
  // The full Chromium build: the headless shell build has no notification permission to grant.
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : { channel: 'chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(['notifications'], { origin: APP });
  page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[browser]', m.text()); });
  await page.goto(APP);
  await page.fill('#login input[name=passcode]', env.APP_PASSCODE);
  await page.click('#login button');
  await page.waitForFunction(() => !document.querySelector('#login'), null, { timeout: 15_000 });
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(sw?.endsWith('/sw.js'), `service worker ${sw}`);
  await page.screenshot({ path: path.join(RESULTS, 'pwa-before-car.png') });
  const before = await page.evaluate(() => document.body.innerText);
  expect(!before.toUpperCase().includes('COMPLETE'), 'page already shows car data before the car connected');
  return { service_worker: sw, url: page.url() };
});

// ---------- 8. The fake car drives, charges and raises alerts ----------
const sse = { events: [], ok: false };
const sseAbort = new AbortController();
(async () => {
  const res = await fetch(`${APP}/api/stream`, { headers: { cookie }, signal: sseAbort.signal });
  sse.ok = res.ok;
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (ev) sse.events.push({ ev, data: data ? JSON.parse(data) : null });
    }
  }
})().catch(() => {});
await sleep(500);

let carOut = '';
await check('car', 'fake car connects over mTLS with the pushed config and every record is acked', async () => {
  // The car connects to whatever the signed config told it: hostname, port and CA.
  fs.writeFileSync(path.join(CERTS, 'config-ca.pem'), telemetryConfig.ca);
  const r = compose('--profile', 'car', 'run', '--rm', '-T', 'fake-car',
    `-server=${telemetryConfig.hostname}:${telemetryConfig.port}`, `-vin=${VIN}`,
    '-cert=car-cert.pem', '-key=car-key.pem', '-ca=config-ca.pem', '-scenario=scenario.json');
  carOut = `${r.stdout}\n${r.stderr}`;
  fs.writeFileSync(path.join(RESULTS, 'fake-car.log'), carOut);
  expect(r.status === 0, `fake car exit ${r.status}`, carOut.split('\n').slice(-8));
  const steps = carOut.match(/step \d+ sent/g)?.length;
  return { exit: 0, steps_acked: steps, first_lines: carOut.split('\n').filter((l) => /connected|done/.test(l)) };
});
await check('car', 'a wrong client certificate is rejected by fleet-telemetry', async () => {
  // Self-signed car cert with the right CN but not issued by a trusted CA.
  const d = path.join(CERTS, 'rogue');
  fs.mkdirSync(d, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-nodes', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-subj', '/CN=Tesla Issuing CA', '-keyout', `${d}/k.pem`, '-out', `${d}/c.pem`, '-days', '1'], { stdio: 'ignore' });
  fs.chmodSync(`${d}/k.pem`, 0o644);
  const r = compose('--profile', 'car', 'run', '--rm', '-T', 'fake-car', `-server=fleet-telemetry:443`, `-vin=${VIN}`,
    '-cert=rogue/c.pem', '-key=rogue/k.pem', '-ca=config-ca.pem', '-scenario=scenario.json');
  const out = `${r.stdout}${r.stderr}`;
  expect(r.status !== 0, 'rogue car was accepted', out);
  return { exit: r.status, last_line: out.trim().split('\n').at(-1) };
});
await sleep(2000);

// ---------- 9. What arrived ----------
let state;
await check('ingest', 'every field the car sent is in /api/state with the right value and type', async () => {
  state = (await api('/api/state')).json;
  const s = state.signals;
  const want = {
    VehicleName: 'e2e Plaid', Version: '2026.32.1 abc123', Soc: 90, BatteryLevel: 81, EnergyRemaining: 84.6, RatedRange: 300.5,
    ChargeLimitSoc: 90, Odometer: 12010, Gear: 'ShiftStateP', Locked: true, LocatedAtHome: false, SentryMode: 'SentryModeStatePanic',
    TpmsPressureFl: 2.9, TpmsPressureRr: 2.95, InsideTemp: 21.5, FdWindow: 'WindowStateClosed', HvacPower: 'HvacPowerStateOff',
    DetailedChargeState: 'DetailedChargeStateComplete', FastChargerType: 'FastChargerSupercharger', ChargePortDoorOpen: true,
    DCChargingPower: 60, DCChargingEnergyIn: 9.8, VehicleSpeed: 0, SoftwareUpdateVersion: '2026.38.4', DestinationName: null,
    LifetimeEnergyGainedRegen: 1520.25, DiTorqueActualF: 120, LongitudinalAcceleration: 2.1,
  };
  const wrong = {};
  for (const [f, v] of Object.entries(want)) {
    const got = s[f]?.value;
    const same = typeof v === 'number' ? Math.abs(got - v) < 1e-3 : got === v;
    if (!same || (f in s && s[f].source !== 'TEL')) wrong[f] = { want: v, got, source: s[f]?.source };
  }
  const loc = s.Location?.value;
  if (!(Math.abs(loc?.latitude - 37.53) < 1e-6 && Math.abs(loc?.longitude + 121.905) < 1e-6)) wrong.Location = loc;
  if (JSON.stringify(s.DoorState?.value) !== JSON.stringify({ DriverFront: false, DriverRear: false, PassengerFront: false, PassengerRear: false, TrunkFront: false, TrunkRear: false })) wrong.DoorState = s.DoorState?.value;
  expect(Object.keys(wrong).length === 0, `mismatched: ${Object.keys(wrong).join(', ')}`, wrong);
  return {
    fields_checked: Object.keys(want).length + 2,
    wire_shapes_from_fleet_telemetry: {
      Gear: s.Gear.value, Location: s.Location.value, DoorState: s.DoorState.value,
      TpmsHardWarnings: s.TpmsHardWarnings?.value, DestinationName_invalid: s.DestinationName?.value, ChargeLimitSoc_int: s.ChargeLimitSoc.value, VehicleSpeed_float: s.VehicleSpeed.value,
    },
  };
});
await check('ingest', 'connectivity record from fleet-telemetry reaches the app', async () => {
  const st = await waitFor(async () => (await api('/api/state')).json.meta.telemetry, 5000, 'meta.telemetry');
  const conn = sse.events.filter((e) => e.ev === 'connectivity').map((e) => e.data.status);
  expect(conn.includes('CONNECTED'), 'no CONNECTED event on SSE', conn);
  return { meta_telemetry: st, sse_connectivity_statuses: conn };
});
await check('ingest', 'vehicle alert record reaches the app and the live stream', async () => {
  const a = sse.events.find((e) => e.ev === 'vehicle-alert');
  expect(a?.data?.name === 'e2e_BMS_test_alert', 'no vehicle-alert on SSE', sse.events.map((e) => e.ev));
  return a.data;
});
await check('ingest', 'live stream (SSE) carried the car\'s signals as they arrived', async () => {
  const sig = sse.events.filter((e) => e.ev === 'signal');
  const fields = new Set(sig.map((e) => e.data.field));
  expect(sse.ok && fields.size >= 30, `only ${fields.size} fields on SSE`);
  const gears = sig.filter((e) => e.data.field === 'Gear').map((e) => e.data.value);
  expect(JSON.stringify(gears) === JSON.stringify(['ShiftStateP', 'ShiftStateD', 'ShiftStateP']), 'gear sequence', gears);
  return { signal_events: sig.length, distinct_fields: fields.size, gear_sequence: gears };
});
await check('ingest', 'history stores every value in order', async () => {
  const h = (await api('/api/history?field=Soc')).json.map((r) => r.value);
  expect(JSON.stringify(h) === JSON.stringify([80.2, 77.6, 78, 85, 90]), 'Soc history', h);
  return { soc_history: h };
});

// ---------- 10. Derived features ----------
await check('derive', 'trip recorded from Gear D to P with distance, energy and route', async () => {
  const t = (await api('/api/trips')).json.trips[0];
  expect(t && t.start_odo === 12000 && t.end_odo === 12010 && t.start_energy === 78.4 && t.end_energy === 75.9 && Math.round(t.wh_per_mile) === 250, 'trip numbers', t);
  expect(t.max_speed === 71.5 && t.start_place === 'Home', 'speed/place', t);
  const full = (await api(`/api/trips/${t.id}`)).json;
  expect(full.route?.length === 4, `route points ${full.route?.length}`);
  return { id: t.id, start_place: t.start_place, miles: t.end_odo - t.start_odo, kwh: +(t.start_energy - t.end_energy).toFixed(2), wh_per_mile: t.wh_per_mile, max_speed: t.max_speed, route_points: full.route.length };
});
await check('derive', 'Supercharger session recorded with peak power, curve and energy', async () => {
  const c = (await api('/api/charging')).json.sessions[0];
  expect(c && c.dc === true && c.fast_charger === 'FastChargerSupercharger' && c.peak_kw === 250 && Math.abs(c.energy_battery_kwh - 9.8) < 1e-6, 'session', c);
  expect(c.start_soc === 77.6 && c.end_soc === 90, 'soc', c);
  const full = (await api(`/api/charging/${c.id}`)).json;
  expect(full.curve?.length === 3, `curve ${full.curve?.length}`, full.curve);
  return { id: c.id, fast_charger: c.fast_charger, start_soc: c.start_soc, end_soc: c.end_soc, peak_kw: c.peak_kw, kwh: c.energy_battery_kwh, curve: full.curve.map(([soc, kw]) => [soc, kw]) };
});
await check('derive', 'tire warning and pressures show on the health endpoint', async () => {
  const t = (await api('/api/health/tires')).json;
  expect(t.hard_warnings?.includes('FL'), 'hard warning FL', t.hard_warnings);
  return { hard_warnings: t.hard_warnings, now: t.now ?? t.current ?? null };
});
await check('derive', 'drive stats endpoint answers after the drive', async () => {
  const d = (await api('/api/drive')).json;
  expect(d.today, 'no today', d);
  return d.today;
});

// ---------- 11. Alerts -> web push ----------
const WANT_ALERTS = { charge_complete: 'Charging complete', sentry_alarm: 'Sentry alarm', tpms_hard: 'Tire pressure warning', software_update: 'Software update ready' };
await check('alerts', 'alert rules fired for charge complete, Sentry alarm, tire warning and update', async () => {
  const ev = (await api('/api/events')).json;
  const kinds = ev.map((e) => e.kind);
  const missing = Object.keys(WANT_ALERTS).filter((k) => !kinds.includes(k));
  expect(missing.length === 0, `missing ${missing}`, ev);
  return ev.filter((e) => WANT_ALERTS[e.kind]).map((e) => ({ kind: e.kind, title: e.title, body: e.body }));
});
let pushes;
await check('alerts', 'each alert arrived at the push service, VAPID-signed and decryptable', async () => {
  pushes = await waitFor(async () => {
    const p = (await fakesLog()).filter((e) => e.kind === 'push' && WANT_ALERTS[e.payload.tag]);
    return p.length >= 4 && p;
  }, 10_000, '4 alert pushes');
  const rejected = (await fakesLog()).filter((e) => e.kind === 'push_rejected');
  expect(rejected.length === 0, 'push service rejected some', rejected);
  for (const p of pushes) expect(p.payload.title === WANT_ALERTS[p.payload.tag], `title for ${p.payload.tag}`, p.payload);
  return pushes.map((p) => ({ ttl: p.ttl, payload: p.payload }));
});
await check('pwa', 'dashboard updated live from the car without a reload', async () => {
  // Values only the car sent (the page was loaded before it connected): charge state, range, trips.
  // (Trip and week totals refresh on a 60 s timer, not over SSE, so they aren't checked here.)
  const want = ['LIMIT 90% · COMPLETE', '301 MI RATED', 'LOCKED'];
  const text = await waitFor(async () => {
    const t = await page.evaluate(() => document.body.innerText);
    const missing = want.filter((w) => !t.toUpperCase().includes(w));
    if (missing.length) throw new Error(`missing ${missing.join(', ')}; page: ${t.replace(/\s+/g, ' ').slice(0, 400)}`);
    return t;
  }, 10_000, 'live values on the page');
  await page.screenshot({ path: path.join(RESULTS, 'pwa-after-car.png') });
  const lines = text.split('\n');
  return { found: want, energy: lines[lines.indexOf('ENERGY') + 1], status_line: lines.find((l) => /LIVE LINK|LAST SEEN/i.test(l)), page_url: page.url() };
});
await check('pwa', 'service worker shows the decrypted alert as a notification', async () => {
  // Chromium's own push service is Google's, which this test can't use, so the payload the
  // fake push service decrypted is handed to the real sw.js through DevTools.
  cdp = await page.context().newCDPSession(page);
  const regs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  const reg = await waitFor(async () => regs.find((r) => r.scopeURL === `${APP}/` && !r.isDeleted), 5000, 'registration');
  const sentry = pushes.find((p) => p.payload.tag === 'sentry_alarm').payload;
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: APP, registrationId: reg.registrationId, data: JSON.stringify(sentry) });
  const shown = await waitFor(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag }))).then((l) => l.length && l), 5000, 'notification');
  expect(shown[0].title === 'Sentry alarm' && shown[0].tag === 'sentry_alarm', 'notification', shown);
  return shown;
});

// ---------- 12. No car commands ----------
await check('no-commands', 'the app has no command endpoint and sent no command to Fleet API during the run', async () => {
  const r = await api('/api/command/flash_lights', { method: 'POST', body: {} });
  const sent = (await fakesLog()).filter((e) => e.kind === 'vehicle_command');
  expect(r.status === 404 && sent.length === 0, `status ${r.status}, ${sent.length} commands at fake Fleet API`, sent);
  return { status: r.status, commands_at_fleet_api: sent.length };
});

sseAbort.abort();
await browser?.close();

// ---------- Report ----------
const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(RESULTS, 'report.json'), JSON.stringify({ when: new Date().toISOString(), vin: VIN, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
const md = [`# Plaid e2e report`, '', `${new Date().toISOString()} · ${checks.length - failed.length}/${checks.length} checks passed`, ''];
for (const c of checks) {
  md.push(`## ${c.ok ? 'PASS' : 'FAIL'} · ${c.group} · ${c.name}`, '');
  if (c.error) md.push(`Error: ${c.error}`, '');
  md.push('```json', JSON.stringify(c.evidence, null, 2)?.slice(0, 3000) ?? 'null', '```', '');
}
fs.writeFileSync(path.join(RESULTS, 'report.md'), md.join('\n'));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Report: ${path.join(RESULTS, 'report.md')}`);
process.exit(failed.length ? 1 : 0);
