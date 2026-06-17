import { airtableData, json } from '../_airtable.js';

function parseRecord(record) {
  const fields = record.fields || {};
  let payload = null;
  try {
    payload = fields.Payload ? JSON.parse(fields.Payload) : null;
  } catch {
    payload = null;
  }
  return {
    id: record.id,
    name: fields.Name || '',
    date: fields.Date || '',
    notes: fields.Notes || '',
    snapshot: payload
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const result = await airtableData('Daily Brief Snapshots?maxRecords=50&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc');
    return json(res, 200, {
      ok: true,
      records: (result.records || []).map(parseRecord)
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
