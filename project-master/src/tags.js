// src/tags.js — Tag manager (Phase 11, task 87).
//
// Global tag list with per-tag colors (persisted in settings.tagColors),
// rename/merge and delete applied across every entity that carries tags,
// plus a manager view. All data helpers are pure and covered by
// runPhase11Tests.

import { $, esc, toast, confirmDialog } from "./ui.js";
import { ICONS } from "./icons.js";

const TAG_ENTITIES = ["task", "note"];
export const TAG_COLORS = ["#8b5cf6", "#22d3ee", "#ec4899", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#14b8a6", "#f97316", "#64748b"];

// ── pure data (tested) ───────────────────────────────────────────
// [{tag, count, color}] sorted by count desc, then name.
export function allTags(store) {
  const map = new Map();
  for (const type of TAG_ENTITIES) {
    for (const rec of store.all(type)) {
      for (const raw of rec.tags || []) {
        const t = String(raw).trim().toLowerCase();
        if (!t) continue;
        const e = map.get(t) || { tag: t, count: 0 };
        e.count++;
        map.set(t, e);
      }
    }
  }
  const colors = store.settings.tagColors || {};
  return [...map.values()].map((e) => ({ ...e, color: colors[e.tag] || null }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function setTagColor(store, tag, color) {
  const colors = Object.assign({}, store.settings.tagColors || {});
  colors[String(tag).trim().toLowerCase()] = color;
  store.setSetting("tagColors", colors);
}

// Color of a tag as shown on chips (case-insensitive lookup), or null.
export function tagColor(store, tag) {
  const colors = store.settings.tagColors || {};
  return colors[String(tag).trim().toLowerCase()] || null;
}

// Rename `old` → `neu` across every entity (also merges if `neu` already
// exists). Returns the number of records touched.
export function renameTag(store, old, neu) {
  const o = String(old).trim().toLowerCase();
  const n = String(neu).trim().toLowerCase();
  if (!o || !n || o === n) return 0;
  let touched = 0;
  for (const type of TAG_ENTITIES) {
    for (const rec of store.all(type)) {
      const raw = (rec.tags || []).map((x) => String(x).trim());
      if (!raw.some((x) => x.toLowerCase() === o)) continue;
      const next = raw.filter((x) => x.toLowerCase() !== o);
      if (!next.some((x) => x.toLowerCase() === n)) next.push(n);
      store.upsert(type, rec.id, { tags: next });
      touched++;
    }
  }
  const colors = Object.assign({}, store.settings.tagColors || {});
  if (colors[o] && !colors[n]) colors[n] = colors[o];
  delete colors[o];
  store.setSetting("tagColors", colors);
  return touched;
}

// Remove `tag` from every entity. Returns the number of records touched.
export function removeTag(store, tag) {
  const t = String(tag).trim().toLowerCase();
  let touched = 0;
  for (const type of TAG_ENTITIES) {
    for (const rec of store.all(type)) {
      const raw = (rec.tags || []).map((x) => String(x).trim());
      if (!raw.some((x) => x.toLowerCase() === t)) continue;
      store.upsert(type, rec.id, { tags: raw.filter((x) => x.toLowerCase() !== t) });
      touched++;
    }
  }
  const colors = Object.assign({}, store.settings.tagColors || {});
  delete colors[t];
  store.setSetting("tagColors", colors);
  return touched;
}

// ── view ─────────────────────────────────────────────────────────
export function tagsViewHTML(store) {
  const tags = allTags(store);
  const rows = tags.length
    ? tags.map((e) => `
      <div class="tm-row" data-tm="${esc(e.tag)}">
        <input type="color" class="tm-color" value="${e.color || "#8b5cf6"}" data-tm-color="${esc(e.tag)}" title="Tag color">
        <span class="tm-name" data-tm-edit="${esc(e.tag)}">${esc(e.tag)}</span>
        <span class="tm-count" title="Records using this tag">${e.count}</span>
        <button class="mini-btn" data-tm-rename title="Rename / merge this tag">${ICONS.pencil}</button>
        <button class="mini-btn danger" data-tm-del="${esc(e.tag)}" title="Remove tag from everything">${ICONS.trash}</button>
      </div>`).join("")
    : `<div class="proj-empty" style="padding:30px 10px;">${ICONS.tag}<h2>No tags yet</h2><p>Tags you add to tasks or notes show up here, where you can color them, rename them, or merge them.</p></div>`;
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.tag}</span> Tags</h1>
        <p class="sub">${tags.length} tag${tags.length === 1 ? "" : "s"} · colors apply to task & note chips · rename merges tags</p></div>
      </div>
    </div>
    <div class="card tm-card">
      ${rows}
      <p class="muted small" style="margin:12px 2px 0;">To add tags, edit a task or note and type them in its Tags field. Colors here are applied everywhere that tag appears.</p>
    </div>`;
}

export function wireTagsView(store, ctx) {
  document.querySelectorAll("[data-tm-color]").forEach((inp) => inp.addEventListener("input", () => {
    setTagColor(store, inp.dataset.tmColor, inp.value);
  }));
  document.querySelectorAll("[data-tm-del]").forEach((b) => b.addEventListener("click", async () => {
    const tag = b.dataset.tmDel;
    const sure = await confirmDialog({
      title: "Remove tag “" + tag + "”?",
      message: "The tag will be removed from every task and note that uses it. Nothing else is deleted.",
      confirmText: "Remove tag", danger: true,
    });
    if (!sure) return;
    removeTag(store, tag);
    toast("Tag removed", "success");
  }));
  document.querySelectorAll("[data-tm-rename]").forEach((b) => b.addEventListener("click", () => {
    const row = b.closest("[data-tm]");
    const nameEl = row.querySelector(".tm-name");
    if (row.classList.contains("editing")) { commitRename(row, nameEl, store); return; }
    row.classList.add("editing");
    const inp = document.createElement("input");
    inp.className = "tm-name-input";
    inp.value = nameEl.textContent;
    nameEl.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = () => commitRename(row, inp, store);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      else if (e.key === "Escape") { row.classList.remove("editing"); ctx.render(); }
    });
    inp.addEventListener("blur", commit);
  }));
}

function commitRename(row, inp, store) {
  if (!row || !inp) return;
  const oldTag = row.dataset.tm;
  const newTag = inp.value.trim().toLowerCase();
  row.classList.remove("editing");
  if (!newTag || newTag === oldTag) { ctxRenderFor(store); return; }
  renameTag(store, oldTag, newTag);
  toast("Tag renamed / merged", "success");
  ctxRenderFor(store);
}

// smallest render helper to avoid a circular import from app.js
function ctxRenderFor(store) {
  if (window.pm && window.pm.renderView) window.pm.renderView();
}
