// ============================================================================
//  Project U — base state manager (Phase 3, task 11)
//  A tiny, dependency-free store: an immutable snapshot + subscribers. Used by
//  member generators to share data across components without a framework.
// ============================================================================

import { deepMerge, deepClone, isPlainObject } from "./utils.js";

export function createStore(initialState = {}, options = {}) {
  const { name = "store", onChange } = options;
  let state = deepClone(initialState);
  const subscribers = new Set();
  const selectorSubs = new Set(); // { selector, handler, last }

  function get() {
    return state;
  }

  function select(selector = (s) => s) {
    return selector(state);
  }

  function notify(prev) {
    for (const handler of [...subscribers]) {
      try {
        handler(state, prev);
      } catch (error) {
        console.error(`[pu:store:${name}] subscriber threw`, error);
      }
    }
    for (const entry of [...selectorSubs]) {
      let next;
      try {
        next = entry.selector(state);
      } catch (error) {
        console.error(`[pu:store:${name}] selector threw`, error);
        continue;
      }
      if (!Object.is(next, entry.last)) {
        const last = entry.last;
        entry.last = next;
        try {
          entry.handler(next, last);
        } catch (error) {
          console.error(`[pu:store:${name}] selector subscriber threw`, error);
        }
      }
    }
    if (typeof onChange === "function") onChange(state, prev);
  }

  function set(patch) {
    const prev = state;
    const next = typeof patch === "function" ? patch(state) : patch;
    if (next === state) return state;
    state = isPlainObject(state) && isPlainObject(next) ? { ...state, ...next } : deepClone(next);
    if (state === prev) return state;
    notify(prev);
    return state;
  }

  function patch(partial) {
    if (!isPlainObject(state)) {
      throw new Error(`[pu:store:${name}] patch() requires an object state`);
    }
    return set(deepMerge(state, partial));
  }

  function replace(next) {
    const prev = state;
    state = deepClone(next);
    notify(prev);
    return state;
  }

  function subscribe(handler, options2 = {}) {
    const { immediate = false } = options2;
    subscribers.add(handler);
    if (immediate) handler(state);
    return () => subscribers.delete(handler);
  }

  function selectSubscribe(selector, handler, options2 = {}) {
    const entry = { selector, handler, last: selector(state) };
    selectorSubs.add(entry);
    if (options2.immediate) handler(entry.last, undefined);
    return () => selectorSubs.delete(entry);
  }

  function reset() {
    return replace(initialState);
  }

  return {
    name,
    get,
    select,
    set,
    patch,
    replace,
    reset,
    subscribe,
    selectSubscribe,
    get subscriberCount() {
      return subscribers.size + selectorSubs.size;
    },
  };
}

// A store whose value is written back to a persistence adapter on every change
// (used by the theme + settings modules so preferences survive reloads).
export function withPersistence(store, storage, key, options2 = {}) {
  const { select: persistSelect = (s) => s } = options2;
  if (storage) {
    const stored = storage.get(key, undefined);
    if (stored !== undefined) store.replace(stored);
  }
  store.subscribe((state) => {
    if (storage) storage.set(key, persistSelect(state));
  });
  return store;
}
