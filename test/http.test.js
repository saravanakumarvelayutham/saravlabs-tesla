import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { createApp } from '../server/index.js';
import { createServer } from '../server/http.js';
import { COMMANDS } from '../server/commands.js';
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
  assert.equal(Object.keys(body.config.fields).length, Object.keys(SIGNALS).length);
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
