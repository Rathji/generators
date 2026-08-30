// Webuntu OS — App launcher + registry (Phase 3, Task 14)
// Reads the appCatalog list from main.pjs and provides the single launch path
// for the Start menu (and later the File Manager / Software Center / Terminal's
// `open` command). Launch routing:
//   - link apps  -> open the top-level perchance page in a new tab
//   - stub apps  -> open a friendly "Coming soon" window
//   - real apps  -> WM.open with the Task-13 singleton semantics (re-opening a
//                   singleton app focuses its existing window instead)
// Also tracks the recently-launched list (localStorage) for the Start menu.

(function () {
  "use strict";

  if (window.__migrateKey) window.__migrateKey("rathbuntu.recent", "webuntu.recent");

  const RECENT_KEY = "webuntu.recent";

  let catalog = [];

  function loadCatalog() {
    try {
      catalog = root.appCatalog.selectAll.map((n) => ({
        id: n.id.evaluateItem,
        name: n.name.evaluateItem,
        icon: n.icon.evaluateItem,
        color: n.color ? n.color.evaluateItem : null,
        category: n.category.evaluateItem,
        blurb: n.blurb ? n.blurb.evaluateItem : "",
        type: n.type ? n.type.evaluateItem : "app",
        target: n.target ? n.target.evaluateItem : null,
        singleton: n.singleton ? n.singleton.evaluateItem === true : false,
        stub: n.stub ? n.stub.evaluateItem === true : false,
      }));
    } catch (e) {
      catalog = [];
    }
  }

  function getById(id) { return catalog.find((a) => a.id === id) || null; }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter(Boolean); }
    catch (e) { return []; }
  }
  function recordRecent(id) {
    try {
      const rec = [id, ...getRecent().filter((x) => x !== id)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(rec));
    } catch (e) {}
  }

  function tileStyle(color) {
    const fallback =
      getComputedStyle(document.documentElement).getPropertyValue("--tile-fallback").trim() ||
      "rgba(148,163,184,.35)";
    const c = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!c) return { background: fallback };
    const hex = c[1];
    return { background: `linear-gradient(140deg, #${hex}cc, #${hex}55)` };
  }

  // Body for apps that are planned but not built yet (stub:true). Themed, so a
  // stub window still feels like part of the OS rather than a broken launch.
  function comingSoonBody(app) {
    const wrap = document.createElement("div");
    wrap.className = "app-comingsoon";
    const tile = document.createElement("div");
    tile.className = "app-cs-tile";
    Object.assign(tile.style, tileStyle(app.color));
    tile.textContent = app.icon;
    const h = document.createElement("h2");
    h.textContent = app.name;
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = app.blurb || "";
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "This app is on the Webuntu roadmap and ships in a later build phase.";
    wrap.append(tile, h, p, note);
    return wrap;
  }

  function launch(id) {
    const app = getById(id);
    if (!app || !window.WM) return null;
    recordRecent(id);

    if (app.type === "link" && app.target) {
      window.open("https://perchance.org/" + app.target, "_blank", "noopener");
      return null;
    }
    // Task 37 — folder-kind catalog apps (Board Games / Video Games) open the
    // real File Manager at their target path instead of spawning a window.
    if (app.type === "folder" && app.target && window.Launcher && window.Launcher.openFolder) {
      window.Launcher.openFolder(app.target);
      return null;
    }
    if (app.stub) {
      return window.WM.open({
        appId: app.id,
        title: app.name,
        icon: app.icon,
        singleton: true,
        content: comingSoonBody(app),
      });
    }
    // Singleton apps that are already open: just refocus the existing window
    // without running the content builder again — re-running would leak
    // per-open resources (e.g. the System Monitor's animation timer).
    if (app.singleton && window.WM.findByAppId(app.id)) {
      return window.WM.open({
        appId: app.id, title: app.name, icon: app.icon, singleton: true,
      });
    }
    // Real apps can register a content builder in window.AppContent (e.g.
    // src/settings.js registers `settings`). A builder returns either a DOM
    // node or { content, w, h, minW, minH } — geometry feeds WM.open.
    let content = null;
    const opts = { appId: app.id, title: app.name, icon: app.icon, singleton: app.singleton };
    const builder = window.AppContent && typeof window.AppContent[app.id] === "function"
      ? window.AppContent[app.id](app) : null;
    if (builder instanceof Node) { content = builder; }
    else if (builder && typeof builder === "object") {
      content = builder.content || null;
      if (builder.w) opts.w = builder.w;
      if (builder.h) opts.h = builder.h;
      if (builder.minW) opts.minW = builder.minW;
      if (builder.minH) opts.minH = builder.minH;
    }
    opts.content = content;
    const win = window.WM.open(opts);
    // Content builders may request lifecycle hooks (e.g. the System Monitor's
    // timer cleanup) — attach them to the live window after it exists.
    if (win && builder && typeof builder.onCloseRequest === "function") {
      win.onCloseRequest = builder.onCloseRequest;
    }
    return win;
  }

  window.Apps = {
    launch,
    getById,
    get catalog() { return catalog; },
    getRecent,
    recordRecent,
    refresh: loadCatalog,
  };

  loadCatalog();
})();
