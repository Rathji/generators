// ============================================================================
// quote-u — line-item model (roadmap task 10)
// ----------------------------------------------------------------------------
// The canonical shape of a line item, its validation, and its DERIVED values.
// A line item belongs to a quote version, sits in a section at a sort order,
// and is either one-time or MRR. Its price is either bound to an immutable
// price_snapshot (build-time pricing) or priced manually — and a manual line is
// the ONLY case in which the snapshot reference is null.
//
// Two hard rules, enforced here:
//   * Money is integer cents (delegated to QU_MONEY).
//   * NO authoritative totals and NO margin are ever stored on a line. The
//     amount, the line cost, the margin and the margin/markup rates are DERIVED
//     on demand from unit prices × quantity — `derive()` computes them and
//     `audit()` proves a stored record carries none of them.
// The module is pure: no clock, no randomness, no storage, no network.
// ============================================================================
window.QU_LINEITEMS = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u line-item model requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const KINDS = ["one_time", "mrr"];
  const PRICING_MODES = ["snapshot", "manual"];

  // The model, in display order. `required` fields must be supplied (or have a
  // default); `derived` fields must NEVER appear on a stored line.
  const FIELDS = [
    { name: "id", required: false, generated: true, note: "stable line-item id" },
    { name: "quote_version_id", required: false, default: null, note: "owning quote version (set at bind time)" },
    { name: "sort_order", required: false, default: 0, note: "integer display order within the section" },
    { name: "section", required: false, default: "", note: "display grouping (e.g. \"Hardware\")" },
    { name: "kind", required: true, note: "one_time | mrr" },
    { name: "description", required: true, note: "what the customer sees" },
    { name: "manufacturer_part_number", required: false, default: "", note: "MPN" },
    { name: "sku", required: false, default: "", note: "seller/internal SKU" },
    { name: "quantity", required: false, default: 1, note: "non-negative integer" },
    { name: "unit_cost_cents", required: false, default: 0, note: "integer cents; never shown to the client" },
    { name: "unit_sell_cents", required: true, note: "integer cents" },
    { name: "optional", required: false, default: false, note: "true = client may toggle it" },
    { name: "option_group_id", required: false, default: null, note: "option-group reference" },
    { name: "selected_by_default", required: false, default: false, note: "initial selection for an optional line" },
    { name: "term_months", required: false, default: null, note: "per-line contract term in months (null = inherit the quote term; task 53)" },
    { name: "catalog_ref", required: false, default: null, note: "optional catalog-item reference" },
    { name: "price_snapshot_ref", required: false, default: null, note: "immutable snapshot ref; null only when manual" },
    { name: "pricing_mode", required: false, default: "manual", note: "snapshot | manual" },
    { name: "currency", required: false, default: M.DEFAULT_CURRENCY, note: "reserved currency column (v1: CAD)" }
  ];

  // Never stored: totals, cost totals, margin or rates. Computed by derive().
  const DERIVED_FIELDS = [
    "amount_cents", "line_total_cents", "cost_total_cents", "cost_cents", "total_cents",
    "unit_margin_cents", "margin_cents", "margin_bp", "markup_bp", "margin", "markup"
  ];

  class LineItemError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "LineItemError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) {
    throw new LineItemError(code, message, meta);
  }

  function genId(rand) {
    return "li-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function asString(value, name, violations) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string` });
      return "";
    }
    return value;
  }

  function asNullableString(value, name, violations) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string or null` });
      return null;
    }
    return value;
  }

  function asBoolean(value, name, def, violations) {
    if (value === undefined || value === null) return def;
    if (typeof value !== "boolean") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be true or false` });
      return def;
    }
    return value;
  }

  function asInt(value, name, def, violations) {
    if (value === undefined || value === null) return def;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be an integer` });
      return def;
    }
    return value;
  }

  // Integer cents: non-integer numbers are reported as fractional, everything
  // else as not-an-integer — the same distinction QU_MONEY makes.
  function asCents(value, name, def, violations) {
    if (value === undefined || value === null) return def;
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      if (violations) violations.push({ field: name, code: "fractional_cents", detail: `${name} must be integer cents, got ${value}` });
      return def;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be integer cents` });
      return def;
    }
    return value;
  }

  // A nullable non-negative integer (contract term). null means "inherit the
  // quote-level term" (task 53's per-line contract-term math).
  function asNullableTerm(value, name, violations) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a non-negative integer or null` });
      return null;
    }
    return value;
  }

  function collect(input, opts) {
    opts = opts || {};
    const violations = [];
    if (!isPlainObject(input)) {
      return { violations: [{ field: null, code: "bad_line_item", detail: "A line item must be an object" }], record: null };
    }

    // Refuse anything that would store a derived/authoritative value.
    for (const f of DERIVED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, f)) {
        violations.push({ field: f, code: "derived_field", detail: `${f} is derived and must never be stored on a line item` });
      }
    }

    let id = input.id;
    if (id === undefined || id === null || id === "") id = opts.id || genId(opts.rand);
    else if (typeof id !== "string") {
      violations.push({ field: "id", code: "bad_id", detail: "id must be a string" });
      id = String(id);
    }

    const kindRaw = input.kind;
    let kind = kindRaw === undefined || kindRaw === null ? null : String(kindRaw);
    if (kind === null) {
      violations.push({ field: "kind", code: "bad_kind", detail: `kind is required (${KINDS.join(" | ")})` });
      kind = opts.kind || "one_time";
    } else if (KINDS.indexOf(kind) === -1) {
      violations.push({ field: "kind", code: "bad_kind", detail: `kind "${kind}" is not one of ${KINDS.join(" | ")}` });
    }

    const description = asString(input.description, "description", violations);
    if (!description.trim()) {
      violations.push({ field: "description", code: "bad_description", detail: "description is required" });
    }

    let pricingMode = input.pricing_mode;
    if (pricingMode !== undefined && pricingMode !== null) pricingMode = String(pricingMode);
    else pricingMode = input.price_snapshot_ref === undefined || input.price_snapshot_ref === null ? "manual" : "snapshot";
    if (PRICING_MODES.indexOf(pricingMode) === -1) {
      violations.push({ field: "pricing_mode", code: "bad_pricing_mode", detail: `pricing_mode "${pricingMode}" is not one of ${PRICING_MODES.join(" | ")}` });
      pricingMode = "manual";
    }

    const priceSnapshotRef = asNullableString(input.price_snapshot_ref, "price_snapshot_ref", violations);
    if (pricingMode === "snapshot" && !priceSnapshotRef) {
      violations.push({ field: "price_snapshot_ref", code: "snapshot_required", detail: "a snapshot-priced line must reference its price_snapshot" });
    }
    if (pricingMode === "manual" && priceSnapshotRef) {
      violations.push({ field: "price_snapshot_ref", code: "snapshot_not_manual", detail: "price_snapshot_ref must be null when pricing_mode is manual" });
    }

    let currency = input.currency === undefined || input.currency === null || input.currency === "" ? M.DEFAULT_CURRENCY : input.currency;
    try {
      currency = M.normalizeCurrency(currency);
    } catch (e) {
      violations.push({ field: "currency", code: "bad_currency", detail: (e && e.message) || String(e) });
      currency = M.DEFAULT_CURRENCY;
    }

    const record = {};
    record.id = id;
    record.quote_version_id = asNullableString(input.quote_version_id, "quote_version_id", violations);
    record.sort_order = asInt(input.sort_order, "sort_order", 0, violations);
    record.section = asString(input.section, "section", violations);
    record.kind = kind;
    record.description = description;
    record.manufacturer_part_number = asString(input.manufacturer_part_number, "manufacturer_part_number", violations);
    record.sku = asString(input.sku, "sku", violations);
    record.quantity = asInt(input.quantity, "quantity", 1, violations);
    if (record.quantity < 0) {
      violations.push({ field: "quantity", code: "bad_quantity", detail: "quantity must be a non-negative integer" });
      record.quantity = 0;
    }
    record.unit_cost_cents = asCents(input.unit_cost_cents, "unit_cost_cents", 0, violations);
    record.unit_sell_cents = asCents(input.unit_sell_cents, "unit_sell_cents", undefined, violations);
    if (record.unit_sell_cents === undefined) {
      violations.push({ field: "unit_sell_cents", code: "bad_price", detail: "unit_sell_cents is required" });
      record.unit_sell_cents = 0;
    }
    record.optional = asBoolean(input.optional, "optional", false, violations);
    record.option_group_id = asNullableString(input.option_group_id, "option_group_id", violations);
    record.selected_by_default = asBoolean(input.selected_by_default, "selected_by_default", false, violations);
    record.term_months = asNullableTerm(input.term_months, "term_months", violations);
    record.catalog_ref = asNullableString(input.catalog_ref, "catalog_ref", violations);
    record.price_snapshot_ref = priceSnapshotRef;
    record.pricing_mode = pricingMode;
    record.currency = currency;

    // Carry through any unknown (non-model, non-derived) fields unchanged.
    Object.keys(input).forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(record, k) && DERIVED_FIELDS.indexOf(k) === -1) record[k] = input[k];
    });

    return { violations, record };
  }

  // Non-throwing validation. `validate(input)` → { ok, violations, record }.
  function validate(input, opts) {
    const out = collect(input, opts);
    return { ok: out.violations.length === 0, violations: out.violations, record: out.record };
  }

  // Pure, throwing normalisation. Fills every default and returns a NEW record;
  // an invalid input throws LineItemError carrying the first violation's code.
  function normalize(input, opts) {
    const out = collect(input, opts);
    if (out.violations.length) {
      const v = out.violations[0];
      fail(v.code, v.detail, { violations: out.violations });
    }
    return out.record;
  }

  function isManual(line) {
    return (line && line.pricing_mode) === "manual";
  }

  // ---- derived values (never stored) ---------------------------------------
  // amount        = unit_sell × quantity
  // cost total    = unit_cost × quantity        (internal only, never portal)
  // unit margin   = unit_sell − unit_cost
  // margin        = amount − cost total
  // margin_bp     = margin / sell (null when sell = 0)
  // markup_bp     = margin / cost (null when cost = 0)
  function derive(line) {
    const sell = line.unit_sell_cents;
    const cost = line.unit_cost_cents;
    const quantity = line.quantity;
    const amount = M.lineTotal(sell, quantity);
    const costTotal = M.lineTotal(cost, quantity);
    return {
      amount_cents: amount,
      cost_total_cents: costTotal,
      unit_margin_cents: M.marginCents(sell, cost),
      margin_cents: M.sub(amount, costTotal),
      margin_bp: M.marginBp(sell, cost),
      markup_bp: M.markupBp(cost, sell)
    };
  }

  function deriveMany(lines) {
    return (lines || []).map(line => Object.assign({ id: line.id, kind: line.kind, selected_by_default: line.selected_by_default === true }, derive(line)));
  }

  // Stable ordering: sort_order, then id.
  function sortLines(lines) {
    return (lines || []).slice().sort((a, b) => {
      const sa = a.sort_order === undefined ? 0 : a.sort_order;
      const sb = b.sort_order === undefined ? 0 : b.sort_order;
      if (sa !== sb) return sa - sb;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  // The subset of fields QU_TOTALS reads — the two engines share one field
  // vocabulary, so binding a line item into a totals input is lossless.
  function toTotalsLine(line) {
    return {
      id: line.id,
      kind: line.kind,
      quantity: line.quantity,
      unit_sell_cents: line.unit_sell_cents,
      optional: line.optional === true,
      option_group_id: line.option_group_id || null,
      selected_by_default: line.selected_by_default === true,
      term_months: line.term_months === undefined ? null : line.term_months,
      currency: line.currency
    };
  }

  // The effective per-line contract term: the line's own term, else the quote
  // default. Pure — used by the totals engine and the bundle roll-up.
  function termOf(line, defaultTerm) {
    const t = line && line.term_months;
    if (typeof t === "number" && Number.isInteger(t) && t >= 0) return t;
    return typeof defaultTerm === "number" && Number.isInteger(defaultTerm) ? defaultTerm : 12;
  }

  // Prove a stored record (or list) carries no derived/authoritative value and
  // only integer cents in its money fields.
  function audit(lines) {
    const list = Array.isArray(lines) ? lines : [lines];
    const violations = [];
    let derivedFields = 0;
    let moneyFields = 0;
    list.forEach((line, i) => {
      if (!isPlainObject(line)) {
        violations.push({ index: i, field: null, code: "bad_line_item", detail: "not an object" });
        return;
      }
      for (const f of DERIVED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(line, f)) {
          derivedFields++;
          violations.push({ index: i, field: f, code: "derived_field", detail: `${line.id || "#" + i} stores derived field ${f}` });
        }
      }
      const money = M.auditStoredMoney(line, { ignoreKeys: ["raw", "rawPayload", "rawResponse", "raw_response", "raw_payload", "price_snapshot_ref", "catalog_ref"] });
      moneyFields += money.moneyFields;
      money.violations.forEach(v => violations.push({ index: i, field: v.path, code: v.reason, detail: v.reason + " at " + v.path }));
    });
    return { ok: violations.length === 0, violations, derivedFields, moneyFields };
  }

  function assertStored(lines) {
    const out = audit(lines);
    if (!out.ok) {
      const v = out.violations[0];
      fail(v.code === "derived_field" ? "stored_derived_field" : "float_in_stored_money",
        `Line items must store neither derived values nor floats — ${out.violations.map(v => (v.field || v.code)).join(", ")}`,
        { violations: out.violations });
    }
    return lines;
  }

  return {
    VERSION,
    KINDS,
    PRICING_MODES,
    FIELDS,
    MODEL_FIELD_NAMES: FIELDS.map(f => f.name),
    DERIVED_FIELDS,
    LineItemError,
    genId,
    validate,
    normalize,
    isManual,
    derive,
    deriveMany,
    sortLines,
    toTotalsLine,
    termOf,
    audit,
    assertStored
  };
})();
