import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeValue } from '../server/store.js';
import { parseTopic, handleMessage } from '../server/ingest/mqtt.js';
import { mapBleState, ingestBle } from '../server/ingest/ble.js';
import { memStore } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config.js';
import { createApp } from '../server/index.js';

test('normalizeValue coerces numeric fields and keeps enums', () => {
  assert.equal(normalizeValue('Soc', '71.5'), 71.5);
  assert.equal(normalizeValue('Soc', 'nope'), null);
  assert.equal(normalizeValue('Gear', 'ShiftStateP'), 'ShiftStateP');
  assert.equal(normalizeValue('Locked', 'true'), true);
  assert.equal(normalizeValue('Soc', null), null);
});

test('parseTopic follows the fleet-telemetry MQTT layout', () => {
  assert.deepEqual(parseTopic('telemetry', 'telemetry/VIN1/v/Soc'), { vin: 'VIN1', kind: 'field', name: 'Soc' });
  assert.deepEqual(parseTopic('telemetry', 'telemetry/VIN1/connectivity'), { vin: 'VIN1', kind: 'connectivity' });
  assert.deepEqual(parseTopic('telemetry', 'telemetry/VIN1/alerts/Foo/current'), { vin: 'VIN1', kind: 'alert', name: 'Foo' });
  assert.equal(parseTopic('telemetry', 'other/VIN1/v/Soc'), null);
  assert.equal(parseTopic('a/b', 'a/b/VIN1/v/Gear').name, 'Gear');
});

test('handleMessage stores JSON values and ignores other VINs', () => {
  const { store } = memStore();
  const ctx = { store, base: 'telemetry', vin: 'VIN1' };
  assert.equal(handleMessage(ctx, 'telemetry/VIN1/v/Soc', Buffer.from('80.2')), true);
  assert.equal(handleMessage(ctx, 'telemetry/VIN1/v/Location', Buffer.from('{"latitude":37.1,"longitude":-122.2}')), true);
  assert.equal(handleMessage(ctx, 'telemetry/VIN2/v/Soc', Buffer.from('10')), false);
  assert.equal(handleMessage(ctx, 'telemetry/VIN1/v/Soc', Buffer.from('not json')), false);
  assert.equal(store.get('Soc'), 80.2);
  assert.deepEqual(store.get('Location'), { latitude: 37.1, longitude: -122.2 });
  assert.equal(store.entry('Soc').source, 'TEL');
});

test('handleMessage passes connectivity events through', () => {
  const { store } = memStore();
  let got;
  handleMessage({ store, base: 'telemetry', vin: '', onConnectivity: (c) => { got = c; } },
    'telemetry/VIN1/connectivity', Buffer.from('{"ConnectionId":"x","Status":"CONNECTED","CreatedAt":1}'));
  assert.equal(got.Status, 'CONNECTED');
});

test('an older value does not replace a newer one in latest', () => {
  const { store } = memStore();
  store.put('Soc', 60, 2000, 'TEL');
  store.put('Soc', 50, 1000, 'BLE');
  assert.equal(store.get('Soc'), 60);
  assert.equal(store.history('Soc', 0).length, 2);
});

test('mapBleState maps tesla-control protojson to telemetry names', () => {
  const out = mapBleState('state:closures', {
    closuresState: { locked: false, windowOpenDriverFront: true, windowOpenPassengerFront: false, sentryModeState: { Armed: {} } },
    chargeState: { usableBatteryLevel: 77, batteryLevel: 78, chargeLimitSoc: 80 },
    tirePressureState: { tpmsPressureFl: 2.9 },
    climateState: { insideTempCelsius: 21.5 },
  });
  assert.equal(out.Locked, false);
  assert.equal(out.FdWindow, 'WindowStateOpened');
  assert.equal(out.FpWindow, 'WindowStateClosed');
  assert.equal(out.SentryMode, 'SentryModeStateArmed');
  assert.equal(out.Soc, 77);
  assert.equal(out.TpmsPressureFl, 2.9);
  assert.equal(out.InsideTemp, 21.5);
  assert.deepEqual(mapBleState('body-controller-state', { vehicleLockState: 'VEHICLELOCKSTATE_LOCKED' }), { Locked: true });
});

test('ingestBle stores with source BLE', () => {
  const { store } = memStore();
  ingestBle(store, { kind: 'state:charge', data: { chargeState: { usableBatteryLevel: 55 } }, ts: 5000 });
  assert.deepEqual(store.entry('Soc'), { value: 55, ts: 5000, source: 'BLE' });
});

test('mapBleState reads the recommended pressure and last-seen times from TirePressureState', () => {
  const out = mapBleState('state:tire-pressure', { tirePressureState: {
    tpmsPressureFl: 2.9, tpmsRcpFrontValue: 2.9, tpmsRcpRearValue: 3.0, tpmsLastSeenPressureTimeFl: '2026-10-24T13:00:00Z',
  } });
  assert.equal(out.TpmsRcpFront, 2.9);
  assert.equal(out.TpmsRcpRear, 3.0);
  assert.equal(out.TpmsLastSeenPressureTimeFl, '2026-10-24T13:00:00Z');
});

test('the last connectivity event survives a restart', () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'conn-')), 'plaid.db');
  const cfg = { ...config, sampleMode: false, tesla: { ...config.tesla, clientId: '', clientSecret: '' } };
  createApp(cfg, { dbFile }).setConnectivity({ ConnectionId: 'x', Status: 'CONNECTED', CreatedAt: 123 });
  assert.deepEqual(createApp(cfg, { dbFile }).connectivity, { status: 'CONNECTED', at: 123 });
});
