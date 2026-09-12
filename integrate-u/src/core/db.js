export function createDb({ kv = null, namespace = "pu-hub", collections = [] } = {}) {
  const safeNamespace = String(namespace).replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "pu_hub";
  const buckets = new Map();
  const known = new Set(collections);
  let mode = kv && typeof kv === "object" ? "persistent" : "memory";
  let readyPromise = null;

  function folder(collection) {
    if (!kv) return null;
    try {
      return kv[`${safeNamespace}__${collection}`];
    } catch (e) {
      return null;
    }
  }

  function bucket(collection) {
    if (!buckets.has(collection)) buckets.set(collection, new Map());
    return buckets.get(collection);
  }

  function register(collection) {
    known.add(collection);
    return bucket(collection);
  }

  async function hydrate() {
    if (!kv) return;
    for (const collection of known) {
      const f = folder(collection);
      if (!f) continue;
      try {
        const entries = await f.entries();
        const b = bucket(collection);
        for (const [key, value] of entries) b.set(key, value);
      } catch (e) {
        mode = "memory-degraded";
      }
    }
  }

  async function persist(collection, key, value) {
    const f = folder(collection);
    if (!f) return;
    try {
      await f.set(key, value);
    } catch (e) {
      mode = "memory-degraded";
    }
  }

  async function drop(collection, key) {
    const f = folder(collection);
    if (!f) return;
    try {
      await f.delete(key);
    } catch (e) {
      mode = "memory-degraded";
    }
  }

  return {
    get mode() {
      return mode;
    },
    namespace: safeNamespace,
    collections: () => Array.from(known),
    ready() {
      if (!readyPromise) readyPromise = hydrate();
      return readyPromise;
    },
    register,
    all(collection) {
      return Array.from(bucket(collection).values());
    },
    entries(collection) {
      return Array.from(bucket(collection).entries());
    },
    get(collection, key) {
      return bucket(collection).get(key);
    },
    has(collection, key) {
      return bucket(collection).has(key);
    },
    count(collection) {
      return bucket(collection).size;
    },
    async put(collection, key, value) {
      register(collection).set(key, value);
      await persist(collection, key, value);
      return value;
    },
    async putMany(collection, pairs) {
      const b = register(collection);
      for (const [key, value] of pairs) b.set(key, value);
      for (const [key, value] of pairs) await persist(collection, key, value);
      return pairs.length;
    },
    async remove(collection, key) {
      bucket(collection).delete(key);
      await drop(collection, key);
    },
    async clear(collection) {
      bucket(collection).clear();
      const f = folder(collection);
      if (!f) return;
      try {
        const keys = await f.keys();
        await f.deleteMany(keys);
      } catch (e) {
        mode = "memory-degraded";
      }
    },
  };
}
