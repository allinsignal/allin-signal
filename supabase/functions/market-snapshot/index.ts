// =====================================================================
// Allin Signal · market-snapshot Edge Function
// Returns current price + daily % change for a list of tickers.
// Called by the frontend ticker banner every 15 minutes.
// =====================================================================

const TICKERS = [
  'AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AVGO',
  'BRK.B','LLY','JPM','V','XOM','MA','WMT','UNH','NFLX','COST',
];

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  try {
    const POLYGON_KEY = Deno.env.get('POLYGON_API_KEY')!;
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers` +
      `?tickers=${TICKERS.join(',')}&apiKey=${POLYGON_KEY}`;

    const res  = await fetch(url);
    const json = await res.json() as {
      tickers?: Array<{
        ticker: string;
        todaysChangePerc: number;
        todaysChange: number;
        day?: { c: number };
        prevDay?: { c: number };
      }>;
    };

    if (!res.ok || !json.tickers) {
      return new Response(
        JSON.stringify({ error: 'Polygon error', status: res.status }),
        { status: 502, headers: CORS }
      );
    }

    const data = json.tickers.map(t => ({
      ticker: t.ticker,
      price:  t.day?.c ?? t.prevDay?.c ?? 0,
      change: +((t.todaysChangePerc ?? 0).toFixed(2)),
    }));

    return new Response(JSON.stringify({ data, ts: Date.now() }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: CORS,
    });
  }
});
