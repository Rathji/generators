const DEF_RE = /^(\s*)([A-Za-z_$][\w$.-]*)\s*=\s*(.*?)\s*$/;
const FN_RE = /^(\s*)(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:\([^)]*\))?\s*=>\s*$/;
const HEADER_RE = /^(\s*)([A-Za-z_$][\w$.-]*)\s*$/;
const IMPORT_RE = /^\{\s*import:\s*([\w-]+)\s*\}$/;

function indentOf(line) {
  const m = /^(\s*)/.exec(line);
  let n = 0;
  for (const ch of m[1]) n += ch === "\t" ? 4 : 1;
  return n;
}

function makeNode(name, kind, value, depth, line) {
  return { name, kind, value: value || "", preview: "", depth, line, children: [], items: 0, body: [] };
}

function previewOf(value) {
  const v = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return v.length > 80 ? v.slice(0, 77) + "…" : v;
}

function nextContentIndent(lines, from) {
  for (let j = from + 1; j < lines.length; j++) {
    if (lines[j].trim() === "") continue;
    return indentOf(lines[j]);
  }
  return -1;
}

export function parsePjsTree(code) {
  const lines = String(code == null ? "" : code).split(/\r?\n/);
  const roots = [];
  const stack = [];
  let fnNode = null;
  let fnIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const indent = indentOf(raw);
    const trimmed = raw.trim();

    if (fnNode) {
      if (indent > fnIndent) { fnNode.body.push(raw); continue; }
      fnNode = null;
      fnIndent = -1;
    }

    let m = DEF_RE.exec(raw);
    if (m) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].node : null;
      const importMatch = IMPORT_RE.exec(m[3]);
      let kind = importMatch ? "import" : "value";
      if (m[2] === "$output") kind = "output";
      const node = makeNode(m[2], kind, importMatch ? importMatch[1] : m[3], stack.length, i + 1);
      node.preview = importMatch ? "import:" + importMatch[1] : previewOf(m[3]);
      if (parent) parent.children.push(node); else roots.push(node);
      stack.push({ indent, node });
      continue;
    }

    m = FN_RE.exec(raw);
    if (m) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].node : null;
      const node = makeNode(m[2], "function", "", stack.length, i + 1);
      node.preview = "function";
      if (parent) parent.children.push(node); else roots.push(node);
      stack.push({ indent, node });
      fnNode = node;
      fnIndent = indent;
      continue;
    }

    m = HEADER_RE.exec(raw);
    if (m && /^[A-Za-z_$]/.test(trimmed) && nextContentIndent(lines, i) > indent) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].node : null;
      const kind = trimmed === "$meta" ? "meta" : "list";
      const node = makeNode(trimmed, kind, "", stack.length, i + 1);
      node.preview = kind === "meta" ? "metadata" : "list";
      if (parent) parent.children.push(node); else roots.push(node);
      stack.push({ indent, node });
      continue;
    }

    if (stack.length) {
      let node = null;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].node.kind === "list" || stack[s].node.kind === "meta") { node = stack[s].node; break; }
      }
      if (node) node.items++;
    }
  }

  return roots;
}

function walk(nodes, fn) {
  for (const n of nodes) {
    fn(n);
    if (n.children.length) walk(n.children, fn);
  }
}

export function listNames(tree) {
  const out = [];
  walk(tree, n => { if (n.kind === "list") out.push(n.name); });
  return out;
}

export function functionNames(tree) {
  const out = [];
  walk(tree, n => { if (n.kind === "function") out.push(n.name); });
  return out;
}

export function generatorImports(code) {
  const out = [];
  const seen = new Set();
  for (const line of String(code == null ? "" : code).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_$][\w$.-]*)\s*=\s*\{\s*import:\s*([\w-]+)\s*\}/.exec(line);
    if (m && !seen.has(m[1])) { seen.add(m[1]); out.push({ alias: m[1], name: m[2] }); }
  }
  return out;
}

export function generatorMeta(code) {
  const lines = String(code == null ? "" : code).split(/\r?\n/);
  const idx = lines.findIndex(l => l.trim() === "$meta");
  const meta = {};
  if (idx === -1) return meta;
  const baseIndent = indentOf(lines[idx]);
  let current = null;
  for (let i = idx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const indent = indentOf(raw);
    if (indent <= baseIndent) break;
    const m = /^\s*([\w-]+)\s*=\s*(.*)$/.exec(raw);
    if (m) {
      current = m[1];
      meta[current] = m[2].trim();
    } else if (current && /^\s+\S/.test(raw)) {
      meta[current] = (meta[current] ? meta[current] + " " : "") + raw.trim();
    }
  }
  return meta;
}

export function generatorOverview(code) {
  const tree = parsePjsTree(code);
  const imports = generatorImports(code);
  const meta = generatorMeta(code);
  let nodeCount = 0;
  walk(tree, () => { nodeCount++; });
  return {
    tree,
    imports,
    meta,
    lists: listNames(tree),
    functions: functionNames(tree),
    hasOutput: tree.some(n => n.kind === "output") || /^\s*\$output\s*=/m.test(String(code || "")),
    nodeCount
  };
}

export function treeToText(tree, options = {}) {
  const maxDepth = options.maxDepth != null ? options.maxDepth : 6;
  const showValues = options.showValues !== false;
  const lines = [];
  const visit = (nodes, depth) => {
    if (depth > maxDepth) return;
    for (const n of nodes) {
      const pad = "  ".repeat(depth);
      let tag = n.kind;
      if (n.kind === "list" && n.items) tag = "list, " + n.items + " item" + (n.items === 1 ? "" : "s");
      if (n.kind === "import") tag = "import:" + n.value;
      let line = pad + n.name + "  [" + tag + "]";
      if (showValues && n.preview && n.kind !== "function" && n.kind !== "list" && n.kind !== "meta") line += "  " + n.preview;
      lines.push(line);
      if (n.children.length) visit(n.children, depth + 1);
    }
  };
  visit(tree, 0);
  return lines.join("\n");
}

export function overviewSummary(overview) {
  if (!overview) return "";
  const bits = [];
  bits.push(overview.lists.length + " list" + (overview.lists.length === 1 ? "" : "s"));
  bits.push(overview.functions.length + " function" + (overview.functions.length === 1 ? "" : "s"));
  if (overview.imports.length) bits.push(overview.imports.length + " import" + (overview.imports.length === 1 ? "" : "s"));
  return bits.join(" · ");
}

export function extractGeneratorName(input) {
  let s = String(input == null ? "" : input).trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  let m = s.match(/^([a-z0-9-]+)\.perchance\.org/);
  if (m) return m[1];
  m = s.match(/(?:^|\/)perchance\.org\/([a-z0-9-]+)/);
  if (m) return m[1];
  s = s.replace(/\/+$/, "");
  return s.split(/[/?#]/)[0].trim();
}

export function generatorApiUrl(name) {
  return "https://perchance.org/api/getGeneratorsAndDependencies?generatorNames=" + encodeURIComponent(name);
}

export function generatorHtmlUrl(name) {
  return "https://perchance.org/api/getGeneratorHtml?generatorName=" + encodeURIComponent(name);
}

export function generatorPageUrl(name) {
  return "https://perchance.org/" + name;
}

export function generatorPreviewUrl(name) {
  return "https://null.perchance.org/" + name;
}
