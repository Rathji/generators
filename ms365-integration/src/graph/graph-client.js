// src/graph/graph-client.js
// MS365 Integration — Generic Graph Request Wrapper.
//
// The standardized handler for every Microsoft Graph API call made by the
// plugin (mail, files, calendar, tasks, ...). Responsibilities:
//   • Header management — Bearer auth (auto-refreshed via getValidToken),
//     Accept/Content-Type, OData query parameters ($select/$filter/$top/...)
//     built with literal `$` keys, user headers merged last.
//   • Rate limiting — 429 responses are retried with exponential backoff
//     (+jitter, capped), honoring the Retry-After header when present; 503/504
//     are retried too (Graph's documented guidance).
//   • 401 handling — a server-side invalidated token triggers a single forced
//     refresh (getValidToken({force:true})) and one retry.
//   • JSON parsing — responses are parsed to objects; empty bodies (204) → null;
//     non-JSON 2xx → raw text; Graph error bodies → structured GraphError.
//   • Paging — getAllPages() walks @odata.nextLink transparently.
//
// graphRequest(method, path, opts) → parsed JSON | text | null (or raw Response
//   with opts.rawResponse). opts: { token, query, body, headers, contentType,
//   maxRetries, baseBackoffMs, maxBackoffMs, retryStatuses, jitter, onRetry,
//   allowTokenRetry, fetchImpl, rawResponse, raw }.

import { getValidToken, resolveFetch } from "../auth/oauth2.js";
import { toFriendlyError } from "./error-mapper.js";

const DEFAULTS = Object.freeze({
  graphBase: "https://graph.microsoft.com/v1.0",
  maxRetries: 4,
  baseBackoffMs: 500,
  maxBackoffMs: 30000,
  backoffMultiplier: 2,
  jitter: 0.25,
  retryStatuses: [429, 503, 504],
  allowTokenRetry: true,
});

let settings = { ...DEFAULTS };

export function configureGraph(opts = {}) {
  settings = { ...settings, ...opts };
  return { ...settings };
}
export function resetGraphConfig(opts = {}) {
  settings = { ...DEFAULTS, ...opts };
  return { ...settings };
}
export function getGraphSettings() { return { ...settings }; }

