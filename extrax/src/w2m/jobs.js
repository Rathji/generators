import { markdownStats } from "./stats.js";

const CURRENT_KEY = "current";

function jobId() {
  return "job-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

export function createJob(input = {}) {
  return {
    id: input.id || jobId(),
    mode: input.mode || "batch",
    status: input.status || "running",
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
    options: input.options || {},
    start: input.start || "",
    host: input.host || "",
    items: Array.isArray(input.items) ? input.items : [],
    done: Array.isArray(input.done) ? input.done : [],
    queue: Array.isArray(input.queue) ? input.queue : [],
    seen: Array.isArray(input.seen) ? input.seen : [],
    pages: Array.isArray(input.pages) ? input.pages : [],
    total: input.total || 0,
    note: input.note || ""
  };
}

export function createJobStore(folder) {
  async function get() {
    try {
      const job = await folder.get(CURRENT_KEY);
      return job && typeof job === "object" ? job : null;
    } catch (err) {
      return null;
    }
  }
  async function save(job) {
    const next = { ...job, updatedAt: Date.now() };
    await folder.set(CURRENT_KEY, next);
    return next;
  }
  async function clear() {
    try { await folder.delete(CURRENT_KEY); } catch (err) { /* already gone */ }
  }
  return { get, save, clear };
}

export function isResumable(job) {
  if (!job) return false;
  if (job.status === "done") return false;
  if (job.mode === "batch") return (job.done || []).length < (job.items || []).length;
  if (job.mode === "crawl") return (job.pages || []).length > 0 || (job.queue || []).length > 0;
  return false;
}

export function jobProgress(job) {
  if (!job) return { done: 0, total: 0, percent: 0 };
  if (job.mode === "batch") {
    const total = (job.items || []).length;
    const done = (job.done || []).length;
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
  }
  const done = (job.pages || []).length;
  const total = done + (job.queue || []).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

export function jobSummary(job) {
  if (!job) return "";
  const p = jobProgress(job);
  const when = new Date(job.updatedAt || job.createdAt).toLocaleString();
  if (job.mode === "batch") {
    return "Batch · " + p.done + " of " + p.total + " page" + (p.total === 1 ? "" : "s") + " · " + when;
  }
  return "Site crawl · " + p.done + " captured" + (p.total > p.done ? ", " + (p.total - p.done) + " queued" : "") + " · " + when;
}

function serializedResult(entry) {
  const value = entry.value || {};
  const doc = value.doc || {};
  const fetched = value.fetched || {};
  return {
    index: entry.index,
    status: entry.status,
    invalid: !!entry.invalid,
    error: entry.error && entry.error.code ? entry.error.code : (entry.error ? String(entry.error.message || entry.error) : ""),
    item: {
      raw: entry.item && entry.item.raw,
      label: entry.item && entry.item.label,
      url: entry.item && entry.item.url,
      host: entry.item && entry.item.host,
      valid: !!(entry.item && entry.item.valid)
    },
    title: doc.title || "",
    url: fetched.finalUrl || fetched.url || (entry.item && entry.item.url) || "",
    host: fetched.host || (entry.item && entry.item.host) || "",
    markdown: typeof doc.markdown === "string" ? doc.markdown : "",
    metadata: doc.metadata || {},
    frontmatter: doc.frontmatter || "",
    body: doc.body || "",
    stats: doc.stats || markdownStats(doc.markdown || ""),
    cleanedBody: value.cleanedBody != null ? value.cleanedBody : null
  };
}

export function serializeBatchResults(results) {
  return (Array.isArray(results) ? results : []).map(serializedResult);
}

function rebuiltValue(rec) {
  const doc = {
    title: rec.title || rec.url,
    metadata: rec.metadata || {},
    frontmatter: rec.frontmatter || "",
    body: rec.body || rec.markdown || "",
    markdown: rec.markdown || "",
    stats: rec.stats || markdownStats(rec.markdown || ""),
    truncation: null,
    extracted: { contentHtml: "" }
  };
  const active = rec.cleanedBody != null ? { ...doc, body: rec.cleanedBody, markdown: (rec.frontmatter ? rec.frontmatter + "\n\n" : "") + rec.cleanedBody, cleaned: true } : doc;
  return {
    fetched: { host: rec.host || "", finalUrl: rec.url || "", url: rec.url || "", status: 0, html: "", bytes: 0, elapsedMs: 0 },
    doc: active,
    baseDoc: doc,
    cleanedBody: rec.cleanedBody != null ? rec.cleanedBody : null,
    quality: null
  };
}

export function deserializeBatchResults(records) {
  return (Array.isArray(records) ? records : []).map(rec => {
    const item = {
      raw: rec.item && rec.item.raw,
      label: rec.item && rec.item.label,
      url: rec.item && rec.item.url,
      host: rec.item && rec.item.host,
      valid: !!(rec.item && rec.item.valid)
    };
    if (rec.status === "ok") return { item, index: rec.index, status: "ok", value: rebuiltValue(rec) };
    return { item, index: rec.index, status: rec.status || "error", invalid: !!rec.invalid, error: rec.error || "invalid_url" };
  });
}

export function serializeCrawlPages(pages) {
  return (Array.isArray(pages) ? pages : [])
    .filter(p => p && p.status === "ok")
    .map(p => ({
      url: p.url,
      finalUrl: p.finalUrl || p.url,
      host: p.host || "",
      title: p.title || "",
      markdown: p.markdown || "",
      depth: p.depth || 0,
      parent: p.parent || null,
      metadata: (p.doc && p.doc.metadata) || {}
    }));
}

export function deserializeCrawlPages(records) {
  return (Array.isArray(records) ? records : []).map(rec => ({
    url: rec.url,
    finalUrl: rec.finalUrl || rec.url,
    host: rec.host || "",
    title: rec.title || rec.url,
    markdown: rec.markdown || "",
    depth: rec.depth || 0,
    parent: rec.parent || null,
    status: "ok",
    fetched: null,
    doc: { title: rec.title || rec.url, markdown: rec.markdown || "", metadata: rec.metadata || {}, stats: markdownStats(rec.markdown || "") },
    error: null
  }));
}
