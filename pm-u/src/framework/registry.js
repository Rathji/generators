// ============================================================================
//  Project U — component library registry (Phase 4, task 19)
//  Member generators register the framework components (views, widgets) they
//  ship, then selectively enable/disable optional ones. Disabled components
//  disappear from navigation and routing without deleting code.
// ============================================================================

import { createStore } from "./store.js";

export function createRegistry(options = {}) {
  const { storage = null, storageKey = "registry:v1", onChange = null } = options;
  const components = new Map();
  const store = createStore({ disabled: loadDisabled() });

  function loadDisabled() {
    const saved = storage ? storage.get(storageKey, []) : [];
    return Array.isArray(saved) ? saved : [];
  }

  function persist() {
    if (storage) storage.set(storageKey, store.get().disabled);
  }

  store.subscribe(() => {
    persist();
    if (typeof onChange === "function") onChange(list());
  });

  function register(definition) {
    if (!definition || !definition.id) throw new Error("[pu:registry] component needs an id");
    components.set(definition.id, {
      group: "General",
      order: 100,
      optional: false,
      defaultEnabled: true,
      icon: "box",
      ...definition,
    });
    return definition.id;
  }

  function registerAll(definitions = []) {
    for (const definition of definitions) register(definition);
    return definitions.map((d) => d.id);
  }

  function get(id) {
    return components.get(id) || null;
  }

  function isDisabled(id) {
    return store.get().disabled.includes(id);
  }

  function isEnabled(id) {
    const component = get(id);
    if (!component) return false;
    if (!component.optional) return !isDisabled(id);
    return !isDisabled(id);
  }

  function setEnabled(id, enabled) {
    const disabled = new Set(store.get().disabled);
    if (enabled) disabled.delete(id);
    else {
      const component = get(id);
      if (component && !component.optional) {
        console.warn(`[pu:registry] "${id}" is required and cannot be disabled`);
        return false;
      }
      disabled.add(id);
    }
    store.set({ disabled: [...disabled] });
    return true;
  }

  function toggle(id) {
    return setEnabled(id, isDisabled(id));
  }

  function list(filter = {}) {
    const items = [...components.values()].filter((c) => (filter.enabledOnly ? isEnabled(c.id) : true));
    return items.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }

  function enabledRoutes() {
    return list({ enabledOnly: true })
      .filter((c) => typeof c.render === "function")
      .map((c) => ({
        path: c.id,
        title: c.label,
        group: c.group,
        icon: c.icon,
        render: c.render,
      }));
  }

  function subscribe(handler, opts = {}) {
    return store.subscribe(() => handler(list()), opts);
  }

  return {
    register,
    registerAll,
    get,
    list,
    isEnabled,
    isDisabled,
    setEnabled,
    toggle,
    enabledRoutes,
    subscribe,
    reset() {
      store.set({ disabled: [] });
    },
  };
}
