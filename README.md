# NHS Address Finder

> **Live:** https://nhs-address-finder.vercel.app/

A free, partner-facing address lookup tool for New Home Solutions (NHS). Type a UK postcode, pick the property, and see it on an Ordnance Survey map alongside EPC, broadband and mobile coverage data — and download a branded PDF report.

Built for NHS estate-agent, photographer and housebuilder partners.

---

## Architecture

A **Vercel-native** single-file app:

```
NHS-Address-Finder/
├── index.html              # The address finder app (static)
├── vercel.json             # Vercel deploy config (caching + security headers)
├── api/                    # Vercel Edge Functions (server-side proxies, keys live here)
│   ├── os/
│   │   ├── places.js       # OS Places postcode search
│   │   └── tile.js         # OS Maps raster tile proxy
│   ├── ofcom/
│   │   └── coverage.js     # Ofcom Connected Nations Broadband + Mobile
│   └── epc/
│       └── lookup.js       # MHCLG EPC Register (search + cert detail)
├── workers/                # ⚠️ Legacy Cloudflare Workers (superseded by /api/)
├── scripts/
│   └── generate_technical_document_pdf.py
├── TECHNICAL_DOCUMENT.md / .pdf
└── README.md
```

The frontend only ever talks to **same-origin** `/api/*` paths. Every upstream API key (OS Data Hub, Ofcom, MHCLG) lives in **Vercel Environment Variables** and never reaches the browser.

---

## Data sources

| Layer | Upstream | Proxy endpoint | Env var |
|---|---|---|---|
| Address lookup | Ordnance Survey **OS Places** | `GET /api/os/places?postcode=…` | `OS_KEY` |
| Map tiles | Ordnance Survey **OS Maps** raster | `GET /api/os/tile?style=Road&z={z}&x={x}&y={y}` | `OS_KEY` (same) |
| Street view | Google Maps embed | iframe, no proxy | — |
| EPC certificate | MHCLG **EPC Register** | `GET /api/epc/lookup?postcode=…` or `?cert=RRN` | `EPC_TOKEN` |
| Broadband coverage | Ofcom **Connected Nations Broadband** | `GET /api/ofcom/coverage?postcode=…&product=broadband` | `OFCOM_BROADBAND_KEY` |
| Mobile coverage | Ofcom **Connected Nations Mobile** | `GET /api/ofcom/coverage?postcode=…&product=mobile` | `OFCOM_MOBILE_KEY` |

---

## Deployment

The repo is wired to Vercel — every push to `main` auto-deploys.

### Required environment variables

Set these once in **Vercel dashboard → Project → Settings → Environment Variables** (Production + Preview + Development):

| Name | Value source |
|---|---|
| `OS_KEY` | OS Data Hub → API Projects → NHS-SF → Project API Key |
| `OFCOM_BROADBAND_KEY` | Ofcom Developer Portal → Subscriptions → Broadband Coverage |
| `OFCOM_MOBILE_KEY` | Ofcom Developer Portal → Subscriptions → Mobile Coverage |
| `EPC_TOKEN` | MHCLG EPC Register → API access token |

> Each Edge Function falls back to the inlined POC key if the env var isn't set, so the app keeps working immediately after first deploy. Set the env vars to rotate to production keys without code changes.

### Deploy commands

```bash
# Auto-deploy (already wired): just push to main
git push

# Or manual one-off:
npx vercel --prod
```

---

## Running the app

### Live (production)

https://nhs-address-finder.vercel.app/

### Local development

Use **Vercel CLI** so the `/api/*` Edge Functions actually run locally:

```bash
npx vercel dev
# then visit http://localhost:3000/
```

Plain `python3 -m http.server` won't work for local dev anymore — without the Vercel runtime, the `/api/*` endpoints return 404.

No build step. No bundler. No npm install.

---

## Features

- **Postcode lookup** — OS Places API via `/api/os/places`, returns full AddressBase results with UPRN, lat/lng, classification
- **List + card views** — switchable, with copy-to-clipboard for UPRNs and coords
- **Detail page** per property with:
  - OS Maps tile (Road / Outdoor / Light) in a Leaflet lightbox
  - Google Street View 360° pano in a lightbox
  - EPC band + full certificate (A–G ladder + cert details)
  - Broadband coverage gauge + tier breakdown (Standard / Superfast / Ultrafast)
  - Mobile coverage cards for EE / Three / O2 / Vodafone (indoor + outdoor, voice + data)
  - Quick links to Rightmove / Zoopla / OnTheMarket for the postcode
- **Generate Report** — produces a branded NHS PDF (4 pages, A4) using the data on the property detail page

---

## PDF report

Click **Generate Report** on any property detail page to download an NHS-branded PDF. The report follows the [NHS brand guidelines](https://github.com/deepakcrmmates/nhs-training-app/blob/main/docs/branding/NHS_Email_Template_Guidelines.md) — sage palette, Futura wordmark, table-based layout.

Page structure:

1. Property identity + location map
2. EPC certificate (ladder + cert details)
3. Broadband coverage (gauge + tier table)
4. Mobile coverage (4 operator cards)

Each page is rendered to its own canvas via `html2canvas` and placed 1:1 into a `jsPDF` A4 page — avoids the slicing / pagebreak heuristic bugs you get with `html2pdf.js`.

---

## Branding

Sage palette (per NHS guidelines):

| Token | Hex | Use |
|---|---|---|
| Sage Dark | `#4A6B5E` | Section headings, table headers, accent stripe |
| Sage | `#6B9080` | Secondary text |
| Sage Background | `#C9D5CB` | Header bar background |
| Sage Tint | `#EAF4EF` | Label cells, section labels, footer |
| Border | `#C5DCCC` | Table borders |
| Navy | `#0D1E4A` | Data values |
| Muted | `#6B7280` | Footer, captions |

Typography: **Aptos** (body) with Segoe UI / Helvetica Neue fallbacks; **Futura LT Light** (logo only — Century Gothic fallback).

---

## Status

- ✅ Live on Vercel — https://nhs-address-finder.vercel.app/
- ✅ All upstream APIs proxied through Vercel Edge Functions
- ✅ Keys held in Vercel env vars (never reach the browser)
- ✅ Ofcom subscriptions active (Connected Nations Broadband + Mobile, Basic tier)
- ✅ MHCLG EPC API key live
- ⚠️ Legacy Cloudflare Workers (`workers/`) still deployed but unused — safe to delete from Cloudflare dashboard when ready

---

*New Home Solutions Ltd · Part Exchange & Assisted Move Specialists*
