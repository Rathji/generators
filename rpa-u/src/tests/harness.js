const suites = [];
const runStartHooks = [];
let current = null;

export function onRunStart(fn) {
  if (typeof fn === "function") runStartHooks.push(fn);
}

export function suite(name, fn) {
  const record = { name, tests: [] };
  suites.push(record);
  const previous = current;
  current = record;
  try {
    fn();
  } finally {
    current = previous;
  }
  return record;
}

export function test(name, fn) {
  if (!current) throw new Error(`test("${name}") was called outside of a suite()`);
  current.tests.push({ name, fn });
}

export function listSuites() {
  return suites.map((s) => ({ name: s.name, tests: s.tests.map((t) => t.name) }));
}

export function clearRegistry() {
  suites.length = 0;
  current = null;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message || "Expected a truthy value");
}

export function assertEquals(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message ? message + ": " : ""}expected ${e} but got ${a}`);
}

export function assertMatch(value, pattern, message) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${message ? message + ": " : ""}${JSON.stringify(value)} does not match ${pattern}`);
  }
}

export function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  if (!threw) throw new Error(message || "Expected function to throw");
}

export async function runTests({ filter } = {}) {
  const started = performance.now();
  const results = [];
  let passed = 0;
  let failed = 0;
  const matches = (name) => !filter || String(name).toLowerCase().includes(String(filter).toLowerCase());

  for (const hook of runStartHooks) await hook();

  for (const s of suites) {
    const tests = [];
    for (const t of s.tests) {
      if (!matches(s.name) && !matches(t.name)) continue;
      const t0 = performance.now();
      try {
        await t.fn();
        tests.push({ name: t.name, ok: true, durationMs: Math.round(performance.now() - t0) });
        passed++;
      } catch (error) {
        tests.push({ name: t.name, ok: false, error: error && error.message ? error.message : String(error), durationMs: Math.round(performance.now() - t0) });
        failed++;
      }
    }
    if (tests.length) results.push({ name: s.name, tests });
  }

  return {
    total: passed + failed,
    passed,
    failed,
    suites: results,
    durationMs: Math.round(performance.now() - started),
  };
}
