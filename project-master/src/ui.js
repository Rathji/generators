// src/ui.js — shared UI primitives: toasts, modals, confirm dialogs
// (Roadmap tasks 14 & 15). Used by every view and the palette.

import { ICONS } from "./icons.js";

export const $ = (sel) => document.querySelector(sel);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── toasts ───────────────────────────────────────────────────────
// Stacked bottom-center, auto-dismiss (default 3.5s), click to dismiss,
// success/error/info variants, aria-live announcements.
export function toast(msg, variant = "info", ms = 3500) {
  const ctn = $("#toasts");
  if (!ctn) return;
  const t = document.createElement("div");
  t.className = "toast " + variant;
  t.textContent = msg;
  ctn.appendChild(t);
  const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 320); };
  t.addEventListener("click", kill);
  setTimeout(kill, ms);
}

// ── modals ───────────────────────────────────────────────────────
// openModal(html) mounts a `.modal-backdrop` with the given inner HTML into
// #modalRoot; returns { el, close }. Close on overlay click / Escape / [data-x].
export function openModal(html) {
  const root = $("#modalRoot");
  if (!root) return { el: null, close: () => {} };
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = html;
  root.appendChild(wrap);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  const close = () => { document.removeEventListener("keydown", onKey); wrap.remove(); };
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll("[data-x]").forEach((x) => x.addEventListener("click", close));
  return { el: wrap, close };
}

// confirmDialog(...) → Promise<boolean>. Reusable, route every destructive
// action through it. `danger` gives it destructive styling.
export function confirmDialog({ title, message = "", confirmText = "Confirm", cancelText = "Cancel", danger = false, html = "" } = {}) {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
        <h3>${esc(title)}</h3>
        <p class="modal-sub">${esc(message)}</p>
        ${html}
        <div class="modal-btns">
          <button class="btn" data-cancel>${esc(cancelText)}</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${esc(confirmText)}</button>
        </div>
      </div>`);
    const finish = (val) => { close(); resolve(val); };
    el.querySelector("[data-cancel]").addEventListener("click", () => finish(false));
    el.querySelector("[data-confirm]").addEventListener("click", () => finish(true));
    el.querySelector("[data-x]").addEventListener("click", () => finish(false));
    const first = el.querySelector("button:not([data-x]), input");
    if (first) first.focus();
  });
}
