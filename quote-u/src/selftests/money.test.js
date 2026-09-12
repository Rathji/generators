(function () {
  const T = window.QU_SELFTEST;
  const M = window.QU_MONEY;
  if (!T || !M) return;

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (!(err instanceof M.MoneyError)) return "threw " + err.name + " instead of MoneyError";
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  T.register("money: money is always integer cents, never a float", () => {
    const bad = [];
    if (M.isCents(1500) !== true) bad.push("1500 rejected");
    if (M.isCents(15.5) !== false) bad.push("15.5 accepted");
    if (M.isCents(NaN) !== false) bad.push("NaN accepted");
    if (M.isCents(Infinity) !== false) bad.push("Infinity accepted");
    if (M.isCents("1500") !== false) bad.push("a string accepted");
    const e = throws(() => M.assertCents(15.5, "test"), "fractional_cents");
    if (e) bad.push("assertCents(15.5): " + e);
    const e2 = throws(() => M.assertCents(1e300), "not_integer_cents");
    if (e2) bad.push("assertCents(1e300): " + e2);
    if (M.assertCents(-42) !== -42) bad.push("assertCents is not identity for valid cents");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "integer cents in, integers out; every float refused" };
  });

  T.register("money: toCents canonicalises without rounding floats", () => {
    const checks = [];
    if (M.toCents(1500) !== 1500) checks.push("int");
    if (M.toCents("1500") !== 1500) checks.push("int string");
    if (M.toCents("15.00") !== 1500) checks.push("major string");
    if (M.toCents({ cents: 1500 }) !== 1500) checks.push("cents object");
    if (M.toCents({ dollars: "15.00" }) !== 1500) checks.push("dollars object");
    if (M.toCents(1500n) !== 1500) checks.push("bigint");
    if (M.centsFromParts(12, 34) !== 1234) checks.push("centsFromParts");
    const e1 = throws(() => M.toCents(15.5), "fractional_cents");
    if (e1) checks.push("15.5: " + e1);
    const e2 = throws(() => M.toCents(true), "not_integer_cents");
    if (e2) checks.push("true: " + e2);
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "int / string / bigint / objects all canonicalise to exact cents" };
  });

  T.register("money: parsing major amounts is exact string math (float would drift)", () => {
    const cases = [
      ["1.005", 101],
      ["2.675", 268],
      ["0.10", 10],
      ["15", 1500],
      ["15.00", 1500],
      ["1,234.56", 123456],
      ["$1,234.56", 123456],
      ["CAD 1,234.56", 123456],
      ["-1,000", -100000],
      ["(1,234.56)", -123456],
      ["1.234,56", 123456],
      ["12,50", 1250],
      ["  42.9  ", 4290],
      ["0", 0],
      ["0.005", 1],
      ["90071992547409.91", 9007199254740991]
    ];
    const bad = [];
    for (const [input, expected] of cases) {
      let got;
      try { got = M.parse(input); } catch (e) { bad.push(`${input} → threw ${e.code || e.message}`); continue; }
      if (got !== expected) bad.push(`${input} → ${got}, want ${expected}`);
    }
    const e1 = throws(() => M.parse("abc"));
    if (e1) bad.push("abc: " + e1);
    const e2 = throws(() => M.parse(""));
    if (e2) bad.push("empty: " + e2);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: cases.length + " amounts parsed exactly; garbage refused" };
  });

  T.register("money: add / sub / sum are exact and refuse fractions", () => {
    const bad = [];
    if (M.add(1500, 250) !== 1750) bad.push("add");
    if (M.sub(1500, 2000) !== -500) bad.push("sub");
    if (M.sum([100, 200, 300]) !== 600) bad.push("sum");
    if (M.sum([{ v: 100 }, { v: 250 }], r => r.v) !== 350) bad.push("sum selector");
    if (M.negate(500) !== -500) bad.push("negate");
    if (M.abs(-500) !== 500) bad.push("abs");
    if (M.sum([]) !== 0) bad.push("sum of empty");
    const e = throws(() => M.add(1.5, 2), "fractional_cents");
    if (e) bad.push("add(1.5): " + e);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "integer additions exact; fractional input refused" };
  });

  T.register("money: mulDiv / mulByInt round half-away-from-zero exactly", () => {
    const bad = [];
    if (M.mulByInt(1500, 3) !== 4500) bad.push("mulByInt");
    if (M.mulDiv(5, 1, 2) !== 3) bad.push("mulDiv +half");
    if (M.mulDiv(-5, 1, 2) !== -3) bad.push("mulDiv -half");
    if (M.mulDiv(123456, 500, 10000) !== 6173) bad.push("mulDiv 5% of 123456 = " + M.mulDiv(123456, 500, 10000));
    if (M.mulDiv(7, 1, 3) !== 2) bad.push("mulDiv 7/3");
    if (M.mulDiv(100, -3, 2) !== -150) bad.push("negative numerator");
    if (M.mulDiv(100, 3, -2) !== -150) bad.push("negative denominator");
    const e1 = throws(() => M.mulDiv(100, 10, 0), "divide_by_zero");
    if (e1) bad.push("div zero: " + e1);
    const e2 = throws(() => M.mulDiv(100, 1.5, 2), "bad_operand");
    if (e2) bad.push("float operand: " + e2);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "exact integer division with deterministic half-away rounding" };
  });

  T.register("money: basis-point rates are integers (10000 bp = 100%)", () => {
    const bad = [];
    if (M.applyBp(10000, 500) !== 500) bad.push("5% of 10000");
    if (M.applyBp(123456, 725) !== 8951) bad.push("7.25% = " + M.applyBp(123456, 725));
    if (M.bpOf(500, 1500) !== 3333) bad.push("bpOf 500/1500 = " + M.bpOf(500, 1500));
    if (M.bpOf(25, 100) !== 2500) bad.push("bpOf 25%");
    if (M.tax(10000, 500) !== 500) bad.push("indicative tax 5%");
    if (M.formatBp(5000) !== "50%") bad.push("formatBp 5000 = " + M.formatBp(5000));
    if (M.formatBp(3333) !== "33.33%") bad.push("formatBp 3333 = " + M.formatBp(3333));
    if (M.formatBp(725) !== "7.25%") bad.push("formatBp 725 = " + M.formatBp(725));
    const e = throws(() => M.applyBp(1000, 12.5), "bad_rate");
    if (e) bad.push("float bp: " + e);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "bp rates integer-only, conversions exact" };
  });

  T.register("money: allocate conserves the total exactly", () => {
    const bad = [];
    const a = M.allocate(100, [1, 1, 1]);
    if (JSON.stringify(a) !== JSON.stringify([34, 33, 33])) bad.push("thirds = " + JSON.stringify(a));
    const b = M.allocate(1000, [1, 2]);
    if (JSON.stringify(b) !== JSON.stringify([333, 667])) bad.push("1:2 = " + JSON.stringify(b));
    const c = M.allocate(-5, [1, 1]);
    if (JSON.stringify(c) !== JSON.stringify([-3, -2])) bad.push("negative = " + JSON.stringify(c));
    const d = M.allocate(999, [0, 5, 5]);
    if (d[0] !== 0 || M.sum(d) !== 999) bad.push("zero-weight = " + JSON.stringify(d));
    const e = throws(() => M.allocate(100, [0, 0]), "zero_weights");
    if (e) bad.push("zero weights: " + e);
    for (const [total, w] of [[1, [1, 1, 1]], [7, [2, 3, 4]], [-100, [3, 7]]]) {
      const parts = M.allocate(total, w);
      if (M.sum(parts) !== total) bad.push(`allocate(${total},${w}) sums to ${M.sum(parts)}`);
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "remainder cents distributed, parts always sum to the total" };
  });

  T.register("money: margin is derived from sell/cost cents, never a stored field", () => {
    const bad = [];
    if (M.MARGIN_IS_DERIVED !== true) bad.push("module does not declare derived margin");
    if (M.marginCents(1500, 1000) !== 500) bad.push("marginCents");
    if (M.marginBp(1500, 1000) !== 3333) bad.push("marginBp = " + M.marginBp(1500, 1000));
    if (M.markupBp(1000, 1500) !== 5000) bad.push("markupBp = " + M.markupBp(1000, 1500));
    if (M.marginBp(0, 100) !== null) bad.push("marginBp on zero sell should be null");
    if (M.markupBp(0, 100) !== null) bad.push("markupBp on zero cost should be null");
    const inputs = { sell: 1500, cost: 1000 };
    M.marginBp(inputs.sell, inputs.cost);
    if (inputs.sell !== 1500 || inputs.cost !== 1000) bad.push("margin helpers mutated their inputs");
    if (M.auditStoredMoney({ records: [{ id: "l1", unit_sell_cents: 1500, unit_cost_cents: 1000 }] }).moneyFields !== 2) {
      bad.push("sell/cost cents are not recognised as money fields");
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "margin/markup recomputed on demand; no margin field exists to store" };
  });

  T.register("money: formatting composes digits exactly (no float rounding)", () => {
    const bad = [];
    const norm = s => s.replace(/\u00a0/g, " ");
    if (norm(M.format(123456789)) !== "$1,234,567.89") bad.push("format = " + norm(M.format(123456789)));
    if (norm(M.format(-123456789)) !== "-$1,234,567.89") bad.push("negative = " + norm(M.format(-123456789)));
    if (norm(M.format(-123456789, { accounting: true })) !== "($1,234,567.89)") bad.push("accounting = " + norm(M.format(-123456789, { accounting: true })));
    if (norm(M.format(5)) !== "$0.05") bad.push("format(5) = " + norm(M.format(5)));
    if (M.format(123456789, { currency: false }) !== "1,234,567.89") bad.push("no currency = " + M.format(123456789, { currency: false }));
    if (norm(M.format(123456789, { grouping: false })) !== "$1234567.89") bad.push("no grouping = " + norm(M.format(123456789, { grouping: false })));
    if (M.format(9007199254740991, { currency: false }) !== "90,071,992,547,409.91") bad.push("max safe = " + M.format(9007199254740991, { currency: false }));
    if (M.majorString(1500) !== "15.00") bad.push("majorString(1500) = " + M.majorString(1500));
    if (M.majorString(-5) !== "-0.05") bad.push("majorString(-5) = " + M.majorString(-5));
    if (M.majorString(123456) !== "1234.56") bad.push("majorString(123456) = " + M.majorString(123456));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "locale formatting + exact major-string round-trip" };
  });

  T.register("money: currency column is reserved and enforced", () => {
    const bad = [];
    if (M.DEFAULT_CURRENCY !== "CAD") bad.push("default currency is not CAD");
    if (M.normalizeCurrency() !== "CAD") bad.push("empty currency should default to CAD");
    if (M.normalizeCurrency("cad") !== "CAD") bad.push("normalisation");
    if (M.minorUnits("CAD") !== 2) bad.push("CAD minor units");
    if (M.currencyInfo("CAD").enabled !== true) bad.push("CAD should be enabled in v1");
    if (M.sameCurrency("CAD", "CAD") !== true) bad.push("sameCurrency true");
    if (M.sameCurrency("CAD", "USD") !== false) bad.push("sameCurrency false");
    const e1 = throws(() => M.assertSameCurrency("CAD", "USD"), "currency_mismatch");
    if (e1) bad.push("mismatch: " + e1);
    const e2 = throws(() => M.normalizeCurrency("money"), "invalid_currency");
    if (e2) bad.push("invalid: " + e2);
    const e3 = throws(() => M.normalizeCurrency("XYZ"), "unknown_currency");
    if (e3) bad.push("unknown: " + e3);
    const m = M.money(1500, "CAD");
    if (m.cents !== 1500 || m.currency !== "CAD" || !Object.isFrozen(m)) bad.push("money() object");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "CAD default, registered domain, mismatch refused" };
  });

  T.register("money: overflow is refused, never silently lossy", () => {
    const bad = [];
    const max = Number.MAX_SAFE_INTEGER;
    const e1 = throws(() => M.add(max, 1), "out_of_range");
    if (e1) bad.push("add at ceiling: " + e1);
    const e2 = throws(() => M.mulByInt(max, 2), "out_of_range");
    if (e2) bad.push("mul overflow: " + e2);
    if (M.add(max - 1, 1) !== max) bad.push("add at ceiling-1");
    if (!equalsThrows(() => M.add(1e300, 1))) bad.push("unsafe input should be refused");
    function equalsThrows(fn) { try { fn(); return false; } catch (e) { return true; } }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "ceiling arithmetic throws out_of_range; exact at the boundary" };
  });

  T.register("money: auditStoredMoney proves no float reaches a stored field", () => {
    const bad = [];
    const clean = {
      records: [
        { id: "l1", unit_cost_cents: 1000, unit_sell_cents: 1500, quantity: 3, listPrice: 1500, raw: { price: 14.99 } },
        { id: "l2", unitCents: 0, one_time_total_cents: 4500, mrr_total_cents: 0, dealValueCents: 4500 }
      ],
      settings: { gst_rate_bp: 500, nextNumber: 2 }
    };
    const okAudit = M.auditStoredMoney(clean);
    if (!okAudit.ok) bad.push("clean document flagged: " + okAudit.violations.map(v => v.path).join(","));
    if (okAudit.moneyFields < 7) bad.push("only " + okAudit.moneyFields + " money fields recognised");
    if (M.assertStored(clean) !== clean) bad.push("assertStored did not return its input");

    const dirty = { records: [{ id: "l1", unit_sell_cents: 1500.5, listPrice: 12.99, amount_cents: "1234", unitCost: Number.MAX_SAFE_INTEGER + 2 }] };
    const badAudit = M.auditStoredMoney(dirty);
    if (badAudit.ok) bad.push("float / string / unsafe money fields were not flagged");
    const reasons = badAudit.violations.map(v => v.path + ":" + v.reason).sort().join(",");
    const paths = badAudit.violations.map(v => v.path);
    if (paths.indexOf("records[0].unit_sell_cents") === -1) bad.push("missed fractional unit_sell_cents");
    if (paths.indexOf("records[0].listPrice") === -1) bad.push("missed fractional listPrice");
    if (paths.indexOf("records[0].amount_cents") === -1) bad.push("missed string cents field");
    if (paths.indexOf("records[0].unitCost") === -1) bad.push("missed unsafe unitCost");
    const e = throws(() => M.assertStored(dirty), "float_in_stored_money");
    if (e) bad.push("assertStored: " + e);
    if (!M.isMoneyFieldName("unit_cost_cents") || !M.isMoneyFieldName("dealValue") || M.isMoneyFieldName("quantity") || M.isMoneyFieldName("gst_rate_bp")) {
      bad.push("field-name detection is wrong");
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") + (reasons ? " [" + reasons + "]" : "") } : { pass: true, detail: okAudit.moneyFields + " money fields audited clean; 4 violations caught" };
  });

  T.register("money: every stored quote-u document is float-free (live)", async () => {
    const QU = window.QU;
    if (!QU || !QU.store || !window.QU_STORE) return { pass: true, skip: true, detail: "no store attached" };
    await (QU.storeReady || Promise.resolve());
    const bad = [];
    let fields = 0;
    for (const module of window.QU_STORE.DEFAULT_MODULES) {
      const loaded = await QU.store.loadDoc(module).catch(() => null);
      if (!loaded || !loaded.ok) continue;
      const audit = M.auditStoredMoney(loaded.content);
      fields += audit.moneyFields;
      if (!audit.ok) bad.push(module + "→" + audit.violations.map(v => v.path).join(","));
    }
    if (bad.length) return { pass: false, detail: bad.join(" | ") };
    return { pass: true, detail: "all entity documents float-free (" + fields + " money fields scanned) in ns " + QU.store.ns };
  });
})();
