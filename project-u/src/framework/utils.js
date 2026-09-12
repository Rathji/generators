// ============================================================================
//  Project U — shared utility library (Phase 1, task 4)
//  Pure, dependency-free helpers used across every member generator.
// ============================================================================

// ---------------------------------------------------------------- strings ---

export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function titleCase(value) {
  return String(value == null ? "" : value)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function slugify(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(value, length = 80, suffix = "…") {
  const str = String(value == null ? "" : value);
  if (str.length <= length) return str;
  return str.slice(0, Math.max(0, length - suffix.length)).trimEnd() + suffix;
}

export function pluralize(count, singular, plural) {
  return Number(count) === 1 ? singular : plural || singular + "s";
}

// ---------------------------------------------------------------- numbers ---

export function clamp(value, min, max) {
  const n = Number(value);
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

export function formatNumber(value, options = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", options);
}

export function formatCurrency(value, currency = "USD", options = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency, ...options });
}

export function formatPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatBytes(bytes, digits = 1) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = i === 0 ? String(n) : (n / 1024 ** i).toFixed(digits).replace(/\.0+$/, "");
  return `${value} ${units[i]}`;
}

// ------------------------------------------------------------------ dates ---

const DATE_UNITS = [
  ["year", 31536000000],
  ["month", 2592000000],
  ["week", 604800000],
  ["day", 86400000],
  ["hour", 3600000],
  ["minute", 60000],
  ["second", 1000],
];

export function formatDate(value, options = { year: "numeric", month: "short", day: "numeric" }) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", options);
}

export function formatDateTime(value) {
  return formatDate(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelativeTime(value, now = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  for (const [unit, ms] of DATE_UNITS) {
    if (abs >= ms || unit === "second") {
      const amount = Math.round(diff / ms);
      if (typeof Intl !== "undefined" && Intl.RelativeTimeFormat) {
        return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(amount, unit);
      }
      return `${Math.abs(amount)} ${pluralize(Math.abs(amount), unit)} ${diff < 0 ? "ago" : "from now"}`;
    }
  }
  return "just now";
}

export function nowIso() {
  return new Date().toISOString();
}

// -------------------------------------------------------------- functions ---

export function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function throttle(fn, wait = 200) {
  let last = 0;
  let timer = null;
  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = null;
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

// ----------------------------------------------------------------- object ---

export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function deepClone(value) {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (_) {
      /* fall through to JSON clone */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function deepMerge(target, source) {
  const out = isPlainObject(target) ? { ...target } : {};
  if (!isPlainObject(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = deepMerge(out[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

export function pick(object, keys) {
  const out = {};
  for (const key of keys) if (object && key in object) out[key] = object[key];
  return out;
}

export function omit(object, keys) {
  const drop = new Set(keys);
  const out = {};
  for (const [key, value] of Object.entries(object || {})) if (!drop.has(key)) out[key] = value;
  return out;
}

export function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items || []) {
    const key = typeof keyFn === "function" ? keyFn(item) : item[keyFn];
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

export function sortBy(items, keyFn, direction = "asc") {
  const dir = direction === "desc" ? -1 : 1;
  const get = typeof keyFn === "function" ? keyFn : (item) => item[keyFn];
  return [...(items || [])].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "en", { numeric: true, sensitivity: "base" }) * dir;
  });
}

export function unique(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = typeof keyFn === "function" ? keyFn(item) : item;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function sum(items, keyFn) {
  const get = keyFn || ((item) => item);
  return (items || []).reduce((total, item) => total + (Number(get(item)) || 0), 0);
}

export function average(items, keyFn) {
  const list = items || [];
  return list.length ? sum(list, keyFn) / list.length : 0;
}

export function range(start, end, step = 1) {
  if (end === undefined) {
    end = start;
    start = 0;
  }
  const out = [];
  for (let i = start; step > 0 ? i < end : i > end; i += step) out.push(i);
  return out;
}

export function uid(prefix = "id") {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

export function cx(...parts) {
  const out = [];
  for (const part of parts) {
    if (!part) continue;
    if (typeof part === "string") out.push(part);
    else if (Array.isArray(part)) out.push(cx(...part));
    else if (isPlainObject(part)) {
      for (const [key, on] of Object.entries(part)) if (on) out.push(key);
    }
  }
  return out.filter(Boolean).join(" ");
}

// -------------------------------------------------------------------- url ---

export function parseQuery(search) {
  const out = {};
  const params = new URLSearchParams(search || "");
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

export function buildQuery(params) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === "") continue;
    usp.set(key, String(value));
  }
  return usp.toString();
}

// ----------------------------------------------------------------- raster ---

export function initials(value, max = 2) {
  const words = String(value == null ? "" : value).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words
    .slice(0, max)
    .map((word) => word[0].toUpperCase())
    .join("");
}

export function colorFromString(value) {
  let hash = 0;
  const str = String(value == null ? "" : value);
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 45%)`;
}
