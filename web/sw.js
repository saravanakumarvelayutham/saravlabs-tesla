// Service worker: offline shell, web push, notification taps.
const CACHE = 'plaid-v11';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/core.js', '/js/ui.js', '/js/map.js',
  '/js/vehicle-insights.js', '/js/experience.js', '/css/experience.css',
  '/js/views/home.js', '/js/views/charge.js', '/js/views/trips.js', '/js/views/health.js', '/js/views/drive.js',
  '/js/views/car.js', '/js/views/setup.js', '/js/views/signal.js', '/js/views/log.js', '/js/views/overview.js', '/js/car3d.js',
  '/vendor/three/three.module.min.js', '/vendor/three/three.core.min.js', '/vendor/three/RoomEnvironment.js',
  '/vendor/three/GLTFLoader.js', '/vendor/three/BufferGeometryUtils.js', '/vendor/three/meshopt_decoder.module.js',
  '/models/model-s-plaid.glb', '/models/LICENSE.txt', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  // A new offline shell must not be seeded from an older release's HTTP cache.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// App shell: network first so updates show up, cache as the offline fallback. API calls are never cached.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  const appCode = url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname === '/sw.js' || url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/');
  e.respondWith(fetch(e.request, appCode ? { cache: 'no-cache' } : {}).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Plaid', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Plaid', {
    body: data.body || '',
    tag: data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(target); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
