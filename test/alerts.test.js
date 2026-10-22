import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Alerts } from '../server/derive/alerts.js';
import { Charging } from '../server/derive/charging.js';
import { Health } from '../server/derive/health.js';
import { memStore, feed } from './helpers.js';

const T0 = new Date('2026-10-01T08:00:00').getTime();

function setup() {
  const { db, store } = memStore();
  const sent = [];
  const push = { send: async (m) => { sent.push(m); } };
  const alerts = new Alerts(db, store, { push, health: new Health(db, store), charging: new Charging(db, store, { homeRatePerKwh: 0 }) });
  return { store, alerts, sent };
}

test('unlocked away from home alerts once, after 10 minutes', () => {
  const { store, sent } = setup();
  feed(store, T0, [['Gear', 'ShiftStateP', 0], ['LocatedAtHome', false, 0], ['Locked', false, 1], ['Soc', 70, 5]]);
  assert.equal(sent.length, 0);
  feed(store, T0, [['Soc', 69, 12], ['Soc', 68, 30]]);
  assert.deepEqual(sent.map((m) => m.tag), ['unlocked_away']);
});

test('no away alert at home or once locked', () => {
  const { store, sent } = setup();
  feed(store, T0, [['Gear', 'ShiftStateP', 0], ['LocatedAtHome', true, 0], ['Locked', false, 1], ['Soc', 70, 20]]);
  feed(store, T0, [['LocatedAtHome', false, 21], ['Locked', true, 22], ['Soc', 69, 40]]);
  assert.equal(sent.length, 0);
});

test('a software update is announced once per version', () => {
  const { store, sent } = setup();
  feed(store, T0, [['SoftwareUpdateVersion', '2026.38.2', 0], ['SoftwareUpdateVersion', '2026.38.2', 60], ['SoftwareUpdateVersion', '2026.40.1', 120]]);
  assert.deepEqual(sent.map((m) => m.body), ['Version 2026.38.2 is available.', 'Version 2026.40.1 is available.']);
});
