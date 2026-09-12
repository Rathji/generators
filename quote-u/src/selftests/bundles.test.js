(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const B = window.QU_BUNDLES;
  if (!T || !QS || !B) return;

  function makeKv(kvStore) {
    return {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  function makeStore(prefix) {
    return QS.create({ ns: prefix + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  const LINES = [
    { id: "l1", description: "Firewall", kind: "one_time", quantity: 2, unit_cost_cents: 80000, unit_sell_cents: 125000 },
    { id: "l2", description: "Support", kind: "mrr", quantity: 1, unit_cost_cents: 12000, unit_sell_cents: 30000, optional: true, selected_by_default: true }
  ];

  T.register("bundles: compose rolls sell, cost and margin up by kind and over twelve months", () => {
    const bad = [];
    const c = B.compose(LINES);
    if (c.component_count !== 2) bad.push("component_count: " + c.component_count);
    if (c.one_time.sell_cents !== 250000) bad.push("one_time sell: " + c.one_time.sell_cents);
    if (c.one_time.cost_cents !== 160000) bad.push("one_time cost: " + c.one_time.cost_cents);
    if (c.one_time.margin_cents !== 90000) bad.push("one_time margin: " + c.one_time.margin_cents);
    if (c.one_time.margin_bp !== 3600) bad.push("one_time margin_bp: " + c.one_time.margin_bp);
    if (c.mrr.sell_cents !== 30000 || c.mrr.cost_cents !== 12000) bad.push("mrr rollup");
    if (c.mrr.margin_bp !== 6000) bad.push("mrr margin_bp: " + c.mrr.margin_bp);
    if (c.twelve_month.sell_cents !== 610000) bad.push("twelve sell: " + c.twelve_month.sell_cents);
    if (c.twelve_month.cost_cents !== 304000) bad.push("twelve cost: " + c.twelve_month.cost_cents);
    if (c.twelve_month.margin_cents !== 306000) bad.push("twelve margin: " + c.twelve_month.margin_cents);
    if (c.missing_cost_count !== 0) bad.push("missing_cost_count: " + c.missing_cost_count);
    const l1 = c.components.find(x => x.id === "l1");
    const l2 = c.components.find(x => x.id === "l2");
    if (l1.share_bp !== 8929) bad.push("l1 share_bp: " + l1.share_bp);
    if (l2.share_bp !== 1071) bad.push("l2 share_bp: " + l2.share_bp);
    if (l1.margin_cents !== 90000) bad.push("l1 margin: " + l1.margin_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one-time/MRR/twelve-month sell, cost and margin all roll up exactly; per-component share basis points reported" };
  });

  T.register("bundles: an uncaptured cost is flagged rather than pretended profitable", () => {
    const bad = [];
    const c = B.compose([
      { id: "a", description: "Known", kind: "one_time", quantity: 1, unit_cost_cents: 5000, unit_sell_cents: 10000 },
      { id: "b", description: "Unknown", kind: "one_time", quantity: 1, unit_cost_cents: 0, unit_sell_cents: 10000 }
    ]);
    if (c.missing_cost_count !== 1) bad.push("missing_cost_count: " + c.missing_cost_count);
    const b = c.components.find(x => x.id === "b");
    if (!b.missing_cost) bad.push("the zero-cost component was not flagged");
    const a = c.components.find(x => x.id === "a");
    if (a.missing_cost) bad.push("a captured cost was flagged");
    const zeroSell = B.compose([{ id: "z", description: "Free", kind: "mrr", quantity: 1, unit_cost_cents: 100, unit_sell_cents: 0 }]);
    if (zeroSell.mrr.margin_bp !== null) bad.push("a zero-sell margin_bp should be null: " + zeroSell.mrr.margin_bp);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a line with no captured cost is flagged missing_cost and a zero-sell roll-up reports null (never a fake rate)" };
  });

  T.register("bundles: a bundle group rolls up its SELECTED member only (exclusive choice)", () => {
    const bad = [];
    const groups = [{ id: "g1", name: "Tier", selection_type: "bundle" }];
    const lines = [
      { id: "t1", description: "Good", kind: "one_time", quantity: 1, unit_cost_cents: 10000, unit_sell_cents: 20000, optional: true, option_group_id: "g1", selected_by_default: true },
      { id: "t2", description: "Better", kind: "one_time", quantity: 1, unit_cost_cents: 30000, unit_sell_cents: 60000, optional: true, option_group_id: "g1" }
    ];
    const chosen = B.groupComposition(lines, groups[0], { t2: true });
    if (chosen.selected_ids.join(",") !== "t2") bad.push("selected: " + chosen.selected_ids.join(","));
    if (chosen.composition.one_time.sell_cents !== 60000) bad.push("tier sell: " + chosen.composition.one_time.sell_cents);
    if (chosen.composition.one_time.margin_cents !== 30000) bad.push("tier margin: " + chosen.composition.one_time.margin_cents);
    if (chosen.member_count !== 2) bad.push("member_count: " + chosen.member_count);
    const roll = B.rollup(groups, lines, { t1: true });
    if (roll.group_count !== 1) bad.push("group_count: " + roll.group_count);
    if (roll.overall.one_time.sell_cents !== 20000) bad.push("overall sell: " + roll.overall.one_time.sell_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a bundle group composes only its selected member, and the version roll-up uses the resolved selection" };
  });

  T.register("bundles: the service rolls up a stored version (live)", async () => {
    const store = makeStore("bnd");
    const audit = window.QU_AUDIT.createService({ store });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const svc = B.createService({ versions, optionGroups: window.QU_OPTIONGROUPS });
    const bad = [];
    const v = await versions.createVersion({ quote_id: "q1", title: "Bundle test" });
    const a = await versions.addLine(v.version.id, { kind: "one_time", description: "Router", quantity: 1, unit_cost_cents: 10000, unit_sell_cents: 20000 });
    const g = await versions.addGroup(v.version.id, { name: "Tier", selection_type: "bundle" });
    const support = await versions.addLine(v.version.id, { kind: "mrr", description: "Support", quantity: 1, unit_cost_cents: 1000, unit_sell_cents: 5000, optional: true, option_group_id: g.group.id, selected_by_default: true });
    const res = await svc.forVersion(v.version.id, null);
    if (!res.ok) return { pass: false, detail: "forVersion failed: " + JSON.stringify(res) };
    if (!res.overall || res.overall.component_count !== 2) bad.push("overall components: " + (res.overall && res.overall.component_count));
    if (res.overall.one_time.sell_cents !== 20000) bad.push("one_time sell: " + res.overall.one_time.sell_cents);
    if (res.overall.mrr.sell_cents !== 5000) bad.push("mrr sell: " + res.overall.mrr.sell_cents);
    if (!res.groups || res.groups.length !== 1) bad.push("groups: " + (res.groups && res.groups.length));
    if (res.groups && res.groups[0].selected_ids.join(",") !== support.line.id) bad.push("the bundle group should compose only the support line, got: " + res.groups[0].selected_ids.join(","));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "forVersion composes the stored version's selected lines through the version service" };
  });
})();
