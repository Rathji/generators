// ============================================================================
//  FORMULA PARSER & EVALUATOR  (T8 — Formula Parser)
//
//  A small spreadsheet formula engine: strings starting with "=" are parsed
//  and evaluated against a cell-lookup function, so it works over any grid
//  (src/grid.js) without knowing its shape.
//
//  Grammar (recursive descent, standard operator precedence):
//    expression := term (('+'|'-') term)*
//    term       := factor (('*'|'/') factor)*
//    factor     := ('-'|'+') factor | primary
//    primary    := NUMBER | CELL_REF | FUNC '(' argList ')' | '(' expression ')'
//    argList    := arg (',' arg)*
//    arg        := CELL_REF ':' CELL_REF | expression
//
//  Functions: SUM, AVERAGE, MIN, MAX, COUNT. Args accept ranges (A1:B3),
//  single references, numbers, and whole expressions.
//
//  Cell semantics (Excel-ish):
//    - numeric cells resolve to their number; empty cells and non-numeric text
//      coerce to 0 inside arithmetic;
//    - SUM/AVERAGE/MIN/MAX/COUNT ignore empty and text cells;
//    - a bare reference to a text cell passes the text through; a bare
//      reference to an empty cell is 0;
//    - a cell containing another formula resolves recursively (cycle-guarded);
//    - errors are returned as strings: "#ERROR!", "#DIV/0!", "#CYCLE!", "#NAME?",
//      "#NUM!".
//
//  Pure module — no DOM.
// ============================================================================

import { cellToRC, rcToCell } from "./grid.js";

/** True when `value` is a formula string (starts with "=", more than just "="). */
export function isFormula(value) {
  return typeof value === "string" && value.length > 1 && value.charAt(0) === "=";
}

// Internal value records: {t:"num",v} | {t:"text",v} | {t:"empty"} | {t:"err",v}
const ERR = (code) => ({ t: "err", v: code });

/** Wrap a number, cleaning float noise (0.1+0.2 -> 0.3); non-finite -> #NUM!. */
function numRec(n) {
  if (typeof n !== "number" || !isFinite(n)) return ERR("#NUM!");
  const p = Number(n.toPrecision(12));
  return { t: "num", v: Object.is(p, -0) ? 0 : p };
}

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ("+-*/():,".includes(ch)) {
      toks.push({ type: ch, value: ch });
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      toks.push({ type: "num", value: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const cell = /^[A-Za-z]+[0-9]+/.exec(src.slice(i));
      if (cell) {
        toks.push({ type: "ref", value: cell[0].toUpperCase() });
        i += cell[0].length;
      } else {
        const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        toks.push({ type: "name", value: name[0].toUpperCase() });
        i += name[0].length;
      }
      continue;
    }
    return null; // illegal character
  }
  toks.push({ type: "end", value: "" });
  return toks;
}

class Parser {
  constructor(toks) {
    this.toks = toks;
    this.i = 0;
  }
  peek() {
    return this.toks[this.i];
  }
  next() {
    return this.toks[this.i++];
  }
  expect(type) {
    const t = this.next();
    if (t.type !== type) throw new Error("expected " + type + ", got " + t.type);
    return t;
  }
  parseExpression() {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.type === "+" || t.type === "-") {
        this.next();
        left = { type: "bin", op: t.type, left, right: this.parseTerm() };
      } else return left;
    }
  }
  parseTerm() {
    let left = this.parseFactor();
    for (;;) {
      const t = this.peek();
      if (t.type === "*" || t.type === "/") {
        this.next();
        left = { type: "bin", op: t.type, left, right: this.parseFactor() };
      } else return left;
    }
  }
  parseFactor() {
    const t = this.peek();
    if (t.type === "-" || t.type === "+") {
      this.next();
      return { type: "unary", op: t.type, operand: this.parseFactor() };
    }
    if (t.type === "num") {
      this.next();
      return { type: "num", value: t.value };
    }
    if (t.type === "ref") {
      this.next();
      return { type: "ref", ref: t.value };
    }
    if (t.type === "(") {
      this.next();
      const inner = this.parseExpression();
      this.expect(")");
      return inner;
    }
    if (t.type === "name") {
      const name = t.value;
      this.next();
      this.expect("(");
      const args = this.parseArgs();
      this.expect(")");
      return { type: "func", name, args };
    }
    throw new Error("unexpected token: " + t.type);
  }
  parseArgs() {
    const args = [];
    if (this.peek().type === ")") return args;
    for (;;) {
      args.push(this.parseArg());
      if (this.peek().type === ",") {
        this.next();
        continue;
      }
      return args;
    }
  }
  parseArg() {
    if (this.peek().type === "ref") {
      const first = this.toks[this.i].value;
      const nextTok = this.toks[this.i + 1];
      if (nextTok && nextTok.type === ":") {
        this.next(); // ref
        this.next(); // :
        const endTok = this.expect("ref");
        return { type: "range", a: first, b: endTok.value };
      }
    }
    return { type: "expr", node: this.parseExpression() };
  }
  expectEnd() {
    if (this.peek().type !== "end") throw new Error("trailing tokens");
  }
}

const parseCache = new Map();

function parseBody(body) {
  if (parseCache.has(body)) return parseCache.get(body);
  let ast = null;
  const toks = tokenize(body);
  if (toks) {
    try {
      const p = new Parser(toks);
      const node = p.parseExpression();
      p.expectEnd();
      ast = node;
    } catch {
      ast = null;
    }
  }
  parseCache.set(body, ast);
  return ast;
}

