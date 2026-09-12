/* ============================================================
   PSA-U — tenancy & data storage (Phase 1 · Task 2)
   psa-u is multi-tenant: one deployment can serve many service
   providers, and each provider holds many client companies.

   Every tenant is a versioned JSON document in psa-u's own store
   namespace, so it syncs across devices and survives reloads with
   a locally cached edit key and a fast local cache (both supplied
   by the document store):

     psa-v1-tenancy            root registry: the service providers
     psa-v1-tenant-<pid>       one service provider document —
                               provider profile, company directory
                               index, members, teams, hours calendars
                               and taxonomy (all records, by `kind`)
     psa-v1-company-<cid>      one client company document —
                               the company record, its sites and its
                               contacts, plus that company's tickets,
                               time, agreements, invoices, projects,
                               quotes, POs, configurations and articles

   Controllers never name documents directly; they go through this
   service, which resolves the active provider / company and hands
   out read/write handles for a tenant document.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const store = ERP.store;

  const T = (ERP.tenancy = {});

  T.ROOT_MODULE = "tenancy";
  T.PROVIDER_PREFIX = "psa-v1-tenant-";
  T.COMPANY_PREFIX = "psa-v1-company-";

  const LS = {
    provider: "psa.tenancy.activeProvider",
    company: "psa.tenancy.activeCompany",
  };
  const readLS = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const writeLS = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };

  /* synchronous display labels for tenant documents (used by the sync centre
     and the backups UI, which render in a synchronous pass) */
  T.labels = {};

  T.providerDocName = (pid) => T.PROVIDER_PREFIX + String(pid);
  T.companyDocName = (cid) => T.COMPANY_PREFIX + String(cid);

  function nextId(list) {
    let max = 0;
    (list || []).forEach((r) => { if (r && isFinite(r.id)) max = Math.max(max, Number(r.id)); });
    return max + 1;
  }
  T.nextId = nextId;

  function nowIso() { return new Date().toISOString(); }

  /* ─────────────────────────── root registry ─────────────────────────── */

  let rootCache = null;
  async function rootRecords(force) {
    if (rootCache && !force) return rootCache;
    const r = await store.loadDoc(T.ROOT_MODULE);
    rootCache = (r && r.records) || [];
    return rootCache;
  }
  async function writeRoot(records) {
    const r = await store.saveDoc(T.ROOT_MODULE, records);
    if (!r.error) rootCache = records;
    return r;
  }
  T.invalidateRoot = () => { rootCache = null; };
  T.invalidate = () => { rootCache = null; };

  T.providers = async () => (await rootRecords()).filter((r) => r.kind === "provider");
  T.providerById = async (id) => (await rootRecords()).find((r) => r.kind === "provider" && String(r.id) === String(id)) || null;

  T.createProvider = async function (data) {
    data = data || {};
    const list = await rootRecords(true);
    const id = nextId(list);
    const rec = {
      id,
      kind: "provider",
      name: data.name || "New service provider",
      legalName: data.legalName || "",
      email: data.email || "",
      phone: data.phone || "",
      website: data.website || "",
      address: data.address || "",
      city: data.city || "",
      region: data.region || "",
      country: data.country || "",
      currency: data.currency || ERP.configVal("psa.defaultCurrency", "USD"),
      timezone: data.timezone || ERP.configVal("psa.defaultTimezone", "UTC"),
      fiscalYearStartMonth: data.fiscalYearStartMonth || Number(ERP.configVal("psa.fiscalYearStartMonth", 1)) || 1,
      status: "active",
      createdAt: nowIso(),
    };
    await writeRoot(list.concat([rec]));
    T.labels[T.providerDocName(id)] = rec.name + " (provider)";
    if (!T.activeProviderId()) T.setActiveProvider(id);
    return rec;
  };

  T.updateProvider = async function (data) {
    const list = await rootRecords(true);
    const i = list.findIndex((r) => r.kind === "provider" && String(r.id) === String(data.id));
    if (i < 0) return { error: "not_found" };
    list[i] = Object.assign({}, list[i], data);
    const res = await writeRoot(list);
    T.labels[T.providerDocName(data.id)] = list[i].name + " (provider)";
    T.notify();
    return res;
  };

  T.deleteProvider = async function (id) {
    const list = await rootRecords(true);
    const remaining = list.filter((r) => !(r.kind === "provider" && String(r.id) === String(id)));
    const res = await writeRoot(remaining);
    if (T.activeProviderId() === String(id)) T.setActiveProvider(remaining.find((r) => r.kind === "provider") ? remaining.find((r) => r.kind === "provider").id : null);
    T.notify();
    return res;
  };

  /* ─────────────────────────── active selection ─────────────────────────── */

  T.activeProviderId = function () { return readLS(LS.provider); };
  T.setActiveProvider = function (id) {
    writeLS(LS.provider, id == null ? null : String(id));
    T._providerCache = null;
    T.notify();
  };
  T.activeCompanyId = function () { return readLS(LS.company); };
  T.setActiveCompany = function (id) {
    writeLS(LS.company, id == null ? null : String(id));
    T.notify();
  };

  let providerCache = null;
  T.provider = async function (force) {
    if (providerCache && !force) return providerCache;
    let id = T.activeProviderId();
    const list = await rootRecords();
    if (id) {
      const p = list.find((r) => r.kind === "provider" && String(r.id) === String(id));
      if (p) { providerCache = p; T.labels[T.providerDocName(p.id)] = p.name + " (provider)"; return p; }
    }
    const first = list.find((r) => r.kind === "provider");
    if (first) T.setActiveProvider(first.id);
    providerCache = first || null;
    if (first) T.labels[T.providerDocName(first.id)] = first.name + " (provider)";
    return providerCache;
  };

  T.providerId = async function () {
    const p = await T.provider();
    return p ? p.id : null;
  };

  /* ─────────────────────────── tenant documents ─────────────────────────── */

  /* Read a tenant document by level ("provider" | "company") + id. Returns
     { records, doc, error, source }. */
  T.load = async function (level, id) {
    const name = level === "company" ? T.companyDocName(id) : T.providerDocName(id);
    const r = await store.get(name);
    return { name, doc: r.doc || null, records: (r.doc && r.doc.records) || [], error: r.error || null, source: r.source };
  };

  /* Overwrite a tenant document's records. Returns the store write result. */
  T.save = async function (level, id, records) {
    const name = level === "company" ? T.companyDocName(id) : T.providerDocName(id);
    return store.set(name, records || []);
  };

  T.records = async function (level, id, kind) {
    const r = await T.load(level, id);
    const list = r.records || [];
    return kind ? list.filter((x) => x.kind === kind) : list;
  };

  /* Convenience: the active provider's records (optionally one kind). */
  T.providerRecords = async function (kind) {
    const p = await T.provider();
    if (!p) return [];
    return T.records("provider", p.id, kind);
  };

  /* Convenience: the active company's records (optionally one kind). */
  T.company = async function () {
    const cid = T.activeCompanyId();
    if (!cid) return null;
    const list = await T.records("company", cid, "company");
    if (list.length) { T.labels[T.companyDocName(cid)] = list[0].name + " (client)"; return list[0]; }
    return null;
  };

  T.companyRecords = async function (companyId, kind) {
    return T.records("company", companyId, kind);
  };

  /* Upsert a single record inside a tenant document. Returns the record. */
  T.upsert = async function (level, id, rec) {
    const r = await T.load(level, id);
    const list = r.records || [];
    const i = list.findIndex((x) => String(x.id) === String(rec.id) && x.kind === rec.kind);
    if (i >= 0) list[i] = Object.assign({}, list[i], rec);
    else list.push(rec);
    const res = await T.save(level, id, list);
    return Object.assign({ record: rec }, res);
  };

  T.remove = async function (level, id, predicate) {
    const r = await T.load(level, id);
    const list = (r.records || []).filter((x) => !predicate(x));
    return T.save(level, id, list);
  };

  /* ─────────────────────────── company-directory index ───────────────────────────
     The provider document carries a lightweight index of its client companies
     (id, name, status, …) so the directory lists without reading every
     company document. The full company record lives in the company document. */

  T.companyIndex = async function (providerId) {
    const pid = providerId == null ? await T.providerId() : providerId;
    if (pid == null) return [];
    return T.records("provider", pid, "companyIndex");
  };

  function indexEntry(company, counts) {
    return {
      id: company.id,
      kind: "companyIndex",
      providerId: company.providerId,
      name: company.name,
      status: company.status || "active",
      type: company.type || "",
      accountManager: company.accountManager || null,
      city: company.city || "",
      sites: counts ? counts.sites || 0 : company.siteCount || 0,
      contacts: counts ? counts.contacts || 0 : company.contactCount || 0,
      updatedAt: nowIso(),
    };
  }
  T.indexEntry = indexEntry;

  T.upsertCompanyIndex = async function (providerId, company, counts) {
    const pid = providerId == null ? await T.providerId() : providerId;
    if (pid == null) return { error: "no_provider" };
    const list = await T.records("provider", pid, "companyIndex");
    const entry = indexEntry(company, counts);
    const i = list.findIndex((x) => String(x.id) === String(entry.id));
    if (i >= 0) list[i] = Object.assign({}, list[i], entry);
    else list.push(entry);
    const r = await T.records("provider", pid);
    const others = r.filter((x) => x.kind !== "companyIndex");
    const res = await T.save("provider", pid, others.concat(list));
    T.labels[T.companyDocName(company.id)] = company.name + " (client)";
    return res;
  };

  T.removeCompanyIndex = async function (providerId, companyId) {
    const pid = providerId == null ? await T.providerId() : providerId;
    const r = await T.records("provider", pid);
    const list = r.filter((x) => !(x.kind === "companyIndex" && String(x.id) === String(companyId)));
    return T.save("provider", pid, list);
  };

  /* ─────────────────────────── human labels ─────────────────────────── */

  function labelFor(name) {
    if (T.labels[name]) return T.labels[name];
    if (name.indexOf(T.PROVIDER_PREFIX) === 0) return "Service provider " + name.slice(T.PROVIDER_PREFIX.length);
    if (name.indexOf(T.COMPANY_PREFIX) === 0) return "Client " + name.slice(T.COMPANY_PREFIX.length);
    return null;
  }
  T.labelFor = labelFor;

  /* Wrap the store's sync-centre label so tenant documents read nicely. */
  if (store && typeof store.humanDocName === "function" && !store._psaHumanPatched) {
    const orig = store.humanDocName;
    store.humanDocName = function (name) {
      const l = labelFor(name);
      if (l) return l;
      return orig.call(store, name);
    };
    store._psaHumanPatched = true;
  }

  /* ─────────────────────────── change notification ─────────────────────────── */

  const listeners = new Set();
  T.subscribe = function (fn) { if (typeof fn === "function") listeners.add(fn); return () => listeners.delete(fn); };
  T.notify = function () {
    providerCache = null;
    listeners.forEach((fn) => { try { fn(); } catch (e) {} });
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  T.seed = async function () {
    const providers = await T.providers();
    if (!providers.length) {
      await T.createProvider({
        name: ERP.configVal("branding.companyName", "PSA-U"),
        legalName: ERP.configVal("branding.companyName", "PSA-U"),
        email: ERP.configVal("branding.contactEmail", ""),
        phone: ERP.configVal("branding.contactPhone", ""),
        website: ERP.configVal("branding.companyUrl", ""),
        address: ERP.configVal("branding.address", ""),
      });
    }
    const p = await T.provider();
    if (p && ERP.taxonomy && typeof ERP.taxonomy.seedProvider === "function") {
      await ERP.taxonomy.seedProvider(p.id);
    }
    if (p && ERP.members && typeof ERP.members.seed === "function") {
      await ERP.members.seed();
    }
    return p;
  };

  T.ready = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* The upload plugin's editable layer finishes its embed handshake a moment
     after load, so first-run seeding must wait for a writable store (and
     retry if the very first attempt lands too early). */
  async function waitCanonical() {
    for (let i = 0; i < 60; i++) {
      if (store.canonicalAvailable && store.canonicalAvailable()) return true;
      await sleep(250);
    }
    return false;
  }

  T.trySeed = async function () {
    try { await T.seed(); } catch (e) { console.error("tenancy seed failed", e); }
    const list = await T.providers();
    if (!list.length) return null;
    return T.provider();
  };

  T.init = async function () {
    await waitCanonical();
    let p = await T.trySeed();
    for (let i = 0; i < 12 && !p; i++) { await sleep(400); p = await T.trySeed(); }
    if (p && ERP.master && typeof ERP.master.seed === "function") {
      try { await ERP.master.seed(); } catch (e) {}
    }
    return p;
  };

  /* ─────────────────────────── document inventory ───────────────────────────
     Every tenant document this device knows about, for the storage view. */
  T.tenantDocs = async function () {
    const out = [];
    const idx = (await store.getIndex()).index;
    const docs = (idx && idx.documents) || {};
    for (const name in docs) {
      const e = docs[name];
      if (name.indexOf(T.PROVIDER_PREFIX) === 0 || name.indexOf(T.COMPANY_PREFIX) === 0) {
        out.push({ name, label: labelFor(name), bytes: e.bytes || 0, records: e.recordCount || 0, rev: e.rev || 0, updatedAt: e.updatedAt || null });
      }
    }
    out.sort((a, b) => b.bytes - a.bytes);
    return out;
  };

  T.init();
})();
