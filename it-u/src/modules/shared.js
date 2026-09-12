// src/modules/shared.js — shared view scaffolding and small UI helpers used
// across every station: the standard view panel, time/byte formatting, the
// breadcrumb bar, and a set of promise-based dialogs (no native dialogs — they
// block the preview).

import { h } from "../framework/dom.js";

// The standard station view: an optional breadcrumb, a title row (with optional
// right-aligned actions), an optional description, and the body.
export function viewPanel({ crumb = "", title, desc = "", body = null, actions = null } = {}) {
  return h(
    "div",
    { class: "kb-view" },
    h(
      "header",
      { class: "kb-view-head" },
      crumb ? h("div", { class: "kb-breadcrumb" }, crumb) : null,
      h("div", { class: "kb-view-title-row" }, h("h1", { class: "kb-view-title" }, title), actions || null),
      desc ? h("p", { class: "kb-view-desc" }, desc) : null,
    ),
    body || null,
  );
}

export const relTime = (ts) => {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min ago";
  const hr = Math.round(m / 60);
  if (hr < 48) return hr + " h ago";
  return Math.round(hr / 24) + " d ago";
};

export const fmtDate = (ts) => {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const fmtBytes = (n) => {
  if (n == null) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
};

export function breadcrumbs(parts) {
  return h(
    "div",
    { class: "kb-breadcrumb" },
    parts.map((p, i) => (i === parts.length - 1 ? h("span", { class: "kb-bc-current" }, p) : h("span", null, p + " / "))),
  );
}

// Promise-based confirm modal (no native dialogs — they block the preview).
export function confirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "kb-modal-overlay" });
    const box = h(
      "div",
      { class: "kb-modal", role: "dialog", "aria-modal": "true" },
      h("h3", { class: "kb-modal-title" }, title),
      message ? h("p", { class: "kb-modal-text" }, message) : null,
      h(
        "div",
        { class: "kb-modal-actions" },
        h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Cancel"),
        h("button", { class: "kb-btn" + (danger ? " kb-btn-danger" : " kb-btn-primary"), type: "button" }, confirmLabel),
      ),
    );
    const [cancelBtn, okBtn] = box.querySelectorAll("button");
    const close = (val) => {
      overlay.remove();
      resolve(val);
    };
    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener("keydown", function escHandler(ev) {
      if (ev.key === "Escape") {
        document.removeEventListener("keydown", escHandler);
        close(false);
      }
    });
    overlay.append(box);
    document.body.append(overlay);
    okBtn.focus();
  });
}

// A small inline prompt panel (used for short free-text prompts).
export function promptPanel({ title = "", placeholder = "", confirmLabel = "OK", initial = "" }) {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "kb-modal-overlay" });
    const input = h("textarea", { class: "kb-input", rows: 3, placeholder });
    input.value = initial;
    const box = h(
      "div",
      { class: "kb-modal", role: "dialog", "aria-modal": "true" },
      h("h3", { class: "kb-modal-title" }, title),
      input,
      h(
        "div",
        { class: "kb-modal-actions" },
        h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Cancel"),
        h("button", { class: "kb-btn kb-btn-primary", type: "button" }, confirmLabel),
      ),
    );
    const [cancelBtn, okBtn] = box.querySelectorAll("button");
    const close = (val) => {
      overlay.remove();
      resolve(val);
    };
    cancelBtn.addEventListener("click", () => close(null));
    okBtn.addEventListener("click", () => close(input.value.trim()));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
  });
}

// A general modal panel (no native dialogs — they block the preview). Returns
// the overlay, an actions row to append buttons to, and error helpers.
export function openModal({ title = "", description = "", children = [], wide = false } = {}) {
  const errEl = h("div", { class: "kb-form-error", hidden: true });
  const actions = h("div", { class: "kb-modal-actions" });
  const box = h(
    "div",
    { class: "kb-modal" + (wide ? " kb-modal-wide" : ""), role: "dialog", "aria-modal": "true" },
    h("h3", { class: "kb-modal-title" }, title),
    description ? h("p", { class: "kb-modal-text" }, description) : null,
    ...children,
    errEl,
    actions,
  );
  const overlay = h("div", { class: "kb-modal-overlay" }, box);
  const close = () => {
    document.removeEventListener("keydown", esc);
    overlay.remove();
  };
  const esc = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", esc);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  return {
    overlay,
    actions,
    close,
    showError: (msg) => {
      errEl.hidden = false;
      errEl.textContent = msg;
    },
    clearError: () => {
      errEl.hidden = true;
      errEl.textContent = "";
    },
  };
}

export function copyText(text, toast) {
  const done = () => toast && toast("Link copied", "success");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      toast && toast("Copy failed — link: " + text, "warning", 5200);
    }
    ta.remove();
  }
}

// Build a CSV string from rows (array of arrays) and trigger a download.
export function downloadCsv(filename, rows) {
  const csv = rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c == null ? "" : c);
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Trigger a download of a text file (Markdown, JSON, plain text, …).
export function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text == null ? "" : String(text)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
