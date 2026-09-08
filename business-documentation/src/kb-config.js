// src/kb-config.js — reads the `kb` boot config from main.pjs (window.root.kb)
// and normalizes it into plain JS. Falls back to sensible defaults if the
// config list is absent (e.g. during isolated tests).

const ev = (v) => (v && typeof v === "object" && typeof v.evaluateItem !== "undefined" ? v.evaluateItem : v);

const DEFAULTS = {
  appTitle: "Company Knowledge Base",
  appShortTitle: "Company KB",
  tagline: "SOPs, policies, how-tos, references & FAQs",
  storageNamespace: "kb-system",
  categories: [],
};

function itemsOf(listNode) {
  if (!listNode) return [];
  if (Array.isArray(listNode.selectAll)) return listNode.selectAll;
  if (typeof listNode.selectAll === "function") return listNode.selectAll();
  return [];
}

function treeFromList(listNode) {
  return itemsOf(listNode).map((it) => ({
    id: ev(it.id) || "",
    label: ev(it.label) || ev(it) || "",
    children: it.subcategories ? treeFromList(it.subcategories) : [],
  }));
}

export function getKbConfig() {
  const kb = window.root && window.root.kb;
  if (!kb) return { ...DEFAULTS };
  return {
    appTitle: ev(kb.appTitle) || DEFAULTS.appTitle,
    appShortTitle: ev(kb.appShortTitle) || DEFAULTS.appShortTitle,
    tagline: ev(kb.tagline) || DEFAULTS.tagline,
    storageNamespace: ev(kb.storageNamespace) || DEFAULTS.storageNamespace,
    categories: treeFromList(kb.categories),
  };
}
