// Webuntu OS — Notes app (Phase 6, Task 35)
// A windowed notes app storing per-user notes in the virtual filesystem at
// /home/user/Documents/Notes (plain .txt files, so they show up in the File
// Manager and can be opened in the Text Editor too). Left panel: note list
// (title + modified date) with a New button. Right panel: title field,
// body editor, Save / Delete. Notes auto-save shortly after you stop typing,
// and Ctrl+S saves immediately. The folder is created on first launch if
// missing.
//
// Singleton: launching the app again focuses the open window.

(function () {
  "use strict";

  const NOTES_DIR = "/home/user/Documents/Notes";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function stripExt(name) { return String(name).replace(/\.txt$/i, ""); }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }
  function ensureDir() {
    if (window.FS.resolve(NOTES_DIR)) return true;
    const parent = window.FSPath.parentPath(NOTES_DIR);
    if (!window.FS.isFolder(window.FS.resolve(parent))) return false;
    window.FS.create(parent, { name: "Notes", type: "folder", icon: "📓", meta: {} });
    return true;
  }

  function createNotes() {
    const n = {
      root: el("div", "notes"),
      notes: [],        // [{node, path}]
      current: -1,
      dirty: false,
      saveTimer: null,
      w: null,
    };

    // ---------- layout ----------
    const side = el("div", "notes-side");
    const sideHead = el("div", "notes-side-head");
    const newBtn = el("button", "set-btn", "＋ New Note");
    newBtn.type = "button"; newBtn.title = "Create a new note";
    sideHead.appendChild(newBtn);
    const list = el("div", "notes-list");
    side.append(sideHead, list);

    const edit = el("div", "notes-edit");
    const titleInput = el("input", "notes-title");
    titleInput.type = "text";
    titleInput.placeholder = "Note title…";
    titleInput.spellcheck = false;
    const metaRow = el("div", "notes-meta");
    const statusEl = el("span", "notes-status", "Select a note to edit it.");
    const deleteBtn = el("button", "set-btn danger", "Delete");
    deleteBtn.type = "button"; deleteBtn.title = "Delete this note";
    const emojiBtn = el("button", "set-btn", "🙂");
    emojiBtn.type = "button"; emojiBtn.title = "Insert emoji (Super+.)";
    emojiBtn.addEventListener("click", () => window.EmojiPicker && window.EmojiPicker.openFor(emojiBtn, body));
    metaRow.append(emojiBtn, statusEl, deleteBtn);
    const body = el("textarea", "notes-body");
    body.placeholder = "Write your note here…";
    body.spellcheck = true;
    edit.append(titleInput, metaRow, body);

    n.root.append(side, edit);

    // ---------- list ----------
    function loadNotes() {
      if (!ensureDir()) return;
      const folder = window.FS.resolve(NOTES_DIR);
      n.notes = (folder.children || [])
        .filter((c) => window.FS.isFile(c) && /\.txt$/i.test(c.name))
        .map((node) => ({ node, path: window.FS.getPath(node) }))
        .sort((a, b) => (b.node.meta.modified || 0) - (a.node.meta.modified || 0));
      renderList();
    }
    function renderList() {
      list.textContent = "";
      if (!n.notes.length) {
        list.appendChild(el("div", "notes-empty", "No notes yet.\nClick “＋ New Note” to start."));
      }
      n.notes.forEach((note, i) => {
        const row = el("button", "notes-item" + (i === n.current ? " active" : ""), "");
        row.type = "button";
        const name = el("span", "notes-item-name", stripExt(note.node.name));
        const when = el("span", "notes-item-when", note.node.meta.modified ? fmtDate(note.node.meta.modified) : "");
        row.append(name, when);
        row.addEventListener("click", () => selectNote(i));
        list.appendChild(row);
      });
    }

    // ---------- selection / editing ----------
    function setDirty(d) {
      n.dirty = d;
      statusEl.textContent = d ? "Editing… (auto-saves)" : (n.current >= 0 ? "Saved" : "Select a note to edit it.");
    }
    function selectNote(i) {
      if (i < 0 || i >= n.notes.length) return;
      if (n.dirty) saveNow();
      n.current = i;
      const note = n.notes[i];
      titleInput.value = stripExt(note.node.name);
      body.value = String(note.node.meta.content || "");
      body.disabled = false;
      titleInput.disabled = false;
      setDirty(false);
      renderList();
      body.focus();
    }
    function clearEditor() {
      n.current = -1;
      titleInput.value = "";
      body.value = "";
      body.disabled = true;
      titleInput.disabled = true;
      setDirty(false);
      renderList();
    }

    // ---------- save ----------
    function saveNow() {
      if (n.current < 0) return;
      const note = n.notes[n.current];
      let node = note.node;
      const newName = (titleInput.value.trim() || "Untitled") + ".txt";
      if (newName !== node.name) {
        const r = window.FS.rename(note.path, newName);
        if (r.ok) {
          node = r.node;
          note.node = node;
          note.path = window.FS.getPath(node);
        }
      }
      const content = body.value;
      node.meta.content = content;
      node.meta.size = new TextEncoder().encode(content).length;
      node.meta.modified = Date.now();
      if (window.FS.onChange) window.FS.onChange();
      setDirty(false);
      loadNotes();
      const idx = n.notes.findIndex((x) => x.node === node);
      n.current = idx >= 0 ? idx : n.current;
      renderList();
    }
    function scheduleSave() {
      setDirty(true);
      if (n.saveTimer) clearTimeout(n.saveTimer);
      n.saveTimer = setTimeout(saveNow, 800);
    }

    function newNote() {
      if (n.dirty) saveNow();
      ensureDir();
      let i = 1;
      let name;
      do { name = "Untitled" + (i === 1 ? "" : " " + i) + ".txt"; i++; }
      while (window.FS.resolve(window.FSPath.childPath(NOTES_DIR, name)));
      const node = window.FS.create(NOTES_DIR, {
        name, type: "file", icon: "📄",
        meta: { content: "", size: 0, modified: Date.now() },
      });
      loadNotes();
      const idx = n.notes.findIndex((x) => x.node === node);
      selectNote(idx);
      titleInput.select();
    }

    async function deleteNote() {
      if (n.current < 0) return;
      const note = n.notes[n.current];
      const ok = await new Promise((resolve) => {
        const wrap = el("div", "te-dialog-wrap");
        const box = el("div", "te-dialog");
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.appendChild(el("h3", null, "Delete “" + stripExt(note.node.name) + "”?"));
        box.appendChild(el("p", "msg", "This permanently removes the note from Documents/Notes."));
        const actions = el("div", "te-dialog-actions");
        const cancel = el("button", "set-btn", "Cancel");
        cancel.type = "button";
        const del = el("button", "set-btn danger", "Delete");
        del.type = "button";
        const close = (v) => { wrap.remove(); resolve(v); };
        cancel.addEventListener("click", () => close(false));
        del.addEventListener("click", () => close(true));
        actions.append(cancel, del);
        box.appendChild(actions);
        wrap.appendChild(box);
        (n.root.closest(".window") || document.body).appendChild(wrap);
        wrap.addEventListener("mousedown", (ev) => { if (ev.target === wrap) close(false); });
        setTimeout(() => del.focus(), 30);
      });
      if (!ok) return;
      window.FS.moveToTrash(note.path);
      loadNotes();
      clearEditor();
    }

    // ---------- wiring ----------
    newBtn.addEventListener("click", newNote);
    deleteBtn.addEventListener("click", deleteNote);
    titleInput.addEventListener("input", scheduleSave);
    titleInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); body.focus(); }
    });
    body.addEventListener("input", scheduleSave);
    body.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === "s" || ev.key === "S")) {
        ev.preventDefault();
        if (n.saveTimer) clearTimeout(n.saveTimer);
        saveNow();
      }
    });

    // ---------- mount ----------
    n.onMount = function () {
      const winEl = n.root.closest(".window");
      if (!winEl) return;
      const win = (window.WM.windows || []).find((x) => x.el === winEl);
      if (win) {
        n.w = win;
        win.onCloseRequest = () => { if (n.dirty && n.saveTimer) { clearTimeout(n.saveTimer); saveNow(); } };
      }
    };

    loadNotes();
    if (!n.notes.length) clearEditor(); else selectNote(0);
    return n;
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["notes"] = function () {
    const n = createNotes();
    setTimeout(() => n.onMount(), 60);
    return { content: n.root, w: 720, h: 480, minW: 480, minH: 320 };
  };
})();
