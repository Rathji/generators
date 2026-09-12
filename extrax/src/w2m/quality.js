import { stripFrontmatter } from "./batch.js";

export const MESSY_THRESHOLD = 45;

export const QUALITY_LEVELS = [
  { level: "clean", min: 0, label: "Clean", tone: "ok" },
  { level: "fair", min: 20, label: "Fair", tone: "warn" },
  { level: "messy", min: MESSY_THRESHOLD, label: "Messy", tone: "bad" },
  { level: "very-messy", min: 70, label: "Very messy", tone: "bad" }
];

const NOISE_PATTERNS = [
  { key: "cookie", label: "cookie notice", re: /\bcookies?\b|\bconsent\b/i },
  { key: "subscribe", label: "subscribe / newsletter", re: /\bsubscribe\b|\bnewsletter\b|\bmailing list\b/i },
  { key: "signin", label: "sign-in prompt", re: /\bsign (in|up)\b|\blog ?in\b|\bcreate (an )?account\b/i },
  { key: "social", label: "social share", re: /\bshare (this|on|via)\b|\bfollow us\b|\btweet\b/i },
  { key: "ad", label: "advertisement", re: /\badvert(isement|ising)?\b|\bsponsored\b|\bpromoted\b/i },
  { key: "teaser", label: "teaser links", re: /\bread more\b|\blearn more\b|\bclick here\b|\bfind out more\b/i },
  { key: "related", label: "related content", re: /\brelated (posts|articles|content|reading|pages)\b|\brecommended\b|\byou may also like\b/i },
  { key: "legal", label: "legal boilerplate", re: /\bprivacy policy\b|\bterms of (service|use)\b|\ball rights reserved\b|\bcopyright ©?\b/i },
  { key: "nav", label: "navigation text", re: /\bskip to (content|main)\b|\bjump to\b|\bback to top\b|\bhome\s*[›>]\s*/i }
];

