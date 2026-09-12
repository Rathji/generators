// src/framework/otp.js — one-time-password generation (roadmap Phase 4, task 18).
//
// A credential record may carry a Base32 OTP secret (the shared secret an
// authenticator app is enrolled with). Task 18 asks IT-U to turn that secret
// into the SIX-DIGIT one-time code the credential's second factor would use,
// to validate the secret properly, and to give a clear error when the secret is
// malformed rather than silently producing wrong codes.
//
// The maths is the standard RFC 4226 HOTP / RFC 6238 TOTP pair that every
// authenticator app implements — HMAC-SHA-1 over a big-endian counter, dynamic
// truncation, modulo 10^digits. It is written as plain synchronous JS (no
// WebCrypto) so it can run anywhere in the app, in tests, and in future
// server-side handlers. The secret is normalised the way enrolments expect:
// case-insensitive, spaces and hyphens stripped, `=` padding optional.

export class OtpError extends Error {
  constructor(message, code = "OTP_INVALID") {
    super(message);
    this.name = "OtpError";
    this.code = code;
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B32_INDEX = (() => {
  const map = new Map();
  for (let i = 0; i < BASE32_ALPHABET.length; i += 1) map.set(BASE32_ALPHABET[i], i);
  return map;
})();

const MIN_SECRET_LENGTH = 16;

// Strip the decoration enrolments add and upper-case the result: "jbsw y3dp
// e5k6 mzq=" → "JBSWY3DPE5K6MZQ".
export function normalizeOtpSecret(secret) {
  return String(secret == null ? "" : secret)
    .replace(/[\s-]/g, "")
    .replace(/=+$/, "")
    .toUpperCase();
}

// Decode a normalised Base32 string to bytes. Never throws — callers validate
// first (validateOtpSecret), which is where the human-readable errors live.
export function decodeBase32(secret) {
  const s = normalizeOtpSecret(secret);
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const idx = B32_INDEX.get(ch);
    if (idx == null) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function encodeBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | (b & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// Validate a stored secret. Returns { ok, errors[], normalized, bytes } and
// never throws, so a form (or the password validator) can show the reason.
export function validateOtpSecret(secret) {
  const s = normalizeOtpSecret(secret);
  const errors = [];
  if (!s) {
    return { ok: false, errors: ["An OTP secret is required."], normalized: s, bytes: null };
  }
  const bad = [...new Set(s.split("").filter((c) => !B32_INDEX.has(c)))];
  if (bad.length) {
    errors.push(
      `An OTP secret may only use the Base32 alphabet (A–Z and 2–7) — it cannot contain ${bad
        .map((c) => `“${c}”`)
        .join(", ")}. (Base32 has no 0, 1, 8 or 9.)`,
    );
  } else if (s.length < MIN_SECRET_LENGTH) {
    errors.push(`An OTP secret must be at least ${MIN_SECRET_LENGTH} Base32 characters — this one is ${s.length}.`);
  }
  if (errors.length) return { ok: false, errors, normalized: s, bytes: null };
  const bytes = decodeBase32(s);
  if (!bytes.length) errors.push("The OTP secret did not decode to any bytes.");
  return { ok: errors.length === 0, errors, normalized: s, bytes };
}

export const isValidOtpSecret = (secret) => validateOtpSecret(secret).ok;

// The human-readable reason a secret is unusable (null when it is fine).
export function otpSecretError(secret) {
  const { ok, errors } = validateOtpSecret(secret);
  return ok ? null : errors.join(" ");
}

function decodeOrThrow(secret) {
  const { ok, errors, bytes } = validateOtpSecret(secret);
  if (!ok) throw new OtpError(errors.join(" "), "OTP_INVALID_SECRET");
  return bytes;
}

// ---- SHA-1 + HMAC-SHA-1 (synchronous, byte-accurate) -----------------------

const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

function sha1(input) {
  const ml = input.length * 8;
  const withOne = input.length + 1;
  const total = withOne + ((56 - (withOne % 64)) + 64) % 64 + 8;
  const msg = new Uint8Array(total);
  msg.set(input);
  msg[input.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Math.floor(ml / 0x100000000));
  dv.setUint32(total - 4, ml >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let chunk = 0; chunk < total; chunk += 64) {
    for (let j = 0; j < 16; j += 1) w[j] = dv.getUint32(chunk + j * 4);
    for (let j = 16; j < 80; j += 1) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let j = 0; j < 80; j += 1) {
      let f;
      let k;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, h0);
  odv.setUint32(4, h1);
  odv.setUint32(8, h2);
  odv.setUint32(12, h3);
  odv.setUint32(16, h4);
  return out;
}

export function hmacSha1(key, message) {
  const BLOCK = 64;
  let k = key;
  if (k.length > BLOCK) k = sha1(k);
  const keyPad = new Uint8Array(BLOCK);
  keyPad.set(k);
  const inner = new Uint8Array(BLOCK + message.length);
  const outer = new Uint8Array(BLOCK + 20);
  for (let i = 0; i < BLOCK; i += 1) {
    inner[i] = keyPad[i] ^ 0x36;
    outer[i] = keyPad[i] ^ 0x5c;
  }
  inner.set(message, BLOCK);
  outer.set(sha1(inner), BLOCK);
  return sha1(outer);
}

// ---- HOTP / TOTP -----------------------------------------------------------

// HOTP: HMAC-SHA-1 over the 8-byte big-endian counter, dynamic truncation,
// modulo 10^digits.
export function hotp(secret, counter, { digits = 6 } = {}) {
  const bytes = decodeOrThrow(secret);
  const c = Math.floor(Number(counter));
  if (!Number.isFinite(c) || c < 0) throw new OtpError("An HOTP counter must be a non-negative number.", "OTP_BAD_COUNTER");
  const msg = new Uint8Array(8);
  const dv = new DataView(msg.buffer);
  dv.setUint32(0, Math.floor(c / 0x100000000));
  dv.setUint32(4, c >>> 0);
  const mac = hmacSha1(bytes, msg);
  const offset = mac[19] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const OTP_PERIOD = 30;
export const OTP_DIGITS = 6;

// TOTP: the six-digit code for a moment in time, plus how long it stays valid.
export function totp(secret, { now = Date.now(), period = OTP_PERIOD, digits = OTP_DIGITS } = {}) {
  const seconds = Math.floor(now / 1000);
  const counter = Math.floor(seconds / period);
  const code = hotp(secret, counter, { digits });
  const secondsRemaining = period - (seconds % period);
  return {
    code,
    counter,
    period,
    digits,
    secondsRemaining,
    generatedAt: now,
    expiresAt: (counter + 1) * period * 1000,
  };
}

// The task-18 headline action: generate the six-digit one-time code from a
// stored Base32 secret. Throws an OtpError with a clear message when the secret
// is malformed.
export function generateOtp(secret, opts = {}) {
  return totp(secret, opts);
}

// Accept a code if it matches the current window (and, by default, one window
// either side — clock skew, same as every authenticator).
export function verifyOtp(secret, code, { now = Date.now(), window = 1, period = OTP_PERIOD, digits = OTP_DIGITS } = {}) {
  const target = String(code == null ? "" : code).replace(/\s/g, "");
  if (!/^\d+$/.test(target)) return false;
  const counter = Math.floor(Math.floor(now / 1000) / period);
  for (let w = -window; w <= window; w += 1) {
    if (hotp(secret, counter + w, { digits }) === target) return true;
  }
  return false;
}

// The otpauth:// URI an authenticator enrols from — useful on the credential
// profile so the secret can be re-enrolled without retyping it.
export function otpAuthUrl({ issuer = "IT-U", account = "", secret, digits = OTP_DIGITS, period = OTP_PERIOD } = {}) {
  const label = encodeURIComponent([issuer, account].filter(Boolean).join(":"));
  const params = new URLSearchParams();
  params.set("secret", normalizeOtpSecret(secret));
  if (issuer) params.set("issuer", issuer);
  if (digits) params.set("digits", String(digits));
  if (period) params.set("period", String(period));
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Mint a fresh Base32 secret (for enrolling a new authenticator).
export function randomOtpSecret(bytes = 20) {
  const n = Math.max(10, Math.min(64, Math.floor(Number(bytes) || 20)));
  const arr = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(arr);
  else for (let i = 0; i < n; i += 1) arr[i] = Math.floor(Math.random() * 256);
  return encodeBase32(arr);
}
