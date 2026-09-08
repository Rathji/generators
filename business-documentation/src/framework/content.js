// src/framework/content.js — the KB content layer. Everything above the raw
// document store: article records + version history + review workflow, the
// category tree, document-type templates, reusable snippets, full-text search,
// related/backlinks, audit log, data-integrity checks, backup/restore,
// capacity, feedback and retrieval-ready bundles.
//
// All state lives in the versioned document store (one document per concern),
// so every mutation flows through the store's sync/conflict layer and is never
// silently lost. `cache` is the kv-backed cache for the namespace; `activity`
// is a second kv folder for per-device state (article "seen" timestamps,
// follows, checklist ticks).

import { renderMarkdown, titleLookup, extractArticleLinks } from "./markdown.js";

const rnd = (p = 6) => Math.random().toString(36).slice(2, 2 + p);
const uid = (p) => p + "-" + rnd(8) + Date.now().toString(36).slice(-4);
const now = () => Date.now();
const DAY = 86400000;

const STATUSES = ["draft", "in_review", "published", "archived"];
const DOC_TYPES = ["sop", "policy", "how-to", "reference", "faq"];

const DOC_TYPE_LABELS = {
  sop: "SOP",
  policy: "Policy",
  "how-to": "How-to",
  reference: "Reference",
  faq: "FAQ",
};

export const CONTENT_LABELS = { DOC_TYPES, DOC_TYPE_LABELS };

function normRecord(r) {
  const rec = {
    id: r.id || uid("art"),
    title: String(r.title || "Untitled").slice(0, 200),
    summary: String(r.summary || "").slice(0, 500),
    body: String(r.body || ""),
    tags: Array.isArray(r.tags) ? r.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [],
    categoryId: r.categoryId || "",
    docType: DOC_TYPES.includes(r.docType) ? r.docType : "sop",
    owner: r.owner || "",
    status: STATUSES.includes(r.status) ? r.status : "draft",
    created: r.created || { at: now(), by: r.createdBy || "" },
    updated: r.updated || { at: now(), by: r.updatedBy || "" },
    reviewedAt: r.reviewedAt || null,
    reviewIntervalDays: Number(r.reviewIntervalDays) > 0 ? Number(r.reviewIntervalDays) : null,
    publishedVersion: r.publishedVersion || null,
    versions: Array.isArray(r.versions) ? r.versions : [],
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
    links: Array.isArray(r.links) ? r.links : [],
    processRefs: Array.isArray(r.processRefs) ? r.processRefs : [],
    feedback: Array.isArray(r.feedback) ? r.feedback : [],
    flags: r.flags || {},
  };
  return rec;
}

