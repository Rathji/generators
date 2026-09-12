/* ============================================================
   BUSINESS ERP — master data & configuration (Phase 2)
   The shared core every module builds on:
     parties  — party directory (customer/supplier/both), contacts,
                addresses, tax id, payment terms, credit limit,
                active flag. One rename/merge updates the whole system.
     catalog  — product & service catalog (sku, uom, prices, tax code).
     chart    — chart of accounts (codes, names, account classes).
     taxes    — tax-rate definitions applied to document lines.
     defaults — the default posting accounts the ledger auto-uses
                (AR, AP, inventory, COGS, sales revenue, tax collected,
                tax paid, bank, equity, retained earnings, expense).
     settings — fiscal profile (company, currency, fiscal-year start)
                + per-type document numbering (prefixes + counters)
                that never reuses a number even after deletion.
   Each lives in its own hidden document (declared on hidden modules
   in psa.modules.js) so sync/conflict handling covers them too.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const store = ERP.store;

  const MASTER = (ERP.MASTER = {
    parties: "parties",
    catalog: "catalog",
    chart: "chart",
    taxes: "taxes",
    defaults: "defaults",
    settings: "settings",
    audit: "audit",
    archive: "archive",
  });

  const master = (ERP.master = {});

  /* ─────────────────────────── low-level loaders ─────────────────────────── */

  const cache = {};
  async function load(moduleId) {
    if (cache[moduleId] && cache[moduleId]._ts && Date.now() - cache[moduleId]._ts < 4000) return cache[moduleId];
    const r = await store.loadDoc(moduleId);
    cache[moduleId] = r.error ? [] : r.records;
    cache[moduleId]._ts = Date.now();
    return cache[moduleId];
  }
  function invalidate(moduleId) { delete cache[moduleId]; }
  master.flush = () => { for (const k in cache) delete cache[k]; };

  async function save(moduleId, records, opts) {
    const r = await store.saveDoc(moduleId, records, opts);
    invalidate(moduleId);
    return r;
  }

  /* ─────────────────────────── public record loaders ─────────────────────────── */

  master.parties = () => load(MASTER.parties);
  master.catalog = () => load(MASTER.catalog);
  master.chart = () => load(MASTER.chart);
  master.taxes = () => load(MASTER.taxes);
  master.defaultsList = () => load(MASTER.defaults);
  master.settingsList = () => load(MASTER.settings);

  master.saveParties = (r) => save(MASTER.parties, r);
  master.saveCatalog = (r) => save(MASTER.catalog, r);
  master.saveChart = async (r) => {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("taxonomy.edit");
    const res = await save(MASTER.chart, r);
    if (!res.error) await master.audit({ action: "chart_update", perm: "taxonomy.edit", targetType: "config", targetId: 0, summary: "Chart of accounts updated — " + (r || []).length + " account(s)." });
    return res;
  };
  master.saveTaxes = async (r) => {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("taxonomy.edit");
    const res = await save(MASTER.taxes, r);
    if (!res.error) await master.audit({ action: "tax_update", perm: "taxonomy.edit", targetType: "config", targetId: 0, summary: "Tax rates updated — " + (r || []).length + " rate(s)." });
    return res;
  };
  master.saveDefaults = async (r) => {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("taxonomy.edit");
    const res = await save(MASTER.defaults, r);
    if (!res.error) await master.audit({ action: "defaults_update", perm: "taxonomy.edit", targetType: "config", targetId: 0, summary: "Automatic-posting account defaults updated." });
    return res;
  };
  master.saveSettings = async (r) => {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("data.manage");
    const res = await save(MASTER.settings, r);
    if (!res.error) await master.audit({ action: "settings_update", perm: "data.manage", targetType: "config", targetId: 0, summary: "Fiscal profile / numbering settings updated." });
    return res;
  };

  /* Convenience: the posting-defaults record as a map. */
  async function defaultsMap() {
    const list = await load(MASTER.defaults);
    const rec = list.find((r) => r.kind === "defaults");
    return (rec && rec.accounts) || {};
  }
  master.defaultsMap = defaultsMap;

  /* Convenience: settings split into profile + numbering. */
  master.settings = async function () {
    const list = await load(MASTER.settings);
    const profile = list.find((r) => r.kind === "profile") || master.DEFAULT_PROFILE;
    const numbering = list.find((r) => r.kind === "numbering") || master.DEFAULT_NUMBERING;
    return { profile, numbering };
  };

  master.currency = async function () {
    const s = await master.settings();
    return (s.profile && s.profile.currency) || "USD";
  };

  /* ─────────────────────────── ids ─────────────────────────── */

  master.nextId = function (records) {
    let max = 0;
    (records || []).forEach((r) => { if (r && isFinite(r.id)) max = Math.max(max, Number(r.id)); });
    return max + 1;
  };

  /* ─────────────────────────── party helpers ─────────────────────────── */

  master.party = async function (id) {
    const list = await master.parties();
    return list.find((p) => String(p.id) === String(id)) || null;
  };
  master.partyName = async function (id) {
    const p = await master.party(id);
    return p ? p.name : (id == null || id === "" ? "—" : String(id));
  };

  master.catalogItem = async function (id) {
    const list = await master.catalog();
    return list.find((c) => String(c.id) === String(id)) || null;
  };
  master.account = async function (code) {
    const list = await master.chart();
    return list.find((a) => String(a.code) === String(code)) || null;
  };
  master.tax = async function (code) {
    const list = await master.taxes();
    return list.find((t) => t.code === code) || null;
  };

  /* Merge party `fromId` into `intoId` across the whole system: every
     reference (partyId/supplierId/customerId) in every module document is
     rewritten, CRM records are reassigned, and the merged party is removed. */
  master.mergeParties = async function (fromId, intoId) {
    const docs = [
      { module: "crm", kind: null },
      { module: "sales", kind: null },
      { module: "purchasing", kind: null },
      { module: "projects", kind: null },
      { module: MASTER.audit, kind: null },
      { module: "finance", kind: null, all: true },
    ];
    const keys = ["partyId", "supplierId", "customerId"];
    let touched = 0;
    for (const d of docs) {
      const mod = ERP.getModule(d.module);
      if (!mod || !mod.doc) continue;
      const r = await store.loadDoc(d.module, d.all ? { all: true } : {});
      if (r.error) continue;
      const records = r.records || [];
      let changed = false;
      for (const rec of records) {
        for (const k of keys) {
          if (rec[k] != null && String(rec[k]) === String(fromId)) { rec[k] = intoId; changed = true; }
        }
      }
      if (changed) {
        await store.saveDoc(d.module, records);
        touched++;
      }
    }
    const parties = await master.parties();
    const remaining = parties.filter((p) => String(p.id) !== String(fromId));
    await master.saveParties(remaining);
    invalidate(MASTER.parties);
    return { merged: fromId, into: intoId, docsTouched: touched };
  };

  /* ─────────────────────────── document numbering (Task 9) ─────────────────────────── */

  master.DEFAULT_PROFILE = {
    id: "profile", kind: "profile",
    companyName: "My Business", legalName: "My Business Ltd", address: "", city: "",
    country: "", currency: "USD", fiscalYearStartMonth: 1, taxScheme: "vat",
    email: "", phone: "", website: "",
  };

  master.DEFAULT_NUMBERING = {
    id: "numbering", kind: "numbering",
    prefixes: {
      quote: "QT", order: "SO", invoice: "INV", creditNote: "CN",
      po: "PO", receipt: "REC", bill: "BILL", supplierPayment: "PAY",
      payment: "PAY", project: "PRJ", journal: "JRNL", bankEntry: "BK",
    },
    counters: {},
    pattern: "{prefix}-{seq}",
    pad: 4,
  };

  master.DEFAULT_CHART = [
    { id: 1, code: "1000", name: "Bank & cash", type: "asset", active: true, parent: null },
    { id: 2, code: "1100", name: "Accounts receivable", type: "asset", active: true, parent: null },
    { id: 3, code: "1200", name: "Inventory", type: "asset", active: true, parent: null },
    { id: 4, code: "1300", name: "Tax paid (input VAT)", type: "asset", active: true, parent: null },
    { id: 5, code: "2000", name: "Accounts payable", type: "liability", active: true, parent: null },
    { id: 6, code: "2100", name: "Tax collected (output VAT)", type: "liability", active: true, parent: null },
    { id: 7, code: "3000", name: "Owner's equity", type: "equity", active: true, parent: null },
    { id: 8, code: "3100", name: "Retained earnings", type: "equity", active: true, parent: null },
    { id: 9, code: "4000", name: "Sales revenue", type: "income", active: true, parent: null },
    { id: 10, code: "4100", name: "Service revenue", type: "income", active: true, parent: null },
    { id: 11, code: "5000", name: "Cost of goods sold", type: "expense", active: true, parent: null },
    { id: 12, code: "5100", name: "Operating expenses", type: "expense", active: true, parent: null },
  ];

  master.DEFAULT_TAXES = [
    { id: 1, code: "NONE", name: "No tax", rate: 0, active: true },
    { id: 2, code: "VAT0", name: "VAT 0%", rate: 0, active: true },
    { id: 3, code: "VAT10", name: "VAT 10%", rate: 10, active: true },
    { id: 4, code: "VAT20", name: "VAT 20%", rate: 20, active: true },
  ];

  master.DEFAULT_DEFAULTS = [
    {
      id: "defaults", kind: "defaults",
      accounts: {
        bank: "1000", ar: "1100", inventory: "1200", taxPaid: "1300",
        ap: "2000", taxCollected: "2100", equity: "3000", retainedEarnings: "3100",
        salesRevenue: "4000", serviceRevenue: "4100", cogs: "5000", expense: "5100",
      },
    },
  ];

  /* Idempotent: only seeds a master document when it is empty. */
  master.seed = async function () {
    const settings = await load(MASTER.settings);
    if (!settings.length) {
      const recs = [Object.assign({}, master.DEFAULT_PROFILE), JSON.parse(JSON.stringify(master.DEFAULT_NUMBERING))];
      await save(MASTER.settings, recs);
    }
    const chart = await load(MASTER.chart);
    if (!chart.length) await save(MASTER.chart, JSON.parse(JSON.stringify(master.DEFAULT_CHART)));
    const taxes = await load(MASTER.taxes);
    if (!taxes.length) await save(MASTER.taxes, JSON.parse(JSON.stringify(master.DEFAULT_TAXES)));
    const defs = await load(MASTER.defaults);
    if (!defs.length) await save(MASTER.defaults, JSON.parse(JSON.stringify(master.DEFAULT_DEFAULTS)));
    invalidate(MASTER.settings); invalidate(MASTER.chart); invalidate(MASTER.taxes); invalidate(MASTER.defaults);
  };

  /* Allocate the next sequential number for `type` (e.g. "invoice" → "INV-0007").
     The counter lives in the settings document; the write is compare-and-set so
     concurrent devices get distinct numbers (on a conflict this device adopts the
     other side's counter and retries — it never reuses a number). */
  master.allocateNumber = async function (type) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const list = await load(MASTER.settings);
      const profile = list.find((r) => r.kind === "profile") || master.DEFAULT_PROFILE;
      const numbering = JSON.parse(JSON.stringify(list.find((r) => r.kind === "numbering") || master.DEFAULT_NUMBERING));
      const seq = (numbering.counters[type] || 0) + 1;
      numbering.counters[type] = seq;
      const res = await save(MASTER.settings, [profile, numbering]);
      if (res.error === "conflict") {
        await store.resolveConflict(store.docName(MASTER.settings), "keep_theirs");
        invalidate(MASTER.settings);
        continue;
      }
      if (res.error) throw new Error("Could not allocate " + type + " number: " + res.error);
      const prefix = numbering.prefixes[type] || type.toUpperCase();
      const pad = numbering.pad == null ? 4 : numbering.pad;
      const pattern = numbering.pattern || "{prefix}-{seq}";
      return pattern.replace("{prefix}", prefix).replace("{seq}", String(seq).padStart(pad, "0"));
    }
    throw new Error("Number allocation for " + type + " kept conflicting with another device.");
  };

  /* ─────────────────────────── audit log (Task 36) ─────────────────────────── */

  /* Records one state-changing action. `summary` is a short human string;
     `target` is {type, id}. Never throws. The audit doc is split by year. */
  master.audit = async function (entry) {
    try {
      const rec = Object.assign({
        id: Date.now(),
        ts: new Date().toISOString(),
        date: new Date().toISOString(),
        actor: ERP.role || "owner",
        action: "updated",
        targetType: "",
        targetId: null,
        summary: "",
        meta: null,
      }, entry);
      /* Multi-user mode: ask the hub to authorise + sign the entry so the
         audit records the server-verified actor even when the local role
         selector disagrees. Offline / tests: the hub signs nothing. */
      try {
        if (ERP.team && typeof ERP.team.signAudit === "function") {
          const signed = await ERP.team.signAudit(rec);
          if (signed && signed.entry) {
            rec.id = signed.entry.id;
            rec.ts = signed.entry.ts;
            rec.date = new Date(signed.entry.ts).toISOString();
            rec.actor = signed.entry.actor;
            rec.role = signed.entry.role;
            rec.verified = true;
          } else if (signed && signed.denied) {
            rec.action = "denied:" + rec.action;
            rec.summary = "Rejected by the team server — " + signed.denied + ". " + rec.summary;
          }
        }
      } catch (e) {
        /* never block a write because hub signing failed */
      }
      const d = ERP.getModule(MASTER.audit);
      if (!d || !d.doc) return;
      const r = await store.loadDoc(MASTER.audit);
      const records = (r.records || []).concat([rec]);
      await store.saveDoc(MASTER.audit, records);
    } catch (e) {
      console.error("audit write failed", e);
    }
  };

  master.auditLog = async function (opts) {
    const r = await store.loadDoc(MASTER.audit, opts && opts.all ? { all: true } : {});
    return r.records || [];
  };

  /* ─────────────────────────── boot: seed once, then expose ─────────────────────────── */

  master.init = async function () {
    /* Wait for the editable backend's embed handshake before the first seed,
       then seed (idempotent) so config documents exist on a fresh generator. */
    for (let i = 0; i < 60 && !store.canonicalAvailable(); i++) await new Promise((r) => setTimeout(r, 250));
    try { await master.seed(); } catch (e) { console.error("master seed failed", e); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", master.init);
  else master.init();
})();
