// src/ui.js — shared UI primitives: toasts, modals, confirm dialogs
// (Roadmap tasks 14 & 15). Used by every view and the palette.
//
// pm-u integration: toasts are delegated to the template-u toaster (so PM-U
// has ONE notification channel, styled by the active theme) via setToaster(),
// and modals mount into the template-u shell's #puModalRoot host instead of the
// old project-master #modalRoot. Falls back gracefully if neither is present.

import { ICONS } from "./icons.js";

export const $ = (sel) => document.querySelector(sel);

// Display strings for generated artifacts (exports, the document title, AI
// personas). Read the live PM-U branding so rebranding main.pjs propagates.
export function appTitle() {
  const t = globalThis.pm && globalThis.pm.appTitle;
  return (typeof t === "string" && t.trim()) || "PM-U";
}
export function appSlug() {
  const s = globalThis.generatorName;
  return (typeof s === "string" && s.trim()) || "pm-u";
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── toasts ───────────────────────────────────────────────────────
// Delegated to the template-u toaster (set by app.js). The legacy DOM fallback
// (a #toasts stack) is kept only for standalone use / unit tests.
let toaster = null;
export function setToaster(t) { toaster = t; }

const TOAST_TYPES = { info: "info", success: "success", error: "error", warning: "warning" };

export function toast(msg, variant = "info", ms = 3500) {
  if (toaster && typeof toaster.show === "function") {
    toaster.show(String(msg), { type: TOAST_TYPES[variant] || "info", duration: ms });
    return;
  }
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

// notify(...) — the richer template-u channel: a titled toast with an optional
// action button (used by the Focus timer, e.g. "Start break now"). Returns the
// toaster's handle ({ id, el, dismiss }) or null when unavailable.
export function notify(message, { variant = "info", title = "", ms = 4200, action = null } = {}) {
  if (toaster && typeof toaster.show === "function") {
    return toaster.show(String(message), { type: TOAST_TYPES[variant] || "info", title, duration: ms, action });
  }
  toast(message, variant, ms);
  return null;
}

// ── modals ───────────────────────────────────────────────────────
// openModal(html) mounts a `.modal-backdrop` with the given inner HTML into
// the template-u modal host (#puModalRoot); returns { el, close }. Close on
// overlay click / Escape / [data-x].
function modalHost() {
  let root = $("#puModalRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "puModalRoot";
    document.body.appendChild(root);
  }
  return root;
}

// `content` may be an HTML string (legacy view code) or a ready-made DOM Node
// (the template-u input-suite path — see src/pm/formkit.js). `options.onClose`
// runs on every close path (X / Escape / backdrop / programmatic).
export function openModal(content, options = {}) {
  const root = modalHost();
  if (!root) return { el: null, close: () => {} };
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  if (content instanceof Node) wrap.appendChild(content);
  else wrap.innerHTML = String(content == null ? "" : content);
  root.appendChild(wrap);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    wrap.remove();
    if (typeof options.onClose === "function") options.onClose();
  };
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
