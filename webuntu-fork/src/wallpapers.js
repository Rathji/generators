// Webuntu OS — Wallpaper picker (Phase 5, Task 25)
// Built-in Rathji wallpapers (radial glow, gradient, grid pattern, network-hub
// art) plus a custom-image URL option, selectable from the desktop context
// menu (floating panel) and reused as the thumbnail row inside the Control
// Center's Appearance section. Applying delegates to window.Desktop — the
// owner of the --wallpaper token; the stored value is a builtin name or a URL.

(function () {
  "use strict";

  // Task 64 — the picker can run in two modes. "global" (default): applying
  // persists the wallpaper as the OS-wide setting (used by Settings and the
  // normal desktop context menu). "desktop": applying sets a per-desktop
  // override on the active workspace via Workspaces.setWallpaper, so switching
  // desktops shows that desktop's own wallpaper.
  let mode = "global";

  function builtins() {
    return (window.Desktop && window.Desktop.WALLPAPERS) || [];
  }
  function current() {
    if (mode === "desktop" && window.Workspaces) {
      return window.Workspaces.wallpaper(window.Workspaces.current) || null;
    }
    return (window.Desktop && window.Desktop.getWallpaper()) || null;
  }
  function applyChoice(value) {
    if (mode === "desktop" && window.Workspaces && window.Workspaces.setWallpaper) {
      window.Workspaces.setWallpaper(value);
    } else if (window.Desktop && window.Desktop.setWallpaper) {
      window.Desktop.setWallpaper(value);
    }
  }

  // One selectable wallpaper tile (also used by the Control Center).
  function buildThumb(name, label, selected, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "set-wp-thumb " + name + (selected ? " sel" : "");
    b.title = label;
    b.setAttribute("aria-pressed", String(!!selected));
    const bg = window.Desktop && window.Desktop.wallpaperThumbBg ? window.Desktop.wallpaperThumbBg(name) : null;
    if (bg) b.style.background = bg;
    const lab = document.createElement("span");
    lab.className = "wp-thumb-label";
    lab.textContent = label;
    b.appendChild(lab);
    b.addEventListener("click", onClick);
    return b;
  }

  // A live thumbs row: reflects the current selection; onChange fires after a
  // choice is applied (the Control Center re-renders its section on it).
  // `forcedMode` lets the floating panel keep its desktop/global mode — the
  // picker's thumbnail selection must reflect the desktop override there.
  function thumbnailsRow(onChange, forcedMode) {
    mode = forcedMode || "global";
    const wrap = document.createElement("div");
    wrap.className = "set-wp-thumbs";
    const rerender = () => {
      wrap.textContent = "";
      const cur = current();
      for (const w of builtins()) {
        wrap.appendChild(buildThumb(w.name, w.label, cur === w.name, () => {
          applyChoice(w.name);
          rerender();
          if (onChange) onChange();
        }));
      }
    };
    rerender();
    return wrap;
  }

  // Apply a random built-in (Task 56 — wallpaper pack).
  function shuffle() {
    const list = builtins();
    if (!list.length) return;
    const cur = current();
    const others = list.filter((w) => w.name !== cur);
    const pool = others.length ? others : list;
    applyChoice(pool[Math.floor(Math.random() * pool.length)].name);
  }

  // ---------- floating panel (desktop context menu) ----------
  let panel = null;

  function show(x, y, opts) {
    hide();
    mode = (opts && opts.desktop && window.Workspaces) ? "desktop" : "global";
    panel = document.createElement("div");
    panel.id = "wallpaperPicker";
    panel.hidden = false;

    panel.appendChild((() => {
      const t = document.createElement("h4");
      t.className = "wp-title";
      t.textContent = mode === "desktop"
        ? "Wallpaper for Desktop " + window.Workspaces.current
        : "Change Wallpaper";
      return t;
    })());

    panel.appendChild(thumbnailsRow(null, mode));

    const urlRow = document.createElement("div");
    urlRow.className = "wp-url-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "set-input";
    input.placeholder = "Paste an image URL…";
    input.maxLength = 500;
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "set-btn";
    applyBtn.textContent = "Apply";
    const go = () => {
      const v = input.value.trim();
      if (/^(https?:|data:|blob:)/i.test(v)) { applyChoice(v); hide(); }
    };
    applyBtn.addEventListener("click", go);
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
    urlRow.append(input, applyBtn);
    panel.appendChild(urlRow);

    const foot = document.createElement("div");
    foot.className = "wp-foot";
    const shuffleBtn = document.createElement("button");
    shuffleBtn.type = "button";
    shuffleBtn.className = "set-btn";
    shuffleBtn.textContent = "Shuffle";
    shuffleBtn.title = "Random wallpaper";
    shuffleBtn.addEventListener("click", () => { shuffle(); hide(); });
    foot.appendChild(shuffleBtn);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "set-btn";
    reset.textContent = mode === "desktop" ? "Reset desktop wallpaper" : "Reset to default";
    reset.addEventListener("click", () => {
      if (mode === "desktop" && window.Workspaces && window.Workspaces.setWallpaper) {
        window.Workspaces.setWallpaper(null);
      } else if (window.Desktop && window.Desktop.clearWallpaper) {
        window.Desktop.clearWallpaper();
      }
      hide();
    });
    foot.appendChild(reset);
    panel.appendChild(foot);

    document.body.appendChild(panel);
    const rect = panel.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    panel.style.left = Math.max(8, Math.min(Math.round(x), vw - rect.width - 8)) + "px";
    panel.style.top = Math.max(8, Math.min(Math.round(y), vh - rect.height - 8)) + "px";

    const onDown = (ev) => { if (!panel.contains(ev.target)) hide(); };
    const onKey = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); hide(); } };
    setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    panel._cleanup = () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      panel.remove();
      panel = null;
    };
  }

  function hide() {
    if (panel) { panel._cleanup(); }
  }

  window.Wallpapers = { show, hide, thumbnailsRow, shuffle, apply: applyChoice };
})();
