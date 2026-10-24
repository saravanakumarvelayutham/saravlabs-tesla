import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { createApp } from '../server/index.js';
import { monthCosts } from '../server/http.js';
import { costBetween, matchSession, parseChargingHistory } from '../server/derive/supercharger.js';
import { sampleFleetCache } from '../server/ingest/sample.js';

// One record in the shape community clients describe. Tesla publishes no format, so these
// tests pin the parser's behavior, not Tesla's real response.
const rec = (o = {}) => ({
  sessionId: 1, vin: 'V1', siteLocationName: 'Gilroy, CA',
  chargeStartDateTime: '2026-10-05T10:00:00Z', chargeStopDateTime: '2026-10-05T10:30:00Z',
  fees: [
    { feeType: 'CHARGING', currencyCode: 'USD', uom: 'kwh', usageBase: 40, totalDue: 19.2 },
    { feeType: 'PARKING', currencyCode: 'USD', uom: 'min', usageBase: 4, totalDue: 4 },
  ],
  ...o,
});

test('charging_history: reads records inside any of the common envelopes', () => {
  for (const raw of [{ data: [rec()] }, { response: { data: [rec()] } }, { response: [rec()] }, [rec()]]) {
    const p = parseChargingHistory(raw, { vin: 'V1' });
    assert.equal(p.recognized, 1);
    const [s] = p.sessions;
    assert.equal(s.cost, 23.2); // charging + idle/parking fees
    assert.equal(s.currency, 'USD');
    assert.equal(s.kwh, 40); // only kWh charging fees count as energy
    assert.equal(s.site, 'Gilroy, CA');
    assert.equal(s.start_ts, Date.parse('2026-10-05T10:00:00Z'));
  }
});

test('charging_history: an unknown shape is reported as unrecognized, never as $0', () => {
  const p = parseChargingHistory({ data: [{ foo: 1 }, { chargeStartDateTime: '2026-10-05T10:00:00Z' }] });
  assert.equal(p.total_records, 2);
  assert.equal(p.recognized, 0);
  assert.equal(p.unrecognized, 2);
  assert.deepEqual(parseChargingHistory(null).sessions, []);
  assert.deepEqual(parseChargingHistory({ error: 'x' }).sessions, []);
});

test('charging_history: other vehicles on the account are skipped, not counted', () => {
  const p = parseChargingHistory({ data: [rec(), rec({ sessionId: 2, vin: 'OTHER' })] }, { vin: 'V1' });
  assert.equal(p.recognized, 1);
  assert.equal(p.unrecognized, 0);
});

test('charging_history: numeric strings parse, garbage amounts do not add up', () => {
  const p = parseChargingHistory({ data: [rec({ fees: [{ feeType: 'CHARGING', currencyCode: 'USD', uom: 'kwh', usageBase: '10.5', totalDue: '5.04' }, { totalDue: 'n/a' }] })] });
  assert.equal(p.sessions[0].cost, 5.04);
  assert.equal(p.sessions[0].kwh, 10.5);
});

