(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const O = window.CRM_SERVICES;
  const D = window.CRM_DOMAIN;
  if (!T || !BS || !R || !O || !D) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "services", "emails", "segments", "rules", "bus", "reports"];

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
    const ns = "sv" + BS.randHex(6);
    const store = BS.create(Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts));
    return { kv, kvStore, editable, store };
  }

  function serviceVia(values) {
    const v = O.validate(values);
    if (!v.ok) return v;
    return { ok: true, record: O.applyForm(null, v.values), values: v.values };
  }

  T.register("services: validate + apply build a normalized recurring-service record", () => {
    const built = serviceVia({
      name: "  Business Fibre 500/500  ",
      companyId: "c-1",
      contactId: "ct-1",
      category: "internet",
      status: "active",
      charge: "349.5",
      billingCycle: "monthly",
      setupFee: "199",
      contractTermMonths: "24",
      startDate: "2025-01-15",
      quantity: 1,
      bandwidth: 500,
      circuitId: "  CID-ONNET-001  ",
      owner: " Dana ",
      tags: "fibre, priority, fibre",
      notes: "  SLA 4h on-site.  ",
      autoRenew: true,
      serviceAddress: { street: "1 Main St", city: "Zurich", region: "  ", postalCode: "8000", country: "CH" }
    });
    if (!built.ok) return { pass: false, detail: JSON.stringify(built.errors) };
    const rec = built.record;
    const checks = [];
    if (rec.name !== "Business Fibre 500/500") checks.push("name not trimmed");
    if (rec.id !== undefined && !/^svc-[0-9a-f]{6}$/.test(rec.id)) checks.push("id format wrong: " + rec.id);
    if (rec.companyId !== "c-1") checks.push("companyId lost");
    if (rec.charge !== 349.5) checks.push("charge not numeric: " + rec.charge);
    if (rec.setupFee !== 199) checks.push("setupFee not numeric");
    if (rec.contractTermMonths !== 24) checks.push("term not numeric");
    if (rec.circuitId !== "CID-ONNET-001") checks.push("circuitId not trimmed");
    if (rec.owner !== "Dana") checks.push("owner not trimmed");
    if (rec.notes !== "SLA 4h on-site.") checks.push("notes not trimmed");
    if (!rec.autoRenew) checks.push("autoRenew lost");
    if (rec.tags.length !== 2) checks.push("tags not deduped: " + JSON.stringify(rec.tags));
    if (!rec.serviceAddress || rec.serviceAddress.region !== undefined) checks.push("blank address field should be omitted");
    if (rec.serviceAddress.city !== "Zurich") checks.push("address city lost");
    if (!rec.createdAt || !rec.updatedAt) checks.push("timestamps missing");
    if (Math.round(D.monthlyOf(rec)) !== 350) checks.push("MRR not normalized: " + D.monthlyOf(rec));
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: rec.id + " · normalized with MRR $" + Math.round(D.monthlyOf(rec)) };
  });

  T.register("services: validation rejects blank name, missing account, negatives and bad dates", () => {
    const a = O.validate({ name: "  ", companyId: "c-1" });
    const b = O.validate({ name: "Seats", companyId: "" });
    const c = O.validate({ name: "Seats", companyId: "c-1", charge: "-5" });
    const d = O.validate({ name: "Seats", companyId: "c-1", startDate: "2025-06-01", endDate: "2025-01-01" });
    const e = O.validate({ name: "Seats", companyId: "c-1", startDate: "not-a-date" });
    const f = O.validate({ name: "Seats", companyId: "c-1", charge: "19.99", billingCycle: "weird", category: "bogus" });
    if (!a.errors.name) return { pass: false, detail: "blank name accepted" };
    if (!b.errors.companyId) return { pass: false, detail: "missing account accepted" };
    if (!c.errors.charge) return { pass: false, detail: "negative charge accepted" };
    if (!d.errors.endDate) return { pass: false, detail: "end-before-start accepted" };
    if (!e.errors.startDate) return { pass: false, detail: "bad date accepted" };
    if (!f.ok) return { pass: false, detail: "valid record rejected" };
    if (f.values.category !== "internet") return { pass: false, detail: "unknown category not defaulted" };
    if (f.values.billingCycle !== "monthly") return { pass: false, detail: "unknown cycle not defaulted" };
    return { pass: true, detail: "name/account/charge/date/category/cycle validation works" };
  });

  T.register("services: editing keeps the id, legacy fields and createdAt; clearing a field prunes it", () => {
    const legacy = { id: "svc-abc123", name: "Old", charge: 10, setupFee: 5, createdAt: "2024-01-02T00:00:00.000Z", legacy: "keep" };
    const v = O.validate({ name: "Renamed", companyId: "c-1", charge: "", setupFee: "", status: "active" });
    const rec = O.applyForm(legacy, v.values);
    const checks = [];
    if (rec.id !== "svc-abc123" || rec.legacy !== "keep") checks.push("id/legacy dropped");
    if (rec.createdAt !== "2024-01-02T00:00:00.000Z") checks.push("createdAt overwritten");
    if (rec.charge !== undefined) checks.push("cleared charge not pruned");
    if (rec.setupFee !== undefined) checks.push("cleared setupFee not pruned");
    if (rec.name !== "Renamed") checks.push("rename not applied");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "rename kept id/legacy/createdAt; blanks pruned" };
  });

  T.register("services: domain summarize rolls recurring charges up into MRR/ARR by cycle", () => {
    const recs = [
      { id: "s1", category: "internet", status: "active", charge: 100, billingCycle: "monthly" },
      { id: "s2", category: "voip", status: "active", charge: 300, billingCycle: "quarterly" },
      { id: "s3", category: "internet", status: "active", charge: 1200, billingCycle: "annual" },
      { id: "s4", category: "managed-it", status: "suspended", charge: 500, billingCycle: "monthly" },
      { id: "s5", category: "voip", status: "terminated", charge: 999, billingCycle: "monthly" }
    ];
    const s = D.summarize(recs);
    const checks = [];
    if (s.count !== 5) checks.push("count " + s.count);
    if (s.active !== 3) checks.push("active " + s.active);
    if (s.suspended !== 1) checks.push("suspended " + s.suspended);
    if (s.terminated !== 1) checks.push("terminated " + s.terminated);
    if (Math.round(s.mrr) !== 300) checks.push("mrr " + s.mrr);
    if (Math.round(s.arr) !== 3600) checks.push("arr " + s.arr);
    if (Math.round(s.byCategory.internet) !== 200) checks.push("internet mrr " + s.byCategory.internet);
    if (Math.round(s.byCategory.voip) !== 100) checks.push("voip mrr " + s.byCategory.voip);
    if (Math.round(s.byCategory["managed-it"] || 0) !== 0) checks.push("suspended must not bill");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "MRR $300 · ARR $3,600 · per-category split correct" };
  });

  T.register("services: renewal date is projected from start date + contract term", () => {
    const rec = { id: "s1", status: "active", charge: 100, billingCycle: "monthly", startDate: "2025-01-15", contractTermMonths: 24 };
    const iso = D.renewalDateOf(rec);
    if (iso !== "2027-01-15") return { pass: false, detail: "projected renewal wrong: " + iso };
    const days = D.daysUntilRenewal(rec);
    if (days === null || days < 0) return { pass: false, detail: "days until renewal wrong: " + days };
    const ended = D.renewalDateOf({ endDate: "2026-03-01T00:00:00.000Z" });
    if (ended !== "2026-03-01") return { pass: false, detail: "explicit end date not used: " + ended };
    return { pass: true, detail: "renews " + iso + " (" + Math.round(days) + " days out)" };
  });

  T.register("services: deletion is refused while another record references the service (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const svc = serviceVia({ name: "Hosted PBX — 12 seats", companyId: "c-1", category: "voip", charge: "240", billingCycle: "monthly", status: "active" });
    if (!svc.ok) return { pass: false, detail: "build failed" };
    const r0 = await s.saveChecked("services", { records: [svc.record] }, { expectedBase: 0 });
    if (!r0.ok) return { pass: false, detail: "service create failed: " + JSON.stringify(r0) };
    const ref = { id: "d-1", name: "PBX project", serviceId: svc.record.id };
    const r1 = await s.saveChecked("deals", { records: [ref] }, { expectedBase: 0 });
    if (!r1.ok) return { pass: false, detail: "deal create failed: " + JSON.stringify(r1) };
    const guarded = await O.canDelete(s, svc.record.id);
    if (guarded.allowed || guarded.refs.length !== 1 || guarded.refs[0].module !== "deals") {
      return { pass: false, detail: "delete should be blocked by the deal: " + JSON.stringify(guarded) };
    }
    const dDoc = await s.loadDoc("deals");
    const rm = R.removeRecord(JSON.parse(JSON.stringify(dDoc.content)), ref.id);
    await s.saveChecked("deals", rm.content, { expectedBase: dDoc.revision });
    const open = await O.canDelete(s, svc.record.id);
    if (!open.allowed) return { pass: false, detail: "delete still blocked after unlink" };
    return { pass: true, detail: "delete blocked by reference; open after unlink" };
  });

  T.register("services: the service book and the new-service form render", async () => {
    window.CRM.go("services");
    await window.CRM.ready();
    const view = document.getElementById("viewRoot");
    if (view.dataset.state !== "ready") return { pass: false, detail: "state=" + view.dataset.state };
    const wrap = view.querySelector(".svc-view");
    if (!wrap) return { pass: false, detail: "no services view rendered" };
    const rows = wrap.querySelectorAll("[data-sid]").length;
    const empty = wrap.querySelector(".rec-empty");
    if (!rows && !empty) return { pass: false, detail: "list shows neither rows nor empty state" };
    if (!wrap.querySelector("[data-svc-q]") || !wrap.querySelector("[data-svc-add]")) return { pass: false, detail: "toolbar missing search or add" };
    window.CRM.go("services", ["new"]);
    await window.CRM.ready();
    const view2 = document.getElementById("viewRoot");
    if (view2.dataset.state !== "ready") return { pass: false, detail: "form state=" + view2.dataset.state };
    const form = view2.querySelector("[data-svc-form]");
    if (!form) return { pass: false, detail: "no service form rendered" };
    if (!form.querySelector('[data-f="name"]') || !form.querySelector('[data-f="companyId"]') || !form.querySelector('[data-f="charge"]')) return { pass: false, detail: "form fields incomplete" };
    if (!form.querySelector("[data-svc-save]")) return { pass: false, detail: "no save button" };
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return { pass: true, detail: (rows ? rows + " rows" : "empty state") + "; new-service form rendered" };
  });
})();
