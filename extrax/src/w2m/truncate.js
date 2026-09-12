export const LIMIT_PRESETS = {
  small: {
    key: "small",
    label: "Small — up to 600 KB pages",
    short: "600 KB",
    maxBytes: 600 * 1024,
    maxHtmlChars: 400000,
    maxMarkdownChars: 120000
  },
  balanced: {
    key: "balanced",
    label: "Balanced — up to 2.5 MB pages",
    short: "2.5 MB",
    maxBytes: 2500000,
    maxHtmlChars: 1500000,
    maxMarkdownChars: 500000
  },
  large: {
    key: "large",
    label: "Large — up to 6 MB pages",
    short: "6 MB",
    maxBytes: 6000000,
    maxHtmlChars: 4000000,
    maxMarkdownChars: 1500000
  },
  unlimited: {
    key: "unlimited",
    label: "No cap — up to 8 MB pages",
    short: "8 MB",
    maxBytes: 8 * 1024 * 1024,
    maxHtmlChars: 0,
    maxMarkdownChars: 0
  }
};

export const DEFAULT_LIMIT = "balanced";

export function resolveLimits(key) {
  return LIMIT_PRESETS[key] || LIMIT_PRESETS[DEFAULT_LIMIT];
}

export function limitOptions() {
  return Object.values(LIMIT_PRESETS).map(p => ({ key: p.key, label: p.label }));
}

export function limitsFor(options = {}) {
  const preset = resolveLimits(options.limitPreset);
  const maxBytes = options.maxBytes != null ? options.maxBytes : preset.maxBytes;
  const maxHtmlChars = options.maxHtmlChars != null ? options.maxHtmlChars : preset.maxHtmlChars;
  const maxMarkdownChars = options.maxMarkdownChars != null ? options.maxMarkdownChars : preset.maxMarkdownChars;
  return { preset, maxBytes, maxHtmlChars, maxMarkdownChars };
}

function count(n) {
  return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatCount(n) {
  return count(n);
}

export function truncateText(text, maxChars, marker = "…") {
  const value = String(text == null ? "" : text);
  const fullChars = value.length;
  const cap = Number(maxChars) || 0;
  if (cap <= 0 || fullChars <= cap) {
    return { text: value, truncated: false, fullChars, keptChars: fullChars };
  }
  let kept = value.slice(0, cap);
  const newline = kept.lastIndexOf("\n");
  if (newline > cap * 0.5) kept = kept.slice(0, newline);
  kept = kept.replace(/\s+$/, "");
  return { text: kept + marker, truncated: true, fullChars, keptChars: kept.length };
}

export function truncateHtml(html, maxChars) {
  const value = String(html == null ? "" : html);
  const fullChars = value.length;
  const cap = Number(maxChars) || 0;
  if (cap <= 0 || fullChars <= cap) {
    return { text: value, truncated: false, fullChars, keptChars: fullChars };
  }
  let kept = value.slice(0, cap);
  const lastTag = kept.lastIndexOf(">");
  if (lastTag > cap * 0.5) kept = kept.slice(0, lastTag + 1);
  return { text: kept, truncated: true, fullChars, keptChars: kept.length };
}

export function truncateMarkdown(markdown, maxChars) {
  const cut = truncateText(markdown, maxChars, "");
  if (!cut.truncated) return cut;
  const note = "\n\n> **Truncated.** This page produced " + count(cut.fullChars) +
    " characters of Markdown; only the first " + count(cut.keptChars) +
    " were kept to keep the browser responsive. Choose a larger size cap to capture more.";
  return { text: cut.text + note, truncated: true, fullChars: cut.fullChars, keptChars: cut.text.length };
}

export function truncationSummary(truncation) {
  if (!truncation || !truncation.any) return "";
  if (truncation.html.truncated && truncation.markdown.truncated) {
    return "page trimmed to " + count(truncation.html.keptChars) + " HTML chars of " + count(truncation.html.fullChars);
  }
  if (truncation.html.truncated) {
    return "page trimmed to " + count(truncation.html.keptChars) + " HTML chars of " + count(truncation.html.fullChars);
  }
  return "Markdown trimmed to " + count(truncation.markdown.keptChars) + " chars of " + count(truncation.markdown.fullChars);
}
