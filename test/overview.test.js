import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drivingInsights, rangeInsight, chargingInsight, overnightInsight } from '../web/js/vehicle-insights.js';
import { renderOverview } from '../web/js/views/overview.js';
import { actions } from '../web/js/core.js';
const now = Date.UTC(2026, 9, 25, 12);
const trip = (miles, kwh, end_ts = now - 1000) => ({ miles, kwh, end_ts });
const signals = { EnergyRemaining: { value: 60, ts: now }, Soc: { value: 60, ts: now } };
const state = { signals, meta: { sample_mode: true } };

test('range uses the distribution of qualifying drives and preserves a 10-point reserve', () => {
  const trips = [200, 250, 300, 350, 400].map((wh) => trip(10, wh / 100));
  const d = drivingInsights(trips, now);
  assert.deepEqual([d.low, d.median, d.high], [250, 300, 350]);
  const r = rangeInsight(d, signals, now);
  assert.equal(r.usable, 50);
  assert.equal(r.typical, 50000 / 300);
  assert.equal(r.low, 50000 / 350);
  assert.equal(r.high, 200);
  assert.equal(rangeInsight(d, { ...signals, Soc: { value: 8, ts: now } }, now).typical, 0);
});

test('range withholds stale, future, missing, or invalid live values', () => {
  const d = drivingInsights(Array.from({ length: 5 }, () => trip(10, 3)), now);
  for (const entry of [{ value: 60, ts: now - 900001 }, { value: 60, ts: now + 1 }, { value: null, ts: now }, { value: Infinity, ts: now }]) {
    assert.equal(rangeInsight(d, { ...signals, EnergyRemaining: entry }, now), null);
  }
  assert.equal(rangeInsight(d, {}, now), null);
  assert.equal(rangeInsight(d, { ...signals, Soc: { value: 10, ts: now - 121000 } }, now), null);
  assert.equal(rangeInsight(d, { ...signals, Soc: { value: 0, ts: now } }, now), null);
});

test('recent range sample excludes incomplete, old, tiny and net-gain trips', () => {
  const trips = [trip(10, 3), trip(10, 3, null), trip(10, 3, now + 1), trip(10, 3, now - 31 * 86400000), trip(.5, .2), trip(10, -1), trip(10, NaN)];
  const d = drivingInsights(trips, now);
  assert.equal(d.count, 1);
  assert.equal(d.median, null);
  assert.equal(rangeInsight(d, signals, now), null);
});

test('short-trip comparison is distance weighted and requires three trips per group', () => {
  const trips = [trip(1, .6), trip(2, .8), trip(4, 1.4), trip(10, 2), trip(20, 4), trip(30, 6)];
  const d = drivingInsights(trips, now);
  assert.equal(d.short.wh, 400);
  assert.equal(d.long.wh, 200);
  assert.equal(d.shortDelta, 100);
  assert.equal(drivingInsights(trips.slice(1), now).shortDelta, null);
});

test('charging comparison uses observed SOC bins without extrapolating missing bands', () => {
  const curve = [[80, 60], [20, 200], [75, 100], [30, 160], [105, 20], [40, null]];
  const result = chargingInsight(curve);
  assert.equal(result.comparison.earlyKw, 180);
  assert.equal(result.comparison.lateKw, 80);
  assert.equal(result.comparison.drop, (1 - 80 / 180) * 100);
  assert.deepEqual(result.points.map((p) => p[0]), [20, 30, 75, 80]);
  assert.equal(curve[0][0], 80);
  assert.equal(chargingInsight([[20, 200], [80, 60]]).comparison, null);
});

test('overnight equivalence is an energy estimate and skips invalid nights', () => {
  const d = { median: 250 };
  const drain = { nights: [
    { valid: true, sentry: true, drain_pct: 2 }, { valid: true, sentry: true, drain_pct: 4 },
    { valid: true, sentry: false, drain_pct: .5 }, { valid: true, sentry: false, drain_pct: .5 },
    { valid: false, sentry: true, drain_pct: 99 },
  ] };
  const n = overnightInsight(drain, d, { latest_kwh: 100 });
  assert.equal(n.difference, 2.5);
  assert.equal(n.on.miles, 12);
  assert.equal(n.off.miles, 2);
  assert.equal(overnightInsight(drain, d, null).on.miles, null);
  const negative = overnightInsight({ nights: [{ valid: true, sentry: false, drain_pct: -.5 }] }, d, { latest_kwh: 100 });
  assert.equal(negative.off.avg, -.5);
  assert.equal(negative.off.miles, null);
  assert.equal(negative.difference, null);
});

test('empty insight dashboard explains evidence requirements without fabricated readings', () => {
  const html = renderOverview({}, state, now);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.match(html, /0\/5 qualifying/);
  assert.match(html, /SIMULATED DATA/);
  assert.equal((html.match(/<article /g) || []).length, 6);
  assert.equal((html.match(/<details /g) || []).length, 6);
});

test('render preserves warnings and escapes telemetry labels', () => {
  const html = renderOverview({ tires: {
    hard_warnings: ['FL'], series: { FL: [[1, 42], [2, 39]] },
    leaks: [{ tire: '<script>', psi_per_day: -.1, drop_psi: 3, days: 10 }],
  } }, state, now);
  assert.match(html, /Your car reports a tire-pressure warning/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test('regen headline identifies partial trip coverage', () => {
  const html = renderOverview({ trips: { trips: [], week: { this_week: {
    regen_share: .25, regen_kwh: 2, regen_trips: 1, trips: 20, regen_source: 'pack_power',
  } } } }, state, now);
  assert.match(html, /25% of energy on measured trips came back/);
  assert.match(html, /Regen coverage: <strong>1 trip<\/strong>/);
});

test('comparisons adapt to available local drives and partial charging curves', () => {
  const d = drivingInsights([...Array.from({ length: 3 }, () => trip(20, 6)), ...Array.from({ length: 3 }, () => trip(70, 28))], now);
  assert.equal(d.split.shortMax, 25);
  assert.equal(d.shortDelta, -25);
  const c = chargingInsight([[50, 140], [55, 130], [60, 120], [65, 110], [70, 100], [75, 90]]).comparison;
  assert.equal(c.earlyLabel, '50–55%');
  assert.equal(c.lateLabel, '70–75%');
  assert.equal(c.earlyKw, 135);
  assert.equal(c.lateKw, 95);
  assert.equal(chargingInsight([[50, 140], [51, 130], [52, 120], [53, 110], [54, 100], [55, 90]]).comparison, null);
});

test('expanded evidence survives telemetry rerenders and toggles closed', () => {
  actions['insight-evidence']({ dataset: { insight: 'range' } });
  assert.match(renderOverview({}, state, now), /class="intel-method" open><summary[^>]+data-insight="range"/);
  assert.match(renderOverview({}, { ...state, signals: {} }, now), /class="intel-method" open><summary[^>]+data-insight="range"/);
  actions['insight-evidence']({ dataset: { insight: 'range' } });
  assert.doesNotMatch(renderOverview({}, state, now), /class="intel-method" open/);
});
