// src/files/file-transfer.js
// File Upload/Download Streamer.
// Uploads binary data as a file (simple PUT for ≤4 MB, chunked upload session
// for larger files) and downloads existing files, preserving the file name's
// extension (or applying the requested output format's extension).
//
// Requires scope: Files.ReadWrite (upload) / Files.Read (download).

import { graphGet, graphPost, graphPut, graphRequest } from "../graph/graph-client.js";
import { normalizeItem, resolveDrive } from "./file-discovery.js";

export const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024; // Graph simple upload cap
export const DEFAULT_CHUNK_SIZE = 320 * 1024;

// Build the "/folder/name" item-address segment for a drive item path.
// Callers concatenate it after "/root:" (OneDrive's path-based addressing,
// e.g. "/root:/Docs/report.pdf:/content").
export function driveItemPath(folder, name) {
  const cleaned = String(folder || "").replace(/^\/+|\/+$/g, "");
  const folderPart = cleaned ? cleaned.split("/").map(encodeURIComponent).join("/") + "/" : "";
  return "/" + folderPart + encodeURIComponent(name);
}

// Upload a file. Options:
//   { name, data (Blob|Uint8Array|ArrayBuffer|string), mimeType, folder, drive,
//     conflictBehavior ("fail"|"replace"|"rename"), forceSimple, chunkSize }
// Returns the created driveItem (normalized).
export async function uploadFile(opts = {}) {
  const { name, data, mimeType, folder, drive, conflictBehavior } = opts;
  if (!name) throw new Error("ms365.files: `name` is required.");
  if (data == null) throw new Error("ms365.files: `data` is required.");
  const bytes = await toBytes(data);
  const base = resolveDrive(drive);
  const itemPath = driveItemPath(folder, name);

  if (bytes.byteLength > (opts.maxSimpleBytes || SIMPLE_UPLOAD_LIMIT) && !opts.forceSimple) {
    return uploadViaSession({ base, itemPath, name, bytes, mimeType, conflictBehavior, chunkSize: opts.chunkSize || DEFAULT_CHUNK_SIZE, fetchImpl: opts.fetchImpl });
  }

  const path = base + "/root:" + itemPath + ":/content";
  const item = await graphPut(path, {
    body: bytes,
    raw: true,
    contentType: mimeType || "application/octet-stream",
    query: conflictBehavior ? { "@microsoft.graph.conflictBehavior": conflictBehavior } : undefined,
    fetchImpl: opts.fetchImpl,
  });
  return normalizeItem(item);
}

// Large-file upload via an upload session (chunked PUTs to the returned URL).
async function uploadViaSession({ base, itemPath, name, bytes, mimeType, conflictBehavior, chunkSize, fetchImpl }) {
  const session = await graphPost(base + "/root:" + itemPath + ":/createUploadSession", {
    body: { item: { "@microsoft.graph.conflictBehavior": conflictBehavior || "rename", name } },
    fetchImpl,
  });
  const uploadUrl = session.uploadUrl;
  if (!uploadUrl) throw new Error("ms365.files: upload session did not return an uploadUrl.");
  const size = bytes.byteLength;
  for (let start = 0; start < size; start += chunkSize) {
    const chunk = bytes.slice(start, Math.min(start + chunkSize, size));
    const rangeEnd = start + chunk.byteLength - 1;
    await graphRequest("PUT", uploadUrl, {
      body: chunk,
      raw: true,
      contentType: mimeType || "application/octet-stream",
      headers: { "Content-Length": String(chunk.byteLength), "Content-Range": "bytes " + start + "-" + rangeEnd + "/" + size },
      fetchImpl,
    });
  }
  // After the last chunk the item exists — fetch its metadata.
  const item = await graphGet(base + "/root:" + itemPath, { fetchImpl });
  return normalizeItem(item);
}

// Download a file by ID. Options:
//   { drive, itemId, format ("pdf"|"png"|...), name }
// Returns { data (Uint8Array), arrayBuffer, name, mimeType, size, format }.
export async function downloadFile({ drive, itemId, format, name }, opts = {}) {
  const base = resolveDrive(drive);
  const res = await graphGet(base + "/items/" + encodeURIComponent(itemId) + "/content", {
    rawResponse: true,
    query: format ? { format } : undefined,
    fetchImpl: opts.fetchImpl,
  });
  const arrayBuffer = await res.arrayBuffer();
  const mimeType = contentTypeOf(res.headers);
  let finalName = name || null;
  if (format) finalName = applyFormatExtension(finalName, format);
  return {
    data: new Uint8Array(arrayBuffer),
    arrayBuffer,
    name: finalName,
    mimeType,
    size: arrayBuffer.byteLength,
    format: format || null,
  };
}

// Preserve extension integrity: keep the original name's stem and attach the
// requested format's extension (e.g. report.docx + pdf → report.pdf).
export function applyFormatExtension(name, format) {
  if (!name) return format ? "download." + format : "download";
  const stem = String(name).replace(/\.[^./]+$/, "");
  return stem + "." + format;
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (typeof data === "string") return new TextEncoder().encode(data);
  throw new Error("ms365.files: unsupported upload data type (use Blob, Uint8Array, ArrayBuffer or string).");
}

function contentTypeOf(headers) {
  if (!headers) return null;
  if (typeof headers.get === "function") { try { return headers.get("content-type"); } catch (e) { return null; } }
  for (const k of Object.keys(headers)) if (String(k).toLowerCase() === "content-type") return headers[k];
  return null;
}
