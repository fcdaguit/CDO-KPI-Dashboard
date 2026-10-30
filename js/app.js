/**
 * app.js — application controller: loading, rendering pipeline, events, theme, auto-refresh.
 * Wires together DataService, Filters, ChartManager, InsightEngine, TableManager and ExportManager.
 */
(function () {
  'use strict';

  /* ----------------------------- configuration -------------------------- */
  const CONFIG = {
    title: 'Sales KPI Dashboard',
    // Published Google Sheet (File → Share → Publish to web → CSV). Change this to point at another sheet.
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQxYJVZKIkTB6AKZEcvosn3yx2u1Tad0Avb_Jp3NY92pBjKGfxYu_Qw1nh91t7fjae67U5u-3AXYqPu/pub?gid=0&single=true&output=csv',
    autoRefreshMs: 5 * 60 * 1000,
  };

  const U = Utils, DS = DataService;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const CHARTS = [
    { key: 'salesperson', title: 'Salesperson Performance', sub: 'Target vs. Actual sellout · achievement % labelled', wide: true },
    { key: 'product', title: 'Product Classification Performance', sub: 'Target vs. Actual by classification' },
    { key: 'channel', title: 'Channel Performance', sub: 'Target vs. Actual by channel' },
    { key: 'storeFormat', title: 'Store Format Performance', sub: 'Target vs. Actual by store format', wide: true },
  ];
  const AGG_KEYS = ['salesperson', 'product', 'channel', 'storeFormat', 'customer'];

  const state = {
    data: null, filtered: [], aggs: {}, totals: null, par: null,
    sort: { salesperson: 'desc', product: 'desc', channel: 'desc', storeFormat: 'desc' },
    parLimit: 50, updatedAt: null, timer: null, loading: false,
  };

  /* ------------------------------- helpers ------------------------------ */
  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, 4200);
  }

  const sortRows = (rows, dir) => rows.slice().sort((a, b) => {
    if (a.ach == null && b.ach == null) return 0;
    if (a.ach == null) return 1;
    if (b.ach == null) return -1;
    return dir === 'asc' ? a.ach - b.ach : b.ach - a.ach;
  });

  function insightsHTML(items) {
    return items.map((i) =>
      '<div class="ins st-' + i.tone + '"><div class="ins-h">' + U.esc(i.label) +
      (i.badge ? ' <span class="badge st-' + i.tone + '">' + U.esc(i.badge) + '</span>' : '') +
      '</div><p>' + U.esc(i.text) + '</p></div>').join('');
  }

  /* ------------------------------ UI scaffolding ------------------------ */
  function toolbar(key, sortable) {
    return '<div class="chart-tools" data-html2canvas-ignore="true">' +
      (sortable ? '<button type="button" class="tbtn" data-act="sort" data-dir="desc" data-chart="' + key + '" title="Sort by achievement, high to low">↓ High</button>' +
        '<button type="button" class="tbtn" data-act="sort" data-dir="asc" data-chart="' + key + '" title="Sort by achievement, low to high">↑ Low</button>' : '') +
      '<button type="button" class="tbtn" data-act="png" data-chart="' + key + '" title="Download chart as PNG">PNG</button>' +
      '<button type="button" class="tbtn" data-act="fs" data-chart="' + key + '" title="Fullscreen">⛶</button></div>';
  }

  function buildCards() {
    const html = CHARTS.map((c) =>
      '<section class="card chart-card' + (c.wide ? ' wide' : '') + '" id="sec-' + c.key + '" data-pdf-section>' +
      '<div class="card-head"><div><h2>' + c.title + '</h2><p class="muted">' + c.sub + ' <span class="hint">· click a bar to drill down</span></p></div>' + toolbar(c.key, true) + '</div>' +
      '<div class="chart" id="chart-' + c.key + '"></div>' +
      '<div class="insights" id="ins-' + c.key + '"></div></section>').join('');
    const pareto =
      '<section class="card chart-card wide" id="sec-pareto" data-pdf-section>' +
      '<div class="card-head"><div><h2>Pareto Analysis — 80/20 Customer Performance</h2><p class="muted">Actual sales by customer with cumulative contribution <span class="hint">· click a bar to drill down</span></p></div>' + toolbar('pareto', false) + '</div>' +
      '<div class="chart" id="chart-pareto"></div>' +
      '<div class="insights" id="ins-pareto"></div>' +
      '<div class="tbl-wrap small"><table class="tbl"><thead><tr><th class="num">#</th><th>Customer Name</th><th class="num">Actual Sales</th><th class="num">Contribution %</th><th class="num">Cumulative %</th></tr></thead><tbody id="paretoBody"></tbody></table></div>' +
      '<div class="more-row" data-html2canvas-ignore="true"><button type="button" id="paretoMore" class="tbtn">Show more customers</button></div></section>';
    $('#chartsGrid').innerHTML = html + pareto;
    CHARTS.forEach((c) => ChartManager.register('chart-' + c.key, $('#chart-' + c.key)));
    ChartManager.register('chart-pareto', $('#chart-pareto'));
  }

  /* ------------------------------- loading ------------------------------ */
  function setLoading(on) {
    $('#loader').classList.toggle('hidden', !on);
    $('#btnRefresh').disabled = on;
    $('#btnRefresh').classList.toggle('spin', on);
  }

  function showError(err) {
    const e = $('#errorBox');
    e.classList.remove('hidden');
    e.innerHTML = '<h3>Unable to load data</h3><p>' + U.esc(err.message || String(err)) + '</p>' +
      (err.hint ? '<p class="muted">' + U.esc(err.hint) + '</p>' : '') +
      '<button type="button" class="btn" id="btnRetry">Try again</button>';
    $('#btnRetry').addEventListener('click', () => load(true));
    $('#analytics').classList.add('hidden');
    $('#tableSection').classList.add('hidden');
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    setLoading(true);
    $('#errorBox').classList.add('hidden');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));   // let the spinner paint before parsing
    try {
      const data = await DS.load(CONFIG.csvUrl);
      applyData(data);
      state.updatedAt = new Date();
      $('#lastUpdated').textContent = 'Last updated: ' + U.timestamp(state.updatedAt);
    } catch (err) {
      if (state.data) toast('Refresh failed: ' + err.message + ' Showing previously loaded data.', 'error');
      else showError(err);
      console.error(err);
    } finally {
      state.loading = false;
      setLoading(false);
    }
  }

  function applyData(data) {
    state.data = data;
    const dims = DS.DIMS.filter((d) => data.map[d.key]);
    Filters.setData(dims, data.options);
    TableManager.setSchema(data.headers, data.map);

    const ok = !data.missingRequired.length;
    $('#analytics').classList.toggle('hidden', !ok);
    $('#tableSection').classList.remove('hidden');
    CHARTS.forEach((c) => $('#sec-' + c.key).classList.toggle('hidden', !data.map[c.key]));
    $('#sec-pareto').classList.toggle('hidden', !data.map.customer);
    $('#mapInfo').innerHTML = '<summary>Detected columns</summary><ul>' + DS.FIELDS.map((f) =>
      '<li><b>' + U.esc(f.label) + '</b> → ' + (data.map[f.key] ? U.esc(data.map[f.key]) : '<i>not found</i>') + '</li>').join('') + '</ul>';
    render();
  }

  /* ------------------------------- rendering ---------------------------- */
  function render() {
    const d = state.data;
    if (!d) return;
    const recs = Filters.apply(d.records);
    state.filtered = recs;
    state.totals = DS.totals(recs);
    const keys = AGG_KEYS.filter((k) => d.map[k]);
    state.aggs = DS.aggregate(recs, keys);

    $('#recordCount').textContent = recs.length.toLocaleString() + ' of ' + d.records.length.toLocaleString() + ' records';
    renderFilterChips();
    renderBanner();
    TableManager.setData(recs);

    if (d.missingRequired.length) return;
    renderKPIs();
    CHARTS.forEach((c) => {
      if (!state.aggs[c.key]) return;
      renderChart(c.key);
      $('#ins-' + c.key).innerHTML = insightsHTML(InsightEngine.forDimension(c.key, state.aggs[c.key]));
    });
    renderPareto();
  }

  function renderChart(key) {
    ChartManager.renderDimension('chart-' + key, sortRows(state.aggs[key], state.sort[key]), key);
    $$('[data-act=sort][data-chart=' + key + ']').forEach((b) => b.classList.toggle('on', b.dataset.dir === state.sort[key]));
  }

  function renderPareto() {
    if (!state.aggs.customer) return;
    state.par = InsightEngine.computePareto(state.aggs.customer);
    ChartManager.renderPareto('chart-pareto', state.par, 'customer');
    $('#ins-pareto').innerHTML = insightsHTML(InsightEngine.paretoInsights(state.par));
    renderParetoTable();
  }

  function renderParetoTable() {
    const par = state.par;
    const rows = par.rows.slice(0, state.parLimit);
    $('#paretoBody').innerHTML = rows.map((r, i) =>
      '<tr class="' + (r.core ? 'core' : '') + (i === par.n80 - 1 ? ' cut' : '') + '"><td class="num">' + (i + 1) + '</td><td>' + U.esc(r.name) + '</td><td class="num">' + U.fmtFull(r.actual) +
      '</td><td class="num">' + U.fmtPct(r.contrib, 2) + '</td><td class="num">' + U.fmtPct(r.cum, 2) + '</td></tr>').join('') ||
      '<tr><td colspan="5" class="empty">No customer sales for the current selection.</td></tr>';
    const more = $('#paretoMore');
    const left = par.rows.length - rows.length;
    more.classList.toggle('hidden', left <= 0);
    more.textContent = 'Show ' + Math.min(100, left) + ' more (' + left.toLocaleString() + ' remaining)';
  }

  function kpi(label, value, sub, st, prog) {
    const small = typeof value === 'string' && value.length > 14;
    return '<div class="kpi ' + st.cls + '"><div class="kpi-label">' + U.esc(label) + '</div><div class="kpi-value' + (small ? ' small' : '') + '" title="' + U.esc(value) + '">' + U.esc(value) + '</div>' +
      '<div class="kpi-sub">' + U.esc(sub) + '</div>' +
      (prog != null ? '<div class="bar"><i style="width:' + Math.min(100, Math.max(0, prog)).toFixed(1) + '%"></i></div>' : '') + '</div>';
  }

  function renderKPIs() {
    const t = state.totals, a = state.aggs, map = state.data.map;
    const ach = t.ach, st = U.status(ach);
    const info = { cls: 'st-info' }, na = U.status(null);
    const cards = [];
    cards.push(kpi('Total Sellout Target', U.fmtCompact(t.target), U.fmtFull(t.target), info));
    cards.push(kpi('Total Actual Sellout', U.fmtCompact(t.actual), U.fmtPct(ach) + ' of target', st, ach));
    cards.push(kpi('Total Gap', U.fmtSigned(t.gap), 'Actual − Target (' + U.fmtFull(t.gap) + ')', ach == null ? na : (t.gap >= 0 ? U.status(100) : st)));
    cards.push(kpi('Achievement %', U.fmtPct(ach), ach == null ? 'No target defined' : st.label, st, ach));

    if (map.salesperson) {
      const r = a.salesperson.filter((x) => x.ach != null);
      const yes = r.filter((x) => x.ach >= 100).length, no = r.length - yes;
      cards.push(kpi('Salespersons Achieving Target', String(yes), 'of ' + r.length + ' salespersons (≥ 100%)', U.status(100), r.length ? (yes / r.length) * 100 : 0));
      cards.push(kpi('Salespersons Below Target', String(no), 'of ' + r.length + ' salespersons (< 100%)', no ? U.status(0) : U.status(100), r.length ? (no / r.length) * 100 : 0));
    } else {
      cards.push(kpi('Salespersons Achieving Target', 'N/A', 'Salesperson column not found', na));
      cards.push(kpi('Salespersons Below Target', 'N/A', 'Salesperson column not found', na));
    }
    const best = (rows) => rows.filter((x) => x.ach != null).sort((x, y) => y.ach - x.ach)[0];
    [['channel', 'Top Performing Channel'], ['product', 'Top Performing Product Classification']].forEach(([k, label]) => {
      const b = map[k] && best(a[k]);
      cards.push(b ? kpi(label, b.name, U.fmtPct(b.ach) + ' achievement', U.status(b.ach), b.ach)
        : kpi(label, 'N/A', map[k] ? 'No targets available' : 'Column not found', na));
    });
    $('#kpiGrid').innerHTML = cards.join('');
  }

  function renderFilterChips() {
    const f = Filters.describe();
    $('#filterSummary').innerHTML = f.length ? f.map((x) => '<span class="chip">' + U.esc(x) + '</span>').join('') : '<span class="muted">No filters applied</span>';
  }

  function renderBanner() {
    const d = state.data, msgs = [];
    if (d.missingRequired.length) msgs.push(['error', 'Required column(s) not found: ' + d.missingRequired.join(', ') + '. KPI cards and charts are disabled until the sheet contains them. Headers found: ' + d.headers.join(', ') + '.']);
    if (d.missingOptional.length) msgs.push(['warn', 'Optional column(s) not detected: ' + d.missingOptional.join(', ') + '. Related filters, charts and KPIs are hidden or show N/A.']);
    if (d.stats.skipped) msgs.push(['warn', d.stats.skipped.toLocaleString() + ' row(s) skipped because neither Target nor Actual is numeric.']);
    if (d.stats.coerced) msgs.push(['warn', d.stats.coerced.toLocaleString() + ' non-numeric Target/Actual value(s) were treated as 0.']);
    if (d.stats.parseWarnings) msgs.push(['info', d.stats.parseWarnings + ' minor CSV formatting warning(s) were ignored (e.g. rows with missing fields).']);
    if (!state.filtered.length) msgs.push(['info', 'No records match the current filters. Use “Clear filters” to reset.']);
    $('#banner').innerHTML = msgs.map((m) => '<div class="note note-' + m[0] + '">' + U.esc(m[1]) + '</div>').join('');
  }

  /* ---------------------------- theme / auto-refresh -------------------- */
  function setTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('kpi.theme', dark ? 'dark' : 'light'); } catch (e) { /* storage unavailable */ }
    $('#btnTheme').textContent = dark ? '☀ Light' : '🌙 Dark';
    if (state.data) render();                        // charts re-read the theme colours
  }

  function setAuto(on) {
    clearInterval(state.timer);
    state.timer = on ? setInterval(() => load(), CONFIG.autoRefreshMs) : null;
    try { localStorage.setItem('kpi.auto', on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (on) toast('Auto-refresh on: every ' + CONFIG.autoRefreshMs / 60000 + ' minutes.');
  }

  /* ------------------------------ exports ------------------------------- */
  function summarySheets() {
    return AGG_KEYS.filter((k) => state.aggs[k]).map((k) => ({
      name: 'By ' + (DS.FIELDS.find((f) => f.key === k) || { label: k }).label,
      headers: ['Name', 'Target', 'Actual', 'Gap', 'Achievement %', 'Status'],
      rows: sortRows(state.aggs[k], 'desc').map((r) => [r.name, r.target, r.actual, r.gap, r.ach == null ? '' : +r.ach.toFixed(2), U.status(r.ach).label]),
    }));
  }

  async function doPDF(btn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing PDF…';
    try {
      await ExportManager.exportPDF({
        title: CONFIG.title, updated: state.updatedAt ? U.timestamp(state.updatedAt) : '',
        filters: Filters.describe(), sections: $$('#exportArea [data-pdf-section]'),
      });
      toast('PDF exported.', 'ok');
    } catch (e) { console.error(e); toast('PDF export failed: ' + e.message, 'error'); }
    btn.disabled = false; btn.textContent = old;
  }

  /* -------------------------------- events ------------------------------ */
  function bind() {
    $('#btnRefresh').addEventListener('click', () => load());
    $('#btnTheme').addEventListener('click', () => setTheme(!document.documentElement.classList.contains('dark')));
    $('#chkAuto').addEventListener('change', (e) => setAuto(e.target.checked));
    $('#btnClear').addEventListener('click', () => Filters.reset());
    $('#btnFilterToggle').addEventListener('click', () => $('#filterBody').classList.toggle('open'));
    $('#btnPdf').addEventListener('click', (e) => doPDF(e.currentTarget));
    $('#btnCsv').addEventListener('click', () => ExportManager.exportCSV(TableManager.getExportData()));
    $('#btnXlsx').addEventListener('click', () => {
      try { ExportManager.exportXLSX(TableManager.getExportData(), summarySheets()); } catch (e) { toast('Excel export failed: ' + e.message, 'error'); }
    });
    $('#paretoBody').closest('section').addEventListener('click', (e) => { if (e.target.id === 'paretoMore') { state.parLimit += 100; renderParetoTable(); } });

    $('#chartsGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const key = b.dataset.chart;
      if (b.dataset.act === 'sort') { state.sort[key] = b.dataset.dir; renderChart(key); }
      else if (b.dataset.act === 'png') ChartManager.exportPNG('chart-' + key, 'sales-kpi-' + key);
      else if (b.dataset.act === 'fs') ChartManager.fullscreen('chart-' + key);
    });
  }

  function onDrill(dimKey, value) {
    const active = Filters.toggleSingle(dimKey, value);
    toast(active ? 'Filtered to “' + value + '”. Click the same bar again to clear.' : 'Drill-down cleared.');
  }

  /* --------------------------------- boot ------------------------------- */
  function init() {
    document.title = CONFIG.title;
    $('#appTitle').textContent = CONFIG.title;
    buildCards();
    ChartManager.init({ onDrill });
    Filters.init($('#filterHost'), () => { state.parLimit = 50; render(); });
    TableManager.init();
    bind();
    const dark = document.documentElement.classList.contains('dark');
    $('#btnTheme').textContent = dark ? '☀ Light' : '🌙 Dark';
    let auto = false;
    try { auto = localStorage.getItem('kpi.auto') === '1'; } catch (e) { /* ignore */ }
    $('#chkAuto').checked = auto;
    if (auto) setAuto(true);
    load();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
