/*
 * upc-lookup.js — optional, best-effort product lookup against the free
 * UPCitemdb trial API (https://www.upcitemdb.com/api/), used only to
 * pre-fill the description when adding a genuinely new item.
 *
 * IMPORTANT / HONESTY NOTE: this app is 100% client-side/static (no
 * backend), so this calls UPCitemdb's trial endpoint directly from the
 * browser. UPCitemdb's own docs only show server-side examples (curl,
 * Python, PHP, Node, etc.) — no JavaScript/browser example, no mention of
 * CORS either way — and the sandbox this was built in has no network route
 * to api.upcitemdb.com at all, so whether the browser actually allows this
 * cross-origin request could NOT be verified here. That's fine by design:
 * `lookup()` below never throws and never blocks the form — a CORS
 * rejection, a network failure, hitting the free tier's rate limit
 * (100 lookups/day, 6/minute, no signup), or a barcode that's just not in
 * their database all resolve to `null` the same way, and the add-item form
 * behaves exactly like it always has: an empty description you fill in by
 * hand. Please try it once on the real deployed site to see whether it
 * actually finds anything — the console logs `[upc-lookup]` either way.
 *
 * Deliberately never touches price/cost/category — only ever suggests a
 * description, which the "double-check before saving" toast in app.js
 * exists specifically to remind you to verify.
 */
(function (global) {
  'use strict';

  const ENDPOINT = 'https://api.upcitemdb.com/prod/trial/lookup?upc=';
  const TIMEOUT_MS = 6000;

  // Always resolves (never rejects) — { title, brand } on a real hit,
  // otherwise null. Callers don't need their own try/catch.
  function lookup(barcode) {
    if (!barcode) return Promise.resolve(null);

    const hasAbort = typeof AbortController !== 'undefined';
    const controller = hasAbort ? new AbortController() : null;
    const timer = hasAbort ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    return fetch(ENDPOINT + encodeURIComponent(barcode), {
      method: 'GET',
      signal: hasAbort ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        console.info('[upc-lookup] HTTP ' + res.status + ' for ' + barcode + ' — treating as no match.');
        return null;
      }
      return res.json();
    }).then(function (data) {
      if (!data || data.code !== 'OK' || !data.items || !data.items.length) {
        console.info('[upc-lookup] no match for ' + barcode);
        return null;
      }
      const item = data.items[0];
      console.info('[upc-lookup] match for ' + barcode + ':', item.title);
      return { title: item.title || '', brand: item.brand || '' };
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      // Network failure, CORS rejection, timeout/abort, rate limit — all
      // land here. This is the expected/normal path if CORS isn't allowed.
      console.info('[upc-lookup] lookup failed for ' + barcode + ' (network/CORS/rate-limit) — falling back to manual entry.', err && err.message);
      return null;
    });
  }

  global.UPCLookup = { lookup: lookup };
})(window);
