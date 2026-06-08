function stripHtml(input = '') {
  return String(input).replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function latestFact(facts, names, unit = 'USD') {
  const usgaap = facts?.facts?.['us-gaap'] || {};
  for (const name of names) {
    const units = usgaap[name]?.units || {};
    const rows = units[unit] || units.shares || units.pure || Object.values(units)[0] || [];
    const sorted = rows
      .filter(r => r.form && ['10-K', '10-Q'].includes(r.form) && num(r.val) !== null)
      .sort((a, b) => String(b.end || '').localeCompare(String(a.end || '')));
    if (sorted.length) return { name, ...sorted[0], value: num(sorted[0].val) };
  }
  return null;
}

function scoreFromRange(value, ranges) {
  if (value === null || !Number.isFinite(value)) return 50;
  for (const [max, score] of ranges) if (value <= max) return score;
  return ranges.at(-1)?.[1] ?? 50;
}

function calcScores({ quote, facts, news }) {
  const revenue = latestFact(facts, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet']);
  const netIncome = latestFact(facts, ['NetIncomeLoss']);
  const opIncome = latestFact(facts, ['OperatingIncomeLoss']);
  const assets = latestFact(facts, ['Assets']);
  const liabilities = latestFact(facts, ['Liabilities']);
  const cash = latestFact(facts, ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents']);
  const shares = latestFact(facts, ['CommonStocksIncludingAdditionalPaidInCapital'], 'USD') || latestFact(facts, ['EntityCommonStockSharesOutstanding'], 'shares');
  const marketCap = quote?.price && quote?.sharesOutstanding ? quote.price * quote.sharesOutstanding : null;
  const netMargin = revenue?.value ? (netIncome?.value || opIncome?.value || 0) / revenue.value : null;
  const debtRatio = assets?.value ? (liabilities?.value || 0) / assets.value : null;
  const ps = marketCap && revenue?.value ? marketCap / revenue.value : null;
  const profitability = scoreFromRange(netMargin, [[-0.1, 25], [0, 42], [0.08, 58], [0.18, 74], [0.35, 86], [Infinity, 92]]);
  const balance = scoreFromRange(debtRatio, [[0.25, 88], [0.45, 76], [0.65, 60], [0.85, 42], [Infinity, 28]]);
  const scale = revenue?.value ? Math.min(92, Math.max(40, 45 + Math.log10(Math.max(1, revenue.value / 1e9)) * 13)) : 50;
  const valuation = scoreFromRange(ps, [[2, 82], [5, 68], [10, 52], [20, 36], [Infinity, 24]]);
  const move = quote?.changePercent;
  const opportunity = Math.round(Math.max(35, Math.min(88, valuation + (move < 0 ? Math.min(18, Math.abs(move) * 2.2) : -Math.min(12, move || 0)))));
  const severeNews = news.some(n => n.thesisRisk === 'thesis-breaking' || n.severity >= 80);
  const verifyNews = news.some(n => n.thesisRisk === 'verify');
  const thesis = severeNews ? 45 : verifyNews ? 60 : 68;
  const fundamental = Math.round(profitability * 0.34 + balance * 0.26 + scale * 0.24 + (cash?.value ? 70 : 50) * 0.16);
  const macro = 55;
  const confidence = Math.round((quote?.price ? 25 : 0) + (facts ? 35 : 0) + (news.length ? 20 : 5) + (revenue?.value ? 20 : 0));
  return {
    fundamental: Math.round(fundamental),
    thesis,
    valuationScore: Math.round(valuation),
    macroScore: macro,
    opportunity,
    confidence: Math.min(90, confidence),
    metrics: {
      revenue: revenue?.value ?? null,
      netIncome: netIncome?.value ?? null,
      operatingIncome: opIncome?.value ?? null,
      cash: cash?.value ?? null,
      assets: assets?.value ?? null,
      liabilities: liabilities?.value ?? null,
      netMargin,
      debtRatio,
      priceToSales: ps
    }
  };
}

function hoursOld(pubDate) {
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 36e5;
}

function severityFromHeadline(title = '') {
  const text = title.toLowerCase();
  if (/(fraud|bankrupt|bankruptcy|sec probe|criminal|restatement|default|insolvency)/.test(text)) return 90;
  if (/(misses|cuts guidance|downgrade|lawsuit|probe|investigation|halts|recall|short seller|outage)/.test(text)) return 68;
  if (/(falls|slides|drops|selloff|slumps|weak|concern|pressure|tariff|regulation|valuation)/.test(text)) return 48;
  return 34;
}

function thesisRiskFromHeadline(title = '') {
  const text = title.toLowerCase();
  if (/(fraud|bankrupt|bankruptcy|criminal|restatement|default|insolvency)/.test(text)) return 'thesis-breaking';
  if (/(cuts guidance|guidance cut|misses|lawsuit|probe|investigation|halts|recall|short seller|outage)/.test(text)) return 'verify';
  if (/(downgrade|valuation|selloff|falls|drops|slumps|pressure|concern|tariff|regulation|rates|macro)/.test(text)) return 'likely-temporary';
  return 'context';
}

async function fetchJson(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'TrevorMarketApp/1.0 contact@example.com', ...headers } });
  if (!r.ok) return null;
  return r.json();
}

