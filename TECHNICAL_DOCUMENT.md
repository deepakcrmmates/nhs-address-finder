# NHS Address Finder — Technical Document

**Status:** Live in sandbox · Cloudflare Workers deployed · Ofcom + MHCLG + OS keys active
**Last updated:** 2026-05-27
**Owner:** Deepak K Rana (CRM Mates) · Built for New Home Solutions Ltd

---

## 1 · Overview

A free, partner-facing address lookup tool for NHS estate-agent, photographer and housebuilder partners. The app is a **single static HTML file** backed by two **Cloudflare Workers** for API-key-protected upstream services.

> Type a UK postcode → pick a property → see UPRN, OS map, EPC, broadband, mobile coverage → download a branded NHS PDF report.

The whole thing is intentionally serverless and dependency-light: no build step, no bundler, no database, no auth. Just a HTML file, two Workers, and four external APIs.

---

## 2 · Architecture

```
                                        ┌─────────────────────────────┐
   Browser  ───────────────────────────▶│ OS Places API               │
   (index.html)                          │ OS Maps Raster Tile API     │
                                        │ Google Street View embed    │
                                        └─────────────────────────────┘

                ┌──────────────────────────┐    ┌─────────────────────┐
   Browser ──▶ │ workers/ofcom-coverage   │──▶ │ Ofcom Connected     │
                │ Cloudflare Worker        │    │ Nations (Broadband  │
                │ (Ocp-Apim-Subscription)  │    │ + Mobile APIs)      │
                └──────────────────────────┘    └─────────────────────┘

                ┌──────────────────────────┐    ┌─────────────────────┐
   Browser ──▶ │ workers/epc-lookup       │──▶ │ MHCLG Energy        │
                │ Cloudflare Worker        │    │ Performance         │
                │ (Bearer auth)            │    │ Register API        │
                └──────────────────────────┘    └─────────────────────┘
```

### Why Workers (not direct browser calls)

| API | CORS-friendly? | Key sensitivity | Verdict |
|---|---|---|---|
| OS Places | ✅ yes | Public partner key | Direct browser call |
| OS Maps tiles | ✅ yes | Same key | Direct browser call |
| Google Street View | ✅ yes (iframe embed) | None needed | Direct browser embed |
| MHCLG EPC API | ❌ no | Bearer token | **Worker proxy** |
| Ofcom Connected Nations | ❌ no | Subscription key | **Worker proxy** |

The Workers also give us free 24h **edge caching** per postcode — repeat lookups return in milliseconds at zero upstream cost.

---

## 3 · Data sources

| # | Layer | Vendor | Endpoint pattern | Tier |
|---|---|---|---|---|
| 1 | Address lookup | Ordnance Survey **OS Places** | `GET /search/places/v1/postcode?postcode=…` | Standard |
| 2 | Map tiles | Ordnance Survey **OS Maps** | `GET /maps/raster/v1/zxy/Road_3857/{z}/{x}/{y}.png` | Standard |
| 3 | Street view | Google Maps (no key) | `iframe src="https://maps.google.com/maps?layer=c&cbll=…"` | Free embed |
| 4 | EPC | MHCLG **EPC Register** | `GET /api/domestic/search?postcode=…` + `GET /api/certificate?certificate_number=…` | Live |
| 5 | Broadband | Ofcom **Connected Nations Broadband** | `GET /broadband/coverage/{POSTCODE}` | Basic |
| 6 | Mobile | Ofcom **Connected Nations Mobile** | `GET /mobile/coverage/{POSTCODE}` | Basic |

**Latency budget per search:** OS Places ~400ms · Ofcom Workers ~700ms · EPC Worker ~600ms — all fired in parallel via `Promise.all`, total page time ~1s warm.

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

## 7 · Cloudflare Worker details

### 7.1 Ofcom Coverage Worker (`workers/ofcom-coverage/`)

| Item | Detail |
|---|---|
| Production URL | `https://nhs-ofcom-coverage.systemtest-827.workers.dev` |
| Deployed | 2026-05-26 |
| Upstream | `https://api-proxy.ofcom.org.uk/{broadband\|mobile}/coverage/{POSTCODE}` |
| Auth | `Ocp-Apim-Subscription-Key` header (server-side) |
| CORS | `Access-Control-Allow-Origin: *` (lock to your origin in production) |
| Cache | 24h edge cache keyed by `(product, postcode)` |
| Endpoints | `?postcode=…&product=broadband\|mobile\|both` |

The `product=both` mode does a single round-trip and returns both feeds — the Address Finder uses this exclusively for efficiency.

### 7.2 EPC Lookup Worker (`workers/epc-lookup/`)

| Item | Detail |
|---|---|
| Production URL | `https://nhs-epc-lookup.systemtest-827.workers.dev` |
| Deployed | 2026-05-14 |
| Upstream | `https://api.get-energy-performance-data.communities.gov.uk` |
| Auth | `Authorization: Bearer <token>` (server-side) |
| CORS | Same |
| Cache | 24h edge cache per query / certificate |
| Endpoints | `?postcode=…` (search) · `?cert=<RRN>` (full certificate detail) |

Both workers use `wrangler@^3.85.0` for deploy. POC keys are inlined as constants with `env.*` fallback hooks ready for production secret rotation.

---

## 8 · Deployment

### 8.1 Frontend (`index.html`)

Static file. Open locally with `open index.html`, or serve from any static host:

```bash
python3 -m http.server 8080
```

For production, deploy to Cloudflare Pages, Netlify, GitHub Pages, or any static-file host.

### 8.2 Workers

```bash
cd workers/ofcom-coverage
npm install
npx wrangler login
# optionally rotate POC keys to secrets:
npx wrangler secret put OFCOM_BROADBAND_KEY
npx wrangler secret put OFCOM_MOBILE_KEY
npx wrangler deploy
```

Same pattern for `workers/epc-lookup`.

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
- [ ] Push to GitHub remote (repo not yet created)
- [ ] Production host for `index.html` (currently runs from `file://`)
- [ ] Rotate Worker POC keys → `wrangler secret put` for production
- [ ] Lock CORS `Allow-Origin` to the production domain (currently `*`)
- [ ] Add usage analytics / partner attribution
- [ ] Add monthly rate-limit guard on the Ofcom Workers (the Basic tier has caps)

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
