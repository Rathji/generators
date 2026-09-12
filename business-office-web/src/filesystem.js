// ============================================================================
//  VIRTUAL FILE SYSTEM  (T13 + T14)
//
//  The persistent store of SAVED documents, distinct from the registry of OPEN
//  documents (src/registry.js). A file is { id, app, name, content, meta,
//  createdAt, updatedAt } — content is app-owned and stored opaquely (the same
//  payload an open doc carries), so a saved file can be opened back into the
//  workspace (T13) as a fresh registry doc bound to a window.
//
//  File naming (T14): every file has a unique name within its app. create()
//  and rename() reject duplicates (`{ ok:false, error:"duplicate" }`); names
//  are compared case-sensitively and must be non-empty after trimming.
//  saveAs() is the "Save" path — upsert by (app, name): it updates the file
//  that already owns the name, or creates a new one.
//
//  Persistence: a StateStore-like {get, set} object (T1). Events:
//  fs.on(fn) -> fn({ type: "create"|"update"|"rename"|"remove", file })
// ============================================================================

import { StateStore } from "./state.js";

let fileCounter = 0;

function generateId() {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : null;
  return (
    uuid ||
    "file_" + Date.now().toString(36) + "_" + ++fileCounter + "_" + Math.random().toString(36).slice(2, 8)
  );
}

function normalizeName(name) {
  return typeof name === "string" ? name.trim() : "";
}

export class FileSystem {
  /**
   * @param {{store?: {get: Function, set: Function}}} [opts]  persistence store
   */
  constructor(opts = {}) {
    this.store = opts.store || null;
    this.files = new Map(); // id -> file (insertion order)
    this.listeners = new Set();
    if (this.store) this._restore();
  }

  _nextId() {
    let id;
    do {
      id = generateId();
    } while (this.files.has(id));
    return id;
  }

  _emit(type, file) {
    for (const fn of this.listeners) {
      try {
        fn({ type, file, fs: this });
      } catch {
        /* a listener must not break the file system */
      }
    }
  }

  _persist() {
    if (!this.store) return;
    this.store.set("files", [...this.files.values()]);
  }

  _restore() {
    const arr = this.store.get("files");
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      if (raw && raw.id && !this.files.has(raw.id)) {
        this.files.set(raw.id, sanitizeFile(raw));
      }
    }
  }

  /** All saved files in insertion order. */
  list() {
    return [...this.files.values()];
  }

  /** Saved files for one app, sorted by name (case-insensitive). */
  listByApp(app) {
    return this.list()
      .filter((f) => f.app === app)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  get(id) {
    return this.files.get(id) || null;
  }

  /** Exact (case-sensitive) lookup by app + name, or null. */
  getByName(app, name) {
    const n = normalizeName(name);
    if (!n) return null;
    for (const f of this.files.values()) {
      if (f.app === app && f.name === n) return f;
    }
    return null;
  }

  count() {
    return this.files.size;
  }

  /** Create a new saved file. Names must be unique within the app (T14). */
  create({ app = "docs", name = "", content = "", meta = {} } = {}) {
    const n = normalizeName(name);
    if (!app || !n) return { ok: false, error: "invalid", file: null };
    const existing = this.getByName(app, n);
    if (existing) return { ok: false, error: "duplicate", file: existing };
    const now = Date.now();
    const file = {
      id: this._nextId(),
      app,
      name: n,
      content,
      meta: meta || {},
      createdAt: now,
      updatedAt: now,
    };
    this.files.set(file.id, file);
    this._persist();
    this._emit("create", file);
    return { ok: true, error: null, file, created: true };
  }

  /** Patch content/meta of an existing file by id. */
  save(id, patch = {}) {
    const file = this.files.get(id);
    if (!file) return { ok: false, error: "not_found", file: null };
    if (patch.content !== undefined) file.content = patch.content;
    if (patch.meta !== undefined && patch.meta !== null) {
      file.meta = Object.assign({}, file.meta, patch.meta);
    }
    file.updatedAt = Date.now();
    this._persist();
    this._emit("update", file);
    return { ok: true, error: null, file, created: false };
  }

  /** "Save" — upsert by (app, name): update the file owning the name, else create. */
  saveAs({ app = "docs", name = "", content = "", meta = {} } = {}) {
    const n = normalizeName(name);
    if (!app || !n) return { ok: false, error: "invalid", file: null };
    const existing = this.getByName(app, n);
    if (existing) {
      return this.save(existing.id, { content, meta });
    }
    return this.create({ app, name: n, content, meta });
  }

  /** Rename a file, enforcing per-app uniqueness (T14). Renaming to its own
   *  current name is a no-op success. */
  rename(id, newName) {
    const file = this.files.get(id);
    if (!file) return { ok: false, error: "not_found", file: null };
    const n = normalizeName(newName);
    if (!n) return { ok: false, error: "invalid", file: null };
    if (n === file.name) return { ok: true, error: null, file, renamed: false };
    const clash = this.getByName(file.app, n);
    if (clash && clash.id !== id) return { ok: false, error: "duplicate", file: clash };
    const oldName = file.name;
    file.name = n;
    file.updatedAt = Date.now();
    this._persist();
    this._emit("rename", file);
    return { ok: true, error: null, file, renamed: true, oldName };
  }

  remove(id) {
    const file = this.files.get(id);
    if (!file) return { ok: false, error: "not_found", file: null };
    this.files.delete(id);
    this._persist();
    this._emit("remove", file);
    return { ok: true, error: null, file };
  }

  /** Subscribe to changes; returns an unsubscribe function. */
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function sanitizeFile(raw) {
  return {
    id: String(raw.id),
    app: typeof raw.app === "string" ? raw.app : "docs",
    name: normalizeName(raw.name) || "Untitled",
    content: raw.content !== undefined ? raw.content : "",
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

/** Shared suite-wide file system, persisted through the T1 session store. */
export const fileSystem = new FileSystem({ store: new StateStore("files") });
