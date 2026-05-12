// =====================================================================
// Allin Signal · backfill Edge Function
// =====================================================================
// One-shot historical backfill. Fetches grouped-daily bars from Polygon
// for every trading day in a date range and upserts to price_history.
//
// SAFE TO RE-RUN — uses upsert + a checkpoint table so a crashed run
// resumes from the last completed date.
//
// Usage:
//   POST /functions/v1/backfill?days=1000
//   POST /functions/v1/backfill?from=2021-01-01&to=2025-05-09
//   POST /functions/v1/backfill?reset=true        (clears the checkpoint)
//
// Free tier (5 calls/min): ~12s gap between calls. 1000 days ≈ 3.5h.
// Starter tier: ~1000 days in 3–5 min.
//
// Edge Functions time out at ~150s. To handle that:
//   - Each invocation processes a BATCH (default 8 dates) then returns.
//   - You re-invoke until status === 'done'. A small shell loop or the
//     cron job below drives it to completion automatically.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const POLYGON_KEY = Deno.env.get("POLYGON_API_KEY")!;
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase    = createClient(SB_URL, SB_SERVICE);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const BATCH_PER_INVOCATION = 8;     // dates to process before returning
const FREE_TIER_GAP_MS     = 13000; // 5 calls/min + buffer
const STARTER_GAP_MS       = 100;   // unlimited, but be polite

async function fetchGroupedDaily(date: string) {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (res.status === 429) {
    await sleep(60000);
    return await fetchGroupedDaily(date);
  }
  if (res.status === 404) return [];   // non-trading day
  if (!res.ok) throw new Error(`Polygon ${date}: ${res.status}`);
  const json = await res.json();
  return (json.results || []) as Array<{
    T: string; o: number; h: number; l: number; c: number; v: number;
  }>;
}

function* dateRange(from: Date, to: Date) {
  for (let d = new Date(to); d >= from; d.setDate(d.getDate() - 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;   // skip weekends
    yield d.toISOString().slice(0, 10);
  }
}

async function getCheckpoint() {
  const { data } = await supabase
    .from("scan_runs").select("*")
    .eq("status", "running").ilike("error_message", "backfill:%")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const reset = url.searchParams.get("reset") === "true";
  const tier  = url.searchParams.get("tier") || "free";   // 'free' | 'starter'
  const gap   = tier === "starter" ? STARTER_GAP_MS : FREE_TIER_GAP_MS;

  // Determine date range
  const days = parseInt(url.searchParams.get("days") || "1050", 10);
  const fromStr = url.searchParams.get("from");
  const toStr   = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const to   = new Date(toStr);
  const from = fromStr ? new Date(fromStr)
                       : new Date(to.getTime() - days * 86400000);

  try {
    if (reset) {
      await supabase.from("scan_runs")
        .update({ status: "failed", error_message: "backfill: reset" })
        .eq("status", "running").ilike("error_message", "backfill:%");
      return new Response(JSON.stringify({ ok: true, reset: true }));
    }

    // Find or create checkpoint
    let checkpoint = await getCheckpoint();
    let cursor: string;
    if (checkpoint) {
      cursor = checkpoint.error_message.split("backfill:cursor=")[1] || toStr;
    } else {
      cursor = toStr;
      const { data } = await supabase.from("scan_runs").insert({
        status: "running",
        error_message: `backfill:cursor=${cursor}`,
      }).select().single();
      checkpoint = data;
    }

    // Build list of remaining dates this invocation will handle
    const remaining: string[] = [];
    for (const d of dateRange(from, new Date(cursor))) {
      remaining.push(d);
      if (remaining.length >= BATCH_PER_INVOCATION) break;
    }

    if (remaining.length === 0) {
      await supabase.from("scan_runs").update({
        status: "success",
        finished_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", checkpoint!.id);
      return new Response(JSON.stringify({ ok: true, status: "done" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Process the batch
    let bars_written = 0;
    let last_processed = cursor;
    for (const date of remaining) {
      const rows = await fetchGroupedDaily(date);
      if (rows.length > 0) {
        const bars = rows.map(r => ({
          ticker: r.T, trade_date: date,
          open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
        }));
        for (let i = 0; i < bars.length; i += 1000) {
          await supabase.from("price_history").upsert(bars.slice(i, i + 1000));
        }
        bars_written += bars.length;
      }
      last_processed = date;
      // advance cursor to the day BEFORE the one we just did
      const prev = new Date(date);
      prev.setDate(prev.getDate() - 1);
      const cursorNew = prev.toISOString().slice(0, 10);
      await supabase.from("scan_runs")
        .update({ error_message: `backfill:cursor=${cursorNew}`,
                  tickers_seen: (checkpoint!.tickers_seen || 0) + rows.length })
        .eq("id", checkpoint!.id);
      checkpoint!.tickers_seen = (checkpoint!.tickers_seen || 0) + rows.length;

      if (date !== remaining[remaining.length - 1]) await sleep(gap);
    }

    // Are we done after this batch?
    const nextCursor = new Date(last_processed);
    nextCursor.setDate(nextCursor.getDate() - 1);
    const done = nextCursor < from;
    if (done) {
      await supabase.from("scan_runs").update({
        status: "success",
        finished_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", checkpoint!.id);
    }

    return new Response(JSON.stringify({
      ok: true,
      status: done ? "done" : "in_progress",
      batch_processed: remaining.length,
      last_date: last_processed,
      next_date: done ? null : nextCursor.toISOString().slice(0, 10),
      target_from: from.toISOString().slice(0, 10),
      bars_written,
      total_rows_so_far: checkpoint!.tickers_seen,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