async function fetchTickerMap() {
  const raw = await fetchJson('https://www.sec.gov/files/company_tickers_exchange.json');
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  const fields = raw?.fields || [];
  return rows.map(row => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
}

async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const raw = await fetchJson(url, { 'User-Agent': 'Mozilla/5.0 (compatible; TrevorMarketApp/1.0)' });
  const result = raw?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  const price = num(meta.regularMarketPrice);
  const prevClose = num(meta.chartPreviousClose);
  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    price,
    prevClose,
    changePercent: price !== null && prevClose ? ((price - prevClose) / prevClose) * 100 : null,
    marketCap: num(meta.marketCap),
    sharesOutstanding: num(meta.sharesOutstanding),
    currency: meta.currency || 'USD',
    exchange: meta.exchangeName || meta.fullExchangeName || ''
  };
}

async function fetchNews(symbol, name) {
  const q = `${symbol} ${name || ''} stock news earnings guidance`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TrevorMarketApp/1.0' } });
  if (!r.ok) return [];
  const xml = await r.text();
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  return blocks.slice(0, 5).map(block => {
    const title = stripHtml((block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || block.match(/<title>([\s\S]*?)<\/title>/) || [,''])[1]);
    const published = stripHtml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [,''])[1]);
    const item = {
      title,
      link: stripHtml((block.match(/<link>([\s\S]*?)<\/link>/) || [,''])[1]),
      published,
      ageHours: hoursOld(published),
      source: stripHtml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [,'Google News'])[1])
    };
    item.severity = severityFromHeadline(item.title);
    item.thesisRisk = thesisRiskFromHeadline(item.title);
    return item;
  }).filter(item => item.title && (item.ageHours <= 24 || (item.severity >= 68 && item.ageHours <= 48)));
}

function latestFilings(submissions) {
  const recent = submissions?.filings?.recent || {};
  const forms = recent.form || [];
  return forms.map((form, i) => ({
    form,
    filed: recent.filingDate?.[i],
    accessionNumber: recent.accessionNumber?.[i],
    primaryDocument: recent.primaryDocument?.[i]
  })).filter(f => ['10-K', '10-Q', '8-K'].includes(f.form)).slice(0, 6);
}

function formatMoney(v) {
  if (!Number.isFinite(v)) return 'unavailable';
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

function buildText({ symbol, quote, company, scores, filings, news }) {
  const name = quote?.name || company?.title || symbol;
  const m = scores.metrics;
  const topNews = news[0]?.title || 'No major fresh headline found.';
  return {
    summary: `${name} research uses free Yahoo price data, SEC filings/facts, and Google News RSS. Revenue ${formatMoney(m.revenue)}, net income ${formatMoney(m.netIncome)}, price ${quote?.price ? '$' + quote.price.toFixed(2) : 'unavailable'}.`,
    bull: `Bull case: fundamentals score ${scores.fundamental}/100. Scale, profitability, balance sheet strength, and recent news are the main positive inputs. Latest relevant headline: ${topNews}`,
    bear: `Bear case: valuation score ${scores.valuationScore}/100 and thesis score ${scores.thesis}/100. Watch for guidance cuts, investigations, weakening margins, debt pressure, or expensive valuation.`,
    valuationText: `Free v1 valuation uses rough price-to-sales when market cap and SEC revenue are available. Current estimated P/S: ${Number.isFinite(m.priceToSales) ? m.priceToSales.toFixed(1) + 'x' : 'unavailable'}.`,
    macroText: `Macro exposure is set neutral in v1 unless a local profile exists. Future version should map sector/theme sensitivity to rates, AI capex, consumer demand, credit, energy, and defense cycles.`,
    risks: `Recent filings: ${filings.map(f => `${f.form} ${f.filed}`).join(', ') || 'unavailable'}. News risk: ${news.map(n => n.thesisRisk).filter(Boolean).slice(0, 3).join(', ') || 'no elevated live headline risk detected'}.`
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const symbol = String(req.query.symbol || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!symbol) return res.status(400).json({ error: 'Missing symbol.' });

  try {
    const quote = await fetchQuote(symbol);
    const map = await fetchTickerMap();
    const company = map.find(row => String(row.ticker || '').toUpperCase() === symbol) || null;
    const cik = company?.cik ? String(company.cik).padStart(10, '0') : null;
    const [facts, submissions, news] = await Promise.all([
      cik ? fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`) : null,
      cik ? fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`) : null,
      fetchNews(symbol, quote?.name || company?.title || symbol)
    ]);
    const filings = latestFilings(submissions);
    const scores = calcScores({ quote, facts, news });
    const text = buildText({ symbol, quote, company, scores, filings, news });
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      symbol,
      name: quote?.name || company?.title || symbol,
      type: company?.exchange ? `${company.exchange} listed equity` : 'Public equity',
      cik,
      quote,
      company,
      filings,
      news,
      ...scores,
      ...text,
      sources: ['Yahoo chart quote', 'SEC EDGAR company facts/submissions', 'Google News RSS']
    });
  } catch (error) {
    return res.status(502).json({ error: 'Research fetch failed.', message: error instanceof Error ? error.message : String(error) });
  }
}
