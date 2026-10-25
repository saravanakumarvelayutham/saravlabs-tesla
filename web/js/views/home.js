// Phone · Car tab: the 3D car with live state, range, quick facts, insights, signal stream.
import { sig, updateStage, useData } from '../core.js';
import { monthMoney } from './car.js';
import { ago, chips, clock, esc, fmtValue, icon, num, temp } from '../ui.js';

// One line in plain words: what the car is doing, its lock state, and charging.
export function carStatus() {
  const g = sig('Gear');
  const moving = /ShiftState[DRN]/.test(g || '');
  const cs = (sig('DetailedChargeState') || '').replace('DetailedChargeState', '');
  const parts = [moving ? 'Driving' : 'Parked'];
  const locked = sig('Locked');
  if (locked != null) parts.push(locked ? 'Locked' : 'Unlocked');
  if (cs === 'Charging') parts.push(`Charging to ${num(sig('ChargeLimitSoc'))}%`);
  else if (cs && cs !== 'Disconnected') parts.push(`Plugged in · ${cs}`);
  if (sig('LocatedAtHome') === true) parts.push('Home');
  return parts.join(' · ');
}

function facts(state) {
  const sentry = sig('SentryMode');
  const sentryOn = typeof sentry === 'string' && !/Off|Unknown/.test(sentry);
  const locked = sig('Locked');
  const cell = (label, value, cls = '') => `<div class="fact"><span class="fv ${cls}">${value}</span><span class="fl">${label}</span></div>`;
  return `<div class="facts">
    ${cell('Inside', temp(sig('InsideTemp')))}
    ${cell('Outside', temp(sig('OutsideTemp')))}
    ${cell('Doors', locked === false ? 'Unlocked' : locked ? 'Locked' : '—', locked === false ? 'amber' : '')}
    ${cell('Sentry', sentryOn ? 'On' : sentry ? 'Off' : '—', sentryOn ? 'red' : '')}
  </div>`;
}

function streamPanel(state) {
  const rows = state.feed.length
    ? state.feed.slice(0, 6)
    : Object.entries(state.signals).map(([field, e]) => ({ field, ...e })).sort((a, b) => b.ts - a.ts).slice(0, 6);
  return `<div class="pn" style="gap:4px">
    <div class="row" style="padding-bottom:4px"><span class="k">Signal stream</span><span class="k" style="color:${state.live ? 'var(--green)' : 'var(--muted)'}">● ${state.live ? 'Receiving' : 'Idle'}</span></div>
    ${rows.map((r, i) => `<button type="button" class="st tap" data-action="sig-open" data-field="${esc(r.field)}" aria-label="${esc(r.field)} history" style="${i > 4 ? 'opacity:.55' : ''}"><span class="ts">${clock(r.ts)}</span><span class="f">${esc(r.field)}</span><span>${esc(fmtValue(r.value))} <span class="chev">›</span></span></button>`).join('')}
    <div class="t" style="padding-top:6px">The raw feed your server receives, newest first. Tap a signal for its history.</div>
  </div>`;
}

