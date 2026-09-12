// ============================================================================
//  VALIDATION TESTS — T8 Formula Parser
//
//  `runFormulaTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/formula.test.js");
//    await m.runFormulaTests()
//
//  Pure tests cover isFormula/evaluateFormula/displayValue in src/formula.js
//  (arithmetic + precedence, cell references, ranges, SUM/AVERAGE/MIN/MAX/
//  COUNT, recursion + cycle guard, error codes, Excel-ish empty/text
//  semantics). DOM-backed tests drive the live spreadsheets window and assert
//  that formulas display computed results while the model keeps the raw text.
// ============================================================================

import { isFormula, evaluateFormula, displayValue } from "../formula.js";
import { Grid } from "../grid.js";
import { documentRegistry } from "../registry.js";

export async function runFormulaTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: detection & API contract ─────────────────────────────────────
  await t("isFormula detects = prefix and rejects bare = and non-strings", () => {
    if (!isFormula("=1+2")) throw new Error("=1+2 should be a formula");
    if (!isFormula("=SUM(A1:B1)")) throw new Error("=SUM should be a formula");
    if (isFormula("=")) throw new Error("bare = should not be a formula");
    if (isFormula("1+2")) throw new Error("no leading = should not be a formula");
    if (isFormula("")) throw new Error("empty string should not be a formula");
    if (isFormula(42)) throw new Error("number should not be a formula");
    if (isFormula(null)) throw new Error("null should not be a formula");
  });

  await t("evaluateFormula throws on non-formula input", () => {
    let threw = false;
    try { evaluateFormula("5", () => ""); } catch { threw = true; }
    if (!threw) throw new Error("should throw for input without =");
  });

  // ── Pure: arithmetic & precedence ──────────────────────────────────────
  await t("basic arithmetic", () => {
    if (evaluateFormula("=1+2") !== 3) throw new Error("1+2");
    if (evaluateFormula("=10/4") !== 2.5) throw new Error("10/4");
    if (evaluateFormula("=5-8") !== -3) throw new Error("5-8");
    if (evaluateFormula("=7") !== 7) throw new Error("plain number");
  });

  await t("operator precedence: * and / bind tighter than + and -", () => {
    if (evaluateFormula("=2+3*4") !== 14) throw new Error("2+3*4");
    if (evaluateFormula("=10-6/2") !== 7) throw new Error("10-6/2");
    if (evaluateFormula("=2*3+4*5") !== 26) throw new Error("2*3+4*5");
  });

  await t("parentheses override precedence", () => {
    if (evaluateFormula("=(2+3)*4") !== 20) throw new Error("(2+3)*4");
    if (evaluateFormula("=10/(2+3)") !== 2) throw new Error("10/(2+3)");
    if (evaluateFormula("=((1+2)*(3+4))") !== 21) throw new Error("nested parens");
  });

  await t("unary minus and plus", () => {
    if (evaluateFormula("=-3+2") !== -1) throw new Error("-3+2");
    if (evaluateFormula("=--3") !== 3) throw new Error("--3");
    if (evaluateFormula("=+5") !== 5) throw new Error("+5");
    if (evaluateFormula("=2*-3") !== -6) throw new Error("2*-3");
  });

  await t("whitespace is tolerated", () => {
    if (evaluateFormula("= 1 + 2 ") !== 3) throw new Error("spaces");
    if (evaluateFormula("=   ( 1 + 2 ) * 3  ") !== 9) throw new Error("padded");
  });

  await t("float noise is cleaned (0.1+0.2 == 0.3)", () => {
    const v = evaluateFormula("=0.1+0.2");
    if (v !== 0.3) throw new Error("0.1+0.2 = " + v);
    if (evaluateFormula("=0.1*3") !== 0.30000000000000004 && evaluateFormula("=0.1*3") !== 0.3) {
      throw new Error("0.1*3 unexpected: " + evaluateFormula("=0.1*3"));
    }
  });

  await t("exponent notation literals", () => {
    if (evaluateFormula("=1e2+5") !== 105) throw new Error("1e2+5");
    if (evaluateFormula("=1E-1") !== 0.1) throw new Error("1E-1");
  });

  // ── Pure: cell references ──────────────────────────────────────────────
  const g = new Grid(20, 10);
  const L = (ref) => g.get(ref);

  await t("single cell references feed arithmetic", () => {
    g.clear();
    g.set("A1", 2);
    if (evaluateFormula("=A1+1", L) !== 3) throw new Error("A1+1");
    g.set("B1", 3);
    if (evaluateFormula("=A1*B1", L) !== 6) throw new Error("A1*B1");
    if (evaluateFormula("=A1+B1", L) !== 5) throw new Error("A1+B1");
    if (evaluateFormula("=B1-A1", L) !== 1) throw new Error("B1-A1");
    if (evaluateFormula("=B1/A1", L) !== 1.5) throw new Error("B1/A1");
  });

  await t("references are case-insensitive", () => {
    g.clear();
    g.set("A1", 2);
    g.set("B1", 3);
    if (evaluateFormula("=a1+b1", L) !== 5) throw new Error("lowercase refs");
  });

  await t("bare reference to an empty cell is 0", () => {
    g.clear();
    if (evaluateFormula("=Z9", L) !== 0) throw new Error("empty ref should be 0");
  });

  await t("bare reference to a text cell passes the text through", () => {
    g.clear();
    g.set("A1", "hello");
    if (evaluateFormula("=A1", L) !== "hello") throw new Error("text passthrough");
    g.set("B1", "42");
    if (evaluateFormula("=B1", L) !== 42) throw new Error("numeric string should coerce");
  });

  await t("text cells coerce to 0 in arithmetic", () => {
    g.clear();
    g.set("A1", "hi");
    if (evaluateFormula("=A1+1", L) !== 1) throw new Error("text+1");
  });

  // ── Pure: functions & ranges ───────────────────────────────────────────
  await t("SUM over a range adds the referenced values", () => {
    g.clear();
    g.set("A1", 2);
    g.set("B1", 3);
    if (evaluateFormula("=SUM(A1:B1)", L) !== 5) throw new Error("SUM(A1:B1)");
    if (evaluateFormula("=SUM(B1:A1)", L) !== 5) throw new Error("reversed range");
  });

  await t("SUM accepts explicit numbers and mixed args", () => {
    g.clear();
    g.set("A1", 2);
    if (evaluateFormula("=SUM(1,2,3)", L) !== 6) throw new Error("numbers");
    if (evaluateFormula("=SUM(A1, 5)", L) !== 7) throw new Error("mixed");
  });

  await t("SUM ignores empty and text cells", () => {
    g.clear();
    g.set("A1", 2);
    g.set("B1", "hi");
    if (evaluateFormula("=SUM(A1:B1)", L) !== 2) throw new Error("text ignored");
    if (evaluateFormula("=SUM(C5:D6)", L) !== 0) throw new Error("all empty");
  });

  await t("SUM over a 2D range sums row-major", () => {
    g.clear();
    g.set("A1", 2);
    g.set("B1", 3);
    g.set("A2", 4);
    g.set("B2", 5);
    if (evaluateFormula("=SUM(A1:B2)", L) !== 14) throw new Error("2D range");
  });

  await t("AVERAGE over a range averages the numeric cells", () => {
    g.clear();
    g.set("A1", 2);
    g.set("B1", 3);
    if (evaluateFormula("=AVERAGE(A1:B1)", L) !== 2.5) throw new Error("AVERAGE");
    g.set("C1", "hi");
    if (evaluateFormula("=AVERAGE(A1:C1)", L) !== 2.5) throw new Error("text ignored");
  });

  await t("AVERAGE with no numeric cells is #DIV/0!", () => {
    g.clear();
    if (evaluateFormula("=AVERAGE(C5:D6)", L) !== "#DIV/0!") throw new Error("empty average");
  });

  await t("MIN/MAX/COUNT over ranges", () => {
    g.clear();
    g.set("A1", 7);
    g.set("B1", 3);
    g.set("C1", "hi");
    if (evaluateFormula("=MAX(A1:B1)", L) !== 7) throw new Error("MAX");
    if (evaluateFormula("=MIN(A1:B1)", L) !== 3) throw new Error("MIN");
    if (evaluateFormula("=COUNT(A1:C1)", L) !== 2) throw new Error("COUNT");
    if (evaluateFormula("=MAX(C1)", L) !== 0) throw new Error("MAX over text");
  });

  await t("functions nest and compose with arithmetic", () => {
    g.clear();
    g.set("A1", 2);
    g.set("B1", 3);
    if (evaluateFormula("=MAX(SUM(A1:B1), 10)", L) !== 10) throw new Error("nested MAX");
    if (evaluateFormula("=SUM(A1:B1)*2", L) !== 10) throw new Error("SUM*2");
    if (evaluateFormula("=SUM(A1, SUM(B1, 1))", L) !== 6) throw new Error("nested SUM");
  });

  await t("function names are case-insensitive", () => {
    g.clear();
    g.set("A1", 2);
    g.set("B1", 3);
    if (evaluateFormula("=sum(a1:b1)", L) !== 5) throw new Error("lowercase sum");
    if (evaluateFormula("=Average(a1:b1)", L) !== 2.5) throw new Error("mixed case");
  });

  // ── Pure: recursion & errors ───────────────────────────────────────────
  await t("formulas reference other formula cells recursively", () => {
    g.clear();
    g.set("A1", "=2+3");
    if (evaluateFormula("=A1*2", L) !== 10) throw new Error("recursive ref");
    g.set("B1", "=A1+1");
    if (evaluateFormula("=B1", L) !== 6) throw new Error("chain");
  });

  await t("circular references are detected without hanging", () => {
    g.clear();
    g.set("A1", "=B1");
    g.set("B1", "=A1");
    if (evaluateFormula("=A1", L) !== "#CYCLE!") throw new Error("mutual cycle");
    g.clear();
    g.set("A1", "=A1");
    if (evaluateFormula("=A1", L) !== "#CYCLE!") throw new Error("self cycle");
  });

  await t("division by zero is #DIV/0!", () => {
    g.clear();
    if (evaluateFormula("=1/0", L) !== "#DIV/0!") throw new Error("1/0");
    g.set("A1", 0);
    if (evaluateFormula("=5/A1", L) !== "#DIV/0!") throw new Error("ref /0");
  });

  await t("malformed formulas are #ERROR!", () => {
    g.clear();
    for (const bad of ["=1+", "=SUM(A1", "=1 2", "=()", "=A1:B1", "=(1+2", "=,", "=1//2"]) {
      if (evaluateFormula(bad, L) !== "#ERROR!") throw new Error("accepted malformed: " + bad);
    }
  });

  await t("unknown functions are #NAME?", () => {
    g.clear();
    if (evaluateFormula("=FOO(1)", L) !== "#NAME?") throw new Error("FOO");
  });

  await t("huge ranges are capped instead of freezing", () => {
    g.clear();
    const v = evaluateFormula("=SUM(A1:ZZ99999)", L);
    if (v !== "#NUM!") throw new Error("expected #NUM!, got " + v);
  });

  // ── Pure: displayValue ─────────────────────────────────────────────────
  await t("displayValue passes non-formulas through untouched", () => {
    const a = displayValue(5, L);
    if (a.value !== 5 || a.isNumber !== true) throw new Error("number passthrough");
    const b = displayValue("hello", L);
    if (b.value !== "hello" || b.isNumber !== false) throw new Error("text passthrough");
    const c = displayValue("", L);
    if (c.value !== "" || c.isNumber !== false) throw new Error("empty passthrough");
  });

  await t("displayValue evaluates formulas and flags numerics", () => {
    g.clear();
    g.set("A1", 2);
    g.set("B1", 3);
    const a = displayValue("=SUM(A1:B1)", L);
    if (a.value !== 5 || a.isNumber !== true) throw new Error("sum display");
    const b = displayValue("=1/0", L);
    if (b.value !== "#DIV/0!" || b.isNumber !== false) throw new Error("error display");
    const c = displayValue("=A1+B1", L);
    if (c.value !== 5 || c.isNumber !== true) throw new Error("ref arithmetic display");
  });

  // ── Editor surface (page only) ─────────────────────────────────────────
  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (domOk) {
    const waitSheets = async () => {
      location.hash = "#/app/sheets";
      let fx = null;
      for (let i = 0; i < 40; i++) {
        fx = document.querySelector(".desk-win.active .sheets-app .ss-fx-input");
        if (fx && document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="0"]')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!fx) throw new Error("sheets surface did not mount");
      const doc = documentRegistry.listByApp("sheets")[0];
      if (!doc) throw new Error("no sheets registry doc");
      return { fx, doc, orig: doc.content };
    };
    const commit = (fx, row, col, text) => {
      const cell = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="' + row + '"][data-c="' + col + '"]');
      if (!cell) throw new Error("cell missing " + row + "," + col);
      cell.click();
      fx.value = text;
      fx.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    };
    const cellState = (row, col) => {
      const el = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="' + row + '"][data-c="' + col + '"]');
      if (!el) throw new Error("cell missing " + row + "," + col);
      return { text: el.textContent, num: el.classList.contains("num") };
    };

    await t("C1=SUM(A1:B1) displays 5 while the model keeps the raw formula", async () => {
      const { fx, doc, orig } = await waitSheets();
      try {
        commit(fx, 0, 0, "2");
        commit(fx, 0, 1, "3");
        commit(fx, 0, 2, "=SUM(A1:B1)");
        const c = cellState(0, 2);
        if (c.text !== "5" || !c.num) throw new Error("C1 shows " + JSON.stringify(c));
        const g = Grid.fromJSON(JSON.parse(doc.content));
        if (g.get("C1") !== "=SUM(A1:B1)") throw new Error("model lost raw formula");
        const cell = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="2"]');
        cell.click();
        if (fx.value !== "=SUM(A1:B1)") throw new Error("fx should show raw formula, got " + fx.value);
        const a1 = document.querySelector('.desk-win.active .sheets-app .ss-cell[data-r="0"][data-c="0"]');
        a1.click();
        if (fx.value !== "2") throw new Error("fx should show A1 raw value, got " + fx.value);
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("AVERAGE(A1:B1) displays 2.5", async () => {
      const { fx, doc, orig } = await waitSheets();
      try {
        commit(fx, 0, 0, "2");
        commit(fx, 0, 1, "3");
        commit(fx, 0, 3, "=AVERAGE(A1:B1)");
        const d = cellState(0, 3);
        if (d.text !== "2.5" || !d.num) throw new Error("D1 shows " + JSON.stringify(d));
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("simple arithmetic formulas evaluate in the grid", async () => {
      const { fx, doc, orig } = await waitSheets();
      try {
        commit(fx, 0, 0, "2");
        commit(fx, 0, 4, "=A1*3+1");
        const e = cellState(0, 4);
        if (e.text !== "7" || !e.num) throw new Error("E1 shows " + JSON.stringify(e));
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("non-formula values pass through untouched", async () => {
      const { fx, doc, orig } = await waitSheets();
      try {
        commit(fx, 0, 0, "hello");
        const a = cellState(0, 0);
        if (a.text !== "hello" || a.num) throw new Error("A1 shows " + JSON.stringify(a));
        commit(fx, 0, 1, "5");
        const b = cellState(0, 1);
        if (b.text !== "5" || !b.num) throw new Error("B1 shows " + JSON.stringify(b));
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("editing a source cell ripples to dependent formulas", async () => {
      const { fx, doc, orig } = await waitSheets();
      try {
        commit(fx, 0, 0, "2");
        commit(fx, 0, 1, "3");
        commit(fx, 0, 2, "=SUM(A1:B1)");
        if (cellState(0, 2).text !== "5") throw new Error("C1 not 5 before ripple");
        commit(fx, 0, 0, "10");
        if (cellState(0, 2).text !== "13") throw new Error("C1 not 13 after A1=10");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("formulas can reference other formula cells", async () => {
      const { fx, doc, orig } = await waitSheets();
      try {
        commit(fx, 0, 0, "2");
        commit(fx, 0, 1, "3");
        commit(fx, 0, 2, "=SUM(A1:B1)");
        commit(fx, 0, 3, "=C1*2");
        if (cellState(0, 3).text !== "10") throw new Error("D1 shows " + cellState(0, 3).text);
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("formula errors display as error text, not crashes", async () => {
      const { fx, doc, orig } = await waitSheets();
      try {
        commit(fx, 0, 0, "=1/0");
        const a = cellState(0, 0);
        if (a.text !== "#DIV/0!" || a.num) throw new Error("A1 shows " + JSON.stringify(a));
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("circular references show an error without freezing the grid", async () => {
      const { fx, doc, orig } = await waitSheets();
      try {
        commit(fx, 0, 0, "=B1");
        commit(fx, 0, 1, "=A1");
        const a = cellState(0, 0);
        const b = cellState(0, 1);
        if (a.text !== "#CYCLE!" || a.num) throw new Error("A1 shows " + JSON.stringify(a));
        if (b.text !== "#CYCLE!" || b.num) throw new Error("B1 shows " + JSON.stringify(b));
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });
  }

  return results;
}
