import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, MAX_ZOOM, fitView, mercX, mercY, tileHref, tilesFor } from '../web/js/map.js';
import { routeSvg } from '../web/js/views/trips.js';

// Slippy-map tile index from OpenStreetMap's wiki (Slippy_map_tilenames), written independently.
const slippy = (lat, lon, z) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)];
};

const HOME = [37.3947, -122.1503];
const WORK = [37.4419, -122.143];
const route = Array.from({ length: 30 }, (_, i) => {
  const f = i / 29;
  return [HOME[0] + (WORK[0] - HOME[0]) * f, HOME[1] + (WORK[1] - HOME[1]) * f + Math.sin(f * 6) * 0.004, 1000 + i * 1000, 40];
});

test('Mercator projection matches the slippy-map tile index', () => {
  assert.equal(mercX(0, 0), 128);
  assert.equal(mercY(0, 0), 128);
  for (const [lat, lon] of [HOME, WORK, [51.5007, -0.1246], [-33.8568, 151.2153], [64.1466, -21.9426]]) {
    for (const z of [3, 10, 14, 17]) {
      assert.deepEqual([Math.floor(mercX(lon, z) / TILE), Math.floor(mercY(lat, z) / TILE)], slippy(lat, lon, z), `${lat},${lon} z${z}`);
    }
  }
});

test('fitView picks the largest zoom that keeps the route inside the padded box', () => {
  const box = { w: 356, h: 250, pad: 26 };
  const v = fitView(route, box);
  for (const [lat, lon] of route) {
    assert.ok(v.X(lon) >= box.pad - 1e-6 && v.X(lon) <= box.w - box.pad + 1e-6);
    assert.ok(v.Y(lat) >= box.pad - 1e-6 && v.Y(lat) <= box.h - box.pad + 1e-6);
  }
  const lats = route.map((p) => p[0]);
  const lons = route.map((p) => p[1]);
  const z1 = v.z + 1;
  const tooBig = mercX(Math.max(...lons), z1) - mercX(Math.min(...lons), z1) > box.w - box.pad * 2
    || mercY(Math.min(...lats), z1) - mercY(Math.max(...lats), z1) > box.h - box.pad * 2;
  assert.ok(tooBig, `zoom ${z1} should not fit`);
  // A parking-lot shuffle doesn't zoom past what tiles exist for.
  assert.equal(fitView([[37.39, -122.15], [37.39001, -122.15001]], box).z, MAX_ZOOM);
});

test('tiles cover the whole box, each is drawn where its own coordinates say', () => {
  const w = 356;
  const h = 250;
  const v = fitView(route, { w, h, pad: 26 });
  const tiles = tilesFor(v, w, h);
  assert.ok(tiles.length >= 2 && tiles.length <= 6, `${tiles.length} tiles`);
  for (let y = 0; y < h; y += 5) {
    for (let x = 0; x < w; x += 5) {
      assert.ok(tiles.some((t) => x >= t.x && x < t.x + TILE && y >= t.y && y < t.y + TILE), `gap at ${x},${y}`);
    }
  }
  // The route's start lands on the tile the slippy formula names for it.
  const [tx, ty] = slippy(HOME[0], HOME[1], v.z);
  const sx = v.X(HOME[1]);
  const sy = v.Y(HOME[0]);
  const hit = tiles.find((t) => sx >= t.x && sx < t.x + TILE && sy >= t.y && sy < t.y + TILE);
  assert.equal(hit.url, `https://tile.openstreetmap.org/${v.z}/${tx}/${ty}.png`);
});

test('tile x wraps across the antimeridian and rows off the map are skipped', () => {
  const z = 2;
  const across = tilesFor({ z, ox: -100, oy: 10 }, 356, 250).map((t) => t.url.split('/').slice(-3).join('/'));
  assert.ok(across.includes('2/3/0.png') && across.includes('2/0/0.png'), across.join(' '));
  const top = tilesFor({ z, ox: 0, oy: -300 }, 356, 250);
  assert.ok(top.every((t) => !/\/-\d/.test(t.url)));
});

test('route SVG draws tiles, dark filter and attribution only when tiles are on', () => {
  const trip = { id: 7, route, segments: [{ from: 0, to: 15_000, wh_per_mile: 250 }, { from: 15_001, to: 99_000, wh_per_mile: 360 }] };
  const direct = (url) => url;
  const on = routeSvg(trip, { tiles: true, href: direct });
  assert.match(on, /<image href="https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png"/);
  assert.match(on, /<filter id="r7f"/);
  assert.match(on, /<g filter="url\(#r7f\)">/);
  assert.match(on, /href="https:\/\/www\.openstreetmap\.org\/copyright"/);
  assert.match(on, /© OpenStreetMap contributors/);
  assert.match(on, /stroke="var\(--cyan\)"/);
  assert.match(on, /stroke="var\(--amber\)"/);
  const off = routeSvg(trip, { tiles: false });
  assert.doesNotMatch(off, /openstreetmap/);
  assert.doesNotMatch(off, /<image/);
  // Two trips on one page don't share filter or clip ids.
  assert.doesNotMatch(routeSvg({ ...trip, id: 8 }, { tiles: true, href: direct }), /id="r7/);
  assert.match(routeSvg({ id: 1, route: [route[0]] }, { tiles: true, href: direct }), /No route points/);
});

test('each tile is fetched once and reused as a blob URL across re-renders', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push([url, opts]); return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })); };
  try {
    const trip = { id: 3, route };
    let readies = 0;
    const href = (url) => tileHref(url, () => { readies++; });
    const first = routeSvg(trip, { tiles: true, href });
    assert.doesNotMatch(first, /<image/, 'nothing drawn until a tile has loaded');
    const n = calls.length;
    assert.ok(n >= 2);
    for (let i = 0; i < 5; i++) routeSvg(trip, { tiles: true, href });
    assert.equal(calls.length, n, 'pending tiles are not requested again');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(readies, n);
    for (let i = 0; i < 5; i++) assert.match(routeSvg(trip, { tiles: true, href }), /<image href="blob:/);
    assert.equal(calls.length, n, 'loaded tiles are not requested again');
    assert.ok(calls.every(([url, o]) => url.startsWith('https://tile.openstreetmap.org/') && o.credentials === 'omit'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a tile that fails to load leaves the route on the bare grid', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  try {
    const trip = { id: 4, route: route.map(([lat, lon, ts, v]) => [lat + 1, lon, ts, v]) };
    let readies = 0;
    const href = (url) => tileHref(url, () => { readies++; });
    routeSvg(trip, { tiles: true, href });
    await new Promise((r) => setTimeout(r, 20));
    const svg = routeSvg(trip, { tiles: true, href });
    assert.equal(readies, 0);
    assert.doesNotMatch(svg, /<image/);
    assert.match(svg, /<line /);
    // Retried only once RETRY_MS has passed.
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new TypeError('offline'); };
    const url = routeSvg(trip, { tiles: true, href: (u) => u }).match(/<image href="([^"]+)"/)[1];
    tileHref(url, () => {});
    assert.equal(calls, 0);
    tileHref(url, () => {}, Date.now() + 5 * 60_000 + 1);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
