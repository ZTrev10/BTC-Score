import { airtableData, json, snapshotRecord } from '../_airtable.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const snapshot = req.body?.snapshot || req.body;
    const result = await airtableData('Daily Brief Snapshots', {
      method: 'POST',
      body: JSON.stringify({
        records: [{ fields: snapshotRecord(snapshot) }]
      })
    });
    return json(res, 200, {
      ok: true,
      id: result.records?.[0]?.id || null,
      record: result.records?.[0] || null
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
