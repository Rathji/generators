// ============================================================================
// quote-u — quote versions, freeze & immutability (roadmap task 16)
// ----------------------------------------------------------------------------
// A quote is a series of VERSIONS. Editing the quote edits its current draft
// version; sending it freezes that version; changing a quote that has been sent
// means REVISING it — which creates a NEW version rather than editing the sent
// one. This module is the authority on all of that, and it exists to make
// invariant I1 true by construction:
//
//   I1 — a sent/frozen version is immutable; no code path re-prices it.
//
// Two layers enforce it:
//
//   1. The *service* refuses to touch a frozen version through any of its own
//      methods (`updateVersion`, `addLine`, `updateLine`, `removeLine`,
//      `add/update/removeGroup` all fail `frozen_version_immutable`), and the
//      only way `frozen_at` is ever set is `freeze()`.
//   2. A *store write guard* is registered with the document store, so even a
//      writer that does not go through this service cannot mutate a frozen
//      version, its line items or its option groups: the guard compares the
//      stored document with the proposed one and vetoes any change to a frozen
//      record. The guard is the storage-layer backstop; the service is the happy
//      path.
//
// A version also carries a `frozen_seal` — a deterministic hash over the frozen
// version plus its lines and groups, captured at freeze time. `verify()` re-seals
// every frozen bundle and reports any that changed, and the seal is registered
// with the authoritative server plugin (which keeps the id→seal map in its
// durable state), so a tamper is provable against a copy the client cannot
// rewrite.
//
// The pure half (isFrozen / normalize / freezeVersion / immutability / sealOf)
// has no I/O; the service half wires it to the versioned document store.
// ============================================================================
window.QU_VERSIONS = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u versions require window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const DOC_VERSIONS = "quote_versions";
  const DOC_LINES = "line_items";
  const DOC_GROUPS = "option_groups";
  const GUARDED_DOCS = [DOC_VERSIONS, DOC_LINES, DOC_GROUPS];
  const DEFAULT_MAX_RETRIES = 4;

  function states() {
    return (window.QU_LIFECYCLE && window.QU_LIFECYCLE.STATES) || ["draft", "internal_review", "sent", "viewed", "approved", "declined", "expired"];
  }
  function terminalStates() {
    return (window.QU_LIFECYCLE && window.QU_LIFECYCLE.TERMINAL_STATES) || ["approved", "declined", "expired"];
  }

  // The stored version record. `frozen_at` is the immutability switch; the
  // `frozen_*` companions record who froze it, in what state, and the seal over
  // the frozen bundle (version + its lines + its groups).
  const VERSION_FIELDS = [
    { name: "id", generated: true },
    { name: "quote_id", default: null },
    { name: "quote_number", default: null },
    { name: "version_number", default: 1 },
    { name: "state", default: "draft" },
    { name: "title", default: "" },
    { name: "notes", default: null, note: "internal note — never exposed to a client" },
    { name: "expires_at", default: null },
    { name: "frozen_at", default: null, note: "set ONLY by freeze()" },
    { name: "frozen_by", default: null },
    { name: "frozen_state", default: null },
    { name: "frozen_seal", default: null },
    { name: "revised_from", default: null },
    { name: "created_at", generated: true },
    { name: "created_by", default: null },
    { name: "updated_at", generated: true }
  ];

  // Fields that only the freeze action may set. A normal update strips them.
  const FREEZE_FIELDS = ["frozen_at", "frozen_by", "frozen_state", "frozen_seal"];

  // Fields carried from a source version into a revision.
  const REVISION_CARRY = ["quote_id", "quote_number", "title", "notes", "expires_at", "created_by"];

  class VersionError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "VersionError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) {
    throw new VersionError(code, message, meta);
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function genId(rand) {
    return "v-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function isFrozen(version) {
    return !!(version && typeof version.frozen_at === "string" && version.frozen_at.length > 0);
  }

  function isIso(v) {
    return typeof v === "string" && v.length > 0 && !isNaN(Date.parse(v));
  }

  // ---- deterministic canonicalisation / digest (share QU_AUDIT when present) --

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

  function localCanonicalize(v) {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(localCanonicalize).join(",") + "]";
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) if (v[k] !== undefined) parts.push(JSON.stringify(k) + ":" + localCanonicalize(v[k]));
    return "{" + parts.join(",") + "}";
  }

  function canonicalize(v) {
    const A = window.QU_AUDIT;
    if (A && typeof A.canonicalize === "function") return A.canonicalize(v);
    return localCanonicalize(v);
  }

  function digestOf(v) {
    const A = window.QU_AUDIT;
    if (A && typeof A.localDigest === "function") return A.localDigest(canonicalize(v));
    return localDigest(canonicalize(v));
  }

  // ---- the version record --------------------------------------------------

  function asString(value, name, def, violations) {
    if (value === undefined || value === null) return def;
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string` });
      return def;
    }
    return value;
  }

  function asNullableString(value, name, violations) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string or null` });
      return null;
    }
    return value;
  }

  function collect(input, opts) {
    opts = opts || {};
    const violations = [];
    if (!isPlainObject(input)) {
      return { violations: [{ field: null, code: "bad_version", detail: "A quote version must be an object" }], record: null };
    }
    let id = input.id;
    if (id === undefined || id === null || id === "") id = opts.id || genId(opts.rand);
    else if (typeof id !== "string") {
      violations.push({ field: "id", code: "bad_id", detail: "id must be a string" });
      id = String(id);
    }

    let versionNumber = input.version_number;
    if (versionNumber === undefined || versionNumber === null) versionNumber = 1;
    if (typeof versionNumber !== "number" || !Number.isInteger(versionNumber) || versionNumber < 1) {
      violations.push({ field: "version_number", code: "bad_version_number", detail: "version_number must be an integer >= 1" });
      versionNumber = 1;
    }

    let state = input.state === undefined || input.state === null ? "draft" : String(input.state);
    if (states().indexOf(state) === -1) {
      violations.push({ field: "state", code: "bad_state", detail: `state "${state}" is not a known lifecycle state` });
      state = "draft";
    }

    const frozenAt = asNullableString(input.frozen_at, "frozen_at", violations);
    if (frozenAt !== null && !isIso(frozenAt)) {
      violations.push({ field: "frozen_at", code: "bad_frozen_at", detail: "frozen_at must be an ISO timestamp or null" });
    }
    let frozenState = asNullableString(input.frozen_state, "frozen_state", violations);
    if (frozenState !== null && states().indexOf(frozenState) === -1) {
      violations.push({ field: "frozen_state", code: "bad_frozen_state", detail: "frozen_state must be a known lifecycle state or null" });
      frozenState = null;
    }

    const expiresAt = asNullableString(input.expires_at, "expires_at", violations);
    if (expiresAt !== null && !isIso(expiresAt)) {
      violations.push({ field: "expires_at", code: "bad_expires_at", detail: "expires_at must be an ISO timestamp or null" });
    }

    const record = {
      id,
      quote_id: asNullableString(input.quote_id, "quote_id", violations),
      quote_number: asNullableString(input.quote_number, "quote_number", violations),
      version_number: versionNumber,
      state,
      title: asString(input.title, "title", "", violations),
      notes: asNullableString(input.notes, "notes", violations),
      expires_at: expiresAt,
      frozen_at: frozenAt,
      frozen_by: asNullableString(input.frozen_by, "frozen_by", violations),
      frozen_state: frozenState,
      frozen_seal: asNullableString(input.frozen_seal, "frozen_seal", violations),
      revised_from: asNullableString(input.revised_from, "revised_from", violations),
      created_at: input.created_at === undefined || input.created_at === null ? nowIso(opts.clock) : asString(input.created_at, "created_at", nowIso(opts.clock), violations),
      created_by: asNullableString(input.created_by, "created_by", violations),
      updated_at: input.updated_at === undefined || input.updated_at === null ? nowIso(opts.clock) : asString(input.updated_at, "updated_at", nowIso(opts.clock), violations)
    };
    if (record.frozen_at === null) {
      // A non-frozen record must not carry freeze companions.
      if (record.frozen_state !== null || record.frozen_seal !== null) {
        violations.push({ field: "frozen_at", code: "inconsistent_freeze", detail: "freeze companions require frozen_at" });
      }
    }

    Object.keys(input).forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(record, k)) record[k] = input[k];
    });
    return { violations, record };
  }

  function validate(input, opts) {
    const out = collect(input, opts);
    return { ok: out.violations.length === 0, violations: out.violations, record: out.record };
  }

  function normalize(input, opts) {
    const out = collect(input, opts);
    if (out.violations.length) {
      const v = out.violations[0];
      fail(v.code, v.detail, { violations: out.violations });
    }
    return out.record;
  }

  // Pure freeze: stamp the immutability switch. Throws `already_frozen` or
  // `terminal_version`. This is the ONLY function that produces a frozen record.
  function freezeVersion(version, ctx) {
    ctx = ctx || {};
    if (!isPlainObject(version)) fail("bad_version", "freeze() needs a version record.");
    if (isFrozen(version)) fail("already_frozen", `Version ${version.id} is already frozen at ${version.frozen_at}.`);
    if (terminalStates().indexOf(version.state) !== -1) {
      fail("terminal_version", `A ${version.state} version cannot be frozen.`);
    }
    const at = nowIso(ctx.clock || ctx.at && null);
    const iso = ctx.at !== undefined && ctx.at !== null ? String(ctx.at) : at;
    return Object.assign({}, version, {
      frozen_at: iso,
      frozen_by: ctx.actor !== undefined && ctx.actor !== null ? String(ctx.actor) : "system",
      frozen_state: version.state,
      updated_at: iso
    });
  }

  // Strip any attempt to set a freeze field outside freeze().
  function stripFreezeFields(patch) {
    const out = {};
    Object.keys(patch || {}).forEach(k => { if (FREEZE_FIELDS.indexOf(k) === -1) out[k] = patch[k]; });
    return out;
  }

  // ---- the seal over a frozen bundle --------------------------------------

  function sealBundle(version, lines, groups) {
    const v = Object.assign({}, version);
    delete v.frozen_seal;
    const sortById = arr => (arr || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return digestOf({ version: v, lines: sortById(lines), groups: sortById(groups) });
  }

  function sealOf(version, lines, groups) {
    return sealBundle(version, lines, groups);
  }

  // The concise version summary the server plugin keeps a seal of.
  function versionSummary(version) {
    if (!version) return null;
    return {
      id: version.id,
      quote_id: version.quote_id === undefined ? null : version.quote_id,
      quote_number: version.quote_number === undefined ? null : version.quote_number,
      version_number: version.version_number,
      state: version.state,
      title: version.title || "",
      frozen_at: version.frozen_at === undefined ? null : version.frozen_at,
      frozen_by: version.frozen_by === undefined ? null : version.frozen_by,
      frozen_state: version.frozen_state === undefined ? null : version.frozen_state,
      revised_from: version.revised_from === undefined ? null : version.revised_from
    };
  }

  // ---- immutability (pure) --------------------------------------------------

  function asRecords(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.records)) return v.records;
    return [];
  }

  function toIdSet(v) {
    const s = new Set();
    if (!v) return s;
    const list = v instanceof Set ? Array.from(v) : (Array.isArray(v) ? v : Object.keys(v));
    list.forEach(x => { if (x !== undefined && x !== null) s.add(String(x)); });
    return s;
  }

  // Pure, non-throwing. Given the document as it *was* (previous) and as it is
  // *proposed* (next), report every change to a frozen record.
  //   { module, previous, next, frozenVersionIds }
  // → { ok, code, violations, detail }
  function immutability(input) {
    input = input || {};
    const module = input.module;
    const prev = asRecords(input.previous);
    const next = asRecords(input.next);
    const violations = [];
    const nextById = new Map();
    next.forEach(r => { if (r && r.id !== undefined && r.id !== null) nextById.set(String(r.id), r); });

    if (module === DOC_VERSIONS) {
      prev.forEach(r => {
        if (!isFrozen(r)) return;
        const found = nextById.get(String(r.id));
        if (!found) {
          violations.push({ id: r.id, code: "frozen_version_deleted", detail: `Frozen version ${r.id} would be removed.` });
          return;
        }
        if (canonicalize(r) !== canonicalize(found)) {
          violations.push({ id: r.id, code: "frozen_version_immutable", detail: `Frozen version ${r.id} would be modified.` });
        }
      });
    } else if (module === DOC_LINES || module === DOC_GROUPS) {
      const frozenIds = toIdSet(input.frozenVersionIds);
      prev.forEach(r => {
        if (!r || r.quote_version_id === undefined || r.quote_version_id === null) return;
        if (!frozenIds.has(String(r.quote_version_id))) return;
        const found = nextById.get(String(r.id));
        if (!found) {
          violations.push({ id: r.id, version_id: r.quote_version_id, code: "frozen_member_deleted", detail: `A record of frozen version ${r.quote_version_id} would be removed.` });
          return;
        }
        if (canonicalize(r) !== canonicalize(found)) {
          violations.push({ id: r.id, version_id: r.quote_version_id, code: "frozen_member_immutable", detail: `A record of frozen version ${r.quote_version_id} would be modified.` });
        }
      });
    }
    if (violations.length) {
      const first = violations[0];
      return {
        ok: false,
        code: first.code,
        violations,
        detail: `${first.detail} A frozen version is immutable (invariant I1).`
      };
    }
    return { ok: true, code: null, violations: [] };
  }

  function assertImmutable(input) {
    const out = immutability(input);
    if (!out.ok) fail(out.code, out.detail, { violations: out.violations });
    return input.next;
  }

  // ---- revision cloning ----------------------------------------------------

  function withFreshId(record, prefix, idFactory) {
    const copy = Object.assign({}, record);
    copy.id = idFactory ? idFactory(prefix) : prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    return copy;
  }

  function cloneLineForVersion(line, newVersionId, idFactory) {
    const copy = withFreshId(line, "li", idFactory);
    copy.quote_version_id = newVersionId;
    return copy;
  }

  function cloneGroupForVersion(group, newVersionId, idFactory) {
    const copy = withFreshId(group, "og", idFactory);
    copy.quote_version_id = newVersionId;
    return copy;
  }

  // ---- snapshot minting at freeze (roadmap task 17) -------------------------

  const MINT_SOURCE = "manual";

  // The manual price snapshot minted for a hand-priced line at freeze: it
  // captures the line's own cost/sell as the source payload, so a sent version
  // never carries a line whose price has no provenance.
  function manualSnapshotInput(line, opts) {
    opts = opts || {};
    line = line || {};
    return {
      source: opts.source || MINT_SOURCE,
      distributor_sku: line.sku || "",
      manufacturer_part_number: line.manufacturer_part_number || "",
      unit_cost_cents: Number.isSafeInteger(line.unit_cost_cents) ? line.unit_cost_cents : 0,
      list_price_cents: Number.isSafeInteger(line.unit_sell_cents) ? line.unit_sell_cents : 0,
      quantity_available: Number.isSafeInteger(line.quantity) ? Math.max(0, line.quantity) : 0,
      warehouse: opts.warehouse || "",
      currency: line.currency || undefined,
      captured_at: opts.at || undefined,
      raw_response: {
        note: "Manual line captured at freeze; provenance minted from the frozen line.",
        line_id: line.id,
        description: line.description || "",
        kind: line.kind || null,
        quantity: line.quantity,
        unit_cost_cents: line.unit_cost_cents,
        unit_sell_cents: line.unit_sell_cents
      }
    };
  }

  // ---- the service ---------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_VERSIONS needs a document store with loadDoc/saveChecked.");
    }
    const audit = opts.audit || null;
    const priceSnapshots = opts.priceSnapshots || null;
    const clock = opts.clock || null;
    const rand = opts.rand || null;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;

    let frozenIds = new Set();
    let loaded = false;
    let unregisterGuard = null;
    let serverCheck = null;      // async ({module, previous, next, frozen_ids}) -> {ok, code, detail}
    let serverRegister = null;   // async ({version, seal}) -> {ok, code, detail}
    let serverVerify = null;     // async ({id, seal}) -> {ok, code, detail}

    function guard(module, content, previous) {
      if (GUARDED_DOCS.indexOf(module) === -1) return null;
      const res = immutability({ module, previous: previous === undefined ? null : previous, next: content, frozenVersionIds: frozenIds });
      if (!res.ok) return { ok: false, code: res.code, detail: res.detail, violations: res.violations };
      return null;
    }
    if (typeof store.registerGuard === "function") unregisterGuard = store.registerGuard(guard);

    async function loadDoc(doc) {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    async function mutate(doc, fn) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await loadDoc(doc);
        if (!l.ok) return l;
        const next = fn(l.records.slice());
        if (next === null) return { ok: true, noop: true, revision: l.revision, records: l.records };
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, records: next, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "version_conflict", detail: `Could not write the ${doc} document after ${maxRetries + 1} attempts.` };
    }

    async function refreshFrozen() {
      const l = await loadDoc(DOC_VERSIONS);
      if (!l.ok) return l;
      frozenIds = new Set();
      l.records.forEach(r => { if (isFrozen(r)) frozenIds.add(String(r.id)); });
      loaded = true;
      return { ok: true, ids: Array.from(frozenIds) };
    }

    function frozenVersionIds() {
      return Array.from(frozenIds);
    }

    async function listVersions(quoteId) {
      const l = await loadDoc(DOC_VERSIONS);
      if (!l.ok) return l;
      let records = l.records;
      if (quoteId !== undefined && quoteId !== null) records = records.filter(r => r.quote_id === quoteId);
      records = records.slice().sort((a, b) => (a.version_number || 0) - (b.version_number || 0));
      return { ok: true, versions: records, revision: l.revision };
    }

    async function getVersion(id) {
      const l = await loadDoc(DOC_VERSIONS);
      if (!l.ok) return l;
      return { ok: true, version: l.records.find(r => r && r.id === id) || null, revision: l.revision };
    }

    async function listLines(versionId) {
      const l = await loadDoc(DOC_LINES);
      if (!l.ok) return l;
      const lines = l.records.filter(r => r && r.quote_version_id === versionId)
        .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.id).localeCompare(String(b.id)));
      return { ok: true, lines, revision: l.revision };
    }

    async function listGroups(versionId) {
      const l = await loadDoc(DOC_GROUPS);
      if (!l.ok) return l;
      const groups = l.records.filter(r => r && r.quote_version_id === versionId)
        .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.id).localeCompare(String(b.id)));
      return { ok: true, groups, revision: l.revision };
    }

    async function isFrozenVersion(id) {
      const g = await getVersion(id);
      if (!g.ok) return g;
      return { ok: true, frozen: isFrozen(g.version), version: g.version };
    }

    // The service-level guard for its own mutators.
    async function requireMutable(versionId) {
      const g = await getVersion(versionId);
      if (!g.ok) return g;
      if (!g.version) return { ok: false, code: "version_not_found", detail: `No quote version ${versionId}.` };
      if (isFrozen(g.version)) {
        return { ok: false, code: "frozen_version_immutable", detail: `Version ${versionId} was frozen at ${g.version.frozen_at} and can never be changed. Revise it into a new version instead.`, version: g.version };
      }
      return { ok: true, version: g.version };
    }

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      return audit.append(input);
    }

    async function createVersion(input) {
      input = input || {};
      let record;
      try {
        record = normalize(input, { clock, rand });
      } catch (e) {
        return { ok: false, code: e.code || "bad_version", detail: e.message, violations: e.meta && e.meta.violations };
      }
      // A version is never born frozen; freeze is a deliberate, separate act.
      record.frozen_at = null;
      record.frozen_by = null;
      record.frozen_state = null;
      record.frozen_seal = null;
      if (input.version_number === undefined || input.version_number === null) {
        const l = await listVersions(record.quote_id);
        if (l.ok && l.versions.length) record.version_number = Math.max.apply(null, l.versions.map(v => v.version_number || 0)) + 1;
      }
      const res = await mutate(DOC_VERSIONS, records => records.concat([record]));
      if (!res.ok) return res;
      await auditAppend({
        quote_id: record.quote_id, version_id: record.id, event: "created",
        actor_type: input.actor ? "internal" : "system", actor: input.actor || "system",
        detail: { kind: "version", version_number: record.version_number, state: record.state }
      });
      return { ok: true, version: record, revision: res.revision };
    }

    async function updateVersion(id, patch) {
      const mutable = await requireMutable(id);
      if (!mutable.ok) return mutable;
      patch = stripFreezeFields(patch);
      let merged;
      try {
        merged = normalize(Object.assign({}, mutable.version, patch, { id: mutable.version.id, frozen_at: mutable.version.frozen_at, frozen_by: mutable.version.frozen_by, frozen_state: mutable.version.frozen_state, frozen_seal: mutable.version.frozen_seal, updated_at: nowIso(clock) }), { clock, rand });
      } catch (e) {
        return { ok: false, code: e.code || "bad_version", detail: e.message, violations: e.meta && e.meta.violations };
      }
      let updated = null;
      const res = await mutate(DOC_VERSIONS, records => records.map(r => {
        if (!r || r.id !== id) return r;
        updated = merged;
        return merged;
      }));
      if (!res.ok) return res;
      if (!updated) return { ok: false, code: "version_not_found", detail: `No quote version ${id}.` };
      return { ok: true, version: updated, revision: res.revision };
    }

    // ---- line items ----

    async function addLine(versionId, input) {
      const mutable = await requireMutable(versionId);
      if (!mutable.ok) return mutable;
      const LI = window.QU_LINEITEMS;
      if (!LI) return { ok: false, code: "no_lineitems", detail: "QU_LINEITEMS is not loaded." };
      const l = await listLines(versionId);
      if (!l.ok) return l;
      const defaultOrder = l.lines.length ? Math.max.apply(null, l.lines.map(x => x.sort_order || 0)) + 1 : 0;
      let line;
      try {
        line = LI.normalize(Object.assign({ sort_order: defaultOrder }, input, { quote_version_id: versionId }), { rand });
      } catch (e) {
        return { ok: false, code: e.code || "bad_line_item", detail: e.message, violations: e.meta && e.meta.violations };
      }
      const res = await mutate(DOC_LINES, records => records.concat([line]));
      if (!res.ok) return res;
      return { ok: true, line, revision: res.revision };
    }

    async function updateLine(versionId, lineId, patch) {
      const mutable = await requireMutable(versionId);
      if (!mutable.ok) return mutable;
      const LI = window.QU_LINEITEMS;
      if (!LI) return { ok: false, code: "no_lineitems", detail: "QU_LINEITEMS is not loaded." };
      const l = await listLines(versionId);
      if (!l.ok) return l;
      const existing = l.lines.find(x => x.id === lineId);
      if (!existing) return { ok: false, code: "line_not_found", detail: `No line ${lineId} on version ${versionId}.` };
      const clean = Object.assign({}, patch);
      delete clean.quote_version_id;
      delete clean.id;
      let merged;
      try {
        merged = LI.normalize(Object.assign({}, existing, clean, { id: existing.id, quote_version_id: versionId }), { rand });
      } catch (e) {
        return { ok: false, code: e.code || "bad_line_item", detail: e.message, violations: e.meta && e.meta.violations };
      }
      let updated = null;
      const res = await mutate(DOC_LINES, records => records.map(r => {
        if (!r || r.id !== lineId) return r;
        updated = merged;
        return merged;
      }));
      if (!res.ok) return res;
      return { ok: true, line: updated, revision: res.revision };
    }

    async function removeLine(versionId, lineId) {
      const mutable = await requireMutable(versionId);
      if (!mutable.ok) return mutable;
      const res = await mutate(DOC_LINES, records => {
        const found = records.some(r => r && r.id === lineId && r.quote_version_id === versionId);
        if (!found) return null;
        return records.filter(r => !(r && r.id === lineId));
      });
      if (!res.ok) return res;
      if (res.noop) return { ok: false, code: "line_not_found", detail: `No line ${lineId} on version ${versionId}.` };
      return { ok: true, revision: res.revision };
    }

    async function reorderLines(versionId, orderedIds) {
      const mutable = await requireMutable(versionId);
      if (!mutable.ok) return mutable;
      if (!Array.isArray(orderedIds)) return { ok: false, code: "bad_order", detail: "orderedIds must be an array of line ids." };
      const position = new Map();
      orderedIds.forEach((id, i) => position.set(String(id), i));
      const res = await mutate(DOC_LINES, records => records.map(r => {
        if (!r || r.quote_version_id !== versionId) return r;
        if (!position.has(String(r.id))) return r;
        return Object.assign({}, r, { sort_order: position.get(String(r.id)) });
      }));
      if (!res.ok) return res;
      return { ok: true, revision: res.revision };
    }

    // ---- option groups ----

    async function addGroup(versionId, input) {
      const mutable = await requireMutable(versionId);
      if (!mutable.ok) return mutable;
      const OG = window.QU_OPTIONGROUPS;
      if (!OG) return { ok: false, code: "no_optiongroups", detail: "QU_OPTIONGROUPS is not loaded." };
      const g = await listGroups(versionId);
      if (!g.ok) return g;
      const defaultOrder = g.groups.length ? Math.max.apply(null, g.groups.map(x => x.sort_order || 0)) + 1 : 0;
      let group;
      try {
        group = OG.normalize(Object.assign({ sort_order: defaultOrder }, input, { quote_version_id: versionId }), { rand });
      } catch (e) {
        return { ok: false, code: e.code || "bad_option_group", detail: e.message, violations: e.meta && e.meta.violations };
      }
      const res = await mutate(DOC_GROUPS, records => records.concat([group]));
      if (!res.ok) return res;
      return { ok: true, group, revision: res.revision };
    }

    async function updateGroup(versionId, groupId, patch) {
      const mutable = await requireMutable(versionId);
      if (!mutable.ok) return mutable;
      const OG = window.QU_OPTIONGROUPS;
      if (!OG) return { ok: false, code: "no_optiongroups", detail: "QU_OPTIONGROUPS is not loaded." };
      const g = await listGroups(versionId);
      if (!g.ok) return g;
      const existing = g.groups.find(x => x.id === groupId);
      if (!existing) return { ok: false, code: "group_not_found", detail: `No option group ${groupId} on version ${versionId}.` };
      const clean = Object.assign({}, patch);
      delete clean.quote_version_id;
      delete clean.id;
      let merged;
      try {
        merged = OG.normalize(Object.assign({}, existing, clean, { id: existing.id, quote_version_id: versionId }), { rand });
      } catch (e) {
        return { ok: false, code: e.code || "bad_option_group", detail: e.message, violations: e.meta && e.meta.violations };
      }
      let updated = null;
      const res = await mutate(DOC_GROUPS, records => records.map(r => {
        if (!r || r.id !== groupId) return r;
        updated = merged;
        return merged;
      }));
      if (!res.ok) return res;
      return { ok: true, group: updated, revision: res.revision };
    }

    async function removeGroup(versionId, groupId) {
      const mutable = await requireMutable(versionId);
      if (!mutable.ok) return mutable;
      const res = await mutate(DOC_GROUPS, records => {
        const found = records.some(r => r && r.id === groupId && r.quote_version_id === versionId);
        if (!found) return null;
        return records.filter(r => !(r && r.id === groupId));
      });
      if (!res.ok) return res;
      if (res.noop) return { ok: false, code: "group_not_found", detail: `No option group ${groupId} on version ${versionId}.` };
      return { ok: true, revision: res.revision };
    }

    // ---- freeze ----

    // Complete price provenance before a version is frozen (roadmap task 17):
    // every hand-priced line (no price_snapshot_ref) gets a minted manual
    // price_snapshot, and the line is backfilled to point at it. Idempotent —
    // lines that already carry a snapshot are left alone, so a retry after a
    // partial mint only fills the gaps.
    async function mintSnapshots(versionId, ctx) {
      ctx = ctx || {};
      if (!priceSnapshots) {
        return { ok: false, code: "no_pricesnapshots", detail: "QU_VERSIONS was created without a price-snapshot service; hand-priced lines cannot be given provenance." };
      }
      const g = await getVersion(versionId);
      if (!g.ok) return g;
      if (!g.version) return { ok: false, code: "version_not_found", detail: `No quote version ${versionId}.` };
      if (isFrozen(g.version)) return { ok: false, code: "frozen", detail: "Cannot mint snapshots into a frozen version — a frozen version is immutable (invariant I1)." };
      const l = await listLines(versionId);
      if (!l.ok) return l;
      const targets = l.lines.filter(x => x && !x.price_snapshot_ref);
      const minted = [];
      const errors = [];
      for (const line of targets) {
        const cap = await priceSnapshots.capture(manualSnapshotInput(line, { at: ctx.at, source: ctx.source, warehouse: ctx.warehouse }));
        if (!cap.ok) { errors.push({ line_id: line.id, code: cap.code, detail: cap.detail }); continue; }
        const up = await updateLine(versionId, line.id, { price_snapshot_ref: cap.snapshot.id, pricing_mode: "snapshot" });
        if (!up.ok) { errors.push({ line_id: line.id, code: up.code, detail: up.detail }); continue; }
        minted.push({ line_id: line.id, snapshot_id: cap.snapshot.id, deduped: !!cap.deduped });
      }
      return { ok: errors.length === 0, minted, count: minted.length, errors, line_count: l.lines.length };
    }

    async function freeze(versionId, ctx) {
      ctx = ctx || {};
      const g = await getVersion(versionId);
      if (!g.ok) return g;
      if (!g.version) return { ok: false, code: "version_not_found", detail: `No quote version ${versionId}.` };
      if (isFrozen(g.version)) return { ok: false, code: "already_frozen", detail: `Version ${versionId} is already frozen.`, version: g.version };

      // Task 17: give every hand-priced line its price provenance first.
      let mint = null;
      if (priceSnapshots && ctx.mintSnapshots !== false) {
        mint = await mintSnapshots(versionId, { at: ctx.at, source: ctx.mintSource, warehouse: ctx.mintWarehouse });
        if (!mint.ok) {
          const first = (mint.errors && mint.errors[0]) || null;
          return {
            ok: false,
            code: mint.code || "mint_failed",
            detail: "Could not complete price provenance for hand-priced lines: " + ((first && first.detail) || mint.detail || "unknown error") + ". The version was not frozen.",
            mint
          };
        }
      }

      let frozen;
      try {
        frozen = freezeVersion(g.version, { at: ctx.at, actor: ctx.actor, clock });
      } catch (e) {
        return { ok: false, code: e.code || "freeze_failed", detail: e.message };
      }
      const lines = await listLines(versionId);
      const groups = await listGroups(versionId);
      if (!lines.ok) return lines;
      if (!groups.ok) return groups;
      // Seal the frozen record itself (frozen_at/by/state + updated_at included,
      // frozen_seal excluded) so verify()'s re-seal of the stored record matches.
      const seal = sealBundle(frozen, lines.lines, groups.groups);
      frozen.frozen_seal = seal;

      // The authoritative server keeps the id→seal map; a server refusal stops
      // the freeze (fail closed), and an unreachable server degrades to local.
      let authority = "local";
      if (serverRegister) {
        try {
          const sres = await serverRegister({ version: versionSummary(frozen), seal });
          if (sres && sres.ok === false) {
            return { ok: false, code: sres.code || "server_refused", detail: sres.detail || "The server refused to freeze this version.", authority: "server" };
          }
          authority = "server";
        } catch (e) {
          authority = "local";
        }
      }

      let written = null;
      const res = await mutate(DOC_VERSIONS, records => records.map(r => {
        if (!r || r.id !== versionId) return r;
        written = frozen;
        return frozen;
      }));
      if (!res.ok) return res;
      await refreshFrozen();
      await auditAppend({
        quote_id: frozen.quote_id, version_id: frozen.id, event: "revised",
        actor_type: "internal", actor: frozen.frozen_by || "system",
        detail: { action: "frozen", frozen_state: frozen.frozen_state, seal }
      });
      return { ok: true, version: written || frozen, seal, authority, revision: res.revision, mint };
    }

    // ---- revise ----

    async function revise(versionId, ctx) {
      ctx = ctx || {};
      const g = await getVersion(versionId);
      if (!g.ok) return g;
      if (!g.version) return { ok: false, code: "version_not_found", detail: `No quote version ${versionId}.` };
      if (!isFrozen(g.version)) {
        return { ok: false, code: "not_frozen", detail: "Only a frozen/sent version is revised into a new version — edit the draft directly. (Invariant I1.)" };
      }
      const source = g.version;
      const allVersions = await listVersions(source.quote_id);
      if (!allVersions.ok) return allVersions;
      const nextNumber = allVersions.versions.length ? Math.max.apply(null, allVersions.versions.map(v => v.version_number || 0)) + 1 : (source.version_number || 1) + 1;

      const newId = genId(rand);
      const carried = {};
      REVISION_CARRY.forEach(k => { if (source[k] !== undefined) carried[k] = source[k]; });
      const revision = normalize(Object.assign(carried, {
        id: newId,
        quote_id: source.quote_id,
        version_number: nextNumber,
        state: "draft",
        revised_from: source.id,
        created_by: ctx.actor !== undefined ? ctx.actor : source.created_by
      }), { clock, rand });
      revision.frozen_at = null;
      revision.frozen_by = null;
      revision.frozen_state = null;
      revision.frozen_seal = null;

      const vres = await mutate(DOC_VERSIONS, records => records.concat([revision]));
      if (!vres.ok) return vres;

      const srcLines = await listLines(source.id);
      const srcGroups = await listGroups(source.id);
      if (!srcLines.ok) return srcLines;
      if (!srcGroups.ok) return srcGroups;
      const idFactory = p => (p === "li" ? window.QU_LINEITEMS.genId(rand) : window.QU_OPTIONGROUPS.genId(rand));
      const newLines = srcLines.lines.map(line => cloneLineForVersion(line, newId, idFactory));
      const newGroups = srcGroups.groups.map(group => cloneGroupForVersion(group, newId, idFactory));

      if (newGroups.length) {
        const gres = await mutate(DOC_GROUPS, records => records.concat(newGroups));
        if (!gres.ok) return { ok: false, code: gres.code, detail: `${gres.detail} The new version ${newId} exists but its option groups did not copy — re-run the revision.`, partial: true, version: revision };
      }
      if (newLines.length) {
        const lres = await mutate(DOC_LINES, records => records.concat(newLines));
        if (!lres.ok) return { ok: false, code: lres.code, detail: `${lres.detail} The new version ${newId} exists but its line items did not copy — re-run the revision.`, partial: true, version: revision };
      }
      await auditAppend({
        quote_id: revision.quote_id, version_id: newId, event: "revised",
        actor_type: "internal", actor: (ctx.actor !== undefined ? ctx.actor : "system") || "system",
        detail: { revised_from: source.id, version_number: nextNumber, line_count: newLines.length, group_count: newGroups.length }
      });
      return { ok: true, version: revision, lines: newLines, groups: newGroups, revised_from: source.id };
    }

    // ---- views ----

    async function totals(versionId, selection) {
      const lines = await listLines(versionId);
      const groups = await listGroups(versionId);
      if (!lines.ok) return lines;
      if (!groups.ok) return groups;
      const TOT = window.QU_TOTALS;
      if (!TOT) return { ok: false, code: "no_totals", detail: "QU_TOTALS is not loaded." };
      return { ok: true, totals: TOT.computeTotals({ line_items: lines.lines, option_groups: groups.groups, selection }), lines: lines.lines, groups: groups.groups };
    }

    async function clientView(versionId, selection, extra) {
      const g = await getVersion(versionId);
      if (!g.ok) return g;
      if (!g.version) return { ok: false, code: "version_not_found", detail: `No quote version ${versionId}.` };
      const lines = await listLines(versionId);
      const groups = await listGroups(versionId);
      if (!lines.ok) return lines;
      if (!groups.ok) return groups;
      const PV = window.QU_PORTALVIEW;
      if (!PV) return { ok: false, code: "no_portalview", detail: "QU_PORTALVIEW is not loaded." };
      const view = PV.serialize(Object.assign({
        quote: (extra && extra.quote) || null,
        version: g.version,
        line_items: lines.lines,
        option_groups: groups.groups,
        selection
      }, extra || {}));
      return { ok: true, view, version: g.version, lines: lines.lines, groups: groups.groups };
    }

    // ---- verify ----

    async function verify() {
      const versions = await listVersions();
      const lines = await loadDoc(DOC_LINES);
      const groups = await loadDoc(DOC_GROUPS);
      if (!versions.ok) return versions;
      if (!lines.ok) return lines;
      if (!groups.ok) return groups;
      const breaks = [];
      const frozen = versions.versions.filter(isFrozen);
      frozen.forEach(v => {
        if (!v.frozen_seal) {
          breaks.push({ id: v.id, code: "unsealed", detail: `Frozen version ${v.id} carries no seal.` });
          return;
        }
        const vLines = lines.records.filter(r => r && r.quote_version_id === v.id);
        const vGroups = groups.records.filter(r => r && r.quote_version_id === v.id);
        const recomputed = sealBundle(v, vLines, vGroups);
        if (recomputed !== v.frozen_seal) {
          breaks.push({ id: v.id, code: "frozen_changed", detail: `Frozen version ${v.id} no longer matches its freeze seal — it was modified.` });
        }
      });
      return { ok: breaks.length === 0, count: frozen.length, breaks, frozen_ids: frozen.map(v => v.id) };
    }

    // Cross-check the local seals against the authoritative server registry.
    async function verifyAgainstServer() {
      if (!serverVerify) return { ok: true, skipped: true, detail: "no server validator attached" };
      const versions = await listVersions();
      if (!versions.ok) return versions;
      const diffs = [];
      for (const v of versions.versions) {
        if (!isFrozen(v) || !v.frozen_seal) continue;
        try {
          const res = await serverVerify({ id: v.id, seal: v.frozen_seal });
          if (res && res.ok === false) diffs.push({ id: v.id, code: res.code || "server_seal_mismatch", detail: res.detail });
        } catch (e) {
          diffs.push({ id: v.id, code: "server_unreachable", detail: (e && e.message) || String(e) });
        }
      }
      return { ok: diffs.length === 0, diffs };
    }

    function attachServerCheck(fn) { serverCheck = typeof fn === "function" ? fn : null; }
    function attachServerRegister(fn) { serverRegister = typeof fn === "function" ? fn : null; }
    function attachServerVerify(fn) { serverVerify = typeof fn === "function" ? fn : null; }

    function dispose() {
      if (unregisterGuard) unregisterGuard();
      unregisterGuard = null;
    }

    function ready() {
      return refreshFrozen();
    }

    return {
      ready,
      dispose,
      refreshFrozen,
      frozenVersionIds,
      isFrozenVersion,
      listVersions,
      getVersion,
      listLines,
      listGroups,
      createVersion,
      updateVersion,
      addLine,
      updateLine,
      removeLine,
      reorderLines,
      addGroup,
      updateGroup,
      removeGroup,
      freeze,
      mintSnapshots,
      revise,
      totals,
      clientView,
      verify,
      verifyAgainstServer,
      attachServerCheck,
      attachServerRegister,
      attachServerVerify,
      get loaded() { return loaded; }
    };
  }

  return {
    VERSION,
    DOC_VERSIONS,
    DOC_LINES,
    DOC_GROUPS,
    GUARDED_DOCS,
    VERSION_FIELDS,
    MODEL_FIELD_NAMES: VERSION_FIELDS.map(f => f.name),
    FREEZE_FIELDS,
    REVISION_CARRY,
    VersionError,
    genId,
    isFrozen,
    normalize,
    validate,
    freezeVersion,
    stripFreezeFields,
    sealOf,
    sealBundle,
    versionSummary,
    immutability,
    assertImmutable,
    cloneLineForVersion,
    cloneGroupForVersion,
    MINT_SOURCE,
    manualSnapshotInput,
    createService
  };
})();
