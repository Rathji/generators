// ============================================================================
// quote-u — advisory send-time completeness checks (roadmap task 55)
// ----------------------------------------------------------------------------
// Before a quote is sent, quote-u runs a set of ADVISORY checks over the
// version's selection: completeness problems (a line with no description or
// part number), commercial problems (a zero-quantity line, an unpriced optional
// item) and freshness problems (a cost snapshot older than the policy window).
//
// These checks are ADVISORY, NEVER BLOCKING. A rep may deliberately send an
// incomplete or stale quote — the system WARNS, it does not veto (the one hard
// gate that remains is the stale-cost acknowledgement, which the send pipeline
// already enforces separately). So `check()` always returns `blocking: false`,
// and every advisory carries a code + severity so the builder can render it.
//
// The module is pure: it resolves the selection through QU_TOTALS (the one
// selection authority), reads no clock unless asked, and touches no storage.
// ============================================================================
window.QU_ADVISORY = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DEFAULT_POLICY = Object.freeze({ stale_cost_days: 7 });

  const CODES = Object.freeze([
    "missing_description",
    "missing_part_number",
    "zero_quantity",
    "stale_cost",
    "unpriced_optional",
    "missing_cost",
    "group_empty"
  ]);

  const SEVERITY = Object.freeze({
    missing_description: "warn",
    missing_part_number: "info",
    zero_quantity: "warn",
    stale_cost: "warn",
    unpriced_optional: "warn",
    missing_cost: "info",
    group_empty: "info"
  });

  class AdvisoryError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "AdvisoryError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new AdvisoryError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = Object.assign({}, DEFAULT_POLICY, isPlainObject(input) ? input : {});
    const days = Number(p.stale_cost_days);
    return { stale_cost_days: Number.isFinite(days) && days >= 0 ? days : DEFAULT_POLICY.stale_cost_days };
  }

  function ms(at) {
    if (at === undefined || at === null) return Date.now();
    if (typeof at === "number") return at;
    const t = Date.parse(at);
    return isNaN(t) ? Date.now() : t;
  }

  function idOf(line, index) {
    const v = line && line.id;
    return v === undefined || v === null ? "line@" + index : String(v);
  }

  function text(v) {
    return v === undefined || v === null ? "" : String(v).trim();
  }

  // ---- the pure check -------------------------------------------------------

  function check(input) {
    input = input || {};
    const lines = Array.isArray(input.line_items) ? input.line_items : (Array.isArray(input.lines) ? input.lines : []);
    const groups = Array.isArray(input.option_groups) ? input.option_groups : (Array.isArray(input.groups) ? input.groups : []);
    const policy = normalizePolicy(input.policy);
    const snapshots = isPlainObject(input.snapshots) ? input.snapshots : {};
    const staleDays = input.stale_cost_days === undefined ? policy.stale_cost_days : Number(input.stale_cost_days);
    const now = ms(input.now);
    const advisories = [];

    let resolved;
    if (input.selection !== undefined && window.QU_TOTALS && typeof window.QU_TOTALS.resolveSelection === "function") {
      try { resolved = window.QU_TOTALS.resolveSelection(lines, input.selection, groups); }
      catch (e) { resolved = null; }
    }
    const selected = resolved
      ? new Set(resolved.selectedIds.map(String))
      : new Set(lines.filter(l => l && (l.optional !== true || l.selected_by_default === true)).map((l, i) => idOf(l, i)));

    function add(code, line, index, extra) {
      const a = Object.assign({
        code,
        severity: SEVERITY[code] || "info",
        line_id: line ? idOf(line, index) : null,
        description: line ? text(line.description) : "",
        option_group_id: line && line.option_group_id ? String(line.option_group_id) : null
      }, extra || {});
      advisories.push(a);
      return a;
    }

    lines.forEach((line, index) => {
      if (!isPlainObject(line)) return;
      const id = idOf(line, index);
      if (!selected.has(id)) return;
      if (!text(line.description)) add("missing_description", line, index, { detail: "This line has no description; the client will see a blank line." });
      if (!text(line.manufacturer_part_number) && !text(line.sku)) add("missing_part_number", line, index, { detail: "This line has neither a manufacturer part number nor a SKU." });
      if (line.quantity === 0) add("zero_quantity", line, index, { detail: "This line has a quantity of zero." });
      if (line.optional === true && !(typeof line.unit_sell_cents === "number" && line.unit_sell_cents > 0)) {
        add("unpriced_optional", line, index, { detail: "This optional item is selected but has no sell price." });
      }
      if (!(typeof line.unit_cost_cents === "number" && line.unit_cost_cents > 0)) {
        add("missing_cost", line, index, { detail: "This line has no captured unit cost, so its margin is unknown." });
      }
      if (line.price_snapshot_ref) {
        const snap = snapshots[String(line.price_snapshot_ref)];
        const captured = snap && snap.captured_at ? Date.parse(snap.captured_at) : NaN;
        if (!isNaN(captured)) {
          const ageDays = (now - captured) / 86400000;
          if (ageDays > staleDays) {
            add("stale_cost", line, index, { age_days: Math.round(ageDays * 10) / 10, captured_at: snap.captured_at, detail: `The cost snapshot is ${Math.round(ageDays)} days old (limit ${staleDays}).` });
          }
        }
      }
    });

    // A selected line in an option group whose members are all off is a
    // modeling smell — but groups with no selected member are legal (all
    // optional), so this only fires for a group that HAS members but no
    // selected one.
    if (Array.isArray(input.option_groups) || Array.isArray(input.groups)) {
      const byGroup = new Map();
      lines.forEach((l, i) => {
        if (!l || !l.option_group_id) return;
        const gid = String(l.option_group_id);
        if (!byGroup.has(gid)) byGroup.set(gid, []);
        byGroup.get(gid).push(idOf(l, i));
      });
      groups.forEach(g => {
        if (!g || g.id === undefined || g.id === null) return;
        const members = byGroup.get(String(g.id)) || [];
        if (!members.length) return;
        const on = members.filter(m => selected.has(m));
        if (!on.length) add("group_empty", null, 0, { option_group_id: String(g.id), group_name: g.name || "", detail: `Option group "${g.name || g.id}" has no selected option.` });
      });
    }

    const counts = {};
    CODES.forEach(c => { counts[c] = 0; });
    advisories.forEach(a => { counts[a.code] = (counts[a.code] || 0) + 1; });
    const warnCount = advisories.filter(a => a.severity === "warn").length;

    return {
      ok: advisories.length === 0,
      blocking: false,
      advisories,
      counts,
      warn_count: warnCount,
      advisory_count: advisories.length,
      stale_cost_days: staleDays,
      checked_line_count: selected.size
    };
  }

  // A one-line summary for a toast/banner.
  function summarize(result) {
    if (!result) return "No advisory result.";
    if (!result.advisories || !result.advisories.length) return "No concerns found.";
    const parts = [];
    const labels = {
      missing_description: "missing description",
      missing_part_number: "missing part number",
      zero_quantity: "zero quantity",
      stale_cost: "stale cost",
      unpriced_optional: "unpriced optional",
      missing_cost: "missing cost",
      group_empty: "empty option group"
    };
    ["missing_description", "zero_quantity", "unpriced_optional", "stale_cost", "missing_cost", "missing_part_number", "group_empty"].forEach(code => {
      const n = result.counts && result.counts[code];
      if (n) parts.push(n + " " + (labels[code] || code));
    });
    return parts.join(", ") + ".";
  }

  function createService(opts) {
    opts = opts || {};
    const policy = normalizePolicy(opts.policy);

    // Accepts an already-loaded { line_items, option_groups, snapshots } or a
    // version service; prices are never fetched — a missing snapshot simply
    // means no staleness advisory.
    function run(input) {
      input = input || {};
      return check(Object.assign({ policy }, input));
    }

    return {
      policy() { return policy; },
      run,
      check,
      summarize,
      ready: () => Promise.resolve({ ok: true })
    };
  }

  return {
    VERSION,
    CODES,
    SEVERITY,
    DEFAULT_POLICY,
    normalizePolicy,
    check,
    summarize,
    createService
  };
})();
