// Launch log, friction circle and heat stats.
//
// Launch times are estimates from VehicleSpeed samples (1 s minimum interval in our config), so
// they are coarse. Tesla doesn't document the sign of LongitudinalAcceleration; we learn it from
// launches (speed rising means the car is accelerating) and store it.
import { kvGet, kvSet } from '../db.js';
import { G } from '../util.js';

const LAUNCH_WINDOW_MS = 8000;

export class Drive {
  constructor(db, store) {
    this.db = db;
    this.store = store;
    this.speed = [];
    this.accel = [];
    store.on('signal', (s) => this.onSignal(s));
  }

  get accelSign() {
    return kvGet(this.db, 'longAccelSign', { sign: 1, learned: false });
  }

  onSignal({ field, value, ts }) {
    if (field === 'LongitudinalAcceleration' && typeof value === 'number') {
      this.accel.push([ts, value]);
      this.accel = this.accel.filter(([t]) => ts - t < LAUNCH_WINDOW_MS + 2000);
    }
    if (field !== 'VehicleSpeed' || typeof value !== 'number') return;
    this.speed.push([ts, value]);
    this.speed = this.speed.filter(([t]) => ts - t < LAUNCH_WINDOW_MS + 2000);
    if (value < 60) return;
    const prev = this.speed[this.speed.length - 2];
    if (!prev || prev[1] >= 60) return;
    // Find the last near-standstill sample before this crossing.
    let startIdx = -1;
    for (let i = this.speed.length - 2; i >= 0; i--) {
      if (this.speed[i][1] <= 1) { startIdx = i; break; }
    }
    if (startIdx < 0) return;
    const start = this.speed[startIdx];
    if (ts - start[0] > LAUNCH_WINDOW_MS) return;
    // Interpolate the 60 mph crossing between the two samples around it.
    const t60 = prev[0] + ((60 - prev[1]) / (value - prev[1])) * (ts - prev[0]);
    const seconds = (t60 - start[0]) / 1000;
    const window = this.accel.filter(([t]) => t >= start[0] && t <= ts);
    const mean = window.length ? window.reduce((s, [, a]) => s + a, 0) / window.length : 0;
    if (window.length >= 2) kvSet(this.db, 'longAccelSign', { sign: mean >= 0 ? 1 : -1, learned: true });
    const sign = this.accelSign.sign;
    const peakG = window.length ? Math.max(...window.map(([, a]) => a * sign)) / G : null;
    const st = this.store;
    const tq = ['DiTorqueActualF', 'DiTorqueActualREL', 'DiTorqueActualRER'].map((f) => st.get(f));
    const total = tq.every((v) => typeof v === 'number') ? tq.reduce((s, v) => s + Math.abs(v), 0) : 0;
    const data = {
      seconds,
      peak_g: peakG,
      pedal: st.get('PedalPosition'),
      samples: this.speed.slice(startIdx).map(([t, v]) => [(t - start[0]) / 1000, v]),
      torque_share: total > 0 ? { F: Math.abs(tq[0]) / total, RL: Math.abs(tq[1]) / total, RR: Math.abs(tq[2]) / total } : null,
      stator_c: { F: st.get('DiStatorTempF'), RL: st.get('DiStatorTempREL'), RR: st.get('DiStatorTempRER') },
    };
    this.db.prepare('INSERT INTO events (ts, kind, title, body, data) VALUES (?, ?, ?, ?, ?)')
      .run(ts, 'launch', `0-60 mph in ${seconds.toFixed(1)} s (estimate)`, null, JSON.stringify(data));
  }

  launches(limit = 20) {
    return this.db.prepare("SELECT ts, title, data FROM events WHERE kind = 'launch' ORDER BY ts DESC LIMIT ?").all(limit)
      .map((r) => ({ ts: r.ts, title: r.title, ...JSON.parse(r.data) }));
  }

  // Peak lateral / acceleration / braking g and peak temperatures since local midnight.
  today(now = Date.now()) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const since = d.getTime();
    const st = this.store;
    const sign = this.accelSign;
    const lat = st.history('LateralAcceleration', since, 100000).map((h) => h.value).filter((v) => typeof v === 'number');
    const lon = st.history('LongitudinalAcceleration', since, 100000).map((h) => h.value).filter((v) => typeof v === 'number').map((v) => v * sign.sign);
    const max = (field) => {
      const vals = st.history(field, since, 100000).map((h) => h.value).filter((v) => typeof v === 'number');
      return vals.length ? Math.max(...vals) : null;
    };
    const points = [];
    const latH = st.history('LateralAcceleration', since, 100000);
    const lonH = st.history('LongitudinalAcceleration', since, 100000);
    let j = 0;
    for (const l of lonH) {
      while (j + 1 < latH.length && latH[j + 1].ts <= l.ts) j++;
      if (latH[j] && typeof latH[j].value === 'number' && typeof l.value === 'number' && Math.abs(latH[j].ts - l.ts) < 1500) points.push([latH[j].value / G, (l.value * sign.sign) / G]);
    }
    return {
      lateral_g: lat.length ? Math.max(...lat.map(Math.abs)) / G : null,
      accel_g: lon.length ? Math.max(0, ...lon) / G : null,
      braking_g: lon.length ? Math.abs(Math.min(0, ...lon)) / G : null,
      accel_sign_learned: sign.learned,
      // Master cylinder pressure; Tesla gives no unit, so it's only compared with itself.
      brake_peak: max('BrakePedalPos'),
      brake_events: st.history('BrakePedalPos', since, 100000).filter((h, i, a) => h.value > 0 && !(a[i - 1]?.value > 0)).length,
      gg_points: points.slice(-1500),
      heat: {
        stator: { F: max('DiStatorTempF'), RL: max('DiStatorTempREL'), RR: max('DiStatorTempRER') },
        inverter: { F: max('DiInverterTF'), RL: max('DiInverterTREL'), RR: max('DiInverterTRER') },
        module_max: max('ModuleTempMax'),
      },
    };
  }
}