export function insights(state) {
  const tires = useData('tires', '/api/health/tires', 5 * 60_000);
  const drain = useData('drain', '/api/health/drain', 10 * 60_000);
  const items = [];
  for (const l of tires?.leaks || []) {
    items.push(['#/health/tires', 'warn', 'var(--amber)', `${l.tire} tire is down ${l.drop_psi.toFixed(1)} psi over ${l.days} days`, 'Possible slow leak · open Tires']);
  }
  if (tires?.hard_warnings?.length) items.push(['#/health/tires', 'warn', 'var(--red)', 'Car reports a tire pressure warning', tires.hard_warnings.join(', ')]);
  const sentryNights = drain?.nights?.filter((n) => n.valid && n.sentry) || [];
  if (sentryNights.length && drain.sentry_avg != null) {
    const ratio = drain.no_sentry_avg ? ` · about ${(drain.sentry_avg / drain.no_sentry_avg).toFixed(1)}× a Sentry-off night` : '';
    items.push(['#/health', 'clock', 'var(--cyan)', `Sentry nights use ${drain.sentry_avg.toFixed(1)}% overnight`, `Average of ${sentryNights.length} nights${ratio}`]);
  }
  const upd = sig('SoftwareUpdateVersion');
  if (upd) items.push(['#/updates', 'download', 'var(--cyan)', `Software update ${esc(upd)} ${updateStage()}`, 'Release notes · install from the car or the Tesla app']);
  // Leaks and updates already have their own line above, so skip their events here.
  const shown = new Set(['tire_leak', ...(upd ? ['software_update', 'software_update_ready'] : [])]);
  for (const ev of state.events.filter((e) => !shown.has(e.kind)).slice(0, 2)) items.push(['#/', 'pulse', 'var(--violet)', esc(ev.title), `${esc(ev.body || '')} · ${ago(ev.ts)}`]);
  if (!items.length) return `<div class="pn intelligence"><div class="eyebrow">Intelligence / Observations</div><div class="t">No insights available yet. Tire and overnight energy trends appear as history accumulates.</div></div>`;
  return `<div class="pn intelligence" style="gap:12px"><div class="eyebrow">Intelligence / Observations</div>
    ${items.slice(0, 4).map(([href, ic, color, title, sub]) => `<a class="insight" href="${href}">${icon(ic, 28, color)}<div class="stack"><span style="font-size:15px;font-weight:500">${title}</span><span class="t">${sub}</span></div></a>`).join('')}
    ${chips(['TpmsPressureRl', 'Soc', 'SentryMode', 'SoftwareUpdateVersion'], state.signals)}
  </div>`;
}

// Links to the Software and Alerts screens, with what's waiting on each.
function logLinks(state) {
  const al = useData('valerts', '/api/vehicle/alerts', 5 * 60_000);
  const active = al?.streamed?.filter((a) => a.active).length || 0;
  const week = Date.now() - 7 * 86400_000;
  const recent = al ? al.alerts.filter((a) => a.ts >= week).length : null;
  const alertSub = active ? `${active} active now` : recent != null ? `${recent} in the last 7 days` : 'Recent alerts from the car';
  const upd = sig('SoftwareUpdateVersion');
  return `<div class="grid2">
    <a class="pn tile" href="#/updates">${icon('doc', 22, 'var(--cyan)')}<span style="font-weight:500">Software</span><span class="t">${upd ? `${esc(upd)} ${updateStage()}` : esc(sig('Version') || 'Release notes')}</span></a>
    <a class="pn tile" href="#/alerts">${icon('bell', 22, active ? 'var(--amber)' : 'var(--cyan)')}<span style="font-weight:500">Alerts</span><span class="t">${esc(alertSub)}</span></a>
  </div>`;
}

export function homeView(state) {
  const trips = useData('trips', '/api/trips?limit=60', 120_000);
  const charging = useData('charging', '/api/charging', 120_000);
  const week = trips?.week?.this_week;
  const month = monthMoney(charging?.month, state.meta.currency);
  return `<div class="journal-intro"><div><span class="chapter-kicker">THE CURRENT CHAPTER</span><h2>Life with ${esc(sig('VehicleName') || 'your Plaid')}.</h2><p>${esc(carStatus())}</p></div><a class="text-link" href="#/insights">Read your car's story ↗</a></div>
    <div class="vehicle-journal-grid"><article class="pn journal-mileage"><div class="chapter-kicker">THIS WEEK / ON THE ROAD</div><div class="journal-distance">${num(week?.miles)}<span>miles</span></div><div class="journal-comparison"><span><b>${num(week?.trips)}</b> completed drives</span><span><b>${num(week?.wh_per_mile)}</b> Wh/mi</span></div><div class="journal-cost"><span>${esc(month.label)}</span><strong>${month.value}</strong></div><a class="text-link" href="#/trips">Open the journey log ↗</a>${chips(['Odometer', 'EnergyRemaining'], state.signals)}</article>${insights(state)}</div>
    ${facts(state)}
    <div class="journal-section-label"><span>THE OWNER'S NOTEBOOK</span><i></i><span>DETAILS WORTH KNOWING</span></div>
    ${logLinks(state)}
    ${streamPanel(state)}`;
}
