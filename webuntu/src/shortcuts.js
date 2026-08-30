// Webuntu OS — Keyboard shortcuts (Phase 3, Task 18)
// The central home for the OS-wide shortcut suite: Super toggles the Start
// menu (moved here from src/startmenu.js), Alt+Tab / Shift+Alt+Tab cycle
// windows through a small visual switcher strip, Ctrl+W closes the focused
// window, Esc closes menus/dialogs, and F1 (or Ctrl+/ / Super+/) opens a
// themed help dialog documenting every shortcut. Shortcuts are inert while
// the screen is locked. Ctrl+W is intercepted globally so the browser tab
// can never be closed by accident.

(function () {
  "use strict";

  const helpEl      = document.getElementById("helpDialog");
  const atBackdrop  = document.getElementById("atBackdrop");
  const atStrip     = document.getElementById("atStrip");
  const helpCloseBtn = document.getElementById("helpCloseBtn");
  const runDialog   = document.getElementById("runDialog");
  const runInput    = document.getElementById("runInput");
  const runGoBtn    = document.getElementById("runGoBtn");
  const runSugg     = document.getElementById("runSugg");

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");

  function locked() { return !!(window.OS && window.OS.isLocked); }

  // ---------- help dialog ----------
  function openHelp() {
    if (window.StartMenu) window.StartMenu.close();
    if (window.SystemBar) window.SystemBar.closePopups();
    closeRun();
    helpEl.classList.add("on");
  }
  function closeHelp() { helpEl.classList.remove("on"); }
  function toggleHelp() { helpEl.classList.contains("on") ? closeHelp() : openHelp(); }

  helpCloseBtn.addEventListener("click", closeHelp);
  helpEl.addEventListener("click", (ev) => { if (ev.target === helpEl) closeHelp(); });

  // ---------- Run-a-command dialog (Alt+F2, Task 70) ----------
  // GNOME-style launcher: type an app name, a file/folder path, or a built-in
  // command and suggestions appear; Enter runs the highlighted entry (or the
  // typed text), Tab fills the input with the highlighted suggestion, ↑/↓ move
  // through suggestions or recall the command history (webuntu.run.history),
  // and Esc / backdrop-click closes. Paths open like a File Manager double-
  // click (folders in the FM, images/PDFs/text in their viewers); "terminal -c
  // <cmd>" runs a command in the Perch shell via window.Terminal.run.
  const RUN_HISTORY_KEY = "webuntu.run.history";

  const RUN_COMMANDS = [
    { run: "help",        icon: "⌨️", label: "help",        sub: "Open the keyboard-shortcuts dialog" },
    { run: "lock",        icon: "🔒", label: "lock",        sub: "Lock the screen" },
    { run: "restart",     icon: "🔄", label: "restart",     sub: "Restart Webuntu" },
    { run: "shutdown",    icon: "⏻",  label: "shutdown",    sub: "Shut down Webuntu" },
    { run: "suspend",     icon: "🌙", label: "suspend",     sub: "Suspend the desktop" },
    { run: "switch-user", icon: "👥", label: "switch-user", sub: "Switch to another account" },
  ];

  let runTreeCache = null;  // FS tree snapshot per dialog session
  let runSel = -1;          // highlighted suggestion index
  let runHistIdx = -1;      // history walk position (-1 = raw input)

  function runHistory() {
    try { return JSON.parse(localStorage.getItem(RUN_HISTORY_KEY) || "[]").filter(Boolean); }
    catch (e) { return []; }
  }
  function pushRunHistory(entry) {
    try {
      const h = [entry, ...runHistory().filter((x) => x !== entry)].slice(0, 12);
      localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(h));
    } catch (e) {}
  }

  function runFsNodes() {
    if (runTreeCache) return runTreeCache;
    const out = [];
    const walk = (node, depth) => {
      if (depth > 7) return;
      for (const c of (node.children || [])) {
        if (c.name === "Trash") continue;
        out.push(c);
        if (window.FS.isFolder(c)) walk(c, depth + 1);
      }
    };
    try { walk(window.FS.root, 0); } catch (e) {}
    runTreeCache = out;
    return out;
  }

  function runCandidates(raw) {
    const q = String(raw || "").trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const a of ((window.Apps && window.Apps.catalog) || [])) {
      if (!a || !a.id) continue;
      const name = String(a.name || "").toLowerCase();
      const blurb = String(a.blurb || "").toLowerCase();
      if (a.id.includes(q) || name.includes(q) || (q.length >= 3 && blurb.includes(q))) {
        out.push({ kind: "App", icon: a.icon || "📦", label: a.name || a.id, sub: (a.blurb || "App") + " — " + a.id, value: a.id });
      }
    }
    for (const n of runFsNodes()) {
      if (out.length >= 14) break;
      const name = n.name || "";
      const path = window.FS.getPath(n);
      if (name.toLowerCase().includes(q) || path.toLowerCase().includes(q)) {
        const icon = window.FS.isFolder(n) ? "📁" : window.FS.isShortcut(n) ? "🔗" : "📄";
        out.push({ kind: "File", icon, label: name, sub: path, value: path });
      }
    }
    for (const c of RUN_COMMANDS) {
      if (c.run.includes(q) || c.label.includes(q)) {
        out.push({ kind: "Command", icon: c.icon, label: c.label, sub: c.sub, value: c.run });
      }
    }
    if (/^terminal\s+-c\s+/.test(q)) {
      out.unshift({ kind: "Command", icon: "🖥️", label: q, sub: "Run in the Perch shell", value: q });
    }
    const seen = new Set();
    return out.filter((c) => (seen.has(c.kind + "|" + c.value) ? false : (seen.add(c.kind + "|" + c.value), true))).slice(0, 9);
  }

  function markSel() {
    [...runSugg.children].forEach((c, i) => c.classList.toggle("sel", i === runSel));
  }
  function renderSugg(items) {
    runSugg.textContent = "";
    runSel = -1;
    if (!items.length) { runSugg.hidden = true; return; }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "run-sugg-item";
      b.dataset.idx = i;
      b.dataset.run = it.value;
      const ico = document.createElement("span");
      ico.className = "rs-ico";
      ico.textContent = it.icon;
      const main = document.createElement("span");
      main.className = "rs-main";
      const b2 = document.createElement("b");
      b2.textContent = it.label;
      const sub = document.createElement("span");
      sub.className = "rs-sub";
      sub.textContent = it.sub;
      main.append(b2, sub);
      const kind = document.createElement("span");
      kind.className = "rs-kind";
      kind.textContent = it.kind;
      b.append(ico, main, kind);
      b.addEventListener("click", () => executeRun(it.value));
      b.addEventListener("mousemove", () => { runSel = i; markSel(); });
      runSugg.appendChild(b);
    }
    runSugg.hidden = false;
  }
  function refreshSugg() {
    runHistIdx = -1;
    renderSugg(runCandidates(runInput.value));
  }

  function recallRunHistory(dir) {
    const h = runHistory();  // newest-first
    if (!h.length) return;
    if (dir < 0) {  // up → older
      if (runHistIdx < 0) runHistIdx = 0;
      else if (runHistIdx < h.length - 1) runHistIdx++;
      else return;
    } else {  // down → newer (back to raw input)
      if (runHistIdx < 0) return;
      runHistIdx--;
      if (runHistIdx < 0) { runHistIdx = -1; runInput.value = ""; refreshSugg(); return; }
    }
    runInput.value = h[runHistIdx];
    runInput.setSelectionRange(runInput.value.length, runInput.value.length);
    refreshSugg();
  }

  // Open a FS path the way a File Manager double-click would.
  function openNode(path) {
    const res = window.FSPath.lookup(path);
    if (!res.ok || !res.node) return false;
    const n = res.node;
    if (window.FS.isFolder(n)) {
      if (window.FileManager && window.FileManager.openPath) { window.FileManager.openPath(path); return true; }
      return false;
    }
    if (window.FS.isShortcut(n)) {
      if (window.Launcher && window.Launcher.launch) { window.Launcher.launch(n); return true; }
      return false;
    }
    const content = n.meta && typeof n.meta.content === "string" ? n.meta.content : "";
    const name = n.name || "";
    if (/\.pdf$/i.test(name) && window.PDFViewer && window.PDFViewer.openPath) window.PDFViewer.openPath(path);
    else if (/^(https?:|data:|blob:)/i.test(content) && !/\.txt$/i.test(name)
             && window.ImageViewer && window.ImageViewer.openPath) window.ImageViewer.openPath(path);
    else if (window.TextEditor && window.TextEditor.openPath) window.TextEditor.openPath(path);
    else return false;
    return true;
  }

  function executeRun(raw) {
    const value = String(raw == null ? "" : raw).trim();
    if (!value) { closeRun(); return; }
    const tm = /^terminal\s+-c\s+(.+)$/.exec(value);
    if (tm) {
      if (window.Terminal && window.Terminal.run) {
        pushRunHistory(value);
        closeRun();
        window.Terminal.run(tm[1]);
      } else if (window.Apps) {
        window.Apps.launch("terminal");
      }
      return;
    }
    const cmd = RUN_COMMANDS.find((c) => c.run === value);
    if (cmd) {
      pushRunHistory(value);
      closeRun();
      if (cmd.run === "help") { openHelp(); return; }
      if (window.PowerMenu && window.PowerMenu.act) window.PowerMenu.act(cmd.run);
      return;
    }
    if (window.Apps && window.Apps.getById(value)) {
      pushRunHistory(value);
      closeRun();
      window.Apps.launch(value);
      return;
    }
    if (window.FSPath && window.FSPath.lookup(value, { cwd: window.FSPath.homePath() }).ok) {
      pushRunHistory(value);
      closeRun();
      openNode(value);
      return;
    }
    closeRun();
    if (window.Notify && window.Notify.toast) {
      window.Notify.toast("Run", "Command not found: \"" + value + "\"", { icon: "❓", app: "Run" });
    }
  }

  function openRun() {
    if (window.StartMenu) window.StartMenu.close();
    if (window.SystemBar) window.SystemBar.closePopups();
    if (window.EmojiPicker && window.EmojiPicker.close) window.EmojiPicker.close();
    closeHelp();
    runTreeCache = null;
    runSel = -1;
    runHistIdx = -1;
    runInput.value = "";
    runSugg.hidden = true;
    runDialog.classList.add("on");
    setTimeout(() => runInput.focus(), 30);
  }
  function closeRun() {
    runDialog.classList.remove("on");
    runSugg.hidden = true;
    runSel = -1;
  }
  function toggleRun() { runDialog.classList.contains("on") ? closeRun() : openRun(); }

  runGoBtn.addEventListener("click", () => executeRun(runInput.value));
  runInput.addEventListener("input", refreshSugg);
  runDialog.addEventListener("click", (ev) => { if (ev.target === runDialog) closeRun(); });
  runInput.addEventListener("keydown", (ev) => {
    const hasSugg = !runSugg.hidden && runSugg.children.length;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (hasSugg) { runSel = (runSel + 1) % runSugg.children.length; markSel(); }
      else recallRunHistory(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (hasSugg) { runSel = runSel <= 0 ? runSugg.children.length - 1 : runSel - 1; markSel(); }
      else recallRunHistory(-1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const selItem = runSel >= 0 && hasSugg ? runSugg.children[runSel] : null;
      executeRun(selItem ? selItem.dataset.run : runInput.value);
    } else if (ev.key === "Tab") {
      ev.preventDefault();
      if (runSel >= 0 && hasSugg) {
        runInput.value = runSugg.children[runSel].dataset.run;
        runInput.setSelectionRange(runInput.value.length, runInput.value.length);
        refreshSugg();
      }
    }
  });

  // ---------- Alt+Tab switcher ----------
  let at = null; // { idx } into the current window list
  function atItems() {
    if (!window.WM) return [];
    // Visible (non-minimized) windows, oldest-first in z-order — the focused
    // window is the last item, so Alt+Tab naturally lands on the
    // next-most-recently-used window (the one just below it).
    return window.WM.getOpen().filter((w) => !w.minimized && !w.closed)
      .sort((a, b) => a.zIndex - b.zIndex);
  }
  function renderStrip(idx) {
    const items = atItems();
    atStrip.textContent = "";
    for (let i = 0; i < items.length; i++) {
      const w = items[i];
      const d = document.createElement("div");
      d.className = "at-item" + (i === idx ? " sel" : "");
      const ico = document.createElement("div");
      ico.className = "at-ico";
      ico.textContent = w.icon;
      const t = document.createElement("div");
      t.className = "at-title";
      t.textContent = w.title;
      d.append(ico, t);
      atStrip.appendChild(d);
    }
  }
  function beginAt() {
    const items = atItems();
    if (items.length < 2) return;
    const focused = window.WM.getFocused();
    let idx = items.length - 1;
    if (focused) { const f = items.findIndex((w) => w.id === focused.id); if (f !== -1) idx = f; }
    at = { idx };
    atBackdrop.classList.add("on");
    atStrip.hidden = false;
    renderStrip(idx);
  }
  function stepAt(dir) {
    if (!at) beginAt();
    const items = atItems();
    if (!at || items.length < 2) return;
    at.idx = (at.idx + dir + items.length) % items.length;
    window.WM.focus(items[at.idx].id);
    // Focusing bumps the window's zIndex, which reorders the list — rebase the
    // selection index onto the now-focused window so highlight stays in sync.
    const focused = window.WM.getFocused();
    const ni = focused ? atItems().findIndex((w) => w.id === focused.id) : -1;
    at.idx = Math.max(0, ni);
    renderStrip(at.idx);
  }
  function endAt() {
    if (!at) return;
    at = null;
    atBackdrop.classList.remove("on");
    atStrip.hidden = true;
    atStrip.textContent = "";
  }

  // ---------- main dispatch ----------
  // Super/Meta is held for combos (Super+., Super+/) as well as the Start-menu
  // toggle. To keep combos from also toggling the Start menu, we only toggle on
  // Meta RELEASE and only when no other key was pressed while Meta was held.
  let metaHeld = false;
  let metaUsed = false;

  window.addEventListener("keydown", (ev) => {
    if (locked()) return;

    // While the window overview (Task 74) or clipboard history (Task 76) is
    // open it owns the keyboard — every other global shortcut stands aside
    // (arrows/Enter/Esc/Delete/Super+Tab/Super+V are handled in their modules).
    if ((window.Overview && window.Overview.isOpen) ||
        (window.ClipboardHistory && window.ClipboardHistory.isOpen)) return;

    // Super / Win key: held for shortcuts; the Start menu toggles on release
    // (skipped on macOS, where Meta is the Cmd modifier and would hijack Cmd
    // shortcuts).
    if (!isMac && (ev.code === "MetaLeft" || ev.code === "MetaRight")) {
      ev.preventDefault();
      metaHeld = true;
      metaUsed = false;
      return;
    }
    if (metaHeld && ev.metaKey && (ev.code !== "MetaLeft" && ev.code !== "MetaRight")) {
      metaUsed = true;
    }

    // Super+. — system emoji picker.
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && ev.key === ".") {
      ev.preventDefault();
      if (window.EmojiPicker) window.EmojiPicker.toggle();
      return;
    }

    // Super+arrows — window snapping (Task 71): snap the focused window to the
    // left/right half (←/→), maximize it (↑), or restore / minimize it (↓).
    // metaUsed is already true by this point, so the Start menu won't toggle on
    // Meta release.
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey &&
        (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault();
      if (window.WM && window.WM.focusedId !== null) {
        const f = window.WM.getById(window.WM.focusedId);
        if (f) {
          if (ev.key === "ArrowLeft") window.WM.snap(f.id, "left");
          else if (ev.key === "ArrowRight") window.WM.snap(f.id, "right");
          else if (ev.key === "ArrowUp") window.WM.maximize(f.id);
          else if (f.maximized) window.WM.unmaximize(f.id);
          else if (f.snap) window.WM.unsnap(f.id);
          else window.WM.minimize(f.id);
        }
      }
      return;
    }

    // Super+D — show desktop (Task 75): minimize every window on the current
    // desktop; a second Super+D restores them. metaUsed is already set above,
    // so the Start menu won't toggle on Meta release.
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && (ev.key === "d" || ev.key === "D")) {
      ev.preventDefault();
      if (window.WM && window.WM.toggleShowDesktop) window.WM.toggleShowDesktop();
      return;
    }

    // Super+V — clipboard history (Task 76). The event is passed through
    // untouched: src/cliphistory.js's own keydown listener opens the picker
    // (capturing the focused text field as the paste target).
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && (ev.key === "v" || ev.key === "V")) {
      ev.preventDefault();
      return;
    }

    // Super+A — Webuntu Assistant (Phase 10, Task 77): open/focus the AI app.
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && (ev.key === "a" || ev.key === "A")) {
      ev.preventDefault();
      if (window.Assistant) window.Assistant.toggle();
      return;
    }

    // Super+H — dictation (Phase 10, Task 79): toggle OS-wide speech-to-text
    // into the focused field (Win+H style; src/voice.js owns the listening).
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && (ev.key === "h" || ev.key === "H")) {
      ev.preventDefault();
      if (window.Dictation) window.Dictation.toggle();
      return;
    }

    // Super+Tab — window overview (Task 74). The event is passed through
    // untouched: src/overview.js's own keydown listener opens the overview
    // (or cycles the selection when it's already open, Shift reversing).
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey &&
        (ev.key === "Tab" || ev.code === "Tab")) {
      ev.preventDefault();
      return;
    }

    // Help: F1, Ctrl+/, Super+/
    if (ev.key === "F1" ||
        (ev.ctrlKey && (ev.key === "/" || ev.key === "?")) ||
        (ev.metaKey && (ev.key === "/" || ev.key === "?"))) {
      ev.preventDefault();
      toggleHelp();
      return;
    }

    // Alt+F2 — run-a-command dialog (GNOME-style).
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && ev.key === "F2") {
      ev.preventDefault();
      toggleRun();
      return;
    }

    // Ctrl+Shift+Esc — Task Manager (Task 88): open/focus the process list.
    if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && ev.key === "Escape") {
      ev.preventDefault();
      if (window.Apps) window.Apps.launch("task-manager");
      return;
    }

    // Esc closes the help/run dialogs (the menus dismiss themselves).
    if (ev.key === "Escape") { closeHelp(); closeRun(); return; }

    // Alt+Tab / Shift+Alt+Tab — cycle windows.
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.key === "Tab" || ev.code === "Tab")) {
      ev.preventDefault();
      stepAt(ev.shiftKey ? -1 : 1);
      return;
    }

    // Ctrl+W — close the focused window (always intercepted so the browser tab
    // never closes on the user).
    if (ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey && (ev.key === "w" || ev.key === "W")) {
      ev.preventDefault();
      if (window.WM && window.WM.focusedId !== null) window.WM.close(window.WM.focusedId);
    }
  });

  // Releasing Alt finalizes the switcher on the highlighted window; releasing
  // Meta toggles the Start menu only if it wasn't part of a combo.
  window.addEventListener("keyup", (ev) => {
    if (ev.key === "Alt") endAt();
    if (!isMac && (ev.code === "MetaLeft" || ev.code === "MetaRight")) {
      // The overview and clipboard-history picker are toggles (Enter/click/Esc
      // resolve them), so releasing Super must not pop the Start menu while
      // either is open.
      if (!metaUsed && window.StartMenu &&
          !(window.Overview && window.Overview.isOpen) &&
          !(window.ClipboardHistory && window.ClipboardHistory.isOpen)) window.StartMenu.toggle();
      metaHeld = false;
      metaUsed = false;
    }
  });

  window.Shortcuts = { openHelp, closeHelp, toggleHelp, openRun, closeRun, toggleRun, executeRun, openNode, fsNodes: runFsNodes, commands: () => RUN_COMMANDS.slice() };
})();
