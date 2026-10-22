// Prints the fleet_telemetry_config request built from server/signals.js and your .env.
//   npm run telemetry-config            print it
//   npm run telemetry-config -- --apply send it through tesla-http-proxy (needs a linked Tesla account)
//   npm run telemetry-config -- --status show the car's current config and any errors
import { config } from '../server/config.js';
import { createApp } from '../server/index.js';
import { telemetryBody } from '../server/http.js';

const mode = process.argv[2] || '';
const body = telemetryBody(config);

if (!mode) {
  console.log(JSON.stringify(body, null, 2));
  console.error(`\n${Object.keys(body.config.fields).length} fields. Run with --apply to send it to the car.`);
  process.exit(0);
}

const app = createApp();
if (!app.fleet) {
  console.error('Fleet API is not configured: set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET and VIN, then link your account in the app (Setup → Link Tesla account).');
  process.exit(1);
}
try {
  if (mode === '--apply') {
    if (!body.config.hostname || !body.config.ca) throw new Error('Set TELEMETRY_HOSTNAME and TELEMETRY_CA_FILE first.');
    console.log(JSON.stringify(await app.fleet.telemetryConfigCreate(body), null, 2));
  } else if (mode === '--status') {
    console.log(JSON.stringify({ config: await app.fleet.telemetryConfigGet(), errors: await app.fleet.telemetryErrors() }, null, 2));
  } else {
    throw new Error(`Unknown option ${mode}`);
  }
} catch (err) {
  console.error(err.message, err.body ? JSON.stringify(err.body) : '');
  process.exit(1);
}
