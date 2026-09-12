/* ============================================================
   RMM-U — integrations & bus publication  (Phase 10 · Task 42)

   RMM-U is one stage in a pipeline (psa-u tickets, the
   documentation tool, the BI tool), so it must (a) consume records
   that other stages own, (b) publish what it knows in a form the
   other stages and outbound subscribers can rely on, and (c) expose
   a stable API and analytics extract.

   Three pieces:

     • FIELD OWNERSHIP & DRIFT — company, site and configuration
       records arrive from psa-u and the documentation tool. Every
       field has an owner (`rmm` or `external`) so a two-way sync
       never fights itself. When an incoming value disagrees with the
       value RMM-U holds for a field it does not own (or an external
       change overwrites one it does), the difference is recorded as
       **drift** with the exact field, both values and the owner, and
       can be resolved per field.

     • THE SHARED VERSIONED ENVELOPE — device-health, alert and job
       events are wrapped in one schema, `rmm.event.v1`:

         { v:1, id, type, source:"rmm-u", schema:"rmm.event.v1",
           subject, providerId, time, data }

       The same envelope is logged, published to the event bus and
       POSTed to every matching outbound webhook, so a subscriber
       never has to special-case a producer.

     • API & ANALYTICS EXTRACT — `ERP.api` is the read API other
       stages call; `INT.analyticsExtract` produces a schema-stable
       (`rmm.analytics.v1`) snapshot for the BI tool.

   State lives on the provider aggregate as `provider.integrationsState`
   (added to OBJECT_COLLECTIONS), so it syncs and backs up like every
   other collection.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy || !ERP.devices) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const AL = ERP.alerts || null;
  const PA = ERP.patch || null;
  const SEC = ERP.security || null;
  const J = ERP.jobs || null;
  const FL = ERP.fleet || null;
  const EV = ERP.events || null;

  const INT = (ERP.integrations = {});

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const enabled = () => cfg("rmm.integrationsEnabled", true) !== false;
  const publicationCap = () => Math.max(20, num(cfg("rmm.integrationPublicationHistory", 500), 500));
  const actor = () => { try { return ERP.role || "owner"; } catch (e) { return "owner"; } };

  INT.ENVELOPE_VERSION = 1;
  INT.ENVELOPE_SCHEMA = "rmm.event.v1";
  INT.ANALYTICS_VERSION = 1;
  INT.ANALYTICS_SCHEMA = "rmm.analytics.v1";
  INT.API_VERSION = 1;

  /* ─────────────────────── state ─────────────────────── */

  const stateOf = (p) => asObj(asObj(p).integrationsState);
  const providerOf = async (providerId) => { const g = await T.get(providerId); return g.error ? null : g.provider; };

  async function writeState(providerId, mutate, attempts) {
    const tries = Math.max(1, num(attempts, 4));
    let last = null;
    for (let i = 0; i < tries; i++) {
      const r = await T.update(providerId, (p) => { p.integrationsState = asObj(p.integrationsState); mutate(p.integrationsState, p); });
      if (!r.error) return r;
      last = r;
      await new Promise((res) => setTimeout(res, 40));
    }
    return last;
  }
  INT.writeState = writeState;

  async function audit(action, providerId, summary, targetType) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: targetType || "integration", targetId: providerId, summary }); } catch (e) {}
  }

  /* ─────────────────────── sources & ownership ─────────────────── */

  INT.SOURCES = [
    { id: "psa-u", label: "psa-u (PSA)", kind: "psa", desc: "Companies, sites and service-plan configuration owned by the PSA." },
    { id: "docs", label: "Documentation tool", kind: "docs", desc: "Configuration records and documentation links owned by the docs tool." },
  ];
  INT.source = (id) => INT.SOURCES.find((s) => s.id === id) || null;
  INT.sourceLabel = (id) => (INT.source(id) || {}).label || id;

  INT.ENTITY_TYPES = ["company", "site", "configuration"];
  INT.OWNERS = ["rmm", "external"];

  /* Default field ownership per entity type. Ownership is what makes a
     two-way sync safe: a field owned by `external` is written by the
     source, a field owned by `rmm` is never silently overwritten. */
  INT.DEFAULT_OWNERSHIP = {
    company: { name: "external", servicePlan: "external", accountManager: "external", phone: "external", email: "external", tags: "rmm", siteIds: "rmm", notes: "rmm" },
    site: { name: "external", address: "external", timezone: "external", companyId: "external", deviceGroupIds: "rmm", notes: "rmm" },
    configuration: { assetTag: "external", documentationUrl: "external", owner: "external", status: "external", hostname: "rmm", serial: "rmm", ip: "rmm", os: "rmm", notes: "rmm" },
  };

  INT.ownershipFor = function (state, entityType) {
    const base = Object.assign({}, asObj(INT.DEFAULT_OWNERSHIP[entityType]));
    return Object.assign(base, asObj(asObj(asObj(state).ownership)[entityType]));
  };
  INT.ownerOf = function (entityType, field) { return asObj(INT.DEFAULT_OWNERSHIP[entityType])[field] || "external"; };

  /* ─────────────────────── ingest & drift ─────────────────────── */

  function normalizeExternal(raw, sourceId, entityType) {
    raw = asObj(raw);
    return {
      entityType: S(raw.entityType || entityType, 40),
      sourceId: String(raw.sourceId || sourceId),
      externalId: S(raw.externalId || raw.id || "", 120),
      fields: Object.assign({}, asObj(raw.fields)),
      linkedEntityId: raw.linkedEntityId ? String(raw.linkedEntityId) : null,
    };
  }

  /* Ingest external records. Fields owned by `external` are accepted;
     fields owned by `rmm` are kept. Any disagreement is recorded as
     drift with both values and the owner, so it can be resolved. */
  INT.ingest = async function (providerId, sourceId, payload, opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { error: "integrations_disabled" };
    if (!INT.source(sourceId)) return { error: "unknown_source", sourceId };
    const incoming = asArr(Array.isArray(payload) ? payload : [payload]).map((x) => normalizeExternal(x, sourceId, opts.entityType));
    const created = [], drift = [];
    const r = await writeState(providerId, (s) => {
      s.external = asArr(s.external);
      s.drift = asArr(s.drift);
      s.sources = asObj(s.sources);
      const at = now();
      s.sources[sourceId] = Object.assign({ enabled: true }, asObj(s.sources[sourceId]), { lastSyncAt: at });
      incoming.forEach((inc) => {
        if (!inc.externalId) return;
        const ownership = INT.ownershipFor(s, inc.entityType);
        let rec = s.external.find((x) => x.sourceId === sourceId && String(x.externalId) === inc.externalId && x.entityType === inc.entityType);
        const isNew = !rec;
        if (!rec) { rec = { kind: "external-record", id: rid("ext"), providerId: String(providerId), sourceId, entityType: inc.entityType, externalId: inc.externalId, external: {}, rmm: {}, agreed: {}, linkedEntityId: inc.linkedEntityId, driftFields: [], syncedAt: at }; s.external.push(rec); }
        rec.external = Object.assign({}, asObj(rec.external), inc.fields);
        rec.syncedAt = at;
        if (inc.linkedEntityId) rec.linkedEntityId = inc.linkedEntityId;
        Object.keys(inc.fields).forEach((field) => {
          const owner = ownership[field] || "external";
          const extVal = inc.fields[field];
          const prevAgreed = asObj(rec.agreed)[field];
          if (owner === "external") {
            if (prevAgreed !== undefined && JSON.stringify(prevAgreed) !== JSON.stringify(extVal)) {
              const d = { kind: "drift", id: rid("drift"), providerId: String(providerId), recordId: rec.id, sourceId, entityType: inc.entityType, externalId: inc.externalId, field, owner, rmmValue: prevAgreed, externalValue: extVal, status: "open", mode: "external-overwrite", detectedAt: at };
              s.drift.push(d); drift.push(d); rec.driftFields = uniq(asArr(rec.driftFields).concat(field));
            }
            rec.agreed[field] = clone(extVal);
          } else {
            const rmmVal = asObj(rec.rmm)[field];
            if (rmmVal !== undefined && JSON.stringify(rmmVal) !== JSON.stringify(extVal)) {
              const d = { kind: "drift", id: rid("drift"), providerId: String(providerId), recordId: rec.id, sourceId, entityType: inc.entityType, externalId: inc.externalId, field, owner, rmmValue: rmmVal, externalValue: extVal, status: "open", mode: "rmm-owned", detectedAt: at };
              s.drift.push(d); drift.push(d); rec.driftFields = uniq(asArr(rec.driftFields).concat(field));
            }
          }
        });
        if (isNew) created.push(rec.id);
      });
    }, 6);
    if (r && r.error) return { error: r.error, message: r.message };
    await audit("integration_ingest", providerId, "Ingested " + incoming.length + " " + sourceId + " record(s).");
    return { ok: true, ingested: incoming.length, created: created.length, drift: drift.length, records: created, driftEntries: drift };
  };

  function uniq(a) { return [...new Set(asArr(a).filter(Boolean))]; }

  INT.records = async function (providerId, opts) {
    opts = opts || {};
    const p = await providerOf(providerId);
    if (!p) return [];
    let list = asArr(stateOf(p).external);
    if (opts.sourceId) list = list.filter((r) => r.sourceId === opts.sourceId);
    if (opts.entityType) list = list.filter((r) => r.entityType === opts.entityType);
    return clone(list);
  };
  INT.getRecord = async function (providerId, recordId) {
    const p = await providerOf(providerId);
    if (!p) return null;
    const rec = asArr(stateOf(p).external).find((r) => String(r.id) === String(recordId));
    return rec ? clone(rec) : null;
  };

  INT.drift = async function (providerId, opts) {
    opts = opts || {};
    const p = await providerOf(providerId);
    if (!p) return [];
    let list = asArr(stateOf(p).drift);
    if (opts.openOnly !== false) list = list.filter((d) => d.status === "open");
    if (opts.sourceId) list = list.filter((d) => d.sourceId === opts.sourceId);
    list.sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt)));
    return clone(list);
  };
  INT.driftCount = async function (providerId) { return (await INT.drift(providerId, { openOnly: true })).length; };

  /* Resolve a drift entry: keep the RMM value or take the external one.
     Resolving writes the chosen value into `agreed` (and, for an
     external-owned field, into `rmm` so the decision is durable). */
  /* Set the RMM-side value for a record field (the value RMM-U owns).
     Recomputes drift for that field against the external copy. */
  INT.setRmmField = async function (providerId, recordId, field, value) {
    let drift = null;
    const r = await writeState(providerId, (s) => {
      s.external = asArr(s.external);
      s.drift = asArr(s.drift);
      const rec = s.external.find((x) => String(x.id) === String(recordId));
      if (!rec) return;
      rec.rmm = Object.assign({}, asObj(rec.rmm), { [field]: clone(value) });
      const ownership = INT.ownershipFor(s, rec.entityType);
      const owner = ownership[field] || "external";
      const extVal = asObj(rec.external)[field];
      if (owner === "rmm" && extVal !== undefined && JSON.stringify(extVal) !== JSON.stringify(value)) {
        const d = { kind: "drift", id: rid("drift"), providerId: String(providerId), recordId: rec.id, sourceId: rec.sourceId, entityType: rec.entityType, externalId: rec.externalId, field, owner, rmmValue: value, externalValue: extVal, status: "open", mode: "rmm-owned", detectedAt: now() };
        s.drift.push(d); rec.driftFields = uniq(asArr(rec.driftFields).concat(field));
        drift = d;
      }
    }, 6);
    if (r && r.error) return { error: r.error, message: r.message };
    return { ok: true, drift, driftDetected: !!drift };
  };

  INT.resolve = async function (providerId, driftId, opts) {
    opts = opts || {};
    const keep = opts.keep === "external" ? "external" : "rmm";
    let entry = null;
    const r = await writeState(providerId, (s) => {
      s.drift = asArr(s.drift);
      s.external = asArr(s.external);
      const d = s.drift.find((x) => String(x.id) === String(driftId));
      if (!d || d.status !== "open") return;
      const rec = s.external.find((x) => String(x.id) === String(d.recordId));
      const value = keep === "external" ? d.externalValue : d.rmmValue;
      if (rec) {
        rec.agreed = Object.assign({}, asObj(rec.agreed));
        rec.agreed[d.field] = clone(value);
        if (keep === "external") rec.rmm = Object.assign({}, asObj(rec.rmm), { [d.field]: clone(value) });
        rec.driftFields = asArr(rec.driftFields).filter((f) => f !== d.field);
      }
      d.status = "resolved"; d.resolution = keep; d.resolvedAt = now(); d.resolvedBy = actor();
      entry = clone(d);
    }, 6);
    if (r && r.error) return { error: r.error, message: r.message };
    if (!entry) return { error: "not_found", driftId };
    await audit("integration_drift_resolve", providerId, "Resolved drift on " + entry.field + " (kept " + keep + ").");
    return { ok: true, entry };
  };

  INT.resolveAll = async function (providerId, opts) {
    opts = opts || {};
    const open = await INT.drift(providerId, { openOnly: true });
    let done = 0;
    for (const d of open) {
      const keep = opts.keep === "external" ? "external" : (opts.keep === "owner" ? d.owner : "rmm");
      const r = await INT.resolve(providerId, d.id, { keep });
      if (!r.error) done++;
    }
    return { ok: true, resolved: done };
  };

  INT.setOwnership = async function (providerId, entityType, field, owner) {
    if (INT.ENTITY_TYPES.indexOf(entityType) === -1) return { error: "unknown_entity", entityType };
    if (INT.OWNERS.indexOf(owner) === -1) return { error: "unknown_owner", owner };
    const r = await writeState(providerId, (s) => {
      s.ownership = asObj(s.ownership);
      s.ownership[entityType] = Object.assign({}, asObj(s.ownership[entityType]), { [field]: owner });
    }, 6);
    if (r && r.error) return { error: r.error, message: r.message };
    await audit("integration_ownership", providerId, "Field " + entityType + "." + field + " is now owned by " + owner + ".");
    return { ok: true, entityType, field, owner };
  };

  INT.ownershipMap = async function (providerId) {
    const p = await providerOf(providerId);
    const state = stateOf(p);
    return INT.ENTITY_TYPES.map((t) => ({ entityType: t, fields: INT.ownershipFor(state, t) }));
  };

  /* ─────────────────────── envelopes & publication ─────────────── */

  const EVENT_TYPES = { "device-state": "device.health", job: "job.result", alert: "alert", "device-op": "device.op", admin: "admin" };
  INT.EVENT_TYPES = EVENT_TYPES;

  INT.envelope = function (event, opts) {
    opts = opts || {};
    const e = asObj(event);
    return {
      v: INT.ENVELOPE_VERSION,
      id: rid("env"),
      type: EVENT_TYPES[e.kind] || S(e.type || e.kind || "event", 60),
      schema: INT.ENVELOPE_SCHEMA,
      source: "rmm-u",
      subject: String(e.deviceId || e.jobId || e.alertId || e.alert || ""),
      providerId: e.providerId ? String(e.providerId) : (opts.providerId ? String(opts.providerId) : null),
      time: e.at || now(),
      data: clone(e),
    };
  };

  function matchWebhook(wh, env) {
    if (!wh || wh.enabled === false) return false;
    const events = asArr(wh.events);
    return events.length === 0 || events.indexOf("*") !== -1 || events.indexOf(env.type) !== -1;
  }

  /* Post one envelope to every matching webhook. `INT.sender` is
     swappable so tests never touch the network. */
  INT.dispatch = async function (providerId, env, opts) {
    opts = opts || {};
    const p = await providerOf(providerId);
    if (!p) return { error: "not_found", providerId };
    const hooks = asArr(stateOf(p).webhooks).filter((w) => matchWebhook(w, env));
    const deliveries = [];
    for (const wh of hooks) {
      const result = { webhookId: wh.id, name: wh.name, at: now(), ok: false, status: 0, error: "" };
      try {
        const res = await INT.sender({ url: wh.url, method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, wh.secret ? { "X-RMM-Signature": await sign(wh.secret, JSON.stringify(env)) } : {}), body: JSON.stringify(env), webhook: wh });
        result.ok = !!(res && res.ok !== false);
        result.status = num(res && res.status, 0);
        if (!result.ok) result.error = "transport_error";
      } catch (e) { result.error = (e && e.message) || "dispatch_threw"; }
      deliveries.push(result);
      await writeState(providerId, (s) => {
        s.webhooks = asArr(s.webhooks);
        const rec = s.webhooks.find((x) => String(x.id) === String(wh.id));
        if (rec) { rec.deliveries = asArr(rec.deliveries).concat([result]).slice(-50); rec.lastDeliveryAt = result.at; rec.lastStatus = result.ok ? "ok" : "failed"; }
      }, 4);
    }
    return { ok: true, webhooks: hooks.length, deliveries };
  };

  async function sign(secret, body) {
    try {
      const enc = new TextEncoder().encode(String(secret) + "." + body);
      if (window.crypto && window.crypto.subtle) {
        const buf = await window.crypto.subtle.digest("SHA-256", enc);
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (e) {}
    return "";
  }

  INT.sender = async function (d) {
    const fn = (window.root && typeof window.root.superFetch === "function") ? window.root.superFetch
      : (typeof fetch === "function" ? fetch : null);
    if (!fn) return { ok: false, status: 0, error: "no_transport" };
    const res = await fn(d.url, { method: d.method || "POST", headers: d.headers || {}, body: d.body });
    return { ok: res.ok !== false, status: res.status };
  };

  /* Wrap, log and publish an event through the shared envelope. */
  INT.publish = async function (providerId, event, opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { error: "integrations_disabled" };
    const env = INT.envelope(Object.assign({ providerId }, asObj(event)));
    const r = await writeState(providerId, (s) => {
      s.publications = asArr(s.publications).concat([env]).slice(-publicationCap());
    }, 6);
    if (r && r.error) return { error: r.error, message: r.message, envelope: env };
    let deliveries = [];
    if (opts.dispatch !== false) { const d = await INT.dispatch(providerId, env, opts); deliveries = asArr(d.deliveries); }
    return { ok: true, envelope: env, deliveries };
  };

  INT.publications = async function (providerId, opts) {
    opts = opts || {};
    const p = await providerOf(providerId);
    if (!p) return [];
    let list = asArr(stateOf(p).publications);
    if (opts.type) list = list.filter((e) => e.type === opts.type);
    list = list.slice().reverse();
    return opts.limit ? clone(list.slice(0, opts.limit)) : clone(list);
  };

  let autoUnsub = null;
  INT.startAutoPublish = function (providerId) {
    if (!EV || autoUnsub) return { started: false };
    autoUnsub = EV.on((e) => {
      const kind = e && e.kind;
      if (["device-state", "alert", "job"].indexOf(kind) === -1) return;
      INT.publish(providerId, e, { dispatch: true }).catch(() => {});
    });
    INT.autoProviderId = providerId;
    return { started: true };
  };
  INT.stopAutoPublish = function () { if (autoUnsub) { autoUnsub(); autoUnsub = null; } return { stopped: true }; };

  /* ─────────────────────── webhooks ─────────────────────── */

  INT.normalizeWebhook = function (raw) {
    raw = asObj(raw);
    return {
      kind: "webhook",
      id: raw.id || rid("wh"),
      name: S(raw.name || "Webhook", 120),
      url: S(raw.url || "", 500),
      events: asArr(raw.events).map((e) => S(e, 60)),
      secret: S(raw.secret || "", 200),
      enabled: raw.enabled !== false,
      deliveries: asArr(raw.deliveries).slice(-50),
      createdAt: raw.createdAt || now(), updatedAt: now(),
    };
  };

  INT.addWebhook = async function (providerId, data) {
    const wh = INT.normalizeWebhook(data);
    if (!/^https?:\/\//i.test(wh.url)) return { error: "invalid_url" };
    const r = await writeState(providerId, (s) => { s.webhooks = asArr(s.webhooks).concat([wh]); }, 6);
    if (r && r.error) return { error: r.error, message: r.message };
    await audit("integration_webhook_add", providerId, "Added webhook \"" + wh.name + "\".");
    return { ok: true, webhook: clone(wh) };
  };
  INT.updateWebhook = async function (providerId, id, patch) {
    let out = null;
    const r = await writeState(providerId, (s) => {
      s.webhooks = asArr(s.webhooks);
      const i = s.webhooks.findIndex((w) => String(w.id) === String(id));
      if (i === -1) return;
      out = INT.normalizeWebhook(Object.assign({}, s.webhooks[i], asObj(patch), { id: s.webhooks[i].id, createdAt: s.webhooks[i].createdAt }));
      s.webhooks[i] = out;
    }, 6);
    if (r && r.error) return { error: r.error, message: r.message };
    if (!out) return { error: "not_found", id };
    return { ok: true, webhook: clone(out) };
  };
  INT.removeWebhook = async function (providerId, id) {
    let removed = false;
    const r = await writeState(providerId, (s) => { const before = asArr(s.webhooks).length; s.webhooks = asArr(s.webhooks).filter((w) => String(w.id) !== String(id)); removed = s.webhooks.length !== before; }, 6);
    if (r && r.error) return { error: r.error, message: r.message };
    if (!removed) return { error: "not_found", id };
    await audit("integration_webhook_remove", providerId, "Removed a webhook.");
    return { ok: true, removed: id };
  };
  INT.listWebhooks = async function (providerId) {
    const p = await providerOf(providerId);
    if (!p) return [];
    return clone(asArr(stateOf(p).webhooks));
  };
  INT.testWebhook = async function (providerId, id) {
    const wh = (await INT.listWebhooks(providerId)).find((w) => String(w.id) === String(id));
    if (!wh) return { error: "not_found", id };
    const env = INT.envelope({ kind: "admin", type: "webhook.test", providerId, at: now(), message: "Test delivery from RMM-U" });
    const res = await INT.dispatch(providerId, env, {});
    return { ok: true, test: true, deliveries: asArr(res.deliveries) };
  };

  /* ─────────────────────── API facade ─────────────────────── */

  const api = {};
  api.version = INT.API_VERSION;
  api.schema = "rmm.api.v1";
  api.devices = async function (providerId) {
    const p = await providerOf(providerId);
    if (!p) return [];
    return asArr(p.devices).map(D.normalizeDevice).map((d) => ({
      id: d.id, hostname: d.hostname || d.displayName || d.id, siteId: d.siteId, groupIds: asArr(d.groupIds),
      os: asObj(d.os).name || asObj(d.os).family || "", role: d.role, status: D.effectiveStatus(d),
      agentVersion: String(asObj(d.agent).version || d.agentVersion || ""), lastSeenAt: d.lastSeenAt || "",
    }));
  };
  api.deviceHealth = async function (providerId) {
    if (FL && FL.snapshot) return await FL.snapshot(providerId, { force: true });
    const p = await providerOf(providerId);
    return p ? { providerId, devices: D.statsOf(p) } : null;
  };
  api.alerts = async function (providerId, opts) { return AL ? await AL.list(providerId, opts || {}) : []; };
  api.compliance = async function (providerId) {
    return {
      patch: PA ? asObj((await PA.rollup(providerId, { by: "provider" })).summary) : null,
      security: SEC ? asObj((await SEC.postureRows(providerId, {})).summary) : null,
      backup: SEC ? asObj((await SEC.backupRows(providerId, {})).summary) : null,
    };
  };
  api.records = (providerId, opts) => INT.records(providerId, opts);
  api.publish = (providerId, event, opts) => INT.publish(providerId, event, opts);
  api.analytics = (providerId, opts) => INT.analyticsExtract(providerId, opts);
  INT.api = api;
  ERP.api = api;

  /* ─────────────────────── analytics extract ─────────────────── */

  function table(name, columns, rows) { return { name, columns, rows: asArr(rows) }; }

  INT.analyticsExtract = async function (providerId, opts) {
    opts = opts || {};
    const p = await providerOf(providerId);
    if (!p) return { error: "not_found", providerId };
    const devices = asArr(p.devices).map(D.normalizeDevice);
    const devRows = devices.map((d) => ({
      deviceId: d.id, hostname: d.hostname || d.displayName || d.id,
      providerId: String(providerId), siteId: d.siteId || "", siteName: siteName(p, d.siteId),
      osFamily: asObj(d.os).family || "", os: asObj(d.os).name || "", role: d.role || "",
      status: D.effectiveStatus(d), agentVersion: String(asObj(d.agent).version || d.agentVersion || ""),
      lastSeenAt: d.lastSeenAt || "", tags: asArr(d.tags).join(","),
    }));
    const alertRows = (AL ? await AL.list(providerId, {}) : asArr(p.alerts)).map((a) => ({
      alertId: a.id, providerId: String(providerId), deviceId: a.deviceId, severityId: a.severityId,
      severityRank: num(a.severityRank, 0), state: a.state, subject: a.subject || "", monitorId: a.monitorId || "",
      firstFiredAt: a.firstFiredAt || "", acknowledgedAt: a.acknowledgedAt || "", resolvedAt: a.resolvedAt || "",
      occurrences: num(a.occurrences, 1),
    }));
    const patchRows = PA ? asArr((await PA.deviceRows(providerId, {})).rows).map((r) => ({
      providerId: String(providerId), deviceId: r.deviceId, complianceStatus: r.complianceStatus,
      missingRequired: num(r.missingRequired, 0), missingTotal: num(r.missingTotal, 0), overdue: num(r.overdue, 0), ageDays: num(r.ageDays, 0), lastScanAt: r.lastScanAt || "",
    })) : [];
    const secRows = SEC ? asArr((await SEC.postureRows(providerId, {})).rows).map((r) => ({
      providerId: String(providerId), deviceId: r.deviceId, state: r.state, score: r.score == null ? "" : r.score, failCount: num(r.failCount, 0), warnCount: num(r.warnCount, 0), lastScanAt: r.at || "",
    })) : [];
    const backupRows = SEC ? asArr((await SEC.backupRows(providerId, {})).rows).map((r) => ({
      providerId: String(providerId), deviceId: r.deviceId, status: r.status, lastSuccessAt: r.lastSuccessAt || "", ageHours: r.ageHours == null ? "" : Math.round(num(r.ageHours, 0)), maxAgeHours: num(r.maxAgeHours, 0), dueAt: r.dueAt || "",
    })) : [];
    const jobRows = J ? asArr(await J.list(providerId, {})).map((j) => ({
      providerId: String(providerId), jobId: j.id, name: j.name || "", state: j.state, targets: num(j.targetCount, 0), succeeded: num(j.succeeded, 0), failed: num(j.failed, 0), createdAt: j.createdAt || "",
    })) : [];
    const extract = {
      schema: INT.ANALYTICS_SCHEMA,
      version: INT.ANALYTICS_VERSION,
      generatedAt: now(),
      provider: { id: String(providerId), name: p.name || String(providerId) },
      tables: {
        devices: table("devices", ["deviceId", "hostname", "providerId", "siteId", "siteName", "osFamily", "os", "role", "status", "agentVersion", "lastSeenAt", "tags"], devRows),
        alerts: table("alerts", ["alertId", "providerId", "deviceId", "severityId", "severityRank", "state", "subject", "monitorId", "firstFiredAt", "acknowledgedAt", "resolvedAt", "occurrences"], alertRows),
        patchCompliance: table("patchCompliance", ["providerId", "deviceId", "complianceStatus", "missingRequired", "missingTotal", "overdue", "ageDays", "lastScanAt"], patchRows),
        securityPosture: table("securityPosture", ["providerId", "deviceId", "state", "score", "failCount", "warnCount", "lastScanAt"], secRows),
        backupStatus: table("backupStatus", ["providerId", "deviceId", "status", "lastSuccessAt", "ageHours", "maxAgeHours", "dueAt"], backupRows),
        jobs: table("jobs", ["providerId", "jobId", "name", "state", "targets", "succeeded", "failed", "createdAt"], jobRows),
      },
    };
    extract.counts = Object.keys(extract.tables).reduce((a, k) => { a[k] = extract.tables[k].rows.length; return a; }, {});
    return extract;
  };

  INT.exportAnalytics = function (extract, format) {
    if (String(format || "json").toLowerCase() === "ndjson") {
      const lines = [];
      Object.keys(asObj(extract.tables)).forEach((name) => {
        asArr(extract.tables[name].rows).forEach((row) => lines.push(JSON.stringify({ schema: extract.schema, version: extract.version, table: name, generatedAt: extract.generatedAt, providerId: asObj(extract.provider).id, ...row })));
      });
      return lines.join("\n") + "\n";
    }
    return JSON.stringify(extract, null, 2);
  };

  function siteName(provider, id) { const s = asArr(provider.sites).find((x) => String(x.id) === String(id)); return s ? (s.name || id) : ""; }

  /* ═══════════════════════ console (Task 42) ═══════════════════════ */

  INT.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || ERP.toast || (() => {});
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rmm-integrations";
    host.appendChild(wrap);
    if (!providers.length) { wrap.innerHTML = ui.alert("No service providers yet.", "info"); return null; }
    let providerId = opts.providerId || providers[0].id;
    const state = { tab: "sources" };

    async function compute() {
      state.provider = await providerOf(providerId);
      state.records = await INT.records(providerId, {});
      state.drift = await INT.drift(providerId, {});
      state.webhooks = await INT.listWebhooks(providerId);
      state.publications = await INT.publications(providerId, { limit: 25 });
      state.ownership = await INT.ownershipMap(providerId);
      return state.provider;
    }

    function sourcesTab() {
      const recRows = asArr(state.records).map((r) => ({
        record: "<b>" + esc(r.externalId) + "</b><div class=\"erp-sub\">" + esc(INT.sourceLabel(r.sourceId)) + " · " + esc(r.entityType) + "</div>",
        linked: r.linkedEntityId ? ui.badge(r.linkedEntityId, "muted") : '<span class="erp-sub">—</span>',
        fields: Object.keys(asObj(r.external)).length + " external · " + Object.keys(asObj(r.agreed)).length + " agreed",
        drift: asArr(r.driftFields).length ? asArr(r.driftFields).map((f) => ui.badge(f, "warn")).join(" ") : ui.badge("in sync", "success"),
        at: '<span class="erp-sub">' + esc(ui.dateTime(r.syncedAt)) + "</span>",
      }));
      const driftRows = asArr(state.drift).map((d) => ({
        field: "<b>" + esc(d.entityType) + "." + esc(d.field) + "</b>",
        record: esc(d.externalId) + '<div class="erp-sub">' + esc(INT.sourceLabel(d.sourceId)) + "</div>",
        owner: ui.badge(d.owner, d.owner === "rmm" ? "info" : "muted"),
        rmmValue: esc(JSON.stringify(d.rmmValue == null ? "" : d.rmmValue)),
        extValue: esc(JSON.stringify(d.externalValue == null ? "" : d.externalValue)),
        actions: ui.btn("Keep RMM", { small: true, act: "int-drift-rmm", arg: d.id }) + " " + ui.btn("Take external", { small: true, act: "int-drift-ext", arg: d.id }),
      }));
      const own = asArr(state.ownership).map((g) => ({
        entity: "<b>" + esc(g.entityType) + "</b>",
        fields: Object.keys(asObj(g.fields)).map((f) => esc(f) + ": " + ui.badge(g.fields[f], g.fields[f] === "rmm" ? "info" : "muted")).join(" "),
      }));
      const picker = providers.length > 1 ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="int_pid">' + providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === providerId ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>" : "";
      return picker +
        ui.card("Field ownership", ui.table([
          { key: "entity", label: "Record type", render: (r) => r.entity },
          { key: "fields", label: "Field owners", render: (r) => r.fields },
        ], own, { scroll: true }), { actions: ui.btn("Simulate ingest", { small: true, act: "int-sim" }) }) +
        ui.card("External records (" + recRows.length + ")", ui.table([
          { key: "record", label: "Record", render: (r) => r.record },
          { key: "linked", label: "Linked entity", render: (r) => r.linked },
          { key: "fields", label: "Fields", render: (r) => r.fields },
          { key: "drift", label: "Drift", render: (r) => r.drift },
          { key: "at", label: "Synced", render: (r) => r.at },
        ], recRows, { scroll: true, emptyText: "No external records ingested yet." })) +
        ui.card("Drift (" + driftRows.length + ")", driftRows.length
          ? ui.table([
              { key: "field", label: "Field", render: (r) => r.field },
              { key: "record", label: "Record", render: (r) => r.record },
              { key: "owner", label: "Owner", render: (r) => r.owner },
              { key: "rmmValue", label: "RMM value", render: (r) => r.rmmValue },
              { key: "extValue", label: "External value", render: (r) => r.extValue },
              { key: "actions", label: "", render: (r) => r.actions },
            ], driftRows, { scroll: true })
          : ui.alert("No open drift — every owned field agrees with its source.", "success"),
          { actions: driftRows.length ? ui.btn("Resolve all (keep RMM)", { small: true, act: "int-drift-all" }) : "" });
    }

    function webhooksTab() {
      const rows = asArr(state.webhooks).map((w) => ({
        name: "<b>" + esc(w.name) + "</b><div class=\"erp-sub\">" + esc(w.url) + "</div>",
        events: asArr(w.events).length ? asArr(w.events).map((e) => ui.badge(e, "muted")).join(" ") : ui.badge("*", "info"),
        state: w.enabled ? ui.badge("enabled", "success") : ui.badge("disabled", "muted"),
        last: w.lastDeliveryAt ? ui.badge(w.lastStatus || "—", w.lastStatus === "ok" ? "success" : "danger") + ' <span class="erp-sub">' + esc(ui.dateTime(w.lastDeliveryAt)) + "</span>" : '<span class="erp-sub">never</span>',
        actions: ui.btn("Test", { small: true, act: "int-wh-test", arg: w.id }) + " " + ui.btn("Edit", { small: true, act: "int-wh-edit", arg: w.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "int-wh-del", arg: w.id }),
      }));
      const pubRows = asArr(state.publications).map((e) => ({
        type: ui.badge(e.type, "info"),
        subject: esc(e.subject || "—"),
        schema: '<span class="erp-sub">' + esc(e.schema) + " v" + esc(String(e.v)) + "</span>",
        at: '<span class="erp-sub">' + esc(ui.dateTime(e.time)) + "</span>",
      }));
      return ui.card("Outbound webhooks (" + rows.length + ")",
        '<p class="erp-sub">Device-health, alert and job events are published through the shared <code>' + esc(INT.ENVELOPE_SCHEMA) + "</code> envelope and POSTed to every matching webhook.</p>" +
        ui.table([
          { key: "name", label: "Webhook", render: (r) => r.name },
          { key: "events", label: "Events", render: (r) => r.events },
          { key: "state", label: "State", render: (r) => r.state },
          { key: "last", label: "Last delivery", render: (r) => r.last },
          { key: "actions", label: "", render: (r) => r.actions },
        ], rows, { scroll: true, emptyText: "No webhooks configured." }),
        { actions: ui.btn("New webhook", { small: true, primary: true, act: "int-wh-new" }) }) +
        ui.card("Recent publications (" + pubRows.length + ")",
          ui.table([
            { key: "type", label: "Type", render: (r) => r.type },
            { key: "subject", label: "Subject", render: (r) => r.subject },
            { key: "schema", label: "Schema", render: (r) => r.schema },
            { key: "at", label: "When", render: (r) => r.at },
          ], pubRows, { scroll: true, emptyText: "Nothing published yet." }),
          { actions: ui.btn("Publish sample", { small: true, act: "int-pub-sample" }) });
    }

    async function analyticsTab() {
      const ex = await INT.analyticsExtract(providerId, {});
      if (ex.error) return ui.alert("Analytics unavailable: " + ex.error, "warn");
      const tables = Object.keys(ex.tables).map((name) => ({
        table: "<b>" + esc(name) + "</b>",
        rows: String(ex.tables[name].rows.length),
        columns: '<span class="erp-sub">' + esc(ex.tables[name].columns.join(", ")) + "</span>",
      }));
      return ui.card("Analytics extract",
        '<p class="erp-sub">Schema <code>' + esc(ex.schema) + "</code> v" + ex.version + " · generated " + esc(ui.dateTime(ex.generatedAt)) + ".</p>" +
        ui.table([
          { key: "table", label: "Table", render: (r) => r.table },
          { key: "rows", label: "Rows", align: "right", render: (r) => r.rows },
          { key: "columns", label: "Columns", render: (r) => r.columns },
        ], tables, { scroll: true }),
        { actions: ui.btn("Export JSON", { small: true, primary: true, act: "int-an-json" }) + " " + ui.btn("Export NDJSON", { small: true, act: "int-an-ndjson" }) + " " + ui.btn("Copy API sample", { small: true, act: "int-api-sample" }) });
    }

    async function paint() {
      ui.loading(wrap, "Loading integrations");
      await compute();
      const tabs = ui.tabs([
        { id: "sources", label: "Sources & drift", badge: asArr(state.drift).length || null },
        { id: "webhooks", label: "Webhooks & bus", badge: asArr(state.webhooks).length || null },
        { id: "analytics", label: "Analytics extract" },
      ], state.tab);
      wrap.innerHTML = '<div class="rmm-integrations-inner">' + tabs.html + "</div>";
      const panel = wrap.querySelector('.erp-tab-panel[data-panel="' + state.tab + '"]');
      if (panel) panel.innerHTML = state.tab === "webhooks" ? webhooksTab() : state.tab === "analytics" ? await analyticsTab() : sourcesTab();
    }

    function simPayload() {
      const key = "sim-" + Date.now().toString(36);
      return {
        entityType: "company",
        externalId: key,
        fields: { name: "Simulated Co " + key.slice(-4), servicePlan: "Gold", phone: "+15550000000", tags: "vip", notes: "from psa-u" },
      };
    }

    function whEditor(id) {
      const isNew = id === "__new";
      const w = isNew ? INT.normalizeWebhook({ name: "", url: "", events: ["*"] }) : asArr(state.webhooks).find((x) => String(x.id) === String(id));
      if (!w) return;
      const body = ui.form(
        ui.text("w_name", "Name", w.name) +
        ui.text("w_url", "URL", w.url) +
        ui.text("w_events", "Events (comma-separated; * for all)", asArr(w.events).join(",") || "*") +
        ui.text("w_secret", "Signing secret (optional)", w.secret) +
        ui.check("w_enabled", "Enabled", w.enabled !== false),
        ui.btn("Save", { primary: true, act: "int-wh-save", arg: isNew ? "__new" : w.id }) + " " + ui.btn("Cancel", { act: "int-cancel" })
      );
      ui.modal({ title: isNew ? "New webhook" : "Edit " + w.name, body });
      const m = document.querySelector("#uiModal");
      m.onclick = async (e) => {
        const a = e.target.closest && e.target.closest("[data-act]");
        if (!a) return;
        const act = a.getAttribute("data-act");
        if (act === "int-cancel") { m.onclick = null; return ui.closeModal(); }
        if (act === "int-wh-save") {
          const c = ui.collect(m, ["w_name", "w_url", "w_events", "w_secret", "w_enabled"]);
          const patch = { name: c.w_name, url: c.w_url, events: String(c.w_events || "").split(",").map((x) => x.trim()).filter(Boolean), secret: c.w_secret, enabled: c.w_enabled };
          const r = isNew ? await INT.addWebhook(providerId, patch) : await INT.updateWebhook(providerId, id, patch);
          if (r.error) return toast("Failed: " + r.error, "error");
          m.onclick = null; ui.closeModal(); toast("Webhook saved"); return paint();
        }
      };
    }

    wrap.addEventListener("change", (e) => {
      const sel = e.target.closest && e.target.closest("[name='int_pid']");
      if (sel) { providerId = sel.value; paint(); }
    });
    wrap.addEventListener("click", async (e) => {
      const t = e.target.closest && e.target.closest("[data-tab]");
      if (t && wrap.contains(t)) { state.tab = t.getAttribute("data-tab"); ui.showTab(wrap, state.tab); return paint(); }
      const a = e.target.closest && e.target.closest("[data-act]");
      if (!a || !wrap.contains(a)) return;
      e.preventDefault();
      const act = a.getAttribute("data-act"), arg = a.getAttribute("data-arg");
      if (act === "int-sim") { const r = await INT.ingest(providerId, "psa-u", simPayload(), {}); if (r.error) return toast("Failed: " + r.error, "error"); toast("Ingested " + r.ingested + " record(s), " + r.drift + " drift"); return paint(); }
      if (act === "int-drift-rmm") { const r = await INT.resolve(providerId, arg, { keep: "rmm" }); if (r.error) return toast("Failed: " + r.error, "error"); return paint(); }
      if (act === "int-drift-ext") { const r = await INT.resolve(providerId, arg, { keep: "external" }); if (r.error) return toast("Failed: " + r.error, "error"); return paint(); }
      if (act === "int-drift-all") { const r = await INT.resolveAll(providerId, { keep: "rmm" }); toast("Resolved " + r.resolved + " drift entr(ies)"); return paint(); }
      if (act === "int-wh-new") return whEditor("__new");
      if (act === "int-wh-edit") return whEditor(arg);
      if (act === "int-wh-del") { const ok = await ERP.ui.confirm({ title: "Delete webhook?", message: "Deliveries already sent are unaffected.", okLabel: "Delete", danger: true }); if (!ok) return; const r = await INT.removeWebhook(providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Deleted"); return paint(); }
      if (act === "int-wh-test") { const r = await INT.testWebhook(providerId, arg); toast(r.deliveries && r.deliveries.length ? "Test delivered" : "No matching webhook"); return paint(); }
      if (act === "int-pub-sample") { const r = await INT.publish(providerId, { kind: "device-state", deviceId: "sample-device", from: "online", to: "stale", providerId }, {}); toast("Published " + r.envelope.type); return paint(); }
      if (act === "int-an-json" || act === "int-an-ndjson") { const ex = await INT.analyticsExtract(providerId, {}); const fmt = act === "int-an-json" ? "json" : "ndjson"; const text = INT.exportAnalytics(ex, fmt); RP_download(INT.slug ? INT.slug("analytics-" + (ex.provider && ex.provider.name)) : "analytics", text, fmt === "json" ? "application/json" : "application/x-ndjson"); toast("Analytics exported"); return; }
      if (act === "int-api-sample") { const sample = "await window.ERP.api.devices(\"" + providerId + "\")\nawait window.ERP.api.alerts(\"" + providerId + "\")\nawait window.ERP.api.analytics(\"" + providerId + "\")"; try { await navigator.clipboard.writeText(sample); toast("API sample copied"); } catch (err) { toast("API: " + sample); } return; }
    });

    await paint();
    INT.currentProviderId = providerId;
    return { state, paint, host: wrap };
  };

  function RP_download(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime || "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
      return { ok: true };
    } catch (e) { return { error: "download_failed" }; }
  }

  INT.render = async function (ctx) {
    const el = ctx.el;
    el.innerHTML = "";
    const root = document.createElement("div");
    root.className = "rmm-integrations-host";
    el.appendChild(root);
    root.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Integrations", "Consume company / site / configuration records from psa-u and the documentation tool with explicit field ownership and drift detection, publish device-health and alert events through the shared versioned envelope, expose a read API and outbound webhooks, and produce a schema-stable analytics extract for the BI tool."));
    await INT.renderInto(root, { toast: ctx.toast });
    return { ok: true };
  };

  /* ─────────────────────── demo seed ─────────────────────── */

  INT.seedDemo = async function (opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { skipped: true, reason: "integrations_disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const p = await providerOf(demo.id);
    if (!p) return { skipped: true, reason: "no_provider" };
    const st = stateOf(p);
    if (asArr(st.external).length && asArr(st.webhooks).length && !opts.force) return { skipped: true, reason: "integrations_demo_exists" };
    const sites = asArr(p.sites);
    const siteId = sites.length ? String(sites[0].id) : null;
    await INT.ingest(demo.id, "psa-u", { entityType: "company", externalId: "co-demo-" + demo.id.slice(-4), linkedEntityId: siteId, fields: { name: (p.name || "Demo provider") + " (PSA)", servicePlan: "Gold managed", accountManager: "Alex Chen", phone: "+15551230000", email: "ops@example.com", tags: "managed", notes: "Imported from psa-u in the demo seed." } }, {});
    await INT.ingest(demo.id, "docs", { entityType: "configuration", externalId: "cfg-demo-" + demo.id.slice(-4), fields: { assetTag: "ASSET-0001", documentationUrl: "https://docs.example.com/systems/0001", owner: "IT Operations", hostname: "DEMO-CONFIG" } }, {});
    const existing = asArr(st.webhooks);
    if (!existing.length || opts.force) {
      await INT.addWebhook(demo.id, { name: "NOC webhook", url: "https://hooks.example.com/rmm", events: ["alert", "*"], secret: "", enabled: true });
    }
    INT.__seeded = { providerId: demo.id, at: now() };
    return { providerId: demo.id, records: 2, webhooks: 1 };
  };

  /* ─────────────────────── boot ─────────────────────── */

  INT.currentProviderId = null;
  let readyResolve;
  INT.ready = new Promise((res) => { readyResolve = res; });
  INT.init = async function () { try { await T.ready; await INT.seedDemo(); } catch (e) { console.error("integrations seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", INT.init);
  else INT.init();
})();
