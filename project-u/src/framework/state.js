// ============================================================================
//  Project U — global application state (Phase 1, task 3)
//  The shared workspace/account selector and the current user context. Views
//  subscribe to it instead of reading scattered globals; persistence of the
//  selection arrives with Phase 4 (preferences & tracking).
// ============================================================================

import { createStore } from "./store.js";
import { initials as toInitials } from "./utils.js";

export const DEFAULT_WORKSPACES = Object.freeze([
  Object.freeze({ id: "riverbend-bakery", name: "Riverbend Bakery", kind: "Bakery", plan: "Starter" }),
  Object.freeze({ id: "northwind-it", name: "Northwind IT Services", kind: "IT provider", plan: "Pro" }),
  Object.freeze({ id: "harbour-bookkeeping", name: "Harbour Bookkeeping", kind: "Bookkeeping", plan: "Starter" }),
]);

export const DEFAULT_USER = Object.freeze({
  id: "user-alex",
  name: "Alex Morgan",
  email: "alex@riverbend.example",
  role: "Owner",
  initials: "AM",
});

export function createAppState(options = {}) {
  const {
    workspaces = DEFAULT_WORKSPACES.map((w) => ({ ...w })),
    user = { ...DEFAULT_USER },
    initialWorkspaceId = null,
    initialMemberId = null,
  } = options;

  const store = createStore({
    workspaces,
    user: withInitials(user),
    workspaceId: initialWorkspaceId || (workspaces[0] ? workspaces[0].id : null),
    activeMemberId: initialMemberId || null,
  });

  function withInitials(person) {
    return { ...person, initials: person.initials || toInitials(person.name) };
  }

  function getWorkspaces() {
    return store.get().workspaces;
  }

  function activeWorkspace() {
    const { workspaces: list, workspaceId } = store.get();
    return list.find((workspace) => workspace.id === workspaceId) || null;
  }

  function setWorkspace(id) {
    const next = getWorkspaces().find((workspace) => workspace.id === id);
    if (!next) {
      console.warn(`[pu:state] unknown workspace "${id}"`);
      return activeWorkspace();
    }
    store.set({ workspaceId: next.id });
    return next;
  }

  function addWorkspaces(list = []) {
    const merged = [...store.get().workspaces];
    for (const workspace of list) {
      if (workspace && workspace.id && !merged.some((w) => w.id === workspace.id)) merged.push({ ...workspace });
    }
    store.set({ workspaces: merged });
    return merged;
  }

  // The member the launcher currently has in focus (last launched/selected).
  function setActiveMember(id) {
    const next = id || null;
    store.set({ activeMemberId: next });
    return next;
  }

  function clearActiveMember() {
    return setActiveMember(null);
  }

  function setUser(partial) {
    const merged = { ...store.get().user, ...(partial || {}) };
    // Recompute initials whenever the name changes unless a caller supplies
    // them explicitly — a stale "AM" on "Jamie Fox" would be wrong.
    const explicit = partial && partial.initials;
    const next = { ...merged, initials: explicit || toInitials(merged.name) };
    store.set({ user: next });
    return next;
  }

  function subscribe(handler, opts = {}) {
    return store.subscribe(handler, opts);
  }

  function selectSubscribe(selector, handler, opts = {}) {
    return store.selectSubscribe(selector, handler, opts);
  }

  function reset() {
    store.reset();
    return store.get();
  }

  return {
    get: () => store.get(),
    get user() {
      return store.get().user;
    },
    get workspaceId() {
      return store.get().workspaceId;
    },
    get activeMemberId() {
      return store.get().activeMemberId;
    },
    getWorkspaces,
    activeWorkspace,
    setWorkspace,
    addWorkspaces,
    setActiveMember,
    clearActiveMember,
    setUser,
    subscribe,
    selectSubscribe,
    reset,
  };
}
