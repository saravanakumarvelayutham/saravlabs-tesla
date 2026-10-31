// Permanent archive of Tesla's charging_history (GET /api/1/dx/charging/history).
//
// Tesla documents this endpoint only as "Returns the paginated charging history" and publishes no
// parameters or depth limit. Community clients pass vin, startTime, endTime, pageNo, pageSize,
// sortBy and sortOrder; the backfill sends only vin, startTime, pageNo and pageSize (no guessed
// sort values) and never trusts any single stop signal:
// it pages until a page is empty, two pages in a row bring nothing new, the reported
// totalResults is reached, or a hard page cap. Whether pageNo starts at 0 or 1 doesn't matter,
// since a repeated page just adds nothing. Every record ever seen is kept (keyed by sessionId),
// so the regular 6-hourly read of the newest page no longer replaces older history.
import { kvGet, kvSet } from '../db.js';
import { records } from '../derive/supercharger.js';

const ARCHIVE = 'archive:charging_history';
const CACHE = 'cache:charging_history';
// Model S deliveries began in 2012, so this covers any car's whole life.
export const DEFAULT_SINCE = '2012-01-01T00:00:00Z';

const keyOf = (r) => String(r?.sessionId ?? r?.id ?? `${r?.chargeStartDateTime ?? ''}|${r?.siteLocationName ?? ''}|${r?.vin ?? ''}`);
const startOf = (r) => Date.parse(r?.chargeStartDateTime ?? r?.chargeStart ?? r?.startDateTime ?? '') || 0;

function totalResults(raw) {
  for (const env of [raw, raw?.response, raw?.data]) {
    const n = Number(env?.totalResults ?? env?.total_results ?? env?.total);
    if (Number.isFinite(n) && n >= 0 && env && !Array.isArray(env)) return n;
  }
  return null;
}

export function loadArchive(db) {
  return kvGet(db, ARCHIVE) || { records: {}, backfill: null, updated_ts: null };
}

// Merge records into the archive, then rewrite the cache entry every reader already uses
// (/api/charging, /api/tesla/cache) so it holds the whole archive, newest first.
export function mergeRecords(db, list, { now = Date.now(), backfill } = {}) {
  const arc = loadArchive(db);
  let added = 0;
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const k = keyOf(r);
    if (!(k in arc.records)) added++;
    arc.records[k] = r;
  }
  arc.updated_ts = now;
  if (backfill) arc.backfill = backfill;
  kvSet(db, ARCHIVE, arc);
  const all = Object.values(arc.records).sort((a, b) => startOf(b) - startOf(a));
  const entry = { ts: now, data: { data: all, totalResults: all.length }, archive: { records: all.length, backfill: arc.backfill } };
  kvSet(db, CACHE, entry);
  return { added, entry };
}

// Page through charging_history. `fetchPage(params)` performs one GET with those query params.
export async function backfill(fetchPage, { vin, since = DEFAULT_SINCE, pageSize = 50, maxPages = 200 } = {}) {
  const seen = new Map();
  let pages = 0;
  let idle = 0;
  let total = null;
  let usedStartTime = Boolean(since);
  let stop = 'max_pages';
  for (let pageNo = 0; pageNo < maxPages; pageNo++) {
    const params = { ...(vin ? { vin } : {}), ...(usedStartTime ? { startTime: since } : {}), pageNo, pageSize };
    let raw;
    try {
      raw = await fetchPage(params);
    } catch (err) {
      // If Tesla rejects our guessed filters on the very first page, retry once with paging only.
      if (pageNo === 0 && err.status >= 400 && err.status < 500 && usedStartTime) {
        usedStartTime = false;
        pageNo = -1;
        continue;
      }
      throw Object.assign(err, { partial: [...seen.values()], pages });
    }
    pages++;
    total ??= totalResults(raw);
    const rows = records(raw);
    if (!rows.length) { stop = 'empty_page'; break; }
    let fresh = 0;
    for (const r of rows) {
      const k = keyOf(r);
      if (!seen.has(k)) { seen.set(k, r); fresh++; }
    }
    idle = fresh ? 0 : idle + 1;
    if (idle >= 2) { stop = 'no_new_records'; break; }
    if (total != null && seen.size >= total) { stop = 'total_reached'; break; }
  }
  const list = [...seen.values()];
  const starts = list.map(startOf).filter(Boolean);
  return {
    records: list,
    summary: {
      pages,
      fetched: list.length,
      total_results: total,
      stop,
      start_time: usedStartTime ? since : null,
      earliest_ts: starts.length ? Math.min(...starts) : null,
      latest_ts: starts.length ? Math.max(...starts) : null,
    },
  };
}

const qs = (params) => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export function chargingHistoryPath(params = {}) {
  const q = qs(params);
  return `/api/1/dx/charging/history${q ? `?${q}` : ''}`;
}

// Run a full backfill against the Fleet API and store the result. Records fetched before an
// error are still kept, and the error is recorded alongside them.
export async function runBackfill(db, request, opts = {}) {
  const now = opts.now ?? Date.now();
  try {
    const { records: list, summary } = await backfill((p) => request('GET', chargingHistoryPath(p)), opts);
    const bf = { ts: now, ...summary, error: null };
    const { added } = mergeRecords(db, list, { now, backfill: bf });
    return { ...bf, added, archived: Object.keys(loadArchive(db).records).length };
  } catch (err) {
    const bf = { ts: now, pages: err.pages ?? 0, fetched: err.partial?.length ?? 0, error: err.message };
    mergeRecords(db, err.partial || [], { now, backfill: bf });
    throw err;
  }
}
