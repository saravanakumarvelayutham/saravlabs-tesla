// Signal history sheet: opens over any screen when a stream row or source chip is tapped.
// Data comes from the server's SQLite history (GET /api/signals/:field/history); live SSE values
// for the open field are appended until the next refetch.
import { state, render, actions, useData } from '../core.js';
import { ago, chips, clock, dateTime, esc, fmtValue, prefs } from '../ui.js';

const RANGES = ['1h', '6h', '24h', '7d'];
const COLORS = ['var(--cyan)', 'var(--violet)', 'var(--green)', 'var(--amber)', 'var(--red)', 'var(--cyan-hi)'];

let lastRange = '24h'; // the sheet reopens on the range picked last
actions['sig-open'] = (el) => {
  state.sheet = { field: el.dataset.field, range: lastRange, live: [], enter: true };
  render();
};
actions['sig-close'] = () => { state.sheet = null; render(); };
actions['sig-range'] = (el) => { state.sheet.range = lastRange = el.dataset.range; state.sheet.live = []; render(); };

// Called from the live stream for every signal.
export function sheetSignal(s) {
  if (state.sheet?.field === s.field) state.sheet.live.push(s);
}

// Display units: tires in psi and temperatures in the user's unit, as on the other screens.
export function displayUnit(meta) {
  const unit = meta?.unit || '';
  if (unit === 'bar') return { unit: 'psi', conv: (v) => v * 14.503773773 };
  if (unit === '°C') return prefs.temp === 'F' ? { unit: '°F', conv: (v) => v * 9 / 5 + 32 } : { unit: '°C', conv: (v) => v };
  return { unit, conv: (v) => v };
}

export const decimals = (lo, hi) => {
  const span = Math.abs(hi - lo);
  if (span === 0) return Number.isInteger(hi) ? 0 : Number.isInteger(hi * 10) ? 1 : 2;
  return span >= 100 || Math.abs(hi) >= 1000 ? 0 : span >= 5 ? 1 : 2;
};

