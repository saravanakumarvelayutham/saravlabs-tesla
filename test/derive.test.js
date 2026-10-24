import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Trips } from '../server/derive/trips.js';
import { Charging } from '../server/derive/charging.js';
import { Health } from '../server/derive/health.js';
import { memStore, feed } from './helpers.js';

const T0 = new Date('2026-10-01T08:00:00').getTime();

test('a trip runs from leaving Park to returning to Park', () => {
  const { db, store } = memStore();
  const trips = new Trips(db, store);
  feed(store, T0, [
    ['Odometer', 1000, 0], ['EnergyRemaining', 80, 0], ['Soc', 80, 0], ['LocatedAtHome', true, 0],
    ['Gear', 'ShiftStateD', 1],
    ['Location', { latitude: 37.4, longitude: -122.1 }, 2], ['VehicleSpeed', 45, 2], ['LocatedAtHome', false, 3],
    ['Odometer', 1005, 8], ['EnergyRemaining', 78.5, 8],
    ['Odometer', 1010, 14], ['EnergyRemaining', 77, 14],
    ['Gear', 'ShiftStateP', 15],
    ['LocatedAtWork', true, 15.5], // arrives just after Park: the finalize window patches it in
  ]);
  const [t] = trips.list();
  assert.equal(t.miles, 10);
  assert.equal(t.kwh, 3);
  assert.equal(t.wh_per_mile, 300);
  assert.equal(t.start_place, 'Home');
  assert.equal(t.end_place, 'Work');
  const full = trips.get(t.id);
  assert.equal(full.route.length, 1);
  assert.deepEqual(full.segments.map((s) => Math.round(s.wh_per_mile)), [300, 300]);
});

test('a DC session records peak power, curve and battery-side kWh', () => {
  const { db, store } = memStore();
  const charging = new Charging(db, store, { homeRatePerKwh: 0.3 });
  let ended;
  charging.onEnd((e) => { ended = e; });
  feed(store, T0, [
    ['Soc', 20, 0], ['FastChargerType', 'FastChargerSupercharger', 0],
    ['DetailedChargeState', 'DetailedChargeStateCharging', 1],
    ['DCChargingPower', 210, 2], ['DCChargingPower', 250, 4], ['ACChargingPower', 11, 4],
    ['DCChargingEnergyIn', 30, 10], ['DCChargingEnergyIn', 42, 20], ['Soc', 70, 20],
    ['DetailedChargeState', 'DetailedChargeStateComplete', 21],
  ]);
  const [c] = charging.list();
  assert.equal(c.dc, true);
  assert.equal(c.peak_kw, 250);
  assert.equal(c.curve_points, 2); // the AC reading is ignored during DC
  assert.equal(c.energy_battery_kwh, 42);
  assert.equal(c.cost, null); // Supercharger cost isn't derived
  assert.equal(ended.state, 'DetailedChargeStateComplete');
});

test('home AC session cost uses wall kWh times your rate', () => {
  const { db, store } = memStore();
  const charging = new Charging(db, store, { homeRatePerKwh: 0.25 });
  feed(store, T0, [
    ['LocatedAtHome', true, 0], ['FastChargerType', 'FastChargerUnknown', 0],
    ['DetailedChargeState', 'DetailedChargeStateCharging', 1],
    ['ACChargingEnergyIn', 20, 60], ['DCChargingEnergyIn', 18.5, 60],
    ['DetailedChargeState', 'DetailedChargeStateComplete', 61],
  ]);
  const [c] = charging.list();
  assert.equal(c.dc, false);
  assert.equal(c.cost, 5);
  assert.equal(c.cost_basis, 'wall kWh x your rate');
});

test('slow leak is flagged on the one tire losing pressure', () => {
  const { db, store } = memStore();
  const health = new Health(db, store);
  const day = 86400_000;
  const bar = (psi) => psi / 14.503773773;
  store.put('Gear', 'ShiftStateP', T0 - 4 * 3600_000, 'TEL');
  for (let d = 0; d < 12; d++) {
    const ts = T0 + d * day;
    store.put('TpmsPressureFl', bar(42 + (d % 2) * 0.1), ts, 'TEL');
    store.put('TpmsPressureFr', bar(42), ts + 1, 'TEL');
    store.put('TpmsPressureRr', bar(41.9), ts + 2, 'TEL');
    store.put('TpmsPressureRl', bar(42 - d * 0.3), ts + 3, 'TEL');
  }
  const t = health.tires(T0 + 11 * day + 3600_000);
  assert.deepEqual(t.leaks.map((l) => l.tire), ['RL']);
  assert.ok(Math.abs(t.leaks[0].psi_per_day + 0.3) < 0.01);
  assert.equal(Math.round(t.current.RL.psi * 10) / 10, 38.7);
});

test('warm readings right after driving are not used for leak detection', () => {
  const { db, store } = memStore();
  const health = new Health(db, store);
  store.put('Gear', 'ShiftStateD', T0, 'TEL');
  store.put('Gear', 'ShiftStateP', T0 + 60_000, 'TEL');
  store.put('TpmsPressureRl', 3.0, T0 + 30 * 60_000, 'TEL'); // 30 min after parking
  assert.equal(health.tires(T0 + 3600_000).series.RL.length, 0);
});

test('battery capacity is estimated from EnergyRemaining and BatteryLevel at 50%+', () => {
  const { db, store } = memStore();
  const health = new Health(db, store);
  feed(store, T0, [['BatteryLevel', 80, 0], ['EnergyRemaining', 76, 0], ['BatteryLevel', 40, 60], ['EnergyRemaining', 38.5, 60]]);
  const b = health.battery(T0 + 2 * 3600_000);
  assert.equal(b.method, 'estimate');
  assert.equal(b.latest_kwh, 95); // the 40% reading is skipped
});

test('weekly regen share is regen over net energy plus regen, from LifetimeEnergyGainedRegen', async () => {
  const { regenShare } = await import('../server/http.js');
  const { store } = memStore();
  feed(store, T0, [['LifetimeEnergyGainedRegen', 100, 0], ['LifetimeEnergyGainedRegen', 102, 60], ['LifetimeEnergyGainedRegen', 103, 120]]);
  // 3 kWh regen in the window, 9 kWh net use: 3 / (9 + 3) = 25%.
  const r = regenShare(store, T0 + 30 * 60_000, T0 + 180 * 60_000, 9);
  assert.equal(r.regen_kwh, 3);
  assert.equal(r.regen_share, 0.25);
  // No reading from before the window: no share rather than a guess.
  assert.equal(regenShare(store, T0 - 60_000, T0 + 180 * 60_000, 9).regen_share, null);
  const { store: empty } = memStore();
  assert.deepEqual(regenShare(empty, T0, T0 + 1, 9), { regen_kwh: null, regen_share: null });
});

test('sample mode sends ChargerVoltage only during AC sessions', async () => {
  const { Sample } = await import('../server/ingest/sample.js');
  const { store } = memStore();
  const sample = new Sample(store);
  const volts = [];
  store.on('signal', (s) => { if (s.field === 'ChargerVoltage') volts.push(s); });
  sample.soc = 30;
  let t = sample.charge(T0, { dc: true, toSoc: 60 });
  assert.equal(volts.length, 0);
  sample.charge(t + 60_000, { dc: false, toSoc: 70 });
  assert.ok(volts.length > 0);
  assert.ok(volts.every((v) => v.value > 200 && v.value < 260));
});
