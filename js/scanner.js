/*
 * scanner.js — camera barcode scanning, backed by the ZXing library.
 *
 * IMPORTANT / HONESTY NOTE (read this before assuming scanning "just works"):
 * ZXing is NOT bundled with this app. It is lazy-loaded from a public CDN
 * (jsDelivr, falling back to unpkg) the first time the user opens the
 * scanner, and cached by the service worker after that so it keeps working
 * offline afterwards. This file was written and code-reviewed against the
 * documented @zxing/library API from training knowledge, but the sandbox
 * this app was built in has no outbound internet access, so the actual
 * network fetch of ZXing and a real end-to-end scan of a physical barcode
 * could NOT be executed or verified here. Everything else (inventory,
 * sales, export/import, offline shell) was tested headlessly — see the
 * README. Please do one real test scan on your phone before relying on
 * this at a show; if it doesn't work, manual entry is always available as
 * a fallback and the console will log which code path was taken.
 *
 * Two code paths are attempted, in order, feature-detected at runtime:
 *   1. codeReader.decodeFromConstraints(constraints, videoEl, callback)
 *      — lets us request a constrained resolution directly (per the
 *      performance requirement: never let the camera stream default to
 *      3000px+ wide).
 *   2. codeReader.decodeFromVideoDevice(deviceId, videoEl, callback)
 *      — older/more universally-documented API, used if (1) isn't present
 *      on whatever ZXing build the CDN serves. Resolution isn't directly
 *      controllable here, but ZXing internally downsamples for decoding,
 *      so it still works, just without our explicit constraint.
 */
(function (global) {
  'use strict';

  const ZXING_URLS = [
    'https://cdn.jsdelivr.net/npm/@zxing/library/umd/index.min.js',
    'https://unpkg.com/@zxing/library/umd/index.min.js'
  ];

  let zxingLoadPromise = null;
  let codeReader = null;
  let activeVideoEl = null;
  let activeStream = null;
  let usingOwnStream = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureZXing() {
    if (global.ZXing) return Promise.resolve(global.ZXing);
    if (zxingLoadPromise) return zxingLoadPromise;
    zxingLoadPromise = ZXING_URLS.reduce(function (chain, url) {
      return chain.catch(function () { return loadScript(url); });
    }, Promise.reject(new Error('start'))).then(function () {
      if (!global.ZXing) throw new Error('ZXing loaded but window.ZXing is missing');
      return global.ZXing;
    });
    return zxingLoadPromise;
  }

  // Starts scanning into `videoEl`. Calls onResult(text) once per successful
  // decode (caller is responsible for debouncing/stopping after a hit).
  // Calls onError(err) if the camera/library could not be started at all.
  // Returns a promise that resolves once scanning has actually started.
  function start(videoEl, onResult, onError) {
    return ensureZXing().then(function (ZXing) {
      activeVideoEl = videoEl;
      codeReader = new ZXing.BrowserMultiFormatReader();

      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      if (typeof codeReader.decodeFromConstraints === 'function') {
        console.info('[scanner] using decodeFromConstraints (constrained resolution)');
        usingOwnStream = false;
        return codeReader.decodeFromConstraints(constraints, videoEl, function (result, err) {
          if (result) onResult(result.getText());
          // NotFoundException fires continuously while no code is in frame — expected, ignore.
        });
      }

      console.info('[scanner] decodeFromConstraints unavailable, falling back to decodeFromVideoDevice');
      return codeReader.listVideoInputDevices().then(function (devices) {
        if (!devices || !devices.length) throw new Error('No camera devices found');
        let device = devices.find(function (d) { return /back|rear|environment/i.test(d.label); });
        if (!device) device = devices[devices.length - 1];
        return codeReader.decodeFromVideoDevice(device.deviceId, videoEl, function (result, err) {
          if (result) onResult(result.getText());
        });
      });
    }).catch(function (err) {
      console.error('[scanner] failed to start', err);
      if (onError) onError(err);
      throw err;
    });
  }

  function stop() {
    try {
      if (codeReader) {
        // reset() stops the video stream and decode loop, safe to call
        // even if nothing is running.
        codeReader.reset();
      }
    } catch (e) {
      console.warn('[scanner] error during stop()', e);
    }
    if (usingOwnStream && activeStream) {
      activeStream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (activeVideoEl) {
      activeVideoEl.srcObject = null;
    }
    activeStream = null;
    activeVideoEl = null;
  }

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  global.Scanner = {
    start: start,
    stop: stop,
    isSupported: isSupported
  };
})(window);
