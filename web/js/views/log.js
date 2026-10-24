// Software (release notes) and Alerts screens. Both read Fleet API data the server cached; nothing
// here calls Tesla until the Fetch button is pressed, and the car is never woken for it.
import { actions, api, isDriving, load, render, state, toast } from '../core.js';
import { ago, chips, clock, dateTime, esc, icon, sampleBadge } from '../ui.js';

const head = (title, meta) => `<div class="head"><div class="stack" style="gap:6px"><a class="k" href="#/">← Car</a><h1>${title}</h1></div>${sampleBadge(meta)}</div>`;

function fetchBar(d, what) {
  const when = d.fetched_at ? `Fetched ${ago(d.fetched_at)}${d.sample ? ' · sample' : ''}` : 'Not fetched yet';
  const btn = d.can_fetch
    ? `<button class="bigbtn ghost slim" type="button" data-action="fleet-fetch" data-what="${what}">Fetch</button>`
    : `<button class="bigbtn ghost slim" type="button" disabled title="Link your Tesla account in Setup first">Fetch</button>`;
  return `<div class="row"><span class="k">${esc(when)}</span>${btn}</div>`;
}

const paras = (text) => esc(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

const rawBlock = (raw) => (raw ? `<details><summary class="k">Raw response</summary><pre>${esc(JSON.stringify(raw, null, 2).slice(0, 8000))}</pre></details>` : '');

function shapeNote(d, kind) {
  if (!d.fetched_at) return '';
  if (d.matched === null) return `<div class="t amber">Tesla's response had no ${kind} list in a format this app knows. It's shown raw below so nothing is hidden.</div>`;
  if (d.matched === 'guess') return `<div class="t amber">The response had no <span class="mono">${kind}</span> key, so the first list in it is shown. Check it against the raw response below.</div>`;
  return '';
}

export async function releaseNotesView(st) {
  const d = await load('relnotes', '/api/vehicle/release-notes', 60_000);
  const update = d.update && !isDriving()
    ? `<div class="update">
        <div class="row"><div class="stack"><span class="k amber">Update ready</span><span class="mono" style="font-size:22px;font-weight:700">${esc(d.update)}</span></div>${icon('download', 28, 'var(--amber)')}</div>
        <button class="bigbtn" type="button" data-cmd="schedule_software_update" data-args='{"offset_sec":0}' data-label="Update" data-confirm="Install ${esc(d.update)} now? The car can't be driven during the install.">Install now</button>
        <div class="t">These notes are the ones Tesla returns for the car. Whether they describe the installed version or the waiting update isn't documented, so check the version on each note.</div>
      </div>`
    : d.update ? `<div class="t">Update ${esc(d.update)} is ready. Install it when parked.</div>` : '';
  const notes = d.notes.length
    ? d.notes.map((n, i) => `<article class="note${i === 0 ? ' first' : ''}">
        <div class="row" style="align-items:flex-start"><div class="stack" style="gap:4px">
          <h2>${esc(n.title || 'Untitled note')}</h2>${n.subtitle ? `<span class="k">${esc(n.subtitle)}</span>` : ''}
        </div>${n.version ? `<span class="ver">${esc(n.version)}</span>` : ''}</div>
        ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        ${n.description ? `<div class="body">${paras(n.description)}</div>` : ''}
      </article>`).join('')
    : `<div class="empty">${d.fetched_at ? 'Tesla returned no release notes.' : 'No release notes yet. Tap Fetch to ask Tesla for them.'}</div>`;
  return `
    ${head('Software', st.meta)}
    <div class="pn" style="gap:12px">
      <div class="k">Installed</div>
      <div class="big glow cyan mono" style="font-size:40px">${esc(d.version || '—')}</div>
      ${update}
      ${chips(['Version', 'SoftwareUpdateVersion'], st.signals)}
    </div>
    <div class="pn" style="gap:10px">
      <div class="k">Release notes${d.notes.length ? ` · ${d.notes.length}` : ''}</div>
      ${fetchBar(d, 'release_notes')}
      ${shapeNote(d, 'release_notes')}
      ${notes}
      ${chips(['api:release_notes'])}
      ${rawBlock(d.raw)}
    </div>
    <div class="t center">Fetching is a billed Fleet API data request. The server keeps the answer for a day.</div>`;
}

const audTag = (a) => `<span class="aud${/customer/i.test(a) ? '' : ' svc'}">${esc(a)}</span>`;

function byDay(rows, tsKey) {
  const groups = [];
  for (const r of rows) {
    const label = r[tsKey] ? new Date(r[tsKey]).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() : 'NO TIME';
    if (groups.at(-1)?.label !== label) groups.push({ label, rows: [] });
    groups.at(-1).rows.push(r);
  }
  return groups;
}

function alertRow(a, { ts, extra = '' }) {
  return `<div class="alert">
    <span class="ts">${ts ? clock(ts).slice(0, 5) : '—'}</span>
    <div class="stack" style="gap:4px;min-width:0">
      <span style="font-size:15px;font-weight:500">${esc(a.text || a.label)}</span>
      <span class="code" title="Alert name as the car reports it">${esc(a.name || '—')}</span>
      <div class="row" style="justify-content:flex-start;gap:4px;flex-wrap:wrap">${a.audience.map(audTag).join('')}${extra}</div>
    </div>
  </div>`;
}

export async function alertsView(st) {
  const d = await load('valerts', '/api/vehicle/alerts', 60_000);
  const week = Date.now() - 7 * 86400_000;
  const recent7 = d.alerts.filter((a) => a.ts && a.ts >= week).length;
  const active = d.streamed.filter((a) => a.active);
  const lastTs = Math.max(0, ...d.alerts.map((a) => a.ts || 0), ...d.streamed.map((a) => a.started || 0));
  const fleet = d.alerts.length
    ? byDay(d.alerts, 'ts').map((g) => `<div class="k day">${esc(g.label)}</div>${g.rows.map((a) => alertRow(a, { ts: a.ts })).join('')}`).join('')
    : `<div class="empty">${d.fetched_at ? 'Tesla returned no recent alerts.' : 'Not fetched yet. Tap Fetch to ask Tesla for the car\'s recent alerts.'}</div>`;
  const streamed = d.streamed.length
    ? byDay(d.streamed, 'started').map((g) => `<div class="k day">${esc(g.label)}</div>${g.rows.map((a) => alertRow(a, {
      ts: a.started,
      extra: a.active
        ? '<span class="aud live-tag"><span class="live" style="width:6px;height:6px"></span>Active</span>'
        : `<span class="aud ended">Ended${a.started && a.ended ? ` after ${dur(a.ended - a.started)}` : ''}</span>`,
    })).join('')}`).join('')
    : '<div class="empty">No alerts streamed yet. They arrive from Fleet Telemetry as the car raises them.</div>';
  return `
    ${head('Alerts', st.meta)}
    <div class="pn">
      <div class="grid3 center">
        <div class="stack"><span class="big glow cyan" style="font-size:34px">${recent7}</span><span class="k">Last 7 days</span></div>
        <div class="stack"><span class="big ${active.length ? 'amber' : 'green'}" style="font-size:34px">${active.length}</span><span class="k">Active now</span></div>
        <div class="stack"><span class="mono" style="font-size:16px;font-weight:700;line-height:34px">${lastTs ? esc(ago(lastTs)) : '—'}</span><span class="k">Last alert</span></div>
      </div>
    </div>
    <div class="pn" style="gap:6px">
      <div class="k">Recent alerts · Fleet API</div>
      ${fetchBar(d, 'recent_alerts')}
      ${shapeNote(d, 'recent_alerts')}
      ${fleet}
      ${chips(['api:recent_alerts'])}
      ${rawBlock(d.raw)}
    </div>
    <div class="pn" style="gap:6px">
      <div class="k">Streamed · Fleet Telemetry</div>
      ${streamed}
      <div class="t">Sent by the car over Fleet Telemetry (alert_types: service). Received ${d.streamed[0] ? dateTime(d.streamed[0].received) : 'never'}.</div>
    </div>
    <div class="t center">Tags show who each alert is meant for, as the car labels it.</div>`;
}

function dur(ms) {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

Object.assign(actions, {
  'fleet-fetch': async (el) => {
    el.setAttribute('aria-busy', 'true');
    try {
      await api(`/api/tesla/refresh?what=${encodeURIComponent(el.dataset.what)}`, { method: 'POST' });
      delete state.cache.relnotes;
      delete state.cache.valerts;
      toast('Fetched from Tesla');
      render();
    } catch (err) {
      toast(`Fetch failed: ${err.message}`, true);
    } finally {
      el.removeAttribute('aria-busy');
    }
  },
});
