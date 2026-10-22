// Holds the latest value of every signal, appends history, and tells listeners about changes.
import { EventEmitter } from 'node:events';
import { SIGNALS } from './signals.js';

// Fields stored as numbers. The fleet-telemetry MQTT README warns that the car may send
// a float as 12.3 or "12.3" depending on firmware, so numeric strings are coerced.
const NUMERIC = new Set(Object.entries(SIGNALS)
  .filter(([k, s]) => s.unit || k.startsWith('DiTorqueActual'))
  .map(([k]) => k));

export function normalizeValue(field, raw) {
  if (raw === null || raw === undefined) return null; // "invalid" datum
  if (NUMERIC.has(field)) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'string' && (raw === 'true' || raw === 'false')) return raw === 'true';
  return raw;
}

export class Store extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    this.latest = new Map();
    for (const row of db.prepare('SELECT field, value, ts, source FROM latest').all()) {
      this.latest.set(row.field, { value: JSON.parse(row.value), ts: row.ts, source: row.source });
    }
    this.upsert = db.prepare(`INSERT INTO latest (field, value, ts, source) VALUES (?, ?, ?, ?)
      ON CONFLICT(field) DO UPDATE SET value = excluded.value, ts = excluded.ts, source = excluded.source`);
    this.append = db.prepare('INSERT INTO history (field, value, ts, source) VALUES (?, ?, ?, ?)');
  }

  get(field) {
    return this.latest.get(field)?.value ?? null;
  }

  entry(field) {
    return this.latest.get(field) ?? null;
  }

  // Record one signal. Values older than what we have (e.g. a late BLE read) are kept in
  // history but don't replace the latest value.
  put(field, raw, ts = Date.now(), source = 'TEL') {
    const value = normalizeValue(field, raw);
    const prev = this.latest.get(field);
    const json = JSON.stringify(value);
    this.append.run(field, json, ts, source);
    if (prev && prev.ts > ts) return;
    this.latest.set(field, { value, ts, source });
    this.upsert.run(field, json, ts, source);
    this.emit('signal', { field, value, ts, source, prev: prev?.value ?? null });
  }

  snapshot() {
    const out = {};
    for (const [k, v] of this.latest) out[k] = v;
    return out;
  }

  history(field, sinceTs = 0, limit = 5000) {
    return this.db.prepare('SELECT value, ts, source FROM history WHERE field = ? AND ts >= ? ORDER BY ts LIMIT ?')
      .all(field, sinceTs, limit)
      .map((r) => ({ value: JSON.parse(r.value), ts: r.ts, source: r.source }));
  }

  prune(olderThanTs) {
    this.db.prepare('DELETE FROM history WHERE ts < ?').run(olderThanTs);
  }
}
