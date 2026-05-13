// =====================================================================
// Allin Signal · refresh-universe Edge Function
// =====================================================================
// Pulls the full list of active US common stocks + market caps from
// Polygon's reference endpoint and upserts to `tickers`. Run weekly.
//
// On Polygon free tier (5 calls/min, ~1000 rows per page, ~7000 stocks):
//   ~7 paginated calls × 12s rate limit gap ≈ 90 seconds.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const POLYGON_KEY = Deno.env.get("POLYGON_API_KEY")!;
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase    = createClient(SB_URL, SB_SERVICE);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchAllTickers() {
  const all: any[] = [];
  let url: string | null =
    `https://api.polygon.io/v3/reference/tickers` +
    `?market=stocks&type=CS&active=true&limit=1000&apiKey=${POLYGON_KEY}`;

  while (url) {
    const res = await fetch(url);
    if (res.status === 429) { await sleep(15000); continue; }
    if (!res.ok) throw new Error(`Polygon tickers: ${res.status}`);
    const json = await res.json();
    all.push(...(json.results || []));
    url = json.next_url ? `${json.next_url}&apiKey=${POLYGON_KEY}` : null;
    if (url) await sleep(13000);  // free-tier rate limit gap
  }
  return all;
}

// Batch-fetch market caps using ticker.any_of (up to 100 per call).
// Polygon's list endpoint returns market_cap per result when you filter
// by specific tickers. 100 tickers/call × 13 s gap = ~11 min for 5000 tickers.
async function fetchMarketCaps(tickers: string[]): Promise<Map<string, number>> {
  const caps = new Map<string, number>();
  const BATCH = 100;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const url = `https://api.polygon.io/v3/reference/tickers?ticker.any_of=${batch.join(',')}&limit=100&apiKey=${POLYGON_KEY}`;
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(15000); i -= BATCH; continue; }
      if (!res.ok) continue;
      const json = await res.json();
      for (const r of (json.results || [])) {
        if (r.market_cap) caps.set(r.ticker, r.market_cap);
      }
    } catch (_) {}
    if (i + BATCH < tickers.length) await sleep(13000);
  }
  return caps;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    // Pass ?enrich=false to do a fast name-only refresh (skips market cap fetch)
    const enrich = url.searchParams.get("enrich") !== "false";

    const tickers = await fetchAllTickers();
    console.log(`Fetched ${tickers.length} tickers`);

    const rows = tickers.map(t => ({
      ticker: t.ticker,
      name: t.name,
      primary_exch: t.primary_exchange,
      active: t.active,
      last_updated: new Date().toISOString(),
    }));

    for (let i = 0; i < rows.length; i += 1000) {
      await supabase.from("tickers").upsert(rows.slice(i, i + 1000));
    }
    console.log(`Upserted ${rows.length} tickers`);

    // Batch-fetch market caps (100 tickers per call, respects free-tier rate limits).
    // Skip with ?enrich=false to do a fast name-only refresh.
    if (enrich !== false) {
      const symbols = tickers.map(t => t.ticker);
      console.log(`Fetching market caps for ${symbols.length} tickers…`);
      const caps = await fetchMarketCaps(symbols);
      console.log(`Got market caps for ${caps.size} tickers`);

      const capRows = Array.from(caps.entries()).map(([ticker, market_cap]) => ({
        ticker, market_cap, last_updated: new Date().toISOString(),
      }));
      for (let i = 0; i < capRows.length; i += 1000) {
        await supabase.from("tickers").upsert(capRows.slice(i, i + 1000), { onConflict: 'ticker' });
      }
    }

    return new Response(JSON.stringify({
      ok: true, tickers: rows.length,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
