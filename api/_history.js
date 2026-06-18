const DAY_MS = 86400000;

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function pctChange(today, prior) {
  if (!Number.isFinite(today) || !Number.isFinite(prior) || prior <= 0) return null;
  return (today - prior) / prior * 100;
}

function dateKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'BTC-Score-Historical-Backfill/1.0'
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.error?.description || body?.error || text || response.statusText;
    throw new Error(`${url} failed (${response.status}): ${message}`);
  }
  return body;
}

async function yahooDaily(symbol, days, extraDays = 10) {
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor((Date.now() - (days + extraDays) * DAY_MS) / 1000);
  const encoded = encodeURIComponent(symbol);
  const body = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?period1=${start}&period2=${end}&interval=1d&includePrePost=false`);
  const result = body?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = result?.indicators?.adjclose?.[0]?.adjclose || quote.close || [];
  return timestamps.map((unixTs, idx) => ({
    d: dateKey(unixTs * 1000),
    unixTs,
    close: Number(closes[idx])
  })).filter(row => row.d && Number.isFinite(row.close));
}

async function fearGreedHistory(days) {
  const body = await fetchJson(`https://api.alternative.me/fng/?limit=${Math.max(1, days + 5)}&format=json`);
  const map = new Map();
  (body?.data || []).forEach(row => {
    const ts = Number(row.timestamp) * 1000;
    if (!Number.isFinite(ts)) return;
    map.set(dateKey(ts), {
      value: Number(row.value),
      classification: row.value_classification || ''
    });
  });
  return map;
}

function movingAverage(rows, idx, window) {
  if (idx + 1 < window) return null;
  let total = 0;
  for (let i = idx - window + 1; i <= idx; i += 1) total += rows[i].close;
  return total / window;
}

function priceVsScore(vs200w) {
  if (!Number.isFinite(vs200w)) return null;
  if (vs200w <= -20) return 8;
  if (vs200w <= 0) return 18 + (vs200w + 20) * 0.5;
  if (vs200w <= 50) return 25 + vs200w * 0.36;
  if (vs200w <= 150) return 43 + (vs200w - 50) * 0.26;
  return 72 + Math.min(23, (vs200w - 150) * 0.08);
}

function momentumScore(move30d) {
  if (!Number.isFinite(move30d)) return 50;
  if (move30d <= -35) return 12;
  if (move30d <= -15) return 22;
  if (move30d <= 10) return 35 + move30d * 0.9;
  if (move30d <= 50) return 50 + (move30d - 10) * 0.55;
  return 72;
}

function estimatedBtcScore({ fearGreed, priceVs200w, move30d }) {
  const fng = Number.isFinite(fearGreed) ? fearGreed : 50;
  const ma = priceVsScore(priceVs200w);
  const mom = momentumScore(move30d);
  const score = Math.round(clamp(fng * 0.35 + (ma ?? 50) * 0.45 + mom * 0.20));
  let label = 'Neutral estimate';
  if (score <= 20) label = 'Deep value estimate';
  else if (score <= 35) label = 'Accumulation estimate';
  else if (score <= 55) label = 'Neutral estimate';
  else if (score <= 75) label = 'Elevated risk estimate';
  else label = 'Cycle heat estimate';
  return { score, label };
}

function marketRegimeFor(date, prices) {
  const spy = prices.SPY?.get(date)?.move1d ?? null;
  const qqq = prices.QQQ?.get(date)?.move1d ?? null;
  const iwm = prices.IWM?.get(date)?.move1d ?? null;
  const tlt = prices.TLT?.get(date)?.move1d ?? null;
  const riskMoves = [spy, qqq, iwm].filter(Number.isFinite);
  const avgRisk = riskMoves.length ? riskMoves.reduce((a, b) => a + b, 0) / riskMoves.length : 0;
  let label = 'Neutral / balanced';
  let risk = 'neutral';
  if (avgRisk <= -1.5 || (Number.isFinite(qqq) && qqq <= -2)) {
    label = 'Risk-off / quality-first';
    risk = 'off';
  } else if (avgRisk >= 1.2 && (Number.isFinite(qqq) ? qqq >= 0 : true)) {
    label = 'Risk-on / growth-friendly';
    risk = 'on';
  }
  if (Number.isFinite(tlt) && tlt <= -1.2 && risk !== 'on') {
    label = 'Rates pressure / duration-sensitive';
    risk = 'rates';
  }
  return { label, risk, avgRisk, spy, qqq, iwm, tlt };
}

