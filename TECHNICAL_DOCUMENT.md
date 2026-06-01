# NHS Address Finder — Technical Document

**Status:** Live on Vercel · Vercel-native architecture · all upstream API keys held in Vercel env vars
**Production URL:** https://nhs-address-finder.vercel.app/
**Last updated:** 2026-05-29
**Owner:** Deepak K Rana (CRM Mates) · Built for New Home Solutions Ltd

---

## 1 · Overview

A free, partner-facing address lookup tool for NHS estate-agent, photographer and housebuilder partners. The app is a **single static HTML file** plus **four Vercel Edge Functions** that proxy every upstream API-key-protected service.

> Type a UK postcode → pick a property → see UPRN, OS map, EPC, broadband, mobile coverage → download a branded NHS PDF report.

The whole thing runs on **one platform (Vercel)**, with the frontend and the API-key-holding proxies served from the same origin. No build step, no bundler, no database, no auth. Every upstream API key (OS Data Hub, Ofcom × 2, MHCLG) lives in **Vercel Environment Variables** and never reaches the browser.

---

## 2 · Architecture

```
                              ┌──── Vercel (nhs-address-finder.vercel.app) ────┐
                              │                                                 │
                              │   index.html (single-file SPA)                  │
   Browser ───────────────────▶                                                  │
                              │   /api/os/places       ─┐                       │
                              │   /api/os/tile         ─┼─▶ all 4 are           │
                              │   /api/ofcom/coverage  ─┤   Vercel Edge         │
                              │   /api/epc/lookup      ─┘   Functions           │
                              └──┬──────────────────────────────────────────────┘
                                 │
                                 │  reads OS_KEY / OFCOM_*_KEY / EPC_TOKEN from
                                 │  Vercel Environment Variables (never sent
                                 │  to the browser)
                                 ▼
            ┌─────────────────────────────────────────────────────────┐
            │ OS Places API · OS Maps Raster Tile API                 │
            │ Ofcom Connected Nations (Broadband + Mobile) API        │
            │ MHCLG Energy Performance of Buildings API               │
            └─────────────────────────────────────────────────────────┘
```

The frontend talks **same-origin** to `/api/*`. Edge Functions read API keys from `process.env.*` and forward to the upstream. Browser never sees a key, never crosses an origin boundary, no CORS allow-list to maintain.

### Why Vercel Edge Functions (not direct browser calls)

| API | CORS-friendly? | Key sensitivity | Verdict |
|---|---|---|---|
| OS Places | ✅ yes | OS Data Hub Project key — no Referer restriction available in our tier | **Edge Function proxy** |
| OS Maps tiles | ✅ yes | Same OS key | **Edge Function proxy** |
| Google Street View | ✅ yes (iframe embed) | None needed | Direct browser embed |
| MHCLG EPC API | ❌ no | Bearer token | **Edge Function proxy** |
| Ofcom Connected Nations | ❌ no | Subscription keys (separate for Broadband + Mobile) | **Edge Function proxy** |

### Why Edge (and not Node) runtime

- Cold-start ~5ms vs ~300ms for Node functions
- Cheaper per invocation
- All four functions only `fetch()` + transform JSON — no Node-specific APIs needed

### Cache strategy

| Endpoint | Cache-Control | Rationale |
|---|---|---|
| `/api/os/places` | `public, max-age=3600` | OS AddressBase updates monthly |
| `/api/os/tile` | `public, max-age=604800, immutable` | OS Maps tiles change rarely |
| `/api/ofcom/coverage` | `public, max-age=86400` | Ofcom data refreshes monthly |
| `/api/epc/lookup` | `public, max-age=86400` | EPC certs are immutable once issued |
| `index.html` | `must-revalidate` | App shell — always check for updates |
| Other static assets | `public, max-age=3600` | Reasonable default |

Vercel's CDN respects `Cache-Control` automatically — no extra config needed.

---

## 3 · Data sources

