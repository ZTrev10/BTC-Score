import { airtableData, json, memoryRecord, snapshotRecord } from '../_airtable.js';
import { generateHistoricalBackfill } from '../_history.js';

async function createRecords(table, records) {
  const clean = records.filter(Boolean);
  const writes = [];
  for (let i = 0; i < clean.length; i += 10) {
    const chunk = clean.slice(i, i + 10);
    const result = await airtableData(table, {
      method: 'POST',
      body: JSON.stringify({ records: chunk.map(fields => ({ fields })) })
    });
    writes.push(...(result.records || []).map(r => r.id));
  }
  return { table, count: writes.length, ids: writes };
}

function backfillRecords(snapshots) {
  const daily = snapshots.map(snapshotRecord);
  const btc = snapshots.map(s => memoryRecord(
    `BTC Backfill ${s.createdAt.slice(0, 10)} · Score ${s.btc?.score ?? '—'}`,
    s.createdAt,
    s.btc,
    s.notes
  ));
  const events = snapshots.map(s => memoryRecord(
    `Market Regime ${s.createdAt.slice(0, 10)} · ${s.marketRegime?.label || 'Unknown'}`,
    s.createdAt,
    {
      eventType: s.eventType,
      marketRegime: s.marketRegime,
      btcScore: s.btc?.score ?? null,
      historicalBackfill: true
    },
    s.notes
  ));
  const watchlist = snapshots.flatMap(s => (s.watchlistScores || []).slice(0, 10).map(w => memoryRecord(
    `${w.ticker || 'Ticker'} Backfill ${s.createdAt.slice(0, 10)}`,
    s.createdAt,
    w,
    w.notes || s.notes
  )));
  return [
    { table: 'Daily Brief Snapshots', records: daily },
    { table: 'BTC History', records: btc },
    { table: 'Events Themes', records: events },
    { table: 'Watchlist Scores', records: watchlist }
  ];
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const days = Math.min(365, Math.max(30, Number(req.body?.days) || 365));
    const tickers = Array.isArray(req.body?.tickers) ? req.body.tickers : String(req.body?.tickers || '').split(',');
    const data = await generateHistoricalBackfill({ days, tickers });
    const writes = [];
    for (const group of backfillRecords(data.snapshots)) {
      writes.push(await createRecords(group.table, group.records));
    }
    return json(res, 200, {
      ok: true,
      days,
      snapshots: data.snapshots.length,
      sources: data.sources,
      writes
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
