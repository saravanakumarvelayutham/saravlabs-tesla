// Car browser views. Parked: vehicle studio and telemetry. Driving: glance view, no controls.
// The page switches between them by itself when Gear leaves or returns to P.
import { sig } from '../core.js';
import { chips, esc, money, num, sampleBadge } from '../ui.js';

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