| # | Layer | Vendor | Browser endpoint (same-origin) | Upstream (server-side) |
|---|---|---|---|---|
| 1 | Address lookup | Ordnance Survey **OS Places** | `GET /api/os/places?postcode=…` | `api.os.uk/search/places/v1/postcode` |
| 2 | Map tiles | Ordnance Survey **OS Maps** | `GET /api/os/tile?style=…&z=…&x=…&y=…` | `api.os.uk/maps/raster/v1/zxy/{style}_3857/{z}/{x}/{y}.png` |
| 3 | Street view | Google Maps (no key) | iframe → `maps.google.com` | direct |
| 4 | EPC | MHCLG **EPC Register** | `GET /api/epc/lookup?postcode=…` or `?cert=RRN` | `api.get-energy-performance-data.communities.gov.uk` |
| 5 | Broadband | Ofcom **Connected Nations Broadband** | `GET /api/ofcom/coverage?product=broadband&postcode=…` | `api-proxy.ofcom.org.uk/broadband/coverage/{POSTCODE}` |
| 6 | Mobile | Ofcom **Connected Nations Mobile** | `GET /api/ofcom/coverage?product=mobile&postcode=…` | `api-proxy.ofcom.org.uk/mobile/coverage/{POSTCODE}` |

The Ofcom proxy supports `product=both` so a single round-trip returns Broadband + Mobile. The Address Finder uses this exclusively for efficiency.

**Latency budget per search:** OS Places ~400ms · Ofcom ~700ms · EPC ~600ms — all fired in parallel via `Promise.all`, total page time ~1s warm. Edge Function cold-start adds ~5ms.

---

## 4 · Frontend stack

| Concern | Choice | Why |
|---|---|---|
| Markup / styling | Hand-written HTML + CSS, all inline in `index.html` | Single-file portability; no build step |
| Type | Inter (UI) + JetBrains Mono (UPRNs / coords) + Futura LT Light (logo per brand spec) | Already on Google Fonts; logo font available system-wide on Mac |
| Map | **Leaflet 1.9.4** via CDN | Native OS Maps raster tile support; small footprint |
| PDF generation | **html2canvas 1.4.1** + **jsPDF 2.5.1** via cdnjs | Lossless screenshot → A4 PDF; see §6 |
| Icons | Inline SVG | No icon font dependency |

No npm. No webpack. No React.

---

## 5 · Feature inventory

### 5.1 Address lookup
- Postcode input, validated by OS Places (UK only)
- Returns all UPRNs at the postcode (typically 5–50 properties)
- Each row shows UPRN, address, classification pill (Residential / Commercial / Other), coords

### 5.2 Two result views
- **List view** (default) — sage-tint headers, rows reveal action buttons on hover
- **Card view** — toggleable, compact cards with same actions

### 5.3 Property detail page
- Big address + UPRN + classification + postcode
- Six action rows: UPRN copy · Map · Street View · Coordinates copy · EPC · Council/Constituency
- **EPC band pill** (A–G gov.uk colour-coded) opening a full certificate lightbox with the ladder and cert summary
- **Broadband coverage** — half-circle SVG speedometer (0–5500 Mbps, red→amber→green bands) + 3-tier breakdown (Standard / Superfast / Ultrafast)
- **Mobile coverage** — 4 brand-coloured operator cards (EE teal · Three black · O2 blue · Vodafone red) with 4-bar signal indicators for indoor/outdoor voice + data
- Portal strip — quick links to Rightmove / Zoopla / OnTheMarket for the postcode

### 5.4 Generate Report (PDF)
See §6 below.

---

## 6 · PDF Report — Design + Implementation

The PDF report is the most complex single feature. It earned a full rebuild after the first three attempts produced corrupt output.

### 6.1 Final design

