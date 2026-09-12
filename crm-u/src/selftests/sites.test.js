(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const O = window.CRM_SITES;
  const D = window.CRM_DOMAIN;
  if (!T || !BS || !R || !O || !D) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "services", "sites", "assets", "tickets", "emails", "segments", "rules", "bus", "reports"];

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
      get: async name => { const f = files.get(name); return f ? f.text : null; },
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
    const ns = "st" + BS.randHex(6);
    const store = BS.create(Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts));
    return { store };
  }

  function siteVia(values) {
    const v = O.validate(values);
    if (!v.ok) return v;
    return { ok: true, record: O.applyForm(null, v.values), values: v.values };
  }

  T.register("sites: validate + apply build a normalized site record", () => {
    const built = siteVia({
      name: "  Zurich HQ  ",
      companyId: "c-1",
      siteType: "hq",
      status: "active",
      siteCode: " ZH-HQ ",
      timezone: "Europe/Zurich",
      owner: " Dana ",
      tags: "fibre, tier-3, fibre",
      accessNotes: "  Badge required.  ",
      notes: "  Rack 4.  ",
      contactIds: ["ct-1", "", "ct-2"],
      address: { street: "1 Bahnhofstrasse", city: "Zurich", region: "  ", postalCode: "8001", country: "CH" }
    });
    if (!built.ok) return { pass: false, detail: JSON.stringify(built.errors) };
    const rec = built.record;
    const checks = [];
    if (rec.name !== "Zurich HQ") checks.push("name not trimmed");
    if (rec.id !== undefined && !/^site-[0-9a-f]{6}$/.test(rec.id)) checks.push("id format wrong: " + rec.id);
    if (rec.companyId !== "c-1") checks.push("companyId lost");
    if (rec.siteType !== "hq") checks.push("siteType lost");
    if (rec.siteCode !== "ZH-HQ") checks.push("siteCode not trimmed");
    if (rec.owner !== "Dana") checks.push("owner not trimmed");
    if (rec.accessNotes !== "Badge required.") checks.push("access notes not trimmed");
    if (rec.tags.length !== 2) checks.push("tags not deduped: " + JSON.stringify(rec.tags));
    if (!rec.address || rec.address.region !== undefined) checks.push("blank address field should be omitted");
    if (rec.address.city !== "Zurich") checks.push("address city lost");
    if (rec.contactIds.length !== 2) checks.push("blank contact id not pruned: " + JSON.stringify(rec.contactIds));
    if (!rec.createdAt || !rec.updatedAt) checks.push("timestamps missing");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: rec.id + " · " + D.siteAddressOf(rec) };
  });

  T.register("sites: validation rejects blank name and missing company, defaults unknown type/status", () => {
    const a = O.validate({ name: "  ", companyId: "c-1" });
    const b = O.validate({ name: "Depot", companyId: "" });
    const c = O.validate({ name: "Depot", companyId: "c-1", siteType: "bogus", status: "weird" });
    if (!a.errors.name) return { pass: false, detail: "blank name accepted" };
    if (!b.errors.companyId) return { pass: false, detail: "missing company accepted" };
    if (!c.ok) return { pass: false, detail: "valid record rejected" };
    if (c.values.siteType !== "branch") return { pass: false, detail: "unknown type not defaulted: " + c.values.siteType };
    if (c.values.status !== "active") return { pass: false, detail: "unknown status not defaulted: " + c.values.status };
    return { pass: true, detail: "name/company validation + type/status defaults work" };
  });

  T.register("sites: editing keeps id, legacy fields and createdAt; clearing prunes fields", () => {
    const legacy = { id: "site-abc123", name: "Old", siteCode: "OLD", timezone: "UTC", createdAt: "2024-01-02T00:00:00.000Z", legacy: "keep" };
    const v = O.validate({ name: "Renamed", companyId: "c-1", siteCode: "", timezone: "", status: "planned" });
    const rec = O.applyForm(legacy, v.values);
    const checks = [];
    if (rec.id !== "site-abc123" || rec.legacy !== "keep") checks.push("id/legacy dropped");
    if (rec.createdAt !== "2024-01-02T00:00:00.000Z") checks.push("createdAt overwritten");
    if (rec.siteCode !== undefined) checks.push("cleared siteCode not pruned");
    if (rec.timezone !== undefined) checks.push("cleared timezone not pruned");
    if (rec.status !== "planned") checks.push("status not applied");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "id/legacy/createdAt kept; blanks pruned" };
  });

  T.register("sites: deletion is refused while a service references the site (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const site = siteVia({ name: "Zurich HQ", companyId: "c-1" });
    if (!site.ok) return { pass: false, detail: "site build failed" };
    const r0 = await s.saveChecked("sites", { records: [site.record] }, { expectedBase: 0 });
    if (!r0.ok) return { pass: false, detail: "site create failed: " + JSON.stringify(r0) };
    const svc = { id: "svc-1", name: "Fibre 500", companyId: "c-1", siteId: site.record.id, status: "active" };
    const r1 = await s.saveChecked("services", { records: [svc] }, { expectedBase: 0 });
    if (!r1.ok) return { pass: false, detail: "service create failed: " + JSON.stringify(r1) };
    const guarded = await O.canDelete(s, site.record.id);
    if (guarded.allowed || guarded.refs.length !== 1 || guarded.refs[0].module !== "services") {
      return { pass: false, detail: "delete should be blocked by the service: " + JSON.stringify(guarded) };
    }
    const dDoc = await s.loadDoc("services");
    const rm = R.removeRecord(JSON.parse(JSON.stringify(dDoc.content)), svc.id);
    await s.saveChecked("services", rm.content, { expectedBase: dDoc.revision });
    const open = await O.canDelete(s, site.record.id);
    if (!open.allowed) return { pass: false, detail: "delete still blocked after unlink" };
    return { pass: true, detail: "delete blocked by service reference; open after unlink" };
  });

  T.register("sites: the site list and the new-site form render", async () => {
    window.CRM.go("sites");
    await window.CRM.ready();
    const view = document.getElementById("viewRoot");
    if (view.dataset.state !== "ready") return { pass: false, detail: "state=" + view.dataset.state };
    const wrap = view.querySelector(".site-view");
    if (!wrap) return { pass: false, detail: "no sites view rendered" };
    const rows = wrap.querySelectorAll("[data-siteid]").length;
    const empty = wrap.querySelector(".rec-empty");
    if (!rows && !empty) return { pass: false, detail: "list shows neither rows nor empty state" };
    if (!wrap.querySelector("[data-site-q]") || !wrap.querySelector("[data-site-add]")) return { pass: false, detail: "toolbar missing search or add" };
    window.CRM.go("sites", ["new"]);
    await window.CRM.ready();
    const view2 = document.getElementById("viewRoot");
    if (view2.dataset.state !== "ready") return { pass: false, detail: "form state=" + view2.dataset.state };
    const form = view2.querySelector("[data-site-form]");
    if (!form) return { pass: false, detail: "no site form rendered" };
    if (!form.querySelector('[data-f="name"]') || !form.querySelector('[data-f="companyId"]') || !form.querySelector('[data-f="a-street"]')) return { pass: false, detail: "form fields incomplete" };
    if (!form.querySelector("[data-site-save]")) return { pass: false, detail: "no save button" };
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return { pass: true, detail: (rows ? rows + " rows" : "empty state") + "; new-site form rendered" };
  });
})();
