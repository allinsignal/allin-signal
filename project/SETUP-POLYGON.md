# Allin Signal — Polygon.io + daily scan setup

Daily EOD price pipeline with your strategy wired in:
- Universe: US common stocks, market cap **$10B – $200B**
- Signal: **BUY** when price is **0–10% above the 200-week SMA**
- Confidence: highest near the SMA, lowest at the 10% edge
- Schedule: every weekday after market close

---

## What gets built

```
   Polygon.io
       │
       ├──► refresh-universe (weekly) ──► tickers       (universe + market caps)
       │
       └──► run-scan (daily, weekday)  ──► price_history (raw bars)
                                       ──► signals       (your ratings — site reads this)
                                       ──► rating_changes (BUY↔SELL flips → email alerts)
```

---

## Step 1 — Run migrations

Supabase **SQL Editor → New query**. Run each:
1. `supabase/migrations/002_price_history.sql`
2. `supabase/migrations/003_tickers.sql`

Verify `price_history`, `scan_runs`, `tickers` exist in Table Editor.

---

## Step 2 — Install + link the CLI

```bash
brew install supabase/tap/supabase           # Mac (Windows: scoop install supabase)
supabase login                                # browser auth
supabase link --project-ref ojmbqmbiyjpokhspcjbs
```

---

## Step 3 — Set your Polygon key

```bash
supabase secrets set POLYGON_API_KEY=paste-your-polygon-key
```

---

## Step 4 — Deploy both functions

```bash
supabase functions deploy refresh-universe --no-verify-jwt
supabase functions deploy run-scan --no-verify-jwt
```

---

## Step 5 — Populate the universe (one-time, ~90 sec)

This fetches all ~7,000 active US common stocks.

```bash
curl -X POST https://ojmbqmbiyjpokhspcjbs.supabase.co/functions/v1/refresh-universe \
  -H "Authorization: Bearer YOUR-ANON-KEY"
```

⚠️ **Market cap is the bottleneck on the free tier.** Polygon's reference endpoint returns names + exchanges in 7 calls, but **market_cap requires a per-ticker call** — 7,000 tickers × 12-sec gap = ~24 hours on free tier.

**Three ways to populate market caps:**

**Option A — Upgrade Polygon Starter ($29/mo)** and run with enrichment:
```bash
curl -X POST "https://ojmbqmbiyjpokhspcjbs.supabase.co/functions/v1/refresh-universe?enrich=true" \
  -H "Authorization: Bearer YOUR-ANON-KEY"
```
Completes in ~5 min.

**Option B — Use a free static list** (recommended for launch). I can drop a one-time SQL seed with ~600 known $10B–$200B mid-large caps. Say "seed the cap band" and I'll add it.

**Option C — Run the enrichment in the background for a day.** Free tier, but you wait 24h before the first useful scan.

---

## Step 6 — Trigger the first scan

```bash
curl -X POST https://ojmbqmbiyjpokhspcjbs.supabase.co/functions/v1/run-scan \
  -H "Authorization: Bearer YOUR-ANON-KEY"
```

The first run only has one day of price history → no SMA(200) yet → empty result. **You need to backfill ~4 years of daily bars before BUY ratings appear.** I'll add a backfill helper in the next step — say "build the backfill" once you've completed Steps 1–5.

Expected after backfill: `{ ok: true, date: "...", tickers: 100-600, flips: 0 }`.

---

## Step 7 — Schedule daily + weekly

Paste into the SQL Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Daily scan: weekdays 9:30pm UTC (4:30pm ET)
select cron.schedule('allin-daily-scan', '30 21 * * 1-5', $$
  select net.http_post(
    url := 'https://ojmbqmbiyjpokhspcjbs.supabase.co/functions/v1/run-scan',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR-ANON-KEY',
      'Content-Type', 'application/json'
    )
  );
$$);

-- Universe refresh: Sundays 6am UTC
select cron.schedule('allin-universe-refresh', '0 6 * * 0', $$
  select net.http_post(
    url := 'https://ojmbqmbiyjpokhspcjbs.supabase.co/functions/v1/refresh-universe',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR-ANON-KEY',
      'Content-Type', 'application/json'
    )
  );
$$);
```

---

## Free-tier reality check

Your strategy needs **200 weekly bars (~4 years of daily history)** for the SMA(200) to be valid. From a cold start, the daily scan alone takes 4 years to build that — so a **historical backfill is required** before launch.

On the free tier, backfill = 1 grouped-daily call per past trading day = 1000 calls × 12s = **~3.5 hours unattended**. I'll write this as a one-shot Edge Function with checkpoint/resume — say "build the backfill" and it's yours.

Recommended path: **Polygon Starter ($29/mo)** drops the rate limit, makes the universe enrichment + 4-year backfill finish in ~10 minutes total, and removes all friction. Worth it for launch IMO.

---

## What's left after this phase

- ✅ Auth + watchlist
- 🟡 **Polygon scan (this doc)** — deploy + populate universe + backfill
- ⬜ **Stripe payments**
- ⬜ **Email alerts** (Resend over `rating_changes`)
- ⬜ **Custom domain**

Say "build the backfill" or "seed the cap band" when you're ready to continue.
