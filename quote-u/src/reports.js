// ============================================================================
// quote-u — quote dashboards & reports (roadmap task 58)
// ----------------------------------------------------------------------------
// ONE pure analytics engine over the quoting system of record. It reads the
// immutable facts the rest of the app already produces — quotes, quote versions,
// the append-only `quote_events` lifecycle timeline, the acceptance `approvals`
// and the line items — and answers the questions a sales manager asks:
//
//   • quote volume       — quotes/versions created, and versions sent/decided
//   • win/loss rate      — won ÷ decided (declined is a loss, expired is lapsed)
//   • average margin     — INTERNAL cost vs sell over ACCEPTED (approved) lines
//   • cycle time         — days from sent to decided
//   • open-quote pipeline— versions still sitting at sent/viewed, and their value
//
// EVERY metric is filterable by rep, company and period. The engine is pure and
// reads only integer cents (QU_MONEY): it never mutates its input, never touches
// storage or the network, and derives margin on demand (never stored).
//
// Reports are INTERNAL. Margin is computed here for the internal Reports
// station only; the portal serializer remains the single client-safe surface
// (invariant I4) and never calls this module.
// ============================================================================
window.QU_REPORTS = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u reports require window.QU_MONEY (load src/money.js first)");
  const TOTALS = window.QU_TOTALS || null;

  const VERSION = "1.0.0";
  const TERM_MONTHS = 12;

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.records)) return v.records;
    return [];
  }

  function str(v) {
    return v === undefined || v === null ? null : String(v);
  }

  // ISO timestamp / epoch ms / Date → epoch ms (null when unparseable).
  function toMs(v) {
    if (v === undefined || v === null || v === "") return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
    if (typeof v === "number" && isFinite(v)) return v >= 1e12 ? v : (v >= 1e9 ? v * 1000 : null);
    if (typeof v === "string") {
      const t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    return null;
  }

  // A period bound: an inclusive start / exclusive-ish end. `to` is treated as
  // the END OF the given day (so a date-only `to` includes that whole day).
  function normalizeFilter(input) {
    const f = isPlainObject(input) ? input : {};
    const fromMs = toMs(f.from);
    let toMsVal = toMs(f.to);
    if (toMsVal !== null && typeof f.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.to.trim())) {
      toMsVal += 24 * 60 * 60 * 1000 - 1;
    }
    return {
      rep: f.rep === undefined || f.rep === null || f.rep === "" ? null : String(f.rep),
      company_id: f.company_id === undefined || f.company_id === null || f.company_id === "" ? null : String(f.company_id),
      from: str(f.from),
      to: str(f.to),
      fromMs: fromMs,
      toMs: toMsVal,
      hasPeriod: fromMs !== null || toMsVal !== null
    };
  }

  function inPeriod(ms, filter) {
    if (ms === null) return !filter.hasPeriod ? true : false;
    if (filter.fromMs !== null && ms < filter.fromMs) return false;
    if (filter.toMs !== null && ms > filter.toMs) return false;
    return true;
  }

  function safeBp(part, whole) {
    if (!Number.isInteger(part) || !Number.isInteger(whole) || whole === 0) return null;
    try { return M.bpOf(part, whole); } catch (e) { return null; }
  }

  function safeRatioBp(count, total) {
    if (!Number.isInteger(count) || !Number.isInteger(total) || total === 0) return null;
    return Math.round((count * 10000) / total);
  }

  function lineQuantity(line) {
    const q = line && line.quantity;
    return typeof q === "number" && Number.isInteger(q) && q >= 0 ? q : 1;
  }
  function lineSell(line) {
    const unit = line && line.unit_sell_cents;
    if (typeof unit !== "number" || !Number.isSafeInteger(unit)) return 0;
    return M.mulByInt(unit, lineQuantity(line));
  }
  function lineCost(line) {
    const unit = line && line.unit_cost_cents;
    if (typeof unit !== "number" || !Number.isSafeInteger(unit)) return 0;
    return M.mulByInt(unit, lineQuantity(line));
  }
  function lineHasCost(line) {
    const unit = line && line.unit_cost_cents;
    return typeof unit === "number" && Number.isSafeInteger(unit) && unit !== 0;
  }
  function lineKind(line) {
    return line && line.kind === "mrr" ? "mrr" : "one_time";
  }
  function lineTerm(line) {
    const t = line && line.term_months;
    return typeof t === "number" && Number.isInteger(t) && t > 0 ? t : TERM_MONTHS;
  }

  // The per-version timeline distilled from the audit log. Falls back to the
  // stored version state when no events exist (older data / a hand-built set).
  function timelineOf(versionId, events) {
    const list = asArray(events).filter(e => e && String(e.version_id) === String(versionId));
    list.sort((a, b) => (toMs(a.at) || 0) - (toMs(b.at) || 0));
    const out = { sent_at: null, viewed_at: null, approved_at: null, declined_at: null, expired_at: null, decision: null, decided_at: null, events: list.length };
    for (const e of list) {
      const name = String(e.event || "");
      const ms = toMs(e.at);
      if (name === "sent" && out.sent_at === null) out.sent_at = e.at;
      else if (name === "viewed" && out.viewed_at === null) out.viewed_at = e.at;
      else if (name === "approved") { out.approved_at = e.at; out.decision = "approved"; out.decided_at = e.at; }
      else if (name === "declined") { out.declined_at = e.at; out.decision = "declined"; out.decided_at = e.at; }
      else if (name === "expired") { out.expired_at = e.at; out.decision = "expired"; out.decided_at = e.at; }
    }
    return out;
  }

  // Resolve the selected line ids for a version: the acceptance selection when
  // there is an approval, else the default selection (required lines plus
  // selected-by-default optionals, bundle groups repaired to one member).
  function selectedIdsFor(lines, groups, approval) {
    if (approval && Array.isArray(approval.selection) && approval.selection.length) {
      return approval.selection.map(String);
    }
    if (TOTALS && typeof TOTALS.resolveSelection === "function") {
      try {
        const res = TOTALS.resolveSelection(lines, undefined, groups);
        return res.selected_ids.map(String);
      } catch (e) { /* fall through to the simple rule */ }
    }
    return lines.filter(l => l && (!l.optional || l.selected_by_default)).map(l => String(l.id));
  }

  // The per-version fact rows the report aggregates. One row per version,
  // carrying its quote context, lifecycle timeline, accepted/default selection
  // and the derived sell/cost/margin over that selection.
  function versionFacts(dataset, filter) {
    const quotes = asArray(dataset && dataset.quotes);
    const versions = asArray(dataset && dataset.versions);
    const events = asArray(dataset && dataset.events);
    const approvals = asArray(dataset && dataset.approvals);
    const lines = asArray(dataset && dataset.lines);
    const groups = asArray(dataset && dataset.groups);
    const byQuote = new Map();
    quotes.forEach(q => { if (q && q.id !== undefined) byQuote.set(String(q.id), q); });
    const byVersionApproval = new Map();
    approvals.forEach(a => { if (a && a.version_id !== undefined) byVersionApproval.set(String(a.version_id), a); });
    const linesByVersion = new Map();
    lines.forEach(l => {
      if (!l || l.quote_version_id === undefined || l.quote_version_id === null) return;
      const k = String(l.quote_version_id);
      if (!linesByVersion.has(k)) linesByVersion.set(k, []);
      linesByVersion.get(k).push(l);
    });
    const groupsByVersion = new Map();
    groups.forEach(g => {
      if (!g || g.quote_version_id === undefined || g.quote_version_id === null) return;
      const k = String(g.quote_version_id);
      if (!groupsByVersion.has(k)) groupsByVersion.set(k, []);
      groupsByVersion.get(k).push(g);
    });

    const rows = [];
    for (const version of versions) {
      if (!version || version.id === undefined) continue;
      const quote = version.quote_id === undefined || version.quote_id === null ? null : byQuote.get(String(version.quote_id));
      const companyId = quote ? quote.company_id : null;
      if (filter.company_id && String(companyId) !== filter.company_id) continue;
      const rep = (quote && quote.created_by) || version.created_by || null;
      if (filter.rep && String(rep || "") !== filter.rep) {
        // A version may also be attributed by the actor who sent it.
        const sentActor = events.find(e => e && String(e.version_id) === String(version.id) && e.event === "sent" && e.actor);
        if (!sentActor || String(sentActor.actor) !== filter.rep) continue;
      }
      const timeline = timelineOf(version.id, events);
      let decision = timeline.decision;
      let decidedAt = timeline.decided_at;
      let sentAt = timeline.sent_at;
      const state = version.state ? String(version.state) : "draft";
      if (!decision && ["approved", "declined", "expired"].indexOf(state) !== -1) {
        decision = state;
        decidedAt = version.updated_at || version.frozen_at || null;
      }
      if (!sentAt && ["sent", "viewed", "approved", "declined", "expired"].indexOf(state) !== -1) {
        sentAt = version.frozen_at || version.updated_at || null;
      }
      const approval = byVersionApproval.get(String(version.id)) || null;
      const vLines = linesByVersion.get(String(version.id)) || [];
      const vGroups = groupsByVersion.get(String(version.id)) || [];
      const selected = selectedIdsFor(vLines, vGroups, approval);
      const selSet = new Set(selected);
      let sell = 0, cost = 0, missingCost = 0, oneTime = 0, mrr = 0, deal = 0;
      vLines.forEach(l => {
        if (!l || !selSet.has(String(l.id))) return;
        const amt = lineSell(l);
        sell = M.add(sell, amt);
        cost = M.add(cost, lineCost(l));
        if (!lineHasCost(l)) missingCost += 1;
        if (lineKind(l) === "one_time") { oneTime = M.add(oneTime, amt); deal = M.add(deal, amt); }
        else { mrr = M.add(mrr, amt); deal = M.add(deal, M.mulByInt(amt, lineTerm(l))); }
      });
      const repName = rep || (approval && approval.approver_name) || "unassigned";
      rows.push({
        version_id: String(version.id),
        quote_id: version.quote_id === undefined || version.quote_id === null ? null : String(version.quote_id),
        quote_number: (quote && quote.quote_number) || version.quote_number || null,
        company_id: companyId === undefined || companyId === null ? null : String(companyId),
        company_name: (quote && quote.company_name) || null,
        rep: String(repName),
        mode: quote && quote.mode ? String(quote.mode) : "quote",
        state: state,
        decision: decision,
        sent_at: sentAt,
        viewed_at: timeline.viewed_at,
        decided_at: decidedAt,
        approved_at: timeline.approved_at,
        quote_created_at: quote ? quote.created_at : null,
        version_created_at: version.created_at || null,
        open: state === "sent" || state === "viewed",
        approved: !!approval || state === "approved",
        approver_name: approval && approval.approver_name !== undefined ? approval.approver_name : null,
        approval_recomputed: approval ? {
          one_time_cents: approval.one_time_cents,
          mrr_cents: approval.mrr_cents,
          twelve_month_value_cents: approval.twelve_month_value_cents,
          deal_value_cents: approval.deal_value_cents
        } : null,
        one_time_cents: approval && Number.isSafeInteger(approval.one_time_cents) ? approval.one_time_cents : oneTime,
        mrr_cents: approval && Number.isSafeInteger(approval.mrr_cents) ? approval.mrr_cents : mrr,
        twelve_month_value_cents: approval && Number.isSafeInteger(approval.twelve_month_value_cents) ? approval.twelve_month_value_cents : M.add(oneTime, M.mulByInt(mrr, 12)),
        deal_value_cents: approval && Number.isSafeInteger(approval.deal_value_cents) ? approval.deal_value_cents : deal,
        sell_cents: sell,
        cost_cents: cost,
        margin_cents: M.sub(sell, cost),
        margin_bp: safeBp(M.sub(sell, cost), sell),
        missing_cost_lines: missingCost,
        line_count: vLines.length,
        selected_count: selected.length
      });
    }
    return rows;
  }

  // Average/median of a numeric array (null when empty).
  function avg(nums) {
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  function median(nums) {
    if (!nums.length) return null;
    const s = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function groupBy(rows, keyFn) {
    const map = new Map();
    rows.forEach(r => {
      const k = keyFn(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return map;
  }

  // Aggregate one set of rows: applied-period decisions + margin.
  function aggregate(rows, filter) {
    const decided = rows.filter(r => r.decided_at && inPeriod(toMs(r.decided_at), filter) && (r.decision === "approved" || r.decision === "declined"));
    const won = decided.filter(r => r.decision === "approved");
    const lost = decided.filter(r => r.decision === "declined");
    const expired = rows.filter(r => r.decision === "expired" && r.decided_at && inPeriod(toMs(r.decided_at), filter));
    const accepted = rows.filter(r => r.approved && (r.approved_at ? inPeriod(toMs(r.approved_at), filter) : inPeriod(toMs(r.decided_at), filter)));
    let sell = 0, cost = 0, missing = 0;
    accepted.forEach(r => { sell = M.add(sell, r.sell_cents); cost = M.add(cost, r.cost_cents); missing += r.missing_cost_lines; });
    return {
      decided: decided.length,
      won: won.length,
      lost: lost.length,
      expired: expired.length,
      win_rate_bp: safeRatioBp(won.length, decided.length),
      margin_sell_cents: sell,
      margin_cost_cents: cost,
      margin_cents: M.sub(sell, cost),
      margin_bp: safeBp(M.sub(sell, cost), sell),
      accepted_versions: accepted.length,
      missing_cost_lines: missing,
      decided_rows: decided,
      accepted_rows: accepted
    };
  }

  // ---- the report -----------------------------------------------------------

  function build(dataset, filterInput) {
    const filter = normalizeFilter(filterInput);
    const rows = versionFacts(dataset, filter);
    const quotes = asArray(dataset && dataset.quotes).filter(q => {
      if (!q) return false;
      if (filter.company_id && String(q.company_id) !== filter.company_id) return false;
      if (filter.rep && String(q.created_by || "") !== filter.rep) return false;
      return true;
    });

    const quotesCreated = quotes.filter(q => inPeriod(toMs(q.created_at), filter));
    const versionsCreated = rows.filter(r => inPeriod(toMs(r.version_created_at), filter));
    const sent = rows.filter(r => r.sent_at && inPeriod(toMs(r.sent_at), filter));
    const viewed = rows.filter(r => r.viewed_at && inPeriod(toMs(r.viewed_at), filter));
    const agg = aggregate(rows, filter);

    // Cycle time: sent → decided for decided-in-period versions.
    const cycleNums = [];
    agg.decided_rows.forEach(r => {
      const a = toMs(r.sent_at), b = toMs(r.decided_at);
      if (a !== null && b !== null && b >= a) cycleNums.push(b - a);
    });
    const cycle = {
      samples: cycleNums.length,
      avg_ms: avg(cycleNums),
      median_ms: median(cycleNums),
      min_ms: cycleNums.length ? Math.min.apply(null, cycleNums) : null,
      max_ms: cycleNums.length ? Math.max.apply(null, cycleNums) : null,
      avg_days: cycleNums.length ? avg(cycleNums) / 86400000 : null,
      median_days: cycleNums.length ? median(cycleNums) / 86400000 : null
    };

    // The open pipeline is a CURRENT snapshot (no period): versions still at
    // sent/viewed with their default-selection value.
    const openRows = rows.filter(r => r.open);
    let openValue = 0, openMrr = 0, openDeal = 0;
    openRows.forEach(r => {
      // The version's own split (its default/selected line kinds), whether or
      // not an approval exists — an open version has no approval yet.
      if (typeof r.one_time_cents === "number") openValue = M.add(openValue, r.one_time_cents);
      if (typeof r.mrr_cents === "number") openMrr = M.add(openMrr, r.mrr_cents);
      if (typeof r.deal_value_cents === "number") openDeal = M.add(openDeal, r.deal_value_cents);
    });
    const byState = {};
    openRows.forEach(r => { byState[r.state] = (byState[r.state] || 0) + 1; });

    // By-rep and by-company breakdowns. `rowKey` groups the version facts and
    // `quoteKey` matches a quote for the creation-count column.
    function breakdown(rowKey, quoteKey) {
      const out = [];
      groupBy(rows, rowKey).forEach((groupRows, key) => {
        const g = aggregate(groupRows, filter);
        const qCreated = quotes.filter(q => String(quoteKey(q) == null ? "" : quoteKey(q)) === String(key == null ? "" : key)).filter(q => inPeriod(toMs(q.created_at), filter)).length;
        let dealTotal = 0, dealCount = 0;
        g.accepted_rows.forEach(r => {
          if (r.approval_recomputed && typeof r.approval_recomputed.deal_value_cents === "number") {
            dealTotal = M.add(dealTotal, r.approval_recomputed.deal_value_cents);
            dealCount += 1;
          }
        });
        out.push({
          key: key == null ? null : String(key),
          label: key == null || key === "" ? "unassigned" : String(key),
          quotes: qCreated,
          sent: groupRows.filter(r => r.sent_at && inPeriod(toMs(r.sent_at), filter)).length,
          decided: g.decided,
          won: g.won,
          lost: g.lost,
          win_rate_bp: g.win_rate_bp,
          margin_sell_cents: g.margin_sell_cents,
          margin_cents: g.margin_cents,
          margin_bp: g.margin_bp,
          avg_deal_cents: dealCount ? M.mulDiv(dealTotal, 1, dealCount) : null
        });
      });
      return out.sort((a, b) => (b.decided - a.decided) || String(a.label).localeCompare(String(b.label)));
    }
    const byRep = breakdown(r => r.rep, q => q.created_by);
    const byCompany = breakdown(r => r.company_id, q => q.company_id);

    return {
      ok: true,
      engine: "QU_REPORTS",
      version: VERSION,
      filter: filter,
      volume: {
        quotes: quotesCreated.length,
        versions: versionsCreated.length,
        sent: sent.length,
        viewed: viewed.length,
        decided: agg.decided,
        approved: agg.won,
        declined: agg.lost,
        expired: agg.expired
      },
      win_loss: {
        decided: agg.decided,
        won: agg.won,
        lost: agg.lost,
        expired: agg.expired,
        win_rate_bp: agg.win_rate_bp,
        loss_rate_bp: safeRatioBp(agg.lost, agg.decided)
      },
      cycle_time: cycle,
      margin: {
        accepted_versions: agg.accepted_versions,
        sell_cents: agg.margin_sell_cents,
        cost_cents: agg.margin_cost_cents,
        margin_cents: agg.margin_cents,
        margin_bp: agg.margin_bp,
        avg_margin_bp: agg.margin_bp,
        missing_cost_lines: agg.missing_cost_lines
      },
      pipeline: {
        open_count: openRows.length,
        by_state: byState,
        one_time_cents: openValue,
        mrr_cents: openMrr,
        deal_value_cents: openDeal,
        twelve_month_value_cents: M.add(openValue, M.mulByInt(openMrr, 12))
      },
      by_rep: byRep,
      by_company: byCompany,
      counts: { versions: rows.length, quotes: quotes.length }
    };
  }

  // ---- the service ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const approvals = opts.approvals || null;
    const audit = opts.audit || null;
    const store = opts.store || null;

    async function loadDataset() {
      const out = { quotes: [], versions: [], approvals: [], events: [], lines: [], groups: [] };
      if (quotes && typeof quotes.listQuotes === "function") {
        const r = await quotes.listQuotes({ scope: opts.scope === undefined ? "*" : opts.scope }, {});
        if (r && r.ok) out.quotes = r.quotes || [];
      }
      if (versions && typeof versions.listVersions === "function") {
        const r = await versions.listVersions();
        if (r && r.ok) out.versions = r.versions || [];
      }
      if (audit && typeof audit.list === "function") {
        const r = await audit.list({});
        if (r && r.ok) out.events = r.records || [];
      }
      if (approvals && typeof approvals.list === "function") {
        const r = await approvals.list({});
        if (r && r.ok) out.approvals = r.approvals || [];
      }
      if (store && typeof store.loadDoc === "function") {
        const lines = await store.loadDoc("line_items");
        if (lines && lines.ok && lines.content) out.lines = asArray(lines.content);
        const groups = await store.loadDoc("option_groups");
        if (groups && groups.ok && groups.content) out.groups = asArray(groups.content);
      } else if (versions && typeof versions.listLines === "function") {
        for (const v of out.versions) {
          const lines = await versions.listLines(v.id);
          if (lines && lines.ok) out.lines = out.lines.concat(lines.lines || []);
          if (typeof versions.listGroups === "function") {
            const groups = await versions.listGroups(v.id);
            if (groups && groups.ok) out.groups = out.groups.concat(groups.groups || []);
          }
        }
      }
      return out;
    }

    async function report(filter) {
      const ds = await loadDataset();
      return build(ds, filter);
    }

    // The distinct reps/companies seen in the data, for the filter controls.
    async function facets() {
      const ds = await loadDataset();
      const reps = new Set();
      const companies = new Map();
      asArray(ds.quotes).forEach(q => {
        if (!q) return;
        if (q.created_by) reps.add(String(q.created_by));
        if (q.company_id !== undefined && q.company_id !== null) companies.set(String(q.company_id), q.company_name || String(q.company_id));
      });
      return { reps: Array.from(reps).sort(), companies: Array.from(companies.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) };
    }

    function ready() { return Promise.resolve({ ok: true }); }

    return { build, loadDataset, report, facets, ready };
  }

  // Filter presets the UI offers (period start relative to `now`).
  function periodFromPreset(preset, nowMs) {
    const now = typeof nowMs === "number" ? nowMs : Date.now();
    const day = 86400000;
    const iso = ms => new Date(ms).toISOString();
    function startOfYear(ms) { return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1); }
    switch (String(preset)) {
      case "30d": return { from: iso(now - 30 * day), to: iso(now) };
      case "90d": return { from: iso(now - 90 * day), to: iso(now) };
      case "12m": return { from: iso(now - 365 * day), to: iso(now) };
      case "ytd": return { from: iso(startOfYear(now)), to: iso(now) };
      case "all":
      default: return { from: null, to: null };
    }
  }

  return {
    VERSION,
    TERM_MONTHS,
    toMs,
    inPeriod,
    normalizeFilter,
    timelineOf,
    selectedIdsFor,
    versionFacts,
    aggregate,
    build,
    periodFromPreset,
    createService
  };
})();
