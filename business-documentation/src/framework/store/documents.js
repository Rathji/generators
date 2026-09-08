// src/framework/store/documents.js — the KB's canonical document set.
//
// One versioned document per content module, all living under the KB's own
// storage namespace (see README for the physical layout). `seed` is the value
// written on first boot when the document doesn't exist yet; `categories` is
// special — its seed comes from the `kb` boot config in main.pjs, not here.
//
// Documents are created idempotently: an existing document is never
// overwritten by seeding (only written if missing).

export const DOCUMENTS = {
  categories: {
    label: "Categories",
    kind: "config",
    seed: null,
    desc: "Category tree that articles live under.",
  },
  articles: {
    label: "Articles",
    kind: "content",
    seed: { items: [] },
    desc: "Article records: title, summary, body, tags, category, owner, status.",
  },
  templates: {
    label: "Document-type templates",
    kind: "content",
    seed: { items: [] },
    desc: "Reusable templates per document type (SOP, policy, how-to, reference, FAQ).",
  },
  snippets: {
    label: "Reusable snippets",
    kind: "content",
    seed: { items: [] },
    desc: "Boilerplate text insertable into any article.",
  },
  reviewLog: {
    label: "Review log",
    kind: "log",
    seed: { entries: [] },
    desc: "Approval workflow transitions (submitted, approved, returned…).",
  },
  auditLog: {
    label: "Audit log",
    kind: "log",
    seed: { entries: [] },
    desc: "Read-only trail of state-changing actions on any article.",
  },
  settings: {
    label: "Settings",
    kind: "config",
    seed: {},
    desc: "App-wide settings (identity, popularity counters).",
  },
  kbBundles: {
    label: "KB bundles",
    kind: "content",
    seed: { schema: "kb-bundles/1", count: 0, articles: {}, categoryIndex: {}, manifest: { version: 1 } },
    desc: "Retrieval-ready per-article bundles + category index, kept current on every publish.",
  },
  backups: {
    label: "Backups",
    kind: "config",
    seed: { entries: [] },
    desc: "Manifest of published full-KB backups.",
  },
};
