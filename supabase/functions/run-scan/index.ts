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
const SMA_DAYS   = 1000;                    // 200-week SMA (200 * 5)
const LOOKBACK_DAYS = 3 * 252;              // 3-year confidence window (~756 days)
const MARKET_CAP_MIN = 10_000_000_000;      // $10B — large cap floor
const MAX_DISTANCE_ABOVE_SMA = 0.10;        // 0–10% above SMA = BUY zone

// ====== ALLIN MODEL (used by runScan — reads SMA from sma_history) ===
// Confidence = % of days in the last 3 years that price was above its
// 200-week SMA. Uses sma_history for SMA values so all Polygon bars
// go to the track record.
function rate(
  closes: number[],         // full Polygon history, ascending
  smaValues: Map<string, number>,  // trade_date -> sma_200w from sma_history
  dates: string[],          // trade_dates matching closes[], ascending
  marketCap: number,
) {
  if (marketCap < MARKET_CAP_MIN) return null;
  if (closes.length < 2) return null;

  const price = closes[closes.length - 1];
  const todayDate = dates[dates.length - 1];
  const sma = smaValues.get(todayDate);
  if (sma == null) return null;

  const distance = (price - sma) / sma;
  const rating = distance >= 0 && distance <= MAX_DISTANCE_ABOVE_SMA ? "BUY" : "SELL";

  // Track record: % of days price was above its SMA (from sma_history)
  let daysAbove = 0;
  let daysTotal = 0;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 3);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (let i = 0; i < closes.length; i++) {
    const d = dates[i];
    if (d < cutoffStr) continue;
    const s = smaValues.get(d);
    if (s == null) continue;
    daysTotal++;
    if (closes[i] > s) daysAbove++;
  }

  if (daysTotal === 0) return null;
  const confidence = Math.round((daysAbove / daysTotal) * 1000) / 1000;

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

    // 1. Upsert today's bars (batched — a handful of DB calls for the whole market)
    const bars = rows.map(r => ({
      ticker: r.T, trade_date: date,
      open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
    }));
    for (let i = 0; i < bars.length; i += 1000) {
      await supabase.from("price_history").upsert(bars.slice(i, i + 1000));
    }

    // 2. Compute today's 200-week SMA for all eligible tickers (single SQL call)
    await supabase.rpc("update_today_sma");

    // 3. Run signal model + write signals + log flips (single SQL call)
    const { data: result, error } = await supabase.rpc("run_signal_scan");
    if (error) throw new Error(error.message);

    // 4. Recompute is_top10 with sma_clean gate (≤5 days below SMA in last 2 years)
    await supabase.rpc("update_top10_ranking");

    await supabase.from("scan_runs").update({
      status: "success",
      finished_at: new Date().toISOString(),
      tickers_seen: result?.signals ?? 0,
      flips_count: result?.flips ?? 0,
    }).eq("id", runId);

    return { ok: true, date, tickers: result?.signals ?? 0, buys: result?.buys ?? 0, flips: result?.flips ?? 0 };
  } catch (e) {
    await supabase.from("scan_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: String(e),
    }).eq("id", runId);
    throw e;
  }
}

