// ============================================================================
// quote-u — external field-map registry & capture verification (roadmap task 49)
// ----------------------------------------------------------------------------
// Every field we read from (or write to) an external system is a MAPPING, and a
// mapping is never guessed: before a connector may be enabled its mapping must
// be verified against a CAPTURED payload — a real sample of what the external
// system actually sends. The registry holds the declaration (which canonical
// field each wire name resolves to); `verifyCapture` proves the declaration
// against a captured sample by requiring every REQUIRED declared field to
// actually appear in it (optional fields a given capture does not carry are
// recorded as absent, not treated as failures), and records the evidence (the
// capture reference, when it was verified, and how many fields matched). A
// mapping that has not been verified this way is `mapping_not_verified` and
// cannot be enabled.
//
// The declarations are derived from the same `SCHEMA` the normalizer uses
// (QU_DISTRIBUTORS.SCHEMA for the distributor wire shapes), so the map and the
// code that consumes it can never drift: both come from one declaration.
// ============================================================================
window.QU_FIELDMAPS = (function () {
  "use strict";

  const VERSION = "1.0.0";

  class FieldMapError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "FieldMapError";
      this.code = code;
    }
  }
  function fail(code, message) { throw new FieldMapError(code, message); }

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function normWire(list) {
    return (Array.isArray(list) ? list : []).map(String).map(s => s.trim()).filter(Boolean);
  }

  // Normalize one declaration: a mapping of canonical fields to the wire names
  // (aliases) that carry them, for one connector function and direction.
  function declare(spec) {
    spec = spec || {};
    const id = String(spec.id || (String(spec.connector || "") + "." + String(spec.fn || "") + "." + (spec.direction || "in")));
    if (!id || id === "..") fail("bad_mapping", "A field map needs an id (or a connector + fn).");
    const direction = spec.direction === "out" ? "out" : "in";
    const fields = (Array.isArray(spec.fields) ? spec.fields : []).map(f => {
      f = f || {};
      const canonical = String(f.canonical || f.field || "").trim();
      if (!canonical) fail("bad_field", `A field map field needs a canonical name (${id}).`);
      const wire = normWire(f.wire || f.aliases).concat(normWire(f.cents_aliases));
      if (!wire.length) fail("bad_field", `The field "${canonical}" needs at least one wire name (${id}).`);
      return { canonical, wire, required: f.required === true, type: f.type ? String(f.type) : "string" };
    });
    if (!fields.length) fail("bad_mapping", `The field map "${id}" declares no fields.`);
    return {
      id,
      connector: String(spec.connector || ""),
      fn: String(spec.fn || ""),
      direction,
      description: spec.description ? String(spec.description) : "",
      fields,
      verified: null
    };
  }

  // Build a declaration (direction "in") from a distributor-style SCHEMA. This
  // is the SAME schema the normalizer consumes, so the map cannot drift from
  // the parser.
  function declareFromSchema(schema, spec) {
    spec = spec || {};
    const fields = (Array.isArray(schema) ? schema : []).map(s => ({
      canonical: s.field,
      wire: normWire(s.aliases).concat(normWire(s.cents_aliases)),
      required: s.required === true,
      type: s.type
    }));
    return declare({
      id: spec.id || (String(spec.connector || "") + "." + String(spec.fn || "read") + ".in"),
      connector: spec.connector,
      fn: spec.fn,
      direction: "in",
      description: spec.description || "canonical record, derived from the shared SCHEMA",
      fields
    });
  }

  function createRegistry(opts) {
    opts = opts || {};
    const maps = new Map();
    const list = () => Array.from(maps.values());
    const get = id => maps.get(String(id)) || null;

    function add(spec) {
      const m = declare(spec);
      maps.set(m.id, m);
      return m;
    }

    function addAll(specs) { return (Array.isArray(specs) ? specs : []).map(add); }

    function missingFields(map, payload, opts) {
      opts = opts || {};
      const keys = new Set(Object.keys(isPlainObject(payload) ? payload : {}));
      const requireAll = opts.require_all === true || opts.all_wires === true;
      const missing = [];
      const absent = [];
      const matched = [];
      map.fields.forEach(f => {
        const hits = f.wire.filter(w => keys.has(w));
        // A field is PRESENT if any of its wire aliases appears. Only a field
        // declared `required` (or every field under `require_all`) is a hard
        // MISSING; an optional field that a given capture simply does not carry
        // is recorded as `absent` and does not fail the proof.
        const hardRequired = f.required === true || requireAll;
        if (hits.length > 0) matched.push({ canonical: f.canonical, wire: hits[0] || null, aliases: f.wire });
        else if (hardRequired) missing.push({ canonical: f.canonical, wire: f.wire, required: true });
        else absent.push({ canonical: f.canonical, wire: f.wire, required: false });
      });
      return { missing, absent, matched, keys: Array.from(keys) };
    }

    // Prove a mapping against a captured payload and record the evidence.
    function verifyCapture(id, payload, opts) {
      opts = opts || {};
      const m = get(id);
      if (!m) return { ok: false, code: "unknown_mapping", detail: `No field map "${id}".` };
      if (!isPlainObject(payload)) return { ok: false, code: "bad_capture", detail: "A captured payload must be an object." };
      const res = missingFields(m, payload, opts);
      const known = new Set();
      m.fields.forEach(f => f.wire.forEach(w => known.add(w)));
      const extra = res.keys.filter(k => !known.has(k));
      if (res.missing.length) {
        return {
          ok: false, code: "capture_mismatch",
          detail: `${res.missing.length} required field(s) did not appear in the captured payload: ${res.missing.map(x => x.canonical + " (" + x.wire.join("/") + ")").join(", ")}.`,
          missing: res.missing, absent: res.absent, matched: res.matched, extra_keys: extra, map: m.id
        };
      }
      m.verified = {
        by_capture: true,
        captured_at: opts.captured_at ? String(opts.captured_at) : new Date().toISOString(),
        verified_at: new Date().toISOString(),
        payload_ref: opts.payload_ref ? String(opts.payload_ref) : (opts.source ? String(opts.source) : "captured payload"),
        field_count: m.fields.length,
        matched_count: res.matched.length,
        sample_keys: res.keys.slice(),
        absent: res.absent.map(x => x.canonical),
        extra_keys: extra
      };
      return { ok: true, map: m.id, verified: m.verified, matched: res.matched, absent: res.absent, extra_keys: extra };
    }

    function isVerified(id) { const m = get(id); return !!(m && m.verified && m.verified.by_capture); }
    function verified() { return list().filter(m => m.verified && m.verified.by_capture).map(summarize); }
    function unverified() { return list().filter(m => !(m.verified && m.verified.by_capture)).map(summarize); }

    // The enablement gate: a mapping may not be enabled until it has been
    // verified by a live capture.
    function assertVerified(id) {
      const m = get(id);
      if (!m) return { ok: false, code: "unknown_mapping", detail: `No field map "${id}".` };
      if (!m.verified || !m.verified.by_capture) {
        return { ok: false, code: "mapping_not_verified", detail: `The field map "${id}" has not been verified against a captured payload; a guessed mapping may never be enabled.` };
      }
      return { ok: true, id: m.id, verified: m.verified };
    }

    function enablement() {
      const blocked = unverified().map(m => m.id);
      return { ok: blocked.length === 0, blocked, ready: list().length - blocked.length, total: list().length };
    }

    function verify() {
      const bad = list().filter(m => !m.fields.length);
      const blocked = unverified();
      return {
        ok: bad.length === 0,
        violations: bad.map(m => ({ code: "empty_mapping", detail: `The field map "${m.id}" declares no fields.` })),
        unverified: blocked.map(m => m.id),
        verified: verified().map(m => m.id)
      };
    }

    function summarize(m) {
      return { id: m.id, connector: m.connector, fn: m.fn, direction: m.direction, field_count: m.fields.length, verified: m.verified ? Object.assign({}, m.verified) : null };
    }

    function snapshot() { return { maps: list().map(m => Object.assign({}, summarize(m), { fields: m.fields.map(f => Object.assign({}, f)) })) }; }

    return { add, addAll, declare, list, get, verifyCapture, missingFields, isVerified, verified, unverified, assertVerified, enablement, verify, snapshot };
  }

  // The app service: declarations derived from the distributor SCHEMA (the one
  // shared parser) plus any additional named mappings, verified from captures.
  function createService(opts) {
    opts = opts || {};
    const registry = createRegistry();
    const D = window.QU_DISTRIBUTORS;
    if (D && D.SCHEMA) {
      (opts.sources || [
        { connector: "distributor_a", fn: "searchCatalog" },
        { connector: "distributor_b", fn: "searchCatalog" },
        { connector: "distributor_a", fn: "getPrice" },
        { connector: "distributor_b", fn: "getPrice" }
      ]).forEach(s => registry.add(declareFromSchema(D.SCHEMA, { id: s.id || (s.connector + "." + s.fn + ".in"), connector: s.connector, fn: s.fn, description: opts.description })));
    }
    (opts.mappings || []).forEach(m => registry.add(m));

    async function ready() {
      return { ok: true, enablement: registry.enablement() };
    }

    return {
      ready,
      registry,
      list: () => registry.list(),
      get: id => registry.get(id),
      verifyCapture: (id, payload, o) => registry.verifyCapture(id, payload, o),
      assertVerified: id => registry.assertVerified(id),
      enablement: () => registry.enablement(),
      unverified: () => registry.unverified(),
      verified: () => registry.verified(),
      verify: () => registry.verify(),
      snapshot: () => registry.snapshot()
    };
  }

  return {
    VERSION,
    declare,
    declareFromSchema,
    createRegistry,
    createService
  };
})();