function isStructuralLine(line) {
  const s = line.trim();
  if (!s) return true;
  if (/^#{1,6}\s/.test(s)) return true;
  if (/^([-*+]|\d+[.)])\s/.test(s)) return true;
  if (/^>/.test(s)) return true;
  if (/^(\*{3,}|-{3,}|_{3,})$/.test(s)) return true;
  if (/^\|/.test(s)) return true;
  if (/^```/.test(s)) return true;
  if (/^<!--/.test(s)) return true;
  return false;
}

function wordCount(text) {
  const trimmed = String(text || "").trim();
  return trimmed ? (trimmed.match(/\S+/g) || []).length : 0;
}

function bodyOf(doc) {
  if (!doc) return "";
  if (typeof doc.body === "string") return doc.body;
  return stripFrontmatter(String(doc.markdown || ""));
}

export function qualityLevel(score) {
  let out = QUALITY_LEVELS[0];
  for (const level of QUALITY_LEVELS) if (score >= level.min) out = level;
  return { ...out };
}

export function analyzeQuality(doc, options = {}) {
  const body = bodyOf(doc);
  const stats = (doc && doc.stats) || {};
  const lines = body.split(/\r?\n/);
  const content = lines.map(l => l.trim()).filter(Boolean);
  const words = wordCount(body);
  const chars = body.length;

  const links = body.match(/\[[^\]]*\]\([^)]*\)/g) || [];
  const linkChars = links.reduce((n, l) => n + l.length, 0);
  const linkRatio = chars ? linkChars / chars : 0;
  const linksPer100 = words ? (links.length / words) * 100 : 0;

  const headings = content.filter(l => /^#{1,6}\s/.test(l));
  const paragraphs = content.filter(l => !isStructuralLine(l));
  const paraChars = paragraphs.reduce((n, l) => n + l.length, 0);
  const avgParagraphChars = paragraphs.length ? Math.round(paraChars / paragraphs.length) : 0;
  const shortParagraphs = paragraphs.filter(l => wordCount(l) <= 4).length;
  const shortParagraphRatio = paragraphs.length ? shortParagraphs / paragraphs.length : 0;

  const seen = new Map();
  for (const line of content) {
    if (line.length < 14) continue;
    seen.set(line, (seen.get(line) || 0) + 1);
  }
  let duplicateLines = 0;
  for (const count of seen.values()) if (count > 1) duplicateLines += count - 1;
  const duplicateRatio = content.length ? duplicateLines / content.length : 0;

  const noiseHits = NOISE_PATTERNS.filter(p => p.re.test(body)).length;

  let emptyHeadings = 0;
  for (let i = 0; i < content.length; i++) {
    if (!/^#{1,6}\s/.test(content[i])) continue;
    let hasContent = false;
    for (let j = i + 1; j < content.length; j++) {
      if (/^#{1,6}\s/.test(content[j])) break;
      hasContent = true;
      break;
    }
    if (!hasContent) emptyHeadings++;
  }

  const mojibake = (body.match(/\uFFFD/g) || []).length;
  const controlChars = (body.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;

  const sourceChars = Number(stats.sourceChars) || 0;
  const contentChars = Number(stats.contentChars) || words * 6;
  const contentRatio = sourceChars ? contentChars / sourceChars : 1;
  const root = String(stats.root || "");
  const html = String(options.html || "");
  const scriptCount = html ? (html.match(/<script\b/gi) || []).length : 0;

  const signals = [];
  const push = (key, label, weight, detail) => {
    if (weight <= 0) return;
    signals.push({ key, label, weight, detail });
  };

  const noRoot = root === "body" || root === "html";
  if (noRoot && sourceChars > 6000) {
    push("no_content_root", "No semantic content region", 20,
      "The extractor fell back to <" + (root || "body") + "> — the page has no <article>/<main> landmark, so navigation and teasers were likely mixed in.");
  }

  const lowTextRatio = sourceChars >= 30000 && contentRatio < 0.015 && contentChars < 4000;
  if (lowTextRatio) {
    push("low_text_ratio", "Little text for a large page", 22,
      "Only " + (contentRatio * 100).toFixed(1) + "% of the HTML was readable text — the page may render its content with JavaScript.");
  }

  const jsHeavy = (noRoot || lowTextRatio) && scriptCount >= 8 && sourceChars > 20000;
  if (jsHeavy && !lowTextRatio) {
    push("js_heavy", "JavaScript-rendered page", 12,
      "Detected " + scriptCount + " scripts with a small readable-text fraction — content may be injected at runtime.");
  }

  const stub = sourceChars >= 15000 && words < 120;
  if (stub && !lowTextRatio) {
    push("stub_content", "Very little extracted text", 24,
      "Only " + words + " words were recovered from " + Math.round(sourceChars / 1024) + " KB of HTML.");
  }

  const linkSoup = (linkRatio > 0.24 && links.length >= 8) || (linksPer100 > 22 && words >= 60);
  if (linkSoup) {
    push("link_soup", "High link density", 18,
      links.length + " links among " + words.toLocaleString() + " words — the result reads like menus and teasers rather than an article.");
  }

  const fragmented = paragraphs.length >= 10 && shortParagraphRatio > 0.4 && avgParagraphChars < 70;
  if (fragmented) {
    push("fragmented", "Fragmented line breaks", 14,
      Math.round(shortParagraphRatio * 100) + "% of text lines are four words or fewer (average " + avgParagraphChars + " chars) — the layout was probably split across columns.");
  }

  const thinProse = paragraphs.length >= 8 && avgParagraphChars < 55;
  if (thinProse) {
    push("thin_prose", "Almost no prose", 12,
      "Most of the extracted text is in short fragments (average line " + avgParagraphChars + " characters) — little reads as a paragraph.");
  }

  if (noiseHits >= 2) {
    push("boilerplate", "Left-over page chrome", Math.min(20, noiseHits * 5),
      "Found " + noiseHits + " kinds of boilerplate: " + NOISE_PATTERNS.filter(p => p.re.test(body)).map(p => p.label).join(", ") + ".");
  }

  if (duplicateRatio > 0.25 && content.length >= 20) {
    push("duplicate_lines", "Repeated lines", 12,
      Math.round(duplicateRatio * 100) + "% of lines are duplicates — a template or teaser block was captured more than once.");
  }

  if (headings.length >= 5 && emptyHeadings / headings.length > 0.3) {
    push("empty_headings", "Headings with no content", 12,
      emptyHeadings + " of " + headings.length + " headings have no text under them.");
  }

  if (mojibake > 3 || controlChars > 3) {
    push("mojibake", "Encoding noise", 10,
      "Found " + (mojibake + controlChars) + " replacement or control characters — the page's encoding was not decoded cleanly.");
  }

  const score = Math.min(100, signals.reduce((n, s) => n + s.weight, 0));
  const level = qualityLevel(score);

  return {
    score,
    ...level,
    messy: score >= MESSY_THRESHOLD,
    jsHeavy,
    signals,
    metrics: {
      words,
      chars,
      lines: lines.length,
      paragraphs: paragraphs.length,
      headings: headings.length,
      links: links.length,
      linkRatio: Number(linkRatio.toFixed(3)),
      linksPer100Words: Number(linksPer100.toFixed(1)),
      avgParagraphChars,
      noiseHits,
      duplicateLines,
      emptyHeadings,
      sourceChars,
      contentChars,
      contentRatio: Number(contentRatio.toFixed(4)),
      root: root || "unknown"
    }
  };
}

export function qualitySummary(quality) {
  if (!quality) return "";
  if (!quality.signals.length) return quality.label + " — no issues detected.";
  return quality.label + " (" + quality.score + "/100) — " + quality.signals.map(s => s.label).join(", ") + ".";
}

export function qualityDelta(before, after) {
  if (!before || !after) return null;
  return {
    scoreBefore: before.score,
    scoreAfter: after.score,
    improvement: before.score - after.score,
    levelBefore: before.level,
    levelAfter: after.level
  };
}
