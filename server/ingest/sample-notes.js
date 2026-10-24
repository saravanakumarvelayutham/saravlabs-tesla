// Sample stand-ins for release_notes and recent_alerts, cached the way Fleet.cached() stores real
// ones (marked sample: true), plus a few streamed telemetry alerts. Field names follow community
// clients because Tesla doesn't publish these response formats; the text is simulated.
import { kvSet } from '../db.js';

export function sampleNotes(now = Date.now()) {
  const iso = (ms) => new Date(ms).toISOString();
  const day = 86400_000;
  return {
    release_notes: { ts: now, sample: true, data: { response: { release_notes: [
      { title: 'Sample: Dashcam Viewer', subtitle: 'Sample release note', description: 'Simulated text. Your car\'s real release notes appear here once your Tesla account is linked and you tap Fetch.', customer_version: '2026.32.4' },
      { title: 'Sample: Supercharger Busyness', subtitle: 'Sample release note', description: 'Another simulated entry, to show how a list renders.\n\nA second paragraph, to show line breaks are kept.', customer_version: '2026.32.4' },
      { title: 'Sample: Minor Fixes', subtitle: 'Sample release note', description: 'A short simulated note.', customer_version: '2026.32.4' },
    ] } } },
    recent_alerts: { ts: now, sample: true, data: { response: { recent_alerts: [
      { name: 'Sample_TPMS_Low_Pressure', time: iso(now - 2 * day), audience: ['customer'], user_text: 'Sample alert: tire pressure low' },
      { name: 'Sample_Charge_Complete', time: iso(now - 5 * day), audience: ['customer'], user_text: 'Sample alert: charging complete' },
      { name: 'SAMPLE_a042_serviceCheckSuggested', time: iso(now - 9 * day), audience: ['service-fix', 'customer'], user_text: 'Sample alert with a service audience' },
      { name: 'SAMPLE_a117_noUserText', time: iso(now - 12 * day), audience: ['service'] },
    ] } } },
  };
}

export function seedSampleNotes(db, streamed, now = Date.now()) {
  for (const [k, v] of Object.entries(sampleNotes(now))) kvSet(db, `cache:${k}`, v);
  const iso = (ms) => new Date(ms).toISOString();
  streamed.record('SAMPLE_w012_rearLeftTirePressureLow', { StartedAt: iso(now - 26 * 3600_000), Audiences: ['Customer'] }, now);
  streamed.record('SAMPLE_a033_cabinFilterReminder', { StartedAt: iso(now - 3 * 86400_000), EndedAt: iso(now - 3 * 86400_000 + 40 * 60_000), Audiences: ['Customer', 'Service'] }, now);
}
