// =====================================================================
// SMA Backfill Script — run with Node.js 18+
// Fetches 10yr price history from Yahoo Finance, computes 200-week SMA,
// writes results to Supabase sma_history table.
//
// Usage:
//   node scripts/backfill-sma.mjs MAS          ← one ticker
//   node scripts/backfill-sma.mjs MAS HBAN O   ← multiple tickers
//   node scripts/backfill-sma.mjs --all        ← all active tickers
//
// Requires: SUPABASE_SERVICE_KEY env var (Project Settings → API → service_role)
//   SUPABASE_SERVICE_KEY=eyJ... node scripts/backfill-sma.mjs MAS
// =====================================================================

const SUPABASE_URL = 'https://ojmbqmbiyjpokhspcjbs.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SMA_DAYS     = 1000; // 200-week SMA

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_KEY env var.');
  console.error('Usage: SUPABASE_SERVICE_KEY=eyJ... node scripts/backfill-sma.mjs MAS');
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Provide ticker(s) or --all');
  process.exit(1);
}

// ── Supabase REST helpers ─────────────────────────────────────────────
const headers = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey':        SERVICE_KEY,
};

async function getActiveTickers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tickers?select=ticker&active=eq.true&order=ticker`,
    { headers }
  );
  if (!res.ok) throw new Error(`Failed to fetch tickers: ${res.status}`);
  const rows = await res.json();
  return rows.map(r => r.ticker);
}

async function upsertSmaRows(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sma_history`, {
    method:  'POST',
    headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
    body:    JSON.stringify(rows),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase upsert failed: ${txt}`);
  }
}

async function runRanking() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_top10_ranking`, {
    method:  'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body:    '{}',
  });
  if (!res.ok) {
    console.warn('  update_top10_ranking failed:', await res.text());
  } else {
    console.log('  Rankings updated.');
  }
}

// ── Yahoo Finance fetch + SMA compute ─────────────────────────────────
async function backfillTicker(ticker) {
  process.stdout.write(`${ticker}: fetching Yahoo Finance... `);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=10y`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    console.log(`SKIP (HTTP ${res.status})`);
    return 0;
  }

  const json   = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) { console.log('SKIP (no data)'); return 0; }

  const timestamps = result.timestamp || [];
  const closes     = result.indicators?.quote?.[0]?.close || [];

  const pairs = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    pairs.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: closes[i] });
  }
  pairs.sort((a, b) => a.date.localeCompare(b.date));

  if (pairs.length < SMA_DAYS) {
    console.log(`SKIP (only ${pairs.length} bars, need ${SMA_DAYS})`);
    return 0;
  }

  process.stdout.write(`${pairs.length} bars → computing SMA... `);

  let sum = 0;
  for (let i = 0; i < SMA_DAYS; i++) sum += pairs[i].close;

  const smaRows = [{ ticker, trade_date: pairs[SMA_DAYS - 1].date, sma_200w: sum / SMA_DAYS }];
  for (let i = SMA_DAYS; i < pairs.length; i++) {
    sum += pairs[i].close;
    sum -= pairs[i - SMA_DAYS].close;
    smaRows.push({ ticker, trade_date: pairs[i].date, sma_200w: sum / SMA_DAYS });
  }

  process.stdout.write(`${smaRows.length} SMA rows → writing... `);
  for (let i = 0; i < smaRows.length; i += 500) {
    await upsertSmaRows(smaRows.slice(i, i + 500));
  }
  console.log('done.');
  return smaRows.length;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  let tickers;

  if (args[0] === '--all') {
    console.log('Fetching active ticker list...');
    tickers = await getActiveTickers();
    console.log(`Found ${tickers.length} active tickers.\n`);
  } else {
    tickers = args.map(t => t.toUpperCase());
  }

  let total = 0;
  for (const ticker of tickers) {
    try {
      total += await backfillTicker(ticker);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    // brief pause to be polite to Yahoo
    if (tickers.length > 1) await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n${total} total SMA rows written.`);
  if (total > 0) {
    process.stdout.write('Updating top-10 rankings... ');
    await runRanking();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
