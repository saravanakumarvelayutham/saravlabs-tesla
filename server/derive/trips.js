// Trips run from Gear leaving P to Gear back in P.
//
// Trip energy is the drop in EnergyRemaining (kWh). We don't use LifetimeEnergyUsedDrive because
// Tesla's Available Data page marks it "Semi-truck only".
//
// Odometer and EnergyRemaining stream at 60 s intervals, so their final values can arrive up to a
// minute after the car is parked. A trip stays open for late values for FINALIZE_MS after Park.
import { isParked, median, placeName } from '../util.js';

const FINALIZE_MS = 90_000;
const MAX_ROUTE_POINTS = 3000;

export class Trips {
  constructor(db, store) {
    this.db = db;
    this.store = store;
    this.active = null;
    this.finalizing = null;
    const open = db.prepare('SELECT * FROM trips WHERE end_ts IS NULL ORDER BY id DESC LIMIT 1').get();
    if (open) this.active = { ...open, route: JSON.parse(open.route || '[]') };
    store.on('signal', (s) => this.onSignal(s));
  }

  onSignal({ field, value, ts }) {
    const st = this.store;
    if (field === 'Gear') {
      if (!isParked(value) && !this.active) this.start(ts);
      else if (isParked(value) && this.active) this.end(ts);
      return;
    }
    if (this.finalizing && ts - this.finalizing.end_ts <= FINALIZE_MS) {
      if (field === 'Odometer') this.patchEnd('end_odo', value);
      if (field === 'EnergyRemaining') this.patchEnd('end_energy', value);
      if (field === 'Soc') this.patchEnd('end_soc', value);
      if (value === true && !this.finalizing.end_place) {
        const place = { LocatedAtHome: 'Home', LocatedAtWork: 'Work', LocatedAtFavorite: 'Favorite' }[field];
        if (place) this.patchEnd('end_place', place);
      }
    }
    if (!this.active) return;
    if (field === 'Location' && value && typeof value.latitude === 'number') {
      if (this.active.route.length < MAX_ROUTE_POINTS) {
        this.active.route.push([value.latitude, value.longitude, ts, st.get('VehicleSpeed')]);
      }
    } else if (field === 'VehicleSpeed' && typeof value === 'number') {
      this.active.max_speed = Math.max(this.active.max_speed || 0, value);
    } else if (field === 'Odometer' && this.active.start_odo == null) {
      this.active.start_odo = value;
    } else if (field === 'EnergyRemaining' && this.active.start_energy == null) {
      this.active.start_energy = value;
    }
  }

  start(ts) {
    const st = this.store;
    const t = {
      start_ts: ts,
      start_odo: st.get('Odometer'),
      start_energy: st.get('EnergyRemaining'),
      start_soc: st.get('Soc'),
      start_place: placeName(st),
      outside_temp: st.get('OutsideTemp'),
      max_speed: 0,
      route: [],
    };
    const r = this.db.prepare(`INSERT INTO trips (start_ts, start_odo, start_energy, start_soc, start_place, outside_temp)
      VALUES (?, ?, ?, ?, ?, ?)`).run(t.start_ts, t.start_odo, t.start_energy, t.start_soc, t.start_place, t.outside_temp);
    t.id = Number(r.lastInsertRowid);
    this.active = t;
  }

  end(ts) {
    const st = this.store;
    const t = this.active;
    this.active = null;
    t.end_ts = ts;
    t.end_odo = st.get('Odometer');
    t.end_energy = st.get('EnergyRemaining');
    t.end_soc = st.get('Soc');
    t.end_place = placeName(st) || st.get('DestinationName') || null;
    this.db.prepare(`UPDATE trips SET end_ts = ?, end_odo = ?, end_energy = ?, end_soc = ?, end_place = ?, max_speed = ?, route = ?,
      start_odo = COALESCE(start_odo, ?), start_energy = COALESCE(start_energy, ?) WHERE id = ?`)
      .run(t.end_ts, t.end_odo, t.end_energy, t.end_soc, t.end_place, t.max_speed, JSON.stringify(t.route), t.start_odo, t.start_energy, t.id);
    this.finalizing = t;
  }

  patchEnd(col, value) {
    this.finalizing[col] = value;
    this.db.prepare(`UPDATE trips SET ${col} = ? WHERE id = ?`).run(value, this.finalizing.id);
  }

  list(limit = 50) {
    return this.db.prepare('SELECT * FROM trips WHERE end_ts IS NOT NULL ORDER BY start_ts DESC LIMIT ?').all(limit).map(summarize);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM trips WHERE id = ?').get(id);
    return row ? { ...summarize(row), route: JSON.parse(row.route || '[]'), segments: this.segments(row) } : null;
  }

  // Efficiency per stretch of the trip, from consecutive EnergyRemaining samples and the
  // Odometer reading at each of them. Used to color the route trace.
  segments(t) {
    const to = (t.end_ts || Date.now()) + 90_000;
    // Fields only arrive when they change, so start from the last reading before the trip began.
    const around = (field) => {
      const rows = this.store.history(field, t.start_ts - 6 * 3600_000).filter((h) => h.ts <= to && typeof h.value === 'number');
      const firstIn = rows.findIndex((h) => h.ts >= t.start_ts);
      const keepFrom = firstIn === -1 ? Math.max(rows.length - 1, 0) : Math.max(firstIn - 1, 0);
      return rows.slice(keepFrom);
    };
    const energy = around('EnergyRemaining');
    const odo = around('Odometer');
    const odoAt = (ts) => {
      let v = null;
      for (const h of odo) { if (h.ts <= ts) v = h.value; else break; }
      return v;
    };
    const out = [];
    for (let i = 1; i < energy.length; i++) {
      const a = energy[i - 1];
      const b = energy[i];
      const miles = (odoAt(b.ts) ?? 0) - (odoAt(a.ts) ?? 0);
      if (miles < 0.05) continue;
      out.push({ from: a.ts, to: b.ts, wh_per_mile: ((a.value - b.value) * 1000) / miles });
    }
    return out;
  }

  current() {
    if (!this.active) return null;
    return { ...summarize({ ...this.active, end_odo: this.store.get('Odometer'), end_energy: this.store.get('EnergyRemaining') }), usual: this.usual() };
  }

  // Your usual efficiency: the median Wh/mi of the last `n` finished trips of a mile or more.
  // Median, so one hilly or freezing trip doesn't move it much.
  usual(n = 20) {
    const vals = this.list(200).filter((t) => t.miles >= 1 && t.wh_per_mile != null).slice(0, n).map((t) => t.wh_per_mile);
    return vals.length >= 3 ? { wh_per_mile: median(vals), trips: vals.length } : null;
  }
}

export function summarize(t) {
  const miles = t.end_odo != null && t.start_odo != null ? t.end_odo - t.start_odo : null;
  const kwh = t.end_energy != null && t.start_energy != null ? t.start_energy - t.end_energy : null;
  const whPerMile = miles && miles > 0.2 && kwh != null ? (kwh * 1000) / miles : null;
  const { route, ...rest } = t;
  return {
    ...rest,
    miles,
    kwh,
    wh_per_mile: whPerMile,
    minutes: t.end_ts ? (t.end_ts - t.start_ts) / 60000 : null,
    route_points: Array.isArray(route) ? route.length : route ? JSON.parse(route).length : 0,
  };
}
