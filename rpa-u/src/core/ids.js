export const ID_PREFIXES = {
  company: "co",
  customer: "ct",
  device: "dv",
  ticket: "tk",
  invoice: "iv",
};

export function slugify(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeDomain(value) {
  let s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  s = s.replace(/^www\./, "");
  s = s.replace(/\.+$/, "");
  return s;
}

export function normalizeEmail(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

export function hash36(value) {
  let h = 0x811c9dc5;
  const str = String(value);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  return h.toString(36).padStart(7, "0");
}

export function makeId(prefix, key) {
  return `${prefix}_${hash36(key)}`;
}

export function isCanonicalId(value, prefix) {
  const codes = Object.values(ID_PREFIXES).join("|");
  const pattern = prefix
    ? new RegExp(`^${prefix}_[0-9a-z]{4,}$`)
    : new RegExp(`^(?:${codes})_[0-9a-z]{4,}$`);
  return typeof value === "string" && pattern.test(value);
}

export function tokenSet(value) {
  return new Set(slugify(value).split("-").filter(Boolean));
}

export function tokenSimilarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / Math.max(left.size, right.size);
}
