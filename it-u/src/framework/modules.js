// src/framework/modules.js — module registry + hash router.
//
// A "module" is { id, label, desc, icon, render(ctx) }. Modules register with
// the router; the active module's render(ctx) draws into the shared #kbMain
// container. Routing is hash-based (#/home, #/browse, …) so module views get
// stable, shareable URLs and back/forward work. A module that throws while
// rendering falls back to the shared error state instead of blanking the app.

import { errorState } from "./states.js";
import { attachHelp } from "./help.js";
import { attachAsk } from "./ai.js";

export function createRouter(container, opts = {}) {
  const { kb, providers, states, toast, modules: moduleList, onNavigate, defaultId = "home" } = opts;
  const registry = new Map();
  const state = { current: null };
  const cleanups = [];

  function resolve(id) {
    return registry.get(id) || registry.get(defaultId);
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
      docs: opts.docs,
      backup: opts.backup,
      archive: opts.archive,
      templates: opts.templates,
      assetTypes: opts.assetTypes,
      access: opts.access,
      publication: opts.publication,
      packets: opts.packets,
      connectivity: opts.connectivity,
      status: opts.status,
      sso: opts.sso,
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
    const screenKey = screenKeyFor(mod, sub);
    attachHelp(container, screenKey);
    attachAsk(container, screenKey, { ctx, sub });
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
    if (!location.hash) location.hash = "#/" + defaultId;
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

// Which screen key a render uses — shared by the help catalog and the Ask AI
// context (framework/ai-context.js). A station's list view uses the station id;
// a detail view uses "<id>:detail". A module may override either with
// `help: { list, detail }` (values may be a key or a function of ctx/sub).
function screenKeyFor(mod, sub) {
  const detail = sub && typeof mod.renderDetail === "function";
  const override = mod.help && (detail ? mod.help.detail : mod.help.list);
  if (typeof override === "function") return override(sub, mod);
  if (override) return override;
  return detail ? mod.id + ":detail" : mod.id;
}
