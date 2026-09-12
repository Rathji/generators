// ============================================================================
//  Project U — user preferences (Phase 4, tasks 16-18)
//  Pins (favourite generators, floated to the top of the launcher) and recent
//  history (the last few generators opened), persisted through the shared
//  storage layer so they survive a reload. Pure state + helpers — no DOM, so
//  the whole thing is testable in isolation.
// ============================================================================

import { deepClone } from "./utils.js";

export const PREFS_STORAGE_KEY = "prefs:v1";
export const MAX_RECENTS_LIMIT = 12;

export const DEFAULT_PREFERENCES = Object.freeze({
  pinned: Object.freeze([]),
  recents: Object.freeze([]),
  maxRecents: 5,
  trackRecents: true,
  pinFirst: true,
});

function isId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueIds(list) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(list) ? list : []) {
    if (!isId(value)) continue;
    const id = value.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function clampRecents(value, fallback = DEFAULT_PREFERENCES.maxRecents) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), MAX_RECENTS_LIMIT);
}

// Recent entries are `{ id, at }`; accept a bare id string too so older saves
// (or hand-written data) still load.
function normalizeEntry(entry) {
  if (isId(entry)) return { id: entry.trim(), at: null };
  if (entry && typeof entry === "object" && isId(entry.id)) {
    const at = Number(entry.at);
    return { id: entry.id.trim(), at: Number.isFinite(at) ? at : null };
  }
  return null;
}

function normalizeRecents(list, limit) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(list) ? list : []) {
    const entry = normalizeEntry(value);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out.slice(0, limit);
}

// Take any saved/partial object and return a safe, complete preferences state.
export function normalizePreferences(input) {
  const saved = input && typeof input === "object" ? input : {};
  const maxRecents = clampRecents(saved.maxRecents);
  return {
    pinned: uniqueIds(saved.pinned),
    recents: normalizeRecents(saved.recents, maxRecents),
    maxRecents,
    trackRecents: saved.trackRecents !== false,
    pinFirst: saved.pinFirst !== false,
  };
}

// Order a member list so pinned members float to the top (in pin order) while
// everything else keeps its registry order. Unknown pinned ids are ignored, so
// retiring a member from the registry can never leave a hole in the grid.
export function orderByPinned(members, pinned, { pinFirst = true } = {}) {
  const list = Array.isArray(members) ? members : [];
  if (!pinFirst) return [...list];
  const rank = new Map(uniqueIds(pinned).map((id, index) => [id, index]));
  return list
    .map((member, index) => ({ member, index, rank: rank.has(member.id) ? rank.get(member.id) : Infinity }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.member);
}

export function createPreferences(options = {}) {
  const { storage = null, storageKey = PREFS_STORAGE_KEY, onChange = null } = options;
  let state = load();
  const subscribers = new Set();

  function load() {
    const saved = storage ? storage.get(storageKey, null) : null;
    return normalizePreferences(saved);
  }

  function persist() {
    if (storage) storage.set(storageKey, state);
  }

  function notify() {
    const snapshot = get();
    for (const handler of [...subscribers]) {
      try {
        handler(snapshot);
      } catch (error) {
        console.error("[pu:preferences] subscriber threw", error);
      }
    }
    if (typeof onChange === "function") onChange(snapshot);
  }

  function commit(next) {
    state = next;
    persist();
    notify();
    return get();
  }

  function get() {
    return deepClone(state);
  }

  function isPinned(id) {
    return isId(id) && state.pinned.includes(id.trim());
  }

  function pin(id) {
    if (!isId(id)) return false;
    const key = id.trim();
    if (state.pinned.includes(key)) return false;
    commit({ ...state, pinned: [key, ...state.pinned] });
    return true;
  }

  function unpin(id) {
    if (!isId(id)) return false;
    const key = id.trim();
    if (!state.pinned.includes(key)) return false;
    commit({ ...state, pinned: state.pinned.filter((entry) => entry !== key) });
    return true;
  }

  function togglePin(id) {
    if (!isId(id)) return false;
    if (isPinned(id)) {
      unpin(id);
      return false;
    }
    return pin(id);
  }

  function clearPins() {
    if (!state.pinned.length) return false;
    commit({ ...state, pinned: [] });
    return true;
  }

  function recordRecent(id, at = Date.now()) {
    if (!state.trackRecents || !isId(id)) return false;
    const key = id.trim();
    const stamp = Number(at);
    const entry = { id: key, at: Number.isFinite(stamp) ? stamp : Date.now() };
    const recents = [entry, ...state.recents.filter((item) => item.id !== key)].slice(0, state.maxRecents);
    commit({ ...state, recents });
    return true;
  }

  function clearRecents() {
    if (!state.recents.length) return false;
    commit({ ...state, recents: [] });
    return true;
  }

  function setMaxRecents(value) {
    const maxRecents = clampRecents(value, state.maxRecents);
    commit({ ...state, maxRecents, recents: state.recents.slice(0, maxRecents) });
    return maxRecents;
  }

  function setTrackRecents(flag) {
    const trackRecents = Boolean(flag);
    if (trackRecents === state.trackRecents) return state.trackRecents;
    commit({ ...state, trackRecents });
    return trackRecents;
  }

  function setPinFirst(flag) {
    const pinFirst = Boolean(flag);
    if (pinFirst === state.pinFirst) return state.pinFirst;
    commit({ ...state, pinFirst });
    return pinFirst;
  }

  function orderMembers(members) {
    return orderByPinned(members, state.pinned, { pinFirst: state.pinFirst });
  }

  function subscribe(handler, opts = {}) {
    subscribers.add(handler);
    if (opts.immediate) handler(get());
    return () => subscribers.delete(handler);
  }

  function reset() {
    return commit(normalizePreferences(DEFAULT_PREFERENCES));
  }

  return {
    storageKey,
    get,
    get pinned() {
      return [...state.pinned];
    },
    get recents() {
      return deepClone(state.recents);
    },
    get maxRecents() {
      return state.maxRecents;
    },
    get trackRecents() {
      return state.trackRecents;
    },
    get pinFirst() {
      return state.pinFirst;
    },
    isPinned,
    pin,
    unpin,
    togglePin,
    clearPins,
    recordRecent,
    clearRecents,
    setMaxRecents,
    setTrackRecents,
    setPinFirst,
    orderMembers,
    subscribe,
    reset,
  };
}
