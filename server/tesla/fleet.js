// Fleet API access, always through tesla-http-proxy (vehicle-command). The proxy signs commands
// and fleet_telemetry_config with the virtual key and forwards everything else to Fleet API.
// It only serves TLS, so we pass its certificate as the CA when it is self-signed.
import fs from 'node:fs';
import https from 'node:https';
import { kvGet, kvSet } from '../db.js';

export class Fleet {
  constructor(db, tesla, auth, vin) {
    this.db = db;
    this.tesla = tesla;
    this.auth = auth;
    this.vin = vin;
    this.ca = tesla.proxyCaFile && fs.existsSync(tesla.proxyCaFile) ? fs.readFileSync(tesla.proxyCaFile) : undefined;
  }

  async request(method, path, body) {
    const token = await this.auth.accessToken();
    const url = new URL(this.tesla.proxyUrl + path);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method,
        ca: this.ca,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 60_000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let json;
          try { json = JSON.parse(text); } catch { json = { raw: text }; }
          if (res.statusCode >= 400) {
            const err = new Error(json.error || json.raw || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            err.body = json;
            reject(err);
          } else resolve(json);
        });
      });
      req.on('timeout', () => req.destroy(new Error('Fleet API request timed out')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  command(name, args = {}) {
    return this.request('POST', `/api/1/vehicles/${this.vin}/command/${name}`, args);
  }

  // Only ever called from an explicit user action: wakes are billed and cost the car sleep time.
  wakeUp() {
    return this.request('POST', `/api/1/vehicles/${this.vin}/wake_up`);
  }

  vehicles() {
    return this.request('GET', '/api/1/vehicles');
  }

  fleetStatus() {
    return this.request('POST', '/api/1/vehicles/fleet_status', { vins: [this.vin] });
  }

  telemetryConfigGet() {
    return this.request('GET', `/api/1/vehicles/${this.vin}/fleet_telemetry_config`);
  }

  telemetryConfigCreate(body) {
    return this.request('POST', '/api/1/vehicles/fleet_telemetry_config', body);
  }

  telemetryErrors() {
    return this.request('GET', `/api/1/vehicles/${this.vin}/fleet_telemetry_errors`);
  }

  // Cached account-level and vehicle reads. Kept raw: Tesla doesn't publish the response format
  // of charging_history, so the UI shows what it finds instead of assuming field names.
  async cached(key, maxAgeMs, fn) {
    const hit = kvGet(this.db, `cache:${key}`);
    if (hit && Date.now() - hit.ts < maxAgeMs) return hit;
    const data = await fn();
    const entry = { ts: Date.now(), data };
    kvSet(this.db, `cache:${key}`, entry);
    return entry;
  }

  chargingHistory(force = false) {
    return this.cached('charging_history', force ? 0 : 6 * 3600_000, () => this.request('GET', `/api/1/dx/charging/history`));
  }

  releaseNotes(force = false) {
    return this.cached('release_notes', force ? 0 : 24 * 3600_000, () => this.request('GET', `/api/1/vehicles/${this.vin}/release_notes`));
  }

  recentAlerts(force = false) {
    return this.cached('recent_alerts', force ? 0 : 3600_000, () => this.request('GET', `/api/1/vehicles/${this.vin}/recent_alerts`));
  }
}
