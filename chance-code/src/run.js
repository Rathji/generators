// run.js — the Perchance mini-engine: parses a user's main.pjs with the real
// engine's createPerchanceTree, then evaluates index.html square blocks against it.
// Errors are reported with HTML source line numbers so the Problems panel can jump.

const INTERNAL = new Set([
  "getOdds","getName","getParent","getLength","getRawListText","getSelf",
  "getPropertyKeys","getPropertyNames","getChildNames","getFunctionNames","getAllKeys",
  "toString","toLocaleString","evaluateItem","selectOne","selectAll","selectMany",
  "selectUnique","joinItems","sumItems","valueOf","pluralForm","singularForm","pastTense",
  "presentTense","futureTense","negativeForm","sentenceCase","titleCase","lowerCase",
  "upperCase","replaceText","consumableList","createClone"
]);

export function topNames(tree) {
  const names = new Set();
  for (const k of Object.getOwnPropertyNames(tree)) {
    if (k.startsWith("$")) continue;
    if (INTERNAL.has(k)) continue;
    names.add(k);
  }
  try {
    const fc = tree.$functionChildren;
    if (fc && typeof fc === "object") for (const k of Object.keys(fc)) names.add(k);
  } catch (e) {}
  return [...names];
}

export function baseScope(tree, names) {
  const scope = {};
  for (const k of names) {
    try { scope[k] = tree[k]; } catch (e) { scope[k] = null; }
  }
  return scope;
}

export function buildTree(dsl) {
  try {
    const tree = window.ignorePerchanceErrors(() => window.createPerchanceTree(dsl));
    return { tree, error: null };
  } catch (e) {
    return { tree: null, error: (e && e.message) || String(e) };
  }
}

function str(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && typeof v.evaluateItem === "function") {
    try { return String(v.evaluateItem); } catch (e) { return ""; }
  }
  return String(v);
}

const ALT_RE = /\{([^{}\n]+)\}/g;
function expandAlternations(code) {
  return code.replace(ALT_RE, (m, inner) => {
    const parts = inner.split("|");
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

function jsEval(code, scope, errs, st, label) {
  try {
    return new Function("__scope", "with(__scope){ return (" + code + "); }")(scope);
  } catch (e) {
    errs.push({ line: st ? st.line : 0, msg: (label || "block") + " → " + e.message });
    return undefined;
  }
}

function scanToClose(s, i, open, close) {
  let depth = 0;
  let q = null;
  let esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (esc) { esc = false; }
      else if (c === "\\") { esc = true; }
      else if (c === q) { q = null; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return j; }
  }
  return -1;
}

function parseIfElse(code) {
  const m = /^\s*if\s*\(/.exec(code);
  if (!m) return null;
  const condStart = code.indexOf("(", m.index);
  const condEnd = scanToClose(code, condStart, "(", ")");
  if (condEnd === -1) return null;
  const cond = code.slice(condStart + 1, condEnd);
  let rest = code.slice(condEnd + 1).trim();
  if (!rest.startsWith("{")) return null;
  const tEnd = scanToClose(rest, 0, "{", "}");
  if (tEnd === -1) return null;
  const thenB = rest.slice(1, tEnd);
  rest = rest.slice(tEnd + 1).trim();
  let elseB = "";
  const em = /^else\s*\{/.exec(rest);
  if (em) {
    const ob = rest.indexOf("{");
    const eEnd = scanToClose(rest, ob, "{", "}");
    if (eEnd !== -1) elseB = rest.slice(ob + 1, eEnd);
  }
  return { cond, thenB, elseB };
}

export function evalBlock(code, scope, errs, st) {
  code = code.trim();
  if (!code) return "";
  code = expandAlternations(code);
  const ie = parseIfElse(code);
  if (ie) {
    const cond = !!jsEval(ie.cond, scope, errs, st, "if condition");
    return evalBranch(cond ? ie.thenB : ie.elseB, scope, errs, st);
  }
  const result = jsEval(code, scope, errs, st, "[" + code.slice(0, 50) + "]");
  return str(result);
}

function evalBranch(content, scope, errs, st) {
  content = content.trim();
  if (!content) return "";
  const q0 = content[0];
  if ((q0 === '"' || q0 === "'") && content.endsWith(q0)) {
    return evalStringBlocks(content.slice(1, -1), scope, errs, st);
  }
  return evalBlock(content, scope, errs, st);
}

export function evalStringBlocks(text, scope, errs, st) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && (text[i + 1] === "[" || text[i + 1] === "{")) {
      out += text[i + 1]; i += 2; continue;
    }
    if (c === "[") {
      const end = scanToClose(text, i, "[", "]");
      if (end === -1) { out += text.slice(i); break; }
      const code = text.slice(i + 1, end);
      out += evalBlock(code, scope, errs, st);
      i = end + 1;
      continue;
    }
    if (c === "{") {
      const end = text.indexOf("}", i + 1);
      if (end === -1) { out += text.slice(i); break; }
      const inner = text.slice(i + 1, end);
      if (!inner.includes("|")) { out += text.slice(i, end + 1); i = end + 1; continue; }
      const parts = inner.split("|");
      out += parts[Math.floor(Math.random() * parts.length)];
      i = end + 1;
      continue;
    }
    if (c === "\n" && st) st.line++;
    out += c;
    i++;
  }
  return out;
}

function evalCodeSection(text, scope, errs, st) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && text[i + 1] === "[") { out += "["; i += 2; continue; }
    if (c === "[") {
      const end = scanToClose(text, i, "[", "]");
      if (end === -1) { out += text.slice(i); break; }
      const code = text.slice(i + 1, end);
      out += evalBlock(code, scope, errs, st);
      i = end + 1;
      continue;
    }
    if (c === "\n" && st) st.line++;
    out += c;
    i++;
  }
  return out;
}

