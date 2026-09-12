// ============================================================================
//  SPREADSHEETS APP (.xlsx) — grid surface (T7) + live formulas (T8) + cell
//  formatting (T9)
//
//  A real, editable grid: a header row of column letters, a header column of
//  row numbers, and a 2D sheet of cells backed by the Grid model
//  (src/grid.js). Click a cell to select it, type (or use the fx bar) to edit,
//  arrows / Enter / Tab to move, double-click or F2 to edit in place. The
//  sheet is stored in the registry as sparse grid JSON, so it survives
//  reloads.
//
//  Formulas (T8, src/formula.js): a cell whose stored value starts with "=" is
//  evaluated against the grid — the fx bar and the model keep the raw "=…"
//  text, the cell displays the computed result, and every commit refreshes all
//  visible cells so dependent formulas ripple.
//
//  Cell formatting (T9, src/cellstyle.js): a second toolbar sets alignment,
//  fill color, font color, bold and italic per cell. Styles live in the
//  document's meta as sparse JSON — completely separate from the values in the
//  grid — so restyling never alters data.
// ============================================================================

import { Grid, rcToCell, indexToCol } from "../grid.js";
import { displayValue } from "../formula.js";
import { CellStyles } from "../cellstyle.js";
import { documentRegistry } from "../registry.js";

const SHEETS_GLYPH = `<svg viewBox="0 0 24 24"><path fill="#fff" d="M5 3.5h14A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z"/><path fill="none" stroke="rgba(25,45,85,.42)" stroke-width="1.2" d="M4 9.5h16M9.5 4v16M14.5 4v16"/></svg>`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** "42" -> 42, "3.5" -> 3.5, anything else stays a string. Spreadsheet-y typing. */
function coerceValue(raw) {
  const s = String(raw).trim();
  if (s === "") return "";
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
    const num = Number(s);
    if (isFinite(num)) return num;
  }
  return raw;
}

const MAX_ROWS = 100;
const MAX_COLS = 26;

const FILLS = ["", "#fff3cd", "#d4edda", "#d1e7f2", "#f8d7da", "#e2d9f3", "#ececec"];
const FONT_COLORS = ["", "#0a58ca", "#b02a37", "#1e7e34", "#8a6d00", "#6f42c1", "#333333"];

function swatchHTML(cls, prop, values) {
  return values
    .map((v) => {
      const label = v || (cls === "ss-fill" ? "No fill" : "Default text color");
      const bg = v ? " style=\"background:" + v + "\"" : "";
      return '<button type="button" class="ss-swatch ' + cls + (v ? "" : " ss-swatch-none") + '" data-' + (cls === "ss-fill" ? "bg" : "fg") + '="' + esc(v) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"' + bg + "></button>";
    })
    .join("");
}

function sheetsHTML(name) {
  return `
  <div class="sheets-app">
    <div class="ss-toolbar">
      <span class="ss-brand">${SHEETS_GLYPH}</span>
      <span class="ss-name">${esc(name)}</span>
      <span class="ss-spacer"></span>
      <span class="ss-selection">A1</span>
    </div>
    <div class="ss-fxbar">
      <span class="ss-fxlabel">fx</span>
      <input class="ss-fx-input" spellcheck="false" placeholder="Value of the selected cell — Enter to apply" aria-label="Formula bar">
    </div>
    <div class="ss-fmtbar">
      <div class="ss-fmt-group" role="group" aria-label="Text alignment">
        <button type="button" class="ss-fmt-btn ss-aln" data-align="left" title="Align left" aria-label="Align left">L</button>
        <button type="button" class="ss-fmt-btn ss-aln" data-align="center" title="Align center" aria-label="Align center">C</button>
        <button type="button" class="ss-fmt-btn ss-aln" data-align="right" title="Align right" aria-label="Align right">R</button>
      </div>
      <div class="ss-fmt-group" role="group" aria-label="Font style">
        <button type="button" class="ss-fmt-btn ss-fmt-tgl" data-fmt="bold" title="Bold" aria-label="Bold"><b>B</b></button>
        <button type="button" class="ss-fmt-btn ss-fmt-tgl" data-fmt="italic" title="Italic" aria-label="Italic"><i>I</i></button>
      </div>
      <div class="ss-fmt-group" role="group" aria-label="Fill color">
        <span class="ss-fmt-label">Fill</span>
        ${swatchHTML("ss-fill", "bg", FILLS)}
      </div>
      <div class="ss-fmt-group" role="group" aria-label="Font color">
        <span class="ss-fmt-label">Text</span>
        ${swatchHTML("ss-fg", "fg", FONT_COLORS)}
      </div>
      <span class="ss-spacer"></span>
      <button type="button" class="ss-fmt-clear" title="Clear formatting of the selected cell" aria-label="Clear formatting">Clear</button>
    </div>
    <div class="ss-gridwrap" tabindex="0">
      <div class="ss-sheet"></div>
    </div>
    <div class="ss-status">
      <span class="ss-stat ss-stat-cells">0 cells</span>
      <span class="ss-stat ss-stat-dims"></span>
      <span class="ss-stat ss-stat-hint">click a cell · type or use fx · = starts a formula</span>
    </div>
  </div>`;
}

