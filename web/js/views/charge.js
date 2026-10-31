// Phone · Charging tab.
import { load, sig } from '../core.js';
import { arc, chips, day, esc, lineChart, money, num, sampleBadge } from '../ui.js';

export async function chargeView(state) {
  const data = await load('charging', '/api/charging', 30_000);
  const past = await load('charging-history', '/api/charging/history', 300_000).catch(() => null);
  const cur = data.current;
  const dc = cur ? cur.dc : /Supercharger|CHAdeMO|Combo|GB/.test(sig('FastChargerType') || '');
  const kw = cur ? sig(dc ? 'DCChargingPower' : 'ACChargingPower') : null;
  const status = cur ? (dc ? 'Supercharging' : 'Charging') : 'Not charging';
  const maxKw = dc ? 250 : 20;
  const hours = sig('TimeToFullCharge');
  const sessionCurve = (cur?.curve || []).filter((p) => p[0] != null).map(([soc, k]) => [soc, k]);
  const avg = data.avg_dc_curve || [];
  const m = data.month;
  const cur$ = state.meta.currency;
  const homeCost = m.home.cost;
  const teslaHist = data.tesla_history;
  const volts = !dc && cur ? sig('ChargerVoltage') : null;
  const histNote = !teslaHist ? "Supercharger cost needs Tesla's charging history: link your Tesla account on Setup."
    : `${teslaHist.sample ? 'Sample ' : ''}Tesla charging history from ${new Date(teslaHist.ts).toLocaleString()}: ${teslaHist.recognized} of ${teslaHist.total_records} records read. Tesla doesn't publish this format, so the mapping is unverified until checked against your account.`;
  return `
    <div class="head">
      <div class="stack" style="gap:6px"><div class="k">Charging</div>
        <div class="row" style="gap:8px;justify-content:flex-start">${cur ? '<span class="live"></span>' : ''}<h1>${status}</h1></div></div>
      ${sampleBadge(state.meta)}
    </div>
    <div class="pn" style="align-items:center;padding:12px 16px 16px">
      <svg class="chart" viewBox="0 0 300 260" style="max-width:300px" role="img" aria-label="Charging power ${num(kw)} kilowatts">
        ${arc({ cx: 150, cy: 140, r: 110, frac: (kw || 0) / maxKw, id: 'cd' })}
        <circle cx="150" cy="140" r="88" fill="none" stroke="rgba(90,167,255,0.12)" stroke-dasharray="1 5"></circle>
        <text class="m" x="150" y="118" fill="var(--muted)" font-size="10" text-anchor="middle" letter-spacing="1.6">POWER</text>
        <text x="150" y="166" fill="var(--cyan)" font-size="64" font-weight="700" text-anchor="middle" letter-spacing="-2">${cur ? num(kw) : '—'}</text>
        <text class="m" x="150" y="190" fill="var(--text-2)" font-size="13" text-anchor="middle">kW · ${dc ? 'DC' : 'AC'}${typeof volts === 'number' ? ` · ${num(volts)} V` : ''}</text>
        <text class="m" x="62" y="252" fill="var(--muted)" font-size="10" text-anchor="middle">0</text>
        <text class="m" x="238" y="252" fill="var(--muted)" font-size="10" text-anchor="middle">${maxKw}</text>
      </svg>
      <div class="grid3 center" style="width:100%">
        <div><div class="k">Battery</div><div style="font-size:22px;font-weight:700">${cur ? `${num(cur.start_soc)}<span style="color:var(--muted)">→</span>` : ''}${num(sig('ChargeLimitSoc'))}%</div></div>
        <div><div class="k">To limit</div><div style="font-size:22px;font-weight:700">${cur && typeof hours === 'number' ? `${Math.round(hours * 60)} min` : '—'}</div></div>
        <div><div class="k">Added</div><div style="font-size:22px;font-weight:700">${cur ? `${num(sig('DCChargingEnergyIn'), 1)} kWh` : '—'}</div></div>
      </div>
      ${chips([dc ? 'DCChargingPower' : 'ACChargingPower', ...(dc ? [] : ['ChargerVoltage']), 'Soc', 'ChargeLimitSoc', 'TimeToFullCharge', 'DCChargingEnergyIn', 'FastChargerType'], state.signals)}
    </div>

    <div class="pn">
      <div class="row"><span class="k">Charge curve · kW vs battery %</span><span class="k cyan">${cur ? 'Live' : 'Average'}</span></div>
      ${lineChart({
        w: 326, h: 160, xmin: 0, xmax: 100, ymin: 0, ymax: 260,
        label: 'DC charging power against battery percent',
        series: [
          { points: avg, color: '#5B6878', dashed: true, width: 1.5 },
          ...(sessionCurve.length ? [{ points: sessionCurve, color: 'var(--cyan)', area: true }] : []),
        ],
        marker: sessionCurve.length ? [...sessionCurve[sessionCurve.length - 1], 'var(--cyan)'] : null,
        labels: ({ X, bottom }) => `<text class="m" x="${X(0)}" y="${bottom + 13}" fill="var(--muted)" font-size="9">0%</text><text class="m" x="${X(100)}" y="${bottom + 13}" fill="var(--muted)" font-size="9" text-anchor="end">100%</text>`,
      })}
      <div class="t">Bright line is this session, dashed is your average over past DC sessions. Point spacing follows the Telemetry interval (10 s for power).</div>
    </div>

    <div class="pn">
      <div class="row end"><span class="k">${new Date().toLocaleString([], { month: 'long' })} energy</span>
        <span class="big glow cyan" style="font-size:34px">${m.total_cost != null ? money(m.total_cost, cur$) : `${num(m.home.kwh + m.dc.kwh, 0)} kWh`}</span></div>
      <div class="grid2">
        <div><div class="k cyan">Home</div><div style="font-size:18px;font-weight:600">${homeCost != null ? money(homeCost, cur$) : `${num(m.home.kwh, 0)} kWh`}</div>
          <div class="t">${m.home.sessions} sessions · ${num(m.home.kwh, 0)} kWh${m.home.rate ? ` × ${money(m.home.rate, cur$)}` : ''}</div></div>
        <div><div class="k violet">Supercharger</div><div style="font-size:18px;font-weight:600">${m.dc_cost != null ? money(m.dc_cost, cur$) : `${num(m.dc.kwh, 0)} kWh`}</div>
          <div class="t">${m.dc.sessions} sessions · ${num(m.dc.kwh, 0)} kWh${m.dc_cost != null ? ` · billed by Tesla${m.dc_unmatched ? `, ${m.dc_unmatched} not billed yet` : ''}` : m.dc.sessions ? " · cost not shown yet (needs Tesla's charging history)" : ''}</div></div>
      </div>
      <div class="row"><span class="k">Cost per mile</span><span style="font-size:18px;font-weight:600">${m.cost_per_mile != null ? money(m.cost_per_mile, cur$, 3) : '—'}</span></div>
      <div class="t">${m.cost_per_mile != null ? `${money(m.total_cost, cur$)} of charging over ${num(m.miles, 0)} mi driven this month.` : `Needs ${esc(m.missing.join(' and '))}.`}${m.dc_other_currencies ? ` Left out: ${esc(Object.entries(m.dc_other_currencies).map(([c, v]) => money(v, c)).join(', '))}.` : ''}</div>
      ${m.home.rate ? '' : '<div class="t">Set HOME_RATE_PER_KWH on the server to turn home energy into cost.</div>'}
      <div class="t">${esc(histNote)}</div>
      ${chips(['ACChargingEnergyIn', 'DCChargingEnergyIn', 'LocatedAtHome', 'api:charging_history'], state.signals)}
    </div>

    ${historyPanel(past)}

    <div class="pn" style="gap:0">
      <div class="k" style="padding-bottom:6px">Session log</div>
      ${data.sessions.length ? data.sessions.slice(0, 12).map((s) => `<div class="list-row">
        <div><div>${s.dc ? `${esc(s.site || (s.fast_charger || 'DC').replace('FastCharger', ''))} · peak ${num(s.peak_kw)} kW` : `${s.at_home ? 'Home' : 'Away'} · AC ${num(s.peak_kw, 1)} kW`}</div>
        <div class="t mono">${day(s.start_ts)} · ${num(s.start_soc)}→${num(s.end_soc)}% · ${num(s.energy_battery_kwh, 1)} kWh</div></div>
        <span class="mono">${s.cost != null ? money(s.cost, cur$) : s.tesla_cost != null ? money(s.tesla_cost, s.tesla_currency || cur$) : s.dc ? 'DC' : '—'}</span></div>`).join('') : '<div class="empty">No charging sessions yet</div>'}
      <div class="t" style="padding-top:8px">Sessions come from DetailedChargeState. Home cost uses the charger-side kWh (ACChargingEnergyIn) times your rate. Supercharger cost is Tesla's billed total for the history record starting within 30 min of the session.</div>
    </div>`;
}

