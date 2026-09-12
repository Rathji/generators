// src/tests/credential-tools.test.js — validation tests for Phase 4 task 19
// (password generation & rotation hooks). Run in the live page:
//   await import("./src/tests/credential-tools.test.js").then((m) => m.run())
//
// Covers: password generation (length, character classes, ambiguous-character
// avoidance, sensible clamping, deterministic under an injected RNG); the
// strength estimate; the rotation method/product catalogs and rotationCapability
// (manual vs a named connected product — and the honest "needs a product"
// state); the rotation schedule (untracked, upcoming, overdue) from a timestamp
// OR a date string; and the explicit disclaimer that rotation depends on the
// connected product.

import { runTests, assert, assertEq } from "./harness.js";
import {
  generatePassword,
  passwordStrength,
  CREDENTIAL_CHARSETS,
  ROTATION_METHODS,
  ROTATION_PRODUCTS,
  ROTATION_DISCLAIMER,
  DEFAULT_ROTATION_DAYS,
  rotationMethod,
  rotationProduct,
  rotationCapability,
  rotationStatus,
  rotationSummary,
} from "../framework/credentialTools.js";

const rng = (seed = 1) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const AMBIGUOUS = /[Il1O0oS5B8Z2G6]/;

export async function run() {
  return runTests([
    {
      name: "generatePassword honours length, classes and ambiguous-character avoidance",
      fn: () => {
        const pw = generatePassword({ length: 24, random: rng(7) });
        assertEq(pw.length, 24, "requested length honoured");
        assert(/[a-z]/.test(pw), "has a lowercase letter");
        assert(/[A-Z]/.test(pw), "has an uppercase letter");
        assert(/[0-9]/.test(pw), "has a digit");
        assert(/[^A-Za-z0-9]/.test(pw), "has a symbol");

        const noSymbols = generatePassword({ length: 20, symbols: false, random: rng(3) });
        assert(!/[^A-Za-z0-9]/.test(noSymbols), "symbols excluded when not requested");
        const digitsOnly = generatePassword({ length: 12, lowercase: false, uppercase: false, symbols: false, digits: true, random: rng(5) });
        assert(/^[0-9]+$/.test(digitsOnly), "a single requested class is honoured");

        const noAmbiguous = generatePassword({ length: 40, random: rng(11) });
        for (const c of noAmbiguous) assert(!AMBIGUOUS.test(c), "no ambiguous character produced: " + c);

        assert(generatePassword({ length: 2, random: rng(1) }).length >= 4, "length clamped to a usable minimum");
        assert(generatePassword({ length: 5000, random: rng(1) }).length <= 128, "length clamped to a sane maximum");
        assert(CREDENTIAL_CHARSETS.symbols.includes("!"), "symbols charset present");
      },
    },
    {
      name: "passwordStrength scores weak and strong secrets and reports entropy",
      fn: () => {
        const weak = passwordStrength("password");
        assert(weak.score <= 1, "a common-ish word scores low");
        assert(weak.entropyBits > 0, "entropy estimated");
        assertEq(passwordStrength("").score, 0, "an empty password scores zero");
        assertEq(passwordStrength("").label, "Empty", "empty label");
        const strong = passwordStrength(generatePassword({ length: 24, random: rng(9) }));
        assert(strong.score >= 3, "a 24-character mixed secret scores strong or better");
        assert(strong.entropyBits > weak.entropyBits, "the strong secret has more entropy");
        assert(typeof strong.symbols === "number" && strong.symbols >= 26, "alphabet size reported");
      },
    },
    {
      name: "the rotation catalogs and rotationCapability describe a workable path honestly",
      fn: () => {
        assert(ROTATION_METHODS.some((m) => m.id === "manual"), "manual rotation path");
        assert(ROTATION_METHODS.some((m) => m.id === "connected-product"), "connected-product rotation path");
        for (const p of ["1password", "bitwarden", "keeper", "hashicorp-vault", "azure-key-vault", "aws-secrets-manager"]) {
          assert(ROTATION_PRODUCTS.some((x) => x.id === p), "product " + p);
        }
        assertEq(rotationMethod("manual").id, "manual", "method lookup");
        assertEq(rotationProduct("1password").label, "1Password", "product lookup");

        const manual = rotationCapability({ rotationMethod: "manual" });
        assertEq(manual.automated, false, "manual is not automated");
        assertEq(manual.ready, true, "manual path is ready");
        assert(/manual/i.test(manual.summary), "manual summary");

        const needsProduct = rotationCapability({ rotationMethod: "connected-product" });
        assertEq(needsProduct.automated, true, "connected product is automated");
        assertEq(needsProduct.needsProduct, true, "but needs a product named");
        assertEq(needsProduct.ready, false, "so it is not ready yet");

        const ready = rotationCapability({ rotationMethod: "connected-product", rotationProduct: "bitwarden" });
        assertEq(ready.ready, true, "ready once a product is named");
        assert(ready.summary.includes("Bitwarden"), "summary names the product");

        const defaulted = rotationCapability({});
        assertEq(defaulted.method.id, "manual", "defaults to manual");
      },
    },
    {
      name: "rotationStatus reports untracked, upcoming and overdue schedules, from timestamps or dates",
      fn: () => {
        const untracked = rotationStatus({});
        assertEq(untracked.tracked, false, "no date → untracked");
        assertEq(untracked.due, false, "not due");
        assertEq(untracked.intervalDays, DEFAULT_ROTATION_DAYS, "default interval");

        const DAY = 86400000;
        const now = Date.parse("2026-09-10T00:00:00Z");
        const upcoming = rotationStatus({ rotatedAt: now - 10 * DAY, rotateEveryDays: 90 }, { now });
        assertEq(upcoming.tracked, true, "tracked");
        assertEq(upcoming.due, false, "not due yet");
        assertEq(upcoming.daysUntil, 80, "80 days left");
        assertEq(upcoming.overdue, false, "not overdue");

        const overdue = rotationStatus({ rotatedAt: now - 100 * DAY, rotateEveryDays: 90 }, { now });
        assertEq(overdue.due, true, "due");
        assertEq(overdue.overdue, true, "overdue");
        assertEq(overdue.overdueDays, 10, "10 days overdue");

        // A plain YYYY-MM-DD date (how the credential record stores it) works.
        const fromString = rotationStatus({ rotatedAt: "2026-01-01", rotateEveryDays: 30 }, { now });
        assertEq(fromString.tracked, true, "date string parsed");
        assertEq(fromString.overdue, true, "date string is overdue here");

        assert(rotationSummary({ rotationMethod: "manual", rotatedAt: now - 100 * DAY, rotateEveryDays: 90 }, { now }).includes("Overdue"), "summary says overdue");
        assert(rotationSummary({}, { now }).includes("No rotation date"), "summary admits no schedule");
      },
    },
    {
      name: "the disclaimer states plainly that rotation depends on the connected product",
      fn: () => {
        assert(/depends on the connected product/i.test(ROTATION_DISCLAIMER), "says capability depends on the product");
        assert(/does not change passwords/i.test(ROTATION_DISCLAIMER), "says IT-U does not itself rotate");
        const cap = rotationCapability({ rotationMethod: "connected-product", rotationProduct: "1password" });
        assertEq(cap.note, ROTATION_DISCLAIMER, "the capability carries the disclaimer");
      },
    },
  ]);
}
