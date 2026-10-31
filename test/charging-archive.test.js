import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { backfill, chargingHistoryPath, loadArchive, mergeRecords, runBackfill } from '../server/tesla/charging-archive.js';
import { monthlyTotals, parseChargingHistory } from '../server/derive/supercharger.js';

// Record shape matches the one verified against the real car (supercharger.js); the paging
// behaviour of Tesla's endpoint is undocumented, so these fakes cover each way it could page.
const rec = (id, iso, total = 10) => ({
  sessionId: id, vin: 'V1', siteLocationName: `Site ${id}`, chargeStartDateTime: iso,
  fees: [{ feeType: 'CHARGING', currencyCode: 'USD', uom: 'kwh', usageBase: 20, totalDue: total }],
});
// 120 records, one every 9 days going back ~3 years from 2026-10-30, newest first.
const ALL = Array.from({ length: 120 }, (_, i) => rec(1000 - i, new Date(Date.parse('2026-10-30T12:00:00Z') - i * 9 * 86400_000).toISOString()));

function fakeApi({ base = 0, total = true, ignorePageSize = false, rejectStartTime = false, failAt = null } = {}) {
  const calls = [];
  const fetchPage = async (p) => {
    calls.push(p);
    if (rejectStartTime && p.startTime) throw Object.assign(new Error('invalid startTime'), { status: 400 });
    if (failAt != null && calls.length === failAt) throw Object.assign(new Error('HTTP 503'), { status: 503 });
    const size = ignorePageSize ? 25 : p.pageSize;
    const idx = Math.max(0, p.pageNo - base);
    const data = ALL.slice(idx * size, idx * size + size);
    return { response: { data, ...(total ? { totalResults: ALL.length } : {}) } };
  };
  return { calls, fetchPage };
}

test('backfill: pages through everything with 0-based pages and stops at totalResults', async () => {
  const api = fakeApi();
  const { records, summary } = await backfill(api.fetchPage, { vin: 'V1', since: '2023-01-01T00:00:00Z', pageSize: 50 });
  assert.equal(records.length, 120);
  assert.equal(summary.stop, 'total_reached');
  assert.equal(summary.pages, 3);
  assert.equal(api.calls[0].startTime, '2023-01-01T00:00:00Z');
  assert.equal(api.calls[0].vin, 'V1');
  assert.equal(summary.earliest_ts, Date.parse(ALL.at(-1).chargeStartDateTime));
});

test('backfill: 1-based pages (page 0 == page 1) still reach the end', async () => {
  const { records } = await backfill(fakeApi({ base: 1 }).fetchPage, { pageSize: 50 });
  assert.equal(records.length, 120);
});

test('backfill: no totalResults and a fixed page size stop on the empty page', async () => {
  const { records, summary } = await backfill(fakeApi({ total: false, ignorePageSize: true }).fetchPage, { pageSize: 50 });
  assert.equal(records.length, 120);
  assert.equal(summary.stop, 'empty_page');
});

test('backfill: an endpoint that ignores pageNo stops after two pages with nothing new', async () => {
  const fetchPage = async () => ({ data: ALL.slice(0, 25) });
  const { records, summary } = await backfill(fetchPage, { pageSize: 25 });
  assert.equal(records.length, 25);
  assert.equal(summary.stop, 'no_new_records');
  assert.equal(summary.pages, 3);
});

test('backfill: drops startTime once if Tesla rejects it', async () => {
  const api = fakeApi({ rejectStartTime: true });
  const { records, summary } = await backfill(api.fetchPage, { since: '2012-01-01T00:00:00Z', pageSize: 50 });
  assert.equal(records.length, 120);
  assert.equal(summary.start_time, null);
  assert.ok(api.calls.slice(1).every((c) => !('startTime' in c)));
});

test('backfill: the page cap bounds Fleet API calls', async () => {
  const api = fakeApi({ total: false });
  const { summary } = await backfill(api.fetchPage, { pageSize: 10, maxPages: 4 });
  assert.equal(api.calls.length, 4);
  assert.equal(summary.stop, 'max_pages');
});

test('archive: newest-page refreshes add to the backfilled history instead of replacing it', () => {
  const db = openDb(':memory:');
  mergeRecords(db, ALL.slice(0, 100));
  const { added, entry } = mergeRecords(db, [rec(2000, '2026-10-31T09:00:00Z'), ...ALL.slice(0, 24)]);
  assert.equal(added, 1);
  assert.equal(entry.data.data.length, 101);
  assert.equal(entry.data.data[0].sessionId, 2000); // newest first
  const parsed = parseChargingHistory(entry.data, { vin: 'V1' });
  assert.equal(parsed.recognized, 101);
});

test('runBackfill: stores results, and keeps the records fetched before an error', async () => {
  const db = openDb(':memory:');
  const api = fakeApi({ failAt: 3 });
  const request = (method, path) => {
    assert.equal(method, 'GET');
    const u = new URL(`https://x${path}`);
    assert.equal(u.pathname, '/api/1/dx/charging/history');
    const p = Object.fromEntries(u.searchParams);
    return api.fetchPage({ ...p, pageNo: Number(p.pageNo), pageSize: Number(p.pageSize) });
  };
  await assert.rejects(runBackfill(db, request, { pageSize: 50, now: 5 }), /503/);
  const arc = loadArchive(db);
  assert.equal(Object.keys(arc.records).length, 100);
  assert.match(arc.backfill.error, /503/);

  const ok = await runBackfill(db, (m, path) => request(m, path), { pageSize: 50, now: 6 });
  assert.equal(ok.error, null);
  assert.equal(ok.archived, 120);
  assert.equal(ok.added, 20);
});

test('chargingHistoryPath: plain path without params, encoded query with them', () => {
  assert.equal(chargingHistoryPath(), '/api/1/dx/charging/history');
  assert.equal(chargingHistoryPath({ startTime: '2023-01-01T00:00:00Z', pageNo: 0 }), '/api/1/dx/charging/history?startTime=2023-01-01T00%3A00%3A00Z&pageNo=0');
});

test('monthlyTotals: groups bills by UTC month, newest first', () => {
  const parsed = parseChargingHistory({ data: [rec(1, '2024-03-02T10:00:00Z', 10), rec(2, '2024-03-30T23:00:00Z', 5.5), rec(3, '2023-12-01T00:00:00Z', 7)] });
  assert.deepEqual(monthlyTotals(parsed), [
    { month: '2024-03', sessions: 2, kwh: 40, cost: { USD: 15.5 } },
    { month: '2023-12', sessions: 1, kwh: 20, cost: { USD: 7 } },
  ]);
  assert.deepEqual(monthlyTotals(null), []);
});
