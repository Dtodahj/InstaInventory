# Rhoads Show Inventory

A small, offline-first, client-side web app for scanning/entering inventory at a show,
selling it down, logging daily sales, and exporting/importing data between devices.
No backend, no database server — everything lives in the browser's IndexedDB on
whatever device you're using, and the export/import file is how data moves between
devices or into your main system later.

Currently branded and deployed for **Burning Halo** (comics · cards · collectibles) —
see "Rebranding" below if you ever reuse this for a different shop or event.

## Rebranding

The app itself is generic; only a handful of spots carry the current shop's branding,
all called out with a comment block at the top of `index.html`. To rebrand:

1. Replace `icons/logo.png` with a new square logo — ideally 512×512 or larger, with a
   solid/opaque background (it's used as-is, with no transparency handling).
2. Regenerate the three PWA icon files from it: `icons/icon-192.png`,
   `icons/icon-512.png` (plain resizes of the new logo), and
   `icons/icon-maskable-512.png` (the same logo, but scaled down to roughly 72% and
   centered on a same-color square canvas — Android's adaptive-icon mask can crop
   right up to the edge of a maskable icon, so its actual artwork needs that safe-zone
   padding, unlike the other two). Any image editor works, or a free online PWA icon
   generator.
3. Update `<title>`, the `apple-mobile-web-app-title` meta tag, and the topbar's
   `<img>`/shop-name text in `index.html` (each marked `BRAND:` or inside the
   `BRANDING` comment block right under `<head>`).
4. Update `name`/`short_name`/`description` in `manifest.json` to match.
5. Bump `CACHE_VERSION` in `sw.js` (any app-shell file change needs this — see the
   Technical Documentation for why) and deploy as usual.

No build step and nothing dynamic — it's a handful of static files to swap/edit, all
listed above.

## Deploying it (required before it's usable on a phone)

This has to be served over **real HTTPS** — camera access does not work over a plain
LAN IP address (like `192.168.1.50`), only over `https://` or `localhost`, no
exceptions, in any browser. The good news is any of these free static hosts gets you
real HTTPS with zero configuration:

**GitHub Pages (simplest if you already use GitHub):**
1. Create a new repo and push the contents of this folder to it (the files, not this
   folder itself — `index.html` should be at the repo root, or in `/docs`).
2. Repo Settings → Pages → set the source to the branch/folder you pushed to.
3. GitHub gives you a `https://<you>.github.io/<repo>/` URL a minute or two later.
   Open that on your phone and on your computer — that's the app.

**Netlify / Vercel / Cloudflare Pages (all equivalent, drag-and-drop friendly):**
- Netlify: drag this folder onto the "Deploy manually" area at app.netlify.com/drop.
- Vercel: `vercel deploy` from inside this folder (or drag-and-drop in their dashboard).
- Cloudflare Pages: connect a repo or use `wrangler pages deploy .`.

Whichever you pick, once it's live, open the same URL on your phone and your
computer. There's no connection between them — they're two independent copies of the
app — the export/import file is how data moves between them.

### Installing it like an app

Once it's open in Safari (iPhone) or Chrome (Android), use "Add to Home Screen" — the
manifest.json here makes it install like a real app icon, launching full-screen
without browser chrome.

## What's implemented

- **Add an item** — scan a barcode with the camera, or enter it manually: barcode,
  description, category, condition, quantity, price, your cost, and notes. Scanning
  (or typing) a barcode that already exists adds to its current quantity rather than
  overwriting it. Category is a fixed dropdown (Toys, Comics, Cards, Other) so it
  stays consistent across your inventory; condition and notes are free-form and
  optional — leave them blank if you don't need them. The inventory search box
  matches against category too, so typing "comics" finds everything tagged that way.
- **Cost tracking** — an optional "your cost" field per item. It's never shown on the
  sell screen (so it stays out of view at the counter); it only surfaces as a lifetime
  profit figure in the Data tab, and as a per-unit snapshot on each sale so profit stays
  accurate even if you later change an item's cost.
- **Photo (detail view only)** — attach a photo to an item from the add/edit screen
  (camera or existing photo, whichever your browser offers). It's resized and
  compressed client-side before it's stored, so it stays reasonably small in IndexedDB
  and in JSON exports. It's intentionally kept out of the compact inventory list, the
  sell sheet, and CSV exports — it only shows up when you open an item's own detail
  screen — so scanning through the list at a show stays fast.
- **UPC auto-fill (optional, best-effort)** — when you add a genuinely new barcode
  (scan it, or type it and tab out of the field), the app tries a free lookup against
  [UPCitemdb](https://www.upcitemdb.com/api/)'s public trial API and pre-fills the
  description if it finds a match — always with a toast reminding you to double-check
  it before saving. It never touches price/cost/category. This never runs for a
  barcode already in your inventory (your own data always wins), and if the lookup
  fails for any reason — not found, the free tier's rate limit (100/day, 6/minute, no
  signup), or the browser blocking the request — it fails completely silently and the
  form behaves exactly like manual entry always has. See the honesty note in
  `js/upc-lookup.js` for what is and isn't verified about this.
- **Sell an item** — scan, or tap it in the list, then set quantity and sale price
  (defaults to the item's listed price, editable per sale). Selling the last unit
  removes it from the on-hand list; the sale itself stays in history forever.
- **Daily sales log** — grouped by day, most recent first, each day collapsible with a
  running total; today's group is expanded by default.
- **Export** — a single JSON file with your full inventory + sales history, plus
  separate inventory/sales CSV files for a quick look in Excel/Sheets.
- **Import** — loads a previously exported JSON file and merges it in by barcode. New
  items are added outright. If a barcode already exists locally with *different*
  values, you're shown a conflict card per item and asked to choose: merge quantities
  together (the default), take the imported values, or keep what's local. Sales are
  deduplicated automatically (by an internal id) so re-importing the same file twice
  never double-counts a sale.
- **Works offline after first load** — a service worker caches the app shell (HTML/CSS/JS/icons)
  on first visit. All actual data (inventory, sales) is IndexedDB, which was never
  network-dependent in the first place.

## Data / export format

```json
{
  "exported_at": "2026-09-08T14:30:00Z",
  "inventory": [
    {"barcode": "036000291452", "description": "...", "quantity": 3, "price": 12.00,
     "cost": 6.00, "category": "Comics", "condition": "Near Mint", "notes": "1st printing",
     "photo": "data:image/jpeg;base64,..."}
  ],
  "sales": [
    {"id": "…uuid…", "barcode": "036000291452", "description": "...", "quantity": 1,
     "sale_price": 12.00, "cost": 6.00, "sold_at": "2026-09-08T14:22:00Z"}
  ]
}
```

This matches the shape you sketched, with a few additions on top: each sale carries an
`id` (a UUID) so re-importing the same export twice is safe and never creates duplicate
sales, and both inventory items and sales carry `cost` (plus `category`/`condition`/
`notes`/`photo` on inventory items). These are all extra fields, not a structural
change — ignorable by anything else that reads this file, and it should generalize
fine to a future "design your own database" import. `photo`, when present, is a
`data:image/jpeg;base64,...` string, already resized/compressed — no separate image
files to keep track of.

## Honesty about what has and hasn't actually been tested

This was built and tested in a sandboxed environment with **no outbound internet
access at all** (not even to package registries or CDNs). That materially limited
what I could verify myself, so here's the real breakdown:

**Actually tested, headlessly, end-to-end, and passing:**
- Adding items (manual entry), persistence across reloads (IndexedDB)
- Selling partially and selling to zero (item drops off on-hand list, sale stays in
  history)
- The oversell guard (can't sell more than on-hand)
- The daily sales log and its running totals
- Scroll position genuinely not resetting when a sheet opens/closes
- All text inputs computed at ≥16px, main tap targets ≥44px
- JSON export producing the documented shape; CSV export
- Import merge logic across three scenarios: brand-new items, exact duplicates
  (skipped sales), and a real quantity/price conflict resolved through the conflict UI
- The category dropdown (Toys/Comics/Cards/Other), searching inventory by category,
  and the cost/condition/notes fields round-tripping through add, edit, sell, and CSV
  export without ever surfacing cost on the list or sell screen
- Attaching a photo in the add/edit screen, the client-side resize/compress step
  producing a real JPEG data URI, the photo staying out of the compact list row, the
  sell sheet, and the CSV export, round-tripping through edit, and coming back out in
  the JSON export
- The service worker actually installing, actually taking over the page, and the app
  shell actually still loading with the network fully cut off, with add/sell still
  working offline
- The scanner's failure path: with no internet available to fetch it, the ZXing
  library genuinely fails to load in this environment, and the app correctly shows an
  error and leaves manual entry available rather than breaking
- The UPC auto-fill's failure path: a lookup attempt is genuinely made and genuinely
  fails (no route out of this sandbox to api.upcitemdb.com at all), and the app
  correctly falls back to a normal empty, manually-fillable form rather than breaking
  — plus that it's never even attempted for a barcode already in your local inventory

**NOT tested, because it requires real internet + a real camera + a real barcode,
none of which this build environment had:**
- Actually loading the ZXing library from its CDN
- Actually decoding a real barcode with a real phone camera
- Whether the UPC auto-fill actually finds a real product and fills it in — I
  genuinely don't know whether UPCitemdb allows this cross-origin browser call
  (their docs only show server-side examples), so this could work perfectly or could
  silently never find anything on the live site. Either way it's designed to never
  break the form; try adding a real, known toy barcode once and see what happens.

The scanner code (`js/scanner.js`) is written against the documented `@zxing/library`
API from training knowledge — `decodeFromConstraints` for resolution control, falling
back to `decodeFromVideoDevice` if that method isn't present on whatever build the CDN
serves — but I could not execute either path against the real library here, so I can't
promise the exact method names are still current. If scanning doesn't work the first
time you try it on your phone: open the browser console (Safari: connect the phone to
a Mac and use Web Inspector; Android Chrome: `chrome://inspect` from a computer) and
look for `[scanner]` log lines — they say which code path was used and why it stopped.
Manual entry works regardless and doesn't depend on any of this.

**Please do one real test scan before relying on this at a show.**
