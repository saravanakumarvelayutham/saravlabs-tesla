// Small helpers for reading enum values exactly as the fleet-telemetry MQTT dispatcher writes them
// (the proto enum value names, e.g. "ShiftStateP", "SentryModeStateArmed", "WindowStateClosed").

export const G = 9.80665;

export const isParked = (gear) => gear == null || gear === 'ShiftStateP' || gear === 'ShiftStateUnknown' || gear === 'ShiftStateInvalid' || gear === 'ShiftStateSNA';
export const isDriving = (gear) => gear === 'ShiftStateD' || gear === 'ShiftStateR' || gear === 'ShiftStateN';

export const sentryOn = (v) => typeof v === 'string' && !['SentryModeStateOff', 'SentryModeStateUnknown'].includes(v);
export const sentryAlarm = (v) => v === 'SentryModeStatePanic';

export const windowOpen = (v) => v === 'WindowStatePartiallyOpen' || v === 'WindowStateOpened';

export const CHARGING_STATES = new Set(['DetailedChargeStateStarting', 'DetailedChargeStateCharging']);
export const CHARGE_END_STATES = new Set(['DetailedChargeStateComplete', 'DetailedChargeStateStopped', 'DetailedChargeStateDisconnected', 'DetailedChargeStateNoPower']);

const DC_CHARGERS = new Set(['FastChargerSupercharger', 'FastChargerCHAdeMO', 'FastChargerGB', 'FastChargerCombo']);
export const isDcCharger = (v) => DC_CHARGERS.has(v);

// TpmsSoftWarnings / TpmsHardWarnings arrive as a TireLocation message. The MQTT dispatcher
// emits only the populated booleans, e.g. {"front_left":true} (getProtoValue in
// datastore/mqtt/mqtt_payload.go unwraps only the outer Value; seen in test/e2e). A bare `true`
// is still accepted in case a firmware sends the field untyped; the tire is then unknown.
export function tireWarnings(v) {
  if (v === true) return ['unknown'];
  if (v && typeof v === 'object') {
    const map = { front_left: 'FL', front_right: 'FR', rear_left: 'RL', rear_right: 'RR' };
    return Object.entries(v).filter(([, on]) => on === true).map(([k]) => map[k] || k);
  }
  return [];
}

export const localDay = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function placeName(store) {
  if (store.get('LocatedAtHome') === true) return 'Home';
  if (store.get('LocatedAtWork') === true) return 'Work';
  if (store.get('LocatedAtFavorite') === true) return 'Favorite';
  return null;
}

// Least-squares slope of y over x.
export function slope(points) {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
