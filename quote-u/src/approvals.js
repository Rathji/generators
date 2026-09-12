// ============================================================================
// quote-u — approval record (roadmap task 28)
// ----------------------------------------------------------------------------
// The `approvals` document is the acceptance record of the system: exactly ONE
// row per quote VERSION (invariant I2). It is the immutable evidence of what a
// client accepted — the selected line-item ids, the frozen totals recomputed
// server-side at approval time, the typed approver name, and the portal context
// (token id, IP, user agent, timestamp).
//
// The record is deliberately immutable: nothing in the app ever updates an
// approval. A second approval of the same version is refused with
// `already_approved`, and the refusal is enforced inside the revision-guarded
// write (read → find → append → save at the read revision), so two racing
// writers cannot both win — the loser sees `conflict` and re-reads, then finds
// the winner's row. That read-check-write-under-revision is the document store's
// version of the unique constraint on `version_id`.
//
// Money is integer cents (QU_MONEY); the token SECRET is never stored (only the
// token id).
// ============================================================================
window.QU_APPROVALS = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u approvals require window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const DOC = "approvals";
  const DEFAULT_MAX_RETRIES = 4;

  const FIELDS = [
    { name: "id", required: false, generated: true, note: "stable approval id" },
    { name: "quote_id", required: true, note: "the quote that was decided" },
    { name: "version_id", required: true, unique: true, note: "the frozen version — one approval per version (invariant I2)" },
    { name: "decision", required: false, default: "approved", note: "approved (declines are recorded on the lifecycle audit, not here)" },
    { name: "selection", required: false, default: [], note: "the selected line-item ids the client accepted" },
    { name: "one_time_cents", required: true, note: "recomputed one-time total, integer cents" },
    { name: "mrr_cents", required: true, note: "recomputed MRR total, integer cents" },
    { name: "twelve_month_value_cents", required: true, note: "recomputed 12-month value, integer cents" },
    { name: "deal_value_cents", required: false, default: null, note: "per-service contract value (Σ selected line deal values), integer cents; task 53" },
    { name: "currency", required: false, default: M.DEFAULT_CURRENCY, note: "reserved currency column (v1: CAD)" },
    { name: "approver_name", required: true, note: "the typed name the client signed with" },
    { name: "signature", required: false, default: null, note: "the sealed typed-name e-signature (task 51), stored with the acceptance" },
    { name: "token_id", required: true, note: "the portal token id (never the secret)" },
    { name: "ip", required: false, default: null, note: "resolved client IP at approval" },
    { name: "user_agent", required: false, default: null, note: "client user agent at approval" },
    { name: "approved_at", required: true, note: "ISO timestamp of acceptance" }
  ];

  // A stored approval may never carry a secret or a raw source payload.
  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;

  class ApprovalError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "ApprovalError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new ApprovalError(code, message, meta); }

  function genId(rand) {
    return "apr-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
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

  // Order-preserving, deduped line-item id list (bounded).
  function selectionOf(selection) {
    if (!Array.isArray(selection)) return [];
    const seen = Object.create(null);
    const out = [];
    for (let i = 0; i < selection.length && out.length < 5000; i++) {
      const v = selection[i];
      if (v === undefined || v === null) continue;
      const s = String(v);
      if (!s || seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
    return out;
  }

  // The typed-name e-signature (task 51) attached to an acceptance. Pure: it is
  // deep-scanned for any secret-shaped key (a signature never holds one) and
  // cloned so a caller cannot mutate the stored record through its input.
  function signatureOf(value, violations) {
    if (value === undefined || value === null) return null;
    if (!isPlainObject(value)) {
      violations.push({ field: "signature", code: "bad_signature", detail: "signature must be an object or null" });
      return null;
    }
    const bad = [];
    (function scan(obj, path) {
      if (!obj || typeof obj !== "object") return;
      for (const k of Object.keys(obj)) {
        if (SECRET_KEY_RE.test(k)) bad.push(path + k);
        scan(obj[k], path + k + ".");
      }
    })(value, "signature.");
    bad.forEach(p => violations.push({ field: p, code: "secret_not_allowed", detail: `An approval must never carry the secret field "${p}"` }));
    if (value.hash !== undefined && (typeof value.hash !== "string" || !value.hash)) {
      violations.push({ field: "signature.hash", code: "unsealed", detail: "a stored signature must carry its seal hash" });
    }
    try { return JSON.parse(JSON.stringify(value)); }
    catch (e) { violations.push({ field: "signature", code: "bad_signature", detail: "signature must be plain data" }); return null; }
  }

  function asCents(value, name, violations, required) {
    if (value === undefined || value === null || value === "") {
      if (required) violations.push({ field: name, code: "bad_" + name, detail: `${name} is required` });
      return required ? 0 : null;
    }
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      violations.push({ field: name, code: "fractional_cents", detail: `${name} must be integer cents` });
      return 0;
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
    const violations = [];
    if (!isPlainObject(input)) {
      return { ok: false, violations: [{ field: null, code: "bad_approval", detail: "An approval must be an object" }], record: null };
    }
    for (const k of Object.keys(input)) {
      if (SECRET_KEY_RE.test(k)) violations.push({ field: k, code: "secret_not_allowed", detail: `An approval must never carry the secret field "${k}"` });
    }
    const quoteId = input.quote_id === undefined || input.quote_id === null ? null : String(input.quote_id);
    if (!quoteId) violations.push({ field: "quote_id", code: "quote_required", detail: "An approval needs a quote_id" });
    const versionId = input.version_id === undefined || input.version_id === null ? null : String(input.version_id);
    if (!versionId) violations.push({ field: "version_id", code: "version_required", detail: "An approval needs a version_id" });
    const approverName = clampText(input.approver_name, 200);
    if (!approverName) violations.push({ field: "approver_name", code: "approver_required", detail: "An approval needs the typed approver name" });
    const tokenId = input.token_id === undefined || input.token_id === null ? null : String(input.token_id);
    if (!tokenId) violations.push({ field: "token_id", code: "token_required", detail: "An approval needs the portal token id" });
    const approvedAt = clampText(input.approved_at, 40) || nowIso(opts.clock);

    let currency = input.currency === undefined || input.currency === null || input.currency === "" ? M.DEFAULT_CURRENCY : input.currency;
    try { currency = M.normalizeCurrency(currency); }
    catch (e) { violations.push({ field: "currency", code: "bad_currency", detail: (e && e.message) || String(e) }); currency = M.DEFAULT_CURRENCY; }

    const record = {
      id: input.id || opts.id || genId(opts.rand),
      quote_id: quoteId,
      version_id: versionId,
      decision: input.decision === undefined || input.decision === null ? "approved" : String(input.decision),
      selection: selectionOf(input.selection !== undefined ? input.selection : input.line_item_ids),
      one_time_cents: asCents(input.one_time_cents, "one_time_cents", violations, true),
      mrr_cents: asCents(input.mrr_cents, "mrr_cents", violations, true),
      twelve_month_value_cents: asCents(input.twelve_month_value_cents, "twelve_month_value_cents", violations, true),
      deal_value_cents: asCents(input.deal_value_cents, "deal_value_cents", violations, false),
      currency,
      approver_name: approverName || "",
      signature: signatureOf(input.signature, violations),
      token_id: tokenId,
      ip: clampText(input.ip, 64),
      user_agent: clampText(input.user_agent, 300),
      approved_at: approvedAt
    };
    return { ok: violations.length === 0, violations, record };
  }

  function validate(input, opts) {
    return collect(input, opts);
  }

  function normalize(input, opts) {
    const out = collect(input, opts);
    if (!out.ok) {
      const v = out.violations[0];
      fail(v.code, v.detail, { violations: out.violations });
    }
    return out.record;
  }

  // Build a record from a portal approval action: the totals are the ones the
  // server recomputed from the frozen version (never the client's numbers).
  function fromDecision(input, opts) {
    return normalize(input, opts);
  }

  function assertNoSecret(record) {
    if (!record || typeof record !== "object") return record;
    for (const k of Object.keys(record)) {
      if (SECRET_KEY_RE.test(k)) fail("secret_not_allowed", `An approval record must never carry a secret-shaped field ("${k}").`);
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
      if (!isPlainObject(r)) { violations.push({ index: i, code: "bad_approval", detail: "not an object" }); return; }
      const out = collect(r, {});
      if (!out.ok) out.violations.forEach(v => violations.push({ index: i, field: v.field, code: v.code, detail: v.detail }));
      const money = M.auditStoredMoney(r, { ignoreKeys: [] });
      money.violations.forEach(v => violations.push({ index: i, field: v.path, code: v.reason, detail: v.reason }));
    });
    const uniq = uniqueByVersion(list);
    uniq.duplicates.forEach(d => violations.push({ index: d.second, field: "version_id", code: "duplicate_approval", detail: `version ${d.version_id} already has an approval` }));
    return { ok: violations.length === 0, violations, count: list.length, duplicates: uniq.duplicates };
  }

  // ---- persistence (system-of-record document) ------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_APPROVALS needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DOC;
    const rand = opts.rand || null;
    const clock = opts.clock || null;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;

    async function load() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    // Record exactly one approval for a version. Reading, checking and appending
    // happen at the same revision, so a concurrent writer is refused and retried
    // rather than racing — the uniqueness constraint is enforced here.
    async function record(input) {
      let built;
      try { built = normalize(input, { rand, clock: clock || undefined }); }
      catch (e) { return { ok: false, code: e.code || "bad_approval", detail: e.message, violations: e.meta && e.meta.violations }; }
      assertNoSecret(built);
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const existing = l.records.find(r => r && String(r.version_id) === built.version_id);
        if (existing) {
          return { ok: false, code: "already_approved", detail: `Version ${built.version_id} already has an approval.`, approval: existing };
        }
        const next = l.records.concat([built]);
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, approval: built, revision: save.revision, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "approval_conflict", detail: `Could not write the approval after ${maxRetries + 1} attempts; the document kept moving.` };
    }

    async function getForVersion(versionId) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, approval: l.records.find(r => r && String(r.version_id) === String(versionId)) || null, revision: l.revision };
    }

    async function getById(id) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, approval: l.records.find(r => r && r.id === id) || null, revision: l.revision };
    }

    async function has(versionId) {
      const g = await getForVersion(versionId);
      if (!g.ok) return g;
      return { ok: true, has: !!g.approval };
    }

    async function list(filter) {
      const l = await load();
      if (!l.ok) return l;
      let recs = l.records.slice();
      if (filter) {
        if (filter.quote_id !== undefined) recs = recs.filter(r => r && r.quote_id === filter.quote_id);
        if (filter.approver_name !== undefined) recs = recs.filter(r => r && r.approver_name === filter.approver_name);
        if (filter.since !== undefined) recs = recs.filter(r => r && r.approved_at >= filter.since);
        if (filter.limit !== undefined) recs = recs.slice(0, filter.limit);
      }
      return { ok: true, approvals: recs, total: l.records.length, revision: l.revision };
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

    return { doc, ready, load, record, getForVersion, getById, has, list, count, verify };
  }

  return {
    VERSION,
    DOC,
    FIELDS,
    MODEL_FIELD_NAMES: FIELDS.map(f => f.name),
    UNIQUE_FIELDS: ["version_id"],
    ApprovalError,
    genId,
    selectionOf,
    fromDecision,
    validate,
    normalize,
    assertNoSecret,
    uniqueByVersion,
    auditRecords,
    createService
  };
})();