let stats = { requests: 0, retries: 0, throttledCount: 0 };
export function getGraphStats() { return { ...stats }; }
export function resetGraphStats() {
  stats = { requests: 0, retries: 0, throttledCount: 0 };
  return { ...stats };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function graphRequest(method, path, opts = {}) {
  const o = { ...settings, ...opts };
  let token = o.token || (await getValidToken());
  if (!token) {
    const err = new Error("ms365.graph: not authenticated — no access token available.");
    err.code = "not_authenticated";
    throw toFriendlyError(err);
  }
  const url = buildUrl(method, path, o);
  stats.requests++;
  let refreshedOnce = false;
  let attempt = 0;
  for (;;) {
    const headers = buildHeaders(o, token);
    const body = buildBody(o);
    let res;
    try {
      res = await (o.fetchImpl || resolveFetch())(url, { method, headers, body });
    } catch (e) {
      if (attempt < o.maxRetries) {
        stats.retries++;
        await sleep(backoff(attempt, o));
        attempt++;
        continue;
      }
      const err = new Error("ms365.graph: request failed at the network level: " + e.message);
      err.code = "network_error";
      err.retryable = true;
      throw toFriendlyError(err);
    }
    const status = res.status == null ? (res.ok ? 200 : 0) : res.status;

    if (status === 429) stats.throttledCount++;

    if (status === 401 && !refreshedOnce && o.allowTokenRetry) {
      refreshedOnce = true;
      const fresh = await getValidToken({ force: true }).catch(() => null);
      if (fresh) {
        token = fresh;
        attempt = 0;
        continue;
      }
    }

    if (o.retryStatuses.indexOf(status) >= 0 && attempt < o.maxRetries) {
      stats.retries++;
      const delay = retryAfterMs(res) ?? backoff(attempt, o);
      if (o.onRetry) { try { o.onRetry({ attempt, status, delayMs: delay }); } catch (e) {} }
      await sleep(delay);
      attempt++;
      continue;
    }

    if (o.rawResponse) return res;
    return parseResponse(res);
  }
}

export const graphGet = (path, opts) => graphRequest("GET", path, opts);
export const graphPost = (path, opts) => graphRequest("POST", path, opts);
export const graphPatch = (path, opts) => graphRequest("PATCH", path, opts);
export const graphPut = (path, opts) => graphRequest("PUT", path, opts);
export const graphDelete = (path, opts) => graphRequest("DELETE", path, opts);

export async function getAllPages(path, opts = {}) {
  const maxPages = opts.maxPages || 50;
  const all = [];
  let url = path;
  let totalCount = null;
  for (let page = 0; page < maxPages; page++) {
    const o = page === 0 ? { ...opts, query: { ...(opts.query || {}) } } : { ...opts, query: undefined };
    const data = await graphRequest("GET", url, o);
    const items = Array.isArray(data) ? data : data && Array.isArray(data.value) ? data.value : [];
    if (page === 0 && data && typeof data["@odata.count"] !== "undefined") totalCount = data["@odata.count"];
    all.push(...items);
    const next = data && data["@odata.nextLink"];
    if (!next) break;
    url = next;
  }
  return { value: all, count: all.length, totalCount };
}

// ── building blocks ─────────────────────────────────────────────────────────
function buildUrl(method, path, o) {
  let url = String(path);
  if (!/^https?:\/\//i.test(url)) {
    if (!url.startsWith("/")) url = "/" + url;
    url = o.graphBase + url;
  }
  const q = o.query || {};
  const parts = [];
  for (const k of Object.keys(q)) {
    const v = q[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) parts.push(k + "=" + encodeURIComponent(String(x)));
    else parts.push(k + "=" + encodeURIComponent(String(v)));
  }
  if (parts.length) url += (url.includes("?") ? "&" : "?") + parts.join("&");
  return url;
}

function buildHeaders(o, token) {
  const h = { Authorization: "Bearer " + token, Accept: "application/json" };
  const hasBody = o.body !== undefined && o.body !== null;
  if (hasBody && !isBlob(o.body) && !isFormData(o.body)) {
    h["Content-Type"] = o.contentType || "application/json";
  }
  if (o.headers) Object.assign(h, o.headers);
  return h;
}

function buildBody(o) {
  if (o.body === undefined || o.body === null) return undefined;
  if (typeof o.body === "string") return o.body;
  if (isBlob(o.body) || isFormData(o.body)) return o.body;
  if (o.raw) return o.body;
  return JSON.stringify(o.body);
}

function isBlob(v) { return typeof Blob !== "undefined" && v instanceof Blob; }
function isFormData(v) { return typeof FormData !== "undefined" && v instanceof FormData; }

function backoff(attempt, o) {
  const base = o.baseBackoffMs * Math.pow(o.backoffMultiplier || 2, attempt);
  const capped = Math.min(base, o.maxBackoffMs);
  const j = (Math.random() * 2 - 1) * (o.jitter || 0);
  return Math.max(0, Math.round(capped * (1 + j)));
}

function retryAfterMs(res) {
  const raw = headerGet(res, "Retry-After");
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).trim());
  if (!isNaN(n) && isFinite(n)) return Math.max(0, n * 1000);
  const t = Date.parse(String(raw).trim());
  if (!isNaN(t)) return Math.max(0, t - Date.now());
  return null;
}

function headerGet(res, name) {
  const h = res && res.headers;
  if (!h) return null;
  if (typeof h.get === "function") {
    try { return h.get(name); } catch (e) { return null; }
  }
  const low = String(name).toLowerCase();
  for (const k of Object.keys(h)) {
    if (String(k).toLowerCase() === low) return h[k];
  }
  return null;
}

async function parseResponse(res) {
  const status = res.status == null ? (res.ok ? 200 : 0) : res.status;
  if (status === 204 || status === 205) return null;
  let text = null;
  try { text = await res.text(); } catch (e) { text = null; }
  if (!text || !text.trim()) {
    if (status >= 200 && status < 300) return null;
    throw graphError(status, null, text);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    if (status >= 200 && status < 300) return text;
    throw graphError(status, null, text);
  }
  if (status >= 400) {
    throw graphError(status, data, text);
  }
  return data;
}

function graphError(status, data, text) {
  const e = data && data.error;
  const code = (e && e.code) || (data && data.code) || "http_" + status;
  const message = (e && e.message) || (data && data.message) || "Graph request failed (HTTP " + status + ").";
  const err = new Error("ms365.graph: " + message);
  err.code = code;
  err.status = status;
  err.isGraphError = true;
  err.body = data || text || null;
  err.retryable = status === 429 || status === 503 || status === 504;
  return toFriendlyError(err);
}
