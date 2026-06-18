const ALLOWED_ENDPOINTS = new Set(['mvrv-zscore', 'puell-multiple', 'nupl', 'realized-price', 'price']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const apiKey = process.env.BGEOMETRICS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing BGEOMETRICS_API_KEY in Vercel environment variables.' });

  const endpoint = String(req.query.endpoint || '').trim();
  if (!ALLOWED_ENDPOINTS.has(endpoint)) return res.status(400).json({ error: 'Invalid endpoint.', allowed: Array.from(ALLOWED_ENDPOINTS) });

  const limit = Number.parseInt(req.query.limit || '1', 10);
  const safeLimit = Number.isFinite(limit) && limit > 0 && limit <= 100 ? limit : 1;

  try {
    const upstream = await fetch(`https://api.bgeometrics.com/v1/${endpoint}?limit=${safeLimit}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'BGeometrics request failed.', status: upstream.status, endpoint, details: data });
    }

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    return res.status(200).json({ endpoint, fetchedAt: new Date().toISOString(), data });
  } catch (err) {
    return res.status(502).json({ error: 'BGeometrics proxy request failed.', message: err instanceof Error ? err.message : String(err) });
  }
}
