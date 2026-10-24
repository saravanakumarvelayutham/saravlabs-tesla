// Recent history of one signal for the tap-to-inspect sheet, read from the SQLite history table.
//
// Numeric fields are grouped into at most `buckets` time buckets, each with its min, max and mean,
// so a 1 s field like VehicleSpeed over a week stays a few hundred points and launches still show
// as the bucket max. Other fields (enums, booleans, objects) come back as their changes, with
// time spent in each state for enums and booleans.
import { NUMERIC } from './store.js';

export const RANGES = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 86400_000, '7d': 7 * 86400_000 };

export function signalHistory(store, field, { range = '24h', now = Date.now(), buckets = 240, maxChanges = 200 } = {}) {
  const span = RANGES[range];
  if (!span) throw Object.assign(new Error(`range must be one of ${Object.keys(RANGES).join(', ')}`), { status: 400 });
  const from = now - span;
  const out = { field, range, from, to: now, latest: store.entry(field) };
  // Fields outside SIGNALS (no declared unit) are numeric when the car sends numbers.
  return NUMERIC.has(field) || typeof out.latest?.value === 'number'
    ? { ...out, kind: 'numeric', ...numeric(store.db, field, from, now, buckets) }
    : { ...out, kind: 'state', ...changes(store.db, field, from, now, maxChanges) };
}

function numeric(db, field, from, to, buckets) {
  const width = Math.max(1, Math.ceil((to - from) / buckets));
  // JSON null is an "invalid" datum from the car: skipped, not charted as zero.
  const rows = db.prepare(`SELECT CAST((ts - ?) / ? AS INTEGER) AS b, COUNT(*) AS n,
      MIN(CAST(value AS REAL)) AS mn, MAX(CAST(value AS REAL)) AS mx, AVG(CAST(value AS REAL)) AS av,
      MIN(ts) AS t0, MAX(ts) AS t1
    FROM history WHERE field = ? AND ts >= ? AND ts <= ? AND value != 'null'
    GROUP BY b ORDER BY b`).all(from, width, field, from, to);
  const points = rows.map((r) => [Math.round((r.t0 + r.t1) / 2), r.av, r.mn, r.mx, r.n]);
  const count = rows.reduce((s, r) => s + r.n, 0);
  const stats = count
    ? {
      count,
      min: Math.min(...rows.map((r) => r.mn)),
      max: Math.max(...rows.map((r) => r.mx)),
      avg: rows.reduce((s, r) => s + r.av * r.n, 0) / count,
      first_ts: rows[0].t0,
      last_ts: rows[rows.length - 1].t1,
    }
    : { count: 0, min: null, max: null, avg: null, first_ts: null, last_ts: null };
  return { bucket_ms: width, points, stats };
}

function changes(db, field, from, to, maxChanges) {
  const before = db.prepare('SELECT value, ts, source FROM history WHERE field = ? AND ts < ? ORDER BY ts DESC LIMIT 1').get(field, from);
  // Newest 5000 rows in the window are plenty to find the last `maxChanges` changes.
  const rows = db.prepare('SELECT value, ts, source FROM history WHERE field = ? AND ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT 5000')
    .all(field, from, to).reverse();
  const list = [];
  let prev = before?.value;
  for (const r of rows) {
    if (r.value === prev) continue;
    list.push({ ts: r.ts, value: JSON.parse(r.value), source: r.source });
    prev = r.value;
  }
  const initial = before ? { ts: before.ts, value: JSON.parse(before.value), source: before.source } : null;
  return {
    initial,
    changes: list.slice(-maxChanges),
    truncated: list.length > maxChanges || rows.length === 5000,
    stats: { count: rows.length, changes: list.length },
    states: timeInState(initial, list, from, to),
  };
}

// Milliseconds spent in each value across the window; only for scalar values.
function timeInState(initial, list, from, to) {
  const segs = [];
  if (initial) segs.push({ value: initial.value, start: from });
  for (const c of list) segs.push({ value: c.value, start: c.ts });
  if (!segs.length || segs.some((s) => s.value !== null && typeof s.value === 'object')) return null;
  const totals = new Map();
  segs.forEach((s, i) => {
    const end = i + 1 < segs.length ? segs[i + 1].start : to;
    const k = JSON.stringify(s.value);
    totals.set(k, (totals.get(k) || 0) + (end - s.start));
  });
  return [...totals.entries()].map(([k, ms]) => ({ value: JSON.parse(k), ms })).sort((a, b) => b.ms - a.ms);
}
