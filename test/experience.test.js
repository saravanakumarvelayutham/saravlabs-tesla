import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterFor, chapterLinks, experienceView, sceneReadings } from '../web/js/experience.js';

const entry = (value) => ({ value, ts: Date.now() });
const state = (signals = {}, cache = {}) => ({ signals, cache, meta: { sample_mode: true } });

test('charging scene withholds stale power outside an active charging state', () => {
  const signals = { DCChargingPower: entry(180), FastChargerType: entry('FastChargerSupercharger'), TimeToFullCharge: entry(0.5) };
  for (const chargeState of ['DetailedChargeStateDisconnected', 'DetailedChargeStateComplete', 'DetailedChargeStateNotCharging', null]) {
    const html = sceneReadings('charge', state({ ...signals, DetailedChargeState: entry(chargeState) }));
    assert.match(html, /No active charge/);
    assert.doesNotMatch(html, />180<|>30</);
  }
  const active = sceneReadings('charge', state({ ...signals, DetailedChargeState: entry('DetailedChargeStateCharging') }));
  assert.match(active, /180\.0/);
  assert.match(active, /30<small>min/);
});

test('charging scene reads the appropriate AC or DC power signal', () => {
  const html = sceneReadings('charge', state({ DetailedChargeState: entry('DetailedChargeStateCharging'), FastChargerType: entry('FastChargerTypeUnknown'), ACChargingPower: entry(7.2), DCChargingPower: entry(180) }));
  assert.match(html, /7\.2<small>kW/);
  assert.doesNotMatch(html, /180/);
});

test('dynamics instruments use a recorded launch, rather than unrelated current signals', () => {
  const html = sceneReadings('drive', state({ VehicleSpeed: entry(60), PedalPosition: entry(99) }, { drive: { data: { launches: [{ seconds: 2.8, peak_g: 1.1, pedal: 100 }] } } }));
  assert.match(html, /2\.8<small>s/);
  assert.match(html, /1\.10<small>g/);
  assert.match(html, /100<small>%/);
  assert.match(html, /Sampled estimate/);
  assert.doesNotMatch(html, /99/);
});

test('all scene instruments tolerate missing and nonfinite readings', () => {
  for (const mode of ['vehicle', 'charge', 'trips', 'health', 'drive', 'insights']) {
    const html = sceneReadings(mode, state({ Soc: entry(NaN), RatedRange: entry(Infinity), TpmsPressureFl: entry(null) }));
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
    assert.match(html, /—/);
  }
});

test('regen estimates remain qualified in the scene instruments', () => {
  const html = sceneReadings('trips', state({}, { trips: { data: { week: { this_week: { regen_share: .2, regen_source: 'pack_power' } } } } }));
  assert.match(html, /Estimated · on measured trips/);
  assert.match(html, /20<small>%/);
});

test('fresh readings do not claim an unverified connection, and disconnects stay explicit', () => {
  const st = { ...state({ Soc: entry(50) }), meta: { sample_mode: false } };
  assert.match(experienceView('', st, ''), /Recent telemetry/);
  assert.doesNotMatch(experienceView('', st, ''), /Telemetry connected/);
  assert.match(experienceView('', { ...st, meta: { telemetry: { status: 'DISCONNECTED' } } }, ''), /Telemetry offline/);
  assert.match(experienceView('', st, ''), /Last signal/);
});

test('nested routes retain their chapter and sample provenance stays visible', () => {
  const health = chapterFor('health');
  assert.equal(health.mode, 'health');
  const links = chapterLinks('health');
  assert.equal((links.match(/aria-current="page"/g) || []).length, 1);
  assert.match(links, /href="#\/health" aria-current="page"/);
  assert.equal(chapterFor('setup'), null);
  const html = experienceView('<p>Details</p>', state(), 'health');
  assert.match(html, /SAMPLE DATA/);
  assert.match(html, /Simulated feed/);
  assert.match(html, /data-action="chapter-data"/);
  assert.match(html, /<p>Details<\/p>/);
  const vehicle = experienceView('', state({ RatedRange: entry(220), InsideTemp: entry(20), DoorState: entry({ DriverFront: true }) }), '');
  assert.match(vehicle, /data-field="RatedRange"/);
  assert.match(vehicle, /data-field="InsideTemp"/);
  assert.match(vehicle, /data-field="DoorState"/);
});
