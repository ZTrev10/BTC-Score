import { yahooDaily } from './_history.js';

const DAY_MS = 86400000;
const WINDOWS = [
  { key: 'm1', label: '1M', days: 30 },
  { key: 'm3', label: '3M', days: 91 },
  { key: 'm6', label: '6M', days: 182 },
  { key: 'm12', label: '12M', days: 365 }
];
const SECTOR_ETFS = {
  XLK: ['MSFT', 'AAPL', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'ADBE', 'AMD', 'PLTR', 'DDOG', 'CRWD', 'NET', 'SNOW', 'MDB', 'PANW', 'NOW'],
  XLC: ['GOOGL', 'GOOG', 'META', 'NFLX', 'DIS', 'TTD', 'SNAP', 'PINS', 'RDDT'],
  XLY: ['AMZN', 'TSLA', 'COST', 'TJX', 'ORLY', 'AZO', 'CPRT', 'HD', 'LOW', 'NKE', 'SBUX'],
  XLP: ['WMT', 'PG', 'KO', 'PEP', 'COST', 'CL', 'MDLZ'],
  XLV: ['UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'TMO', 'DHR', 'ISRG', 'TMDX', 'SYK', 'BSX', 'IDXX', 'RMD'],
  XLI: ['GE', 'HON', 'ETN', 'PWR', 'FIX', 'HWM', 'HUBB', 'EME', 'WCC', 'GWW', 'FAST', 'ROP', 'TDG'],
  XLF: ['JPM', 'BAC', 'V', 'MA', 'ICE', 'SPGI', 'MCO', 'BRO', 'AJG', 'AXP', 'COF'],
  XLE: ['XOM', 'CVX', 'COP', 'SLB', 'VST', 'CEG', 'GEV'],
  XLU: ['NEE', 'SO', 'DUK', 'VST', 'CEG', 'AEP'],
  ITA: ['LMT', 'RTX', 'NOC', 'GD', 'HWM', 'KTOS', 'AVAV', 'BWXT', 'TXT', 'BA'],
  PHO: ['XYL', 'MWA', 'AOS', 'WTS']
};

function json(res, status, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(status).json(body);
}

function cleanSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '');
}

function pctChange(today, prior) {
  if (!Number.isFinite(today) || !Number.isFinite(prior) || prior <= 0) return null;
  return (today - prior) / prior * 100;
}

function nearestOnOrAfter(rows, targetTs, maxForwardDays = 7) {
  const maxTs = targetTs + maxForwardDays * DAY_MS;
  return rows.find(row => {
    const ts = Date.parse(row.d);
    return Number.isFinite(ts) && ts >= targetTs && ts <= maxTs;
  }) || null;
}

function rowForWindow(rows, createdTs, days) {
  return nearestOnOrAfter(rows, createdTs + days * DAY_MS, 10);
}

function sectorBenchmarkFor(ticker) {
  for (const [etf, tickers] of Object.entries(SECTOR_ETFS)) {
    if (tickers.includes(ticker)) return etf;
  }
  return null;
}

