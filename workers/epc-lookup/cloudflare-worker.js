// =====================================================================
// EPC Lookup — Cloudflare Worker
// =====================================================================
// Serverless proxy that the NHS Address Finder calls from the browser
// to fetch EPC certificates by postcode / UPRN / address.
//
// Why a Worker:
//   - The MHCLG EPC API does not allow cross-origin browser calls
//   - The Bearer token must stay off the partner-facing client
//   - We want per-postcode edge caching (24h TTL) for free
//
// Setup:
//   wrangler secret put EPC_TOKEN
//   # paste: 6hrbF3yHfqTt020tMuMju5DZ0XR0RYl9Hra658Y6I9sbnbVEW0zs2HVlNuMRNhbs
//
// Deploy:
//   wrangler deploy
//
// Endpoint (after deploy):
//   GET https://epc-lookup.<your-subdomain>.workers.dev/?postcode=UB2+4WQ
//   GET https://epc-lookup.<your-subdomain>.workers.dev/?uprn=000072028894
//   GET https://epc-lookup.<your-subdomain>.workers.dev/?address=9+Union+Street
// =====================================================================

const API_BASE = 'https://api.get-energy-performance-data.communities.gov.uk';

// POC token — kept inline by request 14 May 2026.
// For production, replace with `env.EPC_TOKEN` (wrangler secret put EPC_TOKEN)
// and delete this constant.
const POC_TOKEN = '6hrbF3yHfqTt020tMuMju5DZ0XR0RYl9Hra658Y6I9sbnbVEW0zs2HVlNuMRNhbs';

// Allow-list of origins permitted to call this Worker. Anything else gets
// blocked by the browser (we omit Access-Control-Allow-Origin entirely).
// Vary: Origin keeps Cloudflare's edge cache honest across origins.
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
  // Cached responses are origin-agnostic; re-emit with this request's CORS.
  const headers = new Headers(cached.headers);
  headers.set('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
  headers.set('Vary', 'Origin');
  return new Response(cached.body, { status: cached.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const CORS_HEADERS = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const postcode = (url.searchParams.get('postcode') || '').trim();
    const uprn     = (url.searchParams.get('uprn') || '').trim();
    const address  = (url.searchParams.get('address') || '').trim();
    const cert     = (url.searchParams.get('cert') || '').trim();

    if (!postcode && !uprn && !address && !cert) {
      return json({ error: 'At least one of postcode / uprn / address / cert is required' }, 400, CORS_HEADERS);
    }

    // Prefer the env secret (production); fall back to inline POC token.
    const token = (env && env.EPC_TOKEN) || POC_TOKEN;
    if (!token) {
      return json({ error: 'EPC_TOKEN not configured' }, 500, CORS_HEADERS);
    }

    // ── Single-certificate detail mode (for the EPC ladder lightbox) ──
    if (cert) {
      const certCacheKey = new Request(`https://epc-cache/cert/${encodeURIComponent(cert)}`);
      const certCached = await caches.default.match(certCacheKey);
      if (certCached) return reCorsCached(certCached, CORS_HEADERS);

      const certUrl = `${API_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`;
      try {
        const res = await fetch(certUrl, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return json({ error: `EPC API returned HTTP ${res.status}`, detail: text.slice(0, 300), cert }, 502, CORS_HEADERS);
        }
        const raw = await res.json();
        const d = raw.data || {};
        const out = {
          rrn:                  cert,
          uprn:                 d.uprn != null ? String(d.uprn) : null,
          addressLine1:         d.address_line_1 || null,
          addressLine2:         d.address_line_2 || null,
          postcode:             d.postcode || null,
          postTown:             d.post_town || null,
          currentEnergyBand:    d.current_energy_efficiency_band || null,
          currentEnergyScore:   d.energy_rating_current ?? null,
          potentialEnergyBand:  d.potential_energy_efficiency_band || null,
          potentialEnergyScore: d.energy_rating_potential ?? null,
          co2Current:           d.co2_emissions_current ?? null,
          co2Potential:         d.co2_emissions_potential ?? null,
          envImpactCurrent:     d.environmental_impact_current ?? null,
          envImpactPotential:   d.environmental_impact_potential ?? null,
          energyConsumptionCurrent:   d.energy_consumption_current ?? null,
          energyConsumptionPotential: d.energy_consumption_potential ?? null,
          totalFloorArea:       d.total_floor_area ?? null,
          inspectionDate:       d.inspection_date || null,
          registrationDate:     d.registration_date || null,
          assessmentType:       d.assessment_type || null,
          dwellingType:         (d.dwelling_type && d.dwelling_type.value) || null,
          certUrl:              `https://find-energy-certificate.service.gov.uk/energy-certificate/${cert}`
        };
        const body = json(out, 200, CORS_HEADERS);
        body.headers.set('Cache-Control', 'public, max-age=86400');
        ctx.waitUntil(caches.default.put(certCacheKey, body.clone()));
        return body;
      } catch (err) {
        return json({ error: 'fetch failed', detail: err.message, cert }, 500, CORS_HEADERS);
      }
    }

    // Cache-key by the full query so repeat lookups hit the edge cache
    const cache = caches.default;
    const cacheKey = new Request(`https://epc-cache/${url.search}`);
    const cached = await cache.match(cacheKey);
    if (cached) return reCorsCached(cached, CORS_HEADERS);

    const params = new URLSearchParams();
    if (postcode) params.append('postcode', postcode);
    if (uprn)     params.append('uprn', uprn.padStart(12, '0'));
    if (address)  params.append('address', address);
    params.append('page_size', '500');     // grab whole result in one call
    const upstreamUrl = `${API_BASE}/api/domestic/search?${params.toString()}`;

    try {
      const res = await fetch(upstreamUrl, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return json({
          error: `EPC API returned HTTP ${res.status}`,
          detail: text.slice(0, 300),
          query: { postcode, uprn, address }
        }, 502, CORS_HEADERS);
      }
      const data = await res.json();
      const records = data.data || [];

      // Trim to fields the Address Finder needs, normalise camelCase
      const certs = records.map(r => ({
        rrn:                     r.certificateNumber || null,
        uprn:                    r.uprn != null ? String(r.uprn) : null,
        addressLine1:            r.addressLine1 || null,
        addressLine2:            r.addressLine2 || null,
        addressLine3:            r.addressLine3 || null,
        addressLine4:            r.addressLine4 || null,
        postcode:                r.postcode || null,
        postTown:                r.postTown || null,
        council:                 r.council || null,
        constituency:            r.constituency || null,
        currentEnergyBand:       r.currentEnergyEfficiencyBand || null,
        registrationDate:        r.registrationDate || null,
        certUrl:                 r.certificateNumber
          ? `https://find-energy-certificate.service.gov.uk/energy-certificate/${r.certificateNumber}`
          : null
      }));

      const body = json({
        query: { postcode, uprn, address },
        pagination: data.pagination || null,
        count: certs.length,
        certs
      }, 200, CORS_HEADERS);
      // 24h edge cache
      body.headers.set('Cache-Control', 'public, max-age=86400');
      ctx.waitUntil(cache.put(cacheKey, body.clone()));
      return body;
    } catch (err) {
      return json({ error: 'fetch failed', detail: err.message }, 500, CORS_HEADERS);
    }
  }
};

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors
    }
  });
}
