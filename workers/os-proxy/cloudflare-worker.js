// =====================================================================
// OS Data Hub Proxy — Cloudflare Worker
// =====================================================================
// Proxies Ordnance Survey APIs so the API key never reaches the browser.
// OS Data Hub doesn't offer HTTP-Referer restrictions in its current UI
// (Actions menu only has "Delete project" / "Regenerate API Key"), so
// this Worker is the only way to keep the key off the partner-facing
// client.
//
// Routes:
//   GET /places/postcode?postcode=UB2+4WQ
//     → proxies https://api.os.uk/search/places/v1/postcode?... (JSON)
//
//   GET /maps/tile/{style}/{z}/{x}/{y}.png
//     → proxies https://api.os.uk/maps/raster/v1/zxy/{style}_3857/{z}/{x}/{y}.png
//     style ∈ {Road, Outdoor, Light} (extend as needed)
//
// Setup:
//   wrangler secret put OS_KEY     # optional, falls back to inline POC key
//
// Deploy:
//   wrangler deploy
// =====================================================================

const OS_BASE = 'https://api.os.uk';

// POC key — kept inline to match the EPC / Ofcom worker pattern. Rotate
// out via `wrangler secret put OS_KEY` for production.
const POC_OS_KEY = '5gc6m89L6DtmTg0A4cTfZzMaK0zHnfCd';

// Allow-list of origins permitted to call this Worker.
const ALLOWED_ORIGINS = new Set([
  'https://nhs-address-finder.vercel.app',
]);
function isLocalhost(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
}
function corsHeaders(origin) {
  const allow = (origin && (ALLOWED_ORIGINS.has(origin) || isLocalhost(origin)))
    ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}
function reCorsCached(cached, cors) {
  // Cache entries are origin-agnostic; rewrite Allow-Origin per request.
  const headers = new Headers(cached.headers);
  headers.set('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
  headers.set('Vary', 'Origin');
  return new Response(cached.body, { status: cached.status, headers });
}

// Tile style allow-list — only proxy known-good OS Maps layers.
const ALLOWED_STYLES = new Set(['Road', 'Outdoor', 'Light']);

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const CORS = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const key = (env && env.OS_KEY) || POC_OS_KEY;
    if (!key) {
      return json({ error: 'OS_KEY not configured' }, 500, CORS);
    }

    // ── /places/postcode ──
    if (url.pathname === '/places/postcode') {
      return handlePlaces(url, key, ctx, CORS);
    }

    // ── /maps/tile/{style}/{z}/{x}/{y}.png ──
    const tileMatch = url.pathname.match(/^\/maps\/tile\/([A-Za-z_]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (tileMatch) {
      const [, style, z, x, y] = tileMatch;
      if (!ALLOWED_STYLES.has(style)) {
        return json({ error: 'unknown style', style, allowed: [...ALLOWED_STYLES] }, 400, CORS);
      }
      return handleTile(style, z, x, y, key, ctx, CORS);
    }

    return json({
      error: 'unknown route',
      path: url.pathname,
      routes: ['/places/postcode', '/maps/tile/{style}/{z}/{x}/{y}.png']
    }, 404, CORS);
  }
};

async function handlePlaces(url, key, ctx, CORS) {
  const postcode = (url.searchParams.get('postcode') || '').trim();
  if (!postcode) {
    return json({ error: 'postcode query param is required' }, 400, CORS);
  }
  const maxresults = Math.min(100, parseInt(url.searchParams.get('maxresults') || '100', 10) || 100);

  const cache = caches.default;
  const cacheKey = new Request(`https://os-proxy-cache/places/${encodeURIComponent(postcode)}/${maxresults}`);
  const cached = await cache.match(cacheKey);
  if (cached) return reCorsCached(cached, CORS);

  const upstreamUrl = `${OS_BASE}/search/places/v1/postcode`
    + `?postcode=${encodeURIComponent(postcode)}`
    + `&output_srs=EPSG:4326`
    + `&maxresults=${maxresults}`
    + `&key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(upstreamUrl, { headers: { Accept: 'application/json' } });
    const body = await res.text();
    const response = new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        ...CORS
      }
    });
    // Only cache successful responses
    if (res.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return json({ error: 'OS Places fetch failed', detail: err.message }, 502, CORS);
  }
}

async function handleTile(style, z, x, y, key, ctx, CORS) {
  const cache = caches.default;
  const cacheKey = new Request(`https://os-proxy-cache/tile/${style}/${z}/${x}/${y}`);
  const cached = await cache.match(cacheKey);
  if (cached) return reCorsCached(cached, CORS);

  const upstreamUrl = `${OS_BASE}/maps/raster/v1/zxy/${style}_3857/${z}/${x}/${y}.png`
    + `?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(upstreamUrl);
    if (!res.ok) {
      return json(
        { error: `OS Maps tile fetch failed`, status: res.status, style, z, x, y },
        res.status,
        CORS
      );
    }
    const body = await res.arrayBuffer();
    const response = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Tiles change rarely — 7-day edge cache
        'Cache-Control': 'public, max-age=604800',
        ...CORS
      }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return json({ error: 'OS Maps fetch failed', detail: err.message }, 502, CORS);
  }
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors
    }
  });
}
