// Webuntu OS — Window overview / Mission Control (Task 74)
// Super+Tab opens a full-screen overview of every window on the CURRENT
// desktop (GNOME Activities / macOS Mission Control style), arranged as a grid
// of live-preview tiles. Each tile shows a scaled, inert clone of the real
// window plus its icon + title and a per-tile close button; minimized windows
// appear dimmed and restore on click. Clicking a tile (or Enter on the
// selected one) focuses/restores that window and closes the overview; Esc,
// the backdrop, or clicking empty grid space just closes it; Backspace/Delete
// closes the selected window. While the overview is open it owns the keyboard
// (arrows move the selection, Home/End jump, Shift+Super+Tab cycles
// backwards), so the global shortcut layer stands aside (see the guard in
// src/shortcuts.js). The overview only covers the current desktop — windows on
// other workspaces are skipped, matching Alt+Tab.

(function () {
  "use strict";

  const el = document.getElementById("overview");
  const grid = document.getElementById("ovGrid");
  const GRID_GAP = 22; // keep in sync with the CSS `gap` on #ovGrid

  let isOpen = false;
  let sel = -1;
  let tiles = []; // { w, tile }

  function locked() { return !!(window.OS && window.OS.isLocked); }
  function currentDesktop() { return (window.Workspaces && window.Workspaces.current) || 1; }

  // Windows on the current desktop, oldest-first in z-order (stacking order).
  function collectWindows() {
    if (!window.WM) return [];
    const cur = currentDesktop();
    return window.WM.windows
      .filter((w) => !w.closed && w.desktop === cur)
      .sort((a, b) => a.zIndex - b.zIndex);
  }

  // Build one tile per window: a live-preview clone (scaled to fit the tile,
  // pointer-events:none so it's pure decoration) + an icon/title/close bar.
  function buildTiles(wins) {
    grid.textContent = "";
    tiles = [];
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      const tile = document.createElement("div");
      tile.className = "ov-tile";
      tile.tabIndex = 0;
      tile.dataset.wid = w.id;
      tile.setAttribute("role", "option");
      tile.setAttribute("aria-selected", "false");
      tile.setAttribute("aria-label", w.title + (w.minimized ? " (minimized)" : ""));
      tile.title = w.title;

      const prev = document.createElement("div");
      prev.className = "ov-preview";
      if (w.el) {
        // The clone is inert (listeners aren't cloned) and display-only. Its
        // inline geometry is forced to the window's MODEL size — the real
        // element may be maximized/snapped (100% width) — so every thumbnail
        // is the window's natural footprint.
        const clone = w.el.cloneNode(true);
        clone.classList.add("ov-clone");
        clone.classList.remove("focused", "dragging", "resizing", "minimized", "wm-other-desktop");
        clone.style.position = "relative";
        clone.style.left = "0";
        clone.style.top = "0";
        clone.style.width = w.w + "px";
        clone.style.height = w.h + "px";
        prev.appendChild(clone);
      }
      tile.appendChild(prev);

      const bar = document.createElement("div");
      bar.className = "ov-bar";
      const ico = document.createElement("span");
      ico.className = "ov-ico";
      ico.textContent = w.icon;
      const name = document.createElement("span");
      name.className = "ov-name";
      name.textContent = w.title;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "ov-close";
      close.title = "Close " + w.title;
      close.setAttribute("aria-label", "Close " + w.title);
      close.textContent = "✕";
      close.addEventListener("click", (ev) => { ev.stopPropagation(); killByWid(w.id); });
      bar.append(ico, name, close);
      tile.appendChild(bar);

      if (w.minimized) tile.classList.add("minimized");

      tile.addEventListener("click", (ev) => {
        if (ev.target.closest(".ov-close")) return;
        activateByWid(w.id);
      });
      tile.addEventListener("mousemove", () => { if (sel !== i) selTo(i); });
      grid.appendChild(tile);
      tiles.push({ w, tile });
    }

    // Scale every clone uniformly to fit its preview box (letterboxed).
    for (const { w, tile } of tiles) {
      const prev = tile.querySelector(".ov-preview");
      const clone = tile.querySelector(".ov-clone");
      if (!clone) continue;
      const pw = prev.clientWidth || 1;
      const ph = prev.clientHeight || 1;
      const s = Math.min(pw / w.w, ph / w.h);
      clone.style.transform = "scale(" + s + ")";
    }
    return tiles;
  }

  function activateByWid(id) {
    const w = window.WM && window.WM.getById(id);
    if (!w || w.closed) { rebuild(); return; }
    if (w.minimized) window.WM.restore(id);
    else window.WM.focus(id);
    close();
  }

  // Close a window from its tile's ✕ (or Backspace/Delete). WM.close is async
  // (an app may show an unsaved-changes guard), so the grid rebuilds when it
  // settles — a cancelled close keeps the tile.
  function killByWid(id) {
    Promise.resolve(window.WM.close(id)).then(() => {
      if (!isOpen) return;
      rebuild();
      if (!tiles.length) close();
    }).catch(() => {});
  }

  function cols() {
    if (!tiles.length) return 1;
    const w = tiles[0].tile.offsetWidth || 1;
    return Math.max(1, Math.floor((grid.clientWidth + GRID_GAP) / (w + GRID_GAP)));
  }

  function selTo(i) {
    if (!tiles.length) return;
    i = Math.max(0, Math.min(tiles.length - 1, i));
    sel = i;
    tiles.forEach((t, k) => {
      const isSel = k === i;
      t.tile.classList.toggle("sel", isSel);
      t.tile.setAttribute("aria-selected", isSel ? "true" : "false");
    });
    tiles[i].tile.focus({ preventScroll: false });
  }
  function step(dir) { selTo(sel + dir); }
  // Horizontal moves wrap around the grid like the Start-menu search; vertical
  // moves clamp at the first/last row.
  function stepH(dir) { selTo((sel + dir + tiles.length) % tiles.length); }

  function rebuild() {
    if (!isOpen) return;
    const prevWid = tiles[sel] ? tiles[sel].w.id : null;
    const fresh = buildTiles(collectWindows());
    if (!fresh.length) { close(); return; }
    const idx = prevWid ? fresh.findIndex((t) => t.w.id === prevWid) : -1;
    sel = idx >= 0 ? idx : Math.min(sel, fresh.length - 1);
    selTo(sel);
  }

  function closeTransients() {
    if (window.StartMenu) window.StartMenu.close();
    if (window.SystemBar) window.SystemBar.closePopups();
    if (window.EmojiPicker && window.EmojiPicker.close) window.EmojiPicker.close();
    if (window.ClipboardHistory && window.ClipboardHistory.close) window.ClipboardHistory.close();
    if (window.Shortcuts) {
      if (window.Shortcuts.closeHelp) window.Shortcuts.closeHelp();
      if (window.Shortcuts.closeRun) window.Shortcuts.closeRun();
    }
  }

  function open() {
    if (isOpen || locked()) return;
    closeTransients();
    const wins = collectWindows();
    if (!wins.length) {
      if (window.Notify && window.Notify.toast) {
        window.Notify.toast("Overview", "No windows are open on this desktop", { icon: "🗔", app: "Overview" });
      }
      return;
    }
    isOpen = true;
    el.classList.add("on");
    buildTiles(wins);
    // Start the selection on the currently focused window, else the top one.
    const focused = window.WM && window.WM.getFocused();
    const idx = focused ? tiles.findIndex((t) => t.w.id === focused.id) : -1;
    sel = idx >= 0 ? idx : tiles.length - 1;
    selTo(sel);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    el.classList.remove("on");
    grid.textContent = "";
    tiles = [];
    sel = -1;
  }

  function toggle() { isOpen ? close() : open(); }

  // While the overview is open it owns the keyboard. The global shortcut layer
  // (shortcuts.js) early-returns for every key, so nothing else acts under the
  // overlay. Enter/Space activate the selection, arrows move it, Home/End jump,
  // Backspace/Delete close the selected window, Shift+Super+Tab cycles
  // backwards, and Esc/backdrop/empty-grid click dismiss.
  window.addEventListener("keydown", (ev) => {
    // Closed: the Super+Tab press that opens the overview lands here (the
    // shortcuts.js layer just preventDefaults and lets it pass through).
    if (!isOpen) {
      if (!locked() && ev.metaKey && !ev.ctrlKey && !ev.altKey &&
          (ev.key === "Tab" || ev.code === "Tab")) {
        ev.preventDefault();
        open();
      }
      return;
    }
    if (locked()) { close(); return; }
    if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
    if (ev.metaKey && (ev.key === "Tab" || ev.code === "Tab")) {
      ev.preventDefault();
      step(ev.shiftKey ? -1 : 1);
      return;
    }
    if (ev.key === "ArrowRight") { ev.preventDefault(); stepH(1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); stepH(-1); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); step(cols()); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); step(-cols()); }
    else if (ev.key === "Home") { ev.preventDefault(); selTo(0); }
    else if (ev.key === "End") { ev.preventDefault(); selTo(tiles.length - 1); }
    else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (tiles[sel]) activateByWid(tiles[sel].w.id);
    }
    else if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      if (tiles[sel]) killByWid(tiles[sel].w.id);
    }
  });

  el.addEventListener("click", (ev) => {
    if (!isOpen) return;
    if (ev.target === el || ev.target === grid || ev.target.closest(".ov-head")) close();
  });

  // Account switch / unlock closes the overview (the lock screen sits above it).
  document.addEventListener("webuntu-userchange", () => { if (isOpen) close(); });

  window.Overview = {
    get isOpen() { return isOpen; },
    open, close, toggle,
  };
})();
