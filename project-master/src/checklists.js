// src/checklists.js — Checklists view (Roadmap Phase 5: tasks 38–42).
//
//  38: multiple checklists — each is its own record; the view shows a card grid
//  39: inline item management — add / check / uncheck / delete items in place
//  40: checklist rename / delete
//  41: per-card progress bar (done/total) on every card
//  42: 6 built-in templates offered when creating a new checklist
//
// Records: {type:"checklist", id, name, items:[{id,text,done}], template, created}
// Pure helpers (templates, checklistStats, item mutations) covered by
// runPhase5Tests().

import { $, esc, toast, confirmDialog, openModal } from "./ui.js";
import { ICONS } from "./icons.js";
import { uid } from "./store.js";

export const CHECKLIST_TEMPLATES = [
  { id: "weekly-reset", name: "Weekly reset", items: ["Clear email inbox", "Review calendar for next week", "Plan the week's top 3 goals", "Tidy workspace / desktop", "Review budget & expenses"] },
  { id: "trip", name: "Pack for a trip", items: ["Clothes for each day", "Toiletries kit", "Chargers & power bank", "Passport / ID / tickets", "Medication", "Snacks for the journey"] },
  { id: "moving", name: "Moving house", items: ["Notify utilities & providers", "File change of address", "Book movers / van", "Pack an essentials box", "Clean the old place"] },
  { id: "launch", name: "Product launch", items: ["Final QA pass", "Confirm pricing", "Prepare marketing assets", "Landing page live", "Announce to audience"] },
  { id: "standup", name: "Daily standup", items: ["What I did yesterday", "Today's top priorities", "Blockers & risks", "Team updates needed"] },
  { id: "grocery", name: "Grocery run", items: ["Fresh produce", "Dairy & eggs", "Grains & bread", "Protein", "Pantry staples"] },
];

export function templateById(id) {
  return CHECKLIST_TEMPLATES.find((t) => t.id === id) || null;
}

// Pure summary for a checklist record.
export function checklistStats(cl) {
  const items = Array.isArray(cl && cl.items) ? cl.items : [];
  return { total: items.length, done: items.filter((i) => i.done).length };
}

// ── item mutations (pure-ish: store in / out) ────────────────────
export function addItem(store, clId, text) {
  const cl = store.get("checklist", clId);
  const t = String(text || "").trim();
  if (!cl || !t) return null;
  const item = { id: uid(), text: t, done: false };
  store.upsert("checklist", clId, { items: [...(cl.items || []), item] });
  return item;
}
export function toggleItem(store, clId, itemId) {
  const cl = store.get("checklist", clId);
  if (!cl) return;
  store.upsert("checklist", clId, { items: (cl.items || []).map((i) => (i.id === itemId ? Object.assign({}, i, { done: !i.done }) : i)) });
}
export function removeItem(store, clId, itemId) {
  const cl = store.get("checklist", clId);
  if (!cl) return;
  store.upsert("checklist", clId, { items: (cl.items || []).filter((i) => i.id !== itemId) });
}
export function renameChecklist(store, clId, name) {
  const cl = store.get("checklist", clId);
  if (!cl) return;
  const n = String(name || "").trim();
  if (!n) return;
  store.upsert("checklist", clId, { name: n });
}

export function checklistCardHTML(store, cl) {
  const s = checklistStats(cl);
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const items = (cl.items || []).map((i) => `
    <div class="cl-item${i.done ? " done" : ""}" data-clitem="${esc(i.id)}">
      <button class="mini-btn cl-done${i.done ? " on" : ""}" data-cl-done="${esc(i.id)}" title="${i.done ? "Mark open" : "Mark done"}">${ICONS.check}</button>
      <span class="cl-text">${esc(i.text)}</span>
      <button class="mini-btn danger" data-cl-del="${esc(i.id)}" title="Remove item">${ICONS.x}</button>
    </div>`).join("");
  return `
    <div class="cl-card" data-clid="${cl.id}">
      <div class="cl-head">
        <h3 data-cl-rename="${cl.id}" title="Click to rename">${esc(cl.name)}</h3>
        <button class="mini-btn danger" data-cl-delete="${cl.id}" title="Delete checklist">${ICONS.trash}</button>
      </div>
      <div class="progress-row">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-pct">${s.done}/${s.total} · ${pct}%</span>
      </div>
      <div class="cl-items">${items || `<div class="ws-empty">Empty — add your first item below.</div>`}</div>
      <div class="cl-add">
        <input type="text" data-cl-addinput placeholder="Add an item…" maxlength="160">
        <button class="btn" data-cl-addbtn title="Add item">${ICONS.plus}</button>
      </div>
    </div>`;
}

