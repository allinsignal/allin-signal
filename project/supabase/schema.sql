-- =====================================================================
-- Allin Signal · Supabase schema
-- Paste this into Supabase Dashboard → SQL Editor → New query → Run.
-- =====================================================================

-- ---------- 1. PROFILES ----------------------------------------------
-- One row per signed-up user. Auto-created on signup via trigger below.
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  full_name       text,
  is_subscribed   boolean default false,
  subscribed_at   timestamptz,
  created_at      timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- Trigger to create profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------- 2. SIGNALS -----------------------------------------------
-- The output of your scan. One row per ticker, updated by your scan job.
create table if not exists public.signals (
  ticker          text primary key,
  company_name    text not null,
  market_cap_band text check (market_cap_band in ('Small','Mid','Large')),
  price           numeric(12,4) not null,
  trend_base      numeric(12,4),                        -- internal: trend baseline
  rating          text not null check (rating in ('BUY','SELL')),
  confidence      numeric(4,3) check (confidence between 0 and 1),
  weekly_change   numeric(6,3),                         -- % vs last week's close
  rated_at        timestamptz default now(),
  is_top10        boolean default false                 -- featured on the free home page
);

create index if not exists signals_rating_idx on public.signals(rating);
create index if not exists signals_top10_idx on public.signals(is_top10) where is_top10 = true;

alter table public.signals enable row level security;

-- Anyone can read the TOP 10 (the free preview). Members get everything.
create policy "signals: read top10 publicly"
  on public.signals for select
  using (is_top10 = true);

create policy "signals: read all when subscribed"
  on public.signals for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.is_subscribed = true
    )
  );

-- Only service role can write. (Your scan job uses service_role key.)
-- No insert/update/delete policies → blocked for anon + authenticated.


-- ---------- 3. WATCHLIST ITEMS ---------------------------------------
create table if not exists public.watchlist_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  ticker          text not null,
  added_price     numeric(12,4),
  alerts_enabled  boolean default true,
  added_at        timestamptz default now(),
  unique (user_id, ticker)
);

create index if not exists watchlist_user_idx on public.watchlist_items(user_id);

alter table public.watchlist_items enable row level security;

create policy "watchlist: read own"
  on public.watchlist_items for select
  using (auth.uid() = user_id);

create policy "watchlist: insert own"
  on public.watchlist_items for insert
  with check (auth.uid() = user_id);

create policy "watchlist: update own"
  on public.watchlist_items for update
  using (auth.uid() = user_id);

create policy "watchlist: delete own"
  on public.watchlist_items for delete
  using (auth.uid() = user_id);


-- ---------- 4. RATING CHANGES (the feed) -----------------------------
-- One row each time the scan flips a ticker's rating. Drives email alerts.
create table if not exists public.rating_changes (
  id              uuid primary key default gen_random_uuid(),
  ticker          text not null references public.signals(ticker) on delete cascade,
  from_rating     text check (from_rating in ('BUY','SELL')),
  to_rating       text not null check (to_rating in ('BUY','SELL')),
  changed_at      timestamptz default now()
);

create index if not exists rc_changed_at_idx on public.rating_changes(changed_at desc);
create index if not exists rc_ticker_idx on public.rating_changes(ticker);

alter table public.rating_changes enable row level security;

-- Anyone can read changes for their own watchlist tickers.
create policy "rating_changes: read own watchlist"
  on public.rating_changes for select
  using (
    exists (
      select 1 from public.watchlist_items
      where watchlist_items.user_id = auth.uid()
      and watchlist_items.ticker = rating_changes.ticker
    )
  );


-- ---------- 5. SEED DATA (so the UI has something to show) -----------
-- Drop a few demo rows; replace with your real scan output.
insert into public.signals (ticker, company_name, market_cap_band, price, trend_base, rating, confidence, weekly_change, is_top10) values
  ('NRTH','Northwind Logistics','Mid', 42.87, 42.11, 'BUY', 0.86, 1.81, true),
  ('KLVR','Kelvr Semiconductors','Large', 118.42, 116.05, 'BUY', 0.91, 2.04, true),
  ('ARGN','Argentum Mining','Small', 8.94, 8.80, 'BUY', 0.78, 1.59, true),
  ('MAVN','Maven Energy','Large', 64.20, 62.97, 'BUY', 0.83, 1.95, true),
  ('PIVO','Pivota Health','Mid', 27.55, 27.12, 'BUY', 0.76, 1.59, true),
  ('BRDG','Bridgepath Capital','Large', 91.10, 89.40, 'BUY', 0.84, 1.90, true),
  ('TUNDR','Tundra Materials','Small', 14.66, 14.40, 'BUY', 0.72, 1.81, true),
  ('ECLO','Eclora Pharma','Mid', 56.78, 55.92, 'BUY', 0.77, 1.54, true),
  ('AXIS','Axis Robotics','Large', 203.40, 199.85, 'BUY', 0.88, 1.78, true),
  ('OREN','Orenda Foods','Mid', 33.21, 32.71, 'BUY', 0.74, 1.53, true),
  ('SOLR','Solera Solar','Mid', 11.04, 13.20, 'SELL', 0.82, -1.50, false),
  ('ZEN','Zenodo Music','Small', 8.90, 11.10, 'SELL', 0.74, -2.10, false)
on conflict (ticker) do nothing;
