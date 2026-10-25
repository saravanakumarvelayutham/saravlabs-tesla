#!/usr/bin/env node
// Garage Pi bridge: talks to the car over Bluetooth with Tesla's `tesla-control -ble`,
// and to the dashboard server over HTTPS. No npm dependencies (Node 18+).
//
//  - Every POLL_SECONDS: `body-controller-state` (works while the car sleeps, doesn't wake it).
//    Only when that says the car is awake, also read `state charge|climate|tire-pressure|closures`.
//    Results go to POST /api/bridge/state.
// It only reads: the app sends no commands to the car.
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

if (!SERVER || !TOKEN || !VIN || !KEY_FILE) {
  console.error('Set SERVER_URL, BRIDGE_TOKEN, TESLA_VIN and TESLA_KEY_FILE (see pi-bridge/README.md).');
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function teslaControl(args) {
  return new Promise((resolve) => {
    execFile(BIN, ['-ble', '-vin', VIN, '-key-file', KEY_FILE, ...args], { timeout: EXEC_TIMEOUT_MS },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout.trim(), stderr: stderr.trim(), error: err ? (stderr.trim() || err.message) : null }));
  });
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

log(`bridge for ${VIN.slice(-6)} → ${SERVER}, polling every ${POLL_MS / 1000}s`);
pollLoop();
