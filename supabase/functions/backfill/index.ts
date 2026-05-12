// =====================================================================
// Allin Signal · backfill Edge Function (stateless)
// =====================================================================
// Resumes automatically by checking the earliest date in price_history.
// Safe to call repeatedly — the cron drives it to completion.
//
// Usage:
//   POST /functions/v1/backfill?tier=starter   (Starter plan)
//   POST /functions/v1/backfill                 (free tier)
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const POLYGON_KEY = Deno.env.get("POLYGON_API_KEY")!;
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase    = createClient(SB_URL, SB_SERVICE);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchGroupedDaily(date: string) {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (res.status === 429) { await sleep(60000); return fetchGroupedDaily(date); }
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Polygon ${date}: ${res.status}`);
  const json = await res.json();
  return (json.results || []) as Array<{
    T: string; o: number; h: number; l: number; c: number; v: number;
  }>;
}

Deno.serve(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const tier      = params.get("tier") || "free";
    const gap       = tier === "starter" ? 100 : 13000;
    const batchSize = tier === "starter" ? 60 : 8;
    const targetDays = parseInt(params.get("days") || "1050");

    // How far back we need to go (calendar days with buffer)
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - Math.ceil(targetDays * 1.5));

    // Find our earliest existing data point to know where to resume
    const { data: rows } = await supabase
      .from("price_history")
      .select("trade_date")
      .order("trade_date", { ascending: true })
      .limit(1);
    const earliestDate: string | null = rows?.[0]?.trade_date ?? null;

    // Start the day before our earliest data, or from yesterday if none
    // (today's grouped daily data isn't published until after market close)
    const cursorDate = earliestDate
      ? (() => { const d = new Date(earliestDate); d.setDate(d.getDate() - 1); return d; })()
      : (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();

    // Already have enough history
    if (cursorDate < targetDate) {
      return new Response(JSON.stringify({
        ok: true,
        status: "done",
        earliest_date: earliestDate,
        message: "Price history is complete",
      }), { headers: { "Content-Type": "application/json" } });
    }

    // Collect next batch of weekdays going backwards
    const dates: string[] = [];
    for (
      let d = new Date(cursorDate);
      d >= targetDate && dates.length < batchSize;
      d.setDate(d.getDate() - 1)
    ) {
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        dates.push(d.toISOString().slice(0, 10));
      }
    }

    if (dates.length === 0) {
      return new Response(JSON.stringify({ ok: true, status: "done" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch and store each date
    let barsWritten = 0;
    for (let i = 0; i < dates.length; i++) {
      const rows = await fetchGroupedDaily(dates[i]);
      if (rows.length > 0) {
        const bars = rows.map(r => ({
          ticker: r.T, trade_date: dates[i],
          open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
        }));
        for (let j = 0; j < bars.length; j += 1000) {
          await supabase.from("price_history").upsert(bars.slice(j, j + 1000));
        }
        barsWritten += rows.length;
      }
      if (i < dates.length - 1) await sleep(gap);
    }

    return new Response(JSON.stringify({
      ok: true,
      status: "in_progress",
      batch_processed: dates.length,
      newest_in_batch: dates[0],
      oldest_in_batch: dates[dates.length - 1],
      bars_written: barsWritten,
      target_from: targetDate.toISOString().slice(0, 10),
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
