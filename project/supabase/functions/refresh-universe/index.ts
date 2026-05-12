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

// Polygon's /v3/reference/tickers doesn't return market_cap directly —
// we need /v3/reference/tickers/{ticker} per ticker for that. Too slow
// on free tier for 7000 tickers. Workaround: use the snapshot endpoint
// which returns market data for all tickers in one call, then enrich
// with /vX/reference/tickers/{ticker} only for tickers passing a
// price-based filter later. For now we store name + exchange only,
// and let the scan use a snapshot-style market cap (price * shares).
async function fetchTickerDetails(symbol: string) {
  const url = `https://api.polygon.io/v3/reference/tickers/${symbol}?apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  return json.results;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const enrich = url.searchParams.get("enrich") === "true";

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

    // Optional second pass: enrich with market_cap.
    // Only call with ?enrich=true if you've upgraded Polygon — this is
    // 7000 calls × 12s = 24h on free tier. On Starter it's ~5 min.
    if (enrich) {
      for (const t of tickers) {
        const details = await fetchTickerDetails(t.ticker);
        if (details?.market_cap) {
          await supabase.from("tickers")
            .update({ market_cap: details.market_cap })
            .eq("ticker", t.ticker);
        }
        await sleep(13000);
      }
    }

    return new Response(JSON.stringify({
      ok: true, tickers: rows.length, enriched: enrich,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
