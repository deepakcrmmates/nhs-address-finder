#!/usr/bin/env node
// =====================================================================
// Local dev server — static files + a live OS Places proxy
// ---------------------------------------------------------------------
// The plain `python -m http.server` can't run the Vercel Edge Functions in
// /api, so locally the Route Planner falls back to Mapbox (area-level only).
// This server mirrors production: it serves the static site AND proxies
// /api/os/places to Ordnance Survey using your key — so the house-level
// address list shows locally, exactly as it will on Vercel.
//
// Run it with your OS Data Hub key (the same value set as OS_KEY in Vercel):
//
//     OS_KEY=your_os_key_here node scripts/dev-server.js
//
// Then open http://localhost:3000/route-planner.html
// =====================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, '..');
const OS_KEY = process.env.OS_KEY || '';
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';
const OS_BASE = 'https://api.os.uk';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Mapbox token (mirrors api/mapbox/token.js) ──────────────────────
  if (url.pathname === '/api/mapbox/token') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ token: MAPBOX_TOKEN }));
  }

  // ── OS Places proxy (mirrors api/os/places.js) ──────────────────────
  if (url.pathname === '/api/os/places') {
    if (!OS_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'OS_KEY not set. Run: OS_KEY=your_key node scripts/dev-server.js' }));
    }
    const postcode = (url.searchParams.get('postcode') || '').trim();
    if (!postcode) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'postcode query param is required' }));
    }
    const maxresults = Math.min(100, parseInt(url.searchParams.get('maxresults') || '100', 10) || 100);
    const upstream = `${OS_BASE}/search/places/v1/postcode`
      + `?postcode=${encodeURIComponent(postcode)}`
      + `&output_srs=EPSG:4326&maxresults=${maxresults}&key=${encodeURIComponent(OS_KEY)}`;
    try {
      const up = await fetch(upstream, { headers: { Accept: 'application/json' } });
      const body = await up.text();
      res.writeHead(up.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'OS Places fetch failed', detail: err.message }));
    }
  }

  // ── Static files ────────────────────────────────────────────────────
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  // Vercel cleanUrls: allow /route-planner → route-planner.html
  let filePath = path.join(ROOT, rel);
  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) filePath += '.html';

  // keep requests inside the project root
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, async () => {
  console.log(`\n  Dev server → http://localhost:${PORT}/route-planner.html`);
  console.log(`  Mapbox     → ${/^pk\./.test(MAPBOX_TOKEN) ? 'token set ✓' : 'NOT set — map disabled (set MAPBOX_TOKEN)'}`);
  if (!OS_KEY) {
    console.log(`  OS proxy   → DISABLED — set OS_KEY to enable house-level lookup`);
    console.log(`               Run: OS_KEY=your_os_key node scripts/dev-server.js\n`);
    return;
  }
  // Self-test: ping OS once so you know immediately if the key works.
  process.stdout.write('  OS proxy   → testing key… ');
  try {
    const up = await fetch(`${OS_BASE}/search/places/v1/postcode?postcode=LS12+1AB&maxresults=1&output_srs=EPSG:4326&key=${encodeURIComponent(OS_KEY)}`);
    const j = await up.json();
    if (j.fault) console.log(`FAILED — OS says: ${j.fault.faultstring} (key invalid or no quota)`);
    else if (j.header) console.log(`OK — house-level lookup is live ✓\n`);
    else console.log(`unexpected response (HTTP ${up.status})`);
  } catch (e) {
    console.log(`could not reach OS: ${e.message}`);
  }
});
