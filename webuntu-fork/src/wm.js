// Webuntu OS — Window Manager: model + registry (Phase 2, Task 6)
// The window model is the single source of truth for every open window:
//   { id, title, icon, w, h, x, y, minimized, maximized, closed, zIndex, content }
// The module owns the windows array, an id counter and a z counter, and exposes
// lifecycle ops (open/close/focus/minimize/restore/maximize) that maintain the
// invariant "an arbitrary number of windows can be open at once". A minimal DOM
// frame makes windows visible on the desktop; the full chrome (title-bar
// buttons, dragging, resizing, taskbar) arrives in Tasks 7-13.

(function () {
  "use strict";

  const desktopEl = document.getElementById("desktop");

  const MIN_W = 320;
  const MIN_H = 200;
  const DEF_W = 640;
  const DEF_H = 420;

  let windows = [];          // model truth: array of window objects
  let idCounter = 1;
  let zCounter = 10;
  let focusedId = null;

  // Title-bar button glyphs (inline SVG, stroked so they inherit theme color)
  const ICON_MIN = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="8" x2="13" y2="8"/></svg>';
  const ICON_MAX = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.4"/></svg>';
  const ICON_RESTORE = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="5.2" width="8.2" height="8.2" rx="1.4"/><path d="M5.2 5.2V4.4A1.8 1.8 0 0 1 7 2.6h4.6a1.8 1.8 0 0 1 1.8 1.8V9a1.8 1.8 0 0 1-1.8 1.8h-.8"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>';

  function makeBtn(cls, svg, label) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wm-btn " + cls;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = svg;
    return b;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function vw() { return desktopEl ? desktopEl.clientWidth : window.innerWidth; }
  function vh() { return desktopEl ? desktopEl.clientHeight : window.innerHeight; }

  // Task 23 — the taskbar can sit at the bottom (default) or the top (Control
  // Center setting). The "work area" starts below a top taskbar, so windows
  // (maximize fill, spawn, drag/resize/clamp) must offset by its height.
  function workTop() {
    if (document.documentElement.getAttribute("data-taskbar") === "top") {
      return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--taskbar-h")) || 0;
    }
    return 0;
  }

  // Cascade spawn (Task 13): successive windows step down-right across the
  // desktop. A monotonic counter advances on every spawn and a candidate
  // position is skipped if an existing window already occupies (nearly) the
  // same spot — so windows never stack exactly on top of one another, even
  // after many opens/closes.
  let spawnN = 0;
  function cascadePos() {
    const dw = vw(), dh = vh();
    const stepX = 40, stepY = 34;
    const cols = Math.min(6, Math.max(1, Math.floor((dw - MIN_W) / stepX)));
    const rows = Math.max(1, Math.floor((dh - MIN_H) / stepY));
    for (let tries = 0; tries < 200; tries++) {
      // Diagonal cascade: every new window steps down-right; after `cols`
      // windows it wraps to a new diagonal below the first. Each window's
      // title bar + left edge stays visible.
      const i = spawnN;
      const x = 40 + (i % cols) * stepX;
      const y = workTop() + 36 + (i % (cols * rows)) * stepY;
      spawnN++;
      if (!windows.some((w) => Math.abs(w.x - x) < 10 && Math.abs(w.y - y) < 10)) return { x, y };
    }
    return { x: 40, y: workTop() + 36 };
  }

  function createWindow(opts) {
    opts = opts || {};
    const pos = cascadePos();
    const w = clamp(opts.w || DEF_W, MIN_W, vw());
    const h = clamp(opts.h || DEF_H, MIN_H, vh());
    const x = clamp(opts.x !== undefined ? opts.x : pos.x, 0, Math.max(0, vw() - w));
    const y = clamp(opts.y !== undefined ? opts.y : pos.y, workTop(), Math.max(0, vh() - 120));
    return {
      id: opts.id !== undefined ? opts.id : idCounter++,
      title: opts.title || "Untitled",
      icon: opts.icon || "📄",
      appId: opts.appId || null,     // logical app identity (Task 13)
      w, h, x, y,
      minW: opts.minW || MIN_W,
      minH: opts.minH || MIN_H,
      minimized: false,
      maximized: false,
      snap: null,                      // Task 71: "left" | "right" | null
      closed: false,
      zIndex: ++zCounter,
      desktop: (window.Workspaces && window.Workspaces.current) || 1,  // Task 64
      content: opts.content || null,   // HTMLElement to mount in the body
      el: null,                        // DOM node (set once rendered)
      _prevRect: null,                 // geometry saved before maximize
    };
  }

  function getById(id) { return windows.find((o) => String(o.id) === String(id)) || null; }

  function getFocused() { return focusedId !== null ? getById(focusedId) : null; }

  function getOpen() { return windows.slice(); }

  function focusTop() {
    // Skip minimized windows and windows on other desktops (Task 64) — focus
    // must never land on a hidden one.
    const cur = (window.Workspaces && window.Workspaces.current) || 1;
    const visible = windows.filter((o) => !o.minimized && o.desktop === cur);
    if (!visible.length) { focusedId = null; }
    else { focusedId = visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)).id; }
    for (const o of windows) sync(o); // refresh focused chrome on all
  }

  // Clicking the desktop itself (empty area or icons) clears window focus, so
  // no window keeps the focused chrome while the user works on the desktop.
  desktopEl.addEventListener("mousedown", (ev) => {
    if (ev.target.closest(".window")) return; // window mousedown handles its own focus
    if (focusedId !== null) {
      focusedId = null;
      for (const o of windows) sync(o);
      taskbarUpdate();
    }
  });

  // ---------- taskbar (Phase 2, Task 11) ----------
  // One entry per open window (icon + title), stable spawn order. Active
  // window highlighted; minimized windows dimmed. Clicking an entry toggles
  // focus/minimize; a hover "×" or middle-click closes the window.
  const taskbarEl = document.getElementById("taskbarEntries");
  const taskEntries = new Map(); // window id -> entry element

  function taskbarUpdate() {
    if (!taskbarEl) return;
    for (const [id, entry] of taskEntries) {
      if (!getById(id)) { entry.remove(); taskEntries.delete(id); }
    }
    for (const w of windows) {
      let entry = taskEntries.get(w.id);
      if (!entry) {
        entry = document.createElement("div");
        entry.className = "wm-task-item";
        entry.setAttribute("role", "button");
        entry.tabIndex = 0;
        entry.dataset.wid = w.id;

        const ico = document.createElement("span");
        ico.className = "wm-task-ico";
        const title = document.createElement("span");
        title.className = "wm-task-title";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "wm-task-close";
        close.title = "Close";
        close.setAttribute("aria-label", "Close window");
        close.textContent = "✕";
        close.addEventListener("click", (ev) => {
          ev.stopPropagation();
          window.WM.close(w.id);
        });

        entry.addEventListener("click", () => {
          if (w.minimized) window.WM.restore(w.id);
          else if (focusedId === w.id) window.WM.minimize(w.id);
          else window.WM.focus(w.id);
        });
        entry.addEventListener("auxclick", (ev) => {   // middle-click closes
          if (ev.button === 1) { ev.preventDefault(); window.WM.close(w.id); }
        });
        entry.addEventListener("keydown", (ev) => {   // Enter/Space activate
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            entry.click();
          }
        });

        entry._ico = ico;
        entry._title = title;
        entry.append(ico, title, close);
        taskbarEl.appendChild(entry);
        taskEntries.set(w.id, entry);
      }
      entry._ico.textContent = w.icon;
      entry._title.textContent = w.title;
      entry.title = w.title;
      // Task 64 — entries for windows on other desktops stay registered but are
      // hidden from the bar (they reappear when their desktop becomes active).
      entry.classList.toggle("wm-task-other", (window.Workspaces && window.Workspaces.current) !== w.desktop);
      entry.classList.toggle("active", focusedId === w.id);
      entry.classList.toggle("minimized", w.minimized);
    }
  }

  // ---------- model ops ----------
  function focus(id) {
    const w = getById(id);
    if (!w || w.closed || w.minimized) return;
    if (focusedId !== id) {
      focusedId = id;
      w.zIndex = ++zCounter;
    }
    for (const o of windows) sync(o);
    taskbarUpdate();
  }

  // Task 29 — apps can intercept a close request (e.g. the Text Editor's
  // unsaved-changes guard). When `onCloseRequest` is set on the window, it is
  // awaited; returning false cancels the close (the app may re-close itself
  // later). The close button / taskbar handlers don't await this, so a pending
  // guard (a confirm dialog) simply keeps the window open until it resolves.
  async function close(id) {
    const w = getById(id);
    if (!w) return;
    if (typeof w.onCloseRequest === "function") {
      try { if (await w.onCloseRequest() === false) return; }
      catch (e) { return; }
    }
    w.closed = true;
    if (w.el) w.el.remove();
    windows = windows.filter((o) => o.id !== id);
    if (focusedId === id) { focusedId = null; focusTop(); }
    for (const o of windows) sync(o);
    taskbarUpdate();
    if (window.Sounds) window.Sounds.play("close");
  }

  // Task 88 — force-close (the Task Manager's "End process"). Identical to
  // close() but skips the app's onCloseRequest hook, killing even a window
  // that would normally refuse to close (unsaved-changes guards etc.).
  function forceClose(id) {
    const w = getById(id);
    if (!w) return;
    w.closed = true;
    if (w.el) w.el.remove();
    windows = windows.filter((o) => o.id !== id);
    if (focusedId === id) { focusedId = null; focusTop(); }
    for (const o of windows) sync(o);
    taskbarUpdate();
    if (window.Sounds) window.Sounds.play("close");
  }

  function minimize(id) {
    const w = getById(id);
    if (!w || w.closed) return;
    w.minimized = true;
    if (focusedId === id) { focusedId = null; focusTop(); }
    sync(w);
    taskbarUpdate();
  }

  function restore(id) {
    const w = getById(id);
    if (!w || w.closed) return;
    w.minimized = false;
    focus(id);
    taskbarUpdate();
    if (window.Sounds) window.Sounds.play("open");
  }

  function maximize(id) {
    const w = getById(id);
    if (!w || w.closed) return;
    if (!w.maximized) {
      savePrevRect(w);
      w.maximized = true;
      w.snap = null;
      w.minimized = false;   // Super+↑ wakes a minimized window too
    }
    focus(id);
    sync(w);
    taskbarUpdate();
  }

  function unmaximize(id) {
    const w = getById(id);
    if (!w || w.closed) return;
    const wasMax = w.maximized;
    w.maximized = false;
    if (wasMax) restorePrevRect(w);   // saved geometry may be stale if the viewport shrank
    sync(w);
    taskbarUpdate();
  }

  // Task 71 — window snapping (Super+arrows). A snapped window fills the left
  // or right half of the work area, exactly like maximize but half-width. The
  // model geometry (x/y/w/h) is left untouched — it keeps holding the pre-snap
  // rect so Super+↓ (or a drag/resize) restores the window where it was — and
  // sync() renders the snapped layout from the `snap` flag, mirroring maximize.
  function savePrevRect(w) {
    if (!w._prevRect) w._prevRect = { x: w.x, y: w.y, w: w.w, h: w.h };
  }
  function restorePrevRect(w) {
    if (!w._prevRect) return;
    w.x = w._prevRect.x;
    w.y = w._prevRect.y;
    w.w = w._prevRect.w;
    w.h = w._prevRect.h;
    w._prevRect = null;
    clampIntoView(w);
  }

  function snap(id, dir) {
    const w = getById(id);
    if (!w || w.closed) return;
    const side = dir === "right" ? "right" : "left";
    if (w.snap !== side) {
      savePrevRect(w);
      w.snap = side;
      w.maximized = false;
      w.minimized = false;   // Super+←/→ wake a minimized window too
    }
    focus(id);
    sync(w);
    taskbarUpdate();
  }

  function unsnap(id) {
    const w = getById(id);
    if (!w || w.closed) return;
    const wasSnapped = w.snap;
    w.snap = null;
    if (wasSnapped) restorePrevRect(w);
    sync(w);
    taskbarUpdate();
  }

  function toggleMaximize(id) {
    const w = getById(id);
    if (!w) return;
    if (w.maximized) unmaximize(id); else maximize(id);
  }

  // ---------- show desktop (Task 75) ----------
  // Super+D / the tray peek-strip button minimizes every window on the CURRENT
  // desktop ("Show Desktop"); pressing again restores exactly the windows that
  // were visible. Each activation re-snapshots the currently visible set, so
  // the toggle stays self-consistent even if the user opened/closed/restored
  // windows in between — a window moved to another desktop is skipped on
  // restore, and one closed while hidden stays closed. Maximized/snapped
  // windows come back in the same state (their flags are untouched).
  let showDesktop = null; // { desktop, ids } | null

  function toggleShowDesktop() {
    if (showDesktop) {
      const st = showDesktop;
      showDesktop = null;
      for (const id of st.ids) {
        const w = getById(id);
        if (w && !w.closed && w.desktop === st.desktop) w.minimized = false;
      }
      focusTop();   // focus lands on the top restored window
      for (const o of windows) sync(o);
      taskbarUpdate();
      if (window.Sounds) window.Sounds.play("open");
      return true;
    }
    const cur = (window.Workspaces && window.Workspaces.current) || 1;
    const vis = windows.filter((w) => !w.closed && w.desktop === cur && !w.minimized);
    if (!vis.length) return false;   // nothing to hide
    showDesktop = { desktop: cur, ids: vis.map((w) => w.id) };
    for (const w of vis) w.minimized = true;
    focusTop();   // no visible windows remain → focus chrome clears
    for (const o of windows) sync(o);
    taskbarUpdate();
    if (window.Sounds) window.Sounds.play("close");
    return true;
  }
  function isShowDesktopActive() { return showDesktop !== null; }

  // ---------- rendering (minimal frame; full chrome in Task 7) ----------
  function sync(w) {
    const el = w.el;
    if (!el) return;
    el.classList.toggle("focused", focusedId === w.id);
    el.classList.toggle("minimized", w.minimized);
    // Task 64 — windows live on a specific desktop; hidden while others are active.
    el.classList.toggle("wm-other-desktop", (window.Workspaces && window.Workspaces.current) !== w.desktop);
    if (w._btnMax) w._btnMax.innerHTML = w.maximized ? ICON_RESTORE : ICON_MAX;
    el.style.zIndex = w.zIndex;
    if (w.maximized) {
      // Maximize fills the work area ABOVE the taskbar (Task 12) — the shared
      // --taskbar-h token keeps the window height in sync with the bar itself.
      // With a top taskbar (Task 23) the work area starts below it instead.
      el.style.left = "0px";
      el.style.top = workTop() + "px";
      el.style.width = "100%";
      el.style.height = "calc(100% - var(--taskbar-h))";
      el.classList.add("maximized");
      el.classList.remove("snapped-left", "snapped-right");
    } else if (w.snap) {
      // Task 71 — snapped halves. Each window takes half the work width with a
      // 1px inset so the two 1px borders form a clean 2px divider between them.
      const right = w.snap === "right";
      el.style.left = right ? "calc(50% + 1px)" : "0px";
      el.style.top = workTop() + "px";
      el.style.width = "calc(50% - 1px)";
      el.style.height = "calc(100% - var(--taskbar-h))";
      el.classList.remove("maximized");
      el.classList.toggle("snapped-left", !right);
      el.classList.toggle("snapped-right", right);
    } else {
      el.style.left = w.x + "px";
      el.style.top = w.y + "px";
      el.style.width = w.w + "px";
      el.style.height = w.h + "px";
      el.classList.remove("maximized", "snapped-left", "snapped-right");
    }
  }

  function render(w) {
    const el = document.createElement("div");
    el.className = "window";
    el.dataset.wid = w.id;

    // Title bar chrome: icon + title (dbl-click maximizes) + min/max/close.
    const top = document.createElement("div");
    top.className = "wm-top";

    const ico = document.createElement("span");
    ico.className = "wm-ico";
    ico.textContent = w.icon;

    const title = document.createElement("span");
    title.className = "wm-title";
    title.textContent = w.title;

    const btns = document.createElement("div");
    btns.className = "wm-btns";
    const btnMin = makeBtn("min", ICON_MIN, "Minimize");
    const btnMax = makeBtn("max", ICON_MAX, "Maximize");
    const btnClose = makeBtn("close", ICON_CLOSE, "Close");
    btns.append(btnMin, btnMax, btnClose);

    top.append(ico, title, btns);
    el.appendChild(top);

    // Isolated scrollable content area.
    const body = document.createElement("div");
    body.className = "wm-body";
    if (w.content instanceof Node) {
      body.appendChild(w.content);
    } else {
      body.textContent = w.content || "App content area — ships with the apps (Phase 6).";
    }
    el.appendChild(body);

    // Chrome interactions (dragging arrives in Task 8 — buttons must stay
    // isolated from it, which the .wm-btn guards below already ensure).
    top.addEventListener("dblclick", (ev) => {
      if (ev.target.closest(".wm-btn")) return;
      window.WM.toggleMaximize(w.id);
    });
    btnMin.addEventListener("click", (ev) => { ev.stopPropagation(); window.WM.minimize(w.id); });
    btnMax.addEventListener("click", (ev) => { ev.stopPropagation(); window.WM.toggleMaximize(w.id); });
    btnClose.addEventListener("click", (ev) => { ev.stopPropagation(); window.WM.close(w.id); });

    // Clicking anywhere on the window raises it to front.
    el.addEventListener("mousedown", () => { window.WM.focus(w.id); });

    // Title-bar drag (Task 8). Attached to the title bar; guards keep it from
    // ever starting on the chrome buttons.
    top.addEventListener("pointerdown", (ev) => startDrag(ev, w, top));
    top.addEventListener("pointermove", onDragMove);
    top.addEventListener("pointerup", endDrag);
    top.addEventListener("pointercancel", endDrag);

    // Resize handles (Task 9): thin edge strips + larger corner squares.
    for (const [name, dir] of RESIZE_DIRS) {
      const h = document.createElement("div");
      h.className = "wm-resize " + name;
      h.addEventListener("pointerdown", (ev) => startResize(ev, w, h, dir));
      h.addEventListener("pointermove", onResizeMove);
      h.addEventListener("pointerup", endResize);
      h.addEventListener("pointercancel", endResize);
      el.appendChild(h);
    }

    desktopEl.appendChild(el);
    w.el = el;
    w._btnMax = btnMax;
    sync(w);
    return w;
  }

  function spawn(opts) {
    const w = createWindow(opts);
    windows.push(w);
    render(w);
    focus(w.id);
    taskbarUpdate();
    if (window.Sounds) window.Sounds.play("open");
    return w;
  }

  // Task 13 — "opening an already-open app focuses it (or spawns a second
  // instance — behavior defined per app)". Apps identify themselves with an
  // `appId`; when that app is already open and the caller did not opt into
  // multiple instances (`singleton:false`), we just bring the existing window
  // to the front (un-minimizing it if needed) instead of spawning a duplicate.
  function open(opts) {
    if (opts && opts.appId) {
      const existing = windows.find((w) => w.appId === opts.appId && !w.closed);
      if (existing && opts.singleton !== false) {
        // Task 64 — a singleton app open on another desktop moves to the
        // current one (GNOME-style) instead of being focused invisibly.
        if (existing.desktop !== ((window.Workspaces && window.Workspaces.current) || 1)) {
          existing.desktop = (window.Workspaces && window.Workspaces.current) || 1;
          if (existing.el) existing.el.classList.remove("wm-other-desktop");
          taskbarUpdate();
        }
        if (existing.minimized) restore(existing.id);
        else focus(existing.id);
        return existing;
      }
    }
    return spawn(opts);
  }

  function findByAppId(appId) {
    return windows.find((w) => w.appId === appId && !w.closed) || null;
  }

  // Task 28 — File Manager updates its window title (and taskbar entry) as it
  // navigates; the chrome title bar text is refreshed here so the DOM follows
  // the model.
  function setTitle(id, title) {
    const w = getById(id);
    if (!w) return;
    w.title = title;
    if (w.el) {
      const t = w.el.querySelector(".wm-title");
      if (t) t.textContent = title;
    }
    taskbarUpdate();
  }

  // ---------- dragging (Phase 2, Task 8) ----------
  // A title-bar drag translates the window model (x/y) live during pointer
  // movement, clamped so the title bar always stays reachable on the desktop.
  // Uses pointer capture so the drag survives the cursor leaving the element.
  const TITLE_H = 42;   // height of the title bar zone kept on-screen
  const VISIBLE = 80;   // min horizontal window width kept visible

  let drag = null; // { w, startX, startY, startLeft, startTop, fromMax, snapZone }

  function clampDrag(x, y, w, h) {
    const dw = vw();
    const dh = vh();
    const minX = -Math.max(0, w - VISIBLE);
    const maxX = Math.max(0, dw - VISIBLE);
    return {
      x: clamp(x, minX, maxX),
      y: clamp(y, workTop(), Math.max(0, dh - TITLE_H)),
    };
  }

  // Task 73 — drag-to-snap. While a window is being dragged, hovering the
  // screen edges shows a translucent snap preview on that half (or full width
  // at the top); releasing over the preview snaps / maximizes the window, like
  // Windows. The preview element is created here and styled in index.html.
  const snapPreview = document.createElement("div");
  snapPreview.id = "snapPreview";
  snapPreview.className = "snap-preview";
  snapPreview.hidden = true;
  desktopEl.appendChild(snapPreview);

  const SNAP_EDGE = 14; // pixels from an edge that counts as a snap zone

  function snapZoneFor(ev) {
    const dw = vw();
    const t = workTop();
    if (ev.clientY <= t + SNAP_EDGE) return "top";
    if (ev.clientX <= SNAP_EDGE) return "left";
    if (ev.clientX >= dw - SNAP_EDGE) return "right";
    return null;
  }

  function showSnapPreview(zone) {
    if (!zone) { snapPreview.hidden = true; return; }
    const t = workTop();
    const h = "calc(100% - var(--taskbar-h))";
    if (zone === "top") {
      snapPreview.style.left = "0px";
      snapPreview.style.top = t + "px";
      snapPreview.style.width = "100%";
    } else if (zone === "left") {
      snapPreview.style.left = "0px";
      snapPreview.style.top = t + "px";
      snapPreview.style.width = "calc(50% - 1px)";
    } else {
      snapPreview.style.left = "calc(50% + 1px)";
      snapPreview.style.top = t + "px";
      snapPreview.style.width = "calc(50% - 1px)";
    }
    snapPreview.style.height = h;
    snapPreview.classList.toggle("snap-preview-full", zone === "top");
    snapPreview.hidden = false;
  }

  function startDrag(ev, w, top) {
    if (ev.button !== 0 && ev.pointerType === "mouse") return; // left only
    if (ev.target.closest(".wm-btn")) return;                  // never from buttons
    if (w.snap) unsnap(w.id);                                  // dragging unsnaps (Task 71)
    window.WM.focus(w.id);
    drag = {
      w, fromMax: w.maximized, snapZone: null,
      startX: ev.clientX, startY: ev.clientY, startLeft: w.x, startTop: w.y,
    };
    w.el.classList.add("dragging");
    try { top.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.preventDefault();
  }

  function onDragMove(ev) {
    if (!drag) return;
    const w = drag.w;

    // Dragging a maximized window's title bar: it stays stuck to the top until
    // the cursor drops a little, then it "unsticks" — restores to the pre-max
    // rect under the cursor and continues as a normal drag (Task 73).
    if (drag.fromMax) {
      if (ev.clientY - drag.startY < 28) return;      // still stuck at the top
      drag.fromMax = false;
      w.maximized = false;
      clampIntoView(w);
      w.x = clamp(ev.clientX - w.w / 2, 0, Math.max(0, vw() - w.w));
      w.y = clamp(ev.clientY - 16, workTop(), Math.max(0, vh() - TITLE_H));
      drag.startX = ev.clientX;
      drag.startY = ev.clientY;
      drag.startLeft = w.x;
      drag.startTop = w.y;
      sync(w);
    }

    const pos = clampDrag(
      drag.startLeft + (ev.clientX - drag.startX),
      drag.startTop + (ev.clientY - drag.startY),
      w.w,
      w.h
    );
    w.x = pos.x;
    w.y = pos.y;
    sync(w);

    // Snap-zone preview (only for non-maximized drags).
    const zone = drag.fromMax ? null : snapZoneFor(ev);
    if (zone !== drag.snapZone) { drag.snapZone = zone; showSnapPreview(zone); }
  }

  function endDrag(ev) {
    if (!drag) return;
    const w = drag.w;
    const zone = drag.snapZone;
    const stuckMax = drag.fromMax;
    drag = null;
    showSnapPreview(null);
    if (w.el) w.el.classList.remove("dragging");
    if (zone) {
      // Released over a snap zone → snap (left/right half) or maximize (top).
      if (zone === "top") window.WM.maximize(w.id);
      else window.WM.snap(w.id, zone);
    } else if (stuckMax) {
      // A maximized window that was grabbed but never pulled far enough to
      // un-stick simply stays maximized.
      sync(w);
    }
  }

  // ---------- resizing (Phase 2, Task 9) ----------
  // Edge/corner handles resize the window model live. Direction flags are
  // T/B/L/R (top/bottom/left/right); opposite edges stay fixed and the window
  // is clamped to its min size and to the visible desktop.
  const RESIZE_DIRS = [
    ["n",  { T: 1 }], ["s",  { B: 1 }], ["e",  { R: 1 }], ["w",  { L: 1 }],
    ["ne", { T: 1, R: 1 }], ["nw", { T: 1, L: 1 }], ["se", { B: 1, R: 1 }], ["sw", { B: 1, L: 1 }],
  ];

  let resize = null; // { w, dir, startX, startY, X, Y, W, H }

  function startResize(ev, w, handle, dir) {
    if (ev.button !== 0 && ev.pointerType === "mouse") return;
    if (w.maximized) return;              // maximized windows don't resize
    if (w.snap) unsnap(w.id);             // resizing unsnaps (Task 71)
    window.WM.focus(w.id);
    resize = {
      w, dir,
      startX: ev.clientX, startY: ev.clientY,
      X: w.x, Y: w.y, W: w.w, H: w.h,
    };
    w.el.classList.add("resizing");
    try { handle.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.preventDefault();
  }

  function onResizeMove(ev) {
    if (!resize) return;
    const r = resize;
    const w = r.w;
    const dx = ev.clientX - r.startX;
    const dy = ev.clientY - r.startY;
    let x = r.X, y = r.Y, nw = r.W, nh = r.H;
    if (r.dir.R) nw = clamp(r.W + dx, w.minW, vw());
    if (r.dir.L) nw = clamp(r.W - dx, w.minW, vw());
    if (r.dir.B) nh = clamp(r.H + dy, w.minH, vh());
    if (r.dir.T) nh = clamp(r.H - dy, w.minH, vh());
    if (r.dir.L) x = r.X + (r.W - nw);
    if (r.dir.T) y = r.Y + (r.H - nh);
    x = clamp(x, 0, Math.max(0, vw() - nw));
    y = clamp(y, workTop(), Math.max(0, vh() - TITLE_H));
    w.x = x; w.y = y; w.w = nw; w.h = nh;
    sync(w);
  }

  function endResize(ev) {
    if (!resize) return;
    const w = resize.w;
    resize = null;
    if (w.el) w.el.classList.remove("resizing");
  }

  // ---------- public API ----------
  // Task 13 — windows must never end up permanently off-screen. When the
  // viewport shrinks (or any geometry change could push a window out of view),
  // every open window is re-clamped back into the visible desktop: position is
  // pulled in, and a window larger than the desktop is shrunk to fit so its
  // title bar always stays reachable. Maximized windows are handled by sync().
  function clampIntoView(w) {
    if (!w || w.closed || w.maximized) return;
    const dw = vw(), dh = vh();
    w.w = Math.min(w.w, dw);
    w.h = Math.min(w.h, dh);
    w.x = clamp(w.x, 0, Math.max(0, dw - w.w));
    w.y = clamp(w.y, workTop(), Math.max(0, dh - TITLE_H));
    if (w.el) sync(w);
  }
  function clampAllIntoView() {
    for (const w of windows) clampIntoView(w);
    taskbarUpdate();
  }
  window.addEventListener("resize", clampAllIntoView);

  window.WM = {
    get windows() { return windows; },
    get focusedId() { return focusedId; },
    create: createWindow,
    spawn,
    open,
    close,
    forceClose,
    focus,
    minimize,
    restore,
    maximize,
    unmaximize,
    toggleMaximize,
    snap,
    unsnap,
    getById,
    findByAppId,
    setTitle,
    getFocused,
    getOpen,
    count: () => windows.length,
    // Task 23 — re-apply geometry to every open window (used when the taskbar
    // position changes so maximized/clamped windows pick up the new work area).
    layout: () => { for (const o of windows) sync(o); taskbarUpdate(); },
    // Task 64 — workspaces needs to re-render the taskbar (window→desktop
    // visibility) and recompute focus when desktops switch.
    refreshTaskbar: taskbarUpdate,
    focusTop,
    // Task 75 — Show Desktop (Super+D / tray peek strip).
    toggleShowDesktop,
    isShowDesktopActive,
  };
})();
