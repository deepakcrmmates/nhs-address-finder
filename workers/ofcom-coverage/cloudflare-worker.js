// =====================================================================
// Ofcom Connected Nations Coverage — Cloudflare Worker
// =====================================================================
// Serverless proxy that the NHS Address Finder calls from the browser
// to fetch broadband + mobile coverage by postcode.
//
// Why a Worker:
//   - Ofcom api-proxy.ofcom.org.uk does not allow cross-origin browser
//     calls
//   - The Ocp-Apim-Subscription-Key must stay off the partner-facing
//     client
//   - Per-postcode edge cache (24h TTL) — Ofcom data refreshes monthly
//
// Setup (optional — POC keys are inline below):
//   wrangler secret put OFCOM_BROADBAND_KEY
//   wrangler secret put OFCOM_MOBILE_KEY
//
// Deploy:
//   wrangler deploy
//
// Endpoint (after deploy):
//   GET https://nhs-ofcom-coverage.<your-subdomain>.workers.dev/
//       ?postcode=UB2+4WQ&product=broadband
//   GET https://nhs-ofcom-coverage.<your-subdomain>.workers.dev/
//       ?postcode=UB2+4WQ&product=mobile
//   GET https://nhs-ofcom-coverage.<your-subdomain>.workers.dev/
//       ?postcode=UB2+4WQ&product=both
// =====================================================================

const API_BASE = 'https://api-proxy.ofcom.org.uk';

// POC keys — kept inline to match the EPC worker pattern.
// For production, set `env.OFCOM_BROADBAND_KEY` / `env.OFCOM_MOBILE_KEY`
// via `wrangler secret put` and delete these constants.
const POC_BROADBAND_KEY = 'c1c47248fdcb43cf842240c36f8c0170';
const POC_MOBILE_KEY    = 'a989a136b8d44599acddd997d3e792ec';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
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

    // Ofcom path expects the postcode without spaces, upper-case
    const postcode = postcodeRaw.replace(/\s+/g, '').toUpperCase();

    const broadbandKey = (env && env.OFCOM_BROADBAND_KEY) || POC_BROADBAND_KEY;
    const mobileKey    = (env && env.OFCOM_MOBILE_KEY)    || POC_MOBILE_KEY;

    const cache = caches.default;
    const cacheKey = new Request(`https://ofcom-cache/${product}/${postcode}`);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const wantBroadband = product === 'broadband' || product === 'both';
    const wantMobile    = product === 'mobile'    || product === 'both';

    const tasks = [];
    if (wantBroadband) tasks.push(fetchOfcom('broadband', postcode, broadbandKey));
    if (wantMobile)    tasks.push(fetchOfcom('mobile',    postcode, mobileKey));

    let results;
    try {
      results = await Promise.all(tasks);
    } catch (err) {
      return json({ error: 'fetch failed', detail: err.message, postcode }, 500);
    }

    const out = { postcode };
    let idx = 0;
    if (wantBroadband) { out.broadband = results[idx++]; }
    if (wantMobile)    { out.mobile    = results[idx++]; }

    const body = json(out, 200);
    body.headers.set('Cache-Control', 'public, max-age=86400');
    ctx.waitUntil(cache.put(cacheKey, body.clone()));
    return body;
  }
};

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
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}
