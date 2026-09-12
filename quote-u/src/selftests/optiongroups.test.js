(function () {
  const T = window.QU_SELFTEST;
  const OG = window.QU_OPTIONGROUPS;
  const LI = window.QU_LINEITEMS;
  const TOT = window.QU_TOTALS;
  if (!T || !OG || !LI || !TOT) return;

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

  function line(id, group, overrides) {
    return LI.normalize(Object.assign({
      kind: "one_time",
      description: "line " + id,
      unit_sell_cents: 10000,
      optional: true,
      option_group_id: group
    }, overrides || {}), { id: id });
  }

  function group(id, type, overrides) {
    return OG.normalize(Object.assign({
      id: id,
      name: "Group " + id,
      selection_type: type
    }, overrides || {}));
  }

  T.register("option groups: the model declares its fields and selection types", () => {
    const bad = [];
    ["quote_version_id", "name", "selection_type", "sort_order", "description"].forEach(f => {
      if (OG.MODEL_FIELD_NAMES.indexOf(f) === -1) bad.push("missing model field " + f);
    });
    if (OG.SELECTION_TYPES.join(",") !== "single,bundle,multi,optional") bad.push("selection types: " + OG.SELECTION_TYPES.join(","));
    if (OG.selectionLimit("single") !== 1) bad.push("single limit: " + OG.selectionLimit("single"));
    if (OG.selectionLimit("bundle") !== 1) bad.push("bundle limit: " + OG.selectionLimit("bundle"));
    if (OG.selectionLimit("multi") !== Infinity) bad.push("multi limit");
    if (OG.selectionLimit("optional") !== Infinity) bad.push("optional limit");
    const g = group("g1", "single");
    if (g.id !== "g1" || g.name !== "Group g1" || g.selection_type !== "single" || g.sort_order !== 0 || g.description !== "") bad.push("defaults: " + JSON.stringify(g));
    const input = { name: "Speed", selection_type: "multi" };
    const n = OG.normalize(input, { id: "g2" });
    if (n.id !== "g2") bad.push("opts.id ignored");
    if (input.id !== undefined) bad.push("normalize mutated its input");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "fields + selection types + single-select limit declared; defaults filled without mutating input" };
  });

  T.register("option groups: malformed groups are refused", () => {
    const bad = [];
    const e1 = throws(() => OG.normalize({ selection_type: "single" }), "bad_group_name");
    if (e1) bad.push("missing name: " + e1);
    const e2 = throws(() => OG.normalize({ name: "Good/Better/Best", selection_type: "one" }), "bad_selection_type");
    if (e2) bad.push("bad type: " + e2);
    const e3 = throws(() => OG.normalize(null), "bad_option_group");
    if (e3) bad.push("null: " + e3);
    const e4 = throws(() => OG.normalize({ name: "x", sort_order: 1.5 }), "bad_sort_order");
    if (e4) bad.push("fractional sort: " + e4);
    const v = OG.validate({ selection_type: "guess" });
    if (v.ok) bad.push("validate accepted an invalid group");
    if (codes(v.violations).indexOf("bad_group_name") === -1 || codes(v.violations).indexOf("bad_selection_type") === -1) bad.push("violations: " + codes(v.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "missing name, unknown type, non-object and fractional sort order all refused" };
  });

  T.register("option groups: membership — every grouped line references a real group", () => {
    const groups = [group("g1", "single"), group("g2", "multi")];
    const lineItems = [line("li-1", "g1"), line("li-2", "g2"), line("li-3", null)];
    const bad = [];
    const ok = OG.validateMembership(lineItems, groups);
    if (!ok.ok) bad.push("valid membership flagged: " + JSON.stringify(ok.violations));
    if (ok.grouped !== 2) bad.push("grouped count: " + ok.grouped);
    const missing = OG.validateMembership([line("li-9", "nope")], groups);
    if (missing.ok || codes(missing.violations).indexOf("group_not_found") === -1) bad.push("unknown group not caught: " + JSON.stringify(missing.violations));
    const dup = OG.validateMembership([], [group("g1", "single"), group("g1", "multi")]);
    if (dup.ok || codes(dup.violations).indexOf("duplicate_group") === -1) bad.push("duplicate group not caught");
    const vbound = group("g7", "single", { quote_version_id: "v2" });
    const vm = OG.validateMembership([line("li-7", "g7", { quote_version_id: "v1" })], [vbound]);
    if (vm.ok || codes(vm.violations).indexOf("group_version_mismatch") === -1) bad.push("version mismatch not caught: " + JSON.stringify(vm.violations));
    const notOptional = line("li-8", "g1", { optional: false });
    const no = OG.validateMembership([notOptional], groups);
    if (no.ok || codes(no.violations).indexOf("grouped_line_not_optional") === -1) bad.push("non-optional grouped line not caught");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "unknown group, duplicate id, cross-version and non-optional grouped lines all refused; valid membership passes" };
  });

  T.register("option groups: a single-select group never has two selected lines in ANY state", () => {
    const groups = [group("g1", "single")];
    const lineItems = [
      line("li-a", "g1", { selected_by_default: true }),
      line("li-b", "g1", { selected_by_default: true }),
      line("li-c", "g1")
    ];
    const bad = [];
    // default state: both a and b are on
    const def = OG.checkSelection(lineItems, groups);
    if (def.ok || def.violations[0].code !== "single_select_conflict") bad.push("defaults not refused: " + JSON.stringify(def.violations));
    if (def.violations[0] && def.violations[0].group !== "g1") bad.push("wrong group reported");
    // explicit map selecting two
    const mapped = OG.checkSelection(lineItems, groups, { "li-a": true, "li-b": true });
    if (mapped.ok) bad.push("explicit map with two selected not refused");
    // complete selected-id array with two
    const completed = OG.checkSelection(lineItems, groups, ["li-a", "li-b"]);
    if (completed.ok) bad.push("complete selection array with two not refused");
    // valid states pass
    const one = OG.checkSelection(lineItems, groups, ["li-a"]);
    if (!one.ok) bad.push("single selection refused: " + JSON.stringify(one.violations));
    const off = OG.checkSelection(lineItems, groups, { "li-a": false, "li-b": false });
    if (!off.ok) bad.push("empty selection refused");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "two selected lines refused for defaults, explicit maps and id arrays; 0/1 selected pass" };
  });

  T.register("option groups: multi and optional groups accept any subset", () => {
    const groups = [group("gm", "multi"), group("go", "optional")];
    const lineItems = [
      line("mi-1", "gm", { selected_by_default: true }),
      line("mi-2", "gm", { selected_by_default: true }),
      line("oi-1", "go", { selected_by_default: true }),
      line("oi-2", "go", { selected_by_default: true })
    ];
    const bad = [];
    const two = OG.checkSelection(lineItems, groups, ["mi-1", "mi-2", "oi-1", "oi-2"]);
    if (!two.ok) bad.push("multi/optional subset refused: " + JSON.stringify(two.violations));
    if (OG.selectionLimit("multi") !== Infinity || OG.selectionLimit("optional") !== Infinity) bad.push("limits");
    if (two.selected_count !== 4) bad.push("selected count: " + two.selected_count);
    if (!two.by_group.get("gm") || two.by_group.get("gm").length !== 2) bad.push("by_group grouping");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "multi/optional groups allow any subset; grouping reported per group" };
  });

  T.register("option groups: QU_TOTALS repairs what QU_OPTIONGROUPS refuses (they compose)", () => {
    const groups = [group("g1", "single")];
    const lineItems = [
      line("li-a", "g1", { selected_by_default: true, unit_sell_cents: 1000 }),
      line("li-b", "g1", { selected_by_default: true, unit_sell_cents: 2000 }),
      line("li-c", "g1", { unit_sell_cents: 3000 })
    ];
    const bad = [];
    const badState = ["li-a", "li-b", "li-c"];
    const check = OG.checkSelection(lineItems, groups, badState);
    if (check.ok) bad.push("enforcement accepted a conflicting state");
    const enforced = OG.enforceSelection(lineItems, groups, badState);
    if (enforced.ok || enforced.code !== "single_select_conflict") bad.push("enforceSelection: " + JSON.stringify(enforced));
    const repaired = OG.resolveSelection(lineItems, groups, badState);
    if (!repaired.repairs || repaired.repairs.length !== 1) bad.push("totals did not repair: " + JSON.stringify(repaired.repairs));
    const repairedCheck = OG.checkSelection(lineItems, groups, repaired.selectedIds);
    if (!repairedCheck.ok) bad.push("repaired state still refused: " + JSON.stringify(repairedCheck.violations));
    const totals = TOT.computeTotals({ line_items: lineItems.map(LI.toTotalsLine), selection: badState, option_groups: groups });
    if (totals.selection.repairs.length !== 1) bad.push("totals engine reports a repair");
    if (totals.selected_count !== 1) bad.push("totals selected_count: " + totals.selected_count);
    const good = OG.enforceSelection(lineItems, groups, ["li-c"]);
    if (!good.ok) bad.push("valid selection not enforced: " + JSON.stringify(good));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "QU_OPTIONGROUPS refuses a 2-selected single group; QU_TOTALS resolves it to one; the repaired state validates" };
  });

  T.register("option groups: ordering and version filtering are stable and pure", () => {
    const gs = [
      group("g3", "single", { sort_order: 2, name: "B" }),
      group("g1", "multi", { sort_order: 0, name: "A" }),
      group("g2", "optional", { sort_order: 1, name: "A" }),
      group("g4", "single", { sort_order: 2, name: "A", quote_version_id: "v2" })
    ];
    const input = gs.slice();
    const sorted = OG.sortGroups(gs);
    const bad = [];
    if (sorted.map(g => g.id).join(",") !== "g1,g2,g4,g3") bad.push("order: " + sorted.map(g => g.id).join(","));
    if (gs[0] !== input[0] || gs.length !== input.length) bad.push("sortGroups mutated its input");
    const v2 = OG.groupsForVersion(gs, "v2");
    if (v2.length !== 1 || v2[0].id !== "g4") bad.push("groupsForVersion: " + v2.map(g => g.id).join(","));
    const all = OG.groupsForVersion(gs, null);
    if (all.length !== 4) bad.push("null version should not filter");
    const idx = OG.indexById(gs);
    if (idx.get("g2").name !== "A") bad.push("indexById");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "sort_order→name→id ordering; version filter; index; no mutation" };
  });

  T.register("option groups: validateAll aggregates records, membership and selection", () => {
    const groups = [group("g1", "single"), { id: "g2", name: "", selection_type: "wat" }];
    const lineItems = [line("li-a", "g1"), line("li-b", "g1", { selected_by_default: true }), line("li-x", "ghost")];
    const out = OG.validateAll(lineItems, groups, ["li-a", "li-b"]);
    const bad = [];
    if (out.ok) bad.push("validateAll accepted invalid data");
    const c = codes(out.violations);
    if (c.indexOf("bad_group_name") === -1) bad.push("group record violation missing: " + c);
    if (c.indexOf("bad_selection_type") === -1) bad.push("bad type missing");
    if (c.indexOf("group_not_found") === -1) bad.push("membership violation missing: " + c);
    if (c.indexOf("single_select_conflict") === -1) bad.push("selection violation missing");
    const clean = OG.validateAll([line("li-c", "g1")], [group("g1", "single")], ["li-c"]);
    if (!clean.ok) bad.push("clean data flagged: " + JSON.stringify(clean.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "aggregates group-record, membership and single-select violations; clean data passes" };
  });
})();
