// Vercel proxy for CoinGecko — avoids browser-side rate limits on the free tier.
// Caches the heavy 1500-day market chart on the CDN for 6 hours.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const path = String(req.query.path || '').replace(/^\/+/, '');
  if (!path) return res.status(400).json({ error: 'Missing path parameter.' });

  // Only allow CoinGecko paths — block open-proxy abuse
  const allowedPrefixes = ['coins/bitcoin/', 'simple/price'];
  const allowed = allowedPrefixes.some(p => path.startsWith(p));
  if (!allowed) return res.status(400).json({ error: 'Path not allowed.' });

  // Forward any query params except our own `path` key
  const params = new URLSearchParams(req.query);
  params.delete('path');
  const qs = params.toString();
  const url = `https://api.coingecko.com/api/v3/${path}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TrevorMarketApp/1.0)',
        'Accept': 'application/json'
      }
    });

    const text = await upstream.text();
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.status(upstream.status).send(text);
  } catch (err) {
    return res.status(502).json({ error: 'CoinGecko proxy failed.', message: err instanceof Error ? err.message : String(err) });
  }
}
