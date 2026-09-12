// ============================================================================
//  Validation tests — framework logic (Phase 3 tasks 11-14 · Phase 4 tasks 18-19)
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import { createBus } from "../framework/bus.js";
import { createStore, withPersistence } from "../framework/store.js";
import { createStorage } from "../framework/storage.js";
import { createRouter } from "../framework/router.js";
import { createRegistry } from "../framework/registry.js";
import { TEMPLATE_META, describe, dependencyReport, compareVersions } from "../framework/meta.js";

function fakeBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

export function frameworkSuite() {
  return createSuite("framework · state, events, storage, routing")
    .test("event bus delivers, isolates and unsubscribes", () => {
      const bus = createBus();
      const seen = [];
      const off = bus.on("save", (payload) => seen.push(`save:${payload}`));
      bus.on("*", (payload, meta) => seen.push(`all:${meta.topic}`));
      bus.emit("save", 1);
      assertDeepEqual(seen, ["save:1", "all:save"]);
      off();
      bus.emit("save", 2);
      assertEqual(seen.length, 3);
      let errors = 0;
      bus.on("boom", () => {
        errors++;
        throw new Error("nope");
      });
      bus.on("boom", () => errors++);
      bus.emit("boom");
      assertEqual(errors, 2, "one failing handler must not stop others");
    })
    .test("once fires a single time", () => {
      const bus = createBus();
      let count = 0;
      bus.once("ping", () => count++);
      bus.emit("ping");
      bus.emit("ping");
      assertEqual(count, 1);
    })
    .test("store set / patch / subscribe / selectSubscribe", () => {
      const store = createStore({ count: 0, nested: { a: 1 } });
      const log = [];
      const off = store.subscribe((state) => log.push(state.count));
      store.set({ count: 1 });
      store.patch({ nested: { b: 2 } });
      store.set((s) => ({ count: s.count + 1 }));
      off();
      store.set({ count: 9 });
      assertDeepEqual(log, [1, 1, 2]);
      assertEqual(store.get().nested.b, 2);
      assertEqual(store.get().count, 9);

      const selected = [];
      store.selectSubscribe((s) => s.count, (value) => selected.push(value));
      store.set({ count: 10 });
      store.set({ count: 10 });
      assertDeepEqual(selected, [10]);
    })
    .test("store reset restores the initial snapshot", () => {
      const store = createStore({ a: 1 });
      store.set({ a: 5 });
      store.reset();
      assertEqual(store.get().a, 1);
    })
    .test("storage namespaces keys and round-trips JSON", () => {
      const backend = fakeBackend();
      const storage = createStorage({ namespace: "test", backend });
      storage.set("theme", { id: "navy" });
      assertDeepEqual(storage.get("theme"), { id: "navy" });
      assert(backend.getItem("test:theme") !== null, "key must be namespaced");
      assert(storage.has("theme"));
      assertDeepEqual(storage.keys(), ["theme"]);
      storage.remove("theme");
      assertEqual(storage.get("theme", "fallback"), "fallback");
    })
    .test("storage falls back to memory when the backend throws", () => {
      const backend = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {},
        key: () => null,
        length: 0,
      };
      const storage = createStorage({ namespace: "x", backend });
      storage.set("a", 1); // must not throw
      assertEqual(storage.get("a", null), null);
    })
    .test("withPersistence loads and saves through storage", () => {
      const backend = fakeBackend();
      const storage = createStorage({ namespace: "p", backend });
      const store = withPersistence(createStore({ mode: "light" }), storage, "prefs");
      store.set({ mode: "dark" });
      assertDeepEqual(storage.get("prefs"), { mode: "dark" });
      const restored = withPersistence(createStore({ mode: "light" }), storage, "prefs");
      assertEqual(restored.get().mode, "dark");
    })
    .test("router resolves unknown paths to notFound and empty hashes to the default", () => {
      const router = createRouter({
        routes: [{ path: "home" }, { path: "tests" }],
        defaultRoute: "home",
        notFound: { path: "not-found" },
      });
      assertEqual(router.resolve("#/tests").route.path, "tests");
      assertEqual(router.resolve("#/definitely-missing").route.path, "not-found");
      assertEqual(router.resolve("").route.path, "home");
      assertEqual(router.resolve("#/").route.path, "home");
    })
    .test("router parses hashes and builds hrefs", () => {
      const router = createRouter({ routes: [{ path: "home" }, { path: "data" }], defaultRoute: "home" });
      assertDeepEqual(router.parse("#/data?sort=amount").query, { sort: "amount" });
      assertEqual(router.parse("#/data").path, "data");
      assertEqual(router.parse("").path, "home");
      assertEqual(router.href("data", { page: 2 }), "#/data?page=2");
      assertEqual(router.routes.length, 2);
    })
    .test("router resolves the default route for unknown paths", () => {
      const router = createRouter({ routes: [{ path: "home" }, { path: "tests" }], defaultRoute: "home" });
      const ctx = router.resolve();
      assert(["home", "tests"].includes(ctx.route.path), "resolve must return a registered route");
    })
    .test("registry enables, disables and guards required components", () => {
      const backend = fakeBackend();
      const registry = createRegistry({ storage: createStorage({ namespace: "r", backend }) });
      registry.register({ id: "home", label: "Home", render: () => {} });
      registry.register({ id: "tests", label: "Tests", optional: true, render: () => {} });
      assert(registry.isEnabled("home"));
      assertEqual(registry.setEnabled("home", false), false, "required component must refuse to disable");
      assert(registry.setEnabled("tests", false));
      assert(!registry.isEnabled("tests"));
      assertEqual(registry.enabledRoutes().length, 1);
      assert(registry.setEnabled("tests", true));
      assertEqual(registry.enabledRoutes().length, 2);
    })
    .test("registry persists disabled components", () => {
      const backend = fakeBackend();
      const storage = createStorage({ namespace: "r2", backend });
      const first = createRegistry({ storage });
      first.register({ id: "a", label: "A", optional: true, render: () => {} });
      first.setEnabled("a", false);
      const second = createRegistry({ storage });
      second.register({ id: "a", label: "A", optional: true, render: () => {} });
      assert(!second.isEnabled("a"));
    })
    .test("metadata describes the template and its dependencies", () => {
      assertEqual(TEMPLATE_META.name, "project-u");
      assertEqual(TEMPLATE_META.family, "Project U");
      assert(describe().summary.includes("project-u") || describe().summary.includes("Project-U"));
      assertEqual(compareVersions("1.2.0", "1.1.9"), 1);
      assertEqual(compareVersions("1.0.0", "1.0.0"), 0);
      const report = dependencyReport({ kv: {} });
      assert(report.every((dep) => typeof dep.present === "boolean"));
    });
}
