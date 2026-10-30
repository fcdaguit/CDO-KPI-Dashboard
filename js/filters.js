/**
 * filters.js — sticky multi-select filter panel (searchable, Select All / Deselect All).
 * Exposes: window.Filters
 *
 * Each dimension keeps an explicit Set of selected values. "All selected" means the filter is inactive.
 * Long option lists are rendered lazily (first LIMIT matches; searching narrows further).
 */
(function (g) {
  'use strict';
  const U = g.Utils;
  const LIMIT = 250;

  let host = null;
  let onChange = () => {};
  let S = {};          // key → { def, opts, sel:Set, q, matches, el:{...} }
  let order = [];      // keys in display order
  const fire = U.debounce(() => onChange(), 150);

  const isAll = (s) => s.sel.size === s.opts.length;

  function init(hostEl, cb) {
    host = hostEl;
    onChange = cb;
    document.addEventListener('click', (e) => { if (!e.target.closest('.ms')) closeAll(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  }

  function closeAll(except) {
    host.querySelectorAll('.ms-panel').forEach((p) => { if (p !== except) p.classList.add('hidden'); });
    host.querySelectorAll('.ms-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  /** (Re)build the panel for the dimensions found in the data, keeping previous selections where possible. */
  function setData(dimDefs, options) {
    const old = S;
    S = {};
    order = [];
    dimDefs.forEach((d) => {
      const opts = options[d.key] || [];
      let sel = new Set(opts);
      const o = old[d.key];
      if (o && !isAll(o)) {
        const keep = new Set(opts.filter((v) => o.sel.has(v)));
        if (keep.size) sel = keep;                     // keep the previous selection if still valid
      }
      S[d.key] = { def: d, opts, sel, q: '', matches: [], el: {} };
      order.push(d.key);
    });
    build();
  }

  function build() {
    host.innerHTML = order.map((k) => {
      const lbl = U.esc(S[k].def.label);
      return '<div class="ms" data-k="' + k + '">' +
        '<button type="button" class="ms-btn" aria-haspopup="listbox" aria-expanded="false"><span class="ms-lbl">' + lbl + '</span><span class="ms-val"></span></button>' +
        '<div class="ms-panel hidden">' +
        '<input type="search" class="ms-search" placeholder="Search ' + lbl + '…" autocomplete="off" aria-label="Search ' + lbl + '">' +
        '<div class="ms-actions"><button type="button" data-a="all">Select all</button><button type="button" data-a="none">Deselect all</button></div>' +
        '<div class="ms-list" role="listbox"></div></div></div>';
    }).join('');

    order.forEach((k) => {
      const s = S[k];
      const root = host.querySelector('.ms[data-k="' + k + '"]');
      s.el = { root, btn: root.querySelector('.ms-btn'), val: root.querySelector('.ms-val'), panel: root.querySelector('.ms-panel'), search: root.querySelector('.ms-search'), list: root.querySelector('.ms-list') };

      s.el.btn.addEventListener('click', () => {
        const open = s.el.panel.classList.contains('hidden');
        closeAll(open ? s.el.panel : null);
        if (open) {
          s.el.panel.classList.remove('hidden', 'right');
          s.el.btn.setAttribute('aria-expanded', 'true');
          if (s.el.panel.getBoundingClientRect().right > window.innerWidth - 8) s.el.panel.classList.add('right');
          renderList(k);
          if (window.matchMedia('(pointer:fine)').matches) s.el.search.focus();
        } else s.el.panel.classList.add('hidden');
      });
      s.el.search.addEventListener('input', U.debounce(() => { s.q = s.el.search.value.trim().toLowerCase(); renderList(k); }, 120));
      s.el.panel.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.a === 'all') { (s.q ? s.matches : s.opts).forEach((o) => s.sel.add(o)); }
        else { (s.q ? s.matches : s.opts).forEach((o) => s.sel.delete(o)); }
        renderList(k); updateLabel(k); fire();
      }));
      s.el.list.addEventListener('change', (e) => {
        const cb = e.target.closest('input[type=checkbox]');
        if (!cb) return;
        const o = s.matches[+cb.dataset.i];
        if (cb.checked) s.sel.add(o); else s.sel.delete(o);
        updateLabel(k); fire();
      });
      updateLabel(k);
    });
  }

  function renderList(k) {
    const s = S[k];
    s.matches = s.q ? s.opts.filter((o) => o.toLowerCase().includes(s.q)) : s.opts;
    const shown = s.matches.slice(0, LIMIT);
    let html = shown.map((o, i) => '<label class="ms-item"><input type="checkbox" data-i="' + i + '"' + (s.sel.has(o) ? ' checked' : '') + '><span>' + U.esc(o) + '</span></label>').join('');
    if (!shown.length) html = '<div class="ms-more">No matches</div>';
    else if (s.matches.length > LIMIT) html += '<div class="ms-more">Showing ' + LIMIT + ' of ' + s.matches.length + ' — type to narrow the list</div>';
    s.el.list.innerHTML = html;
  }

  function updateLabel(k) {
    const s = S[k];
    let t;
    if (isAll(s)) t = 'All';
    else if (s.sel.size === 0) t = 'None';
    else if (s.sel.size === 1) t = Array.from(s.sel)[0];
    else t = s.sel.size + ' selected';
    s.el.val.textContent = t;
    s.el.root.classList.toggle('active', !isAll(s));
  }

  /** Filter records by every active dimension. */
  function apply(records) {
    const active = order.filter((k) => !isAll(S[k]));
    if (!active.length) return records;
    return records.filter((r) => {
      for (let i = 0; i < active.length; i++) if (!S[active[i]].sel.has(r[active[i]])) return false;
      return true;
    });
  }

  function reset() {
    order.forEach((k) => { S[k].sel = new Set(S[k].opts); S[k].q = ''; if (S[k].el.search) S[k].el.search.value = ''; updateLabel(k); });
    onChange();
  }

  /** Drill-down helper: select only `value`, or clear the filter if it is already the only selection. */
  function toggleSingle(key, value) {
    const s = S[key];
    if (!s) return false;
    if (s.sel.size === 1 && s.sel.has(value)) s.sel = new Set(s.opts);
    else s.sel = new Set([value]);
    updateLabel(key);
    onChange();
    return s.sel.size === 1;
  }

  function isActive() { return order.some((k) => !isAll(S[k])); }

  /** Human-readable list of active filters (used in the UI and the PDF header). */
  function describe() {
    return order.filter((k) => !isAll(S[k])).map((k) => {
      const s = S[k];
      const v = Array.from(s.sel);
      const txt = v.length === 0 ? 'none selected' : v.length <= 3 ? v.join(', ') : v.slice(0, 3).join(', ') + ' (+' + (v.length - 3) + ' more)';
      return s.def.label + ': ' + txt;
    });
  }

  g.Filters = { init, setData, apply, reset, toggleSingle, isActive, describe };
})(window);
