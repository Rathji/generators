const NON_EMPTY = value => value != null && String(value).trim() !== "";

function metaContent(doc, selectors) {
  for (const selector of selectors) {
    let el;
    try { el = doc.querySelector(selector); } catch (err) { continue; }
    if (!el) continue;
    const value = el.getAttribute("content") || el.textContent || "";
    if (NON_EMPTY(value)) return value.trim();
  }
  return "";
}

function resolve(raw, baseUrl) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value || !baseUrl) return value;
  try { return new URL(value, baseUrl).href; } catch (err) { return value; }
}

function firstText(doc, selectors) {
  for (const selector of selectors) {
    let el;
    try { el = doc.querySelector(selector); } catch (err) { continue; }
    if (el) {
      const value = (el.getAttribute("content") || el.getAttribute("datetime") || el.textContent || "").trim();
      if (NON_EMPTY(value)) return value;
    }
  }
  return "";
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (err) { return ""; }
}

export function extractMetadata(doc, options = {}) {
  const url = options.url || "";
  const metadata = {
    title: "",
    author: "",
    published: "",
    modified: "",
    site: "",
    canonical: "",
    description: "",
    lang: "",
    source: url
  };
  if (!doc) return metadata;

  const title = metaContent(doc, [
    'meta[property="og:title"]', 'meta[name="og:title"]',
    'meta[name="twitter:title"]', 'meta[name="citation_title"]'
  ]) || (doc.title || "").trim() || firstText(doc, ["article h1", "h1"]);
  metadata.title = title;

  metadata.author = metaContent(doc, [
    'meta[name="author"]', 'meta[property="article:author"]', 'meta[name="article:author"]',
    'meta[name="twitter:creator"]', 'meta[name="parsely-author"]', 'meta[name="citation_author"]',
    'meta[itemprop="author"]', 'meta[property="author"]'
  ]) || firstText(doc, [
    '[itemprop="author"] [itemprop="name"]', 'a[rel="author"]', '[itemprop="author"]',
    ".byline", ".author", ".article-author", ".post-author", '[class*="byline"]'
  ]);

  metadata.published = metaContent(doc, [
    'meta[property="article:published_time"]', 'meta[name="article:published_time"]',
    'meta[itemprop="datePublished"]', 'meta[name="datePublished"]', 'meta[name="date"]',
    'meta[name="pubdate"]', 'meta[name="publish-date"]', 'meta[name="DC.date"]',
    'meta[name="citation_publication_date"]', 'meta[property="og:published_time"]'
  ]) || firstText(doc, ["time[datetime]", "time[pubdate]", '[itemprop="datePublished"]']);

  metadata.modified = metaContent(doc, [
    'meta[property="article:modified_time"]', 'meta[name="last-modified"]', 'meta[itemprop="dateModified"]'
  ]) || firstText(doc, ["time[itemprop='dateModified']"]);

  metadata.site = metaContent(doc, [
    'meta[property="og:site_name"]', 'meta[name="application-name"]',
    'meta[name="apple-mobile-web-app-title"]', 'meta[name="publisher"]'
  ]) || hostOf(url);

  const canonicalLink = doc.querySelector('link[rel="canonical"]');
  const canonicalRaw = (canonicalLink && canonicalLink.getAttribute("href") || "").trim()
    || metaContent(doc, ['meta[property="og:url"]']);
  metadata.canonical = canonicalRaw ? resolve(canonicalRaw, url) : url;

  metadata.description = metaContent(doc, [
    'meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]'
  ]);

  const htmlEl = doc.documentElement;
  metadata.lang = (htmlEl && (htmlEl.getAttribute("lang") || htmlEl.getAttribute("xml:lang")) || "").trim();

  return metadata;
}

function yamlString(value) {
  const s = String(value).replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function normalizeDate(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return raw;
}

export const FRONTMATTER_FIELDS = [
  ["title", "title"],
  ["author", "author"],
  ["published", "published"],
  ["modified", "modified"],
  ["site", "site"],
  ["source", "source"],
  ["canonical", "canonical"],
  ["description", "description"],
  ["lang", "lang"]
];

export function formatFrontmatter(metadata, options = {}) {
  if (options.includeFrontmatter === false) return "";
  const rows = [];
  for (const [key, field] of FRONTMATTER_FIELDS) {
    const raw = metadata ? metadata[field] : "";
    if (!NON_EMPTY(raw)) continue;
    const value = (field === "published" || field === "modified") ? normalizeDate(raw) : raw;
    if (!NON_EMPTY(value)) continue;
    rows.push(`${key}: ${yamlString(value)}`);
  }
  if (!rows.length) return "";
  return "---\n" + rows.join("\n") + "\n---";
}
