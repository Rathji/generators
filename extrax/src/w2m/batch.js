import { normalizeUrl } from "./urls.js";
import { markdownStats } from "./stats.js";

const MARKDOWN_LINK_RE = /^\s*(?:[-*+]|\d+[.)]|>)?\s*\[([^\]]*)\]\((https?:\/\/.+)\)\s*$/i;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)]|>)\s+/;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pushCandidate(token, items, seen) {
  const raw = String(token == null ? "" : token).trim();
  if (!raw || raw.startsWith("#")) return;

  let label = "";
  let candidate = raw;
  const link = MARKDOWN_LINK_RE.exec(raw);
  if (link) {
    label = link[1].trim();
    candidate = link[2].trim();
  } else {
    candidate = raw.replace(BULLET_RE, "").trim();
  }
  if (!candidate || candidate.startsWith("#")) return;

  const norm = normalizeUrl(candidate);
  const key = norm.ok ? norm.url.toLowerCase() : candidate.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);

  items.push({
    raw,
    label,
    url: norm.ok ? norm.url : candidate,
    host: norm.ok ? norm.host : "",
    valid: !!norm.ok,
    error: norm.ok ? "" : norm.error
  });
}

export function parseUrlList(text) {
  const items = [];
  const seen = new Set();
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const tokens = trimmed.includes(",") ? trimmed.split(",") : [trimmed];
    for (const token of tokens) pushCandidate(token, items, seen);
  }
  return items;
}

export async function runBatch(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const process = options.process;
  const shouldStop = options.shouldStop;
  const delayMs = Number(options.delayMs) || 0;
  const total = list.length;
  const results = [];
  let stopped = false;

  for (let index = 0; index < total; index++) {
    const item = list[index];

    if (stopped || (typeof shouldStop === "function" && shouldStop())) {
      stopped = true;
      results.push({ item, index, status: "skipped", reason: "cancelled" });
      continue;
    }

    if (typeof process !== "function" || (item && item.valid === false)) {
      const entry = { item, index, status: "error", invalid: !!(item && item.valid === false), error: (item && item.error) || "invalid_url" };
      results.push(entry);
      if (typeof options.onItem === "function") await options.onItem(entry, index, total);
      continue;
    }

    if (typeof options.onStart === "function") await options.onStart(item, index, total);

    let entry;
    try {
      entry = { item, index, status: "ok", value: await process(item, index, total) };
    } catch (err) {
      entry = { item, index, status: "error", error: err };
    }
    results.push(entry);
    if (typeof options.onItem === "function") await options.onItem(entry, index, total);

    if (delayMs > 0 && index < total - 1) await sleep(delayMs);
  }

  const ok = results.filter(r => r.status === "ok").length;
  const failed = results.filter(r => r.status === "error").length;
  const skipped = results.filter(r => r.status === "skipped").length;
  return { results, total, ok, failed, skipped, stopped };
}

function yamlString(value) {
  const s = String(value).replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function inlineText(value) {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").replace(/[[\]]/g, "").trim();
}

function anchorFor(index) {
  return "doc-" + (index + 1);
}

export function stripFrontmatter(markdown) {
  const value = String(markdown == null ? "" : markdown);
  const m = /^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(value);
  return m ? value.slice(m[0].length) : value;
}

export function combineDocuments(docs, options = {}) {
  const all = Array.isArray(docs) ? docs : [];
  const list = all.filter(d => d && d.markdown != null && String(d.markdown).trim() !== "");
  const title = String(options.title || "Combined capture");
  const includeToc = options.includeToc !== false;
  const includeFrontmatter = options.includeFrontmatter !== false;

  const created = options.createdAt != null ? new Date(options.createdAt) : new Date();
  const stamp = Number.isNaN(created.getTime()) ? "" : created.toISOString().slice(0, 10);

  const parts = [];

  if (includeFrontmatter && list.length) {
    const fm = ["---", "title: " + yamlString(title), "documents: " + list.length];
    if (stamp) fm.push("created: " + stamp);
    fm.push("sources:");
    for (const d of list) {
      fm.push("  - " + yamlString(d.url || d.title || "unknown"));
    }
    fm.push("---");
    parts.push(fm.join("\n"));
  }

  parts.push("# " + title);

  if (includeToc && list.length) {
    const lines = list.map((d, i) =>
      (i + 1) + ". [" + (inlineText(d.title || d.host || d.url) || "Document " + (i + 1)) + "](#" + anchorFor(i) + ")"
    );
    parts.push("## Contents\n\n" + lines.join("\n"));
  }

  list.forEach((d, i) => {
    const heading = "## " + (i + 1) + ". " + (inlineText(d.title || d.host || d.url) || "Document " + (i + 1));
    const body = stripFrontmatter(String(d.markdown)).trim();
    parts.push('<a id="' + anchorFor(i) + '"></a>\n\n' + heading + "\n\n" + body);
  });

  const markdown = parts.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
  return {
    markdown,
    count: list.length,
    skipped: all.length - list.length,
    stats: markdownStats(markdown)
  };
}
