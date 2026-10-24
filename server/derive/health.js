// Battery, tire and overnight-drain insights.
import { barToPsi } from '../signals.js';
import { isParked, localDay, median, sentryOn, slope, tireWarnings } from '../util.js';

const TIRES = { TpmsPressureFl: 'FL', TpmsPressureFr: 'FR', TpmsPressureRl: 'RL', TpmsPressureRr: 'RR' };

// Thresholds are this app's own choices, not Tesla values.
export const TIRE_RULES = {
  coldParkedMs: 3 * 3600_000, // a reading counts as "cold" after 3 h parked
  windowDays: 30,
  minPoints: 7,
  leakPsiPerDay: -0.08,
  minDropPsi: 2,
  steadyPsiPerDay: -0.04,
};

export class Health {
  constructor(db, store) {
    this.db = db;
    this.store = store;
    this.parkedSince = null;
    const gear = store.entry('Gear');
    if (gear && isParked(gear.value)) this.parkedSince = gear.ts;
    store.on('signal', (s) => this.onSignal(s));
  }

  onSignal({ field, value, ts, prev }) {
    if (field === 'Gear') {
      if (isParked(value) && !isParked(prev)) this.parkedSince = ts;
      if (!isParked(value)) this.parkedSince = null;
      if (isParked(value) && this.parkedSince == null) this.parkedSince = ts;
      return;
    }
    const tire = TIRES[field];
    if (tire && typeof value === 'number' && this.parkedSince != null && ts - this.parkedSince >= TIRE_RULES.coldParkedMs) {
      // First cold reading of the day per tire, so warm-tire swings don't look like leaks.
      this.db.prepare('INSERT OR IGNORE INTO tire_daily (day, tire, psi, ts) VALUES (?, ?, ?, ?)')
        .run(localDay(ts), tire, barToPsi(value), ts);
    }
  }

  tires(now = Date.now()) {
    const st = this.store;
    const since = localDay(now - TIRE_RULES.windowDays * 86400_000);
    const rows = this.db.prepare('SELECT day, tire, psi, ts FROM tire_daily WHERE day >= ? ORDER BY day').all(since);
    const series = { FL: [], FR: [], RL: [], RR: [] };
    for (const r of rows) series[r.tire]?.push([r.ts, r.psi]);
    const slopes = {};
    for (const [t, pts] of Object.entries(series)) {
      slopes[t] = pts.length >= 2 ? slope(pts.map(([ts, p]) => [ts / 86400_000, p])) : null;
    }
    const current = {};
    for (const [f, t] of Object.entries(TIRES)) {
      const e = st.entry(f);
      current[t] = e && typeof e.value === 'number' ? { psi: barToPsi(e.value), ts: e.ts, source: e.source } : null;
    }
    const leaks = [];
    for (const [t, pts] of Object.entries(series)) {
      if (pts.length < TIRE_RULES.minPoints) continue;
      const others = Object.entries(slopes).filter(([k, v]) => k !== t && v != null).map(([, v]) => v);
      const drop = pts[0][1] - pts[pts.length - 1][1];
      if (slopes[t] <= TIRE_RULES.leakPsiPerDay && drop >= TIRE_RULES.minDropPsi && (median(others) ?? 0) > TIRE_RULES.steadyPsiPerDay) {
        leaks.push({ tire: t, psi_per_day: slopes[t], drop_psi: drop, days: pts.length });
      }
    }
    // The car's own recommended cold pressure, when the garage Pi has read it over Bluetooth.
    const rcp = (f) => {
      const e = st.entry(f);
      return e && typeof e.value === 'number' ? { psi: barToPsi(e.value), ts: e.ts, source: e.source } : null;
    };
    const lastSeen = {};
    for (const [f, t] of Object.entries(TIRES)) {
      const e = st.entry(f.replace('TpmsPressure', 'TpmsLastSeenPressureTime'));
      lastSeen[t] = e && e.value != null ? { raw: e.value, ts: e.ts, source: e.source } : null;
    }
    return {
      current,
      recommended: { front: rcp('TpmsRcpFront'), rear: rcp('TpmsRcpRear') },
      last_seen: lastSeen,
      series,
      slopes,
      leaks,
      soft_warnings: tireWarnings(st.get('TpmsSoftWarnings')),
      hard_warnings: tireWarnings(st.get('TpmsHardWarnings')),
      rules: TIRE_RULES,
    };
  }