const monthName = (key) => new Date(`${key}-01T12:00:00Z`).toLocaleString([], { month: 'short', year: 'numeric', timeZone: 'UTC' });
const costs = (cost) => Object.entries(cost).map(([c, v]) => (c === 'unknown' ? `${num(v, 2)}` : money(v, c))).join(' + ');

// Supercharger bills from Tesla's charging history, as far back as Tesla returned them.
function historyPanel(h) {
  if (!h || !h.months.length) return '';
  const bf = h.backfill;
  const ymd = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const span = h.earliest_ts ? `${ymd(h.earliest_ts)} to ${ymd(h.latest_ts)}` : '';
  const note = bf?.error ? `Last backfill stopped early: ${bf.error}.`
    : bf ? `Backfill read ${bf.fetched} records over ${bf.pages} page${bf.pages === 1 ? '' : 's'}${bf.total_results != null ? ` (Tesla reported ${bf.total_results})` : ''}.`
    : 'Only the newest page has been read so far; run the backfill on Setup for older bills.';
  return `<div class="pn" style="gap:0">
      <div class="row" style="padding-bottom:6px"><span class="k">Supercharger history</span>${h.sample ? '<span class="k">Sample</span>' : ''}</div>
      <div class="t" style="padding-bottom:6px">${h.recognized} billed sessions${span ? `, ${esc(span)}` : ''}. ${esc(note)}</div>
      ${h.months.map((m) => `<div class="list-row"><div><div>${esc(monthName(m.month))}</div>
        <div class="t mono">${m.sessions} session${m.sessions === 1 ? '' : 's'} · ${num(m.kwh, 0)} kWh</div></div>
        <span class="mono">${esc(costs(m.cost))}</span></div>`).join('')}
      <div class="t" style="padding-top:8px">From Tesla's charging_history, which covers Supercharger sessions only. Home charging and drives before telemetry started on this dashboard aren't in any Tesla API.</div>
    </div>`;
}