export function mountSheets(zone, ctx) {
  const doc = ctx.doc || null;
  zone.innerHTML = sheetsHTML((doc && doc.meta && doc.meta.name) || "Untitled Spreadsheet");
  const sheet = zone.querySelector(".ss-sheet");
  const gridwrap = zone.querySelector(".ss-gridwrap");
  const fx = zone.querySelector(".ss-fx-input");
  const selLabel = zone.querySelector(".ss-selection");
  const cellsEl = zone.querySelector(".ss-stat-cells");
  const dimsEl = zone.querySelector(".ss-stat-dims");

  let model;
  try {
    model = doc && doc.content ? Grid.fromJSON(JSON.parse(doc.content)) : new Grid(40, 26);
  } catch {
    model = new Grid(40, 26);
  }
  if (model.rows === 0 || model.cols === 0) model = new Grid(40, 26);

  let styles;
  try {
    styles = CellStyles.fromJSON(doc && doc.meta && doc.meta.styles ? JSON.parse(doc.meta.styles) : null);
  } catch {
    styles = new CellStyles();
  }

  let sel = { row: 0, col: 0 };
  let editor = null;

  const cellEl = (r, c) => sheet.querySelector('.ss-cell[data-r="' + r + '"][data-c="' + c + '"]');

  const updateStatus = () => {
    const n = model.nonEmptyCount();
    cellsEl.textContent = n + " cell" + (n === 1 ? "" : "s");
    dimsEl.textContent = model.rows + " rows × " + model.cols + " cols";
  };

  const sync = () => {
    if (!doc) return;
    documentRegistry.update(doc.id, { content: JSON.stringify(model.toJSON()) });
  };

  const syncStyles = () => {
    if (!doc) return;
    documentRegistry.update(doc.id, { meta: { styles: JSON.stringify(styles.toJSON()) } });
  };

  const writeCell = (v) => {
    model.set(sel.row, sel.col, coerceValue(v));
    refreshAllCells();
    sync();
    updateStatus();
  };

  const applySelection = () => {
    sheet.querySelectorAll(".ss-cell.selected").forEach((el) => el.classList.remove("selected"));
    const el = cellEl(sel.row, sel.col);
    if (el) el.classList.add("selected");
  };

  const select = (row, col) => {
    sel = { row, col };
    applySelection();
    selLabel.textContent = rcToCell(row, col);
    const v = model.get(row, col);
    fx.value = v === "" ? "" : String(v);
    updateFmtState();
  };

  const cellDisplay = (r, c) => displayValue(model.get(r, c), (ref) => model.get(ref));

  const styleOf = (r, c) => styles.get(rcToCell(r, c));

  /** Inline style string for a cell, from its style record ("" when unstyled). */
  const cellCss = (r, c) => {
    const st = styleOf(r, c);
    let css = "";
    if (st.bg) css += "--bg:" + st.bg + ";";
    if (st.align) css += "text-align:" + st.align + ";";
    if (st.color) css += "color:" + st.color + ";";
    if (st.bold) css += "font-weight:700;";
    if (st.italic) css += "font-style:italic;";
    return css;
  };

  const refreshAllCells = () => {
    const cols = Math.min(model.cols, MAX_COLS);
    const els = sheet.querySelectorAll(".ss-cell");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const c = i % cols;
      const r = (i - c) / cols;
      const dv = cellDisplay(r, c);
      el.textContent = dv.value === "" ? "" : esc(String(dv.value));
      el.classList.toggle("num", dv.isNumber);
      el.style.cssText = cellCss(r, c);
    }
  };

  const render = () => {
    const rows = Math.min(model.rows, MAX_ROWS);
    const cols = Math.min(model.cols, MAX_COLS);
    sheet.style.gridTemplateColumns = "44px repeat(" + cols + ", 96px)";
    let html = '<div class="ss-corner"></div>';
    for (let c = 0; c < cols; c++) html += '<div class="ss-colhead">' + indexToCol(c) + "</div>";
    for (let r = 0; r < rows; r++) {
      html += '<div class="ss-rowhead">' + (r + 1) + "</div>";
      for (let c = 0; c < cols; c++) {
        const dv = cellDisplay(r, c);
        const css = cellCss(r, c);
        html += '<div class="ss-cell' + (dv.isNumber ? " num" : "") + '" style="' + css + '" data-r="' + r + '" data-c="' + c + '">' + (dv.value === "" ? "" : esc(String(dv.value))) + "</div>";
      }
    }
    sheet.innerHTML = html;
    applySelection();
  };

  const fmtbar = zone.querySelector(".ss-fmtbar");
  const fmtBtns = Array.from(zone.querySelectorAll(".ss-fmt-tgl"));
  const alnBtns = Array.from(zone.querySelectorAll(".ss-aln"));
  const fillSwatches = Array.from(zone.querySelectorAll(".ss-fill"));
  const fgSwatches = Array.from(zone.querySelectorAll(".ss-fg"));

  const updateFmtState = () => {
    const st = styleOf(sel.row, sel.col);
    for (const b of fmtBtns) b.classList.toggle("on", !!st[b.dataset.fmt]);
    for (const b of alnBtns) b.classList.toggle("active", st.align === b.dataset.align);
    for (const s of fillSwatches) s.classList.toggle("sel", (s.dataset.bg || "") === (st.bg || ""));
    for (const s of fgSwatches) s.classList.toggle("sel", (s.dataset.fg || "") === (st.color || ""));
  };

  const applyFmt = (props) => {
    styles.set(rcToCell(sel.row, sel.col), props);
    refreshAllCells();
    updateFmtState();
    syncStyles();
  };

  const clearFmt = () => {
    styles.clear(rcToCell(sel.row, sel.col));
    refreshAllCells();
    updateFmtState();
    syncStyles();
  };

  fmtbar.addEventListener("click", (e) => {
    const aln = e.target.closest(".ss-aln");
    if (aln) { applyFmt({ align: aln.dataset.align }); return; }
    const tgl = e.target.closest(".ss-fmt-tgl");
    if (tgl) {
      const f = tgl.dataset.fmt;
      applyFmt({ [f]: !styleOf(sel.row, sel.col)[f] });
      return;
    }
    const fill = e.target.closest(".ss-fill");
    if (fill) { applyFmt({ bg: fill.dataset.bg || null }); return; }
    const fg = e.target.closest(".ss-fg");
    if (fg) { applyFmt({ color: fg.dataset.fg || null }); return; }
    if (e.target.closest(".ss-fmt-clear")) clearFmt();
  });

  const closeEditor = () => {
    const el = editor;
    editor = null;
    if (el && el.isConnected) el.remove();
  };

  const openEditor = (prefill, replace) => {
    closeEditor();
    const el = cellEl(sel.row, sel.col);
    if (!el) return;
    const current = model.get(sel.row, sel.col);
    editor = document.createElement("input");
    editor.className = "ss-cell-editor";
    editor.spellcheck = false;
    editor.value = prefill !== undefined && (replace || current === "") ? prefill : String(current);
    editor.style.gridRow = String(sel.row + 2);
    editor.style.gridColumn = String(sel.col + 2);
    sheet.appendChild(editor);
    editor.focus();
    editor.select();
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEditor(1, 0);
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEditor(0, 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeEditor();
        gridwrap.focus();
      }
      e.stopPropagation();
    });
    editor.addEventListener("blur", () => {
      if (!editor) return;
      const v = editor.value;
      closeEditor();
      if (v !== String(model.get(sel.row, sel.col))) writeCell(v);
    });
  };

  const commitEditor = (dr, dc) => {
    if (!editor) return;
    const v = editor.value;
    closeEditor();
    if (v !== String(model.get(sel.row, sel.col))) writeCell(v);
    if (dr || dc) moveSel(dr, dc);
    else gridwrap.focus();
  };

  const moveSel = (dr, dc) => {
    const rows = Math.min(model.rows, MAX_ROWS);
    const cols = Math.min(model.cols, MAX_COLS);
    const nr = Math.max(0, Math.min(rows - 1, sel.row + dr));
    const nc = Math.max(0, Math.min(cols - 1, sel.col + dc));
    if (nr !== sel.row || nc !== sel.col) select(nr, nc);
    gridwrap.focus();
  };

  const commitFx = () => {
    const v = fx.value;
    if (v !== String(model.get(sel.row, sel.col))) writeCell(v);
    gridwrap.focus();
  };

  render();
  select(0, 0);
  updateStatus();

  sheet.addEventListener("click", (e) => {
    const cell = e.target.closest(".ss-cell");
    if (!cell) return;
    select(parseInt(cell.dataset.r, 10), parseInt(cell.dataset.c, 10));
    gridwrap.focus();
  });
  sheet.addEventListener("dblclick", (e) => {
    const cell = e.target.closest(".ss-cell");
    if (!cell) return;
    select(parseInt(cell.dataset.r, 10), parseInt(cell.dataset.c, 10));
    openEditor();
  });
  gridwrap.addEventListener("keydown", (e) => {
    if (editor) return;
    const k = e.key;
    if (k === "ArrowUp") { e.preventDefault(); moveSel(-1, 0); }
    else if (k === "ArrowDown") { e.preventDefault(); moveSel(1, 0); }
    else if (k === "ArrowLeft") { e.preventDefault(); moveSel(0, -1); }
    else if (k === "ArrowRight") { e.preventDefault(); moveSel(0, 1); }
    else if (k === "Enter") { e.preventDefault(); moveSel(1, 0); }
    else if (k === "Tab") { e.preventDefault(); moveSel(0, 1); }
    else if (k === "F2") { e.preventDefault(); openEditor(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openEditor(k, true);
    }
  });
  fx.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitFx();
    } else if (e.key === "Escape") {
      e.preventDefault();
      fx.value = model.get(sel.row, sel.col) === "" ? "" : String(model.get(sel.row, sel.col));
      gridwrap.focus();
    }
  });
  fx.addEventListener("blur", () => {
    if (fx.value !== String(model.get(sel.row, sel.col))) commitFx();
  });

  return () => {
    closeEditor();
  };
}

