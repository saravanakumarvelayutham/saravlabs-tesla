// Car browser views. Parked: full-screen three-column dashboard. Driving: glance view, no controls.
// The page switches between them by itself when Gear leaves or returns to P.
import { sig, useData } from '../core.js';
import { arc, chips, esc, money, num, psi, sampleBadge, temp } from '../ui.js';
import { car3dSlot } from '../car3d.js';
import { carStatus, liveLine, insights, intelligenceHeader, vehicleStageHeader } from './home.js';
import { regenFields } from './trips.js';
import { overviewGraphics } from './overview.js';

// Month charging money for the parked view: home + Supercharger with cost per mile when the
// server can price both, else home cost alone, else kWh.
export function monthMoney(m, currency) {
  const month = new Date().toLocaleString([], { month: 'long' });
  if (!m) return { label: `${month} charging`, value: '—', perMile: '—', note: '' };
  if (m.total_cost != null) {
    return { label: `${month} charging`, value: money(m.total_cost, currency), perMile: m.cost_per_mile != null ? money(m.cost_per_mile, currency, 3) : '—',
      note: m.cost_per_mile != null ? '' : 'Per mile needs miles driven this month.' };
  }
  const why = `Cost per mile needs ${m.missing?.length ? m.missing.join(' and ') : 'home and Supercharger cost'}.`;
  if (m.home?.cost != null) return { label: `Home charging, ${month}`, value: money(m.home.cost, currency), perMile: '—', note: why };
  return { label: `${month} charging`, value: `${num((m.home?.kwh || 0) + (m.dc?.kwh || 0))} kWh`, perMile: '—', note: why };
}

// Four tyre pressures laid out like the car, low ones in amber.
function tireGrid(state, tires) {
  const leaks = (tires?.leaks || []).map((l) => l.tire);
  const target = state.meta.tire_target_psi;
  const cell = (k) => {
    const p = psi(sig(`TpmsPressure${k}`));
    const low = leaks.includes(k.toUpperCase()) || (target && p != null && p < target - 3);
    return `<div class="tire-cell${low ? ' amber' : ''}"><span class="fv">${num(p)}</span><span class="fl">${k.toUpperCase()} · psi</span></div>`;
  };
  return `<div class="tires">${cell('Fl')}${cell('Fr')}${cell('Rl')}${cell('Rr')}</div>
    <div class="t" style="align-self:flex-start">${target ? `Target ${target} psi · ` : ''}<a href="#/health/tires">Tire history</a></div>`;
}

