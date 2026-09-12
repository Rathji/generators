(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const O = window.CRM_ASSETS;
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
    const ns = "as" + BS.randHex(6);
    const store = BS.create(Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts));
    return { store };
  }

  function assetVia(values) {
    const v = O.validate(values);
    if (!v.ok) return v;
    return { ok: true, record: O.applyForm(null, v.values), values: v.values };
  }

  T.register("assets: validate + apply build a normalized CPE record", () => {
    const built = assetVia({
      kind: "cpe",
      status: "assigned",
      name: "  Edge router  ",
      identifier: " AT-0007 ",
      companyId: "c-1",
      siteId: "site-1",
      serviceId: "svc-1",
      contactId: "ct-1",
      manufacturer: " Ubiquiti ",
      model: " UDM-Pro ",
      serial: " SN-123 ",
      mac: " aa:bb:cc:dd:ee:ff ",
      purchaseDate: "2025-02-01",
      warrantyEnd: "2027-02-01",
      purchaseCost: "480.5",
      tags: "cpe, edge, cpe",
      notes: "  In rack 4.  "
    });
    if (!built.ok) return { pass: false, detail: JSON.stringify(built.errors) };
    const rec = built.record;
    const checks = [];
    if (rec.name !== "Edge router") checks.push("name not trimmed");
    if (rec.identifier !== "AT-0007") checks.push("identifier not trimmed");
    if (rec.id !== undefined && !/^ast-[0-9a-f]{6}$/.test(rec.id)) checks.push("id format wrong: " + rec.id);
    if (rec.kind !== "cpe") checks.push("kind lost");
    if (rec.companyId !== "c-1" || rec.siteId !== "site-1" || rec.serviceId !== "svc-1") checks.push("references lost");
    if (rec.manufacturer !== "Ubiquiti" || rec.serial !== "SN-123") checks.push("kind fields not trimmed");
    if (rec.purchaseCost !== 480.5) checks.push("cost not numeric: " + rec.purchaseCost);
    if (rec.purchaseDate !== "2025-02-01") checks.push("purchase date lost");
    if (rec.tags.length !== 2) checks.push("tags not deduped: " + JSON.stringify(rec.tags));
    if (rec.owner !== undefined) checks.push("blank owner should be pruned");
    if (!rec.createdAt || !rec.updatedAt) checks.push("timestamps missing");
    if (O.assetName(rec) !== "Edge router") checks.push("assetName should use explicit name");
    const derived = O.assetName({ kind: "did", identifier: "+41 44 555 01 00" });
    if (derived.indexOf("+41 44 555 01 00") === -1) checks.push("assetName should derive from identifier: " + derived);
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: rec.id + " · " + O.assetName(rec) };
  });

  T.register("assets: validation rejects blank identifier, negatives and bad dates", () => {
    const a = O.validate({ kind: "cpe", identifier: "  " });
    const b = O.validate({ kind: "circuit", identifier: "CID-1", bandwidth: "-5" });
    const c = O.validate({ kind: "cpe", identifier: "AT-1", purchaseCost: "-1" });
    const d = O.validate({ kind: "sim", identifier: "8944", purchaseDate: "not-a-date" });
    const e = O.validate({ kind: "bogus", identifier: "X-1" });
    if (!a.errors.identifier) return { pass: false, detail: "blank identifier accepted" };
    if (!b.errors.bandwidth) return { pass: false, detail: "negative bandwidth accepted" };
    if (!c.errors.purchaseCost) return { pass: false, detail: "negative cost accepted" };
    if (!d.errors.purchaseDate) return { pass: false, detail: "bad date accepted" };
    if (!e.ok) return { pass: false, detail: "valid record rejected" };
    if (e.values.kind !== "cpe") return { pass: false, detail: "unknown kind not defaulted: " + e.values.kind };
    return { pass: true, detail: "identifier/negative/date validation + kind default works" };
  });

  T.register("assets: editing keeps id and createdAt, prunes cleared kind fields", () => {
    const legacy = { id: "ast-abc123", kind: "cpe", identifier: "AT-1", serial: "SN-1", mac: "aa", createdAt: "2024-01-02T00:00:00.000Z", legacy: "keep" };
    const v = O.validate({ kind: "cpe", identifier: "AT-1", serial: "", mac: "", status: "retired" });
    const rec = O.applyForm(legacy, v.values);
    const checks = [];
    if (rec.id !== "ast-abc123" || rec.legacy !== "keep") checks.push("id/legacy dropped");
    if (rec.createdAt !== "2024-01-02T00:00:00.000Z") checks.push("createdAt overwritten");
    if (rec.serial !== undefined) checks.push("cleared serial not pruned");
    if (rec.mac !== undefined) checks.push("cleared mac not pruned");
    if (rec.status !== "retired") checks.push("status not applied");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "id/createdAt kept; cleared kind fields pruned" };
  });

  T.register("assets: domain exposes per-kind field sets", () => {
    const didFields = D.assetKindFields("did").map(f => f.key);
    const cpeFields = D.assetKindFields("cpe").map(f => f.key);
    const simFields = D.assetKindFields("sim").map(f => f.key);
    const checks = [];
    if (didFields.indexOf("provider") === -1 || didFields.indexOf("target") === -1) checks.push("DID fields wrong: " + didFields);
    if (cpeFields.indexOf("serial") === -1 || cpeFields.indexOf("mac") === -1) checks.push("CPE fields wrong: " + cpeFields);
    if (simFields.indexOf("msisdn") === -1) checks.push("SIM fields wrong: " + simFields);
    if (D.assetKindIdLabel("did") !== "Number") checks.push("DID id label wrong");
    if (!D.isAssetAssigned({ status: "assigned" }) || D.isAssetAssigned({ status: "available" })) checks.push("asset assignment flag wrong");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "DID/CPE/SIM field sets + id labels correct" };
  });

  T.register("assets: deletion is refused while a ticket references the asset (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const asset = assetVia({ kind: "did", identifier: "+41 44 555 01 00", companyId: "c-1", status: "assigned" });
    if (!asset.ok) return { pass: false, detail: "asset build failed" };
    const r0 = await s.saveChecked("assets", { records: [asset.record] }, { expectedBase: 0 });
    if (!r0.ok) return { pass: false, detail: "asset create failed: " + JSON.stringify(r0) };
    const tkt = { id: "tk-1", subject: "Number not ringing", companyId: "c-1", assetId: asset.record.id, status: "open", priority: "high", openedAt: new Date().toISOString() };
    const r1 = await s.saveChecked("tickets", { records: [tkt] }, { expectedBase: 0 });
    if (!r1.ok) return { pass: false, detail: "ticket create failed: " + JSON.stringify(r1) };
    const guarded = await O.canDelete(s, asset.record.id);
    if (guarded.allowed || guarded.refs.length !== 1 || guarded.refs[0].module !== "tickets") {
      return { pass: false, detail: "delete should be blocked by the ticket: " + JSON.stringify(guarded) };
    }
    const tDoc = await s.loadDoc("tickets");
    const rm = R.removeRecord(JSON.parse(JSON.stringify(tDoc.content)), tkt.id);
    await s.saveChecked("tickets", rm.content, { expectedBase: tDoc.revision });
    const open = await O.canDelete(s, asset.record.id);
    if (!open.allowed) return { pass: false, detail: "delete still blocked after unlink" };
    return { pass: true, detail: "delete blocked by ticket reference; open after unlink" };
  });

  T.register("assets: the inventory list and the new-asset form render", async () => {
    window.CRM.go("assets");
    await window.CRM.ready();
    const view = document.getElementById("viewRoot");
    if (view.dataset.state !== "ready") return { pass: false, detail: "state=" + view.dataset.state };
    const wrap = view.querySelector(".asset-view");
    if (!wrap) return { pass: false, detail: "no assets view rendered" };
    const rows = wrap.querySelectorAll("[data-assetid]").length;
    const empty = wrap.querySelector(".rec-empty");
    if (!rows && !empty) return { pass: false, detail: "list shows neither rows nor empty state" };
    if (!wrap.querySelector("[data-asset-q]") || !wrap.querySelector("[data-asset-add]")) return { pass: false, detail: "toolbar missing search or add" };
    window.CRM.go("assets", ["new"]);
    await window.CRM.ready();
    const view2 = document.getElementById("viewRoot");
    if (view2.dataset.state !== "ready") return { pass: false, detail: "form state=" + view2.dataset.state };
    const form = view2.querySelector("[data-asset-form]");
    if (!form) return { pass: false, detail: "no asset form rendered" };
    if (!form.querySelector('[data-f="kind"]') || !form.querySelector('[data-f="identifier"]') || !form.querySelector('[data-f="status"]')) return { pass: false, detail: "form fields incomplete" };
    if (!form.querySelector("[data-asset-save]")) return { pass: false, detail: "no save button" };
    const kindSel = form.querySelector('[data-f="kind"]');
    kindSel.value = "cpe";
    kindSel.dispatchEvent(new Event("change"));
    if (!form.querySelector('[data-f="serial"]')) return { pass: false, detail: "CPE kind fields did not render on change" };
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return { pass: true, detail: (rows ? rows + " rows" : "empty state") + "; new-asset form + kind fields rendered" };
  });
})();