export const sheetsApp = {
  key: "sheets",
  roadTitle: "Spreadsheets build",
  roadmap: [
    "Named sheets, sheet tabs and multi-sheet workbooks",
    "Live dependency graph so edits ripple through the workbook",
    "Number formats and column resize",
    "Formula library expansion (IF, TEXT, date/time, …)",
    "Charts from ranges via data-visualization-plugin",
    "Sort, filter and .xlsx / CSV export",
  ],
  workspaceNote:
    "An editable grid with live formulas and per-cell formatting — A1-style addressing, click-to-select, in-cell typing, an fx bar, arrow-key navigation and registry persistence (T7). Formulas (T8): = arithmetic with SUM/AVERAGE/MIN/MAX/COUNT, references, ranges, recursion and cycle-safe errors. Cell formatting (T9): alignment, fill, font color, bold and italic stored separately from values in the document meta.",
  mountFile: "src/apps/sheets.js",
  hasSurface: true,
  mount: mountSheets,
  seedHints: [
    "Every cell edit flows through the Grid model in src/grid.js — never the raw DOM",
    "Formulas (src/formula.js) are display-only: the model stores the raw '=…' text and evaluateFormula computes what the cell shows",
    "Cell styles (src/cellstyle.js) persist in the doc's meta.styles — separate from the values, so restyling never changes data",
  ],
};
