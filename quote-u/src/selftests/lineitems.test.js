(function () {
  const T = window.QU_SELFTEST;
  const LI = window.QU_LINEITEMS;
  const M = window.QU_MONEY;
  const TOT = window.QU_TOTALS;
  if (!T || !LI || !M || !TOT) return;

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  function codes(violations) {
    return violations.map(v => v.code).sort().join(",");
  }

  const SPEC_FIELDS = [
    "sort_order", "section", "kind", "description", "manufacturer_part_number", "sku",
    "quantity", "unit_cost_cents", "unit_sell_cents", "optional", "option_group_id",
    "selected_by_default", "catalog_ref", "price_snapshot_ref"
  ];

  T.register("line items: the model declares the full field set and refuses derived fields", () => {
    const bad = [];
    SPEC_FIELDS.forEach(f => { if (LI.MODEL_FIELD_NAMES.indexOf(f) === -1) bad.push("missing model field " + f); });
    if (LI.KINDS.join(",") !== "one_time,mrr") bad.push("kinds: " + LI.KINDS.join(","));
    if (LI.PRICING_MODES.join(",") !== "snapshot,manual") bad.push("pricing modes");
    for (const f of ["amount_cents", "margin_cents", "margin_bp", "markup_bp", "cost_total_cents"]) {
      if (LI.DERIVED_FIELDS.indexOf(f) === -1) bad.push("derived not declared: " + f);
    }
    const e1 = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, amount_cents: 100 }), "derived_field");
    if (e1) bad.push("amount_cents: " + e1);
    const e2 = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, margin_bp: 4000 }), "derived_field");
    if (e2) bad.push("margin_bp: " + e2);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: SPEC_FIELDS.length + " spec fields present; derived/authoritative fields refused" };
  });

  T.register("line items: normalize fills every default without mutating the input", () => {
    const input = { kind: "mrr", description: "Managed endpoint", unit_sell_cents: 4500 };
    const line = LI.normalize(input, { id: "li-1" });
    const bad = [];
    if (line.id !== "li-1") bad.push("id=" + line.id);
    if (line.quote_version_id !== null) bad.push("quote_version_id default");
    if (line.sort_order !== 0) bad.push("sort_order");
    if (line.section !== "") bad.push("section");
    if (line.manufacturer_part_number !== "" || line.sku !== "") bad.push("empty string defaults");
    if (line.quantity !== 1) bad.push("quantity");
    if (line.unit_cost_cents !== 0) bad.push("unit_cost");
    if (line.optional !== false || line.selected_by_default !== false) bad.push("boolean defaults");
    if (line.option_group_id !== null || line.catalog_ref !== null || line.price_snapshot_ref !== null) bad.push("null reference defaults");
    if (line.pricing_mode !== "manual") bad.push("pricing_mode default");
    if (line.currency !== "CAD") bad.push("currency=" + line.currency);
    if (input.quantity !== undefined || input.amount_cents !== undefined) bad.push("input was mutated");
    if (Object.prototype.hasOwnProperty.call(line, "amount_cents")) bad.push("derived stored on the record");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "all 18 model fields defaulted; input untouched; no derived value on the record" };
  });

  T.register("line items: a null snapshot is allowed only for manual pricing", () => {
    const bad = [];
    const manualWithRef = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, price_snapshot_ref: "snap-1", pricing_mode: "manual" }), "snapshot_not_manual");
    if (manualWithRef) bad.push("manual+ref: " + manualWithRef);
    const snapWithoutRef = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, pricing_mode: "snapshot" }), "snapshot_required");
    if (snapWithoutRef) bad.push("snapshot, no ref: " + snapWithoutRef);
    const snap = LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, price_snapshot_ref: "snap-1" });
    if (snap.pricing_mode !== "snapshot" || snap.price_snapshot_ref !== "snap-1") bad.push("snapshot mode not inferred");
    const manual = LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, pricing_mode: "manual" });
    if (manual.pricing_mode !== "manual" || manual.price_snapshot_ref !== null) bad.push("manual mode");
    if (!LI.isManual(manual) || LI.isManual(snap)) bad.push("isManual");
    const badMode = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, pricing_mode: "guess" }), "bad_pricing_mode");
    if (badMode) bad.push("bad mode: " + badMode);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "manual ⇔ no snapshot; snapshot ⇒ ref required; unknown mode refused" };
  });

  T.register("line items: malformed kinds, descriptions, quantities and prices are refused", () => {
    const bad = [];
    const base = { description: "x", unit_sell_cents: 100 };
    const e1 = throws(() => LI.normalize(Object.assign({ kind: "annual" }, base)), "bad_kind"); if (e1) bad.push("bad kind: " + e1);
    const e2 = throws(() => LI.normalize(base), "bad_kind"); if (e2) bad.push("missing kind: " + e2);
    const e3 = throws(() => LI.normalize({ kind: "one_time", unit_sell_cents: 100 }), "bad_description"); if (e3) bad.push("missing desc: " + e3);
    const e4 = throws(() => LI.normalize({ kind: "one_time", description: "  ", unit_sell_cents: 100 }), "bad_description"); if (e4) bad.push("blank desc: " + e4);
    const e5 = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, quantity: -1 }), "bad_quantity"); if (e5) bad.push("negative qty: " + e5);
    const e6 = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, quantity: 1.5 }), "bad_quantity"); if (e6) bad.push("fractional qty: " + e6);
    const e7 = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 1.5 }), "fractional_cents"); if (e7) bad.push("fractional price: " + e7);
    const e8 = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: "100" }), "bad_unit_sell_cents"); if (e8) bad.push("string price: " + e8);
    const e9 = throws(() => LI.normalize({ kind: "one_time", description: "x" }), "bad_price"); if (e9) bad.push("missing price: " + e9);
    const e10 = throws(() => LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100, unit_cost_cents: 0.5 }), "fractional_cents"); if (e10) bad.push("fractional cost: " + e10);
    const v = LI.validate({ kind: "annual", description: "", unit_sell_cents: 1.5, quantity: -2 });
    if (v.ok) bad.push("validate accepted an invalid line");
    if (codes(v.violations).indexOf("bad_kind") === -1 || codes(v.violations).indexOf("bad_description") === -1 || codes(v.violations).indexOf("bad_quantity") === -1 || codes(v.violations).indexOf("fractional_cents") === -1) {
      bad.push("violations: " + codes(v.violations));
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "10 malformed inputs refused; validate() reports every violation" };
  });

  T.register("line items: derive computes amount, cost, margin and rates exactly", () => {
    const line = LI.normalize({ kind: "one_time", description: "Switch", quantity: 3, unit_cost_cents: 6000, unit_sell_cents: 10000 }, { id: "li-d" });
    const d = LI.derive(line);
    const bad = [];
    if (d.amount_cents !== 30000) bad.push("amount=" + d.amount_cents);
    if (d.cost_total_cents !== 18000) bad.push("cost=" + d.cost_total_cents);
    if (d.unit_margin_cents !== 4000) bad.push("unit margin=" + d.unit_margin_cents);
    if (d.margin_cents !== 12000) bad.push("margin=" + d.margin_cents);
    if (d.margin_bp !== 4000) bad.push("margin_bp=" + d.margin_bp);
    if (d.markup_bp !== 6667) bad.push("markup_bp=" + d.markup_bp);
    if (Object.prototype.hasOwnProperty.call(line, "amount_cents")) bad.push("derive mutated the line");
    const zeroSell = LI.derive(LI.normalize({ kind: "one_time", description: "free", unit_sell_cents: 0, unit_cost_cents: 100 }));
    if (zeroSell.margin_bp !== null) bad.push("zero-sell margin_bp should be null");
    const zeroCost = LI.derive(LI.normalize({ kind: "one_time", description: "house", unit_sell_cents: 500, unit_cost_cents: 0 }));
    if (zeroCost.markup_bp !== null) bad.push("zero-cost markup_bp should be null");
    if (zeroCost.margin_bp !== 10000) bad.push("zero-cost margin_bp=" + zeroCost.margin_bp);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "amount/cost/margin/rates exact; 0-sell and 0-cost rates return null not NaN" };
  });

  T.register("line items: derived values agree with QU_TOTALS on the same lines", () => {
    const lines = [
      LI.normalize({ kind: "one_time", description: "Firewall", quantity: 2, unit_sell_cents: 125000, unit_cost_cents: 80000 }, { id: "li-1" }),
      LI.normalize({ kind: "mrr", description: "Support", quantity: 1, unit_sell_cents: 30000, unit_cost_cents: 12000, optional: true, selected_by_default: true }, { id: "li-2" })
    ];
    const totals = TOT.computeTotals({ line_items: lines.map(LI.toTotalsLine), selection: ["li-1", "li-2"] });
    const d = LI.deriveMany(lines);
    const bad = [];
    if (d[0].amount_cents !== 250000 || totals.lines[0].amount_cents !== 250000) bad.push("line 1 amount");
    if (d[1].amount_cents !== 30000 || totals.lines[1].amount_cents !== 30000) bad.push("line 2 amount");
    if (totals.one_time_cents !== 250000) bad.push("one_time=" + totals.one_time_cents);
    if (totals.mrr_cents !== 30000) bad.push("mrr=" + totals.mrr_cents);
    if (d[0].margin_bp !== M.marginBp(125000, 80000)) bad.push("margin rate disagreement");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "derive() amounts equal QU_TOTALS' line amounts; one field vocabulary shared" };
  });

  T.register("line items: audit proves no derived value or float reached storage", () => {
    const line = LI.normalize({ kind: "one_time", description: "Router", quantity: 2, unit_cost_cents: 5000, unit_sell_cents: 8000 }, { id: "li-a" });
    const bad = [];
    const clean = LI.audit([line]);
    if (!clean.ok) bad.push("clean line flagged: " + JSON.stringify(clean.violations));
    if (clean.derivedFields !== 0) bad.push("derivedFields=" + clean.derivedFields);
    if (clean.moneyFields < 2) bad.push("money fields not counted: " + clean.moneyFields);
    const withDerived = LI.audit([Object.assign({}, line, { amount_cents: 16000 })]);
    if (withDerived.ok || codes(withDerived.violations).indexOf("derived_field") === -1) bad.push("stored amount not caught");
    const withFloat = LI.audit([Object.assign({}, line, { unit_sell_cents: 80.5 })]);
    if (withFloat.ok) bad.push("stored float not caught");
    const e1 = throws(() => LI.assertStored([Object.assign({}, line, { margin_bp: 3750 })]), "stored_derived_field");
    if (e1) bad.push("assertStored derived: " + e1);
    const e2 = throws(() => LI.assertStored([Object.assign({}, line, { unit_sell_cents: 80.5 })]), "float_in_stored_money");
    if (e2) bad.push("assertStored float: " + e2);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "stored derived values and floats both refused; integers pass" };
  });

  T.register("line items: sortLines orders by sort_order then id without mutating", () => {
    const a = LI.normalize({ kind: "one_time", description: "A", unit_sell_cents: 1, sort_order: 2 }, { id: "li-b" });
    const b = LI.normalize({ kind: "one_time", description: "B", unit_sell_cents: 1, sort_order: 0 }, { id: "li-a" });
    const c = LI.normalize({ kind: "one_time", description: "C", unit_sell_cents: 1, sort_order: 2 }, { id: "li-a" });
    const input = [a, b, c];
    const out = LI.sortLines(input);
    const bad = [];
    if (out.map(x => x.id).join(",") !== "li-a,li-a,li-b") bad.push("order: " + out.map(x => x.id).join(","));
    if (input[0] !== a || input[1] !== b || input[2] !== c) bad.push("sort mutated/reordered the source array");
    const t = LI.toTotalsLine(a);
    if (t.id !== "li-b" || t.kind !== "one_time" || t.quantity !== 1 || t.unit_sell_cents !== 1 || t.selected_by_default !== false) bad.push("toTotalsLine: " + JSON.stringify(t));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "sort_order then id; source untouched; totals vocabulary lossless" };
  });
})();
