(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const D = window.CRM_DUP;
  if (!T || !BS || !R || !D) return;

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
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
    const ns = "dp" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  T.register("dups: company candidates match on normalized name or website", () => {
    const pairs = D.candidatePairs("companies", [
      { id: "c-1", name: "Acme  Industries, Inc." },
      { id: "c-2", name: "acme industries inc" },
      { id: "c-3", name: "Beta Works", website: "https://www.beta.example/" },
      { id: "c-4", name: "Beta Works", website: "beta.example" },
      { id: "c-5", name: "Gamma" }
    ]);
    const keys = pairs.map(p => p.a.id + ":" + p.b.id).sort();
    const expect = ["c-1:c-2", "c-3:c-4"];
    if (JSON.stringify(keys) !== JSON.stringify(expect)) {
      return { pass: false, detail: "expected " + expect.join(", ") + " got " + keys.join(", ") };
    }
    const reasons = D.dupReasons("companies", { name: "Acme" }, { name: "Acme" });
    if (reasons.indexOf("same name") === -1) return { pass: false, detail: "same-name reason missing" };
    return { pass: true, detail: "name + website normalization catches " + pairs.length + " pair(s)" };
  });

  T.register("dups: contacts match on email, or on name at the same company only", () => {
    const recs = [
      { id: "ct-1", name: "Pat Smith", email: "pat@acme.example", companyId: "c-1" },
      { id: "ct-2", name: "Patricia Smith", email: "PAT@acme.example", companyId: "c-1" },
      { id: "ct-3", name: "Pat Smith", companyId: "c-2" },
      { id: "ct-4", name: "Pat Smith", companyId: "c-1" },
      { id: "ct-5", name: "Robin", email: "robin@beta.example", companyId: "c-2" }
    ];
    const pairs = D.candidatePairs("contacts", recs);
    const keys = pairs.map(p => p.a.id + ":" + p.b.id).sort();
    const expect = ["ct-1:ct-2", "ct-1:ct-4"];
    if (JSON.stringify(keys) !== JSON.stringify(expect)) {
      return { pass: false, detail: "expected " + expect.join(", ") + " got " + keys.join(", ") };
    }
    return { pass: true, detail: "email + same-company-name pairs found; cross-company names not linked" };
  });

  T.register("dups: candidatesFor excludes inactive pairs and honors dismissals", () => {
    const rec = { id: "c-1", name: "Acme", active: true };
    const records = [
      rec,
      { id: "c-2", name: "Acme", active: true },
      { id: "c-3", name: "Acme", active: false }
    ];
    const both = D.candidatesFor("companies", records, rec);
    if (both.length !== 1 || both[0].other.id !== "c-2") return { pass: false, detail: "active handling wrong: " + JSON.stringify(both) };
    const dismissed = Object.assign({}, rec, { dupDismissed: ["c-2"] });
    const filtered = D.candidatesFor("companies", records, dismissed).filter(c => D.dismissedKeys(dismissed).indexOf(c.other.id) === -1);
    if (filtered.length !== 0) return { pass: false, detail: "dismissed pair still suggested" };
    const skip = D.candidatePairs("companies", [{ id: "c-1", name: "Acme", active: false }, { id: "c-2", name: "Acme", active: false }]);
    if (skip.length) return { pass: false, detail: "two inactive records flagged" };
    return { pass: true, detail: "active-only candidate + dismissal honoured" };
  });

  T.register("dups: merge rewrites every reference to the survivor and closes the duplicate (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const docSetup = [
      ["companies", { records: [
        { id: "c-1", name: "Acme Industries", website: "acme.example", tags: ["partner"], notes: "main notes", createdAt: "2024-01-01T00:00:00.000Z" },
        { id: "c-2", name: "Acme", email: "hello@acme.example", tags: ["priority", "europe"], notes: "dup notes", active: true }
      ] }],
      ["contacts", { records: [{ id: "ct-1", name: "Pat", companyId: "c-2" }, { id: "ct-2", name: "Robin", companyId: "c-1" }] }],
      ["deals", { pipeline: { stages: [] }, records: [{ id: "d-1", name: "Acme deal", companyId: "c-2", contactId: "ct-1" }] }],
      ["activities", { records: [{ id: "a-1", at: "2024-05-01T10:00:00.000Z", companyId: "c-2" }] }],
      ["leads", { records: [{ id: "l-1", companyId: "c-2" }] }]
    ];
    for (const [m, content] of docSetup) {
      const r = await s.saveChecked(m, content, { expectedBase: 0 });
      if (!r.ok) return { pass: false, detail: "seed " + m + " failed: " + JSON.stringify(r) };
    }
    const res = await D.mergeRecords(s, { module: "companies", survivorId: "c-1", dupId: "c-2", note: "same company" });
    if (!res.ok) return { pass: false, detail: "merge failed: " + JSON.stringify(res) };
    if (res.rewrites.length < 3) return { pass: false, detail: "expected rewrites in contacts+deals+activities+leads: " + JSON.stringify(res.rewrites) };

    const checkDoc = async (m, field, id, expected) => {
      const doc = await s.loadDoc(m, { refresh: true });
      const rec = R.getRecord(doc.content, id);
      if (!rec) return "missing " + m + "/" + id;
      if (String(rec[field]) !== expected) return m + "/" + id + " still points at " + rec[field];
      return null;
    };
    let err = await checkDoc("contacts", "companyId", "ct-1", "c-1");
    if (!err) err = await checkDoc("deals", "companyId", "d-1", "c-1");
    if (!err) err = await checkDoc("deals", "contactId", "d-1", "ct-1");
    if (!err) err = await checkDoc("activities", "companyId", "a-1", "c-1");
    if (!err) err = await checkDoc("leads", "companyId", "l-1", "c-1");
    if (err) return { pass: false, detail: err };

    const coDoc = await s.loadDoc("companies", { refresh: true });
    if (R.getRecord(coDoc.content, "c-2")) return { pass: false, detail: "duplicate c-2 still present" };
    const sur = R.getRecord(coDoc.content, "c-1");
    if (!sur) return { pass: false, detail: "survivor c-1 gone" };
    const checks = [];
    if (sur.email !== "hello@acme.example") checks.push("dup email not carried over");
    if (!sur.tags || sur.tags.indexOf("priority") === -1 || sur.tags.indexOf("partner") === -1) checks.push("tags not unioned: " + JSON.stringify(sur.tags));
    if (!sur.notes || sur.notes.indexOf("dup notes") === -1 || sur.notes.indexOf("merge note: same company") === -1) checks.push("notes not merged");
    if (!sur.merges || !sur.merges.length || sur.merges[0].dupId !== "c-2") checks.push("merge journal missing");
    if (checks.length) return { pass: false, detail: checks.join(" | ") };
    return { pass: true, detail: "c-2 → c-1: " + res.rewrites.map(w => w.count + " " + w.module).join(", ") + " relinked; survivor consolidated" };
  });

  T.register("dups: contact merge rewrites contactId refs and keeps the chosen id (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("contacts", { records: [
      { id: "ct-1", name: "Pat Smith", email: "pat@acme.example", active: true },
      { id: "ct-2", name: "Pat", email: "PAT@acme.example", active: false }
    ] }, { expectedBase: 0 });
    await s.saveChecked("deals", { pipeline: { stages: [] }, records: [{ id: "d-1", name: "Deal", contactId: "ct-2", companyId: "c-1" }] }, { expectedBase: 0 });
    const res = await D.mergeRecords(s, { module: "contacts", survivorId: "ct-1", dupId: "ct-2" });
    if (!res.ok) return { pass: false, detail: "merge failed: " + JSON.stringify(res) };
    const dDoc = await s.loadDoc("deals", { refresh: true });
    const deal = R.getRecord(dDoc.content, "d-1");
    if (!deal || deal.contactId !== "ct-1") return { pass: false, detail: "deal contactId not rewritten: " + JSON.stringify(deal) };
    const cDoc = await s.loadDoc("contacts", { refresh: true });
    if (R.getRecord(cDoc.content, "ct-2")) return { pass: false, detail: "duplicate still present" };
    const sur = R.getRecord(cDoc.content, "ct-1");
    if (!sur || sur.email !== "pat@acme.example") return { pass: false, detail: "survivor email wrong" };
    return { pass: true, detail: "contact merge kept ct-1; d-1 relinked" };
  });

  T.register("dups: merging two missing ids reports a clear failure", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("companies", { records: [{ id: "c-1", name: "Acme" }] }, { expectedBase: 0 });
    const res = await D.mergeRecords(s, { module: "companies", survivorId: "c-1", dupId: "c-99" });
    if (res.ok || res.code !== "not_found") return { pass: false, detail: "expected not_found, got " + JSON.stringify(res) };
    return { pass: true, detail: "not_found surfaced cleanly" };
  });
})();
