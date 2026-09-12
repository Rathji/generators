// ============================================================================
//  Project U — persistence layer (Phase 3, task 13)
//  A defensive localStorage wrapper: namespaced keys, JSON encoding, change
//  notifications, and an automatic in-memory fallback when storage is blocked
//  (private browsing, embedded webviews, quota errors). Member generators use
//  this instead of touching localStorage directly.
// ============================================================================

export const MEMORY = new Map();

function memoryBackend() {
  return {
    getItem: (key) => (MEMORY.has(key) ? MEMORY.get(key) : null),
    setItem: (key, value) => MEMORY.set(key, value),
    removeItem: (key) => MEMORY.delete(key),
    key: (index) => [...MEMORY.keys()][index] ?? null,
    get length() {
      return MEMORY.size;
    },
    __memory: true,
  };
}

function resolveBackend(backend) {
  if (backend) return backend;
  try {
    const test = "__pu_probe__";
    window.localStorage.setItem(test, "1");
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch (_) {
    console.warn("[pu:storage] localStorage unavailable — using in-memory fallback");
    return memoryBackend();
  }
}

export function createStorage(options = {}) {
  const { namespace = "pu", separator = ":", backend: provided } = options;
  const backend = resolveBackend(provided);
  const listeners = new Set();

  function fullKey(key) {
    return `${namespace}${separator}${key}`;
  }

  function get(key, fallback = null) {
    try {
      const raw = backend.getItem(fullKey(key));
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`[pu:storage] could not read "${key}"`, error);
      return fallback;
    }
  }

  function set(key, value) {
    let ok = true;
    try {
      backend.setItem(fullKey(key), JSON.stringify(value));
    } catch (error) {
      ok = false;
      console.warn(`[pu:storage] could not write "${key}"`, error);
    }
    const event = { key, value, ok, at: Date.now() };
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[pu:storage] listener threw", error);
      }
    }
    return ok;
  }

  function remove(key) {
    try {
      backend.removeItem(fullKey(key));
    } catch (error) {
      console.warn(`[pu:storage] could not remove "${key}"`, error);
    }
    for (const listener of listeners) listener({ key, value: undefined, removed: true, at: Date.now() });
  }

  function has(key) {
    return backend.getItem(fullKey(key)) != null;
  }

  function keys() {
    const prefix = fullKey("");
    const out = [];
    for (let i = 0; i < (backend.length || 0); i++) {
      const k = backend.key(i);
      if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
  }

  function clear() {
    for (const key of keys()) remove(key);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    namespace,
    backend,
    get,
    set,
    remove,
    has,
    keys,
    clear,
    subscribe,
    get isPersistent() {
      return !backend.__memory;
    },
  };
}
