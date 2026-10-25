import { actions, render, useData } from '../core.js';
import { ago, chips, esc, num } from '../ui.js';
import { chargingInsight, drivingInsights, finite, overnightInsight, rangeInsight } from '../vehicle-insights.js';

const heading = (label, href, tag) => `<div class="intel-top"><span>${label}</span><a href="${href}">${tag} ↗</a></div>`;
// Keep evidence expanded across telemetry-triggered rerenders.
const expanded = new Set();
actions['insight-evidence'] = (el) => {
  const key = el.dataset.insight;
  if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
  render();
};
const evidence = (key, text) => `<details class="intel-method" ${expanded.has(key) ? 'open' : ''}><summary data-action="insight-evidence" data-insight="${key}">Evidence &amp; calculation</summary><p class="intel-evidence">${text}</p></details>`;
const metric = (value, unit) => `<div class="intel-metric">${value}<span>${unit}</span></div>`;
const waiting = (text) => `<div class="intel-wait">${text}</div>`;
const shell = (cls, body) => `<article class="pn intel-card ${cls}">${body}</article>`;

function rangeCard(d, state, now) {
  const r = rangeInsight(d, state.signals, now);
  const max = Math.max(r?.high || 0, 1);
  const bars = r ? [['Higher-use trips', r.low], ['Typical trip', r.typical], ['Lower-use trips', r.high]]
    .map(([label, miles], i) => `<div class="intel-range-row"><span>${label}</span><div><i style="width:${miles / max * 100}%;opacity:${i === 1 ? 1 : .4}"></i></div><b>${num(miles)} mi</b></div>`).join('') : '';
  return shell('intel-range', `${heading('01 / Your usable range', '#/trips', 'Estimate')}
    <h2>How far does your driving take you?</h2>
    ${r ? `${metric(num(r.typical), 'mi to a 10% reserve')}<p>At your recent median of <strong>${num(d.median)} Wh/mi</strong>, with ${num(r.usable, 1)} kWh above reserve.</p><div class="intel-range-bars">${bars}</div>`
      : waiting(d.count < 5 ? `${d.count}/5 qualifying trips recorded. Range learns from your driving.` : 'Waiting for energy and battery readings received within the last 15 minutes and within 2 minutes of each other.')}
    ${evidence('range', `${d.count} qualifying trips from the last 30 days, within the latest 60 drives. Bands use the middle half of trip efficiencies, not a forecast interval. Excludes drives under 1 mile and net energy gains. ${r ? `Read ${ago(r.ts, now)}. ` : ''}Weather, speed and route can change actual range.`)}
    ${chips(['EnergyRemaining', 'Soc', 'Odometer'], state.signals)}`);
}