// ====== SMA BACKFILL ==================================================
// Fetches 10 years of daily bars from Yahoo Finance (free, no API key),
// computes rolling 1000-day SMA for each date, stores in sma_history.
// Run once via SELECT run_sma_backfill() in SQL Editor.
async function runSmaBackfill() {
  const { data: universe } = await supabase
    .from("tickers").select("ticker").eq("active", true);
  if (!universe?.length) return { ok: true, message: "No active tickers" };

  const CONCURRENCY = 5; // Yahoo Finance is free-tier, keep low
  const results: { ticker: string; rows: number }[] = [];

  for (let i = 0; i < universe.length; i += CONCURRENCY) {
    const wave = universe.slice(i, i + CONCURRENCY);
    const waveResults = await Promise.all(wave.map(async ({ ticker }) => {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=10y`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) {
          console.warn(`Yahoo ${ticker}: ${res.status}`);
          return { ticker, rows: 0 };
        }
        const json = await res.json();
        const result = json?.chart?.result?.[0];
        if (!result) return { ticker, rows: 0 };

        const timestamps: number[] = result.timestamp || [];
        const closes: number[]     = result.indicators?.quote?.[0]?.close || [];

        // Build sorted date+close pairs, filter nulls
        const pairs: { date: string; close: number }[] = [];
        for (let j = 0; j < timestamps.length; j++) {
          if (closes[j] == null) continue;
          const d = new Date(timestamps[j] * 1000).toISOString().slice(0, 10);
          pairs.push({ date: d, close: closes[j] });
        }
        pairs.sort((a, b) => a.date.localeCompare(b.date));

        if (pairs.length < SMA_DAYS) {
          console.warn(`Yahoo ${ticker}: only ${pairs.length} bars, need ${SMA_DAYS}`);
          return { ticker, rows: 0 };
        }

        // Compute rolling SMA with sliding window
        let windowSum = 0;
        for (let j = 0; j < SMA_DAYS; j++) windowSum += pairs[j].close;

        const smaRows: { ticker: string; trade_date: string; sma_200w: number }[] = [];
        // First SMA value is at index SMA_DAYS - 1
        smaRows.push({
          ticker,
          trade_date: pairs[SMA_DAYS - 1].date,
          sma_200w: windowSum / SMA_DAYS,
        });

        for (let j = SMA_DAYS; j < pairs.length; j++) {
          windowSum += pairs[j].close;
          windowSum -= pairs[j - SMA_DAYS].close;
          smaRows.push({
            ticker,
            trade_date: pairs[j].date,
            sma_200w: windowSum / SMA_DAYS,
          });
        }

        // Upsert in batches
        for (let j = 0; j < smaRows.length; j += 500) {
          await supabase.from("sma_history").upsert(smaRows.slice(j, j + 500));
        }

        console.log(`Yahoo ${ticker}: ${smaRows.length} SMA rows stored`);
        return { ticker, rows: smaRows.length };
      } catch (e) {
        console.warn(`Yahoo ${ticker} error:`, e);
        return { ticker, rows: 0 };
      }
    }));
    results.push(...waveResults);

    // Brief pause between waves to be polite to Yahoo
    if (i + CONCURRENCY < universe.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const succeeded = results.filter(r => r.rows > 0).length;
  const failed    = results.filter(r => r.rows === 0).length;
  return { ok: true, total: results.length, succeeded, failed };
}
// =====================================================================

// ====== POLYGON BACKFILL =============================================
// Fetches 5 years of daily bars for all active tickers with insufficient
// history from Polygon.
async function runBackfill() {
  const FROM_DATE  = "2019-01-01";
  const MIN_BARS   = 1200;
  const CONCURRENCY = 20;

  const { data: universe } = await supabase
    .from("tickers").select("ticker").eq("active", true);
  if (!universe?.length) return { ok: true, message: "No active tickers" };

  const counts = await Promise.all(
    universe.map(async u => {
      const { count } = await supabase
        .from("price_history").select("*", { count: "exact", head: true })
        .eq("ticker", u.ticker);
      return { ticker: u.ticker, count: count ?? 0 };
    })
  );
  const needs = counts.filter(c => c.count < MIN_BARS).map(c => c.ticker);
  console.log(`Backfilling ${needs.length} tickers`);

  const to = new Date().toISOString().slice(0, 10);
  const results: { ticker: string; bars: number }[] = [];

  for (let i = 0; i < needs.length; i += CONCURRENCY) {
    const wave = needs.slice(i, i + CONCURRENCY);
    const waveResults = await Promise.all(wave.map(async ticker => {
      try {
        const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${FROM_DATE}/${to}?adjusted=true&sort=asc&limit=10000&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return { ticker, bars: 0 };
        const json = await res.json();
        const bars = (json.results || []).map((r: any) => ({
          ticker,
          trade_date: new Date(r.t).toISOString().slice(0, 10),
          open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
        }));
        for (let j = 0; j < bars.length; j += 1000) {
          await supabase.from("price_history").upsert(bars.slice(j, j + 1000));
        }
        return { ticker, bars: bars.length };
      } catch {
        return { ticker, bars: 0 };
      }
    }));
    results.push(...waveResults);
  }

  return {
    ok: true,
    total: results.length,
    succeeded: results.filter(r => r.bars > 0).length,
    failed: results.filter(r => r.bars === 0).length,
  };
}
// =====================================================================

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    let result;
    if (body.mode === "sma_backfill") {
      result = await runSmaBackfill();
    } else if (body.mode === "backfill") {
      result = await runBackfill();
    } else {
      result = await runScan();
    }
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