function splitSections(html) {
  const sections = [];
  const re = /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let last = 0, m;
  while ((m = re.exec(html))) {
    if (m.index > last) sections.push({ type: "text", text: html.slice(last, m.index), absStart: last });
    sections.push({ type: "code", text: m[0], absStart: m.index });
    last = m.index + m[0].length;
  }
  if (last < html.length) sections.push({ type: "text", text: html.slice(last), absStart: last });
  return sections;
}

export function evaluateTemplate(html, tree, extraVars = {}) {
  const top = topNames(tree);
  const scope = { ...baseScope(tree, top), ...extraVars };
  const errs = [];
  const sections = splitSections(html);
  let out = "";
  let consumed = 0;
  for (const { type, text, absStart } of sections) {
    const st = { line: absStart === 0 ? 1 : html.slice(0, absStart).split("\n").length };
    const res = type === "text" ? evalStringBlocks(text, scope, errs, st) : evalCodeSection(text, scope, errs, st);
    out += res;
    consumed += text.length;
  }
  return { html: out, errors: errs, scope };
}

export function renderProject(files, extraVars = {}) {
  const out = { errors: [], html: null, tree: null, pjsError: null, scope: null, ok: false };
  const dsl = (files["main.pjs"] || "").trim();
  const html = files["index.html"] || "";
  if (!dsl && !html) {
    out.pjsError = "The workspace has no main.pjs or index.html yet. Create one and press Run.";
    return out;
  }
  const { tree, error } = buildTree(dsl);
  if (error) { out.pjsError = error; return out; }
  if (!tree) { out.pjsError = "Could not parse main.pjs into a tree."; return out; }
  out.tree = tree;
  const tpl = evaluateTemplate(html, tree, extraVars);
  out.html = tpl.html;
  out.errors = tpl.errors;
  out.scope = tpl.scope;
  out.ok = !out.pjsError && out.errors.length === 0;
  return out;
}

export function evalAgainstTree(expr, tree, extraVars = {}) {
  const top = topNames(tree);
  const scope = { ...baseScope(tree, top), ...extraVars };
  const errs = [];
  const st = { line: 0 };
  const result = jsEval(expr.trim(), scope, errs, st, "eval");
  return { text: str(result), errors: errs };
}
