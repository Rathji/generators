// ============================================================================
//  VALIDATION TESTS — T2 Global Document Registry
//
//  `runRegistryTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/registry.test.js");
//    m.runRegistryTests()
// ============================================================================

import { DocumentRegistry, documentRegistry } from "../registry.js";
import { StateStore } from "../state.js";

/** Minimal {get,set} store for persistence tests. */
function memoryStore() {
  const map = new Map();
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => map.set(k, v),
  };
}

export function runRegistryTests() {
  const results = [];
  const t = (name, fn) => {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  t("create returns docs with unique ids + content/meta/timestamps", () => {
    const r = new DocumentRegistry();
    const ids = new Set();
    const doc = r.create({ app: "docs", content: "hello", meta: { name: "Doc 1" } });
    for (let i = 0; i < 25; i++) ids.add(r.create({ app: "sheets" }).id);
    ids.add(doc.id);
    if (ids.size !== 26) throw new Error("ids are not unique");
    if (doc.app !== "docs" || doc.content !== "hello" || doc.meta.name !== "Doc 1")
      throw new Error("fields are wrong");
    if (!(doc.createdAt > 0) || !(doc.updatedAt > 0)) throw new Error("timestamps missing");
  });

  t("get/has round-trip", () => {
    const r = new DocumentRegistry();
    const d = r.create({});
    if (r.get(d.id) !== d) throw new Error("get failed");
    if (!r.has(d.id)) throw new Error("has failed");
    if (r.get("missing-id") !== null) throw new Error("missing id should be null");
  });

  t("update changes content, merges meta, bumps updatedAt", () => {
    const r = new DocumentRegistry();
    const d = r.create({ app: "docs", content: "a", meta: { name: "N", color: "red" } });
    const before = d.updatedAt;
    const updated = r.update(d.id, { content: "b", meta: { color: "blue" } });
    if (updated.content !== "b") throw new Error("content not updated");
    if (updated.meta.name !== "N" || updated.meta.color !== "blue")
      throw new Error("meta not merged");
    if (updated.updatedAt < before) throw new Error("updatedAt not bumped");
  });

  t("update returns null for unknown id", () => {
    const r = new DocumentRegistry();
    if (r.update("nope", { content: "x" }) !== null) throw new Error("should return null");
  });

  t("remove works and unknown id returns false", () => {
    const r = new DocumentRegistry();
    const d = r.create({});
    if (!r.remove(d.id)) throw new Error("remove should return true");
    if (r.has(d.id)) throw new Error("still present after remove");
    if (r.remove(d.id) !== false) throw new Error("double remove should return false");
  });

  t("find by predicate", () => {
    const r = new DocumentRegistry();
    const a = r.create({ app: "docs", meta: { name: "Alpha" } });
    r.create({ app: "sheets" });
    const f = r.find((d) => d.meta.name === "Alpha");
    if (!f || f.id !== a.id) throw new Error("find failed");
    if (r.find((d) => d.app === "mail") !== null) throw new Error("find should be null");
  });

  t("list order = insertion order; listByApp filters; count", () => {
    const r = new DocumentRegistry();
    const d1 = r.create({ app: "docs" });
    const d2 = r.create({ app: "sheets" });
    const d3 = r.create({ app: "docs" });
    const all = r.list();
    if (all[0].id !== d1.id || all[1].id !== d2.id || all[2].id !== d3.id)
      throw new Error("insertion order wrong");
    const docs = r.listByApp("docs");
    if (docs.length !== 2 || docs[0].id !== d1.id) throw new Error("listByApp wrong");
    if (r.count() !== 3) throw new Error("count wrong");
  });

  t("events fire create/update/remove and unsubscribe stops them", () => {
    const r = new DocumentRegistry();
    const seen = [];
    const off = r.on((e) => seen.push(e.type + ":" + e.doc.id));
    const d = r.create({});
    r.update(d.id, { content: "x" });
    r.remove(d.id);
    if (seen.join(",") !== "create:" + d.id + ",update:" + d.id + ",remove:" + d.id)
      throw new Error("event sequence wrong: " + seen.join(","));
    seen.length = 0;
    off();
    r.create({});
    if (seen.length !== 0) throw new Error("unsubscribe failed");
  });

  t("persistence: new instance restores open docs (reload simulation)", () => {
    const store = memoryStore();
    const r1 = new DocumentRegistry({ store });
    const d = r1.create({ app: "docs", content: { p: "some text" }, meta: { name: "Q3 report" } });
    const r2 = new DocumentRegistry({ store }); // reload
    const got = r2.get(d.id);
    if (!got) throw new Error("doc not restored");
    if (got.content.p !== "some text") throw new Error("content not restored");
    if (got.meta.name !== "Q3 report") throw new Error("meta not restored");
    if (r2.count() !== 1) throw new Error("count wrong after restore");
  });

  t("removal persists across instances", () => {
    const store = memoryStore();
    const r1 = new DocumentRegistry({ store });
    const d = r1.create({});
    r1.remove(d.id);
    const r2 = new DocumentRegistry({ store });
    if (r2.has(d.id)) throw new Error("removed doc came back");
  });

  t("absent or corrupt stored data is handled safely", () => {
    const store = memoryStore();
    const r0 = new DocumentRegistry({ store });
    if (r0.count() !== 0) throw new Error("should start empty");
    store.set("open", "garbage");
    const r1 = new DocumentRegistry({ store });
    if (r1.count() !== 0) throw new Error("garbage should be ignored");
    store.set("open", [{ id: "x1" }]);
    const r2 = new DocumentRegistry({ store });
    const d = r2.get("x1");
    if (!d || d.app !== "docs" || d.content !== "" || typeof d.meta !== "object")
      throw new Error("sanitize failed");
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
    t("persists through real localStorage (page only)", () => {
      const store = new StateStore("regreal", { prefix: "__ptest" });
      store.remove("open");
      const r1 = new DocumentRegistry({ store });
      const d = r1.create({ app: "docs", content: "hi", meta: { name: "X" } });
      const r2 = new DocumentRegistry({ store });
      const got = r2.get(d.id);
      if (!got || got.content !== "hi" || got.meta.name !== "X")
        throw new Error("real persistence failed");
      r2.remove(d.id);
      store.remove("open");
    });

    t("singleton documentRegistry is live and localStorage-backed", () => {
      if (!(documentRegistry instanceof DocumentRegistry)) throw new Error("not a registry");
      const before = documentRegistry.count();
      const d = documentRegistry.create({ app: "test", meta: { name: "singleton-probe" } });
      const fresh = new DocumentRegistry({ store: new StateStore("registry") });
      if (!fresh.has(d.id)) throw new Error("singleton doc not persisted");
      documentRegistry.remove(d.id);
      if (documentRegistry.count() !== before) throw new Error("singleton cleanup failed");
    });
  }

  return results;
}
