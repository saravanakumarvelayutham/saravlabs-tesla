// Alert rules. Each fires once per episode, is saved to the events table and sent as a web push.
import { kvGet, kvSet } from '../db.js';
import { isParked, sentryAlarm, tireWarnings, windowOpen } from '../util.js';

const AWAY_GRACE_MS = 10 * 60_000;
const WINDOWS = ['FdWindow', 'FpWindow', 'RdWindow', 'RpWindow'];

export class Alerts {
  constructor(db, store, { push, health, charging, broadcast }) {
    this.db = db;
    this.store = store;
    this.push = push;
    this.health = health;
    this.broadcast = broadcast || (() => {});
    this.muted = false; // set while back-filling sample history
    this.pending = new Map(); // rule -> first-seen ts
    store.on('signal', (s) => this.onSignal(s));
    charging.onEnd(({ session, state }) => {
      if (state !== 'DetailedChargeStateComplete') return;
      const kwh = session.energy_battery_kwh;
      this.fire('charge_complete', 'Charging complete',
        `Battery at ${fmt(session.end_soc)}%${kwh != null ? `, ${kwh.toFixed(1)} kWh added` : ''}.`, { id: session.id }, session.end_ts);
    });
  }

  onSignal({ field, value, ts, prev }) {
    const st = this.store;
    if (field === 'SentryMode' && sentryAlarm(value) && !sentryAlarm(prev)) {
      this.fire('sentry_alarm', 'Sentry alarm', 'Sentry Mode reports an alarm. Check the cameras in the Tesla app.', null, ts);
    }
    if (field === 'TpmsHardWarnings') {
      const tires = tireWarnings(value);
      if (tires.length && !tireWarnings(prev).length) {
        this.fire('tpms_hard', 'Tire pressure warning', `The car reports a hard TPMS warning (${tires.join(', ')}).`, { tires }, ts);
      }
    }
    if (field === 'SoftwareUpdateVersion' && typeof value === 'string' && value.trim()) {
      const last = kvGet(this.db, 'notifiedUpdate');
      if (last !== value) {
        kvSet(this.db, 'notifiedUpdate', value);
        this.fire('software_update', 'Software update available', `Version ${value} is available.`, { version: value }, ts);
      }
    }
    // Seen on a real car: false while the update downloads, true once the Tesla app offers Install.
    if (field === 'SoftwareUpdateAvailable' && value === true) {
      const version = st.get('SoftwareUpdateVersion') || '';
      if (kvGet(this.db, 'notifiedUpdateReady') !== version) {
        kvSet(this.db, 'notifiedUpdateReady', version);
        this.fire('software_update_ready', 'Update ready to install',
          `${version ? `Version ${version}` : 'The update'} is ready. Install it from the car or the Tesla app.`, { version: version || null }, ts);
      }
    }
    this.checkAway(ts);
  }

  // Unlocked or a window open while parked away from home, for longer than the grace period.
  checkAway(ts = Date.now()) {
    const st = this.store;
    const away = isParked(st.get('Gear')) && st.get('LocatedAtHome') === false;
    this.hold('unlocked_away', away && st.get('Locked') === false, ts,
      () => ['Car unlocked', 'Your car has been unlocked for 10 minutes away from home.']);
    const open = WINDOWS.filter((w) => windowOpen(st.get(w)));
    this.hold('window_away', away && open.length > 0, ts,
      () => ['Window open', `A window has been open for 10 minutes away from home (${open.join(', ')}).`]);
  }

  hold(rule, active, ts, text) {
    if (!active) {
      this.pending.delete(rule);
      return;
    }
    const first = this.pending.get(rule);
    if (first == null) {
      this.pending.set(rule, ts);
    } else if (first !== -1 && ts - first >= AWAY_GRACE_MS) {
      this.pending.set(rule, -1); // fired for this episode
      const [title, body] = text();
      this.fire(rule, title, body, null, ts);
    }
  }

  // Called daily: slow-leak detection from tire trends.
  checkTires(now = Date.now()) {
    for (const leak of this.health.tires(now).leaks) {
      const key = `leak_${leak.tire}_${new Date(now).toDateString()}`;
      if (kvGet(this.db, key)) continue;
      kvSet(this.db, key, true);
      this.fire('tire_leak', `Possible slow leak: ${leak.tire}`,
        `${leak.tire} tire is down ${leak.drop_psi.toFixed(1)} psi over ${leak.days} days while the others held steady.`, leak, now);
    }
  }

  fire(kind, title, body, data, ts = Date.now()) {
    const r = this.db.prepare('INSERT INTO events (ts, kind, title, body, data) VALUES (?, ?, ?, ?, ?)')
      .run(ts, kind, title, body, data ? JSON.stringify(data) : null);
    const event = { id: Number(r.lastInsertRowid), ts, kind, title, body, data };
    this.broadcast('event', event);
    if (!this.muted) this.push.send({ title, body, tag: kind, url: '/#/' }).catch(() => {});
    return event;
  }

  list(limit = 50) {
    return this.db.prepare("SELECT * FROM events WHERE kind != 'launch' ORDER BY ts DESC LIMIT ?").all(limit)
      .map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
  }
}

const fmt = (v) => (typeof v === 'number' ? Math.round(v) : '?');
