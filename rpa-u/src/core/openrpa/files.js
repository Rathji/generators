import { hash36 } from "../ids.js";
import { classifyError } from "./documents.js";

export const OPENRPA_FILE_LIMIT = 5 * 1024 * 1024;
export const OPENRPA_DEFAULT_CONTENT_TYPE = "application/octet-stream";

const CONTENT_TYPES = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  xml: "application/xml",
  xaml: "application/xaml+xml",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const IMAGE_TYPES = /^image\//;
const TEXT_TYPES = /^(text\/|application\/(json|xml|xaml\+xml|javascript))/;

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function invalid(code, message, context = {}) {
  return { ok: false, error: { kind: "validation", code, message, retryable: false, operation: context.operation || null, collection: "files" } };
}

export function baseName(path) {
  const value = String(path == null ? "" : path);
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] || value;
}

export function extensionOf(name) {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function guessContentType(name) {
  return CONTENT_TYPES[extensionOf(name)] || OPENRPA_DEFAULT_CONTENT_TYPE;
}

export function isTextContentType(contentType) {
  return TEXT_TYPES.test(String(contentType || ""));
}

export function isImageContentType(contentType) {
  return IMAGE_TYPES.test(String(contentType || ""));
}

export function formatBytes(bytes) {
  const value = toNumber(bytes, 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function normalizeFile(raw) {
  const file = raw && typeof raw === "object" ? raw : {};
  const filename = file.filename || file.name || "(unnamed file)";
  return {
    id: file._id || file.id || null,
    name: file.name || filename,
    filename,
    contentType: file.contenttype || file.contentType || guessContentType(filename),
    encoding: file.encoding || "utf8",
    length: toNumber(file.length, 0),
    checksum: file.checksum || null,
    refId: file.refid || file.refId || null,
    ref: file.ref || null,
    version: toNumber(file.version, 1),
    created: file._created || null,
    modified: file._modified || null,
    raw: file,
  };
}

function encodeBase64(text) {
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(text)));
  let out = "";
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}

function decodedLength(text, encoding) {
  if (encoding !== "base64") return text.length;
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  const padding = (clean.match(/=+$/) || [""])[0].length;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function resolveContent(content, encoding = "utf8") {
  const text = content == null ? "" : String(content);
  const kind = encoding === "base64" ? "base64" : "utf8";
  return { text, encoding: kind, length: decodedLength(text, kind), checksum: hash36(text) };
}

export function toDataUrl(file, content) {
  const normalized = normalizeFile(file);
  const text = content == null ? "" : String(content);
  const base64 = normalized.encoding === "base64" ? text : encodeBase64(text);
  return `data:${normalized.contentType || OPENRPA_DEFAULT_CONTENT_TYPE};base64,${base64}`;
}

export function createFileStore({ request, clock = () => Date.now() } = {}) {
  const counters = { uploads: 0, downloads: 0, deletions: 0, errors: 0 };
  let lastAt = null;

  const nowIso = () => new Date(clock()).toISOString();
  const call = (command, data) => (typeof request === "function" ? request(command, data) : Promise.reject(new Error("No OpenFlow connection is available.")));

  async function guarded(operation, task) {
    try {
      const result = await task();
      lastAt = nowIso();
      return result;
    } catch (error) {
      counters.errors += 1;
      return classifyError(error, { operation, collection: "files" });
    }
  }

  async function list({ refId = null, ref = null, search = "" } = {}) {
    return guarded("list", async () => {
      const docs = await call("listfiles", {});
      const needle = search ? String(search).trim().toLowerCase() : "";
      const files = (Array.isArray(docs) ? docs : [])
        .map(normalizeFile)
        .filter((file) => (refId ? file.refId === refId : true))
        .filter((file) => (ref ? file.ref === ref : true))
        .filter((file) => (needle ? `${file.filename} ${file.contentType} ${file.refId || ""}`.toLowerCase().includes(needle) : true))
        .sort((a, b) => String(b.modified || "").localeCompare(String(a.modified || "")));
      return { ok: true, files, operation: "list" };
    });
  }

  async function get(id) {
    if (!id) return invalid("missing-id", "A file id is required.", { operation: "get" });
    return guarded("get", async () => {
      const file = await call("getfile", { id });
      return { ok: true, file: normalizeFile(file), content: file && file.content != null ? file.content : "", operation: "get" };
    });
  }

  async function content(id) {
    const result = await get(id);
    if (!result.ok) return result;
    return { ok: true, content: result.content, file: result.file, operation: "content" };
  }

  async function verify(id) {
    const result = await get(id);
    if (!result.ok) return result;
    const actual = hash36(result.content);
    const expected = result.file.checksum || actual;
    return { ok: true, valid: actual === expected, expected, actual, length: result.file.length, operation: "verify" };
  }

  async function upload(input) {
    if (!input || typeof input !== "object") return invalid("invalid-file", "A file upload must be a JSON object.", { operation: "upload" });
    const filename = String(input.filename || input.name || "").trim();
    if (!filename) return invalid("missing-filename", "A file needs a name.", { operation: "upload" });
    if (input.content == null) return invalid("missing-content", "A file needs content.", { operation: "upload" });
    const resolved = resolveContent(input.content, input.encoding);
    if (resolved.length > OPENRPA_FILE_LIMIT) {
      return invalid("file-too-big", `That file is ${formatBytes(resolved.length)}; the limit is ${formatBytes(OPENRPA_FILE_LIMIT)}.`, { operation: "upload" });
    }
    return guarded("upload", async () => {
      const item = {
        filename,
        name: filename,
        contenttype: input.contenttype || input.contentType || guessContentType(filename),
        encoding: resolved.encoding,
        content: resolved.text,
        length: resolved.length,
        checksum: resolved.checksum,
        refid: input.refId || input.refid || null,
        ref: input.ref || null,
      };
      const created = await call("uploadfile", item);
      counters.uploads += 1;
      return { ok: true, file: normalizeFile({ ...created, checksum: created.checksum || resolved.checksum }), operation: "upload" };
    });
  }

  async function uploadMany(list) {
    if (!Array.isArray(list) || !list.length) return invalid("empty-batch", "A bulk upload needs a non-empty array of files.", { operation: "uploadMany" });
    const results = [];
    let uploaded = 0;
    for (let index = 0; index < list.length; index += 1) {
      const result = await upload(list[index]);
      if (result.ok) uploaded += 1;
      results.push(result.ok ? { ok: true, index, file: result.file } : { ok: false, index, error: result.error });
    }
    return { ok: true, uploaded, failed: results.length - uploaded, results, operation: "uploadMany" };
  }

  async function remove(id) {
    if (!id) return invalid("missing-id", "A file id is required.", { operation: "delete" });
    return guarded("delete", async () => {
      const result = await call("deletefile", { id });
      const deleted = (result && result.deleted) || 0;
      counters.deletions += deleted;
      return { ok: true, deleted, operation: "delete" };
    });
  }

  async function removeMany(ids) {
    if (!Array.isArray(ids) || !ids.length) return invalid("empty-batch", "A bulk delete needs a non-empty array of ids.", { operation: "deleteMany" });
    let deleted = 0;
    for (const id of ids) {
      const result = await remove(id);
      if (result.ok) deleted += result.deleted || 0;
    }
    return { ok: true, deleted, operation: "deleteMany" };
  }

  async function dataUrl(id) {
    const result = await get(id);
    if (!result.ok) return result;
    counters.downloads += 1;
    return { ok: true, url: toDataUrl(result.file, result.content), file: result.file, operation: "dataUrl" };
  }

  async function fetchWorkItem(id) {
    const docs = await call("query", { collection: "openrpa_workitem", query: { _id: id }, top: 1 });
    return docs && docs[0] ? docs[0] : null;
  }

  async function attachToWorkItem(workItemId, input) {
    if (!workItemId) return invalid("missing-item", "Choose a work item to attach the file to.", { operation: "attach" });
    const existing = await guarded("attach", async () => fetchWorkItem(workItemId));
    if (existing && existing.ok === false) return existing;
    const item = existing && existing.ok === false ? null : existing;
    if (!item) return invalid("item-not-found", `Work item "${workItemId}" was not found.`, { operation: "attach" });
    const uploaded = await upload({ ...input, refId: workItemId, ref: "workitem" });
    if (!uploaded.ok) return uploaded;
    const attachments = Array.isArray(item.files) ? item.files.slice() : [];
    attachments.push({ _id: uploaded.file.id, name: uploaded.file.name, filename: uploaded.file.filename, contenttype: uploaded.file.contentType, length: uploaded.file.length, refid: workItemId, ref: "workitem" });
    const saved = await guarded("attach", () => call("updateworkitem", { item: { _id: workItemId, files: attachments } }));
    if (saved && saved.ok === false) return saved;
    return { ok: true, file: uploaded.file, workItemId, attachments: attachments.length, operation: "attach" };
  }

  async function detachFromWorkItem(workItemId, fileId, { deleteFile = false } = {}) {
    if (!workItemId || !fileId) return invalid("missing-args", "A work item and a file id are required.", { operation: "detach" });
    const attachment = await guarded("detach", async () => {
      const item = await fetchWorkItem(workItemId);
      if (!item) throw new Error(`Work item "${workItemId}" was not found.`);
      const attachments = (Array.isArray(item.files) ? item.files : []).filter((file) => (file._id || file.id) !== fileId);
      const updated = await call("updateworkitem", { item: { _id: workItemId, files: attachments } });
      return { removed: (Array.isArray(item.files) ? item.files.length : 0) - attachments.length, item: updated, attachments: attachments.length };
    });
    if (attachment && attachment.ok === false) return attachment;
    if (deleteFile) await remove(fileId);
    return { ok: true, removed: attachment.removed, attachments: attachment.attachments, operation: "detach" };
  }

  function stats() {
    return { ...counters, lastAt };
  }

  function reset() {
    counters.uploads = 0;
    counters.downloads = 0;
    counters.deletions = 0;
    counters.errors = 0;
    lastAt = null;
  }

  return {
    list,
    get,
    content,
    verify,
    upload,
    uploadMany,
    remove,
    removeMany,
    dataUrl,
    attachToWorkItem,
    detachFromWorkItem,
    stats,
    reset,
  };
}
