// ───────────────────────────────────────────────────────────────────────────────
//  almustaqbal-v2  –  Service Worker
//  Strategies:
//    • HTML / JS / CSS  → Network-first (fresh code beats cache)
//    • Images / Fonts   → Stale-while-revalidate (fast + background refresh)
//    • Firebase SDK / CDN bundles → precached with Promise.allSettled
// ───────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'almustaqbal-v2';
const IMG_CACHE  = 'almustaqbal-v2-img';

// App-shell files — cached immediately on install
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/time-utils.js',
  './js/app.js',
  './js/audio.js',
  './js/excel-export.js',
  './js/firebase-config.js',
];

// CDN bundles — precache best-effort (Promise.allSettled, never blocks install)
const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700;900&display=swap',
];

// ── Install ───────────────────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // App shell — must succeed (install aborts if any fail)
      await cache.addAll(APP_SHELL);

      // CDN bundles — best-effort (never block install)
      const results = await Promise.allSettled(
        CDN_URLS.map(url =>
          fetch(url, { mode: 'cors' }).then(res => {
            if (res.ok) return cache.put(url, res);
          })
        )
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) console.warn('[SW] CDN precache: ' + failed + ' url(s) failed (non-fatal)');
    })()
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const KEEP = [CACHE_NAME, IMG_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (KEEP.includes(k) ? null : caches.delete(k))))
    )
  );
  self.clients.claim();

  // Tell all open tabs that a new version just activated
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
  });
});

// ── Fetch ────────────────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, non-http, and Firebase realtime/Firestore streaming
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;
  if (
    url.hostname.includes('firebaseio.com') ||
    (url.hostname.includes('googleapis.com') && url.pathname.startsWith('/google.firestore'))
  ) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isAppShell   = isSameOrigin && (
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js')   ||
    url.pathname.endsWith('.css')  ||
    url.pathname === '/' ||
    url.pathname === ''
  );
  const isImageOrFont =
    /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|eot|ico)(\?.*)?$/.test(url.pathname) ||
    url.hostname === 'fonts.gstatic.com';

  if (isImageOrFont) {
    event.respondWith(staleWhileRevalidate(request, IMG_CACHE));
  } else {
    // App shell + CDNs + everything else: network-first
    event.respondWith(networkFirst(request, CACHE_NAME));
  }
});

// ── Strategy helpers ─────────────────────────────────────────────────────────────────────

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, res.clone());
    }
    return res;
  } catch (_) {
    return (await caches.match(request)) || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchAndUpdate = fetch(request).then(res => {
    if (res && res.status === 200) cache.put(request, res.clone());
    return res;
  }).catch(() => null);

  return cached || (await fetchAndUpdate) || Response.error();
}
