// Alpha: The Gathering — test harness & game log (roadmap task 3).
// Globals exposed: window.Test (assert/assertEqual/assertThrows/test/run/reset),
// window.gameLog(msg, kind), window.deepEqual.
(function () {
  "use strict";

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a !== "object") return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  function gameLog(msg, kind) {
    const el = document.getElementById("gameLog");
    if (el) {
      const line = document.createElement("div");
      line.className = "log-line" + (kind ? " log-" + kind : "");
      line.textContent = msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
    console.log("[game]", msg);
  }

  const Test = {
    _tests: [],
    _results: [],

    assert(cond, msg) {
      if (!cond) throw new Error("Assertion failed: " + (msg || "condition was false"));
    },

    assertEqual(actual, expected, msg) {
      if (!deepEqual(actual, expected)) {
        const prefix = msg ? msg + " — " : "";
        throw new Error(prefix + "expected " + JSON.stringify(expected) + " but got " + JSON.stringify(actual));
      }
    },

    assertThrows(fn, msg) {
      let threw = false;
      try { fn(); } catch (e) { threw = true; }
      if (!threw) throw new Error("Expected to throw (" + (msg || "no description") + ") but it did not");
    },

    test(name, fn) {
      Test._tests.push({ name, fn });
    },

    async run() {
      Test._results = [];
      for (const t of Test._tests) {
        try {
          await t.fn();
          Test._results.push({ name: t.name, ok: true });
        } catch (e) {
          Test._results.push({ name: t.name, ok: false, error: e });
        }
      }
      const passed = Test._results.filter((r) => r.ok).length;
      const failed = Test._results.length - passed;
      gameLog("Test run: " + passed + " passed, " + failed + " failed");
      for (const r of Test._results) {
        if (r.ok) {
          gameLog("  PASS " + r.name);
        } else {
          gameLog("  FAIL " + r.name + ": " + r.error.message, "fail");
          console.error("[test] FAIL", r.name, r.error);
        }
      }
      if (failed > 0) throw new Error(failed + " test(s) failed");
      return { passed, failed, failures: [] };
    },

    reset() {
      Test._tests = [];
      Test._results = [];
    }
  };

  window.Test = Test;
  window.gameLog = gameLog;
  window.deepEqual = deepEqual;
})();
