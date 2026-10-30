/**
 * tableManager.js — interactive detail table (global search, per-column search, sorting,
 * pagination, column visibility). Columns are taken from the CSV headers dynamically.
 * Exposes: window.TableManager
 */
(function (g) {
  'use strict';
  const U = g.Utils;
  const $ = (s) => document.querySelector(s);

  const S = { all: [], cols: [], visible: new Set(), gq: '', cq: {}, sort: null, page: 1, size: 25, view: [] };

  function init() {
    $('#tblSearch').addEventListener('input', U.debounce((e) => { S.gq = e.target.value.trim().toLowerCase(); S.page = 1; refresh(); }, 200));
    $('#tblSize').addEventListener('change', (e) => { S.size = +e.target.value; S.page = 1; renderBody(); });
    $('#tblPager').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b || b.disabled) return;
      S.page = +b.dataset.p; renderBody();
      $('#tblWrap').scrollTop = 0;
    });
    const head = $('#tblHead');
    head.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-c]');
      if (!th || e.target.closest('input')) return;
      const id = th.dataset.c;
      if (!S.sort || S.sort.col !== id) S.sort = { col: id, dir: 'asc' };
      else if (S.sort.dir === 'asc') S.sort.dir = 'desc';
      else S.sort = null;
      buildHead(); refresh();
    });
    head.addEventListener('input', U.debounce((e) => {
      const inp = e.target.closest('input[data-q]');
      if (!inp) return;
      const v = inp.value.trim().toLowerCase();
      if (v) S.cq[inp.dataset.q] = v; else delete S.cq[inp.dataset.q];
      S.page = 1; refresh();
    }, 200));
    $('#tblColsBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#tblColsPanel').classList.toggle('hidden'); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#tblColsWrap')) $('#tblColsPanel').classList.add('hidden'); });
    $('#tblColsPanel').addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-col]');
      if (!cb) return;
      if (cb.checked) S.visible.add(cb.dataset.col);
      else if (S.visible.size > 1) S.visible.delete(cb.dataset.col);
      else cb.checked = true;                  // keep at least one column
      buildHead(); renderBody();
    });
  }

  /** Called once per data load with the CSV headers and the detected column map. */
  function setSchema(headers, map) {
    S.cols = headers.map((h, i) => {
      const isT = h === map.target, isA = h === map.actual;
      return {
        id: 'c' + i, label: h, numeric: isT || isA,
        get: isT ? (r) => r.target : isA ? (r) => r.actual : (r) => r.raw[h],
        fmt: isT || isA ? (v) => U.fmtFull(v) : (v) => (v == null ? '' : v),
      };
    });
    S.cols.push({ id: 'gap', label: 'Gap', numeric: true, get: (r) => r.actual - r.target, fmt: (v) => (v > 0 ? '+' : '') + U.fmtFull(v) });
    S.cols.push({ id: 'ach', label: 'Achievement % (row)', numeric: true, get: (r) => (r.target > 0 ? (r.actual / r.target) * 100 : null), fmt: (v) => U.fmtPct(v) });
    S.visible = new Set(S.cols.map((c) => c.id));
    S.cq = {}; S.sort = null; S.gq = ''; S.page = 1;
    $('#tblSearch').value = '';
    $('#tblColsPanel').innerHTML = S.cols.map((c) => '<label class="ms-item"><input type="checkbox" data-col="' + c.id + '" checked><span>' + U.esc(c.label) + '</span></label>').join('');
    buildHead();
  }

  function setData(records) { S.all = records; S.page = 1; refresh(); }

  const visCols = () => S.cols.filter((c) => S.visible.has(c.id));
  const colById = (id) => S.cols.find((c) => c.id === id);

  function buildHead() {
    const cols = visCols();
    const arrow = (c) => (S.sort && S.sort.col === c.id ? (S.sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    $('#tblHead').innerHTML =
      '<tr>' + cols.map((c) => '<th data-c="' + c.id + '" class="' + (c.numeric ? 'num ' : '') + 'sortable" title="Click to sort">' + U.esc(c.label) + arrow(c) + '</th>').join('') + '</tr>' +
      '<tr class="col-search">' + cols.map((c) => '<th><input type="search" data-q="' + c.id + '" placeholder="Filter…" value="' + U.esc(S.cq[c.id] || '') + '" aria-label="Filter ' + U.esc(c.label) + '"></th>').join('') + '</tr>';
  }

  function searchStr(r) {
    if (r._s === undefined) r._s = Object.keys(r.raw).map((k) => r.raw[k]).join(' ').toLowerCase();
    return r._s;
  }

  const NUMLIKE = /^\s*[-+(]?\s*[₱$€£]?\s*[\d,]+(\.\d+)?\s*\)?%?\s*$/;
  function sortKey(c, r) {
    const v = c.get(r);
    if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (NUMLIKE.test(v)) { const n = U.num(v); if (!isNaN(n)) return n; }
    return String(v).toLowerCase();
  }

  function computeView() {
    let rows = S.all;
    if (S.gq) rows = rows.filter((r) => searchStr(r).includes(S.gq));
    Object.keys(S.cq).forEach((id) => {
      const c = colById(id), q = S.cq[id];
      if (c) rows = rows.filter((r) => String(c.fmt(c.get(r))).toLowerCase().includes(q));
    });
    if (S.sort) {
      const c = colById(S.sort.col), dir = S.sort.dir === 'asc' ? 1 : -1;
      const keyed = rows.map((r) => ({ r, k: sortKey(c, r) }));
      keyed.sort((a, b) => {
        if (a.k === null && b.k === null) return 0;
        if (a.k === null) return 1;                 // empty values always last
        if (b.k === null) return -1;
        const an = typeof a.k === 'number', bn = typeof b.k === 'number';
        if (an && bn) return (a.k - b.k) * dir;
        if (an !== bn) return an ? -1 : 1;
        return a.k.localeCompare(b.k, undefined, { numeric: true }) * dir;
      });
      rows = keyed.map((x) => x.r);
    }
    S.view = rows;
  }

  function refresh() { computeView(); renderBody(); }

  function renderBody() {
    const cols = visCols();
    const total = S.view.length;
    const pages = Math.max(1, Math.ceil(total / S.size));
    if (S.page > pages) S.page = pages;
    const start = (S.page - 1) * S.size;
    const slice = S.view.slice(start, start + S.size);
    $('#tblBody').innerHTML = slice.length ? slice.map((r) => '<tr>' + cols.map((c) => {
      const v = c.get(r);
      if (c.id === 'ach') { const st = U.status(v); return '<td class="num"><span class="pill ' + st.cls + '">' + U.fmtPct(v) + '</span></td>'; }
      if (c.id === 'gap') return '<td class="num ' + (v < 0 ? 'txt-red' : v > 0 ? 'txt-green' : '') + '">' + U.esc(c.fmt(v)) + '</td>';
      return '<td class="' + (c.numeric ? 'num' : '') + '">' + U.esc(c.fmt(v)) + '</td>';
    }).join('') + '</tr>').join('') : '<tr><td colspan="' + cols.length + '" class="empty">No records match the current filters or search.</td></tr>';

    $('#tblInfo').textContent = total ? 'Showing ' + (start + 1).toLocaleString() + '–' + (start + slice.length).toLocaleString() + ' of ' + total.toLocaleString() + ' records' + (total !== S.all.length ? ' (filtered from ' + S.all.length.toLocaleString() + ')' : '') : '0 records';

    const btn = (p, label, dis, cur) => '<button type="button" data-p="' + p + '"' + (dis ? ' disabled' : '') + (cur ? ' class="cur"' : '') + '>' + label + '</button>';
    let h = btn(S.page - 1, '‹ Prev', S.page <= 1);
    const lo = Math.max(1, S.page - 2), hi = Math.min(pages, lo + 4);
    for (let p = Math.max(1, hi - 4); p <= hi; p++) h += btn(p, p, false, p === S.page);
    h += btn(S.page + 1, 'Next ›', S.page >= pages);
    $('#tblPager').innerHTML = h;
  }

  /** Rows/columns exactly as currently displayed (all pages, visible columns) — used by CSV/XLSX export. */
  function getExportData() {
    const cols = visCols();
    return {
      headers: cols.map((c) => c.label),
      rows: S.view.map((r) => cols.map((c) => { const v = c.get(r); return v == null || (typeof v === 'number' && isNaN(v)) ? '' : v; })),
    };
  }

  g.TableManager = { init, setSchema, setData, getExportData };
})(window);
