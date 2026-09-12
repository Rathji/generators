// ============================================================================
//  VALIDATION TESTS — T1 State Persistence Layer
//
//  Run in the live page (real localStorage available) or headless (injected
//  memory storage). `runStateTests()` returns [{name, pass, error?}, ...].
//
//  In the page:
//    const m = await import("./src/tests/state.test.js");
//    m.runStateTests()   // -> results array
// ============================================================================

import { StateStore, sessionStore } from "../state.js";

/** A minimal Storage-compatible in-memory backend (has length/key(i)). */
export function memoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
    getItem(k) {
      return map.has(String(k)) ? map.get(String(k)) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
  };
}

export function runStateTests() {
  const results = [];
  const t = (name, fn) => {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  t("round-trips all JSON value types", () => {
    const s = new StateStore("test", { storage: memoryStorage() });
    s.set("str", "hello");
    s.set("num", 42);
    s.set("bool", true);
    s.set("null", null);
    s.set("arr", [1, "two", { three: 3 }]);
    s.set("obj", { a: 1, b: { c: [1, 2, 3] } });
    if (s.get("str") !== "hello") throw new Error("string round-trip failed");
    if (s.get("num") !== 42) throw new Error("number round-trip failed");
    if (s.get("bool") !== true) throw new Error("boolean round-trip failed");
    if (s.get("null") !== null) throw new Error("null round-trip failed");
    if (JSON.stringify(s.get("arr")) !== JSON.stringify([1, "two", { three: 3 }]))
      throw new Error("array round-trip failed");
    if (JSON.stringify(s.get("obj")) !== JSON.stringify({ a: 1, b: { c: [1, 2, 3] } }))
      throw new Error("object round-trip failed");
  });

  t("get returns fallback for missing keys", () => {
    const s = new StateStore("test", { storage: memoryStorage() });
    if (s.get("nope", "fb") !== "fb") throw new Error("explicit fallback not returned");
    if (s.get("nope") !== null) throw new Error("default fallback not returned");
  });

  t("corrupt JSON is treated as missing and cleaned up", () => {
    const st = memoryStorage();
    st.setItem("p:t2:x", "{not json!!");
    const s = new StateStore("t2", { storage: st, prefix: "p" });
    if (s.get("x", "fb") !== "fb") throw new Error("corrupt value leaked through");
    if (st.getItem("p:t2:x") !== null) throw new Error("corrupt key was not cleaned up");
  });

  t("remove + has stay consistent", () => {
    const s = new StateStore("test", { storage: memoryStorage() });
    s.set("k", 1);
    if (!s.has("k")) throw new Error("has() false after set");
    s.remove("k");
    if (s.has("k")) throw new Error("has() true after remove");
  });

  t("namespaces are isolated", () => {
    const st = memoryStorage();
    const a = new StateStore("na", { storage: st, prefix: "p" });
    const b = new StateStore("nb", { storage: st, prefix: "p" });
    a.set("k", "A");
    if (b.get("k") !== null) throw new Error("cross-namespace leak");
    if (a.get("k") !== "A") throw new Error("namespace a lost its value");
  });

  t("clear() only clears its own namespace", () => {
    const st = memoryStorage();
    const a = new StateStore("ca", { storage: st, prefix: "p" });
    const b = new StateStore("cb", { storage: st, prefix: "p" });
    a.set("k1", 1);
    a.set("k2", 2);
    b.set("k1", 99);
    a.clear();
    if (a.get("k1") !== null || a.get("k2") !== null) throw new Error("namespace a not cleared");
    if (b.get("k1") !== 99) throw new Error("namespace b was wrongly cleared");
  });

  t("entries() lists only this namespace's contents", () => {
    const st = memoryStorage();
    const a = new StateStore("ea", { storage: st, prefix: "p" });
    const b = new StateStore("eb", { storage: st, prefix: "p" });
    a.set("x", 1);
    a.set("y", "two");
    b.set("z", true);
    const e = a.entries();
    if (e.x !== 1 || e.y !== "two" || e.z !== undefined)
      throw new Error("entries mismatch: " + JSON.stringify(e));
  });

  t("quota errors are swallowed and reported as false", () => {
    const st = memoryStorage();
    let fail = false;
    const originalSetItem = st.setItem.bind(st);
    st.setItem = (k, v) => {
      if (fail) {
        const e = new Error("QuotaExceededError");
        e.name = "QuotaExceededError";
        throw e;
      }
      originalSetItem(k, v);
    };
    const s = new StateStore("quota", { storage: st });
    if (s.set("ok", 1) !== true) throw new Error("normal write did not return true");
    fail = true;
    if (s.set("full", 1) !== false) throw new Error("quota write did not return false");
    fail = false;
    if (s.get("ok") !== 1) throw new Error("earlier write lost");
  });

  t("persistence survives a fresh store instance (reload simulation)", () => {
    const st = memoryStorage();
    const s1 = new StateStore("persist", { storage: st });
    s1.set("route", "#/app/docs");
    s1.set("session", { draft: "hello", ts: 123 });
    const s2 = new StateStore("persist", { storage: st }); // simulates a reload
    if (s2.get("route") !== "#/app/docs") throw new Error("route not persisted");
    const sess = s2.get("session");
    if (!sess || sess.draft !== "hello" || sess.ts !== 123)
      throw new Error("session object not persisted");
  });

  t("no-storage environment degrades gracefully", () => {
    const s = new StateStore("test", { storage: null });
    if (s.set("k", 1) !== false) throw new Error("set should return false");
    if (s.get("k", "fb") !== "fb") throw new Error("get should return fallback");
    s.remove("k");
    s.clear(); // must not throw
    if (JSON.stringify(s.entries()) !== "{}") throw new Error("entries should be empty");
  });

  // ── Real localStorage (page only) ─────────────────────────────────────────
  let realOk = true;
  try {
    localStorage.setItem("__poffice_probe__", "1");
    localStorage.removeItem("__poffice_probe__");
  } catch {
    realOk = false;
  }

  if (realOk) {
    t("real localStorage round-trip + clear", () => {
      const s = new StateStore("real", { prefix: "__ptest" });
      s.clear();
      s.set("x", { a: [1, 2, 3] });
      const s2 = new StateStore("real", { prefix: "__ptest" });
      const v = s2.get("x");
      if (!v || JSON.stringify(v.a) !== "[1,2,3]") throw new Error("localStorage round-trip failed");
      s2.clear();
      if (s2.get("x") !== null) throw new Error("localStorage clear failed");
    });

    t("sessionStore singleton round-trips", () => {
      sessionStore.remove("__testkey");
      sessionStore.set("__testkey", 7);
      if (sessionStore.get("__testkey") !== 7) throw new Error("sessionStore round-trip failed");
      sessionStore.remove("__testkey");
      if (sessionStore.has("__testkey")) throw new Error("sessionStore remove failed");
    });
  }

  return results;
}
