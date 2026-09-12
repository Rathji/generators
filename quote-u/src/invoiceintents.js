// ============================================================================
// quote-u — invoice intent guard (roadmap task 34)
// ----------------------------------------------------------------------------
// `invoice_intents` is the hard double-billing guard: exactly ONE row per quote
// VERSION (invariant I2), recording the chosen path (direct accounting vs PSA),
// the status, and the external reference. The row is written BEFORE the
// external invoicing call, so any second invoicing attempt for that version —
// along the same path OR the other path — is refused with `already_invoiced`.
//
// Uniqueness is enforced inside a revision-guarded read-check-append-save (the
// same shape as the approvals record): the read, the existing-row check and the
// append all happen at one revision, so two racing writers cannot both win —
// the loser sees `conflict`, re-reads and finds the winner's row. There is no
// code path that deletes an intent, and `version_id`/`path` are immutable once
// claimed; only the status block (status / external_reference / error) may be
// updated, which is how a path reconciles its created invoice back in.
//
// Money is integer cents (QU_MONEY); no secret is ever stored.
// ============================================================================
window.QU_INVOICEINTENTS = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u invoice intents require window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const DOC = "invoice_intents";
  const DEFAULT_MAX_RETRIES = 4;
  const DEFAULT_PATHS = Object.freeze(["direct", "psa"]);
  const STATUSES = Object.freeze(["pending", "created", "failed", "reconciled"]);

  const FIELDS = [
    { name: "id", required: false, generated: true, note: "stable intent id" },
    { name: "quote_id", required: true, note: "the quote being invoiced" },
    { name: "version_id", required: true, unique: true, note: "the frozen version — one intent per version (invariant I2)" },
    { name: "path", required: true, note: "direct | psa — which invoicing path claimed this version" },
    { name: "status", required: false, default: "pending", note: "pending | created | failed | reconciled" },
    { name: "external_reference", required: false, default: null, note: "the created invoice id/reference, once known" },
    { name: "external_system", required: false, default: null, note: "accounting | psa — the system that owns the reference" },
    { name: "amount_cents", required: true, note: "the invoiced amount, integer cents" },
    { name: "currency", required: false, default: M.DEFAULT_CURRENCY, note: "reserved currency column (v1: CAD)" },
    { name: "attempt", required: false, default: 1, note: "how many external attempts this intent represents" },
    { name: "created_by", required: false, default: null, note: "the actor that claimed the intent" },
    { name: "error", required: false, default: null, note: "last error when status is failed" },
    { name: "created_at", required: true, note: "ISO timestamp the intent was claimed" },
    { name: "updated_at", required: false, default: null, note: "ISO timestamp of the last status change" }
  ];

  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;

  class InvoiceIntentError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "InvoiceIntentError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new InvoiceIntentError(code, message, meta); }

  function genId(rand) {
    return "inv-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function clampText(v, max) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }

  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    let paths = Array.isArray(p.paths) && p.paths.length ? p.paths.map(String) : DEFAULT_PATHS.slice();
    const defaultPath = p.default_path !== undefined && p.default_path !== null ? String(p.default_path) : (paths.indexOf("psa") !== -1 ? "psa" : paths[0]);
    if (paths.indexOf(defaultPath) === -1) paths = paths.concat([defaultPath]);
    return { paths: paths, default_path: defaultPath };
  }

  function asCents(value, name, violations, required) {
    if (value === undefined || value === null || value === "") {
      if (required) violations.push({ field: name, code: "bad_" + name, detail: `${name} is required` });
      return required ? 0 : null;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      violations.push({ field: name, code: "bad_" + name, detail: `${name} must be integer cents` });
      return 0;
    }
    return value;
  }

  // Pure, non-throwing assembly. Returns { ok, violations, record }.
  function collect(input, opts) {
    opts = opts || {};
    const policy = opts.policy || normalizePolicy(null);
    const violations = [];
    if (!isPlainObject(input)) {
      return { ok: false, violations: [{ field: null, code: "bad_intent", detail: "An invoice intent must be an object" }], record: null };
    }
    for (const k of Object.keys(input)) {
      if (SECRET_KEY_RE.test(k)) violations.push({ field: k, code: "secret_not_allowed", detail: `An invoice intent must never carry the secret field "${k}"` });
    }
    const quoteId = input.quote_id === undefined || input.quote_id === null ? null : String(input.quote_id);
    if (!quoteId) violations.push({ field: "quote_id", code: "quote_required", detail: "An invoice intent needs a quote_id" });
    const versionId = input.version_id === undefined || input.version_id === null ? null : String(input.version_id);
    if (!versionId) violations.push({ field: "version_id", code: "version_required", detail: "An invoice intent needs a version_id" });
    const path = input.path === undefined || input.path === null || input.path === "" ? policy.default_path : String(input.path);
    if (policy.paths.indexOf(path) === -1) violations.push({ field: "path", code: "bad_path", detail: `Unknown invoice path "${path}"; expected one of ${policy.paths.join(", ")}` });
    let status = input.status === undefined || input.status === null ? "pending" : String(input.status);
    if (STATUSES.indexOf(status) === -1) violations.push({ field: "status", code: "bad_status", detail: `Unknown invoice intent status "${status}"` });
    let currency = input.currency === undefined || input.currency === null || input.currency === "" ? M.DEFAULT_CURRENCY : input.currency;
    try { currency = M.normalizeCurrency(currency); }
    catch (e) { violations.push({ field: "currency", code: "bad_currency", detail: (e && e.message) || String(e) }); currency = M.DEFAULT_CURRENCY; }
    const attempt = input.attempt === undefined || input.attempt === null ? 1 : input.attempt;
    if (!Number.isInteger(attempt) || attempt < 1) violations.push({ field: "attempt", code: "bad_attempt", detail: "attempt must be a positive integer" });

    const record = {
      id: input.id || opts.id || genId(opts.rand),
      quote_id: quoteId,
      version_id: versionId,
      path: path,
      status: status,
      external_reference: clampText(input.external_reference, 200),
      external_system: clampText(input.external_system, 40),
      amount_cents: asCents(input.amount_cents, "amount_cents", violations, true),
      currency: currency,
      attempt: Number.isInteger(attempt) && attempt >= 1 ? attempt : 1,
      created_by: clampText(input.created_by, 200),
      error: clampText(input.error, 500),
      created_at: clampText(input.created_at, 40) || nowIso(opts.clock),
      updated_at: clampText(input.updated_at, 40)
    };
    return { ok: violations.length === 0, violations, record };
  }

  function validate(input, opts) { return collect(input, opts); }

  function normalize(input, opts) {
    const out = collect(input, opts);
    if (!out.ok) fail(out.violations[0].code, out.violations[0].detail, { violations: out.violations });
    return out.record;
  }

  function assertNoSecret(record) {
    if (!record || typeof record !== "object") return record;
    for (const k of Object.keys(record)) {
      if (SECRET_KEY_RE.test(k)) fail("secret_not_allowed", `An invoice intent must never carry a secret-shaped field ("${k}").`);
    }
    return record;
  }

  // The invariant I2 check, pure: at most one record per version_id.
  function uniqueByVersion(records) {
    const seen = Object.create(null);
    const duplicates = [];
    (records || []).forEach((r, i) => {
      if (!r || r.version_id === undefined || r.version_id === null) return;
      const id = String(r.version_id);
      if (seen[id] !== undefined) duplicates.push({ version_id: id, first: seen[id], second: i });
      else seen[id] = i;
    });
    return { ok: duplicates.length === 0, duplicates };
  }

  function auditRecords(records) {
    const list = Array.isArray(records) ? records : [records];
    const violations = [];
    list.forEach((r, i) => {
      if (!isPlainObject(r)) { violations.push({ index: i, code: "bad_intent", detail: "not an object" }); return; }
      const out = collect(r, {});
      if (!out.ok) out.violations.forEach(v => violations.push({ index: i, field: v.field, code: v.code, detail: v.detail }));
      const money = M.auditStoredMoney(r, { ignoreKeys: [] });
      money.violations.forEach(v => violations.push({ index: i, field: v.path, code: v.reason, detail: v.reason }));
    });
    const uniq = uniqueByVersion(list);
    uniq.duplicates.forEach(d => violations.push({ index: d.second, field: "version_id", code: "duplicate_intent", detail: `version ${d.version_id} already has an invoice intent` }));
    return { ok: violations.length === 0, violations, count: list.length, duplicates: uniq.duplicates };
  }

  // ---- persistence (system-of-record document) ------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_INVOICEINTENTS needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DOC;
    const rand = opts.rand || null;
    const clock = opts.clock || null;
    const policy = normalizePolicy(opts.policy);
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;

    async function load() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    // Claim the version for a path: this is the double-billing guard. The row is
    // written BEFORE the external call, so a second attempt (same or other path)
    // is refused. Read + check + append share one revision, so racers cannot
    // both win.
    async function claim(input) {
      let built;
      try { built = normalize(Object.assign({ status: "pending" }, input), { rand, clock: clock || undefined, policy }); }
      catch (e) { return { ok: false, code: e.code || "bad_intent", detail: e.message, violations: e.meta && e.meta.violations }; }
      assertNoSecret(built);
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const existing = l.records.find(r => r && String(r.version_id) === built.version_id);
        if (existing) {
          return {
            ok: false,
            code: "already_invoiced",
            detail: `Version ${built.version_id} already has an invoice intent on the "${existing.path}" path; a second invoicing attempt is refused.`,
            intent: existing,
            path: existing.path,
            status: existing.status
          };
        }
        const next = l.records.concat([built]);
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, intent: built, revision: save.revision, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "intent_conflict", detail: `Could not write the invoice intent after ${maxRetries + 1} attempts; the document kept moving.` };
    }

    // Update the status block of an existing intent. version_id, path and
    // amount_cents are immutable — a claimed intent's identity cannot change.
    async function updateStatus(id, patch) {
      patch = patch || {};
      let updated = null;
      let missing = false;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const found = l.records.find(r => r && r.id === id);
        if (!found) { missing = true; break; }
        const next = Object.assign({}, found);
        if (patch.status !== undefined) {
          const status = String(patch.status);
          if (STATUSES.indexOf(status) === -1) return { ok: false, code: "bad_status", detail: `Unknown invoice intent status "${status}".` };
          next.status = status;
        }
        if (patch.external_reference !== undefined) next.external_reference = clampText(patch.external_reference, 200);
        if (patch.external_system !== undefined) next.external_system = clampText(patch.external_system, 40);
        if (patch.error !== undefined) next.error = clampText(patch.error, 500);
        if (patch.attempt !== undefined) {
          if (!Number.isInteger(patch.attempt) || patch.attempt < 1) return { ok: false, code: "bad_attempt", detail: "attempt must be a positive integer." };
          next.attempt = patch.attempt;
        }
        next.updated_at = nowIso(clock);
        const content = Object.assign({}, l.content, { records: l.records.map(r => (r && r.id === id) ? next : r) });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) { updated = next; break; }
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      if (missing) return { ok: false, code: "intent_not_found", detail: `No invoice intent ${id}.` };
      if (!updated) return { ok: false, code: "intent_conflict", detail: `Could not update the invoice intent after ${maxRetries + 1} attempts.` };
      return { ok: true, intent: updated };
    }

    function markCreated(id, input) {
      input = input || {};
      return updateStatus(id, { status: "created", external_reference: input.external_reference, external_system: input.external_system, error: null });
    }
    function markFailed(id, input) {
      input = input || {};
      return updateStatus(id, { status: "failed", error: (input && (input.error || input.detail)) || "failed" });
    }
    function markReconciled(id, input) {
      input = input || {};
      return updateStatus(id, { status: "reconciled", external_reference: input.external_reference, external_system: input.external_system, error: null });
    }

    async function getForVersion(versionId) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, intent: l.records.find(r => r && String(r.version_id) === String(versionId)) || null, revision: l.revision };
    }

    async function getById(id) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, intent: l.records.find(r => r && r.id === id) || null, revision: l.revision };
    }

    async function has(versionId) {
      const g = await getForVersion(versionId);
      if (!g.ok) return g;
      return { ok: true, has: !!g.intent };
    }

    // The advisory pre-check a caller can run before doing any work.
    async function canInvoice(versionId) {
      const g = await getForVersion(versionId);
      if (!g.ok) return g;
      return { ok: true, allowed: !g.intent, intent: g.intent };
    }

    async function list(filter) {
      const l = await load();
      if (!l.ok) return l;
      let recs = l.records.slice();
      if (filter) {
        if (filter.quote_id !== undefined) recs = recs.filter(r => r && r.quote_id === filter.quote_id);
        if (filter.path !== undefined) recs = recs.filter(r => r && r.path === filter.path);
        if (filter.status !== undefined) recs = recs.filter(r => r && r.status === filter.status);
        if (filter.limit !== undefined) recs = recs.slice(0, filter.limit);
      }
      return { ok: true, intents: recs, total: l.records.length, revision: l.revision };
    }

    async function count() {
      const l = await load();
      return l.ok ? { ok: true, count: l.records.length, revision: l.revision } : l;
    }

    async function verify() {
      const l = await load();
      if (!l.ok) return l;
      const res = auditRecords(l.records);
      res.revision = l.revision;
      return res;
    }

    function ready() {
      const p = store.ready ? Promise.resolve(store.ready()) : Promise.resolve();
      return p.then(() => ({ ok: true, doc }));
    }

    return {
      doc, policy, ready, load,
      claim, updateStatus, markCreated, markFailed, markReconciled,
      getForVersion, getById, has, canInvoice, list, count, verify
    };
  }

  return {
    VERSION,
    DOC,
    FIELDS,
    STATUSES,
    PATHS: DEFAULT_PATHS,
    MODEL_FIELD_NAMES: FIELDS.map(f => f.name),
    UNIQUE_FIELDS: ["version_id"],
    InvoiceIntentError,
    genId,
    normalizePolicy,
    validate,
    normalize,
    assertNoSecret,
    uniqueByVersion,
    auditRecords,
    createService
  };
})();
