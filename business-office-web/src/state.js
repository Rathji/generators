// ============================================================================
//  STATE PERSISTENCE LAYER  (T1)
//
//  Namespaced JSON persistence over localStorage so suite state survives page
//  refreshes. Safe against corrupt values, quota errors and private-mode
//  storage. Storage is injectable, so the same code runs headless in tests.
//
//  Usage:
//    import { StateStore, sessionStore } from "./state.js";
//    sessionStore.set("lastRoute", "#/app/docs");
//    const route = sessionStore.get("lastRoute", "#/home");
//
//  Apps that need their own bucket should create one namespace each:
//    const drafts = new StateStore("drafts");
// ============================================================================

const DEFAULT_PREFIX = "poffice";
const MISSING = Symbol("missing");

export class StateStore {
  /**
   * @param {string} namespace  unique bucket name (e.g. "session", "drafts")
   * @param {{storage?: object, prefix?: string}} [opts]  injectable storage
   */
  constructor(namespace, opts = {}) {
    if (!namespace) throw new Error("StateStore requires a namespace");
    this.namespace = namespace;
    this.prefix = (opts.prefix || DEFAULT_PREFIX) + ":" + namespace + ":";
    this.storage =
      opts.storage !== undefined
        ? opts.storage
        : typeof localStorage !== "undefined"
          ? localStorage
          : null;
  }

  _key(key) {
    return this.prefix + key;
  }

  /** Write a value. Returns true on success, false on failure (quota / no storage). */
  set(key, value) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this._key(key), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  /** Read a value, or `fallback` when missing / unreadable / corrupt. */
  get(key, fallback = null) {
    if (!this.storage) return fallback;
    let raw;
    try {
      raw = this.storage.getItem(this._key(key));
    } catch {
      return fallback;
    }
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      this.remove(key);
      return fallback;
    }
  }

  remove(key) {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this._key(key));
    } catch {
      /* noop */
    }
  }

  /** True when the key holds a stored value (including a stored null). */
  has(key) {
    return this.get(key, MISSING) !== MISSING;
  }

  /** Snapshot of every { key: value } stored in this namespace. */
  entries() {
    const out = {};
    if (!this.storage) return out;
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const fullKey = this.storage.key(i);
        if (fullKey && fullKey.startsWith(this.prefix)) {
          const raw = this.storage.getItem(fullKey);
          out[fullKey.slice(this.prefix.length)] = raw === null ? null : safeParse(raw);
        }
      }
    } catch {
      /* noop */
    }
    return out;
  }

  /** Remove every key in this namespace (other namespaces are untouched). */
  clear() {
    if (!this.storage) return;
    try {
      for (let i = this.storage.length - 1; i >= 0; i--) {
        const fullKey = this.storage.key(i);
        if (fullKey && fullKey.startsWith(this.prefix)) {
          this.storage.removeItem(fullKey);
        }
      }
    } catch {
      /* noop */
    }
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Shared suite-wide session bucket used by the shell and apps. */
export const sessionStore = new StateStore("session");
