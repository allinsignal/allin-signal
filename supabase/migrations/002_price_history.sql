-- =====================================================================
-- Allin Signal · Migration 002 — daily price history
-- Run AFTER schema.sql. Paste into Supabase SQL Editor → New query → Run.
-- =====================================================================

-- ---------- price_history (daily EOD bars from Polygon) -------------
create table if not exists public.price_history (
  ticker      text not null,
  trade_date  date not null,
  open        numeric(12,4),
  high        numeric(12,4),
  low         numeric(12,4),
  close       numeric(12,4) not null,
  volume      bigint,
  primary key (ticker, trade_date)
);

create index if not exists ph_ticker_date_idx
  on public.price_history(ticker, trade_date desc);

create index if not exists ph_date_idx
  on public.price_history(trade_date desc);

alter table public.price_history enable row level security;

-- No public read policy → blocked for anon and authenticated.
-- Only service_role (used by Edge Functions) can read/write.
-- Members consume aggregated `signals`, not raw history.

-- ---------- scan_runs (audit log of each scan) ----------------------
create table if not exists public.scan_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz default now(),
  finished_at   timestamptz,
  status        text check (status in ('running','success','failed')) default 'running',
  tickers_seen  int default 0,
  flips_count   int default 0,
  error_message text
);

alter table public.scan_runs enable row level security;
-- read-only for everyone (so you can show "last updated" in UI later)
create policy "scan_runs: public read"
  on public.scan_runs for select using (true);

-- ---------- helper: latest scan timestamp ---------------------------
create or replace view public.latest_scan as
  select started_at, finished_at, status, tickers_seen, flips_count
  from public.scan_runs
  where status = 'success'
  order by finished_at desc nulls last
  limit 1;
