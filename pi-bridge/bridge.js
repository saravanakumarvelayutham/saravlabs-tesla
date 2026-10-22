#!/usr/bin/env node
// Garage Pi bridge: talks to the car over Bluetooth with Tesla's `tesla-control -ble`,
// and to the dashboard server over HTTPS. No npm dependencies (Node 18+).
//
//  - Every POLL_SECONDS: `body-controller-state` (works while the car sleeps, doesn't wake it).
//    Only when that says the car is awake, also read `state charge|climate|tire-pressure|closures`.
//    Results go to POST /api/bridge/state.
//  - Meanwhile long-polls GET /api/bridge/next for commands the server routed to Bluetooth,
//    runs them with tesla-control and posts the result back.
import { execFile } from 'node:child_process';

const env = process.env;
const SERVER = (env.SERVER_URL || '').replace(/\/$/, '');
const TOKEN = env.BRIDGE_TOKEN || '';
const VIN = env.TESLA_VIN || '';
const KEY_FILE = env.TESLA_KEY_FILE || '';
const BIN = env.TESLA_CONTROL || 'tesla-control';
const POLL_MS = Math.max(15, Number(env.POLL_SECONDS) || 60) * 1000;
const EXEC_TIMEOUT_MS = Number(env.EXEC_TIMEOUT_SECONDS || 40) * 1000;
const STATE_CATEGORIES = ['charge', 'climate', 'tire-pressure', 'closures'];

// The only tesla-control subcommands the server may ask for (mirrors server/commands.js).
const ALLOWED = new Set([
  'lock', 'unlock', 'climate-on', 'climate-off', 'charging-set-limit', 'charging-start', 'charging-stop',
  'sentry-mode', 'software-update-start', 'flash-lights', 'honk', 'wake',
]);

if (!SERVER || !TOKEN || !VIN || !KEY_FILE) {
  console.error('Set SERVER_URL, BRIDGE_TOKEN, TESLA_VIN and TESLA_KEY_FILE (see pi-bridge/README.md).');
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One Bluetooth conversation at a time: the polling loop and commands share this lock.
let chain = Promise.resolve();
function teslaControl(args) {
  const run = () => new Promise((resolve) => {
    execFile(BIN, ['-ble', '-vin', VIN, '-key-file', KEY_FILE, ...args], { timeout: EXEC_TIMEOUT_MS },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout.trim(), stderr: stderr.trim(), error: err ? (stderr.trim() || err.message) : null }));
  });
  const p = chain.then(run, run);
  chain = p;
  return p;
}

async function server(method, path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35_000),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
}

// tesla-control talks to both the body controller and infotainment for most commands; only the body
// controller answers while the car sleeps. So when the car is asleep, wake it first and wait for it.
async function ensureAwake() {
  const now = parse((await teslaControl(['body-controller-state'])).stdout);
  if (!now || now.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_AWAKE') return;
  log('car asleep, waking first');
  await teslaControl(['wake']);
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const s = parse((await teslaControl(['body-controller-state'])).stdout);
    if (s?.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_AWAKE') return;
  }
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

async function pollOnce() {
  const body = await teslaControl(['body-controller-state']);
  const data = body.ok ? parse(body.stdout) : null;
  if (!data) {
    log('car not reachable:', body.error || 'unparseable output');
    await server('POST', '/api/bridge/state', { kind: 'none', reached_car: false, ts: Date.now() });
    return;
  }
  const sleepStatus = data.vehicleSleepStatus || null; // VEHICLE_SLEEP_STATUS_AWAKE | _ASLEEP | _UNKNOWN
  await server('POST', '/api/bridge/state', { kind: 'body-controller-state', data, ts: Date.now(), reached_car: true, sleep: sleepStatus });
  if (sleepStatus !== 'VEHICLE_SLEEP_STATUS_AWAKE') return; // reading full state would wake it
  for (const cat of STATE_CATEGORIES) {
    const r = await teslaControl(['state', cat]);
    const d = r.ok ? parse(r.stdout) : null;
    if (d) await server('POST', '/api/bridge/state', { kind: `state:${cat}`, data: d, ts: Date.now(), reached_car: true, sleep: sleepStatus });
    else log(`state ${cat} failed:`, r.error);
  }
}

async function pollLoop() {
  for (;;) {
    try { await pollOnce(); } catch (err) { log('poll error:', err.message); }
    await sleep(POLL_MS);
  }
}

async function commandLoop() {
  for (;;) {
    try {
      const job = await server('GET', '/api/bridge/next');
      if (!job) continue;
      if (!ALLOWED.has(job.command)) {
        await server('POST', `/api/bridge/result/${job.id}`, { ok: false, error: `command not allowed on bridge: ${job.command}` });
        continue;
      }
      log('running', job.command, ...(job.args || []));
      if (job.command !== 'wake') await ensureAwake();
      const r = await teslaControl([job.command, ...(job.args || []).map(String)]);
      await server('POST', `/api/bridge/result/${job.id}`, { ok: r.ok, output: r.stdout || null, error: r.error });
      log(job.command, r.ok ? 'ok' : `failed: ${r.error}`);
    } catch (err) {
      log('command loop error:', err.message);
      await sleep(5000);
    }
  }
}

log(`bridge for ${VIN.slice(-6)} → ${SERVER}, polling every ${POLL_MS / 1000}s`);
pollLoop();
commandLoop();
