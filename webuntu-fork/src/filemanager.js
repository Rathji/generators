// Webuntu OS — File Manager (Phase 6, Task 28)
// A windowed app over the virtual filesystem (window.FS + window.FSPath).
// Toolbar: back/forward/up navigation, clickable breadcrumbs, a "New" menu
// (folder / text file) and a grid/list view toggle. The item area supports
// single + multi selection (click / ctrl-click / shift-click / arrow keys /
// Ctrl+A), double-click open (folders navigate, shortcuts launch via
// window.Launcher, files open a read-only preview), F2 rename, Delete with a
// themed in-window confirm dialog, and a right-click menu (Open / Rename /
// Delete, plus New Folder / New File on the empty background). Includes
// empty-state and folder-not-found error views.
//
// Registers itself as the content builder for the "file-manager" catalog app
// (apps.js). Desktop folders and folder-kind shortcuts route here through
// window.Launcher.openFolder -> FileManager.openPath; a single file-manager
// window is reused and navigated rather than spawning duplicates.

(function () {
  "use strict";

  const VIEW_KEY = "webuntu.fm.view";
  const HOME = "/home/user";
  const TRASH = "/Trash";
  // Default tile colors for the well-known home folders (FS folder nodes don't
  // carry a color; shortcuts do). Falls back to cyan folders / slate files.
  const ICON_COLORS = {
    "🎲": "#f59e0b", "🕹️": "#7c6cff", "📄": "#22d3ee", "🖼️": "#ec4899",
    "🎵": "#22c55e", "⬇️": "#f97316", "💿": "#8b5cf6", "📁": "#22d3ee",
    "🖥️": "#94a3b8", "📓": "#f59e0b", "📂": "#22d3ee", "📦": "#8b5cf6",
  };
  const FILE_COLOR = "#94a3b8";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function nodeColor(node) {
    if (node && node.color) return node.color;
    if (node && window.FS.isFolder(node)) return ICON_COLORS[node.icon] || ICON_COLORS["📁"];
    if (node && window.FS.isShortcut(node)) return node.color || ICON_COLORS[node.icon] || "#8b5cf6";
    return FILE_COLOR;
  }
  function tileStyle(color) {
    const fallback =
      getComputedStyle(document.documentElement).getPropertyValue("--tile-fallback").trim() ||
      "rgba(148,163,184,.35)";
    const m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return { background: fallback };
    return { background: `linear-gradient(140deg, #${m[1]}cc, #${m[1]}55)` };
  }
  // Task 41 — VGN game shortcuts (meta.era set) get an arcade-cabinet look:
  // a saturated marquee gradient over a dark base + a CSS scanline overlay.
  function arcadeTile(tile, item) {
    if (!item || !item.meta || !item.meta.era) return;
    tile.classList.add("tile-vgn");
    tile.style.background =
      `linear-gradient(150deg, #${(item.color || "#7c6cff").replace(/^#/, "")}, #10131f 165%)`;
    tile.style.boxShadow =
      "inset 0 0 0 1px rgba(255,255,255,.14), inset 0 -10px 18px -8px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.4)";
  }
  // Chip text for a game shortcut: VGN games show "Era · Year" (arcade data,
  // Task 41), BGN games keep the player count.
  function gameChip(item) {
    if (!item || !window.FS.isShortcut(item) || !item.meta || item.meta.kind !== "game") return null;
    if (item.meta.era) {
      const yr = item.meta.year && item.meta.year !== "TBD" ? " · " + item.meta.year : "";
      return (item.meta.eraName || item.meta.era) + yr;
    }
    return item.meta.players || null;
  }
  function fmtSize(bytes) {
    if (bytes == null || isNaN(bytes)) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }
  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      });
    } catch (e) { return "—"; }
  }
  function typeLabel(node) {
    if (window.FS.isFolder(node)) return "Folder";
    if (window.FS.isShortcut(node)) {
      const kind = node.meta && node.meta.kind;
      const map = { app: "App", link: "Link", game: "Game", folder: "Folder shortcut", stub: "Coming soon" };
      return map[kind] || "Shortcut";
    }
    const ext = (node.name || "").includes(".") ? node.name.split(".").pop().toUpperCase() : "";
    return ext ? ext + " file" : "File";
  }
  function sortItems(items) {
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    const folders = items.filter((i) => window.FS.isFolder(i)).sort(byName);
    const rest = items.filter((i) => !window.FS.isFolder(i)).sort(byName);
    return folders.concat(rest);
  }
  function loadView() { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; } catch (e) { return "grid"; } }
  function saveView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) {} }

  // ---------- in-window themed dialog (never a native confirm/alert) ----------
  function fmDialog(fm, opts) {
    return new Promise((resolve) => {
      const wrap = el("div", "fm-dialog-wrap");
      const box = el("div", "fm-dialog");
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
      const actions = el("div", "fm-dialog-actions");
      const cancel = el("button", "set-btn", opts.cancelLabel || "Cancel");
      cancel.type = "button";
      const ok = el("button", "set-btn" + (opts.danger ? " danger" : ""), opts.confirmLabel || "OK");
      ok.type = "button";
      const close = (value) => { wrap.remove(); fm.bodyEl.focus(); resolve(value); };
      cancel.addEventListener("click", () => close({ ok: false }));
      ok.addEventListener("click", () => {
        if (input && opts.validate) {
          const err = opts.validate(input.value);
          if (err) { errEl.textContent = err; errEl.hidden = false; input.classList.add("err"); input.focus(); return; }
        }
        close({ ok: true, value: input ? input.value : undefined });
      });
      if (input) {
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); ok.click(); }
          else if (ev.key === "Escape") { ev.preventDefault(); cancel.click(); }
        });
      } else {
        box.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); cancel.click(); } });
      }
      actions.append(cancel, ok);
      box.appendChild(actions);
      wrap.appendChild(box);
      fm.root.appendChild(wrap);
      wrap.addEventListener("mousedown", (ev) => { if (ev.target === wrap) cancel.click(); });
      setTimeout(() => { if (input) { input.select(); input.focus(); } else ok.focus(); }, 30);
    });
  }

  function validateName(name, parentPath, ignore) {
    const v = window.FS.sanitizeName(name);
    if (!v.ok) return v.error;
    const parent = window.FS.resolve(parentPath);
    if (parent && parent.children.some((c) => c !== ignore && c.name === v.name)) {
      return "An item named \u201c" + v.name + "\u201d already exists here.";
    }
    return null;
  }

  function defaultName(kind) {
    return kind === "folder" ? "New Folder" : "New File.txt";
  }

  // ---------- file ops (create / rename / delete) ----------
  async function newItem(fm, kind) {
    const res = await fmDialog(fm, {
      title: kind === "folder" ? "New folder" : "New text file",
      message: "Create in " + fm.cwd,
      input: true, value: defaultName(kind),
      confirmLabel: "Create",
      validate: (v) => validateName(v, fm.cwd),
    });
    if (!res.ok) return;
    const spec = kind === "folder"
      ? { name: res.value, type: "folder", icon: "📁", meta: {} }
      : { name: res.value, type: "file", icon: "📄", meta: { content: "", size: 0, modified: Date.now() } };
    window.FS.create(fm.cwd, spec);
    render(fm);
    updateChrome(fm);
    setSelection(fm, [res.value]);
    scrollToName(fm, res.value);
  }

  async function renameItems(fm) {
    if (fm.selection.length !== 1) return;
    const item = fm.items.find((i) => i.name === fm.selection[0]);
    if (!item) return;
    const path = window.FSPath.childPath(fm.cwd, item.name);
    const res = await fmDialog(fm, {
      title: "Rename",
      message: "Rename \u201c" + item.name + "\u201d",
      input: true, value: item.name,
      confirmLabel: "Rename",
      validate: (v) => validateName(v, fm.cwd, item),
    });
    if (!res.ok) return;
    const name = res.value.trim();
    if (name === item.name) return;
    window.FS.rename(path, name);
    render(fm);
    updateChrome(fm);
    setSelection(fm, [name]);
  }

  async function deleteItems(fm) {
    if (!fm.selection.length) return;
    const names = fm.items.filter((i) => fm.selection.includes(i.name));
    if (!names.length) return;
    const single = names.length === 1;
    // Inside /Trash, "Delete" is permanent; everywhere else it moves to /Trash.
    const inTrash = fm.cwd === TRASH;
    const res = await fmDialog(fm, {
      title: single
        ? (inTrash ? "Delete \u201c" + names[0].name + "\u201d permanently?" : "Move \u201c" + names[0].name + "\u201d to Trash?")
        : (inTrash ? "Delete " + names.length + " items permanently?" : "Move " + names.length + " items to Trash?"),
      message: inTrash
        ? "This permanently removes " + (single ? "it" : "them") + " from the Trash. This can't be undone."
        : (single ? "It will be" : "They will be") + " moved to the Trash. You can restore it later from there.",
      confirmLabel: inTrash ? "Delete" : "Move to Trash", cancelLabel: "Cancel", danger: inTrash,
    });
    if (!res.ok) return;
    for (const n of names) {
      const p = window.FSPath.childPath(fm.cwd, n.name);
      if (inTrash) window.FS.remove(p);
      else window.FS.moveToTrash(p);
    }
    fm.selection = [];
    render(fm);
    updateChrome(fm);
  }

  // Restore selected Trash items back to where they were deleted from.
  async function restoreItems(fm) {
    if (fm.cwd !== TRASH || !fm.selection.length) return;
    for (const n of fm.items.filter((i) => fm.selection.includes(i.name))) {
      window.FS.restoreFromTrash(window.FSPath.childPath(fm.cwd, n.name));
    }
    fm.selection = [];
    render(fm);
    updateChrome(fm);
  }

  // Permanently empty the whole /Trash folder (with a confirm dialog).
  async function emptyTrashNow(fm) {
    const trashNode = window.FS.resolve(TRASH);
    const count = trashNode && trashNode.children ? trashNode.children.length : 0;
    if (!count) return;
    const res = await fmDialog(fm, {
      title: "Empty Trash?",
      message: "Permanently delete " + count + " item" + (count === 1 ? "" : "s") + " from the Trash? This can't be undone.",
      confirmLabel: "Empty Trash", cancelLabel: "Cancel", danger: true,
    });
    if (!res.ok) return;
    window.FS.emptyTrash();
    fm.selection = [];
    render(fm);
    updateChrome(fm);
  }

  // ---------- clipboard (Task 67) ----------
  // Copy/cut/paste/duplicate ride on the OS-wide window.Clipboard (src/clipboard.js)
  // so every File Manager window shares one clipboard.

  function selPaths(fm) {
    return fm.items.filter((i) => fm.selection.includes(i.name)).map((i) => window.FS.getPath(i));
  }

  function clipboardCopy(fm) {
    const paths = selPaths(fm);
    if (!paths.length) return;
    const n = window.Clipboard.copy(paths);
    window.Notify.toast("Copied", n + (n === 1 ? " item" : " items") + " to clipboard", { icon: "📋", app: "File Manager" });
  }

  function clipboardCut(fm) {
    const paths = selPaths(fm);
    if (!paths.length) return;
    const n = window.Clipboard.cut(paths);
    render(fm);
    window.Notify.toast("Cut", n + (n === 1 ? " item" : " items") + " — paste somewhere to move", { icon: "✂️", app: "File Manager" });
  }

  function clipboardPaste(fm, destDir) {
    if (!window.Clipboard || window.Clipboard.isEmpty) return;
    const dir = destDir || fm.cwd;
    const res = window.Clipboard.paste(dir);
    if (fm.cwd === dir || fm.cwd.startsWith(dir + "/")) render(fm);
    updateChrome(fm);
    window.Notify.toast(res.ok ? "Done" : "Clipboard", res.message, {
      icon: res.ok ? "📥" : "⚠️", app: "File Manager",
    });
  }

  function duplicateItems(fm) {
    const paths = selPaths(fm);
    if (!paths.length) return;
    let ok = 0;
    for (const p of paths) {
      const r = window.FS.copyInto(p, fm.cwd);
      if (r.ok) ok++;
    }
    if (ok) {
      render(fm);
      window.Notify.toast("Duplicated", ok + (ok === 1 ? " item" : " items"), { icon: "🟰", app: "File Manager" });
    }
  }

  // Task 82 — right-click "Upload & get link": host the file via upload-plugin
  // and put the share URL on the OS clipboard + history.
  async function uploadItem(fm) {
    const paths = selPaths(fm);
    if (paths.length !== 1) return;
    const node = window.FS.resolve(paths[0]);
    if (!node || window.FS.isFolder(node)) return;
    if (!window.Uploads) { window.Notify.toast("Uploads", "The Uploads module isn't loaded.", { icon: "⚠️", app: "File Manager" }); return; }
    window.Notify.toast("Uploading", "Hosting " + node.name + " …", { icon: "📤", app: "File Manager" });
    const r = await window.Uploads.uploadNode(node);
    if (!r.ok) {
      window.Notify.toast("Upload failed", (r.error || "unknown error"), { icon: "⚠️", app: "File Manager" });
      return;
    }
    window.Notify.toast("Uploaded", node.name + " — link copied to clipboard.", { icon: "🔗", app: "File Manager" });
  }

  function clipSummary() {
    if (!window.Clipboard || window.Clipboard.isEmpty) return "";
    return window.Clipboard.mode === "cut"
      ? " · ✂️ " + window.Clipboard.count + (window.Clipboard.count === 1 ? " cut" : " cut")
      : " · 📋 " + window.Clipboard.count + (window.Clipboard.count === 1 ? " copied" : " copied");
  }

  // ---------- Task 87: File Manager AI ----------
  // Right-click a folder → AI actions (Summarize / Generate README / Suggest
  // structure). Each builds a bounded textual inventory of the folder tree and
  // feeds it to generateText; the answer streams into a dialog, and the README
  // / structure results are also written into the folder as .md files.
  const FM_TEXTISH = /\.(md|txt|pjs|js|mjs|json|html|css|py|ts|sh|yaml|yml|toml|csv)$/i;

  function folderInventory(node) {
    const stats = { files: 0, folders: 0, bytes: 0 };
    const out = [node.name + "/"];
    const MAX_ITEMS = 200;
    let seen = 0, truncated = false;
    function walk(n, depth) {
      const kids = n.children || [];
      for (const c of kids) {
        if (seen >= MAX_ITEMS) { truncated = true; return; }
        seen++;
        const pad = "  ".repeat(depth);
        if (window.FS.isFolder(c)) {
          stats.folders++;
          out.push(pad + c.name + "/");
          walk(c, depth + 1);
        } else {
          const sz = (c.meta && c.meta.size != null) ? c.meta.size : 0;
          stats.bytes += sz;
          stats.files++;
          let line = pad + c.name;
          if (sz) line += " · " + fmtSize(sz);
          if (c.type === "file" && c.meta && typeof c.meta.content === "string" && FM_TEXTISH.test(c.name)) {
            const flat = c.meta.content.replace(/\s+/g, " ").trim().slice(0, 140);
            if (flat) line += " — \"" + flat + (c.meta.content.length > 140 ? "…" : "") + "\"";
          }
          out.push(line);
        }
      }
    }
    walk(node, 1);
    if (truncated) out.push("… (inventory truncated at " + MAX_ITEMS + " items)");
    const total = fmtSize(stats.bytes);
    return stats.folders + " folder" + (stats.folders === 1 ? "" : "s") + ", " + stats.files + " file" +
      (stats.files === 1 ? "" : "s") + " · " + total + " total\n" + out.join("\n");
  }

  // Write (or overwrite) a text file inside a folder, same recipe the Projects
  // backlog uses. Returns { path, created }.
  function writeFmFile(folderPath, name, content) {
    const path = window.FSPath.childPath(folderPath, name);
    const bytes = new TextEncoder().encode(content).length;
    const existing = window.FS.resolve(path);
    if (existing && window.FS.isFile(existing)) {
      existing.meta = existing.meta || {};
      existing.meta.content = content;
      existing.meta.size = bytes;
      existing.meta.modified = Date.now();
      return { path, created: false };
    }
    window.FS.create(folderPath, { name, type: "file", icon: "📄", meta: { content, size: bytes, modified: Date.now() } });
    return { path, created: true };
  }

  // Modal that streams the AI answer into a scrollable <pre> with Copy, and a
  // Close that cancels an in-flight generation. Returns a small handle.
  function fmAiDialog(fm, opts) {
    const wrap = el("div", "fm-dialog-wrap");
    const box = el("div", "fm-dialog wide");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.appendChild(el("h3", null, opts.title));
    const out = el("pre", "fm-preview-text");
    const busyEl = el("div", "fm-ai-busy", "✨ Generating…");
    const noteEl = el("p", "fm-ai-note", opts.note || "");
    box.append(out, busyEl, noteEl);
    const actions = el("div", "fm-dialog-actions");
    const copy = el("button", "set-btn", "📋 Copy");
    copy.type = "button";
    const closeBtn = el("button", "set-btn", "Close");
    closeBtn.type = "button";
    actions.append(copy, closeBtn);
    box.appendChild(actions);
    wrap.appendChild(box);
    fm.root.appendChild(wrap);
    const dlg = {
      out, busyEl, noteEl, text: "", stopped: false,
      close() { wrap.remove(); try { fm.bodyEl.focus(); } catch (e) {} },
    };
    copy.addEventListener("click", async () => {
      if (!dlg.text) return;
      try {
        await navigator.clipboard.writeText(dlg.text);
        window.Notify.toast("Copied", "AI result copied to the OS clipboard.", { icon: "📋", app: "File Manager" });
      } catch (e) {}
    });
    closeBtn.addEventListener("click", () => { dlg.stopped = true; if (opts.onStop) opts.onStop(); dlg.close(); });
    box.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); closeBtn.click(); } });
    wrap.addEventListener("mousedown", (ev) => { if (ev.target === wrap) closeBtn.click(); });
    setTimeout(() => closeBtn.focus(), 30);
    return dlg;
  }

  async function fmAi(fm, item, kind) {
    if (fm.busy || !window.FS.isFolder(item)) return;
    const meta = {
      summarize: { icon: "📝", label: "Summarize contents" },
      readme:     { icon: "📄", label: "Generate README" },
      structure:  { icon: "🧱", label: "Suggest file structure" },
    }[kind] || null;
    if (!meta) return;
    const folderPath = window.FS.getPath(item);
    const inv = folderInventory(item);
    const shared = "Below is an inventory of the folder \"" + item.name + "\" (at " + folderPath + ") in a Linux home directory.\n" + inv + "\n\n";
    const prompts = {
      summarize: shared + "Write a concise, friendly summary (5–10 bullet points): what this folder appears to be, what the main files and folders do, and any patterns you notice (code project, config, docs, assets). End with one short line noting anything that looks incomplete or worth attention. Plain text with light markdown bullets, no preamble.",
      readme: shared + "Generate a clean Markdown README.md for this folder: a one-line title, a short description, a \"Contents\" section listing the main entries with one-line explanations, and a \"Usage\" / \"Notes\" section when the inventory suggests one. Keep it under ~40 lines. Output ONLY the markdown document, no preamble.",
      structure: shared + "Suggest an improved, cleaner file & folder structure for this folder. First output a Markdown fenced code block containing a proposed file tree (folders end with /), then a short numbered list of the top 2–4 recommended moves or reorganizations and why. Keep it under ~30 lines, no preamble.",
    };
    const saveName = kind === "readme" ? "README.md" : kind === "structure" ? "SUGGESTED-STRUCTURE.md" : null;
    const savePath = saveName ? folderPath + "/" + saveName : null;

    fm.busy = meta.label + " " + item.name;
    updateStatus(fm);
    let cur = null;
    const dlg = fmAiDialog(fm, {
      title: meta.icon + " " + meta.label + " — " + item.name,
      note: savePath ? "Will be saved to " + savePath : "Streaming — results appear below.",
      onStop: () => { if (cur) { try { cur.stop(); } catch (e) {} } },
    });
    try {
      const gen = window.root && window.root.generateText;
      if (typeof gen !== "function") throw new Error("The AI text plugin isn't loaded.");
      dlg.out.textContent = "✨ thinking…";
      cur = gen({
        instruction: prompts[kind],
        onChunk: (d) => {
          if (dlg.stopped || !dlg.out.isConnected) return;
          const t = d && d.textChunk != null ? String(d.textChunk) : "";
          if (t) { dlg.text += t; dlg.out.textContent = dlg.text; dlg.out.scrollTop = dlg.out.scrollHeight; }
        },
      });
      await cur;
    } catch (e) {
      if (dlg.out.isConnected && !dlg.stopped) {
        dlg.text += (dlg.text ? "\n" : "") + "[error] " + ((e && e.message) || "stopped");
        dlg.out.textContent = dlg.text;
      }
    } finally {
      if (!dlg.stopped && dlg.out.isConnected) {
        const result = dlg.text.trim();
        if (saveName && result && !/^\[error\]/.test(result)) {
          const w = writeFmFile(folderPath, saveName, result + "\n");
          dlg.noteEl.textContent = "✓ Saved to " + w.path;
          dlg.noteEl.classList.add("ok");
        }
        dlg.busyEl.hidden = true;
      }
      fm.busy = null;
      if (fm.root.isConnected) render(fm);
    }
  }

  // ---------- selection ----------
  function applySelection(fm) {
    for (const cell of fm.bodyEl.querySelectorAll(".fm-cell, .fm-row")) {
      cell.classList.toggle("sel", fm.selection.includes(cell.dataset.name));
    }
  }
  function setSelection(fm, names, opts) {
    opts = opts || {};
    if (opts.toggle) {
      for (const n of names) {
        const i = fm.selection.indexOf(n);
        if (i === -1) fm.selection.push(n); else fm.selection.splice(i, 1);
      }
    } else if (opts.add) {
      for (const n of names) if (!fm.selection.includes(n)) fm.selection.push(n);
    } else {
      fm.selection = names.slice();
    }
    applySelection(fm);
    updateStatus(fm);
  }

  function gridCols(fm) {
    if (fm.view !== "grid") return 1;
    return Math.max(1, Math.floor((fm.bodyEl.clientWidth - 24) / 112));
  }

  // ---------- opening items ----------
  function activate(fm, item) {
    if (window.FS.isFolder(item)) {
      fm.navigate(window.FS.getPath(item), { push: true });
    } else if (window.FS.isShortcut(item)) {
      window.Launcher.launch(item);
    } else if (window.FS.isFile(item) && isImageFile(item)
               && window.ImageViewer && window.ImageViewer.openPath) {
      // Task 32 — image files (a file whose content is an image URL) open in
      // the Image Viewer, which also collects sibling images for prev/next.
      window.ImageViewer.openPath(window.FS.getPath(item));
    } else if (window.FS.isFile(item) && isPdfFile(item)
               && window.PDFViewer && window.PDFViewer.openPath) {
      // POST-52 Task 61 — .pdf files (content starts with "%PDF-") open in
      // the PDF Viewer, which renders them with pdf.js.
      window.PDFViewer.openPath(window.FS.getPath(item));
    } else if (window.FS.isFile(item) && item.meta && typeof item.meta.content === "string"
               && window.TextEditor && window.TextEditor.openPath) {
      // Task 29 — plain-text files open for editing in the Text Editor.
      window.TextEditor.openPath(window.FS.getPath(item));
    } else {
      previewFile(item);
    }
  }

  // A file counts as an image when its stored content is an image URL (the
  // virtual FS stores file content as strings) and it isn't a plain-text file.
  function isImageFile(node) {
    const content = node && node.meta && node.meta.content;
    return typeof content === "string" && !/\.txt$/i.test(node.name || "")
      && /^(https?:|data:image|blob:)/i.test(content.trim());
  }

  // A file counts as a PDF when it has a .pdf name and its stored content is
  // an actual PDF (content starts with the "%PDF-" magic bytes).
  function isPdfFile(node) {
    const content = node && node.meta && node.meta.content;
    return /\.pdf$/i.test(node.name || "") && typeof content === "string"
      && /^%PDF-/i.test(content.trim());
  }

  function previewFile(node) {
    const path = window.FS.getPath(node);
    const m = node.meta || {};
    const body = el("div", "fm-preview");
    body.appendChild(el("div", "fm-preview-head", node.name));
    if (typeof m.content === "string") {
      const pre = el("pre", "fm-preview-text");
      pre.textContent = m.content || "(empty file)";
      body.appendChild(pre);
    } else {
      body.appendChild(el("div", "fm-preview-meta",
        typeLabel(node) + " \u00b7 " + fmtSize(m.size || 0) + (m.modified ? " \u00b7 " + fmtDate(m.modified) : "")));
    }
    body.appendChild(el("p", "fm-preview-note", "Full editing ships with the Text Editor app."));
    window.WM.open({
      appId: "file-preview:" + path,
      title: node.name, icon: node.icon || "📄",
      content: body, w: 480, h: 380, minW: 320, minH: 240,
    });
  }

  // ---------- rendering ----------
  function renderGrid(fm) {
    const g = el("div", "fm-grid");
    for (const item of fm.items) {
      const cell = el("div", "fm-cell");
      cell.dataset.name = item.name;
      cell.title = item.name;
      if (window.Clipboard && window.Clipboard.isCut(item)) cell.classList.add("cut");
      const tile = el("div", "tile", item.icon || (window.FS.isFolder(item) ? "📁" : "📄"));
      Object.assign(tile.style, tileStyle(nodeColor(item)));
      arcadeTile(tile, item);
      cell.appendChild(tile);
      cell.appendChild(el("div", "name", item.name));
      if (window.FS.isShortcut(item) && item.meta && item.meta.comingSoon) {
        cell.appendChild(el("span", "fm-soon", "Soon"));
      }
      const chipTxt = gameChip(item);
      if (chipTxt) cell.appendChild(el("span", "fm-chip", chipTxt));
      g.appendChild(cell);
    }
    fm.bodyEl.appendChild(g);
    applySelection(fm);
  }

  function renderList(fm) {
    const list = el("div", "fm-list");
    const head = el("div", "fm-row-head");
    head.append(el("span", null, "Name"), el("span", null, "Type"), el("span", null, "Size"), el("span", null, "Modified"));
    list.appendChild(head);
    for (const item of fm.items) {
      const row = el("div", "fm-row");
      row.dataset.name = item.name;
      row.title = item.name;
      if (window.Clipboard && window.Clipboard.isCut(item)) row.classList.add("cut");
      const nameC = el("span", "c-name");
      const tile = el("span", "tile", item.icon || (window.FS.isFolder(item) ? "📁" : "📄"));
      Object.assign(tile.style, tileStyle(nodeColor(item)));
      arcadeTile(tile, item);
      nameC.append(tile, el("span", "name", item.name));
      if (window.FS.isShortcut(item) && item.meta && item.meta.comingSoon) {
        nameC.appendChild(el("span", "fm-soon", "Soon"));
      }
      const chipTxt = gameChip(item);
      if (chipTxt) nameC.appendChild(el("span", "fm-chip", chipTxt));
      const size = window.FS.isFile(item) ? fmtSize((item.meta && item.meta.size) || 0) : "—";
      const date = (item.meta && item.meta.modified) ? fmtDate(item.meta.modified) : "—";
      row.append(nameC, el("span", "c-type", typeLabel(item)), el("span", "c-size", size), el("span", "c-date", date));
      list.appendChild(row);
    }
    fm.bodyEl.appendChild(list);
    applySelection(fm);
  }

  function renderEmpty(fm) {
    fm.bodyEl.textContent = "";
    const e = el("div", "fm-empty");
    if (fm.cwd === TRASH) {
      e.appendChild(el("div", "fm-empty-ico", "🗑️"));
      e.appendChild(el("h3", null, "Trash is empty"));
      e.appendChild(el("p", null, "Deleted files and folders show up here so you can restore them."));
      const btns = el("div", "fm-empty-actions");
      const b1 = el("button", "set-btn", "Go to Home");
      b1.type = "button";
      b1.addEventListener("click", () => navigate(fm, HOME, { push: true }));
      btns.appendChild(b1);
      e.appendChild(btns);
      fm.bodyEl.appendChild(e);
      return;
    }
    e.appendChild(el("div", "fm-empty-ico", "📂"));
    e.appendChild(el("h3", null, "This folder is empty"));
    e.appendChild(el("p", null, "Nothing here yet — create something to get started."));
    const btns = el("div", "fm-empty-actions");
    const b1 = el("button", "set-btn", "New folder");
    const b2 = el("button", "set-btn", "New text file");
    b1.type = "button"; b2.type = "button";
    b1.addEventListener("click", () => newItem(fm, "folder"));
    b2.addEventListener("click", () => newItem(fm, "file"));
    btns.append(b1, b2);
    e.appendChild(btns);
    fm.bodyEl.appendChild(e);
  }

  function renderError(fm, res) {
    fm.bodyEl.textContent = "";
    const e = el("div", "fm-error");
    e.appendChild(el("div", "fm-empty-ico", "⚠️"));
    e.appendChild(el("h3", null, "Folder not found"));
    const msg = res && res.ok && !window.FS.isFolder(res.node)
      ? "That's not a folder."
      : (res && res.error ? res.error : "This folder no longer exists.");
    e.appendChild(el("p", null, msg));
    const b = el("button", "set-btn", "Go to Home");
    b.type = "button";
    b.addEventListener("click", () => navigate(fm, HOME, { push: true }));
    e.appendChild(b);
    fm.bodyEl.appendChild(e);
  }

  function render(fm) {
    fm.bodyEl.textContent = "";
    const res = window.FSPath.lookup(fm.cwd);
    if (!res.ok || !window.FS.isFolder(res.node)) { renderError(fm, res); updateStatus(fm); return; }
    fm.items = sortItems(res.node.children.slice());
    if (!fm.items.length) renderEmpty(fm);
    else if (fm.view === "list") renderList(fm);
    else renderGrid(fm);
    updateStatus(fm);
  }

  function updateStatus(fm) {
    if (fm.pathEl) fm.pathEl.textContent = fm.cwd;
    const clipSuffix = clipSummary();
    if (fm.countEl) {
      if (fm.busy) { fm.countEl.textContent = "✨ " + fm.busy + "…"; fm.countEl.classList.add("busy"); return; }
      fm.countEl.classList.remove("busy");
      if (fm.selection.length) { fm.countEl.textContent = fm.selection.length + " selected" + clipSuffix; return; }
      const folders = fm.items.filter((i) => window.FS.isFolder(i)).length;
      const files = fm.items.filter((i) => window.FS.isFile(i)).length;
      const shortcuts = fm.items.length - folders - files;
      const bits = [];
      if (folders) bits.push(folders + " folder" + (folders === 1 ? "" : "s"));
      if (files) bits.push(files + " file" + (files === 1 ? "" : "s"));
      if (shortcuts) bits.push(shortcuts + " shortcut" + (shortcuts === 1 ? "" : "s"));
      fm.countEl.textContent = fm.items.length + " item" + (fm.items.length === 1 ? "" : "s") + clipSuffix +
        (bits.length ? " \u00b7 " + bits.join(" \u00b7 ") : "");
    }
  }

  function renderCrumbs(fm) {
    fm.crumbsEl.textContent = "";
    const parts = fm.cwd.split("/").filter(Boolean);
    const root = el("button", "fm-crumb" + (parts.length ? "" : " cur"), "📁");
    root.type = "button";
    root.title = "/";
    root.dataset.path = "/";
    root.disabled = !parts.length;
    fm.crumbsEl.appendChild(root);
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc += "/" + parts[i];
      fm.crumbsEl.appendChild(el("span", "fm-crumb-sep", "›"));
      const last = i === parts.length - 1;
      const b = el("button", "fm-crumb" + (last ? " cur" : ""), parts[i]);
      b.type = "button";
      b.dataset.path = acc;
      b.title = acc;
      b.disabled = last;
      fm.crumbsEl.appendChild(b);
    }
  }

  function updateTitle(fm) {
    const w = window.WM && window.WM.findByAppId("file-manager");
    if (!w || w.id == null) return;
    const name = fm.cwd === "/" ? "File System" : window.FSPath.basename(fm.cwd);
    window.WM.setTitle(w.id, name);
  }

  function updateChrome(fm) {
    const canBack = fm.hIndex > 0;
    const canFwd = fm.hIndex < fm.history.length - 1;
    fm.btnBack.disabled = !canBack;
    fm.btnFwd.disabled = !canFwd;
    fm.btnUp.disabled = fm.cwd === "/";
    const inTrash = fm.cwd === TRASH;
    if (fm.trashBar) {
      fm.trashBar.hidden = !inTrash;
      fm.trashBar.textContent = "";
      if (inTrash) {
        fm.trashBar.append(
          el("span", "fm-trashbar-ico", "🗑️"),
          el("span", null, "Deleted items live here until you restore them (↩) or empty the Trash."),
        );
      }
    }
    if (fm.btnEmpty) fm.btnEmpty.hidden = !inTrash;
    if (fm.btnNew) fm.btnNew.hidden = inTrash;
    if (fm.btnPaste) fm.btnPaste.disabled = inTrash || !(window.Clipboard && !window.Clipboard.isEmpty);
    renderCrumbs(fm);
    updateTitle(fm);
    updateStatus(fm);
  }

  // ---------- navigation ----------
  function navigate(fm, path, opts) {
    opts = opts || {};
    const res = window.FSPath.lookup(path);
    if (!res.ok || !window.FS.isFolder(res.node)) {
      fm.cwd = res.path;
      fm.selection = [];
      fm.items = [];
      render(fm);
      updateChrome(fm);
      return;
    }
    if (opts.push && res.path !== fm.cwd) {
      fm.history = fm.history.slice(0, fm.hIndex + 1);
      fm.history.push(res.path);
      fm.hIndex = fm.history.length - 1;
    }
    fm.cwd = res.path;
    fm.selection = [];
    render(fm);
    updateChrome(fm);
    fm.bodyEl.scrollTop = 0;
  }

  function go(fm, delta) {
    const idx = fm.hIndex + delta;
    if (idx < 0 || idx >= fm.history.length) return;
    fm.hIndex = idx;
    fm.cwd = fm.history[idx];
    fm.selection = [];
    render(fm);
    updateChrome(fm);
    fm.bodyEl.scrollTop = 0;
  }

  function toggleView(fm) {
    fm.view = fm.view === "grid" ? "list" : "grid";
    saveView(fm.view);
    fm.viewBtn.textContent = fm.view === "grid" ? "▤ List" : "▦ Grid";
    render(fm);
    updateChrome(fm);
  }

  function keyMove(fm, dir) {
    const n = fm.items.length;
    let cur = -1;
    if (fm.selection.length) {
      const i = fm.items.findIndex((it) => it.name === fm.selection[fm.selection.length - 1]);
      if (i !== -1) cur = i;
    }
    const cols = fm.view === "grid" ? gridCols(fm) : 1;
    let next;
    if (dir === "down") next = cur === -1 ? 0 : cur + cols;
    else if (dir === "up") next = cur === -1 ? n - 1 : cur - cols;
    else if (dir === "right") next = cur === -1 ? 0 : cur + 1;
    else next = cur === -1 ? n - 1 : cur - 1;
    return Math.max(0, Math.min(n - 1, next));
  }

  function scrollToName(fm, name) {
    const cell = [...fm.bodyEl.querySelectorAll(".fm-cell, .fm-row")].find((c) => c.dataset.name === name);
    if (cell) cell.scrollIntoView({ block: "nearest" });
  }

  function showNewMenu(fm, x, y) {
    const menu = [
      { label: "Folder", icon: "📁", onClick: () => newItem(fm, "folder") },
      { label: "Text file", icon: "📄", onClick: () => newItem(fm, "file") },
    ];
    if (window.Clipboard && !window.Clipboard.isEmpty) {
      menu.push({ sep: true });
      menu.push({ label: "Paste", icon: "📥", onClick: () => clipboardPaste(fm) });
    }
    window.ContextMenu.show(x, y, menu);
  }

  // ---------- app factory ----------
  function createFM(initialPath) {
    const fm = {
      root: el("div", "fm"),
      bodyEl: null, crumbsEl: null, pathEl: null, countEl: null,
      viewBtn: null, btnBack: null, btnFwd: null, btnUp: null,
      cwd: null, history: [], hIndex: -1, view: loadView(),
      selection: [], items: [],
    };
    fm.root._fm = fm;   // lets openPath find the mounted instance
    // Module-level ops take `fm` as their first arg; expose them as methods so
    // the mounted instance (root._fm) can be driven externally (openPath).
    fm.navigate = (path, opts) => navigate(fm, path, opts);
    fm.go = (delta) => go(fm, delta);
    fm.render = () => render(fm);
    fm.updateChrome = () => updateChrome(fm);

    const toolbar = el("div", "fm-toolbar");
    const nav = el("div", "fm-nav");
    fm.btnBack = el("button", "fm-nav-btn", "‹");
    fm.btnBack.type = "button"; fm.btnBack.title = "Back";
    fm.btnFwd = el("button", "fm-nav-btn", "›");
    fm.btnFwd.type = "button"; fm.btnFwd.title = "Forward";
    fm.btnUp = el("button", "fm-nav-btn", "↑");
    fm.btnUp.type = "button"; fm.btnUp.title = "Up";
    nav.append(fm.btnBack, fm.btnFwd, fm.btnUp);

    fm.crumbsEl = el("div", "fm-crumbs");
    fm.crumbsEl.tabIndex = 0;
    fm.crumbsEl.setAttribute("aria-label", "Location");

    const actions = el("div", "fm-actions");
    fm.btnNew = el("button", "fm-act-btn", "＋ New");
    fm.btnNew.type = "button"; fm.btnNew.title = "New folder or file";
    fm.btnPaste = el("button", "fm-act-btn", "📥 Paste");
    fm.btnPaste.type = "button"; fm.btnPaste.title = "Paste from the OS clipboard (Ctrl+V)";
    fm.btnPaste.disabled = true;
    fm.viewBtn = el("button", "fm-act-btn", fm.view === "grid" ? "▤ List" : "▦ Grid");
    fm.viewBtn.type = "button"; fm.viewBtn.title = "Toggle grid / list view";
    fm.btnEmpty = el("button", "fm-act-btn danger", "Empty Trash");
    fm.btnEmpty.type = "button"; fm.btnEmpty.title = "Permanently delete everything in the Trash";
    fm.btnEmpty.hidden = true;
    actions.append(fm.btnNew, fm.btnPaste, fm.viewBtn, fm.btnEmpty);
    toolbar.append(nav, fm.crumbsEl, actions);

    const trashBar = el("div", "fm-trashbar", "");
    trashBar.hidden = true;
    fm.trashBar = trashBar;

    const status = el("div", "fm-status");
    fm.pathEl = el("span", "fm-status-path", "");
    fm.countEl = el("span", "fm-status-count", "");
    status.append(fm.pathEl, fm.countEl);

    fm.bodyEl = el("div", "fm-body");
    fm.bodyEl.tabIndex = 0;
    fm.bodyEl.setAttribute("aria-label", "Files");

    fm.root.append(toolbar, trashBar, status, fm.bodyEl);

    // toolbar events
    fm.btnBack.addEventListener("click", () => go(fm, -1));
    fm.btnFwd.addEventListener("click", () => go(fm, 1));
    fm.btnUp.addEventListener("click", () => {
      const p = window.FSPath.parentPath(fm.cwd);
      if (p !== fm.cwd) navigate(fm, p, { push: true });
    });
    fm.btnNew.addEventListener("click", () => {
      const r = fm.btnNew.getBoundingClientRect();
      showNewMenu(fm, r.left, r.bottom + 2);
    });
    fm.btnPaste.addEventListener("click", () => clipboardPaste(fm));
    fm.btnEmpty.addEventListener("click", () => emptyTrashNow(fm));
    fm.viewBtn.addEventListener("click", () => toggleView(fm));
    fm.crumbsEl.addEventListener("click", (ev) => {
      const b = ev.target.closest(".fm-crumb");
      if (b && !b.disabled && b.dataset.path) navigate(fm, b.dataset.path, { push: true });
    });

    // item-area pointer events
    fm.bodyEl.addEventListener("click", (ev) => {
      const target = ev.target.closest(".fm-cell, .fm-row");
      if (!target) { setSelection(fm, []); return; }
      const name = target.dataset.name;
      if (ev.ctrlKey || ev.metaKey) setSelection(fm, [name], { toggle: true });
      else if (ev.shiftKey) {
        const idx = fm.items.findIndex((i) => i.name === name);
        let anchor = fm.items.findIndex((i) => fm.selection.includes(i.name));
        if (anchor === -1) anchor = idx;
        const a = Math.min(anchor, idx), b = Math.max(anchor, idx);
        setSelection(fm, fm.items.slice(a, b + 1).map((i) => i.name), { add: true });
      } else setSelection(fm, [name]);
    });
    fm.bodyEl.addEventListener("dblclick", (ev) => {
      const target = ev.target.closest(".fm-cell, .fm-row");
      if (!target) return;
      const item = fm.items.find((i) => i.name === target.dataset.name);
      if (item) activate(fm, item);
    });
    // Right-click on an item: select it, then Open / Rename / Delete. The
    // window lives inside #desktop, so stopPropagation keeps the shell's
    // desktop context menu from also firing (contextmenu.js listens on
    // document).
    fm.bodyEl.addEventListener("contextmenu", (ev) => {
      const target = ev.target.closest(".fm-cell, .fm-row");
      if (!target) return;
      ev.preventDefault();
      ev.stopPropagation();
      const name = target.dataset.name;
      if (!fm.selection.includes(name)) setSelection(fm, [name]);
      const single = fm.selection.length === 1;
      const item = fm.items.find((i) => i.name === name);
      const inTrash = fm.cwd === TRASH;
      const menu = [
        { label: "Open", icon: "⏎", disabled: !single, onClick: () => item && activate(fm, item) },
        { label: "Rename…", icon: "✎", disabled: !single, onClick: () => renameItems(fm) },
      ];
      if (!inTrash) {
        menu.push(
          { label: "Copy", icon: "📋", disabled: fm.selection.length === 0, onClick: () => clipboardCopy(fm) },
          { label: "Cut", icon: "✂️", disabled: fm.selection.length === 0, onClick: () => clipboardCut(fm) },
          { label: "Duplicate", icon: "🟰", disabled: !single, onClick: () => duplicateItems(fm) },
          { label: "Upload & get link", icon: "📤", disabled: !single || !item || window.FS.isFolder(item), onClick: () => uploadItem(fm) },
        );
        if (window.Clipboard && !window.Clipboard.isEmpty) {
          menu.push({ sep: true });
          menu.push({ label: "Paste", icon: "📥", disabled: false, onClick: () => clipboardPaste(fm) });
          if (item && window.FS.isFolder(item)) {
            menu.push({
              label: "Paste into " + item.name,
              icon: "📂",
              onClick: () => clipboardPaste(fm, window.FSPath.childPath(fm.cwd, item.name)),
            });
          }
        }
      }
      if (!inTrash && single && item && window.FS.isFolder(item)) {
        menu.push({ sep: true });
        menu.push({ label: "Summarize contents", icon: "📝", disabled: !!fm.busy, onClick: () => fmAi(fm, item, "summarize") });
        menu.push({ label: "Generate README", icon: "📄", disabled: !!fm.busy, onClick: () => fmAi(fm, item, "readme") });
        menu.push({ label: "Suggest file structure", icon: "🧱", disabled: !!fm.busy, onClick: () => fmAi(fm, item, "structure") });
      }
      if (inTrash) {
        menu.push({ label: "Restore", icon: "↩", disabled: false, onClick: () => restoreItems(fm) });
      }
      menu.push({
        label: fm.selection.length > 1
          ? (inTrash ? "Delete " + fm.selection.length + " items permanently…" : "Move " + fm.selection.length + " items to Trash…")
          : (inTrash ? "Delete permanently…" : "Move to Trash…"),
        icon: "🗑", danger: inTrash, onClick: () => deleteItems(fm),
      });
      window.ContextMenu.show(ev.clientX, ev.clientY, menu);
    });
    // Empty-background right-click: new folder / file shortcuts (never inside
    // /Trash — nothing can be created there).
    fm.root.addEventListener("contextmenu", (ev) => {
      if (ev.target.closest(".fm-cell, .fm-row, .fm-toolbar")) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (fm.cwd === TRASH) return;
      showNewMenu(fm, ev.clientX, ev.clientY);
    });

    // keyboard navigation
    fm.bodyEl.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey || ev.metaKey) {
        const k = ev.key.toLowerCase();
        if (k === "a") { ev.preventDefault(); setSelection(fm, fm.items.map((i) => i.name)); }
        else if (k === "c") { ev.preventDefault(); clipboardCopy(fm); }
        else if (k === "x") { ev.preventDefault(); clipboardCut(fm); }
        else if (k === "v") { ev.preventDefault(); clipboardPaste(fm); }
        else if (k === "d") { ev.preventDefault(); duplicateItems(fm); }
        return;
      }
      const n = fm.items.length;
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (window.Clipboard && window.Clipboard.cancelCut()) render(fm);
        setSelection(fm, []);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        if (fm.selection.length === 1) {
          const item = fm.items.find((i) => i.name === fm.selection[0]);
          if (item) activate(fm, item);
        }
        return;
      }
      if (ev.key === "F2") { ev.preventDefault(); renameItems(fm); return; }
      if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); deleteItems(fm); return; }
      const dirs = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" };
      if (!dirs[ev.key] || !n) return;
      ev.preventDefault();
      const idx = keyMove(fm, dirs[ev.key]);
      setSelection(fm, [fm.items[idx].name]);
      scrollToName(fm, fm.items[idx].name);
    });

    navigate(fm, initialPath || HOME, { push: false });

    // The window may not exist yet when the builder runs (apps.js mounts the
    // content after WM.open); once it's live, refresh chrome so the title bar
    // reflects the current folder. setTimeout (not rAF): rAF never fires while
    // the preview iframe is a hidden/backgrounded tab, which would leave the
    // title stuck on the app name.
    setTimeout(() => { if (fm.root.isConnected) updateChrome(fm); }, 50);

    return fm;
  }

  // ---------- public API ----------
  function openPath(path) {
    const home = window.FSPath.homePath ? window.FSPath.homePath() : HOME;
    let target = path || home;
    const res = window.FSPath.lookup(target);
    if (!res.ok || !window.FS.isFolder(res.node)) target = home;
    const w = window.WM.findByAppId("file-manager");
    if (w && !w.closed && w.el) {
      if (w.minimized) window.WM.restore(w.id); else window.WM.focus(w.id);
      const root = w.el.querySelector(".fm");
      if (root && root._fm) root._fm.navigate(target, { push: true });
      return w;
    }
    const fm = createFM(target);
    return window.WM.open({
      appId: "file-manager", title: "File Manager", icon: "📁",
      singleton: true, w: 740, h: 500, minW: 480, minH: 320,
      content: fm.root,
    });
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["file-manager"] = function () {
    const fm = createFM(window.FSPath.homePath ? window.FSPath.homePath() : HOME);
    return { content: fm.root, w: 740, h: 500, minW: 480, minH: 320 };
  };

  // Any change to the OS clipboard re-renders the open File Manager so cut
  // dimming and the status hint stay live across windows.
  document.addEventListener("webuntu-clipboard", () => {
    const w = window.WM && window.WM.findByAppId("file-manager");
    if (!w || w.closed || !w.el) return;
    const root = w.el.querySelector(".fm");
    if (!root || !root._fm) return;
    const fm = root._fm;
    if (fm.btnPaste) fm.btnPaste.disabled = fm.cwd === TRASH || window.Clipboard.isEmpty;
    render(fm);
    updateChrome(fm);
  });

  window.FileManager = { openPath };
})();
