import { yahooDaily } from './_history.js';

const DAY_MS = 86400000;
const WINDOWS = [
  { key: 'm1', label: '1M', days: 30 },
  { key: 'm3', label: '3M', days: 91 },
  { key: 'm6', label: '6M', days: 182 },
  { key: 'm12', label: '12M', days: 365 }
];

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
    const measured = rows.filter(r => Number.isFinite(r.alpha?.m6 ?? r.alpha?.m3 ?? r.alpha?.m1));
    const alphas = measured.map(r => r.alpha?.m6 ?? r.alpha?.m3 ?? r.alpha?.m1).filter(Number.isFinite);
    const winners = alphas.filter(v => v > 0).length;
    const avgAlpha = alphas.length ? alphas.reduce((a, b) => a + b, 0) / alphas.length : null;
    const best = measured.slice().sort((a, b) => (b.alpha?.m6 ?? b.alpha?.m3 ?? -Infinity) - (a.alpha?.m6 ?? a.alpha?.m3 ?? -Infinity))[0] || null;
    const worst = measured.slice().sort((a, b) => (a.alpha?.m6 ?? a.alpha?.m3 ?? Infinity) - (b.alpha?.m6 ?? b.alpha?.m3 ?? Infinity))[0] || null;
    return {
      username,
      posts: rows.length,
      measuredCalls: measured.length,
      winRate: alphas.length ? Math.round(winners / alphas.length * 100) : null,
      avgOutperformance: Number.isFinite(avgAlpha) ? Number(avgAlpha.toFixed(1)) : null,
      bestCall: best ? `${best.ticker} ${best.alpha?.m6 != null ? '6M' : '3M'} alpha ${Number(best.alpha?.m6 ?? best.alpha?.m3).toFixed(1)}%` : 'Not enough outcome history yet.',
      worstCall: worst ? `${worst.ticker} ${worst.alpha?.m6 != null ? '6M' : '3M'} alpha ${Number(worst.alpha?.m6 ?? worst.alpha?.m3).toFixed(1)}%` : 'Not enough outcome history yet.'
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
    const symbols = [...new Set([...posts.flatMap(p => p.tickers), 'SPY', 'QQQ'])].slice(0, 60);
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
        const spyRows = prices.SPY || [];
        const qqqRows = prices.QQQ || [];
        const start = nearestOnOrAfter(tickerRows, createdTs);
        const spyStart = nearestOnOrAfter(spyRows, createdTs);
        const qqqStart = nearestOnOrAfter(qqqRows, createdTs);
        const returns = {};
        const benchmarks = {};
        const alpha = {};
        WINDOWS.forEach(w => {
          const end = rowForWindow(tickerRows, createdTs, w.days);
          const spyEnd = rowForWindow(spyRows, createdTs, w.days);
          const qqqEnd = rowForWindow(qqqRows, createdTs, w.days);
          returns[w.key] = pctChange(end?.close, start?.close);
          benchmarks[w.key] = {
            spy: pctChange(spyEnd?.close, spyStart?.close),
            qqq: pctChange(qqqEnd?.close, qqqStart?.close)
          };
          const benchVals = [benchmarks[w.key].spy, benchmarks[w.key].qqq].filter(Number.isFinite);
          const bench = benchVals.length ? benchVals.reduce((a, b) => a + b, 0) / benchVals.length : null;
          alpha[w.key] = Number.isFinite(returns[w.key]) && Number.isFinite(bench) ? returns[w.key] - bench : null;
        });
        results.push({
          username: post.username,
          subreddit: post.subreddit,
          createdAt: post.createdAt,
          ticker,
          kind: post.kind,
          title: post.title,
          url: post.url,
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
      sources: ['Yahoo Finance daily chart', 'SPY and QQQ benchmark average']
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
