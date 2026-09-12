// ============================================================================
// quote-u — event publication & the pipeline bus (roadmap task 50)
// ----------------------------------------------------------------------------
// quote-u publishes what happened to a quote as VERSIONED events on the shared
// pipeline bus, so the rest of the pipeline (the knowledge base, BI, other
// tools) can consume quoting state without reading quote-u's storage:
//
//   quote.created · quote.sent · quote.viewed · quote.approved ·
//   quote.declined · quote.expired · quote.invoiced
//
// Every event is wrapped in ONE envelope — { schema, version, id, type, source,
// at, key, subject, actor, data, meta } — and written to the `bus-quote-events`
// stream through the connector gateway (so publishing is allowlisted, gated and
// logged like every other cross-system call). The same envelope is fanned out
// to the outbound WEBHOOKS configured in `quoteBusPolicy`, so an external
// consumer can subscribe without polling. A webhook is just a published
// outbound stream: the same envelope, delivered by POST.
//
// The local `bus_events` document is the DURABLE STREAM BACKING: each published
// envelope is recorded there with whether it reached the bus and its webhooks,
// so a failed delivery is retried by `flush()` — idempotently, keyed on the
// envelope id (the bus and the mock webhook both de-duplicate by that id), so a
// retry can never double-publish or double-deliver.
// ============================================================================
window.QU_BUS = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const SCHEMA = "pipeline.quote-event";
  const SCHEMA_VERSION = 1;
  const STREAM = "bus-quote-events";
  const DOC = "bus_events";
  const SOURCE = "quote-u";
  const CAP = 1000;

  // The audit/lifecycle event names that map onto a bus event type. Not every
  // audit row is publishable (the log is the internal record; the bus is the
  // external feed), so this is a deliberate allowlist.
  const TYPE_MAP = Object.freeze({
    created: "quote.created",
    sent: "quote.sent",
    viewed: "quote.viewed",
    approved: "quote.approved",
    declined: "quote.declined",
    expired: "quote.expired",
    invoice_created: "quote.invoiced",
    invoice_reconciled: "quote.invoiced"
  });
  const TYPES = Object.freeze(["quote.created", "quote.sent", "quote.viewed", "quote.approved", "quote.declined", "quote.expired", "quote.invoiced"]);
  const SUBJECT_KINDS = Object.freeze(TYPES.map(t => t.replace("quote.", "")));

  class BusError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "BusError";
      this.code = code;
    }
  }
  function fail(code, message) { throw new BusError(code, message); }

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function hash32(text) {
    const s = String(text == null ? "" : text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }

  function typeFor(event) {
    const name = String((event && (event.event || event.type || event.name)) || "");
    if (TYPE_MAP[name]) return TYPE_MAP[name];
    if (TYPES.indexOf(name) !== -1) return name;
    return null;
  }

  function isPublishable(event) { return !!typeFor(event); }

  // A stable id: the audit record's own id when present (so re-publishing the
  // same record de-duplicates), else a deterministic content hash.
  function envelopeId(event, type) {
    if (event && event.id !== undefined && event.id !== null && String(event.id)) return "qe-" + String(event.id);
    const seed = [type, event && (event.quote_id || ""), event && (event.version_id || ""), event && (event.at || event.created_at || "")].join("|");
    return "qe-" + hash32(seed) + "-" + hash32(seed + "|v");
  }

  // The versioned envelope shared with the rest of the pipeline.
  function toEnvelope(event, opts) {
    opts = opts || {};
    event = event || {};
    const type = typeFor(event);
    if (!type) fail("unpublishable_event", `"${String(event.event || event.type || "")}" is not a publishable quote event.`);
    const at = event.at ? String(event.at) : nowIso(opts.clock);
    const quoteId = event.quote_id === undefined || event.quote_id === null ? null : String(event.quote_id);
    const versionId = event.version_id === undefined || event.version_id === null ? null : String(event.version_id);
    const companyId = event.company_id === undefined || event.company_id === null ? null : String(event.company_id);
    return {
      schema: SCHEMA,
      version: SCHEMA_VERSION,
      id: envelopeId(event, type),
      type,
      source: opts.source ? String(opts.source) : SOURCE,
      stream: opts.stream ? String(opts.stream) : STREAM,
      at,
      key: quoteId || versionId || envelopeId(event, type),
      subject: { kind: "quote", id: quoteId, version_id: versionId, company_id: companyId },
      actor: { type: event.actor_type ? String(event.actor_type) : "system", id: event.actor ? String(event.actor) : "" },
      token_id: event.token_id ? String(event.token_id) : null,
      data: isPlainObject(event.detail) ? event.detail : {},
      meta: { generator: opts.generatorName || null }
    };
  }

  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    const normEvents = v => v === undefined || v === null || v === "*"
      ? TYPES.slice()
      : (Array.isArray(v) ? v.map(String) : String(v).split(",").map(s => s.trim()).filter(Boolean));
    const webhooks = (Array.isArray(p.webhooks) ? p.webhooks : []).map((w, i) => {
      w = w || {};
      const url = String(w.url || "").trim();
      if (!url) return null;
      return { id: String(w.id || ("wh-" + (i + 1))), url, events: normEvents(w.events).filter(e => TYPES.indexOf(e) !== -1), active: w.active !== false };
    }).filter(Boolean);
    // A single webhook may also be declared with flat scalar fields, so the pjs
    // policy block stays simple (no nested arrays/objects).
    if (!webhooks.length && p.webhook_url) {
      webhooks.push({ id: "wh-1", url: String(p.webhook_url).trim(), events: normEvents(p.webhook_events).filter(e => TYPES.indexOf(e) !== -1), active: true });
    }
    return { stream: p.stream ? String(p.stream) : STREAM, source: p.source ? String(p.source) : SOURCE, webhooks };
  }

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const gateway = opts.gateway || null;
    const audit = opts.audit || null;
    const clock = opts.clock || null;
    const actor = opts.actor || "system";
    const generatorName = opts.generatorName || null;
    const maxRetries = opts.maxRetries === undefined ? 4 : opts.maxRetries;
    const policy = normalizePolicy(opts.policy);

    let records = [];
    let revision = 0;
    let loaded = false;
    const subscribers = [];

    if (store && (typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function")) {
      throw new BusError("no_store", "QU_BUS needs a document store with loadDoc/saveChecked.");
    }

    const stream = policy.stream;
    function envelopeStream(env) { return (env && env.stream) || stream; }

    function webhooksFor(type) {
      return policy.webhooks.filter(w => w.active && w.events.indexOf(type) !== -1);
    }

    async function load() {
      if (!store) return { ok: true, records: records.slice(), revision: 0 };
      const d = await store.loadDoc(DOC);
      if (!d.ok) return d;
      const content = isPlainObject(d.content) ? d.content : {};
      return { ok: true, revision: d.revision, recs: Array.isArray(content.records) ? content.records.slice() : [] };
    }

    async function persist() {
      if (!store) return { ok: true, revision: 0 };
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const byId = new Map();
        (l.recs || []).concat(records).forEach(r => { if (r && r.envelope && r.envelope.id) byId.set(String(r.envelope.id), r); });
        const merged = Array.from(byId.values()).sort((a, b) => String(a.envelope.at).localeCompare(String(b.envelope.at))).slice(-CAP);
        const content = { records: merged };
        const save = await store.saveChecked(DOC, content, { expectedBase: l.revision });
        if (save.ok) { records = merged; revision = save.revision; loaded = true; return { ok: true, revision: save.revision }; }
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "bus_write_conflict", detail: `Could not write the ${DOC} document after ${maxRetries + 1} attempts.` };
    }

    async function ready() {
      const l = await load();
      if (l.ok) {
        const byId = new Map();
        (l.recs || []).concat(records).forEach(r => { if (r && r.envelope && r.envelope.id) byId.set(String(r.envelope.id), r); });
        records = Array.from(byId.values()).sort((a, b) => String(a.envelope.at).localeCompare(String(b.envelope.at))).slice(-CAP);
        revision = l.revision;
        loaded = true;
      } else return l;
      return { ok: true, doc: DOC, stream, published: records.filter(r => r.published).length, pending: records.filter(r => !r.delivered).length, webhooks: policy.webhooks.length };
    }

    function find(id) { return records.find(r => r.envelope && r.envelope.id === String(id)) || null; }

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      return audit.append(input);
    }

    function notify(env, rec) {
      subscribers.forEach(fn => { try { fn(Object.assign({}, env), rec); } catch (e) {} });
    }

    // Record + publish one event. Returns { ok, skipped } for an unmapped event
    // (the log keeps it, the bus does not), else the envelope + delivery state.
    async function publish(event) {
      const type = typeFor(event);
      if (!type) return { ok: true, skipped: true, reason: "unpublishable_event" };
      const env = toEnvelope(event, { clock, source: policy.source, stream, generatorName });
      const existing = find(env.id);
      if (existing) {
        // Already recorded — re-publishing is a no-op (idempotent).
        return { ok: true, duplicate: true, envelope: existing.envelope, record: publicRecord(existing) };
      }
      const rec = { envelope: env, published: false, delivered: false, attempts: 0, last_error: null, at: nowIso(clock), bus_result: null, webhook_results: [] };
      records.push(rec);
      if (records.length > CAP) records = records.slice(-CAP);
      await persist();
      await auditAppend({
        quote_id: env.subject.id, version_id: env.subject.version_id, event: "bus_published",
        actor_type: "system", actor: actor,
        detail: { type: env.type, envelope_id: env.id, stream, schema: SCHEMA, version: SCHEMA_VERSION }
      });
      notify(env, publicRecord(rec));
      return { ok: true, envelope: env, record: publicRecord(rec) };
    }

    // Try to land one record on the bus and its webhooks. Idempotent.
    async function deliver(rec) {
      rec.attempts = (rec.attempts || 0) + 1;
      const env = rec.envelope;
      if (!gateway || typeof gateway.call !== "function") {
        rec.last_error = "no_gateway";
        return { ok: false, code: "no_gateway", detail: "No connector gateway is configured." };
      }
      if (!rec.published) {
        const res = gateway.call("bus", "publish", { stream: envelopeStream(env), envelope: env }, { scope: "*", confirm: { by: actor, note: "publish " + env.type + " " + env.id } });
        if (!res.ok) { rec.last_error = res.code || "bus_publish_failed"; await persist(); return { ok: false, code: "bus_publish_failed", detail: res.detail || "The event could not be published to the bus." }; }
        rec.published = true;
        rec.bus_result = res.result || null;
      }
      const hooks = webhooksFor(env.type);
      const results = [];
      let allOk = true;
      for (const w of hooks) {
        const res = gateway.call("bus", "webhookPost", { url: w.url, envelope: env }, { scope: "*", confirm: { by: actor, note: "webhook " + env.id } });
        if (res.ok) results.push({ id: w.id, url: w.url, status: (res.result && res.result.status) || 200, ok: true });
        else { results.push({ id: w.id, url: w.url, ok: false, code: res.code || "webhook_failed" }); allOk = false; }
      }
      rec.webhook_results = results;
      rec.delivered = allOk;
      if (!allOk) rec.last_error = "webhook_failed";
      await persist();
      return { ok: true, published: rec.published, delivered: rec.delivered, webhooks: results };
    }

    // Flush every record that has not been fully delivered. Idempotent; safe to
    // call on a timer or after any publish.
    async function flush() {
      const due = records.filter(r => !r.delivered);
      const out = [];
      for (const rec of due) {
        const res = await deliver(rec);
        out.push({ id: rec.envelope.id, type: rec.envelope.type, ok: res.ok, delivered: !!rec.delivered, error: rec.last_error });
      }
      return { ok: out.every(o => o.ok), delivered: out.filter(o => o.delivered).length, attempted: out.length, results: out };
    }

    // Publish-and-deliver in one call (the common path for a live event).
    async function emit(event) {
      const pub = await publish(event);
      if (pub.skipped) return pub;
      if (pub.duplicate) return pub;
      const rec = find(pub.envelope.id);
      const res = await deliver(rec);
      return { ok: res.ok, envelope: pub.envelope, published: rec.published, delivered: rec.delivered, webhooks: res.webhooks, duplicate: false };
    }

    function registerWebhook(spec) {
      spec = spec || {};
      const url = String(spec.url || "").trim();
      if (!url) return { ok: false, code: "url_required", detail: "A webhook needs a url." };
      const events = spec.events === undefined || spec.events === null || spec.events === "*"
        ? TYPES.slice()
        : (Array.isArray(spec.events) ? spec.events.map(String) : String(spec.events).split(",").map(s => s.trim()).filter(Boolean));
      const entry = { id: String(spec.id || ("wh-" + (policy.webhooks.length + 1))), url, events: events.filter(e => TYPES.indexOf(e) !== -1), active: spec.active !== false };
      policy.webhooks.push(entry);
      return { ok: true, webhook: entry };
    }

    function pending() { return records.filter(r => !r.delivered).map(publicRecord); }
    function published() { return records.filter(r => r.published).map(publicRecord); }
    function subscribe(fn) { if (typeof fn === "function") subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i !== -1) subscribers.splice(i, 1); }; }

    function publicRecord(r) {
      return { envelope_id: r.envelope.id, type: r.envelope.type, key: r.envelope.key, at: r.envelope.at, published: !!r.published, delivered: !!r.delivered, attempts: r.attempts || 0, error: r.last_error || null };
    }

    function verify() {
      const violations = [];
      records.forEach(r => {
        const env = r.envelope || {};
        if (env.schema !== SCHEMA) violations.push({ code: "bad_schema", detail: `${env.id} has schema ${env.schema}.` });
        if (env.version !== SCHEMA_VERSION) violations.push({ code: "bad_schema_version", detail: `${env.id} has version ${env.version}.` });
        if (TYPES.indexOf(env.type) === -1) violations.push({ code: "bad_type", detail: `${env.id} has an unknown type.` });
        if (!env.id) violations.push({ code: "no_id", detail: "An envelope has no id." });
      });
      const ids = records.map(r => r.envelope.id);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dup.length) violations.push({ code: "duplicate_envelope", detail: `Duplicate envelope id(s): ${dup.join(", ")}.` });
      return { ok: violations.length === 0, violations, count: records.length, pending: pending().length, stream };
    }

    return {
      ready,
      SCHEMA,
      SCHEMA_VERSION,
      stream: () => stream,
      policy: () => JSON.parse(JSON.stringify(policy)),
      webhooks: () => policy.webhooks.map(w => Object.assign({}, w)),
      registerWebhook,
      publish,
      emit,
      flush,
      pending,
      published,
      records: () => records.map(publicRecord),
      get: id => { const r = find(id); return r ? publicRecord(r) : null; },
      subscribe,
      verify,
      TYPES
    };
  }

  return {
    VERSION,
    SCHEMA,
    SCHEMA_VERSION,
    STREAM,
    SOURCE,
    DOC,
    TYPE_MAP,
    TYPES,
    typeFor,
    isPublishable,
    envelopeId,
    toEnvelope,
    normalizePolicy,
    createService
  };
})();
