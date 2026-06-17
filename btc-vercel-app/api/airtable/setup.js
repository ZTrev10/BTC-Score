import { ensureSchema, json } from '../_airtable.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
  try {
    const results = await ensureSchema();
    return json(res, 200, {
      ok: true,
      message: 'Airtable memory schema is ready.',
      results
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
