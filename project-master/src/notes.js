// src/notes.js — Notes view (Roadmap Phase 6: tasks 43–50).
//
//  43: note editor — title + body (plain text, multi-line), created/updated stamps
//  44: notes list with text search + project filter
//  45: pin / unpin — pinned notes float to the top of the list
//  46: download a note as .txt
//  47: delete note (confirm)
//  48: import .txt / .md files
//  49: import .docx via mammoth (browser build loaded on demand)
//  50: import .doc via a built-in binary text extractor
//
// Records: {type:"note", id, title, body, pinned, tags, projectId, created, updated}
// Pure helpers covered by runPhase6Tests().

import { $, esc, toast, confirmDialog, openModal } from "./ui.js";
import { ICONS } from "./icons.js";
import { parseTags } from "./taskEditor.js";
import { tagColor } from "./tags.js";
import { attachmentSectionHTML, wireAttachmentSection } from "./attachments.js";

export function openNoteEditor(store, { note = null, defaults = {} } = {}) {
  const isEdit = !!note;
  const { el, close } = openModal(`
    <div class="modal-card task-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "Edit note" : "New note"}">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>${isEdit ? "Edit note" : "New note"}</h3>
      <p class="modal-sub">${isEdit ? "Update the note." : "Capture an idea, a link or a longer thought."}</p>
      <div class="field"><label for="ntTitleInput">Title *</label><input type="text" id="ntTitleInput" value="${esc(note ? note.title : "")}" placeholder="Note title" maxlength="120"></div>
      <div class="field"><label for="ntBodyInput">Body</label><textarea id="ntBodyInput" placeholder="Write here…" style="min-height:180px;">${esc(note ? note.body : "")}</textarea></div>
      <div class="te-grid">
        <div class="field"><label for="ntTagsInput">Tags (comma separated)</label><input type="text" id="ntTagsInput" value="${esc(note && note.tags ? note.tags.join(", ") : "")}" placeholder="ideas, research"></div>
        <div class="field"><label for="ntProjSel">Project</label>
          <select id="ntProjSel"><option value="">No project</option>${store.all("project").map((p) => `<option value="${esc(p.id)}" ${note && note.projectId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      </div>
      ${isEdit ? `<div class="field">${attachmentSectionHTML(store, "note", note.id)}</div>` : ""}
      <div class="modal-btns">
        ${isEdit ? `<button class="btn btn-danger" id="ntDelBtn" style="margin-right:auto;">${ICONS.trash} Delete</button>` : ""}
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="ntSaveBtn">${isEdit ? "Save changes" : "Add note"}</button>
      </div>
    </div>`);
  if (isEdit) {
    const atSection = el.querySelector("[data-at-section]");
    if (atSection) wireAttachmentSection(atSection, store, "note", note.id);
  }

  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("#ntSaveBtn")?.addEventListener("click", () => {
    const title = (el.querySelector("#ntTitleInput")?.value || "").trim();
    if (!title) { toast("Enter a note title", "error"); el.querySelector("#ntTitleInput")?.focus(); return; }
    const fields = {
      title,
      body: (el.querySelector("#ntBodyInput")?.value || "").trim(),
      tags: parseTags(el.querySelector("#ntTagsInput")?.value),
      projectId: el.querySelector("#ntProjSel")?.value || null,
    };
    if (isEdit) store.upsert("note", note.id, fields);
    else store.create("note", fields);
    toast(isEdit ? "Note updated" : "Note added", "success");
    close();
  });

  if (isEdit) {
    el.querySelector("#ntDelBtn")?.addEventListener("click", async () => {
      const sure = await confirmDialog({ title: "Delete note?", message: "“" + note.title + "” will be permanently removed.", confirmText: "Delete note", danger: true });
      if (!sure) return;
      store.remove("note", note.id);
      toast("Note deleted", "success");
      close();
    });
  }

  setTimeout(() => { const t = el.querySelector("#ntTitleInput"); if (t) t.focus(); }, 30);
  return { el, close };
}

export function togglePin(store, note) {
  store.upsert("note", note.id, { pinned: !note.pinned });
  return !note.pinned;
}

// Pure: filter notes by query + project, pinned first, then updated desc.
export function filterNotes(notes, q, projectId) {
  const query = String(q || "").toLowerCase().trim();
  return notes
    .filter((n) => {
      if (projectId === "none") { if ((n.projectId ?? null) !== null) return false; }
      else if (projectId && projectId !== "all" && n.projectId !== projectId) return false;
      if (query) {
        const hay = (((n.title || "") + " " + (n.body || "") + " " + (n.tags || []).join(" "))).toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updated || b.created || 0) - (a.updated || a.created || 0);
    });
}

export function noteCardHTML(store, pmap, n) {
  const body = (n.body || "").split("\n").slice(0, 3).join(" · ") || "—";
  const tags = (n.tags || []).map((t) => {
    const c = tagColor(store, t);
    return `<span class="tv-tag${c ? " tv-tag-c" : ""}"${c ? ` style="--tcol:${c}"` : ""}>${esc(t)}</span>`;
  }).join("");
  const proj = n.projectId && pmap.get(n.projectId) ? `<span class="tv-proj"><span class="tv-dot" style="background:${pmap.get(n.projectId).color}"></span>${esc(pmap.get(n.projectId).name)}</span>` : "";
  return `
    <div class="nt-card${n.pinned ? " pinned" : ""}" data-ntid="${n.id}">
      <div class="nt-head">
        <h3 data-nt-open="${n.id}" title="Open note">${esc(n.title)}${n.pinned ? ` <span class="nt-pin">${ICONS.pin}</span>` : ""}</h3>
        <div class="nt-actions">
          <button class="mini-btn nt-pinbtn${n.pinned ? " on" : ""}" data-nt-pin="${n.id}" title="${n.pinned ? "Unpin" : "Pin"}">${ICONS.pin}</button>
          <button class="mini-btn" data-nt-open="${n.id}" title="Edit note">${ICONS.pencil}</button>
          <button class="mini-btn" data-nt-dl="${n.id}" title="Download as .txt">${ICONS.download}</button>
          <button class="mini-btn danger" data-nt-del="${n.id}" title="Delete note">${ICONS.trash}</button>
        </div>
      </div>
      <p class="nt-body" data-nt-open="${n.id}">${esc(body)}</p>
      <div class="nt-foot">
        ${tags ? `<span class="tv-tags">${tags}</span>` : ""}
        ${proj}
        <span class="nt-date">${new Date(n.updated || n.created || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      </div>
    </div>`;
}

export function notesViewHTML(store) {
  const pmap = new Map(store.all("project").map((p) => [p.id, p]));
  const state = notesState;
  const shown = filterNotes(store.all("note"), state.q, state.project);
  const cards = shown.map((n) => noteCardHTML(store, pmap, n)).join("") ||
    `<div class="proj-empty">${ICONS.file}<h2>No notes found</h2><p>Write a new note or import a .txt / .md / .docx file.</p></div>`;
  const projOpts = `<option value="all">All projects</option><option value="none">No project</option>` +
    store.all("project").map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.file}</span> Notes</h1><p class="sub">${shown.length} of ${store.count("note")} notes · pinned first</p></div>
        <div class="ws-actions">
          <button class="btn" id="ntExportBtn" title="Export all notes as Markdown">${ICONS.download} Export .md</button>
          <button class="btn" id="ntImportBtn" title="Import .txt / .md / .docx / .doc">${ICONS.upload} Import</button>
          <input type="file" id="ntImportFile" accept=".txt,.md,.markdown,.docx,.doc,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword" hidden multiple>
          <button class="btn btn-primary" id="ntNewBtn">${ICONS.plus} New note</button>
        </div>
      </div>
    </div>
    <div class="nt-toolbar">
      <div class="tv-search">${ICONS.search}<input id="ntSearchInput" type="text" placeholder="Search notes…" value="${esc(state.q)}"></div>
      <select id="ntProjFilter" title="Filter by project">${projOpts}</select>
    </div>
    <div class="nt-grid">${cards}</div>`;
}

export const notesState = { q: "", project: "all" };

export function wireNotesView(store, ctx) {
  const redraw = () => ctx.render && ctx.render();
  $("#ntExportBtn")?.addEventListener("click", () => {
    import("./exports.js").then((X) => { X.downloadNotesMD(store); toast("Notes exported as Markdown — check your downloads", "success"); });
  });
  $("#ntNewBtn")?.addEventListener("click", () => openNoteEditor(store));
  $("#ntImportBtn")?.addEventListener("click", () => $("#ntImportFile")?.click());
  const handleFiles = async (fileList) => {
    for (const file of Array.from(fileList || [])) {
      try {
        const title = file.name.replace(/\.(txt|md|markdown|docx|doc)$/i, "");
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        let body = "";
        if (ext === "docx") body = await importDocx(file);
        else if (ext === "doc") body = await importDoc(file);
        else body = (await file.text()).trim();
        store.create("note", { title, body, pinned: false, tags: [], projectId: null });
        toast("Imported “" + file.name + "”", "success");
      } catch (e) {
        toast("Import failed: " + e.message, "error", 5000);
      }
    }
  };
  $("#ntImportFile")?.addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  let debounce = null;
  $("#ntSearchInput")?.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { notesState.q = e.target.value; redraw(); }, 140);
  });
  $("#ntProjFilter")?.addEventListener("change", (e) => { notesState.project = e.target.value; redraw(); });
  document.querySelectorAll("[data-nt-open]").forEach((b) => b.addEventListener("click", () => {
    const n = store.get("note", b.dataset.ntOpen);
    if (n) openNoteEditor(store, { note: n });
  }));
  document.querySelectorAll("[data-nt-pin]").forEach((b) => b.addEventListener("click", () => {
    const n = store.get("note", b.dataset.ntPin);
    if (n) togglePin(store, n);
  }));
  document.querySelectorAll("[data-nt-dl]").forEach((b) => b.addEventListener("click", () => {
    const n = store.get("note", b.dataset.ntDl);
    if (!n) return;
    downloadText(n.title + ".txt", n.title + "\n\n" + (n.body || ""));
    toast("Downloaded “" + n.title + ".txt”", "success");
  }));
  document.querySelectorAll("[data-nt-del]").forEach((b) => b.addEventListener("click", async () => {
    const n = store.get("note", b.dataset.ntDel);
    if (!n) return;
    const sure = await confirmDialog({ title: "Delete note?", message: "“" + n.title + "” will be permanently removed.", confirmText: "Delete note", danger: true });
    if (!sure) return;
    store.remove("note", n.id);
    toast("Note deleted", "success");
  }));
}

// ── export / import helpers ──────────────────────────────────────
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function loadMammoth() {
  if (window.mammoth) return window.mammoth;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
    s.onload = res;
    s.onerror = () => rej(new Error("couldn't load the .docx reader (mammoth) — check your connection"));
    document.head.appendChild(s);
  });
  return window.mammoth;
}

