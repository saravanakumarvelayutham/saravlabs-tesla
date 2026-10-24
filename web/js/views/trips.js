// Phone · Trips tab and trip detail.
import { load } from '../core.js';
import { chips, day, esc, lineChart, money, num, ring, sampleBadge, temp } from '../ui.js';

const effColor = (wh) => (wh == null ? '#5B6878' : wh < 280 ? 'var(--cyan)' : wh <= 340 ? 'var(--violet)' : 'var(--amber)');

// Route drawn on the grid (no map tiles, so no map provider or API key is needed).
function routeSvg(trip) {
  const pts = trip.route || [];
  if (pts.length < 2) return '<div class="empty">No route points for this trip (needs the vehicle_location scope).</div>';
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const w = 356;
  const h = 250;
  const pad = 26;
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const span = Math.max((maxLon - minLon) * kx, maxLat - minLat) || 1e-4;
  const X = (lon) => pad + ((lon - minLon) * kx / span) * (w - pad * 2);
  const Y = (lat) => h - pad - ((lat - minLat) / span) * (h - pad * 2);
  const segOf = (ts) => trip.segments?.find((s) => ts >= s.from && ts <= s.to)?.wh_per_mile ?? null;
  let lines = '';
  for (let i = 1; i < pts.length; i++) {
    const c = effColor(segOf(pts[i][2]));
    const d = `x1="${X(pts[i - 1][1]).toFixed(1)}" y1="${Y(pts[i - 1][0]).toFixed(1)}" x2="${X(pts[i][1]).toFixed(1)}" y2="${Y(pts[i][0]).toFixed(1)}"`;
    lines += `<line ${d} stroke="${c}" stroke-width="10" stroke-linecap="round" opacity="0.22"></line><line ${d} stroke="${c}" stroke-width="4" stroke-linecap="round"></line>`;
  }
  const s = pts[0];
  const e = pts[pts.length - 1];
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Route trace colored by energy use">
    <rect width="${w}" height="${h}" fill="#060B12"></rect>
    ${lines}
    <circle cx="${X(s[1])}" cy="${Y(s[0])}" r="6" fill="var(--bg)" stroke="var(--text)" stroke-width="2"></circle>
    <circle cx="${X(e[1])}" cy="${Y(e[0])}" r="7" fill="var(--cyan)"></circle>
    <rect class="m" x="12" y="232" width="10" height="4" fill="var(--cyan)"></rect><text class="m" x="26" y="237" fill="var(--text-2)" font-size="9">&lt;280</text>
    <rect x="70" y="232" width="10" height="4" fill="var(--violet)"></rect><text class="m" x="84" y="237" fill="var(--text-2)" font-size="9">280–340</text>
    <rect x="146" y="232" width="10" height="4" fill="var(--amber)"></rect><text class="m" x="160" y="237" fill="var(--text-2)" font-size="9">&gt;340 Wh/mi</text>
    <text class="m" x="12" y="20" fill="var(--muted)" font-size="9" letter-spacing="1.2">ROUTE FROM LOCATION · ${pts.length} POINTS</text>
  </svg>`;
}

// Where a regen figure came from (server/derive/regen.js), for labels and source chips.
export const regenFields = (r) => (r?.regen_source === 'pack_power' ? ['PackVoltage', 'PackCurrent', 'EnergyRemaining']
  : r?.regen_source === 'mixed' ? ['LifetimeEnergyGainedRegen', 'PackVoltage', 'PackCurrent'] : ['LifetimeEnergyGainedRegen']);
export const regenNote = (r) => (r?.regen_source === 'pack_power'
  ? 'Estimated from pack voltage × current, since the car isn\'t sending its regen counter.'
  : r?.regen_source === 'mixed' ? 'Partly from LifetimeEnergyGainedRegen, partly estimated from pack voltage × current.' : '');

const tripName = (t) => `${esc(t.start_place || 'Away')} → ${esc(t.end_place || 'Away')}`;
const tripCost = (t, meta) => (meta.home_rate && t.kwh != null ? money(t.kwh * meta.home_rate, meta.currency) : null);

// Regen and the steepest climb, for the trip detail page.
function tripExtras(trip) {
  const regen = trip.regen_share != null
    ? `<span class="green">Regen ${num(trip.regen_share * 100)}%</span>: ${num(trip.regen_kwh, 2)} kWh back${trip.regen_source === 'pack_power' ? ' (estimated from pack power)' : ''}`
    : 'Regen: no data for this trip';
  const graded = (trip.segments || []).filter((s) => s.grade_pct != null);
  const climb = graded.length ? graded.reduce((a, b) => (b.grade_pct > a.grade_pct ? b : a)) : null;
  const grade = climb ? ` · steepest stretch ${num(climb.grade_pct, 1)}% grade at ${num(climb.wh_per_mile)} Wh/mi` : '';
  return regen + grade;
}

function tripCard(trip, state, full) {
  return `<div class="pn" style="padding:0;overflow:hidden">
    ${routeSvg(trip)}
    <div class="grid4" style="padding:12px 16px">
      <div><div class="k">Dist</div><div style="font-size:17px;font-weight:700">${num(trip.miles, 1)} mi</div></div>
      <div><div class="k">Time</div><div style="font-size:17px;font-weight:700">${num(trip.minutes)} min</div></div>
      <div><div class="k">Wh/mi</div><div style="font-size:17px;font-weight:700;color:${effColor(trip.wh_per_mile)}">${num(trip.wh_per_mile)}</div></div>
      <div><div class="k">${tripCost(trip, state.meta) ? 'Cost' : 'Energy'}</div><div style="font-size:17px;font-weight:700">${tripCost(trip, state.meta) || `${num(trip.kwh, 1)} kWh`}</div></div>
    </div>
    ${full ? `<div class="t" style="padding:0 16px 8px">Max ${num(trip.max_speed)} mph · outside ${temp(trip.outside_temp, true)} · battery ${num(trip.start_soc)}→${num(trip.end_soc)}%</div>
    <div class="t" style="padding:0 16px 8px">${tripExtras(trip)}</div>` : ''}
    <div style="padding:0 16px 14px">${chips([...new Set(['Location', 'Gear', 'Odometer', 'EnergyRemaining', 'VehicleSpeed', ...(full ? [...regenFields(trip), 'GradeEstimatePercent'] : [])])], state.signals)}</div>
  </div>`;
}

export async function tripsView(state) {
  const { trips, week } = await load('trips', '/api/trips?limit=60', 60_000);
  const latest = trips[0] ? await load(`trip:${trips[0].id}`, `/api/trips/${trips[0].id}`, 3600_000) : null;
  const tw = week.this_week;
  const lw = week.last_week;
  const delta = tw.wh_per_mile && lw.wh_per_mile ? ((tw.wh_per_mile - lw.wh_per_mile) / lw.wh_per_mile) * 100 : null;
  const pts = week.weekly.filter((w) => w.outside_c != null).map((w) => [w.outside_c * 9 / 5 + 32, w.wh_per_mile]);
  const regenSig = state.signals.LifetimeEnergyGainedRegen;
  const share = tw.regen_share;
  return `
    <div class="head">
      <div class="stack" style="gap:6px"><div class="k">Trips</div><h1>${latest ? `${tripName(latest)} · ${day(latest.start_ts)}` : 'No trips yet'}</h1></div>
      ${sampleBadge(state.meta)}
    </div>
    ${latest ? tripCard(latest, state, false) : ''}
    <div class="grid2">
      <div class="pn" style="align-items:center;justify-content:center">
        ${share != null ? `<svg width="110" height="110" viewBox="0 0 110 110" role="img" aria-label="Regen recovered ${num(share * 100)} percent of energy used this week">${ring({ cx: 55, cy: 55, r: 44, frac: share, color: 'var(--green)' })}<text x="55" y="62" fill="var(--text)" font-size="22" font-weight="700" text-anchor="middle">${num(share * 100)}%</text></svg>
          <div class="k center">Regen recovered this week</div>
          <div class="t center">${num(tw.regen_kwh, 1)} kWh back of ${num(tw.kwh + tw.regen_kwh, 1)} kWh used${regenSig ? ` · ${num(regenSig.value, 0)} kWh lifetime` : ''}</div>
          ${regenNote(tw) ? `<div class="t center">${esc(regenNote(tw))}</div>` : ''}`
          : regenSig ? `<div class="k center">Regen recovered</div><div class="big center" style="font-size:28px">${num(regenSig.value, 0)} kWh</div>
          <div class="t center">Lifetime total. A weekly share needs a reading from before this week and trips with energy data.</div>`
          : `<div class="k center">Regen recovered</div><div class="t center">No regen data this week. It needs LifetimeEnergyGainedRegen (in Tesla's proto, not on their docs page) or PackVoltage and PackCurrent over a trip.</div>`}
        ${chips(regenFields(tw), state.signals)}
      </div>
      <div class="pn" style="justify-content:center">
        <div class="k">This week</div>
        <div class="big glow cyan" style="font-size:36px">${num(tw.wh_per_mile)}</div>
        <div class="t">Wh/mi over ${num(tw.miles)} mi${delta != null ? `, ${Math.abs(delta).toFixed(0)}% ${delta > 0 ? 'worse' : 'better'} than last week` : ''}</div>
      </div>
    </div>
    <div class="pn">
      <div class="k">Efficiency vs outside temp · 8 weeks</div>
      ${pts.length >= 2 ? lineChart({
        w: 326, h: 150, label: 'Weekly efficiency against average outside temperature',
        series: [{ points: [...pts].sort((a, b) => a[0] - b[0]), color: 'rgba(179,168,255,0.6)', dashed: true, width: 1.5 }],
        labels: ({ X, Y }) => pts.map(([x, y], i) => `<circle cx="${X(x)}" cy="${Y(y)}" r="${i === 0 ? 6 : 5}" fill="${i === 0 ? 'var(--text)' : 'var(--cyan)'}"></circle>`).join(''),
      }) : '<div class="empty">Needs two or more weeks of trips</div>'}
      <div class="t">Each dot is one week (white is this week). Temperatures shown in °F.</div>
      ${chips(['OutsideTemp', 'EnergyRemaining', 'Odometer'], state.signals)}
    </div>
    <div class="pn" style="gap:0">
      <div class="k" style="padding-bottom:6px">Recent trips</div>
      ${trips.slice(0, 15).map((t) => `<a class="trip" href="#/trips/${t.id}"><span style="font-weight:600">${tripName(t)}</span><span class="mono">${tripCost(t, state.meta) || `${num(t.kwh, 1)} kWh`}</span>
        <span class="t mono" style="color:${t.wh_per_mile > 340 ? 'var(--amber)' : 'var(--muted)'}">${day(t.start_ts)} · ${num(t.miles, 1)} MI · ${num(t.wh_per_mile)} WH/MI</span><span class="t mono">${temp(t.outside_temp, true)}</span></a>`).join('') || '<div class="empty">No trips yet</div>'}
      <div class="t" style="padding-top:8px">A trip runs from Gear leaving P to Gear back in P. Energy is the drop in EnergyRemaining (Tesla marks LifetimeEnergyUsedDrive as Semi-only).</div>
      ${chips(['LocatedAtHome', 'LocatedAtWork', 'LocatedAtFavorite', 'DestinationName'], state.signals)}
    </div>`;
}

export async function tripView(state, id) {
  const t = await load(`trip:${id}`, `/api/trips/${id}`, 3600_000);
  return `<div class="head"><div class="stack" style="gap:6px"><a class="k" href="#/trips">← Trips</a><h1>${tripName(t)} · ${day(t.start_ts)}</h1></div>${sampleBadge(state.meta)}</div>
    ${tripCard(t, state, true)}`;
}
