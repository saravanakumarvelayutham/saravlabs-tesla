import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertLabel, findArray, parseRecentAlerts, parseReleaseNotes, StreamedAlerts, toMs } from '../server/derive/vehicle-log.js';
import { handleMessage } from '../server/ingest/mqtt.js';
import { sampleNotes, seedSampleNotes } from '../server/ingest/sample-notes.js';
import { kvGet } from '../server/db.js';
import { memStore } from './helpers.js';

test('findArray finds the named list under one or two response wrappers', () => {
  assert.deepEqual(findArray({ response: { release_notes: [{ a: 1 }] } }, 'release_notes'), { items: [{ a: 1 }], matched: 'release_notes' });
  assert.equal(findArray({ response: { response: { release_notes: [{ a: 1 }] } } }, 'release_notes').matched, 'release_notes');
  assert.deepEqual(findArray({ response: { notes: [{ b: 2 }] } }, 'release_notes'), { items: [{ b: 2 }], matched: 'guess' });
  assert.deepEqual(findArray({ response: { ok: true } }, 'release_notes'), { items: [], matched: null });
  assert.deepEqual(findArray(null, 'release_notes'), { items: [], matched: null });
});

test('toMs reads ISO strings, epoch seconds and epoch milliseconds', () => {
  assert.equal(toMs('2026-10-20T10:00:00Z'), Date.UTC(2026, 9, 20, 10));
  assert.equal(toMs(1_790_000_000), 1_790_000_000_000);
  assert.equal(toMs(1_790_000_000_000), 1_790_000_000_000);
  assert.equal(toMs('1790000000'), 1_790_000_000_000);
  assert.equal(toMs('not a date'), null);
  assert.equal(toMs(undefined), null);
});

test('parseReleaseNotes keeps known fields and drops non-https images', () => {
  const { notes, matched } = parseReleaseNotes({ response: { release_notes: [
    { title: 'Dashcam', subtitle: 'New', description: 'Text', customer_version: '2026.32.4', image_url: 'https://example.com/a.png' },
    { name: 'Fixes', body: 'More', version: '2026.32.5', image_url: 'http://example.com/b.png' },
    'not an object',
  ] } });
  assert.equal(matched, 'release_notes');
  assert.equal(notes.length, 2);
  assert.deepEqual(notes[0], { title: 'Dashcam', subtitle: 'New', description: 'Text', version: '2026.32.4', image: 'https://example.com/a.png' });
  assert.equal(notes[1].title, 'Fixes');
  assert.equal(notes[1].description, 'More');
  assert.equal(notes[1].image, null);
});

test('parseRecentAlerts sorts newest first and reads audience as a list', () => {
  const { alerts } = parseRecentAlerts({ response: { recent_alerts: [
    { name: 'Old_One', time: '2026-10-01T00:00:00Z', audience: ['customer'] },
    { name: 'VCFRONT_a180_lowVoltageBatteryWarning', time: '2026-10-10T00:00:00Z', audience: 'service', user_text: 'Low voltage battery' },
    { name: 'No_Time' },
  ] } });
  assert.deepEqual(alerts.map((a) => a.name), ['VCFRONT_a180_lowVoltageBatteryWarning', 'Old_One', 'No_Time']);
  assert.deepEqual(alerts[0].audience, ['service']);
  assert.equal(alerts[0].text, 'Low voltage battery');
  assert.equal(alerts[2].ts, null);
});

test('alertLabel makes a readable name from an alert code', () => {
  assert.equal(alertLabel('VCFRONT_a180_lowVoltageBatteryWarning'), 'Low voltage battery warning');
  assert.equal(alertLabel('Sample_Charge_Complete'), 'Sample charge complete');
  assert.equal(alertLabel('ABC'), 'Abc');
  assert.equal(alertLabel(''), 'Unnamed alert');
});

test('streamed telemetry alerts are stored, updated when they end, and capped', () => {
  const { db } = memStore();
  const s = new StreamedAlerts(db);
  s.record('BMS_a066_cellTempHigh', { StartedAt: '2026-10-20T10:00:00Z', Audiences: ['Customer'] }, 1000);
  assert.equal(s.list()[0].active, true);
  s.record('BMS_a066_cellTempHigh', { StartedAt: '2026-10-20T10:00:00Z', EndedAt: '2026-10-20T10:30:00Z', Audiences: ['Customer'] }, 2000);
  const [a] = s.list();
  assert.equal(s.list().length, 1);
  assert.equal(a.active, false);
  assert.equal(a.ended - a.started, 30 * 60_000);
  assert.equal(a.received, 1000);
  for (let i = 0; i < 210; i++) s.record(`X_${i}`, { StartedAt: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString() }, 3000);
  assert.equal(kvGet(db, 'streamedAlerts').length, 200);
  assert.equal(s.list(1)[0].name, 'X_209');
});

test('an MQTT alert message reaches the streamed alert store', () => {
  const { db, store } = memStore();
  const s = new StreamedAlerts(db);
  const ctx = { store, base: 'telemetry', vin: 'VIN1', onAlert: (name, a) => s.record(name, a) };
  assert.equal(handleMessage(ctx, 'telemetry/VIN1/alerts/DI_a175_tireWarning/current', Buffer.from('{"StartedAt":"2026-10-20T10:00:00Z","Audiences":["Customer"]}')), true);
  assert.equal(s.list()[0].name, 'DI_a175_tireWarning');
});

test('sample notes parse with the same code as real responses', () => {
  const { db } = memStore();
  const s = new StreamedAlerts(db);
  seedSampleNotes(db, s, Date.UTC(2026, 9, 24));
  const notes = parseReleaseNotes(kvGet(db, 'cache:release_notes').data);
  const alerts = parseRecentAlerts(kvGet(db, 'cache:recent_alerts').data);
  assert.equal(notes.notes.length, sampleNotes().release_notes.data.response.release_notes.length);
  assert.equal(alerts.alerts.length, 4);
  assert.ok(kvGet(db, 'cache:release_notes').sample);
  assert.equal(s.list().filter((a) => a.active).length, 1);
});
