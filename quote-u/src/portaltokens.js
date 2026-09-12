// ============================================================================
// quote-u — portal tokens (roadmap task 18; hardened further in task 22)
// ----------------------------------------------------------------------------
// A portal token is the credential behind a client's tokenized link. It is an
// OPAQUE, high-entropy secret; only its SHA-256 HASH is ever stored (invariant
// I2/I4 — the `portal_tokens` document must never carry the plaintext). The
// secret itself is returned exactly once, at mint time, and is mathematically
// unrecoverable afterwards: verify() hashes the presented secret and compares
// it to the stored hash.
//
//   id  — a public token id (safe to record in the audit log; the secret never is)
//   secret — the private half, handed to the client in the link and never stored
//
//   mint   → { secret, record }   (record carries token_hash, not the secret)
//   verify → { ok, token } | { ok:false, code }  (bad_secret | not_found |
//            revoked | expired | hash_mismatch)
//
// The hashing is a synchronous, pure-JS SHA-256 so the SAME function can run in
// the server-plugin's synchronous handlers (which cannot use crypto.subtle).
// ============================================================================
window.QU_PORTALTOKENS = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "portal_tokens";
  const DEFAULT_MAX_RETRIES = 4;
  const DEFAULT_SECRET_BYTES = 32;
  const SECRET_HEX_LEN = DEFAULT_SECRET_BYTES * 2;
  const STATUSES = ["active", "revoked", "expired"];

  // Synchronous SHA-256 (hex). Pure JS so it also runs in a server-plugin
  // handler, and identical to the implementation mirrored in index.html.
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256Hex(input) {
    const msg = input === undefined || input === null ? "" : String(input);
    const bytes = [];
    for (let i = 0; i < msg.length; i++) {
      const c = msg.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const w = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) | 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = [(H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0, (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0];
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }

  function hashSecret(secret) {
    return sha256Hex("qu-portal-v1:" + String(secret == null ? "" : secret));
  }

  function bytesToHex(arr) {
    let out = "";
    for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
    return out;
  }

  // High-entropy secret. Uses the platform CSPRNG when available; the fallback
  // is only exercised where crypto.getRandomValues is absent.
  function genSecret(bytes) {
    const n = bytes || DEFAULT_SECRET_BYTES;
    const arr = new Uint8Array(n);
    let filled = false;
    try {
      const c = (typeof crypto !== "undefined" && crypto) || (typeof self !== "undefined" && self.crypto) || null;
      if (c && typeof c.getRandomValues === "function") { c.getRandomValues(arr); filled = true; }
    } catch (e) { filled = false; }
    if (!filled) for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256) & 0xff;
    return bytesToHex(arr);
  }

  function genId(rand) {
    return "tok-" + Date.now().toString(36) + "-" + (rand ? rand(10) : Math.random().toString(36).slice(2, 12));
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function ms(at) {
    if (at === undefined || at === null) return Date.now();
    if (typeof at === "number") return at;
    const t = Date.parse(at);
    return isNaN(t) ? Date.now() : t;
  }

  // No stored field may carry the secret in any spelling. A token record has
  // exactly one secret-derived field: `token_hash` (a hash, not the secret).
  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;
  function assertNoSecret(record) {
    if (!record || typeof record !== "object") return record;
    for (const k of Object.keys(record)) {
      if (k === "token_hash") continue;
      if (SECRET_KEY_RE.test(k)) {
        const e = new Error(`A portal token record must never carry a plaintext secret (field "${k}").`);
        e.code = "secret_not_allowed";
        throw e;
      }
    }
    return record;
  }

  const FIELDS = [
    { name: "id", required: false, generated: true, note: "public token id (never the secret)" },
    { name: "quote_id", required: true, note: "the quote this token opens" },
    { name: "version_id", required: true, note: "the frozen version it opens" },
    { name: "token_hash", required: true, note: "sha256 of the secret — the only stored form" },
    { name: "created_at", required: false, note: "ISO mint timestamp" },
    { name: "created_by", required: false, default: "", note: "the rep who sent it" },
    { name: "expires_at", required: false, default: null, note: "ISO expiry (null = never)" },
    { name: "revoked_at", required: false, default: null, note: "ISO revocation timestamp" },
    { name: "revoked_by", required: false, default: "", note: "who revoked it" },
    { name: "single_use", required: false, default: false, note: "hardened in task 22" },
    { name: "use_count", required: false, default: 0, note: "how many times the secret was presented" },
    { name: "last_used_at", required: false, default: null, note: "ISO of the last successful verify" },
    { name: "label", required: false, default: "", note: "human label for the token list" }
  ];

  class TokenError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "TokenError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }
  function fail(code, message, meta) { throw new TokenError(code, message, meta); }

  function statusOf(record, at) {
    if (!record) return null;
    if (record.revoked_at) return "revoked";
    if (record.expires_at && ms(at) > ms(record.expires_at)) return "expired";
    return "active";
  }

  function isActive(record, at) { return statusOf(record, at) === "active"; }

  // Mint a fresh token: generates the secret and the hash-only record. The
  // secret is returned once and is not part of the record.
  function mint(input, opts) {
    opts = opts || {};
    input = input || {};
    if (!input.quote_id) fail("quote_required", "A portal token needs a quote_id.");
    if (!input.version_id) fail("version_required", "A portal token needs a version_id.");
    const secret = input.secret || genSecret(opts.secretBytes);
    if (typeof secret !== "string" || secret.length < SECRET_HEX_LEN) fail("weak_secret", "A portal secret must be high-entropy.");
    const created_at = input.created_at || nowIso(opts.clock);
    let expires_at = input.expires_at === undefined ? null : input.expires_at;
    if (expires_at === undefined || expires_at === null) {
      if (input.expires_days !== undefined && input.expires_days !== null) {
        expires_at = new Date(ms(created_at) + Number(input.expires_days) * 86400000).toISOString();
      }
    }
    const record = assertNoSecret({
      id: input.id || opts.id || genId(opts.rand),
      quote_id: String(input.quote_id),
      version_id: String(input.version_id),
      token_hash: hashSecret(secret),
      created_at: String(created_at),
      created_by: input.created_by === undefined ? "" : String(input.created_by),
      expires_at: expires_at === null || expires_at === undefined ? null : String(expires_at),
      revoked_at: null,
      revoked_by: "",
      single_use: input.single_use === true,
      use_count: 0,
      last_used_at: null,
      label: input.label === undefined ? "" : String(input.label)
    });
    return { secret, record };
  }

  // Constant-time-ish string compare of two hex digests.
  function safeEqual(a, b) {
    const x = String(a == null ? "" : a);
    const y = String(b == null ? "" : b);
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return diff === 0;
  }

  function hashMatches(secret, record) {
    if (!record || typeof record.token_hash !== "string") return false;
    return safeEqual(hashSecret(secret), record.token_hash);
  }

  // Verify a presented secret against a record. Never reveals the stored hash.
  function verify(secret, record, at) {
    if (!record) return { ok: false, code: "not_found", detail: "No portal token matches that link." };
    if (typeof secret !== "string" || !secret) return { ok: false, code: "bad_secret", detail: "No portal secret was presented." };
    if (!hashMatches(secret, record)) return { ok: false, code: "hash_mismatch", detail: "That portal link is not valid.", token_id: record.id };
    const status = statusOf(record, at);
    if (status === "revoked") return { ok: false, code: "revoked", detail: "This portal link has been revoked.", token_id: record.id };
    if (status === "expired") return { ok: false, code: "expired", detail: "This portal link has expired.", token_id: record.id };
    if (record.single_use && record.use_count > 0) return { ok: false, code: "used", detail: "This single-use portal link has already been opened.", token_id: record.id };
    return { ok: true, code: null, token_id: record.id, token: record, status: "active" };
  }

  // The public client URL for a secret (the top-level perchance page + hash
  // route, so it survives a generator rename via the redirect).
  function linkFor(secret, generatorName) {
    const name = generatorName || (typeof window !== "undefined" && window.generatorName) || "quote-u";
    return "https://perchance.org/" + name + "#/q/" + encodeURIComponent(secret);
  }

  // ---- persistence (system-of-record document) ------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_PORTALTOKENS needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DOC;
    const rand = opts.rand || null;
    const clock = opts.clock || null;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;
    // Optional authoritative server (the index.html QUTOKEN registry). When
    // attached, mint registers the hash, verify consults the server (which may
    // veto), and revoke/markUsed mirror. The server never holds the plaintext.
    let server = opts.server || null;

    function attachServer(handlers) {
      server = handlers || null;
      return { ok: true, attached: !!server };
    }
    function detachServer() { server = null; }
    function hasServer() { return !!server && typeof server.verify === "function"; }

    async function serverCall(name, arg) {
      if (!server || typeof server[name] !== "function") return null;
      try { return await server[name](arg); } catch (e) { return { ok: false, code: "server_unreachable", detail: (e && e.message) || String(e) }; }
    }

    async function load() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    async function mutate(fn) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const next = fn(l.records.slice());
        if (next === null) return { ok: true, noop: true, revision: l.revision };
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, records: next, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "token_conflict", detail: `Could not write the portal-token document after ${maxRetries + 1} attempts.` };
    }

    // Mint and persist. Returns the secret ONCE — callers must not store it.
    async function mintToken(input) {
      let minted;
      try {
        minted = mint(input, { rand, clock: clock || undefined });
      } catch (e) {
        return { ok: false, code: e.code || "bad_token", detail: e.message };
      }
      const res = await mutate(records => records.concat([minted.record]));
      if (!res.ok) return res;
      // Best-effort: register the hash authoritatively. A failure here does not
      // undo the mint (the document is the system of record); it is reported so
      // the caller can retry registration.
      const reg = await serverCall("register", {
        id: minted.record.id,
        token_hash: minted.record.token_hash,
        expires_at: minted.record.expires_at,
        single_use: minted.record.single_use
      });
      return { ok: true, secret: minted.secret, token: minted.record, revision: res.revision, server_registered: reg ? !!reg.ok : null };
    }

    async function getById(id) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, token: l.records.find(r => r && r.id === id) || null, revision: l.revision };
    }

    // Look a token up by the HASH of a presented secret — the only lookup a
    // portal needs (never a scan-and-compare of plaintext).
    async function getBySecret(secret) {
      const l = await load();
      if (!l.ok) return l;
      const want = hashSecret(secret);
      const found = l.records.find(r => r && typeof r.token_hash === "string" && safeEqual(r.token_hash, want)) || null;
      return { ok: true, token: found, revision: l.revision };
    }

    async function verifySecret(secret, at) {
      const g = await getBySecret(secret);
      if (!g.ok) return g;
      const local = verify(secret, g.token, at);
      if (hasServer()) {
        const remote = await serverCall("verify", {
          secret: secret,
          at: at === undefined || at === null ? null : (typeof at === "number" ? at : Date.parse(at))
        });
        if (remote && remote.ok === false) {
          // The server is the authority: it may veto even when the local doc
          // looks fine (a stale/superseded document, for example). It returns
          // not_found for tokens it has never seen; that is not a veto.
          if (remote.code === "revoked" || remote.code === "expired" || remote.code === "used" || remote.code === "hash_mismatch") {
            return { ok: false, code: remote.code, detail: remote.detail || "The server refused this portal link.", authority: "server", token_id: remote.token_id || (g.token && g.token.id) };
          }
          return Object.assign({ revision: g.revision, authority: "local", degraded: true, degraded_reason: remote.code }, local);
        }
        if (remote && remote.ok === true) return Object.assign({ revision: g.revision, authority: "server" }, local);
        // Unreachable server: fall back to the local verification.
        return Object.assign({ revision: g.revision, authority: "local", degraded: true, degraded_reason: (remote && remote.code) || "server_unreachable" }, local);
      }
      return Object.assign({ revision: g.revision, authority: "local" }, local);
    }

    async function listForQuote(quoteId) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, tokens: l.records.filter(r => r && r.quote_id === quoteId).slice(), revision: l.revision };
    }

    async function listForVersion(versionId) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, tokens: l.records.filter(r => r && r.version_id === versionId).slice(), revision: l.revision };
    }

    async function activeForVersion(versionId, at) {
      const l = await listForVersion(versionId);
      if (!l.ok) return l;
      const active = l.tokens.filter(t => isActive(t, at));
      return { ok: true, tokens: active, token: active.length ? active[active.length - 1] : null, revision: l.revision };
    }

    async function revoke(id, ctx) {
      ctx = ctx || {};
      let revoked = null;
      const res = await mutate(records => records.map(r => {
        if (!r || r.id !== id || r.revoked_at) return r;
        revoked = Object.assign({}, r, { revoked_at: nowIso(clock), revoked_by: ctx.actor === undefined ? "" : String(ctx.actor) });
        return revoked;
      }));
      if (!res.ok) return res;
      if (res.noop || !revoked) {
        const g = await getById(id);
        if (g.ok && g.token) return { ok: true, token: g.token, already: true };
        return { ok: false, code: "token_not_found", detail: `No portal token ${id}.` };
      }
      await serverCall("revoke", { id: revoked.id });
      return { ok: true, token: revoked, revision: res.revision };
    }

    // Record a successful open (used by the portal in later phases).
    async function markUsed(id, at) {
      let used = null;
      const res = await mutate(records => records.map(r => {
        if (!r || r.id !== id) return r;
        used = Object.assign({}, r, { use_count: (r.use_count || 0) + 1, last_used_at: nowIso(at === undefined ? clock : at) });
        return used;
      }));
      if (!res.ok) return res;
      if (!used) return { ok: false, code: "token_not_found", detail: `No portal token ${id}.` };
      await serverCall("markUsed", { id: used.id, at: at === undefined || at === null ? null : (typeof at === "number" ? at : Date.parse(at)) });
      return { ok: true, token: used, revision: res.revision };
    }

    function ready() { return Promise.resolve({ ok: true, doc }); }

    return {
      doc,
      ready,
      load,
      mint: mintToken,
      getById,
      getBySecret,
      verify: verifySecret,
      listForQuote,
      listForVersion,
      activeForVersion,
      revoke,
      markUsed,
      linkFor,
      statusOf,
      isActive,
      attachServer,
      detachServer,
      hasServer
    };
  }

  return {
    VERSION,
    DOC,
    DEFAULT_SECRET_BYTES,
    SECRET_HEX_LEN,
    STATUSES,
    FIELDS,
    MODEL_FIELD_NAMES: FIELDS.map(f => f.name),
    TokenError,
    sha256Hex,
    hashSecret,
    genSecret,
    genId,
    statusOf,
    isActive,
    hashMatches,
    assertNoSecret,
    mint,
    verify,
    linkFor,
    createService
  };
})();
