// Car browser views. Parked: full-screen three-column dashboard. Driving: glance view, no controls.
// The page switches between them by itself when Gear leaves or returns to P.
import { sig, useData } from '../core.js';
import { arc, carTop, chips, esc, money, num, sampleBadge } from '../ui.js';
import { commandButtons, liveLine } from './home.js';

export async function carParkedView(state) {
  const trips = useData('trips', '/api/trips?limit=60', 120_000);
  const charging = useData('charging', '/api/charging', 120_000);
  const drain = useData('drain', '/api/health/drain', 600_000);
  const tires = useData('tires', '/api/health/tires', 600_000);
  const soc = sig('Soc');
  const cs = (sig('DetailedChargeState') || '').replace('DetailedChargeState', '');
  const tw = trips?.week?.this_week;
  const m = charging?.month;
  return `
    <div class="car-top">
      <div class="row" style="gap:18px;justify-content:flex-start"><span style="font-size:26px;font-weight:700">${esc(sig('VehicleName') || 'My Plaid')}</span><span class="k">Park · full screen</span>${liveLine(state)}</div>
      <div class="row" style="gap:12px"><nav class="car-nav" aria-label="Screens"><a href="#/charge">Charge</a><a href="#/trips">Trips</a><a href="#/health">Health</a><a href="#/drive">Drive</a></nav>${sampleBadge(state.meta)}</div>
    </div>
    <div class="car">
      <div class="pn" style="align-items:center">
        <div class="k" style="align-self:flex-start">Energy</div>
        <svg class="chart" viewBox="0 0 260 240" style="max-width:260px" role="img" aria-label="Battery ${num(soc)} percent, ${num(sig('RatedRange'))} miles rated">
          ${arc({ cx: 130, cy: 125, r: 100, frac: (soc || 0) / 100, width: 10, id: 'pe' })}
          <text x="130" y="140" fill="var(--cyan)" font-size="76" font-weight="700" text-anchor="middle" letter-spacing="-3">${num(soc)}</text>
          <text class="m" x="130" y="168" fill="var(--text-2)" font-size="15" text-anchor="middle">${num(sig('RatedRange'))} MI RATED</text>
          <text class="m" x="130" y="232" fill="var(--muted)" font-size="11" text-anchor="middle" letter-spacing="1.4">LIMIT ${num(sig('ChargeLimitSoc'))}% · ${esc((cs === 'Disconnected' ? 'Unplugged' : cs || '—').toUpperCase())}</text>
        </svg>
        ${chips(['Soc', 'RatedRange', 'ChargeLimitSoc'], state.signals)}
        <div style="width:100%;margin-top:auto">${commandButtons(state, { big: true })}</div>
      </div>
      <div class="pn" style="padding:10px;align-items:center;justify-content:center">
        ${carTop(state.signals, { scale: 1, leaks: (tires?.leaks || []).map((l) => l.tire) })}
        ${chips(['TpmsPressureFl', 'InsideTemp', 'OutsideTemp', 'Locked', 'FdWindow', 'SentryMode'], state.signals)}
      </div>
      <div class="pn">
        <div class="k">This week</div>
        <div class="row" style="justify-content:flex-start;gap:10px;align-items:baseline"><span class="big glow cyan" style="font-size:56px">${num(tw?.wh_per_mile)}</span><span class="k">Wh/mi</span></div>
        <div class="kv"><span>Driven</span><span class="mono">${num(tw?.miles)} MI</span></div>
        <div class="kv"><span>Trips</span><span class="mono">${num(tw?.trips)}</span></div>
        <div class="kv"><span>Home charging, month</span><span class="mono">${m?.home.cost != null ? money(m.home.cost, state.meta.currency) : `${num(m?.home.kwh)} kWh`}</span></div>
        <div class="kv"><span>Supercharging, month</span><span class="mono">${num(m?.dc.kwh)} kWh</span></div>
        <div class="kv"><span>Sentry drain</span><span class="mono amber">${drain?.sentry_avg != null ? `${drain.sentry_avg.toFixed(1)}%/NIGHT` : '—'}</span></div>
        <div style="margin-top:auto">${chips(['EnergyRemaining', 'Odometer', 'ACChargingEnergyIn', 'api:charging_history'], state.signals)}</div>
      </div>
    </div>`;
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
  return `
    <div class="row"><span class="k">Drive · glance mode · no controls</span>${sampleBadge(state.meta)}</div>
    <div class="glance">
      <div class="pn glance-main">
        ${typeof mins === 'number' ? `
        <svg viewBox="0 0 380 380" class="glance-ring" role="img" aria-label="${Math.round(mins)} minutes to destination">
          <circle cx="190" cy="190" r="150" fill="none" stroke="var(--track)" stroke-width="16"></circle>
          <circle cx="190" cy="190" r="150" fill="none" stroke="var(--cyan)" stroke-width="12" stroke-dasharray="${frac * 942} 1000" stroke-linecap="round" transform="rotate(-90 190 190)"></circle>
          <circle cx="190" cy="190" r="122" fill="none" stroke="rgba(79,227,255,0.12)" stroke-dasharray="1 7"></circle>
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
          <div class="mono green" style="font-size:22px">WH/MI · ${num(trip?.miles, 1)} MI</div>
          ${chips(['EnergyRemaining', 'Odometer'], state.signals)}
        </div>
      </div>
    </div>
    <div class="t" style="margin-top:12px">Switches back to the parked dashboard when Gear returns to P.</div>`;
}
