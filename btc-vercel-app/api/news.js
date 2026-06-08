function stripHtml(input = '') {
  return String(input)
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function hoursOld(pubDate) {
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 36e5;
}

function isBigNews(item) {
  const text = `${item.title || ''} ${item.source || ''}`.toLowerCase();
  return /(fed|federal reserve|rate cut|rate hike|cpi|inflation|recession|war|attack|crisis|bank|default|sec|etf|bitcoin reserve|earnings shock|guidance cut|tariff|sanction|nuclear|defense|ai capex|data center|blackout|grid|credit stress)/.test(text);
}

function affectsTodayDecision(item) {
  const text = `${item.title || ''} ${item.theme || ''} ${item.category || ''}`.toLowerCase();
  return /(bitcoin|btc|ethereum|eth|etf|fed|federal reserve|rate|yield|cpi|inflation|jobs|treasury|recession|bank|credit|liquidity|war|attack|tariff|sanction|guidance|earnings|downgrade|selloff|falls|drops|stock|nvidia|nvda|meta|google|googl|amazon|amzn|microsoft|msft|asml|tsm|visa|mastercard|axon|crowdstrike|crwd|power|grid|nuclear|defense|drones|data center|ai capex|water|infrastructure)/.test(text);
}

function sourceTier(source = '') {
  const s = source.toLowerCase();
  if (/(reuters|associated press|ap news|cnbc|wall street journal|wsj|bloomberg|financial times|ft|barron)/.test(s)) return 'Primary market source';
  if (/(sec|investor relations|earnings call|transcript)/.test(s)) return 'Company / filing source';
  if (/(coindesk|the block|decrypt|cointelegraph)/.test(s)) return 'Crypto source';
  if (/(seeking alpha|marketwatch|yahoo finance)/.test(s)) return 'Market commentary';
  return 'News source';
}

function inferTicker(title = '') {
  const text = title.toUpperCase();
  const tickers = ['BTC', 'ETH', 'NVDA', 'AVGO', 'MU', 'AMD', 'ASML', 'TSM', 'META', 'GOOGL', 'AMZN', 'MSFT', 'V', 'MA', 'ISRG', 'CRWD', 'DDOG', 'AXON', 'PWR', 'FIX', 'BWXT', 'VST', 'ETN', 'HWM', 'XYL'];
  return tickers.find(t => new RegExp(`\\b${t}\\b`).test(text)) || null;
}

function inferTheme(title = '', category = '') {
  const text = `${title} ${category}`.toLowerCase();
  if (/(bitcoin|btc|crypto|ethereum|eth|etf)/.test(text)) return 'Crypto';
  if (/(fed|rate|yield|cpi|inflation|jobs|treasury)/.test(text)) return 'Rates / Macro';
  if (/(chip|semiconductor|ai|nvidia|broadcom|micron|data center|capex)/.test(text)) return 'AI / Semis';
  if (/(nuclear|power|grid|electricity|utility)/.test(text)) return 'Power / Grid';
  if (/(defense|drone|war|geopolitical|missile)/.test(text)) return 'Defense / Geopolitics';
  if (/(water|drought|infrastructure)/.test(text)) return 'Water / Infrastructure';
  if (/(earnings|guidance|forecast|revenue|profit)/.test(text)) return 'Earnings';
  return category || 'Market';
}

function whyItMatters(item) {
  const theme = item.theme || inferTheme(item.title, item.category);
  if (theme === 'Crypto') return 'Can affect BTC/ETH risk appetite, ETF flows, and reserve deployment context.';
  if (theme === 'Rates / Macro') return 'Changes discount rates and pressure on long-duration growth assets.';
  if (theme === 'AI / Semis') return 'Important for AI infrastructure valuations and opportunity selloffs.';
  if (theme === 'Power / Grid') return 'Supports or challenges the power, grid, and data-center infrastructure theme.';
  if (theme === 'Defense / Geopolitics') return 'Can shift defense budgets, supply chains, energy prices, and market risk appetite.';
  if (theme === 'Water / Infrastructure') return 'Relevant to long-term infrastructure and resilience themes.';
  if (theme === 'Earnings') return 'Can create opportunity setups if the news is temporary rather than thesis-breaking.';
  return 'Relevant to today’s market context and portfolio decision-making.';
}

function extractItems(xml, bucket) {
  const items = [];
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks.slice(0, 10)) {
    const title = stripHtml((block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || block.match(/<title>([\s\S]*?)<\/title>/) || [,''])[1]);
    const link = stripHtml((block.match(/<link>([\s\S]*?)<\/link>/) || [,''])[1]);
    const pubDate = stripHtml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [,''])[1]);
    const source = stripHtml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [,'Google News'])[1]);
    if (!title) continue;
    const item = {
      title,
      link,
      published: pubDate,
      source,
      sourceTier: sourceTier(source),
      category: bucket.category,
      sourceGroup: bucket.name,
      ticker: inferTicker(title),
      theme: inferTheme(title, bucket.category)
    };
    item.ageHours = hoursOld(pubDate);
    item.bigNews = isBigNews(item);
    item.decisionRelevant = affectsTodayDecision(item);
    item.why = whyItMatters(item);
    items.push(item);
  }
  return items;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  const buckets = [
    { name: 'Market / Macro', category: 'MACRO', limit: 5, q: 'US stock market Fed jobs report Treasury yields inflation recession Reuters OR AP OR CNBC OR Bloomberg OR "Wall Street Journal" OR "Financial Times"' },
    { name: 'Crypto', category: 'CRYPTO', limit: 4, q: 'bitcoin ethereum crypto ETF regulation market CoinDesk OR "The Block" OR Decrypt OR Reuters' },
    { name: 'Opportunity Selloffs', category: 'OPPORTUNITIES', limit: 5, q: 'stock falls drops selloff earnings guidance downgrade valuation thesis intact NVDA AVGO MU ASML TSM META GOOGL AMZN MSFT Reuters CNBC Barrons Seeking Alpha' },
    { name: 'Watchlist Companies', category: 'WATCHLIST', limit: 5, q: 'META GOOGL AMZN MSFT ASML TSM V MA ISRG CPRT AXON CRWD DDOG PWR FIX earnings guidance stock news' },
    { name: 'Themes', category: 'THEMES', limit: 5, q: 'AI data center power grid nuclear defense drones water infrastructure reshoring market news Reuters CNBC Bloomberg' },
    { name: 'Filings / Earnings', category: 'EARNINGS', limit: 4, q: 'earnings guidance SEC filing 10-Q 8-K earnings transcript stock market today' }
  ];
  const all = [];
  try {
    for (const bucket of buckets) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(bucket.q)}&hl=en-US&gl=US&ceid=US:en`;
      const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TrevorMarketApp/1.0' } });
      if (!upstream.ok) continue;
      const xml = await upstream.text();
      all.push(...extractItems(xml, bucket));
    }

    const fresh = dedupe(all)
      .filter(item => item.ageHours <= 24 || (item.bigNews && item.decisionRelevant && item.ageHours <= 48))
      .sort((a, b) => {
        if (a.bigNews !== b.bigNews) return a.bigNews ? -1 : 1;
        return a.ageHours - b.ageHours;
      });

    const byBucket = buckets.map(bucket => ({
      name: bucket.name,
      category: bucket.category,
      items: fresh.filter(item => item.sourceGroup === bucket.name).slice(0, bucket.limit)
    })).filter(bucket => bucket.items.length);

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      policy: '24h normal news; 48h major context only if still decision-relevant',
      buckets: byBucket,
      items: byBucket.flatMap(bucket => bucket.items).slice(0, 16)
    });
  } catch (error) {
    return res.status(502).json({ updatedAt: new Date().toISOString(), buckets: [], items: [], error: 'News fetch failed.' });
  }
}
