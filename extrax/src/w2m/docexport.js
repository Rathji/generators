import { stripFrontmatter } from "./batch.js";
import { createDocRecord } from "./library.js";

export const DOC_FORMAT = "extrax-documents";
export const DOC_VERSION = 1;

const MARKER_RE = /<!--\s*extrax-doc\s+(\{[\s\S]*?\})\s*-->/g;
const DOCUMENT_RE = /<!--\s*extrax-doc\s+(\{[\s\S]*?\})\s*-->\s*(?:##[^\n]*\n)?\s*<document>\n?([\s\S]*?)\n?<\/document>/g;

export function docsToJson(records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  return {
    format: DOC_FORMAT,
    version: DOC_VERSION,
    exportedAt: new Date().toISOString(),
    documents: list.map(d => ({ ...d }))
  };
}

export function docsFromJson(data) {
  if (Array.isArray(data)) return data.filter(d => d && typeof d === "object");
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.documents)) return data.documents.filter(d => d && typeof d === "object");
  return null;
}

function unquote(value) {
  const s = String(value == null ? "" : value).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseFrontmatter(text) {
  const value = String(text == null ? "" : text).replace(/\r\n/g, "\n");
  const m = /^\s*---\n([\s\S]*?)\n---\n?/.exec(value);
  if (!m) return { fields: {}, body: value };
  const fields = {};
  for (const raw of m[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    fields[key] = unquote(line.slice(idx + 1));
  }
  return { fields, body: value.slice(m[0].length) };
}

function firstHeading(text) {
  const m = /^\s*#\s+(.+)$/m.exec(String(text || ""));
  return m ? m[1].trim() : "";
}

function normTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(t => String(t || "").trim().toLowerCase()).filter(Boolean);
}

export function docsToMarkdown(records, options = {}) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  const title = options.title || "Extrax Documents";
  const when = options.date != null ? new Date(options.date) : new Date();
  const stamp = Number.isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 10);

  const header = [
    "# " + title,
    "",
    list.length + " document" + (list.length === 1 ? "" : "s") + (stamp ? " · exported " + stamp : "") + " · importable back into Extrax",
    ""
  ].join("\n");

  const chunks = list.map((d, i) => {
    const meta = {
      title: d.title || "Untitled",
      url: d.url || "",
      site: d.site || "",
      author: d.author || "",
      published: d.published || "",
      tags: normTags(d.tags),
      notes: d.notes || "",
      createdAt: Number.isFinite(d.createdAt) ? d.createdAt : null
    };
    const body = stripFrontmatter(String(d.markdown || "")).replace(/^\n+/, "").replace(/\s+$/, "");
    return "<!-- extrax-doc " + JSON.stringify(meta) + " -->\n"
      + "## " + (i + 1) + ". " + meta.title + "\n\n"
      + "<document>\n" + body + "\n</document>\n";
  });

  return header + chunks.join("\n---\n\n") + "\n";
}

export function docsFromMarkdown(text) {
  const src = String(text == null ? "" : text);
  const out = [];
  let m;
  DOCUMENT_RE.lastIndex = 0;
  while ((m = DOCUMENT_RE.exec(src))) {
    let meta = {};
    try { meta = JSON.parse(m[1]); } catch (err) { meta = {}; }
    const body = m[2].replace(/^\n+/, "").replace(/\s+$/, "");
    if (!body && !meta.title) continue;
    out.push({ ...meta, markdown: body });
  }
  return out;
}

export function hasDocMarkers(text) {
  MARKER_RE.lastIndex = 0;
  return MARKER_RE.test(String(text == null ? "" : text));
}

export function docFromMarkdown(text, options = {}) {
  const src = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
  const parsed = parseFrontmatter(src);
  const fields = parsed.fields;
  const filename = String(options.filename || "").replace(/\.(md|markdown)$/i, "").trim();
  const title = fields.title || firstHeading(parsed.body) || filename || "Imported document";
  return {
    title,
    url: fields.url || fields.source || fields.canonical || "",
    site: fields.site || fields.site_name || "",
    author: fields.author || "",
    published: fields.published || fields.date || "",
    tags: [],
    notes: "",
    markdown: src
  };
}

export function parseDocsMarkdown(text, options = {}) {
  const multi = docsFromMarkdown(text);
  if (multi.length) return multi;
  return [docFromMarkdown(text, options)];
}

export function makeImportedRecord(partial) {
  return createDocRecord({
    id: partial.id,
    title: partial.title,
    url: partial.url,
    site: partial.site,
    author: partial.author,
    published: partial.published,
    tags: partial.tags,
    notes: partial.notes,
    markdown: partial.markdown,
    stats: partial.stats,
    options: partial.options,
    createdAt: partial.createdAt
  });
}
