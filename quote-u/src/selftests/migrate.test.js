(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const MIG = window.QU_MIGRATE;
  if (!T || !QS || !MIG) return;

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

  async function seedDoc(store, doc, records) {
    const d = await store.loadDoc(doc);
    const base = d.ok ? d.revision : 0;
    return store.saveChecked(doc, { records: records }, { expectedBase: base });
  }

  const INPUT = {
    option_groups: [
      { id: "g1", quote_version_id: "v1", name: "Tier", selection_type: "single" },
      { id: "g2", quote_version_id: "v2", name: "Frozen tier", selection_type: "single" },
      { id: "g3", quote_version_id: null, name: "Unbound", selection_type: "single" },
      { id: "g4", quote_version_id: "v1", name: "Add-ons", selection_type: "multi" }
    ],
    quote_versions: [
      { id: "v1", quote_id: "q1", state: "internal_review" },
      { id: "v2", quote_id: "q1", state: "internal_review", frozen_at: "2026-01-01T00:00:00Z" }
    ],
    quotes: [
      { id: "q1", status: "internal_review" },
      { id: "q2", status: "sent" }
    ]
  };

  T.register("migration: plan finds the deprecated values and refuses to touch a frozen member", () => {
    const bad = [];
    const p = MIG.plan(INPUT);
    if (!p.ok || !p.has_changes) bad.push("plan did not find changes");
    if (p.counts.option_groups.convert !== 2) bad.push("group converts: " + p.counts.option_groups.convert);
    if (p.counts.option_groups.skip !== 1) bad.push("group skips: " + p.counts.option_groups.skip);
    const skip = p.group_changes.find(c => c.id === "g2");
    if (!skip || skip.action !== "skip" || skip.reason !== "frozen_version") bad.push("g2 (frozen) should be skipped");
    const unbound = p.group_changes.find(c => c.id === "g3");
    if (!unbound || unbound.action !== "convert") bad.push("g3 (unbound) should convert");
    if (p.counts.quote_versions.convert !== 1 || p.counts.quote_versions.skip !== 1) bad.push("version counts: " + JSON.stringify(p.counts.quote_versions));
    if (p.counts.quotes.convert !== 1) bad.push("quote converts: " + p.counts.quotes.convert);
    if (p.total_converted !== 4) bad.push("total_converted: " + p.total_converted);
    if (MIG.DEPRECATIONS.length < 2) bad.push("deprecation registry is incomplete");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "plan rewrites 2 non-frozen 'single' groups and the internal_review version/quote, while skipping the frozen group + version" };
  });

  T.register("migration: apply is a pure transform (input untouched, frozen members byte-identical)", () => {
    const bad = [];
    const before = JSON.stringify(INPUT);
    const out = MIG.apply(INPUT);
    if (JSON.stringify(INPUT) !== before) bad.push("apply mutated its input");
    if (out.option_groups.find(g => g.id === "g1").selection_type !== "bundle") bad.push("g1 not converted");
    if (out.option_groups.find(g => g.id === "g3").selection_type !== "bundle") bad.push("g3 not converted");
    if (out.option_groups.find(g => g.id === "g2").selection_type !== "single") bad.push("g2 (frozen member) was converted — I1 violated");
    if (out.option_groups.find(g => g.id === "g4").selection_type !== "multi") bad.push("g4 (multi) was changed");
    if (out.quote_versions.find(v => v.id === "v1").state !== "draft") bad.push("v1 not returned to draft");
    if (out.quote_versions.find(v => v.id === "v2").state !== "internal_review") bad.push("frozen v2 was changed");
    if (out.quotes.find(q => q.id === "q1").status !== "draft") bad.push("q1 status not migrated");
    // Re-planning the result leaves only the frozen skip.
    const after = MIG.plan({ option_groups: out.option_groups, quote_versions: out.quote_versions, quotes: out.quotes });
    if (after.total_converted !== 0) bad.push("apply left actionable changes: " + after.total_converted);
    if (after.total_skipped !== 2) bad.push("skips after apply: " + after.total_skipped);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "apply returns fresh records, converts the deprecated values and never touches a frozen member; a re-plan has nothing actionable left" };
  });

  T.register("migration: the service migrates the live documents and reconciles to zero (live)", async () => {
    const store = makeStore("mig");
    await store.ready();
    await seedDoc(store, "option_groups", INPUT.option_groups);
    await seedDoc(store, "quote_versions", INPUT.quote_versions);
    await seedDoc(store, "quotes", INPUT.quotes);
    const svc = MIG.createService({ store });
    const bad = [];

    const ins = await svc.inspect();
    if (!ins.ok || ins.total_converted !== 4) bad.push("inspect: " + JSON.stringify(ins && { converted: ins.total_converted }));

    const run = await svc.run({ actor: "tester" });
    if (!run.ok) return { pass: false, detail: "run failed: " + JSON.stringify(run) };
    if (run.converted !== 4) bad.push("converted: " + run.converted);
    if (!run.reconciled) bad.push("not reconciled: remaining " + (run.after && run.after.total_converted));

    const groups = await store.loadDoc("option_groups");
    const gd = (groups.content && groups.content.records) || [];
    if (gd.find(g => g.id === "g1").selection_type !== "bundle") bad.push("stored g1 not migrated");
    if (gd.find(g => g.id === "g2").selection_type !== "single") bad.push("stored frozen g2 was migrated");
    const vers = await store.loadDoc("quote_versions");
    const vd = (vers.content && vers.content.records) || [];
    if (vd.find(v => v.id === "v1").state !== "draft") bad.push("stored v1 not migrated");
    if (vd.find(v => v.id === "v2").state !== "internal_review" || !vd.find(v => v.id === "v2").frozen_at) bad.push("stored frozen v2 was touched");
    const quotes = await store.loadDoc("quotes");
    const qd = (quotes.content && quotes.content.records) || [];
    if (qd.find(q => q.id === "q1").status !== "draft") bad.push("stored q1 not migrated");

    // Idempotent: a second run is a no-op.
    const again = await svc.run({ actor: "tester" });
    if (!again.ok || !again.noop) bad.push("second run was not a no-op: " + JSON.stringify(again && { noop: again.noop, converted: again.converted }));
    const rec = await svc.reconcile();
    if (!rec.ok || rec.remaining !== 0) bad.push("reconcile after run: " + JSON.stringify(rec));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the service rewrites the live option_groups/quote_versions/quotes documents, leaves the frozen member intact, reconciles to zero and is idempotent" };
  });
})();
