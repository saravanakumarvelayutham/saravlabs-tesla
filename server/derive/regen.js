// Regen: energy won back by braking with the motors, for a trip or a run of trips.
//
// Two ways to get it, best first:
//   counter    LifetimeEnergyGainedRegen (kWh). In vehicle_data.proto but not on Tesla's
//              Available Data page, so a Plaid may never send it.
//   pack_power PackVoltage × PackCurrent, both on the Available Data page ("voltage measured on
//              the battery side of the HV contactors", "current measured at the HV contactors").
//              Integrated over the drive, the part flowing into the pack is regen. Tesla states
//              neither the units nor the sign, so the estimate assumes volts and amps, takes the
//              sign that matches the drop in EnergyRemaining, and is dropped when the integrated
//              net energy disagrees with that drop by more than CHECK_RANGE.
//
// Share is regen / (energy drawn while driving) = regen / (net + regen), since the drop in
// EnergyRemaining already has regen added back in.

export const CHECK_RANGE = [0.5, 2];
// The car only resends a field when it changes (by minimum_delta), so a reading holds until the
// next one; across a longer gap (lost connection) it counts for at most this long.
const MAX_HOLD_MS = 300_000;
const MIN_NET_KWH = 0.3; // too little energy to check the units against

function numericRows(store, field, from, to) {
  const before = store.valueAt(field, from);
  const rows = store.history(field, from, 500_000).filter((h) => h.ts <= to && typeof h.value === 'number');
  return typeof before === 'number' && (!rows.length || rows[0].ts > from) ? [{ ts: from, value: before }, ...rows] : rows;
}

// From the counter over [from, to]. `to` should include time for a late reading to arrive.
export function regenFromCounter(store, from, to) {
  const a = store.valueAt('LifetimeEnergyGainedRegen', from);
  const b = store.valueAt('LifetimeEnergyGainedRegen', to);
  if (typeof a !== 'number' || typeof b !== 'number' || b < a) return null;
  // No reading inside the window at all means the counter isn't streaming, not zero regen.
  const any = store.db.prepare('SELECT 1 FROM history WHERE field = ? AND ts > ? AND ts <= ? LIMIT 1').get('LifetimeEnergyGainedRegen', from, to);
  return any ? b - a : null;
}

// Integrates PackVoltage × PackCurrent over [from, to]. Returns kWh in and out of the pack
// (sign unresolved) or null when either signal is missing.
export function integratePackPower(store, from, to) {
  const amps = numericRows(store, 'PackCurrent', from, to);
  const volts = numericRows(store, 'PackVoltage', from, to);
  if (amps.length < 2 || !volts.length) return null;
  let pos = 0;
  let neg = 0;
  let vi = 0;
  for (let i = 0; i < amps.length; i++) {
    const a = amps[i];
    const end = Math.min(amps[i + 1]?.ts ?? to, a.ts + MAX_HOLD_MS, to);
    if (end <= a.ts) continue;
    while (vi + 1 < volts.length && volts[vi + 1].ts <= a.ts) vi++;
    const kwh = (volts[vi].value * a.value * (end - a.ts)) / 3_600_000 / 1000;
    if (kwh >= 0) pos += kwh; else neg -= kwh;
  }
  return { pos, neg, samples: amps.length };
}

// Regen from pack power, checked against the EnergyRemaining drop (netKwh) over the same span.
export function regenFromPackPower(store, from, to, netKwh) {
  if (typeof netKwh !== 'number' || Math.abs(netKwh) < MIN_NET_KWH) return null;
  const p = integratePackPower(store, from, to);
  if (!p) return null;
  // Discharge is whichever direction makes the integrated net match the sign of netKwh.
  const [out, back] = (p.pos - p.neg) * netKwh >= 0 ? [p.pos, p.neg] : [p.neg, p.pos];
  const check = (out - back) / netKwh;
  if (!(check >= CHECK_RANGE[0] && check <= CHECK_RANGE[1])) return { regen_kwh: null, check, rejected: true };
  return { regen_kwh: back, check };
}

// Best available regen for a span with a known net energy use.
export function regenFor(store, from, to, netKwh) {
  const counter = regenFromCounter(store, from, to);
  if (counter != null) return { regen_kwh: counter, regen_share: share(counter, netKwh), regen_source: 'counter' };
  const pp = regenFromPackPower(store, from, to, netKwh);
  if (pp && pp.regen_kwh != null) return { regen_kwh: pp.regen_kwh, regen_share: share(pp.regen_kwh, netKwh), regen_source: 'pack_power', regen_check: pp.check };
  return { regen_kwh: null, regen_share: null, regen_source: null, ...(pp?.rejected ? { regen_check: pp.check } : {}) };
}

// Sum over trips that each have a regen figure. Share only counts the trips that have one.
export function regenTotal(trips) {
  const ok = trips.filter((t) => t.regen_kwh != null && t.kwh != null);
  if (!ok.length) return { regen_kwh: null, regen_share: null, regen_source: null, regen_trips: 0 };
  const regen = ok.reduce((s, t) => s + t.regen_kwh, 0);
  const net = ok.reduce((s, t) => s + t.kwh, 0);
  const sources = [...new Set(ok.map((t) => t.regen_source))];
  return { regen_kwh: regen, regen_share: share(regen, net), regen_source: sources.length === 1 ? sources[0] : 'mixed', regen_trips: ok.length };
}

function share(regen, net) {
  return typeof net === 'number' && net + regen > 0 ? regen / (net + regen) : null;
}