export async function carParkedView(state) {
  const trips = useData('trips', '/api/trips?limit=60', 120_000);
  const charging = useData('charging', '/api/charging', 120_000);
  const drain = useData('drain', '/api/health/drain', 600_000);
  const tires = useData('tires', '/api/health/tires', 600_000);
  const soc = sig('Soc');
  const cs = (sig('DetailedChargeState') || '').replace('DetailedChargeState', '');
  const tw = trips?.week?.this_week;
  const mm = monthMoney(charging?.month, state.meta.currency);
  return `
    ${intelligenceHeader()}
    <div class="car-top">
      <div class="row" style="gap:18px;justify-content:flex-start"><h1 class="car-name">${esc(sig('VehicleName') || 'My Plaid')}</h1><span class="status">${esc(carStatus())}</span>${liveLine(state)}</div>
      <div class="row" style="gap:12px"><nav class="car-nav" aria-label="Screens"><a href="#/charge">Charge</a><a href="#/trips">Trips</a><a href="#/health">Health</a><a href="#/drive">Drive</a></nav>${sampleBadge(state.meta)}</div>
    </div>
    <div class="car">
      <div class="pn" style="align-items:center">
        <div class="k" style="align-self:flex-start">Energy</div>
        <svg class="chart" viewBox="0 0 260 240" style="max-width:260px" role="img" aria-label="Battery ${num(soc)} percent, ${num(sig('RatedRange'))} miles rated">
          ${arc({ cx: 130, cy: 125, r: 100, frac: (soc || 0) / 100, width: 10, id: 'pe' })}
          <text x="130" y="140" fill="var(--text)" font-size="72" font-weight="600" text-anchor="middle" letter-spacing="-2">${num(soc)}%</text>
          <text x="130" y="170" fill="var(--text-2)" font-size="17" text-anchor="middle">${num(sig('RatedRange'))} mi rated</text>
          <text x="130" y="232" fill="var(--muted)" font-size="14" text-anchor="middle">Limit ${num(sig('ChargeLimitSoc'))}% · ${esc(cs === 'Disconnected' ? 'Unplugged' : cs || '—')}</text>
        </svg>
        ${chips(['Soc', 'RatedRange', 'ChargeLimitSoc'], state.signals)}
        <div class="k" style="align-self:flex-start;margin-top:18px">Tires</div>
        ${tireGrid(state, tires)}
      </div>
      <div class="pn car-hero">
        ${vehicleStageHeader()}
        ${car3dSlot(state.signals, (tires?.leaks || []).map((l) => l.tire), 'fill')}
        <div class="row car-hero-foot"><span>Inside ${temp(sig('InsideTemp'))} · Outside ${temp(sig('OutsideTemp'))}</span><span>${num(sig('Odometer'))} mi</span></div>
        ${chips(['DoorState', 'TpmsPressureFl', 'InsideTemp', 'OutsideTemp', 'Locked', 'FdWindow', 'SentryMode'], state.signals)}
        ${insights(state)}
      </div>
      <div class="pn">
        <div class="k">This week</div>
        <div class="row" style="justify-content:flex-start;gap:10px;align-items:baseline"><span class="big" style="font-size:56px">${num(tw?.wh_per_mile)}</span><span class="k">Wh/mi</span></div>
        <div class="kv"><span>Driven</span><span class="mono">${num(tw?.miles)} MI</span></div>
        <div class="kv"><span>Trips</span><span class="mono">${num(tw?.trips)}</span></div>
        <div class="kv"><span>Regen back</span><span class="mono green" title="${tw?.regen_source === 'pack_power' ? 'Estimated from pack voltage × current' : 'From LifetimeEnergyGainedRegen'}">${tw?.regen_share != null ? `${num(tw.regen_share * 100)}%${tw.regen_source === 'pack_power' ? ' EST' : ''}` : '—'}</span></div>
        <div class="kv"><span>${esc(mm.label)}</span><span class="mono">${mm.value}</span></div>
        <div class="kv"><span>Per mile</span><span class="mono">${mm.perMile}</span></div>
        <div class="kv"><span>Sentry drain</span><span class="mono amber">${drain?.sentry_avg != null ? `${drain.sentry_avg.toFixed(1)}%/NIGHT` : '—'}</span></div>
        ${mm.note ? `<div class="t">${esc(mm.note)}</div>` : ''}
        <div style="margin-top:auto">${chips([...new Set(['EnergyRemaining', 'Odometer', ...regenFields(tw), 'ACChargingEnergyIn', 'api:charging_history'])], state.signals)}</div>
      </div>
    </div>${overviewGraphics(state)}`;
}