  // Monthly pack-capacity points. Uses NominalFullPackEnergyKwh (firmware 2026.32+) when present,
  // else estimates EnergyRemaining / (BatteryLevel / 100) from readings at 50%+ charge.
  battery(now = Date.now()) {
    const st = this.store;
    const since = now - 400 * 86400_000;
    const nominal = st.history('NominalFullPackEnergyKwh', since, 200000).filter((h) => typeof h.value === 'number');
    const method = nominal.length ? 'NominalFullPackEnergyKwh' : 'estimate';
    let samples = [];
    if (nominal.length) {
      samples = nominal.map((h) => [h.ts, h.value]);
    } else {
      const energy = st.history('EnergyRemaining', since, 200000);
      const level = st.history('BatteryLevel', since, 200000);
      let j = 0;
      for (const e of energy) {
        while (j + 1 < level.length && level[j + 1].ts <= e.ts) j++;
        const l = level[j];
        if (!l || typeof l.value !== 'number' || typeof e.value !== 'number') continue;
        if (Math.abs(l.ts - e.ts) > 120_000 || l.value < 50) continue;
        samples.push([e.ts, e.value / (l.value / 100)]);
      }
    }
    const months = new Map();
    for (const [ts, v] of samples) {
      const d = new Date(ts);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(v);
    }
    const monthly = [...months.entries()].sort().map(([month, vals]) => ({ month, kwh: median(vals), n: vals.length }));
    const vmax = st.get('BrickVoltageMax');
    const vmin = st.get('BrickVoltageMin');
    return {
      method,
      monthly,
      latest_kwh: monthly.length ? monthly[monthly.length - 1].kwh : null,
      change_pct: monthly.length >= 2 ? ((monthly[monthly.length - 1].kwh - monthly[0].kwh) / monthly[0].kwh) * 100 : null,
      brick_v: { max: vmax, min: vmin, spread_mv: vmax != null && vmin != null ? (vmax - vmin) * 1000 : null },
      module_temp: { min: st.get('ModuleTempMin'), max: st.get('ModuleTempMax') },
      heater_on: st.get('BatteryHeaterOn'),
    };
  }

  // Overnight drain for the last `nights` nights, 22:00 to 06:00 local, only when the car stayed parked.
  drain(nights = 7, now = Date.now()) {
    const st = this.store;
    const out = [];
    for (let i = nights; i >= 1; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(22, 0, 0, 0);
      const from = d.getTime();
      const to = from + 8 * 3600_000;
      if (to > now) continue;
      const drove = this.db.prepare('SELECT COUNT(*) AS n FROM trips WHERE start_ts < ? AND (end_ts IS NULL OR end_ts > ?)').get(to, from).n;
      const socFrom = valueAt(st, 'Soc', from);
      const socTo = valueAt(st, 'Soc', to);
      const charged = this.db.prepare('SELECT COUNT(*) AS n FROM charges WHERE start_ts < ? AND (end_ts IS NULL OR end_ts > ?)').get(to, from).n;
      const sentry = sentryOn(valueAt(st, 'SentryMode', from)) || st.history('SentryMode', from).some((h) => h.ts < to && sentryOn(h.value));
      const cop = st.history('HvacPower', from).some((h) => h.ts < to && h.value === 'HvacPowerStateOverheatProtect');
      out.push({
        night: localDay(from),
        from,
        to,
        valid: !drove && !charged && socFrom != null && socTo != null,
        drain_pct: socFrom != null && socTo != null ? socFrom - socTo : null,
        sentry,
        cabin_overheat_ran: cop,
      });
    }
    const valid = out.filter((n) => n.valid);
    const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n.drain_pct, 0) / arr.length : null);
    return {
      nights: out,
      sentry_avg: avg(valid.filter((n) => n.sentry)),
      no_sentry_avg: avg(valid.filter((n) => !n.sentry)),
    };
  }
}

export function valueAt(store, field, ts) {
  const row = store.db.prepare('SELECT value FROM history WHERE field = ? AND ts <= ? ORDER BY ts DESC LIMIT 1').get(field, ts);
  return row ? JSON.parse(row.value) : null;
}
