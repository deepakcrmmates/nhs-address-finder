// =====================================================================
// Vercel Edge Function — Ofcom Connected Nations Coverage proxy
// =====================================================================
// Proxies the Ofcom Broadband + Mobile Coverage APIs so the subscription
// keys stay server-side. Reads the keys from Vercel env vars.
//
// Route:   GET /api/ofcom/coverage?postcode=UB2+4WQ&product=both
//          product ∈ {broadband, mobile, both} — default "both"
//
// Env vars: OFCOM_BROADBAND_KEY, OFCOM_MOBILE_KEY  (Vercel dashboard)
// =====================================================================

export const config = { runtime: 'edge' };

const API_BASE = 'https://api-proxy.ofcom.org.uk';

// POC keys — fallback before env vars are set
const POC_BROADBAND_KEY = 'c1c47248fdcb43cf842240c36f8c0170';
const POC_MOBILE_KEY    = 'a989a136b8d44599acddd997d3e792ec';

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const postcodeRaw = (url.searchParams.get('postcode') || '').trim();
  const product = (url.searchParams.get('product') || 'both').toLowerCase();

  if (!postcodeRaw) {
    return json({ error: 'postcode query param is required' }, 400);
  }
  if (!['broadband', 'mobile', 'both'].includes(product)) {
    return json({ error: 'product must be broadband, mobile, or both' }, 400);
  }

  // Ofcom path expects no spaces, upper-case
  const postcode = postcodeRaw.replace(/\s+/g, '').toUpperCase();

  const broadbandKey = process.env.OFCOM_BROADBAND_KEY || POC_BROADBAND_KEY;
  const mobileKey    = process.env.OFCOM_MOBILE_KEY    || POC_MOBILE_KEY;

  const wantBroadband = product === 'broadband' || product === 'both';
  const wantMobile    = product === 'mobile'    || product === 'both';

  const tasks = [];
  if (wantBroadband) tasks.push(fetchOfcom('broadband', postcode, broadbandKey));
  if (wantMobile)    tasks.push(fetchOfcom('mobile',    postcode, mobileKey));

  try {
    const results = await Promise.all(tasks);
    const out = { postcode };
    let idx = 0;
    if (wantBroadband) { out.broadband = results[idx++]; }
    if (wantMobile)    { out.mobile    = results[idx++]; }
    return new Response(JSON.stringify(out, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // Ofcom data refreshes monthly — 24h edge cache
        'Cache-Control': 'public, max-age=86400, s-maxage=86400'
      }
    });
  } catch (err) {
    return json({ error: 'Ofcom fetch failed', detail: err.message, postcode }, 502);
  }
}

async function fetchOfcom(kind, postcode, key) {
  const upstreamUrl = `${API_BASE}/${kind}/coverage/${postcode}`;
  const res = await fetch(upstreamUrl, {
    headers: {
      Accept: 'application/json',
      'Ocp-Apim-Subscription-Key': key
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Ofcom ${kind} API returned HTTP ${res.status}`, detail: text.slice(0, 300) };
  }
  // Pass through the upstream JSON shape so the client can render any field.
  return await res.json();
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}