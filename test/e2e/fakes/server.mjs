// Stand-ins for the parts of the outside world the e2e stack talks to, on one HTTPS port:
//   fleet-auth.prd.vn.cloud.tesla.com   OAuth token endpoint (authorization_code, refresh, client_credentials)
//   fleet-api.prd.na.vn.cloud.tesla.com Fleet API, reached only through tesla-http-proxy
//   push.e2e.test                       a web push service: checks the VAPID JWT and decrypts the
//                                       RFC 8291 payload with the subscription's private key
// Every request is logged; GET http://fakes:8099/log (published on 127.0.0.1) returns the log.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const CERTS = process.env.CERTS_DIR || '/certs';
const VIN = process.env.VIN;
const APP_URL = process.env.APP_URL || 'http://app:8080';
const log = [];
const record = (entry) => { log.push({ ts: Date.now(), ...entry }); console.log(JSON.stringify(entry).slice(0, 400)); };

const b64u = (b) => Buffer.from(b).toString('base64url');
// tesla-http-proxy decodes the access token payload with base64.RawStdEncoding (pkg/account),
// so the fake token uses standard base64 without padding, like Tesla's tokens.
const raw64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
function accessToken(sub) {
  const payload = {
    iss: 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/nts',
    aud: ['https://fleet-api.prd.na.vn.cloud.tesla.com', 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/userinfo'],
    sub, ou_code: 'NA', scp: ['openid', 'vehicle_device_data', 'vehicle_location', 'vehicle_charging_cmds'],
    exp: Math.floor(Date.now() / 1000) + 8 * 3600, iat: Math.floor(Date.now() / 1000),
  };
  return `${raw64({ alg: 'RS256', typ: 'JWT' })}.${raw64(payload)}.c2lnbmF0dXJl`;
}

// --- push subscription the test registers with the app (stands in for a browser's) ---
const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const subscription = {
  endpoint: 'https://push.e2e.test/push/e2e-device',
  keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(authSecret) },
};

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// RFC 8291 section 3.4 + RFC 8188 aes128gcm, single record.
function decryptPush(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const ecdhSecret = ua.computeSecret(asPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const padded = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error('missing last-record padding delimiter');
  return padded.subarray(0, end).toString();
}

// RFC 8292: Authorization: vapid t=<JWT>, k=<public key>
function checkVapid(header, audience) {
  const m = /^vapid t=([^,\s]+),\s*k=(\S+)$/.exec(header || '');
  if (!m) throw new Error(`no vapid authorization header: ${header}`);
  const [h, p, s] = m[1].split('.');
  const jwtHeader = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  const pub = Buffer.from(m[2], 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('VAPID signature does not verify');
  if (jwtHeader.alg !== 'ES256') throw new Error(`VAPID alg ${jwtHeader.alg}`);
  if (claims.aud !== audience) throw new Error(`VAPID aud ${claims.aud} != ${audience}`);
  if (!(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 86400)) throw new Error('VAPID exp outside 24 h');
  return { k: m[2], claims };
}

function decodeJws(token) {
  const [h, p, s] = token.split('.');
  return { header: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(p, 'base64url')), signature_bytes: Buffer.from(s, 'base64url').length };
}

let telemetryConfig = null;
const readBody = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function handle(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  const url = new URL(req.url, `https://${host}`);
  const body = await readBody(req);
  const entry = { host, method: req.method, path: url.pathname, auth: req.headers.authorization ? req.headers.authorization.slice(0, 16) + '…' : null };

  if (host === 'push.e2e.test') {
    try {
      const vapid = checkVapid(req.headers.authorization, 'https://push.e2e.test');
      if (req.headers['content-encoding'] !== 'aes128gcm') throw new Error(`content-encoding ${req.headers['content-encoding']}`);
      const plaintext = decryptPush(body);
      record({ ...entry, kind: 'push', ttl: req.headers.ttl, vapid_k: vapid.k, vapid_sub: vapid.claims.sub, payload: JSON.parse(plaintext) });
      res.writeHead(201); res.end();
    } catch (err) {
      record({ ...entry, kind: 'push_rejected', error: err.message });
      json(res, 400, { error: err.message });
    }
    return;
  }

  if (host === 'fleet-auth.prd.vn.cloud.tesla.com' && url.pathname === '/oauth2/v3/token') {
    const form = Object.fromEntries(new URLSearchParams(body.toString()));
    record({ ...entry, kind: 'token', grant_type: form.grant_type, client_id: form.client_id, has_secret: Boolean(form.client_secret), code: form.code, audience: form.audience, redirect_uri: form.redirect_uri, scope: form.scope });
    if (form.grant_type === 'authorization_code' && form.code !== 'e2e-code') return json(res, 400, { error: 'invalid_grant' });
    return json(res, 200, { access_token: accessToken(form.grant_type === 'client_credentials' ? 'partner' : 'e2e-user'), refresh_token: `rt-${Date.now()}`, expires_in: 28800, token_type: 'Bearer', scope: form.scope || 'openid offline_access vehicle_device_data vehicle_location vehicle_charging_cmds' });
  }

  if (host === 'fleet-api.prd.na.vn.cloud.tesla.com') {
    const p = url.pathname;
    let m;
    if (p === '/api/1/vehicles/fleet_telemetry_config_jws' && req.method === 'POST') {
      const b = JSON.parse(body.toString());
      const jws = decodeJws(b.token);
      telemetryConfig = jws.claims;
      record({ ...entry, kind: 'telemetry_config_jws', vins: b.vins, jws_header: jws.header, iss: jws.claims.iss, aud: jws.claims.aud, hostname: jws.claims.hostname, port: jws.claims.port, field_count: Object.keys(jws.claims.fields || {}).length, ca_sha256: crypto.createHash('sha256').update(jws.claims.ca || '').digest('hex'), signature_bytes: jws.signature_bytes });
      return json(res, 200, { response: { updated_vehicles: b.vins.length, skipped_vehicles: {} } });
    }
    if ((m = /^\/api\/1\/vehicles\/(\w+)\/fleet_telemetry_config$/.exec(p))) {
      record({ ...entry, kind: 'telemetry_config_get', vin: m[1] });
      return json(res, 200, { response: { synced: Boolean(telemetryConfig), config: telemetryConfig, limit_reached: false, key_paired: true } });
    }
    if ((m = /^\/api\/1\/vehicles\/(\w+)\/fleet_telemetry_errors$/.exec(p))) {
      record({ ...entry, kind: 'telemetry_errors', vin: m[1] });
      return json(res, 200, { response: { fleet_telemetry_errors: [] } });
    }
    if ((m = /^\/api\/1\/vehicles\/(\w+)\/(signed_command|command\/\w+|wake_up)$/.exec(p))) {
      record({ ...entry, kind: 'vehicle_command', vin: m[1], endpoint: m[2], body_bytes: body.length, body: body.toString().slice(0, 300) });
      // The app sends no commands; this is here so the e2e run can prove none arrive.
      return json(res, 408, { response: null, error: 'vehicle unavailable: vehicle is offline or asleep', error_description: '' });
    }
    if (p === '/api/1/partner_accounts' && req.method === 'POST') {
      const b = JSON.parse(body.toString());
      // Tesla fetches the public key from the registered domain; here the app is reached directly.
      const r = await fetch(`${APP_URL}/.well-known/appspecific/com.tesla.3p.public-key.pem`);
      const served = await r.text();
      record({ ...entry, kind: 'partner_register', domain: b.domain, key_status: r.status, served_key: served.trim() });
      return json(res, r.ok ? 200 : 424, { response: { domain: b.domain, public_key: served } });
    }
    if (p === '/api/1/vehicles') {
      record({ ...entry, kind: 'vehicles' });
      return json(res, 200, { response: [{ id: 1, vin: VIN, state: 'asleep', display_name: 'e2e Plaid' }], count: 1 });
    }
    if (p === '/api/1/dx/charging/history') {
      record({ ...entry, kind: 'charging_history' });
      return json(res, 200, { response: { data: [{ sessionId: 1, vin: VIN, siteLocationName: 'e2e Supercharger', chargeStartDateTime: new Date().toISOString(), fees: [{ feeType: 'CHARGING', totalDue: 12.34, currencyCode: 'USD', usageBase: 40, uom: 'kwh' }] }], totalResults: 1 } });
    }
    record({ ...entry, kind: 'fleet_unhandled' });
    return json(res, 404, { error: `fake Fleet API has no ${req.method} ${p}` });
  }

  record({ ...entry, kind: 'unknown_host' });
  json(res, 421, { error: `unknown host ${host}` });
}

https.createServer({ key: fs.readFileSync(`${CERTS}/fakes-key.pem`), cert: fs.readFileSync(`${CERTS}/fakes-cert.pem`) }, (req, res) => {
  handle(req, res).catch((err) => { record({ kind: 'fake_error', error: err.message }); json(res, 500, { error: err.message }); });
}).listen(443, () => console.log('fakes on :443'));

http.createServer((req, res) => {
  if (req.url === '/subscription') return json(res, 200, subscription);
  if (req.url === '/log') return json(res, 200, log);
  if (req.url === '/telemetry-config') return json(res, telemetryConfig ? 200 : 404, telemetryConfig);
  json(res, 404, {});
}).listen(8099, () => console.log('fakes control on :8099'));
