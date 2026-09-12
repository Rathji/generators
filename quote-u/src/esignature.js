// ============================================================================
// quote-u — typed-name e-signature (roadmap task 51)
// ----------------------------------------------------------------------------
// A client's acceptance is an ELECTRONIC SIGNATURE, not a bare click. This
// module models and seals that signature:
//
//   { type: "typed_name", name, consent, signed_at, quote_id, version_id,
//     content_seal, ip, user_agent, hash }
//
//   • `name` is the typed legal name the client entered.
//   • `consent` is the exact wording they agreed to (kept verbatim, so the
//     record proves WHAT they agreed to, not just that they clicked).
//   • `content_seal` binds the signature to the frozen version's own seal, so a
//     signature can never be lifted onto a different/edited quote.
//   • `hash` seals every other field, so any change to the signature is
//     detectable (`verify` re-derives it).
//
// The capability is GATED BEHIND A SCOPE SIGN-OFF. Typed-name signatures are
// only produced when the policy is enabled AND an explicit sign-off has been
// recorded (who authorised it, when, and under what reference) in the
// `esignature` document. Until then, `status().enabled` is false and — unless
// `require_signature` is set — approvals proceed exactly as before, with no
// signature (so this task is backward compatible). When `require_signature` is
// true a non-enabled capability REFUSES approval rather than quietly collecting
// a signature nobody authorised.
//
// The signature is stored WITH the approval record (QU_APPROVALS carries the
// `signature` field) and surfaced on the accepted artifact (QU_ARTIFACTS), so
// there is exactly one acceptance record holding the signature and the
// client-facing artifact it attests to.
// ============================================================================
window.QU_ESIGN = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "esignature";
  const TYPES = Object.freeze(["typed_name"]);
  const DEFAULT_CONSENT = "By typing my name I agree that my electronic signature is the legal equivalent of my handwritten signature, and I accept this quote.";

  const DEFAULT_POLICY = Object.freeze({
    enabled: true,
    require_signature: false,
    scope: "sales",
    consent_text: DEFAULT_CONSENT
  });

  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;

  class EsignError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "EsignError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new EsignError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function genId(rand) {
    return "sig-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function clampText(v, max) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }

  function normalizePolicy(policy) {
    const p = isPlainObject(policy) ? policy : {};
    const consent = typeof p.consent_text === "string" && p.consent_text.trim() ? p.consent_text : DEFAULT_POLICY.consent_text;
    return {
      enabled: p.enabled === undefined ? DEFAULT_POLICY.enabled : p.enabled === true,
      require_signature: p.require_signature === true,
      scope: typeof p.scope === "string" && p.scope.trim() ? p.scope : DEFAULT_POLICY.scope,
      consent_text: consent
    };
  }

  // ---- deterministic canonicalisation + digest (self-contained) -------------

  function canonicalize(v) {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) if (v[k] !== undefined) parts.push(JSON.stringify(k) + ":" + canonicalize(v[k]));
    return "{" + parts.join(",") + "}";
  }

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

  function digestOf(value) {
    const A = window.QU_AUDIT;
    if (A && typeof A.canonicalize === "function" && typeof A.localDigest === "function") {
      return A.localDigest(A.canonicalize(value));
    }
    return localDigest(canonicalize(value));
  }

  function core(record) {
    const c = Object.assign({}, record);
    delete c.hash;
    return c;
  }

  function hashOf(record) {
    return digestOf(core(record));
  }

  function verify(signature, version) {
    if (!isPlainObject(signature)) return { ok: false, code: "bad_signature", detail: "A signature must be an object." };
    if (TYPES.indexOf(signature.type) === -1) return { ok: false, code: "bad_signature_type", detail: `Signature type \"${signature.type}\" is not one of ${TYPES.join(" | ")}.` };
    if (!signature.name || !String(signature.name).trim()) return { ok: false, code: "signature_name_required", detail: "A typed-name signature needs the typed name." };
    if (typeof signature.hash !== "string" || !signature.hash) return { ok: false, code: "unsealed", detail: "This signature carries no seal hash." };
    if (hashOf(signature) !== signature.hash) return { ok: false, code: "signature_tampered", detail: "The signature's content no longer matches its seal." };
    if (version && version.frozen_seal && signature.content_seal !== version.frozen_seal) {
      return { ok: false, code: "seal_mismatch", detail: "This signature does not attest to the version's frozen content." };
    }
    return { ok: true, signature };
  }

  function assertNoSecret(record) {
    if (!record || typeof record !== "object") return record;
    for (const k of Object.keys(record)) {
      if (SECRET_KEY_RE.test(k)) fail("secret_not_allowed", `A signature must never carry a secret-shaped field (\"${k}\").`);
    }
    return record;
  }

  // Build the sealed signature. Pure; requires the typed name and the frozen
  // version (so the signature can be bound to the content seal).
  function build(input, opts) {
    opts = opts || {};
    input = input || {};
    const policy = normalizePolicy(opts.policy || input.policy);
    const violations = [];
    const name = clampText(input.name !== undefined ? input.name : input.approver_name, 200);
    if (!name) violations.push({ field: "name", code: "signature_name_required", detail: "A typed name is required to sign." });
    const version = input.version;
    if (!isPlainObject(version) || version.id === undefined || version.id === null) {
      violations.push({ field: "version", code: "version_required", detail: "A signature needs the version it attests to." });
    }
    const consent = clampText(input.consent, 2000) || policy.consent_text;
    const signedAt = clampText(input.signed_at !== undefined ? input.signed_at : input.at, 40) || nowIso(opts.clock);
    for (const k of Object.keys(input)) {
      if (SECRET_KEY_RE.test(k)) violations.push({ field: k, code: "secret_not_allowed", detail: `A signature must never carry the secret field \"${k}\"` });
    }
    if (violations.length) return { ok: false, code: violations[0].code, detail: violations[0].detail, violations };
    const record = {
      id: input.id || opts.id || genId(opts.rand),
      type: "typed_name",
      name: name,
      consent: consent,
      signed_at: signedAt,
      quote_id: input.quote_id === undefined || input.quote_id === null ? null : String(input.quote_id),
      version_id: String(version.id),
      content_seal: version.frozen_seal === undefined ? null : version.frozen_seal,
      ip: clampText(input.ip !== undefined ? input.ip : opts.ip, 64),
      user_agent: clampText(input.user_agent !== undefined ? input.user_agent : opts.user_agent, 300)
    };
    record.hash = hashOf(record);
    assertNoSecret(record);
    return { ok: true, signature: record };
  }

  // ---- the service (scope sign-off + policy gate) ---------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const clock = opts.clock || null;
    const frozenPolicy = normalizePolicy(opts.policy);
    const maxRetries = opts.maxRetries === undefined ? 4 : opts.maxRetries;
    const doc = opts.doc || DOC;

    let cache = null;

    function contentOf(d) {
      const c = d && d.content && typeof d.content === "object" ? d.content : {};
      // The document follows the store convention of carrying a `records`
      // array (so a large document can be split across part files); here the
      // records ARE the sign-off history, and `signoff` is the current state.
      const history = Array.isArray(c.records) ? c.records : (Array.isArray(c.history) ? c.history : []);
      return { signoff: isPlainObject(c.signoff) ? c.signoff : null, history: history };
    }

    async function load() {
      if (!store || typeof store.loadDoc !== "function") return { ok: true, content: { signoff: null, history: [] }, revision: 0, local: true };
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      return { ok: true, content: contentOf(d), revision: d.revision, state: d.state };
    }

    // The gate: enabled = the capability is configured on AND an explicit
    // sign-off has been recorded.
    async function status() {
      const l = await load();
      if (!l.ok) return l;
      const signoff = l.content.signoff;
      const enabled = frozenPolicy.enabled && !!signoff;
      let code = null;
      let detail = null;
      if (!frozenPolicy.enabled) {
        code = "feature_disabled";
        detail = "Typed-name e-signature is disabled by policy.";
      } else if (!signoff) {
        code = "signoff_required";
        detail = "Typed-name e-signature requires a scope sign-off before it can be used.";
      }
      return { ok: true, enabled, policy: frozenPolicy, signoff: signoff, code, detail, revision: l.revision };
    }

    async function saveDoc(content) {
      if (!store || typeof store.saveChecked !== "function") { cache = content; return { ok: true, revision: 0, local: true }; }
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const cur = await load();
        if (!cur.ok) return cur;
        const save = await store.saveChecked(doc, content, { expectedBase: cur.revision });
        if (save.ok) return { ok: true, revision: save.revision };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "esignature_conflict", detail: `Could not write the ${doc} document after ${maxRetries + 1} attempts.` };
    }

    // Record the explicit scope sign-off that enables typed-name signatures.
    async function signOff(input) {
      input = input || {};
      const by = clampText(input.by, 200);
      if (!by) return { ok: false, code: "signoff_by_required", detail: "A sign-off needs the name of the person authorising e-signature." };
      const at = clampText(input.at, 40) || nowIso(clock);
      const entry = {
        by: by,
        at: at,
        scope: clampText(input.scope, 100) || frozenPolicy.scope,
        reference: clampText(input.reference, 300),
        note: clampText(input.note, 500)
      };
      const cur = await load();
      if (!cur.ok) return cur;
      const history = cur.content.history.concat([Object.assign({ action: "signed_off" }, entry)]);
      const saved = await saveDoc({ signoff: entry, records: history, updated_at: at });
      if (!saved.ok) return saved;
      return { ok: true, signoff: entry, revision: saved.revision };
    }

    async function revokeSignOff(input) {
      input = input || {};
      const at = clampText(input.at, 40) || nowIso(clock);
      const cur = await load();
      if (!cur.ok) return cur;
      if (!cur.content.signoff) return { ok: true, revoked: false, signoff: null };
      const prior = cur.content.signoff;
      const history = cur.content.history.concat([{ action: "revoked", at: at, by: clampText(input.by, 200), prior_by: prior.by }]);
      const saved = await saveDoc({ signoff: null, records: history, updated_at: at });
      if (!saved.ok) return saved;
      return { ok: true, revoked: true, signoff: null, prior: prior, revision: saved.revision };
    }

    async function history() {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, signoff: l.content.signoff, history: l.content.history };
    }

    // Build a signature using the service's policy; refuses when the gate is
    // closed, so even a direct call cannot mint an unauthorised signature.
    async function buildSealed(input) {
      const st = await status();
      if (!st.ok) return st;
      if (!st.enabled) return { ok: false, code: st.code || "signature_not_enabled", detail: st.detail || "Typed-name e-signature is not enabled." };
      return build(input, { policy: st.policy, clock: clock });
    }

    function ready() {
      if (!store || typeof store.ready !== "function") return Promise.resolve({ ok: true, doc, local: true });
      return store.ready().then(() => ({ ok: true, doc }));
    }

    return {
      doc,
      policy() { return frozenPolicy; },
      status,
      signOff,
      revokeSignOff,
      history,
      build: buildSealed,
      verify,
      ready
    };
  }

  return {
    VERSION,
    DOC,
    TYPES,
    DEFAULT_POLICY,
    DEFAULT_CONSENT,
    EsignError,
    normalizePolicy,
    canonicalize,
    hashOf,
    build,
    verify,
    assertNoSecret,
    createService
  };
})();
