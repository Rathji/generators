// ============================================================================
// quote-u — append-only audit log (roadmap task 6)
// ----------------------------------------------------------------------------
// `quote_events` is the system's memory of what happened: every lifecycle
// transition (task 5) and every external write (the approval orchestrator and
// connector gateway in later phases) lands here as one immutable record.
//
// The log is APPEND-ONLY: records are never edited or deleted. Each record is
// sealed into a hash chain — its `hash` covers its own canonical content plus
// the previous record's hash — so a rewritten or removed record breaks the
// chain and `verify()` proves it. The client half is pure and testable; the
// service half appends through the same revision-guarded document store as
// every other entity, and refuses to write if the stored log no longer extends
// what it read (a concurrent rewrite), so no device can silently rewrite
// history.
//
// Record shape (superset of QU_LIFECYCLE.createEvent — the base fields):
//   quote_id, version_id, event, actor_type (internal|portal|system), actor,
//   token_id, ip, user_agent, detail (JSON), at              ← the audit facts
//   seq, id, prev_hash, hash                                  ← log bookkeeping
// The token SECRET is never recorded — only a token id (invariant I4/portal).
// ============================================================================
(function () {
  "use strict";

  const VERSION = "1.0.0";
  const MODULE = "quote_events";
  const GENESIS_HASH = "0".repeat(64);
  const DEFAULT_MAX_RETRIES = 5;
  const ORDER = ["draft", "internal_review", "sent", "viewed", "approved", "declined", "expired"];

  // Every event the log must be able to record, grouped by what produced it.
  const EVENT_CATEGORY = Object.freeze({
    // per-version lifecycle (mirrors QU_LIFECYCLE.TRANSITIONS + created/revised)
    created: "lifecycle",
    revised: "lifecycle",
    internal_review_started: "lifecycle",
    internal_review_returned: "lifecycle",
    sent: "lifecycle",
    viewed: "lifecycle",
    option_changed: "lifecycle",
    approved: "lifecycle",
    declined: "lifecycle",
    expired: "lifecycle",
    link_revoked: "lifecycle",
    // external writes, performed through the connector gateway (audited too)
    opp_created: "external",
    opp_updated: "external",
    note_written: "external",
    email_sent: "external",
    invoice_created: "external",
    invoice_reconciled: "external",
    products_written: "external",
    bus_published: "external",
    // governance: proving an external integration is safe to enable (task 64)
    integration_verified: "governance",
    error: "external"
  });

  const EVENT_LABEL = Object.freeze({
    created: "Version created",
    revised: "Version revised",
    internal_review_started: "Internal review started",
    internal_review_returned: "Internal review returned",
    sent: "Quote sent",
    viewed: "Quote viewed",
    option_changed: "Option changed",
    approved: "Quote approved",
    declined: "Quote declined",
    expired: "Quote expired",
    link_revoked: "Portal link revoked",
    opp_created: "Opportunity created",
    opp_updated: "Opportunity updated",
    note_written: "Opportunity note written",
    email_sent: "Quote email sent",
    invoice_created: "Invoice created",
    invoice_reconciled: "Invoice reconciled",
    products_written: "Revenue lines written",
    bus_published: "Event published to the pipeline bus",
    integration_verified: "Integration verified (live)",
    error: "External write failed"
  });

  const REQUIRED_EVENTS = Object.freeze(Object.keys(EVENT_CATEGORY));
  const ACTOR_TYPES = Object.freeze(["internal", "portal", "system"]);
  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;

  class AuditError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "AuditError";
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new AuditError(code, message);
  }

  function isEvent(name) {
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(EVENT_CATEGORY, name);
  }

  function eventCategory(name) {
    return isEvent(name) ? EVENT_CATEGORY[name] : null;
  }

  function events(category) {
    return REQUIRED_EVENTS.filter(e => !category || EVENT_CATEGORY[e] === category);
  }

  function acceptedAttrs() {
    return { events: REQUIRED_EVENTS.slice(), actorTypes: ACTOR_TYPES.slice() };
  }

  // ------------------------------------------------------------------ hashing

  function randHex(n) {
    if (window.QU_STORE && window.QU_STORE.randHex) return window.QU_STORE.randHex(n);
    const arr = new Uint8Array(n);
    if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    let out = "";
    for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
    return out.slice(0, n);
  }

  // Deterministic content hash used only when no store digest is available.
  function localDigest(text) {
    const s = String(text == null ? "" : text);
    let out = "";
    for (let k = 0; k < 8; k++) {
      let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      out += h.toString(16).padStart(8, "0");
    }
    return out;
  }

  // Deterministic JSON (sorted keys, arrays in order, undefined → null) so the
  // same record always hashes the same on every device.
  function canonicalize(v) {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) if (v[k] !== undefined) parts.push(JSON.stringify(k) + ":" + canonicalize(v[k]));
    return "{" + parts.join(",") + "}";
  }

  function stripHash(record) {
    const c = Object.assign({}, record);
    delete c.hash;
    return c;
  }

  function hashOf(prevHash, record, digest) {
    const input = String(prevHash) + "\n" + canonicalize(stripHash(record));
    return Promise.resolve((digest || localDigest)(input)).then(h => String(h));
  }

  function newEventId(at) {
    const ms = Date.parse(at);
    return "ev-" + (isNaN(ms) ? Date.now() : ms).toString(36) + "-" + randHex(6);
  }

  // ------------------------------------------------------------- normalizing

  function nowIso(ctx) {
    if (ctx && ctx.at) return String(ctx.at);
    return new Date().toISOString();
  }

  function nz(v) {
    return v === undefined ? null : v;
  }

  function checkForbiddenKeys(obj, path) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => checkForbiddenKeys(v, path + "[" + i + "]"));
      return;
    }
    for (const key of Object.keys(obj)) {
      if (SECRET_KEY_RE.test(key)) fail("secret_in_event", `Refusing to record a secret-shaped field "${path}${key}" in the audit log.`);
      checkForbiddenKeys(obj[key], path + key + ".");
    }
  }

  // Validate a raw input (or a record produced by QU_LIFECYCLE) and return the
  // canonical base record. Throws AuditError on anything malformed.
  function normalizeInput(input) {
    input = input || {};
    if (!isEvent(input.event)) fail("unknown_event", `"${input.event}" is not a known audit event.`);
    const actorType = input.actor_type === undefined ? "system" : input.actor_type;
    if (ACTOR_TYPES.indexOf(actorType) === -1) fail("bad_actor", `actor_type must be one of ${ACTOR_TYPES.join(", ")}.`);
    if (actorType === "portal" && !input.token_id) fail("portal_needs_token", "A portal event must carry the token id (never the token secret).");
    const actor = input.actor === undefined ? actorType : input.actor;
    if (typeof actor !== "string" || !actor) fail("bad_actor", "An audit event needs a non-empty actor.");
    for (const key of Object.keys(input)) {
      if (SECRET_KEY_RE.test(key)) fail("secret_in_event", `Refusing to record a secret-shaped field "${key}" in the audit log.`);
    }
    checkForbiddenKeys(input.detail, "detail.");
    return {
      quote_id: nz(input.quote_id),
      version_id: nz(input.version_id),
      event: input.event,
      actor_type: actorType,
      actor: actor,
      token_id: nz(input.token_id),
      ip: nz(input.ip),
      user_agent: nz(input.user_agent),
      detail: input.detail === undefined || input.detail === null ? {} : input.detail,
      at: nowIso(input)
    };
  }

  // Extract the audit record from a QU_LIFECYCLE apply()/beginVersion() result.
  function extractRecord(result) {
    if (result && typeof result === "object" && result.record && typeof result.record === "object") return result.record;
    return null;
  }

  // Seal one record onto the end of a records array (pure; returns a new array).
  function buildRecord(records, input, digest) {
    const prev = Array.isArray(records) ? records : [];
    const base = normalizeInput(input);
    const seq = prev.length + 1;
    const prevHash = prev.length ? String(prev[prev.length - 1].hash || GENESIS_HASH) : GENESIS_HASH;
    const draft = Object.assign({}, base, { seq, id: newEventId(base.at), prev_hash: prevHash });
    return hashOf(prevHash, draft, digest).then(hash => {
      draft.hash = hash;
      return draft;
    });
  }

  function recordsOf(content) {
    if (Array.isArray(content)) return content;
    return Array.isArray(content && content.records) ? content.records : [];
  }

  // Pure append onto a log object { records, meta }.
  function appendRecord(log, record) {
    const records = recordsOf(log).slice();
    records.push(record);
    return {
      records,
      meta: Object.assign({}, (log && log.meta) || {}, {
        count: records.length,
        head_hash: record.hash,
        updated_at: new Date().toISOString()
      })
    };
  }

  // ------------------------------------------------------------ append-only

  function compare(a, b) {
    return canonicalize(a) === canonicalize(b);
  }

  // Prove `after` only ever added to `before` — every earlier record is byte-
  // identical and still present in the same order. Any edit or removal fails.
  function verifyAppendOnly(before, after) {
    const a = recordsOf(before);
    const b = recordsOf(after);
    if (b.length < a.length) return { ok: false, code: "log_shrunk", detail: `the log lost ${a.length - b.length} record(s)` };
    for (let i = 0; i < a.length; i++) {
      if (!compare(a[i], b[i])) return { ok: false, code: "log_rewritten", detail: `record ${i + 1} was modified or reordered` };
    }
    return { ok: true, appended: b.length - a.length, unchanged: a.length };
  }

  // Cheap O(1) tail check used on every append: the last record's seq and link.
  function verifyTail(records) {
    const recs = recordsOf(records);
    if (!recs.length) return { ok: true, count: 0 };
    const last = recs[recs.length - 1];
    if (!last || typeof last !== "object") return { ok: false, code: "log_corrupt", detail: "the last record is not an object" };
    if (last.seq !== recs.length) return { ok: false, code: "log_corrupt", detail: `the last record has seq ${last.seq}, expected ${recs.length}` };
    const expectPrev = recs.length === 1 ? GENESIS_HASH : recs[recs.length - 2].hash;
    if (last.prev_hash !== expectPrev) return { ok: false, code: "log_corrupt", detail: "the last record does not link to its predecessor" };
    return { ok: true, count: recs.length };
  }

  // Full integrity walk: every seq is contiguous and every hash re-derives.
  async function verifyChain(records, digest) {
    const recs = recordsOf(records);
    const breaks = [];
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (!r || typeof r !== "object") { breaks.push(`record ${i + 1} is not an object`); continue; }
      if (r.seq !== i + 1) breaks.push(`record ${i + 1} has seq ${r.seq} (expected ${i + 1})`);
      const expectPrev = i === 0 ? GENESIS_HASH : recs[i - 1].hash;
      if (r.prev_hash !== expectPrev) breaks.push(`record ${i + 1} does not link to record ${i}`);
      const recomputed = await hashOf(r.prev_hash, r, digest);
      if (recomputed !== r.hash) breaks.push(`record ${i + 1} failed its content-hash check`);
    }
    return { ok: breaks.length === 0, count: recs.length, breaks, head_hash: recs.length ? recs[recs.length - 1].hash : GENESIS_HASH };
  }

  // --------------------------------------------------------------- service

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "The audit service needs a document store with loadDoc/saveChecked.");
    }
    const module = opts.module || MODULE;
    const digest = opts.digest || (store.digestHex ? (s => store.digestHex(s)) : localDigest);
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;

    async function load() {
      const d = await store.loadDoc(module);
      if (!d.ok) return d;
      return { ok: true, state: d.state, revision: d.revision, records: recordsOf(d.content), meta: (d.content && d.content.meta) || {} };
    }

    async function appendMany(inputs) {
      const list = Array.isArray(inputs) ? inputs.slice() : [inputs];
      if (!list.length) return { ok: true, appended: 0, records: [], records_total: 0 };
      let base = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const d = await store.loadDoc(module);
        if (!d.ok) return d;
        const records = recordsOf(d.content);
        if (base) {
          const guard = verifyAppendOnly(base, records);
          if (!guard.ok) {
            return { ok: false, code: "log_rewritten", detail: "The stored audit log no longer extends what was read a moment ago — refusing to append so history cannot be rewritten.", guard };
          }
        }
        const tail = verifyTail(records);
        if (!tail.ok) return tail;
        let log = { records, meta: (d.content && d.content.meta) || {} };
        const built = [];
        for (const input of list) {
          const rec = await buildRecord(log.records, input, digest);
          log = appendRecord(log, rec);
          built.push(rec);
        }
        const save = await store.saveChecked(module, log, { expectedBase: d.revision });
        if (save.ok) {
          return { ok: true, appended: built.length, records: built, revision: save.revision, records_total: log.records.length, noop: !!save.noop };
        }
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") {
          base = records;
          continue;
        }
        return save;
      }
      return { ok: false, code: "append_conflict", detail: `Could not append to the audit log after ${maxRetries + 1} attempts; the log kept moving.` };
    }

    async function append(input) {
      const r = await appendMany([input]);
      if (!r.ok) return r;
      return Object.assign({}, r, { record: r.records[0] });
    }

    function matches(record, f) {
      if (f.quote_id !== undefined && record.quote_id !== f.quote_id) return false;
      if (f.version_id !== undefined && record.version_id !== f.version_id) return false;
      if (f.event !== undefined && record.event !== f.event) return false;
      if (f.actor_type !== undefined && record.actor_type !== f.actor_type) return false;
      if (f.from !== undefined && record.seq < f.from) return false;
      if (f.to !== undefined && record.seq > f.to) return false;
      return true;
    }

    async function list(filter) {
      const d = await load();
      if (!d.ok) return d;
      let recs = d.records;
      if (filter) {
        const f = filter;
        recs = recs.filter(r => matches(r, f));
        if (f.order === "desc") recs = recs.slice().reverse();
        if (f.limit !== undefined) recs = recs.slice(0, f.limit);
      }
      return { ok: true, records: recs, total: d.records.length, revision: d.revision, head_hash: d.records.length ? d.records[d.records.length - 1].hash : GENESIS_HASH };
    }

    function forQuote(quoteId, filter) {
      return list(Object.assign({}, filter || {}, { quote_id: quoteId }));
    }
    function forVersion(versionId, filter) {
      return list(Object.assign({}, filter || {}, { version_id: versionId }));
    }
    function sinceSeq(seq) {
      return list({ from: (Number(seq) || 0) + 1 });
    }
    async function count() {
      const d = await load();
      return d.ok ? { ok: true, count: d.records.length, revision: d.revision } : d;
    }

    function stats(records) {
      const recs = recordsOf(records);
      const byEvent = {};
      const byCategory = {};
      const byActor = {};
      for (const r of recs) {
        byEvent[r.event] = (byEvent[r.event] || 0) + 1;
        const c = eventCategory(r.event) || "unknown";
        byCategory[c] = (byCategory[c] || 0) + 1;
        byActor[r.actor_type] = (byActor[r.actor_type] || 0) + 1;
      }
      return { total: recs.length, byEvent, byCategory, byActor };
    }

    async function statsSummary() {
      const d = await load();
      if (!d.ok) return d;
      return Object.assign({ ok: true, revision: d.revision }, stats(d.records));
    }

    async function verify() {
      const d = await load();
      if (!d.ok) return d;
      const res = await verifyChain(d.records, digest);
      res.revision = d.revision;
      res.meta = d.meta;
      return res;
    }

    function ready() {
      const p = store.ready ? Promise.resolve(store.ready()) : Promise.resolve();
      return p.then(() => true);
    }

    return {
      module,
      load,
      append,
      appendMany,
      list,
      forQuote,
      forVersion,
      sinceSeq,
      count,
      stats: statsSummary,
      verify,
      ready
    };
  }

  window.QU_AUDIT = {
    VERSION,
    MODULE,
    GENESIS_HASH,
    EVENT_CATEGORY,
    EVENT_LABEL,
    REQUIRED_EVENTS,
    ACTOR_TYPES,
    ORDER,
    AuditError,
    isEvent,
    eventCategory,
    events,
    acceptedAttrs,
    canonicalize,
    hashOf,
    stripHash,
    normalizeInput,
    extractRecord,
    buildRecord,
    recordsOf,
    appendRecord,
    verifyAppendOnly,
    verifyTail,
    verifyChain,
    localDigest,
    createService
  };
})();
