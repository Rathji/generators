import { markdownStats } from "./stats.js";

export const CLEANUP_PRESETS = [
  {
    key: "tidy",
    label: "Tidy & fix structure",
    hint: "Repair headings, lists and spacing, and drop navigation or boilerplate left in the text.",
    instruction: "Clean up the source document as described in the rules. Keep all of the article's content."
  },
  {
    key: "article",
    label: "Extract the article only",
    hint: "Keep just the core article body — remove menus, promos, cookie notices and teaser links.",
    instruction: "Reduce the source document to the core article. Remove every remaining menu, promotion, cookie notice, teaser, related-links block and footer. Keep the full article content itself."
  },
  {
    key: "readable",
    label: "Make it readable prose",
    hint: "Merge fragmented lines into flowing paragraphs and normalise the wording.",
    instruction: "Rewrite the source document as clean, readable prose. Merge line breaks that split sentences mid-way into single paragraphs, remove duplicated fragments, and keep the original meaning."
  },
  {
    key: "outline",
    label: "Outline / key points",
    hint: "Turn the document into a structured outline of its main points.",
    instruction: "Produce a tidy outline of the source document: a Markdown hierarchy (headings and nested bullets) capturing its main sections and key points. Do not add commentary."
  },
  {
    key: "summary",
    label: "Concise summary",
    hint: "Condense the document into a short summary plus key bullets.",
    instruction: "Write a concise summary of the source document: one short introductory paragraph followed by 3-7 key bullet points. Do not add commentary."
  },
  {
    key: "custom",
    label: "Custom instruction…",
    hint: "Write your own instruction for the model in the box below.",
    instruction: ""
  }
];

export const CLEANUP_MAX_SOURCE_TOKENS = 3000;

const PREAMBLE = [
  "You are a precise Markdown cleaning engine. You receive Markdown that was automatically extracted from a web page and may contain navigation, advertisements, cookie notices, broken headings, duplicated fragments or lines split by the original layout.",
  "",
  "Rules:",
  "- Output ONLY the resulting Markdown. No commentary, no explanation, and no code fence around the whole document.",
  "- Preserve the meaning of the source. Never invent facts, names, numbers or quotes.",
  "- Keep the headings, links and images that belong to the document; drop navigation, ads, social and consent boilerplate.",
  "- Fix heading levels so the document starts at a sensible level and nesting is consistent.",
  "- Merge paragraph fragments that the extraction split across lines into single paragraphs.",
  "- Keep lists, tables, blockquotes and code blocks as valid GitHub-Flavored Markdown.",
  "- Do not add or modify a YAML front-matter block; it is managed separately."
].join("\n");

const SOURCE_OPEN = "<SOURCE_DOCUMENT>";
const SOURCE_CLOSE = "</SOURCE_DOCUMENT>";

export function cleanupPresets() {
  return CLEANUP_PRESETS.map(p => ({ ...p }));
}

export function presetByKey(key) {
  return CLEANUP_PRESETS.find(p => p.key === key) || CLEANUP_PRESETS[0];
}

function taskText(preset, custom, feedback) {
  const chosen = presetByKey(preset);
  let task = chosen.key === "custom"
    ? (String(custom || "").trim() || "Clean up the source document.")
    : chosen.instruction;
  const note = String(feedback || "").trim();
  if (note) task += ' The user also asked for this change: "' + note + '". Apply it.';
  return task + " Output only the resulting Markdown.";
}

export function buildCleanupPrompt(options = {}) {
  const source = options.source || {};
  const body = String(source.body != null ? source.body : source.markdown || "");
  const revisions = Array.isArray(options.revisions) ? options.revisions : [];

  const parts = [PREAMBLE, ""];
  parts.push("SOURCE METADATA:");
  parts.push("- Title: " + (source.title || "(untitled)"));
  parts.push("- URL: " + (source.url || "(unknown)"));
  parts.push("");
  parts.push(SOURCE_OPEN);
  parts.push(body);
  parts.push(SOURCE_CLOSE);

  if (revisions.length) {
    parts.push("");
    parts.push("Earlier revisions of this document (oldest first), each followed by the user's feedback on it:");
    revisions.forEach((rev, i) => {
      parts.push("");
      parts.push('<revision n="' + (i + 1) + '" preset="' + (rev.preset || "tidy") + '">');
      parts.push(String(rev.text || ""));
      parts.push("</revision>");
      const note = String(rev.feedback || "").trim();
      if (note) parts.push("<feedback>" + note + "</feedback>");
    });
  }

  parts.push("");
  parts.push("TASK:");
  parts.push(taskText(options.preset, options.custom, options.feedback));
  return parts.join("\n");
}

export function normalizeCleanupOutput(raw) {
  let text = String(raw == null ? "" : raw).replace(/\r\n/g, "\n").trim();
  const fences = (text.match(/```/g) || []).length;
  if (fences === 2) {
    const m = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(text);
    if (m) text = m[1].trim();
  }
  return text;
}

export function fitToBudget(text, countTokens, maxTokens) {
  const value = String(text == null ? "" : text);
  if (typeof countTokens !== "function" || !maxTokens || maxTokens <= 0) {
    return { text: value, truncated: false, tokens: 0 };
  }
  const tokens = countTokens(value);
  if (tokens <= maxTokens) return { text: value, truncated: false, tokens };

  let lo = 0;
  let hi = value.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (countTokens(value.slice(0, mid)) <= maxTokens) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  let cut = value.lastIndexOf("\n", best);
  if (cut < best * 0.6) cut = best;
  const kept = value.slice(0, cut).replace(/\s+$/, "");
  const out = kept + "\n\n[The document was truncated to fit the model's context window. Capture a smaller section for a complete cleanup.]";
  return { text: out, truncated: true, tokens: countTokens(out) };
}

export async function runCleanup(options = {}) {
  if (typeof options.generateText !== "function") {
    throw new Error("AI text generation is unavailable on this page.");
  }
  const prompt = buildCleanupPrompt(options);
  const pending = options.generateText({
    instruction: prompt,
    onChunk: typeof options.onChunk === "function" ? chunk => options.onChunk(chunk) : undefined
  });
  if (typeof options.onPending === "function") options.onPending(pending);

  const result = await pending;
  const raw = result == null ? "" : (typeof result === "string" ? result : (result.text != null ? result.text : String(result)));
  const text = normalizeCleanupOutput(raw);
  if (!text) throw new Error("The AI returned an empty result.");
  return { text, prompt, preset: options.preset || "tidy", stats: markdownStats(text) };
}

export function applyBody(doc, body) {
  const text = String(body == null ? "" : body)
    .replace(/\r\n/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
  const markdown = doc && doc.frontmatter
    ? doc.frontmatter + "\n\n" + text
    : text;
  return { ...doc, body: text, markdown, cleaned: true };
}
