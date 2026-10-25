// Runtime configuration, read once from the environment (and ./.env when present).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

if (fs.existsSync(path.join(root, '.env')) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(path.join(root, '.env'));
}

const env = process.env;
const bool = (v) => v === '1' || v === 'true' || v === 'yes';
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const publicUrl = (env.PUBLIC_URL || `http://localhost:${num(env.PORT, 8080)}`).replace(/\/$/, '');

export const config = {
  root,
  port: num(env.PORT, 8080),
  publicUrl,
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),

  // Sample mode feeds simulated signals through the same pipeline as the real car.
  sampleMode: bool(env.SAMPLE_MODE),

  // Login for the dashboard itself. Anyone with this can unlock the car, so it is required
  // unless the server only listens on localhost in sample mode.
  appPasscode: env.APP_PASSCODE || '',
  sessionSecret: env.SESSION_SECRET || '',
  // Set when a reverse proxy (deploy/caddy) is the only way in, so X-Forwarded-For names the real client.
  trustProxy: bool(env.TRUST_PROXY),

  vin: env.VIN || '',

  // Fleet Telemetry -> MQTT (tesla/fleet-telemetry MQTT dispatcher, topic <base>/<VIN>/v/<Field>)
  mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
  mqttUsername: env.MQTT_USERNAME || undefined,
  mqttPassword: env.MQTT_PASSWORD || undefined,
  mqttTopicBase: env.MQTT_TOPIC_BASE || 'telemetry',

  // Fleet API (OAuth third-party tokens, https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens)
  tesla: {
    clientId: env.TESLA_CLIENT_ID || '',
    clientSecret: env.TESLA_CLIENT_SECRET || '',
    redirectUri: env.TESLA_REDIRECT_URI || `${publicUrl}/auth/callback`,
    audience: env.TESLA_AUDIENCE || 'https://fleet-api.prd.na.vn.cloud.tesla.com',
    scopes: env.TESLA_SCOPES || 'openid offline_access user_data vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds',
    authorizeUrl: 'https://auth.tesla.com/oauth2/v3/authorize',
    tokenUrl: 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token',
    // tesla-http-proxy signs commands with the virtual key and forwards the rest to Fleet API.
    proxyUrl: (env.TESLA_PROXY_URL || 'https://localhost:4443').replace(/\/$/, ''),
    proxyCaFile: env.TESLA_PROXY_CA_FILE || '',
    publicKeyFile: env.TESLA_PUBLIC_KEY_FILE || '',
  },

  // Fleet Telemetry server the car connects to (used to build fleet_telemetry_config).
  telemetry: {
    hostname: env.TELEMETRY_HOSTNAME || '',
    port: num(env.TELEMETRY_PORT, 443),
    caFile: env.TELEMETRY_CA_FILE || '',
  },

  push: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:owner@example.com',
  },

  bridgeToken: env.BRIDGE_TOKEN || '',

  // Your home electricity price, used for home charging cost (Tesla does not report it).
  homeRatePerKwh: num(env.HOME_RATE_PER_KWH, 0),
  tireTargetPsi: num(env.TIRE_TARGET_PSI, 0),
  currency: env.CURRENCY || 'USD',
};
