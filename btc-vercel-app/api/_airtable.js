const TABLES = [
  'BTC History',
  'Daily Brief Snapshots',
  'Opportunities',
  'Research Snapshots',
  'Portfolio Snapshots',
  'Watchlist Scores',
  'Outcomes',
  'Events Themes'
];

const FIELDS = [
  { name: 'Name', type: 'singleLineText' },
  { name: 'Date', type: 'date', options: { dateFormat: { name: 'iso' } } },
  { name: 'Payload', type: 'multilineText' },
  { name: 'Notes', type: 'multilineText' }
];

function airtableConfig() {
  const token = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) {
    const missing = [
      token ? null : 'AIRTABLE_API_KEY',
      baseId ? null : 'AIRTABLE_BASE_ID'
    ].filter(Boolean).join(', ');
    throw new Error(`Missing Airtable env vars: ${missing}`);
  }
  return { token, baseId };
}

async function airtableMeta(path, options = {}) {
  const { token, baseId } = airtableConfig();
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.error?.message || body?.error || text || response.statusText;
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${message}`);
  }
  return body;
}

async function airtableData(tableName, options = {}) {
  const { token, baseId } = airtableConfig();
  const [name, query = ''] = String(tableName).split('?');
  const path = `${encodeURIComponent(name)}${query ? `?${query}` : ''}`;
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.error?.message || body?.error || text || response.statusText;
    throw new Error(`${options.method || 'GET'} ${tableName} failed (${response.status}): ${message}`);
  }
  return body;
}

function fieldPayload(field) {
  const payload = { name: field.name, type: field.type };
  if (field.options) payload.options = field.options;
  return payload;
}

async function createField(tableId, field) {
  try {
    return await airtableMeta(`/tables/${tableId}/fields`, {
      method: 'POST',
      body: JSON.stringify(fieldPayload(field))
    });
  } catch (error) {
    if (field.options) {
      return airtableMeta(`/tables/${tableId}/fields`, {
        method: 'POST',
        body: JSON.stringify({ name: field.name, type: field.type })
      });
    }
    throw error;
  }
}

async function createTable(name) {
  try {
    return await airtableMeta('/tables', {
      method: 'POST',
      body: JSON.stringify({ name, fields: FIELDS.map(fieldPayload) })
    });
  } catch (error) {
    const table = await airtableMeta('/tables', {
      method: 'POST',
      body: JSON.stringify({ name, fields: [fieldPayload(FIELDS[0])] })
    });
    for (const field of FIELDS.slice(1)) await createField(table.id, field);
    return table;
  }
}

async function ensureSchema() {
  const schema = await airtableMeta('/tables');
  const existingTables = schema.tables || [];
  const results = [];

  for (const tableName of TABLES) {
    let table = existingTables.find(t => t.name === tableName);
    if (!table) {
      table = await createTable(tableName);
      results.push({ table: tableName, action: 'created' });
      continue;
    }

    const existingFields = new Set((table.fields || []).map(f => f.name));
    const addedFields = [];
    for (const field of FIELDS) {
      if (existingFields.has(field.name)) continue;
      await createField(table.id, field);
      addedFields.push(field.name);
    }
    results.push({ table: tableName, action: 'exists', addedFields });
  }

  return results;
}

function json(res, status, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(status).json(body);
}

function snapshotRecord(snapshot) {
  const createdAt = snapshot?.createdAt || new Date().toISOString();
  return memoryRecord(
    `${snapshot?.eventType || 'Daily Snapshot'} ${createdAt.slice(0, 10)}`,
    createdAt,
    snapshot,
    snapshot?.notes || ''
  );
}

function memoryRecord(name, date, payload, notes = '') {
  const isoDate = String(date || new Date().toISOString()).slice(0, 10);
  return {
    Name: String(name || `Record ${isoDate}`),
    Date: isoDate,
    Payload: JSON.stringify(payload || {}, null, 2),
    Notes: String(notes || '')
  };
}

export { TABLES, FIELDS, airtableData, ensureSchema, json, memoryRecord, snapshotRecord };
