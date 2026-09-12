(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const O = window.CRM_DOCUMENTS;
  const D = window.CRM_DOMAIN;
  if (!T || !BS || !R || !O || !D) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "services", "sites", "assets", "tickets", "documents", "emails", "segments", "rules", "bus", "reports"];

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
    const ns = "dc" + BS.randHex(6);
    const store = BS.create(Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts));
    return { store };
  }

  function docVia(values) {
    const v = O.validate(values);
    if (!v.ok) return v;
    return { ok: true, record: O.applyForm(null, v.values), values: v.values };
  }

  T.register("documents: validate + apply build a normalized document record", () => {
    const built = docVia({
      title: "  Fibre 500 — service contract  ",
      type: "contract",
      status: "active",
      ownerType: "service",
      ownerId: "svc-1",
      companyId: "c-1",
      reference: "  CT-2026-118 ",
      value: "1200",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
      fileUrl: "https://example.com/contract.pdf",
      fileName: "contract.pdf",
      tags: "signed, 24-month, signed",
      body: "  Scope: 500/500 fibre.  ",
      notes: "  Renewal owned by Dana.  "
    });
    if (!built.ok) return { pass: false, detail: JSON.stringify(built.errors) };
    const rec = built.record;
    const checks = [];
    if (rec.title !== "Fibre 500 — service contract") checks.push("title not trimmed");
    if (rec.id !== undefined && !/^doc-[0-9a-f]{6}$/.test(rec.id)) checks.push("id format wrong: " + rec.id);
    if (rec.type !== "contract") checks.push("type lost");
    if (rec.status !== "active") checks.push("status lost");
    if (rec.ownerType !== "service" || rec.ownerId !== "svc-1") checks.push("owner lost");
    if (rec.reference !== "CT-2026-118") checks.push("reference not trimmed");
    if (rec.value !== 1200) checks.push("value not numeric: " + rec.value);
    if (rec.tags.length !== 2) checks.push("tags not deduped: " + JSON.stringify(rec.tags));
    if (rec.body !== "Scope: 500/500 fibre.") checks.push("body not trimmed");
    if (!rec.createdAt || !rec.updatedAt) checks.push("timestamps missing");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: rec.id + " · " + D.docStateLabel(rec) };
  });

  T.register("documents: validation rejects bad input and defaults unknown type/status", () => {
    const a = O.validate({ title: "  " });
    const b = O.validate({ title: "Contract", ownerType: "service" });
    const c = O.validate({ title: "Contract", type: "bogus", status: "weird" });
    const d = O.validate({ title: "Contract", value: "-5" });
    const e = O.validate({ title: "Contract", startDate: "2026-06-01", endDate: "2026-01-01" });
    const f = O.validate({ title: "Contract", fileUrl: "not a url" });
    if (!a.errors.title) return { pass: false, detail: "blank title accepted" };
    if (!b.errors.ownerId) return { pass: false, detail: "owner type without a record accepted" };
    if (!c.ok) return { pass: false, detail: "valid record rejected" };
    if (c.values.type !== "contract") return { pass: false, detail: "unknown type not defaulted: " + c.values.type };
    if (c.values.status !== "draft") return { pass: false, detail: "unknown status not defaulted: " + c.values.status };
    if (!d.errors.value) return { pass: false, detail: "negative value accepted" };
    if (!e.errors.endDate) return { pass: false, detail: "end before start accepted" };
    if (!f.errors.fileUrl) return { pass: false, detail: "malformed attachment url accepted" };
    return { pass: true, detail: "title/owner/value/date/url guards and defaults work" };
  });

  T.register("documents: editing keeps id, legacy fields and createdAt; clearing prunes fields", () => {
    const legacy = { id: "doc-abc123", title: "Old", reference: "OLD", startDate: "2025-01-01", createdAt: "2024-01-02T00:00:00.000Z", legacy: "keep" };
    const v = O.validate({ title: "Renamed", type: "sla", status: "active", reference: "", startDate: "", tags: "" });
    const rec = O.applyForm(legacy, v.values);
    const checks = [];
    if (rec.id !== "doc-abc123" || rec.legacy !== "keep") checks.push("id/legacy dropped");
    if (rec.createdAt !== "2024-01-02T00:00:00.000Z") checks.push("createdAt overwritten");
    if (rec.reference !== undefined) checks.push("cleared reference not pruned");
    if (rec.startDate !== undefined) checks.push("cleared startDate not pruned");
    if (rec.type !== "sla") checks.push("type not applied");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "id/legacy/createdAt kept; blanks pruned" };
  });

  T.register("documents: docState derives expiring and expired from an in-force end date", () => {
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10);
    const a = D.docState({ status: "active", endDate: soon });
    const b = D.docState({ status: "active", endDate: past });
    const c = D.docState({ status: "active", endDate: far });
    const d = D.docState({ status: "draft", endDate: soon });
    if (a !== "expiring") return { pass: false, detail: "soon end date should be expiring, got " + a };
    if (b !== "expired") return { pass: false, detail: "past end date should be expired, got " + b };
    if (c !== "active") return { pass: false, detail: "far end date should stay active, got " + c };
    if (d !== "draft") return { pass: false, detail: "a draft should not be flagged expiring, got " + d };
    return { pass: true, detail: "expiring/expired/active states derive correctly" };
  });

  T.register("documents: a site with a document attached cannot be deleted (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const site = { id: "site-abc123", name: "Zurich HQ", companyId: "c-1" };
    const r0 = await s.saveChecked("sites", { records: [site] }, { expectedBase: 0 });
    if (!r0.ok) return { pass: false, detail: "site create failed: " + JSON.stringify(r0) };
    const doc = docVia({ title: "Colo contract", type: "contract", status: "active", ownerType: "site", ownerId: site.id, fileUrl: "https://example.com/a.pdf" });
    if (!doc.ok) return { pass: false, detail: "document build failed" };
    const r1 = await s.saveChecked("documents", { records: [doc.record] }, { expectedBase: 0 });
    if (!r1.ok) return { pass: false, detail: "document create failed: " + JSON.stringify(r1) };
    const guarded = await window.CRM_SITES.canDelete(s, site.id);
    if (guarded.allowed || !guarded.refs.some(r => r.module === "documents")) {
      return { pass: false, detail: "delete should be blocked by the document owner reference: " + JSON.stringify(guarded) };
    }
    const back = await O.recordsFor(s, "site", site.id);
    if (back.length !== 1) return { pass: false, detail: "recordsFor should find the document: " + back.length };
    return { pass: true, detail: "owner reference blocks site deletion; recordsFor finds it" };
  });

  T.register("documents: the documents list, form and an owner card render", async () => {
    window.CRM.go("documents");
    await window.CRM.ready();
    const view = document.getElementById("viewRoot");
    if (view.dataset.state !== "ready") return { pass: false, detail: "state=" + view.dataset.state };
    const wrap = view.querySelector(".doc-view");
    if (!wrap) return { pass: false, detail: "no documents view rendered" };
    const rows = wrap.querySelectorAll("[data-docid]").length;
    const empty = wrap.querySelector(".rec-empty");
    if (!rows && !empty) return { pass: false, detail: "list shows neither rows nor empty state" };
    if (!wrap.querySelector("[data-doc-q]") || !wrap.querySelector("[data-doc-add]")) return { pass: false, detail: "toolbar missing search or add" };

    window.CRM.go("documents", ["new"]);
    await window.CRM.ready();
    const view2 = document.getElementById("viewRoot");
    if (view2.dataset.state !== "ready") return { pass: false, detail: "form state=" + view2.dataset.state };
    const form = view2.querySelector("[data-doc-form]");
    if (!form) return { pass: false, detail: "no document form rendered" };
    if (!form.querySelector('[data-f="title"]') || !form.querySelector('[data-f="ownerType"]') || !form.querySelector('[data-f="fileUrl"]')) return { pass: false, detail: "form fields incomplete" };
    if (!form.querySelector("[data-doc-save]")) return { pass: false, detail: "no save button" };

    window.CRM.go("dashboard");
    await window.CRM.ready();
    return { pass: true, detail: (rows ? rows + " rows" : "empty state") + "; new-document form rendered" };
  });
})();
