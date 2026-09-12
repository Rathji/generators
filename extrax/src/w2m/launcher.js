import { normalizeUrl } from "./urls.js";
import { extractGeneratorName } from "../theme/inspector.js";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(triple >> 18) & 63] + B64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[triple & 63] : "=";
  }
  return out;
}

function base64ToBytes(str) {
  const clean = String(str).replace(/[^A-Za-z0-9+/=]/g, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = B64.indexOf(clean[i + 2]);
    const c3 = B64.indexOf(clean[i + 3]);
    const triple = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    out.push((triple >> 16) & 255);
    if (c2 >= 0) out.push((triple >> 8) & 255);
    if (c3 >= 0) out.push(triple & 255);
  }
  return new Uint8Array(out);
}

export function encodeLaunch(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeLaunch(value) {
  try {
    const padded = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(base64ToBytes(padded));
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

export function parseLaunchHash(hash) {
  const raw = String(hash == null ? "" : hash).replace(/^#/, "");
  if (!raw) return null;
  const m = /(?:^|&)extrax=([^&]+)/.exec(raw);
  if (!m) return null;
  const value = m[1];
  const decoded = decodeLaunch(value);
  if (decoded && typeof decoded === "object") return normalizePayload(decoded);
  try {
    const viaUri = JSON.parse(decodeURIComponent(value));
    if (viaUri && typeof viaUri === "object") return normalizePayload(viaUri);
  } catch (err) { /* not URI-encoded JSON */ }
  const plain = (() => { try { return decodeURIComponent(value); } catch (e) { return value; } })();
  return normalizePayload({ kind: "url", value: plain });
}

function normalizePayload(payload) {
  const kind = payload.kind === "generator" || payload.kind === "urls" || payload.kind === "batch" || payload.kind === "theme" ? payload.kind : "url";
  return {
    kind: kind === "batch" ? "urls" : kind,
    value: String(payload.value != null ? payload.value : payload.url || payload.name || payload.text || ""),
    auto: !!payload.auto
  };
}

export function detectInput(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return { kind: "empty", value: "" };
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) return { kind: "urls", value: raw, count: lines.length };

  if (/perchance\.org\//i.test(raw) || /^[a-z0-9-]+\.perchance\.org/i.test(raw)) {
    return { kind: "generator", value: extractGeneratorName(raw), name: extractGeneratorName(raw) };
  }
  const norm = normalizeUrl(raw);
  if (norm.ok) {
    const path = (() => { try { return new URL(norm.url).pathname.replace(/\/+$/, ""); } catch (e) { return ""; } })();
    if (norm.host === "perchance.org" && path) return { kind: "generator", value: path.slice(1), name: path.slice(1) };
    return { kind: "url", value: norm.url, url: norm.url };
  }
  if (/^[a-z0-9][a-z0-9-]*$/.test(raw.toLowerCase())) return { kind: "generator", value: raw.toLowerCase(), name: raw.toLowerCase() };
  return { kind: "unknown", value: raw };
}

export function launchUrl(generatorName, payload) {
  return "https://perchance.org/" + generatorName + "#extrax=" + encodeLaunch(payload);
}

export function bookmarkletCode(generatorName) {
  const target = "https://perchance.org/" + generatorName + "#extrax=";
  const body = "javascript:(function(){"
    + "var j=JSON.stringify({kind:'url',value:location.href});"
    + "window.open('" + target + "'+encodeURIComponent(j),'_blank');"
    + "})()";
  return body;
}

export function bookmarkletForGenerator(generatorName) {
  return bookmarkletCode(generatorName);
}

export function payloadForInput(text, options = {}) {
  const detected = detectInput(text);
  return {
    kind: detected.kind === "empty" || detected.kind === "unknown" ? "url" : detected.kind,
    value: detected.value,
    auto: !!options.auto
  };
}
