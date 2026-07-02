#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checks = [];

function ok(name, detail = '') {
  checks.push({ name, ok: true, detail });
  console.log(`OK   ${name}${detail ? ` - ${detail}` : ''}`);
}

function fail(name, error) {
  const detail = error instanceof Error ? error.message : String(error);
  checks.push({ name, ok: false, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out.sort();
}

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function checkHtmlScript(path) {
  const html = read(path);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  assert(script.trim(), `${path} has no inline script`);
  new Function(script);
  return script;
}

function checkApiSyntax() {
  const files = [
    ...listFiles(resolve(root, 'api')).filter(f => f.endsWith('.js')),
    ...listFiles(resolve(root, 'btc-vercel-app/api')).filter(f => f.endsWith('.js'))
  ];
  for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  return files.length;
}

function compareFile(a, b) {
  const left = read(a);
  const right = read(b);
  assert(left === right, `${a} and ${b} differ`);
}

function compareDirs(a, b) {
  const leftRoot = resolve(root, a);
  const rightRoot = resolve(root, b);
  const left = listFiles(leftRoot).map(f => relative(leftRoot, f)).sort();
  const right = listFiles(rightRoot).map(f => relative(rightRoot, f)).sort();
  assert(JSON.stringify(left) === JSON.stringify(right), `${a} and ${b} file lists differ`);
  for (const file of left) compareFile(`${a}/${file}`, `${b}/${file}`);
  return left.length;
}

function browserLogicSmoke(script) {
  const store = {};
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        textContent: '',
        innerHTML: '',
        value: '',
        disabled: false,
        style: {},
        classList: { contains: () => false, add: () => {}, remove: () => {} },
        insertAdjacentHTML: (_where, html) => {
          const current = elements.get(id);
          current.innerHTML += html;
        },
        appendChild: () => {},
        remove: () => {},
        click: () => {}
      });
    }
    return elements.get(id);
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    alert: () => {},
    confirm: () => false,
    location: { protocol: 'file:', hostname: '' },
    localStorage: {
      getItem: key => store[key] ?? null,
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: key => { delete store[key]; }
    },
    document: {
      querySelector: selector => selector.startsWith('#') ? element(selector.slice(1)) : null,
      querySelectorAll: () => [],
      getElementById: id => element(id),
      addEventListener: () => {},
      createElement: () => element(`created-${elements.size}`),
      body: { appendChild: () => {} }
    },
    getComputedStyle: () => ({ display: 'block' }),
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
    Blob: function Blob() {},
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    FileReader: function FileReader() {}
  };
  context.window = context;
  context.addEventListener = () => {};

  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'index.html' });

  assert(context.dataHealthRows().length === 6, 'Data Health should render 6 feed rows');
  assert(context.watchlistRecommendations().length > 0, 'Watchlist recommendations should build');
  assert(context.buildNextDollarCandidates().length > 0, 'Best Next Dollar candidates should build');
  assert(context.cacheHasCycleData() === false, 'Empty BTC cache should not count as valid');
  const upSetup = context.opportunitySetup({ ticker: 'FIX', drop: 12.3, quality: 82, thesis: 80, confidence: 60, newsSeverity: 40, reason: 'strong momentum' });
  const downSetup = context.opportunitySetup({ ticker: 'AXON', drop: -5.5, quality: 85, thesis: 83, confidence: 61, newsSeverity: 42, reason: 'valuation reset', liveNews: { title: 'valuation reset', severity: 42 } });
  assert(upSetup.valuationImproved === false, 'Positive stock moves should not count as valuation improved');
  assert(upSetup.entryRead.label.includes('extended') || upSetup.entryRead.label.includes('stretched'), 'Positive stock moves should warn about entry');
  assert(downSetup.valuationImproved === true, 'Meaningful stock drops can count as valuation improved');
  assert(downSetup.entry >= upSetup.entry, 'Downside entries should score better than upside entries');
  const greatButExtended = context.qualityEntryAction({ business: 95, entry: 35, thesisDamaged: false, speculative: false });
  const damaged = context.qualityEntryAction({ business: 85, entry: 70, thesisDamaged: true, speculative: false });
  const improving = context.qualityEntryAction({ business: 88, entry: 72, thesisDamaged: false, speculative: false, hasLiveNews: true, downEnough: true });
  const cappedNextDollar = context.capActionByBase(
    { label: 'BUY STARTER', color: '#1D9E75', copy: 'boosted by underweight allocation' },
    { label: 'ADD ON PULLBACK', color: '#639922', copy: 'entry is not clean enough yet' },
    50
  );
  const greenNearHighScore = context.entryQualityScore(3.4, 60, 85, -1);
  const greenBelowHighScore = context.entryQualityScore(3.4, 60, 85, -15);
  const greenBelowHighRead = context.entryQualityRead(3.4, greenBelowHighScore, -15);
  assert(greatButExtended.label === 'WAIT / EXTENDED', 'Great business with poor entry should wait, not avoid');
  assert(damaged.label === 'AVOID / THESIS DAMAGED', 'Avoid should be reserved for thesis damage');
  assert(improving.label === 'BUY STARTER', 'High quality with improved entry should become buy starter');
  assert(cappedNextDollar.label !== 'BUY STARTER', 'Best Next Dollar should not promote weak/neutral entry into buy starter');
  assert(greenBelowHighScore > greenNearHighScore, 'Stocks still below highs should get better entry scores than near-high stocks');
  assert(greenBelowHighRead.label !== 'Entry extended', 'Green day should not force extended label when stock is still below highs');
  assert(context.bgeometricsUrls('nupl').some(url => url.includes('btcscore.vercel.app')), 'Local/file BGeometrics calls should fall back to deployed API');

  return context.loadScreener()
    .then(() => {
      assert(context.window._screenerLastError, 'Screener failure should be captured');
      return context.refreshWatchlistScores();
    })
    .then(() => {
      assert(
        element('watchlist-status').textContent.includes('cached/local data'),
        'Watchlist refresh should explain cached/local fallback'
      );
      store.trevor_btc_cycle_cache_v3 = JSON.stringify({
        updatedAt: Date.now(),
        vals: { mvrvZ: 0.3, puell: 0.8, nupl: 0.2, fg: 15, rvp: 25, ma: 30 }
      });
      assert(context.cacheHasCycleData() === true, 'Valid BTC cache should count as valid');
      assert(context.dataHealthRows()[0].body.includes('3/3 BGeometrics'), 'BTC health should summarize BG metrics');
    });
}

async function run(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail === undefined ? '' : String(detail));
  } catch (error) {
    fail(name, error);
  }
}

await run('required files exist', () => {
  for (const file of ['index.html', 'btc-vercel-app/index.html', 'api', 'btc-vercel-app/api']) {
    assert(existsSync(resolve(root, file)), `${file} is missing`);
  }
});

let appScript = '';
await run('parse index.html script', () => {
  appScript = checkHtmlScript('index.html');
});

await run('parse deploy index.html script', () => {
  checkHtmlScript('btc-vercel-app/index.html');
});

await run('API route syntax', () => `${checkApiSyntax()} files`);

await run('local and deploy HTML are synced', () => {
  compareFile('index.html', 'btc-vercel-app/index.html');
});

await run('local and deploy API routes are synced', () => `${compareDirs('api', 'btc-vercel-app/api')} files`);

await run('browser logic smoke test', async () => {
  await browserLogicSmoke(appScript);
});

const failed = checks.filter(check => !check.ok);
if (failed.length) {
  console.error(`\n${failed.length} check${failed.length === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} checks passed.`);
