// ============================================================================
//  VALIDATION TESTS — T9 Cell Formatting Engine
//
//  `runCellStyleTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/cellstyle.test.js");
//    await m.runCellStyleTests()
//
//  Pure tests cover the CellStyles model in src/cellstyle.js (sparse per-cell
//  styles kept fully separate from values). DOM-backed tests drive the live
//  spreadsheets window's formatting toolbar and assert styles apply to the
//  selected cell, follow selection, persist in the doc meta, and never alter
//  cell values.
// ============================================================================

import { CellStyles } from "../cellstyle.js";
import { Grid } from "../grid.js";
import { documentRegistry } from "../registry.js";

export async function runCellStyleTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: the CellStyles model ─────────────────────────────────────────
  await t("set/get returns merged style; unstyled cells read {}", () => {
    const s = new CellStyles();
    if (Object.keys(s.get("A1")).length !== 0) throw new Error("unstyled should read {}");
    s.set("A1", { bold: true });
    if (s.get("A1").bold !== true) throw new Error("bold not stored");
    s.set("A1", { align: "center" });
    const st = s.get("A1");
    if (st.bold !== true || st.align !== "center") throw new Error("merge failed: " + JSON.stringify(st));
  });

  await t("null/false/'' props remove that property; empty styles are dropped", () => {
    const s = new CellStyles();
    s.set("A1", { bold: true, align: "center" });
    s.set("A1", { bold: false });
    const st = s.get("A1");
    if (st.bold !== undefined || st.align !== "center") throw new Error(JSON.stringify(st));
    s.set("A1", { align: "" });
    if (s.count() !== 0) throw new Error("empty style should be dropped from the map");
  });

  await t("clear removes a style and returns the previous one", () => {
    const s = new CellStyles();
    s.set("A1", { bg: "#fff3cd" });
    const prev = s.clear("A1");
    if (prev.bg !== "#fff3cd") throw new Error("clear should return the previous style");
    if (s.count() !== 0) throw new Error("clear failed to remove");
  });

  await t("clearAll wipes every style", () => {
    const s = new CellStyles();
    s.set("A1", { bold: true });
    s.set("B2", { align: "right" });
    s.clearAll();
    if (s.count() !== 0) throw new Error("clearAll failed");
  });

  await t("toJSON/fromJSON round-trips sparse styles", () => {
    const s = new CellStyles();
    s.set("A1", { bold: true, align: "center" });
    s.set("C3", { bg: "#fff3cd", italic: true });
    const json = s.toJSON();
    if (Object.keys(json).length !== 2) throw new Error("toJSON should be sparse, got " + JSON.stringify(json));
    const s2 = CellStyles.fromJSON(JSON.parse(JSON.stringify(json)));
    if (s2.count() !== 2) throw new Error("count after round trip");
    const a = s2.get("A1");
    if (a.bold !== true || a.align !== "center") throw new Error("A1 lost: " + JSON.stringify(a));
    const c = s2.get("C3");
    if (c.bg !== "#fff3cd" || c.italic !== true) throw new Error("C3 lost: " + JSON.stringify(c));
    if (s2.get("B2").align !== undefined) throw new Error("stray style appeared");
  });

  await t("fromJSON is defensive about bad input", () => {
    if (CellStyles.fromJSON(null).count() !== 0) throw new Error("null should be empty");
    const s = CellStyles.fromJSON({ A1: null, B2: "nope", C3: { bold: true } });
    if (s.count() !== 1 || s.get("C3").bold !== true) throw new Error("invalid entries should be skipped");
  });

  await t("styles never alter grid values (restyle does not touch data)", () => {
    const g = new Grid(5, 5);
    g.set("A1", 42);
    g.set("B2", "hello");
    const before = JSON.stringify(g.toJSON());
    const s = new CellStyles();
    s.set("A1", { bold: true, align: "center", bg: "#fff3cd", color: "#b02a37" });
    s.set("B2", { italic: true });
    s.clear("B2");
    if (JSON.stringify(g.toJSON()) !== before) throw new Error("grid changed by styling");
    if (g.get("A1") !== 42 || g.get("B2") !== "hello") throw new Error("cell values changed");
  });

  // ── Editor surface (page only) ─────────────────────────────────────────
  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (domOk) {
    const normColor = (v) => {
      const d = document.createElement("span");
      d.style.color = v;
      return d.style.color;
    };
    const waitSheets = async () => {
      if (location.hash !== "#/home") location.hash = "#/home";
      for (let i = 0; i < 60; i++) {
        if (!document.querySelector(".desk-win.active .sheets-app")) break;
        await new Promise((r) => setTimeout(r, 30));
      }
      await new Promise((r) => setTimeout(r, 80));
      location.hash = "#/app/sheets";
      let fmtbar = null;
      for (let i = 0; i < 60; i++) {
        fmtbar = document.querySelector(".desk-win.active .sheets-app .ss-fmtbar");
        if (fmtbar && document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="0"]')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!fmtbar) throw new Error("format bar did not mount");
      const doc = documentRegistry.listByApp("sheets")[0];
      if (!doc) throw new Error("no sheets registry doc");
      const fx = document.querySelector(".desk-win.active .sheets-app .ss-fx-input");
      return { fmtbar, fx, doc, origContent: doc.content, origStyles: doc.meta.styles !== undefined ? doc.meta.styles : null };
    };
    const commit = (fx, row, col, text) => {
      const cell = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="' + row + '"][data-c="' + col + '"]');
      cell.click();
      fx.value = text;
      fx.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    };
    const cellEl = (row, col) => document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="' + row + '"][data-c="' + col + '"]');
    const restore = (doc, origContent, origStyles) => {
      documentRegistry.update(doc.id, { content: origContent });
      documentRegistry.update(doc.id, { meta: { styles: origStyles } });
    };

    await t("formatting toolbar mounts with alignment, style and color controls", async () => {
      const { fmtbar } = await waitSheets();
      if (fmtbar.querySelectorAll(".ss-aln").length !== 3) throw new Error("alignment buttons");
      if (fmtbar.querySelectorAll(".ss-fmt-tgl").length !== 2) throw new Error("bold/italic buttons");
      if (fmtbar.querySelectorAll(".ss-fill").length < 5) throw new Error("fill swatches");
      if (fmtbar.querySelectorAll(".ss-fg").length < 5) throw new Error("font swatches");
      if (!fmtbar.querySelector(".ss-fmt-clear")) throw new Error("clear button");
    });

    await t("bold styles the selected cell and leaves its value untouched", async () => {
      const { fx, doc, origContent, origStyles } = await waitSheets();
      try {
        commit(fx, 0, 0, "42");
        const before = JSON.stringify(Grid.fromJSON(JSON.parse(doc.content)).toJSON());
        const cell = cellEl(0, 0);
        cell.click();
        const boldBtn = document.querySelector('.desk-win.active .sheets-app .ss-fmt-tgl[data-fmt="bold"]');
        boldBtn.click();
        if (cell.style.fontWeight !== "700") throw new Error("fontWeight: " + cell.style.fontWeight);
        if (!boldBtn.classList.contains("on")) throw new Error("bold button not .on");
        const after = JSON.stringify(Grid.fromJSON(JSON.parse(doc.content)).toJSON());
        if (before !== after) throw new Error("value changed by styling");
        if (cell.textContent !== "42") throw new Error("cell text changed");
        const st = JSON.parse(doc.meta.styles);
        if (!st.A1 || st.A1.bold !== true) throw new Error("style not in meta: " + JSON.stringify(st));
      } finally {
        restore(doc, origContent, origStyles);
      }
    });

    await t("alignment, fill and font color apply to the selected cell", async () => {
      const { doc, origContent, origStyles } = await waitSheets();
      try {
        const cell = cellEl(0, 0);
        cell.click();
        document.querySelector('.desk-win.active .sheets-app .ss-aln[data-align="center"]').click();
        document.querySelector('.desk-win.active .sheets-app .ss-fill[data-bg="#fff3cd"]').click();
        document.querySelector('.desk-win.active .sheets-app .ss-fg[data-fg="#0a58ca"]').click();
        if (cell.style.textAlign !== "center") throw new Error("align: " + cell.style.textAlign);
        if (cell.style.getPropertyValue("--bg") !== "#fff3cd") throw new Error("bg: " + cell.style.getPropertyValue("--bg"));
        if (cell.style.color !== normColor("#0a58ca")) throw new Error("color: " + cell.style.color);
        const st = JSON.parse(doc.meta.styles).A1;
        if (!st || st.align !== "center" || st.bg !== "#fff3cd" || st.color !== "#0a58ca")
          throw new Error("meta style: " + JSON.stringify(st));
      } finally {
        restore(doc, origContent, origStyles);
      }
    });

    await t("format button state follows the selection", async () => {
      const { doc, origContent, origStyles } = await waitSheets();
      try {
        const boldBtn = document.querySelector('.desk-win.active .sheets-app .ss-fmt-tgl[data-fmt="bold"]');
        cellEl(0, 0).click();
        boldBtn.click();
        if (!boldBtn.classList.contains("on")) throw new Error("A1 should be bold");
        cellEl(1, 1).click();
        if (boldBtn.classList.contains("on")) throw new Error("B2 should not show bold");
        cellEl(0, 0).click();
        if (!boldBtn.classList.contains("on")) throw new Error("A1 bold state not restored");
      } finally {
        restore(doc, origContent, origStyles);
      }
    });

    await t("clear formatting removes every style from the cell", async () => {
      const { doc, origContent, origStyles } = await waitSheets();
      try {
        const cell = cellEl(0, 0);
        cell.click();
        document.querySelector('.desk-win.active .sheets-app .ss-fmt-tgl[data-fmt="bold"]').click();
        document.querySelector('.desk-win.active .sheets-app .ss-fill[data-bg="#fff3cd"]').click();
        if (!cell.style.fontWeight && !cell.style.getPropertyValue("--bg")) throw new Error("style not applied first");
        document.querySelector(".desk-win.active .sheets-app .ss-fmt-clear").click();
        if (cell.style.cssText.trim() !== "") throw new Error("cell still styled: " + cell.style.cssText);
        const st = JSON.parse(doc.meta.styles || "{}");
        if (st.A1) throw new Error("A1 still in meta: " + JSON.stringify(st));
        const boldBtn = document.querySelector('.desk-win.active .sheets-app .ss-fmt-tgl[data-fmt="bold"]');
        if (boldBtn.classList.contains("on")) throw new Error("bold button still .on");
      } finally {
        restore(doc, origContent, origStyles);
      }
    });

    await t("styles persist in meta while content holds only values", async () => {
      const { fx, doc, origContent, origStyles } = await waitSheets();
      try {
        commit(fx, 0, 1, "5");
        cellEl(0, 1).click();
        document.querySelector('.desk-win.active .sheets-app .ss-fmt-tgl[data-fmt="bold"]').click();
        document.querySelector('.desk-win.active .sheets-app .ss-aln[data-align="right"]').click();
        const meta = JSON.parse(doc.meta.styles);
        if (!meta.B1 || meta.B1.bold !== true || meta.B1.align !== "right") throw new Error("meta: " + JSON.stringify(meta));
        const grid = Grid.fromJSON(JSON.parse(doc.content));
        if (grid.get("B1") !== 5) throw new Error("value lost");
        const contentHasStyle = JSON.stringify(JSON.parse(doc.content)).includes("align") || JSON.stringify(JSON.parse(doc.content)).includes("bold");
        if (contentHasStyle) throw new Error("style leaked into content");
      } finally {
        restore(doc, origContent, origStyles);
      }
    });
  }

  return results;
}
