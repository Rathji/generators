// Webuntu OS — Context menus (Phase 3, Task 17)
// A single reusable themed right-click menu. window.ContextMenu.show(x, y,
// items) renders a popup menu at the cursor (clamped to the viewport) and
// dismisses on outside click, Esc, scroll or resize. Items are
// { label, icon?, danger?, disabled?, onClick }.
//
// The module also owns the global contextmenu dispatch, so a right-click in
// the three shell zones (window title bars, taskbar, desktop) replaces the
// browser menu with the OS menu; app content areas keep the browser default
// (their own apps can override it later). The wallpaper/display items route
// into the Settings stub for now — they get real behavior in Tasks 23-25.

(function () {
  "use strict";

  const menuEl = document.createElement("div");
  menuEl.className = "ctx-menu";
  menuEl.setAttribute("role", "menu");
  menuEl.tabIndex = -1;
  menuEl.hidden = true;
  document.body.appendChild(menuEl);

  let open = false;
  let activeIdx = -1;

  function setActive(idx, el) {
    activeIdx = idx;
    for (const c of menuEl.children) c.classList.toggle("active", c === el);
  }

  function itemEl(item, idx) {
    if (item.sep) {
      const s = document.createElement("div");
      s.className = "ctx-sep";
      return s;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ctx-item" + (item.danger ? " danger" : "") + (item.disabled ? " disabled" : "");
    b.disabled = !!item.disabled;
    b.dataset.idx = idx;
    b.setAttribute("role", "menuitem");
    if (item.icon) {
      const i = document.createElement("span");
      i.className = "ctx-ico";
      i.textContent = item.icon;
      b.appendChild(i);
    }
    const l = document.createElement("span");
    l.className = "ctx-label";
    l.textContent = item.label;
    b.appendChild(l);
    b.addEventListener("click", () => {
      if (item.disabled) return;
      hide();
      if (item.onClick) item.onClick();
    });
    b.addEventListener("mouseenter", () => setActive(idx, b));
    return b;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function show(x, y, items) {
    items = items || [];
    menuEl.textContent = "";
    if (!items.length) { hide(); return; }
    for (let i = 0; i < items.length; i++) menuEl.appendChild(itemEl(items[i], i));
    menuEl.hidden = false;
    // Measure while unfixed (top-left), then clamp into the viewport.
    const rect = menuEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    menuEl.style.left = clamp(Math.round(x), 2, Math.max(2, vw - rect.width - 2)) + "px";
    menuEl.style.top = clamp(Math.round(y), 2, Math.max(2, vh - rect.height - 2)) + "px";
    open = true;
    const first = [...menuEl.children].find((c) => !c.disabled && !c.classList.contains("ctx-sep"));
    setActive(first ? Number(first.dataset.idx) : 0, first || null);
    menuEl.focus();
  }

  function hide() {
    if (!open) return;
    open = false;
    menuEl.hidden = true;
    menuEl.textContent = "";
    activeIdx = -1;
  }

  function move(dir) {
    const btns = [...menuEl.children].filter((b) => !b.disabled && !b.classList.contains("ctx-sep"));
    if (!btns.length) return;
    let idx = btns.indexOf(menuEl.children[activeIdx]);
    idx = (idx + dir + btns.length) % btns.length;
    setActive(Number(btns[idx].dataset.idx), btns[idx]);
  }

  function activate() {
    const el = menuEl.children[activeIdx];
    if (el && !el.disabled && !el.classList.contains("ctx-sep")) el.click();
  }

  // ---------- editable-field edit menu (Task 85) ----------
  // Cut/Copy/Paste for the focused field + AI transforms on the current
  // selection (Polish / Rewrite / Summarize via the AI text plugin). The AI
  // result replaces the selection in place; a small pulsing chip marks the
  // field while it generates.
  function editableField(node) {
    return node.closest ? node.closest("textarea, input, [contenteditable]") : null;
  }
  function focusField(f) {
    try { f.focus({ preventScroll: true }); } catch (e) { try { f.focus(); } catch (err) {} }
  }
  function fieldSelection(f) {
    if (!f) return "";
    if (f.tagName === "INPUT" || f.tagName === "TEXTAREA") {
      const s = f.selectionStart == null ? 0 : f.selectionStart;
      const e = f.selectionEnd == null ? s : f.selectionEnd;
      return (f.value || "").slice(s, e);
    }
    const sel = window.getSelection();
    return sel ? sel.toString() : "";
  }
  function pasteInto(f) {
    focusField(f);
    let ok = false;
    try { ok = document.execCommand("paste"); } catch (e) {}
    if (ok) return;
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((t) => {
        if (t && window.ClipboardHistory && window.ClipboardHistory.insertInto) {
          window.ClipboardHistory.insertInto(f, t);
        }
      }).catch(() => {});
    }
  }
  let busyChip = null;
  function busyOn(f, label) {
    busyOff();
    const c = document.createElement("div");
    c.className = "ai-edit-busy";
    c.textContent = "✨ " + label + "…";
    document.body.appendChild(c);
    const r = (f && f.isConnected && f.getBoundingClientRect) ? f.getBoundingClientRect() : { top: innerHeight / 2, left: innerWidth / 2 };
    c.style.left = Math.max(8, Math.min(Math.round(r.left), innerWidth - 220)) + "px";
    c.style.top = Math.max(8, Math.round(r.top - 36)) + "px";
    busyChip = c;
  }
  function busyOff() {
    if (busyChip) { busyChip.remove(); busyChip = null; }
  }
  async function aiEdit(f, sel, kind) {
    const CH = window.ClipboardHistory;
    if (!CH || typeof CH.aiAction !== "function") {
      if (window.Notify) window.Notify.toast("AI " + kind, "the AI text plugin isn't loaded", { icon: "⚠️", app: "AI" });
      return;
    }
    busyOn(f, kind[0].toUpperCase() + kind.slice(1));
    try {
      const out = await CH.aiAction(kind, sel);
      if (out) {
        CH.insertInto(f, out);
        CH.add(out);
        if (window.Sounds) window.Sounds.play("ok");
        if (window.Notify) {
          window.Notify.toast("✨ " + kind, out.length > 90 ? out.slice(0, 90) + "…" : out, { icon: "✨", app: "AI" });
        }
      } else throw new Error("the AI returned nothing");
    } catch (e) {
      if (window.Notify) window.Notify.toast("AI " + kind + " failed", (e && e.message) || "error", { icon: "⚠️", app: "AI" });
    } finally {
      busyOff();
    }
  }
  function editMenuItems(node) {
    const field = editableField(node);
    if (!field) return [];
    const sel = fieldSelection(field);
    const items = [];
    if (!field.readOnly && !field.disabled) {
      items.push(
        { label: "Cut", icon: "✂️", disabled: !sel, onClick: () => { focusField(field); try { document.execCommand("cut"); } catch (e) {} } },
        { label: "Copy", icon: "📋", disabled: !sel, onClick: () => { focusField(field); try { document.execCommand("copy"); } catch (e) {} } },
        { label: "Paste", icon: "📥", onClick: () => pasteInto(field) }
      );
    }
    items.push(
      { sep: true },
      { label: "Polish", icon: "✨", disabled: !sel, onClick: () => aiEdit(field, sel, "polish") },
      { label: "Rewrite", icon: "🔁", disabled: !sel, onClick: () => aiEdit(field, sel, "rewrite") },
      { label: "Summarize", icon: "📝", disabled: !sel, onClick: () => aiEdit(field, sel, "summarize") }
    );
    return items;
  }

  // ---------- dismissal ----------
  document.addEventListener("mousedown", (ev) => {
    if (!open) return;
    if (ev.target.closest(".ctx-menu")) return;
    hide();
  });
  document.addEventListener("keydown", (ev) => {
    if (!open) return;
    if (ev.key === "Escape") { ev.preventDefault(); hide(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); move(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); move(-1); }
    else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); activate(); }
  });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);

  // ---------- shell-wide right-click dispatch ----------
  // Order matters: window chrome > taskbar > desktop (windows live inside the
  // desktop container, so the window test must come first).
  document.addEventListener("contextmenu", (ev) => {
    // Task 85 — right-click inside an editable text field shows the OS edit
    // menu (Cut/Copy/Paste) plus AI transforms for the selected text instead
    // of the browser's native menu. App menus (e.g. File Manager) call
    // stopPropagation, so this only fires for plain text fields.
    if (!ev.defaultPrevented) {
      const editable = ev.target.closest("textarea, input, [contenteditable]");
      if (editable && !ev.target.closest("#clipHistory, .ctx-menu")) {
        ev.preventDefault();
        show(ev.clientX, ev.clientY, editMenuItems(editable));
        return;
      }
    }
    const top = ev.target.closest(".wm-top");
    if (top) {
      ev.preventDefault();
      const wid = Number(top.closest(".window").dataset.wid);
      const w = window.WM && window.WM.getById(wid);
      if (!w) return;
      show(ev.clientX, ev.clientY, [
        { label: "Minimize", icon: "─", onClick: () => window.WM.minimize(wid) },
        { label: w.maximized ? "Restore" : "Maximize", icon: w.maximized ? "❐" : "▢", onClick: () => window.WM.toggleMaximize(wid) },
        { label: "Close", icon: "✕", danger: true, onClick: () => window.WM.close(wid) },
      ]);
      return;
    }
    const taskbar = ev.target.closest("#taskbar");
    if (taskbar) {
      ev.preventDefault();
      show(ev.clientX, ev.clientY, [
        { label: "Lock", icon: "🔒", onClick: () => window.PowerMenu && window.PowerMenu.act("lock") },
        { label: "Settings", icon: "⚙️", onClick: () => window.Apps && window.Apps.launch("settings") },
      ]);
      return;
    }
    const desktop = ev.target.closest("#desktop");
    if (desktop) {
      ev.preventDefault();
      const ws = window.Workspaces;
      const items = [
        { label: "Arrange Icons", icon: "🗂️", onClick: () => window.Desktop && window.Desktop.arrange() },
        { label: "Change Wallpaper…", icon: "🖼️", onClick: () => window.Wallpapers && window.Wallpapers.show(ev.clientX, ev.clientY) },
        { label: "Open Terminal", icon: "⌨️", onClick: () => window.Apps && window.Apps.launch("terminal") },
        { label: "Display Settings", icon: "🖥️", onClick: () => window.Apps && window.Apps.launch("settings") },
      ];
      if (ws) {
        // Task 64 — switch desktop (flat list, current marked) + per-desktop wallpaper.
        const cur = ws.current;
        for (const d of ws.desktops) {
          items.push({
            label: "Switch to Desktop " + d + (d === cur ? " ✓" : ""),
            icon: d === cur ? "🌐" : "▫️",
            disabled: d === cur,
            onClick: () => ws.switchTo(d),
          });
        }
        items.push({
          label: "Set this desktop's wallpaper…",
          icon: "🖌️",
          onClick: () => window.Wallpapers && window.Wallpapers.show(ev.clientX, ev.clientY, { desktop: true }),
        });
        if (ws.wallpaper(cur) !== undefined) {
          items.push({
            label: "Reset this desktop's wallpaper",
            icon: "♻️",
            onClick: () => ws.setWallpaper(null),
          });
        }
      }
      items.push({
        label: "Reset Desktop…", icon: "♻️", danger: true, onClick: () => {
          if (confirm("Reset desktop? This restores the default folders, wallpaper and settings.")) {
            if (window.FSPersist) window.FSPersist.resetDesktop();
          }
        },
      });
      show(ev.clientX, ev.clientY, items);
    }
  });

  window.ContextMenu = { show, hide, isOpen: () => open };
})();
