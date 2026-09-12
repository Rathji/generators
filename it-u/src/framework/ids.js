// src/framework/ids.js — id + slug helpers shared by the documentation-set
// layer. Record/document ids are URL- and file-safe: they appear in hash
// routes and (for documents) in lowercase-hyphen cloud file names.

export function newId(prefix = "id") {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

// Lowercase-hyphen slug for a human name, capped so ids stay short. Returns an
// empty string when nothing usable remains (callers fall back to a random id).
export function slugify(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
