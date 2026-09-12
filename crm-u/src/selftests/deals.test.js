(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const D = window.CRM_DEALS;
  if (!T || !BS || !R || !D) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];

  function mockEnv(opts) {
    opts = opts || {};
    const kvStore = new Map();
    const files = new Map();
    const kv = {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
    const editable = {
      get: async name => {
        const f = files.get(name);
        return f ? f.text : null;
      },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.text = text;
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true, unchanged: false, superseded: false };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, created: false, unchanged: true, superseded: false };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, created: false, unchanged: false, superseded: false };
      },
      files
    };
    const ns = "dl" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  const PL = {
    stages: [
      { id: "qualification", label: "Qualification" },
      { id: "proposal", label: "Proposal" }
    ],
    won: { id: "won", label: "Won" },
    lost: { id: "lost", label: "Lost" }
  };

  function dealRec(over) {
    return Object.assign({
      id: "d-1",
      name: "Acme annual licence",
      companyId: "c-1",
      owner: "Me",
      expectedValue: 24000,
      probability: 60,
      stage: "qualification",
      stageEnteredAt: "2026-02-01T09:00:00.000Z",
      createdAt: "2026-02-01T09:00:00.000Z"
    }, over || {});
  }

  T.register("deals: deal validation guards value, probability, close date and stage", () => {
    const bad = D.validate({ name: "  " });
    if (bad.ok) return { pass: false, detail: "expected name error" };
    const bad2 = D.validate({ name: "x", expectedValue: -4 });
    if (bad2.ok || !bad2.errors.expectedValue) return { pass: false, detail: "negative value accepted" };
    const bad3 = D.validate({ name: "x", probability: 120 });
    if (bad3.ok || !bad3.errors.probability) return { pass: false, detail: "probability >100 accepted" };
    const bad4 = D.validate({ name: "x", closeDate: "not-a-date" });
    if (bad4.ok || !bad4.errors.closeDate) return { pass: false, detail: "bad date accepted" };
    const bad5 = D.validate({ name: "x", stage: "nope" }, PL);
    if (bad5.ok || !bad5.errors.stage) return { pass: false, detail: "unknown stage accepted" };
    const v = D.validate({ name: "  Acme licence ", expectedValue: "25.5", probability: "40", closeDate: "2026-06-30", stage: "proposal", notes: "multi-year" }, PL);
    if (!v.ok) return { pass: false, detail: "valid rejected: " + JSON.stringify(v.errors) };
    if (v.values.name !== "Acme licence" || v.values.expectedValue !== 25.5 || v.values.probability !== 40) {
      return { pass: false, detail: "parsing wrong: " + JSON.stringify(v.values) };
    }
    const auto = D.validate({ name: "x" }, PL);
    if (auto.values.stage !== "qualification") return { pass: false, detail: "stage did not default to first open stage" };
    const noVal = D.validate({ name: "x", expectedValue: "", probability: "" }, PL);
    if (noVal.values.expectedValue !== null || noVal.values.probability !== null) {
      return { pass: false, detail: "blanks not normalized to null" };
    }
    const rec = D.applyForm(null, v.values, {});
    if (!String(rec.id).startsWith("d-")) return { pass: false, detail: "id prefix wrong: " + rec.id };
    if (rec.expectedValue !== 25.5 || rec.stage !== "proposal" || !rec.stageEnteredAt || !rec.createdAt) {
      return { pass: false, detail: "applyForm shaping wrong: " + JSON.stringify(rec) };
    }
    return { pass: true, detail: "validation + applyForm verified" };
  });

  T.register("deals: pipeline defaults apply until the document defines its own", () => {
    const def = D.effectivePipelineOf({ records: [] });
    if (!def.stages || def.stages.length < 4) return { pass: false, detail: "default pipeline not complete" };
    if (def.won.id !== "won" || def.lost.id !== "lost") return { pass: false, detail: "terminal stage ids wrong" };
    const custom = D.effectivePipelineOf({ records: [], pipeline: PL });
    if (custom.stages.length !== 2 || custom.stages[0].id !== "qualification") {
      return { pass: false, detail: "custom pipeline ignored" };
    }
    D.remember({ records: [], pipeline: PL });
    if (D.stageLabels().join(",") !== "Qualification,Proposal,Won,Lost") return { pass: false, detail: "stageLabels wrong: " + D.stageLabels().join(",") };
    if (D.stageLabel("proposal") !== "Proposal") return { pass: false, detail: "stageLabel lookup failed" };
    if (D.isOpenStage("won") || !D.isOpenStage("qualification")) return { pass: false, detail: "isOpenStage wrong" };
    D.remember({ records: [] });
    if (D.stageLabel("won") !== "Won") return { pass: false, detail: "default fallback after remember failed" };
    return { pass: true, detail: "pipeline default/custom switching verified" };
  });

  T.register("deals: stage moves journal from/to with note and track stageEnteredAt", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("deals", { records: [dealRec()], pipeline: PL }, { expectedBase: 0 });
    let res = await D.changeStage(s, "d-1", "proposal", { note: "Sent quote" });
    if (!res || !res.ok) return { pass: false, detail: "move failed: " + JSON.stringify(res) };
    let doc = await s.loadDoc("deals", { refresh: true });
    let rec = R.getRecord(doc.content, "d-1");
    if (rec.stage !== "proposal" || !rec.stageEnteredAt || rec.stageEnteredAt === "2026-02-01T09:00:00.000Z") {
      return { pass: false, detail: "stageEnteredAt not refreshed" };
    }
    const evs = rec.events || [];
    if (evs.length !== 1 || evs[0].from !== "qualification" || evs[0].to !== "proposal" || evs[0].note !== "Sent quote") {
      return { pass: false, detail: "journal wrong: " + JSON.stringify(evs) };
    }
    res = await D.changeStage(s, "d-1", "bogus", {});
    if (res.ok || res.code !== "invalid_stage") return { pass: false, detail: "bogus stage accepted" };
    res = await D.changeStage(s, "d-1", "proposal", {});
    if (!res.ok || !res.noop) return { pass: false, detail: "same-stage move not a noop" };
    doc = await s.loadDoc("deals", { refresh: true });
    rec = R.getRecord(doc.content, "d-1");
    if ((rec.events || []).length !== 1) return { pass: false, detail: "noop still journaled" };
    return { pass: true, detail: "stage moves, journaling and validation verified" };
  });

  T.register("deals: won closes the deal with a timestamp; reopening clears close timestamps", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("deals", { records: [dealRec()], pipeline: PL }, { expectedBase: 0 });
    let res = await D.changeStage(s, "d-1", "won", { note: "Signed" });
    if (!res || !res.ok) return { pass: false, detail: "won failed: " + JSON.stringify(res) };
    let doc = await s.loadDoc("deals", { refresh: true });
    let rec = R.getRecord(doc.content, "d-1");
    if (rec.stage !== "won" || !rec.wonAt) return { pass: false, detail: "won state not recorded" };
    const wonAt = rec.wonAt;
    res = await D.changeStage(s, "d-1", "lost", { reason: "Price", note: "Went elsewhere" });
    if (!res || !res.ok) return { pass: false, detail: "won→lost should be allowed: " + JSON.stringify(res) };
    doc = await s.loadDoc("deals", { refresh: true });
    rec = R.getRecord(doc.content, "d-1");
    if (rec.stage !== "lost" || rec.lossReason !== "Price" || !rec.lostAt) {
      return { pass: false, detail: "lost state wrong: " + JSON.stringify(rec) };
    }
    if (rec.wonAt !== undefined) return { pass: false, detail: "wonAt not cleared on lost" };
    res = await D.changeStage(s, "d-1", "qualification", { note: "Reopened" });
    if (!res || !res.ok) return { pass: false, detail: "reopen failed" };
    doc = await s.loadDoc("deals", { refresh: true });
    rec = R.getRecord(doc.content, "d-1");
    if (rec.stage !== "qualification" || rec.lostAt !== undefined || rec.lossReason !== undefined || rec.wonAt !== undefined) {
      return { pass: false, detail: "reopen did not clear terminal fields" };
    }
    const evs = rec.events || [];
    if (evs.length !== 3 || evs[1].reason !== "Price") return { pass: false, detail: "journal lost reason missing" };
    if (wonAt && rec.createdAt && rec.createdAt === wonAt) return { pass: false, detail: "sanity" };
    return { pass: true, detail: "won/lost/reopen lifecycle verified" };
  });

  T.register("deals: weighted value equals expected × probability with 100% default", () => {
    const full = { expectedValue: 1000, probability: 60 };
    if (D.weightedOf(full) !== 600) return { pass: false, detail: "weighted 60% wrong" };
    const unset = { expectedValue: 1000 };
    if (D.weightedOf(unset) !== 1000) return { pass: false, detail: "unset probability should mean 100%" };
    const zero = { expectedValue: 0, probability: 50 };
    if (D.weightedOf(zero) !== 0) return { pass: false, detail: "zero value weighted" };
    if (D.probOf({ probability: 500 }) !== 100 || D.probOf({ probability: -3 }) !== 0) {
      return { pass: false, detail: "probability clamping wrong" };
    }
    return { pass: true, detail: "weighted & probability math verified" };
  });

  T.register("deals: won deal converts the linked company to a customer", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("companies", { records: [{ id: "c-1", name: "Acme Industries", active: true }] }, { expectedBase: 0 });
    await s.saveChecked("deals", { records: [dealRec({ stage: "won", wonAt: "2026-03-01T10:00:00.000Z" })], pipeline: PL }, { expectedBase: 0 });
    const res = await D.convertWonToCustomer(s, "d-1", {});
    if (!res || !res.ok) return { pass: false, detail: "convert failed: " + JSON.stringify(res) };
    const cdoc = await s.loadDoc("companies", { refresh: true });
    const comp = R.getRecord(cdoc.content, "c-1");
    if (comp.isCustomer !== true || !comp.customerSince) return { pass: false, detail: "company not marked customer" };
    const ddoc = await s.loadDoc("deals", { refresh: true });
    const deal = R.getRecord(ddoc.content, "d-1");
    if (!deal.convertedToCustomerAt) return { pass: false, detail: "deal not stamped" };
    const evs = deal.events || [];
    if (!evs.some(e => e.kind === "customer")) return { pass: false, detail: "customer event missing" };
    const again = await D.convertWonToCustomer(s, "d-1", {});
    if (!again.ok || !again.noop) return { pass: false, detail: "second convert should be a noop" };
    const standalone = await D.convertWonToCustomer(s, "d-9", {});
    if (!standalone || standalone.ok || standalone.code !== "not_found") {
      return { pass: false, detail: "missing deal should error" };
    }
    await s.saveChecked("deals", { records: [dealRec({ id: "d-2", companyId: "c-9", stage: "proposal" })], pipeline: PL }, { expectedBase: 0 });
    const notWon = await D.convertWonToCustomer(s, "d-2", {});
    if (notWon.ok || notWon.code !== "not_won") return { pass: false, detail: "non-won deal accepted" };
    return { pass: true, detail: "won → customer conversion verified" };
  });

  T.register("deals: pipeline rename keeps ids; removal of a stage with deals is refused", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("deals", { records: [
      dealRec({ id: "d-1", stage: "qualification" }),
      dealRec({ id: "d-2", stage: "proposal" })
    ], pipeline: PL }, { expectedBase: 0 });
    const renamed = {
      stages: [
        { id: "qualification", label: "Discovery" },
        { id: "proposal", label: "Legal review" },
        { id: "deep-dive", label: "Deep dive" }
      ],
      won: { id: "won", label: "Closed won" },
      lost: { id: "lost", label: "Closed lost" }
    };
    const res = await D.savePipeline(s, renamed, { seedCounts: { qualification: 1, proposal: 1 } });
    if (!res || !res.ok) return { pass: false, detail: "rename failed: " + JSON.stringify(res) };
    let doc = await s.loadDoc("deals", { refresh: true });
    let pl = doc.content.pipeline;
    if (pl.stages.length !== 3 || pl.stages[0].label !== "Discovery" || pl.stages[2].id !== "deep-dive") {
      return { pass: false, detail: "pipeline not updated: " + JSON.stringify(pl) };
    }
    if (pl.won.label !== "Closed won") return { pass: false, detail: "won label not renamed" };
    let rec = R.getRecord(doc.content, "d-1");
    if (rec.stage !== "qualification") return { pass: false, detail: "deal lost its stage on rename" };
    const removeInUse = {
      stages: [{ id: "qualification", label: "Discovery" }],
      won: pl.won,
      lost: pl.lost
    };
    const refuse = await D.savePipeline(s, removeInUse, { seedCounts: { qualification: 1, proposal: 1 } });
    if (refuse.ok || refuse.code !== "stage_in_use") return { pass: false, detail: "removal with deals allowed: " + JSON.stringify(refuse) };
    doc = await s.loadDoc("deals", { refresh: true });
    pl = doc.content.pipeline;
    if (pl.stages.length !== 3) return { pass: false, detail: "refused save still mutated the doc" };
    const emptyDrop = {
      stages: [
        { id: "qualification", label: "Discovery" },
        { id: "proposal", label: "Legal review" }
      ],
      won: pl.won,
      lost: pl.lost
    };
    const dropEmpty = await D.savePipeline(s, emptyDrop, { seedCounts: { qualification: 1, proposal: 1 } });
    if (!dropEmpty || !dropEmpty.ok) return { pass: false, detail: "dropping an empty stage failed: " + JSON.stringify(dropEmpty) };
    doc = await s.loadDoc("deals", { refresh: true });
    pl = doc.content.pipeline;
    if (pl.stages.length !== 2 || pl.stages.some(x => x.id === "deep-dive")) {
      return { pass: false, detail: "empty stage not dropped" };
    }
    return { pass: true, detail: "pipeline rename/protect/drop verified" };
  });

  T.register("deals: deleting a converted deal returns its lead to qualified", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("leads", { records: [{ id: "l-1", name: "Northwind pilot", status: "converted", convertedToDealId: "d-1", convertedAt: "2026-02-10T09:00:00.000Z", createdAt: "2026-01-01T09:00:00.000Z" }] }, { expectedBase: 0 });
    await s.saveChecked("deals", { records: [dealRec({ leadId: "l-1" })], pipeline: PL }, { expectedBase: 0 });
    const del = await D.canDelete(s, "d-1");
    if (!del.allowed) return { pass: false, detail: "fresh deal should be deletable" };
    const rem = await R.persistUpdate(s, "deals", content => {
      const out = R.removeRecord(content, "d-1");
      return out.removed ? { changed: true, content } : { changed: false };
    });
    if (!rem || !rem.ok) return { pass: false, detail: "delete failed" };
    await D.revertLeadOnDelete(s, "d-1", "l-1");
    const ldoc = await s.loadDoc("leads", { refresh: true });
    const lead = R.getRecord(ldoc.content, "l-1");
    if (!lead || lead.status !== "qualified" || lead.convertedToDealId !== undefined) {
      return { pass: false, detail: "lead not returned to qualified: " + JSON.stringify(lead) };
    }
    return { pass: true, detail: "lead revert on deal delete verified" };
  });
})();
