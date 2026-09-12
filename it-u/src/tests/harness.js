// src/tests/harness.js — tiny zero-dependency test runner.
// Tests run in the live page (see shell.test.js) and report a summary.

const SKIP_TAG = "__testSkip";

/** Throw from inside a test to report it as SKIPPED rather than passed/failed. */
export function skip(reason = "") {
  const err = new Error(typeof reason === "string" ? reason : "");
  err[SKIP_TAG] = true;
  throw err;
}

export function isSkip(err) {
  return !!(err && err[SKIP_TAG]);
}

function withTimeout(promise, ms, name) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`test timeout after ${ms}ms: ${name}`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Run a list of `{ name, fn, skip? }` tests.
 *
 * @param {Array} tests
 * @param {object} [opts]
 *   timeoutMs — per-test deadline; a test that never settles fails instead of
 *               wedging the whole sweep (0/undefined disables, default off).
 * @returns {{passed, failed, skipped, total, failures, skips}}
 */
export async function runTests(tests, opts = {}) {
  const timeoutMs = opts.timeoutMs || 0;
  const results = { passed: 0, failed: 0, skipped: 0, total: tests.length, failures: [], skips: [] };
  for (const t of tests) {
    try {
      const declareSkip = typeof t.skip === "function" ? await t.skip() : t.skip;
      if (declareSkip) {
        results.skipped += 1;
        results.skips.push({ name: t.name, reason: typeof declareSkip === "string" ? declareSkip : "" });
        continue;
      }
      await withTimeout(t.fn(), timeoutMs, t.name);
      results.passed += 1;
    } catch (e) {
      if (isSkip(e)) {
        results.skipped += 1;
        results.skips.push({ name: t.name, reason: String((e && e.message) || "") });
      } else {
        results.failed += 1;
        results.failures.push({ name: t.name, error: String((e && e.message) || e) });
      }
    }
  }
  return results;
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

export function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "assertEq"} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
