// Phone · Drive stats tab: launch log, tri-motor torque split, friction circle, heat.
import { load } from '../core.js';
import { chips, dateTime, lineChart, num, sampleBadge, temp } from '../ui.js';

export async function driveView(state) {
  const { today, launches } = await load('drive', '/api/drive', 30_000);
  const l = launches[0];
  const share = l?.torque_share;
  const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');
  const hottest = l ? Math.max(...Object.values(l.stator_c).filter((v) => typeof v === 'number')) : null;
  const motor = (cx, cy, key, label) => {
    const hot = l && l.stator_c[key] === hottest;
    return `<circle cx="${cx}" cy="${cy}" r="16" fill="${hot ? 'rgba(255,181,71,0.16)' : 'rgba(90,167,255,0.14)'}" stroke="${hot ? 'var(--amber)' : 'var(--cyan)'}" stroke-width="2"></circle>
      <text class="m" x="${cx}" y="${cy + 4}" fill="var(--text)" font-size="10" font-weight="700" text-anchor="middle">${label}</text>`;
  };
  const gg = today.gg_points;
  const R = 76;
  const sc = R / 1.2;
  const heatRow = (label, v, max) => `<div class="th"><span>${label}</span><div class="bar"><div style="width:${typeof v === 'number' ? Math.min(100, (v / max) * 100) : 0}%"></div></div><span style="text-align:right">${temp(v, true)}</span></div>`;
  return `
    <div class="head"><div class="stack" style="gap:6px"><div class="k">Drive stats</div><h1>${l ? `Launch · ${dateTime(l.ts)}` : 'No launches logged yet'}</h1></div>${sampleBadge(state.meta)}</div>
    <div class="pn">
      <div class="row end">
        <div><div class="k">0–60 mph · estimate</div><div class="big glow cyan" style="font-size:60px">${l ? l.seconds.toFixed(1) : '—'}<span style="font-size:22px">s</span></div></div>
        <div style="text-align:right"><div class="mono" style="font-size:20px;font-weight:700">${num(l?.peak_g, 2)} g</div><div class="k">Peak accel</div>
          <div class="mono" style="font-size:14px;color:var(--text-2);padding-top:4px">PEDAL ${num(l?.pedal)}%</div></div>
      </div>
      ${l ? lineChart({
        w: 326, h: 140, xmin: 0, ymin: 0, ymax: Math.max(70, ...l.samples.map((s) => s[1])), label: `Speed trace, 0 to 60 in ${l.seconds.toFixed(1)} seconds`,
        series: [{ points: l.samples, color: 'var(--cyan)', area: true }],
        marker: [l.seconds, 60, 'var(--amber)'],
        labels: ({ X, Y, bottom }) => `<line x1="8" y1="${Y(60)}" x2="318" y2="${Y(60)}" stroke="rgba(255,181,71,0.5)" stroke-dasharray="3 4"></line>
          <text class="m" x="12" y="${Y(60) - 6}" fill="var(--amber)" font-size="9">60 MPH</text>
          <text class="m" x="${X(l.seconds)}" y="${bottom + 13}" fill="var(--amber)" font-size="9" text-anchor="middle">${l.seconds.toFixed(1)} S</text>`,
      }) : '<div class="empty">A launch is logged when speed goes from standstill to 60 mph within 8 seconds.</div>'}
      <div class="t">Timed from VehicleSpeed samples (1 s minimum interval), interpolated at 60 mph. An estimate, not an official time.</div>
      ${chips(['VehicleSpeed', 'LongitudinalAcceleration', 'PedalPosition'], state.signals)}
    </div>
    <div class="pn" style="align-items:center">
      <div class="k" style="align-self:flex-start">Tri-motor at launch · torque share and stator temp</div>
      <svg class="chart" viewBox="0 0 326 230" style="max-width:360px" role="img" aria-label="Torque share: front ${pct(share?.F)}, rear left ${pct(share?.RL)}, rear right ${pct(share?.RR)}">
        <path d="M128,20 C128,6 198,6 198,20 L206,70 L206,196 C206,214 120,214 120,196 L120,70 Z" fill="rgba(90,167,255,0.03)" stroke="rgba(90,167,255,0.4)" stroke-width="1.5"></path>
        <line x1="163" y1="60" x2="163" y2="160" stroke="rgba(90,167,255,0.35)" stroke-dasharray="3 4"></line>
        ${motor(163, 50, 'F', 'F')}${motor(140, 176, 'RL', 'RL')}${motor(186, 176, 'RR', 'RR')}
        <line x1="181" y1="50" x2="236" y2="50" stroke="rgba(90,167,255,0.5)"></line>
        <text x="242" y="46" fill="var(--text)" font-size="18" font-weight="700">${pct(share?.F)}</text>
        <text class="m" x="242" y="62" fill="var(--muted)" font-size="9">${temp(l?.stator_c?.F)} STATOR</text>
        <line x1="122" y1="176" x2="88" y2="176" stroke="rgba(90,167,255,0.5)"></line>
        <text x="84" y="172" fill="var(--text)" font-size="18" font-weight="700" text-anchor="end">${pct(share?.RL)}</text>
        <text class="m" x="84" y="188" fill="var(--muted)" font-size="9" text-anchor="end">${temp(l?.stator_c?.RL)} STATOR</text>
        <line x1="204" y1="176" x2="238" y2="176" stroke="rgba(90,167,255,0.5)"></line>
        <text x="242" y="172" fill="var(--text)" font-size="18" font-weight="700">${pct(share?.RR)}</text>
        <text class="m" x="242" y="188" fill="var(--muted)" font-size="9">${temp(l?.stator_c?.RR)} STATOR</text>
      </svg>
      <div class="t" style="align-self:flex-start">Share of total torque across the three drive units. Tesla gives no torque unit, so only the split is shown. Amber is the hottest stator.</div>
      <div style="align-self:flex-start">${chips(['DiTorqueActualF', 'DiTorqueActualREL', 'DiTorqueActualRER', 'DiStatorTempF', 'DiStatorTempREL', 'DiStatorTempRER'], state.signals)}</div>
    </div>
    <div class="pn">
      <div class="k">Friction circle · today</div>
      <div class="row" style="gap:14px;justify-content:flex-start">
        <svg width="170" height="170" viewBox="0 0 170 170" role="img" aria-label="Acceleration samples today: lateral ${num(today.lateral_g, 2)} g, braking ${num(today.braking_g, 2)} g, acceleration ${num(today.accel_g, 2)} g">
          <circle cx="85" cy="85" r="${R}" fill="none" stroke="rgba(90,167,255,0.25)"></circle>
          <circle cx="85" cy="85" r="${R * 2 / 3}" fill="none" stroke="rgba(90,167,255,0.12)" stroke-dasharray="2 4"></circle>
          <circle cx="85" cy="85" r="${R / 3}" fill="none" stroke="rgba(90,167,255,0.12)" stroke-dasharray="2 4"></circle>
          <line x1="9" y1="85" x2="161" y2="85" stroke="rgba(90,167,255,0.12)"></line><line x1="85" y1="9" x2="85" y2="161" stroke="rgba(90,167,255,0.12)"></line>
          ${gg.map(([x, y]) => `<circle cx="${(85 + x * sc).toFixed(1)}" cy="${(85 - y * sc).toFixed(1)}" r="1.6" fill="var(--cyan)" opacity="0.7"></circle>`).join('')}
          <text class="m" x="92" y="18" fill="var(--muted)" font-size="8">ACCEL</text><text class="m" x="92" y="160" fill="var(--muted)" font-size="8">BRAKE</text><text class="m" x="140" y="80" fill="var(--muted)" font-size="8">1.2g</text>
        </svg>
        <div class="stack" style="gap:10px">
          <div><div class="k">Lateral</div><div style="font-size:20px;font-weight:700">${num(today.lateral_g, 2)} g</div></div>
          <div><div class="k">Braking</div><div style="font-size:20px;font-weight:700">${num(today.braking_g, 2)} g</div></div>
          <div><div class="k">Accel</div><div style="font-size:20px;font-weight:700;color:var(--amber)">${num(today.accel_g, 2)} g</div></div>
          <div><div class="k">Brake pressure</div><div style="font-size:20px;font-weight:700">${num(today.brake_peak, 1)}</div><div class="t">peak · ${num(today.brake_events)} stops on the brakes</div></div>
        </div>
      </div>
      <div class="t">${today.accel_sign_learned ? 'Accel/brake direction learned from your launches.' : "Tesla doesn't document which sign means braking; assumed negative until a launch confirms it."}</div>
      <div class="t">Brake pressure is BrakePedalPos, which Tesla describes as master cylinder pressure with no unit, so it's only comparable with your own other stops. Slowing on regen alone reads 0.</div>
      ${chips(['LateralAcceleration', 'LongitudinalAcceleration', 'BrakePedalPos'], state.signals)}
    </div>
    <div class="pn">
      <div class="k">Peak heat today</div>
      ${heatRow('STATOR RL', today.heat.stator.RL, 150)}
      ${heatRow('STATOR RR', today.heat.stator.RR, 150)}
      ${heatRow('INVERTER RR', today.heat.inverter.RR, 150)}
      ${heatRow('BATT MODULE', today.heat.module_max, 80)}
      <div class="t">No limits are shown because Tesla doesn't publish them; bars are scaled for comparison only. Units assumed °C (Tesla doesn't state them).</div>
      ${chips(['DiStatorTempREL', 'DiInverterTRER', 'ModuleTempMax'], state.signals)}
    </div>`;
}