export function carDrivingView(state) {
  const mins = sig('MinutesToArrival');
  const miles = sig('MilesToArrival');
  const dest = sig('DestinationName');
  const arrive = sig('ExpectedEnergyPercentAtTripArrival');
  const delay = sig('RouteTrafficMinutesDelay');
  const soc = sig('Soc');
  const trip = state.trip;
  const total = trip && typeof mins === 'number' ? Math.max(mins + (Date.now() - trip.start_ts) / 60000, 1) : null;
  const frac = total ? 1 - mins / total : 0;
  const usual = trip?.usual?.wh_per_mile;
  // Positive = using more energy than usual. Only shown after a few miles, when the number settles.
  const vsUsual = usual && trip?.wh_per_mile != null && trip.miles >= 2 ? ((trip.wh_per_mile - usual) / usual) * 100 : null;
  return `
    <div class="row"><span class="k">Drive · glance mode · no controls</span>${sampleBadge(state.meta)}</div>
    <div class="glance">
      <div class="pn glance-main">
        ${typeof mins === 'number' ? `
        <svg viewBox="0 0 380 380" class="glance-ring" role="img" aria-label="${Math.round(mins)} minutes to destination">
          <circle cx="190" cy="190" r="150" fill="none" stroke="var(--track)" stroke-width="16"></circle>
          <circle cx="190" cy="190" r="150" fill="none" stroke="var(--cyan)" stroke-width="12" stroke-dasharray="${frac * 942} 1000" stroke-linecap="round" transform="rotate(-90 190 190)"></circle>
          <circle cx="190" cy="190" r="122" fill="none" stroke="rgba(90,167,255,0.12)" stroke-dasharray="1 7"></circle>
          <text class="m" x="190" y="124" fill="var(--muted)" font-size="14" text-anchor="middle" letter-spacing="2">ARRIVE IN</text>
          <text x="190" y="236" fill="var(--cyan)" font-size="120" font-weight="700" text-anchor="middle" letter-spacing="-5">${Math.round(mins)}</text>
          <text class="m" x="190" y="270" fill="var(--text-2)" font-size="20" text-anchor="middle">MIN · ${num(miles, 1)} MI</text>
        </svg>
        <div class="stack" style="gap:18px">
          <div class="k">To ${esc(dest || 'destination')}</div>
          <div><div class="k">Battery at arrival</div><div class="big" style="font-size:64px">${num(arrive)}%</div></div>
          ${typeof delay === 'number' && delay >= 1 ? `<div class="mono amber" style="font-size:24px">+${Math.round(delay)} MIN TRAFFIC</div>` : ''}
          ${chips(['DestinationName', 'MinutesToArrival', 'MilesToArrival', 'ExpectedEnergyPercentAtTripArrival', 'RouteTrafficMinutesDelay'], state.signals)}
        </div>` : `<div class="stack" style="gap:12px"><div class="k">Speed</div><div class="big glow cyan" style="font-size:140px">${num(sig('VehicleSpeed'))}</div><div class="k">MPH · no navigation route set</div>${chips(['VehicleSpeed', 'DestinationName'], state.signals)}</div>`}
      </div>
      <div class="stack" style="gap:24px">
        <div class="pn" style="flex:1;justify-content:center">
          <div class="k">Battery now</div>
          <div class="big glow cyan" style="font-size:96px">${num(soc)}<span style="font-size:36px">%</span></div>
          <div style="height:10px;border-radius:5px;background:var(--track);position:relative"><div style="width:${soc || 0}%;height:10px;border-radius:5px;background:var(--cyan)"></div>
            ${typeof arrive === 'number' ? `<div style="position:absolute;left:${arrive}%;top:-6px;width:3px;height:22px;background:var(--text)"></div>` : ''}</div>
          ${typeof arrive === 'number' ? '<div class="k" style="font-size:12px">White mark is your arrival estimate</div>' : ''}
          ${chips(['Soc'], state.signals)}
        </div>
        <div class="pn" style="flex:1;justify-content:center">
          <div class="k">This trip</div>
          <div class="big" style="font-size:80px">${num(trip?.wh_per_mile)}</div>
          <div class="mono" style="font-size:22px;color:var(--text-2)">WH/MI · ${num(trip?.miles, 1)} MI</div>
          ${vsUsual != null ? `<div class="mono ${vsUsual > 0 ? 'amber' : 'green'}" style="font-size:24px">${Math.abs(vsUsual) < 1 ? 'SAME AS USUAL' : `${Math.abs(vsUsual).toFixed(0)}% ${vsUsual > 0 ? 'WORSE' : 'BETTER'} THAN USUAL`}</div>
          <div class="k" style="font-size:12px">Usual: ${num(usual)} Wh/mi, median of your last ${trip.usual.trips} trips</div>` : ''}
          ${chips(['EnergyRemaining', 'Odometer'], state.signals)}
        </div>
      </div>
    </div>
    <div class="t" style="margin-top:12px">Switches back to the parked dashboard when Gear returns to P.</div>`;
}
