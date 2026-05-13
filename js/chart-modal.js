// =====================================================================
// Allin Signal · Chart modal — Lightweight Charts + Supabase price_history
// Usage: openChart(ticker, companyName)
// =====================================================================

(function () {
  // ---- Inject modal HTML ----
  const root = document.createElement('div');
  root.innerHTML = `
    <div id="chartModal" style="
      display:none;position:fixed;inset:0;z-index:500;
      background:oklch(0 0 0/0.72);backdrop-filter:blur(6px);
      align-items:center;justify-content:center;padding:16px;
    ">
      <div style="
        background:var(--bg-1);border:1px solid var(--line);border-radius:16px;
        width:100%;max-width:1100px;height:min(760px,90vh);
        display:flex;flex-direction:column;overflow:hidden;
        box-shadow:0 24px 64px oklch(0 0 0/0.5);
      ">
        <div style="
          display:flex;align-items:center;gap:12px;
          padding:14px 18px;border-bottom:1px solid var(--line-soft);flex:none;
        ">
          <div id="cmLogo" style="
            width:34px;height:34px;border-radius:8px;flex:none;
            display:grid;place-items:center;
            font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
            color:var(--logo-fg);
          "></div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
              <span id="cmTicker" style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:17px"></span>
              <span id="cmName" style="color:var(--fg-2);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
            </div>
            <div style="font-size:11px;color:var(--fg-3);margin-top:1px">Daily candlestick chart</div>
          </div>
          <button id="cmClose" aria-label="Close chart" style="
            width:32px;height:32px;border-radius:8px;font-size:18px;line-height:1;
            color:var(--fg-2);display:grid;place-items:center;
            border:1px solid var(--line-soft);flex:none;
          ">×</button>
        </div>
        <div id="cmContainer" style="flex:1;min-height:0;position:relative"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const modal    = document.getElementById('chartModal');
  const closeBtn = document.getElementById('cmClose');

  function hashColor(t) {
    let h = 0;
    for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `oklch(0.65 0.13 ${h % 360})`;
  }

  // ---- Load Lightweight Charts from CDN ----
  let lwcReady = false;
  function loadLWC() {
    return new Promise((resolve, reject) => {
      if (lwcReady || window.LightweightCharts) { lwcReady = true; resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';
      s.onload  = () => { lwcReady = true; resolve(); };
      s.onerror = () => reject(new Error('Could not load charting library'));
      document.head.appendChild(s);
    });
  }

  // ---- Fetch price history from Supabase ----
  async function fetchPrices(ticker) {
    if (!window.allin?.supabase) return { data: [], error: 'Supabase not ready' };
    const from = new Date();
    from.setFullYear(from.getFullYear() - 6);
    const { data, error } = await window.allin.supabase
      .from('price_history')
      .select('trade_date,open,high,low,close')
      .eq('ticker', ticker)
      .gte('trade_date', from.toISOString().slice(0, 10))
      .order('trade_date', { ascending: true })
      .limit(2000);
    return { data: data || [], error };
  }

  function setLoading(msg) {
    document.getElementById('cmContainer').innerHTML =
      `<div style="display:grid;place-items:center;height:100%;color:var(--fg-2);font-size:13px">${msg}</div>`;
  }

  // ---- Public API ----
  window.openChart = async function (ticker, name) {
    document.getElementById('cmLogo').textContent    = ticker.slice(0, 2);
    document.getElementById('cmLogo').style.background = hashColor(ticker);
    document.getElementById('cmTicker').textContent  = ticker;
    document.getElementById('cmName').textContent    = name || '';

    modal.style.display       = 'flex';
    document.body.style.overflow = 'hidden';
    setLoading('Loading price history…');

    try {
      const [{ data: rows, error: fetchErr }] = await Promise.all([fetchPrices(ticker), loadLWC()]);

      if (fetchErr) {
        setLoading(
          `<b>Database error for ${ticker}:</b><br>` +
          `<span style="font-size:11px;color:var(--fg-3)">${fetchErr?.message || JSON.stringify(fetchErr)}</span>`
        );
        return;
      }

      if (!rows.length) {
        setLoading(
          `No price history found for <b>${ticker}</b>.<br>` +
          `<span style="font-size:11px;color:var(--fg-3)">This ticker may not be in the price database yet.</span><br>` +
          `<a href="https://www.tradingview.com/chart/?symbol=${ticker}" ` +
          `target="_blank" rel="noopener" ` +
          `style="color:var(--accent);margin-top:10px;display:inline-block">` +
          `View on TradingView ↗</a>`
        );
        return;
      }

      const candles = rows.map(r => ({
        time:  r.trade_date,
        open:  +r.open,
        high:  +r.high,
        low:   +r.low,
        close: +r.close,
      }));

      const container = document.getElementById('cmContainer');
      container.innerHTML = '';

      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const bg     = isDark ? '#1c2232' : '#fafafa';
      const grid   = isDark ? '#252c3e' : '#ebebeb';
      const border = isDark ? '#313a52' : '#d8d8d8';
      const text   = isDark ? '#8a93a8' : '#555';

      const chart = window.LightweightCharts.createChart(container, {
        width:  container.clientWidth,
        height: container.clientHeight,
        layout: { background: { color: bg }, textColor: text },
        grid: {
          vertLines: { color: grid },
          horzLines: { color: grid },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: border },
        timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
        handleScroll: true,
        handleScale:  true,
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor:         '#52c87a',
        downColor:       '#e8614d',
        borderUpColor:   '#52c87a',
        borderDownColor: '#e8614d',
        wickUpColor:     '#52c87a',
        wickDownColor:   '#e8614d',
      });
      candleSeries.setData(candles);
      chart.timeScale().fitContent();

      // Responsive resize
      const ro = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      });
      ro.observe(container);

      container._lwcChart = chart;
      container._lwcRO    = ro;

    } catch (e) {
      setLoading('Could not load chart — please try again.');
      console.warn('chart-modal:', e);
    }
  };

  window.closeChart = function () {
    modal.style.display          = 'none';
    document.body.style.overflow = '';
    const c = document.getElementById('cmContainer');
    if (c._lwcChart) { c._lwcChart.remove(); c._lwcChart = null; }
    if (c._lwcRO)    { c._lwcRO.disconnect(); c._lwcRO = null; }
    c.innerHTML = '';
  };

  closeBtn.addEventListener('click', window.closeChart);
  modal.addEventListener('click', e => { if (e.target === modal) window.closeChart(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.style.display !== 'none') window.closeChart();
  });
})();
