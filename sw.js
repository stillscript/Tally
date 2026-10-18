// Offline support: the app shell and libraries are cached; food lookups always go to the network.
// The version comes from version.js: bump it there whenever files change so phones pick up the update.
importScripts('./version.js');
const VERSION = 'tally-' + self.TALLY_VERSION;
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './version.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './js/app.js', './js/preact.js', './js/util.js', './js/db.js', './js/store.js', './js/barcode.js',
  './js/sources.js', './js/search.js', './js/goals.js', './js/insights.js', './js/scanner.js', './js/ai.js', './js/summary.js',
  './js/data/common-foods.js', './js/data/brand-drinks.js',
  './js/ui/icons.js', './js/ui/nav.js', './js/ui/common.js', './js/ui/host.js', './js/ui/today.js',
  './js/ui/food.js', './js/ui/scanner-sheet.js', './js/ui/add.js', './js/ui/quickadd.js', './js/ui/label.js',
  './js/ui/weight.js', './js/ui/checkin.js', './js/ui/progress.js', './js/ui/charts.js', './js/ui/settings.js',
  './js/ui/onboarding.js', './js/ui/profile-form.js', './js/ui/explain.js', './js/ui/meals.js', './js/ui/ai.js',
  './js/ui/voice.js', './js/ui/whatsnew.js', './js/ui/celebrate.js', './js/parse.js', './js/changelog.js',
  './js/week.js', './js/ui/week.js', './js/ui/install.js',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net'];
const CDN_PRELOAD = [
  'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js',
  'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/iife/ponyfill.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // Bypass the browser's HTTP cache so a new version never mixes in stale files.
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(CDN_PRELOAD.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Serve instantly from cache, refresh in the background.
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(r => {
        if (r.ok) c.put(req, r.clone());
        return r;
      }).catch(() => hit || (req.mode === 'navigate' ? c.match('./index.html') : Response.error()));
      return hit || net;
    })());
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    // Versioned library files never change: cache-first.
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    })());
  }
  // USDA / Open Food Facts requests fall through to the network untouched.
});
