export function parseHash(hash) {
  const match = String(hash || "").match(/^#\/(.*)$/);
  if (!match) return "";
  return match[1].split("?")[0].replace(/\/+$/, "").trim();
}

export function createRouter({ routes, fallbackId = "home", onRoute }) {
  const byId = new Map(routes.map((route) => [route.id, route]));

  function currentId() {
    return parseHash(window.location.hash) || fallbackId;
  }

  function resolve(id = currentId()) {
    return byId.get(id) || null;
  }

  function go(id, { replace = false } = {}) {
    const target = `#/${id}`;
    if (window.location.hash === target) {
      handle();
      return;
    }
    if (replace) window.location.replace(target);
    else window.location.hash = target;
  }

  function handle() {
    const id = currentId();
    const route = resolve(id);
    onRoute(route, id);
  }

  function start() {
    window.addEventListener("hashchange", handle);
    handle();
  }

  function stop() {
    window.removeEventListener("hashchange", handle);
  }

  return { start, stop, go, currentId, resolve, routes, byId };
}
