// =====================================================================
// Allin Signal · History backfill Edge Function
// =====================================================================
// Fetches up to 9 years of daily bars per ticker from Polygon and
// upserts into price_history. Fetches all tickers in parallel —
// suitable for paid Polygon plans with high rate limits.
//
// Deploy: supabase functions deploy backfill-history --no-verify-jwt
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const POLYGON_KEY = Deno.env.get("POLYGON_API_KEY")!;
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase    = createClient(SB_URL, SB_SERVICE);

const MIN_BARS   = 1800;        // SMA_DAYS(1000) + LOOKBACK(756) + buffer
const FROM_DATE  = "2017-01-01"; // 9 years back
const CONCURRENCY = 20;          // parallel Polygon requests per wave

async function backfillTicker(ticker: string): Promise<{ ticker: string; bars: number }> {
  const to  = new Date().toISOString().slice(0, 10);
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${FROM_DATE}/${to}?adjusted=true&sort=asc&limit=10000&apiKey=${POLYGON_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ticker, bars: 0 };
    const json = await res.json();
    const bars = (json.results || []).map((r: any) => ({
      ticker,
      trade_date: new Date(r.t).toISOString().slice(0, 10),
      open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
    }));
    for (let i = 0; i < bars.length; i += 1000) {
      await supabase.from("price_history").upsert(bars.slice(i, i + 1000));
    }
    return { ticker, bars: bars.length };
  } catch {
    return { ticker, bars: 0 };
  }
}

Deno.serve(async (_req) => {
  // Find active tickers that still need more history
  const { data: needsBackfill } = await supabase
    .rpc("tickers_needing_backfill", { p_min_bars: MIN_BARS, p_limit: 2000 });

  if (!needsBackfill?.length) {
    return new Response(JSON.stringify({ done: true, message: "All tickers have sufficient history" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const tickers = needsBackfill.map((r: { ticker: string }) => r.ticker);
  const results: { ticker: string; bars: number }[] = [];

  // Process in parallel waves to avoid overwhelming connections
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const wave = tickers.slice(i, i + CONCURRENCY);
    const waveResults = await Promise.all(wave.map(backfillTicker));
    results.push(...waveResults);
  }

  const succeeded = results.filter(r => r.bars > 0).length;
  const failed    = results.filter(r => r.bars === 0).length;

  return new Response(JSON.stringify({
    done: true,
    total: results.length,
    succeeded,
    failed,
  }), { headers: { "Content-Type": "application/json" } });
});
