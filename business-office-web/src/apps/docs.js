// ============================================================================
//  DOCUMENTS APP (.docx) — rich-text editor (T4)
//
//  A real editor surface: a formatting toolbar (bold / italic / underline), a
//  contenteditable page, a live word & character count, and a "clean output"
//  pane that shows the exact Markdown and clean HTML produced by the document
//  model (src/richtext.js). The document is stored in the registry as
//  Markdown, so it survives reloads and is easy to export later (T5).
// ============================================================================

import { RichText } from "../richtext.js";
import { documentRegistry } from "../registry.js";
import { exportDocument } from "../export.js";
import { documentTemplates, findTemplate } from "../templates.js";
import { selectionOffsets, setSelectionAt } from "../domedit.js";

const DOCS_GLYPH = `<svg viewBox="0 0 24 24"><path fill="#fff" d="M6.2 3.2h7.3l5.3 5.3v11.1a1.7 1.7 0 0 1-1.7 1.7H6.2A1.7 1.7 0 0 1 4.5 19.6V4.9a1.7 1.7 0 0 1 1.7-1.7Z"/><path fill="none" stroke="rgba(25,45,85,.42)" stroke-width="1.3" stroke-linecap="round" d="M9.3 9h5.3M9.3 12h5.3M9.3 15h3.3"/></svg>`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function editorHTML(ctx) {
  const name = ctx.doc ? ctx.doc.meta.name || "Untitled Documents" : "Untitled Documents";
  return `
  <div class="docs-app">
    <div class="doc-toolbar">
      <span class="doc-brand">${DOCS_GLYPH}</span>
      <div class="doc-fmt-group" role="toolbar" aria-label="Text formatting">
        <button type="button" class="doc-fmt-btn" data-fmt="b" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
        <button type="button" class="doc-fmt-btn" data-fmt="i" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
        <button type="button" class="doc-fmt-btn" data-fmt="u" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
      </div>
      <select class="doc-template-select" aria-label="Insert template" title="Load a pre-made document template (replaces the current document)">
        <option value="" selected>Templates…</option>
        ${documentTemplates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}
      </select>
      <span class="doc-name">${esc(name)}</span>
      <span class="doc-spacer"></span>
      <div class="doc-view-group" role="group" aria-label="View">
        <button type="button" class="doc-view-btn active" data-view="doc">Document</button>
        <button type="button" class="doc-view-btn" data-view="md">Markdown</button>
        <button type="button" class="doc-view-btn" data-view="html">HTML</button>
      </div>
      <div class="doc-export-group" role="group" aria-label="Export">
        <span class="doc-export-label">Export</span>
        <button type="button" class="doc-export-btn" data-ext="html" title="Download as .html">HTML</button>
        <button type="button" class="doc-export-btn" data-ext="txt" title="Download as .txt">TXT</button>
      </div>
    </div>
    <div class="doc-canvas">
      <div class="doc-page" contenteditable="true" spellcheck="false" data-placeholder="Start writing — your document is saved as you type…"></div>
    </div>
    <div class="doc-out" hidden>
      <div class="doc-out-head">
        <span class="doc-out-label">Markdown</span>
        <span class="doc-out-sub">clean output — regenerated from the document model</span>
        <button type="button" class="doc-out-copy">Copy</button>
      </div>
      <pre class="doc-out-pre"></pre>
    </div>
    <div class="doc-status">
      <span class="doc-stat doc-stat-words">0 words</span>
      <span class="doc-stat doc-stat-chars">0 characters</span>
      <span class="doc-stat doc-stat-clean">clean HTML + Markdown</span>
    </div>
  </div>`;
}