export async function importDocx(file) {
  const mammoth = await loadMammoth();
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const html = result.value || "";
  // crude HTML → plain text: paragraphs become newlines, inline tags dropped.
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .split("\n").map((l) => l.trim()).filter((l) => l).join("\n");
}

// Best-effort text extraction from legacy binary .doc files. The Word binary
// format stores text as runs of printable characters separated by control
// bytes; newer .doc files store UTF-16LE. We try both and keep the richer one.
export async function importDoc(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const latin = extractRuns(buf, false);
  const utf16 = extractRuns(buf, true);
  const better = utf16.length > latin.length ? utf16 : latin;
  if (!better.trim()) throw new Error("no readable text found in this .doc file");
  return better;
}

function extractRuns(buf, utf16) {
  const out = [];
  let run = "";
  const push = () => { if (run.trim().length >= 3) out.push(run.trim()); run = ""; };
  if (utf16) {
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const code = buf[i] | (buf[i + 1] << 8);
      const ch = String.fromCharCode(code);
      if (code >= 0x20 && code <= 0x7e || code >= 0xa0 && code !== 0xffff && !isControl(code)) run += ch;
      else push();
    }
  } else {
    for (let i = 0; i < buf.length; i++) {
      const code = buf[i];
      if (code >= 0x20 && code <= 0x7e || code >= 0xa0) run += String.fromCharCode(code);
      else push();
    }
  }
  push();
  return out.join("\n");
}
function isControl(c) { return (c >= 0 && c < 0x20) || (c >= 0x7f && c < 0xa0); }
