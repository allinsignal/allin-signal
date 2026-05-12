-- =====================================================================
-- Allin Signal · Migration 003 — ticker universe
-- Run AFTER 002_price_history.sql.
-- =====================================================================

-- The investable universe: all active US common stocks with market cap.
-- Refreshed weekly by the `refresh-universe` Edge Function.
create table if not exists public.tickers (
  ticker        text primary key,
  name          text,
  market_cap    bigint,           -- in USD
  primary_exch  text,
  active        boolean default true,
  last_updated  timestamptz default now()
);

create index if not exists tickers_mktcap_idx
  on public.tickers(market_cap)
  where active = true;

alter table public.tickers enable row level security;
-- Public can read names + caps (for the watchlist search dropdown etc.)
create policy "tickers: public read"
  on public.tickers for select using (true);
