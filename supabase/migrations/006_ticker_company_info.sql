-- Add company info columns to tickers
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS sector      text;
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS industry    text;
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS website     text;

-- Hardcode descriptions for all 25 ETFs
UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Broad Market',
  description = 'The SPDR S&P 500 ETF Trust seeks to provide investment results that correspond generally to the price and yield of the S&P 500 Index, representing 500 of the largest US companies.'
WHERE ticker = 'SPY';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Large Cap Growth',
  description = 'The Invesco QQQ Trust tracks the Nasdaq-100 Index, which includes the 100 largest non-financial companies listed on the Nasdaq stock exchange, heavily weighted toward technology.'
WHERE ticker = 'QQQ';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Broad Market',
  description = 'The Vanguard S&P 500 ETF seeks to track the performance of the S&P 500 Index, providing low-cost exposure to 500 of the largest US publicly traded companies.'
WHERE ticker = 'VOO';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Total Market',
  description = 'The Vanguard Total Stock Market ETF seeks to track the CRSP US Total Market Index, providing exposure to the entire US equity market including small-, mid-, and large-cap stocks.'
WHERE ticker = 'VTI';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Broad Market',
  description = 'The iShares Core S&P 500 ETF seeks to track the investment results of the S&P 500 Index, providing exposure to 500 large US companies across all sectors.'
WHERE ticker = 'IVV';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Small Cap',
  description = 'The iShares Russell 2000 ETF seeks to track the investment results of the Russell 2000 Index, which measures the performance of the small-capitalization sector of the US equity market.'
WHERE ticker = 'IWM';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Large Cap',
  description = 'The SPDR Dow Jones Industrial Average ETF Trust seeks to provide investment results that correspond generally to the price and yield of the Dow Jones Industrial Average, tracking 30 blue-chip US stocks.'
WHERE ticker = 'DIA';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Commodities',
  description = 'The SPDR Gold Shares ETF is designed to track the price of gold bullion, offering investors a cost-effective and convenient way to gain exposure to the gold market.'
WHERE ticker = 'GLD';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Fixed Income',
  description = 'The iShares 20+ Year Treasury Bond ETF seeks to track an index of US Treasury bonds with remaining maturities greater than twenty years, providing long-duration government bond exposure.'
WHERE ticker = 'TLT';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Commodities',
  description = 'The iShares Silver Trust is designed to reflect the price of silver owned by the trust, offering investors a simple way to gain exposure to silver without physically holding the metal.'
WHERE ticker = 'SLV';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Financials',
  description = 'The Financial Select Sector SPDR Fund seeks to provide investment results that correspond to the price and yield of the Financial Select Sector Index, covering banks, insurance, and investment companies.'
WHERE ticker = 'XLF';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Technology',
  description = 'The Technology Select Sector SPDR Fund seeks to provide investment results that correspond to the Technology Select Sector Index, covering software, hardware, semiconductors, and IT services companies.'
WHERE ticker = 'XLK';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Energy',
  description = 'The Energy Select Sector SPDR Fund seeks to provide investment results that correspond to the Energy Select Sector Index, covering oil, gas, consumable fuels, and energy equipment companies.'
WHERE ticker = 'XLE';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Healthcare',
  description = 'The Health Care Select Sector SPDR Fund seeks to provide investment results that correspond to the Health Care Select Sector Index, covering pharmaceuticals, biotech, medical devices, and health services.'
WHERE ticker = 'XLV';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Industrials',
  description = 'The Industrial Select Sector SPDR Fund seeks to provide investment results that correspond to the Industrial Select Sector Index, covering aerospace, defense, machinery, and transportation companies.'
WHERE ticker = 'XLI';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Consumer Staples',
  description = 'The Consumer Staples Select Sector SPDR Fund seeks to provide investment results that correspond to the Consumer Staples Select Sector Index, covering food, beverage, household, and personal products companies.'
WHERE ticker = 'XLP';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Consumer Discretionary',
  description = 'The Consumer Discretionary Select Sector SPDR Fund seeks to provide investment results that correspond to the Consumer Discretionary Select Sector Index, covering retail, media, hotels, and leisure companies.'
WHERE ticker = 'XLY';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'International Developed',
  description = 'The iShares MSCI EAFE ETF seeks to track the investment results of the MSCI EAFE Index, providing exposure to large and mid-cap equities across Europe, Australasia, and the Far East.'
WHERE ticker = 'EFA';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Emerging Markets',
  description = 'The iShares MSCI Emerging Markets ETF seeks to track the investment results of the MSCI Emerging Markets Index, providing exposure to stocks in developing economies including China, India, and Brazil.'
WHERE ticker = 'EEM';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Fixed Income',
  description = 'The iShares iBoxx High Yield Corporate Bond ETF seeks to track an index of US dollar-denominated, high yield corporate bonds, providing exposure to the below-investment-grade debt market.'
WHERE ticker = 'HYG';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Fixed Income',
  description = 'The iShares Core US Aggregate Bond ETF seeks to track the Bloomberg US Aggregate Bond Index, providing broad exposure to US investment-grade bonds including Treasuries, corporate, and mortgage-backed securities.'
WHERE ticker = 'AGG';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Semiconductors',
  description = 'The VanEck Semiconductor ETF seeks to replicate the MVIS US Listed Semiconductor 25 Index, tracking the performance of companies involved in semiconductor production and equipment.'
WHERE ticker = 'SMH';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Innovation',
  description = 'The ARK Innovation ETF is an actively managed fund that seeks long-term capital growth by investing in companies relevant to ARK''s investment theme of disruptive innovation across genomics, automation, fintech, and AI.'
WHERE ticker = 'ARKK';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Large Cap Growth',
  description = 'The Vanguard Growth ETF seeks to track the CRSP US Large Cap Growth Index, providing exposure to large-cap US stocks characterized by higher growth rates, including major technology and consumer companies.'
WHERE ticker = 'VUG';

UPDATE tickers SET
  sector = 'Exchange Traded Fund',
  industry = 'Semiconductors',
  description = 'The iShares Semiconductor ETF seeks to track the investment results of the PHLX Semiconductor Sector Index, providing exposure to US-listed companies that design, manufacture, and distribute semiconductors.'
WHERE ticker = 'SOXX';