test('costBetween groups by currency and respects the window', () => {
  const p = parseChargingHistory({ data: [
    rec(),
    rec({ sessionId: 2, chargeStartDateTime: '2026-10-06T10:00:00Z', fees: [{ currencyCode: 'CAD', totalDue: 10 }] }),
    rec({ sessionId: 3, chargeStartDateTime: '2026-10-07T10:00:00Z', fees: [{ totalDue: 3 }] }),
    rec({ sessionId: 4, chargeStartDateTime: '2026-11-01T10:00:00Z' }),
  ] });
  assert.deepEqual(costBetween(p, Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-11-01T00:00:00Z')), { USD: 23.2, CAD: 10, unknown: 3 });
});

test('matchSession picks the closest record within 30 minutes', () => {
  const p = parseChargingHistory({ data: [rec(), rec({ sessionId: 2, chargeStartDateTime: '2026-10-05T10:20:00Z' })] });
  const t = Date.parse('2026-10-05T10:15:00Z');
  assert.equal(matchSession(p, t).id, '2');
  assert.equal(matchSession(p, t + 3 * 3600_000), null);
  assert.equal(matchSession(null, t), null);
});

// --- month totals and cost per mile ---

function setup({ rate = 0.25 } = {}) {
  const app = createApp({ ...config, sampleMode: false, vin: 'V1', homeRatePerKwh: rate, currency: 'USD', tesla: { ...config.tesla, clientId: '', clientSecret: '' } }, { dbFile: ':memory:' });
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const h = (n) => from + n * 3600_000;
  const charge = (start, o) => app.db.prepare(`INSERT INTO charges (start_ts, end_ts, at_home, dc, fast_charger, energy_battery_kwh, energy_wall_kwh, curve)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`).run(start, start + 1800_000, o.home ? 1 : 0, o.dc ? 1 : 0, o.dc ? 'FastChargerSupercharger' : null, o.kwh, o.home ? o.kwh : null);
  const trip = (start, miles) => app.db.prepare('INSERT INTO trips (start_ts, end_ts, start_odo, end_odo, start_energy, end_energy) VALUES (?, ?, ?, ?, ?, ?)')
    .run(start, start + 3600_000, 1000, 1000 + miles, 80, 80 - miles * 0.3);
  charge(h(1), { home: true, kwh: 40 }); // $10 at 0.25
  charge(h(30), { dc: true, kwh: 50 });
  trip(h(5), 100);
  trip(h(40), 150);
  const month = () => app.charging.monthSummary(now.getFullYear(), now.getMonth());
  const hist = (records) => parseChargingHistory({ data: records }, { vin: 'V1' });
  return { app, h, month, hist, charge };
}

test('month: home + billed Supercharger give total and cost per mile', () => {
  const { app, h, month, hist } = setup();
  const m = monthCosts(app, month(), hist([rec({ chargeStartDateTime: new Date(h(30) + 60_000).toISOString() })]));
  assert.equal(m.dc_cost, 23.2);
  assert.equal(m.dc_unmatched, 0);
  assert.equal(m.total_cost, 33.2);
  assert.equal(m.miles, 250);
  assert.equal(Math.round(m.cost_per_mile * 10000) / 10000, 0.1328);
  assert.deepEqual(m.missing, []);
});

test('month: no charging history means no Supercharger cost and no total', () => {
  const { app, month } = setup();
  const m = monthCosts(app, month(), null);
  assert.equal(m.dc_cost, null);
  assert.equal(m.total_cost, null);
  assert.equal(m.cost_per_mile, null);
  assert.deepEqual(m.missing, ["Tesla's charging history"]);
});

test('month: a Supercharger session with no Tesla record blocks the total instead of counting as $0', () => {
  const { app, h, month, hist, charge } = setup();
  charge(h(50), { dc: true, kwh: 30 });
  const m = monthCosts(app, month(), hist([rec({ chargeStartDateTime: new Date(h(30)).toISOString() })]));
  assert.equal(m.dc_cost, 23.2); // what is billed so far
  assert.equal(m.dc_unmatched, 1);
  assert.equal(m.total_cost, null);
  assert.deepEqual(m.missing, ['Tesla records for 1 of 2 Supercharger sessions']);
});

test('month: history read but nothing recognized gives no Supercharger cost', () => {
  const { app, month } = setup();
  const m = monthCosts(app, month(), parseChargingHistory({ data: [{ unexpected: true }] }));
  assert.equal(m.dc_cost, null);
  assert.equal(m.total_cost, null);
});

test('month: charges in another currency are listed separately and block the total', () => {
  const { app, h, month, hist } = setup();
  const m = monthCosts(app, month(), hist([rec({ chargeStartDateTime: new Date(h(30)).toISOString(), fees: [{ currencyCode: 'CAD', totalDue: 30 }] })]));
  assert.deepEqual(m.dc_other_currencies, { CAD: 30 });
  assert.equal(m.total_cost, null);
});

test('month: without a home rate the total waits for it', () => {
  const { app, h, month, hist } = setup({ rate: 0 });
  const m = monthCosts(app, month(), hist([rec({ chargeStartDateTime: new Date(h(30)).toISOString() })]));
  assert.equal(m.dc_cost, 23.2);
  assert.equal(m.total_cost, null);
  assert.deepEqual(m.missing, ['your home rate (HOME_RATE_PER_KWH)']);
});

test('sample charging history covers every simulated Supercharger session', () => {
  const { app, h } = setup();
  const { charging_history: c } = sampleFleetCache(app.db, { vin: 'V1' });
  assert.equal(c.sample, true);
  const p = parseChargingHistory(c.data, { vin: 'V1' });
  assert.equal(p.recognized, 1);
  assert.ok(matchSession(p, h(30)));
});

test('GET /api/charging returns month costs, matched session costs and a history summary', async () => {
  const { createServer } = await import('../server/http.js');
  const { kvSet } = await import('../server/db.js');
  const { app, h } = setup();
  kvSet(app.db, 'cache:charging_history', { ts: 1, data: { data: [rec({ chargeStartDateTime: new Date(h(30)).toISOString() }), { junk: 1 }] } });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/charging`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.month.total_cost, 33.2);
    assert.equal(body.month.miles, 250);
    assert.deepEqual(body.tesla_history, { ts: 1, sample: false, total_records: 2, recognized: 1, unrecognized: 1 });
    const dc = body.sessions.find((s) => s.dc);
    assert.equal(dc.tesla_cost, 23.2);
    assert.equal(dc.site, 'Gilroy, CA');
  } finally {
    server.close();
  }
});
