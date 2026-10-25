import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargingGraphic, drainGraphic, efficiencyGraphic } from '../web/js/views/overview.js';

test('overview distinguishes unavailable summaries from measured zero', () => {
  for (const render of [chargingGraphic, drainGraphic, efficiencyGraphic]) {
    const html = render(null);
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
    assert.match(html, /—/);
  }
  const zero = chargingGraphic({ home: { sessions: 0 }, dc: { sessions: 0 }, other: { sessions: 0 } });
  assert.match(zero, /No completed charging sessions/);
  assert.doesNotMatch(zero, /stroke-dasharray/);
  assert.match(drainGraphic({ sentry_avg: 0, nights: [{ valid: true, sentry: true }] }), /0\.0%/);
});

test('charging mix includes away AC and uses session shares, not incompatible energy totals', () => {
  const html = chargingGraphic({ home: { sessions: 2, kwh: 100 }, dc: { sessions: 1, kwh: 500 }, other: { sessions: 1 }, cost_per_mile: 0.125 }, 'USD');
  assert.match(html, /4 charging sessions/);
  assert.match(html, /stroke-dasharray="50 50"/);
  assert.equal((html.match(/stroke-dasharray="25 75"/g) || []).length, 2);
  assert.match(html, /Other AC/);
  assert.match(html, /0\.125/);
});

test('efficiency comparison handles negative energy and missing baselines', () => {
  const week = { this_week: { wh_per_mile: 240, miles: 20, trips: 2 }, last_week: { wh_per_mile: 300 }, weekly: [{ weeks_ago: 0, wh_per_mile: 240 }, { weeks_ago: 1, wh_per_mile: -50 }] };
  const html = efficiencyGraphic(week);
  assert.match(html, /20\.0% less energy/);
  assert.match(html, />-50</);
  assert.doesNotMatch(html, /height:-/);
  assert.equal(week.weekly[0].weeks_ago, 0);
  assert.match(efficiencyGraphic({ ...week, last_week: { wh_per_mile: 0 } }), /Comparison needs/);
});

test('overnight comparison counts only qualifying nights and preserves negative readings', () => {
  const html = drainGraphic({ sentry_avg: 2, no_sentry_avg: -0.2, nights: [
    { valid: true, sentry: true }, { valid: false, sentry: true }, { valid: true, sentry: false },
  ] });
  assert.equal((html.match(/1 qualifying night/g) || []).length, 2);
  assert.match(html, /-0\.2%/);
  assert.match(html, /net battery gain/);
  assert.doesNotMatch(html, /width:-/);
});
