// Webuntu OS — Workspaces / virtual desktops (Task 64)
// A simple multi-desktop layer on top of the Window Manager. There are
// `count` desktops (default 4, configurable 1-6 via Settings → Personalization
// → Workspaces, persisted in webuntu.settings.wsCount). Every window is
// assigned to the desktop that was active when it opened; switching desktops
// hides the others (a .wm-other-desktop class on the window + taskbar entry)
// and re-focuses the top window of the new desktop. A pager widget in the
// taskbar (#deskPager) switches desktops by click; Ctrl+Alt+←/→ (prev/next),
// Ctrl+Alt+Home/End (first/last) and Ctrl+Alt+1..N (direct) work too.
//
// Per-desktop wallpapers (optional): a desktop can carry its own wallpaper
// override (webuntu.settings.wsWallpapers = { desktopId: source }). On switch,
// the override is applied if present, otherwise the global wallpaper. Setting
// it is available from the desktop context menu → "Set this desktop's
// wallpaper…" (a desktop-scoped variant of the wallpaper picker) and cleared
// with "Reset this desktop's wallpaper".

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";
  const MAX_WS = 6;
  const DEF_WS = 4;

  let count = DEF_WS;
  let active = 1;
  let overrides = {};   // desktopId -> wallpaper source

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(loadSettings(), patch))); }
    catch (e) {}
  }

  function load() {
    const s = loadSettings();
    const c = Math.round(Number(s.wsCount));
    count = (c >= 1 && c <= MAX_WS) ? c : DEF_WS;
    if (active > count) active = count;
    overrides = (s.wsWallpapers && typeof s.wsWallpapers === "object") ? s.wsWallpapers : {};
  }

  // Apply the current desktop to every window (visibility + focus + wallpaper).
  function applyDesktopState() {
    const cur = active;
    if (window.WM && window.WM.windows) {
      for (const w of window.WM.windows) {
        if (w.el) w.el.classList.toggle("wm-other-desktop", w.desktop !== cur);
      }
    }
    if (window.WM && window.WM.refreshTaskbar) window.WM.refreshTaskbar();
    if (window.WM && window.WM.windows) {
      const visible = window.WM.windows.filter((o) => !o.closed && !o.minimized && o.desktop === cur);
      if (visible.length) {
        const top = visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
        window.WM.focus(top.id);
      } else if (window.WM.focusTop) {
        window.WM.focusTop();
      }
    }
    const ov = overrides[cur];
    if (window.Desktop) {
      window.Desktop.apply(ov !== undefined ? ov : window.Desktop.getWallpaper());
    }
    renderPager();
  }

  function switchTo(id) {
    id = Math.max(1, Math.min(count, Math.round(id) || 1));
    if (id === active) return;
    active = id;
    applyDesktopState();
  }
  function next() { switchTo(active >= count ? 1 : active + 1); }
  function prev() { switchTo(active <= 1 ? count : active - 1); }

  function setCount(n) {
    n = Math.max(1, Math.min(MAX_WS, Math.round(n) || 1));
    if (n === count) return;
    count = n;
    if (active > count) active = count;
    saveSettings({ wsCount: count });
    for (const k of Object.keys(overrides)) {
      if (Number(k) > count) delete overrides[k];
    }
    if (Object.keys(overrides).length) saveSettings({ wsWallpapers: overrides });
    applyDesktopState();
  }

  // ---- per-desktop wallpapers ----
  function wallpaper(id) { return overrides[id]; }
  function setWallpaper(source) {
    if (source) overrides[active] = source; else delete overrides[active];
    saveSettings({ wsWallpapers: overrides });
    if (window.Desktop) window.Desktop.apply(source || window.Desktop.getWallpaper());
  }

  // ---- moving windows between desktops ----
  function moveWindow(w, id) {
    if (!w) return;
    w.desktop = Math.max(1, Math.min(count, Math.round(id) || 1));
    if (window.WM && window.WM.refreshTaskbar) window.WM.refreshTaskbar();
    if (w.desktop === active) {
      if (w.el) w.el.classList.remove("wm-other-desktop");
      if (window.WM) window.WM.focus(w.id);
    } else if (w.el) {
      w.el.classList.add("wm-other-desktop");
    }
  }

  // ---- pager widget (taskbar) ----
  const pagerEl = document.getElementById("deskPager");
  function renderPager() {
    if (!pagerEl) return;
    pagerEl.textContent = "";
    for (let i = 1; i <= count; i++) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "ws-chip" + (i === active ? " active" : "");
      c.dataset.ws = i;
      c.textContent = i;
      c.title = "Desktop " + i + (i === active ? " (current)" : "");
      c.setAttribute("aria-label", "Desktop " + i);
      c.setAttribute("role", "tab");
      c.setAttribute("aria-selected", String(i === active));
      c.addEventListener("click", () => switchTo(i));
      pagerEl.appendChild(c);
    }
  }

  // ---- keyboard shortcuts ----
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey && ev.altKey)) return;
    const k = ev.key;
    if (k === "ArrowRight") { ev.preventDefault(); next(); }
    else if (k === "ArrowLeft") { ev.preventDefault(); prev(); }
    else if (k === "Home") { ev.preventDefault(); switchTo(1); }
    else if (k === "End") { ev.preventDefault(); switchTo(count); }
    else if (/^[1-9]$/.test(k)) {
      const n = Number(k);
      if (n <= count) { ev.preventDefault(); switchTo(n); }
    }
  });

  window.Workspaces = {
    get current() { return active; },
    get count() { return count; },
    get desktops() { const a = []; for (let i = 1; i <= count; i++) a.push(i); return a; },
    switchTo,
    next,
    prev,
    setCount,
    wallpaper,
    setWallpaper,
    moveWindow,
    refresh: applyDesktopState,
    renderPager,
  };

  load();
  renderPager();
})();
