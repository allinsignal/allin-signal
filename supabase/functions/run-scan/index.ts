// =====================================================================
// Allin Signal · Daily scan Edge Function
// =====================================================================
// Runs after US market close. Fetches the day's grouped daily bars from
// Polygon, upserts to price_history, runs the model per ticker, writes
// to `signals`. Flips logged to `rating_changes`.
//
// Deploy: supabase functions deploy run-scan --no-verify-jwt
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const POLYGON_KEY = Deno.env.get("POLYGON_API_KEY")!;
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase    = createClient(SB_URL, SB_SERVICE);

// ---------- CONFIG ---------------------------------------------------
const SMA_WEEKS  = 200;                     // 200-week SMA
const SMA_DAYS   = SMA_WEEKS * 5;           // ~1000 trading days
const LOOKBACK_DAYS = 3 * 252;              // 3-year confidence window (~756 days)
const HISTORY_DAYS = SMA_DAYS + LOOKBACK_DAYS + 50; // ~2058 days needed
const MARKET_CAP_MIN = 10_000_000_000;      // $10B — large cap floor (no upper limit)
const MAX_DISTANCE_ABOVE_SMA = 0.10;        // 0–10% above SMA = BUY zone

// ====== ALLIN MODEL ===================================================
// Buy zone: price is 0–10% above its 200-week SMA.
// Confidence = 70% track record (4-yr history above SMA) + 30% entry quality.
// Entry quality rewards stocks DECLINING toward the SMA (on sale) over
// stocks that just crossed up from below (not yet a bargain).
function rate(closes: number[], marketCap: number) {
  if (marketCap < MARKET_CAP_MIN) return null;
  if (closes.length < SMA_DAYS + 1) return null;

  const recentSmaWindow = closes.slice(-SMA_DAYS);
  const sma = recentSmaWindow.reduce((a, b) => a + b, 0) / SMA_DAYS;
  const price = closes[closes.length - 1];
  const distance = (price - sma) / sma;

  const rating = distance >= 0 && distance <= MAX_DISTANCE_ABOVE_SMA ? "BUY" : "SELL";

  // 4-year track record: % of days price was above its rolling 200-week SMA.
  const lookback = Math.min(LOOKBACK_DAYS, closes.length - SMA_DAYS);
  const startIdx = closes.length - SMA_DAYS - lookback;

  let windowSum = 0;
  for (let j = startIdx; j < startIdx + SMA_DAYS; j++) windowSum += closes[j];

  let daysAbove = 0;
  for (let i = 0; i < lookback; i++) {
    const priceIdx = startIdx + SMA_DAYS + i;
    if (closes[priceIdx] > windowSum / SMA_DAYS) daysAbove++;
    if (i < lookback - 1) {
      windowSum -= closes[startIdx + i];
      windowSum += closes[priceIdx];
    }
  }

  const trackRecord = daysAbove / lookback;

  // Confidence = pure 3-year track record: % of days above rolling 200-week SMA.
  // Stocks that consistently trade above their long-term trend rank highest.
  // The BUY zone filter (0–10% above SMA) already handles entry timing.
  const confidence = Math.round(trackRecord * 1000) / 1000;

  return { rating, confidence, trend_base: sma };
}
// =====================================================================

async function fetchGroupedDaily(date: string) {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon grouped daily ${date}: ${res.status}`);
  const json = await res.json();
  return (json.results || []) as Array<{
    T: string; o: number; h: number; l: number; c: number; v: number;
  }>;
}

async function mostRecentTradingDate() {
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    try {
      const rows = await fetchGroupedDaily(iso);
      if (rows.length > 0) return { date: iso, rows };
    } catch (_) {}
  }
  throw new Error("No trading day in last 7 days");
}

async function runScan() {
  const { data: run } = await supabase
    .from("scan_runs").insert({ status: "running" }).select().single();
  const runId = run!.id;

  try {
    const { date, rows } = await mostRecentTradingDate();
    console.log(`Scanning ${rows.length} tickers for ${date}`);

    // 1. Upsert today's bars
    const bars = rows.map(r => ({
      ticker: r.T, trade_date: date,
      open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
    }));
    for (let i = 0; i < bars.length; i += 1000) {
      await supabase.from("price_history").upsert(bars.slice(i, i + 1000));
    }

    // 2. Load eligible universe (large/mega cap: $10B+, no upper limit)
    const { data: universe } = await supabase
      .from("tickers")
      .select("ticker, name, market_cap")
      .gte("market_cap", MARKET_CAP_MIN)
      .eq("active", true);

    const capMap = new Map(universe?.map(u => [u.ticker, u]) || []);
    console.log(`Eligible by market cap: ${capMap.size}`);

    // 3. For each eligible ticker, pull history + run the model
    let flips = 0;
    const newSignals: any[] = [];
    const ratingChanges: any[] = [];

    for (const r of rows) {
      const u = capMap.get(r.T);
      if (!u) continue;  // outside market cap band

      const { data: hist } = await supabase
        .from("price_history")
        .select("close")
        .eq("ticker", r.T)
        .order("trade_date", { ascending: true })
        .limit(HISTORY_DAYS);
      if (!hist) continue;

      const out = rate(hist.map(h => Number(h.close)), u.market_cap || 0);
      if (!out) continue;

      const { data: prev } = await supabase
        .from("signals").select("rating").eq("ticker", r.T).maybeSingle();
      if (prev && prev.rating !== out.rating) {
        ratingChanges.push({ ticker: r.T, from_rating: prev.rating, to_rating: out.rating });
        flips++;
      }

      newSignals.push({
        ticker: r.T,
        company_name: u.name || r.T,
        price: r.c,
        trend_base: out.trend_base,
        rating: out.rating,
        confidence: out.confidence,
        weekly_change: 0,
        rated_at: new Date().toISOString(),
      });
    }

    // 4. Mark top 10 BUYs by confidence
    newSignals.sort((a, b) =>
      a.rating === b.rating
        ? b.confidence - a.confidence
        : a.rating === "BUY" ? -1 : 1);
    newSignals.forEach((s, i) => s.is_top10 = s.rating === "BUY" && i < 10);

    for (let i = 0; i < newSignals.length; i += 500) {
      await supabase.from("signals").upsert(newSignals.slice(i, i + 500));
    }
    if (ratingChanges.length) {
      await supabase.from("rating_changes").insert(ratingChanges);
    }

    await supabase.from("scan_runs").update({
      status: "success",
      finished_at: new Date().toISOString(),
      tickers_seen: newSignals.length,
      flips_count: flips,
    }).eq("id", runId);

    return { ok: true, date, tickers: newSignals.length, flips };
  } catch (e) {
    await supabase.from("scan_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: String(e),
    }).eq("id", runId);
    throw e;
  }
}

Deno.serve(async (_req) => {
  try {
    const result = await runScan();
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
