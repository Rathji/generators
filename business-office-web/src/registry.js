// ============================================================================
//  GLOBAL DOCUMENT REGISTRY  (T2)
//
//  Tracks every open "document" in the suite: unique id -> { id, app, content,
//  meta, createdAt, updatedAt }. Content is app-owned and stored opaquely
//  (plain text for documents, a grid model for spreadsheets, ...). Metadata
//  carries names, titles and any other per-doc bookkeeping.
//
//  Optional persistence: pass a StateStore-like {get, set} object and the
//  registry restores existing docs on construction and writes through on every
//  change — so open documents survive page reloads (see T1).
//
//  Events: registry.on(fn) -> fn({ type: "create"|"update"|"remove", doc })
//  returns an unsubscribe function.
// ============================================================================

import { StateStore } from "./state.js";

let uidCounter = 0;

function generateId() {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : null;
  return (
    uuid ||
    "doc_" + Date.now().toString(36) + "_" + ++uidCounter + "_" + Math.random().toString(36).slice(2, 8)
  );
}

export class DocumentRegistry {
  /**
   * @param {{store?: {get: Function, set: Function}}} [opts]  persistence store
   */
  constructor(opts = {}) {
    this.store = opts.store || null;
    this.docs = new Map(); // id -> doc (insertion order)
    this.listeners = new Set();
    if (this.store) this._restore();
  }

  _nextId() {
    let id;
    do {
      id = generateId();
    } while (this.docs.has(id));
    return id;
  }

  _emit(type, doc) {
    for (const fn of this.listeners) {
      try {
        fn({ type, doc, registry: this });
      } catch {
        /* a listener must not break the registry */
      }
    }
  }

  _persist() {
    if (!this.store) return;
    this.store.set("open", [...this.docs.values()]);
  }

  _restore() {
    const arr = this.store.get("open");
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      if (raw && raw.id && !this.docs.has(raw.id)) {
        this.docs.set(raw.id, sanitizeDoc(raw));
      }
    }
  }

  /** Create an open document and return it. */
  create({ app = "docs", content = "", meta = {} } = {}) {
    const now = Date.now();
    const doc = {
      id: this._nextId(),
      app,
      content,
      meta: meta || {},
      createdAt: now,
      updatedAt: now,
    };
    this.docs.set(doc.id, doc);
    this._persist();
    this._emit("create", doc);
    return doc;
  }

  /** The doc object, or null. */
  get(id) {
    return this.docs.get(id) || null;
  }

  has(id) {
    return this.docs.has(id);
  }

  /** Patch content/app/meta (meta is shallow-merged). Returns the doc, or null. */
  update(id, patch = {}) {
    const doc = this.docs.get(id);
    if (!doc) return null;
    if (patch.content !== undefined) doc.content = patch.content;
    if (patch.app !== undefined) doc.app = patch.app;
    if (patch.meta !== undefined && patch.meta !== null) {
      doc.meta = Object.assign({}, doc.meta, patch.meta);
    }
    doc.updatedAt = Date.now();
    this._persist();
    this._emit("update", doc);
    return doc;
  }

  /** Remove a document. Returns true if it existed. */
  remove(id) {
    const doc = this.docs.get(id);
    if (!doc) return false;
    this.docs.delete(id);
    this._persist();
    this._emit("remove", doc);
    return true;
  }

  /** First doc matching the predicate, or null. */
  find(predicate) {
    for (const doc of this.docs.values()) {
      if (predicate(doc)) return doc;
    }
    return null;
  }

  /** All open docs in insertion order. */
  list() {
    return [...this.docs.values()];
  }

  /** Open docs belonging to one app. */
  listByApp(app) {
    return this.list().filter((d) => d.app === app);
  }

  count() {
    return this.docs.size;
  }

  /** Subscribe to changes; returns an unsubscribe function. */
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function sanitizeDoc(raw) {
  return {
    id: String(raw.id),
    app: typeof raw.app === "string" ? raw.app : "docs",
    content: raw.content !== undefined ? raw.content : "",
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

/** Shared suite-wide registry, persisted through the T1 session store. */
export const documentRegistry = new DocumentRegistry({ store: new StateStore("registry") });
