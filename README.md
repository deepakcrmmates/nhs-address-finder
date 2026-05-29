# NHS Address Finder

> **Live:** https://nhs-address-finder.vercel.app/

A free, partner-facing address lookup tool for New Home Solutions (NHS). Type a UK postcode, pick the property, and see it on an Ordnance Survey map alongside EPC, broadband and mobile coverage data — and download a branded PDF report.

Built for NHS estate-agent, photographer and housebuilder partners.

---

## What's in the box

```
NHS-Address-Finder/
├── index.html                  # The address finder app
├── vercel.json                 # Vercel deploy config (caching + security headers)
├── workers/
│   ├── ofcom-coverage/         # Cloudflare Worker — Ofcom broadband + mobile coverage
│   └── epc-lookup/             # Cloudflare Worker — MHCLG EPC certificates
├── scripts/
│   └── generate_technical_document_pdf.py   # reportlab + Chrome + pypdf
├── TECHNICAL_DOCUMENT.md / .pdf
└── README.md
```

The app is a single static HTML file. It calls two Cloudflare Workers for upstream data (so the API keys stay server-side and CORS is handled cleanly).

---

## Data sources

| Layer | Source | Auth | Where it's called from |
|---|---|---|---|
| Address lookup | Ordnance Survey **OS Places API** | Inline key (`OS_KEY` in `index.html`) | Browser → OS directly |
| Map tiles | Ordnance Survey **OS Maps API** | Same `OS_KEY` | Leaflet → OS directly |
| EPC certificate | MHCLG **Energy Performance of Buildings** API | Bearer token, server-side | Browser → `workers/epc-lookup` → MHCLG |
| Broadband coverage | Ofcom **Connected Nations Broadband** API | `Ocp-Apim-Subscription-Key`, server-side | Browser → `workers/ofcom-coverage` → Ofcom |
| Mobile coverage | Ofcom **Connected Nations Mobile** API | `Ocp-Apim-Subscription-Key`, server-side | Browser → `workers/ofcom-coverage` → Ofcom |
| Street view | Google **Maps Embed** (no key in v1) | None | Browser → Google directly |

---

## Running the app

### Live (production)

https://nhs-address-finder.vercel.app/

### Local development

```bash
# Serve from localhost so the Workers' CORS allow-list permits the request
python3 -m http.server 8080
# then visit http://localhost:8080/
```

> The Workers' CORS allow-list accepts `https://nhs-address-finder.vercel.app` and any `localhost` / `127.0.0.1` origin. Opening `index.html` directly via `file://` will be **blocked** by the browser — use the local server instead.

No build step. No bundler. No npm install.

### Deploying to Vercel

Vercel auto-detects this as a static site. Either:

```bash
npx vercel --prod
```

…or wire up the GitHub repo at [vercel.com/new](https://vercel.com/new) so each push to `main` triggers a deploy. `vercel.json` is already set up with caching + security headers.

---

## Deploying the Workers

Both workers use **Cloudflare Workers** via [`wrangler`](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

### Ofcom Coverage Worker

Endpoint after deploy: `https://nhs-ofcom-coverage.<your-subdomain>.workers.dev/?postcode=UB2+4WQ&product=both`

```bash
cd workers/ofcom-coverage
npm install                              # one-off, pulls wrangler
npx wrangler login                       # one-off, browser auth
# Optional — rotate the POC keys out into env secrets:
npx wrangler secret put OFCOM_BROADBAND_KEY
npx wrangler secret put OFCOM_MOBILE_KEY
npx wrangler deploy
```

The current source has POC keys inlined as `POC_BROADBAND_KEY` / `POC_MOBILE_KEY` constants — fine for sandbox, but for production set the `env.OFCOM_*` secrets above and delete the constants.

### EPC Lookup Worker

Endpoint after deploy: `https://nhs-epc-lookup.<your-subdomain>.workers.dev/?postcode=UB2+4WQ` (and `?cert=<RRN>` for full certificate detail).

```bash
cd workers/epc-lookup
npm install
npx wrangler login
npx wrangler secret put EPC_TOKEN        # one-off — MHCLG bearer
npx wrangler deploy
```

### After deploying

If your Workers end up on a subdomain other than the one currently hardcoded in `index.html`, update these two constants near the top of the `<script>` block:

```js
const EPC_LOOKUP_URL     = 'https://nhs-epc-lookup.systemtest-827.workers.dev';
const OFCOM_COVERAGE_URL = 'https://nhs-ofcom-coverage.systemtest-827.workers.dev';
```

---

## Features

- **Postcode lookup** — uses OS Places API, returns full AddressBase results with UPRN, lat/lng and classification
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

- ✅ Live in sandbox testing
- ✅ Both Cloudflare Workers deployed
- ✅ Ofcom subscriptions active (Connected Nations Broadband + Mobile, Basic tier)
- ✅ MHCLG EPC API key live

---

*New Home Solutions Ltd · Part Exchange & Assisted Move Specialists*
