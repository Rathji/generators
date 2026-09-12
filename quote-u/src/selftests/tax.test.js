(function () {
  const T = window.QU_SELFTEST;
  const TAX = window.QU_TAX;
  const PV = window.QU_PORTALVIEW;
  const LI = window.QU_LINEITEMS;
  const M = window.QU_MONEY;
  if (!T || !TAX || !PV || !LI || !M) return;

  function lines() {
    return [
      LI.normalize({ kind: "one_time", description: "Firewall", quantity: 1, unit_sell_cents: 200000, unit_cost_cents: 120000 }, { id: "li-1" }),
      LI.normalize({ kind: "mrr", description: "Circuit", quantity: 1, unit_sell_cents: 250000, unit_cost_cents: 150000 }, { id: "li-2" })
    ];
  }

  T.register("tax: the policy normalizes defaults, overrides and junk, and labels the rate exactly", () => {
    const bad = [];
    const def = TAX.normalizePolicy(null);
    if (def.rate_bp !== 500 || def.label !== "GST" || def.show !== true) bad.push("defaults: " + JSON.stringify(def));
    if (def.disclaimer.indexOf("indicative") === -1) bad.push("default disclaimer is not explicit: " + def.disclaimer);

    const tuned = TAX.normalizePolicy({ gst_rate_bp: 1300, gst_label: "HST", show: false, disclaimer: "estimate only" });
    if (tuned.rate_bp !== 1300 || tuned.label !== "HST" || tuned.show !== false || tuned.disclaimer !== "estimate only") bad.push("overrides: " + JSON.stringify(tuned));

    const junk = TAX.normalizePolicy({ gst_rate_bp: -5 });
    if (junk.rate_bp !== 500) bad.push("negative rate not defaulted: " + junk.rate_bp);
    const frac = TAX.normalizePolicy({ gst_rate_bp: 12.5 });
    if (frac.rate_bp !== 500) bad.push("fractional bp not defaulted: " + frac.rate_bp);
    const huge = TAX.normalizePolicy({ gst_rate_bp: 9999999 });
    if (huge.rate_bp !== 500) bad.push("absurd rate not defaulted: " + huge.rate_bp);

    const cases = [[500, "5%"], [525, "5.25%"], [0, "0%"], [1300, "13%"], [1234, "12.34%"], [100, "1%"]];
    cases.forEach(([bp, want]) => {
      const got = TAX.percentLabel(bp);
      if (got !== want) bad.push("percentLabel(" + bp + ") = " + got + " (want " + want + ")");
    });
    if (TAX.lineLabel({ gst_rate_bp: 500, gst_label: "GST" }) !== "GST (indicative, 5%)") bad.push("lineLabel: " + TAX.lineLabel({ gst_rate_bp: 500 }));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "defaults to 5% GST; overrides accepted; junk falls back; percent labels render exactly (500→5%, 525→5.25%, 1234→12.34%)" };
  });

  T.register("tax: the estimate is derived from the shared totals via QU_MONEY.tax and is never authoritative", () => {
    const bad = [];
    const totals = window.QU_TOTALS.computeTotals({ line_items: lines() });
    const pol = TAX.normalizePolicy({ gst_rate_bp: 500, gst_label: "GST" });
    const s = TAX.summary(totals, pol);
    if (!s) return { pass: false, detail: "summary returned null" };
    if (s.one_time_cents !== M.tax(totals.one_time_cents, 500)) bad.push("one-time tax not from QU_MONEY.tax");
    if (s.twelve_month_value_cents !== M.tax(totals.twelve_month_value_cents, 500)) bad.push("12-month tax not from QU_MONEY.tax");
    if (s.one_time_cents !== 10000) bad.push("one-time indicative = " + s.one_time_cents + " (want 10000)");
    if (s.twelve_month_value_cents !== 160000) bad.push("12-month indicative = " + s.twelve_month_value_cents + " (want 160000)");
    if (s.indicative !== true) bad.push("summary is not flagged indicative");
    if (s.authoritative_system.indexOf("invoicing") === -1) bad.push("authoritative system not named: " + s.authoritative_system);
    if (s.disclaimer.indexOf("indicative") === -1 || s.disclaimer.indexOf("invoice") === -1) bad.push("disclaimer unclear: " + s.disclaimer);
    if (TAX.summary(null, pol) !== null) bad.push("null totals should give a null summary");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the indicative figures equal QU_MONEY.tax of the shared pre-tax totals; the DTO is flagged indicative and names the invoicing system as authoritative" };
  });

  T.register("tax: the client view carries the indicative line, renders it, and refuses to leak cost", () => {
    const bad = [];
    const dto = PV.serialize({ line_items: lines(), tax_policy: { gst_rate_bp: 500, gst_label: "GST" } });
    if (!dto.tax) return { pass: false, detail: "client view had no tax block" };
    if (dto.tax.line_label !== "GST (indicative, 5%)") bad.push("label: " + dto.tax.line_label);
    if (dto.tax.one_time_cents !== 10000) bad.push("view one-time tax: " + dto.tax.one_time_cents);
    if (PV.audit(dto).ok !== true) bad.push("view with tax failed the client-safety audit: " + JSON.stringify(PV.audit(dto).violations));
    const json = JSON.stringify(dto);
    ["cost", "margin", "markup", "unit_cost_cents"].forEach(k => { if (json.toLowerCase().indexOf(k) !== -1) bad.push("client view leaked " + k); });

    const html = PV.renderHtml(dto);
    if (html.indexOf("GST (indicative, 5%)") === -1) bad.push("renderHtml missing the indicative label");
    if (html.indexOf("invoicing/accounting system") === -1) bad.push("renderHtml missing the authoritative disclaimer");
    if (html.indexOf("12-month value (pre-tax)") === -1) bad.push("renderHtml does not mark totals pre-tax");
    const text = PV.toText(dto);
    if (text.indexOf("GST (indicative, 5%)") === -1) bad.push("toText missing the indicative label");
    if (text.indexOf("invoicing/accounting system") === -1) bad.push("toText missing the disclaimer");

    const off = PV.serialize({ line_items: lines(), tax_policy: { gst_rate_bp: 500, show: false } });
    if (off.tax !== null) bad.push("show:false still produced a tax block");
    const custom = PV.serialize({ line_items: lines(), tax_policy: { gst_rate_bp: 1300, gst_label: "HST" } });
    if (!custom.tax || custom.tax.line_label !== "HST (indicative, 13%)") bad.push("custom policy not honoured: " + JSON.stringify(custom.tax && custom.tax.line_label));
    if (custom.tax.one_time_cents !== 26000) bad.push("custom rate maths: " + custom.tax.one_time_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the client view carries an indicative GST block audited cost-free, renders the labelled line + disclaimer (pre-tax totals marked), honours a custom rate, and omits the line when show:false" };
  });
})();
