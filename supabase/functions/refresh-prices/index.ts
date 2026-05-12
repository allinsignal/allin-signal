// =====================================================================
// Allin Signal · refresh-prices Edge Function
// =====================================================================
// Fetches the latest daily close for all tickers and upserts into
// price_history. Run before the daily scan so signals use fresh prices.
//
// Designed to be called repeatedly by pg_cron — each invocation
// processes one batch, picking up where the last left off.
//
// Cron: every 5 min from 9–10 PM UTC on weekdays
//   */5 21-22 * * 1-5
// =====================================================================

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function lastTradingDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  // Roll back over weekends
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  try {
    const SB_URL      = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const POLYGON_KEY = Deno.env.get("POLYGON_API_KEY")!;

    const sbHeaders = {
      "apikey": SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    };

    const params    = new URL(req.url).searchParams;
    const tier      = params.get("tier") || "free";
    const gap       = tier === "starter" ? 150 : 13000;
    const batchSize = tier === "starter" ? 50 : 5;

    const dateStr = params.get("date") || lastTradingDay();

    // Find tickers missing this date's price
    const rpcRes = await fetch(`${SB_URL}/rest/v1/rpc/tickers_pending_daily_refresh`, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({ target_date: dateStr, batch_size: batchSize }),
    });

    if (!rpcRes.ok) {
      const err = await rpcRes.text();
      return new Response(JSON.stringify({ error: `RPC failed: ${err}` }), { status: 500 });
    }

    const pending = await rpcRes.json() as Array<{ ticker: string }>;

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        status: "done",
        date: dateStr,
        message: "All tickers up to date",
      }), { headers: { "Content-Type": "application/json" } });
    }

    let written = 0;
    const errors: string[] = [];

    for (let i = 0; i < pending.length; i++) {
      const ticker = pending[i].ticker;

      try {
        const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${dateStr}/${dateStr}?adjusted=true&limit=1&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url);

        if (res.status === 429) {
          await sleep(60000);
          i--; // retry same ticker
          continue;
        }

        if (!res.ok) {
          errors.push(`${ticker}: ${res.status}`);
          if (i < pending.length - 1) await sleep(gap);
          continue;
        }

        const json = await res.json() as {
          results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
        };
        const rows = json.results || [];

        if (rows.length > 0) {
          const r = rows[0];
          const bar = {
            ticker,
            trade_date: dateStr,
            open: r.o, high: r.h, low: r.l, close: r.c,
            volume: Math.round(r.v),
          };

          const upsertRes = await fetch(`${SB_URL}/rest/v1/price_history`, {
            method: "POST",
            headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify([bar]),
          });

          if (upsertRes.ok) {
            written++;
          } else {
            errors.push(`${ticker} upsert: ${await upsertRes.text()}`);
          }
        }
      } catch (e) {
        errors.push(`${ticker}: ${String(e)}`);
      }

      if (i < pending.length - 1) await sleep(gap);
    }

    return new Response(JSON.stringify({
      ok: true,
      status: "in_progress",
      date: dateStr,
      batch_processed: pending.length,
      bars_written: written,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
