// =====================================================================
// Vercel Edge Function — OS Places proxy
// =====================================================================
// Proxies the Ordnance Survey Places API so the OS Data Hub key never
// reaches the browser. Reads the key from Vercel env vars at request time.
//
// Route:   GET /api/os/places?postcode=UB2+4WQ&maxresults=100
// Env var: OS_KEY  (set in Vercel dashboard → Settings → Environment Variables)
//
// OS Data Hub doesn't expose HTTP-Referer restrictions in its UI for our
// tier, so server-side proxying is the only way to keep the key off the
// partner-facing client.
// =====================================================================

export const config = { runtime: 'edge' };

const OS_BASE = 'https://api.os.uk';

// POC key — fallback for first deploy before env var is set. Rotate out:
// Vercel dashboard → Project → Settings → Environment Variables → add OS_KEY
const POC_OS_KEY = '5gc6m89L6DtmTg0A4cTfZzMaK0zHnfCd';

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const postcode = (url.searchParams.get('postcode') || '').trim();
  if (!postcode) {
    return json({ error: 'postcode query param is required' }, 400);
  }
  const maxresults = Math.min(
    100,
    parseInt(url.searchParams.get('maxresults') || '100', 10) || 100
  );

  const key = process.env.OS_KEY || POC_OS_KEY;
  const upstreamUrl = `${OS_BASE}/search/places/v1/postcode`
    + `?postcode=${encodeURIComponent(postcode)}`
    + `&output_srs=EPSG:4326`
    + `&maxresults=${maxresults}`
    + `&key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(upstreamUrl, { headers: { Accept: 'application/json' } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // OS Places data refreshes monthly — 1h edge cache is fine
        'Cache-Control': res.ok ? 'public, max-age=3600, s-maxage=3600' : 'no-store'
      }
    });
  } catch (err) {
    return json({ error: 'OS Places fetch failed', detail: err.message }, 502);
  }
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
