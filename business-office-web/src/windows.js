// ============================================================================
//  WINDOW MANAGER INTERFACE  (T3)
//
//  Virtual application windows: creation, focusing, closing, z-ordering and
//  moving. A window is UI chrome bound to a document in the registry (docId);
//  closing a window never deletes the underlying document — it stays in the
//  registry for reopening (see T2 / T13).
//
//  Optional persistence: pass a StateStore-like {get, set} object and the
//  manager restores windows + the active window on construction and writes
//  through on every change — so your desktop layout survives reloads (T1).
//
//  Events: manager.on(fn) -> fn({ type: "open"|"close"|"focus"|"move", win })
//  returns an unsubscribe function.
// ============================================================================

import { StateStore } from "./state.js";

let winCounter = 0;

function generateId() {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : null;
  return (
    uuid ||
    "win_" + Date.now().toString(36) + "_" + ++winCounter + "_" + Math.random().toString(36).slice(2, 8)
  );
}

export class WindowManager {
  /**
   * @param {{store?: {get: Function, set: Function}}} [opts]  persistence store
   */
  constructor(opts = {}) {
    this.store = opts.store || null;
    this.windows = new Map(); // id -> win
    this.activeId = null;
    this.listeners = new Set();
    this._zCounter = 0;
    if (this.store) this._restore();
  }

  _nextId() {
    let id;
    do {
      id = generateId();
    } while (this.windows.has(id));
    return id;
  }

  _emit(type, win) {
    for (const fn of this.listeners) {
      try {
        fn({ type, win, manager: this });
      } catch {
        /* a listener must not break the manager */
      }
    }
  }

  _persist() {
    if (!this.store) return;
    this.store.set("windows", { list: [...this.windows.values()], activeId: this.activeId });
  }

  _restore() {
    const data = this.store.get("windows");
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.list)) {
      let maxZ = 0;
      for (const raw of data.list) {
        if (!raw || !raw.id || this.windows.has(raw.id)) continue;
        const win = sanitizeWin(raw);
        this.windows.set(win.id, win);
        if (win.z > maxZ) maxZ = win.z;
      }
      this._zCounter = maxZ;
    }
    if (data.activeId && this.windows.has(data.activeId)) {
      this.activeId = data.activeId;
    } else {
      const highest = [...this.windows.values()].sort((a, b) => b.z - a.z)[0];
      this.activeId = highest ? highest.id : null;
    }
  }

  /** Create a window (optionally bound to a registry docId) and focus it. */
  open({ docId = null, app = "docs", title = "Untitled", x, y, w = 760, h = 520 } = {}) {
    const n = this.windows.size;
    const win = {
      id: this._nextId(),
      docId,
      app,
      title,
      x: x !== undefined ? x : 60 + (n % 6) * 30,
      y: y !== undefined ? y : 44 + (n % 6) * 26,
      w,
      h,
      z: ++this._zCounter,
    };
    this.windows.set(win.id, win);
    this.activeId = win.id;
    this._persist();
    this._emit("open", win);
    return win;
  }

  /** Bring a window to the front and make it active. Returns true if focused. */
  focus(id) {
    const win = this.windows.get(id);
    if (!win) return false;
    win.z = ++this._zCounter;
    this.activeId = id;
    this._persist();
    this._emit("focus", win);
    return true;
  }

  /** Close a window (the underlying registry doc stays). Returns true if closed. */
  close(id) {
    const win = this.windows.get(id);
    if (!win) return false;
    this.windows.delete(id);
    if (this.activeId === id) {
      let next = null;
      let maxZ = -1;
      for (const w of this.windows.values()) {
        if (w.z > maxZ) {
          maxZ = w.z;
          next = w;
        }
      }
      this.activeId = next ? next.id : null;
      if (next) this._emit("focus", next);
    }
    this._persist();
    this._emit("close", win);
    return true;
  }

  /** Move a window to new (x, y). Returns the window, or null. */
  move(id, x, y) {
    const win = this.windows.get(id);
    if (!win) return null;
    win.x = Math.round(x);
    win.y = Math.round(y);
    this._persist();
    this._emit("move", win);
    return win;
  }

  get(id) {
    return this.windows.get(id) || null;
  }

  has(id) {
    return this.windows.has(id);
  }

  /** All windows, front-to-back (highest z last). */
  list() {
    return [...this.windows.values()].sort((a, b) => a.z - b.z);
  }

  count() {
    return this.windows.size;
  }

  getActive() {
    return this.activeId ? this.windows.get(this.activeId) || null : null;
  }

  /** Subscribe to changes; returns an unsubscribe function. */
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function sanitizeWin(raw) {
  return {
    id: String(raw.id),
    docId: raw.docId != null ? String(raw.docId) : null,
    app: typeof raw.app === "string" ? raw.app : "docs",
    title: typeof raw.title === "string" ? raw.title : "Untitled",
    x: typeof raw.x === "number" ? raw.x : 60,
    y: typeof raw.y === "number" ? raw.y : 44,
    w: typeof raw.w === "number" && raw.w > 80 ? raw.w : 760,
    h: typeof raw.h === "number" && raw.h > 60 ? raw.h : 520,
    z: typeof raw.z === "number" ? raw.z : 0,
  };
}

/** Shared suite-wide window manager, persisted through the T1 session store. */
export const windowManager = new WindowManager({ store: new StateStore("windows") });
