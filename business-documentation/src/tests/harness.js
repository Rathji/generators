// src/tests/harness.js — tiny zero-dependency test runner.
// Tests run in the live page (see shell.test.js) and report a summary.

export async function runTests(tests) {
  const results = { passed: 0, failed: 0, failures: [] };
  for (const t of tests) {
    try {
      await t.fn();
      results.passed += 1;
    } catch (e) {
      results.failed += 1;
      results.failures.push({ name: t.name, error: String((e && e.message) || e) });
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
