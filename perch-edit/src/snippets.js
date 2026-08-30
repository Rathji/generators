import { autocompletion, snippetCompletion, acceptCompletion } from "https://esm.sh/@codemirror/autocomplete@%5E6.0.0?target=es2022";
import { keymap } from "https://esm.sh/@codemirror/view@%5E6.0.0?target=es2022";
import { store, bus } from "./store.js";

export const SNIPPETS_PATH = ".vscode/snippets.json";

const S = (template, label, detail) => snippetCompletion(template, { label, detail, type: "snippet" });

const JS_SNIPPETS = [
  S("console.log(${1:value});", "clg", "console.log"),
  S("function ${1:name}(${2:params}) {\n  ${3}\n}", "fun", "function declaration"),
  S("async function ${1:name}(${2:params}) {\n  ${3}\n}", "afun", "async function"),
  S("(${1:params}) => ${2:value}", "arr", "arrow function"),
  S("if (${1:condition}) {\n  ${2}\n}", "if", "if statement"),
  S("if (${1:condition}) {\n  ${2}\n} else {\n  ${3}\n}", "ifel", "if/else"),
  S("for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n  ${3}\n}", "for", "for loop"),
  S("for (const ${1:item} of ${2:items}) {\n  ${3}\n}", "forof", "for...of"),
  S("for (const ${1:key} in ${2:obj}) {\n  ${3}\n}", "forin", "for...in"),
  S("try {\n  ${1}\n} catch (${2:err}) {\n  ${3}\n}", "tryc", "try/catch"),
  S("class ${1:Name} {\n  ${2}\n}", "cl", "class"),
  S("import { ${1:name} } from '${2:module}';", "imp", "import"),
  S("export ${1:const} ${2:name};", "exp", "export"),
  S("new Promise((resolve, reject) => {\n  ${1}\n});", "prom", "Promise"),
  S("setTimeout(() => {\n  ${1}\n}, ${2:ms});", "st", "setTimeout"),
];

const HTML_SNIPPETS = [
  S("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>${1:Document}</title>\n</head>\n<body>\n  ${2}\n</body>\n</html>", "!doc", "HTML5 skeleton"),
  S("<img src=\"${1:img.png}\" alt=\"${2:description}\">", "img", "image"),
  S("<link rel=\"stylesheet\" href=\"${1:style.css}\">", "link", "stylesheet link"),
  S("<script src=\"${1:app.js}\"></script>", "script", "script tag"),
  S("<a href=\"${1:https://example.com}\">${2:link text}</a>", "a", "anchor"),
  S("<button type=\"button\" onclick=\"${1}\">${2:Button}</button>", "btn", "button"),
  S("<input type=\"text\" id=\"${1}\" name=\"${1}\" placeholder=\"${2}\">", "input", "text input"),
  S("<form action=\"${1}\" method=\"post\">\n  ${2}\n</form>", "form", "form"),
  S("<div class=\"${1:container}\">\n  ${2}\n</div>", "divc", "div with class"),
];

const CSS_SNIPPETS = [
  S("display: flex;\njustify-content: ${1:center};\nalign-items: ${2:center};", "df", "flex display"),
  S("display: grid;\ngrid-template-columns: ${1:repeat(auto-fit, minmax(200px, 1fr))};", "dg", "grid display"),
  S("margin: 0 auto;", "mx", "center horizontally"),
  S("font-size: ${1:16px};", "fs", "font size"),
  S("background-color: ${1:#fff};", "bc", "background color"),
  S("color: ${1:#333};", "c", "color"),
  S("position: relative;\ntop: ${1:0};\nleft: ${2:0};", "pos", "position"),
  S("border: 1px solid ${1:#ccc};", "b", "border"),
  S("padding: ${1:12px};", "p", "padding"),
  S("margin: ${1:12px};", "m", "margin"),
];

const SNIPPETS_BY_LANG = { js: JS_SNIPPETS, html: HTML_SNIPPETS, css: CSS_SNIPPETS };

