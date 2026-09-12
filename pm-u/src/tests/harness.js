// ============================================================================
//  Project U — validation test harness
//  A tiny in-page test runner (no build step). Suites are plain functions that
//  register named async tests; `runSuites()` returns structured results that
//  the Tests view renders and `window.PU.tests.runAll()` can inspect.
// ============================================================================

export function assert(condition, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(message || `Expected ${format(expected)}, received ${format(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message || `Expected ${b}, received ${a}`);
}

export function assertThrows(fn, message = "Expected function to throw") {
  let threw = false;
  try {
    fn();
  } catch (_) {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

function format(value) {
  try {
    return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

export function createSuite(name) {
  const tests = [];
  return {
    name,
    tests,
    test(title, fn) {
      tests.push({ title, fn });
      return this;
    },
    async run() {
      const results = [];
      for (const test of tests) {
        const started = performance.now();
        try {
          await test.fn();
          results.push({ name: test.title, ok: true, ms: Math.round((performance.now() - started) * 100) / 100 });
        } catch (error) {
          results.push({
            name: test.title,
            ok: false,
            ms: Math.round((performance.now() - started) * 100) / 100,
            error: error && error.message ? error.message : String(error),
          });
        }
      }
      return { name, results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    },
  };
}

export async function runSuites(suites) {
  const started = performance.now();
  const suiteResults = [];
  // Some tests deliberately exercise error paths (thrown handlers, blocked
  // storage). Silence the console while the suite runs so expected failures
  // don't look like real problems, then restore it.
  const realError = console.error;
  const realWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    for (const suite of suites) suiteResults.push(await suite.run());
  } finally {
    console.error = realError;
    console.warn = realWarn;
  }
  const passed = suiteResults.reduce((total, s) => total + s.passed, 0);
  const failed = suiteResults.reduce((total, s) => total + s.failed, 0);
  return {
    suites: suiteResults,
    passed,
    failed,
    total: passed + failed,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    ok: failed === 0,
  };
}
