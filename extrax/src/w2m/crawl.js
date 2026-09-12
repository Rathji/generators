import { normalizeUrl } from "./urls.js";
import { W2MError } from "./errors.js";
import { crc32, createZip, uniqueZipName } from "../lib/zip.js";

export { crc32, createZip, uniqueZipName };

const SKIP_SCHEME = /^(?:mailto|tel|sms|javascript|data|blob|ftp|ftps|file|about|chrome|view-source):/i;
const SKIP_EXT = /\.(?:pdf|zip|gz|tgz|tar|rar|7z|png|jpe?g|gif|svg|webp|avif|bmp|ico|mp4|m4v|mov|avi|webm|mkv|mp3|wav|ogg|flac|woff2?|ttf|otf|eot|css|js|mjs|json|xml|rss|atom|docx?|xlsx?|pptx?|csv|txt|exe|dmg|apk|iso)$/i;
const HTML_EXT = /\.(?:html?|php|asp|aspx|jsp)$/i;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); } catch (err) { return ""; }
}

export function sameSite(a, b) {
  const ha = hostOf(a);
  const hb = hostOf(b);
  return !!ha && ha === hb;
}

export function normalizeCrawlUrl(input) {
  const norm = normalizeUrl(input);
  if (!norm.ok) return norm;
  let u;
  try { u = new URL(norm.url); } catch (err) { return { ok: false, error: "invalid", url: norm.url }; }
  u.hash = "";
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  u.pathname = path || "/";
  return { ok: true, url: u.href, host: u.hostname };
}

export function crawlKey(url) {
  const norm = normalizeCrawlUrl(url);
  if (!norm.ok) return String(url == null ? "" : url).trim().toLowerCase();
  const stripped = norm.url.replace(/\/+$/, "");
  return (stripped || norm.url).toLowerCase();
}

export function extractLinks(doc) {
  const out = [];
  if (!doc) return out;
  for (const el of doc.querySelectorAll("a[href], area[href]")) {
    const href = (el.getAttribute("href") || "").trim();
    if (!href) continue;
    out.push({ href, text: (el.textContent || "").replace(/\s+/g, " ").trim() });
  }
  return out;
}

