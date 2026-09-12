// Webuntu OS — Text Editor (Phase 6, Task 29)
// A windowed plain-text editor over the virtual filesystem (window.FS +
// window.FSPath). Features: create / open / save (+ Save As), multiline
// editing, snapshot-based undo/redo, line/column + word/char/line counts, an
// in-file search bar (live count, next/prev, Enter/Shift+Enter, Esc), and an
// unsaved-changes guard on close / on switching documents. Plain-text files
// double-clicked in the File Manager route here (window.TextEditor.openPath)
// instead of the read-only preview.
//
// Windows are keyed per document (appId "text-editor:<path>" for files), so
// several files can be open at once and re-opening an already-open file just
// focuses its window. Launching the app from the Start menu (catalog
// singleton:false) opens a fresh untitled document; Ctrl+N clears the current
// window's buffer instead.

(function () {
  "use strict";

  const HOME_DOCS = "/home/user/Documents";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function fmtSize(bytes) {
    if (bytes == null || isNaN(bytes)) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }
  function baseName(path) {
    const p = String(path || "").split("/").filter(Boolean);
    return p.length ? p[p.length - 1] : path;
  }
  function parentOf(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    parts.pop();
    return "/" + parts.join("/") || "/";
  }
  function isTextFile(node) {
    return !!node && window.FS.isFile(node) && typeof (node.meta && node.meta.content) === "string";
  }
  function countWords(text) {
    const t = String(text).trim();
    return t ? t.split(/\s+/).length : 0;
  }
  function lineCol(text, pos) {
    const prefix = String(text).slice(0, pos);
    const lines = prefix.split("\n");
    return { line: lines.length, col: lines[lines.length - 1].length + 1 };
  }

  // ---------- themed dialog ----------
  function teDialog(opts) {
    return new Promise((resolve) => {
      const wrap = el("div", "te-dialog-wrap");
      const box = el("div", "te-dialog");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.appendChild(el("h3", null, opts.title));
      if (opts.message) box.appendChild(el("p", "msg", opts.message));
      let input = null;
      let errEl = null;
      if (opts.input) {
        input = el("input", "");
        input.type = "text";
        input.value = opts.value || "";
        input.placeholder = opts.placeholder || "";
        input.maxLength = 120;
        input.spellcheck = false;
        box.appendChild(input);
        errEl = el("div", "err");
        errEl.hidden = true;
        box.appendChild(errEl);
      }
      const actions = el("div", "te-dialog-actions");
      const defs = opts.buttons || ["Cancel", "OK"];
      const buttons = defs.map((b, i) => {
        const label = typeof b === "string" ? b : b.label;
        const btn = el("button", "set-btn" + (b && b.danger ? " danger" : ""), label);
        btn.type = "button";
        const value = (b && b.value !== undefined) ? b.value : i;
        const close = () => { wrap.remove(); resolve(value); };
        if (i === defs.length - 1) {
          // The primary button validates any input before resolving.
          btn.addEventListener("click", () => {
            if (input && opts.validate) {
              const err = opts.validate(input.value);
              if (err) { errEl.textContent = err; errEl.hidden = false; input.classList.add("err"); input.focus(); return; }
            }
            close();
          });
        } else {
          btn.addEventListener("click", close);
        }
        actions.appendChild(btn);
        return btn;
      });
      const okBtn = buttons[buttons.length - 1];
      const cancelBtn = buttons[0];
      if (input) {
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); okBtn.click(); }
          else if (ev.key === "Escape") { ev.preventDefault(); wrap.remove(); resolve(cancelBtn.value); }
        });
        input.addEventListener("input", () => { if (input.classList.contains("err")) { input.classList.remove("err"); errEl.hidden = true; } });
      }
      box.appendChild(actions);
      wrap.appendChild(box);
      (opts.attachTo || document.body).appendChild(wrap);
      wrap.addEventListener("mousedown", (ev) => { if (ev.target === wrap) { wrap.remove(); resolve(cancelBtn.value); } });
      setTimeout(() => { if (input) { input.select(); input.focus(); } else okBtn.focus(); }, 30);
    });
  }

  // ---------- open / save path picker ----------
  // A small folder navigator used by both Open and Save. Returns
  // { ok, path, node, name } or { ok:false }.
  function pathDialog(opts) {
    return new Promise((resolve) => {
      const wrap = el("div", "te-dialog-wrap");
      const box = el("div", "te-dialog te-pathbox");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.appendChild(el("h3", null, opts.title));

      let cwd = opts.startPath || HOME_DOCS;
      let selected = null; // { path, node } picked from the list (open mode)
      let picked = false;

      const pathEl = el("div", "te-path-row");
      const upBtn = el("button", "set-btn", "↑ Parent");
      upBtn.type = "button"; upBtn.title = "Go to parent folder";
      const pathText = el("span", "te-path-text");
      pathText.textContent = cwd;
      pathEl.append(upBtn, pathText);

      const listWrap = el("div", "te-path-list");
      const nameRow = el("div", "te-path-name");
      nameRow.hidden = opts.mode === "open";
      const nameInput = el("input", "");
      nameInput.type = "text";
      nameInput.value = opts.defaultName || "";
      nameInput.spellcheck = false;
      nameRow.append(el("label", null, "File name"), nameInput);

      const errEl = el("div", "err");
      errEl.hidden = true;
      const actions = el("div", "te-dialog-actions");
      const cancelBtn = el("button", "set-btn", "Cancel");
      cancelBtn.type = "button";
      const okBtn = el("button", "set-btn" + (opts.confirmDanger ? " danger" : ""), opts.pickLabel || (opts.mode === "open" ? "Open" : "Save"));
      okBtn.type = "button";

      function childPath(p, name) { return String(p).replace(/\/+$/, "") + "/" + name; }
      function refresh() {
        pathText.textContent = cwd;
        listWrap.textContent = "";
        const dir = window.FS.resolve(cwd);
        if (!dir || !window.FS.isFolder(dir)) { cwd = parentOf(cwd); refresh(); return; }
        const children = (dir.children || []).slice().sort((a, b) => {
          const af = window.FS.isFolder(a) ? 0 : 1, bf = window.FS.isFolder(b) ? 0 : 1;
          return af - bf || a.name.localeCompare(b.name);
        });
        if (!children.length) listWrap.appendChild(el("div", "te-path-none", "This folder is empty."));
        for (const child of children) {
          const row = el("div", "te-path-item");
          const isDir = window.FS.isFolder(child);
          row.appendChild(el("span", "te-path-ico", child.icon || (isDir ? "📁" : "📄")));
          row.appendChild(el("span", "te-path-name", child.name));
          row.dataset.path = childPath(cwd, child.name);
          row.dataset.isDir = isDir ? "1" : "0";
          row.tabIndex = 0;
          row.addEventListener("click", () => {
            for (const r of listWrap.querySelectorAll(".te-path-item")) r.classList.remove("sel");
            row.classList.add("sel");
            selected = { path: row.dataset.path, node: child, name: child.name };
            if (opts.mode === "save") nameInput.value = child.name;
          });
          row.addEventListener("dblclick", () => {
            if (isDir) { cwd = row.dataset.path; selected = null; refresh(); }
            else if (opts.mode === "open") finish(true, row.dataset.path, child);
          });
          listWrap.appendChild(row);
        }
      }
      function finish(ok, path, node) {
        if (picked) return;
        picked = true;
        wrap.remove();
        if (ok) resolve({ ok: true, path, node });
        else resolve({ ok: false });
      }
      function showErr(msg) { errEl.textContent = msg; errEl.hidden = false; }
      function commit() {
        if (opts.mode === "open") {
          if (selected && selected.node && window.FS.isFolder(selected.node)) { cwd = selected.path; selected = null; refresh(); return; }
          if (!selected) { showErr("Pick a file, or double-click to open."); return; }
          finish(true, selected.path, selected.node);
        } else {
          const v = window.FS.sanitizeName(nameInput.value);
          if (!v.ok) { showErr(v.error); return; }
          const target = childPath(cwd, v.name);
          const existing = window.FS.resolve(target);
          if (existing && window.FS.isFolder(existing)) { showErr("\u201c" + v.name + "\u201d is a folder."); return; }
          const doSave = () => finish(true, target, existing || null);
          if (existing) {
            teDialog({
              title: "Overwrite \u201c" + v.name + "\u201d?",
              message: "A file with that name already exists in " + cwd + ".",
              attachTo: opts.attachTo,
              buttons: [
                { label: "Cancel", value: false },
                { label: "Overwrite", value: true, danger: true },
              ],
            }).then((r) => { if (r) doSave(); });
          } else doSave();
        }
      }

      upBtn.addEventListener("click", () => { cwd = parentOf(cwd); selected = null; refresh(); });
      cancelBtn.addEventListener("click", () => finish(false));
      okBtn.addEventListener("click", commit);
      nameInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
      });
      box.append(pathEl, listWrap, nameRow, errEl, actions);
      actions.append(cancelBtn, okBtn);
      wrap.appendChild(box);
      (opts.attachTo || document.body).appendChild(wrap);
      wrap.addEventListener("mousedown", (ev) => { if (ev.target === wrap) finish(false); });
      setTimeout(() => { refresh(); if (nameInput) nameInput.focus(); }, 30);
    });
  }

  // ---------- instance ----------
  function createEditor(opts) {
    const te = {
      root: el("div", "te"),
      textarea: null,
      pathEl: null, countEl: null, posEl: null, dirtyDot: null,
      path: opts.path || null,          // FS path; null = untitled
      node: opts.node || null,
      dirty: false,
      history: { undo: [], redo: [] },
      lastPush: 0, prevValue: "", prevSel: 0,
      // search state
      findOpen: false, term: "", matches: [], matchIndex: -1,
      w: null,                          // WM window (wired on mount)
    };

    // ---- toolbar ----
    const bar = el("div", "te-bar");
    const mkBtn = (label, title, fn) => {
      const b = el("button", "te-btn", label);
      b.type = "button"; b.title = title;
      b.addEventListener("click", fn);
      return b;
    };
    const emojiBtn = mkBtn("🙂", "Insert emoji (Super+.)", () => window.EmojiPicker && window.EmojiPicker.openFor(emojiBtn, te.textarea));
    bar.append(
      mkBtn("＋ New", "New document (Ctrl+N)", () => newDoc(te)),
      mkBtn("📂 Open…", "Open a file (Ctrl+O)", () => openDialog(te)),
      mkBtn("💾 Save", "Save (Ctrl+S)", () => save(te)),
      mkBtn("Save As…", "Save As (Ctrl+Shift+S)", () => saveAs(te)),
      mkBtn("🔍 Find", "Find in file (Ctrl+F)", () => toggleFind(te)),
      emojiBtn,
    );
    const pathSpan = el("span", "te-file");
    pathSpan.textContent = te.path ? baseName(te.path) : "Untitled";
    te.pathEl = pathSpan;
    bar.appendChild(pathSpan);

    // ---- find bar ----
    const findBar = el("div", "te-find");
    findBar.hidden = true;
    const findInput = el("input", "");
    findInput.type = "text";
    findInput.placeholder = "Find in file…";
    findInput.spellcheck = false;
    const findPrev = el("button", "set-btn", "▲");
    findPrev.type = "button"; findPrev.title = "Previous (Shift+Enter)";
    const findNext = el("button", "set-btn", "▼");
    findNext.type = "button"; findNext.title = "Next (Enter)";
    const findCount = el("span", "te-find-count", "");
    const findClose = el("button", "set-btn", "✕");
    findClose.type = "button"; findClose.title = "Close (Esc)";
    findBar.append(findInput, findPrev, findNext, findCount, findClose);

    // ---- textarea ----
    const areaWrap = el("div", "te-area");
    const area = el("textarea", "te-area-input");
    area.wrap = "off";
    area.spellcheck = false;
    area.placeholder = "Start typing…";
    area.value = (te.node && typeof te.node.meta.content === "string") ? te.node.meta.content : "";
    te.textarea = area;
    areaWrap.appendChild(area);

    // ---- status bar ----
    const status = el("div", "te-status");
    te.posEl = el("span", "te-pos", "Ln 1, Col 1");
    const counts = el("span", "te-counts");
    te.countEl = counts;
    const sizeEl = el("span", "te-size", "");
    const statPath = el("span", "te-statpath");
    te.dirtyDot = el("span", "te-dirty", "●");
    te.dirtyDot.hidden = true;
    te.dirtyDot.title = "Unsaved changes";
    status.append(te.posEl, counts, sizeEl, statPath, te.dirtyDot);

    te.root.append(bar, findBar, areaWrap, status);

    // ---------- counts ----------
    function updateStats() {
      const text = area.value;
      const lc = lineCol(text, area.selectionStart);
      te.posEl.textContent = "Ln " + lc.line + ", Col " + lc.col;
      te.countEl.textContent = countWords(text) + " words · " + text.length + " chars · " + (text.split("\n").length) + " lines";
      sizeEl.textContent = te.node ? fmtSize(te.node.meta.size) : (new TextEncoder().encode(text).length) + " B";
      statPath.textContent = te.path || "";
    }

    // ---------- undo / redo (snapshot stack with coalescing) ----------
    function pushHistory() {
      te.history.undo.push({ value: te.prevValue, sel: te.prevSel });
      if (te.history.undo.length > 100) te.history.undo.shift();
      te.history.redo.length = 0;
    }
    function snapshotState() {
      te.prevValue = area.value;
      te.prevSel = area.selectionStart;
    }
    function undo() {
      if (!te.history.undo.length) return;
      te.history.redo.push({ value: area.value, sel: area.selectionStart });
      const snap = te.history.undo.pop();
      area.value = snap.value;
      area.setSelectionRange(snap.sel, snap.sel);
      te.lastPush = 0;
      snapshotState();
      afterEdit(true);
    }
    function redo() {
      if (!te.history.redo.length) return;
      te.history.undo.push({ value: te.prevValue, sel: te.prevSel });
      const snap = te.history.redo.pop();
      area.value = snap.value;
      area.setSelectionRange(snap.sel, snap.sel);
      te.lastPush = 0;
      snapshotState();
      afterEdit(true);
    }

    function setDirty(d) {
      if (te.dirty === d) return;
      te.dirty = d;
      te.dirtyDot.hidden = !d;
      if (te.w) window.WM.setTitle(te.w.id, baseName(te.path || "Untitled") + (d ? " ●" : ""));
    }
    function afterEdit(fromUndo) {
      if (!fromUndo) setDirty(true);
      updateStats();
      if (te.findOpen) recomputeMatches();
      te.textarea.focus();
    }

    area.addEventListener("input", () => {
      if (Date.now() - te.lastPush > 800) pushHistory();
      te.lastPush = Date.now();
      snapshotState();
      afterEdit(false);
    });
    area.addEventListener("select", updateStats);
    area.addEventListener("click", updateStats);
    area.addEventListener("keyup", updateStats);
    area.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
        const k = ev.key.toLowerCase();
        if (k === "s" && ev.shiftKey) { ev.preventDefault(); saveAs(te); return; }
        if (k === "s") { ev.preventDefault(); save(te); return; }
        if (k === "n") { ev.preventDefault(); newDoc(te); return; }
        if (k === "o") { ev.preventDefault(); openDialog(te); return; }
        if (k === "f") { ev.preventDefault(); toggleFind(te); return; }
        if (k === "z") { ev.preventDefault(); undo(); return; }
        if (k === "y") { ev.preventDefault(); redo(); return; }
      }
      if (ev.key === "Escape" && te.findOpen) { ev.preventDefault(); toggleFind(te); }
    });

    // ---------- find ----------
    function toggleFind() {
      te.findOpen = !te.findOpen;
      findBar.hidden = !te.findOpen;
      if (te.findOpen) { recomputeMatches(); findInput.focus(); findInput.select(); }
      else { area.focus(); }
    }
    function recomputeMatches() {
      const term = findInput.value;
      te.term = term;
      te.matches = [];
      if (term) {
        const lower = area.value.toLowerCase();
        const t = term.toLowerCase();
        let idx = 0;
        while (true) {
          const i = lower.indexOf(t, idx);
          if (i === -1) break;
          te.matches.push(i);
          idx = i + Math.max(1, t.length);
        }
      }
      if (te.matches.length) { te.matchIndex = 0; jumpToMatch(0); }
      else { te.matchIndex = -1; findCount.textContent = "no matches"; area.setSelectionRange(area.selectionStart, area.selectionStart); }
    }
    function jumpToMatch(dir) {
      if (!te.matches.length) { findCount.textContent = "no matches"; return; }
      const n = te.matches.length;
      te.matchIndex = ((te.matchIndex + dir) % n + n) % n;
      const pos = te.matches[te.matchIndex];
      area.focus();
      area.setSelectionRange(pos, pos + te.term.length);
      let target = 0;
      for (const line of area.value.slice(0, pos).split("\n")) target += line.length + 1;
      area.scrollTop = Math.max(0, target - area.clientHeight / 2);
      findCount.textContent = (te.matchIndex + 1) + " / " + n;
    }
    findInput.addEventListener("input", () => { te.matchIndex = -1; recomputeMatches(); });
    findInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); jumpToMatch(ev.shiftKey ? -1 : 1); }
      else if (ev.key === "Escape") { ev.preventDefault(); toggleFind(te); }
    });
    findNext.addEventListener("click", () => jumpToMatch(1));
    findPrev.addEventListener("click", () => jumpToMatch(-1));
    findClose.addEventListener("click", () => toggleFind(te));

    // ---------- save ----------
    function writeToNode(node, text) {
      node.meta.content = text;
      node.meta.size = new TextEncoder().encode(text).length;
      node.meta.modified = Date.now();
      if (window.FS.onChange) window.FS.onChange();
    }
    function displayName() { return baseName(te.path || "Untitled"); }

    async function doSave(path) {
      const parent = parentOf(path);
      let node = window.FS.resolve(path);
      if (!node) {
        if (!window.FS.isFolder(window.FS.resolve(parent))) return { ok: false, error: "The folder no longer exists." };
        node = window.FS.create(parent, {
          name: baseName(path),
          type: "file",
          icon: "📄",
          meta: { content: area.value, size: new TextEncoder().encode(area.value).length, modified: Date.now() },
        });
        if (!node) return { ok: false, error: "Could not create the file." };
      }
      writeToNode(node, area.value);
      te.path = path;
      te.node = node;
      te.dirty = false;
      te.dirtyDot.hidden = true;
      te.pathEl.textContent = displayName();
      if (te.w) window.WM.setTitle(te.w.id, displayName());
      updateStats();
      return { ok: true };
    }

    async function save() {
      if (te.path) return doSave(te.path);
      return saveAs(te);
    }
    async function saveAs() {
      const res = await pathDialog({
        title: "Save as",
        mode: "save",
        startPath: te.path ? parentOf(te.path) : HOME_DOCS,
        defaultName: displayName(),
        pickLabel: "Save",
        attachTo: te.root,
      });
      if (!res.ok) return { ok: false };
      return doSave(res.path);
    }

    // ---------- new / open (with unsaved-changes guard) ----------
    async function confirmDiscard() {
      if (!te.dirty) return true;
      const r = await teDialog({
        title: "Unsaved changes",
        message: "Save changes to \u201c" + displayName() + "\u201d before continuing?",
        attachTo: te.root,
        buttons: [
          { label: "Cancel", value: "cancel" },
          { label: "Don't Save", value: "discard" },
          { label: "Save", value: "save" },
        ],
      });
      if (r === "save") { const s = await save(); return !!s.ok; }
      return r === "discard";
    }

    // Reset the current window to a fresh untitled buffer (Ctrl+N).
    async function newDoc() {
      if (!(await confirmDiscard())) return;
      te.path = null; te.node = null; te.dirty = false;
      te.history.undo.length = 0; te.history.redo.length = 0; te.lastPush = 0;
      te.findOpen = false; findBar.hidden = true; te.matches = []; te.matchIndex = -1;
      area.value = "";
      te.dirtyDot.hidden = true;
      te.pathEl.textContent = "Untitled";
      if (te.w) window.WM.setTitle(te.w.id, "Untitled");
      snapshotState();
      updateStats();
      area.focus();
    }

    // Load a file into this window (Open…; the caller has already guarded).
    function loadInto(path, node) {
      te.path = path; te.node = node; te.dirty = false;
      te.history.undo.length = 0; te.history.redo.length = 0; te.lastPush = 0;
      te.findOpen = false; findBar.hidden = true; te.matches = []; te.matchIndex = -1;
      area.value = (node.meta && typeof node.meta.content === "string") ? node.meta.content : "";
      te.dirtyDot.hidden = true;
      te.pathEl.textContent = baseName(path);
      if (te.w) window.WM.setTitle(te.w.id, baseName(path));
      snapshotState();
      updateStats();
      area.focus();
    }

    async function openDialog() {
      if (!(await confirmDiscard())) return;
      const res = await pathDialog({
        title: "Open file",
        mode: "open",
        startPath: te.path ? parentOf(te.path) : HOME_DOCS,
        pickLabel: "Open",
        attachTo: te.root,
      });
      if (!res.ok) return;
      if (!res.node || !isTextFile(res.node)) {
        teDialog({ title: "Can't open that", message: "That isn't a plain-text file.", attachTo: te.root });
        return;
      }
      const appId = "text-editor:" + res.path;
      const existing = window.WM.findByAppId(appId);
      if (existing && !existing.closed && existing !== te.w) {
        if (existing.minimized) window.WM.restore(existing.id); else window.WM.focus(existing.id);
        if (te.path === null) window.WM.close(te.w.id);
        return;
      }
      loadInto(res.path, res.node);
    }

    // ---------- unsaved-changes guard (WM close hook) ----------
    te.guardClose = async function () {
      if (!te.dirty) return true;
      const r = await teDialog({
        title: "Unsaved changes",
        message: "\u201c" + displayName() + "\u201d has unsaved changes. Save before closing?",
        attachTo: te.root,
        buttons: [
          { label: "Cancel", value: "cancel" },
          { label: "Don't Save", value: "discard" },
          { label: "Save", value: "save" },
        ],
      });
      if (r === "save") { const s = await save(); return !!s.ok; }
      return r === "discard";
    };

    // ---------- mount wiring ----------
    // Called once the WM window owning te.root exists (WM.open + content are
    // both done in the same task, so a short timeout finds it reliably).
    te.onMount = function () {
      if (te.w) return;
      const winEl = te.root.closest(".window");
      if (!winEl) return;
      const win = (window.WM.windows || []).find((w) => w.el === winEl);
      if (win) {
        te.w = win; win.onCloseRequest = te.guardClose;
        window.WM.setTitle(win.id, displayName() + (te.dirty ? " ●" : ""));
        setDirty(te.dirty);
      }
    };

    te.root._te = te;
    snapshotState();
    updateStats();
    return te;
  }

  // ---------- public API ----------
  // Open (or focus) an editor for a plain-text file at `path`.
  function openPath(path, opts) {
    opts = opts || {};
    const res = window.FSPath.lookup(path);
    if (!res.ok || !isTextFile(res.node)) return null;
    const appId = "text-editor:" + res.path;
    const existing = window.WM.findByAppId(appId);
    if (existing && !existing.closed) {
      if (existing.minimized) window.WM.restore(existing.id); else window.WM.focus(existing.id);
      return existing;
    }
    const te = createEditor({ path: res.path, node: res.node });
    const w = window.WM.open({
      appId: appId,
      title: baseName(res.path),
      icon: "📝",
      w: 640, h: 460, minW: 400, minH: 300,
      content: te.root,
    });
    te.w = w;
    w.onCloseRequest = te.guardClose;
    return w;
  }

  // A fresh untitled document (external callers, e.g. a future Terminal open).
  function newDocument() {
    const te = createEditor({ path: null, node: null });
    const w = window.WM.open({
      appId: "text-editor:new-" + Date.now(),
      title: "Untitled",
      icon: "📝",
      singleton: false,
      w: 640, h: 460, minW: 400, minH: 300,
      content: te.root,
    });
    te.w = w;
    w.onCloseRequest = te.guardClose;
    return w;
  }

  // The app's content builder (apps.js calls this on Start-menu launch; it
  // must return { content, w, h, minW, minH } — WM.open happens afterwards).
  window.AppContent = window.AppContent || {};
  window.AppContent["text-editor"] = function () {
    const te = createEditor({ path: null, node: null });
    setTimeout(() => te.onMount(), 60);
    return { content: te.root, w: 640, h: 460, minW: 400, minH: 300 };
  };

  window.TextEditor = { openPath, newDocument };
})();
