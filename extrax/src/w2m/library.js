const ORDER_KEY = "order";
const DOC_PREFIX = "doc_";

export function createDocStore(folder) {
  async function list() {
    const order = await folder.get(ORDER_KEY);
    const ids = Array.isArray(order) ? order : [];
    const docs = [];
    for (const id of ids) {
      const doc = await folder.get(DOC_PREFIX + id);
      if (doc) docs.push(doc);
    }
    return docs;
  }

  async function save(doc) {
    await folder.set(DOC_PREFIX + doc.id, doc);
    await folder.update(ORDER_KEY, current => {
      const arr = Array.isArray(current) ? current : [];
      if (!arr.includes(doc.id)) arr.unshift(doc.id);
      return arr;
    });
    return doc;
  }

  async function remove(id) {
    await folder.delete(DOC_PREFIX + id);
    await folder.update(ORDER_KEY, current => (Array.isArray(current) ? current : []).filter(x => x !== id));
  }

  async function patch(id, changes) {
    const doc = await folder.get(DOC_PREFIX + id);
    if (!doc) return null;
    const next = { ...doc, ...changes };
    await folder.set(DOC_PREFIX + id, next);
    return next;
  }

  return { list, save, remove, patch };
}

function newId() {
  try {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (err) { /* fall through */ }
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function createDocRecord(input = {}) {
  const createdAt = Number.isFinite(input.createdAt) ? input.createdAt : Date.now();
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map(t => normalizeTag(t)).filter(Boolean))]
    : [];
  return {
    id: input.id ? String(input.id) : newId(),
    title: String(input.title || input.url || "Untitled document").trim(),
    url: String(input.url || "").trim(),
    site: String(input.site || "").trim(),
    author: String(input.author || "").trim(),
    published: String(input.published || "").trim(),
    tags,
    notes: String(input.notes || ""),
    markdown: String(input.markdown || ""),
    stats: input.stats && typeof input.stats === "object" ? input.stats : {},
    options: input.options && typeof input.options === "object" ? input.options : {},
    createdAt
  };
}

export function slugifyTitle(title) {
  const slug = String(title == null ? "" : title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "document";
}

export function docFilename(doc) {
  const base = slugifyTitle(doc && (doc.title || doc.site) || "document");
  const when = doc && doc.createdAt ? new Date(doc.createdAt) : new Date();
  const stamp = Number.isNaN(when.getTime()) ? new Date().toISOString().slice(0, 10) : when.toISOString().slice(0, 10);
  return base + "-" + stamp + ".md";
}

export function uniqueFilename(name, used) {
  const taken = used instanceof Set ? used : new Set(used ? Array.from(used) : []);
  const value = String(name == null || name === "" ? "document.md" : name);
  if (!taken.has(value)) return value;
  const match = /^(.*?)(\.[^.]+)?$/.exec(value);
  const base = match ? match[1] : value;
  const ext = (match && match[2]) || "";
  let n = 2;
  let candidate = base + "-" + n + ext;
  while (taken.has(candidate)) {
    n++;
    candidate = base + "-" + n + ext;
  }
  return candidate;
}

export function normalizeTag(tag) {
  return String(tag == null ? "" : tag).trim().replace(/\s+/g, " ").toLowerCase().slice(0, 32);
}

export function docSearchHaystack(doc) {
  if (!doc) return "";
  return [
    doc.title, doc.url, doc.site, doc.author, doc.published,
    (doc.tags || []).join(" "), doc.notes, doc.markdown
  ].filter(Boolean).join(" ").toLowerCase();
}

export function matchDoc(doc, query) {
  const q = String(query == null ? "" : query).trim().toLowerCase();
  if (!q) return true;
  return docSearchHaystack(doc).indexOf(q) !== -1;
}