function tripCard(d, state) {
  const points = d.measured;
  const maxX = Math.max(10, ...points.map((t) => t.miles));
  const maxY = Math.max(1, ...points.map((t) => t.kwh * 1000 / t.miles));
  const X = (x) => 35 + x / maxX * 290;
  const Y = (y) => 132 - y / maxY * 110;
  const delta = d.shortDelta;
  return shell('intel-trips', `${heading('02 / Trip length effect', '#/trips', 'Observed')}
    <h2>${delta == null ? 'Are short trips costing more energy?' : `${d.split.label} use ${num(Math.abs(delta))}% ${delta >= 0 ? 'more' : 'less'} per mile`}</h2>
    ${points.length ? `<svg class="intel-plot" viewBox="0 0 350 165" role="img" aria-label="Trip distance versus net watt-hours per mile. Each dot is a trip.">
      <text x="35" y="12">Wh/mi · ${num(maxY)} at top</text><path d="M35 20V132H325" class="intel-axis"/>
      ${finite(d.long.wh) ? `<path d="M35 ${Y(d.long.wh)}H325" class="intel-reference"/>` : ''}
      ${points.map((t) => `<circle cx="${X(t.miles)}" cy="${Y(t.kwh * 1000 / t.miles)}" r="4" fill="${t.miles < d.split.shortMax ? 'var(--amber)' : 'var(--cyan)'}" opacity=".8"><title>${num(t.miles, 1)} mi · ${num(t.kwh * 1000 / t.miles)} Wh/mi</title></circle>`).join('')}
      <text x="35" y="153">0 mi</text><text x="325" y="153" text-anchor="end">${num(maxX)} mi</text></svg>` : waiting('Completed drives with distance and energy readings will appear here.')}
    <div class="intel-pair"><div><span>1–&lt;${d.split.shortMax} mi · ${d.short.count} trips</span><b>${num(d.short.wh)} <small>Wh/mi</small></b></div><div><span>${d.split.longMin}+ mi · ${d.long.count} trips</span><b>${num(d.long.wh)} <small>Wh/mi</small></b></div></div>
    ${evidence('trips', `${delta == null ? 'Comparison needs at least 3 trips in each group. ' : ''}Distance-weighted averages over the same recent drives as the range estimate. Uses a 25-mile split when short-trip history is insufficient. Amber dots are under ${d.split.shortMax} mi; dashed line is the ${d.split.longMin}+ mi average. Route, weather and cabin heating may differ; this is not a causal comparison.`)}
    ${chips(['EnergyRemaining', 'Odometer'], state.signals)}`);
}

function regenCard(week, state) {
  const w = week?.this_week;
  const share = w?.regen_share;
  const ready = finite(share) && share >= 0 && share <= 1 && finite(w?.regen_kwh) && w.regen_kwh >= 0;
  const estimated = w?.regen_source === 'pack_power' || w?.regen_source === 'mixed';
  return shell('intel-regen', `${heading('03 / Energy recovered', '#/trips', estimated ? 'Estimated' : 'Measured')}
    <h2>${ready ? `${num(share * 100)}% of ${finite(w?.regen_trips) ? 'energy on measured trips' : 'driving energy'} came back` : 'What did regenerative braking recover?'}</h2>
    ${ready && finite(w?.regen_trips) ? `<p>Regen coverage: <strong>${w.regen_trips} ${w.regen_trips === 1 ? 'trip' : 'trips'}</strong> in the last 7 days; other trips are excluded from this share.</p>` : ''}
    ${ready ? `${metric(num(w.regen_kwh, 1), 'kWh recovered · last 7 days')}
      <div class="intel-flow" role="img" aria-label="${num(share * 100)} percent recovered; ${num((1 - share) * 100)} percent net energy used">
        <span style="width:${(1 - share) * 100}%"></span><span style="width:${share * 100}%"></span>
      </div><div class="intel-pair"><div><span>Net energy used</span><b>${num((1 - share) * 100)}%</b></div><div><span>Recovered</span><b>${num(share * 100)}%</b></div></div><p>The recovered share compares regen with <strong>net battery use + recovered energy</strong>.</p>` : waiting('Needs a regen counter or usable pack voltage/current readings during drives.')}
    ${evidence('regen', `${estimated ? 'Includes estimates from pack voltage × current.' : 'Uses the car’s regen energy counter when available.'} ${finite(w?.regen_trips) ? `Coverage: ${w.regen_trips} trips with regen data. ` : ''}This is energy recaptured, not additional miles already driven or a guaranteed cost saving.`)}
    ${chips(estimated ? ['PackVoltage', 'PackCurrent'] : ['LifetimeEnergyGainedRegen'], state.signals)}`);
}

