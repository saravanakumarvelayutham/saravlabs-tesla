// Rendering helpers: formatting, source chips, and the SVG pieces of the v2 look.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const prefs = {
  get temp() { return pref('plaid.temp', 'F'); },
  set temp(v) { try { localStorage.setItem('plaid.temp', v); } catch { /* private mode */ } },
  get sources() { return pref('plaid.sources', '1') === '1'; },
  set sources(v) { try { localStorage.setItem('plaid.sources', v ? '1' : '0'); } catch { /* private mode */ } },
};

export const BAR_TO_PSI = 14.503773773;
export const G = 9.80665;

export function num(v, d = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
}
export const psi = (bar) => (typeof bar === 'number' ? bar * BAR_TO_PSI : null);
export function temp(c, withUnit = false) {
  if (typeof c !== 'number') return '—';
  const v = prefs.temp === 'F' ? c * 9 / 5 + 32 : c;
  return `${Math.round(v)}°${withUnit ? prefs.temp : ''}`;
}
export function money(v, currency = 'USD', digits) {
  if (typeof v !== 'number') return '—';
  const opts = digits == null ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, ...opts }).format(v);
  } catch {
    return `${v.toFixed(digits ?? 2)} ${currency}`; // a currency code Intl doesn't know
  }
}
export function ago(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const day = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase();
export const dateTime = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const SRC_CLASS = { TEL: '', API: 'api', BLE: 'ble', SAMPLE: 'sample' };

// One chip per field: the exact Tesla field name, colored by the channel it last came from,
// with its age on hover. Strings prefixed "api:" are Fleet API endpoints.
export function chips(fields, signals = {}) {
  const parts = fields.map((f) => {
    if (f.startsWith('api:')) return `<span class="src api" title="Fleet API endpoint">${esc(f.slice(4))}</span>`;
    if (f.startsWith('ble:')) return `<span class="src ble" title="Bluetooth via the garage Pi">${esc(f.slice(4))}</span>`;
    const e = signals[f.replace(/\*$/, '')] || signals[f];
    if (!e) return `<span class="src none" title="No data yet">${esc(f)}</span>`;
    const stale = Date.now() - e.ts > 6 * 3600_000 ? ' stale' : '';
    return `<span class="src ${SRC_CLASS[e.source] ?? ''}${stale}" title="${esc(e.source)} · ${esc(ago(e.ts))}">${esc(f)}</span>`;
  });
  return `<div class="srcs">${parts.join('')}</div>`;
}

export const sampleBadge = (meta) => (meta?.sample_mode ? '<span class="badge">SAMPLE DATA</span>' : '');

// Arc gauge, 270 degrees, as in the v2 charge dial.
export function arc({ cx, cy, r, frac, width = 10, glow = true, color = 'var(--cyan)', id = 'g' }) {
  const len = 2 * Math.PI * r * 0.75;
  const on = Math.max(0, Math.min(1, frac || 0)) * len;
  const common = `cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})"`;
  return `
    <defs><filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"></feGaussianBlur></filter></defs>
    <circle ${common} stroke="var(--track)" stroke-width="${width + 4}" stroke-dasharray="${len} 2000"></circle>
    ${glow && on > 0 ? `<circle ${common} stroke="${color}" stroke-width="${width + 4}" stroke-dasharray="${on} 2000" filter="url(#${id})" opacity="0.7"></circle>` : ''}
    ${on > 0 ? `<circle ${common} stroke="${color}" stroke-width="${width}" stroke-dasharray="${on} 2000"></circle>` : ''}`;
}

export function ring({ cx, cy, r, frac, width = 9, color = 'var(--cyan)' }) {
  const c = 2 * Math.PI * r;
  const on = Math.max(0, Math.min(1, frac || 0)) * c;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${width}"></circle>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-dasharray="${on} ${c}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"></circle>`;
}

// Line/area chart. series: [{points: [[x, y]], color, dashed, area}]
export function lineChart({ w = 326, h = 140, series, xmin, xmax, ymin, ymax, pad = 8, labels = '', marker, label = 'chart' }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return `<div class="empty">No data yet</div>`;
  xmin ??= Math.min(...all.map((p) => p[0]));
  xmax ??= Math.max(...all.map((p) => p[0]));
  ymin ??= Math.min(...all.map((p) => p[1]));
  ymax ??= Math.max(...all.map((p) => p[1]));
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  if (xmax === xmin) xmax += 1;
  const bottom = h - 16;
  const X = (x) => pad + ((x - xmin) / (xmax - xmin)) * (w - pad * 2);
  const Y = (y) => 10 + (1 - (y - ymin) / (ymax - ymin)) * (bottom - 10);
  const paths = series.map((s, i) => {
    const pts = s.points.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
    const area = s.area && s.points.length > 1
      ? `<defs><linearGradient id="ar${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.32"></stop><stop offset="1" stop-color="${s.color}" stop-opacity="0"></stop></linearGradient></defs>
         <path d="M${X(s.points[0][0])},${bottom} L${pts.replace(/ /g, ' L')} L${X(s.points[s.points.length - 1][0])},${bottom} Z" fill="url(#ar${i})"></path>`
      : '';
    return `${area}<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" stroke-linecap="round" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="3 4"' : ''}></polyline>`;
  }).join('');
  const m = marker ? `<circle cx="${X(marker[0])}" cy="${Y(marker[1])}" r="5" fill="var(--bg)" stroke="${marker[2] || 'var(--cyan)'}" stroke-width="2"></circle>` : '';
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
    <line x1="${pad}" y1="${bottom}" x2="${w - pad}" y2="${bottom}" stroke="rgba(79,227,255,0.18)"></line>
    <line x1="${pad}" y1="${Y((ymin + ymax) / 2)}" x2="${w - pad}" y2="${Y((ymin + ymax) / 2)}" stroke="rgba(79,227,255,0.08)" stroke-dasharray="2 4"></line>
    ${paths}${m}${typeof labels === 'function' ? labels({ X, Y, bottom, w, h }) : labels}
  </svg>`;
}

// Top view of the car with tire pressures, cabin temperature, lock and Sentry state.
export function carTop(sig, { scale = 1, leaks = [] } = {}) {
  const v = (f) => sig[f]?.value;
  const tire = (f) => psi(v(f));
  const flag = (t) => leaks.includes(t);
  const tireColor = (t) => (flag(t) ? 'var(--amber)' : 'var(--cyan)');
  const locked = v('Locked');
  const sentry = typeof v('SentryMode') === 'string' && !/Off|Unknown/.test(v('SentryMode'));
  const openWin = ['FdWindow', 'FpWindow', 'RdWindow', 'RpWindow'].filter((w) => /Open/.test(v(w) || ''));
  const doors = v('DoorState');
  const openDoors = doors && typeof doors === 'object' ? Object.entries(doors).filter(([, o]) => o).map(([k]) => k) : [];
  const tt = (x, y, val, label, t, anchor = 'start') => `
    <text x="${x}" y="${y}" fill="${flag(t) ? 'var(--amber)' : 'var(--text)'}" font-size="24" font-weight="700" text-anchor="${anchor}">${num(val)}</text>
    <text class="m" x="${x}" y="${y + 16}" fill="${flag(t) ? 'var(--amber)' : 'var(--muted)'}" font-size="9" letter-spacing="1.2" text-anchor="${anchor}">${label}${flag(t) ? ' ▼' : ''}</text>`;
  const lockLabel = locked === true ? 'LOCKED' : locked === false ? 'UNLOCKED' : 'LOCK ?';
  const lockColor = locked === false ? 'var(--amber)' : 'var(--green)';
  return `<svg class="chart" viewBox="0 0 356 310" style="max-width:${520 * scale}px;margin:0 auto" role="img" aria-label="Car top view: tires ${num(tire('TpmsPressureFl'))}, ${num(tire('TpmsPressureFr'))}, ${num(tire('TpmsPressureRl'))}, ${num(tire('TpmsPressureRr'))} psi; cabin ${temp(v('InsideTemp'))}; ${lockLabel.toLowerCase()}${sentry ? '; Sentry on' : ''}">
    <defs><filter id="ct" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"></feGaussianBlur></filter></defs>
    <ellipse cx="178" cy="150" rx="120" ry="138" fill="none" stroke="rgba(79,227,255,0.10)" stroke-dasharray="2 6"></ellipse>
    <path d="M138,40 C138,20 218,20 218,40 L226,110 L226,252 C226,274 130,274 130,252 L130,110 Z" fill="rgba(79,227,255,0.04)" stroke="var(--cyan)" stroke-width="1.5" filter="url(#ct)" opacity="0.6"></path>
    <path d="M138,40 C138,20 218,20 218,40 L226,110 L226,252 C226,274 130,274 130,252 L130,110 Z" fill="none" stroke="var(--cyan)" stroke-width="1.5"></path>
    <path d="M146,96 C150,86 206,86 210,96 L214,206 C200,216 156,216 142,206 Z" fill="rgba(79,227,255,0.07)" stroke="rgba(79,227,255,0.6)"></path>
    <line x1="178" y1="30" x2="178" y2="86" stroke="rgba(79,227,255,0.25)"></line>
    <rect x="120" y="58" width="9" height="32" rx="3" fill="${tireColor('FL')}"></rect>
    <rect x="227" y="58" width="9" height="32" rx="3" fill="${tireColor('FR')}"></rect>
    <rect x="120" y="206" width="9" height="32" rx="3" fill="${tireColor('RL')}"></rect>
    <rect x="227" y="206" width="9" height="32" rx="3" fill="${tireColor('RR')}"></rect>
    <line x1="118" y1="74" x2="72" y2="74" stroke="rgba(79,227,255,0.5)"></line>
    <line x1="238" y1="74" x2="284" y2="74" stroke="rgba(79,227,255,0.5)"></line>
    <line x1="118" y1="222" x2="72" y2="222" stroke="${flag('RL') ? 'rgba(255,181,71,0.7)' : 'rgba(79,227,255,0.5)'}"></line>
    <line x1="238" y1="222" x2="284" y2="222" stroke="${flag('RR') ? 'rgba(255,181,71,0.7)' : 'rgba(79,227,255,0.5)'}"></line>
    ${tt(12, 72, tire('TpmsPressureFl'), 'PSI · FL', 'FL')}
    ${tt(344, 72, tire('TpmsPressureFr'), 'PSI · FR', 'FR', 'end')}
    ${tt(12, 220, tire('TpmsPressureRl'), 'PSI · RL', 'RL')}
    ${tt(344, 220, tire('TpmsPressureRr'), 'PSI · RR', 'RR', 'end')}
    <text x="178" y="146" fill="var(--text)" font-size="22" font-weight="600" text-anchor="middle">${temp(v('InsideTemp'))}</text>
    <text class="m" x="178" y="162" fill="var(--muted)" font-size="9" text-anchor="middle" letter-spacing="1.2">CABIN · OUT ${temp(v('OutsideTemp'))}</text>
    <rect x="134" y="282" width="88" height="18" rx="9" fill="${locked === false ? 'rgba(255,181,71,0.12)' : 'rgba(92,242,176,0.12)'}" stroke="${lockColor}" stroke-opacity="0.6"></rect>
    <text class="m" x="178" y="295" fill="${lockColor}" font-size="9" text-anchor="middle" letter-spacing="1.2">${lockLabel}</text>
    ${sentry ? '<circle cx="292" cy="290" r="4" fill="var(--red)"></circle><text class="m" x="302" y="294" fill="var(--text-2)" font-size="9" letter-spacing="1.2">SENTRY</text>' : ''}
    ${openWin.length || openDoors.length ? `<text class="m" x="12" y="294" fill="var(--amber)" font-size="9" letter-spacing="1.2">${openDoors.length ? 'DOOR OPEN' : 'WINDOW OPEN'}</text>` : ''}
  </svg>`;
}

export const ICONS = {
  car: '<path d="M4 16 12 4l8 12M7 20h10"></path>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"></path>',
  route: '<circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="6" r="2"></circle><path d="M8 18h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6"></path>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"></path>',
  gauge: '<path d="M12 14l4-4"></path><path d="M3.3 19a10 10 0 1 1 17.4 0"></path>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 7.5-2"></path>',
  fan: '<circle cx="12" cy="12" r="2"></circle><path d="M12 10c0-4 1-6 4-6s2 5-2 6M14 12c4 0 6 1 6 4s-5 2-6-2M12 14c0 4-1 6-4 6s-2-5 2-6M10 12c-4 0-6-1-6-4s5-2 6 2"></path>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
  warn: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v6M12 16.5h.01"></path>',
  clock: '<path d="M12 3a9 9 0 1 0 9 9"></path><path d="M12 7v5l3 2"></path>',
  gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path>',
};
export const icon = (name, size = 24, color = 'currentColor') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
