// Webuntu OS — Start menu (Phase 3, Task 14)
// A panel of installed apps grouped by category, with a live search filter, an
// "All apps" grid, a recently-launched list and a power button. Launches route
// through window.Apps (src/apps.js), which reuses the Task-13 singleton
// semantics. Dismissed on outside click and Esc; the Super/Windows key toggles
// it (the full shortcut suite — Super, Alt+Tab, Ctrl+W, Esc, help dialog —
// is centralized in src/shortcuts.js, Task 18). The power button's
// minimal Lock/Restart/Shut Down actions live here; the animated Power menu
// (shutdown screen, suspend easter egg, confirm dialog) is Task 16.

(function () {
  "use strict";

  const menuEl       = document.getElementById("startMenu");
  const startBtn     = document.getElementById("startBtn");
  const searchInput  = document.getElementById("smSearch");
  const catEl        = document.getElementById("smCats");
  const gridEl       = document.getElementById("smGrid");
  const gridTitleEl  = document.getElementById("smGridTitle");
  const recentWrap   = document.getElementById("smRecentWrap");
  const recentEl     = document.getElementById("smRecent");
  const userNameEl   = document.getElementById("smUserName");
  const userHostEl   = document.getElementById("smUserHost");
  const userAvatarEl = document.getElementById("smAvatar");
  const userEl       = document.getElementById("smUser");
  const userMenuEl   = document.getElementById("smUserMenu");
  const powerBtn     = document.getElementById("smPowerBtn");
  const powerMenu    = document.getElementById("smPowerMenu");

  const CATEGORIES = ["All apps", "AI", "Accessories", "Games", "Internet", "System", "Developer", "Network Hubs"];

  // Task 72 — the search box searches *everything*: apps, files/folders in the
  // virtual FS, Settings sections and OS commands. These mirror Settings' nav.
  const SETTING_SECTIONS = [
    ["appearance", "🎨", "Appearance"],
    ["display", "🌓", "Display"],
    ["personalization", "🧩", "Personalization"],
    ["sound", "🔊", "Sound"],
    ["notifications", "🔔", "Notifications"],
    ["users", "👥", "Users"],
    ["system", "🖥️", "System"],
  ];
  const CAT_ICONS  = {
    "All apps": "🗂️", AI: "🧠", Accessories: "🧰", Games: "🎮", Internet: "🌐",
    System: "🖥️", Developer: "🔧", "Network Hubs": "🕸️",
  };

  let currentCat = "All apps";
  let visible = false;

  function appList() { return window.Apps ? window.Apps.catalog : []; }
  function userName() { return (window.OS && window.OS.currentUser) || "user"; }

  function tileStyle(color) {
    const fallback = getComputedStyle(document.documentElement).getPropertyValue("--tile-fallback").trim() || "rgba(148,163,184,.35)";
    const c = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!c) return { background: fallback };
    const hex = c[1];
    return { background: `linear-gradient(140deg, #${hex}cc, #${hex}55)` };
  }

  function buildTile(app) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "sm-app";
    el.title = (app.blurb || app.name) + (app.stub ? " — coming soon" : "");
    const tile = document.createElement("span");
    tile.className = "sm-a-tile";
    Object.assign(tile.style, tileStyle(app.color));
    tile.textContent = app.icon;
    if (app.stub) {
      const soon = document.createElement("span");
      soon.className = "sm-a-soon";
      soon.textContent = "Soon";
      tile.appendChild(soon);
    }
    const name = document.createElement("span");
    name.className = "sm-a-name";
    name.textContent = app.name;
    el.append(tile, name);
    el.addEventListener("click", () => { launchAndClose(app.id); });
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); launchAndClose(app.id); }
    });
    return el;
  }

  function launchAndClose(id) {
    if (window.Apps) window.Apps.launch(id);
    close();
  }

  function renderCats() {
    catEl.textContent = "";
    for (const cat of CATEGORIES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sm-cat" + (cat === currentCat ? " active" : "");
      b.dataset.cat = cat;
      b.textContent = (CAT_ICONS[cat] || "•") + "  " + cat;
      b.addEventListener("click", () => { currentCat = cat; renderAll(); });
      catEl.appendChild(b);
    }
  }

  function filteredApps() {
    const q = searchInput.value.trim().toLowerCase();
    let apps = appList();
    if (currentCat !== "All apps") apps = apps.filter((a) => a.category === currentCat);
    if (q) apps = apps.filter((a) => (a.name + " " + (a.blurb || "")).toLowerCase().includes(q));
    return apps;
  }

  function renderGrid() {
    const q = searchInput.value.trim();
    gridEl.textContent = "";
    if (q) { renderSearch(q); return; }
    gridEl.classList.remove("sm-results");
    const apps = filteredApps();
    if (!apps.length) {
      const e = document.createElement("div");
      e.className = "sm-empty";
      e.textContent = 'No apps match "' + q + '".';
      gridEl.appendChild(e);
      return;
    }
    for (const app of apps) gridEl.appendChild(buildTile(app));
  }

  // Task 72 — universal search. A query replaces the app grid with grouped
  // results across the whole OS: Applications (grid tiles, as before), Files
  // (virtual-FS walk, opened like a File Manager double-click), Settings
  // (jumps to that section) and Commands (help / power actions). Everything is
  // keyboard-walkable with the same arrows + Enter used by the app grid.
  function renderSearch(q) {
    gridEl.classList.add("sm-results");
    const lq = q.toLowerCase();
    const groups = [];

    const apps = ((window.Apps && window.Apps.catalog) || []).filter((a) =>
      a && a.id && (a.id.toLowerCase().includes(lq) ||
                    String(a.name || "").toLowerCase().includes(lq) ||
                    (lq.length >= 3 && String(a.blurb || "").toLowerCase().includes(lq)))
    ).slice(0, 6);
    if (apps.length) groups.push(["Applications", apps.map((a) => ({
      icon: a.icon || "📦", label: a.name || a.id, sub: a.blurb || "Application",
      act: () => launchAndClose(a.id),
    }))]);

    let files = [];
    if (window.Shortcuts && window.Shortcuts.fsNodes) {
      files = window.Shortcuts.fsNodes().filter((n) => {
        const nm = String(n.name || "").toLowerCase();
        const p = window.FS && window.FS.getPath ? window.FS.getPath(n).toLowerCase() : "";
        return nm.includes(lq) || p.includes(lq);
      }).slice(0, 5);
    }
    if (files.length) groups.push(["Files", files.map((n) => {
      const path = window.FS.getPath(n);
      const icon = window.FS.isFolder(n) ? "📁" : window.FS.isShortcut(n) ? "🔗" : "📄";
      return { icon, label: n.name || path, sub: path, act: () => { close(); if (window.Shortcuts) window.Shortcuts.openNode(path); } };
    })]);

    const settings = SETTING_SECTIONS.filter((s) => s[0].includes(lq) || s[1].toLowerCase().includes(lq) || s[2].toLowerCase().includes(lq)).slice(0, 3);
    if (settings.length) groups.push(["Settings", settings.map((s) => ({
      icon: s[1], label: s[2], sub: "Open in Settings",
      act: () => { close(); if (window.Settings && window.Settings.openSection) window.Settings.openSection(s[0]); },
    }))]);

    let commands = [];
    if (window.Shortcuts && window.Shortcuts.commands) {
      commands = window.Shortcuts.commands().filter((c) => c.run.includes(lq) || c.label.toLowerCase().includes(lq)).slice(0, 3);
    }
    if (commands.length) groups.push(["Commands", commands.map((c) => ({
      icon: c.icon, label: c.label, sub: c.sub,
      act: () => { if (c.run === "help") { close(); if (window.Shortcuts) window.Shortcuts.openHelp(); } else { doPower(c.run); } },
    }))]);

    if (!groups.length) {
      const e = document.createElement("div");
      e.className = "sm-empty";
      e.textContent = 'Nothing found for "' + q + '".';
      gridEl.appendChild(e);
      return;
    }
    for (const [title, items] of groups) {
      const h = document.createElement("div");
      h.className = "sm-res-head";
      h.textContent = title;
      gridEl.appendChild(h);
      for (const it of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sm-res";
        const ico = document.createElement("span");
        ico.className = "sm-res-ico";
        ico.textContent = it.icon;
        const main = document.createElement("span");
        main.className = "sm-res-main";
        const b2 = document.createElement("b");
        b2.textContent = it.label;
        const sub = document.createElement("span");
        sub.textContent = it.sub;
        main.append(b2, sub);
        const kind = document.createElement("span");
        kind.className = "sm-res-kind";
        kind.textContent = title.replace(/s$/, "");
        b.append(ico, main, kind);
        b.addEventListener("click", it.act);
        gridEl.appendChild(b);
      }
    }
  }

  function renderRecent() {
    if (!window.Apps) return;
    const rec = window.Apps.getRecent().map((id) => window.Apps.getById(id)).filter(Boolean);
    recentEl.textContent = "";
    if (!rec.length || searchInput.value.trim()) { recentWrap.hidden = true; return; }
    recentWrap.hidden = false;
    for (const app of rec.slice(0, 6)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sm-recent-item";
      b.innerHTML = '<span class="sm-r-ico">' + app.icon + "</span><span>" + app.name + "</span>";
      b.addEventListener("click", () => launchAndClose(app.id));
      recentEl.appendChild(b);
    }
  }

  function renderAll() {
    const q = searchInput.value.trim();
    gridTitleEl.textContent = q ? "Search results" : (currentCat === "All apps" ? "All apps" : currentCat);
    renderCats();
    renderGrid();
    renderRecent();
  }

  function open() {
    visible = true;
    currentCat = "All apps";
    searchInput.value = "";
    refreshUser();
    menuEl.hidden = false;
    startBtn.classList.add("active");
    renderAll();
    searchInput.focus();
  }

  function refreshUser() {
    const u = userName();
    const disp = (window.OS && window.OS.displayName) ? window.OS.displayName(u) : u;
    if (userNameEl) userNameEl.textContent = disp;
    if (userHostEl) userHostEl.textContent = "@webuntu";
    if (userAvatarEl) userAvatarEl.textContent = (window.OS && window.OS.avatar) ? window.OS.avatar(u) : (u ? u[0].toUpperCase() : "👤");
  }

  function close() {
    visible = false;
    menuEl.hidden = true;
    startBtn.classList.remove("active");
    powerMenu.hidden = true;
    if (userMenuEl) userMenuEl.hidden = true;
    if (window.SystemBar) window.SystemBar.closePopups();
  }

  function toggle() { if (visible) close(); else open(); }

  // Power actions — dispatched through the unified PowerMenu (Task 16), which
  // owns the animated shutdown/restart screens and the suspend easter egg.
  function doPower(action) {
    close();
    if (window.PowerMenu) window.PowerMenu.act(action);
  }

  // ---------- events ----------
  startBtn.addEventListener("click", (ev) => { ev.stopPropagation(); toggle(); });

  powerBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    powerMenu.hidden = !powerMenu.hidden;
  });
  powerMenu.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-pw]");
    if (b) doPower(b.dataset.pw);
  });

  // User chip → account menu (Task 62)
  userEl.addEventListener("click", (ev) => {
    ev.stopPropagation();
    powerMenu.hidden = true;
    if (userMenuEl) userMenuEl.hidden = !userMenuEl.hidden;
  });
  menuEl.addEventListener("click", (ev) => {
    if (userMenuEl && !ev.target.closest("#smUserMenu") && !ev.target.closest("#smUser")) userMenuEl.hidden = true;
  });
  userMenuEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-ua]");
    if (!b) return;
    userMenuEl.hidden = true;
    const act = b.dataset.ua;
    if (act === "settings") {
      close();
      if (window.Settings && window.Settings.openSection) window.Settings.openSection("users");
      else if (window.Settings) window.Settings.open();
    } else if (act === "switch") {
      doPower("switch-user");
    } else if (act === "lock") {
      doPower("lock");
    }
  });
  document.addEventListener("webuntu-userchange", () => { if (visible) refreshUser(); });

  searchInput.addEventListener("input", () => { renderGrid(); renderRecent(); });

  // Task 26 — arrow-key navigation over the "All apps" grid: Left/Right move
  // one tile, Up/Down move a whole row (wrapping at the ends). Enter/Space
  // already launch from the tile buttons. Task 72 — in search mode the same
  // keys walk the grouped result rows (a single column list).
  gridEl.addEventListener("keydown", (ev) => {
    const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[ev.key];
    if (!dir) return;
    const tiles = [...gridEl.querySelectorAll(".sm-app, .sm-res")];
    if (!tiles.length) return;
    ev.preventDefault();
    const idx = tiles.indexOf(document.activeElement);
    if (idx === -1) { tiles[0].focus(); return; }
    let next;
    if (gridEl.classList.contains("sm-results")) {
      next = (idx + (dir === "down" ? 1 : dir === "up" ? -1 : 0) + tiles.length) % tiles.length;
    } else if (dir === "left") {
      next = (idx - 1 + tiles.length) % tiles.length;
    } else if (dir === "right") {
      next = (idx + 1) % tiles.length;
    } else {
      const cols = Math.max(1, Math.floor(gridEl.clientWidth / 96));
      const off = dir === "down" ? cols : -cols;
      next = Math.min(tiles.length - 1, Math.max(0, idx + off));
      if (next === idx) next = dir === "down" ? (idx + 1) % tiles.length : (idx - 1 + tiles.length) % tiles.length;
    }
    tiles[next].focus();
  });

  // Dismiss on outside click / Esc.
  document.addEventListener("mousedown", (ev) => {
    if (!visible) return;
    if (ev.target.closest("#startMenu") || ev.target.closest("#startBtn")) return;
    close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });

  window.StartMenu = {
    open, close, toggle,
    get isOpen() { return visible; },
  };
})();