export function signalSheet() {
  const { field, range } = state.sheet;
  const data = useData(`sig:${field}:${range}`, `/api/signals/${encodeURIComponent(field)}/history?range=${range}`, 30_000);
  const entry = state.signals[field];
  const body = !data ? '<div class="empty">Loading history…</div>' : data.kind === 'numeric' ? numericBody(data) : stateBody(data);
  const doc = data?.meta ? [data.meta.doc, data.meta.unitNote, data.meta.interval ? `Car sends it on change, at most every ${data.meta.interval} s.` : ''].filter(Boolean).join(' ') : '';
  const enter = state.sheet.enter ? ' enter' : '';
  state.sheet.enter = false;
  return `<div class="sheet-bg${enter}" data-action="sig-close"></div>
  <section class="sheet pn${enter}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <div class="row" style="align-items:flex-start">
      <div class="stack" style="gap:4px;min-width:0">
        <span class="k">Signal history</span>
        <span id="sheet-title" class="mono cyan glow sheet-field">${esc(field)}</span>
      </div>
      <button class="sheet-x" type="button" data-action="sig-close" data-fk="close" aria-label="Close">✕</button>
    </div>
    ${current(field, entry, data)}
    <div class="switch" role="group" aria-label="Time range">${RANGES.map((r) => `<a href="#" role="button" data-action="sig-range" data-range="${r}" data-fk="r${r}" class="${r === range ? 'on' : ''}"${r === range ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${r}</a>`).join('')}</div>
    ${body}
    ${doc ? `<div class="t">${esc(doc)}</div>` : ''}
    ${chips([field], state.signals)}
  </section>`;
}

function current(field, entry, data) {
  if (!entry) return '<div class="t">No value received yet.</div>';
  const { unit, conv } = displayUnit(data?.meta);
  const v = entry.value;
  const shown = typeof v === 'number' ? conv(v) : null;
  const d = data?.stats?.count ? decimals(conv(data.stats.min), conv(data.stats.max)) : 1;
  const text = shown != null ? shown.toFixed(d) : fmtValue(v);
  return `<div class="row end">
    <div class="big glow cyan" style="font-size:${shown != null ? 44 : 28}px;min-width:0;overflow-wrap:anywhere">${esc(text)}${shown != null && unit ? `<span style="font-size:18px;margin-left:4px">${esc(unit)}</span>` : ''}</div>
    <div class="stack" style="align-items:flex-end;flex:none"><span class="k">${esc(entry.source)}</span><span class="t">${esc(ago(entry.ts))}</span></div>
  </div>`;
}

function numericBody(data) {
  const { unit, conv } = displayUnit(data.meta);
  const live = state.sheet.live.filter((s) => s.ts > data.to && typeof s.value === 'number');
  const pts = data.points.map(([t, av, mn, mx]) => [t, conv(av), conv(mn), conv(mx)]);
  // End on the actual latest reading, not its bucket's average, so the marker matches the big number.
  const e = data.latest;
  if (e && typeof e.value === 'number' && e.ts >= data.from && pts.length) {
    if (pts[pts.length - 1][0] >= e.ts) pts.pop();
    pts.push([e.ts, conv(e.value), conv(e.value), conv(e.value)]);
  }
  for (const s of live) pts.push([s.ts, conv(s.value), conv(s.value), conv(s.value)]);
  if (!pts.length) {
    return `<div class="empty">No samples in the last ${esc(data.range)}.${e ? ` Last value ${esc(fmtValue(typeof e.value === 'number' ? conv(e.value) : e.value))} ${esc(unit)} at ${esc(dateTime(e.ts))}.` : ''}${widerRange(data.range)}</div>`;
  }
  const lo = Math.min(data.stats.min != null ? conv(data.stats.min) : Infinity, ...live.map((s) => conv(s.value)));
  const hi = Math.max(data.stats.max != null ? conv(data.stats.max) : -Infinity, ...live.map((s) => conv(s.value)));
  const d = decimals(lo, hi);
  const count = data.stats.count + live.length;
  const avg = data.stats.count ? conv(data.stats.avg) : pts[pts.length - 1][1];
  const to = Math.max(Date.now(), pts[pts.length - 1][0]);
  return `${bandChart({ pts, from: data.from, to, lo, hi, d, unit, range: data.range, field: data.field })}
    <div class="grid4">
      ${stat('Min', lo.toFixed(d), unit)}${stat('Avg', avg.toFixed(d), unit)}${stat('Max', hi.toFixed(d), unit)}${stat('Samples', String(count), '')}
    </div>
    <div class="t">${data.points.some((p) => p[4] > 1) ? `Line is the average per ${esc(span(data.bucket_ms))}; the shaded band is each bucket's min to max. ` : ''}Dashed line holds the last value until now, since the car only sends a field when it changes.</div>`;
}

function widerRange(range) {
  const next = RANGES[RANGES.indexOf(range) + 1];
  return next ? ` <a href="#" role="button" data-action="sig-range" data-range="${next}" data-fk="w${next}">Show ${next.toUpperCase()}</a>` : '';
}

const stat = (k, v, unit) => `<div class="pn stat"><span class="k">${k}</span><span class="mono" style="font-size:15px;font-weight:700;white-space:nowrap">${esc(v)}<span style="font-size:10px;font-weight:400;color:var(--muted)">${esc(unit)}</span></span></div>`;

function span(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3600_000)} h`;
}

function bandChart({ pts, from, to, lo, hi, d, unit, range, field }) {
  const w = 340; const h = 170; const left = 8; const right = 8; const top = 14; const bottom = h - 20;
  let ymin = lo; let ymax = hi;
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const padY = (ymax - ymin) * 0.08;
  ymin -= padY; ymax += padY;
  const X = (t) => left + ((t - from) / (to - from)) * (w - left - right);
  const Y = (v) => top + (1 - (v - ymin) / (ymax - ymin)) * (bottom - top);
  const f = (n) => n.toFixed(1);
  const band = pts.length > 1
    ? `<path d="M${pts.map((p) => `${f(X(p[0]))},${f(Y(p[3]))}`).join(' L')} L${pts.slice().reverse().map((p) => `${f(X(p[0]))},${f(Y(p[2]))}`).join(' L')} Z" fill="rgba(79,227,255,0.14)" stroke="none"></path>`
    : '';
  const line = pts.map((p) => `${f(X(p[0]))},${f(Y(p[1]))}`).join(' ');
  const last = pts[pts.length - 1];
  const fmtT = range === '7d' ? (t) => new Date(t).toLocaleDateString([], { weekday: 'short' }).toUpperCase() : (t) => clock(t).slice(0, 5);
  // A week is labelled at local midnights; shorter ranges at quarters.
  const ticks = range === '7d' ? midnights(from, to) : [0, 0.25, 0.5, 0.75].map((q) => from + q * (to - from));
  const grid = [0.25, 0.5, 0.75].map((q) => `<line x1="${left}" x2="${w - right}" y1="${f(top + q * (bottom - top))}" y2="${f(top + q * (bottom - top))}" stroke="rgba(79,227,255,0.07)" stroke-dasharray="2 4"></line>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(field)} over the last ${esc(range)}: min ${lo.toFixed(d)}, max ${hi.toFixed(d)} ${esc(unit)}">
    <defs><filter id="sgl" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3"></feGaussianBlur></filter></defs>
    ${grid}
    <line x1="${left}" y1="${bottom}" x2="${w - right}" y2="${bottom}" stroke="rgba(79,227,255,0.18)"></line>
    ${band}
    <polyline points="${line}" fill="none" stroke="var(--cyan)" stroke-width="4" opacity="0.55" filter="url(#sgl)"></polyline>
    <polyline points="${line}" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    <line x1="${f(X(last[0]))}" y1="${f(Y(last[1]))}" x2="${f(X(to))}" y2="${f(Y(last[1]))}" stroke="var(--cyan)" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.7"></line>
    <circle cx="${f(X(last[0]))}" cy="${f(Y(last[1]))}" r="4.5" fill="var(--bg)" stroke="var(--cyan-hi)" stroke-width="2"></circle>
    <text class="m" x="${left + 2}" y="${top - 3}" fill="var(--muted)" font-size="9">${hi.toFixed(d)} ${esc(unit)}</text>
    <text class="m" x="${left + 2}" y="${bottom - 4}" fill="var(--muted)" font-size="9">${lo.toFixed(d)} ${esc(unit)}</text>
    ${ticks.filter((t) => t === from || (X(t) > 24 && X(t) < w - 40)).map((t) => `<text class="m" x="${f(X(t))}" y="${h - 5}" fill="var(--muted)" font-size="9" text-anchor="${t === from ? 'start' : 'middle'}">${fmtT(t)}</text>`).join('')}
    <text class="m" x="${w - right}" y="${h - 5}" fill="var(--cyan)" font-size="9" text-anchor="end">NOW</text>
  </svg>`;
}

function midnights(from, to) {
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  const out = [];
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) out.push(d.getTime());
  return out;
}

function stateBody(data) {
  const live = state.sheet.live.filter((s) => s.ts > data.to);
  const changes = [...data.changes];
  for (const s of live) {
    const prev = changes.length ? changes[changes.length - 1].value : data.initial?.value;
    if (JSON.stringify(prev) !== JSON.stringify(s.value)) changes.push({ ts: s.ts, value: s.value, source: s.source });
  }
  if (!changes.length && !data.initial) return `<div class="empty">No values stored in the last ${esc(data.range)}.${widerRange(data.range)}</div>`;
  const parts = [];
  if (data.states) parts.push(timeline(data, changes));
  const rows = changes.slice().reverse().slice(0, 14);
  parts.push(`<div class="stack" style="gap:0">
    <div class="row"><span class="k">Changes</span><span class="k">${changes.length}${data.truncated ? '+' : ''} in ${esc(data.range)}</span></div>
    ${rows.length ? rows.map((c) => `<div class="st"><span class="ts">${esc(data.range === '1h' || data.range === '6h' ? clock(c.ts) : dateTime(c.ts))}</span><span>${esc(fmtValue(c.value))}</span><span class="k">${esc(c.source)}</span></div>`).join('')
    : `<div class="t">No change in the last ${esc(data.range)}; it has been ${esc(fmtValue(data.initial.value))} since ${esc(dateTime(data.initial.ts))}.</div>`}
  </div>`);
  return parts.join('');
}

// Strip of colored segments, one per value over the window, with time-in-state percentages.
function timeline(data, changes) {
  const to = Math.max(Date.now(), data.to);
  const segs = [];
  if (data.initial) segs.push({ value: data.initial.value, start: data.from });
  for (const c of changes) segs.push({ value: c.value, start: Math.max(c.ts, data.from) });
  const keys = [...new Set(data.states.map((s) => JSON.stringify(s.value)))];
  for (const s of segs) if (!keys.includes(JSON.stringify(s.value))) keys.push(JSON.stringify(s.value));
  const color = (v) => (v === false || v === null ? 'var(--track)' : COLORS[keys.indexOf(JSON.stringify(v)) % COLORS.length]);
  const w = 340;
  const X = (t) => ((t - data.from) / (to - data.from)) * w;
  const rects = segs.map((s, i) => {
    const end = i + 1 < segs.length ? segs[i + 1].start : to;
    return `<rect x="${X(s.start).toFixed(1)}" y="0" width="${Math.max(1, X(end) - X(s.start)).toFixed(1)}" height="22" fill="${color(s.value)}" opacity="${s.value === false || s.value === null ? 1 : 0.85}"></rect>`;
  }).join('');
  const total = data.states.reduce((s, x) => s + x.ms, 0) || 1;
  return `<svg class="chart" viewBox="0 0 ${w} 22" preserveAspectRatio="none" style="height:22px;border-radius:4px" role="img" aria-label="${esc(data.field)} states over the last ${esc(data.range)}">${rects}</svg>
    <div class="legend">${data.states.slice(0, 6).map((s) => `<span><i style="background:${color(s.value)}"></i>${esc(fmtValue(s.value))} <b>${Math.round((s.ms / total) * 100)}%</b></span>`).join('')}</div>`;
}
