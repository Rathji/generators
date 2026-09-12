import { fitToBudget } from "./cleanup.js";
import { markdownStats } from "./stats.js";
import { stripFrontmatter } from "./batch.js";

const CONTEXT_PREAMBLE = [
  "You are a research assistant answering questions using ONLY the provided source documents.",
  "Rules:",
  "- Base every statement on the documents. If the answer is not in them, say you don't know.",
  "- Cite the sources you use with bracketed numbers, e.g. [1], matching the numbered list in SOURCES.",
  "- Be concise and specific. Quote sparingly.",
  "- Do not invent facts, numbers, names or URLs."
].join("\n");

function docBlock(doc, index) {
  const title = doc.title || doc.host || doc.url || "Document " + (index + 1);
  const body = stripFrontmatter(String(doc.markdown == null ? "" : doc.markdown)).trim();
  return "## " + index + ". " + title + "\n\n" + body;
}

export function buildContextBundle(docs, options = {}) {
  const list = (Array.isArray(docs) ? docs : []).filter(d => d && String(d.markdown || "").trim());
  const countTokens = typeof options.countTokens === "function" ? options.countTokens : null;
  const maxTokens = Number(options.maxTokens) || 0;
  const title = options.title || "Context bundle";
  const stamp = options.createdAt != null ? new Date(options.createdAt) : new Date();
  const created = Number.isNaN(stamp.getTime()) ? "" : stamp.toISOString().slice(0, 10);

  const header = ["# " + title, ""];
  if (created) header.push("- **Built:** " + created);
  header.push("- **Documents:** " + list.length);
  if (list.length) {
    header.push("");
    header.push("## Sources");
    list.forEach((d, i) => header.push((i + 1) + ". " + (d.title || d.host || d.url || "Document " + (i + 1)) + (d.url ? " — " + d.url : "")));
  }
  header.push("");

  const blocks = [];
  let prefix = header.join("\n");
  let included = 0;
  let dropped = 0;
  let truncated = false;
  const used = () => (countTokens ? countTokens(prefix + blocks.join("\n\n")) : (prefix + blocks.join("\n\n")).length);

  for (let i = 0; i < list.length; i++) {
    const block = docBlock(list[i], included + 1);
    const candidate = blocks.concat([block]).join("\n\n");
    if (!countTokens || !maxTokens || countTokens(prefix + candidate) <= maxTokens) {
      blocks.push(block);
      included++;
      continue;
    }
    const remaining = maxTokens - used();
    if (countTokens && remaining > 200) {
      const fitted = fitToBudget(block, countTokens, remaining);
      if (fitted.text.trim()) {
        blocks.push(fitted.text);
        included++;
        truncated = true;
      }
    }
    dropped = list.length - included;
    break;
  }
  if (used() > maxTokens && countTokens && maxTokens) {
    const fitted = fitToBudget(blocks.join("\n\n"), countTokens, maxTokens);
    if (fitted.truncated) {
      blocks.length = 0;
      blocks.push(fitted.text);
      truncated = true;
    }
  }

  const markdown = (prefix + blocks.join("\n\n")).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return {
    markdown,
    stats: markdownStats(markdown),
    included,
    dropped,
    truncated,
    tokens: countTokens ? countTokens(markdown) : 0,
    sources: list.slice(0, included).map((d, i) => ({ index: i + 1, title: d.title || d.host || d.url || "Document " + (i + 1), url: d.url || "" }))
  };
}

export function bundleFileName(base) {
  const d = new Date();
  const stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  return String(base || "context-bundle").replace(/[\\/:*?"<>|]+/g, "-") + "-" + stamp + ".md";
}

export function buildAskPrompt(options = {}) {
  const docs = Array.isArray(options.docs) ? options.docs : [];
  const history = Array.isArray(options.history) ? options.history : [];
  const bundle = options.bundle || buildContextBundle(docs, options);

  const parts = [CONTEXT_PREAMBLE, ""];
  parts.push("SOURCES:");
  if (bundle.sources.length) {
    for (const s of bundle.sources) parts.push("[" + s.index + "] " + s.title + (s.url ? " — " + s.url : ""));
  } else {
    parts.push("(none)");
  }
  parts.push("");
  parts.push("<DOCUMENTS>");
  parts.push(bundle.markdown.replace(/^# .*\n\n?/, ""));
  parts.push("</DOCUMENTS>");

  if (history.length) {
    parts.push("");
    parts.push("CONVERSATION SO FAR:");
    for (const turn of history) {
      parts.push("");
      parts.push((turn.role === "user" ? "User: " : "Assistant: ") + String(turn.text || "").trim());
    }
  }

  parts.push("");
  parts.push("TASK:");
  parts.push("Answer the question in the user's language, using only the sources above, and cite them as [n].");
  parts.push("QUESTION: " + String(options.question || "").trim());
  return { prompt: parts.join("\n"), bundle };
}

export function parseAskAnswer(raw) {
  const text = String(raw == null ? "" : raw).trim();
  const refs = [];
  const re = /\[(\d{1,2})\]/g;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    if (n > 0 && !refs.includes(n)) refs.push(n);
  }
  return { answer: text, citations: refs };
}

export async function runAsk(options = {}) {
  if (typeof options.generateText !== "function") throw new Error("AI text generation is unavailable on this page.");
  const built = buildAskPrompt(options);
  const pending = options.generateText({
    instruction: built.prompt,
    onChunk: typeof options.onChunk === "function" ? chunk => options.onChunk(chunk) : undefined
  });
  if (typeof options.onPending === "function") options.onPending(pending);
  const result = await pending;
  const raw = result == null ? "" : (typeof result === "string" ? result : (result.text != null ? result.text : String(result)));
  const parsed = parseAskAnswer(raw);
  return { ...parsed, prompt: built.prompt, bundle: built.bundle };
}
