import { store, schedulePersist } from "./store.js";
import { collectWorkspace, restoreWorkspaceData } from "./zip.js";

const SHARE_HASH = /[#&]pe=([A-Za-z0-9_\-]+)/;
const MAX_INLINE = 50000;

function b64url(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function gzipBase64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return b64url(new Uint8Array(buf));
}

async function gunzipBase64(b64) {
  const stream = new Blob([b64urlToBytes(b64)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function baseUrl() {
  return location.href.split("#")[0].split("?")[0];
}

export async function buildShareLink() {
  const data = JSON.stringify(collectWorkspace());
  const enc = await gzipBase64(data);
  let link;
  let uploaded = false;
  if (enc.length <= MAX_INLINE) {
    link = baseUrl() + "#pe=" + enc;
  } else {
    const up = globalThis.root && globalThis.root.uploadPlugin;
    if (!up) throw new Error("Workspace is too large for a link, and the upload service is unavailable here.");
    const res = await up(enc, { expires: Date.now() + 1000 * 60 * 60 * 24 * 365 });
    if (res.error) throw new Error("Share upload failed: " + res.error);
    link = baseUrl() + "?data=" + encodeURIComponent(res.url);
    uploaded = true;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch (e) {}
  return { link, copied, uploaded, bytes: enc.length };
}

export async function restoreFromShare() {
  let payload = null;
  const h = location.hash || "";
  const m = h.match(SHARE_HASH);
  if (m) {
    try {
      payload = JSON.parse(await gunzipBase64(m[1]));
    } catch (e) {
      console.error("bad share payload", e);
      return null;
    }
  } else {
    const q = new URLSearchParams(location.search);
    const dataUrl = q.get("data");
    if (dataUrl) {
      try {
        const resp = await fetch(dataUrl);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        payload = JSON.parse(await gunzipBase64((await resp.text()).trim()));
      } catch (e) {
        console.error("bad share data url", e);
        return null;
      }
    }
  }
  if (!payload || !Array.isArray(payload)) return null;
  restoreWorkspaceData(payload);
  store.readOnly = true;
  store.dirty.clear();
  store.saved = {};
  store.tabs = [];
  store.activePath = null;
  store.problems = {};
  store.folds = {};
  schedulePersist();
  return payload.length;
}
