// ── NOTEPAD_SERVICE_WORKER.JS ────────────────────────────────────────────────
// Keeps the whole app on the phone so it opens with no internet.
// Change CACHE_NAME (v4 -> v5 ...) whenever you upload new files so phones pick them up.

const CACHE_NAME = 'notepad-v5';

// Every file the app needs, all stored the first time the app is opened online.
const ASSETS = [
  './',
  'index.html',
  'notepad_stylesheet.css',
  'notepad_sync.js',
  'notepad_fonts.js',
  'notepad_engine.js',
  'notepad_photos.js',
  'notepad_menu.js',
  'notepad_manifest.json',
  'icon-192.png',
  'icon-512.png',
  // Libraries loaded from the internet: kept too, so the app starts without it.
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js',
  'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@200..900&family=Playfair+Display:wght@400;600&family=Space+Mono&display=swap'
];

self.addEventListener('install', (e) => {
  // One missing file must never stop the rest from being stored.
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) =>
        fetch(url, { cache: 'reload', mode: url.startsWith('http') ? 'no-cors' : 'same-origin' })
          .then((res) => cache.put(url, res))
          .catch(() => {})
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Stored copy first (instant, works offline); a fresh copy is fetched in the background
// and used the next time the app opens.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Only the app's own files, the Firebase libraries and the fonts are kept. Sign-in and the
  // database talk straight to Google, untouched.
  const own = url.origin === self.location.origin;
  const library = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!own && !library && !fonts) return;

  e.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(e.request, { ignoreSearch: url.origin === self.location.origin }).then((cached) => {
        const fresh = fetch(e.request).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    )
  );
});
