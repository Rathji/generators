const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "link", "meta", "base", "title",
  "iframe", "form", "button", "input", "select", "textarea", "object", "embed",
  "svg", "canvas", "video", "audio", "track", "source", "map", "area", "param"
]);

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "caption", "center", "dd", "details",
  "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main",
  "menu", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul"
]);

const HARD_BREAK = "\u0001BR\u0001";
const HARD_BREAK_RE = /\u0001BR\u0001/g;
const TOKEN_RE = /\u0000(\d+)\u0000/g;

export const CONVERT_DEFAULTS = {
  baseUrl: "",
  includeImages: true,
  includeLinks: true,
  linkMode: "absolute",
  bullet: "-"
};

function stash(ctx, value) {
  const index = ctx.stash.push(value) - 1;
  return "\u0000" + index + "\u0000";
}

function unstash(text, ctx) {
  return text.replace(TOKEN_RE, (match, index) => {
    const value = ctx.stash[Number(index)];
    return value == null ? "" : value;
  });
}

function isBlockTag(tag) {
  return BLOCK_TAGS.has(tag);
}

function isBlockNode(node) {
  return node.nodeType === 1 && isBlockTag(node.tagName.toLowerCase());
}

function resolveUrl(raw, baseUrl, mode) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) return "";
  if (/^(?:data|mailto|tel|sms|cid):/i.test(value)) return value;
  if (/^#/.test(value)) return value;
  if (mode === "relative" || !baseUrl) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch (err) {
    return value;
  }
}

