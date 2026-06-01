// =====================================================================
// Vercel Edge Function — OS Maps raster tile proxy
// =====================================================================
// Proxies Ordnance Survey OS Maps raster tiles so the API key stays on
// the server. Leaflet calls this endpoint for every map tile.
//
// Route:   GET /api/os/tile?style=Road&z=15&x=123&y=456
//   Leaflet URL template: /api/os/tile?style=Road&z={z}&x={x}&y={y}
//
// Env var: OS_KEY  (Vercel dashboard → Settings → Environment Variables)
// =====================================================================

export const config = { runtime: 'edge' };

const OS_BASE = 'https://api.os.uk';
const POC_OS_KEY = '5gc6m89L6DtmTg0A4cTfZzMaK0zHnfCd';

// Only proxy known-good layers
const ALLOWED_STYLES = new Set(['Road', 'Outdoor', 'Light']);

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const url = new URL(request.url);
  const style = url.searchParams.get('style') || '';
  const z = url.searchParams.get('z') || '';
  const x = url.searchParams.get('x') || '';
  const y = url.searchParams.get('y') || '';

  if (!ALLOWED_STYLES.has(style)) {
    return new Response(`Unknown style: ${style}`, { status: 400 });
  }
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return new Response('z, x, y must be integers', { status: 400 });
  }

  const key = process.env.OS_KEY || POC_OS_KEY;
  const upstreamUrl = `${OS_BASE}/maps/raster/v1/zxy/${style}_3857/${z}/${x}/${y}.png`
    + `?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(upstreamUrl);
    if (!res.ok) {
      // Don't cache failures; return upstream status so Leaflet retries cleanly
      return new Response(`OS tile fetch failed (HTTP ${res.status})`, {
        status: res.status,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Tiles change rarely — 7-day edge cache
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable'
      }
    });
  } catch (err) {
    return new Response(`OS tile fetch failed: ${err.message}`, { status: 502 });
  }
}
