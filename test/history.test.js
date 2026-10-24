import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalHistory } from '../server/history.js';
import { memStore, feed } from './helpers.js';

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const NOW = T0 + 60 * 60_000;

test('numeric history is bucketed with min, max and mean, skipping invalid data', () => {
  const { store } = memStore();
  // Two hours of speed, one sample a minute; only the last hour is in range.
  for (let m = -60; m < 60; m++) store.put('VehicleSpeed', m === 30 ? 120 : 30, T0 + m * 60_000);
  store.put('VehicleSpeed', null, T0 + 45 * 60_000 + 1);
  const h = signalHistory(store, 'VehicleSpeed', { range: '1h', now: NOW, buckets: 6 });
  assert.equal(h.kind, 'numeric');
  assert.equal(h.from, T0);
  assert.equal(h.bucket_ms, 10 * 60_000);
  assert.equal(h.points.length, 6);
  assert.equal(h.stats.count, 60);
  assert.equal(h.stats.min, 30);
  assert.equal(h.stats.max, 120);
  assert.ok(Math.abs(h.stats.avg - (59 * 30 + 120) / 60) < 1e-9);
  // The launch shows as the max of its bucket while the mean stays near 30.
  const [, av, mn, mx, n] = h.points[3];
  assert.deepEqual([mn, mx, n], [30, 120, 10]);
  assert.ok(Math.abs(av - 39) < 1e-9);
  assert.equal(h.latest.value, 30); // the late null is history only
});

test('numeric history accepts numeric strings stored before coercion and an empty window', () => {
  const { store } = memStore();
  feed(store, T0, [['Soc', '71.5', -120]]);
  const h = signalHistory(store, 'Soc', { range: '1h', now: NOW });
  assert.equal(h.kind, 'numeric');
  assert.deepEqual(h.points, []);
  assert.equal(h.stats.count, 0);
  assert.equal(h.latest.value, 71.5);
});

test('state history lists changes, the value before the window, and time in each state', () => {
  const { store } = memStore();
  feed(store, T0, [
    ['Gear', 'ShiftStateP', -300],
    ['Gear', 'ShiftStateD', 10],
    ['Gear', 'ShiftStateD', 20], // repeat, not a change
    ['Gear', 'ShiftStateR', 40],
    ['Gear', 'ShiftStateP', 45],
  ]);
  const h = signalHistory(store, 'Gear', { range: '1h', now: NOW });
  assert.equal(h.kind, 'state');
  assert.deepEqual(h.initial.value, 'ShiftStateP');
  assert.deepEqual(h.changes.map((c) => c.value), ['ShiftStateD', 'ShiftStateR', 'ShiftStateP']);
  assert.equal(h.stats.count, 4);
  const ms = Object.fromEntries(h.states.map((s) => [s.value, s.ms / 60_000]));
  assert.deepEqual(ms, { ShiftStateP: 25, ShiftStateD: 30, ShiftStateR: 5 });
  assert.equal(h.states.reduce((s, x) => s + x.ms, 0), 60 * 60_000);
});

test('object fields come back as changes without time-in-state', () => {
  const { store } = memStore();
  feed(store, T0, [
    ['Location', { latitude: 37.1, longitude: -122.1 }, 5],
    ['Location', { latitude: 37.2, longitude: -122.2 }, 15],
  ]);
  const h = signalHistory(store, 'Location', { range: '1h', now: NOW });
  assert.equal(h.changes.length, 2);
  assert.equal(h.states, null);
  assert.equal(h.initial, null);
});

test('state history keeps only the newest changes when there are many', () => {
  const { store } = memStore();
  for (let i = 0; i < 30; i++) store.put('Locked', i % 2 === 0, T0 + i * 60_000);
  const h = signalHistory(store, 'Locked', { range: '1h', now: NOW, maxChanges: 10 });
  assert.equal(h.changes.length, 10);
  assert.equal(h.truncated, true);
  assert.equal(h.changes.at(-1).ts, T0 + 29 * 60_000);
});

test('unknown ranges are rejected', () => {
  const { store } = memStore();
  assert.throws(() => signalHistory(store, 'Soc', { range: '3y' }), /range must be one of/);
});
