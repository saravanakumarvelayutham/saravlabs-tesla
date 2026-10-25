// Overview graphics reuse the same summaries as the detailed screens.
import { useData } from '../core.js';
import { esc, money, num } from '../ui.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const empty = (text) => `<div class="empty">${text}</div>`;
const title = (label, href) => `<div class="row"><h2 class="k">${label}</h2><a class="overview-link" href="${href}">Explore →</a></div>`;

export function efficiencyGraphic(week) {
  const current = week?.this_week;
  const previous = week?.last_week?.wh_per_mile;
  const delta = finite(current?.wh_per_mile) && finite(previous) && previous > 0
    ? (current.wh_per_mile / previous - 1) * 100 : null;
  const weeks = (week?.weekly || []).filter((w) => finite(w.wh_per_mile) && finite(w.weeks_ago)).sort((a, b) => b.weeks_ago - a.weeks_ago);
  const max = Math.max(1, ...weeks.map((w) => Math.abs(w.wh_per_mile)));
  return `<article class="pn overview-card">
    ${title('Driving efficiency', '#/trips')}
    <div class="overview-value">${num(current?.wh_per_mile)} <span>Wh/mi</span></div>
    <div class="t">Last 7 days · ${num(current?.miles, 1)} mi · ${num(current?.trips)} measured trips</div>
    ${weeks.length ? `<div class="overview-columns" role="list" aria-label="Weekly energy use per mile">${weeks.map((w) => `<div class="overview-column" role="listitem">
      <span class="mono">${num(w.wh_per_mile)}</span>
      <div class="overview-bar-space"><div class="overview-column-bar${w.weeks_ago === 0 ? ' current' : ''}" style="height:${Math.abs(w.wh_per_mile) / max * 100}%"></div></div>
      <span class="t">${w.weeks_ago === 0 ? 'Now' : `${w.weeks_ago}w ago`}</span>
    </div>`).join('')}</div>` : empty('Weekly trends appear after measured trips.')}
    <div class="overview-note t">${delta == null ? 'Comparison needs measured trips in both 7-day periods.' : `${num(Math.abs(delta), 1)}% ${delta < 0 ? 'less' : 'more'} energy per mile than the previous 7 days.`} Lower means less net energy used. Bars show magnitude; negative values indicate net energy gained.</div>
  </article>`;
}

export function chargingGraphic(month, currency) {
  const groups = [
    { label: 'Home AC', count: month?.home?.sessions, color: 'var(--cyan)' },
    { label: 'DC fast charge', count: month?.dc?.sessions, color: 'var(--violet)' },
    { label: 'Other AC', count: month?.other?.sessions, color: 'var(--amber)' },
  ];
  const ready = groups.every((g) => finite(g.count) && g.count >= 0);
  const total = ready ? groups.reduce((s, g) => s + g.count, 0) : null;
  let offset = 0;
  const arcs = total > 0 ? groups.map((g) => {
    const share = g.count / total * 100;
    const circle = `<circle cx="80" cy="80" r="62" pathLength="100" fill="none" stroke="${g.color}" stroke-width="12" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"></circle>`;
    offset += share;
    return circle;
  }).join('') : '';
  return `<article class="pn overview-card">
    ${title('Charging mix', '#/charge')}
    <div class="t">${esc(new Date().toLocaleString([], { month: 'long', year: 'numeric' }))} · completed sessions</div>
    <div class="overview-mix">
      <svg viewBox="0 0 160 160" role="img" aria-label="${total == null ? 'Charging data unavailable' : `${total} charging sessions this month`}">
        <circle cx="80" cy="80" r="62" fill="none" stroke="var(--track)" stroke-width="12"></circle>${arcs}
        <text x="80" y="80" text-anchor="middle" fill="var(--text)" font-size="32">${num(total)}</text>
        <text x="80" y="101" text-anchor="middle" fill="var(--muted)" font-size="11">sessions</text>
      </svg>
      <div class="overview-legend">${groups.map((g) => `<div><span class="overview-dot" style="background:${g.color}"></span><span>${g.label}</span><strong>${num(g.count)}</strong></div>`).join('')}</div>
    </div>
    <div class="overview-note t">${total === 0 ? 'No completed charging sessions this month.' : total == null ? 'Charging summary is not available yet.' : 'Share of sessions, not energy. DC includes all fast chargers.'}
      ${finite(month?.cost_per_mile) ? `<div class="overview-cost">${money(month.cost_per_mile, currency, 3)} / mi <span>charging cost this month</span></div>` : '<div>Cost per mile appears when mileage and charging costs are available.</div>'}
    </div>
  </article>`;
}

export function drainGraphic(drain) {
  const groups = [
    { label: 'Sentry on', value: drain?.sentry_avg, sentry: true, color: 'var(--amber)' },
    { label: 'Sentry off', value: drain?.no_sentry_avg, sentry: false, color: 'var(--cyan)' },
  ];
  const max = Math.max(1, ...groups.map((g) => finite(g.value) ? Math.abs(g.value) : 0));
  return `<article class="pn overview-card">
    ${title('Overnight battery use', '#/health')}
    <div class="t">Average battery percentage points · 10 PM–6 AM</div>
    <div class="overview-drain">${groups.map((g) => {
      const nights = (drain?.nights || []).filter((n) => n.valid && !!n.sentry === g.sentry).length;
      return `<div><div class="row"><span>${g.label}</span><strong class="mono">${finite(g.value) ? `${num(g.value, 1)}%` : '—'}</strong></div>
        <div class="overview-track"><div style="width:${finite(g.value) ? Math.abs(g.value) / max * 100 : 0}%;background:${g.color}"></div></div>
        <div class="t">${nights} qualifying ${nights === 1 ? 'night' : 'nights'}${finite(g.value) && g.value < 0 ? ' · net battery gain' : ''}</div></div>`;
    }).join('')}</div>
    <div class="overview-note t">Only parked nights without charging count. Weather and other systems also affect drain; this comparison does not isolate Sentry’s impact. Missing readings are not zero.</div>
  </article>`;
}

export function overviewGraphics(state) {
  const trips = useData('trips', '/api/trips?limit=60', 60_000);
  const charging = useData('charging', '/api/charging', 120_000);
  const drain = useData('drain', '/api/health/drain', 600_000);
  return `<section class="overview" aria-label="Your car in numbers">
    <div class="eyebrow">Your car / In numbers${state.meta.sample_mode ? ' · Sample data' : ''}</div>
    <div class="overview-grid">${efficiencyGraphic(trips?.week)}${chargingGraphic(charging?.month, state.meta.currency)}${drainGraphic(drain)}</div>
  </section>`;
}
