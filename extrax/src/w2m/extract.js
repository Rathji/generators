import { W2MError } from "./errors.js";
import { extractMetadata } from "./metadata.js";

export const BOILERPLATE_TAGS = [
  "script", "style", "noscript", "template", "nav", "footer", "aside",
  "iframe", "form", "button", "input", "select", "textarea", "svg", "canvas",
  "link", "meta", "object", "embed", "base"
];

export const BOILERPLATE_ROLES = [
  "navigation", "banner", "contentinfo", "search", "complementary",
  "dialog", "alertdialog", "menu", "menubar", "toolbar", "tablist"
];

export const BOILERPLATE_CLASS = /(^|[\s_-])(ad|ads|advert|adverts|advertisement|adsbygoogle|sponsor|sponsored|promo|promotion|banner|cookie|consent|gdpr|newsletter|popup|modal|overlay|lightbox|social|share|sharing|sharebar|breadcrumb|breadcrumbs|pagination|pager|related|recommended|recommendations|sidebar|side-bar|menu|navbar|nav-bar|masthead|skip-link|site-header|site-footer|subnav|sub-nav|comments|comment-list|disqus|subscribe|paywall|login|signup|trustbar|byline-share|print-only|no-print|screen-reader|visually-hidden|sr-only)([\s_-]|$)/i;

export function parseHtml(html) {
  const source = String(html == null ? "" : html);
  if (!source.trim()) throw new W2MError("empty_content");
  let doc;
  try {
    doc = new DOMParser().parseFromString(source, "text/html");
  } catch (err) {
    throw new W2MError("parse_error", (err && err.message) || "");
  }
  if (!doc || !doc.documentElement) throw new W2MError("parse_error");
  return doc;
}

function countNodes(root) {
  return root.querySelectorAll("*").length;
}

function textOf(el) {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function linkDensity(el) {
  const total = textOf(el).length || 1;
  let linkText = 0;
  for (const a of el.querySelectorAll("a")) linkText += (a.textContent || "").length;
  return linkText / total;
}

function isChromeLike(el) {
  const text = textOf(el);
  if (text.length < 160) return true;
  return linkDensity(el) > 0.5;
}

export function pruneBoilerplate(doc) {
  const before = countNodes(doc);
  const removed = { tags: 0, roles: 0, hidden: 0, patterns: 0 };

  for (const el of doc.querySelectorAll(BOILERPLATE_TAGS.join(","))) {
    el.remove();
    removed.tags++;
  }
  for (const role of BOILERPLATE_ROLES) {
    for (const el of doc.querySelectorAll(`[role="${role}"]`)) {
      el.remove();
      removed.roles++;
    }
  }
  for (const el of doc.querySelectorAll('[aria-hidden="true"],[hidden]')) {
    el.remove();
    removed.hidden++;
  }
  for (const el of doc.querySelectorAll("[style]")) {
    const style = (el.getAttribute("style") || "").toLowerCase();
    if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(style)) {
      el.remove();
      removed.hidden++;
    }
  }
  for (const el of doc.querySelectorAll("[class],[id]")) {
    const signature = ((el.getAttribute("class") || "") + " " + (el.id || "")).trim();
    if (!signature) continue;
    if (BOILERPLATE_CLASS.test(signature) && isChromeLike(el)) {
      el.remove();
      removed.patterns++;
    }
  }

  const removedTotal = before - countNodes(doc);
  return { ...removed, removedTotal };
}

const CONTENT_SELECTORS = [
  "article", "main", '[role="main"]',
  "#content", "#main", "#article", "#primary", "#main-content", "#content-main",
  ".post-content", ".entry-content", ".article-body", ".article-content",
  ".post-body", ".content-body", ".story-body", ".markdown-body", ".prose",
  ".post", ".entry", ".article", ".story"
];

function paragraphText(el) {
  let n = 0;
  for (const p of el.querySelectorAll("p,li,blockquote,pre,td,dd,h1,h2,h3,h4,h5,h6")) {
    n += (p.textContent || "").length;
  }
  return n;
}

function scoreNode(el) {
  const textLen = textOf(el).length;
  const para = paragraphText(el);
  const density = linkDensity(el);
  const penalty = 1 - Math.min(0.85, density);
  return (para + textLen * 0.25) * penalty;
}

function selectorPath(el) {
  if (!el) return "";
  if (el.tagName === "BODY") return "body";
  if (el.tagName === "HTML") return "html";
  let s = el.tagName.toLowerCase();
  if (el.id) s += "#" + el.id;
  else if (el.classList && el.classList.length) s += "." + Array.from(el.classList).slice(0, 2).join(".");
  return s;
}

export function findContentRoot(doc) {
  const body = doc.body || doc.documentElement;
  if (!body) return null;

  const seen = new Set();
  const tiered = [];
  for (const sel of CONTENT_SELECTORS) {
    let nodes;
    try { nodes = doc.querySelectorAll(sel); } catch (err) { continue; }
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      tiered.push(el);
    }
  }

  const bodyText = textOf(body).length;
  const scored = tiered
    .map(el => ({ el, score: scoreNode(el) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (top && textOf(top.el).length >= Math.max(60, bodyText * 0.35) && top.score > 0) {
    return top.el;
  }

  let bestChild = null;
  let bestScore = 0;
  for (const child of body.children) {
    const score = scoreNode(child);
    if (score > bestScore) {
      bestScore = score;
      bestChild = child;
    }
  }
  const bodyScore = scoreNode(body);
  if (bestChild && bestScore > bodyScore * 1.05) return bestChild;
  return bodyScore > 0 ? body : (bestChild || body);
}

function documentTitle(doc) {
  const og = doc.querySelector('meta[property="og:title"],meta[name="og:title"]');
  if (og) {
    const content = og.getAttribute("content");
    if (content && content.trim()) return content.trim();
  }
  const metaTitle = doc.querySelector('meta[name="twitter:title"]');
  if (metaTitle) {
    const content = metaTitle.getAttribute("content");
    if (content && content.trim()) return content.trim();
  }
  const title = (doc.title || "").trim();
  if (title) return title;
  const h1 = doc.querySelector("h1");
  return h1 ? textOf(h1) : "";
}

export function extractContent(html, options = {}) {
  const doc = parseHtml(html);
  const metadata = extractMetadata(doc, { url: options.url || "" });
  const title = metadata.title || documentTitle(doc);
  const removal = pruneBoilerplate(doc);
  const contentEl = findContentRoot(doc);
  if (!contentEl) throw new W2MError("empty_content");

  const text = textOf(contentEl);
  if (text.length < 20) throw new W2MError("empty_content");

  return {
    title,
    metadata,
    doc,
    contentHtml: contentEl.innerHTML.trim(),
    contentEl,
    text,
    stats: {
      sourceChars: String(html).length,
      contentChars: text.length,
      nodeCount: countNodes(contentEl),
      removedNodes: removal.removedTotal,
      removed: removal,
      root: selectorPath(contentEl)
    }
  };
}
