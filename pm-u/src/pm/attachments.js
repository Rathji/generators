// src/attachments.js — File attachments (Phase 11, task 86).
//
// Files attach to tasks and notes and are stored locally as data URLs inside
// the record's `attachments` array — never uploaded anywhere. Images preview
// inline; other files download. All data helpers are pure and covered by
// runPhase11Tests.

import { esc, toast } from "./ui.js";
import { ICONS } from "./icons.js";
import { uid } from "./store.js";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB per file (kv-friendly)

export function attachmentsOf(rec) {
  return Array.isArray(rec && rec.attachments) ? rec.attachments : [];
}

// Pure add — UI wraps a File into a data URL first via fileToDataUrl.
export function attachData(store, type, id, { name, mime, size, dataUrl }) {
  const rec = store.get(type, id);
  if (!rec) return null;
  const att = attachmentsOf(rec).slice();
  const entry = { id: uid(), name: String(name || "file").slice(0, 120), mime: mime || "application/octet-stream", size: Number(size) || 0, dataUrl, added: Date.now() };
  att.push(entry);
  store.upsert(type, id, { attachments: att });
  return entry;
}

export function removeAttachment(store, type, id, attId) {
  const rec = store.get(type, id);
  if (!rec) return false;
  store.upsert(type, id, { attachments: attachmentsOf(rec).filter((a) => a.id !== attId) });
  return true;
}

export function isImage(mime) {
  return /^image\/(png|jpe?g|gif|webp|svg\+xml|svg|bmp|avif)/i.test(String(mime || ""));
}

export function fileSizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

export function attachmentHTML(att) {
  const body = isImage(att.mime)
    ? `<img class="at-thumb" src="${att.dataUrl}" alt="${esc(att.name)}" loading="lazy">`
    : `<span class="at-ico">${ICONS.file}</span>`;
  return `<div class="at-item" data-at="${att.id}">
    <a class="at-main" href="${att.dataUrl}" download="${esc(att.name)}" title="Download ${esc(att.name)}">${body}<span class="at-name">${esc(att.name)}</span></a>
    <span class="at-meta">${fileSizeLabel(att.size)}</span>
    <button class="mini-btn danger" data-at-del="${att.id}" title="Remove attachment">${ICONS.trash}</button>
  </div>`;
}

export function attachmentSectionHTML(store, type, id) {
  const rec = store.get(type, id);
  const atts = attachmentsOf(rec);
  const title = type === "note" ? "Note attachments" : "Task attachments";
  return `
    <div class="te-att-section" data-at-section>
      <label>${ICONS.paperclip} ${title}</label>
      <div class="at-list">
        ${atts.length ? atts.map((a) => attachmentHTML(a)).join("") : `<div class="at-empty">No attachments yet.</div>`}
      </div>
      <label class="at-add btn ghost">${ICONS.upload} Add file…
        <input type="file" multiple hidden>
      </label>
      <p class="muted small">Max 4 MB per file — stored locally in this browser, never uploaded.</p>
    </div>`;
}

// Wire the section inside a modal: re-renders the section on every change.
export function wireAttachmentSection(sectionEl, store, type, id) {
  const render = () => {
    const parent = sectionEl.parentNode;
    if (!parent) return;
    const next = document.createElement("div");
    next.innerHTML = attachmentSectionHTML(store, type, id);
    const fresh = next.firstElementChild;
    parent.replaceChild(fresh, sectionEl);
    wireAttachmentSection(fresh, store, type, id);
  };
  sectionEl.querySelectorAll("[data-at-del]").forEach((b) => b.addEventListener("click", () => {
    removeAttachment(store, type, id, b.dataset.atDel);
    render();
  }));
  const input = sectionEl.querySelector("input[type=file]");
  input?.addEventListener("change", async () => {
    for (const file of input.files || []) {
      if (file.size > MAX_FILE_BYTES) { toast(file.name + " is too large (max 4 MB)", "error"); continue; }
      let dataUrl;
      try { dataUrl = await fileToDataUrl(file); } catch { toast("Couldn't read " + file.name, "error"); continue; }
      attachData(store, type, id, { name: file.name, mime: file.type, size: file.size, dataUrl });
    }
    input.value = "";
    render();
  });
}

export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}