function toPriceMap(rows) {
  const map = new Map();
  rows.forEach((row, idx) => {
    const prev = rows[idx - 1]?.close;
    map.set(row.d, {
      price: row.close,
      move1d: pctChange(row.close, prev)
    });
  });
  return map;
}

function watchlistRowsFor(date, tickers, prices) {
  return tickers.map(ticker => {
    const row = prices[ticker]?.get(date);
    if (!row) return null;
    return {
      ticker,
      name: ticker,
      source: 'Historical Backfill',
      score: null,
      action: 'PRICE HISTORY',
      price: row.price,
      move: row.move1d,
      notes: 'Historical daily close from Yahoo chart data.'
    };
  }).filter(Boolean);
}

async function generateHistoricalBackfill({ days = 365, tickers = [] } = {}) {
  const boundedDays = Math.max(30, Math.min(1460, Number(days) || 365));
  const cleanTickers = [...new Set((tickers || []).map(t => String(t || '').trim().toUpperCase()).filter(Boolean))].slice(0, 25);
  const marketSymbols = ['SPY', 'QQQ', 'IWM', 'TLT', 'VOO'];
  const symbols = [...new Set([...marketSymbols, ...cleanTickers])];
  const btcRows = await yahooDaily('BTC-USD', boundedDays, 1500);
  const fearGreed = await fearGreedHistory(boundedDays);
  const priceSeries = {};
  await Promise.all(symbols.map(async symbol => {
    try {
      priceSeries[symbol] = toPriceMap(await yahooDaily(symbol, boundedDays, 35));
    } catch {
      priceSeries[symbol] = new Map();
    }
  }));

  const snapshots = [];
  btcRows.forEach((row, idx) => {
    if (idx < btcRows.length - boundedDays) return;
    const ma200w = movingAverage(btcRows, idx, 1400);
    const prior30 = btcRows[idx - 30]?.close;
    const priceVs200w = ma200w ? pctChange(row.close, ma200w) : null;
    const move30d = pctChange(row.close, prior30);
    const fg = fearGreed.get(row.d);
    const estimate = estimatedBtcScore({
      fearGreed: fg?.value,
      priceVs200w,
      move30d
    });
    const marketRegime = marketRegimeFor(row.d, priceSeries);
    const watchlistScores = watchlistRowsFor(row.d, cleanTickers, priceSeries);
    snapshots.push({
      id: `hist_${row.d}`,
      createdAt: `${row.d}T16:00:00.000Z`,
      eventType: 'Historical Backfill',
      notes: 'Historical estimate. BGeometrics on-chain fields are intentionally left blank unless separately backfilled from BGeometrics.',
      historicalBackfill: true,
      btc: {
        score: estimate.score,
        label: estimate.label,
        price: row.close,
        historicalEstimate: true,
        inputs: {
          fearGreed: fg ? { value: fg.value, classification: fg.classification } : null,
          priceVs200w,
          movingAverage200w: ma200w,
          move30d,
          mvrvZscore: null,
          nupl: null,
          puellMultiple: null,
          priceVsRealized: null
        }
      },
      marketRegime,
      opportunities: [],
      watchlistScores,
      research: null,
      portfolio: { total: 0, cashValue: 0, cashPct: 0, holdings: 0, allocations: [], concentration: [] },
      headlines: []
    });
  });

  return {
    ok: true,
    days: boundedDays,
    tickers: cleanTickers,
    sources: {
      btc: 'Yahoo Finance BTC-USD daily chart',
      fearGreed: 'Alternative.me Fear & Greed history',
      market: 'Yahoo Finance ETF daily chart',
      watchlistPrices: cleanTickers.length ? 'Yahoo Finance ticker daily chart' : 'not requested',
      onchain: 'not backfilled in this free route'
    },
    snapshots
  };
}

export { generateHistoricalBackfill };
