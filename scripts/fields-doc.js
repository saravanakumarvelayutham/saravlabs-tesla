// Regenerates docs/FIELDS.md from server/signals.js:  node scripts/fields-doc.js > docs/FIELDS.md
import { SIGNALS } from '../server/signals.js';

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');
const rows = Object.entries(SIGNALS).map(([name, s]) => {
  const status = s.unverified ? 'Not in Tesla docs (proto only)' : s.unitNote ? 'Unit not stated by Tesla' : 'Documented';
  const notes = [s.doc, s.unitNote, s.minFirmware ? `Needs firmware ${s.minFirmware}+.` : '', s.minimumDelta ? `minimum_delta ${s.minimumDelta}.` : '']
    .filter(Boolean).join(' ');
  return `| \`${name}\` | ${s.interval} s | ${cell(s.unit || '—')} | ${status} | ${cell(notes)} |`;
});

console.log(`# Telemetry fields

Generated from \`server/signals.js\` by \`node scripts/fields-doc.js\`. Do not edit by hand.

Source: Tesla's [Available Data](https://developer.tesla.com/docs/fleet-api/fleet-telemetry/available-data) page and
[vehicle_data.proto](https://github.com/teslamotors/fleet-telemetry/blob/main/protos/vehicle_data.proto), checked 2026-10-22.

- **Documented**: the field and its unit are on Tesla's page.
- **Unit not stated by Tesla**: the field is documented but the unit is this app's reading; the UI labels it as assumed.
- **Not in Tesla docs**: the field exists in the proto but Tesla's page does not list it. Shown only if the car sends it.

Interval is \`interval_seconds\`: the car sends a field at most once per interval, and only when it changed.

| Field | Interval | Unit | Status | Notes |
|---|---|---|---|---|
${rows.join('\n')}

## Not used, and why

- \`LifetimeEnergyUsedDrive\`: Tesla marks it "Semi-truck only". Trip energy comes from the change in \`EnergyRemaining\`.
- Tesla's \`charging_history\` endpoint: the response format isn't published, so the Setup page shows it raw and nothing is derived from it yet.
`);