**4-page A4 portrait report**, NHS-branded per [`docs/branding/NHS_Email_Template_Guidelines.md`](https://github.com/deepakcrmmates/nhs-training-app/blob/main/docs/branding/NHS_Email_Template_Guidelines.md) from the parent project:

| Page | Content |
|---|---|
| 1 | Header bar · Address heading · Property Identity table · Section 01 Location (OS map + coords) · Footer |
| 2 | Header bar · Section 02 Energy (full EPC ladder + cert details table) · Footer |
| 3 | Header bar · Section 03 Broadband coverage (gauge + tier rows) · Footer |
| 4 | Header bar · Section 04 Mobile coverage (4 operator cards) · Footer |

Repeated chrome on every page:
- **Header bar** — `#C9D5CB` sage background, Futura LT Light "NEW HOME SOLUTIONS" left, "Property Report · DATE · TIME" right
- **3px accent stripe** — `#4A6B5E` sage dark
- **Footer bar** — `#EAF4EF` sage tint, centred, with "P: SAVE THE TREES" + page X of 4 + company registration

### 6.2 Brand compliance

Every visual element ladders back to the NHS Newsletter / Email Template Guidelines:

| Spec section | Implementation |
|---|---|
| §1 Typography | Aptos (body, with Segoe UI / Helvetica fallback). Futura LT Light (logo only, 23px, weight 300, letter-spacing 0.06em, word-spacing 0.3em) |
| §2 Palette | Sage Dark `#4A6B5E` · Sage `#6B9080` · Sage BG `#C9D5CB` · Sage Tint `#EAF4EF` · Border `#C5DCCC` · Navy `#0D1E4A` · Muted `#6B7280` |
| §3 Structure | Header bar → accent stripe → white body → sage-tint footer |
| §4 Tables | All structural data in tables: `#4A6B5E` header, `#EAF4EF` label cells, white value cells, `1px solid #C5DCCC` borders, `border-radius: 10px` |
| §6 Footer | "P: SAVE THE TREES" mandatory copy + registered office line |

The on-screen mockup uses a legacy `#075F50` teal palette for historical reasons. The PDF renderer overrides every `--nhs-*` CSS variable inside `.rpt-render-host` so all reused components (gauge, tier bars, EPC ladder, mobile cards) re-tint to sage automatically.

### 6.3 Render pipeline

```
User clicks "Generate Report"
        ▼
async generateReport()
        ▼
Fetch full EPC certificate via Worker (if RRN known)
        ▼
Build off-screen render host (opacity: 0, 210mm wide, pinned to viewport top-left)
        ▼
Render 4 × <div class="rpt-pdf-page"> — A4-sized (210mm × 297mm), flex column,
  header + body (flex: 1) + footer (pinned to bottom)
        ▼
Init Leaflet map inside page 1's body; wait for OS tile layer 'load' event
  (with 3.5s safety net)
        ▼
const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
for each .rpt-pdf-page:
    canvas = await html2canvas(page, { scale: 3, useCORS: true, ... })
    imgData = canvas.toDataURL('image/png')
    pdf.addImage(imgData, 'PNG', 0, 0, 210, imgH, undefined, 'FAST')
    pdf.addPage()  // except on the last
pdf.save(filename)
        ▼
Remove the off-screen host
```

### 6.4 Why per-page rendering (not html2pdf.js)

We initially used `html2pdf.js` with its `pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }` config. It produced consistent bugs:

1. **Half-width output** — content rendered at ~95mm wide instead of full 190mm content area, with left-edges clipped on every page ("Certificate" became "rtificate")
2. **Mid-row table splits** — `page-break-inside: avoid` on `.rpt-id-table` was ignored, the Property Identity table split between page 1 and 2 with the "Geographic centroid" cell broken across both
3. **Vanishing sections** — Section 04 Mobile rendered as an empty page; Section 03 Broadband body lost entirely
4. **Content pushed to bottom of page 1** — huge empty space at top, header bar starting 70% down the page

Root cause: html2pdf renders the whole DOM into one tall canvas, then heuristically slices it across pages. Heuristics fight CSS rules. Heuristics produced garbage.

Solution: bypass them. Render **each page as its own canvas, place 1:1 into the PDF**. Each `.rpt-pdf-page` is sized to exactly A4 dimensions (210mm × 297mm) so the captured image fills its PDF page without scaling. One page in the DOM = one page in the PDF. Deterministic.

### 6.5 Quality tuning

- `scale: 3` on `html2canvas` → ~288 DPI captured canvas (above 300 DPI print quality threshold)
- `toDataURL('image/png')` for lossless text edges (JPEG at q=0.95 visibly softened type)
- `pdf.addImage(..., 'FAST')` for PNG compression in the PDF — keeps a 4-page report under 5MB

### 6.6 Known PDF quirks that took iterations to find

| Bug | Cause | Fix |
|---|---|---|
| `NaNNaNNaN` shown in Postcode / Classification / Coordinates cells | `+ + idCell(...)` typo — second `+` was unary plus, coercing HTML string to `NaN` | Removed the rogue `+` |
| Broadband gauge invisible in PDF | `<feDropShadow>` filter on the needle — html2canvas can't render SVG filters | Removed the filter |
| Gauge SVG missing even after filter removal | Inline `<svg>` without explicit `width`/`height` attributes serialises to 0×0 in html2canvas's foreignObject path | Switched to `<img src="data:image/svg+xml,…">` — html2canvas handles images reliably |
| EPC ladder rendered with garbled letters ("B" → "3") and indicator arrows in wrong column | The lightbox renderer uses `clip-path: polygon(...)` for pentagon arrows and `display: flex; justify-content: flex-end` for letter positioning. html2canvas can't reliably render either | Wrote a dedicated `renderEpcForReport(cert)` using a plain table with background-coloured cells and standard text alignment |
| Right edge of report header cropped ("Property Repor…", "13:2…") | Render host was 210mm wide but PDF content area is only 190mm — html2pdf was scaling, edge text fell off | Made host 210mm exactly + sized each `.rpt-pdf-page` to A4 so it's placed 1:1 |
| `Could not generate the PDF — PDF dependencies (html2canvas / jsPDF) not exposed by html2pdf bundle.` | html2pdf bundles its dependencies as ES module internals; they're not on `window` | Switched to standalone html2canvas + jsPDF CDN scripts |

---

## 7 · Vercel Edge Function details

All four functions use the **Edge runtime** (`export const config = { runtime: 'edge' }`), read keys from `process.env.*` with a POC-key fallback so the app keeps working before env vars are configured, and emit `Cache-Control` headers so Vercel's CDN caches automatically.

### 7.1 `api/os/places.js` — OS Places proxy

| Item | Detail |
|---|---|
| Endpoint | `GET /api/os/places?postcode=…&maxresults=100` |
| Upstream | `api.os.uk/search/places/v1/postcode` |
| Auth | `key=…` query param |
| Env var | `OS_KEY` (Vercel) |
| Cache | `public, max-age=3600` (1h) |

### 7.2 `api/os/tile.js` — OS Maps raster tile proxy

| Item | Detail |
|---|---|
| Endpoint | `GET /api/os/tile?style=Road&z={z}&x={x}&y={y}` |
| Upstream | `api.os.uk/maps/raster/v1/zxy/{style}_3857/{z}/{x}/{y}.png` |
| Auth | `key=…` query param |
| Env var | `OS_KEY` (shared with `/places`) |
| Allowed styles | `Road`, `Outdoor`, `Light` |
| Cache | `public, max-age=604800, immutable` (7 days) |

Used directly as Leaflet's tile URL template — Leaflet substitutes `{z}/{x}/{y}` per tile.

### 7.3 `api/ofcom/coverage.js` — Ofcom Connected Nations proxy

| Item | Detail |
|---|---|
| Endpoint | `GET /api/ofcom/coverage?postcode=…&product=broadband\|mobile\|both` |
| Upstream | `api-proxy.ofcom.org.uk/{broadband\|mobile}/coverage/{POSTCODE}` |
| Auth | `Ocp-Apim-Subscription-Key` header |
| Env vars | `OFCOM_BROADBAND_KEY`, `OFCOM_MOBILE_KEY` |
| Cache | `public, max-age=86400` (24h) |

`product=both` fires both fetches in parallel via `Promise.all` and returns `{ broadband, mobile }` in one response — the Address Finder uses this exclusively.

### 7.4 `api/epc/lookup.js` — MHCLG EPC Register proxy

| Item | Detail |
|---|---|
| Endpoints | `GET /api/epc/lookup?postcode=…` (search) · `?cert=<RRN>` (full certificate) |
| Upstream | `api.get-energy-performance-data.communities.gov.uk` |
| Auth | `Authorization: Bearer <token>` |
| Env var | `EPC_TOKEN` |
| Cache | `public, max-age=86400` (24h) |

The cert-detail mode transforms the upstream's snake_case keys into the camelCase shape the EPC ladder renderer expects.

### Why these replaced the Cloudflare Workers

The original architecture used three Cloudflare Workers (`workers/ofcom-coverage/`, `workers/epc-lookup/`, `workers/os-proxy/`). All still deployed and working, but **superseded** by Edge Functions because:

- **Same-origin** → no CORS allow-list to maintain (the Workers needed Vercel + localhost added explicitly, and cache hits had to rewrite `Allow-Origin`)
- **Single platform** → keys + frontend deploy together, atomic rollback
- **Env vars in one dashboard** → no `wrangler secret put` flow
- **Cleaner DX** → `git push` deploys everything

The legacy Worker source is retained in `workers/` for reference. Cloudflare deployments can be deleted from the Cloudflare dashboard whenever convenient.

---

## 8 · Deployment

### 8.1 Frontend + Edge Functions (`index.html` + `api/`)

Deployed to **Vercel** — the repo is wired up so every push to `main` auto-deploys both the static frontend and the four Edge Functions in one go.

`vercel.json` configures:
- Cache control — `index.html` always re-validates, other static assets cached 1h, `/api/*` excluded so functions set their own `Cache-Control`
- Security headers (applied to all non-`/api/` routes) — `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/mic/geo, HSTS 2-year

### 8.2 Environment variables (one-time setup)

In **Vercel dashboard → Project → Settings → Environment Variables**, add the four keys for all three environments (Production / Preview / Development):

| Name | Source |
|---|---|
| `OS_KEY` | OS Data Hub → API Projects → NHS-SF → Project API Key |
| `OFCOM_BROADBAND_KEY` | Ofcom Developer Portal → Subscriptions → Broadband Coverage |
| `OFCOM_MOBILE_KEY` | Ofcom Developer Portal → Subscriptions → Mobile Coverage |
| `EPC_TOKEN` | MHCLG EPC Register → bearer token |

> Each Edge Function falls back to an inlined POC key if its env var isn't set — the app keeps working immediately after first deploy. Set the env vars to rotate to production keys without a code change.

### 8.3 Deploy commands

```bash
# Auto-deploy on every push (already wired):
git push

# Or manual one-off:
npx vercel --prod
```

### 8.4 Local development

Use **Vercel CLI** so the `/api/*` Edge Functions actually run locally:

```bash
npx vercel dev
# then visit http://localhost:3000/
```

Plain `python3 -m http.server` won't work for local dev — without the Vercel runtime, the `/api/*` endpoints return 404 and every upstream call fails.

### 8.5 Legacy Cloudflare Workers (`workers/`)

The original architecture used three Cloudflare Workers. They're still deployed but **no longer called by the app** — superseded by the Edge Functions in `api/`. The source is retained in `workers/` for reference and can be deleted from the Cloudflare dashboard at any time.

---

## 9 · Key technical decisions

| Decision | Rationale |
|---|---|
| Single HTML file, no build step | Maximum portability for partners; anyone can fork / inspect / host |
| Cloudflare Workers (not Apex callouts) | Sub-100ms warm latency from anywhere, free tier covers all expected volume, edge caching is free |
| html2canvas + jsPDF (not html2pdf.js) | Direct library access lets us control pagination per-page; html2pdf's heuristics were unreliable |
| Per-page render (not full-doc slice) | One page in DOM = one page in PDF — eliminates entire class of pagebreak bugs |
| PNG (not JPEG) for PDF images | Lossless text edges; ~5MB file size is acceptable for a property report |
| `scale: 3` on html2canvas | Hits ~288 DPI (above print threshold); below this visibly blurry |
| Inline POC keys in Workers (not env secrets yet) | Faster iteration in sandbox; `env.*` fallback already wired for prod cutover |
| Aptos + Futura LT Light (brand-specified) | Spec compliance; system fallbacks (Segoe UI / Century Gothic) cover Windows users without Aptos |

---

## 10 · Status & next steps

### Done
- [x] Postcode → addresses lookup (OS Places live)
- [x] OS Maps tile viewer (Leaflet + OS Maps API)
- [x] Google Street View embed
- [x] EPC certificate ladder + details (MHCLG via Worker)
- [x] Broadband gauge + tier breakdown (Ofcom via Worker)
- [x] Mobile coverage cards (Ofcom via Worker)
- [x] Generate Report → 4-page branded PDF
- [x] Brand compliance per NHS Email Template Guidelines
- [x] Both Workers deployed to Cloudflare
- [x] Ofcom subscriptions active (Broadband + Mobile, Basic tier)
- [x] MHCLG EPC bearer token live

### Pending
- [x] ~~Push to GitHub remote~~ — live at `github.com/deepakcrmmates/nhs-address-finder`
- [x] ~~Production host for `index.html`~~ — Vercel at `nhs-address-finder.vercel.app`
- [x] ~~Lock CORS `Allow-Origin`~~ — N/A now (same-origin Edge Functions)
- [x] ~~Restrict OS Data Hub API key~~ — key is now server-side only, not exposed to the browser
- [x] ~~Migrate proxies to Vercel Edge~~ — all 4 functions live in `api/`
- [ ] Rotate POC keys → Vercel env vars (`OS_KEY`, `OFCOM_BROADBAND_KEY`, `OFCOM_MOBILE_KEY`, `EPC_TOKEN`)
- [ ] Add custom domain (e.g. `find.newhomesolutions.co.uk`)
- [ ] Add usage analytics / partner attribution
- [ ] Add monthly rate-limit guard on the Ofcom functions (the Basic tier has caps)
- [ ] Delete legacy Cloudflare Workers from the Cloudflare dashboard once Vercel cutover verified

### Considered, deferred
- Selectable text in the PDF — would need to rebuild via `pdfmake` and lose the gauge / operator cards. Trade-off not worth it for v1.
- Server-side cache layer between Workers and upstreams beyond Cloudflare's edge cache — not needed at current call volumes.

---

## 11 · Glossary

| Term | Meaning |
|---|---|
| **UPRN** | Unique Property Reference Number — 12-digit identifier from OS AddressBase, the canonical UK property ID |
| **RRN** | Report Reference Number — EPC certificate identifier |
| **NHS** | New Home Solutions Ltd — the client (not the National Health Service) |
| **Sprift / Street Data / HomeData** | Other property data vendors NHS uses in the parent training app — not used here |
| **MHCLG** | UK Ministry of Housing, Communities and Local Government — owns the EPC Register |
| **Ofcom** | UK communications regulator — publishes Connected Nations data on broadband + mobile coverage |
| **OS** | Ordnance Survey — UK national mapping agency |

---

*New Home Solutions Ltd · Part Exchange & Assisted Move Specialists · Document maintained by CRM Mates*
