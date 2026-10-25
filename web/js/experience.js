// Shared presentation for every chapter. Domain calculations remain in the views.
import { car3dSlot } from './car3d.js';
import { ago, chips, esc, icon, num, psi, sampleBadge, temp } from './ui.js';

export const CHAPTERS = [
  { path: '', label: 'Vehicle', icon: 'car', mode: 'vehicle', title: ['Your Plaid.', 'In perspective.'], note: 'One machine. Every detail connected.', subject: 'The machine', word: 'PLAID', color: '#ff824f' },
  { path: 'charge', label: 'Energy', icon: 'bolt', mode: 'charge', title: ['A little pause.', 'A lot of possibility.'], note: 'Follow the energy, from the plug to the next mile.', subject: 'The energy', word: 'RECHARGE', color: '#8ce3c9' },
  { path: 'trips', label: 'Journeys', icon: 'route', mode: 'trips', title: ['Every mile.', 'A story of its own.'], note: 'Routes, energy and the places in between.', subject: 'The journey', word: 'EXPLORE', color: '#d6be92' },
  { path: 'health', label: 'Condition', icon: 'pulse', mode: 'health', title: ['Know your car.', 'Inside and out.'], note: 'Small signals. A longer view of the machine.', subject: 'The condition', word: 'ATTUNED', color: '#aebee9' },
  { path: 'drive', label: 'Dynamics', icon: 'gauge', mode: 'drive', title: ['Three motors.', 'One instinct.'], note: 'A closer look at how your Plaid puts power down.', subject: 'The dynamics', word: 'UNLEASH', color: '#ff824f' },
  { path: 'insights', label: 'Insights', icon: 'eye', mode: 'insights', title: ['Read between', 'the miles.'], note: 'Patterns from the life your car actually lives.', subject: 'The bigger picture', word: 'DISCOVER', color: '#d6be92' },
];

export function chapterFor(path) {
  return CHAPTERS.find((chapter) => chapter.path === path) || null;
}

export function chapterLinks(path, mobile = false) {
  return CHAPTERS.map((chapter, index) => `<a data-fk="${mobile ? 'dock' : 'chapter'}-${chapter.mode}" class="${mobile ? 'tab' : 'chapter-link'}${chapter.path === path ? ' on' : ''}" href="#/${chapter.path}"${chapter.path === path ? ' aria-current="page"' : ''}>
    <span class="chapter-number" aria-hidden="true">0${index + 1}</span>${icon(chapter.icon, 19)}<span>${chapter.label}</span>${mobile ? '' : '<span class="chapter-arrow" aria-hidden="true">↗</span>'}</a>`).join('');
}

const value = (signals, field) => signals[field]?.value;
const reading = (label, amount, unit = '', href = '', note = '') => {
  const contents = `<span class="instrument-label">${label}</span><span class="instrument-value">${amount}<small>${unit}</small></span>${note ? `<span class="instrument-note">${esc(note)}</span>` : ''}`;
  return href ? `<a class="world-instrument" href="${href}">${contents}<span class="instrument-arrow" aria-hidden="true">↗</span></a>` : `<div class="world-instrument">${contents}</div>`;
};

