// Release notes and recent alerts from Fleet API, plus alerts streamed by Fleet Telemetry.
// Tesla documents release_notes and recent_alerts only by path, not by response format, so the
// parsers look for the expected array by name, fall back to the first array of objects they
// find, and keep every field they don't recognise visible through the raw response.
import { kvGet, kvSet } from '../db.js';

const MAX_STREAMED = 200;

// Breadth-first search for `key` holding an array, a few levels deep (Fleet API wraps
// payloads in `response`, sometimes twice).
export function findArray(data, key) {
  let level = [data];
  let guess = null;
  for (let depth = 0; depth < 5 && level.length; depth++) {
    const next = [];
    for (const node of level) {
      if (Array.isArray(node)) {
        if (!guess && node.some((x) => x && typeof x === 'object' && !Array.isArray(x))) guess = node;
        continue;
      }
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node[key])) return { items: node[key], matched: key };
      next.push(...Object.values(node));
    }
    level = next;
  }
  return guess ? { items: guess, matched: 'guess' } : { items: [], matched: null };
}

const pick = (o, keys) => {
  for (const k of keys) if (typeof o?.[k] === 'string' && o[k].trim()) return o[k].trim();
  return null;
};

// Accepts ISO strings, epoch seconds or epoch milliseconds.
export function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+(\.\d+)?$/.test(v.trim())) return toMs(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

const httpsUrl = (v) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null);

export function parseReleaseNotes(data) {
  const { items, matched } = findArray(data, 'release_notes');
  const notes = items.filter((n) => n && typeof n === 'object').map((n) => ({
    title: pick(n, ['title', 'name', 'heading']),
    subtitle: pick(n, ['subtitle', 'summary']),
    description: pick(n, ['description', 'body', 'text', 'details']),
    version: pick(n, ['customer_version', 'version']),
    image: httpsUrl(n.image_url),
  }));
  return { notes, matched };
}

// "VCFRONT_a180_lowVoltageBatteryWarning" -> "Low voltage battery warning". Cosmetic only:
// the raw name is always shown next to it.
export function alertLabel(name) {
  if (typeof name !== 'string' || !name) return 'Unnamed alert';
  const parts = name.split('_').filter(Boolean);
  const words = parts.filter((p, i) => !(i === 0 && parts.length > 1 && /^[A-Z0-9]+$/.test(p)) && !/^[a-z]\d+$/.test(p));
  const text = (words.length ? words : parts).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return text ? text[0].toUpperCase() + text.slice(1) : name;
}

const audiences = (v) => (Array.isArray(v) ? v : v != null ? [v] : []).map(String);

export function parseRecentAlerts(data) {
  const { items, matched } = findArray(data, 'recent_alerts');
  const alerts = items.filter((a) => a && typeof a === 'object').map((a) => {
    const name = pick(a, ['name', 'alert_name']);
    return {
      name,
      label: alertLabel(name),
      text: pick(a, ['user_text', 'text', 'description', 'message']),
      ts: toMs(a.time ?? a.started_at ?? a.timestamp),
      audience: audiences(a.audience ?? a.audiences),
    };
  }).sort((x, y) => (y.ts ?? 0) - (x.ts ?? 0));
  return { alerts, matched };
}

// Alerts from fleet-telemetry's MQTT topic <base>/<VIN>/alerts/<name>/current, payload
// {"StartedAt","EndedAt","Audiences"} with RFC 3339 times (datastore/mqtt/mqtt_payload.go).
// An alert with no EndedAt is still active (protos/vehicle_alert.proto).
export class StreamedAlerts {
  constructor(db) {
    this.db = db;
  }

  record(name, payload, now = Date.now()) {
    const started = toMs(payload?.StartedAt);
    const list = kvGet(this.db, 'streamedAlerts', []);
    const entry = {
      name,
      label: alertLabel(name),
      started,
      ended: toMs(payload?.EndedAt),
      audience: audiences(payload?.Audiences),
      received: now,
    };
    const i = list.findIndex((a) => a.name === name && a.started === started);
    if (i >= 0) list[i] = { ...entry, received: list[i].received };
    else list.push(entry);
    list.sort((a, b) => (b.started ?? b.received) - (a.started ?? a.received));
    kvSet(this.db, 'streamedAlerts', list.slice(0, MAX_STREAMED));
    return entry;
  }

  list(limit = 50) {
    return kvGet(this.db, 'streamedAlerts', []).slice(0, limit).map((a) => ({ ...a, active: a.ended == null }));
  }
}
