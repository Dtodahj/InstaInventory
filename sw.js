/*
 * sw.js — caches the app shell on first visit so the app keeps working
 * with no internet afterwards. Data itself (inventory/sales) is never
 * touched here — that's all IndexedDB, which needs no network at all.
 *
 * Two caches:
 *  - APP_CACHE: the app shell (HTML/CSS/JS/icons/manifest), precached on
 *    install. Each file is cached individually with its own catch so one
 *    missing file can't fail the whole install.
 *  - RUNTIME_CACHE: anything fetched at runtime that isn't part of the
 *    shell — in practice, the ZXing script pulled from a CDN the first
 *    time the scanner is opened. Cache-first, so once it's been fetched
 *    successfully once, it works offline from then on.
 */
'use strict';

const CACHE_VERSION = 'v6';
const APP_CACHE = 'rsi-app-' + CACHE_VERSION;
const RUNTIME_CACHE = 'rsi-runtime-' + CACHE_VERSION;

// Cross-origin hosts we actually want to cache-wrap (the ZXing scanner
// library CDN, so scanning still works offline after first load). Any
// other cross-origin request — notably the UPC lookup calls to
// api.upcitemdb.com, which are one-off/per-barcode and never worth
// caching — is deliberately left alone (see the fetch handler below) so
// the browser handles it natively and any failure (including a genuine
// CORS rejection) surfaces to the calling code with its real error
// message intact, instead of being masked as a synthetic 504 here.
const RUNTIME_CACHE_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com'];

const APP_SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/db.js',
  'js/scanner.js',
  'js/upc-lookup.js',
  'js/export-import.js',
  'js/app.js',
  'manifest.json',
  'icons/logo.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(APP_CACHE).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('[sw] could not precache', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== APP_CACHE && key !== RUNTIME_CACHE) {
          return caches.delete(key);
        }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCacheableCrossOrigin = !isSameOrigin && RUNTIME_CACHE_HOSTS.indexOf(url.hostname) !== -1;

  if (isSameOrigin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        const networkFetch = fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(APP_CACHE).then(function (cache) { cache.put(req, res.clone()); });
          }
          return res;
        }).catch(function () { return cached; });
        // Cache-first for speed at a show; falls back to network if missing,
        // and refreshes the cache in the background either way.
        return cached || networkFetch;
      })
    );
  } else if (isCacheableCrossOrigin) {
    // Cross-origin (the ZXing CDN script): cache-first, populate on first
    // successful fetch, so scanning keeps working with no connection later.
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(RUNTIME_CACHE).then(function (cache) { cache.put(req, res.clone()); });
          }
          return res;
        }).catch(function () {
          return new Response('', { status: 504, statusText: 'Offline and not cached yet' });
        });
      })
    );
  }
  // Any other cross-origin request (e.g. the UPC lookup API) is left
  // completely alone — no event.respondWith() — so it goes straight to
  // the network exactly as if there were no service worker at all, and
  // the calling code sees the real success/failure.
});
