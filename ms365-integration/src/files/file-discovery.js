// src/files/file-discovery.js
// File Discovery Service.
// Lists files/folders in the user's OneDrive root (or a sub-folder), searches
// across the drive, and fetches metadata for a single item. SharePoint sites
// are supported via { siteId } or { drive: "sharepoint" }.
//
// Requires scope: Files.Read (or Files.ReadWrite.All for write operations).

import { getAllPages, graphGet } from "../graph/graph-client.js";
import { escapeODataStr } from "../odata.js";

const ITEM_SELECT = [
  "id", "name", "folder", "file", "size", "createdDateTime", "lastModifiedDateTime",
  "webUrl", "parentReference", "downloadUrl",
].join(",");

// drive: undefined | drive-id string | { siteId } | { driveId } | "sharepoint"
export function resolveDrive(drive) {
  if (!drive) return "/me/drive";
  if (typeof drive === "string") {
    if (drive === "sharepoint" || drive.startsWith("/")) return drive;
    return "/drives/" + encodeURIComponent(drive);
  }
  if (drive.siteId) return "/sites/" + encodeURIComponent(drive.siteId) + "/drive";
  if (drive.driveId) return "/drives/" + encodeURIComponent(drive.driveId);
  if (drive.groupId) return "/groups/" + encodeURIComponent(drive.groupId) + "/drive";
  return "/me/drive";
}

// List the children of a folder. Options:
//   { drive, folder (relative path, "/" separated, or item-id), top, skip, select }
export async function listFiles(filters = {}, opts = {}) {
  const base = resolveDrive(filters.drive);
  const q = { $select: opts.select || ITEM_SELECT };
  if (filters.top) q.$top = filters.top;
  if (filters.skip) q.$skip = filters.skip;
  const path = folderChildrenPath(base, filters.folder);
  const data = await getAllPages(path, { query: q, maxPages: opts.maxPages || 20, fetchImpl: opts.fetchImpl });
  return { value: data.value.map(normalizeItem), count: data.count, totalCount: data.totalCount };
}

// Full-text / name search across the drive.
//   { query, drive, top }
export async function searchFiles(filters = {}, opts = {}) {
  const base = resolveDrive(filters.drive);
  const q = { $select: opts.select || ITEM_SELECT };
  if (filters.top) q.$top = filters.top;
  const path = base + "/root/search(q='" + escapeODataStr(filters.query || "") + "')";
  const data = await getAllPages(path, { query: q, maxPages: opts.maxPages || 20, fetchImpl: opts.fetchImpl });
  return { value: data.value.map(normalizeItem), count: data.count, totalCount: data.totalCount };
}

// Metadata for one item by ID.
export async function getFileMeta({ drive, itemId }, opts = {}) {
  const base = resolveDrive(drive);
  const data = await graphGet(base + "/items/" + encodeURIComponent(itemId), {
    query: { $select: opts.select || ITEM_SELECT },
    fetchImpl: opts.fetchImpl,
  });
  return normalizeItem(data);
}

// Metadata for one item by path (e.g. "Documents/report.pdf").
export async function getFileByPath(path, opts = {}) {
  const data = await graphGet("/me/drive/root:/" + path, {
    query: { $select: opts.select || ITEM_SELECT },
    fetchImpl: opts.fetchImpl,
  });
  return normalizeItem(data);
}

// Build the "children" listing path for a folder (by relative path or item id).
//   base + "/root:/path:/children"   (relative path)
//   base + "/items/{id}/children"    (item id)
function folderChildrenPath(base, folder) {
  if (!folder) return base + "/root/children";
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}/.test(String(folder))) {
    return base + "/items/" + encodeURIComponent(folder) + "/children";
  }
  const cleaned = String(folder).replace(/^\/+|\/+$/g, "");
  return base + "/root:/" + cleaned.split("/").map(encodeURIComponent).join("/") + ":/children";
}

// Map a raw Graph driveItem to the standardized internal shape.
export function normalizeItem(it) {
  if (!it) return null;
  return {
    id: it.id,
    name: it.name,
    isFolder: !!it.folder,
    isFile: !!it.file,
    mimeType: it.file && it.file.mimeType ? it.file.mimeType : (it.folder ? "folder" : null),
    size: it.size != null ? Number(it.size) : 0,
    createdDateTime: it.createdDateTime || null,
    lastModifiedDateTime: it.lastModifiedDateTime || null,
    webUrl: it.webUrl || null,
    downloadUrl: it["@microsoft.graph.downloadUrl"] || null,
    parentId: it.parentReference ? it.parentReference.id || null : null,
    path: it.parentReference ? it.parentReference.path || null : null,
    childCount: it.folder && it.folder.childCount != null ? it.folder.childCount : null,
  };
}
