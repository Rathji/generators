// quote-u — totals engine (roadmap task 4)
//
// ONE pure implementation of quote totals, shared by every surface: the
// builder's live preview, the portal's display-only totals, and the approval
// record. There is no second copy of this math anywhere — if two screens ever
// disagreed, it is because one of them stopped calling `computeTotals`.
//
// Definitions (v1):
//   one_time_cents            = Σ selected one-time line amounts
//   mrr_cents                 = Σ selected MRR line amounts (per month)
//   annual_mrr_cents          = 12 × mrr
//   twelve_month_value_cents  = one_time + 12 × mrr        (fixed 12-month metric)
//   deal_value_cents          = Σ selected lines of { one_time amount | term × mrr
//                               amount }  — the PER-SERVICE deal value (task 53).
//                               A line may carry its own `term_months`; when it
//                               does not it inherits the quote-level term
//                               (default 12). With every line at the default
//                               term this is exactly one_time + 12 × mrr, so
//                               the flat twelve-month formula is the special case.
// A line amount is unit_sell × quantity, exact via QU_MONEY (integer cents only).
//
// The engine is pure and total: it never mutates its input, never reads the
// clock or randomness, and never touches the network or storage. It resolves
// the client's selection (honouring required lines and single-select option
// groups) and returns integer cents plus a per-line breakdown. Every monetary
// output is an integer and passes QU_MONEY.auditStoredMoney.
(function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u totals engine requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const TERM_MONTHS = 12;
  const KINDS = ["one_time", "mrr"];
  // Task 56: `bundle` is the canonical name for a mutually-exclusive group
  // (good/better/best tiers, package options). `single` is the deprecated
  // alias, still accepted so pre-migration data reads correctly; QU_MIGRATE
  // rewrites stored `single` groups to `bundle`.
  const GROUP_TYPES = ["single", "bundle", "multi", "optional"];
  const DEPRECATED_GROUP_TYPES = Object.freeze({ single: "bundle" });
  const EXCLUSIVE_GROUP_TYPES = Object.freeze({ single: true, bundle: true });

  class TotalsError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "TotalsError";
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new TotalsError(code, message);
  }

  function field(obj, names) {
    for (let i = 0; i < names.length; i++) {
      const v = obj[names[i]];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }

  function idOf(item, index) {
    const v = field(item, ["id", "line_item_id", "lineItemId"]);
    return v !== undefined ? String(v) : "line@" + index;
  }

  function kindOf(item, id) {
    const k = field(item, ["kind", "billing_kind", "billingKind"]);
    if (k === undefined) fail("bad_kind", `Line item "${id}" has no kind (expected one of ${KINDS.join(", ")}).`);
    const norm = String(k);
    if (KINDS.indexOf(norm) === -1) fail("bad_kind", `Line item "${id}" has kind "${norm}"; expected one of ${KINDS.join(", ")}.`);
    return norm;
  }

  function quantityOf(item, id) {
    const q = field(item, ["quantity", "qty"]);
    if (q === undefined) return 1;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 0) {
      fail("bad_quantity", `Line item "${id}" has quantity ${String(q)}; expected a non-negative integer.`);
    }
    return q;
  }

  function unitSellOf(item, id) {
    const v = field(item, ["unit_sell_cents", "unitSellCents", "sell_cents", "sellCents"]);
    if (v === undefined) fail("bad_price", `Line item "${id}" has no unit sell price in cents.`);
    if (typeof v !== "number" || !Number.isSafeInteger(v)) {
      fail("bad_price", `Line item "${id}" unit sell must be integer cents, got ${String(v)}.`);
    }
    return v;
  }

  function currencyOf(item) {
    const v = field(item, ["currency"]);
    return v === undefined || v === null || v === "" ? null : M.normalizeCurrency(v);
  }

  function groupOf(item) {
    const v = field(item, ["option_group_id", "optionGroupId", "option_group", "optionGroup"]);
    return v === undefined || v === null || v === "" ? null : String(v);
  }

  function isOptional(item) {
    return item.optional === true || groupOf(item) !== null;
  }

  // Exact line amount: unit sell × quantity.
  function lineAmount(item, index) {
    const id = idOf(item, index || 0);
    return M.lineTotal(unitSellOf(item, id), quantityOf(item, id));
  }

  function normalizeSelection(selection) {
    const map = new Map();
    if (selection === undefined || selection === null) return { map, complete: false };
    if (selection instanceof Map) {
      selection.forEach((v, k) => map.set(String(k), v === true));
      return { map, complete: false };
    }
    if (Array.isArray(selection)) {
      selection.forEach(k => map.set(String(k), true));
      return { map, complete: true };
    }
    if (typeof selection === "object") {
      Object.keys(selection).forEach(k => map.set(String(k), selection[k] === true));
      return { map, complete: false };
    }
    fail("bad_selection", `Selection must be a map, object or array of line ids, got ${typeof selection}.`);
  }

  function normalizeGroup(item) {
    const v = field(item, ["selection_type", "selectionType", "type", "mode"]);
    if (v === undefined) return "multi";
    const norm = String(v);
    if (GROUP_TYPES.indexOf(norm) === -1) {
      fail("bad_group", `Option group "${item.id}" has selection type "${norm}"; expected one of ${GROUP_TYPES.join(", ")}.`);
    }
    return norm;
  }

  // Resolve a client selection into a per-line boolean, honouring:
  //   - required lines (non-optional) are always selected;
  //   - optional lines default to `selected_by_default`;
  //   - a complete selection (array of ids / selected_ids) turns off any
  //     optional line not named;
  //   - a single-select option group keeps at most ONE line selected (an
  //     explicit choice wins over the default; ties resolve in sort order).
  function resolveSelection(lineItems, selection, optionGroups) {
    const items = lineItems || [];
    const norm = normalizeSelection(selection);
    const resolved = new Map();
    const meta = [];
    items.forEach((item, index) => {
      const id = idOf(item, index);
      const optional = isOptional(item);
      let selected;
      if (!optional) {
        selected = true;
      } else if (norm.map.has(id)) {
        selected = norm.map.get(id) === true;
      } else if (norm.complete) {
        selected = false;
      } else if (item.selected !== undefined && item.selected !== null) {
        selected = item.selected === true;
      } else {
        selected = item.selected_by_default === true;
      }
      resolved.set(id, selected);
      meta.push({ id, item, optional, group: groupOf(item) });
    });

    const groupTypes = new Map();
    (optionGroups || []).forEach(g => {
      const gid = field(g, ["id", "group_id", "groupId"]);
      if (gid !== undefined && gid !== null) groupTypes.set(String(gid), normalizeGroup(g));
    });

    const byGroup = new Map();
    meta.forEach(m => {
      if (m.group === null) return;
      if (!byGroup.has(m.group)) byGroup.set(m.group, []);
      byGroup.get(m.group).push(m);
    });

    const repairs = [];
    byGroup.forEach((members, gid) => {
      const type = groupTypes.has(gid) ? groupTypes.get(gid) : "multi";
      if (!EXCLUSIVE_GROUP_TYPES[type]) return;
      const trueMembers = members.filter(m => resolved.get(m.id) === true);
      if (trueMembers.length <= 1) return;
      const explicit = trueMembers.filter(m => norm.map.get(m.id) === true);
      let keeper;
      if (explicit.length) keeper = explicit[0];
      else {
        const byDefault = trueMembers.filter(m => m.item.selected_by_default === true);
        keeper = byDefault.length ? byDefault[0] : trueMembers[0];
      }
      const dropped = trueMembers.filter(m => m !== keeper);
      dropped.forEach(m => resolved.set(m.id, false));
      repairs.push({ group: gid, kept: keeper.id, dropped: dropped.map(m => m.id) });
    });

    const lineIds = meta.map(m => m.id);
    const selectedIds = lineIds.filter(id => resolved.get(id) === true);
    return { map: resolved, lineIds, selectedIds, repairs, selectedCount: selectedIds.length };
  }

  function termOf(input) {
    const raw = field(input, ["term_months", "termMonths", "months"]);
    if (raw === undefined) return TERM_MONTHS;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      fail("bad_term", `term_months must be a non-negative integer, got ${String(raw)}.`);
    }
    return raw;
  }

  // The contract term declared ON a line, or null when the line inherits the
  // quote-level term (task 53's per-line contract-term math).
  function lineTermOf(item) {
    const raw = field(item, ["term_months", "termMonths", "months"]);
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      fail("bad_term", `term_months must be a non-negative integer, got ${String(raw)}.`);
    }
    return raw;
  }

  // The per-service deal value (task 53): a one-time line contributes its
  // amount; an MRR line contributes its amount over its own contract term. The
  // flat "one_time + term × mrr" formula is the special case where every MRR
  // line carries the same term — so the default-term result is unchanged.
  function lineDealValue(item, defaultTerm) {
    const id = idOf(item, 0);
    const kind = kindOf(item, id);
    const amount = lineAmount(item, 0);
    if (kind === "one_time") return amount;
    const lineTerm = lineTermOf(item);
    const term = lineTerm === null ? (defaultTerm === undefined ? TERM_MONTHS : defaultTerm) : lineTerm;
    return M.mulByInt(amount, term);
  }

  // The shared implementation. `computeTotals({ line_items, selection,
  // option_groups, term_months, currency })` → integer-cent totals + line
  // breakdown. Pure: the input is never mutated.
  function computeTotals(input) {
    input = input || {};
    const items = input.line_items || input.lineItems || [];
    if (!Array.isArray(items)) fail("bad_line_items", "line_items must be an array.");
    const months = termOf(input);

    let currency = input.currency !== undefined ? M.normalizeCurrency(input.currency) : null;
    items.forEach((item, index) => {
      const itemCurrency = currencyOf(item);
      if (itemCurrency) {
        if (currency === null) currency = itemCurrency;
        else M.assertSameCurrency(currency, itemCurrency);
      }
    });
    if (currency === null) currency = M.DEFAULT_CURRENCY;

    const selection = resolveSelection(items, input.selection !== undefined ? input.selection : (input.selected_ids || input.selectedIds), input.option_groups || input.optionGroups);

    let oneTime = 0;
    let mrr = 0;
    let dealValue = 0;
    const lines = [];
    const services = [];
    items.forEach((item, index) => {
      const id = idOf(item, index);
      const kind = kindOf(item, id);
      const quantity = quantityOf(item, id);
      const unit = unitSellOf(item, id);
      const amount = M.lineTotal(unit, quantity);
      const selected = selection.map.get(id) === true;
      const lineTerm = lineTermOf(item);
      const term = lineTerm === null ? months : lineTerm;
      // Per-service deal value: a one-time line contributes its amount; an MRR
      // line contributes its amount over the line's own term. Every default-term
      // line makes this identical to one_time + term × mrr (backward compatible).
      const dealLine = kind === "one_time" ? amount : M.mulByInt(amount, term);
      if (selected) {
        if (kind === "one_time") oneTime = M.add(oneTime, amount);
        else mrr = M.add(mrr, amount);
        dealValue = M.add(dealValue, dealLine);
      }
      const group = groupOf(item);
      lines.push({
        index,
        id,
        kind,
        quantity,
        unit_sell_cents: unit,
        amount_cents: amount,
        selected,
        optional: isOptional(item),
        option_group_id: group,
        term_months: term,
        deal_value_cents: dealLine,
        currency
      });
      services.push({
        id,
        kind,
        quantity,
        term_months: term,
        amount_cents: amount,
        deal_value_cents: dealLine,
        selected,
        option_group_id: group
      });
    });

    const annualMrr = M.mulByInt(mrr, 12);
    const twelveMonthValue = M.add(oneTime, annualMrr);

    return {
      engine: "QU_TOTALS",
      version: VERSION,
      currency,
      term_months: months,
      one_time_cents: oneTime,
      mrr_cents: mrr,
      annual_mrr_cents: annualMrr,
      twelve_month_value_cents: twelveMonthValue,
      deal_value_cents: dealValue,
      line_count: lines.length,
      selected_count: selection.selectedCount,
      lines,
      services,
      selection: { line_ids: selection.lineIds, selected_ids: selection.selectedIds, repairs: selection.repairs }
    };
  }

  // Compare the integer totals of two results — used to prove every surface
  // (builder preview, portal, approval record) computed the same thing.
  function sameTotals(a, b) {
    if (!a || !b) return false;
    return a.one_time_cents === b.one_time_cents &&
      a.mrr_cents === b.mrr_cents &&
      a.annual_mrr_cents === b.annual_mrr_cents &&
      a.twelve_month_value_cents === b.twelve_month_value_cents &&
      a.deal_value_cents === b.deal_value_cents &&
      a.currency === b.currency &&
      a.term_months === b.term_months &&
      a.selected_count === b.selected_count;
  }

  // Display strings for a totals result (builder preview / portal).
  function describeTotals(totals, opts) {
    if (!totals) return null;
    const o = Object.assign({ currency: totals.currency }, opts || {});
    return {
      one_time: M.format(totals.one_time_cents, o),
      mrr: M.format(totals.mrr_cents, o),
      annual_mrr: M.format(totals.annual_mrr_cents, o),
      twelve_month_value: M.format(totals.twelve_month_value_cents, o),
      deal_value: M.format(totals.deal_value_cents, o)
    };
  }

  window.QU_TOTALS = {
    VERSION,
    TERM_MONTHS,
    KINDS,
    GROUP_TYPES,
    DEPRECATED_GROUP_TYPES,
    EXCLUSIVE_GROUP_TYPES,
    TotalsError,
    lineAmount,
    lineTermOf,
    lineDealValue,
    isOptional,
    resolveSelection,
    computeTotals,
    sameTotals,
    describeTotals
  };
})();
