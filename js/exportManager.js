/**
 * exportManager.js — CSV, Excel (.xlsx) and full-dashboard PDF export.
 * Exposes: window.ExportManager
 *
 * PDF: each dashboard section ([data-pdf-section]) is rasterised with html2canvas and placed on
 * landscape A4 pages without cutting a card in half. A header page block records the applied filters.
 */
(function (g) {
  'use strict';
  const U = g.Utils;

  const stamp = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  };

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /** data = { headers:[], rows:[[]] } from TableManager.getExportData() */
  function exportCSV(data, base) {
    const csv = g.Papa.unparse({ fields: data.headers, data: data.rows });
    saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), (base || 'sales-kpi-data') + '_' + stamp() + '.csv');
  }

  /** extraSheets = [{ name, headers:[], rows:[[]] }] — added after the data sheet. */
  function exportXLSX(data, extraSheets, base) {
    const wb = g.XLSX.utils.book_new();
    const add = (name, headers, rows) => {
      const ws = g.XLSX.utils.aoa_to_sheet([headers].concat(rows));
      ws['!cols'] = headers.map((h) => ({ wch: Math.min(36, Math.max(10, String(h).length + 2)) }));
      g.XLSX.utils.book_append_sheet(wb, ws, String(name).replace(/[\[\]:*?\/\\]/g, '').slice(0, 31) || 'Sheet');
    };
    add('Filtered Data', data.headers, data.rows);
    (extraSheets || []).forEach((s) => add(s.name, s.headers, s.rows));
    g.XLSX.writeFile(wb, (base || 'sales-kpi-data') + '_' + stamp() + '.xlsx');
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function bgColor() {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255];
    return { r: +m[0], g: +m[1], b: +m[2], css: 'rgb(' + m[0] + ',' + m[1] + ',' + m[2] + ')' };
  }

  /**
   * opts = { title, updated, filters:[string], sections: NodeList|Element[] }
   * Retains KPI cards, charts, summaries and the applied filters (printed in the header block).
   */
  async function exportPDF(opts) {
    if (!g.jspdf || !g.html2canvas) throw new Error('PDF libraries failed to load.');
    g.ChartManager.ensureAll();
    await wait(800);                                   // let chart animations finish

    const bg = bgColor();
    const head = document.createElement('div');
    head.className = 'pdf-head';
    head.style.cssText = 'position:fixed;left:-99999px;top:0;width:1200px;';
    head.innerHTML = '<h1>' + U.esc(opts.title) + '</h1><p>Generated: ' + U.esc(U.timestamp()) + ' · Data last updated: ' + U.esc(opts.updated || 'n/a') + '</p>' +
      '<p><b>Applied filters:</b> ' + (opts.filters && opts.filters.length ? U.esc(opts.filters.join(' | ')) : 'None (all data)') + '</p>';
    document.body.appendChild(head);

    const shots = [];
    const shoot = async (el) => g.html2canvas(el, {
      scale: 1.6, backgroundColor: bg.css, useCORS: true, logging: false,
      ignoreElements: (e) => e.hasAttribute && e.hasAttribute('data-html2canvas-ignore'),
    });
    try {
      shots.push(await shoot(head));
      for (const el of Array.from(opts.sections)) {
        if (el.offsetParent === null) continue;        // skip hidden sections
        shots.push(await shoot(el));
      }
    } finally { head.remove(); }

    const pdf = new g.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    const M = 24, CW = W - M * 2, CH = H - M * 2 - 8;
    const paint = () => { pdf.setFillColor(bg.r, bg.g, bg.b); pdf.rect(0, 0, W, H, 'F'); };
    paint();
    let y = M;
    shots.forEach((cv) => {
      let w = CW, h = (cv.height * w) / cv.width;
      if (h > CH) { h = CH; w = (cv.width * h) / cv.height; }   // very tall section → scale to fit one page
      if (y + h > M + CH && y > M) { pdf.addPage(); paint(); y = M; }
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', M + (CW - w) / 2, y, w, h);
      y += h + 10;
    });
    const pages = pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(140, 150, 165);
      pdf.text(opts.title + ' · Page ' + i + ' of ' + pages, W / 2, H - 10, { align: 'center' });
    }
    pdf.save('Sales-KPI-Dashboard_' + stamp() + '.pdf');
  }

  g.ExportManager = { exportCSV, exportXLSX, exportPDF };
})(window);
