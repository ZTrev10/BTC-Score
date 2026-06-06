// Yahoo Finance public quote API — no key required
// Returns current price, % change from previous close, and volume for each symbol

const DEFAULT_SYMBOLS = [
  'META','GOOGL','AMZN','MSFT','ASML','TSM','V','MA','ISRG','CPRT','FIX','PWR','AXON','CRWD','DDOG','TMDX',
  'KTOS','HWM','BWXT','VST','ETN','HUBB','XYL','MWA',
  'NVDA','GOOGL','AMZN','MSFT','AAPL'          // reference names
];

const COMPANY_HINTS = {
  META: 'Meta Platforms',
  GOOGL: 'Alphabet',
  AMZN: 'Amazon',
  MSFT: 'Microsoft',
  ASML: 'ASML Holding',
  TSM: 'Taiwan Semiconductor',
  V: 'Visa',
  MA: 'Mastercard',
  ISRG: 'Intuitive Surgical',
  CPRT: 'Copart',
  FIX: 'Comfort Systems USA',
  PWR: 'Quanta Services',
  AXON: 'Axon Enterprise',
  CRWD: 'CrowdStrike',
  DDOG: 'Datadog',
  TMDX: 'TransMedics',
  KTOS: 'Kratos Defense',
  HWM: 'Howmet Aerospace',
  BWXT: 'BWX Technologies',
  VST: 'Vistra',
  ETN: 'Eaton',
  HUBB: 'Hubbell',
  XYL: 'Xylem',
  MWA: 'Mueller Water Products'
};

function stripHtml(input = '') {
  return String(input).replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}

function extractNewsItems(xml, symbol) {
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  return blocks.slice(0, 3).map(block => ({
    symbol,
    title: stripHtml((block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || block.match(/<title>([\s\S]*?)<\/title>/) || [,''])[1]),
    link: stripHtml((block.match(/<link>([\s\S]*?)<\/link>/) || [,''])[1]),
    published: stripHtml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [,''])[1]),
    source: stripHtml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [,'Google News'])[1])
  })).filter(item => item.title);
}

function severityFromHeadline(title = '') {
  const text = title.toLowerCase();
  if (/(fraud|bankrupt|bankruptcy|sec probe|criminal|restatement|default|insolvency)/.test(text)) return 90;
  if (/(misses|cuts guidance|downgrade|lawsuit|probe|investigation|halts|recall|short seller)/.test(text)) return 68;
  if (/(falls|slides|drops|selloff|slumps|weak|concern|pressure|tariff|regulation)/.test(text)) return 48;
  return 34;
}

async function fetchSymbolNews(symbol, name) {
  const q = `${symbol} ${name || COMPANY_HINTS[symbol] || ''} stock news earnings`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TrevorMarketApp/1.0' } });
  if (!upstream.ok) return [];
  return extractNewsItems(await upstream.text(), symbol).map(item => ({
    ...item,
    severity: severityFromHeadline(item.title)
  }));
}

async function fetchChartQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrevorMarketApp/1.0)' }
  });
  if (!upstream.ok) return null;
  const raw = await upstream.json();
  const result = raw?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const price = meta.regularMarketPrice ?? null;
  const prevClose = meta.chartPreviousClose ?? null;
  const changePercent = price != null && prevClose ? ((price - prevClose) / prevClose) * 100 : null;
  return {
    symbol,
    name: meta.shortName || meta.longName || COMPANY_HINTS[symbol] || symbol,
    price,
    changePercent,
    prevClose,
    volume: meta.regularMarketVolume ?? quote.volume?.at?.(-1) ?? null,
    dayLow: meta.regularMarketDayLow ?? quote.low?.at?.(-1) ?? null,
    dayHigh: meta.regularMarketDayHigh ?? quote.high?.at?.(-1) ?? null
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const rawSymbols = String(req.query.symbols || '').trim();
  const symbols = rawSymbols
    ? rawSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 30)
    : DEFAULT_SYMBOLS;

  try {
    const quotes = (await Promise.all(symbols.map(fetchChartQuote))).filter(Boolean);

    const newsBySymbol = {};
    const candidates = quotes
      .filter(q => Number(q.changePercent) <= -4.5)
      .slice(0, 8);
    await Promise.all(candidates.map(async q => {
      try {
        newsBySymbol[q.symbol] = await fetchSymbolNews(q.symbol, q.name);
      } catch {
        newsBySymbol[q.symbol] = [];
      }
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ updatedAt: new Date().toISOString(), quotes, newsBySymbol });
  } catch (err) {
    return res.status(502).json({ error: 'Screener fetch failed.', message: err instanceof Error ? err.message : String(err) });
  }
}