export function sceneReadings(mode, state) {
  const s = state.signals;
  const get = (field) => value(s, field);
  const battery = reading('State of charge', num(get('Soc')), '%', '#/charge', `Charge limit ${num(get('ChargeLimitSoc'))}%`);
  if (mode === 'charge') {
    const active = /^(DetailedChargeState)?Charging$/.test(String(get('DetailedChargeState') || ''));
    const dc = /Supercharger|CHAdeMO|Combo|GB/.test(String(get('FastChargerType') || ''));
    return battery + reading('Reported power', active ? num(get(dc ? 'DCChargingPower' : 'ACChargingPower'), 1) : '—', 'kW', '', active ? 'Charging now' : 'No active charge')
      + reading('Rated range', num(get('RatedRange')), 'mi', '#/trips', 'Vehicle estimate')
      + reading('To charge limit', active && typeof get('TimeToFullCharge') === 'number' ? num(get('TimeToFullCharge') * 60) : '—', 'min', '', active ? 'Vehicle estimate' : 'Waiting for a session');
  }
  if (mode === 'health') return reading('Front left', num(psi(get('TpmsPressureFl'))), 'psi', '#/health/tires', 'Last reported pressure')
    + reading('Front right', num(psi(get('TpmsPressureFr'))), 'psi', '#/health/tires', 'Last reported pressure')
    + reading('Rear left', num(psi(get('TpmsPressureRl'))), 'psi', '#/health/tires', 'Last reported pressure')
    + reading('Rear right', num(psi(get('TpmsPressureRr'))), 'psi', '#/health/tires', 'Last reported pressure');
  if (mode === 'trips' || mode === 'insights') {
    const week = state.cache.trips?.data?.week?.this_week;
    return reading('This week', num(week?.miles), 'mi', '#/trips', 'Completed drives')
      + reading('Energy per mile', num(week?.wh_per_mile), 'Wh/mi', '#/trips', 'This week')
      + reading('Energy recovered', week?.regen_share != null ? num(week.regen_share * 100) : '—', '%', '#/insights', week?.regen_source === 'pack_power' ? 'Estimated · on measured trips' : week?.regen_source === 'mixed' ? 'Includes estimates · measured trips' : 'On measured trips')
      + battery;
  }
  if (mode === 'drive') {
    const launch = state.cache.drive?.data?.launches?.[0];
    return reading('Latest 0–60', launch ? num(launch.seconds, 1) : '—', 's', '', 'Sampled estimate')
      + reading('Peak acceleration', num(launch?.peak_g, 2), 'g', '', 'Latest recorded launch')
      + reading('Pedal position', num(launch?.pedal), '%', '', 'Latest recorded launch')
      + reading('Drive units', '03', '', '', 'Front · rear left · rear right');
  }
  return battery + reading('Rated range', num(get('RatedRange')), 'mi', '#/trips', 'Vehicle estimate')
    + reading('Cabin temperature', temp(get('InsideTemp')), '', '', `Outside ${temp(get('OutsideTemp'))}`)
    + reading('Odometer', num(get('Odometer')), 'mi', '#/trips', 'Distance driven');
}

const SCENE_FIELDS = {
  vehicle: ['Soc', 'RatedRange', 'ChargeLimitSoc', 'DetailedChargeState', 'InsideTemp', 'OutsideTemp', 'Odometer', 'DoorState', 'FdWindow', 'FpWindow', 'RdWindow', 'RpWindow', 'ChargePortDoorOpen', 'Locked'],
  charge: ['Soc', 'ChargeLimitSoc', 'DCChargingPower', 'ACChargingPower', 'TimeToFullCharge', 'DetailedChargeState', 'ChargePortDoorOpen'],
  health: ['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr', 'TpmsSoftWarnings', 'TpmsHardWarnings'],
  drive: ['VehicleSpeed', 'LongitudinalAcceleration', 'PedalPosition', 'DiTorqueActualF', 'DiTorqueActualREL', 'DiTorqueActualRER'],
  trips: ['Odometer', 'EnergyRemaining', 'LifetimeEnergyGainedRegen', 'PackVoltage', 'PackCurrent'],
  insights: ['EnergyRemaining', 'Soc', 'LifetimeEnergyGainedRegen', 'PackVoltage', 'PackCurrent'],
};

