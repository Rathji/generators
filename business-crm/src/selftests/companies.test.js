(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const O = window.CRM_COMPANIES;
  if (!T || !BS || !R || !O) return;

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function until(fn, timeoutMs, stepMs) {
    const t0 = Date.now();
    const limit = timeoutMs || 5000;
    const step = stepMs || 250;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > limit) return null;
      await sleep(step);
    }
  }

  function deepEq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

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
    const ns = "cm" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ["companies", "contacts", "leads", "deals", "activities", "reports"] }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  function companyVia(values) {
    const v = O.validate(values);
    if (!v.ok) return v;
    return { ok: true, record: O.applyForm(null, v.values), values: v.values };
  }

  async function saveFresh(store, module, records) {
    const res = await store.saveChecked(module, { records }, { expectedBase: 0 });
    return res;
  }

  T.register("companies: validate + apply build a normalized record from form input", () => {
    const built = companyVia({
      name: "  Acme Industries ",
      industry: "Software / SaaS",
      employees: "200",
      website: "acme.example",
      taxId: "CHE-123",
      tags: "partner, priority, partner",
      notes: "  Long-standing account.  ",
      address: { street: "1 Main St", city: "Zurich", country: "CH" }
    });
    if (!built.ok) return { pass: false, detail: JSON.stringify(built.values || built.errors) };
    const rec = built.record;
    const checks = [];
    if (rec.name !== "Acme Industries") checks.push("name not trimmed");
    if (!/^c-[0-9a-f]{6}$/.test(rec.id)) checks.push("id format wrong: " + rec.id);
    if (rec.employees !== 200) checks.push("employees not numeric: " + rec.employees);
    if (rec.website !== "acme.example") checks.push("website mangled");
    if (!rec.tags || rec.tags.length !== 2 || rec.tags[1] !== "priority") checks.push("tags not de-duplicated or parsed");
    if (!rec.notes || rec.notes !== "Long-standing account.") checks.push("notes not trimmed");
    if (!rec.address || rec.address.city !== "Zurich" || rec.address.country !== "CH") checks.push("address lost");
    if (rec.address.street !== "1 Main St") checks.push("street lost");
    if (rec.active !== true) checks.push("new records should be active");
    if (rec.isCustomer !== false) checks.push("new records should not be customers");
    if (!rec.createdAt || !rec.updatedAt) checks.push("timestamps missing");
    if (checks.length) return { pass: false, detail: checks.join(" | ") };
    return { pass: true, detail: rec.id + " · normalized and timestamped" };
  });

  T.register("companies: validation rejects missing name and malformed website", () => {
    const a = O.validate({ name: "   " });
    const b = O.validate({ name: "Acme", website: "not a url" });
    const c = O.validate({ name: "Acme", website: "acme.example/path?q=1" });
    if (!a.errors.name) return { pass: false, detail: "blank name accepted" };
    if (!b.errors.website) return { pass: false, detail: "bad website accepted" };
    if (!c.ok) return { pass: false, detail: "valid website path rejected" };
    return { pass: true, detail: "name + website validation works" };
  });

  T.register("companies: editing preserves unknown/legacy fields and timestamps", () => {
    const legacy = { id: "c-1", name: "Acme", email: "hello@acme.example", stage: "customer", owner: "alex", createdAt: "2024-01-02T00:00:00.000Z" };
    const v = O.validate({ name: "Acme Industries" });
    const rec = O.applyForm(legacy, v.values);
    const checks = [];
    if (rec.id !== "c-1") checks.push("id changed");
    if (rec.email !== "hello@acme.example" || rec.stage !== "customer" || rec.owner !== "alex") checks.push("legacy fields dropped");
    if (rec.name !== "Acme Industries") checks.push("rename not applied");
    if (rec.createdAt !== "2024-01-02T00:00:00.000Z") checks.push("createdAt overwritten");
    if (!rec.updatedAt || rec.updatedAt === legacy.createdAt) checks.push("updatedAt not bumped");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "rename kept id, legacy fields and createdAt" };
  });

  T.register("companies: full store round-trip — create, cache, canonical read-back", async () => {
    const env = mockEnv();
    const s = env.store;
    const built = companyVia({ name: "Beta Works", industry: "Retail / Consumer" });
    if (!built.ok) return { pass: false, detail: "company build failed" };
    const r1 = await s.saveChecked("companies", { records: [built.record] }, { expectedBase: 0 });
    if (!r1.ok || r1.revision !== 1 || !r1.created) return { pass: false, detail: "create failed: " + JSON.stringify(r1) };
    const loaded = await s.loadDoc("companies");
    if (!loaded.content || !loaded.content.records || loaded.content.records.length !== 1) return { pass: false, detail: "read-back missing record" };
    if (loaded.content.records[0].id !== built.record.id) return { pass: false, detail: "read-back id mismatch" };
    return { pass: true, detail: "rev 1 round-trip with record " + built.record.id };
  });

  T.register("companies: a rename keeps the stable id and every reference to it intact (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const co = companyVia({ name: "Acme Industries", industry: "Manufacturing" });
    const r1 = await s.saveChecked("companies", { records: [co.record] }, { expectedBase: 0 });
    if (!r1.ok) return { pass: false, detail: "company create failed: " + JSON.stringify(r1) };
    const contact = { id: "ct-1", companyId: co.record.id, name: "Pat Smith", role: "procurement" };
    const r2 = await s.saveChecked("contacts", { records: [contact] }, { expectedBase: 0 });
    if (!r2.ok) return { pass: false, detail: "contact create failed: " + JSON.stringify(r2) };
    const refsBefore = await R.findRefs(s, "companies", "companyId", co.record.id);
    if (refsBefore.length !== 1 || refsBefore[0].module !== "contacts" || refsBefore[0].id !== "ct-1") {
      return { pass: false, detail: "reference not found before rename: " + JSON.stringify(refsBefore) };
    }
    const doc = await s.loadDoc("companies");
    const fresh = R.getRecord(doc.content, co.record.id);
    const v = O.validate({ name: "Acme International AG", industry: "Manufacturing" });
    const renamed = O.applyForm(fresh, v.values);
    const r3 = await s.saveChecked("companies", R.upsertRecord(JSON.parse(JSON.stringify(doc.content)), renamed).content, { expectedBase: doc.revision });
    if (!r3.ok) return { pass: false, detail: "rename failed: " + JSON.stringify(r3) };
    const after = await s.loadDoc("companies", { refresh: true });
    const rec = R.getRecord(after.content, co.record.id);
    if (!rec || rec.name !== "Acme International AG") return { pass: false, detail: "rename did not land" };
    const refsAfter = await R.findRefs(s, "companies", "companyId", co.record.id);
    if (refsAfter.length !== 1 || refsAfter[0].id !== "ct-1") return { pass: false, detail: "reference broken by rename" };
    const ct = await s.loadDoc("contacts");
    if (ct.content.records[0].companyId !== co.record.id) return { pass: false, detail: "contact companyId rewritten" };
    return { pass: true, detail: "rename kept id " + co.record.id + "; contact ct-1 still linked and resolves by id" };
  });

  T.register("companies: deletion is refused while any record references the company (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const co = companyVia({ name: "Linked Co" });
    await s.saveChecked("companies", { records: [co.record] }, { expectedBase: 0 });
    await s.saveChecked("contacts", { records: [{ id: "ct-1", companyId: co.record.id, name: "Pat" }] }, { expectedBase: 0 });
    const guarded = await O.canDelete(s, co.record.id);
    if (guarded.allowed || guarded.refs.length !== 1) return { pass: false, detail: "delete should be refused: " + JSON.stringify(guarded) };
    const ctDoc = await s.loadDoc("contacts");
    const rm = R.removeRecord(JSON.parse(JSON.stringify(ctDoc.content)), "ct-1");
    const r2 = await s.saveChecked("contacts", rm.content, { expectedBase: ctDoc.revision });
    if (!r2.ok) return { pass: false, detail: "contact removal failed: " + JSON.stringify(r2) };
    const open = await O.canDelete(s, co.record.id);
    if (!open.allowed || open.refs.length) return { pass: false, detail: "delete still blocked after links removed: " + JSON.stringify(open) };
    const doc = await s.loadDoc("companies");
    const gone = R.removeRecord(JSON.parse(JSON.stringify(doc.content)), co.record.id);
    const r3 = await s.saveChecked("companies", gone.content, { expectedBase: doc.revision });
    if (!r3.ok) return { pass: false, detail: "delete failed: " + JSON.stringify(r3) };
    const finalDoc = await s.loadDoc("companies", { refresh: true });
    if (R.getRecord(finalDoc.content, co.record.id)) return { pass: false, detail: "record still present after delete" };
    return { pass: true, detail: "referenced delete refused; after unlink, delete landed at rev " + r3.revision };
  });

  T.register("companies: list helpers sort active-first and search every field", () => {
    const recs = [
      { id: "c-1", name: "Acme", industry: "Retail", tags: ["partner"], address: { city: "Zurich" }, active: false },
      { id: "c-2", name: "Beta Bank", industry: "Financial services", tags: ["vip"], address: { city: "Geneva" } },
      { id: "c-3", name: "Gamma GmbH", notes: "talked to alex" }
    ];
    const sorted = R.sortByName(recs);
    if (sorted[0].id !== "c-2" || sorted[1].id !== "c-3" || sorted[2].id !== "c-1") {
      return { pass: false, detail: "order wrong: " + sorted.map(r => r.id).join(",") };
    }
    const byCity = R.filterRecords(recs, "zurich");
    const byTag = R.filterRecords(recs, "vip");
    const byNote = R.filterRecords(recs, "alex");
    const byIndustry = R.filterRecords(recs, "financ");
    if (byCity.length !== 1 || byCity[0].id !== "c-1") return { pass: false, detail: "city search failed" };
    if (byTag.length !== 1 || byTag[0].id !== "c-2") return { pass: false, detail: "tag search failed" };
    if (byNote.length !== 1 || byNote[0].id !== "c-3") return { pass: false, detail: "notes search failed" };
    if (byIndustry.length !== 1) return { pass: false, detail: "industry search failed" };
    return { pass: true, detail: "alpha sort (inactive last) + field search verified" };
  });

  T.register("companies: companies page renders the list and the new-company form", async () => {
    window.CRM.go("companies");
    await window.CRM.ready();
    const view = document.getElementById("viewRoot");
    if (view.dataset.state !== "ready") return { pass: false, detail: "state=" + view.dataset.state };
    const cmp = view.querySelector(".cmp-view");
    if (!cmp) return { pass: false, detail: "no companies view rendered" };
    const rows = cmp.querySelectorAll("[data-cid]").length;
    const empty = cmp.querySelector(".rec-empty");
    if (!rows && !empty) return { pass: false, detail: "list shows neither rows nor empty state" };
    if (!cmp.querySelector("[data-cmp-q]") || !cmp.querySelector("[data-cmp-add]")) return { pass: false, detail: "toolbar missing search or add" };
    window.CRM.go("companies", ["new"]);
    await window.CRM.ready();
    const view2 = document.getElementById("viewRoot");
    if (view2.dataset.state !== "ready") return { pass: false, detail: "form state=" + view2.dataset.state };
    const form = view2.querySelector("[data-cmp-form]");
    if (!form) return { pass: false, detail: "no company form rendered" };
    const fieldN = form.querySelectorAll("[data-f]").length;
    const hasName = form.querySelector('[data-f="name"]');
    const hasSave = form.querySelector("[data-cmp-save]");
    if (fieldN < 13 || !hasName || !hasSave) return { pass: false, detail: "form incomplete: fields=" + fieldN };
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return { pass: true, detail: (rows ? rows + " rows" : "empty state") + "; new-company form has " + fieldN + " fields" };
  });

  T.register("companies: real create → rename round-trip keeps the stable id on live server files (needs saved generator)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin || !r.uploadPlugin.editable) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "cmv" + Date.now().toString(36) + BS.randHex(4);
    let store;
    try {
      store = BS.create({
        ns,
        modules: ["companies"],
        kv: { get: k => r.kv.bcrm.get(k), set: (k, v) => r.kv.bcrm.set(k, v), delete: k => r.kv.bcrm.delete(k) },
        editable: { get: n => r.uploadPlugin.editable.get(n), set: (n, t, o) => r.uploadPlugin.editable.set(n, t, o || {}) },
        generatorName: window.generatorName || null,
        token: BS.tokenFrom(window.generatorPublicId || window.generatorName || "bcrm")
      });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const m = "companies";
    const headName = store.fileName(m);
    const t0 = Date.now();
    const cleanup = async () => {
      const folder = r.kv.bcrm;
      const entries = await folder.entries().catch(() => []);
      for (const pair of entries) {
        if (pair[0].indexOf(":" + ns + ":") !== -1 || pair[0] === "recon:" + ns) await folder.delete(pair[0]);
      }
    };
    const readCanonical = async () => {
      let text = null;
      try { text = await r.uploadPlugin.editable.get(headName); } catch (e) {}
      if (!text) return null;
      try {
        const h = JSON.parse(text);
        return { revision: h.revision || 0, content: h.content || {} };
      } catch (e) { return null; }
    };
    const a = companyVia({ name: "Live Alpha", industry: "Software / SaaS", notes: "keep me" });
    const b = companyVia({ name: "Live Beta", employees: "50", address: { city: "Bern" } });
    if (!a.ok || !b.ok) return { pass: false, detail: "build failed" };
    const r1 = await store.saveChecked(m, { records: [a.record, b.record] }, { expectedBase: 0 });
    if (r1.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (!r1.ok) return { pass: false, detail: "live create failed: " + JSON.stringify(r1) };
    try {
      const seen1 = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 1 && h.content.records && h.content.records.length === 2) return h;
        return null;
      }, 30000, 1500);
      if (!seen1) return { pass: false, detail: "rev 1 never readable on the server" };

      const waitA = 13000 - (Date.now() - t0);
      if (waitA > 0) await sleep(waitA);
      const doc2 = await store.loadDoc(m, { refresh: true });
      const freshA = R.getRecord(doc2.content, a.record.id);
      const vA = O.validate({ name: "Live Alpha GmbH", industry: "Software / SaaS", notes: "keep me" });
      const renamed = O.applyForm(freshA, vA.values);
      const up = R.upsertRecord(JSON.parse(JSON.stringify(doc2.content)), renamed);
      const tRen = Date.now();
      const r2 = await store.saveChecked(m, up.content, { expectedBase: doc2.revision });
      if (!r2.ok) return { pass: false, detail: "live rename failed: " + JSON.stringify(r2) };
      const seen2 = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 2) return h;
        return null;
      }, 30000, 1500);
      if (!seen2) return { pass: false, detail: "rev 2 never readable on the server" };
      const recA2 = R.getRecord(seen2.content, a.record.id);
      if (!recA2 || recA2.name !== "Live Alpha GmbH" || recA2.id !== a.record.id) return { pass: false, detail: "rename did not keep id" };
      if (recA2.notes !== "keep me") return { pass: false, detail: "unknown/legacy fields lost on rename" };
      return { pass: true, detail: "created 2 (rev 1), renamed Alpha keeping its id at rev 2 with legacy fields intact (" + Math.round((Date.now() - t0) / 1000) + "s incl. write throttles)" };
    } finally {
      await cleanup();
    }
  });
})();