function escapeText(text, lineStart) {
  let s = String(text);
  s = s.replace(/\\/g, "\\\\")
       .replace(/([`*\[\]])/g, "\\$1")
       .replace(/</g, "\\<")
       .replace(/(^|[\s(])_(?=\S)/g, "$1\\_")
       .replace(/_($|[\s).,!?;:])/g, "\\_$1");
  if (lineStart) {
    s = s.replace(/^(\s*)([#>+\-=])(\s)/, (match, ws, marker, space) => ws + "\\" + marker + space);
    s = s.replace(/^(\s*)(\d+)([.)])(\s)/, (match, ws, digits, delim, space) => ws + digits + "\\" + delim + space);
  }
  return s;
}

function cleanInline(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function wrapInline(inner, delimiter) {
  const lead = (inner.match(/^\s+/) || [""])[0];
  const trail = (inner.match(/\s+$/) || [""])[0];
  const core = inner.slice(lead.length, inner.length - trail.length);
  if (!core) return inner;
  return lead + delimiter + core + delimiter + trail;
}

function inlineCode(ctx, text) {
  let value = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (!value) return "";
  let fence = "`";
  if (value.includes("`")) fence = value.includes("``") ? "```" : "``";
  const pad = /^`|`$|^ /.test(value) || / $/.test(value) ? " " : "";
  return stash(ctx, fence + pad + value + pad + fence);
}

function hrefMarkdown(url) {
  if (!url) return "";
  if (/[\s()<>]/.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url)) return "<" + url + ">";
  if (/\s/.test(url)) return "<" + url + ">";
  return url;
}

function convertImage(node, ctx, lineStart) {
  if (!ctx.opts.includeImages) return "";
  let src = node.getAttribute("src") || "";
  const dataSrc = node.getAttribute("data-src") || node.getAttribute("data-original") || "";
  if (dataSrc && (!src || /^data:image\/(?:gif|png);base64,/i.test(src))) src = dataSrc;
  if (!src) return "";
  const resolved = resolveUrl(src, ctx.opts.baseUrl, ctx.opts.linkMode);
  const alt = (node.getAttribute("alt") || "").replace(/\s+/g, " ").replace(/([\[\]])/g, "\\$1").replace(HARD_BREAK_RE, " ");
  const title = (node.getAttribute("title") || "").replace(/\s+/g, " ").replace(/"/g, '\\"').replace(HARD_BREAK_RE, " ");
  return "![" + alt + "](" + hrefMarkdown(resolved) + (title ? ` "${title}"` : "") + ")";
}

function isPermalinkGlyph(text) {
  return /^(?:[¶§#\^*]|\u200b)+$/.test(text);
}

function isFootnoteable(url) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

function footnoteMarker(ctx, url, title) {
  const key = url + "\n" + title;
  let index = ctx.footnoteIndex.get(key);
  if (!index) {
    index = ctx.footnotes.push({ url, title });
    ctx.footnoteIndex.set(key, index);
  }
  return "[^" + index + "]";
}

function convertLink(node, ctx, lineStart) {
  const rawHref = node.getAttribute("href") || "";
  const inner = convertInlineNodes(Array.from(node.childNodes), ctx, lineStart);
  if (isPermalinkGlyph(cleanInline(inner))) return "";
  if (!ctx.opts.includeLinks) return inner;
  if (!rawHref || /^\s*javascript:/i.test(rawHref) || /^#?$/.test(rawHref.trim())) {
    return cleanInline(inner);
  }
  const resolved = resolveUrl(rawHref, ctx.opts.baseUrl, ctx.opts.linkMode);
  const lead = (inner.match(/^\s+/) || [""])[0];
  const trail = (inner.match(/\s+$/) || [""])[0];
  let core = inner.slice(lead.length, inner.length - trail.length).trim();
  if (!core) core = resolved;
  const title = (node.getAttribute("title") || "").replace(/"/g, '\\"').replace(HARD_BREAK_RE, " ");
  if (ctx.opts.linkMode === "footnote" && isFootnoteable(resolved)) {
    return lead + core + footnoteMarker(ctx, resolved, title) + trail;
  }
  return lead + "[" + core + "](" + hrefMarkdown(resolved) + (title ? ` "${title}"` : "") + ")" + trail;
}

function convertInlineNode(node, ctx, lineStart) {
  if (node.nodeType === 3) {
    const value = node.nodeValue || "";
    if (!value) return "";
    if (!/\S/.test(value)) return /\s/.test(value) ? " " : "";
    return escapeText(value.replace(/\s+/g, " "), lineStart);
  }
  if (node.nodeType !== 1) return "";

  const tag = node.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return "";
  if (isBlockTag(tag)) {
    const block = convertBlock(node, ctx);
    return block ? "\n\n" + block + "\n\n" : "";
  }

  switch (tag) {
    case "br": return HARD_BREAK;
    case "wbr": return "";
    case "img": return convertImage(node, ctx, lineStart);
    case "a": return convertLink(node, ctx, lineStart);
    case "code": return inlineCode(ctx, node.textContent || "");
    case "strong":
    case "b": return wrapInline(convertInlineNodes(Array.from(node.childNodes), ctx, lineStart), "**");
    case "em":
    case "i": return wrapInline(convertInlineNodes(Array.from(node.childNodes), ctx, lineStart), "*");
    case "del":
    case "s":
    case "strike": return wrapInline(convertInlineNodes(Array.from(node.childNodes), ctx, lineStart), "~~");
    case "sub":
    case "sup": return convertInlineNodes(Array.from(node.childNodes), ctx, lineStart);
    default: return convertInlineNodes(Array.from(node.childNodes), ctx, lineStart);
  }
}

function convertInlineNodes(nodes, ctx, lineStart) {
  let out = "";
  let pendingLineStart = !!lineStart;
  for (const node of nodes) {
    const piece = convertInlineNode(node, ctx, pendingLineStart);
    out += piece;
    if (/\S/.test(piece)) pendingLineStart = false;
  }
  return out;
}

function convertChildren(el, ctx) {
  return convertInlineNodes(Array.from(el.childNodes), ctx, true);
}

function convertBlocks(root, ctx) {
  const parts = [];
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const text = cleanInline(convertInlineNodes(buffer, ctx, true));
    buffer = [];
    if (text) parts.push(text);
  };
  for (const child of root.childNodes) {
    if (isBlockNode(child)) {
      flush();
      const block = convertBlock(child, ctx);
      if (block && block.trim()) parts.push(block.trim());
    } else {
      buffer.push(child);
    }
  }
  flush();
  return parts.join("\n\n");
}

function convertHeading(el, ctx) {
  const level = Number(el.tagName[1]) || 1;
  const inner = cleanInline(convertChildren(el, ctx)).replace(HARD_BREAK_RE, " ").replace(/\s+/g, " ").trim();
  if (!inner) return "";
  return "#".repeat(Math.min(6, Math.max(1, level))) + " " + inner;
}

function convertParagraph(el, ctx) {
  return cleanInline(convertChildren(el, ctx));
}

function convertBlockquote(el, ctx) {
  const inner = convertBlocks(el, ctx);
  if (!inner.trim()) return "";
  return inner.split("\n").map(line => (line.trim() ? "> " + line : ">")).join("\n");
}

function chooseFence(text) {
  let fence = "```";
  while (text.includes(fence)) fence += "`";
  return fence;
}

function languageOf(el) {
  const code = el.querySelector("code");
  const source = code || el;
  const cls = (source.getAttribute("class") || "") + " " + (el.getAttribute("class") || "");
  const m = /(?:language|lang|highlight-source|brush:)[-:]([a-z0-9+#._-]+)/i.exec(cls);
  return m ? m[1].toLowerCase() : "";
}

function convertCodeBlock(el, ctx) {
  const codeEl = el.querySelector("code");
  const raw = (codeEl ? codeEl.textContent : el.textContent) || "";
  const text = raw.replace(/\r\n?/g, "\n").replace(/^\n+/, "").replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
  if (!text.trim()) return "";
  const fence = chooseFence(text);
  const lang = languageOf(el);
  return fence + lang + "\n" + text + "\n" + fence;
}

function convertHr() {
  return "---";
}

function convertList(el, ctx, indent) {
  const ordered = el.tagName.toLowerCase() === "ol";
  const step = indent || (ordered ? 3 : 2);
  let counter = parseInt(el.getAttribute("start") || "1", 10);
  if (!Number.isFinite(counter)) counter = 1;
  const items = Array.from(el.children).filter(child => child.tagName && child.tagName.toLowerCase() === "li");
  const lines = [];
  for (const li of items) {
    const marker = ordered ? (counter++) + ". " : (ctx.opts.bullet || "-") + " ";
    const body = convertListItem(li, ctx, step);
    if (!body) {
      lines.push(marker.trimEnd());
      continue;
    }
    const bodyLines = body.split("\n");
    lines.push(marker + bodyLines[0]);
    for (let i = 1; i < bodyLines.length; i++) {
      lines.push(bodyLines[i] ? " ".repeat(step) + bodyLines[i] : "");
    }
  }
  return lines.join("\n");
}

function convertListItem(li, ctx, step) {
  const inlineNodes = [];
  const blocks = [];
  for (const child of li.childNodes) {
    if (isBlockNode(child)) blocks.push(child);
    else inlineNodes.push(child);
  }
  const parts = [];
  const first = cleanInline(convertInlineNodes(inlineNodes, ctx, true));
  if (first) parts.push(first);
  for (const block of blocks) {
    const tag = block.tagName.toLowerCase();
    const md = (tag === "ul" || tag === "ol") ? convertList(block, ctx, tag === "ol" ? 3 : 2) : convertBlock(block, ctx);
    if (md && md.trim()) parts.push(md.trim());
  }
  return parts.join("\n");
}

function alignOf(cell) {
  const attr = (cell.getAttribute("align") || "").toLowerCase();
  const style = (cell.getAttribute("style") || "").toLowerCase();
  const m = /text-align\s*:\s*(left|center|right)/.exec(style);
  const value = m ? m[1] : attr;
  return value === "center" || value === "right" || value === "left" ? value : "";
}

function alignMarker(align) {
  if (align === "center") return ":---:";
  if (align === "right") return "---:";
  if (align === "left") return ":---";
  return "---";
}

function convertTable(el, ctx) {
  const rows = [];
  for (const tr of el.querySelectorAll("tr")) {
    const cells = [];
    for (const cell of Array.from(tr.children)) {
      const tag = cell.tagName.toLowerCase();
      if (tag !== "td" && tag !== "th") continue;
      let text = cleanInline(convertChildren(cell, ctx)).replace(HARD_BREAK_RE, "<br>").replace(/\|/g, "\\|");
      const isHeader = tag === "th";
      const align = alignOf(cell);
      cells.push({ text, isHeader, align });
      const colspan = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
      for (let i = 1; i < colspan; i++) cells.push({ text: "", isHeader, align });
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return "";

  const width = Math.max(...rows.map(row => row.length));
  for (const row of rows) {
    while (row.length < width) row.push({ text: "", isHeader: false, align: "" });
  }

  const header = rows[0];
  const body = rows.slice(1);
  const lines = [];
  lines.push("| " + header.map(cell => cell.text || " ").join(" | ") + " |");
  lines.push("| " + header.map(cell => alignMarker(cell.align)).join(" | ") + " |");
  for (const row of body) {
    lines.push("| " + row.map(cell => cell.text || " ").join(" | ") + " |");
  }
  return lines.join("\n");
}

function convertDefinition(el, ctx) {
  const lines = [];
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    const text = cleanInline(convertChildren(child, ctx));
    if (!text) continue;
    if (tag === "dt") lines.push("**" + text + "**");
    else if (tag === "dd") lines.push(text);
  }
  return lines.join("\n\n");
}

function convertBlock(el, ctx) {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return "";
  switch (tag) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return convertHeading(el, ctx);
    case "p":
      return convertParagraph(el, ctx);
    case "blockquote":
      return convertBlockquote(el, ctx);
    case "pre":
      return convertCodeBlock(el, ctx);
    case "hr":
      return convertHr();
    case "ul": case "ol":
      return convertList(el, ctx);
    case "li":
      return convertListItem(el, ctx, 2);
    case "table":
      return convertTable(el, ctx);
    case "dl":
      return convertDefinition(el, ctx);
    case "dt":
    case "dd":
      return cleanInline(convertChildren(el, ctx));
    case "figcaption":
      return wrapInline(cleanInline(convertChildren(el, ctx)), "*");
    case "summary":
      return wrapInline(cleanInline(convertChildren(el, ctx)), "**");
    default:
      return convertBlocks(el, ctx);
  }
}

export function convertHtmlToMarkdown(root, options = {}) {
  if (!root) return "";
  const target = root.nodeType === 9 ? root.body : root;
  if (!target) return "";
  const opts = { ...CONVERT_DEFAULTS };
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) opts[key] = options[key];
  }
  const ctx = { opts, stash: [], footnotes: [], footnoteIndex: new Map() };
  let out = convertBlocks(target, ctx);
  out = out.replace(/[ \t]+$/gm, "");
  out = out.replace(HARD_BREAK_RE, "  \n");
  out = unstash(out, ctx);
  if (ctx.footnotes.length) {
    const defs = ctx.footnotes.map((f, i) => {
      const title = f.title ? ` "${f.title}"` : "";
      return `[^${i + 1}]: ${hrefMarkdown(f.url)}${title}`;
    }).join("\n");
    return out.trim() + "\n\n" + defs + "\n";
  }
  return out.trim() + "\n";
}
