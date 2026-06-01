// =====================================================================
// Vercel Edge Function — MHCLG EPC Register proxy
// =====================================================================
// Proxies the gov.uk Energy Performance of Buildings API so the bearer
// token stays server-side. Two modes:
//
//   Search:           GET /api/epc/lookup?postcode=UB2+4WQ
//                     GET /api/epc/lookup?uprn=72028900
//                     GET /api/epc/lookup?address=9+Union+Street
//   Cert detail:      GET /api/epc/lookup?cert=2150-3530-1169-1529-8222
//
// Env var: EPC_TOKEN  (Vercel dashboard → Settings → Environment Variables)
// =====================================================================

export const config = { runtime: 'edge' };

const API_BASE = 'https://api.get-energy-performance-data.communities.gov.uk';

// POC bearer — fallback before env var is set
const POC_EPC_TOKEN = '6hrbF3yHfqTt020tMuMju5DZ0XR0RYl9Hra658Y6I9sbnbVEW0zs2HVlNuMRNhbs';

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const postcode = (url.searchParams.get('postcode') || '').trim();
  const uprn     = (url.searchParams.get('uprn')     || '').trim();
  const address  = (url.searchParams.get('address')  || '').trim();
  const cert     = (url.searchParams.get('cert')     || '').trim();

  if (!postcode && !uprn && !address && !cert) {
    return json({ error: 'At least one of postcode / uprn / address / cert is required' }, 400);
  }

  const token = process.env.EPC_TOKEN || POC_EPC_TOKEN;
  if (!token) {
    return json({ error: 'EPC_TOKEN not configured' }, 500);
  }

  if (cert) {
    return await fetchCert(cert, token);
  }
  return await fetchSearch({ postcode, uprn, address }, token);
}

async function fetchCert(cert, token) {
  const certUrl = `${API_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`;
  try {
    const res = await fetch(certUrl, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return json({ error: `EPC API returned HTTP ${res.status}`, detail: text.slice(0, 300), cert }, 502);
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
    return new Response(JSON.stringify(out, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400'
      }
    });
  } catch (err) {
    return json({ error: 'EPC cert fetch failed', detail: err.message, cert }, 500);
  }
}

async function fetchSearch({ postcode, uprn, address }, token) {
  const params = new URLSearchParams();
  if (postcode) params.append('postcode', postcode);
  if (uprn)     params.append('uprn', uprn.padStart(12, '0'));
  if (address)  params.append('address', address);
  params.append('page_size', '500');
  const upstreamUrl = `${API_BASE}/api/domestic/search?${params.toString()}`;

  try {
    const res = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return json({
        error: `EPC API returned HTTP ${res.status}`,
        detail: text.slice(0, 300),
        query: { postcode, uprn, address }
      }, 502);
    }
    const data = await res.json();
    const records = data.data || [];
    const certs = records.map(r => ({
      rrn:                r.certificateNumber || null,
      uprn:               r.uprn != null ? String(r.uprn) : null,
      addressLine1:       r.addressLine1 || null,
      addressLine2:       r.addressLine2 || null,
      addressLine3:       r.addressLine3 || null,
      addressLine4:       r.addressLine4 || null,
      postcode:           r.postcode || null,
      postTown:           r.postTown || null,
      council:            r.council || null,
      constituency:       r.constituency || null,
      currentEnergyBand:  r.currentEnergyEfficiencyBand || null,
      registrationDate:   r.registrationDate || null,
      certUrl:            r.certificateNumber
        ? `https://find-energy-certificate.service.gov.uk/energy-certificate/${r.certificateNumber}`
        : null
    }));
    return new Response(JSON.stringify({
      query: { postcode, uprn, address },
      pagination: data.pagination || null,
      count: certs.length,
      certs
    }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400'
      }
    });
  } catch (err) {
    return json({ error: 'EPC search fetch failed', detail: err.message }, 500);
  }
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}