let userSnippets = { js: [], html: [], css: [], any: [] };
let badJsonLogged = false;

function scopeLang(scope) {
  const s = String(scope || "").toLowerCase();
  if (/js|javascript/.test(s)) return "js";
  if (/html/.test(s)) return "html";
  if (/css|scss|less/.test(s)) return "css";
  return "any";
}

export function loadUserSnippets() {
  userSnippets = { js: [], html: [], css: [], any: [] };
  let raw = null;
  try {
    raw = store.vfs.read(SNIPPETS_PATH);
  } catch (e) {
    return;
  }
  if (!raw) {
    badJsonLogged = false;
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
    badJsonLogged = false;
  } catch (e) {
    if (!badJsonLogged) {
      badJsonLogged = true;
      console.warn("snippets: " + SNIPPETS_PATH + " is not valid JSON — ignoring");
    }
    return;
  }
  if (!data || typeof data !== "object") return;
  for (const [name, def] of Object.entries(data)) {
    if (!def || typeof def !== "object") continue;
    const prefix = String(def.prefix ?? name);
    const body = Array.isArray(def.body) ? def.body.join("\n") : String(def.body ?? "");
    if (!body.trim()) continue;
    const comp = snippetCompletion(body, { label: prefix, detail: def.description || name, type: "snippet" });
    userSnippets[scopeLang(def.scope)].push(comp);
  }
}

export function initSnippets() {
  loadUserSnippets();
  bus.on("docchange", (path) => {
    if (path === SNIPPETS_PATH) loadUserSnippets();
  });
  bus.on("saved", (path) => {
    if (path === SNIPPETS_PATH) loadUserSnippets();
  });
}

export function langForPath(path) {
  if (!path) return null;
  const ov = store.langOverride && store.langOverride[path];
  if (ov && ov !== "auto") {
    const l = ov.toLowerCase();
    if (l.includes("javascript") || l === "js") return "js";
    if (l.includes("html")) return "html";
    if (l.includes("css") || l.includes("scss") || l.includes("less")) return "css";
    return null;
  }
  const name = String(path).split("/").pop().toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  if (/^(js|mjs|cjs|jsx|ts|tsx)$/.test(ext)) return "js";
  if (/^(html?|htm)$/.test(ext)) return "html";
  if (/^(css|scss|less)$/.test(ext)) return "css";
  return null;
}

const SNIPPET_DEFAULTS = `{
  "Example log": {
    "prefix": "myLog",
    "body": ["console.log('Hello from my snippet: ' + \${1:value});"],
    "description": "My custom log snippet"
  }
}
`;

export function openSnippetsFile() {
  let content = store.vfs.read(SNIPPETS_PATH);
  if (content === null) {
    content = SNIPPET_DEFAULTS;
    store.vfs.write(SNIPPETS_PATH, content);
  }
  return SNIPPETS_PATH;
}

function mergeSource(context) {
  const word = context.matchBefore(/[\w!]*$/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const lang = langForPath(store.activePath);
  const opts = [];
  let from = word.from;
  for (const src of context.state.languageDataAt("autocomplete", context.pos)) {
    let res = null;
    try {
      res = src(context);
    } catch (e) {
      continue;
    }
    if (res && Array.isArray(res.options)) {
      opts.push(...res.options);
      if (typeof res.from === "number" && res.from < from) from = res.from;
    }
  }
  const snips = [
    ...(SNIPPETS_BY_LANG[lang] || []),
    ...(userSnippets[lang] || []),
    ...(userSnippets.any || []),
  ];
  opts.push(...snips);
  const seen = new Set();
  const uniq = [];
  for (const o of opts) {
    if (o && typeof o.label === "string" && !seen.has(o.label)) {
      seen.add(o.label);
      uniq.push(o);
    }
  }
  return { from, options: uniq, validFor: /^[\w!]*$/ };
}

export function snippetExtension() {
  return [
    autocompletion({ override: [mergeSource], activateOnTyping: false }),
    keymap.of([{ key: "Tab", run: acceptCompletion }]),
  ];
}