function evalNode(node, lookup, stack, depth) {
  if (depth > 64) return ERR("#ERROR!");
  switch (node.type) {
    case "num":
      return numRec(node.value);
    case "ref":
      return resolveRef(node.ref, lookup, stack, depth);
    case "unary": {
      const r = evalNode(node.operand, lookup, stack, depth + 1);
      if (r.t === "err") return r;
      const n = r.t === "num" ? r.v : 0;
      return numRec(node.op === "-" ? -n : +n);
    }
    case "bin": {
      const l = evalNode(node.left, lookup, stack, depth + 1);
      if (l.t === "err") return l;
      const r = evalNode(node.right, lookup, stack, depth + 1);
      if (r.t === "err") return r;
      const a = l.t === "num" ? l.v : 0;
      const b = r.t === "num" ? r.v : 0;
      if (node.op === "+") return numRec(a + b);
      if (node.op === "-") return numRec(a - b);
      if (node.op === "*") return numRec(a * b);
      if (b === 0) return ERR("#DIV/0!");
      return numRec(a / b);
    }
    case "func": {
      const cells = [];
      for (const arg of node.args) {
        if (arg.type === "range") {
          const range = rangeCells(arg.a, arg.b, lookup, stack, depth + 1);
          if (range.err) return range.err;
          for (const cell of range.cells) cells.push(cell);
        } else {
          const r = evalNode(arg.node, lookup, stack, depth + 1);
          if (r.t === "err") return r;
          cells.push(r);
        }
      }
      return callFunction(node.name, cells);
    }
    default:
      return ERR("#ERROR!");
  }
}

function resolveRef(ref, lookup, stack, depth) {
  if (stack.has(ref)) return ERR("#CYCLE!");
  let raw;
  try {
    raw = lookup(ref);
  } catch {
    raw = "";
  }
  if (typeof raw === "number") return numRec(raw);
  if (typeof raw === "boolean") return numRec(raw ? 1 : 0);
  if (typeof raw === "string") {
    if (isFormula(raw)) {
      const ast = parseBody(raw.slice(1));
      if (!ast) return ERR("#ERROR!");
      stack.add(ref);
      try {
        return evalNode(ast, lookup, stack, depth + 1);
      } finally {
        stack.delete(ref);
      }
    }
    const s = raw.trim();
    if (s === "") return { t: "empty" };
    if (/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
      const n = Number(s);
      if (isFinite(n)) return numRec(n);
    }
    return { t: "text", v: raw };
  }
  return { t: "empty" };
}

const MAX_RANGE_CELLS = 100000;

function rangeCells(a, b, lookup, stack, depth) {
  const ra = cellToRC(a);
  const rb = cellToRC(b);
  if (!ra || !rb) return { err: ERR("#ERROR!") };
  const r0 = Math.min(ra.row, rb.row);
  const r1 = Math.max(ra.row, rb.row);
  const c0 = Math.min(ra.col, rb.col);
  const c1 = Math.max(ra.col, rb.col);
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_RANGE_CELLS) return { err: ERR("#NUM!") };
  const cells = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = resolveRef(rcToCell(r, c), lookup, stack, depth);
      if (cell.t === "err") return { err: cell };
      cells.push(cell);
    }
  }
  return { cells };
}

function callFunction(name, cells) {
  const nums = [];
  for (const cell of cells) {
    if (cell.t === "num") nums.push(cell.v);
  }
  if (name === "SUM") {
    let total = 0;
    for (const n of nums) total += n;
    return numRec(total);
  }
  if (name === "AVERAGE") {
    if (nums.length === 0) return ERR("#DIV/0!");
    let total = 0;
    for (const n of nums) total += n;
    return numRec(total / nums.length);
  }
  if (name === "MIN") {
    if (nums.length === 0) return { t: "num", v: 0 };
    let best = nums[0];
    for (let i = 1; i < nums.length; i++) if (nums[i] < best) best = nums[i];
    return numRec(best);
  }
  if (name === "MAX") {
    if (nums.length === 0) return { t: "num", v: 0 };
    let best = nums[0];
    for (let i = 1; i < nums.length; i++) if (nums[i] > best) best = nums[i];
    return numRec(best);
  }
  if (name === "COUNT") {
    return { t: "num", v: nums.length };
  }
  return ERR("#NAME?");
}

/**
 * Evaluate a formula string (starting with "=") against a cell lookup.
 * `lookup(ref)` returns the raw stored value of a cell ("" when empty).
 * Returns a number for numeric results, or a string (text passthrough or an
 * error like "#DIV/0!"). Throws a TypeError if `formula` does not start with "=".
 */
export function evaluateFormula(formula, lookup) {
  if (typeof formula !== "string" || formula.charAt(0) !== "=") {
    throw new TypeError("evaluateFormula expects a formula string starting with '='");
  }
  const ast = parseBody(formula.slice(1));
  if (!ast) return "#ERROR!";
  const r = evalNode(ast, lookup, new Set(), 0);
  if (r.t === "num") return r.v;
  if (r.t === "text") return r.v;
  if (r.t === "err") return r.v;
  return 0; // bare reference to an empty cell -> 0 (Excel behavior)
}

/**
 * What a cell should display: {value, isNumber}. Non-formulas pass through
 * untouched; formulas are evaluated. `isNumber` drives right-alignment.
 */
export function displayValue(value, lookup) {
  if (isFormula(value)) {
    const r = evaluateFormula(value, lookup);
    return { value: r, isNumber: typeof r === "number" };
  }
  return { value, isNumber: typeof value === "number" };
}
