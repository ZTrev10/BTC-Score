#!/usr/bin/env node

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

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

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error(`
Missing Airtable config.

Run this with:

  AIRTABLE_API_KEY=pat... AIRTABLE_BASE_ID=app... node scripts/setup-airtable.mjs

Your Airtable token needs these scopes:
  schema.bases:read
  schema.bases:write
  data.records:read
  data.records:write
`);
  process.exit(1);
}

const API_ROOT = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}`;

async function airtable(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
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

function fieldPayload(field) {
  const payload = { name: field.name, type: field.type };
  if (field.options) payload.options = field.options;
  return payload;
}

async function createField(tableId, field) {
  try {
    return await airtable(`/tables/${tableId}/fields`, {
      method: 'POST',
      body: JSON.stringify(fieldPayload(field))
    });
  } catch (error) {
    // Date options can change across Airtable API versions. Retry without
    // options before giving up so the setup remains easy to run.
    if (field.options) {
      return airtable(`/tables/${tableId}/fields`, {
        method: 'POST',
        body: JSON.stringify({ name: field.name, type: field.type })
      });
    }
    throw error;
  }
}

async function createTable(name) {
  const fields = FIELDS.map(fieldPayload);
  try {
    return await airtable('/tables', {
      method: 'POST',
      body: JSON.stringify({ name, fields })
    });
  } catch (error) {
    // Some bases/API versions are picky about date options during table
    // creation. Create with only the primary field, then add the rest.
    const table = await airtable('/tables', {
      method: 'POST',
      body: JSON.stringify({ name, fields: [fieldPayload(FIELDS[0])] })
    });
    for (const field of FIELDS.slice(1)) {
      await createField(table.id, field);
    }
    return table;
  }
}

async function ensureTable(tableName, existingTables) {
  let table = existingTables.find(t => t.name === tableName);
  if (!table) {
    table = await createTable(tableName);
    console.log(`Created table: ${tableName}`);
    return table;
  }

  console.log(`Found table: ${tableName}`);
  const existingFields = new Set((table.fields || []).map(f => f.name));
  for (const field of FIELDS) {
    if (existingFields.has(field.name)) continue;
    await createField(table.id, field);
    console.log(`  Added field: ${field.name}`);
  }
  return table;
}

async function main() {
  console.log(`Setting up Airtable base ${AIRTABLE_BASE_ID}...`);
  const schema = await airtable('/tables');
  const existingTables = schema.tables || [];

  for (const tableName of TABLES) {
    await ensureTable(tableName, existingTables);
  }

  console.log('\nDone. Airtable memory schema is ready.');
}

main().catch(error => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
