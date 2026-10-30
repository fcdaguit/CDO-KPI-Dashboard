/**
 * chartManager.js — Apache ECharts wrapper.
 * Exposes: window.ChartManager
 *
 * - Charts are mounted lazily (IntersectionObserver) and updated with notMerge setOption.
 * - Click on a bar/point = drill-down (applies a filter through the onDrill callback).
 * - Per-chart PNG export and fullscreen. Colours follow the traffic-light rules.
 */
(function (g) {
  'use strict';
  const U = g.Utils;
  const C = U.COLORS;
  const PARETO_CAP = 300;              // max customers drawn in the Pareto chart (cumulative % still uses all)
  const reg = {};                      // id → { el, inst, build, drillKey }
  let io = null;
  let onDrill = () => {};

  const css = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);
  const theme = () => ({
    text: css('--text', '#0f172a'), muted: css('--muted', '#64748b'),
    border: css('--border', '#e2e8f0'), card: css('--card', '#ffffff'),
    dark: document.documentElement.classList.contains('dark'),
  });
  const trunc = (s) => (String(s).length > 16 ? String(s).slice(0, 15) + '…' : String(s));

  function init(opts) {
    onDrill = (opts && opts.onDrill) || onDrill;
    document.addEventListener('fullscreenchange', () => setTimeout(resizeAll, 120));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { document.querySelectorAll('.fs-fallback').forEach((c) => c.classList.remove('fs-fallback')); setTimeout(resizeAll, 80); }
    });
  }

  function register(id, el) {
    reg[id] = { el, inst: null, build: null, drillKey: null };
    if ('IntersectionObserver' in g) {
      io = io || new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { const r = reg[e.target.dataset.chartId]; if (r && !r.inst) mount(r); } });
      }, { rootMargin: '300px' });
      el.dataset.chartId = id;
      io.observe(el);
    } else mount(reg[id]);
  }

  function mount(r) {
    if (r.inst || !g.echarts) return;
    r.inst = g.echarts.init(r.el, null, { renderer: 'canvas' });
    r.inst.on('click', (p) => {
      if (p.componentType === 'series' && r.drillKey && typeof p.name === 'string' && p.name && p.seriesName !== 'Gap') onDrill(r.drillKey, p.name);
    });
    if ('ResizeObserver' in g) new ResizeObserver(() => r.inst && r.inst.resize()).observe(r.el);
    if (r.build) apply(r);
  }

  function apply(r) { r.inst.setOption(r.build(), true); r.inst.resize(); }

  function update(id, build, drillKey) {
    const r = reg[id];
    if (!r) return;
    r.build = build; r.drillKey = drillKey;
    if (r.inst) apply(r);            // otherwise applied when the chart scrolls into view
  }

  /* ------------------------- Target / Actual / Gap chart ---------------- */

  function renderDimension(id, rows, drillKey) {
    update(id, () => {
      const t = theme();
      const n = rows.length;
      const ranked = rows.filter((r) => r.ach != null);
      let top = null, low = null;
      if (ranked.length > 1) {
        top = ranked.reduce((a, b) => (b.ach > a.ach ? b : a));
        low = ranked.reduce((a, b) => (b.ach < a.ach ? b : a));
        if (top === low) top = low = null;
      }
      const mark = [];
      if (top) mark.push({ name: 'Top', coord: [rows.indexOf(top), top.actual], itemStyle: { color: C.green } });
      if (low) mark.push({ name: 'Low', coord: [rows.indexOf(low), low.actual], itemStyle: { color: C.red } });

      const rich = {};
      ['green', 'yellow', 'red', 'na'].forEach((k) => { rich[k] = { color: k === 'na' ? C.na : C[k], fontWeight: 700, fontSize: 11 }; });

      const opt = {
        animationDuration: 350,
        tooltip: {
          trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
          backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.text },
          formatter: (ps) => {
            const r = rows[ps[0].dataIndex];
            if (!r) return '';
            const st = U.status(r.ach);
            return '<div style="min-width:190px"><b>' + U.esc(r.name) + '</b><br/>Target: ' + U.fmtFull(r.target) + '<br/>Actual: ' + U.fmtFull(r.actual) +
              '<br/>Gap: <b style="color:' + (r.gap >= 0 ? C.green : C.red) + '">' + (r.gap > 0 ? '+' : '') + U.fmtFull(r.gap) + '</b><br/>Achievement: <b style="color:' + st.color + '">' + U.fmtPct(r.ach) + '</b> · ' + st.label + '</div>';
          },
        },
        legend: { top: 0, textStyle: { color: t.text }, data: ['Target', 'Actual', 'Gap'] },
        grid: { left: 10, right: 16, top: 48, bottom: n > 15 ? 66 : 10, containLabel: true },
        xAxis: {
          type: 'category', data: rows.map((r) => r.name),
          axisLabel: { color: t.muted, interval: n <= 15 ? 0 : 'auto', rotate: n > 5 ? 30 : 0, formatter: trunc },
          axisLine: { lineStyle: { color: t.border } },
        },
        yAxis: { type: 'value', axisLabel: { color: t.muted, formatter: (v) => U.fmtCompact(v) }, splitLine: { lineStyle: { color: t.border } } },
        series: [
          { name: 'Target', type: 'bar', barMaxWidth: 34, barGap: '6%', itemStyle: { color: t.dark ? '#6366f1' : '#a5b4fc', borderRadius: [4, 4, 0, 0] }, data: rows.map((r) => r.target) },
          {
            name: 'Actual', type: 'bar', barMaxWidth: 34, itemStyle: { color: C.primary, borderRadius: [4, 4, 0, 0] },
            data: rows.map((r) => {
              const hi = r === top || r === low;
              return { value: r.actual, itemStyle: { color: U.status(r.ach).color, borderRadius: [4, 4, 0, 0], borderColor: hi ? t.text : 'transparent', borderWidth: hi ? 2 : 0 } };
            }),
            label: { show: true, position: 'top', rich, formatter: (p) => { const r = rows[p.dataIndex]; return r ? '{' + U.status(r.ach).key + '|' + U.fmtPct(r.ach, 0) + '}' : ''; } },
            labelLayout: { hideOverlap: true },
            markPoint: mark.length ? { symbol: 'pin', symbolSize: 40, symbolOffset: [0, -24], label: { formatter: (p) => (p.name === 'Top' ? '★' : '▼'), color: '#fff', fontSize: 12 }, data: mark, tooltip: { show: false } } : undefined,
          },
          {
            // Gap overlay indicator: a connector from the target level to the actual level (green = surplus, red = shortfall)
            name: 'Gap', type: 'custom', z: 6, silent: true, encode: { x: 0, y: [1, 2] },
            data: rows.map((r, i) => [i, r.target, r.actual]),
            renderItem: (params, api) => {
              const i = api.value(0), tg = api.value(1), ac = api.value(2);
              const a = api.coord([i, tg]), b = api.coord([i, ac]);
              const col = ac >= tg ? C.green : C.red;
              return {
                type: 'group', children: [
                  { type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: col, lineWidth: 2.5, lineDash: [4, 3] } },
                  { type: 'circle', shape: { cx: b[0], cy: b[1], r: 3.5 }, style: { fill: col } },
                ],
              };
            },
          },
        ],
      };
      if (n > 15) {
        const end = (15 / n) * 100;
        opt.dataZoom = [{ type: 'inside', start: 0, end }, { type: 'slider', height: 18, bottom: 8, start: 0, end, textStyle: { color: t.muted } }];
      }
      return opt;
    }, drillKey);
  }

  /* ------------------------------ Pareto chart -------------------------- */

  function renderPareto(id, par, drillKey) {
    update(id, () => {
      const t = theme();
      const rows = par.rows.slice(0, PARETO_CAP);
      const n = rows.length;
      const opt = {
        animationDuration: 350,
        tooltip: {
          trigger: 'axis', axisPointer: { type: 'cross' }, confine: true,
          backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.text },
          formatter: (ps) => {
            const r = rows[ps[0].dataIndex];
            if (!r) return '';
            return '<div style="min-width:180px"><b>' + U.esc(r.name) + '</b><br/>Actual: ' + U.fmtFull(r.actual) + '<br/>Contribution: ' + U.fmtPct(r.contrib, 2) +
              '<br/>Cumulative: ' + U.fmtPct(r.cum, 2) + '<br/>' + (r.core ? 'Core (within first 80%)' : 'Long tail') + '</div>';
          },
        },
        legend: { top: 0, textStyle: { color: t.text }, data: ['Actual Sales', 'Cumulative %'] },
        grid: { left: 10, right: 12, top: 48, bottom: n > 25 ? 66 : 10, containLabel: true },
        xAxis: {
          type: 'category', data: rows.map((r) => r.name),
          axisLabel: { color: t.muted, interval: n <= 25 ? 0 : 'auto', rotate: n > 5 ? 35 : 0, formatter: trunc },
          axisLine: { lineStyle: { color: t.border } },
        },
        yAxis: [
          { type: 'value', axisLabel: { color: t.muted, formatter: (v) => U.fmtCompact(v) }, splitLine: { lineStyle: { color: t.border } } },
          { type: 'value', min: 0, max: 100, axisLabel: { color: t.muted, formatter: '{value}%' }, splitLine: { show: false } },
        ],
        series: [
          {
            name: 'Actual Sales', type: 'bar', barMaxWidth: 34, itemStyle: { color: C.primary, borderRadius: [4, 4, 0, 0] },
            data: rows.map((r) => ({ value: r.actual, itemStyle: { color: r.core ? C.primary : C.primarySoft, borderRadius: [4, 4, 0, 0] } })),
          },
          {
            name: 'Cumulative %', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 5,
            lineStyle: { color: C.yellow, width: 2.5 }, itemStyle: { color: C.yellow },
            data: rows.map((r) => +r.cum.toFixed(2)),
            markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: C.red }, label: { formatter: '80%', color: t.text }, data: [{ yAxis: 80 }] },
          },
        ],
      };
      if (n > 25) {
        const end = (25 / n) * 100;
        opt.dataZoom = [{ type: 'inside', start: 0, end }, { type: 'slider', height: 18, bottom: 8, start: 0, end, textStyle: { color: t.muted } }];
      }
      return opt;
    }, drillKey);
  }

  /* ------------------------- exports / view helpers --------------------- */

  function download(url, name) {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function exportPNG(id, name) {
    const r = reg[id];
    if (!r) return;
    if (!r.inst) mount(r);
    if (!r.inst) return;
    download(r.inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: theme().card }), (name || id) + '.png');
  }

  function fullscreen(id) {
    const r = reg[id];
    if (!r) return;
    const card = r.el.closest('.chart-card');
    const on = document.fullscreenElement === card || card.classList.contains('fs-fallback');
    if (on) {
      if (document.fullscreenElement) document.exitFullscreen();
      card.classList.remove('fs-fallback');
    } else if (card.requestFullscreen) {
      card.requestFullscreen().catch(() => card.classList.add('fs-fallback'));
    } else card.classList.add('fs-fallback');
    setTimeout(resizeAll, 150);
  }

  /** Mount every visible chart (needed before a PDF export so nothing is blank). */
  function ensureAll() {
    Object.keys(reg).forEach((id) => { const r = reg[id]; if (!r.inst && r.el.offsetParent !== null) mount(r); });
    resizeAll();
  }

  function resizeAll() { Object.keys(reg).forEach((id) => reg[id].inst && reg[id].inst.resize()); }

  g.ChartManager = { init, register, renderDimension, renderPareto, exportPNG, fullscreen, ensureAll, resizeAll };
})(window);
