import { airtableData, json, memoryRecord, snapshotRecord } from '../_airtable.js';

async function createRecords(table, records) {
  const clean = records.filter(Boolean).slice(0, 10);
  if (!clean.length) return { table, count: 0, ids: [] };
  const result = await airtableData(table, {
    method: 'POST',
    body: JSON.stringify({ records: clean.map(fields => ({ fields })) })
  });
  return {
    table,
    count: result.records?.length || 0,
    ids: (result.records || []).map(r => r.id)
  };
}

function splitSnapshot(snapshot) {
  const createdAt = snapshot?.createdAt || new Date().toISOString();
  const notes = snapshot?.notes || '';
  const btc = snapshot?.btc || {};
  const portfolio = snapshot?.portfolio || {};
  const research = snapshot?.research || null;
  const opportunities = snapshot?.opportunities || [];
  const watchlist = snapshot?.watchlistScores || [];
  const eventType = snapshot?.eventType || 'Daily Snapshot';

  return [
    {
      table: 'Daily Brief Snapshots',
      records: [snapshotRecord(snapshot)]
    },
    {
      table: 'BTC History',
      records: [memoryRecord(`BTC ${createdAt.slice(0, 10)} · Score ${btc.score ?? '—'}`, createdAt, btc, notes)]
    },
    {
      table: 'Opportunities',
      records: opportunities.slice(0, 5).map(o => memoryRecord(`${o.ticker || 'Opportunity'} · ${o.score ?? '—'}`, createdAt, o, o.reason || notes))
    },
    {
      table: 'Portfolio Snapshots',
      records: [memoryRecord(`Portfolio ${createdAt.slice(0, 10)} · ${portfolio.total ? '$' + Math.round(portfolio.total).toLocaleString() : 'No value'}`, createdAt, portfolio, notes)]
    },
    {
      table: 'Watchlist Scores',
      records: watchlist.slice(0, 10).map(w => memoryRecord(`${w.ticker || 'Watchlist'} · ${w.score ?? '—'}`, createdAt, w, w.action || notes))
    },
    {
      table: 'Research Snapshots',
      records: research ? [memoryRecord(`${research.ticker || 'Research'} · ${research.score ?? '—'}`, createdAt, research, research.decision || notes)] : []
    },
    {
      table: 'Events Themes',
      records: [memoryRecord(`${eventType} ${createdAt.slice(0, 10)}`, createdAt, {
        eventType,
        headlines: snapshot?.headlines || [],
        topOpportunity: opportunities[0] || null,
        btcScore: btc.score ?? null
      }, notes)]
    }
  ];
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const snapshot = req.body?.snapshot || req.body;
    const writes = [];
    for (const group of splitSnapshot(snapshot)) {
      writes.push(await createRecords(group.table, group.records));
    }
    return json(res, 200, {
      ok: true,
      writes,
      id: writes.find(w => w.table === 'Daily Brief Snapshots')?.ids?.[0] || null
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
