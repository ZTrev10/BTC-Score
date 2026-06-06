export default async function handler(req, res) {
  const endpoint = String(req.query.endpoint || '').trim();
  const allowed = new Set(['mvrv-zscore', 'puell-multiple', 'nupl']);

  if (!allowed.has(endpoint)) {
    return res.status(400).json({ error: 'Invalid BGeometrics endpoint.' });
  }

  const apiKey = process.env.BGEOMETRICS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing BGEOMETRICS_API_KEY in Vercel environment variables.' });
  }

  try {
    const upstream = await fetch(`https://api.bgeometrics.com/v1/${endpoint}?limit=1`, {
      headers: { 'x-api-key': apiKey }
    });

    const text = await upstream.text();
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');

    return res.status(upstream.status).send(text);
  } catch (error) {
    return res.status(502).json({ error: 'BGeometrics proxy request failed.' });
  }
}
