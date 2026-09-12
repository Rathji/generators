const HAS_SCHEME_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;
const BAD_SCHEME = /^(?:mailto|javascript|data|ftp|ftps|file|tel|sms|about|chrome|edge|ws|wss|blob|view-source):/i;

const HTML_MIMES = new Set(["text/html", "application/xhtml+xml", "application/xml", "text/xml"]);

const MIME_LABELS = {
  "application/pdf": "a PDF document",
  "application/json": "a JSON file",
  "application/zip": "a ZIP archive",
  "application/gzip": "a compressed file",
  "application/x-tar": "a TAR archive",
  "application/octet-stream": "a binary file",
  "application/rss+xml": "an RSS feed",
  "application/atom+xml": "an Atom feed"
};

export function normalizeUrl(input) {
  let raw = String(input == null ? "" : input).trim();
  raw = raw.replace(/^[<"'\s]+/, "").replace(/[>"'\s]+$/, "");
  if (!raw) return { ok: false, error: "empty", url: "" };

  if (!HAS_SCHEME_SLASHES.test(raw)) {
    if (BAD_SCHEME.test(raw)) return { ok: false, error: "unsupported_scheme", url: raw };
    raw = "https://" + raw.replace(/^\/+/, "");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    return { ok: false, error: "invalid", url: raw };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "unsupported_scheme", url: raw };
  }
  if (!parsed.hostname) return { ok: false, error: "invalid_host", url: raw };
  const isLocal = parsed.hostname === "localhost" || parsed.hostname.startsWith("[");
  if (!isLocal && !parsed.hostname.includes(".")) {
    return { ok: false, error: "invalid_host", url: raw };
  }

  return { ok: true, url: parsed.href, host: parsed.hostname };
}

export function mimeOf(contentType) {
  if (!contentType) return "";
  return String(contentType).split(";")[0].trim().toLowerCase();
}

export function isHtmlContentType(contentType) {
  const mime = mimeOf(contentType);
  if (!mime) return null;
  if (HTML_MIMES.has(mime)) return true;
  if (mime === "text/plain") return null;
  if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) return false;
  if (mime.startsWith("text/")) return null;
  return false;
}

export function describeMime(contentType) {
  const mime = mimeOf(contentType);
  if (!mime) return "";
  if (MIME_LABELS[mime]) return MIME_LABELS[mime];
  if (mime.startsWith("image/")) return "a " + mime.slice(6).toUpperCase() + " image";
  return mime + " content";
}

export function sniffHtml(text) {
  const head = String(text).slice(0, 8192).toLowerCase();
  if (/^\s*<!doctype\s+html/.test(head)) return true;
  if (/<html[\s>]/.test(head)) return true;
  if (/<head[\s>]/.test(head) && /<body[\s>]/.test(head)) return true;
  return /<(?:div|p|section|article|main|span|a|ul|ol|li|h[1-6]|table|br|img)[\s/>]/.test(head);
}

export function looksBinary(text) {
  const sample = String(text).slice(0, 2048);
  if (sample.includes("\u0000")) return true;
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) control++;
  }
  return sample.length > 200 && control / sample.length > 0.05;
}
