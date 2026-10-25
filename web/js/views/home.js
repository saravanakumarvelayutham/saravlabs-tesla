// Phone · Car tab: live status, car wireframe, energy, signal stream, insights.
import { sig, useData } from '../core.js';
import { ago, carTop, chips, clock, esc, fmtValue, icon, num, sampleBadge, temp } from '../ui.js';

export function liveLine(state) {
  const latest = Object.values(state.signals).reduce((m, e) => Math.max(m, e.ts || 0), 0);
  const fresh = Date.now() - latest < 5 * 60_000;
  const src = state.meta.sample_mode ? 'Sample' : state.meta.telemetry?.status === 'DISCONNECTED' ? 'Telemetry offline' : 'Telemetry';
  return `<div class="row" style="justify-content:flex-start;gap:8px"><span class="live${fresh ? '' : ' off'}"></span><span class="k" style="color:${fresh ? 'var(--green)' : 'var(--muted)'}">${fresh ? 'Live link' : 'Last seen'} · ${src} · ${ago(latest)}</span></div>`;
}

export function energyPanel(state, { compact = false } = {}) {
  const soc = sig('Soc');
  const limit = sig('ChargeLimitSoc');
  const segs = 40;
  const on = typeof soc === 'number' ? Math.round((soc / 100) * segs) : 0;
  const limitSeg = typeof limit === 'number' ? Math.round((limit / 100) * segs) : -1;
  const cs = (sig('DetailedChargeState') || '').replace('DetailedChargeState', '') || '—';
  const plug = cs === 'Disconnected' ? 'Unplugged' : cs;
  return `<div class="pn" style="gap:10px">
    <div class="row end">
      <div><div class="k">Energy</div><div class="big glow cyan" style="font-size:${compact ? 54 : 64}px">${num(soc)}<span style="font-size:26px">%</span></div></div>
      <div style="text-align:right"><div class="mono" style="font-size:22px;font-weight:700">${num(sig('RatedRange'))} MI</div><div class="k">Rated range</div></div>
    </div>
    <div class="seg-bar" role="img" aria-label="Battery ${num(soc)} percent, limit ${num(limit)} percent">
      ${Array.from({ length: segs }, (_, i) => `<div class="seg${i < on ? ' on' : ''}${i === limitSeg ? ' limit' : ''}"></div>`).join('')}
    </div>
    <div class="row k"><span>Limit ${num(limit)}%</span><span>${esc(plug)}</span></div>
    ${chips(['Soc', 'RatedRange', 'ChargeLimitSoc', 'DetailedChargeState'], state.signals)}
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

function insights(state) {
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
  if (upd) items.push(['#/updates', 'download', 'var(--cyan)', `Software update ${esc(upd)} is ready`, 'Release notes · install from the car or the Tesla app']);
  // Leaks and updates already have their own line above, so skip their events here.
  const shown = new Set(['tire_leak', ...(upd ? ['software_update'] : [])]);
  for (const ev of state.events.filter((e) => !shown.has(e.kind)).slice(0, 2)) items.push(['#/', 'pulse', 'var(--violet)', esc(ev.title), `${esc(ev.body || '')} · ${ago(ev.ts)}`]);
  if (!items.length) return '';
  return `<div class="pn" style="gap:12px"><div class="k">Insights</div>
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
    <a class="pn tile" href="#/updates">${icon('doc', 22, 'var(--cyan)')}<span style="font-weight:500">Software</span><span class="t">${upd ? `${esc(upd)} ready` : esc(sig('Version') || 'Release notes')}</span></a>
    <a class="pn tile" href="#/alerts">${icon('bell', 22, active ? 'var(--amber)' : 'var(--cyan)')}<span style="font-weight:500">Alerts</span><span class="t">${esc(alertSub)}</span></a>
  </div>`;
}

export function homeView(state) {
  const tires = useData('tires', '/api/health/tires', 5 * 60_000);
  return `
    <div class="head">
      <div class="stack" style="gap:6px">
        <div class="k">Model S Plaid</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:-0.01em">${esc(sig('VehicleName') || 'My Plaid')}</div>
        ${liveLine(state)}
      </div>
      <div class="stack" style="align-items:flex-end;gap:8px">${sampleBadge(state.meta)}<a href="#/setup" class="k" aria-label="Setup">${icon('gear', 20, 'var(--muted)')}</a></div>
    </div>
    <div class="pn" style="padding:8px 8px 12px">
      ${carTop(state.signals, { leaks: (tires?.leaks || []).map((l) => l.tire) })}
      <div style="padding:0 8px">${chips(['TpmsPressureFl', 'TpmsPressureRl', 'InsideTemp', 'OutsideTemp', 'Locked', 'DoorState', 'SentryMode'], state.signals)}</div>
    </div>
    ${energyPanel(state)}
    ${streamPanel(state)}
    ${insights(state)}
    ${logLinks(state)}
    <div class="t center">Cabin ${temp(sig('InsideTemp'), true)}.</div>`;
}
