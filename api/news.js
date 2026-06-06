function stripHtml(input = '') {
  return String(input).replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}
function extractItems(xml, category) {
  const items = [];
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks.slice(0, 5)) {
    const title = stripHtml((block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || block.match(/<title>([\s\S]*?)<\/title>/) || [,''])[1]);
    const link = stripHtml((block.match(/<link>([\s\S]*?)<\/link>/) || [,''])[1]);
    const pubDate = stripHtml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [,''])[1]);
    const source = stripHtml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [,'Google News'])[1]);
    if (title) items.push({ title, link, published: pubDate, source, category });
  }
  return items;
}

export default async function handler(req, res) {
  const queries = [
    ['CRYPTO', 'bitcoin OR crypto market ETF outflows regulation'],
    ['STOCKS', 'NVIDIA Broadcom Coinbase Meta stock news'],
    ['MACRO', 'AI data center power nuclear defense drones geopolitical market news']
  ];
  const all = [];
  try {
    for (const [category, q] of queries) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TrevorMarketApp/1.0' } });
      if (!upstream.ok) continue;
      const xml = await upstream.text();
      all.push(...extractItems(xml, category));
    }
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ updatedAt: new Date().toISOString(), items: all.slice(0, 12) });
  } catch (error) {
    return res.status(502).json({ updatedAt: new Date().toISOString(), items: [], error: 'News fetch failed.' });
  }
}
