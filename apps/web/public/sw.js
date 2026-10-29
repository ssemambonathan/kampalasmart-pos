/* KampalaSmart offline shell. Financial data is never cached here; the POS
   reads its catalogue and outbox from IndexedDB, and API responses are only
   used for live server state. */
const VERSION = 'ks-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const PAGE_CACHE = `${VERSION}-pages`;
const SHELL_URLS = ['/', '/pos', '/dashboard', '/offline', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await caches.match('/pos');
    if (shell) return shell;
    return caches.match('/offline');
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated API responses. The app uses IndexedDB for
  // offline data and shows a clear offline state instead of stale numbers.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'OFFLINE',
                message: 'This device is offline. Server actions will retry when the connection returns.',
              },
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || /\.(css|js|svg|png|jpg|jpeg|woff2?|webp)$/.test(url.pathname)) {
    event.respondWith(cacheFirstAsset(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
