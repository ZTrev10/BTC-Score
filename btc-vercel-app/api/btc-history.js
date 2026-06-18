import { yahooDaily } from './_history.js';

function json(res, status, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const days = Math.max(365, Math.min(2000, Number(req.query.days) || 1500));
    const rows = await yahooDaily('BTC-USD', days, 35);
    const prices = rows.map(row => [row.unixTs * 1000, row.close]);
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    return json(res, 200, {
      ok: true,
      source: 'yahoo-server',
      days,
      prices
    });
  } catch (error) {
    return json(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
