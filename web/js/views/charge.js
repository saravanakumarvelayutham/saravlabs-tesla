// Phone · Charging tab.
import { load, sig } from '../core.js';
import { arc, chips, day, esc, lineChart, money, num, sampleBadge } from '../ui.js';

export async function chargeView(state) {
  const data = await load('charging', '/api/charging', 30_000);
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
  return `
    <div class="head">
      <div class="stack" style="gap:6px"><div class="k">Charging</div>
        <div class="row" style="gap:8px;justify-content:flex-start">${cur ? '<span class="live"></span>' : ''}<h1>${status}</h1></div></div>
      ${sampleBadge(state.meta)}
    </div>
    <div class="pn" style="align-items:center;padding:12px 16px 16px">
      <svg class="chart" viewBox="0 0 300 260" style="max-width:300px" role="img" aria-label="Charging power ${num(kw)} kilowatts">
        ${arc({ cx: 150, cy: 140, r: 110, frac: (kw || 0) / maxKw, id: 'cd' })}
        <circle cx="150" cy="140" r="88" fill="none" stroke="rgba(79,227,255,0.12)" stroke-dasharray="1 5"></circle>
        <text class="m" x="150" y="118" fill="var(--muted)" font-size="10" text-anchor="middle" letter-spacing="1.6">POWER</text>
        <text x="150" y="166" fill="var(--cyan)" font-size="64" font-weight="700" text-anchor="middle" letter-spacing="-2">${cur ? num(kw) : '—'}</text>
        <text class="m" x="150" y="190" fill="var(--text-2)" font-size="13" text-anchor="middle">kW · ${dc ? 'DC' : 'AC'}</text>
        <text class="m" x="62" y="252" fill="var(--muted)" font-size="10" text-anchor="middle">0</text>
        <text class="m" x="238" y="252" fill="var(--muted)" font-size="10" text-anchor="middle">${maxKw}</text>
      </svg>
      <div class="grid3 center" style="width:100%">
        <div><div class="k">Battery</div><div style="font-size:22px;font-weight:700">${cur ? `${num(cur.start_soc)}<span style="color:var(--muted)">→</span>` : ''}${num(sig('ChargeLimitSoc'))}%</div></div>
        <div><div class="k">To limit</div><div style="font-size:22px;font-weight:700">${cur && typeof hours === 'number' ? `${Math.round(hours * 60)} min` : '—'}</div></div>
        <div><div class="k">Added</div><div style="font-size:22px;font-weight:700">${cur ? `${num(sig('DCChargingEnergyIn'), 1)} kWh` : '—'}</div></div>
      </div>
      ${chips([dc ? 'DCChargingPower' : 'ACChargingPower', 'Soc', 'ChargeLimitSoc', 'TimeToFullCharge', 'DCChargingEnergyIn', 'FastChargerType'], state.signals)}
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
        <span class="big glow cyan" style="font-size:34px">${homeCost != null ? money(homeCost, cur$) : `${num(m.home.kwh + m.dc.kwh, 0)} kWh`}</span></div>
      <div class="grid2">
        <div><div class="k cyan">Home</div><div style="font-size:18px;font-weight:600">${homeCost != null ? money(homeCost, cur$) : `${num(m.home.kwh, 0)} kWh`}</div>
          <div class="t">${m.home.sessions} sessions · ${num(m.home.kwh, 0)} kWh${m.home.rate ? ` × ${money(m.home.rate, cur$)}` : ''}</div></div>
        <div><div class="k violet">Supercharger</div><div style="font-size:18px;font-weight:600">${num(m.dc.kwh, 0)} kWh</div>
          <div class="t">${m.dc.sessions} sessions · cost from Tesla's charging history</div></div>
      </div>
      ${m.home.rate ? '' : '<div class="t">Set HOME_RATE_PER_KWH on the server to turn home energy into cost.</div>'}
      <div class="t">${teslaHist ? `Tesla charging_history fetched ${new Date(teslaHist.ts).toLocaleString()}; its field format isn't published, so it's shown raw on the Setup page until mapped.` : 'Tesla charging_history not fetched yet (link your Tesla account on Setup).'}</div>
      ${chips(['ACChargingEnergyIn', 'DCChargingEnergyIn', 'LocatedAtHome', 'api:charging_history'], state.signals)}
    </div>

    <div class="pn" style="gap:0">
      <div class="k" style="padding-bottom:6px">Session log</div>
      ${data.sessions.length ? data.sessions.slice(0, 12).map((s) => `<div class="list-row">
        <div><div>${s.dc ? `${esc((s.fast_charger || 'DC').replace('FastCharger', ''))} · peak ${num(s.peak_kw)} kW` : `${s.at_home ? 'Home' : 'Away'} · AC ${num(s.peak_kw, 1)} kW`}</div>
        <div class="t mono">${day(s.start_ts)} · ${num(s.start_soc)}→${num(s.end_soc)}% · ${num(s.energy_battery_kwh, 1)} kWh</div></div>
        <span class="mono">${s.cost != null ? money(s.cost, cur$) : s.dc ? 'DC' : '—'}</span></div>`).join('') : '<div class="empty">No charging sessions yet</div>'}
      <div class="t" style="padding-top:8px">Sessions come from DetailedChargeState. Home cost uses the charger-side kWh (ACChargingEnergyIn) times your rate.</div>
    </div>`;
}
