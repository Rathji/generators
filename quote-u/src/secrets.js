// ============================================================================
// quote-u — secret discipline (roadmap task 49)
// ----------------------------------------------------------------------------
// No credential may ever be committed to source or exposed to a client surface.
// The app holds only REFERENCES by identity — a gateway key NAME, a secret
// store handle — and the credential itself lives in the fleet secret store,
// resolved at call time by the host (window.QU_KEYSTORE). This module is the
// executable half of that rule:
//
//   isSecretShaped(v)  — recognise a value that looks like a credential
//                        (private-key blocks, provider token shapes, bearer
//                        strings, long high-entropy blobs);
//   reference(name)    — build an identity reference (never a value);
//   assertClean(x)     — refuse an object/textarea that carries a secret-shaped
//                        value or key, so a seed/declaration cannot carry one;
//   scanSurfaces(list) — scan the client-facing surfaces (the portal DTO, the
//                        print view, the call log, …) for leaked credentials.
//
// It is deliberately conservative about false positives in one direction: any
// value that LOOKS like a secret is treated as one (fail closed), because a
// leaked credential is unrecoverable whereas a rejected innocuous string is a
// one-line fix.
// ============================================================================
window.QU_SECRETS = (function () {
  "use strict";

  const VERSION = "1.0.0";

  class SecretError extends Error {
    constructor(code, message, findings) {
      super(message);
      this.name = "SecretError";
      this.code = code;
      if (findings) this.findings = findings;
    }
  }
  function fail(code, message, findings) { throw new SecretError(code, message, findings); }

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // Credential shapes. Each is a labelled test over a string value.
  const PATTERNS = Object.freeze([
    { code: "private_key", label: "private key block", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
    { code: "openai_key", label: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
    { code: "github_token", label: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { code: "slack_token", label: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
    { code: "aws_key", label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { code: "google_key", label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
    { code: "bearer", label: "bearer credential", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
    { code: "basic_auth", label: "basic-auth credential", re: /\bBasic\s+[A-Za-z0-9+/=]{20,}/i },
    { code: "jwt", label: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
    { code: "assigned_secret", label: "assigned secret literal", re: /\b(?:api[_-]?key|secret|password|passwd|client[_-]?secret|access[_-]?token|private[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i },
    { code: "long_hex", label: "long hex blob", re: /\b[0-9a-fA-F]{40,}\b/ }
  ]);

  // A key name that is never allowed to carry a value (it must be a reference).
  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|passwd|apikey|api_key|private_key|token_secret|tokensecret|bearer)(_|$)|^token$|secret$|plaintext$|password$/i;

  function scanString(text) {
    const s = String(text == null ? "" : text);
    const out = [];
    PATTERNS.forEach(p => { if (p.re.test(s)) out.push({ code: p.code, label: p.label }); });
    return out;
  }

  function isSecretShaped(value) {
    if (typeof value === "string") return scanString(value).length > 0;
    if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return false;
    return scanValue(value, "").length > 0;
  }

  // Recursively find secret-shaped values and secret-shaped keys.
  function scanValue(value, path) {
    const findings = [];
    const walk = (v, p) => {
      if (typeof v === "string") {
        const hits = scanString(v);
        if (hits.length) findings.push({ path: p, code: hits[0].code, label: hits[0].label, reason: "secret-shaped value" });
        return;
      }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + "[" + i + "]")); return; }
      if (isPlainObject(v)) {
        Object.keys(v).forEach(k => {
          const kp = p ? p + "." + k : k;
          if (SECRET_KEY_RE.test(k) && !isReference(v[k]) && v[k] !== null && v[k] !== undefined && v[k] !== "") {
            findings.push({ path: kp, code: "secret_key", label: "secret-shaped key carries a value", reason: "must be a reference by identity" });
          }
          walk(v[k], kp);
        });
      }
    };
    walk(value, path || "");
    return findings;
  }

  function assertClean(value, label) {
    const findings = typeof value === "string" ? scanString(value).map(h => ({ path: label || "text", code: h.code, label: h.label })) : scanValue(value, label || "");
    if (findings.length) {
      return fail("secret_in_surface", `${label || "The value"} carries ${findings.length} secret-shaped entr${findings.length === 1 ? "y" : "ies"}: ${findings.map(f => f.path + " (" + f.label + ")").join(", ")}. A credential must live only in the fleet secret store, referenced by identity.`, findings);
    }
    return { ok: true, findings: [] };
  }

  // An identity reference: names the secret store entry, carries no value.
  function reference(name, opts) {
    opts = opts || {};
    const n = String(name || "").trim();
    if (!n) fail("bad_reference", "A secret reference needs a name.");
    return { by: "identity", name: n, store: opts.store ? String(opts.store) : "fleet" };
  }

  function isReference(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) && v.by === "identity" && typeof v.name === "string" && v.value === undefined && v.secret === undefined;
  }

  function redact(value) {
    // Never echo any part of the value — not even its length (a length is a
    // small but needless disclosure). Use `fingerprint` for a stable display id.
    return "[redacted]";
  }

  // A non-reversible-enough display fingerprint (never used for security).
  function fingerprint(value) {
    const s = String(value == null ? "" : value);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }

  // Scan client-facing surfaces. Each surface is `{ name, text }` or
  // `{ name, json }`; both are inspected for secret-shaped content.
  function scanSurfaces(surfaces) {
    const findings = [];
    (Array.isArray(surfaces) ? surfaces : []).forEach(s => {
      s = s || {};
      const name = String(s.name || "surface");
      const text = s.text !== undefined ? String(s.text) : (s.json !== undefined ? JSON.stringify(s.json) : "");
      scanString(text).forEach(h => findings.push({ surface: name, code: h.code, label: h.label }));
    });
    return { ok: findings.length === 0, findings };
  }

  // Prove the discipline: the seed/declaration surface must be clean, and only
  // identity references may stand in for a secret.
  function assertSurfaces(surfaces) {
    const res = scanSurfaces(surfaces);
    if (!res.ok) {
      return fail("secret_in_surface", `A client surface leaked ${res.findings.length} secret-shaped entr${res.findings.length === 1 ? "y" : "ies"}: ${res.findings.map(f => f.surface + " (" + f.label + ")").join(", ")}.`, res.findings);
    }
    return { ok: true, findings: [] };
  }

  function verify(sample) {
    sample = sample || {};
    const findings = scanValue(isPlainObject(sample) ? sample : { sample: sample }, "");
    return { ok: findings.length === 0, findings, patterns: PATTERNS.map(p => p.code) };
  }

  return {
    VERSION,
    PATTERNS,
    scanString,
    isSecretShaped,
    scanValue,
    assertClean,
    reference,
    isReference,
    redact,
    fingerprint,
    scanSurfaces,
    assertSurfaces,
    verify
  };
})();
