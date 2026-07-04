// =====================================================================
// Vercel Edge Function — HM Land Registry comparable-sales average
// =====================================================================
// Backs the "Make an Offer" page. Given a postcode + property type it:
//   1. postcodes.io   → centroid + nearby postcodes (~1 mile)
//   2. HM Land Registry Price Paid Data (open SPARQL, NO API key)
//                      → sold transactions for those postcodes + type
//   3. Computes the average sold price used for the offer meter.
//
// Neither postcodes.io nor the Land Registry SPARQL endpoint needs an
// API key, so there are no secrets to configure — this "just works" on
// Vercel. Mirrors the Apex NHSPriceTrendController in the main SF app.
//
// Route: GET /api/hmlr/comps?postcode=B91+3ST&type=D&years=3
//   type: D=Detached  S=Semi  T=Terraced  F=Flat  (defaults to all)
// =====================================================================

export const config = { runtime: 'edge' };

const POSTCODES_BASE = 'https://api.postcodes.io';
const LR_SPARQL      = 'https://landregistry.data.gov.uk/landregistry/query';
const RADIUS_M       = 1600;   // ~1 mile (postcodes.io caps at 2000m/call)
const MAX_POSTCODES  = 40;     // keep the SPARQL VALUES clause sane
const VALID_TYPES    = { D: 'detached', S: 'semi-detached', T: 'terraced', F: 'flat' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'GET')     return json({ error: 'Method not allowed' }, 405);

  const url      = new URL(request.url);
  const postcode = (url.searchParams.get('postcode') || '').trim().toUpperCase();
  const type     = (url.searchParams.get('type') || '').trim().toUpperCase();
  const years    = Math.min(10, Math.max(1, parseInt(url.searchParams.get('years') || '3', 10) || 3));
  if (!postcode) return json({ error: 'postcode query param is required' }, 400);

  try {
    // 1 — centroid ----------------------------------------------------
    const cRes = await fetch(`${POSTCODES_BASE}/postcodes/${encodeURIComponent(postcode)}`);
    if (!cRes.ok) return json({ error: 'Postcode not found', postcode }, 404);
    const cJson = await cRes.json();
    const { longitude: lon, latitude: lat } = cJson.result || {};
    if (lon == null) return json({ error: 'No centroid for postcode', postcode }, 404);

    // 2 — nearby postcodes within ~1 mile -----------------------------
    const nRes = await fetch(
      `${POSTCODES_BASE}/postcodes?lon=${lon}&lat=${lat}&radius=${RADIUS_M}&limit=100`
    );
    const nJson = nRes.ok ? await nRes.json() : { result: [] };
    let postcodes = (nJson.result || []).map(p => p.postcode);
    if (!postcodes.includes(postcode)) postcodes.unshift(postcode);
    postcodes = postcodes.slice(0, MAX_POSTCODES);

    // 3 — Land Registry Price Paid average ----------------------------
    const sparql = buildSparql(postcodes, type, years);
    const lrRes = await fetch(`${LR_SPARQL}?query=${encodeURIComponent(sparql)}`, {
      headers: { Accept: 'application/sparql-results+json' }
    });
    if (!lrRes.ok) {
      const detail = await lrRes.text();
      return json({ error: 'Land Registry query failed', status: lrRes.status, detail: detail.slice(0, 300) }, 502);
    }
    const lrJson = await lrRes.json();
    const rows   = (lrJson.results && lrJson.results.bindings) || [];

    const prices = rows
      .map(r => parseFloat(r.amount && r.amount.value))
      .filter(v => !isNaN(v) && v > 0);

    if (!prices.length) {
      return json({
        postcode, type: VALID_TYPES[type] || 'all', years,
        postcodesSearched: postcodes.length, comps: 0,
        average: null, message: 'No comparable sales found for this type/area.'
      });
    }

    prices.sort((a, b) => a - b);
    const sum   = prices.reduce((a, b) => a + b, 0);
    const avg   = Math.round(sum / prices.length);
    const median = prices[Math.floor(prices.length / 2)];

    return json({
      postcode,
      type: VALID_TYPES[type] || 'all',
      years,
      postcodesSearched: postcodes.length,
      comps: prices.length,
      average: avg,
      median,
      low: prices[0],
      high: prices[prices.length - 1],
      centroid: { lon, lat }
    });
  } catch (err) {
    return json({ error: 'comps lookup failed', detail: err.message }, 502);
  }
}

// Build a SPARQL query for average sold price across a set of postcodes,
// optionally constrained to one property type, within the last N years.
function buildSparql(postcodes, type, years) {
  const values = postcodes.map(p => `"${p.replace(/"/g, '')}"`).join(' ');
  const cutoff = `${new Date().getUTCFullYear() - years}-01-01`;
  // Land Registry represents property type as a URI under lrcommon:, e.g.
  // lrcommon:detached / semi-detached / terraced / flat-maisonette
  let typeFilter = '';
  if (VALID_TYPES[type]) {
    const slug = type === 'F' ? 'flat-maisonette' : VALID_TYPES[type];
    typeFilter = `;\n          ppd:propertyType lrcommon:${slug}`;
  }
  return `
    PREFIX ppd: <http://landregistry.data.gov.uk/def/ppi/>
    PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
    SELECT ?amount WHERE {
      VALUES ?pc { ${values} }
      ?addr lrcommon:postcode ?pc .
      ?tx ppd:propertyAddress ?addr ;
          ppd:pricePaid ?amount ;
          ppd:transactionDate ?date${typeFilter} .
      FILTER(?date >= "${cutoff}"^^<http://www.w3.org/2001/XMLSchema#date>)
    }
    LIMIT 800`;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=86400, s-maxage=86400' : 'no-store'
    }
  });
}