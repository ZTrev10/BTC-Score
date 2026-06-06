// Yahoo Finance public quote API — no key required
// Returns current price, % change from previous close, and volume for each symbol

const DEFAULT_SYMBOLS = [
  'META','CPRT','FIX','PWR','AXON','TMDX',   // core watchlist
  'KTOS','MWA',                                 // emerging leaders
  'NVDA','GOOGL','AMZN','MSFT','AAPL'          // reference names
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const rawSymbols = String(req.query.symbols || '').trim();
  const symbols = rawSymbols
    ? rawSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 30)
    : DEFAULT_SYMBOLS;

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose,shortName,regularMarketVolume,regularMarketDayLow,regularMarketDayHigh`;
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrevorMarketApp/1.0)' }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Yahoo Finance request failed.', status: upstream.status });
    }

    const raw = await upstream.json();
    const results = raw?.quoteResponse?.result || [];

    const quotes = results.map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.symbol,
      price: q.regularMarketPrice ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      prevClose: q.regularMarketPreviousClose ?? null,
      volume: q.regularMarketVolume ?? null,
      dayLow: q.regularMarketDayLow ?? null,
      dayHigh: q.regularMarketDayHigh ?? null
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ updatedAt: new Date().toISOString(), quotes });
  } catch (err) {
    return res.status(502).json({ error: 'Screener fetch failed.', message: err instanceof Error ? err.message : String(err) });
  }
}
