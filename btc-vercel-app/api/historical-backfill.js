import { generateHistoricalBackfill } from './_history.js';

function json(res, status, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(status).json(body);
}

function parseTickers(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
  try {
    const input = req.method === 'POST' ? req.body || {} : req.query || {};
    const data = await generateHistoricalBackfill({
      days: input.days,
      tickers: parseTickers(input.tickers)
    });
    return json(res, 200, data);
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
