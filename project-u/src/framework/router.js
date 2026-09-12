// ============================================================================
//  Project U — hash router (Phase 3, task 14)
//  Single-page view switching with deep-linkable `#/section?param=value`
//  routes. The router owns no DOM beyond the outlet element it is given.
// ============================================================================

export function createRouter(options = {}) {
  const {
    routes = [],
    defaultRoute = null,
    notFound = null,
    onNavigate = null,
    base = "#",
  } = options;

  const registry = new Map();
  for (const route of routes) registry.set(normalizePath(route.path), route);

  let outlet = null;
  let current = null;
  const subscribers = new Set();

  function normalizePath(path) {
    return String(path || "")
      .replace(/^#/, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "") || "home";
  }

  function parse(hash) {
    const raw = String(hash || "").replace(/^#/, "").replace(/^\/+/, "");
    const [pathPart, queryPart] = raw.split("?");
    const path = normalizePath(pathPart);
    const query = {};
    for (const [key, value] of new URLSearchParams(queryPart || "").entries()) query[key] = value;
    return { path, query, raw };
  }

  function href(path, query) {
    const clean = normalizePath(path);
    const qs = query ? new URLSearchParams(query).toString() : "";
    return `${base}/${clean}${qs ? `?${qs}` : ""}`;
  }

  function resolve(hash) {
    const parsed = parse(hash === undefined ? location.hash : hash);
    let route = registry.get(parsed.path);
    // An empty hash (or `#/`) means "open the default section".
    if (!route && !parsed.raw) route = registry.get(defaultRoute) || null;
    // A non-empty, unregistered path is a genuine 404.
    if (!route) route = notFound || registry.get(defaultRoute) || { path: parsed.path, render: () => {} };
    return { ...parsed, route };
  }

  function renderCurrent() {
    const ctx = resolve();
    current = ctx;
    const result = ctx.route.render ? ctx.route.render(outlet, ctx) : undefined;
    for (const handler of subscribers) {
      try {
        handler(ctx, result);
      } catch (error) {
        console.error("[pu:router] subscriber threw", error);
      }
    }
    if (typeof onNavigate === "function") onNavigate(ctx, result);
    return result;
  }

  function navigate(path, opts = {}) {
    const target = href(path, opts.query);
    if (opts.replace) {
      const url = `${location.pathname}${location.search}${target}`;
      history.replaceState(null, "", url);
      renderCurrent();
    } else if (location.hash === target) {
      renderCurrent();
    } else {
      location.hash = target;
    }
    return target;
  }

  function start(target) {
    outlet = target;
    if (!location.hash) {
      history.replaceState(null, "", `${location.pathname}${location.search}${href(defaultRoute || "home")}`);
    }
    window.addEventListener("hashchange", renderCurrent);
    return renderCurrent();
  }

  function stop() {
    window.removeEventListener("hashchange", renderCurrent);
  }

  function subscribe(handler, opts = {}) {
    subscribers.add(handler);
    if (opts.immediate && current) handler(current);
    return () => subscribers.delete(handler);
  }

  return {
    start,
    stop,
    navigate,
    href,
    parse,
    resolve,
    render: renderCurrent,
    subscribe,
    get current() {
      return current;
    },
    get routes() {
      return [...registry.values()];
    },
    add(route) {
      registry.set(normalizePath(route.path), route);
      return route;
    },
    setRoutes(list = []) {
      registry.clear();
      for (const route of list) registry.set(normalizePath(route.path), route);
      return [...registry.values()];
    },
  };
}