export function checklistsViewHTML(store) {
  const all = store.all("checklist");
  const cards = all.map((cl) => checklistCardHTML(store, cl)).join("") ||
    `<div class="proj-empty">${ICONS.checkSquare}<h2>No checklists yet</h2><p>Create one from a template or start blank.</p></div>`;
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.checkSquare}</span> Checklists</h1><p class="sub">${all.length} checklist${all.length === 1 ? "" : "s"} · templates make it fast to start</p></div>
        <div class="ws-actions">
          <button class="btn" id="clExportBtn" title="Export all checklists as Markdown">${ICONS.download} Export .md</button>
          <button class="btn btn-primary" id="clNewBtn">${ICONS.plus} New checklist</button>
        </div>
      </div>
    </div>
    <div class="cl-grid">${cards}</div>`;
}

export function newChecklistModal(store, ctx) {
  const { el, close } = openModal(`
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="New checklist">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>New checklist</h3>
      <p class="modal-sub">Start from a template or with a blank list.</p>
      <div class="field"><label for="clNameInput">Name *</label><input type="text" id="clNameInput" placeholder="e.g. Pack for Berlin" maxlength="80"></div>
      <div class="field"><label>Or use a template</label>
        <div class="cl-tpl-grid">
          ${CHECKLIST_TEMPLATES.map((t) => `<button class="cl-tpl" data-tpl="${t.id}"><b>${esc(t.name)}</b><span>${t.items.length} items</span></button>`).join("")}
        </div>
      </div>
      <div class="modal-btns">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="clCreateBtn">${ICONS.plus} Create</button>
      </div>
    </div>`);
  let chosenTpl = "";
  el.querySelectorAll(".cl-tpl").forEach((b) => b.addEventListener("click", () => {
    chosenTpl = b.dataset.tpl;
    el.querySelectorAll(".cl-tpl").forEach((x) => x.classList.toggle("sel", x === b));
  }));
  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("#clCreateBtn")?.addEventListener("click", () => {
    const name = (el.querySelector("#clNameInput")?.value || "").trim();
    const tpl = templateById(chosenTpl);
    const finalName = name || (tpl ? tpl.name : "Untitled checklist");
    store.create("checklist", { name: finalName, items: tpl ? tpl.items.map((text) => ({ id: uid(), text, done: false })) : [], template: chosenTpl || "" });
    toast("Checklist created", "success");
    close();
    ctx.render();
  });
  setTimeout(() => { const t = el.querySelector("#clNameInput"); if (t) t.focus(); }, 30);
  return { el, close };
}

export function wireChecklistsView(store, ctx) {
  const redraw = () => ctx.render && ctx.render();
  $("#clExportBtn")?.addEventListener("click", () => {
    import("./exports.js").then((X) => { X.downloadChecklistsMD(store); toast("Checklists exported as Markdown — check your downloads", "success"); });
  });
  $("#clNewBtn")?.addEventListener("click", () => newChecklistModal(store, { render: redraw }));
  const bindCard = (card) => {
    const id = card.dataset.clid;
    const cl = store.get("checklist", id);
    if (!cl) return;
    const input = card.querySelector("[data-cl-addinput]");
    const add = () => {
      const t = (input?.value || "").trim();
      if (!t) return;
      addItem(store, id, t);
      input.value = "";
    };
    card.querySelector("[data-cl-addbtn]")?.addEventListener("click", add);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    card.querySelectorAll("[data-cl-done]").forEach((b) => b.addEventListener("click", () => toggleItem(store, id, b.dataset.clDone)));
    card.querySelectorAll("[data-cl-del]").forEach((b) => b.addEventListener("click", () => removeItem(store, id, b.dataset.clDel)));
    card.querySelector("[data-cl-rename]")?.addEventListener("click", async () => {
      const name = await promptModal("Rename checklist", "Name", cl.name);
      if (name) { renameChecklist(store, id, name); toast("Renamed", "success"); }
    });
    card.querySelector("[data-cl-delete]")?.addEventListener("click", async () => {
      const sure = await confirmDialog({ title: "Delete checklist?", message: "“" + cl.name + "” and its items will be permanently removed.", confirmText: "Delete checklist", danger: true });
      if (!sure) return;
      store.remove("checklist", id);
      toast("Checklist deleted", "success");
    });
  };
  document.querySelectorAll(".cl-card").forEach(bindCard);
}

// Small reusable "prompt" modal (used for rename flows across views).
export function promptModal(title, label, initial = "") {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
        <h3>${esc(title)}</h3>
        <div class="field" style="margin-top:10px;"><label for="promptInput">${esc(label)}</label><input type="text" id="promptInput" value="${esc(initial)}" maxlength="160"></div>
        <div class="modal-btns">
          <button class="btn" data-cancel>Cancel</button>
          <button class="btn btn-primary" data-ok>Save</button>
        </div>
      </div>`);
    const input = el.querySelector("#promptInput");
    const finish = (val) => { close(); resolve(val); };
    el.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
    el.querySelector("[data-ok]")?.addEventListener("click", () => finish((input?.value || "").trim() || null));
    el.querySelector("[data-x]")?.addEventListener("click", () => finish(null));
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish((input.value || "").trim() || null); } });
    setTimeout(() => input?.focus(), 30);
  });
}