function drainCard(drain, d, battery, state) {
  const n = overnightInsight(drain, d, battery);
  const max = Math.max(1, ...n.nights.map((v) => Math.abs(v.drain_pct)));
  return shell('intel-night', `${heading('04 / While you sleep', '#/health', 'Observed')}
    <h2>${n.difference == null ? 'What does parking overnight use?' : `Sentry-on nights lost ${num(Math.abs(n.difference), 1)} points ${n.difference >= 0 ? 'more' : 'less'}`}</h2>
    <div class="intel-nights">${n.nights.length ? n.nights.map((v) => `<div><b>${num(v.drain_pct, 1)}%</b><div class="intel-night-bar"><i style="height:${Math.abs(v.drain_pct) / max * 100}%;background:${v.sentry ? 'var(--amber)' : 'var(--cyan)'}"></i></div><span>${esc(v.night?.slice(5) || '')}</span></div>`).join('') : waiting('Waiting for a full parked night without charging.')}</div>
    <div class="intel-pair">${[['Sentry on', n.on], ['Sentry off', n.off]].map(([label, g]) => `<div><span>${label} · ${g.count} nights</span><b>${num(g.avg, 1)}<small> points/night</small></b>${g.miles == null ? '' : `<span>≈ ${num(g.miles, 1)} mi of driving energy</span>`}</div>`).join('')}</div>
    ${evidence('drain', 'Last 7 nights, 10 PM–6 AM in server time. Comparison needs 2 nights per group; any Sentry use counts as on. Driving equivalents use latest estimated pack capacity and recent median efficiency, not measured range lost. Negative bars indicate a net battery gain. Conditions differ; this does not isolate Sentry’s impact.')}
    ${chips(['Soc', 'SentryMode', 'EnergyRemaining'], state.signals)}`);
}

function chargeCard(charging) {
  const { points, comparison: c } = chargingInsight(charging?.avg_dc_curve);
  const max = Math.max(1, ...points.map(([, kw]) => kw));
  const coords = points.map(([soc, kw]) => `${30 + soc * 2.9},${135 - kw / max * 105}`).join(' ');
  return shell('intel-charge', `${heading('05 / Fast-charge sweet spot', '#/charge', 'Your curve')}
    <h2>${c ? `${esc(c.lateLabel)} charging power is ${num(Math.abs(c.drop))}% ${c.drop >= 0 ? 'lower' : 'higher'}` : 'Where does your charging slow down?'}</h2>
    ${points.length >= 2 ? `<svg class="intel-plot" viewBox="0 0 350 165" role="img" aria-label="Average DC charging power versus battery percentage">
      ${c ? `<rect x="${30 + c.lateStart * 2.9}" y="25" width="${(c.lateEnd - c.lateStart) * 2.9}" height="110" fill="var(--amber)" opacity=".08"/>` : ''}<text x="30" y="14">kW · ${num(max)} at top</text>
      <path d="M30 25V135H320" class="intel-axis"/><polyline points="${coords}" fill="none" stroke="var(--cyan)" stroke-width="3"/>
      ${points.map(([soc, kw]) => `<circle cx="${30 + soc * 2.9}" cy="${135 - kw / max * 105}" r="3" fill="var(--cyan)"><title>${num(soc)}% · ${num(kw)} kW</title></circle>`).join('')}
      <text x="30" y="155">0%</text><text x="175" y="155" text-anchor="middle">50%</text><text x="320" y="155" text-anchor="end">100%</text></svg>` : waiting('Your DC sessions will build a charging curve here.')}
    <div class="intel-pair"><div><span>${esc(c?.earlyLabel || 'Lower charge')} battery</span><b>${num(c?.earlyKw)} <small>kW avg</small></b></div><div><span>${esc(c?.lateLabel || 'Higher charge')} battery</span><b>${num(c?.lateKw)} <small>kW avg</small></b></div></div>
    ${evidence('charge', `${c ? `Based on ${c.earlyBins} lower-charge and ${c.lateBins} higher-charge bins. ` : 'Needs at least 2 power bins in each charge band. '}Compares 20–50% against 70–90% when available, otherwise the lowest and highest thirds of observed bins across at least 15 battery points. Equal-weight averages of 5% bins from up to 20 DC sessions. Power comparison, not elapsed charging time. Charger limits and battery temperature also matter.`)}`);
}

