# Rhoads Show Inventory

A small, offline-first, client-side web app for scanning/entering inventory at a show,
selling it down, logging daily sales, and exporting/importing data between devices.
No backend, no database server — everything lives in the browser's IndexedDB on
whatever device you're using, and the export/import file is how data moves between
devices or into your main system later.

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
  overwriting it. Category, condition, and notes are optional — leave them blank if
  you don't need them.
- **Cost tracking** — an optional "your cost" field per item. It's never shown on the
  sell screen (so it stays out of view at the counter); it only surfaces as a lifetime
  profit figure in the Data tab, and as a per-unit snapshot on each sale so profit stays
  accurate even if you later change an item's cost.
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
     "cost": 6.00, "category": "Comics", "condition": "Near Mint", "notes": "1st printing"}
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
`notes` on inventory items). These are all extra fields, not a structural change —
ignorable by anything else that reads this file, and it should generalize fine to a
future "design your own database" import.

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
- The service worker actually installing, actually taking over the page, and the app
  shell actually still loading with the network fully cut off, with add/sell still
  working offline
- The scanner's failure path: with no internet available to fetch it, the ZXing
  library genuinely fails to load in this environment, and the app correctly shows an
  error and leaves manual entry available rather than breaking

**NOT tested, because it requires real internet + a real camera + a real barcode,
none of which this build environment had:**
- Actually loading the ZXing library from its CDN
- Actually decoding a real barcode with a real phone camera

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
