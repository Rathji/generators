(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const RP = window.CRM_REPORTS;
  if (!T || !BS || !R || !RP) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];
  const DAY = 86400000;
  const iso = d => d.toISOString();
  const daysFromNow = n => iso(new Date(Date.now() + n * DAY));

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
    const store = BS.create({ ns: "rp" + BS.randHex(6), kv, editable, modules: ALL_MODULES.slice() });
    return { kv, kvStore, editable, store };
  }

  const old = iso(new Date(Date.now() - 40 * DAY));
  const month = d => String(d).slice(0, 7);

  function seed(env, extra) {
    const d1 = { id: "d-1", name: "Proposal deal", stage: "proposal", owner: "Sam", expectedValue: 10000, probability: 50, closeDate: month(new Date()) + "-20", companyId: "c-1", leadId: "l-1", createdAt: old, updatedAt: old };
    const d2 = { id: "d-2", name: "Won deal", stage: "won", owner: "Sam", expectedValue: 2000, probability: 100, closeDate: month(new Date()) + "-01", companyId: "c-1", createdAt: iso(new Date(Date.now() - 30 * DAY)), wonAt: daysFromNow(-1), updatedAt: old };
    const d3 = { id: "d-3", name: "Lost deal", stage: "lost", owner: "Rio", expectedValue: 5000, probability: 100, lossReason: "Price", companyId: "c-2", createdAt: old, lostAt: daysFromNow(-2), updatedAt: old };
    const d4 = { id: "d-4", name: "Unassigned deal", stage: "qualification", owner: "", expectedValue: 3000, probability: 100, closeDate: month(new Date(Date.now() + 40 * DAY)) + "-05", companyId: "c-2", createdAt: old, updatedAt: old };
    const deals = [d1, d2, d3, d4];
    const leads = [{ id: "l-1", name: "Web lead", source: "Website", status: "converted" }];
    const companies = [
      { id: "c-1", name: "Acme Industries" },
      { id: "c-2", name: "Beta Works" }
    ];
    const contacts = [{ id: "ct-1", name: "Pat Smith", companyId: "c-1" }];
    const today = iso(new Date());
    const acts = [
      { id: "a-1", type: "call", subject: "Intro call", owner: "Sam", at: today, durationMin: 20 },
      { id: "a-2", type: "email", subject: "Proposal sent", owner: "Sam", at: daysFromNow(-3), outcome: "sent" },
      { id: "a-3", type: "task", subject: "Follow up", owner: "Rio", at: daysFromNow(-5), dueDate: month(new Date(Date.now() + 4 * DAY)) + "-10", status: "done", completedAt: daysFromNow(-1), completedBy: "Rio" },
      { id: "a-4", type: "task", subject: "Open task", owner: "Rio", at: daysFromNow(-2), dueDate: month(new Date(Date.now() + 10 * DAY)) + "-10", status: "open" },
      { id: "a-5", type: "note", subject: "Note no owner", at: daysFromNow(-1) }
    ];
    return { d1, d2, d3, d4, deals, leads, companies, contacts, acts };
  }

  async function seedBase(env) {
    const s = seed(env);
    await env.store.saveChecked("companies", { records: s.companies }, { expectedBase: 0 });
    await env.store.saveChecked("contacts", { records: s.contacts }, { expectedBase: 0 });
    await env.store.saveChecked("leads", { records: s.leads }, { expectedBase: 0 });
    await env.store.saveChecked("deals", { records: s.deals }, { expectedBase: 0 });
    await env.store.saveChecked("activities", { records: s.acts }, { expectedBase: 0 });
    return s;
  }

  function rowBy(rpt, idx) {
    return rpt.rows[idx];
  }

  T.register("reports: deals by owner groups open/won/lost values per owner with a correct total row", async () => {
    const env = mockEnv();
    await seedBase(env);
    const res = await RP.runReport(env.store, "dealsByOwner");
    if (!res.ok) return { pass: false, detail: res.error };
    const rpt = res.rpt;
    const owners = rpt.rows.map(r => r[0]);
    const sam = rpt.rows[owners.indexOf("Sam")];
    if (sam[1] !== 1 || sam[2] !== 10000 || sam[3] !== 5000 || sam[4] !== 1 || sam[5] !== 2000 || sam[6] !== 0) {
      return { pass: false, detail: "Sam row wrong: " + JSON.stringify(sam) };
    }
    const rio = rpt.rows[owners.indexOf("Rio")];
    if (rio[1] !== 0 || rio[7] !== 5000) return { pass: false, detail: "Rio row wrong: " + JSON.stringify(rio) };
    const un = rpt.rows[owners.indexOf("Unassigned")];
    if (!un || un[2] !== 3000) return { pass: false, detail: "Unassigned row missing/wrong" };
    const total = rpt.rows[rpt.rows.length - 1];
    if (total[0] !== "Total" || total[1] !== 2 || total[2] !== 13000 || total[3] !== 8000 || total[4] !== 1 || total[5] !== 2000 || total[7] !== 5000) {
      return { pass: false, detail: "total row wrong: " + JSON.stringify(total) };
    }
    return { pass: true, detail: "3 owners + totals verified" };
  });

  T.register("reports: pipeline stage report lists stages in order with weighted values", async () => {
    const env = mockEnv();
    await seedBase(env);
    const res = await RP.runReport(env.store, "dealsByStage");
    if (!res.ok) return { pass: false, detail: res.error };
    const rpt = res.rpt;
    const stages = rpt.rows.map(r => r[0]);
    const qi = stages.indexOf("Qualification");
    if (rpt.rows[qi][1] !== 1 || rpt.rows[qi][2] !== 3000 || rpt.rows[qi][3] !== 3000) return { pass: false, detail: "qualification wrong: " + JSON.stringify(rpt.rows[qi]) };
    const pi = stages.indexOf("Proposal");
    if (rpt.rows[pi][3] !== 5000) return { pass: false, detail: "proposal weighted wrong: " + JSON.stringify(rpt.rows[pi]) };
    const total = rpt.rows[rpt.rows.length - 1];
    if (total[0] !== "Total open" || total[1] !== 2 || total[3] !== 8000) return { pass: false, detail: "total wrong: " + JSON.stringify(total) };
    const chips = rpt.chips.map(c => c.k + "=" + c.v).join("|");
    if (chips.indexOf("Won=1 deals") === -1) return { pass: false, detail: "won chip missing: " + chips };
    return { pass: true, detail: "stage rows + chips verified" };
  });

  T.register("reports: win/loss shows counts, rate and loss reasons", async () => {
    const env = mockEnv();
    await seedBase(env);
    const res = await RP.runReport(env.store, "winLoss");
    if (!res.ok) return { pass: false, detail: res.error };
    const rpt = res.rpt;
    const chips = {};
    rpt.chips.forEach(c => { chips[c.k] = c.v; });
    if (chips["Won"] !== "1 deals · $2,000") return { pass: false, detail: "won chip: " + chips["Won"] };
    if (chips["Win rate"] !== "50%") return { pass: false, detail: "rate: " + chips["Win rate"] };
    if (rpt.rows.length !== 1 || rpt.rows[0][0] !== "Price" || rpt.rows[0][1] !== 1 || rpt.rows[0][2] !== 5000) {
      return { pass: false, detail: "loss reason rows wrong: " + JSON.stringify(rpt.rows) };
    }
    return { pass: true, detail: "won/lost + reason verified" };
  });

  T.register("reports: forecast and close-period reports bucket open deals by month", async () => {
    const env = mockEnv();
    await seedBase(env);
    const fc = await RP.runReport(env.store, "revenueForecast");
    if (!fc.ok) return { pass: false, detail: fc.error };
    const fr = fc.rpt;
    const byM = {};
    fr.rows.forEach(r => { byM[r[0]] = r; });
    const thisM = month(new Date());
    const nextM = month(new Date(Date.now() + 40 * DAY));
    if (byM[thisM][1] !== 1 || byM[thisM][3] !== 5000) return { pass: false, detail: "this-month forecast wrong" };
    if (byM[nextM][2] !== 3000 || byM[nextM][3] !== 3000) return { pass: false, detail: "next-month forecast wrong" };
    const cp = await RP.runReport(env.store, "dealsByClosePeriod");
    const cr = cp.rpt;
    const rows = cr.rows.map(r => r[0]);
    if (rows.indexOf(month(new Date())) === -1 || rows[rows.length - 1] !== "Total") return { pass: false, detail: "close-period rows wrong" };
    return { pass: true, detail: "forecast buckets verified" };
  });

  T.register("reports: activity by owner and team performance count calls, emails and completed follow-ups", async () => {
    const env = mockEnv();
    await seedBase(env);
    const byOwner = await RP.runReport(env.store, "activityByOwner");
    const ab = byOwner.rpt;
    const owners = ab.rows.map(r => r[0]);
    const sam = ab.rows[owners.indexOf("Sam")];
    if (sam[1] !== 2 || sam[2] !== 1 || sam[3] !== 1) return { pass: false, detail: "Sam activity wrong: " + JSON.stringify(sam) };
    const rio = ab.rows[owners.indexOf("Rio")];
    if (rio[6] !== 2 || rio[7] !== 1) return { pass: false, detail: "Rio tasks wrong: " + JSON.stringify(rio) };
    const team = await RP.runReport(env.store, "teamPerformance");
    const tr = team.rpt;
    const tOwners = tr.rows.map(r => r[0]);
    const ts = tr.rows[tOwners.indexOf("Sam")];
    if (ts[1] !== 1 || ts[2] !== 1 || ts[3] !== 2000 || ts[4] !== 1 || ts[5] !== 1) return { pass: false, detail: "Sam team row wrong: " + JSON.stringify(ts) };
    const trr = tr.rows[tOwners.indexOf("Rio")];
    if (trr[6] !== 1) return { pass: false, detail: "Rio follow-ups wrong: " + JSON.stringify(trr) };
    const noteOnly = tr.rows.find(r => r[0] === "Unassigned");
    if (noteOnly && noteOnly[7] !== 0) return { pass: false, detail: "Unassigned owner should have zero today activity" };
    return { pass: true, detail: "per-owner activity + team metrics verified" };
  });

  T.register("reports: sources resolve through linked leads and unknown leads group under no source", async () => {
    const env = mockEnv();
    await seedBase(env);
    const res = await RP.runReport(env.store, "dealsBySource");
    if (!res.ok) return { pass: false, detail: res.error };
    const rpt = res.rpt;
    const rows = rpt.rows.map(r => r[0]);
    const wi = rows.indexOf("Website");
    const website = rpt.rows[wi];
    if (website[0] !== "Website" || website[1] < 1) return { pass: false, detail: "Website source row wrong: " + JSON.stringify(website) };
    const ns = rpt.rows[rows.indexOf("No source")];
    if (!ns || ns[3] < 1) return { pass: false, detail: "No-source bucket wrong: " + JSON.stringify(ns) };
    return { pass: true, detail: "source grouping verified" };
  });

  T.register("reports: saved definitions save, list, update and delete in the reports document", async () => {
    const env = mockEnv();
    await seedBase(env);
    let defs = await RP.loadDefs(env.store);
    if (defs.length) return { pass: false, detail: "reports doc not empty at start" };
    const d = { id: null, name: "Quarterly owner view", template: "dealsByOwner" };
    const saved = await RP.saveDef(env.store, d);
    if (!saved.ok || !d.id) return { pass: false, detail: "save failed: " + JSON.stringify(saved) };
    defs = await RP.loadDefs(env.store);
    if (defs.length !== 1 || defs[0].name !== "Quarterly owner view" || defs[0].template !== "dealsByOwner") return { pass: false, detail: "def not listed correctly" };
    const upd = await RP.saveDef(env.store, { id: d.id, name: "Q3 owner view", template: "dealsByStage" });
    if (!upd.ok) return { pass: false, detail: "update failed" };
    defs = await RP.loadDefs(env.store);
    if (defs.length !== 1 || defs[0].name !== "Q3 owner view" || defs[0].template !== "dealsByStage") return { pass: false, detail: "def not updated" };
    const res = await RP.deleteDef(env.store, d.id);
    if (!res.ok) return { pass: false, detail: "delete failed" };
    defs = await RP.loadDefs(env.store);
    if (defs.length !== 0) return { pass: false, detail: "def still present after delete" };
    return { pass: true, detail: "save → list → update → delete verified" };
  });

  T.register("reports: csv export flattens a report with a header row and raw numbers", async () => {
    const env = mockEnv();
    await seedBase(env);
    const res = await RP.runReport(env.store, "dealsByOwner");
    const csv = RP.toCsv(res.rpt);
    const lines = csv.split("\n");
    if (lines[0].indexOf("Owner") === -1 || lines[0].indexOf("Weighted forecast") === -1) return { pass: false, detail: "header row wrong" };
    const totalLine = lines[lines.length - 1];
    if (totalLine.indexOf("Total") === -1 || totalLine.indexOf("13000") === -1) return { pass: false, detail: "total row wrong: " + totalLine };
    return { pass: true, detail: "CSV contains header + raw total" };
  });
})();
