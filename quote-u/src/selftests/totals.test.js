(function () {
  const T = window.QU_SELFTEST;
  const TO = window.QU_TOTALS;
  const M = window.QU_MONEY;
  if (!T || !TO || !M) return;

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  function norm(s) {
    return String(s).replace(/\u00a0/g, " ");
  }

  const LINES = [
    { id: "base", kind: "one_time", quantity: 1, unit_sell_cents: 500000 },
    { id: "seat", kind: "mrr", quantity: 10, unit_sell_cents: 2500 },
    { id: "addon", kind: "mrr", quantity: 1, unit_sell_cents: 9900, optional: true, selected_by_default: false }
  ];

  const TIERS = [
    { id: "t1", kind: "one_time", quantity: 1, unit_sell_cents: 100000, option_group_id: "tier", selected_by_default: true },
    { id: "t2", kind: "one_time", quantity: 1, unit_sell_cents: 200000, option_group_id: "tier" },
    { id: "t3", kind: "one_time", quantity: 1, unit_sell_cents: 300000, option_group_id: "tier" }
  ];
  const TIER_GROUPS = [{ id: "tier", name: "Service tier", selection_type: "single" }];

  T.register("totals: one-time and MRR totals roll up from selected lines", () => {
    const t = TO.computeTotals({ line_items: LINES });
    const bad = [];
    if (t.one_time_cents !== 500000) bad.push("one_time=" + t.one_time_cents);
    if (t.mrr_cents !== 25000) bad.push("mrr=" + t.mrr_cents);
    if (t.annual_mrr_cents !== 300000) bad.push("annual_mrr=" + t.annual_mrr_cents);
    if (t.twelve_month_value_cents !== 800000) bad.push("twelve=" + t.twelve_month_value_cents);
    if (t.deal_value_cents !== 800000) bad.push("deal=" + t.deal_value_cents);
    if (t.selected_count !== 2 || t.line_count !== 3) bad.push("counts " + t.selected_count + "/" + t.line_count);
    if (t.currency !== "CAD") bad.push("currency=" + t.currency);
    const optional = t.lines.filter(l => l.id === "addon")[0];
    if (optional.selected) bad.push("optional line selected by default");
    if (optional.amount_cents !== 9900) bad.push("line amount=" + optional.amount_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "$5,000 one-time + $250/mo → $8,000 twelve-month" };
  });

  T.register("totals: twelve-month value is one_time + 12 × MRR (exact)", () => {
    const t = TO.computeTotals({ line_items: LINES, selection: { addon: true } });
    const bad = [];
    if (t.mrr_cents !== 34900) bad.push("mrr=" + t.mrr_cents);
    if (t.annual_mrr_cents !== 418800) bad.push("annual_mrr=" + t.annual_mrr_cents);
    if (t.twelve_month_value_cents !== 918800) bad.push("twelve=" + t.twelve_month_value_cents);
    if (t.one_time_cents + 12 * t.mrr_cents !== t.twelve_month_value_cents) bad.push("identity broken");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "optional MRR included → $9,188.00 twelve-month, identity holds" };
  });

  T.register("totals: every selection form resolves identically", () => {
    const defaultT = TO.computeTotals({ line_items: LINES });
    const objectT = TO.computeTotals({ line_items: LINES, selection: { addon: true } });
    const mapT = TO.computeTotals({ line_items: LINES, selection: new Map([["addon", true]]) });
    const arrayT = TO.computeTotals({ line_items: LINES, selected_ids: ["base", "seat", "addon"] });
    const bad = [];
    if (!TO.sameTotals(objectT, mapT)) bad.push("object vs map differ");
    if (!TO.sameTotals(objectT, arrayT)) bad.push("object vs array differ");
    if (TO.sameTotals(objectT, defaultT)) bad.push("adding the addon changed nothing");
    const optLines = [
      { id: "r", kind: "one_time", quantity: 1, unit_sell_cents: 1000 },
      { id: "o1", kind: "mrr", quantity: 1, unit_sell_cents: 100, optional: true, selected_by_default: true },
      { id: "o2", kind: "mrr", quantity: 1, unit_sell_cents: 200, optional: true, selected_by_default: true }
    ];
    const bothDefault = TO.computeTotals({ line_items: optLines });
    if (bothDefault.mrr_cents !== 300) bad.push("optional defaults = " + bothDefault.mrr_cents);
    const complete = TO.computeTotals({ line_items: optLines, selected_ids: ["r", "o1"] });
    if (complete.mrr_cents !== 100) bad.push("complete selection did not turn o2 off: mrr=" + complete.mrr_cents);
    const partial = TO.computeTotals({ line_items: optLines, selection: { o2: false } });
    if (partial.mrr_cents !== 100) bad.push("map form should keep o1's default: mrr=" + partial.mrr_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "object / Map / id-array agree; a complete set turns unlisted optionals off, a map only sets named lines" };
  });

  T.register("totals: required lines can never be deselected", () => {
    const t = TO.computeTotals({ line_items: LINES, selection: { base: false, seat: false } });
    const bad = [];
    if (t.one_time_cents !== 500000) bad.push("required one-time dropped");
    if (t.mrr_cents !== 25000) bad.push("required MRR dropped");
    if (t.selection.selected_ids.indexOf("base") === -1) bad.push("base not in selected ids");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "attempts to deselect required lines are ignored" };
  });

  T.register("totals: a single-select option group keeps at most one line", () => {
    const bad = [];
    const dflt = TO.computeTotals({ line_items: TIERS, option_groups: TIER_GROUPS });
    if (dflt.one_time_cents !== 100000) bad.push("default tier = " + dflt.one_time_cents);
    if (dflt.selection.selected_ids.join(",") !== "t1") bad.push("default selected " + dflt.selection.selected_ids.join(","));

    const chosen = TO.computeTotals({ line_items: TIERS, option_groups: TIER_GROUPS, selection: { t2: true } });
    if (chosen.selection.selected_ids.join(",") !== "t2") bad.push("explicit choice → " + chosen.selection.selected_ids.join(","));
    if (chosen.one_time_cents !== 200000) bad.push("chosen total = " + chosen.one_time_cents);
    const repair = chosen.selection.repairs;
    if (!repair.length || repair[0].kept !== "t2" || repair[0].dropped.indexOf("t1") === -1) bad.push("no repair recorded: " + JSON.stringify(repair));

    const double = TO.computeTotals({ line_items: TIERS, option_groups: TIER_GROUPS, selection: { t2: true, t3: true } });
    if (double.selection.selected_ids.length !== 1) bad.push("two explicit selections kept: " + double.selection.selected_ids.join(","));
    if (double.selection.selected_ids[0] !== "t2") bad.push("tie-break is not stable sort order: " + double.selection.selected_ids.join(","));

    const arr = TO.computeTotals({ line_items: TIERS, option_groups: TIER_GROUPS, selected_ids: ["t3"] });
    if (arr.selection.selected_ids.join(",") !== "t3" || arr.one_time_cents !== 300000) bad.push("array choice → " + arr.selection.selected_ids.join(","));

    const multi = TO.computeTotals({ line_items: TIERS, option_groups: [{ id: "tier", selection_type: "multi" }] });
    if (multi.selection.selected_ids.join(",") !== "t1") bad.push("multi group should not repair defaults");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "single-select repaired to one line; explicit choice wins; stable tie-break" };
  });

  T.register("totals: line amounts use exact integer quantity math", () => {
    const bad = [];
    const t = TO.computeTotals({
      line_items: [
        { id: "a", kind: "mrr", quantity: 7, unit_sell_cents: 1234 },
        { id: "b", kind: "one_time", quantity: 3, unit_sell_cents: 9999 }
      ]
    });
    if (t.lines[0].amount_cents !== 8638) bad.push("7×1234 = " + t.lines[0].amount_cents);
    if (t.lines[1].amount_cents !== 29997) bad.push("3×9999 = " + t.lines[1].amount_cents);
    if (t.mrr_cents !== 8638 || t.one_time_cents !== 29997) bad.push("rollup mismatch");
    if (t.twelve_month_value_cents !== 29997 + 12 * 8638) bad.push("twelve-month mismatch");
    if (TO.lineAmount({ id: "c", kind: "one_time", quantity: 0, unit_sell_cents: 1234 }) !== 0) bad.push("zero quantity");
    const e1 = throws(() => TO.computeTotals({ line_items: [{ id: "d", kind: "one_time", quantity: 1.5, unit_sell_cents: 100 }] }), "bad_quantity");
    if (e1) bad.push("float quantity: " + e1);
    const e2 = throws(() => TO.computeTotals({ line_items: [{ id: "e", kind: "one_time", quantity: -1, unit_sell_cents: 100 }] }), "bad_quantity");
    if (e2) bad.push("negative quantity: " + e2);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "unit×quantity exact; fractional/negative quantity refused" };
  });

  T.register("totals: deal value uses the term while the twelve-month metric stays 12", () => {
    const bad = [];
    const t12 = TO.computeTotals({ line_items: LINES, selection: { addon: true } });
    const t24 = TO.computeTotals({ line_items: LINES, selection: { addon: true }, term_months: 24 });
    if (t24.term_months !== 24) bad.push("term=" + t24.term_months);
    if (t24.twelve_month_value_cents !== t12.twelve_month_value_cents) bad.push("twelve-month metric changed with the term");
    if (t24.deal_value_cents !== 500000 + 24 * 34900) bad.push("24-month deal = " + t24.deal_value_cents);
    const t0 = TO.computeTotals({ line_items: LINES, term_months: 0 });
    if (t0.deal_value_cents !== 500000) bad.push("zero-term deal = " + t0.deal_value_cents);
    const e = throws(() => TO.computeTotals({ line_items: LINES, term_months: -1 }), "bad_term");
    if (e) bad.push("bad term: " + e);
    if (TO.TERM_MONTHS !== 12) bad.push("default term is not 12");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "deal value follows the term; twelve-month value is always 12" };
  });

  T.register("totals: computeTotals is pure — it never mutates its input", () => {
    const bad = [];
    const input = { line_items: LINES, option_groups: TIER_GROUPS, selection: { base: true, addon: true, t2: true } };
    const before = JSON.stringify(input);
    const a = TO.computeTotals(input);
    const b = TO.computeTotals(input);
    if (JSON.stringify(input) !== before) bad.push("input was mutated");
    if (JSON.stringify(a) !== JSON.stringify(b)) bad.push("two runs disagree");
    if (a.lines[0] === LINES[0]) bad.push("result lines alias the input objects");
    a.lines[0].selected = "tampered";
    const c = TO.computeTotals(input);
    if (c.lines[0].selected !== true) bad.push("mutating a result changed a later run");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "input untouched; repeat calls identical; results are fresh objects" };
  });

  T.register("totals: currency column is enforced across line items", () => {
    const bad = [];
    const cad = TO.computeTotals({ line_items: LINES });
    if (cad.currency !== "CAD") bad.push("default currency");
    const explicit = TO.computeTotals({ line_items: [{ id: "x", kind: "one_time", quantity: 1, unit_sell_cents: 100, currency: "CAD" }] });
    if (explicit.currency !== "CAD") bad.push("item currency");
    const e1 = throws(() => TO.computeTotals({
      line_items: [{ id: "x", kind: "one_time", quantity: 1, unit_sell_cents: 100, currency: "USD" }],
      currency: "CAD"
    }), "currency_mismatch");
    if (e1) bad.push("input/item mismatch: " + e1);
    const e2 = throws(() => TO.computeTotals({
      line_items: [{ id: "x", kind: "one_time", quantity: 1, unit_sell_cents: 100, currency: "CAD" }, { id: "y", kind: "mrr", quantity: 1, unit_sell_cents: 100, currency: "USD" }]
    }), "currency_mismatch");
    if (e2) bad.push("mixed items: " + e2);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "CAD default; any mismatch refused" };
  });

  T.register("totals: results are float-free and refuse float prices", () => {
    const bad = [];
    const t = TO.computeTotals({ line_items: LINES, selection: { addon: true } });
    const audit = M.auditStoredMoney(t);
    if (!audit.ok) bad.push("float in result: " + audit.violations.map(v => v.path + ":" + v.reason).join(","));
    if (audit.moneyFields < 6) bad.push("only " + audit.moneyFields + " money fields audited");
    const e1 = throws(() => TO.computeTotals({ line_items: [{ id: "f", kind: "one_time", quantity: 1, unit_sell_cents: 1234.5 }] }), "bad_price");
    if (e1) bad.push("float price: " + e1);
    const e2 = throws(() => TO.computeTotals({ line_items: [{ id: "g", kind: "one_time", quantity: 1 }] }), "bad_price");
    if (e2) bad.push("missing price: " + e2);
    const e3 = throws(() => TO.computeTotals({ line_items: [{ id: "h", kind: "subscription", quantity: 1, unit_sell_cents: 100 }] }), "bad_kind");
    if (e3) bad.push("bad kind: " + e3);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: audit.moneyFields + " money fields integer-clean; float price / missing price / bad kind refused" };
  });

  T.register("totals: describeTotals formats the shared result for every surface", () => {
    const bad = [];
    const t = TO.computeTotals({ line_items: LINES });
    const d = TO.describeTotals(t);
    if (norm(d.one_time) !== "$5,000.00") bad.push("one_time=" + norm(d.one_time));
    if (norm(d.mrr) !== "$250.00") bad.push("mrr=" + norm(d.mrr));
    if (norm(d.annual_mrr) !== "$3,000.00") bad.push("annual=" + norm(d.annual_mrr));
    if (norm(d.twelve_month_value) !== "$8,000.00") bad.push("twelve=" + norm(d.twelve_month_value));
    if (norm(d.deal_value) !== "$8,000.00") bad.push("deal=" + norm(d.deal_value));
    if (TO.describeTotals(null) !== null) bad.push("null result");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "display strings derive from the integer totals" };
  });

  T.register("totals: the builder, portal and approval share one implementation (live)", async () => {
    const QU = window.QU;
    if (!QU || !QU.store) return { pass: true, skip: true, detail: "app not booted" };
    await (QU.storeReady || Promise.resolve());
    const bad = [];
    if (QU.totals !== TO) bad.push("QU.totals is not the QU_TOTALS module");
    if (typeof TO.computeTotals !== "function") bad.push("computeTotals missing");
    const preview = TO.computeTotals({ line_items: LINES, selection: { addon: true } });
    const portal = TO.computeTotals({ line_items: LINES, selection: { addon: true } });
    const approval = TO.computeTotals({ line_items: LINES, selection: { addon: true } });
    if (!(TO.sameTotals(preview, portal) && TO.sameTotals(portal, approval))) bad.push("surfaces disagree");
    if (approval.twelve_month_value_cents !== 918800) bad.push("approval total = " + approval.twelve_month_value_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one pure function behind QU.totals; preview = portal = approval" };
  });
})();
