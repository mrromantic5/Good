/// <reference lib="webworker" />
/* CineFliX service worker — app-shell caching for instant repeat visits.
   • Hashed bundles (cf/dist/*-HASH.js|css): cache-first, immutable.
   • HTML pages: network-first, cached copy when offline.
   • Fonts and posters: stale-while-revalidate.
   • API, video, ChatXAP backend: never cached here (always live). */
export {};
declare const self: ServiceWorkerGlobalScope;
const VERSION = '__CF_VERSION__';
const SHELL = 'cf-shell-' + VERSION;
const RUNTIME = 'cf-rt-v1';
const PRECACHE: string[] = (self as unknown as { __CF_PRECACHE__: string[] }).__CF_PRECACHE__ || [];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('cf-shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isImage = (u: URL) => /\.(jpe?g|png|webp|avif|gif)$/i.test(u.pathname) || /aoneroom\.com$/.test(u.hostname);
const isFont = (u: URL) => /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (/omegatech|espn\.com|workers\.dev|t-lyfe\.com\.ng\/(api|backend)\//.test(url.href) || url.pathname.includes('/cf/api/')) return;

  if (url.origin === location.origin && url.pathname.includes('/cf/dist/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error())));
    return;
  }
  if (isFont(url) || isImage(url)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit as Response);
      return hit || net;
    }));
  }
});