function tireCard(tires, state) {
  const worst = [...(tires?.leaks || [])].sort((a, b) => a.psi_per_day - b.psi_per_day)[0];
  const hasWarning = (tires?.hard_warnings?.length || 0) + (tires?.soft_warnings?.length || 0) > 0;
  const changes = Object.entries(tires?.series || {}).map(([tire, pts]) => ({ tire, pts: pts.filter(([ts, p]) => finite(ts) && finite(p)).sort((a, b) => a[0] - b[0]) }));
  const any = changes.some((g) => g.pts.length >= 2);
  return shell('intel-tires', `${heading('06 / Pressure watch', '#/health/tires', worst || hasWarning ? 'Check tires' : 'Cold readings')}
    <h2>${hasWarning ? 'Your car reports a tire-pressure warning' : worst ? `${esc(worst.tire)} is drifting away from the others` : any ? 'Are your tires holding pressure together?' : 'Watch for a slow pressure loss'}</h2>
    <div class="intel-tire-grid">${changes.map(({ tire, pts }) => {
      const delta = pts.length >= 2 ? pts[pts.length - 1][1] - pts[0][1] : null;
      const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
      const span = pts.length ? pts[pts.length - 1][0] - pts[0][0] : 0;
      const flagged = tires?.leaks?.some((l) => l.tire === tire);
      return `<div class="${flagged ? 'intel-flag' : ''}"><span>${esc(tire)} · ${pts.length} readings</span><b>${delta == null ? '—' : `${Math.abs(delta) < .05 ? '0.0' : `${delta > 0 ? '+' : ''}${num(delta, 1)}`}`} <small>psi</small></b>
        ${pts.length >= 2 ? `<svg viewBox="0 0 130 35" role="img" aria-label="${esc(tire)} cold pressure trend; independent vertical scale"><polyline points="${pts.map(([ts, p]) => `${4 + (ts - pts[0][0]) / Math.max(1, span) * 122},${30 - (p - lo) / Math.max(.5, hi - lo) * 25}`).join(' ')}" fill="none" stroke="${flagged ? 'var(--amber)' : 'var(--cyan)'}" stroke-width="2"/></svg>` : ''}</div>`;
    }).join('') || waiting('Cold tire readings accumulate after the car has been parked.')}</div>
    ${evidence('tires', `${worst ? `${esc(worst.tire)} lost ${num(worst.drop_psi, 1)} psi across ${worst.days} daily readings. Check cold pressure against the door placard and inspect for a leak. ` : hasWarning ? 'Check the car’s tire warning and cold pressure before relying on these trends. ' : 'Changes compare the first and latest cold readings in the last 30 days. '}Sparklines use independent vertical scales; compare the numeric changes. Cold readings require 3 hours parked. These are app trend rules, not a tire-health diagnosis.`)}
    ${chips(['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr'], state.signals)}`);
}

export function renderOverview({ trips, charging, drain, battery, tires }, state, now = Date.now()) {
  const d = drivingInsights(trips?.trips, now);
  return `<section class="overview vehicle-intelligence" aria-label="Insights from your car">
    <div class="intel-heading"><div><span class="intel-kicker">BEYOND THE ODOMETER</span><h2>What your car is telling you</h2><p>Patterns from your drives, charging stops and parked nights.</p></div><span class="intel-data-label">${state.meta.sample_mode ? 'SIMULATED DATA · DEMO INSIGHTS' : 'YOUR RECORDED DATA'}</span></div>
    <div class="intel-grid">${rangeCard(d, state, now)}${tripCard(d, state)}${regenCard(trips?.week, state)}${drainCard(drain, d, battery, state)}${chargeCard(charging)}${tireCard(tires, state)}</div>
  </section>`;
}

export function overviewGraphics(state) {
  return renderOverview({
    trips: useData('trips', '/api/trips?limit=60', 60_000),
    charging: useData('charging', '/api/charging', 120_000),
    drain: useData('drain', '/api/health/drain', 600_000),
    battery: useData('battery', '/api/health/battery', 600_000),
    tires: useData('tires', '/api/health/tires', 600_000),
  }, state);
}
