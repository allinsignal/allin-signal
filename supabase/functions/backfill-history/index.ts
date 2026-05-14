// =====================================================================
// Allin Signal · History backfill Edge Function
// =====================================================================
// Fetches up to 9 years of daily bars per ticker from Polygon and
// upserts into price_history. Processes 5 tickers per invocation
// (free-tier safe: 13s delay between Polygon calls).
//
// Call repeatedly until response shows { done: true }.
// Deploy: supabase functions deploy backfill-history --no-verify-jwt
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const POLYGON_KEY = Deno.env.get("POLYGON_API_KEY")!;
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase    = createClient(SB_URL, SB_SERVICE);

const MIN_BARS  = 1800;        // SMA_DAYS(1000) + LOOKBACK(756) + buffer
const BATCH     = 5;           // tickers per invocation (free-tier safe)
const FROM_DATE = "2017-01-01"; // 9 years back — plenty for 200wk SMA + 3yr lookback
const DELAY_MS  = 13000;       // 13s between Polygon calls (5 req/min free tier)

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function backfillTicker(ticker: string): Promise<number> {
  const to  = new Date().toISOString().slice(0, 10);
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${FROM_DATE}/${to}?adjusted=true&sort=asc&limit=10000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return 0;
  const json = await res.json();
  const bars = (json.results || []).map((r: any) => ({
    ticker,
    trade_date: new Date(r.t).toISOString().slice(0, 10),
    open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
  }));
  for (let i = 0; i < bars.length; i += 1000) {
    await supabase.from("price_history").upsert(bars.slice(i, i + 1000));
  }
  return bars.length;
}

Deno.serve(async (_req) => {
  // Find active tickers that still need more history
  const { data: needsBackfill } = await supabase
    .rpc("tickers_needing_backfill", { p_min_bars: MIN_BARS, p_limit: BATCH });

  if (!needsBackfill?.length) {
    return new Response(JSON.stringify({ done: true, message: "All tickers have sufficient history" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: { ticker: string; bars: number }[] = [];
  for (let i = 0; i < needsBackfill.length; i++) {
    if (i > 0) await sleep(DELAY_MS);
    const bars = await backfillTicker(needsBackfill[i].ticker);
    results.push({ ticker: needsBackfill[i].ticker, bars });
  }

  // Check how many still remain after this batch
  const { data: remaining } = await supabase
    .rpc("tickers_needing_backfill", { p_min_bars: MIN_BARS, p_limit: 1000 });

  return new Response(JSON.stringify({
    done: false,
    processed: results,
    remaining: remaining?.length ?? 0,
  }), { headers: { "Content-Type": "application/json" } });
});
