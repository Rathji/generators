// ============================================================================
// quote-u — bundle cost composition & margin roll-up (roadmap task 54)
// ----------------------------------------------------------------------------
// A bundle — a good/better/best tier, a package option, or any option group —
// has a COST COMPOSITION, not just a price. Before this module the only place a
// bundle's profitability could be discovered was after delivery, when the
// distributor invoices landed. This module makes the composition an OBJECT that
// can be computed at authoring time, so a rep sees an option's margin BEFORE it
// is sent.
//
//   compose(lines)
//     → { components[], one_time{...}, mrr{...}, twelve_month{...},
//         missing_cost_count, currency }
//   groupComposition(lines, group, selection)
//     → the composition of ONE option group's SELECTED members
//   rollup(groups, lines, selection)
//     → per-group compositions + the whole-version composition
//
// Each component carries its sell, its cost, its derived margin and a
// `share_bp` (its share of the bundle's sell), so a rep can see which component
// is dragging the margin down. A line whose unit cost is absent/zero is flagged
// `missing_cost` (its margin is reported as null rather than pretended to be
// 100%). Money stays integer cents via QU_MONEY; the module is pure (no clock,
// randomness, storage or network) and INTERNAL ONLY — a composition always
// carries cost and margin and must never reach a client surface (invariant I4).
// ============================================================================
window.QU_BUNDLES = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u bundles require window.QU_MONEY (load src/money.js first)");
  const LI = window.QU_LINEITEMS || null;
  const TOT = window.QU_TOTALS || null;

  const VERSION = "1.0.0";
  const KINDS = ["one_time", "mrr"];

  class BundleError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "BundleError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new BundleError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function intOrNull(v) {
    return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
  }

  function sellOf(line) {
    const v = intOrNull(line && line.unit_sell_cents);
    return v === null ? 0 : v;
  }

  function costOf(line) {
    const v = intOrNull(line && line.unit_cost_cents);
    return v === null ? 0 : v;
  }

  function quantityOf(line) {
    const q = line && line.quantity;
    return typeof q === "number" && Number.isInteger(q) && q >= 0 ? q : 1;
  }

  function idOf(line, index) {
    const v = line && line.id;
    return v === undefined || v === null ? "line@" + index : String(v);
  }

  function kindOf(line) {
    const k = line && line.kind;
    if (k === "one_time" || k === "mrr") return k;
    fail("bad_kind", `A bundle component must be one_time or mrr, got ${String(k)}.`);
  }

  function ratioBp(part, whole) {
    if (!whole) return null;
    return M.bpOf(part, whole);
  }

  function rateBp(sell, cost) {
    return M.marginBp(sell, cost);
  }

  function bucket() {
    return { sell_cents: 0, cost_cents: 0, margin_cents: 0 };
  }

  function addToBucket(b, line, amount) {
    const sell = amount;
    const cost = M.lineTotal(costOf(line), quantityOf(line));
    b.sell_cents = M.add(b.sell_cents, sell);
    b.cost_cents = M.add(b.cost_cents, cost);
    b.margin_cents = M.sub(b.sell_cents, b.cost_cents);
    return b;
  }

  function bucketOut(b) {
    return {
      sell_cents: b.sell_cents,
      cost_cents: b.cost_cents,
      margin_cents: b.margin_cents,
      margin_bp: rateBp(b.sell_cents, b.cost_cents)
    };
  }

  // The cost composition of a list of line items. Pure.
  function compose(lines) {
    const list = Array.isArray(lines) ? lines : [];
    const components = [];
    const oneTime = bucket();
    const mrr = bucket();
    let totalSell = 0;
    let missingCost = 0;
    let currency = null;

    list.forEach((line, index) => {
      if (!isPlainObject(line)) fail("bad_line", "A bundle component must be a line item object.");
      const id = idOf(line, index);
      const kind = kindOf(line);
      const quantity = quantityOf(line);
      const unitSell = sellOf(line);
      const unitCost = costOf(line);
      const amount = M.lineTotal(unitSell, quantity);
      const costTotal = M.lineTotal(unitCost, quantity);
      const missing = !(unitCost > 0);
      if (missing) missingCost++;
      if (line.currency) currency = currency || M.normalizeCurrency(line.currency);
      const marginCents = M.sub(amount, costTotal);
      components.push({
        id,
        description: (line && line.description) || "",
        kind,
        quantity,
        unit_sell_cents: unitSell,
        unit_cost_cents: unitCost,
        amount_cents: amount,
        cost_total_cents: costTotal,
        unit_margin_cents: M.marginCents(unitSell, unitCost),
        margin_cents: marginCents,
        margin_bp: rateBp(amount, costTotal),
        markup_bp: M.markupBp(costTotal, amount),
        missing_cost: missing,
        option_group_id: (line && line.option_group_id) || null,
        section: (line && line.section) || ""
      });
      addToBucket(kind === "mrr" ? mrr : oneTime, line, amount);
      totalSell = M.add(totalSell, amount);
    });

    if (currency === null) currency = M.DEFAULT_CURRENCY;
    components.forEach(c => { c.share_bp = ratioBp(c.amount_cents, totalSell); });

    const twelveSell = M.add(oneTime.sell_cents, M.mulByInt(mrr.sell_cents, 12));
    const twelveCost = M.add(oneTime.cost_cents, M.mulByInt(mrr.cost_cents, 12));

    return {
      component_count: components.length,
      components,
      one_time: bucketOut(oneTime),
      mrr: bucketOut(mrr),
      twelve_month: {
        sell_cents: twelveSell,
        cost_cents: twelveCost,
        margin_cents: M.sub(twelveSell, twelveCost),
        margin_bp: rateBp(twelveSell, twelveCost)
      },
      missing_cost_count: missingCost,
      currency
    };
  }

  // The composition of one option group's SELECTED members. `selection` is any
  // QU_TOTALS form; when omitted the group's defaults apply.
  function groupComposition(lines, group, selection) {
    if (!isPlainObject(group)) fail("bad_group", "groupComposition needs an option group.");
    const all = Array.isArray(lines) ? lines : [];
    const members = all.filter(l => l && String(l.option_group_id || "") === String(group.id));
    let selectedIds = null;
    if (TOT && typeof TOT.resolveSelection === "function") {
      const resolved = TOT.resolveSelection(all, selection, [group]);
      selectedIds = resolved.selectedIds;
    }
    const selected = selectedIds
      ? members.filter(m => selectedIds.indexOf(String(m.id)) !== -1)
      : members.filter(m => m.selected_by_default === true || m.optional !== true);
    return {
      group: {
        id: group.id,
        name: group.name || "",
        selection_type: group.selection_type || "multi"
      },
      member_count: members.length,
      selected_ids: selected.map(m => String(m.id)),
      composition: compose(selected)
    };
  }

  // The whole-version roll-up: every option group's composition plus the
  // composition of the resolved selection (the same selection the totals engine
  // would bill). Pure.
  function rollup(groups, lines, selection) {
    const list = Array.isArray(lines) ? lines : [];
    let selectedIds = null;
    let selectionInfo = null;
    if (TOT && typeof TOT.resolveSelection === "function") {
      const resolved = TOT.resolveSelection(list, selection, groups || []);
      selectedIds = resolved.selectedIds;
      selectionInfo = { selected_ids: resolved.selectedIds.slice(), repairs: resolved.repairs.slice() };
    }
    const selectedLines = selectedIds ? list.filter(l => l && selectedIds.indexOf(String(l.id)) !== -1) : list;
    const perGroup = (groups || []).map(g => groupComposition(list, g, selection));
    return {
      groups: perGroup,
      group_count: perGroup.length,
      overall: compose(selectedLines),
      selection: selectionInfo
    };
  }

  // A short human summary of a composition (internal UI). Never client-facing.
  function describe(composition, opts) {
    if (!composition) return null;
    const o = Object.assign({ currency: composition.currency }, opts || {});
    return {
      one_time: M.format(composition.one_time.sell_cents, o),
      one_time_cost: M.format(composition.one_time.cost_cents, o),
      one_time_margin: M.format(composition.one_time.margin_cents, o),
      mrr: M.format(composition.mrr.sell_cents, o),
      mrr_cost: M.format(composition.mrr.cost_cents, o),
      mrr_margin: M.format(composition.mrr.margin_cents, o),
      twelve_month: M.format(composition.twelve_month.sell_cents, o),
      twelve_month_margin: M.format(composition.twelve_month.margin_cents, o),
      one_time_margin_bp: composition.one_time.margin_bp,
      mrr_margin_bp: composition.mrr.margin_bp
    };
  }

  function createService(opts) {
    opts = opts || {};
    const versions = opts.versions || null;
    const optionGroups = opts.optionGroups || window.QU_OPTIONGROUPS || null;

    async function forVersion(versionId, selection) {
      if (!versions || typeof versions.listLines !== "function") {
        return { ok: false, code: "no_versions", detail: "QU_BUNDLES needs the version service to roll up a stored version." };
      }
      const lines = await versions.listLines(versionId);
      if (!lines.ok) return lines;
      const groups = await versions.listGroups(versionId);
      if (!groups.ok) return groups;
      try {
        return Object.assign({ ok: true, version_id: versionId }, rollup(groups.groups, lines.lines, selection));
      } catch (e) {
        return { ok: false, code: e.code || "bundle_failed", detail: (e && e.message) || String(e) };
      }
    }

    function ready() { return Promise.resolve({ ok: true }); }

    return {
      ready,
      compose,
      groupComposition,
      rollup,
      describe,
      forVersion,
      isInternal: true
    };
  }

  return {
    VERSION,
    KINDS,
    BundleError,
    compose,
    groupComposition,
    rollup,
    describe,
    createService
  };
})();
