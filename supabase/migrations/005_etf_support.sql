-- ETF support migration
-- Run in Supabase SQL Editor

-- 1. Add is_etf flag to both tables
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS is_etf boolean DEFAULT false;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS is_etf boolean DEFAULT false;

-- 2. Insert the 25 most popular ETFs
INSERT INTO tickers (ticker, company_name, is_etf, active)
VALUES
  ('SPY',  'SPDR S&P 500 ETF Trust',                          true, true),
  ('QQQ',  'Invesco QQQ Trust',                               true, true),
  ('VOO',  'Vanguard S&P 500 ETF',                            true, true),
  ('VTI',  'Vanguard Total Stock Market ETF',                  true, true),
  ('IVV',  'iShares Core S&P 500 ETF',                        true, true),
  ('IWM',  'iShares Russell 2000 ETF',                        true, true),
  ('DIA',  'SPDR Dow Jones Industrial Average ETF',            true, true),
  ('GLD',  'SPDR Gold Shares',                                true, true),
  ('TLT',  'iShares 20+ Year Treasury Bond ETF',              true, true),
  ('SLV',  'iShares Silver Trust',                            true, true),
  ('XLF',  'Financial Select Sector SPDR Fund',               true, true),
  ('XLK',  'Technology Select Sector SPDR Fund',              true, true),
  ('XLE',  'Energy Select Sector SPDR Fund',                  true, true),
  ('XLV',  'Health Care Select Sector SPDR Fund',             true, true),
  ('XLI',  'Industrial Select Sector SPDR Fund',              true, true),
  ('XLP',  'Consumer Staples Select Sector SPDR Fund',        true, true),
  ('XLY',  'Consumer Discretionary Select Sector SPDR Fund',  true, true),
  ('EFA',  'iShares MSCI EAFE ETF',                           true, true),
  ('EEM',  'iShares MSCI Emerging Markets ETF',               true, true),
  ('HYG',  'iShares iBoxx High Yield Corporate Bond ETF',     true, true),
  ('AGG',  'iShares Core U.S. Aggregate Bond ETF',            true, true),
  ('SMH',  'VanEck Semiconductor ETF',                        true, true),
  ('ARKK', 'ARK Innovation ETF',                              true, true),
  ('VUG',  'Vanguard Growth ETF',                             true, true),
  ('SOXX', 'iShares Semiconductor ETF',                       true, true)
ON CONFLICT (ticker) DO UPDATE
  SET is_etf = true, active = true, company_name = EXCLUDED.company_name;

-- 3. Helper function: copy is_etf flag from tickers → signals (called after each scan)
CREATE OR REPLACE FUNCTION sync_etf_flags()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.signals s
  SET    is_etf = t.is_etf
  FROM   public.tickers t
  WHERE  s.ticker = t.ticker;
$$;

-- Sync any signals that already exist
SELECT sync_etf_flags();
