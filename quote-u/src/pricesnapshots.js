// ============================================================================
// quote-u — manual pricing & immutable price snapshots (roadmap task 13)
// ----------------------------------------------------------------------------
// A price_snapshot is a captured price from a source (a distributor quote, a
// supplier feed, or a hand-entered manual price) taken at a moment in time. It
// is IMMUTABLE: once captured it carries a content hash sealing every field, a
// stored snapshot is never edited or deleted, and a line item references it by
// id. Its `raw_response` preserves the source payload byte-for-byte, so the
// provenance of any price on any quote is always reconstructible — long after
// the distributor's page has changed.
//
//   capture  → normalise + seal (pure; returns the record)
//   bind     → attach a snapshot to a line item (QU_LINEITEMS is the validator)
//   service  → persist into the `price_snapshots` document, dedupe identical
//              captures, and expose verify / age / staleness helpers
//
// Every monetary value is integer cents through QU_MONEY; the raw source
// payload is exempt from the money auditor (it preserves the source format).
// ============================================================================
window.QU_PRICESNAPSHOTS = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u price snapshots require window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const DOC = "price_snapshots";
  const DEFAULT_MAX_RETRIES = 4;
  const DEFAULT_STALE_DAYS = 7;

  const FIELDS = [
    { name: "id", required: false, generated: true, note: "stable snapshot id (what a line item references)" },
    { name: "source", required: true, note: "where the price came from (distributor / supplier / manual)" },
    { name: "distributor_sku", required: false, default: "", note: "source's own SKU" },
    { name: "manufacturer_part_number", required: false, default: "", note: "MPN" },
    { name: "unit_cost_cents", required: true, note: "integer cents; internal only" },
    { name: "list_price_cents", required: false, default: 0, note: "integer cents" },
    { name: "quantity_available", required: false, default: 0, note: "non-negative integer" },
    { name: "warehouse", required: false, default: "", note: "stocking location" },
    { name: "currency", required: false, default: M.DEFAULT_CURRENCY, note: "reserved currency column (v1: CAD)" },
    { name: "captured_at", required: true, note: "ISO timestamp of capture" },
    { name: "raw_response", required: false, default: null, note: "full source payload, preserved for audit" },
    { name: "hash", required: false, generated: true, note: "immutability seal over every other field" }
  ];

  class SnapshotError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "SnapshotError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) {
    throw new SnapshotError(code, message, meta);
  }

  function genId(rand) {
    return "snap-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function asString(value, name, violations) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string` });
      return "";
    }
    return value;
  }

  function asCents(value, name, def, violations) {
    if (value === undefined || value === null) return def;
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      if (violations) violations.push({ field: name, code: "fractional_cents", detail: `${name} must be integer cents, got ${value}` });
      return def;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be integer cents` });
      return def;
    }
    return value;
  }

  function asCount(value, name, def, violations) {
    const n = asCents(value, name, def, violations);
    if (typeof n === "number" && n < 0) {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a non-negative integer` });
      return 0;
    }
    return n;
  }

  // ---- hashing (deterministic, order-independent) ---------------------------

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

  function canonicalize(v) {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) if (v[k] !== undefined) parts.push(JSON.stringify(k) + ":" + canonicalize(v[k]));
    return "{" + parts.join(",") + "}";
  }

  function core(record) {
    const c = Object.assign({}, record);
    delete c.hash;
    return c;
  }

  // The identity-free content of a capture: everything the seal covers except
  // the generated id. Two captures of the same source payload (same content,
  // different generated ids) share a content hash, which is what the store
  // dedupes on.
  function contentCore(record) {
    const c = Object.assign({}, record);
    delete c.hash;
    delete c.id;
    return c;
  }

  // Prefer the audit module's canonicaliser/digest so a snapshot and the audit
  // log hash the same way; fall back to the local pair when the audit engine
  // isn't loaded.
  function digestOf(value) {
    const A = window.QU_AUDIT;
    if (A && typeof A.canonicalize === "function" && typeof A.localDigest === "function") {
      return A.localDigest(A.canonicalize(value));
    }
    return localDigest(canonicalize(value));
  }

  // The seal covers every field except the hash itself (id included).
  function hashOf(record) {
    return digestOf(core(record));
  }

  // The dedupe identity: the sealed content with the generated id removed.
  function contentHashOf(record) {
    return digestOf(contentCore(record));
  }

  function seal(record) {
    return Object.assign({}, record, { hash: hashOf(record) });
  }

  function verify(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { ok: false, code: "bad_snapshot", detail: "A snapshot must be an object." };
    }
    if (typeof record.hash !== "string" || !record.hash) {
      return { ok: false, code: "unsealed", detail: "This snapshot carries no immutability hash." };
    }
    const expected = hashOf(record);
    return {
      ok: expected === record.hash,
      code: expected === record.hash ? null : "snapshot_tampered",
      expected,
      actual: record.hash,
      detail: expected === record.hash ? "" : "This snapshot's contents no longer match its immutability hash."
    };
  }

  // ---- the snapshot record --------------------------------------------------

  function collect(input, opts) {
    opts = opts || {};
    const violations = [];
    if (!isPlainObject(input)) {
      return { violations: [{ field: null, code: "bad_snapshot", detail: "A price snapshot must be an object" }], record: null };
    }

    let id = input.id;
    if (id === undefined || id === null || id === "") id = opts.id || genId(opts.rand);
    else if (typeof id !== "string") {
      violations.push({ field: "id", code: "bad_id", detail: "id must be a string" });
      id = String(id);
    }

    const source = asString(input.source, "source", violations);
    if (!source.trim()) violations.push({ field: "source", code: "bad_source", detail: "A price snapshot needs a source." });

    const unitCost = asCents(input.unit_cost_cents, "unit_cost_cents", undefined, violations);
    if (unitCost === undefined) {
      violations.push({ field: "unit_cost_cents", code: "bad_unit_cost_cents", detail: "unit_cost_cents is required" });
    } else if (unitCost < 0) {
      violations.push({ field: "unit_cost_cents", code: "negative_cost", detail: "unit_cost_cents cannot be negative" });
    }

    let currency = input.currency === undefined || input.currency === null || input.currency === "" ? M.DEFAULT_CURRENCY : input.currency;
    try {
      currency = M.normalizeCurrency(currency);
    } catch (e) {
      violations.push({ field: "currency", code: "bad_currency", detail: (e && e.message) || String(e) });
      currency = M.DEFAULT_CURRENCY;
    }

    const capturedAt = input.captured_at === undefined || input.captured_at === null || input.captured_at === ""
      ? nowIso(opts.clock)
      : input.captured_at;
    if (typeof capturedAt !== "string" || isNaN(Date.parse(capturedAt))) {
      violations.push({ field: "captured_at", code: "bad_captured_at", detail: "captured_at must be an ISO timestamp" });
    }

    const listPrice = asCents(input.list_price_cents, "list_price_cents", 0, violations);
    if (typeof listPrice === "number" && listPrice < 0) violations.push({ field: "list_price_cents", code: "negative_price", detail: "list_price_cents cannot be negative" });

    const record = {
      id,
      source,
      distributor_sku: asString(input.distributor_sku, "distributor_sku", violations),
      manufacturer_part_number: asString(input.manufacturer_part_number, "manufacturer_part_number", violations),
      unit_cost_cents: unitCost === undefined ? 0 : unitCost,
      list_price_cents: listPrice,
      quantity_available: asCount(input.quantity_available, "quantity_available", 0, violations),
      warehouse: asString(input.warehouse, "warehouse", violations),
      currency,
      captured_at: typeof capturedAt === "string" ? capturedAt : String(capturedAt),
      raw_response: input.raw_response === undefined ? null : input.raw_response
    };

    Object.keys(input).forEach(k => {
      if (k === "hash") return;
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

  // Pure capture: normalise then seal. Throws on malformed input.
  function capture(input, opts) {
    return seal(normalize(input, opts));
  }

  // Non-throwing capture: { ok, snapshot } or { ok:false, code, violations }.
  function tryCapture(input, opts) {
    const v = validate(input, opts);
    if (!v.ok) return { ok: false, code: v.violations[0].code, violations: v.violations, detail: v.violations[0].detail };
    return { ok: true, snapshot: seal(v.record) };
  }

  // ---- binding a line item to its snapshot ----------------------------------

  function idOf(snapshotOrId) {
    if (typeof snapshotOrId === "string") return snapshotOrId;
    if (snapshotOrId && snapshotOrId.id) return String(snapshotOrId.id);
    return null;
  }

  // Attach a snapshot to a line: the line becomes snapshot-priced and points at
  // the snapshot. Validated through QU_LINEITEMS so the two modules cannot
  // drift.
  function bind(line, snapshotOrId) {
    const id = idOf(snapshotOrId);
    if (!id) fail("snapshot_required", "A snapshot-priced line needs a snapshot id.");
    const input = Object.assign({}, line, { price_snapshot_ref: id, pricing_mode: "snapshot" });
    const LI = window.QU_LINEITEMS;
    if (!LI || typeof LI.normalize !== "function") return input;
    return LI.normalize(input);
  }

  // Bind AND stamp the snapshot's cost onto the line, optionally computing the
  // sell price from a markup over that cost. Never mutates the input line.
  function applyCost(line, snapshot, opts) {
    opts = opts || {};
    const id = idOf(snapshot);
    if (!id) fail("snapshot_required", "A snapshot-priced line needs a snapshot.");
    const cost = snapshot.unit_cost_cents;
    M.assertCents(cost, "snapshot unit cost");
    const input = Object.assign({}, line, { unit_cost_cents: cost });
    if (opts.unit_sell_cents !== undefined) input.unit_sell_cents = opts.unit_sell_cents;
    else if (opts.markup_bp !== undefined) input.unit_sell_cents = M.add(cost, M.applyBp(cost, opts.markup_bp));
    return bind(input, snapshot);
  }

  // The reconstructible provenance of a price: everything needed to explain
  // where it came from, plus the sealed raw payload.
  function provenance(snapshot) {
    if (!snapshot) return null;
    return {
      id: snapshot.id,
      source: snapshot.source,
      distributor_sku: snapshot.distributor_sku,
      manufacturer_part_number: snapshot.manufacturer_part_number,
      unit_cost_cents: snapshot.unit_cost_cents,
      list_price_cents: snapshot.list_price_cents,
      quantity_available: snapshot.quantity_available,
      warehouse: snapshot.warehouse,
      currency: snapshot.currency,
      captured_at: snapshot.captured_at,
      hash: snapshot.hash || null,
      raw_response: snapshot.raw_response === undefined ? null : snapshot.raw_response
    };
  }

  // ---- age / staleness ------------------------------------------------------

  function ageDays(snapshot, now) {
    if (!snapshot || !snapshot.captured_at) return null;
    const then = Date.parse(snapshot.captured_at);
    if (isNaN(then)) return null;
    const at = now === undefined || now === null ? Date.now() : (typeof now === "number" ? now : Date.parse(now));
    if (isNaN(at)) return null;
    return (at - then) / 86400000;
  }

  function isStale(snapshot, opts) {
    opts = opts || {};
    const maxAgeDays = opts.maxAgeDays === undefined ? DEFAULT_STALE_DAYS : opts.maxAgeDays;
    const age = ageDays(snapshot, opts.now);
    if (age === null) return null;
    return age > maxAgeDays;
  }

  // ---- persistence (system-of-record document) ------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_PRICESNAPSHOTS needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DOC;
    const rand = opts.rand || null;
    const clock = opts.clock || null;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;
    const pureCapture = capture;

    async function loadSnapshots() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    async function mutate(fn) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await loadSnapshots();
        if (!l.ok) return l;
        const next = fn(l.records.slice());
        if (next === null) return { ok: true, noop: true, revision: l.revision, records: l.records };
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, records: next, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "snapshot_conflict", detail: `Could not write the price-snapshot document after ${maxRetries + 1} attempts.` };
    }

    // Capture and persist. Identical captures (same seal) are deduped: the
    // already-stored immutable snapshot is returned instead of a second copy.
    async function captureAndStore(input) {
      let snapshot;
      try {
        snapshot = pureCapture(input, { rand, clock: clock || undefined });
      } catch (e) {
        return { ok: false, code: e.code || "bad_snapshot", detail: e.message, violations: e.meta && e.meta.violations };
      }
      const key = contentHashOf(snapshot);
      let existing = null;
      let deduped = false;
      const res = await mutate(records => {
        existing = null;
        const found = records.find(r => r && contentHashOf(r) === key);
        if (found) { existing = found; deduped = true; return null; }
        return records.concat([snapshot]);
      });
      if (!res.ok) return res;
      return { ok: true, snapshot: deduped ? existing : snapshot, revision: res.revision, created: !deduped, deduped };
    }

    async function get(id) {
      const l = await loadSnapshots();
      if (!l.ok) return l;
      return { ok: true, snapshot: l.records.find(r => r && r.id === id) || null, revision: l.revision };
    }

    async function list(filter) {
      filter = filter || {};
      const l = await loadSnapshots();
      if (!l.ok) return l;
      let records = l.records.slice();
      if (filter.source) records = records.filter(r => r.source === filter.source);
      if (filter.manufacturer_part_number) records = records.filter(r => r.manufacturer_part_number === filter.manufacturer_part_number);
      if (filter.distributor_sku) records = records.filter(r => r.distributor_sku === filter.distributor_sku);
      if (filter.warehouse) records = records.filter(r => r.warehouse === filter.warehouse);
      return { ok: true, snapshots: records, revision: l.revision };
    }

    // Bind a stored snapshot to a line item.
    async function bindLine(line, id) {
      const g = await get(id);
      if (!g.ok) return g;
      if (!g.snapshot) return { ok: false, code: "snapshot_not_found", detail: `No price snapshot ${id}.` };
      return { ok: true, line: bind(line, g.snapshot), snapshot: g.snapshot };
    }

    // Re-verify every stored snapshot's seal — immutability, proven on demand.
    async function verifyAll() {
      const l = await loadSnapshots();
      if (!l.ok) return l;
      const breaks = [];
      l.records.forEach((r, i) => {
        const v = verify(r);
        if (!v.ok) breaks.push({ index: i, id: r && r.id, code: v.code });
      });
      return { ok: breaks.length === 0, count: l.records.length, breaks, revision: l.revision };
    }

    // A snapshot is immutable: there is no update or delete path.
    async function update() {
      return { ok: false, code: "immutable", detail: "A price snapshot is immutable — capture a new snapshot instead of editing this one." };
    }
    async function remove() {
      return { ok: false, code: "immutable", detail: "A price snapshot is immutable and is referenced by lines — it can never be deleted." };
    }

    async function ageDaysOf(id, now) {
      const g = await get(id);
      if (!g.ok) return g;
      if (!g.snapshot) return { ok: false, code: "snapshot_not_found", detail: `No price snapshot ${id}.` };
      return { ok: true, age_days: ageDays(g.snapshot, now) };
    }

    async function isStaleSnapshot(id, o) {
      const g = await get(id);
      if (!g.ok) return g;
      if (!g.snapshot) return { ok: false, code: "snapshot_not_found", detail: `No price snapshot ${id}.` };
      return { ok: true, stale: isStale(g.snapshot, o), captured_at: g.snapshot.captured_at };
    }

    function ready() {
      return Promise.resolve({ ok: true, doc });
    }

    return {
      doc,
      ready,
      load: loadSnapshots,
      capture: captureAndStore,
      get,
      list,
      bind: bindLine,
      verifyAll,
      update,
      remove,
      ageDays: ageDaysOf,
      isStale: isStaleSnapshot
    };
  }

  return {
    VERSION,
    DOC,
    DEFAULT_STALE_DAYS,
    FIELDS,
    MODEL_FIELD_NAMES: FIELDS.map(f => f.name),
    SnapshotError,
    genId,
    localDigest,
    canonicalize,
    hashOf,
    contentHashOf,
    seal,
    verify,
    validate,
    normalize,
    capture,
    tryCapture,
    bind,
    applyCost,
    provenance,
    ageDays,
    isStale,
    createService
  };
})();
