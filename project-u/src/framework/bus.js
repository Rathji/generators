// ============================================================================
//  Project U — event bus (Phase 3, task 12)
//  A minimal synchronous pub/sub used to decouple framework components.
//  Wildcard topic "*" receives every event. Handlers are isolated: a throw in
//  one subscriber never prevents the others from running.
// ============================================================================

export function createBus() {
  const topics = new Map(); // topic -> Set<handler>
  let paused = false;

  function subscribers(topic) {
    if (!topics.has(topic)) topics.set(topic, new Set());
    return topics.get(topic);
  }

  function on(topic, handler) {
    subscribers(topic).add(handler);
    return () => off(topic, handler);
  }

  function once(topic, handler) {
    const offFn = on(topic, (payload, meta) => {
      offFn();
      handler(payload, meta);
    });
    return offFn;
  }

  function off(topic, handler) {
    const set = topics.get(topic);
    if (!set) return false;
    const removed = set.delete(handler);
    if (!set.size) topics.delete(topic);
    return removed;
  }

  function emit(topic, payload, meta = {}) {
    if (paused) return 0;
    const envelope = { topic, payload, at: Date.now(), ...meta };
    let delivered = 0;
    const fire = (handler) => {
      delivered++;
      try {
        handler(payload, envelope);
      } catch (error) {
        console.error(`[pu:bus] handler for "${topic}" threw`, error);
      }
    };
    const exact = topics.get(topic);
    if (exact) for (const handler of [...exact]) fire(handler);
    if (topic !== "*") {
      const all = topics.get("*");
      if (all) for (const handler of [...all]) fire(handler);
    }
    return delivered;
  }

  function clear(topic) {
    if (topic) topics.delete(topic);
    else topics.clear();
  }

  function listenerCount(topic) {
    if (topic) return (topics.get(topic) || new Set()).size;
    let total = 0;
    for (const set of topics.values()) total += set.size;
    return total;
  }

  return {
    on,
    once,
    off,
    emit,
    clear,
    listenerCount,
    get topics() {
      return [...topics.keys()];
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
  };
}

export const bus = createBus();
