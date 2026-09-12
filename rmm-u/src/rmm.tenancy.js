/* ============================================================
   RMM-U — tenancy & data storage (Phase 1 · Task 2)
   Each managed-service provider is a tenant, and each tenant is a
   versioned JSON document in RMM-U's own storage namespace:

     rmm-v1-provider-<id>   the provider aggregate — sites, device
                            groups, devices, policies, monitor
                            definitions, alert history, the script
                            library, patch & software state and the
                            automation rules, all in one document.
     rmm-v1-providers       the tenant registry — one summary record
                            per provider, so the console can list
                            tenants without loading every aggregate.

   Both go through the canonical document store (src/erp.store.js),
   so every tenant automatically gets: a canonical editable-file copy
   keyed to this generator (survives across devices), a locally cached
   edit key, a fast localStorage cache so reads never block on the
   network, a monotone revision counter, the per-document write
   ceiling, and compare-and-set conflict protection on concurrent
   edits.

   Config (main.pjs → config.rmm) controls the namespace prefix and
   the first-run demo seed. Everything is exposed as
   window.ERP.tenancy for later phases (device hierarchy, policies,
   monitors, alerts, automations) to build on.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store) return;
  const store = ERP.store;

  const T = (ERP.tenancy = {});

  /* The collections the tenancy contract promises inside every
     provider document (arrays of records) and the two that are
     structured objects rather than record lists. */
  const COLLECTIONS = ["sites", "deviceGroups", "devices", "policies", "monitorDefinitions", "alerts", "scriptLibrary", "automationRules"];
  const OBJECT_COLLECTIONS = ["patchState", "softwareState", "securityState", "remoteState", "integrationsState"];
  const ID_PREFIX = {
    sites: "site", deviceGroups: "grp", devices: "dev", policies: "pol",
    monitorDefinitions: "mon", alerts: "alrt", scriptLibrary: "scr", automationRules: "auto",
  };
  const PROVIDER_KIND = "provider";
  const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

  T.REGISTRY_MODULE = "providers";
  T.COLLECTIONS = COLLECTIONS.slice();
  T.OBJECT_COLLECTIONS = OBJECT_COLLECTIONS.slice();

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const now = () => new Date().toISOString();
  const rand = (n) => { let s = ""; for (let i = 0; i < n; i++) s += ID_CHARS[(Math.random() * ID_CHARS.length) | 0]; return s; };

  T.newId = (prefix) => (prefix || cfg("rmm.providerPrefix", "prov")) + "-" + rand(8);
  T.newItemId = (collection) => T.newId(ID_PREFIX[collection] || "item");

  /* ─────────────────── document naming ─────────────────── */

  T.namespace = () => store.namespace;
  T.registryDocName = () => store.docName(T.REGISTRY_MODULE);
  T.providerDocName = (id) => store.namespace + "-v" + store.schemaVersion + "-provider-" + id;
  T.providerLogicalName = (id) => "provider-" + id;

  /* ─────────────────── the provider aggregate ─────────────────── */

  function newProvider(data) {
    data = data || {};
    return {
      kind: PROVIDER_KIND,
      id: data.id || T.newId(),
      name: String(data.name || "Untitled provider"),
      legalName: String(data.legalName || ""),
      status: data.status || "active",          // active | onboarding | suspended | archived
      timezone: data.timezone || cfg("rmm.defaultTimezone", "UTC"),
      currency: data.currency || cfg("rmm.defaultCurrency", "USD"),
      locale: String(data.locale || ""),
      contact: Object.assign({ email: "", phone: "", website: "", address: "" }, asObj(data.contact)),
      tags: asArr(data.tags),
      demo: !!data.demo,
      createdAt: data.createdAt || now(),
      updatedAt: now(),
      sites: asArr(data.sites),
      deviceGroups: asArr(data.deviceGroups),
      devices: asArr(data.devices),
      policies: asArr(data.policies),
      monitorDefinitions: asArr(data.monitorDefinitions),
      alerts: asArr(data.alerts),
      scriptLibrary: asArr(data.scriptLibrary),
      automationRules: asArr(data.automationRules),
      patchState: Object.assign({ policies: [], scanRuns: [], approvals: [] }, asObj(data.patchState)),
      softwareState: Object.assign({ catalog: [], deployments: [], licenses: [] }, asObj(data.softwareState)),
      securityState: Object.assign({ checks: [], baselines: [], posture: {}, scans: [], deviations: [], backupExpectations: [], backupJobs: [], backupState: {}, recoveryTests: [] }, asObj(data.securityState)),
      remoteState: Object.assign({ tools: [], sessions: [], shells: [], transfers: [] }, asObj(data.remoteState)),
      integrationsState: Object.assign({ sources: {}, ownership: {}, external: [], drift: [], webhooks: [], publications: [] }, asObj(data.integrationsState)),
      meta: asObj(data.meta),
    };
  }
  T.newProvider = newProvider;

  /* Bring a loaded record up to the current schema without dropping
     anything (older/partial documents still open). */
  function normalizeProvider(p) {
    if (!p || typeof p !== "object") return null;
    const base = newProvider(p);
    const out = Object.assign({}, p, {
      kind: PROVIDER_KIND,
      id: p.id || base.id,
      name: p.name || base.name,
      contact: Object.assign(base.contact, asObj(p.contact)),
      tags: Array.isArray(p.tags) ? p.tags : [],
      patchState: Object.assign(base.patchState, asObj(p.patchState)),
      softwareState: Object.assign(base.softwareState, asObj(p.softwareState)),
      securityState: Object.assign(base.securityState, asObj(p.securityState)),
      remoteState: Object.assign(base.remoteState, asObj(p.remoteState)),
      integrationsState: Object.assign(base.integrationsState, asObj(p.integrationsState)),
      meta: asObj(p.meta),
    });
    for (const c of COLLECTIONS) out[c] = Array.isArray(p[c]) ? p[c] : [];
    return out;
  }
  T.normalizeProvider = normalizeProvider;

  T.providerFields = () => Object.keys(newProvider());

  /* ─────────────────── the tenant registry ─────────────────── */

  function summaryOf(p) {
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      demo: !!p.demo,
      timezone: p.timezone,
      currency: p.currency,
      siteCount: asArr(p.sites).length,
      groupCount: asArr(p.deviceGroups).length,
      deviceCount: asArr(p.devices).length,
      updatedAt: p.updatedAt,
    };
  }

  let registryMemo = { at: 0, list: null };

  async function loadRegistry() {
    const r = await store.loadDoc(T.REGISTRY_MODULE);
    return asArr(r.error ? [] : r.records);
  }

  T.list = async function (opts) {
    opts = opts || {};
    const t = Date.now();
    if (!opts.force && registryMemo.list && t - registryMemo.at < 1500) return clone(registryMemo.list);
    const list = await loadRegistry();
    registryMemo = { at: t, list };
    return clone(list);
  };

  async function saveRegistry(list) {
    const res = await store.saveDoc(T.REGISTRY_MODULE, list);
    if (!res.error) registryMemo = { at: Date.now(), list: asArr(list) };
    return res;
  }

  async function upsertRegistry(p) {
    const list = await loadRegistry();
    const rec = summaryOf(p);
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    return saveRegistry(list);
  }

  async function dropFromRegistry(id) {
    const list = (await loadRegistry()).filter((x) => x.id !== id);
    return saveRegistry(list);
  }

  T.reload = function () { registryMemo = { at: 0, list: null }; };

  /* ─────────────────── provider documents ─────────────────── */

  function providerEnvelope(p) {
    return {
      schema: store.docSchema,
      schemaVersion: store.schemaVersion,
      doc: T.providerLogicalName(p.id),
      year: null,
      rev: 0,
      updatedAt: p.updatedAt || now(),
      updatedBy: ERP.role || "owner",
      records: [p],
    };
  }

  async function writeProvider(p) {
    p.updatedAt = now();
    return store.put(T.providerDocName(p.id), providerEnvelope(p), {
      module: T.REGISTRY_MODULE, name: T.providerLogicalName(p.id), year: null,
    });
  }

  async function readProvider(id) {
    const name = T.providerDocName(id);
    const r = await store.get(name);
    if (r.error) return { error: r.error, message: r.message, id };
    const rec = r.doc && r.doc.records && r.doc.records[0];
    if (!rec) return { error: "not_found", id };
    return { provider: normalizeProvider(rec), rev: r.doc.rev || 0, source: r.source, docName: name };
  }

  T.get = (id) => readProvider(id);
  T.exists = async (id) => !(await readProvider(id)).error;

  T.create = async function (data) {
    data = data || {};
    const list = await loadRegistry();
    let id = data.id || T.newId();
    for (let i = 0; i < 12 && list.some((x) => x.id === id); i++) id = T.newId();
    const p = newProvider(Object.assign({}, data, { id }));
    const w = await writeProvider(p);
    if (w.error) return { error: w.error, message: w.message, conflict: !!w.conflict, provider: p };
    const reg = await upsertRegistry(p);
    if (reg.error) return { error: reg.error, message: reg.message, provider: p, partial: true, result: w };
    notify("create", p);
    return { provider: p, rev: w.rev, editKey: w.editKey || null, created: !!w.created };
  };

  /* Read-modify-write under the store's compare-and-set guard.
     `mutate` receives a mutable deep clone of the provider aggregate;
     return an object to merge it as a patch, or just mutate it. */
  T.update = async function (id, mutate) {
    const g = await readProvider(id);
    if (g.error) return g;
    const draft = clone(g.provider);
    if (typeof mutate === "function") {
      const ret = mutate(draft);
      if (ret && typeof ret === "object") Object.assign(draft, ret);
    } else if (mutate && typeof mutate === "object") {
      Object.assign(draft, mutate);
    }
    draft.id = id;
    draft.kind = PROVIDER_KIND;
    const w = await writeProvider(draft);
    if (w.error) return { error: w.error, message: w.message, conflict: !!w.conflict, provider: draft };
    await upsertRegistry(draft);
    notify("update", draft);
    return { provider: draft, rev: w.rev, noop: !!w.noop };
  };

  T.save = async function (provider) {
    if (!provider || !provider.id) return { error: "missing_id" };
    const p = normalizeProvider(provider);
    const w = await writeProvider(p);
    if (w.error) return w;
    await upsertRegistry(p);
    notify("save", p);
    return Object.assign(w, { provider: p });
  };

  T.archive = (id) => T.update(id, (p) => { p.status = "archived"; });
  T.restore = (id) => T.update(id, (p) => { if (p.status === "archived") p.status = "active"; });

  /* Soft-remove: the tenant leaves the registry while its document is
     retained (status "archived"), so an accidental removal is always
     recoverable from canonical or a backup. */
  T.remove = async function (id) {
    const g = await readProvider(id);
    if (g.error) return { error: g.error, message: g.message, id };
    const p = clone(g.provider);
    p.status = "archived";
    const w = await writeProvider(p);
    if (w.error) return { error: w.error, message: w.message, conflict: !!w.conflict };
    await dropFromRegistry(id);
    notify("remove", { id });
    return { removed: id, status: "archived" };
  };

  /* ─────────────────── collection helpers ─────────────────── */

  T.addItem = async function (id, collection, item) {
    if (COLLECTIONS.indexOf(collection) === -1) return { error: "unknown_collection", collection };
    const rec = Object.assign({}, clone(item) || {});
    rec.id = rec.id || T.newItemId(collection);
    rec.createdAt = rec.createdAt || now();
    rec.updatedAt = rec.createdAt;
    const r = await T.update(id, (p) => { p[collection].push(rec); });
    return Object.assign({}, r, { item: rec });
  };

  T.updateItem = async function (id, collection, itemId, patch) {
    if (COLLECTIONS.indexOf(collection) === -1) return { error: "unknown_collection", collection };
    let found = null;
    const r = await T.update(id, (p) => {
      const it = p[collection].find((x) => String(x.id) === String(itemId));
      if (!it) return;
      if (typeof patch === "function") patch(it);
      else if (patch && typeof patch === "object") Object.assign(it, clone(patch));
      it.updatedAt = now();
      found = it;
    });
    if (!r.error && !found) return { error: "not_found", collection, itemId };
    return Object.assign({}, r, { item: found });
  };

  T.removeItem = async function (id, collection, itemId) {
    if (COLLECTIONS.indexOf(collection) === -1) return { error: "unknown_collection", collection };
    return T.update(id, (p) => { p[collection] = p[collection].filter((x) => String(x.id) !== String(itemId)); });
  };

  T.item = async function (id, collection, itemId) {
    const g = await readProvider(id);
    if (g.error) return g;
    if (COLLECTIONS.indexOf(collection) === -1) return { error: "unknown_collection", collection };
    const it = g.provider[collection].find((x) => String(x.id) === String(itemId));
    return it ? { item: it } : { error: "not_found", collection, itemId };
  };

  /* ─────────────────── diagnostics ─────────────────── */

  T.stats = async function () {
    const list = await T.list({ force: true });
    const s = { providers: list.length, active: 0, archived: 0, sites: 0, deviceGroups: 0, devices: 0, bytes: 0 };
    for (const p of list) {
      if (p.status === "active") s.active++;
      if (p.status === "archived") s.archived++;
      s.sites += p.siteCount || 0;
      s.deviceGroups += p.groupCount || 0;
      s.devices += p.deviceCount || 0;
    }
    const idx = (await store.getIndex()).index;
    const regName = store.docName(T.REGISTRY_MODULE);
    for (const n of Object.keys(idx.documents || {})) {
      if (n === regName || n.indexOf("-provider-") !== -1) s.bytes += idx.documents[n].bytes || 0;
    }
    return s;
  };

  /* Is a provider document internally well-formed? (Used by the
     validation suite; the data-quality linter reuses it later.) */
  T.validate = function (p) {
    const errors = [];
    if (!p || typeof p !== "object") return { valid: false, errors: ["provider is not an object"] };
    if (!p.id) errors.push("missing id");
    if (!p.name) errors.push("missing name");
    for (const c of COLLECTIONS) if (!Array.isArray(p[c])) errors.push("missing array: " + c);
    for (const c of OBJECT_COLLECTIONS) if (!p[c] || typeof p[c] !== "object" || Array.isArray(p[c])) errors.push("missing object: " + c);
    return { valid: errors.length === 0, errors };
  };

  /* ─────────────────── change notification ─────────────────── */

  const listeners = [];
  T.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  /* ─────────────────── first-run demo seed ─────────────────── */

  function seedProviders() {
    const tz = cfg("rmm.defaultTimezone", "UTC");
    return [{
      name: cfg("rmm.demoProviderName", "Demo Managed Services"),
      status: "active",
      demo: true,
      timezone: tz,
      tags: ["demo"],
      contact: { email: "support@example.com", phone: "", website: "", address: "" },
      sites: [
        { id: "site-demo-hq", name: "Head Office", address: "", timezone: tz, createdAt: now(), updatedAt: now() },
        { id: "site-demo-branch", name: "Branch Office", address: "", timezone: tz, createdAt: now(), updatedAt: now() },
      ],
      deviceGroups: [
        { id: "grp-demo-servers", name: "Servers", kind: "static", siteId: "site-demo-hq", tags: ["server"], createdAt: now(), updatedAt: now() },
        { id: "grp-demo-workstations", name: "Workstations", kind: "static", siteId: null, tags: ["workstation"], createdAt: now(), updatedAt: now() },
      ],
    }];
  }

  /* Idempotent: seeds the demo tenant only when the registry is empty
     (and only when config.rmm.seedDemo is not false). */
  T.seed = async function (opts) {
    opts = opts || {};
    if (!opts.force && cfg("rmm.seedDemo", true) === false) return { skipped: true, reason: "seed_disabled" };
    const list = await loadRegistry();
    if (list.length && !opts.force) return { skipped: true, reason: "registry_not_empty", providers: list.length };
    const created = [];
    for (const data of seedProviders()) {
      const r = await T.create(data);
      if (r.error) return { created, error: r.error, message: r.message };
      created.push(r.provider.id);
    }
    return { created };
  };

  /* Boot promise other RMM modules await before they seed, so they never
     race the tenancy seed and create a second demo tenant. */
  let readyResolve;
  T.ready = new Promise((res) => { readyResolve = res; });

  T.init = async function () { try { await T.seed(); } catch (e) { console.error("tenancy seed failed", e); } finally { readyResolve(); } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", T.init);
  else T.init();
})();
