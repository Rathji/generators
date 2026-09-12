import { normalizeUrl, isHtmlContentType, describeMime, sniffHtml, looksBinary } from "./urls.js";
import { W2MError } from "./errors.js";

export const FETCH_DEFAULTS = { timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 };

const BLOCK_PATTERNS = [
  /just a moment\.\.\./i,
  /checking your browser/i,
  /enable javascript and cookies to continue/i,
  /attention required/i,
  /cf-chl/i,
  /cf_chl/i,
  /access denied/i,
  /are you a human/i,
  /verify (?:you are|that you are) (?:a )?human/i,
  /unusual traffic/i,
  /recaptcha/i,
  /hcaptcha/i,
  /ddos protection by/i,
  /please complete the security check/i
];

const PAYWALL_PATTERNS = [
  /subscribe to (?:continue|read|keep reading|unlock)/i,
  /this (?:article|story|content|post) is (?:for|available to|reserved for) (?:subscribers|members|our members)/i,
  /you(?:'|\u2019)?ve reached your (?:free )?(?:article|story|premium|monthly) limit/i,
  /become a (?:member|subscriber|premium member)/i,
  /create a free account to (?:continue|read|keep reading)/i,
  /sign in to (?:continue|read) (?:reading|this article)/i,
  /already a (?:subscriber|member)\?/i,
  /to (?:read|view) the full (?:article|story), (?:please )?(?:subscribe|sign in)/i
];

export function detectBarrier(html, status) {
  if (status === 402) return "paywall";
  if (status === 401 || status === 403 || status === 429 || status === 451) return "blocked";
  const text = String(html);
  if (text.length > 400000) return null;
  const head = text.slice(0, 200000);
  if (text.length < 30000) {
    for (const re of BLOCK_PATTERNS) if (re.test(head)) return "blocked";
  }
  if (text.length < 120000) {
    const paragraphCount = (head.match(/<p[\s>]/gi) || []).length;
    if (paragraphCount < 12) {
      for (const re of PAYWALL_PATTERNS) if (re.test(head)) return "paywall";
    }
  }
  return null;
}

export function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function decodeBytes(bytes, contentType) {
  let charset = "utf-8";
  const m = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType || "");
  if (m) charset = m[1].trim().toLowerCase();
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch (err) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

async function readBytesCapped(res, maxBytes) {
  const lenHeader = res.headers && res.headers.get ? res.headers.get("content-length") : null;
  if (lenHeader && Number(lenHeader) > maxBytes) {
    throw new W2MError("too_large", formatBytes(lenHeader));
  }

  if (!res.body || typeof res.body.getReader !== "function") {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new W2MError("too_large", formatBytes(buf.byteLength));
    return new Uint8Array(buf);
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || !value.byteLength) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (err) { /* stream already closed */ }
      throw new W2MError("too_large", formatBytes(total) + "+");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchDocument(input, options = {}) {
  const fetchImpl = options.fetchImpl;
  if (typeof fetchImpl !== "function") throw new W2MError("no_fetch");

  const timeoutMs = options.timeoutMs > 0 ? options.timeoutMs : FETCH_DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes > 0 ? options.maxBytes : FETCH_DEFAULTS.maxBytes;

  const norm = normalizeUrl(input);
  if (!norm.ok) throw new W2MError(norm.error);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(norm.url, { signal: controller.signal, redirect: "follow" });
  } catch (err) {
    if (controller.signal.aborted) throw new W2MError("timeout", `${Math.round(timeoutMs / 1000)}s`);
    throw new W2MError("unreachable", (err && err.message) || "");
  } finally {
    clearTimeout(timer);
  }

  if (!res || typeof res !== "object") throw new W2MError("unreachable");

  const status = Number(res.status) || 0;
  const contentType = (res.headers && typeof res.headers.get === "function")
    ? (res.headers.get("content-type") || "")
    : "";
  const reportedUrl = res.url || "";
  const finalUrl = reportedUrl && !/fetch-plugin\.perchance\.org\/proxy\d*\//.test(reportedUrl)
    ? reportedUrl
    : norm.url;

  if (status >= 300 && status < 400) throw new W2MError("unreachable", `redirect ${status} not followed`);
  if (status >= 400) {
    const barrier = detectBarrier("", status);
    if (barrier === "paywall") throw new W2MError("paywall", `HTTP ${status}`);
    if (barrier === "blocked") throw new W2MError("blocked", `HTTP ${status}`);
    throw new W2MError("http_error", String(status));
  }

  const ctVerdict = isHtmlContentType(contentType);
  if (ctVerdict === false) throw new W2MError("non_html", describeMime(contentType));

  const bytes = await readBytesCapped(res, maxBytes);
  const html = decodeBytes(bytes, contentType);

  if (!html.trim()) throw new W2MError("empty_content");
  if (looksBinary(html)) throw new W2MError("binary");
  if (ctVerdict === null && !sniffHtml(html)) {
    throw new W2MError("non_html", describeMime(contentType) || "an unrecognized resource");
  }

  const barrier = detectBarrier(html, status);
  if (barrier) throw new W2MError(barrier);

  return {
    url: norm.url,
    finalUrl,
    host: norm.host,
    status,
    contentType,
    html,
    bytes: bytes.byteLength,
    elapsedMs: Date.now() - started
  };
}
