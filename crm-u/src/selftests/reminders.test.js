(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const RM = window.CRM_REMINDERS;
  const A = window.CRM_ACTIVITIES;
  if (!T || !BS || !R || !RM || !A) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports", "services", "sites", "assets", "tickets"];
  const DAY = 86400000;

  function mockEnv() {
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
    const store = BS.create({ ns: "rm" + BS.randHex(6), kv, editable, modules: ALL_MODULES.slice() });
    return { kv, kvStore, editable, store };
  }

  const iso = d => d.toISOString();
  const daysFromNow = n => iso(new Date(Date.now() + n * DAY));
  const dateISO = RM.localDateISO ? RM.localDateISO(new Date()) : new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => RM.addDaysISO(d, n);

  function taskRec(over) {
    return Object.assign({
      id: "a-" + BS.randHex(6),
      type: "task",
      subject: "Send proposal",
      at: daysFromNow(-2),
      status: "open",
      priority: "med",
      dueDate: addDays(dateISO, 3),
      owner: "Sasha Chen",
      companyId: "c-1",
      contactId: "ct-1",
      dealId: "d-1"
    }, over || {});
  }

  function dealRec(over) {
    return Object.assign({
      id: "d-" + BS.randHex(6),
      name: "Acme licence",
      stage: "proposal",
      owner: "Sasha Chen",
      expectedValue: 24000,
      probability: 60,
      closeDate: addDays(dateISO, 5),
      companyId: "c-1",
      createdAt: daysFromNow(-20)
    }, over || {});
  }

  async function seedBase(env, tasks, deals, leads, extra) {
    extra = extra || {};
    await env.store.saveChecked("companies", { records: [{ id: "c-1", name: "Acme Industries" }] }, { expectedBase: 0 });
    await env.store.saveChecked("contacts", { records: [{ id: "ct-1", name: "Pat Smith", companyId: "c-1" }] }, { expectedBase: 0 });
    await env.store.saveChecked("activities", { records: tasks || [] }, { expectedBase: 0 });
    await env.store.saveChecked("deals", { records: deals || [] }, { expectedBase: 0 });
    await env.store.saveChecked("leads", { records: leads || [] }, { expectedBase: 0 });
    if (extra.services) await env.store.saveChecked("services", { records: extra.services }, { expectedBase: 0 });
    if (extra.tickets) await env.store.saveChecked("tickets", { records: extra.tickets }, { expectedBase: 0 });
    if (extra.assets) await env.store.saveChecked("assets", { records: extra.assets }, { expectedBase: 0 });
    if (extra.sites) await env.store.saveChecked("sites", { records: extra.sites }, { expectedBase: 0 });
  }

  async function actDocs(env) {
    const doc = await env.store.loadDoc("activities");
    return R.recordsOf(doc && doc.content);
  }

  T.register("reminders: open tasks due within 7 days surface; done, dateless, snoozed or dismissed do not", async () => {
    const env = mockEnv();
    const dueSoon = taskRec({ dueDate: addDays(dateISO, 2) });
    const overdue = taskRec({ subject: "Overdue call", dueDate: addDays(dateISO, -4) });
    await seedBase(env, [
      dueSoon,
      overdue,
      taskRec({ subject: "Done task", status: "done", completedAt: daysFromNow(-1) }),
      taskRec({ subject: "No due date", dueDate: null }),
      taskRec({ subject: "Far future", dueDate: addDays(dateISO, 40) }),
      taskRec({ subject: "Snoozed", snoozedUntil: addDays(dateISO, 9) }),
      taskRec({ subject: "Dismissed task", dismissed: { at: daysFromNow(-1), by: "me", reason: "not needed" } })
    ], []);
    const items = await RM.collect(env.store);
    const ids = items.map(i => i.rec.id);
    if (!ids.includes(dueSoon.id) || !ids.includes(overdue.id)) return { pass: false, detail: "expected tasks missing: " + ids.join(",") };
    for (const bad of ["Done task", "No due date", "Far future", "Snoozed", "Dismissed task"]) {
      if (items.some(i => i.rec.subject === bad)) return { pass: false, detail: "should not appear: " + bad };
    }
    const od = items.find(i => i.rec.id === overdue.id);
    if (!od.overdue) return { pass: false, detail: "past-due task not flagged overdue" };
    const ok = items.find(i => i.rec.id === dueSoon.id);
    if (ok.overdue) return { pass: false, detail: "future task wrongly overdue" };
    return { pass: true, detail: items.length + " reminders; overdue + due-soon both present" };
  });

  T.register("reminders: snooze defers until the chosen day, then the task resurfaces", async () => {
    const env = mockEnv();
    const t = taskRec();
    await seedBase(env, [t], []);
    const snoozed = await RM.snoozeItem(env.store, { kind: "task", id: t.id, rec: t }, addDays(dateISO, 5));
    if (!snoozed.ok) return { pass: false, detail: "snooze failed: " + JSON.stringify(snoozed) };
    let items = await RM.collect(env.store);
    if (items.length) return { pass: false, detail: "snoozed task still visible" };
    const doc = await env.store.loadDoc("activities", { refresh: true });
    const stored = R.getRecord(doc.content, t.id);
    if (!stored.snoozedUntil) return { pass: false, detail: "snoozedUntil not persisted" };
    const env2 = mockEnv();
    await seedBase(env2, [taskRec({ id: t.id, snoozedUntil: addDays(dateISO, -1) })], []);
    items = await RM.collect(env2.store);
    if (!items.some(i => i.rec.id === t.id)) return { pass: false, detail: "expired snooze did not resurface" };
    const notes = (await actDocs(env)).filter(a => a.type === "note" && a.subject.indexOf("Snoozed follow-up") === 0);
    if (!notes.length) return { pass: false, detail: "no snooze note logged" };
    if (notes[0].dealId !== "d-1") return { pass: false, detail: "note lost its deal link" };
    return { pass: true, detail: "snooze persisted, hidden, resurfaced, note logged" };
  });

  T.register("reminders: reschedule moves the due date and clears a snooze; reassign changes the owner", async () => {
    const env = mockEnv();
    const t = taskRec({ snoozedUntil: addDays(dateISO, 4) });
    await seedBase(env, [t], []);
    const item = { kind: "task", id: t.id, rec: t };
    const res = await RM.rescheduleItem(env.store, item, addDays(dateISO, 10));
    if (!res.ok) return { pass: false, detail: "reschedule failed" };
    const doc = await env.store.loadDoc("activities", { refresh: true });
    let stored = R.getRecord(doc.content, t.id);
    if (stored.dueDate !== addDays(dateISO, 10)) return { pass: false, detail: "due date unchanged" };
    if (stored.snoozedUntil) return { pass: false, detail: "snooze not cleared by reschedule" };
    const items = await RM.collect(env.store);
    if (items.length) return { pass: false, detail: "rescheduled 10 days out still visible" };
    const re = await RM.reassignItem(env.store, { kind: "task", id: t.id, rec: stored }, "Jordan Lee");
    if (!re.ok) return { pass: false, detail: "reassign failed" };
    const doc2 = await env.store.loadDoc("activities", { refresh: true });
    stored = R.getRecord(doc2.content, t.id);
    if (stored.owner !== "Jordan Lee") return { pass: false, detail: "owner not changed" };
    const notes = (await actDocs(env)).filter(a => a.type === "note");
    const subs = notes.map(n => n.subject).join(" | ");
    if (subs.indexOf("Rescheduled") === -1 || subs.indexOf("Reassigned") === -1) return { pass: false, detail: "missing notes: " + subs };
    return { pass: true, detail: "reschedule + reassign verified with notes" };
  });

  T.register("reminders: dismiss-with-reason hides the reminder, is listed as dismissed and can be restored", async () => {
    const env = mockEnv();
    const t = taskRec();
    await seedBase(env, [t], []);
    const res = await RM.dismissItem(env.store, { kind: "task", id: t.id, rec: t }, "client on holiday until next quarter");
    if (!res.ok) return { pass: false, detail: "dismiss failed: " + JSON.stringify(res) };
    let items = await RM.collect(env.store);
    if (items.length) return { pass: false, detail: "dismissed task still collected" };
    const dism = await RM.dismissedItems(env.store);
    if (!dism.some(d => d.kind === "task" && d.id === t.id)) return { pass: false, detail: "not listed under dismissed" };
    if (!String(dism[0].dismissed.reason).length) return { pass: false, detail: "reason missing" };
    const restored = await RM.restoreItem(env.store, dism.find(d => d.id === t.id));
    if (!restored.ok) return { pass: false, detail: "restore failed" };
    items = await RM.collect(env.store);
    if (!items.some(i => i.id === t.id)) return { pass: false, detail: "restored task not back" };
    const notes = (await actDocs(env)).filter(a => a.type === "note" && a.subject.indexOf("Dismissed follow-up") === 0);
    if (!notes.length) return { pass: false, detail: "dismiss note missing" };
    return { pass: true, detail: "dismiss + restore + note verified" };
  });

  T.register("reminders: open deals closing within 7 days surface; closed, dateless and dismissed deals do not", async () => {
    const env = mockEnv();
    const closing = dealRec({ name: "Closing soon" });
    const overdue = dealRec({ name: "Overdue close", closeDate: addDays(dateISO, -2) });
    await seedBase(env, [], [
      closing,
      overdue,
      dealRec({ name: "Won", stage: "won", closeDate: addDays(dateISO, 2) }),
      dealRec({ name: "Lost", stage: "lost", closeDate: addDays(dateISO, 2) }),
      dealRec({ name: "No close date", closeDate: null }),
      dealRec({ name: "Far out", closeDate: addDays(dateISO, 30) }),
      dealRec({ name: "Dismissed close", closeReminderDismissed: { at: daysFromNow(-1), by: "me", reason: "waiting on budget" } })
    ], []);
    const items = await RM.collect(env.store);
    const names = items.map(i => i.rec.name);
    for (const bad of ["Won", "Lost", "No close date", "Far out", "Dismissed close"]) {
      if (names.indexOf(bad) !== -1) return { pass: false, detail: "deal should not remind: " + bad };
    }
    if (names.indexOf("Closing soon") === -1 || names.indexOf("Overdue close") === -1) return { pass: false, detail: "expected deals missing: " + names.join(",") };
    return { pass: true, detail: items.length + " deal reminders" };
  });

  T.register("reminders: deal reminders support snooze, reschedule and dismiss with logged notes", async () => {
    const env = mockEnv();
    const d = dealRec();
    await seedBase(env, [], [d]);
    const item = { kind: "deal", id: d.id, rec: d };
    const snoozed = await RM.snoozeItem(env.store, item, addDays(dateISO, 6));
    if (!snoozed.ok) return { pass: false, detail: "deal snooze failed" };
    let items = await RM.collect(env.store);
    if (items.length) return { pass: false, detail: "snoozed deal still visible" };
    const doc = await env.store.loadDoc("deals", { refresh: true });
    let stored = R.getRecord(doc.content, d.id);
    if (stored.closeReminderAfter !== addDays(dateISO, 6)) return { pass: false, detail: "closeReminderAfter not set" };
    const res = await RM.rescheduleItem(env.store, { kind: "deal", id: d.id, rec: stored }, addDays(dateISO, 20));
    if (!res.ok) return { pass: false, detail: "deal reschedule failed" };
    const doc2 = await env.store.loadDoc("deals", { refresh: true });
    stored = R.getRecord(doc2.content, d.id);
    if (stored.closeDate !== addDays(dateISO, 20) || stored.closeReminderAfter) return { pass: false, detail: "closeDate/reschedule state wrong" };
    const dism = await RM.dismissItem(env.store, { kind: "deal", id: d.id, rec: stored }, "deal on hold");
    if (!dism.ok) return { pass: false, detail: "deal dismiss failed" };
    const dismList = await RM.dismissedItems(env.store);
    if (!dismList.some(x => x.kind === "deal" && x.id === d.id)) return { pass: false, detail: "dismissed deal not listed" };
    const notes = (await actDocs(env)).filter(a => a.type === "note");
    const subs = notes.map(n => n.subject).join(" | ");
    if (subs.indexOf("Snoozed close-date") === -1 || subs.indexOf("Rescheduled close") === -1 || subs.indexOf("Dismissed close-date") === -1) {
      return { pass: false, detail: "missing deal notes: " + subs };
    }
    return { pass: true, detail: "deal snooze/reschedule/dismiss all logged" };
  });

  T.register("reminders: reject a dismiss without a reason and an invalid snooze date", async () => {
    const env = mockEnv();
    const t = taskRec();
    await seedBase(env, [t], []);
    const item = { kind: "task", id: t.id, rec: t };
    const noReason = await RM.dismissItem(env.store, item, "   ");
    if (noReason.ok || !noReason.errors || !noReason.errors.reason) return { pass: false, detail: "empty reason accepted" };
    const badSnooze = await RM.snoozeItem(env.store, item, addDays(dateISO, -3));
    if (badSnooze.ok) return { pass: false, detail: "past snooze date accepted" };
    const stillThere = await RM.collect(env.store);
    if (!stillThere.length) return { pass: false, detail: "failed actions still hid the reminder" };
    return { pass: true, detail: "validation enforced, reminder untouched" };
  });

  T.register("reminders: digest groups today's due, overdue, soon, closing deals and new leads, and renders a text bundle", async () => {
    const env = mockEnv();
    const todayTask = taskRec({ subject: "Due today", dueDate: dateISO });
    const overdue = taskRec({ subject: "Digest overdue", dueDate: addDays(dateISO, -1) });
    const soon = taskRec({ subject: "Digest soon", dueDate: addDays(dateISO, 4) });
    const far = taskRec({ subject: "Digest far", dueDate: addDays(dateISO, 30) });
    const closing = dealRec({ name: "Digest closing", closeDate: addDays(dateISO, 3) });
    const oldLead = { id: "l-" + BS.randHex(6), name: "Old lead", status: "new", owner: "Sam", createdAt: daysFromNow(-5) };
    const newLead = { id: "l-" + BS.randHex(6), name: "Fresh lead", status: "new", owner: "Sam", source: "Website", createdAt: daysFromNow(0) };
    const newQualified = { id: "l-" + BS.randHex(6), name: "Qualified today", status: "qualified", owner: "Rio", createdAt: daysFromNow(0) };
    await seedBase(env, [todayTask, overdue, soon, far], [closing], [oldLead, newLead, newQualified]);
    const d = await RM.digest(env.store);
    if (d.overdue.length !== 1 || d.dueToday.length !== 1 || d.dueSoon.length !== 1) {
      return { pass: false, detail: "group counts wrong: o" + d.overdue.length + " t" + d.dueToday.length + " s" + d.dueSoon.length };
    }
    if (d.closing.length !== 1) return { pass: false, detail: "closing count wrong" };
    if (d.newLeads.length !== 2) return { pass: false, detail: "expected 2 new leads, got " + d.newLeads.length };
    const emptyMaps = { companies: new Map(), contacts: new Map(), deals: new Map(), leads: new Map() };
    const text = RM.digestText(d, emptyMaps);
    if (text.indexOf("Overdue follow-ups (1)") === -1) return { pass: false, detail: "text bundle missing overdue header" };
    if (text.indexOf("Due today (1)") === -1) return { pass: false, detail: "text bundle missing due-today header" };
    if (text.indexOf("Due today") !== -1 && text.indexOf("Due in the next 7 days (1)") === -1) return { pass: false, detail: "text bundle missing soon header" };
    if (text.indexOf("Deals closing or overdue to close (1)") === -1) return { pass: false, detail: "text bundle missing closing header" };
    if (text.indexOf("New leads (2)") === -1) return { pass: false, detail: "text bundle missing new-leads header" };
    if (text.indexOf("Digest overdue") === -1 || text.indexOf("Fresh lead") === -1) return { pass: false, detail: "text bundle missing item names" };
    return { pass: true, detail: "digest grouped " + (d.followupCount + d.closingCount) + " items + " + d.newLeads.length + " new leads; bundle verified" };
  });

  function svcRec(over) {
    return Object.assign({
      id: "sv-" + BS.randHex(6),
      name: "Business fibre",
      companyId: "c-1",
      category: "internet",
      status: "active",
      charge: 500,
      billingCycle: "monthly",
      endDate: addDays(dateISO, 25)
    }, over || {});
  }

  T.register("reminders: service renewals, ticket SLA and warranty alerts populate the panel and the digest", async () => {
    const env = mockEnv();
    const soonSvc = svcRec({ name: "Business fibre" });
    const farSvc = svcRec({ name: "Long contract", endDate: addDays(dateISO, 300) });
    const termSvc = svcRec({ name: "Cancelled circuit", status: "terminated", endDate: addDays(dateISO, 5) });
    const propSvc = svcRec({ name: "Prospect fibre", status: "prospect", endDate: addDays(dateISO, 5) });
    const overdueTicket = { id: "tk-1", subject: "Router down", companyId: "c-1", priority: "urgent", status: "open", openedAt: daysFromNow(-3) };
    const healthyTicket = { id: "tk-2", subject: "Password reset", companyId: "c-1", priority: "low", status: "new", openedAt: daysFromNow(0) };
    const closedTicket = { id: "tk-3", subject: "Old issue", companyId: "c-1", priority: "urgent", status: "closed", openedAt: daysFromNow(-9), resolvedAt: daysFromNow(-9) };
    const warrantyAsset = { id: "as-1", kind: "cpe", identifier: "CPE-100", companyId: "c-1", status: "assigned", warrantyEnd: addDays(dateISO, 30) };
    const freshAsset = { id: "as-2", kind: "cpe", identifier: "CPE-200", companyId: "c-1", status: "assigned", warrantyEnd: addDays(dateISO, 500) };
    await seedBase(env, [], [], [], {
      services: [soonSvc, farSvc, termSvc, propSvc],
      tickets: [overdueTicket, healthyTicket, closedTicket],
      assets: [warrantyAsset, freshAsset]
    });
    const al = await RM.alerts(env.store);
    if (al.renewals.length !== 1 || al.renewals[0].id !== soonSvc.id) return { pass: false, detail: "renewal alerts wrong: " + al.renewals.map(r => r.rec.name).join(",") };
    if (al.sla.length !== 1 || al.sla[0].id !== overdueTicket.id) return { pass: false, detail: "SLA alerts wrong: " + al.sla.map(s => s.rec.subject).join(",") };
    if (al.warranties.length !== 1 || al.warranties[0].id !== warrantyAsset.id) return { pass: false, detail: "warranty alerts wrong: " + al.warranties.map(w => w.rec.identifier).join(",") };
    if (al.total !== 3) return { pass: false, detail: "alert total wrong: " + al.total };
    const d = await RM.digest(env.store);
    if (d.renewals.length !== 1 || d.sla.length !== 1 || d.warranties.length !== 1 || d.alertCount !== 3) {
      return { pass: false, detail: "digest alerts wrong: r" + d.renewals.length + " s" + d.sla.length + " w" + d.warranties.length + " t" + d.alertCount };
    }
    const maps = { companies: new Map([["c-1", { id: "c-1", name: "Acme Industries" }]]), contacts: new Map(), deals: new Map(), leads: new Map() };
    const text = RM.digestText(d, maps);
    for (const needle of ["Renewals due in the next 60 days (1)", "SLA at risk or breached (1)", "Warranties ending in the next 60 days (1)", "Business fibre", "Router down", "CPE-100"]) {
      if (text.indexOf(needle) === -1) return { pass: false, detail: "digest text missing: " + needle };
    }
    return { pass: true, detail: "alerts + digest sections verified (" + al.total + " alerts)" };
  });

  T.register("reminders: alerts exclude retired assets, far-off renewals and skip records with no dates", async () => {
    const env = mockEnv();
    const noDate = svcRec({ name: "No end date", endDate: "", contractTermMonths: 0 });
    const keep = { id: "as-7", kind: "cpe", identifier: "CPE-7", companyId: "c-1", status: "assigned", warrantyEnd: addDays(dateISO, 20) };
    const noWarranty = { id: "as-9", kind: "other", identifier: "X-1", companyId: "c-1" };
    const retiredLate = { id: "as-8", kind: "cpe", identifier: "CPE-8", companyId: "c-1", status: "retired", warrantyEnd: addDays(dateISO, 10) };
    await seedBase(env, [], [], [], { services: [noDate], assets: [keep, noWarranty, retiredLate] });
    const al = await RM.alerts(env.store);
    if (al.renewals.length !== 0) return { pass: false, detail: "expected no renewal alerts, got " + al.renewals.length };
    if (al.warranties.length !== 1 || al.warranties[0].id !== keep.id) return { pass: false, detail: "warranty filtering wrong: " + al.warranties.map(w => w.id).join(",") };
    const counts = await RM.alertCounts(env.store);
    if (counts.total !== al.total || counts.warranties !== 1) return { pass: false, detail: "alertCounts mismatch" };
    return { pass: true, detail: "undated, far and retired records excluded; counts consistent" };
  });
})();
