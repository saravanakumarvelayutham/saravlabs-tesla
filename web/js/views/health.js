// Phone · Health tab: battery pack and tires.
import { load } from '../core.js';
import { chips, day, esc, lineChart, num, ring, sampleBadge, temp } from '../ui.js';

const switcher = (on) => `<div class="switch"><a href="#/health" class="${on === 'battery' ? 'on' : ''}">Battery</a><a href="#/health/tires" class="${on === 'tires' ? 'on' : ''}">Tires</a></div>`;

export async function batteryView(state) {
  const [b, d] = await Promise.all([load('battery', '/api/health/battery', 600_000), load('drain', '/api/health/drain', 600_000)]);
  const pts = b.monthly.map((m, i) => [i, m.kwh]);
  const nights = d.nights;
  const maxDrain = Math.max(2, ...nights.map((n) => n.drain_pct || 0));
  const bw = 326 / Math.max(nights.length, 1);
  const spread = b.brick_v.spread_mv;
  return `
    <div class="head"><div class="stack" style="gap:6px"><div class="k">Health</div><h1>Battery pack</h1></div>${sampleBadge(state.meta)}</div>
    ${switcher('battery')}
    <div class="pn">
      <div class="row end">
        <div><div class="k">Full-pack energy${b.method === 'estimate' ? ' · estimate' : ''}</div>
          <div class="big glow cyan" style="font-size:54px">${num(b.latest_kwh, 1)}<span style="font-size:20px"> kWh</span></div></div>
        <div style="text-align:right"><div class="mono" style="font-size:18px;font-weight:700;color:var(--text-2)">${b.change_pct != null ? `${b.change_pct > 0 ? '+' : ''}${b.change_pct.toFixed(1)}%` : '—'}</div><div class="k">${b.monthly.length} months</div></div>
      </div>
      ${lineChart({ w: 326, h: 140, series: [{ points: pts, color: 'var(--cyan)', area: true }], marker: pts.length ? pts[pts.length - 1] : null, label: 'Full pack energy by month' })}
      <div class="t">${b.method === 'estimate'
        ? 'Estimated as EnergyRemaining ÷ BatteryLevel from readings at 50% or more, one median per month. NominalFullPackEnergyKwh replaces this once the car is on firmware 2026.32 or later.'
        : 'Monthly median of NominalFullPackEnergyKwh.'}</div>
      ${chips(['NominalFullPackEnergyKwh', 'EnergyRemaining', 'BatteryLevel'], state.signals)}
    </div>
    <div class="pn">
      <div class="row"><span class="k">Cell balance</span><span class="mono green" style="font-size:13px">${spread != null ? `Δ ${num(spread)} mV` : '—'}</span></div>
      <div class="row mono" style="font-size:13px"><span>min ${num(b.brick_v.min, 3)} V</span><span>max ${num(b.brick_v.max, 3)} V</span></div>
      <div class="t">The gap between the lowest and highest brick voltage. A gap that keeps widening is an early warning sign. Tesla doesn't state the unit; volts is assumed.</div>
      ${chips(['BrickVoltageMin', 'BrickVoltageMax'], state.signals)}
    </div>
    <div class="pn">
      <div class="row"><span class="k">Overnight drain · ${nights.length} nights</span>
        <span class="mono amber" style="font-size:13px">${d.sentry_avg != null && d.no_sentry_avg ? `SENTRY ${(d.sentry_avg / d.no_sentry_avg).toFixed(1)}×` : ''}</span></div>
      <svg class="chart" viewBox="0 0 326 120" role="img" aria-label="Overnight battery drain per night">
        <line x1="0" y1="96" x2="326" y2="96" stroke="rgba(90,167,255,0.18)"></line>
        ${nights.map((n, i) => {
          const hgt = n.drain_pct != null ? (Math.max(0, n.drain_pct) / maxDrain) * 70 : 0;
          const x = i * bw + bw * 0.2;
          return `<rect x="${x}" y="${96 - hgt}" width="${bw * 0.6}" height="${hgt}" rx="3" fill="${n.sentry ? 'var(--amber)' : 'var(--cyan)'}" opacity="${n.valid ? (n.sentry ? 1 : 0.55) : 0.2}"></rect>
            <text class="m" x="${x + bw * 0.3}" y="112" fill="var(--muted)" font-size="9" text-anchor="middle">${new Date(n.from).toLocaleDateString([], { weekday: 'short' }).toUpperCase()}</text>
            ${n.valid ? `<text class="m" x="${x + bw * 0.3}" y="${90 - hgt}" fill="var(--text)" font-size="9" text-anchor="middle">${n.drain_pct.toFixed(1)}</text>` : ''}`;
        }).join('')}
      </svg>
      <div class="row t" style="justify-content:flex-start;gap:14px">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--amber)"></span> Sentry on · ${num(d.sentry_avg, 1)}%</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--cyan);opacity:.55"></span> Sentry off · ${num(d.no_sentry_avg, 1)}%</span>
      </div>
      <div class="t">10 PM to 6 AM, nights the car stayed parked and didn't charge (faded bars were skipped). ${nights.some((n) => n.cabin_overheat_ran) ? 'Cabin Overheat Protection ran on some nights.' : "Cabin Overheat Protection didn't run on these nights."}</div>
      ${chips(['Soc', 'Gear', 'SentryMode', 'HvacPower'], state.signals)}
    </div>
    <div class="pn row" style="flex-direction:row">
      <div><div class="k">Pack temp</div><div style="font-size:22px;font-weight:700">${temp(b.module_temp.min)}–${temp(b.module_temp.max, true)}</div></div>
      <div style="text-align:right"><div class="k">Heater</div><div class="mono" style="font-size:15px;color:var(--text-2)">${b.heater_on === true ? 'ON' : b.heater_on === false ? 'OFF' : '—'}</div></div>
    </div>
    ${chips(['ModuleTempMin', 'ModuleTempMax', 'BatteryHeaterOn'], state.signals)}`;
}

