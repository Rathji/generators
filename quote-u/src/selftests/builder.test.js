(function () {
  const T = window.QU_SELFTEST;
  const B = window.QU_BUILDER;
  const LI = window.QU_LINEITEMS;
  const OG = window.QU_OPTIONGROUPS;
  const TOT = window.QU_TOTALS;
  if (!T || !B || !LI || !OG || !TOT) return;

  function line(overrides) {
    return LI.normalize(Object.assign({
      kind: "one_time",
      description: "line",
      unit_sell_cents: 5000
    }, overrides || {}));
  }

  T.register("builder: money and quantity parsing is exact integer cents", () => {
    const bad = [];
    const cases = [["1250", 125000], ["1250.00", 125000], ["$1,234.56", 123456], ["0.5", 50], ["0.05", 5], ["-12.30", -1230], [" 42 ", 4200]];
    cases.forEach(([input, expected]) => {
      if (B.moneyToCents(input) !== expected) bad.push(input + " → " + B.moneyToCents(input) + " (want " + expected + ")");
    });
    ["", "abc", "1.234", "1,2,3", "12.", ".5", null, undefined].forEach(input => {
      if (B.moneyToCents(input) !== null) bad.push("expected null for " + JSON.stringify(input));
    });
    if (B.centsToMoney(123456) !== "1234.56") bad.push("centsToMoney: " + B.centsToMoney(123456));
    if (B.centsToMoney(5) !== "0.05") bad.push("centsToMoney(5): " + B.centsToMoney(5));
    if (B.centsToMoney(-1230) !== "-12.30") bad.push("centsToMoney(-1230): " + B.centsToMoney(-1230));
    [0, 1, 99, 100, 123456, 999999].forEach(c => { if (B.moneyToCents(B.centsToMoney(c)) !== c) bad.push("round-trip failed for " + c); });
    if (B.parseQuantity("", 1) !== 1) bad.push("empty quantity default");
    if (B.parseQuantity("7") !== 7) bad.push("parse quantity");
    if (B.parseQuantity("1.5") !== null) bad.push("fractional quantity accepted");
    if (B.parseQuantity("-2") !== null) bad.push("negative quantity accepted");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "dollar↔cents is exact and locale-tolerant; fractional/negative quantities rejected" };
  });

  T.register("builder: the line form parses into a validated line-item input", () => {
    const bad = [];
    const good = B.lineFromForm({ kind: "mrr", description: "Support", quantity: "2", unit_sell_cents: "1250.00", section: "Services", manufacturer_part_number: "MPN-1" });
    if (!good.ok) bad.push("valid form refused: " + JSON.stringify(good.violations));
    else {
      if (good.input.kind !== "mrr") bad.push("kind");
      if (good.input.quantity !== 2) bad.push("quantity");
      if (good.input.unit_sell_cents !== 125000) bad.push("unit price cents: " + good.input.unit_sell_cents);
      if (good.input.unit_cost_cents !== 0) bad.push("cost default");
      if (good.input.optional !== false || good.input.option_group_id !== null) bad.push("optional defaults");
    }
    const noDesc = B.lineFromForm({ kind: "one_time", description: "  ", unit_sell_cents: "5" });
    if (noDesc.ok || noDesc.violations[0].code !== "bad_description") bad.push("blank description accepted");
    const noPrice = B.lineFromForm({ kind: "one_time", description: "x" });
    if (noPrice.ok || noPrice.violations[0].code !== "bad_unit_sell_cents") bad.push("missing price accepted");
    const badPrice = B.lineFromForm({ kind: "one_time", description: "x", unit_sell_cents: "1.234" });
    if (badPrice.ok || badPrice.violations[0].code !== "bad_unit_sell_cents") bad.push("bad price accepted");
    const badQty = B.lineFromForm({ kind: "one_time", description: "x", unit_sell_cents: "5", quantity: "1.5" });
    if (badQty.ok || badQty.violations[0].code !== "bad_quantity") bad.push("bad quantity accepted");
    const optNoGroup = B.lineFromForm({ kind: "one_time", description: "x", unit_sell_cents: "5", optional: true });
    if (optNoGroup.ok || optNoGroup.violations[0].code !== "group_required") bad.push("optional without group accepted");
    const plain = B.lineFromForm({ kind: "one_time", description: "x", unit_sell_cents: "5", option_group_id: "og-1" });
    if (!plain.ok || plain.input.option_group_id !== null) bad.push("a non-optional line must drop its group");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "valid forms produce a QU_LINEITEMS-validated input; blank description, missing/odd price, fraction quantity and a groupless optional are refused" };
  });

  T.register("builder: option-group forms, membership and ordering", () => {
    const bad = [];
    const g = B.groupFromForm({ name: "Internet speed", selection_type: "single", description: "Pick one" });
    if (!g.ok || g.input.selection_type !== "single") bad.push("valid group: " + JSON.stringify(g));
    const bundle = B.groupFromForm({ name: "Tier", selection_type: "bundle", description: "Pick one" });
    if (!bundle.ok || bundle.input.selection_type !== "bundle") bad.push("bundle group: " + JSON.stringify(bundle));
    const noName = B.groupFromForm({ name: " " });
    if (noName.ok || noName.violations[0].code !== "bad_group_name") bad.push("nameless group accepted");
    const badType = B.groupFromForm({ name: "x", selection_type: "exclusive" });
    if (badType.ok || badType.violations[0].code !== "bad_selection_type") bad.push("bad selection type accepted");

    const lines = [
      line({ id: "li-1", kind: "one_time", description: "A", unit_sell_cents: 100, optional: true, option_group_id: "og-1", sort_order: 2 }),
      line({ id: "li-2", kind: "one_time", description: "B", unit_sell_cents: 200, sort_order: 1 }),
      line({ id: "li-3", kind: "mrr", description: "C", unit_sell_cents: 300, optional: true, option_group_id: "og-1", sort_order: 0 })
    ];
    const members = B.groupMemberIds(lines, "og-1");
    if (members.length !== 2 || members.indexOf("li-1") === -1 || members.indexOf("li-3") === -1) bad.push("groupMemberIds: " + members.join(","));
    const oneTime = B.linesFor(lines, "one_time");
    if (oneTime.length !== 2 || oneTime[0].id !== "li-2" || oneTime[1].id !== "li-1") bad.push("one-time ordering: " + oneTime.map(l => l.id).join(","));
    const membersOnly = B.linesFor(lines, null, { groupId: "og-1" });
    if (membersOnly.length !== 2) bad.push("linesFor by group: " + membersOnly.length);
    if (B.linesFor(lines, null).length !== 3) bad.push("linesFor(null) should not filter by kind");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "group form validated; membership and stable kind/group ordering derived from the line records" };
  });

  T.register("builder: selection honours defaults and single-select groups", () => {
    const bad = [];
    const lines = [
      line({ id: "li-1", description: "Required", unit_sell_cents: 100 }),
      line({ id: "li-2", description: "Opt default", unit_sell_cents: 200, optional: true, option_group_id: "og-1", selected_by_default: true }),
      line({ id: "li-3", description: "Opt off", unit_sell_cents: 300, optional: true, option_group_id: "og-1", selected_by_default: false })
    ];
    const groups = [OG.normalize({ id: "og-1", name: "Speed", selection_type: "single" })];
    const sel = B.computeSelection(lines, {});
    if (sel["li-1"] !== true || sel["li-2"] !== true || sel["li-3"] !== false) bad.push("defaults: " + JSON.stringify(sel));
    const toggled = B.toggleSelected({}, lines[2], lines, groups);
    if (toggled["li-3"] !== true || toggled["li-2"] !== false) bad.push("single-select toggle did not clear the sibling: " + JSON.stringify(toggled));
    const off = B.toggleSelected({ "li-2": true }, lines[1], lines, groups);
    if (off["li-2"] !== false) bad.push("toggling a selected line off: " + JSON.stringify(off));
    const multiGroups = [OG.normalize({ id: "og-1", name: "Speed", selection_type: "multi" })];
    const multi = B.toggleSelected({}, lines[2], lines, multiGroups);
    if (multi["li-2"] !== undefined || multi["li-3"] !== true) bad.push("multi group must not clear siblings: " + JSON.stringify(multi));
    // the canonical `bundle` type is exclusive too, not just its deprecated `single` alias
    const bundleGroups = [OG.normalize({ id: "og-1", name: "Tier", selection_type: "bundle" })];
    const bundleToggle = B.toggleSelected({}, lines[2], lines, bundleGroups);
    if (bundleToggle["li-3"] !== true || bundleToggle["li-2"] !== false) bad.push("bundle toggle did not clear the sibling: " + JSON.stringify(bundleToggle));
    if (!B.isExclusiveGroup({ selection_type: "bundle" }) || !B.isExclusiveGroup({ selection_type: "single" }) || B.isExclusiveGroup({ selection_type: "multi" })) bad.push("isExclusiveGroup is wrong");
    if (B.groupTypeText("single") !== "bundle" || B.groupTypeText(undefined) !== "multi") bad.push("groupTypeText is wrong");
    const tot = TOT.computeTotals({ line_items: lines, option_groups: groups, selection: sel });
    if (tot.one_time_cents !== 300) bad.push("totals from selection: " + tot.one_time_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "required lines always on, optional lines follow defaults; a single-select toggle clears its siblings; totals follow" };
  });

  T.register("builder: summarize produces shared totals and a client-safe view", () => {
    const bad = [];
    const lines = [
      line({ id: "li-1", kind: "one_time", description: "Router", quantity: 2, unit_sell_cents: 15000, unit_cost_cents: 9000 }),
      line({ id: "li-2", kind: "mrr", description: "Support", unit_sell_cents: 5000 })
    ];
    const groups = [OG.normalize({ id: "og-1", name: "Add-ons", selection_type: "multi" })];
    const s = B.summarize({ quote: { quote_number: "Q-1", title: "Test" }, version: { version_number: 1, state: "draft" }, lines, groups, overrides: {} });
    if (!s.ok) return { pass: false, detail: JSON.stringify(s) };
    if (s.totals.one_time_cents !== 30000) bad.push("one-time: " + s.totals.one_time_cents);
    if (s.totals.mrr_cents !== 5000) bad.push("mrr: " + s.totals.mrr_cents);
    if (s.totals.twelve_month_value_cents !== 30000 + 60000) bad.push("12-month: " + s.totals.twelve_month_value_cents);
    if (!s.display.one_time || s.display.one_time.indexOf("300") === -1) bad.push("display: " + s.display.one_time);
    if (!s.view || s.view.kind !== "quote-portal-view") bad.push("no client view");
    else if (JSON.stringify(s.view).indexOf("cost") !== -1) bad.push("client view leaked a cost field");
    if (B.canEditVersion({ frozen_at: null })) { /* ok */ } else bad.push("unfrozen version reported locked");
    if (B.canEditVersion({ frozen_at: "2026-01-01T00:00:00.000Z" })) bad.push("frozen version reported editable");
    if (!B.freezeNotice({ frozen_at: "2026-01-01T00:00:00.000Z", frozen_by: "rep" })) bad.push("no freeze notice");
    if (B.freezeNotice({ frozen_at: null }) !== null) bad.push("freeze notice for an unfrozen version");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "summarize returns QU_TOTALS totals, display strings and a cost-free QU_PORTALVIEW DTO; freeze state drives editability" };
  });

  T.register("builder: the station renders (start screen) in the live DOM", async () => {
    if (typeof window.QU_BUILDER !== "object") return { pass: true, skip: true, detail: "builder module not loaded" };
    const wrap = window.QU_RENDERERS && window.QU_RENDERERS.builder ? window.QU_RENDERERS.builder({ params: [], moduleList: [], env: {} }) : null;
    if (!wrap || wrap.className.indexOf("bd-view") === -1) return { pass: false, detail: "renderer did not return a .bd-view element" };
    for (let i = 0; i < 30; i++) {
      if (wrap.querySelector(".bd-start") || wrap.querySelector(".state")) break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (!wrap.querySelector(".bd-start") && !wrap.querySelector(".state")) return { pass: false, detail: "start screen never settled" };
    if (!wrap.querySelector("form.frm")) return { pass: false, detail: "the new-quote form is missing" };
    return { pass: true, detail: "the builder station mounted a start screen with the quote list and the new-quote form" };
  });
})();