export function linksFromHtml(html, baseUrl, options = {}) {
  const parse = options.parse || (h => new DOMParser().parseFromString(String(h == null ? "" : h), "text/html"));
  let doc;
  try { doc = parse(html); } catch (err) { return []; }
  const base = options.baseUrl || baseUrl || "";
  const baseHost = hostOf(base);
  const baseKey = crawlKey(base);
  const sameHostOnly = options.sameHostOnly !== false;
  const include = String(options.include || "").trim().toLowerCase();
  const exclude = String(options.exclude || "").trim().toLowerCase();

  const seen = new Set();
  const out = [];
  for (const { href, text } of extractLinks(doc)) {
    if (!href || href.startsWith("#") || SKIP_SCHEME.test(href)) continue;
    let u;
    try { u = new URL(href, base); } catch (err) { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    u.hash = "";
    if (SKIP_EXT.test(u.pathname)) continue;
    const url = u.href;
    if (sameHostOnly && hostOf(url) !== baseHost) continue;
    const low = url.toLowerCase();
    if (include && low.indexOf(include) === -1) continue;
    if (exclude && low.indexOf(exclude) !== -1) continue;
    const key = crawlKey(url);
    if (!key || key === baseKey || seen.has(key)) continue;
    seen.add(key);
    out.push({ url, text });
  }
  return out;
}

export function crawlTree(pages) {
  const list = Array.isArray(pages) ? pages : [];
  const nodes = new Map();
  for (const p of list) {
    if (!p) continue;
    const key = crawlKey(p.url);
    if (nodes.has(key)) continue;
    nodes.set(key, { url: p.url, title: p.title || "", status: p.status || "queued", depth: p.depth || 0, error: p.error || null, children: [] });
  }
  const roots = [];
  for (const p of list) {
    if (!p) continue;
    const node = nodes.get(crawlKey(p.url));
    if (!node) continue;
    const parent = p.parent ? nodes.get(crawlKey(p.parent)) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function slugSegment(segment) {
  let value = String(segment == null ? "" : segment);
  try { value = decodeURIComponent(value); } catch (err) { /* keep raw */ }
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "page";
}

export function crawlFilePath(url) {
  let u;
  try { u = new URL(url); } catch (err) { return "site/index.md"; }
  const host = (u.hostname || "site").replace(/^www\./i, "").replace(/[^a-z0-9.-]+/gi, "-").toLowerCase() || "site";
  const rawSegs = u.pathname.split("/").filter(Boolean).map(slugSegment);
  const isDir = u.pathname.endsWith("/") || rawSegs.length === 0;
  let segs = rawSegs;
  let file;
  if (isDir) {
    file = "index.md";
  } else {
    let last = segs[segs.length - 1] || "index";
    if (HTML_EXT.test(last)) { last = last.replace(HTML_EXT, ""); file = (last || "index") + ".md"; }
    else if (/\.[a-z0-9]+$/i.test(last)) { last = last.replace(/\.[a-z0-9]+$/i, ""); file = (last || "index") + ".md"; }
    else { file = last + ".md"; }
    segs = segs.slice(0, -1);
  }
  return [host, ...segs, file].join("/");
}

export function crawlFilePaths(pages) {
  const used = new Set();
  const out = new Map();
  for (const p of (Array.isArray(pages) ? pages : [])) {
    if (!p || p.status !== "ok") continue;
    const name = uniqueZipName(crawlFilePath(p.finalUrl || p.url), used);
    used.add(name);
    out.set(p.url, name);
  }
  return out;
}

export async function crawlSite(start, options = {}) {
  const fetchPage = options.fetchPage;
  const buildDoc = typeof options.buildDoc === "function" ? options.buildDoc : ((html, url) => ({ title: url, markdown: String(html == null ? "" : html), body: "", metadata: {}, stats: {}, truncation: null }));
  if (typeof fetchPage !== "function") throw new Error("crawlSite requires a fetchPage function");

  const maxDepth = clampInt(options.maxDepth, 0, 10, 2);
  const maxPages = clampInt(options.maxPages, 1, 500, 25);
  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  const sameHostOnly = options.sameHostOnly !== false;
  const shouldStop = options.shouldStop;
  const onStart = options.onStart;
  const onVisit = options.onVisit;
  const onQueue = options.onQueue;
  const include = options.include;
  const exclude = options.exclude;

  const startNorm = normalizeCrawlUrl(start);
  if (!startNorm.ok) throw new W2MError(startNorm.error || "invalid");

  const seeded = Array.isArray(options.seed) ? options.seed : [];
  const queue = seeded.length
    ? seeded.map(n => ({ url: n.url, depth: Number(n.depth) || 0, parent: n.parent || null }))
    : [{ url: startNorm.url, depth: 0, parent: null }];
  const seen = new Set((Array.isArray(options.seen) ? options.seen : []).map(k => String(k)));
  seen.add(crawlKey(startNorm.url));
  const pages = [];
  let stopped = false;

  const reportQueue = () => {
    if (typeof onQueue === "function") onQueue(queue.map(n => ({ url: n.url, depth: n.depth, parent: n.parent })));
  };
  reportQueue();

  while (queue.length && pages.length < maxPages) {
    if (typeof shouldStop === "function" && shouldStop()) { stopped = true; break; }
    const node = queue.shift();
    const page = { url: node.url, depth: node.depth, parent: node.parent, status: "fetching", title: "", markdown: "", fetched: null, doc: null, error: null };
    pages.push(page);
    if (typeof onStart === "function") onStart(page, pages.length, maxPages);

    try {
      const fetched = await fetchPage(node.url, node);
      page.fetched = fetched || {};
      page.finalUrl = (fetched && (fetched.finalUrl || fetched.url)) || node.url;
      page.host = (fetched && fetched.host) || hostOf(page.finalUrl);
      const doc = buildDoc(fetched && fetched.html != null ? fetched.html : "", page.finalUrl);
      page.doc = doc || {};
      page.title = (doc && doc.title) || page.host || node.url;
      page.markdown = (doc && doc.markdown) || "";
      page.status = "ok";

      if (node.depth < maxDepth && fetched && fetched.html != null) {
        const links = linksFromHtml(fetched.html, page.finalUrl, { sameHostOnly, include, exclude });
        for (const link of links) {
          const key = crawlKey(link.url);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          queue.push({ url: link.url, depth: node.depth + 1, parent: page.url });
        }
        reportQueue();
      }
    } catch (err) {
      page.status = "error";
      page.error = err;
    }

    if (typeof onVisit === "function") onVisit(page, pages.length, maxPages);
    reportQueue();
    if (delayMs > 0 && queue.length && pages.length < maxPages) await sleep(delayMs);
  }

  for (const node of queue) {
    pages.push({ url: node.url, depth: node.depth, parent: node.parent, status: "skipped", title: "", markdown: "", fetched: null, doc: null, error: null });
  }

  const ok = pages.filter(p => p.status === "ok").length;
  const failed = pages.filter(p => p.status === "error").length;
  const skipped = pages.filter(p => p.status === "skipped").length;
  return { pages, start: startNorm.url, host: startNorm.host, maxDepth, maxPages, stopped, total: pages.length, ok, failed, skipped };
}

function mdLabel(text) {
  return String(text == null ? "" : text).replace(/[[\]()]/g, "").replace(/\s+/g, " ").trim();
}

export function crawlManifest(pages, options = {}) {
  const list = (Array.isArray(pages) ? pages : []).filter(p => p && p.status === "ok");
  const paths = options.paths instanceof Map ? options.paths : crawlFilePaths(pages);
  const start = options.startUrl || (list[0] && (list[0].finalUrl || list[0].url)) || "";
  const title = options.title || "Site export";
  const created = options.createdAt != null ? new Date(options.createdAt) : new Date();
  const stamp = Number.isNaN(created.getTime()) ? "" : created.toISOString().slice(0, 10);

  const lines = ["# " + title, ""];
  if (start) lines.push("- **Start:** " + start);
  if (stamp) lines.push("- **Captured:** " + stamp);
  lines.push("- **Pages:** " + list.length, "");
  for (const p of list) {
    const name = paths.get(p.url) || "";
    const indent = "  ".repeat(Math.max(0, Math.min(6, p.depth || 0)));
    const label = mdLabel(p.title) || mdLabel(p.finalUrl || p.url) || "Untitled";
    lines.push(indent + "- [" + label + "](" + encodeURI(name) + ") — " + (p.finalUrl || p.url));
  }
  const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  return { markdown, count: list.length, start };
}