function worldScene(chapter, state) {
  const index = CHAPTERS.indexOf(chapter) + 1;
  return `<section class="world-scene${chapter.mode === 'vehicle' ? ' world-scene-main' : ''}" aria-labelledby="chapter-title">
    <div class="world-heading"><div><div class="chapter-kicker"><span class="chapter-dot"></span>0${index} / ${chapter.subject}</div><h1 id="chapter-title">${chapter.title[0]}<br><em>${chapter.title[1]}</em></h1></div>
      <div class="world-caption"><span class="coordinate-mark" aria-hidden="true">+</span><p>${chapter.note}</p><span>MODEL S · TRI-MOTOR · ALL ELECTRIC</span></div></div>
    <div class="world-visual"><span class="world-word" aria-hidden="true">${chapter.word}</span><div class="world-axis" aria-hidden="true"><span>FRONT</span><i></i><span>REAR</span></div>
      ${car3dSlot(state.signals, (state.cache.tires?.data?.leaks || []).map((leak) => leak.tire), 'world-car')}
      <div class="world-locator"><span class="chapter-dot"></span> ${chapter.mode === 'drive' ? 'DRIVE UNIT STUDY' : chapter.mode === 'health' ? 'PRESSURE STUDY' : chapter.mode === 'charge' ? 'ENERGY STUDY' : 'VEHICLE STUDY'} <span>01—03</span></div>
    </div>
    <div class="world-instruments">${sceneReadings(chapter.mode, state)}</div>
    <div class="world-sources">${chips(SCENE_FIELDS[chapter.mode], state.signals)}</div>
    <div class="world-footnote"><span>YOUR CAR, FROM A DIFFERENT ANGLE</span><a href="#chapter-data" data-action="chapter-data" data-fk="chapter-explore">Explore ${chapter.label.toLowerCase()} <span aria-hidden="true">↓</span></a></div>
  </section>`;
}

export function experienceView(content, state, path) {
  const chapter = chapterFor(path);
  const latest = Object.values(state.signals).reduce((max, entry) => Math.max(max, entry.ts || 0), 0);
  const fresh = latest > 0 && Date.now() - latest < 300_000;
  const offline = state.meta.telemetry?.status === 'DISCONNECTED';
  const auxiliary = { setup: 'Preferences & connections', updates: 'The next chapter', alerts: 'Attention to detail' }[path] || 'Vehicle intelligence';
  return `<div class="experience" style="--chapter-accent:${chapter?.color || '#d6be92'}">
    <header class="world-header"><a class="world-brand" href="#/" aria-label="Plaid home"><span class="plaid-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>PLAID<small>VEHICLE INTELLIGENCE</small></span></a>
      <div class="world-connection"><span class="live${fresh && !offline ? '' : ' off'}"></span><span>${state.meta.sample_mode ? 'Simulated feed' : offline ? 'Telemetry offline' : fresh ? 'Recent telemetry' : 'Awaiting telemetry'}<small>${latest ? `Last signal ${ago(latest)}` : 'No readings yet'}</small></span></div>
      <div class="world-utility">${sampleBadge(state.meta)}<a class="world-settings${path === 'setup' ? ' on' : ''}" href="#/setup" aria-label="Setup">${icon('gear', 20)}</a></div></header>
    <nav class="chapter-nav" aria-label="Chapters">${chapterLinks(path)}</nav>
    <div class="chapter-body">${chapter ? worldScene(chapter, state) : `<header class="aux-heading"><div class="chapter-kicker">PLAID / FIELD NOTES</div><h1>${auxiliary}</h1><p>Keep every part of the experience connected.</p></header>`}
      <section class="chapter-content chapter-content-${esc(path || 'vehicle')}" id="chapter-data" aria-label="${esc(chapter?.label || auxiliary)} details">${content}</section>
      <footer class="world-footer"><a href="#/" class="footer-signature">Plaid<span>One car. A deeper connection.</span></a><div><a href="#/updates">Software notes ↗</a><a href="#/alerts">Vehicle alerts ↗</a><a href="#/setup">Preferences ↗</a></div><span class="footer-edition">MODEL S / OWNER'S EDITION</span></footer>
    </div></div>`;
}
