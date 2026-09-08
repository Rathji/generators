(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const RU = window.CRM_RULES;
  const A = window.CRM_ACTIVITIES;
  if (!T || !BS || !R || !RU || !A) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];
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
    const store = BS.create({ ns: "rl" + BS.randHex(6), kv, editable, modules: ALL_MODULES.slice() });
    return { kv, kvStore, editable, store };
  }

  const daysFromNow = n => new Date(Date.now() + n * DAY).toISOString();

  function stageRule(over) {
    return Object.assign({
      id: "ru-1",
      kind: "rule",
      name: "Proposal sent follow-up",
      module: "deals",
      event: "write",
      enabled: true,
      condition: { f: "stage", op: "changed_to", v: "proposal" },
      actions: [{ type: "task", subject: "Follow up on {name} in a week", dueIn: 7, priority: "high" }],
      createdAt: daysFromNow(-1),
      updatedAt: daysFromNow(-1)
    }, over || {});
  }

  async function seed(env, opts) {
    opts = opts || {};
    await env.store.saveChecked("companies", { records: opts.companies || [{ id: "c-1", name: "Acme Industries" }] }, { expectedBase: 0 });
    await env.store.saveChecked("contacts", { records: opts.contacts || [{ id: "ct-1", name: "Pat Smith", companyId: "c-1" }] }, { expectedBase: 0 });
    if (opts.deals) await env.store.saveChecked("deals", { records: opts.deals }, { expectedBase: 0 });
    if (opts.leads) await env.store.saveChecked("leads", { records: opts.leads }, { expectedBase: 0 });
    if (opts.activities) await env.store.saveChecked("activities", { records: opts.activities }, { expectedBase: 0 });
    if (opts.rules) {
      const res = await env.store.saveChecked("rules", { records: [], rules: opts.rules, execLog: [] }, { expectedBase: 0 });
      if (!res.ok) throw new Error("rules seed failed: " + JSON.stringify(res));
    }
  }

  async function docs(store, module) {
    const doc = await store.loadDoc(module, { refresh: true });
    return doc && doc.content ? doc.content : { records: [] };
  }

  T.register("rules: validate and persist rules; pause and delete them", async () => {
    const env = mockEnv();
    const good = RU.validateRule({ name: "Stage change", module: "deals", event: "write", condition: { f: "stage", op: "changed_to", v: "proposal" }, actions: [{ type: "task", subject: "Nudge", dueIn: 7 }] });
    if (!good.ok) return { pass: false, detail: "valid rule rejected: " + JSON.stringify(good.errors) };
    const bad = RU.validateRule({ name: "", module: "deals", event: "write", condition: { f: "stage", op: "changed_to", v: "proposal" }, actions: [] });
    if (bad.ok) return { pass: false, detail: "nameless/actionless rule accepted" };
    const scanWithChanged = RU.validateRule({ name: "x", module: "leads", event: "scan", condition: { f: "stage", op: "changed_to", v: "a" }, actions: [{ type: "note", text: "hi" }] });
    if (scanWithChanged.ok) return { pass: false, detail: "changed_to accepted on a scan rule" };
    await seed(env, { rules: [stageRule()] });
    const saved = await RU.saveRule(env.store, { id: "ru-2", name: "Quiet leads", module: "leads", event: "scan", condition: { f: "daysSinceLastActivity", op: "gt", v: 10 }, actions: [{ type: "note", subject: "Flag", text: "Lead quiet for {name}" }] });
    if (!saved.ok) return { pass: false, detail: "save failed: " + JSON.stringify(saved) };
    let list = await RU.docRules(env.store);
    if (list.length !== 2) return { pass: false, detail: "expected 2 rules, got " + list.length };
    const paused = await RU.setEnabled(env.store, "ru-1", false);
    if (!paused.ok) return { pass: false, detail: "pause failed" };
    list = await RU.docRules(env.store);
    if (list.find(r => r.id === "ru-1").enabled !== false) return { pass: false, detail: "enabled flag not persisted" };
    const del = await RU.deleteRule(env.store, "ru-2");
    if (!del.ok) return { pass: false, detail: "delete failed" };
    list = await RU.docRules(env.store);
    if (list.length !== 1) return { pass: false, detail: "rule not deleted" };
    return { pass: true, detail: "validate/persist/pause/delete all verified" };
  });

  T.register("rules: conditions match eq and numeric gt; stage changed_to fires only on a real change", async () => {
    const env = mockEnv();
    const base = { f: "expectedValue", op: "gt", v: 10000 };
    if (!RU.condMatches(base, "deals", { id: "d-1", expectedValue: 24000 }, null)) return { pass: false, detail: "24000 > 10000 should match" };
    if (RU.condMatches(base, "deals", { id: "d-1", expectedValue: 500 }, null)) return { pass: false, detail: "500 > 10000 should not match" };
    const eq = { f: "owner", op: "eq", v: "Sasha Chen" };
    if (!RU.condMatches(eq, "deals", { id: "d-1", owner: "sasha chen" }, null)) return { pass: false, detail: "case-insensitive eq failed" };
    const ct = { f: "stage", op: "changed_to", v: "proposal" };
    const rec = { id: "d-1", stage: "proposal" };
    if (!RU.condMatches(ct, "deals", rec, { id: "d-1", stage: "qualification" }, null)) return { pass: false, detail: "qualification→proposal should fire" };
    if (RU.condMatches(ct, "deals", rec, { id: "d-1", stage: "proposal" }, null)) return { pass: false, detail: "proposal→proposal must not fire" };
    if (!RU.condMatches(ct, "deals", rec, null, null)) return { pass: false, detail: "record created already at proposal should fire" };
    const cf = { f: "stage", op: "changed_from", v: "proposal" };
    if (!RU.condMatches(cf, "deals", { id: "d-1", stage: "negotiation" }, { id: "d-1", stage: "proposal" }, null)) return { pass: false, detail: "proposal→negotiation should match changed_from" };
    return { pass: true, detail: "condition semantics verified" };
  });

  T.register("rules: a saved deal entering the stage creates a templated follow-up task and logs the execution", async () => {
    const env = mockEnv();
    const rule = stageRule();
    const prev = { id: "d-1", name: "Acme licence", stage: "qualification", owner: "Sasha Chen", expectedValue: 24000, companyId: "c-1", createdAt: daysFromNow(-10) };
    const next = Object.assign({}, prev, { stage: "proposal" });
    await seed(env, { deals: [next], rules: [rule] });
    const res = await RU.fire(env.store, rule, next, prev, "write");
    if (!res) return { pass: false, detail: "rule did not fire" };
    if (!res.every(r => r.ok)) return { pass: false, detail: "action failed: " + JSON.stringify(res) };
    const acts = await docs(env.store, "activities");
    const task = acts.records.find(a => a.type === "task");
    if (!task) return { pass: false, detail: "no follow-up task created" };
    if (task.subject.indexOf("Acme licence") === -1) return { pass: false, detail: "template token not resolved: " + task.subject };
    if (task.dealId !== "d-1" || task.companyId !== "c-1") return { pass: false, detail: "task links wrong" };
    if (task.owner !== "Sasha Chen" || task.priority !== "high" || !task.dueDate) return { pass: false, detail: "task meta wrong" };
    const rules = await docs(env.store, "rules");
    const log = (rules.execLog || []).filter(e => e.ruleId === "ru-1");
    if (!log.length || !log[0].ok) return { pass: false, detail: "execution log missing or failed" };
    if (log[0].recordId !== "d-1") return { pass: false, detail: "exec log record ref wrong" };
    const again = await RU.fire(env.store, rule, next, prev, "write");
    if (again !== null) return { pass: false, detail: "changed_to re-fired on an unchanged pair" };
    return { pass: true, detail: "write rule created a task, logged it, and did not double-fire" };
  });

  T.register("rules: disabled rules never fire and the throttle skips an immediate repeat", async () => {
    const env = mockEnv();
    const rule = stageRule({ enabled: false });
    const next = { id: "d-1", name: "Acme", stage: "proposal", owner: "Sasha Chen" };
    await seed(env, { deals: [next], rules: [rule] });
    const res = await RU.fire(env.store, rule, next, null, "write");
    if (res !== null) return { pass: false, detail: "disabled rule fired" };
    const env2 = mockEnv();
    const rule2 = stageRule({ id: "ru-9" });
    const rec = { id: "d-2", name: "Beta", stage: "proposal", owner: "Sam" };
    await seed(env2, { deals: [rec], rules: [rule2] });
    const first = await RU.fire(env2.store, rule2, rec, null, "write");
    if (!first) return { pass: false, detail: "first fire failed" };
    const second = await RU.fire(env2.store, rule2, rec, null, "write");
    if (second !== null) return { pass: false, detail: "throttle did not stop immediate repeat" };
    const acts = await docs(env2.store, "activities");
    const tasks = acts.records.filter(a => a.type === "task");
    if (tasks.length !== 1) return { pass: false, detail: "duplicate task created: " + tasks.length };
    return { pass: true, detail: "disable + throttle verified" };
  });

  T.register("rules: a scan rule flags only leads quiet for 10+ days by logging a note", async () => {
    const env = mockEnv();
    const quiet = { id: "l-1", name: "Northwind pilot", status: "new", owner: "Sam", companyId: "c-1", createdAt: daysFromNow(-20) };
    const active = { id: "l-2", name: "Fresh lead", status: "new", owner: "Rio", companyId: "c-1", createdAt: daysFromNow(-1) };
    const recentAct = { id: "a-9", type: "call", subject: "Intro", at: daysFromNow(-1), leadId: "l-2", companyId: "c-1" };
    const rule = {
      id: "ru-7",
      kind: "rule",
      name: "Flag quiet leads",
      module: "leads",
      event: "scan",
      enabled: true,
      condition: { f: "daysSinceLastActivity", op: "gt", v: 10 },
      actions: [{ type: "note", subject: "Flagged by automation", text: "No activity on {name} for more than 10 days." }]
    };
    await seed(env, { leads: [quiet, active], activities: [recentAct], rules: [rule] });
    const fired = await RU.runScan(env.store);
    if (fired !== 1) return { pass: false, detail: "expected exactly 1 scan fire, got " + fired };
    const acts = await docs(env.store, "activities");
    const notes = acts.records.filter(a => a.type === "note" && a.subject === "Flagged by automation");
    if (notes.length !== 1) return { pass: false, detail: "flag note count wrong: " + notes.length };
    if (notes[0].leadId !== "l-1") return { pass: false, detail: "note linked to wrong lead" };
    if (notes[0].notes.indexOf("Northwind pilot") === -1) return { pass: false, detail: "template not resolved in note" };
    return { pass: true, detail: "scan rule flagged the quiet lead only" };
  });

  T.register("rules: field actions update the record and manual runs report matches", async () => {
    const env = mockEnv();
    const deal = { id: "d-1", name: "Acme licence", stage: "proposal", owner: "Sasha Chen", expectedValue: 24000, companyId: "c-1", createdAt: daysFromNow(-10) };
    const rule = {
      id: "ru-3",
      kind: "rule",
      name: "Bump probability on proposals",
      module: "deals",
      event: "write",
      enabled: true,
      condition: { f: "stage", op: "eq", v: "proposal" },
      actions: [{ type: "field", field: "probability", value: 75 }]
    };
    await seed(env, { deals: [deal], rules: [rule] });
    const res = await RU.fire(env.store, rule, deal, null, "manual");
    if (!res || !res[0].ok) return { pass: false, detail: "field action failed: " + JSON.stringify(res) };
    const deals = await docs(env.store, "deals");
    const stored = deals.records[0];
    if (stored.probability !== 75) return { pass: false, detail: "field not updated: " + stored.probability };
    const run = await RU.runManual(env.store, "ru-3");
    if (!run.ok) return { pass: false, detail: "manual run failed" };
    return { pass: true, detail: "field action + manual run verified" };
  });

  T.register("rules: manual run of a stage-change rule applies to records already at the stage", async () => {
    const env = mockEnv();
    const atProposal = { id: "d-1", name: "Acme licence", stage: "proposal", owner: "Sasha Chen", expectedValue: 12000, companyId: "c-1", createdAt: daysFromNow(-10) };
    const elsewhere = { id: "d-2", name: "Other", stage: "qualification", owner: "Sasha Chen", companyId: "c-1", createdAt: daysFromNow(-10) };
    await seed(env, { deals: [atProposal, elsewhere], rules: [stageRule({ id: "ru-4" })] });
    const run = await RU.runManual(env.store, "ru-4");
    if (!run.ok || run.fired !== 1) return { pass: false, detail: "expected 1 manual match: " + JSON.stringify(run) };
    const acts = await docs(env.store, "activities");
    const tasks = acts.records.filter(a => a.type === "task");
    if (tasks.length !== 1 || tasks[0].dealId !== "d-1") return { pass: false, detail: "task not created for the right deal" };
    return { pass: true, detail: "manual run fired for the record at the stage" };
  });
})();
