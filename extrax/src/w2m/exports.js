import { createDocRecord, docFilename, uniqueFilename } from "./library.js";
import { docsToJson } from "./docexport.js";
import { combineDocuments } from "./batch.js";
import { markdownStats } from "./stats.js";

function docMetadata(doc) {
  if (doc && doc.doc && doc.doc.metadata) return doc.doc.metadata;
  if (doc && doc.metadata) return doc.metadata;
  return {};
}

export function exportRecord(doc, options = {}) {
  const meta = docMetadata(doc);
  return createDocRecord({
    title: doc.title || doc.url || "Untitled",
    url: doc.url || meta.canonical || "",
    site: meta.site || doc.site || doc.host || "",
    author: meta.author || doc.author || "",
    published: meta.published || doc.published || "",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    markdown: typeof doc.markdown === "string" ? doc.markdown : "",
    stats: markdownStats(doc.markdown || ""),
    options: options.docOptions || {}
  });
}

function jsonText(records) {
  return JSON.stringify(docsToJson(records), null, 2);
}

export function buildExportFiles(docs, options = {}) {
  const list = (Array.isArray(docs) ? docs : []).filter(d => d && typeof d.markdown === "string");
  const format = options.format === "json" ? "json" : "markdown";
  const individual = !!options.individual;
  const baseName = String(options.baseName || "capture").replace(/[\\/:*?"<>|]+/g, "-");
  const files = [];

  if (!list.length) return { files, format, individual, count: 0 };

  const records = list.map(d => exportRecord(d, options));

  if (!individual) {
    if (format === "json") {
      files.push({ name: baseName + ".json", mime: "application/json", text: jsonText(records) });
    } else {
      const combined = combineDocuments(list, {
        title: options.title || "Combined capture",
        includeToc: options.includeToc !== false,
        includeFrontmatter: options.includeFrontmatter !== false,
        createdAt: options.createdAt
      });
      files.push({ name: baseName + ".md", mime: "text/markdown;charset=utf-8", text: combined.markdown });
    }
    return { files, format, individual, count: list.length };
  }

  const used = new Set();
  for (let i = 0; i < list.length; i++) {
    const raw = list[i].filename || docFilename(records[i]);
    const base = String(raw).replace(/\//g, "__").replace(/\.(md|markdown|json)$/i, "");
    if (format === "json") {
      const name = uniqueFilename(base + ".json", used);
      used.add(name);
      files.push({ name, mime: "application/json", text: jsonText([records[i]]) });
    } else {
      const name = uniqueFilename(base + ".md", used);
      used.add(name);
      files.push({ name, mime: "text/markdown;charset=utf-8", text: records[i].markdown });
    }
  }
  return { files, format, individual, count: list.length };
}
