// Webuntu OS — Shortcut launcher (Phase 4, Task 22)
// The single double-click entry point for shortcut nodes, used by the desktop
// and the File Manager / Terminal `open` command. Dispatches on a shortcut
// node's meta.kind:
//   app    → Apps.launch(appId) (catalog apps); unknown ids (e.g. Trash) fall
//            back to a generic singleton WM window, preserving pre-Task-22
//            behavior.
//   link   → open the top-level perchance page (https://perchance.org/<slug>)
//            in a new tab.
//   game   → the Game Window launcher (Task 38): a themed window embedding the
//            generator via https://null.perchance.org/<slug>, with reload /
//            new-tab fallback.
//   hub    → open the network hub INSIDE a Browser window (Task 39), with a
//            new-tab fallback.
//   stub   → a themed "Coming soon" window.
//   folder → open an FS folder in the real File Manager (Task 28), which
//            navigates a single file-manager window to that path.
// Any shortcut flagged comingSoon (game/app/link/stub) routes to the themed
// "Visit the hub instead" dialog (Task 40) instead of launching.
// Plain folder nodes passed directly also open via the folder path.

(function () {
  "use strict";

  function tileStyle(color) {
    const fallback =
      getComputedStyle(document.documentElement).getPropertyValue("--tile-fallback").trim() ||
      "rgba(148,163,184,.35)";
    const c = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!c) return { background: fallback };
    const hex = c[1];
    return { background: `linear-gradient(140deg, #${hex}cc, #${hex}55)` };
  }

  function themedBody(node, lines) {
    const wrap = document.createElement("div");
    wrap.className = "app-comingsoon";
    const tile = document.createElement("div");
    tile.className = "app-cs-tile";
    Object.assign(tile.style, tileStyle(node.color));
    tile.textContent = node.icon || "📄";
    const h = document.createElement("h2");
    h.textContent = node.name;
    wrap.append(tile, h);
    for (const line of lines) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = line;
      wrap.appendChild(p);
    }
    return wrap;
  }

  function openLink(target) {
    if (!target) return;
    window.open("https://perchance.org/" + target, "_blank", "noopener");
  }

  function openGame(node, m) {
    // Task 38 — the Game Window embeds the generator in a themed window; the
    // new-tab link stays as a fallback if the GameLauncher module isn't loaded.
    if (window.GameLauncher && window.GameLauncher.open) return window.GameLauncher.open(node);
    if (m.comingSoon) return comingSoon(node);
    openLink(m.target);
  }

  function openHub(node, m) {
    // Task 39 — the hub opens INSIDE a Browser window (with a new-tab fallback
    // if the Browser module isn't available).
    if (window.Browser && window.Browser.navigate) {
      window.Browser.navigate(m.target || "bgn-boardgame-network");
      return;
    }
    openLink(m.target);
  }

  function comingSoon(node) {
    // Task 40 — a coming-soon shortcut offers the hub instead of a dead end.
    if (window.GameLauncher && window.GameLauncher.comingSoon) {
      return window.GameLauncher.comingSoon(node);
    }
    window.WM.open({
      appId: "stub:" + node.name,
      title: node.name,
      icon: node.icon,
      singleton: true,
      content: themedBody(node, ["This is on the Webuntu roadmap and ships in a later build phase."]),
    });
  }

  function openFolder(pathOrNode) {
    const node = typeof pathOrNode === "object"
      ? pathOrNode
      : (window.FSPath.lookup(pathOrNode).node || null);
    if (!node || !window.FS.isFolder(node)) {
      return window.WM.open({
        appId: "folder-missing",
        title: "Folder not found",
        icon: "🗂️",
        singleton: true,
        content: themedBody({ name: "Folder not found", icon: "🗂️", color: null },
          ["The requested folder no longer exists."]),
      });
    }
    // Task 28 — the real File Manager handles folder opens (desktop folders and
    // folder-kind shortcuts both route here); a themed listing is only the
    // fallback if the File Manager module hasn't loaded.
    if (window.FileManager && window.FileManager.openPath) {
      window.FileManager.openPath(window.FS.getPath(node));
      return;
    }
    // Placeholder (pre-Task-28): a themed window listing the folder's children.
    const body = themedBody(node, [window.FS.getPath(node)]);
    const ul = document.createElement("ul");
    ul.className = "folder-children";
    for (const child of node.children || []) {
      const li = document.createElement("li");
      li.textContent = (child.icon ? child.icon + "  " : "") + child.name;
      ul.appendChild(li);
    }
    if (node.children && node.children.length) body.appendChild(ul);
    window.WM.open({
      appId: "folder:" + window.FS.getPath(node),
      title: node.name,
      icon: node.icon || "📁",
      content: body,
    });
  }

  function launchApp(node, m) {
    const catalog = window.Apps && m.appId ? window.Apps.getById(m.appId) : null;
    if (catalog) { window.Apps.launch(m.appId); return; }
    // Not in the app catalog (e.g. Trash) → generic singleton window, same as
    // the pre-Task-22 desktop behavior.
    window.WM.open({
      appId: m.appId || node.name,
      title: node.name,
      icon: node.icon,
      singleton: m.singleton === true,
    });
  }

  function launch(pathOrNode) {
    const node = typeof pathOrNode === "object"
      ? pathOrNode
      : (window.FSPath.lookup(pathOrNode).node || null);
    if (!node) return;
    if (window.FS.isFolder(node)) return openFolder(node);
    if (!window.FS.isShortcut(node)) return;
    const m = node.meta || {};
    if (m.comingSoon) return comingSoon(node);
    switch (m.kind) {
      case "app": return launchApp(node, m);
      case "link": return openLink(m.target);
      case "game": return openGame(node, m);
      case "hub": return openHub(node, m);
      case "stub": return comingSoon(node);
      case "folder": return openFolder(m.target);
      default: return openLink(m.target);
    }
  }

  window.Launcher = { launch, openFolder, openLink };
})();
