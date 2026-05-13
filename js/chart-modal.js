// =====================================================================
// Allin Signal · Chart modal (TradingView embed)
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
        <!-- Header -->
        <div style="
          display:flex;align-items:center;gap:12px;
          padding:14px 18px;border-bottom:1px solid var(--line-soft);flex:none;
        ">
          <div id="cmLogo" style="
            width:34px;height:34px;border-radius:8px;
            display:grid;place-items:center;
            font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
            color:var(--logo-fg);flex:none;
          "></div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;gap:10px">
              <span id="cmTicker" style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:17px"></span>
              <span id="cmName" style="color:var(--fg-2);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
            </div>
            <div style="font-size:11px;color:var(--fg-3);margin-top:1px">Weekly candles · 5-year view — powered by TradingView</div>
          </div>
          <button id="cmClose" aria-label="Close chart" style="
            width:32px;height:32px;border-radius:8px;font-size:18px;line-height:1;
            color:var(--fg-2);display:grid;place-items:center;
            border:1px solid var(--line-soft);
          ">×</button>
        </div>
        <!-- Chart area -->
        <div id="cmContainer" style="flex:1;min-height:0"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const modal     = document.getElementById('chartModal');
  const closeBtn  = document.getElementById('cmClose');

  // ---- Helpers ----
  function hashColor(t) {
    let h = 0;
    for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `oklch(0.65 0.13 ${h % 360})`;
  }

  let tvLoaded = false;
  function loadTV(cb) {
    if (tvLoaded || window.TradingView) { tvLoaded = true; cb(); return; }
    const s = document.createElement('script');
    s.src   = 'https://s3.tradingview.com/tv.js';
    s.async = true;
    s.onload = () => { tvLoaded = true; cb(); };
    s.onerror = () => {
      document.getElementById('cmContainer').innerHTML =
        `<div style="display:grid;place-items:center;height:100%;color:var(--fg-2);font-size:13px">
           Unable to load chart — check your connection and try again.
         </div>`;
    };
    document.head.appendChild(s);
  }

  // ---- Public API ----
  window.openChart = function (ticker, name) {
    document.getElementById('cmLogo').textContent   = ticker.slice(0, 2);
    document.getElementById('cmLogo').style.background = hashColor(ticker);
    document.getElementById('cmTicker').textContent = ticker;
    document.getElementById('cmName').textContent   = name || '';

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    loadTV(() => {
      const container = document.getElementById('cmContainer');
      container.innerHTML = '';

      // TradingView widget - weekly candles, 5-year range for macro view
      new window.TradingView.widget({
        container_id:        'cmContainer',
        symbol:              ticker,
        interval:            'W',
        range:               '5Y',
        timezone:            'America/New_York',
        theme:               isDark ? 'dark' : 'light',
        style:               '1',
        locale:              'en',
        width:               '100%',
        height:              '100%',
        allow_symbol_change: true,
        hide_top_toolbar:    false,
        hide_legend:         false,
        save_image:          false,
        withdateranges:      true,
      });
    });
  };

  window.closeChart = function () {
    modal.style.display = 'none';
    document.body.style.overflow = '';
    document.getElementById('cmContainer').innerHTML = '';
  };

  // ---- Close handlers ----
  closeBtn.addEventListener('click', window.closeChart);
  modal.addEventListener('click', e => {
    if (e.target === modal) window.closeChart();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.style.display !== 'none') window.closeChart();
  });
})();
