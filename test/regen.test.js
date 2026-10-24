import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Trips } from '../server/derive/trips.js';
import { integratePackPower, regenFor, regenFromCounter, regenTotal } from '../server/derive/regen.js';
import { Sample } from '../server/ingest/sample.js';
import { memStore, feed } from './helpers.js';

const T0 = new Date('2026-10-01T08:00:00').getTime();
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// A 10 minute trip: 400 V, 100 A out for 5 min (3.333 kWh), 50 A back for 2 min (0.667 kWh),
// then idle. Net use 2.667 kWh, which is what EnergyRemaining drops by.
function packTrip(store, { sign = 1, scale = 1, counter = false } = {}) {
  const rows = [
    ['Odometer', 1000, 0], ['EnergyRemaining', 80, 0], ['PackVoltage', 400, 0], ['PackCurrent', 0, 0],
    ['Gear', 'ShiftStateD', 1],
    ['PackCurrent', sign * 100 * scale, 1],
    ['PackCurrent', -sign * 50 * scale, 6],
    ['PackCurrent', 0, 8],
    ['Odometer', 1008, 10], ['EnergyRemaining', 80 - 8 / 3, 10],
    ['Gear', 'ShiftStateP', 11],
  ];
  if (counter) rows.push(['LifetimeEnergyGainedRegen', 500, 0], ['LifetimeEnergyGainedRegen', 500.9, 11.5]);
  feed(store, T0, rows.sort((a, b) => a[2] - b[2]));
}

test('trip regen comes from LifetimeEnergyGainedRegen when the car sends it', () => {
  const { db, store } = memStore();
  const trips = new Trips(db, store);
  packTrip(store, { counter: true });
  const t = trips.get(trips.list()[0].id);
  assert.equal(t.regen_source, 'counter');
  near(t.regen_kwh, 0.9); // the reading 30 s after Park still counts (finalize window)
  near(t.regen_share, 0.9 / (8 / 3 + 0.9));
});

test('without the counter, trip regen is estimated from PackVoltage × PackCurrent', () => {
  const { db, store } = memStore();
  const trips = new Trips(db, store);
  packTrip(store);
  const t = trips.get(trips.list()[0].id);
  assert.equal(t.regen_source, 'pack_power');
  near(t.regen_kwh, 2 / 3);
  near(t.regen_share, (2 / 3) / (8 / 3 + 2 / 3)); // 20%
  near(t.regen_check, 1, 1e-3); // integrated net matches the EnergyRemaining drop
});

test('the pack-power estimate works whichever way Tesla signs the current', () => {
  const { db, store } = memStore();
  const trips = new Trips(db, store);
  packTrip(store, { sign: -1 });
  const t = trips.get(trips.list()[0].id);
  assert.equal(t.regen_source, 'pack_power');
  near(t.regen_kwh, 2 / 3);
});

test('the pack-power estimate is dropped when its units disagree with EnergyRemaining', () => {
  const { db, store } = memStore();
  const trips = new Trips(db, store);
  packTrip(store, { scale: 10 }); // e.g. current reported in tenths of an amp
  const t = trips.get(trips.list()[0].id);
  assert.equal(t.regen_kwh, null);
  assert.equal(t.regen_share, null);
  assert.equal(t.regen_source, null);
  near(t.regen_check, 10, 1e-3);
});

test('no counter and no pack signals means no regen figure, not zero', () => {
  const { db, store } = memStore();
  const trips = new Trips(db, store);
  feed(store, T0, [['Odometer', 1, 0], ['EnergyRemaining', 80, 0], ['Gear', 'ShiftStateD', 1], ['Odometer', 9, 10], ['EnergyRemaining', 77, 10], ['Gear', 'ShiftStateP', 11]]);
  const t = trips.get(trips.list()[0].id);
  assert.deepEqual([t.regen_kwh, t.regen_share, t.regen_source], [null, null, null]);
});

test('a counter that stopped streaming before the trip gives no figure', () => {
  const { store } = memStore();
  feed(store, T0, [['LifetimeEnergyGainedRegen', 500, 0]]);
  assert.equal(regenFromCounter(store, T0 + 60_000, T0 + 20 * 60_000), null);
});

test('a current reading holds for at most 5 min across a gap', () => {
  const { store } = memStore();
  feed(store, T0, [['PackVoltage', 400, 0], ['PackCurrent', 100, 0], ['PackCurrent', 100, 20]]);
  const p = integratePackPower(store, T0, T0 + 20 * 60_000);
  near(p.pos, (400 * 100 * 300) / 3600 / 1000); // 5 min held, not 20
});

test('regenFor needs enough net energy to check the units against', () => {
  const { store } = memStore();
  feed(store, T0, [['PackVoltage', 400, 0], ['PackCurrent', 100, 0], ['PackCurrent', 0, 0.1]]);
  assert.equal(regenFor(store, T0, T0 + 60_000, 0.05).regen_kwh, null);
});

test('weekly totals add up the trips that have a regen figure', () => {
  const r = regenTotal([
    { kwh: 4, regen_kwh: 1, regen_source: 'counter' },
    { kwh: 2, regen_kwh: 0.5, regen_source: 'pack_power' },
    { kwh: 3, regen_kwh: null, regen_source: null },
  ]);
  assert.equal(r.regen_kwh, 1.5);
  near(r.regen_share, 1.5 / 7.5);
  assert.equal(r.regen_source, 'mixed');
  assert.equal(r.regen_trips, 2);
  assert.equal(regenTotal([]).regen_share, null);
});

test('segments carry the mean GradeEstimatePercent over each stretch', () => {
  const { db, store } = memStore();
  const trips = new Trips(db, store);
  feed(store, T0, [
    ['Odometer', 0, 0], ['EnergyRemaining', 80, 0], ['Gear', 'ShiftStateD', 1],
    ['GradeEstimatePercent', 2, 2], ['GradeEstimatePercent', 4, 4],
    ['Odometer', 5, 5], ['EnergyRemaining', 78, 5],
    ['Odometer', 10, 10], ['EnergyRemaining', 77, 10],
    ['Gear', 'ShiftStateP', 11],
  ]);
  const t = trips.get(trips.list()[0].id);
  assert.equal(t.segments[0].grade_pct, 3);
  assert.equal(t.segments[0].miles, 5);
  assert.equal(t.segments[1].grade_pct, null);
});

test('sample drives give a pack-power estimate that passes the units check', () => {
  const { db, store } = memStore();
  const trips = new Trips(db, store);
  const sample = new Sample(store, { regenCounter: false });
  sample.static(T0);
  sample.putBattery(T0);
  sample.put('Odometer', sample.odo, T0);
  sample.drive(T0 + 60_000, 18, { to: 'work', outsideC: 15, place: 'home' });
  assert.equal(store.get('LifetimeEnergyGainedRegen'), null);
  const t = trips.get(trips.list()[0].id);
  assert.equal(t.regen_source, 'pack_power');
  assert.ok(t.regen_check > 0.9 && t.regen_check < 1.1, `check ${t.regen_check}`);
  assert.ok(t.regen_share > 0.02 && t.regen_share < 0.4, `share ${t.regen_share}`);
});
