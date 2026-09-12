// ============================================================================
//  VALIDATION TESTS — T7 Grid Data Structure
//
//  `runGridTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/grid.test.js");
//    await m.runGridTests()
//
//  Pure tests cover the A1 coordinate helpers and the Grid model in
//  src/grid.js; DOM-backed tests drive the live spreadsheets window and
//  assert that selecting, typing and committing edits land in the grid and
//  the registry.
// ============================================================================

import { Grid, colToIndex, indexToCol, cellToRC, rcToCell } from "../grid.js";
import { documentRegistry } from "../registry.js";

export async function runGridTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: A1 coordinate helpers ─────────────────────────────────────────
  await t("colToIndex maps single, double and triple letters", () => {
    const cases = { A: 0, B: 1, Z: 25, AA: 26, AZ: 51, BA: 52, ZZ: 701, AAA: 702 };
    for (const [col, idx] of Object.entries(cases)) {
      if (colToIndex(col) !== idx) throw new Error(col + " -> " + colToIndex(col) + " != " + idx);
    }
    if (colToIndex("a1") !== null) throw new Error("digits accepted");
    if (colToIndex("") !== null) throw new Error("empty accepted");
    if (colToIndex("AB!") !== null) throw new Error("symbols accepted");
  });

  await t("indexToCol mirrors colToIndex", () => {
    const cases = { 0: "A", 1: "B", 25: "Z", 26: "AA", 51: "AZ", 52: "BA", 701: "ZZ", 702: "AAA" };
    for (const [idx, col] of Object.entries(cases)) {
      if (indexToCol(Number(idx)) !== col) throw new Error(idx + " -> " + indexToCol(Number(idx)));
    }
    for (let i = 0; i < 2000; i++) {
      if (colToIndex(indexToCol(i)) !== i) throw new Error("round-trip fail at " + i);
    }
  });

  await t("cellToRC parses A1-style references (case-insensitive, multi-digit rows)", () => {
    const cases = { A1: [0, 0], B3: [2, 1], aa10: [9, 26], Z100: [99, 25], AA2: [1, 26], " A5 ": [4, 0] };
    for (const [ref, [row, col]] of Object.entries(cases)) {
      const rc = cellToRC(ref);
      if (!rc || rc.row !== row || rc.col !== col) throw new Error(ref + " -> " + JSON.stringify(rc));
    }
    for (const bad of ["", "1A", "A", "1", "A0", "A-1", "A1.5", "A 1", "$A$1"]) {
      if (cellToRC(bad) !== null) throw new Error("accepted invalid ref: " + bad);
    }
  });

  await t("rcToCell matches cellToRC (inverse)", () => {
    for (const ref of ["A1", "B3", "Z100", "AA2", "C19", "ZZ9"]) {
      const rc = cellToRC(ref);
      if (rcToCell(rc.row, rc.col) !== ref.toUpperCase()) throw new Error(rcToCell(rc.row, rc.col));
    }
    if (rcToCell(-1, 0) !== null || rcToCell(0, -1) !== null) throw new Error("negative accepted");
  });

  // ── Pure: the Grid model ────────────────────────────────────────────────
  await t("set/get via A1 coords round-trips values with types intact", () => {
    const g = new Grid(5, 5);
    g.set("A1", "hello");
    g.set("B2", 42);
    g.set("C3", true);
    g.set("D4", 3.14);
    if (g.get("A1") !== "hello") throw new Error("string");
    if (g.get("B2") !== 42 || typeof g.get("B2") !== "number") throw new Error("int type");
    if (g.get("C3") !== true || typeof g.get("C3") !== "boolean") throw new Error("bool type");
    if (g.get("D4") !== 3.14) throw new Error("float");
    if (g.get("E5") !== "") throw new Error("blank read");
    if (g.get("F6") !== "") throw new Error("out-of-bounds read should be empty");
  });

  await t("set/get via numeric (row, col) coords works too", () => {
    const g = new Grid(4, 4);
    g.set(1, 2, "x");
    if (g.get(1, 2) !== "x") throw new Error("write");
    if (g.get(0, 0) !== "") throw new Error("blank");
    let threw = false;
    try { g.get(-1, 0); } catch { threw = true; }
    if (!threw) throw new Error("negative read should throw");
  });

  await t("writing past bounds grows the grid to fit", () => {
    const g = new Grid(5, 5);
    g.set("Z200", "deep");
    if (g.rows !== 200 || g.cols !== 26) throw new Error(g.rows + "x" + g.cols);
    if (g.get("Z200") !== "deep") throw new Error("value lost");
    if (g.get("A1") !== "") throw new Error("still blank");
  });

  await t("set returns the previous value and \"\" clears a cell", () => {
    const g = new Grid(3, 3);
    if (g.set("A1", 7) !== "") throw new Error("first set prev");
    if (g.set("A1", 9) !== 7) throw new Error("overwrite prev");
    g.set("A1", "");
    if (g.get("A1") !== "" || g.nonEmptyCount() !== 0) throw new Error("not cleared");
    if (g.usedRange().row !== -1) throw new Error("usedRange not empty");
  });

  await t("clear() empties everything but keeps dimensions", () => {
    const g = new Grid(6, 8);
    g.set("B2", 1);
    g.set("D4", 2);
    g.clear();
    if (g.nonEmptyCount() !== 0) throw new Error("not empty");
    if (g.rows !== 6 || g.cols !== 8) throw new Error("dims changed");
  });

  await t("usedRange reports the true bottom-right corner of used cells", () => {
    const g = new Grid(10, 10);
    if (g.usedRange().row !== -1 || g.usedRange().col !== -1) throw new Error("blank range");
    g.set("A1", "a");
    g.set("C5", "b");
    g.set("B9", "c");
    const ur = g.usedRange();
    if (ur.row !== 8 || ur.col !== 2) throw new Error(JSON.stringify(ur));
  });

  await t("forEach visits all non-empty cells in row-major order with correct refs", () => {
    const g = new Grid(4, 4);
    g.set("A1", 1);
    g.set("C1", 2);
    g.set("B2", 3);
    const seen = [];
    g.forEach((ref, v, r, c) => seen.push([ref, v, r, c]));
    if (JSON.stringify(seen) !== JSON.stringify([["A1", 1, 0, 0], ["C1", 2, 0, 2], ["B2", 3, 1, 1]]))
      throw new Error(JSON.stringify(seen));
  });

  await t("toJSON/fromJSON round-trips values, dims and sparseness", () => {
    const g = new Grid(10, 8);
    g.set("A1", "text");
    g.set("B2", 42);
    g.set("C3", false);
    g.set("Z100", "deep"); // expands dims
    const json = g.toJSON();
    if (json.rows !== 100 || json.cols !== 26) throw new Error("dims: " + json.rows + "x" + json.cols);
    if (Object.keys(json.cells).length !== 4) throw new Error("not sparse: " + JSON.stringify(json.cells));
    const g2 = Grid.fromJSON(JSON.parse(JSON.stringify(json)));
    if (g2.get("A1") !== "text" || g2.get("B2") !== 42 || g2.get("C3") !== false || g2.get("Z100") !== "deep")
      throw new Error("values lost");
    if (g2.get("D4") !== "") throw new Error("sparse gap filled");
    if (g2.rows !== 100 || g2.cols !== 26) throw new Error("dims lost");
  });

  await t("fromJSON is defensive about bad input", () => {
    const g = Grid.fromJSON(null);
    if (g.rows !== 0 || g.cols !== 0 || g.nonEmptyCount() !== 0) throw new Error("null");
    const g2 = Grid.fromJSON({ rows: 2, cols: 2, cells: { A1: "x", "9!": "bad", A2: "y" } });
    if (g2.get("A1") !== "x" || g2.get("A2") !== "y") throw new Error("valid refs lost");
    if (g2.nonEmptyCount() !== 2) throw new Error("invalid ref counted");
  });

  await t("resize grows and shrinks, preserving in-bounds data", () => {
    const g = new Grid(4, 4);
    g.set("B2", "keep");
    g.set("D4", "drop");
    g.resize(6, 6);
    if (g.get("B2") !== "keep" || g.rows !== 6 || g.cols !== 6) throw new Error("grow");
    g.resize(2, 2);
    if (g.rows !== 2 || g.cols !== 2) throw new Error("shrink dims");
    if (g.get("B2") !== "keep") throw new Error("in-bounds lost");
    if (g.get("D4") !== "") throw new Error("out-of-bounds kept");
  });

  await t("scattered writes and reads stay consistent", () => {
    const g = new Grid(20, 10);
    const want = {};
    for (let i = 0; i < 300; i++) {
      const row = Math.floor(Math.random() * 20);
      const col = Math.floor(Math.random() * 10);
      const ref = rcToCell(row, col);
      const v = "v" + i;
      g.set(ref, v);
      want[ref] = v;
    }
    for (const [ref, v] of Object.entries(want)) {
      if (g.get(ref) !== v) throw new Error("mismatch at " + ref);
    }
    if (g.nonEmptyCount() !== Object.keys(want).length) throw new Error("count");
  });

  // ── Editor surface (page only) ───────────────────────────────────────────
  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (domOk) {
    await t("spreadsheets window mounts a real grid with headers", async () => {
      location.hash = "#/app/sheets";
      let sheet = null;
      for (let i = 0; i < 40; i++) {
        sheet = document.querySelector(".desk-win.active .sheets-app .ss-sheet");
        if (sheet) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!sheet) throw new Error("sheets surface did not mount");
      if (sheet.querySelectorAll(".ss-colhead").length < 5) throw new Error("too few col headers");
      const firstCol = sheet.querySelector(".ss-colhead").textContent;
      if (firstCol !== "A") throw new Error("first col header: " + firstCol);
      if (sheet.querySelector(".ss-rowhead").textContent !== "1") throw new Error("first row header");
      if (sheet.querySelectorAll(".ss-cell").length < 100) throw new Error("grid too small");
    });

    await t("clicking a cell selects it and shows its reference", async () => {
      location.hash = "#/app/sheets";
      let cell = null;
      for (let i = 0; i < 40; i++) {
        cell = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="1"][data-c="1"]');
        if (cell) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!cell) throw new Error("cell B2 not rendered");
      cell.click();
      const sel = document.querySelector(".desk-win.active .sheets-app .ss-selection");
      if (!sel || sel.textContent.trim() !== "B2") throw new Error("selection label: " + (sel && sel.textContent));
      if (!cell.classList.contains("selected")) throw new Error("cell not highlighted");
    });

    await t("typing via the fx bar commits into the cell, grid and registry", async () => {
      location.hash = "#/app/sheets";
      let fx = null;
      for (let i = 0; i < 40; i++) {
        fx = document.querySelector(".desk-win.active .sheets-app .ss-fx-input");
        if (fx) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!fx) throw new Error("fx bar missing");
      const cell = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="1"][data-c="1"]');
      cell.click();
      const doc = documentRegistry.listByApp("sheets")[0];
      if (!doc) throw new Error("no sheets registry doc");
      const orig = doc.content;

      fx.value = "Hello World";
      fx.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      const g = Grid.fromJSON(JSON.parse(doc.content));
      if (g.get("B2") !== "Hello World") throw new Error("registry grid missing value");
      if (cell.textContent !== "Hello World") throw new Error("cell DOM not updated");
      try {
        if (JSON.stringify(g.toJSON()) !== doc.content) throw new Error("registry JSON != grid JSON");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("numeric text typed via the fx bar is stored as a number", async () => {
      location.hash = "#/app/sheets";
      let fx = null;
      for (let i = 0; i < 40; i++) {
        fx = document.querySelector(".desk-win.active .sheets-app .ss-fx-input");
        if (fx) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!fx) throw new Error("fx bar missing");
      const cell = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="1"]');
      cell.click();
      const doc = documentRegistry.listByApp("sheets")[0];
      const orig = doc.content;
      fx.value = "42";
      fx.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      try {
        const g = Grid.fromJSON(JSON.parse(doc.content));
        const v = g.get("B1");
        if (v !== 42 || typeof v !== "number") throw new Error("not stored as number: " + JSON.stringify(v));
        const cellEl = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="1"]');
        if (!cellEl.classList.contains("num")) throw new Error("cell not right-aligned (.num)");
        if (cellEl.textContent !== "42") throw new Error("cell text: " + cellEl.textContent);
        const notNum = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="0"]');
        notNum.click();
        fx.value = "not a number";
        fx.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        const g2 = Grid.fromJSON(JSON.parse(doc.content));
        if (g2.get("A1") !== "not a number" || typeof g2.get("A1") !== "string")
          throw new Error("text coerced: " + JSON.stringify(g2.get("A1")));
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("arrow keys move the selection", async () => {
      location.hash = "#/app/sheets";
      let wrap = null;
      for (let i = 0; i < 40; i++) {
        wrap = document.querySelector(".desk-win.active .sheets-app .ss-gridwrap");
        if (wrap) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!wrap) throw new Error("grid wrap missing");
      const cellA1 = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="0"]');
      cellA1.click();
      wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      const sel = document.querySelector(".desk-win.active .sheets-app .ss-selection");
      if (sel.textContent.trim() !== "B1") throw new Error("after right: " + sel.textContent);
      wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      if (sel.textContent.trim() !== "B2") throw new Error("after down: " + sel.textContent);
    });

    await t("in-cell typing opens an editor and Enter commits", async () => {
      location.hash = "#/app/sheets";
      let wrap = null;
      for (let i = 0; i < 40; i++) {
        wrap = document.querySelector(".desk-win.active .sheets-app .ss-gridwrap");
        if (wrap) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!wrap) throw new Error("grid wrap missing");
      const doc = documentRegistry.listByApp("sheets")[0];
      const orig = doc.content;
      const cellA1 = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="0"]');
      cellA1.click();
      wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
      let editor = document.querySelector(".desk-win.active .sheets-app .ss-cell-editor");
      if (!editor) throw new Error("editor did not open");
      editor.value = "typed value";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      try {
        const g = Grid.fromJSON(JSON.parse(doc.content));
        if (g.get("A1") !== "typed value") throw new Error("grid missing typed value");
        if (document.querySelector(".desk-win.active .sheets-app .ss-cell-editor")) throw new Error("editor not closed");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });
  }

  return results;
}
