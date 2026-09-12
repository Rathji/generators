(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const L = window.CRM_LEADS;
  const D = window.CRM_DEALS;
  if (!T || !BS || !R || !L || !D) return;

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
    const ns = "ld" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  function leadRec(over) {
    return Object.assign({
      id: "l-1",
      name: "Northwind pilot",
      status: "new",
      createdAt: "2026-01-10T09:00:00.000Z"
    }, over || {});
  }

  T.register("leads: validation requires a name and applyForm seeds status & timestamps", () => {
    const bad = L.validate({ name: "  " });
    if (bad.ok) return { pass: false, detail: "expected name error" };
    const v = L.validate({ name: "  Acme wants a pilot  ", source: "Referral", owner: "Me" });
    if (!v.ok) return { pass: false, detail: "valid input rejected: " + JSON.stringify(v.errors) };
    if (v.values.name !== "Acme wants a pilot") return { pass: false, detail: "name not trimmed" };
    const rec = L.applyForm(null, v.values, { status: "new" });
    if (!String(rec.id).startsWith("l-")) return { pass: false, detail: "id does not start with l-: " + rec.id };
    if (rec.status !== "new" || !rec.createdAt) return { pass: false, detail: "status/createdAt not seeded" };
    if (rec.source !== "Referral") return { pass: false, detail: "source not kept" };
    return { pass: true, detail: "validation + form shaping verified" };
  });

  T.register("leads: status changes journal, disqualify records reason, reopen clears close fields", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("leads", { records: [leadRec()] }, { expectedBase: 0 });
    let res = await L.setLeadStatus(s, "l-1", "contacted", { note: "First call made" });
    if (!res || !res.ok) return { pass: false, detail: "contacted failed: " + JSON.stringify(res) };
    res = await L.setLeadStatus(s, "l-1", "qualified", { note: "Budget confirmed" });
    if (!res || !res.ok) return { pass: false, detail: "qualified failed" };
    res = await L.setLeadStatus(s, "l-1", "disqualified", { reason: "Budget", note: "Too small" });
    if (!res || !res.ok) return { pass: false, detail: "disqualify failed" };
    let doc = await s.loadDoc("leads", { refresh: true });
    let rec = R.getRecord(doc.content, "l-1");
    if (rec.status !== "disqualified" || !rec.disqualifiedAt || rec.disqualifyReason !== "Budget") {
      return { pass: false, detail: "disqualify fields wrong: " + JSON.stringify({ status: rec.status, reason: rec.disqualifyReason }) };
    }
    if ((rec.events || []).length !== 3) return { pass: false, detail: "expected 3 journal events, got " + (rec.events || []).length };
    const last = rec.events[rec.events.length - 1];
    if (last.from !== "qualified" || last.to !== "disqualified" || last.reason !== "Budget") {
      return { pass: false, detail: "journal tail wrong: " + JSON.stringify(last) };
    }
    res = await L.setLeadStatus(s, "l-1", "new", { note: "Reopened" });
    if (!res || !res.ok) return { pass: false, detail: "reopen failed" };
    doc = await s.loadDoc("leads", { refresh: true });
    rec = R.getRecord(doc.content, "l-1");
    if (rec.status !== "new") return { pass: false, detail: "reopen did not reset status" };
    if (rec.disqualifiedAt !== undefined || rec.disqualifyReason !== undefined) {
      return { pass: false, detail: "reopen left disqualify fields behind" };
    }
    if ((rec.events || []).length !== 4) return { pass: false, detail: "expected 4 events after reopen" };
    return { pass: true, detail: "journaling + disqualify + reopen verified" };
  });

  T.register("leads: qualified lead converts to a deal and the lead is marked converted", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("companies", { records: [{ id: "c-1", name: "Acme Industries" }] }, { expectedBase: 0 });
    await s.saveChecked("leads", { records: [leadRec({ status: "qualified", companyId: "c-1", owner: "Me", notes: "Wants a pilot of 200 seats" })] }, { expectedBase: 0 });
    const doc = await s.loadDoc("leads", { refresh: true });
    const lead = R.getRecord(doc.content, "l-1");
    const out = await L.convertToDeal(s, lead, { note: "Converted after discovery call" });
    if (!out || !out.ok) return { pass: false, detail: "conversion failed: " + JSON.stringify(out) };
    if (!out.dealId || !String(out.dealId).startsWith("d-")) return { pass: false, detail: "no deal id: " + JSON.stringify(out) };
    const ddoc = await s.loadDoc("deals", { refresh: true });
    const deal = R.getRecord(ddoc.content, out.dealId);
    if (!deal) return { pass: false, detail: "deal not persisted" };
    if (deal.name !== "Northwind pilot" || deal.companyId !== "c-1" || deal.owner !== "Me" || deal.leadId !== "l-1") {
      return { pass: false, detail: "deal did not inherit lead fields: " + JSON.stringify(deal) };
    }
    const pl = D.effectivePipelineOf(ddoc.content);
    if (deal.stage !== pl.stages[0].id) return { pass: false, detail: "deal not placed in first open stage: " + deal.stage };
    const ldoc2 = await s.loadDoc("leads", { refresh: true });
    const lead2 = R.getRecord(ldoc2.content, "l-1");
    if (lead2.status !== "converted" || lead2.convertedToDealId !== out.dealId || !lead2.convertedAt) {
      return { pass: false, detail: "lead not marked converted: " + JSON.stringify({ status: lead2.status, id: lead2.convertedToDealId }) };
    }
    return { pass: true, detail: "lead → deal conversion verified (dealId " + out.dealId + ")" };
  });

  T.register("leads: conversion refuses a non-qualified lead without touching documents", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("leads", { records: [leadRec({ status: "contacted" })] }, { expectedBase: 0 });
    const out = await L.convertToDeal(s, leadRec({ status: "contacted" }), {});
    if (out.ok || out.code !== "not_qualified") return { pass: false, detail: "expected not_qualified, got " + JSON.stringify(out) };
    const ddoc = await s.loadDoc("deals", { refresh: true });
    const deals = R.recordsOf(ddoc.content);
    if (deals.length) return { pass: false, detail: "deals doc was touched" };
    return { pass: true, detail: "non-qualified conversion blocked cleanly" };
  });

  T.register("leads: delete guard blocks when a deal references the lead", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("leads", { records: [leadRec({ status: "converted", convertedToDealId: "d-9" })] }, { expectedBase: 0 });
    await s.saveChecked("deals", { records: [{ id: "d-9", name: "Northwind pilot", leadId: "l-1", stage: "qualification" }] }, { expectedBase: 0 });
    const del = await L.canDelete(s, "l-1");
    if (del.allowed) return { pass: false, detail: "delete should be blocked" };
    if (!del.refs.length || del.refs[0].module !== "deals") return { pass: false, detail: "refs wrong: " + JSON.stringify(del.refs) };
    return { pass: true, detail: "ref guard sees the referencing deal" };
  });
})();
