// Shared YTD % + sparkline helpers used across all pages.
// Requires window.allin.supabase (set up by supabase-client.js).
(function () {
  async function getTickerSummaries(tickers) {
    if (!tickers?.length || !window.allin?.supabase) return {};
    const { data, error } = await window.allin.supabase
      .rpc('get_ticker_summaries', { p_tickers: tickers });
    if (error || !data) return {};
    const map = {};
    data.forEach(d => { map[d.ticker] = d; });
    return map;
  }

  function renderSparkSVG(prices, signal, w, h) {
    w = w || 80; h = h || 32;
    if (!prices?.length) return '';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const n = prices.length;
    const pts = prices.map((p, i) => {
      const x = n > 1 ? (i / (n - 1)) * w : w / 2;
      const y = (h - 2) - ((p - min) / range) * (h - 4);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const color = signal === 'SELL' ? 'var(--sell)' : 'var(--buy)';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h +
      '" preserveAspectRatio="none" style="display:block;overflow:visible">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color +
      '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '</svg>';
  }

  function renderYTD(pct) {
    if (pct == null || isNaN(Number(pct))) return '';
    const n = Number(pct);
    const up = n >= 0;
    const color = up ? 'var(--buy)' : 'var(--sell)';
    return '<span style="color:' + color + ';font-weight:600;font-size:11px;' +
      'font-family:\'JetBrains Mono\',monospace">' + (up ? '+' : '') + n.toFixed(1) + '% YTD</span>';
  }

  window.tickerSummary = { getTickerSummaries, renderSparkSVG, renderYTD };
})();
