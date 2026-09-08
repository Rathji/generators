// src/modules/shared.js — shared view scaffolding + article-rendering helpers
// used across every module: view panels, breadcrumbs, time/date formatting,
// status badges, article rows for lists, category flattening, and a small
// promise-based confirm dialog.

import { h, esc } from "../framework/dom.js";
import { icons } from "../framework/icons.js";

export function viewPanel({ crumb = "", title, desc = "", body = null, actions = null } = {}) {
  return h(
    "div",
    { class: "kb-view" },
    h(
      "header",
      { class: "kb-view-head" },
      crumb ? h("div", { class: "kb-breadcrumb" }, crumb) : null,
      h(
        "div",
        { class: "kb-view-title-row" },
        h("h1", { class: "kb-view-title" }, title),
        actions || null,
      ),
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

export const STATUS_LABELS = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  archived: "Archived",
};

export function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  return h("span", { class: "kb-badge kb-badge-" + (status || "draft") }, label);
}

export function docTypePill(dt) {
  return h("span", { class: "kb-doctype" }, (dt || "").toUpperCase());
}

// A clickable article row used by browse / search / review / stale lists.
export function articleRow(ctx, article, opts = {}) {
  const { showStatus = true, snippet = null, metaRight = null, actions = null, body = null } = opts;
  const a = article || {};
  const row = h(
    "article",
    { class: "kb-article-row" },
    h(
      "a",
      { class: "kb-article-row-main", href: "#/article/" + encodeURIComponent(a.id) },
      h(
        "div",
        { class: "kb-article-row-titleline" },
        h("h3", { class: "kb-article-row-title" }, a.title || "Untitled"),
        showStatus ? statusBadge(a.status) : null,
        docTypePill(a.docType),
      ),
      a.summary
        ? h("p", { class: "kb-article-row-summary" }, String(a.summary).slice(0, 220) + (a.summary.length > 220 ? "…" : ""))
        : null,
      snippet ? h("div", { class: "kb-article-row-snippet", html: snippet }) : null,
      body ? body : null,
      h(
        "div",
        { class: "kb-article-row-meta" },
        h("span", null, "Updated " + relTime(a.updated && a.updated.at)),
        a.owner ? h("span", null, "Owner: " + esc(a.owner)) : null,
        h("span", null, "v" + (opts.version != null ? opts.version : (a.publishedVersion || a.versions ? (a.versions || []).length : 0))),
        a.views ? h("span", null, a.views + " views") : null,
        metaRight,
      ),
    ),
    actions ? h("div", { class: "kb-article-row-actions" }, actions) : null,
  );
  return row;
}

export function breadcrumbs(parts) {
  return h(
    "div",
    { class: "kb-breadcrumb" },
    parts.map((p, i) => (i === parts.length - 1 ? h("span", { class: "kb-bc-current" }, p) : h("span", null, p + " / "))),
  );
}

export function flattenTree(tree, depth = 0, out = []) {
  for (const n of tree || []) {
    out.push({ id: n.id, label: n.label, depth, children: (n.children || []).length });
    if (n.children && n.children.length) flattenTree(n.children, depth + 1, out);
  }
  return out;
}

export function findCat(nodes, id) {
  for (const n of nodes || []) {
    if (n.id === id) return n;
    if (n.children && n.children.length) {
      const f = findCat(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function catPathStr(tree, id) {
  const path = [];
  const walk = (nodes, acc) => {
    for (const n of nodes || []) {
      if (n.id === id) {
        path.push(...acc, n.label);
        return true;
      }
      if (n.children && walk(n.children, [...acc, n.label])) return true;
    }
    return false;
  };
  walk(tree, []);
  return path.join(" / ") || "Uncategorized";
}

// Category <select> options from a tree (indented, with a root option).
export function categoryOptions(tree, current) {
  const opts = [h("option", { value: "" }, "Uncategorized")];
  for (const f of flattenTree(tree)) {
    opts.push(
      h(
        "option",
        { value: f.id, selected: f.id === current ? true : null },
        "—".repeat(f.depth) + (f.depth ? " " : "") + f.label,
      ),
    );
  }
  return opts;
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
    document.body.append(overlay);
    okBtn.focus();
  });
}

// A small inline prompt panel (used for return-with-comment and other flows).
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
    document.body.append(overlay);
    input.focus();
  });
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