function parsePosts(input) {
  const years = Math.max(1, Math.min(10, Number(input.years) || 2));
  const ddOnly = input.ddOnly !== false;
  const excludeOptions = input.excludeOptions !== false;
  const cutoff = Date.now() - years * 365.25 * DAY_MS;
  const posts = Array.isArray(input.posts) ? input.posts : [];
  return posts.map(post => ({
    username: String(post.username || post.author || '').replace(/^u\//, '').trim(),
    subreddit: String(post.subreddit || ''),
    createdAt: post.createdAt || post.created || post.date || null,
    title: String(post.title || ''),
    url: String(post.url || post.permalink || ''),
    kind: String(post.kind || ''),
    tickers: (Array.isArray(post.tickers) ? post.tickers : String(post.tickers || '').split(/[,\s;|]+/))
      .map(cleanSymbol)
      .filter(Boolean)
      .slice(0, 8)
  })).filter(post => {
    const ts = Date.parse(post.createdAt);
    if (!post.username || !Number.isFinite(ts) || !post.tickers.length || ts < cutoff) return false;
    if (ddOnly && !['Real DD', 'DD Candidate', 'Bear Case'].includes(post.kind)) return false;
    if (excludeOptions && /Options/.test(post.kind)) return false;
    return true;
  }).slice(0, 500);
}

function summarizeUsers(results) {
  const byUser = new Map();
  results.forEach(row => {
    if (!byUser.has(row.username)) byUser.set(row.username, []);
    byUser.get(row.username).push(row);
  });
  return [...byUser.entries()].map(([username, rows]) => {
    const alphaFor = r => r.alpha?.m6Sector ?? r.alpha?.m6 ?? r.alpha?.m3Sector ?? r.alpha?.m3 ?? r.alpha?.m1Sector ?? r.alpha?.m1;
    const measured = rows.filter(r => Number.isFinite(alphaFor(r)));
    const alphas = measured.map(alphaFor).filter(Number.isFinite);
    const winners = alphas.filter(v => v > 0).length;
    const avgAlpha = alphas.length ? alphas.reduce((a, b) => a + b, 0) / alphas.length : null;
    const best = measured.slice().sort((a, b) => alphaFor(b) - alphaFor(a))[0] || null;
    const worst = measured.slice().sort((a, b) => alphaFor(a) - alphaFor(b))[0] || null;
    const labelFor = r => r.alpha?.m6Sector != null ? `6M vs ${r.sectorBenchmark}` : r.alpha?.m6 != null ? '6M vs SPY/QQQ' : r.alpha?.m3Sector != null ? `3M vs ${r.sectorBenchmark}` : r.alpha?.m3 != null ? '3M vs SPY/QQQ' : r.alpha?.m1Sector != null ? `1M vs ${r.sectorBenchmark}` : '1M vs SPY/QQQ';
    return {
      username,
      posts: rows.length,
      measuredCalls: measured.length,
      winRate: alphas.length ? Math.round(winners / alphas.length * 100) : null,
      avgOutperformance: Number.isFinite(avgAlpha) ? Number(avgAlpha.toFixed(1)) : null,
      bestCall: best ? `${best.ticker} ${labelFor(best)} alpha ${Number(alphaFor(best)).toFixed(1)}%` : 'Not enough outcome history yet.',
      worstCall: worst ? `${worst.ticker} ${labelFor(worst)} alpha ${Number(alphaFor(worst)).toFixed(1)}%` : 'Not enough outcome history yet.'
    };
  }).sort((a, b) => (b.avgOutperformance ?? -999) - (a.avgOutperformance ?? -999));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const input = req.body || {};
    const posts = parsePosts(input);
    if (!posts.length) return json(res, 400, { ok: false, error: 'No valid posts supplied.' });

    const earliest = Math.min(...posts.map(p => Date.parse(p.createdAt)));
    const days = Math.max(45, Math.min(3700, Math.ceil((Date.now() - earliest) / DAY_MS) + 15));
    const postTickers = [...new Set(posts.flatMap(p => p.tickers))];
    const sectorSymbols = [...new Set(postTickers.map(sectorBenchmarkFor).filter(Boolean))];
    const symbols = [...new Set([...postTickers, 'SPY', 'QQQ', ...sectorSymbols])].slice(0, 80);
    const prices = {};
    await Promise.all(symbols.map(async symbol => {
      try {
        prices[symbol] = await yahooDaily(symbol, days, 15);
      } catch {
        prices[symbol] = [];
      }
    }));

    const results = [];
    posts.forEach(post => {
      const createdTs = Date.parse(post.createdAt);
      post.tickers.forEach(ticker => {
        const tickerRows = prices[ticker] || [];
        const sectorSymbol = sectorBenchmarkFor(ticker);
        const sectorRows = sectorSymbol ? prices[sectorSymbol] || [] : [];
        const spyRows = prices.SPY || [];
        const qqqRows = prices.QQQ || [];
        const start = nearestOnOrAfter(tickerRows, createdTs);
        const sectorStart = nearestOnOrAfter(sectorRows, createdTs);
        const spyStart = nearestOnOrAfter(spyRows, createdTs);
        const qqqStart = nearestOnOrAfter(qqqRows, createdTs);
        const returns = {};
        const benchmarks = {};
        const alpha = {};
        WINDOWS.forEach(w => {
          const end = rowForWindow(tickerRows, createdTs, w.days);
          const sectorEnd = rowForWindow(sectorRows, createdTs, w.days);
          const spyEnd = rowForWindow(spyRows, createdTs, w.days);
          const qqqEnd = rowForWindow(qqqRows, createdTs, w.days);
          returns[w.key] = pctChange(end?.close, start?.close);
          benchmarks[w.key] = {
            spy: pctChange(spyEnd?.close, spyStart?.close),
            qqq: pctChange(qqqEnd?.close, qqqStart?.close),
            sector: pctChange(sectorEnd?.close, sectorStart?.close),
            sectorSymbol
          };
          const benchVals = [benchmarks[w.key].spy, benchmarks[w.key].qqq].filter(Number.isFinite);
          const bench = benchVals.length ? benchVals.reduce((a, b) => a + b, 0) / benchVals.length : null;
          alpha[w.key] = Number.isFinite(returns[w.key]) && Number.isFinite(bench) ? returns[w.key] - bench : null;
          alpha[`${w.key}Sector`] = Number.isFinite(returns[w.key]) && Number.isFinite(benchmarks[w.key].sector) ? returns[w.key] - benchmarks[w.key].sector : null;
        });
        results.push({
          username: post.username,
          subreddit: post.subreddit,
          createdAt: post.createdAt,
          ticker,
          kind: post.kind,
          title: post.title,
          url: post.url,
          sectorBenchmark: sectorSymbol,
          startPrice: start?.close ?? null,
          startDate: start?.d ?? null,
          returns,
          benchmarks,
          alpha
        });
      });
    });

    return json(res, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      posts: posts.length,
      years: Math.max(1, Math.min(10, Number(input.years) || 2)),
      filters: {
        ddOnly: input.ddOnly !== false,
        excludeOptions: input.excludeOptions !== false,
        maxPosts: 500
      },
      tickers: symbols.filter(s => !['SPY', 'QQQ'].includes(s)),
      windows: WINDOWS,
      results,
      users: summarizeUsers(results),
      sources: ['Yahoo Finance daily chart', 'SPY and QQQ benchmark average', 'Sector ETF benchmark when mapped']
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
