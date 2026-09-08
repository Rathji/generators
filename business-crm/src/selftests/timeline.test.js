(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const TL = window.CRM_TIMELINE;
  if (!T || !BS || !R || !TL) return;

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
    const ns = "tl" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  async function seedWorld(store) {
    await store.saveChecked("companies", { records: [
      { id: "c-1", name: "Acme Industries" },
      { id: "c-2", name: "Beta Works" }
    ] }, { expectedBase: 0 });
    await store.saveChecked("contacts", { records: [
      { id: "ct-1", name: "Pat Smith", companyId: "c-1" },
      { id: "ct-2", name: "Rae Jones", companyId: "c-2" }
    ] }, { expectedBase: 0 });
    await store.saveChecked("deals", { records: [
      {
        id: "d-1", name: "Acme licence", companyId: "c-1", stage: "proposal", createdAt: "2026-07-01T09:00:00.000Z",
        events: [
          { kind: "create", at: "2026-07-01T09:00:00.000Z" },
          { kind: "stage", from: "qualification", to: "proposal", at: "2026-07-15T09:00:00.000Z" }
        ]
      },
      {
        id: "d-2", name: "Beta pilot", companyId: "c-2", stage: "qualification", createdAt: "2026-07-20T09:00:00.000Z",
        events: [
          { kind: "create", at: "2026-07-20T09:00:00.000Z" }
        ]
      }
    ] }, { expectedBase: 0 });
    await store.saveChecked("leads", { records: [
      {
        id: "l-1", name: "Northwind pilot", status: "contacted", createdAt: "2026-06-10T09:00:00.000Z",
        events: [
          { kind: "status", from: "new", to: "contacted", at: "2026-06-11T09:00:00.000Z" }
        ]
      }
    ] }, { expectedBase: 0 });
    await store.saveChecked("activities", { records: [
      { id: "a-1", type: "call", subject: "Intro call", at: "2026-08-01T10:00:00.000Z", contactId: "ct-1", durationMin: 30 },
      { id: "a-2", type: "note", subject: "Beta note", at: "2026-08-02T10:00:00.000Z", companyId: "c-2" },
      { id: "a-3", type: "task", subject: "Send draft", at: "2026-08-03T10:00:00.000Z", dealId: "d-1", dueDate: "2026-08-20T00:00:00.000Z", status: "open" },
      { id: "a-4", type: "meeting", subject: "Acme on-site", at: "2026-08-04T10:00:00.000Z", companyId: "c-1" },
      { id: "a-5", type: "email", subject: "Lead email", at: "2026-08-05T10:00:00.000Z", leadId: "l-1", outcome: "sent" }
    ] }, { expectedBase: 0 });
  }

  T.register("timeline: company scope merges contact/deal activity and deal stage events", async () => {
    const env = mockEnv();
    await seedWorld(env.store);
    const coll = await TL.collect(env.store, { companyId: "c-1" });
    const kinds = coll.items.map(i => (i.kind === "event" ? "event:" + i.group : i.kind)).sort();
    const join = kinds.join(",");
    if (!join.includes("call") || !join.includes("meeting") || !join.includes("task")) {
      return { pass: false, detail: "expected company-scope activity missing: " + join };
    }
    if (!join.includes("event:stage")) return { pass: false, detail: "deal stage events missing: " + join };
    if (join.includes("note")) return { pass: false, detail: "other-company activity leaked in: " + join };
    const titles = coll.items.map(i => i.title).join(" | ");
    if (!titles.includes("Qualification → Proposal")) return { pass: false, detail: "stage not labelled: " + titles };
    if (!titles.includes("Acme licence — Created")) return { pass: false, detail: "create event missing: " + titles };
    const refs = coll.items.filter(i => i.ref && i.ref.id === "d-1");
    if (!refs.length) return { pass: false, detail: "event rows carry no deal ref" };
    const recIds = coll.recs.map(r => r.id).sort().join(",");
    if (recIds !== "a-1,a-3,a-4") return { pass: false, detail: "matched recs wrong: " + recIds };
    for (let i = 1; i < coll.items.length; i++) {
      if (coll.items[i - 1].at < coll.items[i].at) return { pass: false, detail: "not newest-first" };
    }
    return { pass: true, detail: "company scope verified (" + coll.items.length + " items)" };
  });

  T.register("timeline: contact scope shows only that contact's activity", async () => {
    const env = mockEnv();
    await seedWorld(env.store);
    const coll = await TL.collect(env.store, { contactId: "ct-1" });
    const join = coll.items.map(i => i.kind).sort().join(",");
    if (join !== "call") return { pass: false, detail: "contact scope leaked: " + join };
    const coll2 = await TL.collect(env.store, { contactId: "ct-2" });
    if (coll2.items.length !== 0) return { pass: false, detail: "ct-2 unexpectedly has items" };
    return { pass: true, detail: "contact scoping verified" };
  });

  T.register("timeline: deal scope shows own events plus deal-linked activity only", async () => {
    const env = mockEnv();
    await seedWorld(env.store);
    const coll = await TL.collect(env.store, { dealId: "d-1" });
    const kinds = coll.items.map(i => (i.kind === "event" ? "event" : i.kind)).sort();
    const join = kinds.join(",");
    if (!join.includes("event") || !join.includes("task")) return { pass: false, detail: "deal items wrong: " + join };
    if (join.includes("call") || join.includes("meeting")) return { pass: false, detail: "non-deal activity leaked: " + join };
    const titles = coll.items.filter(i => i.kind === "event").map(i => i.title).join(" | ");
    if (!titles.includes("Created") || !titles.includes("Qualification → Proposal")) return { pass: false, detail: "deal event titles wrong: " + titles };
    if (coll.recs.length !== 1 || coll.recs[0].id !== "a-3") return { pass: false, detail: "matched recs wrong for deal scope" };
    return { pass: true, detail: "deal scope verified" };
  });

  T.register("timeline: lead scope shows status events plus lead-linked activity", async () => {
    const env = mockEnv();
    await seedWorld(env.store);
    const coll = await TL.collect(env.store, { leadId: "l-1" });
    const kinds = coll.items.map(i => (i.kind === "event" ? "event:" + i.group : i.kind)).sort();
    const join = kinds.join(",");
    if (!join.includes("email") || !join.includes("event:status")) return { pass: false, detail: "lead items wrong: " + join };
    const titles = coll.items.filter(i => i.kind === "event").map(i => i.title).join(" | ");
    if (!titles.includes("→ Contacted")) return { pass: false, detail: "status label missing: " + titles };
    if (coll.recs.length !== 1 || coll.recs[0].id !== "a-5") return { pass: false, detail: "matched recs wrong for lead scope" };
    return { pass: true, detail: "lead scope verified" };
  });

  T.register("timeline: helpers label outcomes, types and overdue consistently", () => {
    if (TL.typeLabel("meeting") !== "Meeting") return { pass: false, detail: "type label wrong" };
    if (TL.typeIcon("email") !== "@") return { pass: false, detail: "type icon wrong" };
    if (TL.outcomeLabel("replied") !== "replied" || TL.outcomeLabel("sent") !== "awaiting reply") return { pass: false, detail: "outcome label wrong" };
    if (TL.outcomeLabel("needs follow-up") !== "needs follow-up") return { pass: false, detail: "needs follow-up label wrong" };
    if (!TL.isOverdue({ status: "open", dueDate: "2020-01-01T00:00:00.000Z" })) return { pass: false, detail: "overdue not detected" };
    if (TL.isOverdue({ status: "open", dueDate: "2999-01-01T00:00:00.000Z" })) return { pass: false, detail: "future flagged overdue" };
    if (TL.isOverdue({ status: "done", dueDate: "2020-01-01T00:00:00.000Z" })) return { pass: false, detail: "done flagged overdue" };
    if (!TL.activityMatchesScope({ dealId: "d-1" }, { dealId: "d-1" })) return { pass: false, detail: "scope match failed" };
    if (TL.activityMatchesScope({ dealId: "d-2" }, { dealId: "d-1" })) return { pass: false, detail: "scope leak on match" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(TL.localDateString(new Date()))) return { pass: false, detail: "localDateString malformed" };
    return { pass: true, detail: "helper functions verified" };
  });
})();
