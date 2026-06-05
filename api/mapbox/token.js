// =====================================================================
// Vercel Edge Function — Mapbox public token provider
// =====================================================================
// Mapbox GL JS needs a token in the browser to load map tiles, so it can't
// be fully hidden — but we keep it OUT of the committed source (GitHub secret
// scanning blocks that) by serving it from a Vercel env var at request time,
// the same way OS_KEY is handled.
//
// Route:   GET /api/mapbox/token  ->  { "token": "pk.…" }
// Env var: MAPBOX_TOKEN  (Vercel dashboard → Settings → Environment Variables)
//
// Use a PUBLIC token (starts with "pk.") and restrict it to your site's URL
// in the Mapbox dashboard so it can't be reused elsewhere.
// =====================================================================

export const config = { runtime: 'edge' };

export default function handler() {
  const token = process.env.MAPBOX_TOKEN || '';
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // token rarely changes; let the edge cache it briefly
      'Cache-Control': token ? 'public, max-age=300, s-maxage=300' : 'no-store'
    }
  });
}
