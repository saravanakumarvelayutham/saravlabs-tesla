// HTTP API, live stream (Server-Sent Events) and static PWA files. No framework: node:http only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { SIGNALS, buildTelemetryConfig } from './signals.js';
import { ingestBle } from './ingest/ble.js';
import { costBetween, matchSession, parseChargingHistory } from './derive/supercharger.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pem': 'application/x-pem-file',
};
const SESSION_DAYS = 30;

export function createServer(app) {
  const { config } = app;
  const webRoot = path.join(config.root, 'web');
  const clients = new Set();
  const loginAttempts = new Map();
  const secret = config.sessionSecret || crypto.randomBytes(32).toString('hex');

  app.broadcast = (event, data) => {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(line);
  };
  app.store.on('signal', (s) => app.broadcast('signal', { field: s.field, value: s.value, ts: s.ts, source: s.source }));
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000).unref();

  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const makeSession = () => {
    const payload = `v1.${Date.now() + SESSION_DAYS * 86400_000}`;
    return `${payload}.${sign(payload)}`;
  };
  const validSession = (cookie) => {
    if (!cookie) return false;
    const i = cookie.lastIndexOf('.');
    const payload = cookie.slice(0, i);
    const mac = cookie.slice(i + 1);
    const expect = sign(payload);
    if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return false;
    return Number(payload.split('.')[1]) > Date.now();
  };
  const authRequired = Boolean(config.appPasscode);
  const authed = (req) => !authRequired || validSession(cookies(req).plaid_session);
  const bridgeAuthed = (req) => config.bridgeToken && safeEqual(req.headers.authorization || '', `Bearer ${config.bridgeToken}`);

  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

  // --- public ---
  route('GET', '/healthz', () => ({ ok: true }), { public: true });
  route('GET', '/.well-known/appspecific/com.tesla.3p.public-key.pem', (req, res) => {
    const f = config.tesla.publicKeyFile;
    if (!f || !fs.existsSync(f)) return send(res, 404, { error: 'TESLA_PUBLIC_KEY_FILE not set' });
    res.writeHead(200, { 'Content-Type': MIME['.pem'] });
    res.end(fs.readFileSync(f));
  }, { public: true });
  route('POST', '/api/login', async (req, res) => {
    const ip = req.socket.remoteAddress;
    const a = loginAttempts.get(ip) || { n: 0, ts: Date.now() };
    if (Date.now() - a.ts > 15 * 60_000) { a.n = 0; a.ts = Date.now(); }
    if (a.n >= 10) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const body = await readJson(req);
    if (!authRequired || safeEqual(String(body.passcode || ''), config.appPasscode)) {
      loginAttempts.delete(ip);
      const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
      res.setHeader('Set-Cookie', `plaid_session=${makeSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
      return send(res, 200, { ok: true });
    }
    a.n++;
    loginAttempts.set(ip, a);
    return send(res, 401, { error: 'Wrong passcode' });
  }, { public: true });

  // --- dashboard data ---
  route('GET', '/api/state', () => ({
    meta: meta(app),
    signals: app.store.snapshot(),
    trip: app.trips.current(),
    charge: app.charging.current(),
  }));
  route('GET', '/api/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  route('GET', '/api/history', (req, res, { query }) => {
    if (!SIGNALS[query.field]) return send(res, 400, { error: 'unknown field' });
    return app.store.history(query.field, Number(query.since || 0), Math.min(Number(query.limit || 5000), 50000));
  });
  route('GET', '/api/trips', (req, res, { query }) => {
    const trips = app.trips.list(Number(query.limit || 50));
    return { trips, week: weekSummary(app, trips) };
  });
  route('GET', /^\/api\/trips\/(\d+)$/, (req, res, { params }) => app.trips.get(Number(params[0])) || send(res, 404, { error: 'not found' }));
  route('GET', '/api/charging', () => {
    const now = new Date();
    const hist = app.fleetCache('charging_history');
    const parsed = hist ? parseChargingHistory(hist.data, { vin: config.vin }) : null;
    const month = app.charging.monthSummary(now.getFullYear(), now.getMonth());
    return {
      current: app.charging.current(),
      sessions: app.charging.list(30).map((s) => withTeslaCost(s, parsed)),
      month: { ...month, ...monthCosts(app, month, parsed) },
      avg_dc_curve: app.charging.averageDcCurve(),
      tesla_history: hist ? { ts: hist.ts, sample: Boolean(hist.sample), total_records: parsed.total_records, recognized: parsed.recognized, unrecognized: parsed.unrecognized } : null,
    };
  });
  route('GET', /^\/api\/charging\/(\d+)$/, (req, res, { params }) => app.charging.get(Number(params[0])) || send(res, 404, { error: 'not found' }));
  route('GET', '/api/health/battery', () => app.health.battery());
  route('GET', '/api/health/tires', () => app.health.tires());
  route('GET', '/api/health/drain', () => app.health.drain());
  route('GET', '/api/drive', () => ({ today: app.drive.today(), launches: app.drive.launches(10) }));
  route('GET', '/api/events', () => app.alerts.list(50));
  route('GET', '/api/signals', () => SIGNALS);

  // --- commands ---
  route('POST', /^\/api\/command\/([a-z_]+)$/, async (req, res, { params }) => {
    const body = await readJson(req);
    try {
      return await app.commands.run(params[0], body.args || {}, body.via || 'auto');
    } catch (err) {
      return send(res, err.status || 500, { error: err.message, detail: err.body });
    }
  });

  // --- web push ---
  route('GET', '/api/push/key', () => ({ enabled: app.push.enabled, publicKey: app.push.publicKey || null, subscriptions: app.push.count() }));
  route('POST', '/api/push/subscribe', async (req) => { app.push.subscribe(await readJson(req)); return { ok: true }; });
  route('POST', '/api/push/test', () => app.push.send({ title: 'Plaid', body: 'Test notification from your dashboard.', tag: 'test' }));

  // --- Tesla account and telemetry setup ---
  route('GET', '/auth/login', (req, res) => {
    if (!app.auth) return send(res, 503, { error: 'Set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET first' });
    res.writeHead(302, { Location: app.auth.loginUrl() });
    res.end();
  });
  route('GET', '/auth/callback', async (req, res, { query }) => {
    if (!app.auth) return send(res, 503, { error: 'Tesla not configured' });
    if (query.error) return send(res, 400, { error: query.error, description: query.error_description });
    await app.auth.handleCallback(query);
    res.writeHead(302, { Location: '/#/setup' });
    res.end();
  });
  route('GET', '/api/tesla/status', async () => {
    const out = { configured: Boolean(app.auth), linked: app.auth?.linked || false, vin: config.vin || null };
    return out;
  });
  route('GET', '/api/tesla/telemetry-config', async (req, res) => {
    const proposed = telemetryBody(config);
    if (!app.fleet || !app.auth?.linked) return { proposed, current: null };
    try {
      return { proposed, current: await app.fleet.telemetryConfigGet(), errors: await app.fleet.telemetryErrors().catch((e) => ({ error: e.message })) };
    } catch (err) {
      return { proposed, current: null, error: err.message };
    }
  });
  route('POST', '/api/tesla/telemetry-config', async (req, res) => {
    if (!app.fleet) return send(res, 503, { error: 'Fleet API not configured' });
    const body = telemetryBody(config);
    if (!body.config.hostname || !body.config.ca) return send(res, 400, { error: 'Set TELEMETRY_HOSTNAME and TELEMETRY_CA_FILE' });
    try { return await app.fleet.telemetryConfigCreate(body); } catch (err) { return send(res, err.status || 500, { error: err.message, detail: err.body }); }
  });
  route('POST', '/api/tesla/refresh', async (req, res, { query }) => {
    if (!app.fleet) return send(res, 503, { error: 'Fleet API not configured' });
    const what = query.what || 'charging_history';
    const fn = { charging_history: () => app.fleet.chargingHistory(true), release_notes: () => app.fleet.releaseNotes(true), recent_alerts: () => app.fleet.recentAlerts(true) }[what];
    if (!fn) return send(res, 400, { error: 'unknown' });
    try { return await fn(); } catch (err) { return send(res, err.status || 500, { error: err.message, detail: err.body }); }
  });
  route('GET', '/api/tesla/cache', (req, res, { query }) => app.fleetCache(query.what || 'charging_history'));

  // --- garage Pi bridge ---
  route('POST', '/api/bridge/state', async (req, res) => {
    const body = await readJson(req);
    app.commands.bridgeSeen = Date.now();
    if (body.reached_car) app.commands.bridgeReachedCar = Date.now();
    if (body.sleep) app.bridgeSleep = body.sleep;
    const fields = body.kind ? ingestBle(app.store, body) : {};
    return { ok: true, fields: Object.keys(fields) };
  }, { bridge: true });
  route('GET', '/api/bridge/next', async (req, res) => {
    app.commands.bridgeSeen = Date.now();
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const job = app.commands.nextForBridge();
      if (job) return job;
      await new Promise((r) => setTimeout(r, 500));
      if (req.destroyed) return undefined;
    }
    res.writeHead(204);
    res.end();
    return undefined;
  }, { bridge: true });
  route('POST', /^\/api\/bridge\/result\/(\d+)$/, async (req, res, { params }) => {
    app.commands.bridgeResult(Number(params[0]), await readJson(req));
    return { ok: true };
  }, { bridge: true });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const query = Object.fromEntries(url.searchParams);
    try {
      if (url.pathname === '/api/session') return send(res, 200, { required: authRequired, authed: authed(req), sample: config.sampleMode });
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = typeof r.pattern === 'string' ? (r.pattern === url.pathname ? [] : null) : url.pathname.match(r.pattern)?.slice(1);
        if (!m) continue;
        if (r.bridge) {
          if (!bridgeAuthed(req)) return send(res, 401, { error: 'bad bridge token' });
        } else if (!r.public && !authed(req)) {
          return send(res, 401, { error: 'login required' });
        }
        const out = await r.handler(req, res, { query, params: m });
        if (out !== undefined && !res.headersSent) send(res, 200, out);
        return;
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      serveStatic(webRoot, url.pathname, res);
    } catch (err) {
      console.error('[http]', err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.message });
    }
  });
  return server;
}

function meta(app) {
  const { config } = app;
  return {
    sample_mode: config.sampleMode,
    vin: config.vin || null,
    tesla_configured: Boolean(app.auth),
    tesla_linked: app.auth?.linked || false,
    bridge: { ...app.commands.bridgeStatus(), sleep: app.bridgeSleep || null },
    telemetry: app.connectivity || null,
    push: { enabled: app.push.enabled },
    home_rate: config.homeRatePerKwh || null,
    tire_target_psi: config.tireTargetPsi || null,
    currency: config.currency,
    server_time: Date.now(),
  };
}

// A DC session with the Tesla history record that matches it (cost, currency, site name).
function withTeslaCost(s, parsed) {
  const t = s.dc ? matchSession(parsed, s.start_ts) : null;
  return t ? { ...s, tesla_cost: t.cost, tesla_currency: t.currency, site: t.site } : s;
}

// Charging money for the month: home (your rate) + Supercharger (Tesla's billed history), and per mile.
// Totals are only given when every part is known in your currency: every DC session this month
// needs a matching Tesla record, otherwise a missing bill would quietly count as $0.
export function monthCosts(app, month, parsed) {
  const currency = app.config.currency;
  const sc = parsed ? costBetween(parsed, month.from, month.to) : {};
  const scOther = Object.keys(sc).filter((c) => c !== currency);
  const dcSessions = app.charging.list(1000).filter((s) => s.dc && s.start_ts >= month.from && s.start_ts < month.to);
  const unmatched = dcSessions.filter((s) => !matchSession(parsed, s.start_ts)).length;
  const scCost = parsed && (sc[currency] != null || dcSessions.length === 0) ? sc[currency] || 0 : null;
  const miles = app.trips.list(1000).filter((t) => t.start_ts >= month.from && t.start_ts < month.to && t.miles > 0)
    .reduce((s, t) => s + t.miles, 0);
  const homeKnown = month.home.sessions === 0 || month.home.cost != null;
  const scKnown = scCost != null && unmatched === 0 && !scOther.length;
  const total = homeKnown && scKnown ? (month.home.cost || 0) + scCost : null;
  const missing = [];
  if (!homeKnown) missing.push('your home rate (HOME_RATE_PER_KWH)');
  if (!parsed) missing.push("Tesla's charging history");
  else if (unmatched) missing.push(`Tesla records for ${unmatched} of ${dcSessions.length} Supercharger sessions`);
  if (scOther.length) missing.push(`Supercharger charges in ${currency} (some are in ${scOther.join(', ')})`);
  if (!(miles > 0)) missing.push('miles driven this month');
  return {
    dc_cost: scCost,
    dc_unmatched: unmatched,
    dc_other_currencies: scOther.length ? Object.fromEntries(scOther.map((c) => [c, sc[c]])) : null,
    total_cost: total,
    miles,
    cost_per_mile: total != null && miles > 0 ? total / miles : null,
    missing,
  };
}

function weekSummary(app, trips) {
  const since = Date.now() - 7 * 86400_000;
  const prev = since - 7 * 86400_000;
  const sum = (list) => {
    const ok = list.filter((t) => t.miles > 0.2 && t.kwh != null);
    const miles = ok.reduce((s, t) => s + t.miles, 0);
    const kwh = ok.reduce((s, t) => s + t.kwh, 0);
    return { miles, kwh, wh_per_mile: miles > 0 ? (kwh * 1000) / miles : null, trips: ok.length };
  };
  const all = app.trips.list(500);
  const thisWeek = sum(all.filter((t) => t.start_ts >= since));
  return {
    this_week: { ...thisWeek, ...regenShare(app.store, since, Date.now(), thisWeek.kwh) },
    last_week: sum(all.filter((t) => t.start_ts >= prev && t.start_ts < since)),
    weekly: weeklySeries(all),
  };
}

// Share of driving energy won back by regen over [from, to]: regen / (net energy used + regen).
// Net use is the drop in EnergyRemaining, which already has regen added back in.
// Needs LifetimeEnergyGainedRegen, which is in Tesla's proto but not on their docs page.
export function regenShare(store, from, to, netKwh) {
  const a = store.valueAt('LifetimeEnergyGainedRegen', from);
  const b = store.valueAt('LifetimeEnergyGainedRegen', to);
  if (typeof a !== 'number' || typeof b !== 'number' || b < a) return { regen_kwh: null, regen_share: null };
  const regen = b - a;
  return { regen_kwh: regen, regen_share: netKwh > 0 ? regen / (netKwh + regen) : null };
}

function weeklySeries(trips) {
  const weeks = new Map();
  for (const t of trips) {
    if (!(t.miles > 0.2) || t.kwh == null) continue;
    const wk = Math.floor((Date.now() - t.start_ts) / (7 * 86400_000));
    if (wk > 7) continue;
    const e = weeks.get(wk) || { miles: 0, kwh: 0, temps: [] };
    e.miles += t.miles;
    e.kwh += t.kwh;
    if (typeof t.outside_temp === 'number') e.temps.push(t.outside_temp);
    weeks.set(wk, e);
  }
  return [...weeks.entries()].sort((a, b) => b[0] - a[0]).map(([wk, e]) => ({
    weeks_ago: wk,
    wh_per_mile: (e.kwh * 1000) / e.miles,
    outside_c: e.temps.length ? e.temps.reduce((s, v) => s + v, 0) / e.temps.length : null,
  }));
}

export function telemetryBody(config) {
  const ca = config.telemetry.caFile && fs.existsSync(config.telemetry.caFile) ? fs.readFileSync(config.telemetry.caFile, 'utf8') : '';
  return buildTelemetryConfig({ vin: config.vin, hostname: config.telemetry.hostname, port: config.telemetry.port, ca });
}

function serveStatic(root, pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'bad path' }); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(root, rel));
  // Separator included so a sibling folder like web-private/ doesn't pass the check.
  if (!file.startsWith(root + path.sep)) return send(res, 403, { error: 'forbidden' });
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  const ext = path.extname(target);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  // The service worker and HTML must revalidate so updates reach installed apps.
  headers['Cache-Control'] = ext === '.html' || target.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600';
  res.writeHead(200, headers);
  fs.createReadStream(target).pipe(res);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
  return undefined;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join('=')]));
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
