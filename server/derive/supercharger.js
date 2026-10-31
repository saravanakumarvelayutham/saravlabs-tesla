// Supercharger costs from Tesla's charging_history (GET /api/1/dx/charging/history).
//
// Tesla's docs list the endpoint but publish no response format, so this reads the record shape
// described by community clients (sessionId, siteLocationName, chargeStartDateTime, fees[] with
// totalDue / currencyCode / usageBase / uom). Anything it can't read is left out and reported as
// unrecognized, so a different real shape shows up as "0 of N recognized" instead of wrong totals.
// Status: checked only against fixtures, never against a real response.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Find the array of records inside whatever envelope the response has.
export function records(raw) {
  const seen = new Set();
  const walk = (v, depth) => {
    if (v == null || depth > 4 || seen.has(v)) return null;
    if (Array.isArray(v)) return v.some((x) => x && typeof x === 'object') ? v : null;
    if (typeof v !== 'object') return null;
    seen.add(v);
    for (const k of ['data', 'response', 'records', 'results', 'sessions']) {
      const found = walk(v[k], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(raw, 0) || [];
}

function parseRecord(r, vin) {
  if (!r || typeof r !== 'object') return null;
  if (vin && r.vin && r.vin !== vin) return { skipped: 'other_vehicle' };
  const start = Date.parse(r.chargeStartDateTime ?? r.chargeStart ?? r.startDateTime ?? '');
  const fees = Array.isArray(r.fees) ? r.fees : [];
  const total = fees.reduce((s, f) => s + (num(f.totalDue) ?? num(f.netDue) ?? 0), 0);
  const currency = fees.find((f) => f.currencyCode)?.currencyCode ?? null;
  const kwh = fees
    .filter((f) => /charg/i.test(f.feeType || '') && /kwh/i.test(f.uom || ''))
    .reduce((s, f) => s + (num(f.usageBase) ?? 0) + (num(f.usageTier1) ?? 0) + (num(f.usageTier2) ?? 0) + (num(f.usageTier3) ?? 0) + (num(f.usageTier4) ?? 0), 0);
  if (!Number.isFinite(start) || !fees.length) return null;
  return {
    id: String(r.sessionId ?? r.id ?? start),
    start_ts: start,
    end_ts: Date.parse(r.chargeStopDateTime ?? r.unlatchDateTime ?? '') || null,
    site: r.siteLocationName ?? null,
    cost: Math.round(total * 100) / 100,
    currency,
    kwh: kwh || null,
  };
}

export function parseChargingHistory(raw, { vin } = {}) {
  const rows = records(raw);
  const sessions = [];
  let skipped = 0;
  for (const r of rows) {
    const s = parseRecord(r, vin);
    if (s && !s.skipped) sessions.push(s);
    else if (!s?.skipped) skipped++;
  }
  sessions.sort((a, b) => b.start_ts - a.start_ts);
  return { total_records: rows.length, recognized: sessions.length, unrecognized: skipped, sessions };
}

// Sum of recognized sessions in [from, to), grouped by currency ('unknown' when a record has none).
export function costBetween(parsed, from, to) {
  const out = {};
  for (const s of parsed?.sessions || []) {
    if (s.start_ts < from || s.start_ts >= to) continue;
    const c = s.currency || 'unknown';
    out[c] = Math.round(((out[c] || 0) + s.cost) * 100) / 100;
  }
  return out;
}

// The Tesla record for one of our DC sessions: the one starting within 30 min of it.
export function matchSession(parsed, startTs) {
  let best = null;
  for (const s of parsed?.sessions || []) {
    const d = Math.abs(s.start_ts - startTs);
    if (d <= 30 * 60_000 && (!best || d < Math.abs(best.start_ts - startTs))) best = s;
  }
  return best;
}

// Recognized sessions grouped by calendar month (UTC), newest first: count, kWh and cost per currency.
export function monthlyTotals(parsed) {
  const months = new Map();
  for (const s of parsed?.sessions || []) {
    const d = new Date(s.start_ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = months.get(key) || { month: key, sessions: 0, kwh: 0, cost: {} };
    m.sessions++;
    m.kwh = Math.round((m.kwh + (s.kwh || 0)) * 10) / 10;
    const c = s.currency || 'unknown';
    m.cost[c] = Math.round(((m.cost[c] || 0) + s.cost) * 100) / 100;
    months.set(key, m);
  }
  return [...months.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}
