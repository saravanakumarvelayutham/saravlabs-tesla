// Entry point: wires storage, ingest, derived insights, Tesla access, push and HTTP together.
import path from 'node:path';
import { config } from './config.js';
import { openDb, kvGet, kvSet } from './db.js';
import { Store } from './store.js';
import { Trips } from './derive/trips.js';
import { Charging } from './derive/charging.js';
import { Health } from './derive/health.js';
import { Drive } from './derive/drive.js';
import { Alerts } from './derive/alerts.js';
import { StreamedAlerts } from './derive/vehicle-log.js';
import { Push } from './push.js';
import { Commands } from './commands.js';
import { TeslaAuth } from './tesla/auth.js';
import { Fleet } from './tesla/fleet.js';
import { startMqtt } from './ingest/mqtt.js';
import { Sample, sampleFleetCache } from './ingest/sample.js';
import { seedSampleNotes } from './ingest/sample-notes.js';
import { createServer } from './http.js';

export function createApp(cfg = config, { dbFile } = {}) {
  const db = openDb(dbFile || path.join(cfg.dataDir, cfg.sampleMode ? 'sample.db' : 'plaid.db'));
  const store = new Store(db);
  const app = { config: cfg, db, store, broadcast: () => {} };
  const broadcast = (e, d) => app.broadcast(e, d);
  app.trips = new Trips(db, store);
  app.charging = new Charging(db, store, { homeRatePerKwh: cfg.homeRatePerKwh });
  app.health = new Health(db, store);
  app.drive = new Drive(db, store);
  app.push = new Push(db, cfg.push);
  if (cfg.tesla.clientId && cfg.tesla.clientSecret) {
    app.auth = new TeslaAuth(db, cfg.tesla);
    app.fleet = cfg.vin ? new Fleet(db, cfg.tesla, app.auth, cfg.vin) : null;
  }
  app.fleetCache = (what) => kvGet(db, `cache:${what}`);
  app.streamedAlerts = new StreamedAlerts(db);
  app.commands = new Commands(db, { fleet: app.fleet, sampleMode: cfg.sampleMode, store, broadcast });
  app.alerts = new Alerts(db, store, { push: app.push, health: app.health, charging: app.charging, broadcast });
  return app;
}

function main() {
  if (!config.appPasscode && !config.sampleMode) {
    console.warn('[plaid] APP_PASSCODE is not set: the dashboard (and car commands) will be open to anyone who can reach it.');
  }
  const app = createApp();
  const { store, config: cfg } = app;

  if (cfg.sampleMode) {
    const sample = new Sample(store);
    const hasData = app.db.prepare('SELECT COUNT(*) AS n FROM history').get().n > 0;
    if (!hasData) {
      console.log('[sample] writing simulated history…');
      app.alerts.muted = true;
      app.db.exec('BEGIN');
      sample.backfill(35);
      app.db.exec('COMMIT');
      app.alerts.muted = false;
    } else {
      sample.soc = store.get('Soc') ?? sample.soc;
      sample.odo = store.get('Odometer') ?? sample.odo;
    }
    const writeSampleCache = () => {
      for (const [k, v] of Object.entries(sampleFleetCache(app.db, { vin: cfg.vin || 'SAMPLE' }))) kvSet(app.db, `cache:${k}`, v);
    };
    writeSampleCache();
    app.charging.onEnd(({ session }) => session.dc && writeSampleCache());
    seedSampleNotes(app.db, app.streamedAlerts);
    sample.live();
    console.log('[sample] SAMPLE MODE: all data is simulated');
  } else {
    startMqtt({
      url: cfg.mqttUrl,
      username: cfg.mqttUsername,
      password: cfg.mqttPassword,
      base: cfg.mqttTopicBase,
      vin: cfg.vin,
      store,
      onConnectivity: (c) => { app.connectivity = { status: c.Status, at: c.CreatedAt }; app.broadcast('connectivity', app.connectivity); },
      onAlert: (name, a) => app.broadcast('vehicle-alert', app.streamedAlerts.record(name, a)),
    });
  }

  // Housekeeping: away-from-home checks need a clock even when no signal arrives.
  setInterval(() => app.alerts.checkAway(Date.now()), 60_000).unref();
  setInterval(() => app.alerts.checkTires(Date.now()), 6 * 3600_000).unref();
  setInterval(() => store.prune(Date.now() - 400 * 86400_000), 24 * 3600_000).unref();
  // Supercharger bills: Tesla's charging_history, read at most every 6 h (Fleet.cached) once linked.
  const refreshHistory = () => {
    if (!cfg.sampleMode && app.fleet && app.auth?.linked) app.fleet.chargingHistory().catch((err) => console.warn('[fleet] charging_history:', err.message));
  };
  refreshHistory();
  setInterval(refreshHistory, 3600_000).unref();

  const server = createServer(app);
  const host = config.appPasscode ? '0.0.0.0' : '127.0.0.1';
  server.listen(cfg.port, host, () => console.log(`[plaid] http://${host}:${cfg.port} ${cfg.sampleMode ? '(sample mode)' : ''}`));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
