/**
 * utils.js — shared helpers (formatting, parsing, KPI status rules).
 * Exposes a single global: window.Utils
 */
(function (g) {
  'use strict';

  const Utils = {
    /** Traffic-light palette used everywhere (cards, charts, tables). */
    COLORS: { green: '#16a34a', yellow: '#f59e0b', red: '#dc2626', na: '#94a3b8', primary: '#4f46e5', primarySoft: '#a5b4fc' },

    debounce(fn, ms = 250) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    },

    /** Normalise a header/alias for case-insensitive matching. */
    norm(s) {
      return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    },

    /** Parse a number from messy spreadsheet text: "1,234.5", "(500)", "₱2,000", "85%". NaN if invalid. */
    num(v) {
      if (typeof v === 'number') return isFinite(v) ? v : NaN;
      if (v == null) return NaN;
      let s = String(v).trim();
      if (!s || s === '-' || s === '—') return NaN;
      const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
      s = s.replace(/[^0-9.]/g, '');
      if (!s || s === '.') return NaN;
      const n = parseFloat(s);
      return isNaN(n) ? NaN : (neg ? -n : n);
    },

    /** Achievement % — computed ONLY on aggregated values. null when target is 0. */
    ach(actual, target) {
      return target > 0 ? (actual / target) * 100 : null;
    },

    /** Traffic-light status from achievement %. */
    status(ach) {
      if (ach == null || isNaN(ach)) return { key: 'na', label: 'No Target', color: Utils.COLORS.na, cls: 'st-na' };
      if (ach >= 100) return { key: 'green', label: 'Above Target', color: Utils.COLORS.green, cls: 'st-green' };
      if (ach >= 90) return { key: 'yellow', label: 'Near Target', color: Utils.COLORS.yellow, cls: 'st-yellow' };
      return { key: 'red', label: 'Below Target', color: Utils.COLORS.red, cls: 'st-red' };
    },

    fmtCompact(n) {
      if (n == null || isNaN(n)) return '—';
      const a = Math.abs(n), sign = n < 0 ? '-' : '';
      if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + 'M';
      if (a >= 1e4) return sign + (a / 1e3).toFixed(1) + 'K';
      return sign + a.toLocaleString(undefined, { maximumFractionDigits: 0 });
    },
    fmtFull(n) {
      if (n == null || isNaN(n)) return '—';
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    },
    fmtPct(n, d = 1) {
      return n == null || isNaN(n) ? 'N/A' : n.toFixed(d) + '%';
    },
    fmtSigned(n) {
      if (n == null || isNaN(n)) return '—';
      return (n > 0 ? '+' : '') + Utils.fmtCompact(n);
    },

    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    MONTHS: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],

    /**
     * Turn a date-ish cell into {label, sort}. Real dates are grouped by month ("Jan 2026").
     * Plain month names ("March") and free text are kept as-is.
     */
    dateInfo(v) {
      const raw = String(v == null ? '' : v).trim();
      if (!raw) return { label: '(Unspecified)', sort: Infinity };
      let d = null;
      if (/^\d{5}$/.test(raw)) { // Excel serial date
        const n = parseInt(raw, 10);
        if (n > 20000 && n < 70000) d = new Date(Math.round((n - 25569) * 86400 * 1000));
      }
      const monthIdx = (s) => {
        const k = String(s).toLowerCase();
        return k.length >= 3 ? Utils.MONTHS.findIndex((m) => m.startsWith(k)) : -1;
      };
      if (!d) { // "Jan 2026", "January-26", "Mar'26"
        const my = raw.match(/^([A-Za-z]{3,9})\.?[\s\-\/,']*(\d{4}|\d{2})$/);
        if (my && monthIdx(my[1]) >= 0) {
          const y = my[2].length === 2 ? 2000 + parseInt(my[2], 10) : parseInt(my[2], 10);
          d = new Date(y, monthIdx(my[1]), 1);
        }
      }
      if (!d && (/\b(19|20)\d{2}\b/.test(raw) || /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(raw))) {
        const t = Date.parse(raw); // guarded: Chrome parses bare words like "March" as the year 2001
        if (!isNaN(t)) { const x = new Date(t); if (x.getFullYear() > 1990 && x.getFullYear() < 2100) d = x; }
      }
      if (d) {
        const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        return { label, sort: d.getFullYear() * 12 + d.getMonth() };
      }
      const mi = monthIdx(raw);
      if (mi >= 0) return { label: raw, sort: mi };
      return { label: raw, sort: 1e6 };
    },

    timestamp(d = new Date()) {
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
    },
  };

  g.Utils = Utils;
})(window);
