/**
 * insightEngine.js — rule-based executive insights generated from calculated data only.
 * Exposes: window.InsightEngine
 *   forDimension(key, aggregatedRows) → [{label, text, tone, badge?}]
 *   computePareto(customerRows)       → pareto model (ranking, contribution %, cumulative %, 80% core)
 *   paretoInsights(pareto)            → [{label, text, tone, badge?}]
 * tone ∈ green | yellow | red | na | info  (maps to the traffic-light CSS classes)
 */
(function (g) {
  'use strict';
  const U = g.Utils;
  const m = (n) => U.fmtCompact(n);
  const p = (n) => U.fmtPct(n);
  const p1 = (n) => U.fmtPct(n, 1);
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
  const names = (rows, max = 3) => rows.slice(0, max).map((r) => r.name).join(', ') + (rows.length > max ? ' and ' + (rows.length - max) + ' more' : '');
  const toneOf = (ach) => U.status(ach).key;
  const cu = (n) => n + (n === 1 ? ' customer' : ' customers');

  /** Wording per dimension (labels follow the report specification). */
  const CFG = {
    salesperson: { plural: 'salespersons', top: 'Top Performer', low: 'Lowest Performer', gap: 'Largest Gap' },
    product: { plural: 'product classifications', top: 'Best Category', low: 'Weakest Category', gap: 'Gap Analysis' },
    channel: { plural: 'channels', top: 'Best Channel', low: 'Weakest Channel', gap: 'Largest Gap' },
    storeFormat: { plural: 'store formats', top: 'Top Format', low: 'Lowest Format', gap: 'Gap Analysis' },
  };

  function forDimension(key, rows) {
    const c = CFG[key];
    if (!rows || !rows.length) return [{ label: 'Key Finding', text: 'No data matches the current filters.', tone: 'na' }];

    const T = sum(rows, 'target'), A = sum(rows, 'actual'), gap = A - T, ach = U.ach(A, T);
    const ranked = rows.filter((r) => r.ach != null).sort((a, b) => b.ach - a.ach);
    const above = ranked.filter((r) => r.ach >= 100);
    const near = ranked.filter((r) => r.ach >= 90 && r.ach < 100);
    const below = ranked.filter((r) => r.ach < 90).reverse();           // worst first
    const deficits = rows.filter((r) => r.gap < 0).sort((a, b) => a.gap - b.gap);
    const totalDeficit = deficits.reduce((s, r) => s + r.gap, 0);
    const noTarget = rows.filter((r) => r.ach == null && r.actual > 0);
    const items = [];

    /* 1. Key Finding */
    let kf;
    if (ach == null) kf = 'No target is defined for the current selection; total actual sellout is ' + m(A) + '.';
    else kf = 'Combined sellout of ' + m(A) + ' against a target of ' + m(T) + ' delivers ' + p(ach) + ' achievement (gap ' + U.fmtSigned(gap) + '). ' +
      above.length + ' of ' + ranked.length + ' ' + c.plural + ' are at or above target, ' + near.length + ' are near target and ' + below.length + ' are below the 90% threshold.';
    items.push({ label: 'Key Finding', text: kf, tone: toneOf(ach), badge: ach != null && ach >= 100 ? 'Success' : ach != null && ach < 90 ? 'Warning' : null });

    /* 2–3. Top / lowest */
    if (ranked.length) {
      const top = ranked[0];
      items.push({
        label: c.top, tone: toneOf(top.ach),
        text: top.name + ' leads at ' + p(top.ach) + ' (actual ' + m(top.actual) + ' vs target ' + m(top.target) + ', gap ' + U.fmtSigned(top.gap) + ')' + (top.ach >= 100 ? ' — target exceeded.' : '.'),
        badge: top.ach >= 100 ? 'Success' : null,
      });
      if (ranked.length > 1) {
        const low = ranked[ranked.length - 1];
        items.push({
          label: c.low, tone: toneOf(low.ach),
          text: low.name + ' trails at ' + p(low.ach) + ' (actual ' + m(low.actual) + ' vs target ' + m(low.target) + ', gap ' + U.fmtSigned(low.gap) + ')' + (low.ach < 90 ? ' — below the 90% threshold.' : '.'),
          badge: low.ach < 90 ? 'Warning' : null,
        });
      }
    }

    /* 4. Dimension specific extras */
    if (key === 'salesperson' && ranked.length) {
      const avg = ranked.reduce((s, r) => s + r.ach, 0) / ranked.length;
      items.push({ label: 'Average Achievement %', tone: toneOf(avg), text: 'The simple average across salespersons is ' + p(avg) + ' versus ' + p(ach) + ' on a volume-weighted basis' + (Math.abs(avg - ach) > 5 ? ' — the difference signals uneven performance between large and small portfolios.' : '.') });
      items.push({ label: 'Number Above Target', tone: above.length === ranked.length ? 'green' : above.length ? 'yellow' : 'red', text: above.length + ' of ' + ranked.length + ' salespersons (' + p(above.length / ranked.length * 100) + ') are at or above 100% of target.' });
    }
    if (key === 'product') {
      const nearSorted = near.slice().sort((a, b) => b.gap - a.gap);
      const share = A > 0 && ranked.length ? Math.max.apply(null, rows.map((r) => r.actual)) / A * 100 : null;
      const big = rows.slice().sort((a, b) => b.actual - a.actual)[0];
      let t;
      if (nearSorted.length) t = names(nearSorted) + ' sit within 10 points of target; closing a combined ' + m(-sum(nearSorted, 'gap')) + ' is the quickest uplift.';
      else if (above.length) t = above.length + ' classification(s) already exceed target; scale distribution and promotions for ' + names(above) + '.';
      else t = 'No classification is close to target; growth requires range, pricing or distribution changes.';
      if (share != null) t += ' ' + big.name + ' is the largest contributor at ' + p(share) + ' of actual sellout.';
      items.push({ label: 'Growth Opportunities', tone: 'info', text: t });
    }
    if (key === 'channel') {
      const recoverable = -sum(below, 'gap');
      items.push({
        label: 'Improvement Opportunities', tone: below.length ? 'red' : near.length ? 'yellow' : 'green',
        text: below.length ? 'Improvement opportunity: ' + names(below) + ' ' + (below.length > 1 ? 'are' : 'is') + ' below 90%, representing up to ' + m(recoverable) + ' of recoverable sellout.'
          : near.length ? names(near) + ' ' + (near.length > 1 ? 'are' : 'is') + ' within 10 points of target and can be lifted with focused execution.'
            : 'No channel is below target; focus on protecting share and testing stretch targets.',
      });
    }
    if (key === 'storeFormat') {
      const big = rows.slice().sort((a, b) => b.actual - a.actual)[0];
      const spread = ranked.length > 1 ? ranked[0].ach - ranked[ranked.length - 1].ach : 0;
      items.push({
        label: 'Key Insights', tone: 'info',
        text: big.name + ' is the largest format with ' + (A > 0 ? p(big.actual / A * 100) : 'n/a') + ' of actual sellout' + (ranked.length > 1 ? '; the spread between the best and lowest format is ' + spread.toFixed(1) + ' points' + (spread > 20 ? ', indicating inconsistent execution across formats.' : '.') : '.'),
      });
    }

    /* 5. Gap analysis */
    let gt;
    if (deficits.length) {
      const d0 = deficits[0];
      gt = 'Net gap is ' + U.fmtSigned(gap) + '. ' + deficits.length + ' of ' + rows.length + ' ' + c.plural + ' are short of target by a combined ' + m(-totalDeficit) +
        '; the largest shortfall is ' + d0.name + ' (' + U.fmtSigned(d0.gap) + ', ' + p(d0.gap / totalDeficit * 100) + ' of total shortfall).';
    } else gt = 'No ' + c.plural + ' fall short of target. Net surplus is ' + U.fmtSigned(gap) + '.';
    items.push({ label: c.gap, tone: deficits.length ? (below.length ? 'red' : 'yellow') : 'green', text: gt });

    /* 6. Risk area */
    let rt, rtone, rbadge = null;
    const bigDeficit = deficits.length && T > 0 && (-deficits[0].gap / T) > 0.10;
    if (below.length) {
      rt = below.length + ' ' + c.plural + ' below 90% — ' + names(below) + ' (combined deficit ' + m(-sum(below, 'gap')) + ').';
      if (bigDeficit) rt += ' Deficit risk: ' + deficits[0].name + ' alone is ' + m(-deficits[0].gap) + ' short, over 10% of total target.';
      rtone = 'red'; rbadge = 'Warning';
    } else if (near.length) {
      rt = 'Watch list: ' + names(near) + ' ' + (near.length > 1 ? 'are' : 'is') + ' between 90% and 99% of target and could slip without intervention.';
      rtone = 'yellow';
    } else rt = 'No ' + c.plural + ' are below 100% of target — no material risk detected.', rtone = 'green';
    if (noTarget.length) rt += ' ' + noTarget.length + ' ' + (noTarget.length > 1 ? 'entries have' : 'entry has') + ' sales but no target (' + names(noTarget, 2) + ').';
    items.push({ label: 'Risk Area', tone: rtone, text: rt, badge: rbadge });

    /* 7. Recommended action */
    const ACTIONS = {
      salesperson: (l) => 'Run targeted coaching and pipeline reviews for ' + names(l) + '; re-check account coverage and set weekly recovery checkpoints.',
      product: (l) => 'Review availability, pricing and promotional support for ' + names(l) + '; reallocate trade spend from over-delivering classifications.',
      channel: (l) => 'Build a channel recovery plan for ' + names(l) + ': assess distribution reach, trade terms and in-store execution.',
      storeFormat: (l) => 'Prioritise merchandising and execution audits in ' + names(l) + ' formats and re-base targets to realistic format potential.',
    };
    let act;
    if (below.length) act = ACTIONS[key](below);
    else if (near.length) act = 'Close the remaining ' + m(-sum(near, 'gap')) + ' gap in ' + names(near) + ' through focused follow-up; they are within reach of 100%.';
    else if (ranked.length) act = 'Sustain momentum: document and replicate what is working at ' + ranked[0].name + ' and consider stretch targets.';
    else act = 'Define targets for this dimension so performance can be measured.';
    items.push({ label: 'Recommended Action', tone: below.length ? 'red' : near.length ? 'yellow' : 'green', text: act });

    return items;
  }

  /* --------------------------------- Pareto ----------------------------- */

  function computePareto(custRows) {
    const pos = (custRows || []).filter((r) => r.actual > 0).sort((a, b) => b.actual - a.actual);
    const total = pos.reduce((s, r) => s + r.actual, 0);
    const out = { rows: [], N: pos.length, total, n80: 0, cum80: 0, top20Share: 0, top1: 0, top3: 0, top5: 0, excluded: (custRows || []).length - pos.length };
    if (!pos.length || total <= 0) return out;
    let run = 0, found = false;
    pos.forEach((r, i) => {
      run += r.actual;
      const cum = run / total * 100;
      if (!found && cum >= 80 - 1e-9) { out.n80 = i + 1; out.cum80 = cum; found = true; }
      out.rows.push({ name: r.name, target: r.target, actual: r.actual, ach: r.ach, contrib: r.actual / total * 100, cum, core: false });
    });
    out.rows.forEach((r, i) => { r.core = i < out.n80; });
    const at = (k) => out.rows[Math.min(k, out.N) - 1].cum;
    out.top20Share = at(Math.max(1, Math.ceil(out.N * 0.2)));
    out.top1 = out.rows[0].contrib; out.top3 = at(3); out.top5 = at(5);
    return out;
  }

  function paretoInsights(par) {
    if (!par || !par.N) return [{ label: 'Key Finding', text: 'No customer sales are available for the current selection.', tone: 'na' }];
    const items = [];
    const core = par.rows.slice(0, par.n80);
    const tail = par.rows.slice(par.n80);
    const pareto = par.top20Share >= 80;

    items.push({
      label: 'Key Finding', tone: pareto ? 'green' : 'info', badge: pareto ? 'Pareto Success' : null,
      text: par.n80 + ' of ' + cu(par.N) + ' (' + p1(par.n80 / par.N * 100) + ') generate ' + p1(par.cum80) + ' of sales. ' +
        (pareto ? 'The top 20% of customers deliver ' + p1(par.top20Share) + ' of sales — a classic 80/20 profile.'
          : 'The top 20% of customers deliver ' + p1(par.top20Share) + ' of sales — revenue is more broadly spread than a strict 80/20 pattern.'),
    });

    const top = par.rows[0];
    const alert = par.top1 > 40;
    items.push({
      label: 'Top Customer', tone: alert ? 'red' : par.top1 > 25 ? 'yellow' : 'green', badge: alert ? 'Concentration Risk' : null,
      text: top.name + ' contributes ' + m(top.actual) + ' (' + p1(top.contrib) + ' of total sales)' + (alert ? '. Concentration risk alert: a single customer exceeds 40% of sales.' : '.'),
    });

    if (par.N > 1) {
      const last = par.rows[par.N - 1];
      items.push({
        label: 'Lowest Performer', tone: 'na',
        text: last.name + ' is the smallest active customer at ' + p1(last.contrib) + ' of sales. The long tail of ' + cu(tail.length) + ' beyond the 80% mark together delivers only ' + p1(100 - par.cum80) + '.',
      });
    }

    const withT = core.filter((r) => r.ach != null);
    if (withT.length) {
      const weak = withT.filter((r) => r.ach < 90);
      const def = weak.reduce((s, r) => s + Math.min(0, r.actual - r.target), 0);
      items.push({
        label: 'Gap Analysis', tone: weak.length ? 'red' : 'green',
        text: weak.length ? weak.length + ' of the ' + core.length + ' core ' + (core.length === 1 ? 'customer is' : 'customers are') + ' below 90% of their target ('+ names(weak, 3) + '), with a combined shortfall of ' + m(-def) + '.'
          : (withT.length === 1 ? 'The only core customer with a target is' : 'All ' + withT.length + ' core customers with targets are') + ' at or above 90% of target.',
      });
    }

    const level = par.top1 > 40 ? 'High' : (par.top1 > 25 || par.top3 > 60) ? 'Moderate' : 'Low';
    items.push({
      label: 'Customer Concentration Risk', tone: level === 'High' ? 'red' : level === 'Moderate' ? 'yellow' : 'green', badge: level === 'High' ? 'Warning' : null,
      text: level + ' concentration. The top customer accounts for ' + p1(par.top1) + ', the top 3 for ' + p1(par.top3) + ' and the top 5 for ' + p1(par.top5) + ' of total sales.',
    });

    items.push({
      label: 'Recommended Actions', tone: level === 'High' ? 'red' : 'info',
      text: (level === 'High'
        ? 'Protect the relationship with ' + top.name + ' through multi-period agreements while developing mid-tier accounts to reduce dependency. '
        : 'Assign dedicated key-account ownership and service levels to the ' + (par.n80 === 1 ? 'core customer' : par.n80 + ' core customers') + '. ') +
        (tail.length ? 'Review cost-to-serve and consider consolidated routes or digital ordering for the ' + (tail.length === 1 ? 'tail customer' : tail.length + ' tail customers') + '.' : ''),
    });
    return items;
  }

  g.InsightEngine = { forDimension, computePareto, paretoInsights };
})(typeof window !== 'undefined' ? window : globalThis);