// TpmsLastSeenPressureTime*: Tesla doesn't document the wire format, so accept epoch seconds,
// epoch ms or a date string. Tesla's note: "Timestamp fields report incorrectly. Treating the
// reported value as Pacific Time will yield the date and time in the vehicle's timezone." So
// telemetry values are shown in Pacific Time, labeled as the car's local time. Bluetooth values
// are protobuf Timestamps (real UTC instants) and are shown in this device's time zone.
export function lastSeenText(e) {
  if (!e) return null;
  const v = e.raw;
  const ms = typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) return { text: String(v), note: 'unrecognized format' };
  const pacific = e.source !== 'BLE';
  const text = new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(pacific ? { timeZone: 'America/Los_Angeles' } : {}) });
  return { text, note: pacific ? "car's local time" : 'your time' };
}

export async function tiresView(state) {
  const t = await load('tires', '/api/health/tires', 300_000);
  // The car's recommended cold pressure (Bluetooth) wins; else TIRE_TARGET_PSI, the door-jamb placard value.
  const rec = t.recommended || {};
  const fromCar = rec.front || rec.rear;
  const target = fromCar
    ? (Math.round(rec.front?.psi) === Math.round(rec.rear?.psi) || !rec.rear || !rec.front ? `${num((rec.front || rec.rear).psi)} psi` : `${num(rec.front.psi)} / ${num(rec.rear.psi)}`)
    : state.meta.tire_target_psi ? `${state.meta.tire_target_psi} psi` : null;
  const seen = Object.fromEntries(Object.entries(t.last_seen || {}).map(([k, e]) => [k, lastSeenText(e)]));
  const leak = new Map(t.leaks.map((l) => [l.tire, l]));
  const gauge = (tire, cx, cy) => {
    const c = t.current[tire];
    const color = leak.has(tire) ? 'var(--amber)' : 'var(--cyan)';
    return `${ring({ cx, cy, r: 36, frac: c ? c.psi / 50 : 0, width: 6, color })}
      <text x="${cx}" y="${cy + 6}" fill="${leak.has(tire) ? 'var(--amber)' : 'var(--text)'}" font-size="22" font-weight="700" text-anchor="middle">${num(c?.psi)}</text>
      <text class="m" x="${cx}" y="${cy + 50}" fill="${leak.has(tire) ? 'var(--amber)' : 'var(--muted)'}" font-size="9" text-anchor="middle" letter-spacing="1.2">${tire}${leak.has(tire) ? ` ▼ ${leak.get(tire).drop_psi.toFixed(0)}` : ''}</text>`;
  };
  const latestTs = Math.max(0, ...Object.values(t.current).map((c) => c?.ts || 0));
  const series = Object.entries(t.series).map(([tire, pts]) => ({
    points: pts.map(([ts, p]) => [ts, p]),
    color: leak.has(tire) ? 'var(--amber)' : '#3A4656',
    width: leak.has(tire) ? 3 : 2,
  }));
  const worst = t.leaks[0];
  return `
    <div class="head"><div class="stack" style="gap:6px"><div class="k">Health</div><h1>Tires</h1></div>${sampleBadge(state.meta)}</div>
    ${switcher('tires')}
    <div class="pn" style="padding:8px">
      <svg class="chart" viewBox="0 0 356 340" role="img" aria-label="Tire pressures in psi">
        <path d="M138,46 C138,26 218,26 218,46 L226,116 L226,280 C226,302 130,302 130,280 L130,116 Z" fill="rgba(90,167,255,0.03)" stroke="rgba(90,167,255,0.55)" stroke-width="1.5"></path>
        ${gauge('FL', 58, 78)}${gauge('FR', 298, 78)}${gauge('RL', 58, 250)}${gauge('RR', 298, 250)}
        <text class="m" x="178" y="172" fill="var(--muted)" font-size="9" text-anchor="middle" letter-spacing="1.2">TARGET</text>
        <text x="178" y="192" fill="var(--text)" font-size="18" font-weight="600" text-anchor="middle">${target || 'not set'}</text>
        <text class="m" x="178" y="208" fill="var(--muted)" font-size="8" text-anchor="middle" letter-spacing="1">${fromCar ? (rec.front && rec.rear ? 'FRONT / REAR · FROM CAR' : 'FROM CAR') : target ? 'FROM TIRE_TARGET_PSI' : ''}</text>
        <text class="m" x="178" y="330" fill="var(--muted)" font-size="9" text-anchor="middle" letter-spacing="1.2">PSI · READ ${latestTs ? new Date(latestTs).toLocaleString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase() : '—'}</text>
      </svg>
      <div style="padding:0 8px 8px">${chips(['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr', 'TpmsRcpFront', 'TpmsRcpRear'], state.signals)}</div>
      <div class="t" style="padding:0 8px 8px">${fromCar ? `Target is the car's recommended cold pressure, read over Bluetooth by the garage Pi${(rec.front || rec.rear).source === 'SAMPLE' ? ' (sample value)' : ''}.` : "Target comes from TIRE_TARGET_PSI. Once the garage Pi reads the car's recommended pressure over Bluetooth, that is used instead."}</div>
    </div>
    <div class="pn" style="gap:0">
      <div class="k" style="padding-bottom:6px">Sensor last reported</div>
      ${['FL', 'FR', 'RL', 'RR'].map((k) => `<div class="kv" style="gap:12px"><span>${k}</span><span class="mono" style="font-size:14px;text-align:right">${seen[k] ? `${esc(seen[k].text)}<div class="t">${seen[k].note}</div>` : '—'}</span></div>`).join('')}
      <div class="t" style="padding-top:8px">When each wheel's pressure sensor last reported. Tesla says these timestamps "report incorrectly" and should be read as Pacific Time to get the car's local time, so telemetry values are shown that way. The exact format the car sends hasn't been checked on a real car yet.</div>
      ${chips(['TpmsLastSeenPressureTimeFl', 'TpmsLastSeenPressureTimeFr', 'TpmsLastSeenPressureTimeRl', 'TpmsLastSeenPressureTimeRr'], state.signals)}
    </div>
    <div class="pn${worst ? ' warn' : ''}">
      <div class="row"><span class="k${worst ? ' amber' : ''}">${worst ? `Slow leak detected · ${worst.tire}` : `Cold pressure · ${t.rules.windowDays} days`}</span>
        <span class="mono${worst ? ' amber' : ''}" style="font-size:13px">${worst ? `${worst.psi_per_day.toFixed(2)} PSI/DAY` : ''}</span></div>
      ${lineChart({ w: 326, h: 130, series, label: 'Daily cold tire pressure per tire' })}
      <div class="t">One cold reading per tire per day (after ${t.rules.coldParkedMs / 3600_000} h parked), so warm-tire swings don't trigger alarms. A leak means ≥${t.rules.minDropPsi} psi lost at ${Math.abs(t.rules.leakPsiPerDay)}+ psi/day while the others hold steady. These thresholds are this app's choice, not Tesla's.</div>
    </div>
    <div class="pn row" style="flex-direction:row">
      <div><div class="k">Car TPMS warnings</div>
        <div style="font-size:18px;font-weight:600;color:${t.hard_warnings.length ? 'var(--red)' : t.soft_warnings.length ? 'var(--amber)' : 'var(--green)'}">
          ${t.hard_warnings.length ? `Hard: ${t.hard_warnings.join(', ')}` : t.soft_warnings.length ? `Soft: ${t.soft_warnings.join(', ')}` : 'None · soft or hard'}</div></div>
    </div>
    ${chips(['TpmsSoftWarnings', 'TpmsHardWarnings'], state.signals)}
    <div class="t">Last cold reading: ${latestTs ? day(latestTs) : '—'}. Tesla reports pressures in bar; shown here in psi.</div>`;
}
