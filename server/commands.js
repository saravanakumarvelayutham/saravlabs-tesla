// The commands the dashboard can send, and how each maps to Fleet API and to tesla-control over BLE.
//
// Fleet API names and body keys: pkg/proxy/command.go in teslamotors/vehicle-command.
// BLE names and arguments: cmd/tesla-control/commands.go in the same repo.
//
// Routing: "auto" uses the garage Pi when it has reached the car over Bluetooth in the last
// 2 minutes (free, works without internet), otherwise Fleet API through the proxy.

export const COMMANDS = {
  door_lock: { label: 'Lock', ble: () => ['lock'] },
  door_unlock: { label: 'Unlock', ble: () => ['unlock'] },
  auto_conditioning_start: { label: 'Climate on', ble: () => ['climate-on'] },
  auto_conditioning_stop: { label: 'Climate off', ble: () => ['climate-off'] },
  set_charge_limit: {
    label: 'Set charge limit',
    validate: (a) => {
      const p = Number(a.percent);
      if (!Number.isInteger(p) || p < 50 || p > 100) throw new Error('percent must be a whole number from 50 to 100');
      return { percent: p };
    },
    ble: (a) => ['charging-set-limit', String(a.percent)],
  },
  charge_start: { label: 'Start charging', ble: () => ['charging-start'] },
  charge_stop: { label: 'Stop charging', ble: () => ['charging-stop'] },
  set_sentry_mode: {
    label: 'Sentry Mode',
    validate: (a) => {
      if (typeof a.on !== 'boolean') throw new Error('on must be true or false');
      return { on: a.on };
    },
    ble: (a) => ['sentry-mode', a.on ? 'on' : 'off'],
  },
  schedule_software_update: {
    label: 'Install update',
    validate: (a) => {
      const s = Number(a.offset_sec ?? 0);
      if (!Number.isInteger(s) || s < 0 || s > 86400) throw new Error('offset_sec must be 0 to 86400');
      return { offset_sec: s };
    },
    ble: (a) => ['software-update-start', `${a.offset_sec}s`],
  },
  flash_lights: { label: 'Flash lights', ble: () => ['flash-lights'] },
  honk_horn: { label: 'Honk', ble: () => ['honk'] },
  // Fleet API wakes are billed; only ever sent when the user taps it.
  wake_up: { label: 'Wake car', ble: () => ['wake'] },
};

const BRIDGE_FRESH_MS = 2 * 60_000;
const BLE_TIMEOUT_MS = 75_000; // room for the Pi to wake a sleeping car first

export class Commands {
  constructor(db, { fleet, sampleMode, store, broadcast }) {
    this.db = db;
    this.fleet = fleet;
    this.sampleMode = sampleMode;
    this.store = store;
    this.broadcast = broadcast || (() => {});
    this.waiters = new Map();
    this.bridgeSeen = 0;
    this.bridgeReachedCar = 0;
  }

  bridgeStatus() {
    return {
      online: Date.now() - this.bridgeSeen < BRIDGE_FRESH_MS,
      car_in_range: Date.now() - this.bridgeReachedCar < BRIDGE_FRESH_MS,
      last_seen: this.bridgeSeen || null,
      last_car_contact: this.bridgeReachedCar || null,
    };
  }

  async run(name, rawArgs = {}, via = 'auto') {
    const def = COMMANDS[name];
    if (!def) throw Object.assign(new Error(`unknown command ${name}`), { status: 400 });
    let args = {};
    try { if (def.validate) args = def.validate(rawArgs); } catch (err) { throw Object.assign(err, { status: 400 }); }
    if (this.sampleMode) return this.simulate(name, args);
    const useBle = via === 'ble' || (via === 'auto' && this.bridgeStatus().car_in_range);
    if (useBle) return { via: 'ble', ...(await this.viaBridge(def.ble(args))) };
    if (!this.fleet) throw Object.assign(new Error('Fleet API is not configured'), { status: 503 });
    const res = name === 'wake_up' ? await this.fleet.wakeUp() : await this.fleet.command(name, args);
    return { via: 'fleet', result: res };
  }

  viaBridge(argv) {
    const r = this.db.prepare('INSERT INTO bridge_queue (ts, command, args) VALUES (?, ?, ?)').run(Date.now(), argv[0], JSON.stringify(argv.slice(1)));
    const id = Number(r.lastInsertRowid);
    this.broadcast('bridge-wake', { id });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        this.db.prepare("UPDATE bridge_queue SET status = 'expired' WHERE id = ? AND status IN ('queued','sent')").run(id);
        reject(Object.assign(new Error('The garage Pi did not answer in time'), { status: 504 }));
      }, BLE_TIMEOUT_MS);
      this.waiters.set(id, (result) => {
        clearTimeout(timer);
        if (result.ok) resolve({ result: result.output ?? null });
        else reject(Object.assign(new Error(result.error || 'tesla-control failed'), { status: 502 }));
      });
    });
  }

  // Bridge side: hand out the oldest queued command.
  nextForBridge() {
    const row = this.db.prepare("SELECT * FROM bridge_queue WHERE status = 'queued' ORDER BY id LIMIT 1").get();
    if (!row) return null;
    this.db.prepare("UPDATE bridge_queue SET status = 'sent' WHERE id = ?").run(row.id);
    return { id: row.id, command: row.command, args: JSON.parse(row.args || '[]') };
  }

  bridgeResult(id, result) {
    this.db.prepare('UPDATE bridge_queue SET status = ?, result = ?, done_ts = ? WHERE id = ?')
      .run(result.ok ? 'done' : 'failed', JSON.stringify(result), Date.now(), id);
    this.waiters.get(id)?.(result);
    this.waiters.delete(id);
  }

  // Sample mode: apply the obvious effect so the UI can be tried end to end.
  simulate(name, args) {
    const st = this.store;
    const ts = Date.now();
    const effects = {
      door_lock: () => st.put('Locked', true, ts, 'SAMPLE'),
      door_unlock: () => st.put('Locked', false, ts, 'SAMPLE'),
      auto_conditioning_start: () => st.put('HvacPower', 'HvacPowerStateOn', ts, 'SAMPLE'),
      auto_conditioning_stop: () => st.put('HvacPower', 'HvacPowerStateOff', ts, 'SAMPLE'),
      set_charge_limit: () => st.put('ChargeLimitSoc', args.percent, ts, 'SAMPLE'),
      set_sentry_mode: () => st.put('SentryMode', args.on ? 'SentryModeStateArmed' : 'SentryModeStateOff', ts, 'SAMPLE'),
    };
    effects[name]?.();
    return { via: 'sample', result: { result: true, reason: 'sample mode: no car contacted' } };
  }
}
