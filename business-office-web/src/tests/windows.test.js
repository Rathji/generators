// ============================================================================
//  VALIDATION TESTS — T3 Window Manager Interface
//
//  `runWindowTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/windows.test.js");
//    m.runWindowTests()
// ============================================================================

import { WindowManager, windowManager } from "../windows.js";
import { StateStore } from "../state.js";

function memoryStore() {
  const map = new Map();
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => map.set(k, v),
  };
}

export function runWindowTests() {
  const results = [];
  const t = (name, fn) => {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  t("open creates windows with unique ids and defaults", () => {
    const m = new WindowManager();
    const w1 = m.open({ app: "docs", title: "Doc", docId: "d1" });
    const w2 = m.open({ app: "sheets" });
    if (w1.id === w2.id) throw new Error("ids are not unique");
    if (w1.app !== "docs" || w1.title !== "Doc" || w1.docId !== "d1")
      throw new Error("fields are wrong");
    if (!(w1.z > 0) || !(w1.w > 0) || !(w1.h > 0)) throw new Error("geometry missing");
    if (w2.docId !== null) throw new Error("docId should default to null");
  });

  t("opening sets the new window active", () => {
    const m = new WindowManager();
    const w1 = m.open({ app: "docs" });
    const w2 = m.open({ app: "sheets" });
    if (m.getActive().id !== w2.id) throw new Error("new window should be active");
    if (m.count() !== 2) throw new Error("count wrong");
  });

  t("focus switches active and raises z", () => {
    const m = new WindowManager();
    const w1 = m.open({ app: "docs" });
    const w2 = m.open({ app: "sheets" });
    const z2before = w2.z;
    if (!m.focus(w1.id)) throw new Error("focus should return true");
    if (m.getActive().id !== w1.id) throw new Error("active not switched");
    if (!(w1.z > z2before)) throw new Error("focused window z not raised");
    const list = m.list();
    if (list[list.length - 1].id !== w1.id) throw new Error("focused window not top of list");
  });

  t("focus on unknown id returns false", () => {
    const m = new WindowManager();
    if (m.focus("nope") !== false) throw new Error("should return false");
    if (m.getActive() !== null) throw new Error("no active expected");
  });

  t("close removes window; closing active focuses next-highest", () => {
    const m = new WindowManager();
    const w1 = m.open({ app: "docs" });
    const w2 = m.open({ app: "sheets" });
    m.focus(w1.id);
    if (!m.close(w1.id)) throw new Error("close should return true");
    if (m.has(w1.id)) throw new Error("window still present");
    if (m.getActive().id !== w2.id) throw new Error("active not handed to remaining window");
    if (m.close("nope") !== false) throw new Error("closing unknown should return false");
  });

  t("closing the last window leaves no active window", () => {
    const m = new WindowManager();
    const w = m.open({ app: "docs" });
    m.close(w.id);
    if (m.count() !== 0 || m.getActive() !== null) throw new Error("should be empty");
  });

  t("move updates position and persists", () => {
    const store = memoryStore();
    const m = new WindowManager({ store });
    const w = m.open({ app: "docs" });
    m.move(w.id, 120, 90);
    if (m.get(w.id).x !== 120 || m.get(w.id).y !== 90) throw new Error("position not updated");
    const m2 = new WindowManager({ store });
    const w2 = m2.get(w.id);
    if (w2.x !== 120 || w2.y !== 90) throw new Error("position not persisted");
  });

  t("events fire open/focus/close and unsubscribe works", () => {
    const m = new WindowManager();
    const seen = [];
    const off = m.on((e) => seen.push(e.type));
    const w = m.open({});
    m.focus(w.id);
    m.close(w.id);
    if (seen.join(",") !== "open,focus,close") throw new Error("events wrong: " + seen.join(","));
    seen.length = 0;
    off();
    const w2 = m.open({});
    if (seen.length !== 0) throw new Error("unsubscribe failed");
    m.close(w2.id);
  });

  t("persistence: new instance restores windows + active (reload simulation)", () => {
    const store = memoryStore();
    const m1 = new WindowManager({ store });
    const a = m1.open({ app: "docs", title: "A", docId: "dA" });
    m1.open({ app: "sheets", title: "B" });
    m1.focus(a.id);
    const m2 = new WindowManager({ store });
    if (m2.count() !== 2) throw new Error("windows not restored");
    if (m2.get(a.id).title !== "A" || m2.get(a.id).docId !== "dA")
      throw new Error("window data not restored");
    if (m2.getActive().id !== a.id) throw new Error("active window not restored");
  });

  t("absent or corrupt stored data is handled safely", () => {
    const store = memoryStore();
    const m0 = new WindowManager({ store });
    if (m0.count() !== 0) throw new Error("should start empty");
    store.set("windows", "garbage");
    const m1 = new WindowManager({ store });
    if (m1.count() !== 0) throw new Error("garbage should be ignored");
    store.set("windows", { list: [{ id: "w1" }], activeId: "w1" });
    const m2 = new WindowManager({ store });
    const w = m2.get("w1");
    if (!w || w.app !== "docs" || w.w !== 760 || w.z !== 0) throw new Error("sanitize failed");
    if (m2.getActive().id !== "w1") throw new Error("active window not restored");
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
      const store = new StateStore("winreal", { prefix: "__ptest" });
      store.remove("windows");
      const m1 = new WindowManager({ store });
      const w = m1.open({ app: "docs", title: "Real", x: 200, y: 150 });
      const m2 = new WindowManager({ store });
      const got = m2.get(w.id);
      if (!got || got.title !== "Real" || got.x !== 200 || got.y !== 150)
        throw new Error("real persistence failed");
      m2.close(w.id);
      store.remove("windows");
    });

    t("singleton windowManager is live and localStorage-backed", () => {
      if (!(windowManager instanceof WindowManager)) throw new Error("not a manager");
      const before = windowManager.count();
      const w = windowManager.open({ app: "test", title: "singleton-probe" });
      const fresh = new WindowManager({ store: new StateStore("windows") });
      if (!fresh.has(w.id)) throw new Error("singleton window not persisted");
      windowManager.close(w.id);
      if (windowManager.count() !== before) throw new Error("singleton cleanup failed");
    });
  }

  return results;
}
