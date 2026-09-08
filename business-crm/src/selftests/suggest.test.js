(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const S = window.CRM_SUGGEST;
  if (!T || !BS || !R || !S) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];
  const DAY = 86400000;

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
    const ns = "sg" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  function daysAgo(n) {
    return new Date(Date.now() - n * DAY).toISOString();
  }

  function dealRec(over) {
    return Object.assign({
      id: "d-1", name: "Acme licence", companyId: "c-1", contactId: "ct-1", owner: "Sasha Chen",
      stage: "qualification", stageEnteredAt: daysAgo(10), expectedValue: 24000,
      createdAt: daysAgo(30)
    }, over || {});
  }

  function leadRec(over) {
    return Object.assign({
      id: "l-1", name: "Northwind pilot", companyId: "c-1", contactId: "ct-1", owner: "Sasha Chen",
      status: "qualified", createdAt: daysAgo(30)
    }, over || {});
  }

  async function seed(store, rec, acts) {
    await store.saveChecked("companies", { records: [{ id: "c-1", name: "Acme Industries" }] }, { expectedBase: 0 });
    await store.saveChecked("contacts", { records: [{ id: "ct-1", name: "Pat Smith", companyId: "c-1" }] }, { expectedBase: 0 });
    if (rec.stage !== undefined) await store.saveChecked("deals", { records: [rec] }, { expectedBase: 0 });
    else await store.saveChecked("leads", { records: [rec] }, { expectedBase: 0 });
    await store.saveChecked("activities", { records: acts }, { expectedBase: 0 });
  }

  T.register("suggest: remind rule fires after an unanswered old email and names the contact", async () => {
    const env = mockEnv();
    const rec = dealRec();
    await seed(env.store, rec, [{ id: "a-1", type: "email", subject: "Pricing attached", at: daysAgo(8), to: "pat@acme.example", outcome: "sent", contactId: "ct-1", companyId: "c-1", dealId: "d-1" }]);
    const sug = await S.evaluate(env.store, rec);
    if (!sug || sug.rule !== "remind") return { pass: false, detail: "remind not offered: " + JSON.stringify(sug) };
    if (!sug.title.includes("Pat Smith")) return { pass: false, detail: "contact name missing from title" };
    if (sug.priority !== "high" || sug.dueInDays !== 1) return { pass: false, detail: "remind params wrong" };
    const afterDismiss = Object.assign({}, rec, { dismissedNext: [{ rule: "remind", at: daysAgo(8) }] });
    const gone = await S.evaluate(env.store, afterDismiss);
    if (gone) return { pass: false, detail: "dismissed remind re-offered" };
    return { pass: true, detail: "remind rule verified" };
  });

  T.register("suggest: followup rule fires after the latest call or meeting", async () => {
    const env = mockEnv();
    const rec = leadRec();
    await seed(env.store, rec, [
      { id: "a-1", type: "call", subject: "Intro call", at: daysAgo(2), owner: "Sasha Chen", contactId: "ct-1", leadId: "l-1" }
    ]);
    const sug = await S.evaluate(env.store, rec);
    if (!sug || sug.rule !== "followup") return { pass: false, detail: "followup not offered: " + JSON.stringify(sug) };
    if (sug.dueInDays !== 3 || sug.priority !== "med") return { pass: false, detail: "followup params wrong" };
    const meeting = Object.assign({}, rec, { dismissedNext: [{ rule: "followup", at: daysAgo(2) }] });
    const gone = await S.evaluate(env.store, meeting);
    if (gone) return { pass: false, detail: "dismissed followup re-offered" };
    return { pass: true, detail: "followup rule verified" };
  });

  T.register("suggest: touchbase fires for quiet records, setclose when a deal lacks a close date", async () => {
    const env = mockEnv();
    const rec = dealRec({ stageEnteredAt: daysAgo(20), closeDate: undefined });
    await seed(env.store, rec, []);
    const sug = await S.evaluate(env.store, rec);
    if (!sug) return { pass: false, detail: "quiet deal got no suggestion" };
    if (sug.rule !== "touchbase") return { pass: false, detail: "expected touchbase, got " + sug.rule };
    const withClose = dealRec({ stageEnteredAt: daysAgo(1), createdAt: daysAgo(2) });
    const env2 = mockEnv();
    await seed(env2.store, withClose, [{ id: "a-9", type: "note", subject: "Just talked", at: daysAgo(1), dealId: "d-1", companyId: "c-1" }]);
    const sug2 = await S.evaluate(env2.store, withClose);
    if (!sug2 || sug2.rule !== "setclose") return { pass: false, detail: "setclose not offered: " + JSON.stringify(sug2) };
    return { pass: true, detail: "touchbase + setclose rules verified" };
  });

  T.register("suggest: accept creates a linked task due soon and dismiss persists", async () => {
    const env = mockEnv();
    const rec = dealRec({ stage: "proposal", createdAt: daysAgo(30), stageEnteredAt: daysAgo(12) });
    await seed(env.store, rec, [
      { id: "a-1", type: "meeting", subject: "Demo", at: daysAgo(2), owner: "Sasha Chen", contactId: "ct-1", companyId: "c-1", dealId: "d-1" }
    ]);
    const sug = await S.evaluate(env.store, rec);
    if (!sug) return { pass: false, detail: "no suggestion to accept" };
    const res = await S.accept(env.store, rec, sug);
    if (!res || !res.ok) return { pass: false, detail: "accept failed: " + JSON.stringify(res) };
    const adoc = await env.store.loadDoc("activities", { refresh: true });
    const task = adoc.content.records.find(r => r.type === "task");
    if (!task) return { pass: false, detail: "no task created" };
    if (task.dealId !== "d-1" || task.contactId !== "ct-1" || task.companyId !== "c-1") return { pass: false, detail: "task links wrong: " + JSON.stringify(task) };
    if (task.owner !== "Sasha Chen" || task.status !== "open") return { pass: false, detail: "task meta wrong" };
    if (!task.dueDate) return { pass: false, detail: "no due date on accepted task" };
    const drift = new Date(task.dueDate).getTime() - (Date.now() + sug.dueInDays * DAY);
    if (Math.abs(drift) > DAY) return { pass: false, detail: "due date drift: " + task.dueDate };
    const dismissed = await S.dismiss(env.store, rec, sug.rule);
    if (!dismissed.ok) return { pass: false, detail: "dismiss failed" };
    const ddoc = await env.store.loadDoc("deals", { refresh: true });
    const stored = ddoc.content.records[0];
    if (!stored.dismissedNext || stored.dismissedNext.length !== 1 || stored.dismissedNext[0].rule !== sug.rule) {
      return { pass: false, detail: "dismissal not persisted: " + JSON.stringify(stored.dismissedNext) };
    }
    return { pass: true, detail: "accept + dismiss verified" };
  });

  T.register("suggest: closed or converted records never suggest", async () => {
    const env = mockEnv();
    const won = dealRec({ stage: "won", closeDate: "2026-08-01" });
    await seed(env.store, won, []);
    const s1 = await S.evaluate(env.store, won);
    if (s1) return { pass: false, detail: "won deal suggested: " + JSON.stringify(s1) };
    const env2 = mockEnv();
    const disq = leadRec({ status: "disqualified", disqualifiedAt: daysAgo(3) });
    await seed(env2.store, disq, []);
    const s2 = await S.evaluate(env2.store, disq);
    if (s2) return { pass: false, detail: "disqualified lead suggested: " + JSON.stringify(s2) };
    const env3 = mockEnv();
    const converted = leadRec({ status: "converted", convertedToDealId: "d-9" });
    await seed(env3.store, converted, []);
    const s3 = await S.evaluate(env3.store, converted);
    if (s3) return { pass: false, detail: "converted lead suggested: " + JSON.stringify(s3) };
    return { pass: true, detail: "closed records stay quiet" };
  });

  T.register("suggest: activity from a shared contact or company counts for the record", async () => {
    const env = mockEnv();
    const rec = leadRec({ status: "contacted", createdAt: daysAgo(40) });
    await seed(env.store, rec, [
      { id: "a-1", type: "call", subject: "Linked by contact only", at: daysAgo(1), contactId: "ct-1" }
    ]);
    const sug = await S.evaluate(env.store, rec);
    if (!sug || sug.rule !== "followup") return { pass: false, detail: "contact-shared activity not counted: " + JSON.stringify(sug) };
    return { pass: true, detail: "shared-link scoping verified" };
  });
})();
