(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const O = window.CRM_CONTACTS;
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
    const ns = "ct" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  function contactVia(values) {
    const v = O.validate(values);
    if (!v.ok) return v;
    return { ok: true, record: O.applyForm(null, v.values), values: v.values };
  }

  T.register("contacts: validate + apply build a normalized record from form input", () => {
    const built = contactVia({
      name: "  Pat Smith  ",
      companyId: "c-1",
      role: " Head of Procurement ",
      email: " PAT@acme.example ",
      phone: " +41 79 123 45 67 ",
      channels: "WhatsApp: +41 79 123 45 67;\nSignal: pat.smith.01",
      social: { linkedin: "in/pat-smith", twitter: "@pat_smith", facebook: "  " },
      tags: "decision-maker, vip, decision-maker",
      notes: "  Prefers email.  ",
      consent: true
    });
    if (!built.ok) return { pass: false, detail: JSON.stringify(built.errors || built.values) };
    const rec = built.record;
    const checks = [];
    if (rec.name !== "Pat Smith") checks.push("name not trimmed");
    if (rec.id !== undefined && !/^ct-[0-9a-f]{6}$/.test(rec.id)) checks.push("id format wrong: " + rec.id);
    if (rec.companyId !== "c-1") checks.push("companyId lost");
    if (rec.email !== "PAT@acme.example") checks.push("email not trimmed");
    if (!rec.consent) checks.push("consent missing");
    if (!rec.channels || rec.channels.length !== 2) checks.push("channels not parsed: " + JSON.stringify(rec.channels));
    if (rec.channels[0].kind !== "WhatsApp" || rec.channels[0].value !== "+41 79 123 45 67") checks.push("first channel mangled");
    if (!rec.social || rec.social.linkedin !== "in/pat-smith" || rec.social.twitter !== "@pat_smith") checks.push("social handles lost");
    if (rec.social.facebook !== undefined) checks.push("blank social handle should be omitted");
    if (!rec.tags || rec.tags.length !== 2) checks.push("tags not parsed/deduped");
    if (rec.notes !== "Prefers email.") checks.push("notes not trimmed");
    if (rec.active !== true) checks.push("new contacts should be active");
    if (!rec.createdAt || !rec.updatedAt) checks.push("timestamps missing");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: rec.id + " · normalized with consent + channels" };
  });

  T.register("contacts: validation rejects blank name and malformed email", () => {
    const a = O.validate({ name: "  " });
    const b = O.validate({ name: "Pat", email: "not-an-email" });
    const c = O.validate({ name: "Pat", email: "pat@acme.example" });
    if (!a.errors.name) return { pass: false, detail: "blank name accepted" };
    if (!b.errors.email) return { pass: false, detail: "bad email accepted" };
    if (!c.ok) return { pass: false, detail: "valid email rejected" };
    return { pass: true, detail: "name + email validation works" };
  });

  T.register("contacts: editing preserves legacy fields; unticking consent removes it", () => {
    const legacy = { id: "ct-1", name: "Pat", createdAt: "2024-01-02T00:00:00.000Z", legacy: "keep" };
    const v = O.validate({ name: "Patricia", consent: false });
    const rec = O.applyForm(legacy, v.values);
    const checks = [];
    if (rec.id !== "ct-1" || rec.legacy !== "keep") checks.push("id/legacy dropped");
    if (rec.consent !== undefined) checks.push("consent not removed when unticked");
    if (rec.name !== "Patricia") checks.push("rename not applied");
    if (rec.createdAt !== "2024-01-02T00:00:00.000Z") checks.push("createdAt overwritten");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "rename kept id, legacy + createdAt; consent pruned" };
  });

  T.register("contacts: a contact with no company is standalone; company select empty keeps it standalone", () => {
    const built = contactVia({ name: "Solo Contact", companyId: "" });
    if (!built.ok) return { pass: false, detail: "build failed" };
    if (built.record.companyId !== undefined) return { pass: false, detail: "blank company should be omitted" };
    return { pass: true, detail: "standalone contact has no companyId key" };
  });

  T.register("contacts: deletion is refused while deals or activities reference the contact (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const co = contactVia({ name: "Referenced Contact", companyId: "" });
    if (!co.ok) return { pass: false, detail: "build failed" };
    const r0 = await s.saveChecked("contacts", { records: [co.record] }, { expectedBase: 0 });
    if (!r0.ok) return { pass: false, detail: "contact create failed: " + JSON.stringify(r0) };
    const deal = { id: "d-1", name: "Acme expansion", contactId: co.record.id, companyId: "c-1" };
    const r1 = await s.saveChecked("deals", { records: [deal] }, { expectedBase: 0 });
    if (!r1.ok) return { pass: false, detail: "deal create failed: " + JSON.stringify(r1) };
    const guarded = await O.canDelete(s, co.record.id);
    if (guarded.allowed || guarded.refs.length !== 1 || guarded.refs[0].module !== "deals") {
      return { pass: false, detail: "delete should be blocked by the deal: " + JSON.stringify(guarded) };
    }
    const dDoc = await s.loadDoc("deals");
    const rm = R.removeRecord(JSON.parse(JSON.stringify(dDoc.content)), deal.id);
    await s.saveChecked("deals", rm.content, { expectedBase: dDoc.revision });
    const open = await O.canDelete(s, co.record.id);
    if (!open.allowed) return { pass: false, detail: "delete still blocked after unlink" };
    return { pass: true, detail: "contact delete blocked by deal reference; open after unlink" };
  });

  T.register("contacts: contacts page renders the list and the new-contact form", async () => {
    window.CRM.go("contacts");
    await window.CRM.ready();
    const view = document.getElementById("viewRoot");
    if (view.dataset.state !== "ready") return { pass: false, detail: "state=" + view.dataset.state };
    const cmp = view.querySelector(".cmp-view");
    if (!cmp) return { pass: false, detail: "no contacts view rendered" };
    const rows = cmp.querySelectorAll("[data-cid]").length;
    const empty = cmp.querySelector(".rec-empty");
    if (!rows && !empty) return { pass: false, detail: "list shows neither rows nor empty state" };
    if (!cmp.querySelector("[data-ct-q]") || !cmp.querySelector("[data-ct-add]")) return { pass: false, detail: "toolbar missing search or add" };
    if (!cmp.querySelector(".seg-saved-box") && !cmp.querySelector(".dup-scanholder")) return { pass: false, detail: "segments control or dup scan missing" };
    window.CRM.go("contacts", ["new"]);
    await window.CRM.ready();
    const view2 = document.getElementById("viewRoot");
    if (view2.dataset.state !== "ready") return { pass: false, detail: "form state=" + view2.dataset.state };
    const form = view2.querySelector("[data-ct-form]");
    if (!form) return { pass: false, detail: "no contact form rendered" };
    const hasName = form.querySelector('[data-f="name"]');
    const hasSave = form.querySelector("[data-ct-save]");
    if (!hasName || !hasSave) return { pass: false, detail: "form incomplete" };
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return { pass: true, detail: (rows ? rows + " rows" : "empty state") + "; new-contact form rendered" };
  });

  T.register("contacts: real create → rename round-trip keeps the stable id on live server files (needs saved generator)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin || !r.uploadPlugin.editable) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "ctv" + Date.now().toString(36) + BS.randHex(4);
    let store;
    try {
      store = BS.create({
        ns,
        modules: ALL_MODULES.slice(),
        kv: { get: k => r.kv.bcrm.get(k), set: (k, v) => r.kv.bcrm.set(k, v), delete: k => r.kv.bcrm.delete(k) },
        editable: { get: n => r.uploadPlugin.editable.get(n), set: (n, t, o) => r.uploadPlugin.editable.set(n, t, o || {}) },
        generatorName: window.generatorName || null,
        token: BS.tokenFrom(window.generatorPublicId || window.generatorName || "bcrm")
      });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const m = "contacts";
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
    const a = contactVia({ name: "Live Alice", role: "CEO", channels: "WhatsApp: +41 79 000 00 00", consent: true });
    if (!a.ok) return { pass: false, detail: "build failed" };
    const r1 = await store.saveChecked(m, { records: [a.record] }, { expectedBase: 0 });
    if (r1.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (!r1.ok) return { pass: false, detail: "live create failed: " + JSON.stringify(r1) };
    try {
      const seen1 = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 1 && h.content.records && h.content.records.length === 1) return h;
        return null;
      }, 30000, 1500);
      if (!seen1) return { pass: false, detail: "rev 1 never readable on the server" };

      const waitA = 13000 - (Date.now() - t0);
      if (waitA > 0) await sleep(waitA);
      const doc2 = await store.loadDoc(m, { refresh: true });
      const fresh = R.getRecord(doc2.content, a.record.id);
      const vA = O.validate({ name: "Live Alice Walker", role: "CEO", channels: "WhatsApp: +41 79 000 00 00", consent: true });
      const renamed = O.applyForm(fresh, vA.values);
      const up = R.upsertRecord(JSON.parse(JSON.stringify(doc2.content)), renamed);
      const r2 = await store.saveChecked(m, up.content, { expectedBase: doc2.revision });
      if (!r2.ok) return { pass: false, detail: "live rename failed: " + JSON.stringify(r2) };
      const seen2 = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 2) return h;
        return null;
      }, 30000, 1500);
      if (!seen2) return { pass: false, detail: "rev 2 never readable on the server" };
      const rec2 = R.getRecord(seen2.content, a.record.id);
      if (!rec2 || rec2.name !== "Live Alice Walker" || rec2.id !== a.record.id) return { pass: false, detail: "rename did not keep id" };
      if (rec2.consent !== true || !rec2.channels || rec2.channels.length !== 1) return { pass: false, detail: "consent/channels lost on rename" };
      return { pass: true, detail: "created (rev 1) then renamed keeping id at rev 2 (" + Math.round((Date.now() - t0) / 1000) + "s incl. throttle)" };
    } finally {
      await cleanup();
    }
  });
})();
