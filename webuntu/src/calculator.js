// Webuntu OS — Calculator (Phase 6, Task 30)
// A windowed scientific-ish calculator: basic ops (＋ − × ÷), percent (%), root
// (√), sign toggle (±), backspace, a four-key memory bank (MC/MR/M+/M− with an
// "M" indicator), full keyboard input, a live display with an expression line,
// and correct divide-by-zero handling (shows "Error" instead of Infinity).
//
// It is a singleton app: launching it again just focuses the open window. The
// windowed app is registered via window.AppContent["calculator"] (apps.js calls
// the builder, then WM.open — WM.open's singleton:true handles re-focus).

(function () {
  "use strict";

  const OPS = { "+": "+", "-": "−", "*": "×", "/": "÷" };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Format a number for the display without float noise: trim to 12 significant
  // digits; fall back to exponential notation for huge/tiny magnitudes.
  function fmtNum(n) {
    if (typeof n !== "number" || !isFinite(n)) return "0";
    if (n === 0) return "0";
    const abs = Math.abs(n);
    if (abs >= 1e15 || abs < 1e-9) {
      return n.toExponential(9).replace(/\.?0+e/, "e");
    }
    return String(Number(n.toPrecision(12)));
  }

  function applyOp(a, b, op) {
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return b === 0 ? NaN : a / b;
    }
    return b;
  }

  function createCalculator() {
    const calc = {
      root: el("div", "calc"),
      state: null,
      w: null,
    };
    const st = {
      entry: "0",        // the number being typed, as a string
      acc: null,         // accumulated (first) operand, number
      op: null,          // pending operator "+" "-" "*" "/"
      waiting: false,    // a binary operator was just pressed — next digit starts fresh
      justEval: false,   // "=" just ran — next digit starts fresh, next op reuses the result
      lastEq: null,      // "12 + 7 =" shown in the expression line after "="
      error: false,
      memory: null,
    };
    calc.state = st;

    // ---------- display ----------
    const display = el("div", "calc-display");
    const screen = el("div", "calc-screen");
    const mind = el("div", "calc-mind");
    mind.title = "Memory holds a value (MC to clear)";
    const expr = el("div", "calc-expr");
    const value = el("div", "calc-value", "0");
    value.setAttribute("aria-live", "polite");
    screen.append(mind, expr, value);
    display.appendChild(screen);

    // ---------- keypad ----------
    const grid = el("div", "calc-grid");
    function btn(label, area, cls, title, fn) {
      const b = el("button", "calc-btn" + (cls ? " " + cls : ""), label);
      b.type = "button";
      b.title = title || label;
      b.style.gridArea = area;
      b.addEventListener("click", () => { fn(); calc.root.focus(); });
      return b;
    }
    const press = (fn) => () => fn();
    const opBtn = (op, area) => btn(OPS[op], area, "calc-op", "Operator: " + OPS[op], press(() => operator(op)));
    const digBtn = (d, area, cls) => btn(d, area, cls || "calc-digit", "Digit " + d, press(() => digit(d)));
    const gridBtns = [
      btn("MC", "mc", "calc-mem", "Memory clear", press(memClear)),
      btn("MR", "mr", "calc-mem", "Memory recall", press(memRecall)),
      btn("M+", "mp", "calc-mem", "Add to memory", press(memAdd)),
      btn("M−", "mm", "calc-mem", "Subtract from memory", press(memSub)),
      btn("⌫", "bs", "calc-fn", "Backspace", press(backspace)),
      btn("AC", "ac", "calc-danger", "All clear", press(clearAll)),
      btn("√", "sq", "calc-fn", "Square root (S)", press(sqrtFn)),
      btn("±", "pm", "calc-fn", "Toggle sign", press(toggleSign)),
      btn("%", "pc", "calc-fn", "Percent", press(percent)),
      opBtn("/", "dv"),
      digBtn("7", "n7"), digBtn("8", "n8"), digBtn("9", "n9"),
      opBtn("*", "mu"),
      btn("=", "eq", "calc-eq", "Equals (Enter)", press(equals)),
      digBtn("4", "n4"), digBtn("5", "n5"), digBtn("6", "n6"),
      opBtn("-", "su"),
      digBtn("1", "n1"), digBtn("2", "n2"), digBtn("3", "n3"),
      opBtn("+", "ad"),
      digBtn("0", "n0"), btn(".", "dt", "calc-digit", "Decimal point", press(dot)),
    ];
    for (const b of gridBtns) grid.appendChild(b);

    // ---------- keyboard hint ----------
    const hint = el("div", "calc-hint",
      "⌨  digits · . · + − * / · Enter = · Esc clear · Backspace · % · S √");

    calc.root.append(display, grid, hint);

    // ---------- actions ----------
    function render() {
      if (st.error) {
        mind.textContent = st.memory != null ? "M" : "";
        expr.textContent = "";
        value.textContent = "Error";
        value.classList.add("err");
        return;
      }
      value.classList.remove("err");
      mind.textContent = st.memory != null ? "M" : "";
      expr.textContent = st.lastEq || (st.op != null ? fmtNum(st.acc) + " " + OPS[st.op] : "");
      value.textContent = st.entry;
    }
    function resetAll() {
      st.entry = "0"; st.acc = null; st.op = null;
      st.waiting = false; st.justEval = false; st.lastEq = null; st.error = false;
      render();
    }
    function enterError() {
      st.error = true;
      render();
    }
    function digit(d) {
      if (st.error) { resetAll(); }
      const e = st.entry;
      if (st.waiting || st.justEval) {
        st.entry = d; st.waiting = false; st.justEval = false; st.lastEq = null;
      } else if (e === "0") {
        st.entry = d;
      } else if (e === "-0") {
        st.entry = "-" + d;
      } else if (e === "-") {
        st.entry = "-" + d;
      } else if (e.replace(/[^0-9]/g, "").length >= 15) {
        return; // display length cap
      } else {
        st.entry = e + d;
      }
      render();
    }
    function dot() {
      if (st.error) { resetAll(); }
      const e = st.entry;
      if (st.waiting || st.justEval) {
        st.entry = "0."; st.waiting = false; st.justEval = false; st.lastEq = null;
      } else if (e === "-") {
        st.entry = "-0.";
      } else if (!e.includes(".")) {
        st.entry = e + ".";
      }
      render();
    }
    function operator(op) {
      if (st.error) return;
      const v = parseFloat(st.entry || "0");
      if (st.op == null) {
        st.acc = v;
        st.op = op;
        st.waiting = true;
        st.justEval = false;
        st.lastEq = null;
      } else if (st.waiting) {
        st.op = op; // replace a just-pressed operator
      } else {
        const res = applyOp(st.acc, v, st.op);
        if (!isFinite(res)) { enterError(); return; }
        st.acc = res;
        st.entry = fmtNum(res);
        st.op = op;
        st.waiting = true;
        st.justEval = false;
      }
      render();
    }
    function equals() {
      if (st.error || st.op == null) return;
      const b = parseFloat(st.entry || "0");
      const res = applyOp(st.acc, b, st.op);
      if (!isFinite(res)) { enterError(); return; }
      st.lastEq = fmtNum(st.acc) + " " + OPS[st.op] + " " + fmtNum(b) + " =";
      st.entry = fmtNum(res);
      st.acc = null; st.op = null;
      st.waiting = true; st.justEval = true;
      render();
    }
    function percent() {
      if (st.error) return;
      const v = parseFloat(st.entry || "0");
      if (!isFinite(v)) return;
      if (st.op != null && (st.op === "+" || st.op === "-") && st.acc != null) {
        st.entry = fmtNum(st.acc * v / 100); // 200 + 10% -> 200 + 20
      } else {
        st.entry = fmtNum(v / 100);
      }
      render();
    }
    function sqrtFn() {
      if (st.error) return;
      const v = parseFloat(st.entry || "0");
      if (v < 0) { enterError(); return; }
      st.entry = fmtNum(Math.sqrt(v));
      st.justEval = true;
      st.lastEq = null;
      render();
    }
    function toggleSign() {
      if (st.error) return;
      if (st.waiting || st.justEval) {
        st.entry = "-"; st.waiting = false; st.justEval = false; st.lastEq = null;
        render();
        return;
      }
      st.entry = st.entry.startsWith("-")
        ? st.entry.slice(1)
        : (st.entry === "0" ? "0" : "-" + st.entry);
      render();
    }
    function backspace() {
      if (st.error || st.waiting || st.justEval) return;
      const e = st.entry;
      st.entry = (e.length <= 1 || e === "-0" || e === "-") ? "0" : e.slice(0, -1);
      render();
    }
    function clearAll() { resetAll(); }
    function memClear() { st.memory = null; render(); }
    function memRecall() {
      if (st.error || st.memory == null) return;
      st.entry = fmtNum(st.memory);
      st.waiting = false; st.justEval = true; st.lastEq = null;
      render();
    }
    function memAdd() {
      if (st.error) return;
      st.memory = (st.memory == null ? 0 : st.memory) + parseFloat(st.entry || "0");
      render();
    }
    function memSub() {
      if (st.error) return;
      st.memory = (st.memory == null ? 0 : st.memory) - parseFloat(st.entry || "0");
      render();
    }

    // ---------- keyboard input ----------
    // Document-level so it works whether focus sits on the window, a button or
    // the root; only fires while the calculator window is the focused window.
    calc.onKey = function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = ev.key;
      if (/^[0-9]$/.test(k)) { ev.preventDefault(); digit(k); return; }
      switch (k) {
        case ".": case ",": ev.preventDefault(); dot(); break;
        case "+": ev.preventDefault(); operator("+"); break;
        case "-": ev.preventDefault(); operator("-"); break;
        case "*": case "x": case "X": ev.preventDefault(); operator("*"); break;
        case "/": ev.preventDefault(); operator("/"); break;
        case "Enter": case "=": ev.preventDefault(); equals(); break;
        case "Escape": ev.preventDefault(); resetAll(); break;
        case "Backspace": ev.preventDefault(); backspace(); break;
        case "%": ev.preventDefault(); percent(); break;
        case "s": case "S": case "r": case "R": ev.preventDefault(); sqrtFn(); break;
        default: return;
      }
    };
    render();
    calc.root.tabIndex = 0;

    // Mount wiring (same pattern as texteditor.js): the WM window owning this
    // root is created right after the builder returns, so a short timeout finds
    // it reliably and lets keyboard input focus land on the calculator.
    calc.onMount = function () {
      const winEl = calc.root.closest(".window");
      if (!winEl) return;
      const win = (window.WM.windows || []).find((w) => w.el === winEl);
      if (win) {
        calc.w = win;
        active = calc;
        setTimeout(() => calc.root.focus(), 60);
      }
    };
    return calc;
  }

  // ---------- shared document keyboard handler ----------
  // One listener for the app (the window is a singleton): it routes keys to the
  // calculator only while its window is the focused one. Registered once.
  let active = null;
  function onDocKeydown(ev) {
    if (!active) return;
    const w = window.WM && window.WM.getFocused && window.WM.getFocused();
    if (!w || w.closed || w.content !== active.root) return;
    active.onKey(ev);
  }
  if (!window.__calcKeyListener) {
    window.__calcKeyListener = true;
    document.addEventListener("keydown", onDocKeydown);
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["calculator"] = function () {
    const calc = createCalculator();
    setTimeout(() => calc.onMount(), 60);
    return { content: calc.root, w: 340, h: 560, minW: 300, minH: 470 };
  };
})();
