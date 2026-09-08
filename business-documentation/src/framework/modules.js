// src/framework/modules.js — module registry + hash router.
//
// A "module" is { id, label, desc, icon, render(ctx) }. Modules register with
// the router; the active module's render(ctx) draws into the shared #kbMain
// container. Routing is hash-based (#/home, #/browse, …) so module views get
// stable, shareable URLs and back/forward work. A module that throws while
// rendering falls back to the shared error state instead of blanking the app.

import { errorState } from "./states.js";

export function createRouter(container, opts = {}) {
  const { kb, providers, states, toast, modules: moduleList, onNavigate } = opts;
  const registry = new Map();
  const state = { current: null };
  const cleanups = [];

  function resolve(id) {
    return registry.get(id) || registry.get("home");
  }

  function hashId() {
    const m = location.hash.match(/^#\/([a-z0-9-]+)(?:\/([a-zA-Z0-9-_@]+))?/i);
    return { id: m ? m[1].toLowerCase() : null, sub: m && m[2] ? m[2] : null };
  }

  function render(id, sub) {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {}
    }
    const mod = resolve(id);
    state.current = mod.id;
    container.innerHTML = "";
    const ctx = {
      kb,
      providers,
      states,
      toast,
      modules: moduleList,
      store: opts.store,
      sync: opts.sync,
      content: opts.content,
      hub: opts.hub,
      integrity: opts.integrity,
      container,
      mod,
      current: () => state.current,
      onUnmount: (fn) => cleanups.push(fn),
      navigate,
      go: (hash) => {
        if (location.hash === hash) {
          const { id, sub } = hashId();
          render(id, sub);
        } else {
          location.hash = hash;
        }
      },
    };
    try {
      if (sub && typeof mod.renderDetail === "function") {
        mod.renderDetail(ctx, sub);
      } else {
        mod.render(ctx);
      }
    } catch (e) {
      container.append(
        errorState({
          title: "Couldn’t render this module",
          description: String((e && e.message) || e),
          onRetry: () => render(mod.id, sub),
        }),
      );
    }
    if (onNavigate) onNavigate(mod);
  }

  function navigate(id) {
    const mod = resolve(id);
    if (location.hash === "#/" + mod.id) {
      render(mod.id);
      return;
    }
    location.hash = "#/" + mod.id;
  }

  function boot() {
    const { id, sub } = hashId();
    render(id, sub);
  }

  function start() {
    window.addEventListener("hashchange", boot);
    if (!location.hash) location.hash = "#/home";
    else boot();
  }

  return {
    register: (m) => registry.set(m.id, m),
    unregister: (id) => registry.delete(id),
    navigate,
    go: (hash) => {
      if (location.hash === hash) {
        const { id, sub } = hashId();
        render(id, sub);
      } else {
        location.hash = hash;
      }
    },
    render,
    start,
    resolve,
    registry,
    get current() {
      return state.current;
    },
  };
}
