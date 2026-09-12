(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const A = window.CRM_ACTIVITIES;
  if (!T || !BS || !R || !A) return;

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
    const ns = "ac" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  function seedBase(store) {
    return store.saveChecked("companies", { records: [{ id: "c-1", name: "Acme Industries" }] }, { expectedBase: 0 }).then(() =>
      store.saveChecked("contacts", { records: [{ id: "ct-1", name: "Pat Smith", companyId: "c-1", email: "pat@acme.example" }] }, { expectedBase: 0 }).then(() =>
        store.saveChecked("deals", { records: [{ id: "d-1", name: "Acme licence", companyId: "c-1", stage: "qualification" }] }, { expectedBase: 0 })
      )
    );
  }

  T.register("activities: validation covers type, subject, at, duration, due date and email address", async () => {
    const empty = A.validate({});
    if (empty.ok || !empty.errors.type || !empty.errors.subject || !empty.errors.at) {
      return { pass: false, detail: "blank activity not rejected: " + JSON.stringify(empty.errors) };
    }
    const badType = A.validate({ type: "carrier-pigeon", subject: "x", at: "2026-09-01T10:00" });
    if (badType.ok || !badType.errors.type) return { pass: false, detail: "unknown type accepted" };
    const badDur = A.validate({ type: "call", subject: "x", at: "2026-09-01T10:00", durationMin: "9000" });
    if (badDur.ok || !badDur.errors.durationMin) return { pass: false, detail: "huge duration accepted" };
    const badEmail = A.validate({ type: "email", subject: "x", at: "2026-09-01T10:00", to: "not-an-address" });
    if (badEmail.ok || !badEmail.errors.to) return { pass: false, detail: "bad email address accepted" };
    const badAt = A.validate({ type: "note", subject: "x", at: "not-a-date" });
    if (badAt.ok || !badAt.errors.at) return { pass: false, detail: "bad timestamp accepted" };
    const good = A.validate({ type: "call", subject: "  Discovery call  ", at: "2026-09-01T10:00", durationMin: "45.7", owner: "  ", notes: "talked" });
    if (!good.ok) return { pass: false, detail: "valid call rejected: " + JSON.stringify(good.errors) };
    if (good.values.subject !== "Discovery call" || good.values.durationMin !== 46) {
      return { pass: false, detail: "trim/round wrong: " + JSON.stringify(good.values) };
    }
    if (good.values.owner !== undefined) return { pass: false, detail: "blank owner not cleared" };
    const task = A.validate({ type: "task", subject: "Send pricing", at: "2026-09-01T10:00", dueDate: "2026-10-05", priority: "high" });
    if (!task.ok) return { pass: false, detail: "valid task rejected: " + JSON.stringify(task.errors) };
    const dd = new Date(task.values.dueDate);
    if (dd.getFullYear() !== 2026 || dd.getMonth() !== 9 || dd.getDate() !== 5) {
      return { pass: false, detail: "due date shifted: " + task.values.dueDate };
    }
    if (task.values.priority !== "high") return { pass: false, detail: "priority not kept" };
    const nonTask = A.validate({ type: "email", subject: "Hi", at: "2026-09-01T10:00", to: "pat@acme.example" });
    if (nonTask.values.dueDate !== null || nonTask.values.priority !== undefined) return { pass: false, detail: "task fields leaked into email" };
    return { pass: true, detail: "validate covers all activity shapes" };
  });

  T.register("activities: create persists trimmed record with links and defaults", async () => {
    const env = mockEnv();
    await seedBase(env.store);
    const res = await A.create(env.store, {
      type: "meeting", subject: "  Kickoff with Pat  ", at: "2026-08-20T09:30", durationMin: "45",
      companyId: "c-1", contactId: "ct-1", dealId: "d-1", owner: "Sasha Chen", notes: "Show roadmap."
    });
    if (!res || !res.ok) return { pass: false, detail: "create failed: " + JSON.stringify(res) };
    const doc = await env.store.loadDoc("activities", { refresh: true });
    const rec = doc && doc.content && doc.content.records ? doc.content.records[0] : null;
    if (!rec) return { pass: false, detail: "no record persisted" };
    if (!String(rec.id).startsWith("a-")) return { pass: false, detail: "bad id prefix: " + rec.id };
    if (rec.subject !== "Kickoff with Pat" || rec.type !== "meeting" || rec.durationMin !== 45) return { pass: false, detail: "record fields wrong: " + JSON.stringify(rec) };
    if (rec.companyId !== "c-1" || rec.contactId !== "ct-1" || rec.dealId !== "d-1" || rec.owner !== "Sasha Chen") return { pass: false, detail: "links wrong" };
    if (!rec.createdAt || !rec.at) return { pass: false, detail: "timestamps missing" };
    const okNoOwner = await A.create(env.store, { type: "note", subject: "Thought", at: "2026-08-21T10:00" });
    if (!okNoOwner.ok) return { pass: false, detail: "unowned note rejected" };
    const doc2 = await env.store.loadDoc("activities", { refresh: true });
    const rec2 = doc2.content.records.find(r => r.type === "note");
    if (rec2.owner !== undefined || "owner" in rec2) return { pass: false, detail: "owner key left behind" };
    return { pass: true, detail: "create + defaults verified" };
  });

  T.register("activities: task state transitions and email outcomes update in place", async () => {
    const env = mockEnv();
    await A.create(env.store, { type: "task", subject: "Send proposal", at: "2026-09-01T10:00", dueDate: "2026-09-10", priority: "high", owner: "Sasha Chen" });
    const doc = await env.store.loadDoc("activities", { refresh: true });
    const id = doc.content.records[0].id;
    let done = await A.setTaskState(env.store, id, true, "Me");
    if (!done.ok) return { pass: false, detail: "setTaskState failed" };
    let d2 = await env.store.loadDoc("activities", { refresh: true });
    const r1 = d2.content.records[0];
    if (r1.status !== "done" || !r1.completedAt || r1.completedBy !== "Me") return { pass: false, detail: "done state wrong: " + JSON.stringify(r1) };
    await A.setTaskState(env.store, id, false);
    d2 = await env.store.loadDoc("activities", { refresh: true });
    const r2 = d2.content.records[0];
    if (r2.status !== "open" || r2.completedAt || r2.completedBy) return { pass: false, detail: "reopen left state: " + JSON.stringify(r2) };
    await A.create(env.store, { type: "email", subject: "Intro", at: "2026-09-02T10:00", to: "pat@acme.example", outcome: "sent" });
    d2 = await env.store.loadDoc("activities", { refresh: true });
    const eid = d2.content.records.find(r => r.type === "email").id;
    await A.setEmailOutcome(env.store, eid, "replied");
    d2 = await env.store.loadDoc("activities", { refresh: true });
    const e1 = d2.content.records.find(r => r.type === "email");
    if (e1.outcome !== "replied" || !e1.repliedAt) return { pass: false, detail: "reply outcome wrong: " + JSON.stringify(e1) };
    await A.setEmailOutcome(env.store, eid, "sent");
    d2 = await env.store.loadDoc("activities", { refresh: true });
    const e2 = d2.content.records.find(r => r.type === "email");
    if (e2.outcome !== "sent" || e2.repliedAt) return { pass: false, detail: "reply not cleared: " + JSON.stringify(e2) };
    return { pass: true, detail: "task + email transitions verified" };
  });

  T.register("activities: remove deletes only the target record", async () => {
    const env = mockEnv();
    await A.create(env.store, { type: "note", subject: "Keep me", at: "2026-09-01T10:00" });
    await A.create(env.store, { type: "note", subject: "Delete me", at: "2026-09-01T11:00" });
    const doc = await env.store.loadDoc("activities", { refresh: true });
    const target = doc.content.records.find(r => r.subject === "Delete me");
    const res = await A.remove(env.store, target.id);
    if (!res.ok) return { pass: false, detail: "remove failed" };
    const doc2 = await env.store.loadDoc("activities", { refresh: true });
    const subs = doc2.content.records.map(r => r.subject);
    if (subs.length !== 1 || subs[0] !== "Keep me") return { pass: false, detail: "remove wrong: " + subs.join(",") };
    return { pass: true, detail: "remove verified" };
  });

  T.register("activities: overdue distinguishes past open tasks", () => {
    const past = "2020-01-01T00:00:00.000Z";
    const future = "2999-01-01T00:00:00.000Z";
    if (!A.overdue({ type: "task", status: "open", dueDate: past })) return { pass: false, detail: "past open task not overdue" };
    if (A.overdue({ type: "task", status: "open", dueDate: future })) return { pass: false, detail: "future task flagged overdue" };
    if (A.overdue({ type: "task", status: "done", dueDate: past })) return { pass: false, detail: "completed task flagged overdue" };
    if (A.overdue({ type: "task", status: "open" })) return { pass: false, detail: "dateless task flagged overdue" };
    if (A.overdue({ type: "call", status: "open", dueDate: past })) return { pass: false, detail: "non-task flagged overdue" };
    return { pass: true, detail: "overdue logic verified" };
  });

  T.register("activities: canDelete reports references found in other modules", async () => {
    const env = mockEnv();
    await seedBase(env.store);
    await A.create(env.store, { type: "call", subject: "Hi", at: "2026-09-01T10:00", dealId: "d-1" });
    const doc = await env.store.loadDoc("activities", { refresh: true });
    const id = doc.content.records[0].id;
    const cd = await A.canDelete(env.store, id);
    if (!cd || cd.allowed !== true) return { pass: false, detail: "unreferenced activity not deletable" };
    return { pass: true, detail: "canDelete verified" };
  });
})();
