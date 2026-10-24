import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { createApp } from '../server/index.js';
import { createServer } from '../server/http.js';
import { COMMANDS } from '../server/commands.js';
import { kvSet } from '../server/db.js';
import { buildTelemetryConfig, SIGNALS } from '../server/signals.js';

const cfg = {
  ...config,
  sampleMode: false,
  appPasscode: 'letmein',
  sessionSecret: 'test-secret',
  bridgeToken: 'bridge-token',
  publicUrl: 'http://localhost',
  vin: 'TESTVIN',
  tesla: { ...config.tesla, clientId: '', clientSecret: '' },
};
let app;
let server;
let base;
let cookie = '';

const req = async (method, path, { body, headers = {} } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
};

before(async () => {
  app = createApp(cfg, { dbFile: ':memory:' });
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('API needs the passcode', async () => {
  assert.equal((await req('GET', '/healthz')).status, 200);
  assert.equal((await req('GET', '/api/state')).status, 401);
  assert.equal((await req('POST', '/api/login', { body: { passcode: 'wrong' } })).status, 401);
  const ok = await req('POST', '/api/login', { body: { passcode: 'letmein' } });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  const state = await req('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.meta.sample_mode, false);
});

test('command arguments are validated before anything is sent', async () => {
  const bad = await req('POST', '/api/command/set_charge_limit', { body: { args: { percent: 120 } } });
  assert.equal(bad.status, 400);
  assert.equal((await req('POST', '/api/command/rm_rf', { body: {} })).status, 400);
});

test('a Bluetooth command goes through the bridge queue and back', async () => {
  const auth = { authorization: 'Bearer bridge-token' };
  assert.equal((await req('GET', '/api/bridge/next', { headers: { authorization: 'Bearer nope' } })).status, 401);
  const pending = req('POST', '/api/command/set_charge_limit', { body: { args: { percent: 80 }, via: 'ble' } });
  const job = await req('GET', '/api/bridge/next', { headers: auth });
  assert.deepEqual({ command: job.json.command, args: job.json.args }, { command: 'charging-set-limit', args: ['80'] });
  await req('POST', `/api/bridge/result/${job.json.id}`, { headers: auth, body: { ok: true, output: '' } });
  const done = await pending;
  assert.equal(done.status, 200);
  assert.equal(done.json.via, 'ble');
});

test('bridge state is stored with source BLE', async () => {
  const auth = { authorization: 'Bearer bridge-token' };
  const r = await req('POST', '/api/bridge/state', {
    headers: auth,
    body: { kind: 'body-controller-state', data: { vehicleLockState: 'VEHICLELOCKSTATE_UNLOCKED', vehicleSleepStatus: 'VEHICLE_SLEEP_STATUS_ASLEEP' }, reached_car: true, sleep: 'VEHICLE_SLEEP_STATUS_ASLEEP', ts: Date.now() },
  });
  assert.deepEqual(r.json.fields, ['Locked']);
  assert.equal(app.store.entry('Locked').source, 'BLE');
  assert.equal((await req('GET', '/api/state')).json.meta.bridge.car_in_range, true);
});

test('every command maps to an allowlisted tesla-control subcommand', async () => {
  const fs = await import('node:fs');
  const bridge = fs.readFileSync(new URL('../pi-bridge/bridge.js', import.meta.url), 'utf8');
  const sample = { set_charge_limit: { percent: 80 }, set_sentry_mode: { on: true }, schedule_software_update: { offset_sec: 0 } };
  for (const [name, def] of Object.entries(COMMANDS)) {
    const args = def.validate ? def.validate(sample[name]) : {};
    assert.ok(bridge.includes(`'${def.ble(args)[0]}'`), `${name} → ${def.ble(args)[0]} missing from the bridge allowlist`);
  }
});

test('telemetry config covers every signal with its interval', () => {
  const body = buildTelemetryConfig({ vin: 'V', hostname: 'telemetry.example.com', port: 8443, ca: 'PEM' });
  assert.deepEqual(body.vins, ['V']);
  assert.equal(body.config.hostname, 'telemetry.example.com');
  assert.equal(Object.keys(body.config.fields).length, Object.values(SIGNALS).filter((s) => !s.bleOnly).length);
  assert.equal(body.config.fields.TpmsRcpFront, undefined); // Bluetooth-only
  for (const [k, f] of Object.entries(body.config.fields)) assert.equal(f.interval_seconds, SIGNALS[k].interval);
});

test('static files cannot escape the web folder', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const sibling = path.join(cfg.root, 'web-private');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'nope');
  try {
    const res = await fetch(`${base}/..%2fweb-private/secret.txt`);
    assert.notEqual(await res.text(), 'nope');
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  } finally {
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('release notes and alerts read only the cache, never Tesla', async () => {
  const empty = await req('GET', '/api/vehicle/release-notes');
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.json.fetched_at, empty.json.notes, empty.json.matched, empty.json.can_fetch], [null, [], null, false]);
  kvSet(app.db, 'cache:release_notes', { ts: 123, data: { response: { release_notes: [{ title: 'T', customer_version: '2026.32.4' }] } } });
  kvSet(app.db, 'cache:recent_alerts', { ts: 456, data: { response: { recent_alerts: [{ name: 'A_b', time: '2026-10-20T10:00:00Z', audience: ['customer'] }] } } });
  app.store.put('Version', '2026.32.4', Date.now(), 'TEL');
  const notes = (await req('GET', '/api/vehicle/release-notes')).json;
  assert.equal(notes.fetched_at, 123);
  assert.equal(notes.notes[0].title, 'T');
  assert.equal(notes.version, '2026.32.4');
  const alerts = (await req('GET', '/api/vehicle/alerts')).json;
  assert.equal(alerts.alerts[0].name, 'A_b');
  assert.deepEqual(alerts.streamed, []);
  assert.equal((await req('POST', '/api/tesla/refresh?what=recent_alerts')).status, 503);
});

test('the Fetch button refreshes through Fleet API once the account is linked', async () => {
  const calls = [];
  Object.assign(app, { fleet: { recentAlerts: async (force) => { calls.push(force); return { ts: 1, data: {} }; } }, auth: { linked: true } });
  try {
    assert.equal((await req('GET', '/api/vehicle/alerts')).json.can_fetch, true);
    assert.equal((await req('POST', '/api/tesla/refresh?what=recent_alerts')).status, 200);
    assert.deepEqual(calls, [true]);
  } finally {
    delete app.fleet;
    delete app.auth;
  }
});