export function createContentService({ store, cache, activity, uploadPlugin, generatorName, now: _now = now, announce = null } = {}) {
  const now = _now;
  const cacheGet = async (k) => {
    try {
      return await cache.get(k);
    } catch {
      return undefined;
    }
  };
  const cacheSet = async (k, v) => {
    try {
      await cache.set(k, v);
    } catch {}
  };
  const cacheDel = async (k) => {
    try {
      await cache.del(k);
    } catch {}
  };

  async function readDoc(id) {
    try {
      const d = await store.readDocument(id);
      return d && d.data !== undefined ? d.data : null;
    } catch {
      return null;
    }
  }

  async function writeDoc(id, data, by, note) {
    const res = await store.writeDocument(id, data, { updatedBy: by || "system" });
    return res;
  }

  // ---- realtime change announcements (Phase 9, hub hook) ------------------
  // Called after any article-affecting mutation so the hub can broadcast the
  // new version to other open sessions. Fire-and-forget — never blocks saves.
  function notify(rec) {
    if (typeof announce !== "function" || !rec) return;
    try {
      const p = announce({ articleId: rec.id, categoryId: rec.categoryId || "", version: latestVersionNumber(rec), updatedAt: now() });
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }

  // ---- identity -----------------------------------------------------------
  async function getSettings() {
    return (await readDoc("settings")) || {};
  }
  async function getIdentity() {
    const s = await getSettings();
    return (s.identity && s.identity.name) || "";
  }
  async function setIdentity(name) {
    const s = await getSettings();
    const next = { ...s, identity: { name: String(name || "").slice(0, 60), updatedAt: now() } };
    await writeDoc("settings", next, name || "system");
  }

  // ---- articles -----------------------------------------------------------
  async function listArticles() {
    const d = await readDoc("articles");
    return Array.isArray(d && d.items) ? d.items : [];
  }

  async function getArticle(id) {
    const items = await listArticles();
    return items.find((a) => a.id === id) || null;
  }

  // The content a reader should see: the last approved version when a revision
  // is pending, otherwise the working copy.
  function liveContent(record) {
    const rec = normRecord(record);
    if (rec.status === "in_review" && rec.publishedVersion) {
      const snap = rec.versions.find((v) => v.n === rec.publishedVersion);
      if (snap && snap.data) return { data: snap.data, version: snap.n, pendingRevision: true };
    }
    return { data: rec, version: latestVersionNumber(rec), pendingRevision: false };
  }

  function latestVersionNumber(rec) {
    return rec.versions.length ? Math.max(...rec.versions.map((v) => v.n)) : 0;
  }

  function editableFields(rec) {
    return {
      title: rec.title,
      summary: rec.summary,
      body: rec.body,
      tags: rec.tags,
      categoryId: rec.categoryId,
      docType: rec.docType,
      owner: rec.owner,
      reviewIntervalDays: rec.reviewIntervalDays,
      blocks: rec.blocks,
      links: rec.links,
      processRefs: rec.processRefs,
    };
  }

  function changeSummary(rec, prevFields) {
    const parts = [];
    if (rec.title !== prevFields.title) parts.push("title");
    if (rec.summary !== prevFields.summary) parts.push("summary");
    if (rec.body !== prevFields.body) parts.push("body");
    if (JSON.stringify(rec.tags) !== JSON.stringify(prevFields.tags)) parts.push("tags");
    if (rec.categoryId !== prevFields.categoryId) parts.push("category");
    if (rec.docType !== prevFields.docType) parts.push("type");
    if (rec.owner !== prevFields.owner) parts.push("owner");
    if (rec.reviewIntervalDays !== prevFields.reviewIntervalDays) parts.push("review interval");
    if (JSON.stringify(rec.blocks) !== JSON.stringify(prevFields.blocks)) parts.push("SOP steps");
    if (JSON.stringify(rec.links) !== JSON.stringify(prevFields.links)) parts.push("links");
    if (JSON.stringify(rec.processRefs) !== JSON.stringify(prevFields.processRefs)) parts.push("process links");
    return parts.length ? "Edited " + parts.join(", ") : "No content change";
  }

  // Persist an article. Every real change appends a version snapshot.
  async function saveArticle(record, { by = "", summary = null } = {}) {
    const all = await listArticles();
    const idx = all.findIndex((a) => a.id === record.id);
    const prev = idx >= 0 ? normRecord(all[idx]) : null;
    const rec = normRecord(record);

    if (prev) {
      rec.created = prev.created;
      // editing a published article routes the revision through review
      if (prev.status === "published" && (rec.body !== prev.body || rec.title !== prev.title || rec.summary !== prev.summary)) {
        rec.status = "in_review";
        rec.flags = { ...(prev.flags || {}), revisionOf: prev.publishedVersion };
      } else if (prev.status === "in_review") {
        rec.status = "in_review"; // stay pending; a new revision replaces the old
      } else {
        rec.status = prev.status;
      }
      rec.reviewedAt = prev.reviewedAt;
      rec.publishedVersion = prev.publishedVersion;
      rec.versions = prev.versions;
      rec.feedback = prev.feedback;
      rec.attachments = prev.attachments;
      rec.created = prev.created;
    } else {
      rec.status = rec.status === "in_review" ? "draft" : rec.status;
    }

    const prevFields = prev ? editableFields(prev) : null;
    const changed = !prev || JSON.stringify(editableFields(rec)) !== JSON.stringify(prevFields);
    const n = (prev ? latestVersionNumber(prev) : 0) + 1;
    if (changed || prev === null) {
      rec.versions = [
        ...(rec.versions || []),
        { n, at: now(), by: by || rec.owner || "system", summary: summary || (prev ? changeSummary(rec, prevFields) : "Created"), data: editableFields(rec), status: rec.status },
      ];
      // cap history so a long-lived KB doesn't grow without bound
      if (rec.versions.length > 200) rec.versions = rec.versions.slice(rec.versions.length - 200);
    }
    rec.updated = { at: now(), by: by || rec.owner || "system" };

    const items = prev ? all.map((a) => (a.id === rec.id ? rec : a)) : [...all, rec];
    await writeDoc("articles", { items }, by || rec.owner || "system");
    notify(rec);
    await audit(prev ? "edited" : "created", rec.id, by || rec.owner || "system", { version: n, summary: summary || "saved" });
    return rec;
  }

  async function createArticle({ docType = "sop", categoryId = "", owner = "", by = "" } = {}) {
    const tpl = await getTemplate(docType);
    const id = uid("art");
    const rec = normRecord({
      id,
      docType,
      categoryId,
      owner,
      by,
      body: tpl ? tpl.body : "",
      title: tpl ? "" : "Untitled " + DOC_TYPE_LABELS[docType],
    });
    const saved = await saveArticle(rec, { by: by || owner || "system", summary: "Created from " + DOC_TYPE_LABELS[docType] + " template" });
    return saved;
  }

  async function deleteArticle(id, by = "") {
    const all = await listArticles();
    const next = all.filter((a) => a.id !== id);
    if (next.length === all.length) return { changed: false };
    await writeDoc("articles", { items: next }, by || "system");
    await audit("deleted", id, by || "system", {});
    return { changed: true };
  }

  // ---- review workflow (task 13) -------------------------------------------
  async function submitForReview(id, by = "") {
    return transition(id, "submit", by);
  }
  async function approveArticle(id, by = "", comment = "") {
    return transition(id, "approve", by, comment);
  }
  async function returnArticle(id, by = "", comment = "") {
    return transition(id, "return", by, comment);
  }
  async function publishArticle(id, by = "") {
    return transition(id, "publish", by);
  }
  async function archiveArticle(id, by = "") {
    return transition(id, "archive", by);
  }
  async function restoreArticle(id, by = "") {
    return transition(id, "restore", by);
  }

  async function transition(id, action, by = "", comment = "") {
    const all = await listArticles();
    const idx = all.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error("Article not found.");
    const rec = normRecord(all[idx]);
    const prevStatus = rec.status;
    let allowed = false;
    if (action === "submit" && rec.status === "draft") {
      rec.status = "in_review";
      allowed = true;
    } else if (action === "approve" && rec.status === "in_review") {
      rec.status = "published";
      rec.publishedVersion = latestVersionNumber(rec);
      rec.reviewedAt = now(); // an approval counts as a review
      allowed = true;
    } else if (action === "return" && rec.status === "in_review") {
      rec.status = "draft";
      allowed = true;
    } else if (action === "publish" && rec.status === "draft") {
      rec.status = "published";
      rec.publishedVersion = latestVersionNumber(rec);
      rec.reviewedAt = now();
      allowed = true;
    } else if (action === "archive" && rec.status === "published") {
      rec.status = "archived";
      allowed = true;
    } else if (action === "restore" && rec.status === "archived") {
      rec.status = "draft";
      allowed = true;
    }
    if (!allowed) throw new Error(`Cannot ${action} an article that is “${prevStatus}”.`);
    rec.updated = { at: now(), by };
    if (action === "approve" || action === "return" || action === "submit") {
      const v = latestVersionNumber(rec);
      rec.versions = [
        ...rec.versions,
        { n: v + 1, at: now(), by, summary: `${action === "approve" ? "Approved" : action === "return" ? "Returned for revision" : "Submitted for review"}` + (comment ? ` — ${comment}` : ""), data: editableFields(rec), status: rec.status, transition: true },
      ];
    }
    const items = all.map((a) => (a.id === id ? rec : a));
    await writeDoc("articles", { items }, by || "system");
    notify(rec);
    await audit(action, id, by || "system", { from: prevStatus, to: rec.status, comment });
    try {
      const rl = await readDoc("reviewLog");
      const entries = (rl && rl.entries) || [];
      await writeDoc(
        "reviewLog",
        { entries: [...entries.slice(-500), { at: now(), actor: by || "system", action, articleId: id, from: prevStatus, to: rec.status, comment }] },
        by || "system",
      );
    } catch {}
    if (action === "approve" || action === "publish") {
      // keep the retrieval-ready bundle current (fire-and-forget — never blocks the transition)
      refreshBundles().catch(() => {});
    }
    return { action, from: prevStatus, to: rec.status, rec };
  }

  async function markReviewed(id, by = "") {
    const all = await listArticles();
    const idx = all.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error("Article not found.");
    const rec = normRecord(all[idx]);
    rec.reviewedAt = now();
    rec.updated = { at: now(), by };
    const items = all.map((a) => (a.id === id ? rec : a));
    await writeDoc("articles", { items }, by || "system");
    notify(rec);
    await audit("reviewed-no-change", id, by || "system", {});
    return rec;
  }

  // Send a published article back through the workflow: it becomes a pending
  // revision (readers keep seeing the last approved version) until a reviewer
  // approves it — which refreshes the review date.
  async function sendForReReview(id, by = "") {
    const all = await listArticles();
    const idx = all.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error("Article not found.");
    const rec = normRecord(all[idx]);
    if (rec.status !== "published") throw new Error("Only published articles can be sent for re-review.");
    rec.status = "in_review";
    rec.flags = { ...(rec.flags || {}), revisionOf: rec.publishedVersion };
    rec.updated = { at: now(), by };
    const items = all.map((a) => (a.id === id ? rec : a));
    await writeDoc("articles", { items }, by || "system");
    notify(rec);
    await audit("sent-for-review", id, by || "system", {});
    try {
      const rl = await readDoc("reviewLog");
      const entries = (rl && rl.entries) || [];
      await writeDoc(
        "reviewLog",
        { entries: [...entries.slice(-500), { at: now(), actor: by || "system", action: "sent-for-review", articleId: id, from: "published", to: "in_review", comment: "scheduled re-review" }] },
        by || "system",
      );
    } catch {}
    return rec;
  }

  async function restoreVersion(id, n, by = "") {
    const all = await listArticles();
    const idx = all.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error("Article not found.");
    const rec = normRecord(all[idx]);
    const snap = rec.versions.find((v) => v.n === n);
    if (!snap) throw new Error(`No version ${n} of this article.`);
    const restored = normRecord({ ...rec, ...snap.data });
    restored.id = rec.id;
    restored.created = rec.created;
    restored.reviewedAt = rec.reviewedAt;
    restored.reviewIntervalDays = snap.data.reviewIntervalDays ?? rec.reviewIntervalDays;
    restored.versions = rec.versions;
    restored.attachments = rec.attachments;
    restored.feedback = rec.feedback;
    restored.publishedVersion = rec.publishedVersion;
    // restoring always makes a NEW draft (never overwrites live content)
    if (rec.status === "published") restored.status = "in_review";
    else if (rec.status === "archived") restored.status = "draft";
    const saved = await saveArticle(restored, { by, summary: `Restored version ${n}` });
    return saved;
  }

  // ---- categories ----------------------------------------------------------
  async function getCategoryTree() {
    const d = await readDoc("categories");
    return Array.isArray(d) ? d : [];
  }
  async function getCategory(id) {
    const tree = await getCategoryTree();
    return findCat(tree, id) || null;
  }
  async function categoryPath(id) {
    const tree = await getCategoryTree();
    const path = [];
    findPath(tree, id, path);
    return path.map((c) => c.label);
  }
  function findCat(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children && n.children.length) {
        const f = findCat(n.children, id);
        if (f) return f;
      }
    }
    return null;
  }
  function findPath(nodes, id, acc) {
    for (const n of nodes) {
      if (n.id === id) {
        acc.push(n);
        return true;
      }
      if (n.children && n.children.length) {
        acc.push(n);
        if (findPath(n.children, id, acc)) return true;
        acc.pop();
      }
    }
    return false;
  }
  function leafIds(nodes, out = []) {
    for (const n of nodes) {
      if (n.children && n.children.length) leafIds(n.children, out);
      else out.push(n.id);
    }
    return out;
  }

  async function saveCategoryTree(tree, by = "", action = "") {
    await writeDoc("categories", tree, by || "system");
    await audit("categories-" + (action || "updated"), "", by || "system", {});
  }

  async function addCategory({ parentId = "", id, label }) {
    const tree = await getCategoryTree();
    const cid = (id || uid("cat")).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const node = { id: cid, label: String(label || "New category").slice(0, 80), children: [] };
    if (parentId) {
      const parent = findCat(tree, parentId);
      if (!parent) throw new Error("Parent category not found.");
      parent.children = [...(parent.children || []), node];
    } else {
      tree.push(node);
    }
    await saveCategoryTree(tree, "", "added");
    return node;
  }

  async function renameCategory(id, label) {
    const tree = await getCategoryTree();
    const node = findCat(tree, id);
    if (!node) throw new Error("Category not found.");
    node.label = String(label || node.label).slice(0, 80);
    await saveCategoryTree(tree, "", "renamed");
    return node;
  }

  async function moveCategory(id, newParentId) {
    const tree = await getCategoryTree();
    const node = findCat(tree, id);
    if (!node) throw new Error("Category not found.");
    if (newParentId && newParentId !== id && isDescendant(node, newParentId)) {
      throw new Error("A category cannot be moved under itself.");
    }
    removeNode(tree, id);
    if (newParentId) {
      const parent = findCat(tree, newParentId);
      if (!parent) throw new Error("Parent category not found.");
      parent.children = [...(parent.children || []), node];
    } else {
      tree.push(node);
    }
    await saveCategoryTree(tree, "", "moved");
    return tree;
  }

  async function deleteCategory(id) {
    const articles = await listArticles();
    const refs = articles.filter((a) => a.categoryId === id);
    if (refs.length) {
      throw new Error(`Cannot delete “${id}” — ${refs.length} article${refs.length === 1 ? "" : "s"} still reference it. Move them first.`);
    }
    const tree = await getCategoryTree();
    removeNode(tree, id);
    await saveCategoryTree(tree, "", "deleted");
    return tree;
  }

  function isDescendant(node, id) {
    for (const c of node.children || []) {
      if (c.id === id) return true;
      if (isDescendant(c, id)) return true;
    }
    return false;
  }
  function removeNode(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        nodes.splice(i, 1);
        return true;
      }
      if (nodes[i].children && removeNode(nodes[i].children, id)) return true;
    }
    return false;
  }

  // ---- templates (task 8) ---------------------------------------------------
  async function listTemplates() {
    const d = await readDoc("templates");
    return Array.isArray(d && d.items) ? d.items : [];
  }
  async function getTemplate(docType) {
    const all = await listTemplates();
    return all.find((t) => t.docType === docType) || null;
  }
  async function saveTemplate(tpl) {
    const all = await listTemplates();
    const idx = all.findIndex((t) => t.id === tpl.id);
    const next = idx >= 0 ? all.map((t) => (t.id === tpl.id ? tpl : t)) : [...all, tpl];
    await writeDoc("templates", { items: next }, "system");
    return tpl;
  }
  async function deleteTemplate(id) {
    const all = await listTemplates();
    await writeDoc("templates", { items: all.filter((t) => t.id !== id) }, "system");
  }
  async function seedDefaultTemplates() {
    const existing = await listTemplates();
    if (existing.length) return;
    const defs = defaultTemplates();
    await writeDoc("templates", { items: defs }, "system");
  }

  function defaultTemplates() {
    return [
      {
        id: "tpl-sop",
        docType: "sop",
        name: "Standard Operating Procedure",
        desc: "Purpose, scope, prerequisites, numbered steps with owners, roles and checklists.",
        body: [
          "# Purpose",
          "State why this procedure exists and what it accomplishes.",
          "",
          "## Scope",
          "Who/what this procedure applies to, and any boundaries.",
          "",
          "## Prerequisites",
          "- List what is required before starting (access, materials, training).",
          "",
          "## Procedure",
          "1. First step — include the owner/role and expected outcome.",
          "2. Second step.",
          "3. Final step, including how to confirm success.",
          "",
          "## Roles & responsibilities",
          "- Who performs the steps.",
          "- Who verifies the outcome.",
          "",
          "## Safety & compliance notes",
          "- Any safety or regulatory requirements that apply.",
          "",
          "## References",
          "- Related documents.",
        ].join("\n"),
      },
      {
        id: "tpl-policy",
        docType: "policy",
        name: "Policy",
        desc: "Purpose, policy statements, compliance and enforcement.",
        body: [
          "# Purpose",
          "Why this policy exists and who it governs.",
          "",
          "## Policy statements",
          "- Statement 1 — what is required.",
          "- Statement 2 — what is prohibited.",
          "",
          "## Compliance & enforcement",
          "- How compliance is checked and consequences of non-compliance.",
          "",
          "## Review",
          "- This policy is reviewed on a scheduled basis.",
        ].join("\n"),
      },
      {
        id: "tpl-how-to",
        docType: "how-to",
        name: "How-to",
        desc: "Task-focused guide with prerequisites and numbered steps.",
        body: [
          "# Overview",
          "What this guide helps the reader accomplish.",
          "",
          "## What you need",
          "- Prerequisites.",
          "",
          "## Steps",
          "1. Do the first thing.",
          "2. Do the second thing.",
          "",
          "## Troubleshooting",
          "- Common problems and fixes.",
        ].join("\n"),
      },
      {
        id: "tpl-reference",
        docType: "reference",
        name: "Reference",
        desc: "Lookup documentation — tables, definitions, contacts.",
        body: [
          "# Overview",
          "What this reference covers.",
          "",
          "## Definitions",
          "| Term | Definition |",
          "| --- | --- |",
          "| Term | Meaning |",
          "",
          "## Details",
          "- Facts, tables, links.",
        ].join("\n"),
      },
      {
        id: "tpl-faq",
        docType: "faq",
        name: "FAQ",
        desc: "Frequently asked questions with answers.",
        body: [
          "# Questions",
          "",
          "## How do I…?",
          "Answer the question concisely, then link to the relevant how-to or SOP: [[related article]].",
          "",
          "## What happens if…?",
          "Answer.",
        ].join("\n"),
      },
    ];
  }

  // ---- snippets (task 12) ----------------------------------------------------
  async function listSnippets() {
    const d = await readDoc("snippets");
    return Array.isArray(d && d.items) ? d.items : [];
  }
  async function saveSnippet(sn) {
    const all = await listSnippets();
    const idx = all.findIndex((s) => s.id === sn.id);
    const next = idx >= 0 ? all.map((s) => (s.id === sn.id ? sn : s)) : [...all, sn];
    await writeDoc("snippets", { items: next }, "system");
    return sn;
  }
  async function deleteSnippet(id) {
    const all = await listSnippets();
    await writeDoc("snippets", { items: all.filter((s) => s.id !== id) }, "system");
  }

  // ---- search (task 18) -------------------------------------------------------
  function tokenize(s) {
    return String(s || "")
      .toLowerCase()
      .split(/[^a-z0-9\u00c0-\u024f]+/)
      .filter(Boolean);
  }

  function searchArticles(query, opts = {}) {
    const q = String(query || "").trim().toLowerCase();
    const articles = opts.articles || [];
    if (!q) {
      return applyFiltersAndSort(articles, opts).map((a) => ({ article: a, score: 0 }));
    }
    const terms = q.split(/\s+/).filter(Boolean);
    const results = [];
    for (const a of articles) {
      const title = String(a.title || "").toLowerCase();
      const summary = String(a.summary || "").toLowerCase();
      const tags = (a.tags || []).join(" ").toLowerCase();
      const body = String(a.body || "").toLowerCase();
      let score = 0;
      let phraseHit = q && title.includes(q) ? 40 : 0;
      score += phraseHit;
      for (const t of terms) {
        if (title.includes(t)) score += 6;
        if (title === t) score += 4;
        if (tags.includes(t)) score += 4;
        if (summary.includes(t)) score += 3;
        const bodyHits = body.split(t).length - 1;
        if (bodyHits) score += Math.min(2, bodyHits);
      }
      // recency boost
      const upd = a.updated && a.updated.at ? a.updated.at : 0;
      const ageDays = (Date.now() - upd) / DAY;
      if (ageDays < 30) score *= 1.15;
      if (!score) continue;
      results.push({ article: a, score });
    }
    results.sort((x, y) => y.score - x.score);
    return applyFiltersAndSort(results.map((r) => r.article), opts).map((a) => ({
      article: a,
      score: (results.find((r) => r.article.id === a.id) || { score: 0 }).score,
    }));
  }

  function applyFiltersAndSort(articles, opts = {}) {
    let out = articles.slice();
    const { categoryId, tag, docType, status, sort, includeArchived } = opts;
    if (status) out = out.filter((a) => a.status === status);
    else if (!includeArchived) out = out.filter((a) => a.status !== "archived");
    if (docType) out = out.filter((a) => a.docType === docType);
    if (tag) out = out.filter((a) => (a.tags || []).includes(tag));
    if (categoryId) {
      const desc = descendantIds(categoryId, opts.categoryTree || []);
      out = out.filter((a) => desc.includes(a.categoryId));
    }
    if (sort === "updated") out.sort((x, y) => (y.updated && y.updated.at) - (x.updated && x.updated.at));
    else if (sort === "reviewed") out.sort((x, y) => (y.reviewedAt || 0) - (x.reviewedAt || 0));
    else if (sort === "popular") out.sort((x, y) => (y.views || 0) - (x.views || 0));
    return out;
  }

  function descendantIds(id, nodes) {
    const out = [];
    const collect = (nn) => {
      out.push(nn.id);
      for (const c of nn.children || []) collect(c);
    };
    const walk = (list) => {
      for (const n of list || []) {
        if (n.id === id) collect(n);
        else if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    return out;
  }

  function snippetFor(article, query) {
    const body = String(article.body || "");
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    let idx = -1;
    for (const t of terms) {
      const i = body.toLowerCase().indexOf(t);
      if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    }
    if (idx < 0) {
      const s = String(article.summary || body).slice(0, 220);
      return s + (s.length > 200 ? "…" : "");
    }
    const start = Math.max(0, idx - 60);
    const slice = body.slice(start, start + 240);
    return (start > 0 ? "…" : "") + slice + (start + 240 < body.length ? "…" : "");
  }

  // ---- related & backlinks (tasks 20, 11) ------------------------------------
  function relatedArticles(id, opts = {}) {
    const articles = opts.articles || [];
    const target = articles.find((a) => a.id === id);
    if (!target) return [];
    const targetTags = new Set(target.tags || []);
    const targetBody = tokenize(target.body);
    const targetTitle = tokenize(target.title);
    const scored = [];
    for (const a of articles) {
      if (a.id === id || a.status === "archived") continue;
      let s = 0;
      for (const t of a.tags || []) if (targetTags.has(t)) s += 3;
      if (a.categoryId === target.categoryId) s += 2;
      const bt = new Set(tokenize(a.title));
      for (const t of targetBody) if (bt.has(t)) s += 1;
      for (const t of targetTitle) if (bt.has(t)) s += 1.5;
      if (s > 0) scored.push({ article: a, score: s });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, (opts.limit || 5)).map((r) => r.article);
  }

  function backlinks(id, opts = {}) {
    const articles = opts.articles || [];
    const out = [];
    for (const a of articles) {
      if (a.id === id) continue;
      const ids = extractArticleLinks(a.body);
      if (ids.includes(id)) out.push(a);
    }
    return out;
  }

  // ---- views (popularity) -----------------------------------------------------
  async function getViews() {
    const s = await getSettings();
    return (s.views && typeof s.views === "object" ? s.views : {}) || {};
  }
  async function bumpView(id) {
    const s = await getSettings();
    const views = { ...(s.views || {}) };
    views[id] = (views[id] || 0) + 1;
    // cap the views map so it can't bloat forever
    const keys = Object.keys(views);
    if (keys.length > 4000) {
      const sorted = keys.sort((x, y) => (views[x] || 0) - (views[y] || 0));
      for (const k of sorted.slice(0, keys.length - 4000)) delete views[k];
    }
    await writeDoc("settings", { ...s, views }, "system");
    return views[id];
  }

  // ---- feedback (task 30) ------------------------------------------------------
  async function rateArticle(id, { helpful, comment = "", by = "" }) {
    const all = await listArticles();
    const idx = all.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error("Article not found.");
    const rec = normRecord(all[idx]);
    const fb = (rec.feedback || []).filter((f) => !f.deviceId); // replace prior vote from this device
    fb.push({ at: now(), helpful: !!helpful, comment: String(comment || "").slice(0, 1000), by: by || "reader", deviceId: cache && cache._deviceId });
    rec.feedback = fb.slice(-500);
    const items = all.map((a) => (a.id === id ? rec : a));
    await writeDoc("articles", { items }, by || "system");
    return rec;
  }

  async function myRating(id) {
    const deviceId = cache && cache._deviceId;
    const rec = await getArticle(id);
    if (!rec || !deviceId) return null;
    return (rec.feedback || []).find((f) => f.deviceId === deviceId) || null;
  }

  // ---- audit log (task 17) -------------------------------------------------------
  async function audit(action, target, by, detail) {
    try {
      const d = await readDoc("auditLog");
      const entries = (d && d.entries) || [];
      await writeDoc(
        "auditLog",
        { entries: [...entries.slice(-3000), { at: now(), actor: by || "system", action, target, detail: detail || {} }] },
        by || "system",
      );
    } catch {}
  }
  async function listAudit(opts = {}) {
    const d = await readDoc("auditLog");
    let entries = (d && d.entries) || [];
    if (opts.action) entries = entries.filter((e) => e.action === opts.action);
    if (opts.target) entries = entries.filter((e) => e.target === opts.target);
    if (opts.actor) entries = entries.filter((e) => e.actor === opts.actor);
    return entries.slice(-(opts.limit || 500)).reverse();
  }

  // ---- review schedule / stale (task 16) ------------------------------------------
  function staleArticles(articles) {
    return articles.filter((a) => {
      if (a.status !== "published") return false;
      const interval = a.reviewIntervalDays || 365;
      const base = a.reviewedAt || (a.versions && a.versions.length && a.versions[0].at) || 0;
      return base + interval * DAY < Date.now();
    });
  }
  function daysOverdue(a) {
    const interval = a.reviewIntervalDays || 365;
    const base = a.reviewedAt || (a.versions && a.versions.length && a.versions[0].at) || Date.now();
    return Math.max(0, Math.floor((Date.now() - (base + interval * DAY)) / DAY));
  }

  // ---- data integrity checks (task 34) ---------------------------------------------
  async function runIntegrityChecks() {
    const issues = [];
    const articles = await listArticles();
    const tree = await getCategoryTree();
    const ids = new Set(articles.map((a) => a.id));
    const seen = new Set();
    for (const a of articles) {
      if (seen.has(a.id)) issues.push({ level: "error", articleId: a.id, message: `Duplicate article id “${a.id}”.` });
      seen.add(a.id);
      if (a.categoryId) {
        const cat = findCat(tree, a.categoryId);
        if (!cat) issues.push({ level: "error", articleId: a.id, message: `Article “${a.title}” references a missing category.` });
      }
      for (const l of extractArticleLinks(a.body)) {
        if (!ids.has(l)) issues.push({ level: "error", articleId: a.id, message: `“${a.title}” links to a missing article (${l}).` });
        else {
          const tgt = articles.find((x) => x.id === l);
          if (tgt && (tgt.status === "draft" || tgt.status === "archived")) {
            issues.push({ level: "warning", articleId: a.id, message: `“${a.title}” links to “${tgt.title}”, which is not published.` });
          }
        }
      }
      if (a.status === "published") {
        const n = a.publishedVersion;
        if (!n || !a.versions.some((v) => v.n === n)) {
          issues.push({ level: "error", articleId: a.id, message: `Published article “${a.title}” has no approved version.` });
        }
      }
      if (a.status === "published" && staleArticles([a]).length) {
        issues.push({ level: "warning", articleId: a.id, message: `Published article “${a.title}” is past its review date.` });
      }
      const ns = a.versions.map((v) => v.n);
      if (new Set(ns).size !== ns.length) {
        issues.push({ level: "error", articleId: a.id, message: `“${a.title}” has duplicate version numbers.` });
      }
    }
    const catLeafIds = leafIds(tree);
    const catsWithArticles = new Set(articles.map((a) => a.categoryId).filter(Boolean));
    for (const cid of catLeafIds) {
      const cat = findCat(tree, cid);
      const n = articles.filter((a) => a.categoryId === cid && a.status !== "archived").length;
      if (!n) issues.push({ level: "info", categoryId: cid, message: `Category “${cat ? cat.label : cid}” has no active articles.` });
    }
    return { ok: !issues.some((i) => i.level === "error"), issues, checkedAt: now(), articleCount: articles.length, categoryCount: catLeafIds.length, catsWithArticles: catsWithArticles.size };
  }

  // Pre-submission consistency check (roadmap task 25): flags duplicate SOP
  // steps, steps with no owner, links to draft/archived articles, unfilled
  // placeholders, empty summary/tags, and missing review interval.
  async function consistencyCheck(rec) {
    const issues = [];
    const r = normRecord(rec);
    if (!rec || !rec.title || !String(rec.title).trim()) issues.push({ level: "error", code: "no-title", message: "The article has no title." });
    if (!r.summary || !r.summary.trim()) issues.push({ level: "warning", code: "no-summary", message: "No summary yet — add one so search results and bundles can describe the article." });
    if (!r.tags || !r.tags.length) issues.push({ level: "info", code: "no-tags", message: "No tags — adding tags improves search and related-article suggestions." });
    if (!r.reviewIntervalDays) issues.push({ level: "info", code: "no-interval", message: "No review interval set — this article will use the default 365-day schedule." });
    const placeholderRe = /\{\{?\s*[a-z0-9 _-]{2,40}\s*\}?\}|(?:TODO|TBD|XXX|FIXME|lorem ipsum|\[insert|\(insert)/i;
    if (placeholderRe.test(r.body)) issues.push({ level: "warning", code: "placeholder", message: "The body still contains unfilled placeholders (TODO / TBD / lorem ipsum / “insert …”)." });
    const all = await listArticles();
    const ids = new Set(all.map((a) => a.id));
    for (const l of extractArticleLinks(r.body)) {
      const tgt = all.find((a) => a.id === l);
      if (!ids.has(l)) issues.push({ level: "error", code: "dead-link", message: `Links to “${l}”, which does not exist.` });
      else if (tgt && tgt.status === "draft") issues.push({ level: "warning", code: "draft-link", message: `Links to “${tgt.title}”, which is still a draft.` });
      else if (tgt && tgt.status === "archived") issues.push({ level: "error", code: "archived-link", message: `Links to “${tgt.title}”, which is archived.` });
    }
    if (r.docType === "sop" && r.blocks && r.blocks.length) {
      const seen = new Map();
      for (const [i, b] of r.blocks.entries()) {
        if (!b || !String(b.step || "").trim()) issues.push({ level: "error", code: "empty-step", message: `Step ${i + 1} has no step text.` });
        if (!b.ownerRole || !String(b.ownerRole).trim()) issues.push({ level: "warning", code: "no-owner", message: `Step ${i + 1} (“${(b.step || "").slice(0, 40)}…”) has no owner/role.` });
        const norm = String(b.step || "").trim().toLowerCase();
        if (norm && seen.has(norm)) issues.push({ level: "error", code: "duplicate-step", message: `Steps ${seen.get(norm)} and ${i + 1} are duplicates.` });
        if (norm) seen.set(norm, i + 1);
      }
    }
    return { ok: !issues.some((i) => i.level === "error"), issues };
  }

  // ---- backup & restore (task 4) ---------------------------------------------------
  async function buildSnapshot(by = "") {
    const docIds = ["articles", "categories", "templates", "snippets", "reviewLog", "auditLog", "settings"];
    const docs = {};
    let totalBytes = 0;
    for (const id of docIds) {
      const d = await store.readDocument(id, { force: true }).catch(() => null);
      if (!d) continue;
      docs[id] = { version: d.version, hash: d.hash, data: d.data };
      totalBytes += (d.hash || "").length + JSON.stringify(d.data).length;
    }
    return {
      schema: "kb-backup/1",
      createdAt: now(),
      by: by || "system",
      namespace: store.namespace,
      docCount: Object.keys(docs).length,
      totalBytes,
      docs,
    };
  }

  async function listBackups() {
    const d = await readDoc("backups");
    return ((d && d.entries) || []).slice().reverse();
  }

  async function publishBackup(snapshot, by = "") {
    const id = "backup-" + now().toString(36);
    const text = JSON.stringify(snapshot, null, 2);
    await writeDoc("backups", { entries: [...((await listBackups())).reverse(), { id, at: snapshot.createdAt || now(), by: by || snapshot.by || "system", docCount: snapshot.docCount, totalBytes: snapshot.totalBytes, bytes: text.length, note: "full backup" }] }, by || "system");
    return { id, text, snapshot };
  }

  function validateBackup(raw) {
    const errors = [];
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return { ok: false, errors: ["The backup file is not valid JSON."], summary: null };
      }
    }
    if (!raw || typeof raw !== "object") return { ok: false, errors: ["The backup is empty."], summary: null };
    if (raw.schema !== "kb-backup/1") errors.push(`Unsupported backup format “${String(raw.schema)}”.`);
    if (!raw.docs || typeof raw.docs !== "object" || !Object.keys(raw.docs).length) {
      errors.push("The backup contains no documents.");
    } else {
      for (const [id, d] of Object.entries(raw.docs)) {
        if (!d || typeof d.data === "undefined") errors.push(`Document “${id}” has no data.`);
      }
    }
    const summary = raw.docs
      ? Object.entries(raw.docs).map(([id, d]) => ({ id, version: d.version, bytes: JSON.stringify(d.data).length }))
      : [];
    return { ok: errors.length === 0, errors, summary, createdAt: raw.createdAt, by: raw.by };
  }

  // Restore is validated first, then applied only for documents present in the
  // backup (never deletes current docs that aren't covered).
  async function restoreFromBackup(raw, { by = "" } = {}) {
    const v = validateBackup(raw);
    if (!v.ok) throw new Error("Restore aborted — " + v.errors.join(" "));
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw new Error("Restore aborted — the backup file is not valid JSON.");
      }
    }
    const restored = [];
    for (const [id, d] of Object.entries(raw.docs)) {
      if (!id || id.includes("backup")) continue;
      await store.writeDocument(id, d.data, { updatedBy: by || "system" });
      restored.push(id);
    }
    await audit("restored", "", by || "system", { docs: restored.join(",") });
    return { restored, snapshot: raw };
  }

  // ---- capacity (task 5) ------------------------------------------------------------
  async function capacityReport() {
    const docs = await store.listDocuments().catch(() => []);
    const ceiling = store.ceiling;
    const rows = [];
    let total = 0;
    for (const d of docs) {
      const st = await store.documentStats(d.id).catch(() => null);
      const bytes = st ? st.bytes : 0;
      total += bytes;
      rows.push({ id: d.id, bytes, chunks: st ? st.chunkCount : 0, ceiling, pct: ceiling ? Math.round((bytes / ceiling) * 1000) / 10 : 0, version: d.version });
    }
    return { rows: rows.sort((a, b) => b.bytes - a.bytes), total, ceiling };
  }

  // ---- retrieval-ready bundles (tasks 26, 27) ------------------------------------------
  function bundleForArticle(rec) {
    const { data, version } = liveContent(rec);
    return {
      schema: "kb-bundle/1",
      id: rec.id,
      title: data.title,
      summary: data.summary || "",
      categoryId: data.categoryId || "",
      categoryPath: data.categoryId ? rec._categoryPath || [] : [],
      tags: data.tags || [],
      docType: rec.docType,
      body: data.body || "",
      version,
      publishedVersion: rec.publishedVersion,
      updatedAt: rec.updated && rec.updated.at,
      permalink: "#/article/" + rec.id,
      status: rec.status,
    };
  }

  async function refreshBundles() {
    const articles = await listArticles();
    const tree = await getCategoryTree();
    const published = articles.filter((a) => a.status === "published");
    for (const a of published) a._categoryPath = await categoryPath(a.categoryId);
    const bundleMap = {};
    for (const a of published) bundleMap[a.id] = bundleForArticle(a);
    const categoryIndex = {};
    for (const a of published) {
      const cid = a.categoryId || "uncategorized";
      categoryIndex[cid] = categoryIndex[cid] || [];
      categoryIndex[cid].push(a.id);
    }
    const payload = {
      schema: "kb-bundles/1",
      updatedAt: now(),
      count: published.length,
      manifest: { format: "kb-bundle/1", generatedAt: now(), generatorName: window.generatorName || "", version: 1 },
      articles: bundleMap,
      categoryIndex,
    };
    await writeDoc("kbBundles", payload, "system");
    await audit("bundles-published", "", "system", { count: published.length });
    return payload;
  }

  async function getBundles() {
    return (await readDoc("kbBundles")) || null;
  }

  // Publish the bundle set as one plain editable file so any consumer (AI
  // assistants, scripts, other tools) can fetch a single URL without knowing
  // the document store's chunk layout. Idempotent: re-publishing identical
  // content is a safe no-op at the editable layer.
  async function publishBundlesPublic() {
    const payload = await refreshBundles();
    if (!uploadPlugin) return { ok: false, reason: "upload plugin unavailable", payload };
    const name = (namespace() + "-bundles").replace(/[^a-z0-9-]/g, "").toLowerCase();
    const res = await uploadPlugin.editable.set(name, JSON.stringify(payload));
    const gn = generatorName || (window.generatorName || "");
    const url = "https://editable.uploads.dev/file/" + gn + "/" + name;
    return { ok: true, url, name, payload, ...res };
  }
  function namespace() {
    return store.namespace || "kb-system";
  }

  // ---- review log read ---------------------------------------------------------------
  async function reviewHistory(articleId) {
    const d = await readDoc("reviewLog");
    return ((d && d.entries) || []).filter((e) => e.articleId === articleId).slice(-50).reverse();
  }

  // ---- checklists (task 9) ---------------------------------------------------------------
  async function checklistState(articleId) {
    if (!activity) return {};
    try {
      return (await activity.get("check::" + articleId)) || {};
    } catch {
      return {};
    }
  }
  async function setChecklistState(articleId, stepIdx, itemIdx, checked) {
    if (!activity) return;
    const cur = await checklistState(articleId);
    const next = { ...cur, [stepIdx + ":" + itemIdx]: !!checked };
    await activity.set("check::" + articleId, next);
  }

  // ---- follows / seen (task 22) ---------------------------------------------------------------
  async function setFollow(id, following) {
    if (!activity) return;
    const f = (await getFollows()) || {};
    if (following) f[id] = Date.now();
    else delete f[id];
    await activity.set("follows", f);
  }
  async function getFollows() {
    if (!activity) return {};
    try {
      return (await activity.get("follows")) || {};
    } catch {
      return {};
    }
  }
  async function markSeen(id) {
    if (!activity) return;
    await activity.set("seen::" + id, Date.now());
  }
  async function seenAt(id) {
    if (!activity) return 0;
    try {
      return (await activity.get("seen::" + id)) || 0;
    } catch {
      return 0;
    }
  }

  return {
    readDoc,
    writeDoc,
    getSettings,
    getIdentity,
    setIdentity,
    listArticles,
    getArticle,
    liveContent,
    latestVersionNumber,
    saveArticle,
    createArticle,
    deleteArticle,
    submitForReview,
    approveArticle,
    returnArticle,
    publishArticle,
    archiveArticle,
    restoreArticle,
    markReviewed,
    sendForReReview,
    restoreVersion,
    versionSnapshot: (rec, n) => (rec.versions || []).find((v) => v.n === n) || null,
    getCategoryTree,
    getCategory,
    categoryPath,
    addCategory,
    renameCategory,
    moveCategory,
    deleteCategory,
    leafIds,
    listTemplates,
    getTemplate,
    saveTemplate,
    deleteTemplate,
    seedDefaultTemplates,
    defaultTemplates,
    listSnippets,
    saveSnippet,
    deleteSnippet,
    searchArticles,
    snippetFor,
    relatedArticles,
    backlinks,
    getViews,
    bumpView,
    rateArticle,
    myRating,
    audit,
    listAudit,
    staleArticles,
    daysOverdue,
    runIntegrityChecks,
    consistencyCheck,
    buildSnapshot,
    listBackups,
    publishBackup,
    validateBackup,
    restoreFromBackup,
    capacityReport,
    bundleForArticle,
    refreshBundles,
    getBundles,
    publishBundlesPublic,
    reviewHistory,
    checklistState,
    setChecklistState,
    setFollow,
    getFollows,
    markSeen,
    seenAt,
    normRecord,
    uid,
    editableFields,
    changeSummary,
    renderMarkdown,
  };
}
