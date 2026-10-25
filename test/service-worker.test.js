import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function worker({ offline = false } = {}) {
  const handlers = {}, installed = [], cached = [];
  const context = {
    URL, Request: class extends Request { constructor(url, opts) { super(new URL(url, 'https://car.test'), opts); } },
    location: { origin: 'https://car.test' },
    self: { addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: {
      open: async () => ({ addAll: async (requests) => { installed.push(...requests); }, put: async (...args) => { cached.push(args); } }),
      match: async () => new Response('offline shell'),
    },
    // Simulate a fresh HTTP-cache entry belonging to the old release.
    fetch: async (request, opts) => {
      if (offline) throw new Error('offline');
      return new Response(opts?.cache === 'no-cache' ? 'current release' : 'old HTTP cache');
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8'), context);
  const fetchAsset = (path) => {
    let response;
    handlers.fetch({ request: new Request(`https://car.test${path}`), respondWith: (p) => { response = p; } });
    return response;
  };
  return { handlers, installed, cached, fetchAsset };
}

test('worker update installs fresh shell files rather than stale browser-cache files', async () => {
  const w = worker();
  let install;
  w.handlers.install({ waitUntil: (p) => { install = p; } });
  await install;
  assert.ok(w.installed.some((r) => r.url.endsWith('/js/views/overview.js')));
  assert.ok(w.installed.every((r) => r.cache === 'reload'));
});

test('controlled pages fetch current app code despite a still-fresh old HTTP cache', async () => {
  const w = worker();
  for (const path of ['/', '/index.html', '/js/app.js', '/js/views/home.js', '/css/app.css']) {
    assert.equal(await (await w.fetchAsset(path)).text(), 'current release', path);
  }
  assert.equal(await (await w.fetchAsset('/models/model-s-plaid.glb')).text(), 'old HTTP cache');
  assert.equal(w.fetchAsset('/api/state'), undefined);
});

test('app code still falls back to the saved shell when offline', async () => {
  assert.equal(await (await worker({ offline: true }).fetchAsset('/js/app.js')).text(), 'offline shell');
});
