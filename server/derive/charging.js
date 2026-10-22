// Charging sessions from DetailedChargeState (firmware 2024.38+).
//
// Energy: DCChargingEnergyIn is "measured at the battery" and valid for AC and DC.
// ACChargingEnergyIn is "measured from the charger" (wall side) and should be ignored during DC.
// Home cost uses the wall-side number when we have it, since that is what the meter bills.
import { CHARGING_STATES, CHARGE_END_STATES, isDcCharger } from '../util.js';

const MAX_CURVE_POINTS = 600;

export class Charging {
  constructor(db, store, { homeRatePerKwh }) {
    this.db = db;
    this.store = store;
    this.rate = homeRatePerKwh;
    this.active = null;
    const open = db.prepare('SELECT * FROM charges WHERE end_ts IS NULL ORDER BY id DESC LIMIT 1').get();
    if (open) this.active = { ...open, curve: JSON.parse(open.curve || '[]') };
    this.listeners = [];
    store.on('signal', (s) => this.onSignal(s));
  }

  onEnd(fn) {
    this.listeners.push(fn);
  }

  onSignal({ field, value, ts }) {
    const st = this.store;
    if (field === 'DetailedChargeState') {
      if (CHARGING_STATES.has(value) && !this.active) this.start(ts);
      else if (CHARGE_END_STATES.has(value) && this.active) this.end(ts, value);
      return;
    }
    const a = this.active;
    if (!a) return;
    if (field === 'FastChargerType' && isDcCharger(value)) {
      a.dc = 1;
      a.fast_charger = value;
    } else if (field === 'DCChargingPower' || field === 'ACChargingPower') {
      const isDc = a.dc === 1;
      if ((field === 'DCChargingPower') !== isDc || typeof value !== 'number') return;
      a.peak_kw = Math.max(a.peak_kw || 0, value);
      if (a.curve.length < MAX_CURVE_POINTS) a.curve.push([st.get('Soc'), value, ts]);
    } else if (field === 'DCChargingEnergyIn' && typeof value === 'number') {
      a.energy_battery_kwh = Math.max(a.energy_battery_kwh || 0, value);
    } else if (field === 'ACChargingEnergyIn' && typeof value === 'number' && a.dc !== 1) {
      a.energy_wall_kwh = Math.max(a.energy_wall_kwh || 0, value);
    }
  }

  start(ts) {
    const st = this.store;
    const fc = st.get('FastChargerType');
    const a = {
      start_ts: ts,
      start_soc: st.get('Soc'),
      at_home: st.get('LocatedAtHome') === true ? 1 : 0,
      fast_charger: fc,
      dc: isDcCharger(fc) ? 1 : 0,
      peak_kw: 0,
      energy_battery_kwh: null,
      energy_wall_kwh: null,
      curve: [],
    };
    const r = this.db.prepare('INSERT INTO charges (start_ts, start_soc, at_home, fast_charger, dc) VALUES (?, ?, ?, ?, ?)')
      .run(a.start_ts, a.start_soc, a.at_home, a.fast_charger, a.dc);
    a.id = Number(r.lastInsertRowid);
    this.active = a;
  }

  end(ts, state) {
    const a = this.active;
    this.active = null;
    a.end_ts = ts;
    a.end_soc = this.store.get('Soc');
    this.db.prepare(`UPDATE charges SET end_ts = ?, end_soc = ?, fast_charger = ?, dc = ?, peak_kw = ?, energy_battery_kwh = ?,
      energy_wall_kwh = ?, curve = ? WHERE id = ?`)
      .run(a.end_ts, a.end_soc, a.fast_charger, a.dc, a.peak_kw, a.energy_battery_kwh, a.energy_wall_kwh, JSON.stringify(a.curve), a.id);
    for (const fn of this.listeners) fn({ session: this.summarize(a), state });
  }

  summarize(c) {
    const curve = Array.isArray(c.curve) ? c.curve : JSON.parse(c.curve || '[]');
    const homeKwh = c.energy_wall_kwh ?? c.energy_battery_kwh;
    const cost = c.at_home && !c.dc && this.rate > 0 && homeKwh != null ? homeKwh * this.rate : null;
    return {
      id: c.id,
      start_ts: c.start_ts,
      end_ts: c.end_ts ?? null,
      start_soc: c.start_soc,
      end_soc: c.end_soc ?? this.store.get('Soc'),
      at_home: !!c.at_home,
      dc: !!c.dc,
      fast_charger: c.fast_charger,
      peak_kw: c.peak_kw,
      energy_battery_kwh: c.energy_battery_kwh,
      energy_wall_kwh: c.energy_wall_kwh,
      // Only home AC sessions get a cost here: your rate x wall-side kWh. Supercharger cost
      // comes from Tesla's charging_history, whose response format isn't published yet.
      cost,
      cost_basis: cost == null ? null : c.energy_wall_kwh != null ? 'wall kWh x your rate' : 'battery kWh x your rate',
      curve,
    };
  }

  list(limit = 50) {
    return this.db.prepare('SELECT * FROM charges WHERE end_ts IS NOT NULL ORDER BY start_ts DESC LIMIT ?').all(limit).map((c) => {
      const { curve, ...s } = this.summarize(c);
      return { ...s, curve_points: curve.length };
    });
  }

  get(id) {
    const c = this.db.prepare('SELECT * FROM charges WHERE id = ?').get(id);
    return c ? this.summarize(c) : null;
  }

  current() {
    return this.active ? this.summarize(this.active) : null;
  }

  // Average DC curve: mean kW per 5% SoC bucket across past DC sessions.
  averageDcCurve() {
    const rows = this.db.prepare('SELECT curve FROM charges WHERE dc = 1 AND end_ts IS NOT NULL ORDER BY start_ts DESC LIMIT 20').all();
    const buckets = new Map();
    for (const r of rows) {
      for (const [soc, kw] of JSON.parse(r.curve || '[]')) {
        if (soc == null) continue;
        const b = Math.round(soc / 5) * 5;
        const e = buckets.get(b) || [0, 0];
        buckets.set(b, [e[0] + kw, e[1] + 1]);
      }
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([soc, [sum, n]]) => [soc, sum / n]);
  }

  monthSummary(year, month) {
    const from = new Date(year, month, 1).getTime();
    const to = new Date(year, month + 1, 1).getTime();
    const rows = this.db.prepare('SELECT * FROM charges WHERE start_ts >= ? AND start_ts < ? AND end_ts IS NOT NULL').all(from, to)
      .map((c) => this.summarize(c));
    const home = rows.filter((r) => r.at_home && !r.dc);
    const dc = rows.filter((r) => r.dc);
    const homeKwh = home.reduce((s, r) => s + (r.energy_wall_kwh ?? r.energy_battery_kwh ?? 0), 0);
    return {
      from,
      to,
      sessions: rows.length,
      home: { sessions: home.length, kwh: homeKwh, cost: this.rate > 0 ? homeKwh * this.rate : null, rate: this.rate || null },
      dc: { sessions: dc.length, kwh: dc.reduce((s, r) => s + (r.energy_battery_kwh ?? 0), 0) },
      other: { sessions: rows.length - home.length - dc.length },
    };
  }
}