export function mountDocs(zone, ctx) {
  const doc = ctx.doc || null;
  zone.innerHTML = editorHTML({ doc });
  const rootEl = zone.querySelector(".docs-app");

  const page = zone.querySelector(".doc-page");
  const wordsEl = zone.querySelector(".doc-stat-words");
  const charsEl = zone.querySelector(".doc-stat-chars");
  const outPane = zone.querySelector(".doc-out");
  const outLabel = zone.querySelector(".doc-out-label");
  const outPre = zone.querySelector(".doc-out-pre");
  const copyBtn = zone.querySelector(".doc-out-copy");

  let model = RichText.fromMarkdown(doc ? doc.content : "");

  const renderPage = () => {
    if (model.isEmpty()) {
      page.innerHTML = "";
      page.classList.add("is-empty");
    } else {
      page.innerHTML = model.getHTML();
      page.classList.remove("is-empty");
    }
  };

  const sync = () => {
    if (!doc) return;
    documentRegistry.update(doc.id, { content: model.getMarkdown() });
  };

  const updateStatus = () => {
    const w = model.wordCount();
    const c = model.charCount();
    wordsEl.textContent = w + " word" + (w === 1 ? "" : "s");
    charsEl.textContent = c + " character" + (c === 1 ? "" : "s");
  };

  const fmtAtSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { b: false, i: false, u: false };
    let el = sel.anchorNode;
    if (!el || !el.parentElement) return { b: false, i: false, u: false };
    if (el.nodeType === 3) el = el.parentElement;
    const f = { b: false, i: false, u: false };
    while (el && el !== rootEl) {
      const t = el.tagName;
      if (t === "STRONG" || t === "B") f.b = true;
      else if (t === "EM" || t === "I") f.i = true;
      else if (t === "U") f.u = true;
      el = el.parentElement;
    }
    return f;
  };

  const updateFmtButtons = () => {
    const f = fmtAtSelection();
    zone.querySelectorAll(".doc-fmt-btn").forEach((btn) => {
      btn.classList.toggle("on", !!f[btn.dataset.fmt]);
    });
  };

  const onInput = () => {
    model = RichText.fromHTML(page.innerHTML);
    page.classList.toggle("is-empty", model.isEmpty());
    updateStatus();
    sync();
  };

  const onFmtClick = (fmt) => {
    const { start, end } = selectionOffsets(page);
    if (start >= end) {
      updateFmtButtons();
      return;
    }
    model.applyFormat(start, end, fmt);
    renderPage();
    setSelectionAt(page, start, end);
    updateStatus();
    sync();
  };

  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === "b" || k === "i" || k === "u")) {
      e.preventDefault();
      onFmtClick(k);
    }
  };

  const onSelectionChange = () => {
    const sel = window.getSelection();
    if (sel && sel.anchorNode && page.contains(sel.anchorNode)) updateFmtButtons();
  };

  const onViewClick = (v) => {
    zone.querySelectorAll(".doc-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    if (v === "doc") {
      model = RichText.fromHTML(page.innerHTML);
      renderPage();
      updateStatus();
      sync();
      outPane.hidden = true;
      page.hidden = false;
    } else {
      model = RichText.fromHTML(page.innerHTML);
      sync();
      outLabel.textContent = v === "md" ? "Markdown" : "HTML";
      outPre.textContent = v === "md" ? model.getMarkdown() : model.getHTML();
      page.hidden = true;
      outPane.hidden = false;
    }
  };

  const onCopy = () => {
    const text = outPre.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  const onExport = (ext) => {
    model = RichText.fromHTML(page.innerHTML);
    updateStatus();
    sync();
    const title = (doc && doc.meta && doc.meta.name) || "Untitled Documents";
    exportDocument(model, { title, format: ext });
  };

  const templateSel = zone.querySelector(".doc-template-select");
  const onTemplateChange = () => {
    const id = templateSel.value;
    templateSel.value = "";
    if (!id) return;
    const tpl = findTemplate(id);
    if (!tpl) return;
    if (!model.isEmpty() && !window.confirm(`Load the "${tpl.name}" template? This replaces the current document.`)) return;
    model = RichText.fromMarkdown(tpl.content);
    renderPage();
    updateStatus();
    sync();
  };

  renderPage();
  updateStatus();

  zone.querySelectorAll(".doc-fmt-btn").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => onFmtClick(btn.dataset.fmt));
  });
  page.addEventListener("input", onInput);
  page.addEventListener("keydown", onKey);
  document.addEventListener("selectionchange", onSelectionChange);
  zone.querySelectorAll(".doc-view-btn").forEach((b) => b.addEventListener("click", () => onViewClick(b.dataset.view)));
  zone.querySelectorAll(".doc-export-btn").forEach((b) => b.addEventListener("click", () => onExport(b.dataset.ext)));
  copyBtn.addEventListener("click", onCopy);
  templateSel.addEventListener("change", onTemplateChange);

  return () => {
    document.removeEventListener("selectionchange", onSelectionChange);
  };
}

export const docsApp = {
  key: "docs",
  roadTitle: "Documents build",
  roadmap: [
    "Rich-text editing surface with a real toolbar (bold, headings, lists)",
    "Page metaphor — margins, fonts, line spacing, alignment",
    "Document state model + save/load per user via kv-plugin",
    "Open .docx-style samples & templates from the start page (toolbar Templates menu is live)",
    "Search & replace, live word count",
    "Print & download (HTML→PDF) so files leave the suite",
  ],
  workspaceNote:
    "Rich-text editing is live — bold / italic / underline, live word count, clean HTML + Markdown output, HTML/TXT export (T5), and a Templates menu with four one-click business documents (T6). The page metaphor lands next.",
  mountFile: "src/apps/docs.js",
  hasSurface: true,
  mount: mountDocs,
  seedHints: [
    "Toolbar commands drive the RichText model in src/richtext.js, never the raw DOM",
    "The registry holds the doc as Markdown — export (T5) writes files from there, templates (T6) load into it",
  ],
};
