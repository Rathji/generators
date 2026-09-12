// src/tests/otp.test.js — validation tests for Phase 4 task 18 (OTP generation).
// Run in the live page:
//   await import("./src/tests/otp.test.js").then((m) => m.run())
//
// Covers: Base32 normalisation + decoding against the canonical RFC 4226 test
// secret; the RFC HOTP test vectors; TOTP producing the six-digit code for a
// moment with a correct countdown; verification across the skew window; the
// secret validator's clear errors for malformed secrets (bad characters, too
// short, empty); generateOtp's typed failure; the otpauth:// enrolment URL; and
// fresh-secret minting.

import { runTests, assert, assertEq } from "./harness.js";
import {
  normalizeOtpSecret,
  decodeBase32,
  encodeBase32,
  validateOtpSecret,
  isValidOtpSecret,
  otpSecretError,
  hotp,
  totp,
  generateOtp,
  verifyOtp,
  otpAuthUrl,
  randomOtpSecret,
  OtpError,
} from "../framework/otp.js";

// RFC 4226's ASCII secret "12345678901234567890" in Base32.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const ASCII = "12345678901234567890";

export async function run() {
  return runTests([
    {
      name: "Base32 normalisation and decoding match the canonical test secret",
      fn: () => {
        assertEq(normalizeOtpSecret(" jbsw-y3dp ehpk3pxp= "), "JBSWY3DPEHPK3PXP", "case/spaces/hyphens/padding stripped");
        const bytes = decodeBase32(SECRET);
        assertEq(bytes.length, 20, "20 bytes");
        assertEq([...bytes].map((b) => String.fromCharCode(b)).join(""), ASCII, "decodes to the ASCII secret");
        const round = encodeBase32(decodeBase32(SECRET));
        assertEq(normalizeOtpSecret(round), SECRET, "encode/decode round-trips");
      },
    },
    {
      name: "HOTP reproduces the RFC 4226 test vectors",
      fn: () => {
        assertEq(hotp(SECRET, 0), "755224", "counter 0");
        assertEq(hotp(SECRET, 1), "287082", "counter 1");
        assertEq(hotp(SECRET, 2), "359152", "counter 2");
        assertEq(hotp(SECRET, 3), "969429", "counter 3");
      },
    },
    {
      name: "TOTP generates a six-digit code with the right countdown, and verification allows skew",
      fn: () => {
        const t = totp(SECRET, { now: 59000 });
        assertEq(t.counter, 1, "counter at 59s");
        assertEq(t.code, "287082", "six-digit code at 59s");
        assertEq(t.digits, 6, "six digits");
        assertEq(t.secondsRemaining, 1, "one second left in the window");
        assertEq(t.expiresAt, 60000, "window ends at 60s");
        assertEq(generateOtp(SECRET, { now: 59000 }).code, "287082", "generateOtp is the headline action");
        assertEq(generateOtp(SECRET, { now: 0 }).code, "755224", "counter 0 at the epoch");

        assert(verifyOtp(SECRET, "287082", { now: 59000 }), "current code accepted");
        assert(verifyOtp(SECRET, "287 082", { now: 59000 }), "spaces in the typed code tolerated");
        assert(verifyOtp(SECRET, "755224", { now: 59000, window: 1 }), "previous window accepted within skew");
        assert(!verifyOtp(SECRET, "755224", { now: 91000, window: 1 }), "a stale code is rejected");
        assert(!verifyOtp(SECRET, "000000", { now: 59000 }), "a wrong code is rejected");
        assert(!verifyOtp(SECRET, "abc123", { now: 59000 }), "a non-numeric code is rejected");
      },
    },
    {
      name: "the secret validator gives a clear reason for every way a secret can be malformed",
      fn: () => {
        assert(isValidOtpSecret("JBSWY3DPEHPK3PXP"), "a normal authenticator secret is valid");
        assert(validateOtpSecret("JBSW Y3DP EHPK 3PXP").ok, "spaces are tolerated");

        const empty = validateOtpSecret("");
        assert(!empty.ok, "empty refused");
        assert(/required/i.test(empty.errors.join(" ")), "empty reason");

        const bad = validateOtpSecret("JBSW1Y3D8EHPK3PXP0");
        assert(!bad.ok, "invalid characters refused");
        assert(/Base32/.test(bad.errors.join(" ")), "explains the Base32 alphabet");
        assert(/0, 1, 8 or 9/.test(bad.errors.join(" ")), "explains Base32 excludes 0/1/8/9");

        const short = validateOtpSecret("ABC234");
        assert(!short.ok, "too-short refused");
        assert(/at least 16/.test(short.errors.join(" ")), "explains the minimum length");

        assert(/Base32/.test(String(otpSecretError("nope!"))), "otpSecretError surfaces the reason");
        assertEq(otpSecretError("JBSWY3DPEHPK3PXP"), null, "no error for a good secret");
      },
    },
    {
      name: "generateOtp fails with a typed, clear error rather than a wrong code",
      fn: () => {
        let threw = null;
        try {
          generateOtp("not-a-valid-secret");
        } catch (e) {
          threw = e;
        }
        assert(threw instanceof OtpError, "throws an OtpError");
        assertEq(threw.code, "OTP_INVALID_SECRET", "typed code");
        assert(/Base32/.test(threw.message), "message explains the problem");
      },
    },
    {
      name: "the otpauth enrolment URL and fresh-secret minting behave",
      fn: () => {
        const url = otpAuthUrl({ issuer: "IT-U", account: "admin@acme.test", secret: "JBSWY3DPEHPK3PXP" });
        assert(url.startsWith("otpauth://totp/"), "otpauth scheme");
        assert(url.includes("secret=JBSWY3DPEHPK3PXP"), "carries the secret");
        assert(url.includes("issuer=IT-U"), "carries the issuer");
        assert(url.includes("digits=6") && url.includes("period=30"), "carries the standard parameters");

        const a = randomOtpSecret();
        const b = randomOtpSecret();
        assert(isValidOtpSecret(a), "minted secret is valid");
        assert(a.length >= 16, "minted secret is long enough");
        assertEq(a.length, 32, "20 bytes → 32 Base32 characters");
        assert(a !== b, "two minted secrets differ");
        assert(decodeBase32(a).length > 0, "minted secret decodes");
      },
    },
  ]);
}
