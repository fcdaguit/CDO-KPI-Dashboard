/**
 * dataService.js — loads the Google Sheets CSV, detects columns dynamically,
 * normalises rows into records and performs all aggregations.
 * Exposes: window.DataService
 *
 * Aggregation rule (per spec): Target = SUM, Actual = SUM, Gap = Actual - Target,
 * Achievement % = SUM(Actual) / SUM(Target) * 100 — always computed AFTER summing.
 */
(function (g) {
  'use strict';
  const U = g.Utils;
  const UNSPEC = '(Unspecified)';

  /** Field definitions: key, label and accepted header aliases (matched case-insensitively). */
  const FIELDS = [
    { key: 'target', label: 'Target', numeric: true, required: true, aliases: ['target', 'sellout target', 'monthly target', 'sales target'] },
    { key: 'actual', label: 'Actual Sellout', numeric: true, required: true, aliases: ['actual', 'actual sellout', 'sellout', 'sales', 'actual sales'] },
    { key: 'salesperson', label: 'Salesperson', aliases: ['salesperson', 'sales person', 'sales rep', 'representative', 'agent'] },
    { key: 'customer', label: 'Customer', aliases: ['customer', 'client', 'account', 'buyer'] },
    { key: 'channel', label: 'Channel', aliases: ['channel', 'sales channel', 'route to market'] },
    { key: 'storeFormat', label: 'Store Format', aliases: ['store format', 'format', 'outlet format'] },
    { key: 'product', label: 'Product Classification', aliases: ['product classification', 'classification', 'category', 'product category'] },
    { key: 'date', label: 'Date', aliases: ['date', 'transaction date', 'month', 'period'] },
  ];

  /** Dimensions used for filters (display order). Aggregated dimensions are all except 'date'. */
  const DIMS = [
    { key: 'salesperson', label: 'Salesperson' },
    { key: 'channel', label: 'Channel' },
    { key: 'storeFormat', label: 'Store Format' },
    { key: 'product', label: 'Product Classification' },
    { key: 'customer', label: 'Customer' },
    { key: 'date', label: 'Date' },
  ];

  class DataError extends Error {
    constructor(code, message, hint) { super(message); this.name = 'DataError'; this.code = code; this.hint = hint || ''; }
  }

  /* ------------------------------ fetching ------------------------------ */

  async function fetchText(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      const sep = url.includes('?') ? '&' : '?';
      res = await fetch(url + sep + '_ts=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new DataError('network',
        e.name === 'AbortError' ? 'The request to Google Sheets timed out.' : 'Could not reach Google Sheets.',
        'Check your internet connection and confirm the sheet is published to the web as CSV.');
    }
    clearTimeout(timer);
    if (!res.ok) {
      throw new DataError('http', 'Google Sheets responded with HTTP ' + res.status + '.',
        res.status === 404 ? 'The published link may have been removed or changed.' : 'Verify the publish/sharing settings of the sheet.');
    }
    return res.text();
  }

  /* ------------------------------- parsing ------------------------------ */

  function parseCSV(text) {
    if (!text || !text.trim()) throw new DataError('empty', 'The CSV file is empty.', 'Add a header row and data to the sheet.');
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new DataError('notcsv', 'The link returned a web page instead of CSV data.',
        'In Google Sheets use File → Share → Publish to web, pick the sheet and choose “Comma-separated values (.csv)”.');
    }
    const res = g.Papa.parse(text.replace(/^﻿/, ''), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h, i) => { const t = String(h == null ? '' : h).trim(); return t || 'Column ' + (i + 1); },
    });
    if (res.errors.some((e) => e.type === 'Quotes')) {
      throw new DataError('malformed', 'The CSV looks malformed (unbalanced quotes).', 'Open the sheet and check for stray quotation marks in cells.');
    }
    const headers = res.meta.fields || [];
    if (headers.length < 2) {
      throw new DataError('malformed', 'No usable columns were found in the CSV.', 'Make sure the first row holds column headers.');
    }
    if (!res.data.length) {
      throw new DataError('empty', 'The sheet has headers but no data rows.', 'Add data rows to the sheet and refresh.');
    }
    return { rows: res.data, headers, parseWarnings: res.errors.length };
  }

  /* --------------------------- column detection ------------------------- */

  function numericShare(rows, col) {
    let seen = 0, ok = 0;
    for (let i = 0; i < rows.length && seen < 200; i++) {
      const v = rows[i][col];
      if (v == null || String(v).trim() === '') continue;
      seen++;
      if (!isNaN(U.num(v))) ok++;
    }
    return seen ? ok / seen : 0;
  }

  /**
   * Case-insensitive detection. Pass 1: exact alias match; pass 2: alias as whole words inside the header.
   * First valid match (left-to-right) wins; a header is never assigned to two fields;
   * numeric fields must actually contain mostly numeric values.
   */
  function detectColumns(headers, rows) {
    const used = new Set();
    const map = {};
    const missingRequired = [];
    const missingOptional = [];
    const nh = headers.map((h) => ({ h, n: U.norm(h) }));

    FIELDS.forEach((f) => {
      const aliases = f.aliases.map(U.norm);
      const valid = (h) => !used.has(h) && (!f.numeric || numericShare(rows, h) >= 0.5);
      let hit = nh.find((x) => aliases.includes(x.n) && valid(x.h));
      if (!hit) {
        for (const a of aliases) {
          hit = nh.find((x) => (' ' + x.n + ' ').includes(' ' + a + ' ') && valid(x.h));
          if (hit) break;
        }
      }
      if (hit) { map[f.key] = hit.h; used.add(hit.h); }
      else (f.required ? missingRequired : missingOptional).push(f.label);
    });
    return { map, missingRequired, missingOptional };
  }

  /* ------------------------------- records ------------------------------ */

  function buildRecords(rows, map) {
    const out = [];
    let skipped = 0, coerced = 0;
    const cell = (row, col) => {
      if (!col) return UNSPEC;
      const v = row[col];
      const s = v == null ? '' : String(v).trim();
      return s || UNSPEC;
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let t = map.target ? U.num(row[map.target]) : 0;
      let a = map.actual ? U.num(row[map.actual]) : 0;
      if (isNaN(t) && isNaN(a)) { skipped++; continue; }   // nothing numeric on this row
      if (isNaN(t)) { t = 0; coerced++; }
      if (isNaN(a)) { a = 0; coerced++; }
      const rec = {
        target: t,
        actual: a,
        salesperson: cell(row, map.salesperson),
        customer: cell(row, map.customer),
        channel: cell(row, map.channel),
        storeFormat: cell(row, map.storeFormat),
        product: cell(row, map.product),
        date: UNSPEC,
        dateSort: Infinity,
        raw: row,
      };
      if (map.date) { const di = U.dateInfo(row[map.date]); rec.date = di.label; rec.dateSort = di.sort; }
      out.push(rec);
    }
    return { records: out, skipped, coerced };
  }

  /** Full pipeline from CSV text (also used by tests). */
  function processText(text) {
    const parsed = parseCSV(text);
    const det = detectColumns(parsed.headers, parsed.rows);
    const built = buildRecords(parsed.rows, det.map);
    if (!built.records.length) {
      throw new DataError('empty', 'No rows with numeric Target/Actual values were found.', 'Check that the Target and Actual columns contain numbers.');
    }
    return {
      headers: parsed.headers,
      map: det.map,
      missingRequired: det.missingRequired,
      missingOptional: det.missingOptional,
      records: built.records,
      options: options(built.records, det.map),
      stats: { rows: parsed.rows.length, used: built.records.length, skipped: built.skipped, coerced: built.coerced, parseWarnings: parsed.parseWarnings },
    };
  }

  async function load(url) {
    return processText(await fetchText(url));
  }

  /* ------------------------------ aggregation --------------------------- */

  /** One pass over the records → { key: [{name,target,actual,gap,ach,n}] } for each requested key. */
  function aggregate(records, keys) {
    const maps = {};
    keys.forEach((k) => { maps[k] = new Map(); });
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      for (let j = 0; j < keys.length; j++) {
        const k = keys[j];
        const m = maps[k];
        let e = m.get(r[k]);
        if (!e) { e = { name: r[k], target: 0, actual: 0, n: 0 }; m.set(r[k], e); }
        e.target += r.target; e.actual += r.actual; e.n++;
      }
    }
    const res = {};
    keys.forEach((k) => {
      res[k] = Array.from(maps[k].values()).map((e) => {
        e.gap = e.actual - e.target;
        e.ach = U.ach(e.actual, e.target);   // computed AFTER aggregation
        return e;
      });
    });
    return res;
  }

  function totals(records) {
    let target = 0, actual = 0;
    for (let i = 0; i < records.length; i++) { target += records[i].target; actual += records[i].actual; }
    return { target, actual, gap: actual - target, ach: U.ach(actual, target), n: records.length };
  }

  /** Distinct values for each filterable dimension that exists in the data. */
  function options(records, map) {
    const out = {};
    DIMS.forEach((d) => {
      if (!map[d.key]) return;
      const seen = new Map();
      for (let i = 0; i < records.length; i++) {
        const v = records[i][d.key];
        if (!seen.has(v)) seen.set(v, records[i].dateSort);
      }
      const arr = Array.from(seen.keys());
      if (d.key === 'date') arr.sort((a, b) => (seen.get(a) - seen.get(b)) || String(a).localeCompare(String(b)));
      else arr.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
      out[d.key] = arr;
    });
    return out;
  }

  g.DataService = { FIELDS, DIMS, UNSPEC, DataError, load, processText, parseCSV, detectColumns, buildRecords, aggregate, totals, options };
})(typeof window !== 'undefined' ? window : globalThis);
