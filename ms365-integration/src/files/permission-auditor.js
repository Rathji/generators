// src/files/permission-auditor.js
// Document Permission Auditor.
// Verifies the effective Read / Write / Admin access level the current user
// has on a specific file or folder ID (OneDrive / SharePoint), by inspecting
// the item's permission set.
//
// Requires scope: Sites.Read.All or Files.Read (permissions on own files).

import { graphGet } from "../graph/graph-client.js";
import { resolveDrive } from "./file-discovery.js";

const PERMISSION_SELECT = [
  "id", "roles", "link", "inheritedFrom", "grantedTo", "grantedToIdentities",
  "hasLinks", "shareId",
].join(",");

// Fetch the raw permission list for an item.
//   { drive, itemId } → [Permission...] (normalized)
export async function getPermissions({ drive, itemId }, opts = {}) {
  if (!itemId) throw new Error("ms365.files: `itemId` is required.");
  const base = resolveDrive(drive);
  const data = await graphGet(base + "/items/" + encodeURIComponent(itemId) + "/permissions", {
    query: { $select: opts.select || PERMISSION_SELECT },
    fetchImpl: opts.fetchImpl,
  });
  return (data.value || []).map(normalizePermission);
}

// Determine the current user's effective access on an item.
// Returns { access: "admin"|"write"|"read"|"none", canRead, canWrite, canAdmin,
//           effectiveRoles, directPermissions, inheritedPermissions, sharingLink }.
export async function checkAccess({ drive, itemId, userId }, opts = {}) {
  const perms = await getPermissions({ drive, itemId }, opts);
  return analyzePermissions(perms, userId);
}

export function analyzePermissions(perms, userId) {
  const effective = { owner: false, write: false, read: false };
  const direct = [];
  const inherited = [];
  let sharingLink = null;
  for (const p of perms || []) {
    (p.inheritedFrom ? inherited : direct).push(p);
    for (const role of p.roles || []) {
      const r = String(role).toLowerCase();
      if (r === "owner" || r === "fullcontrol" || r === "manage") effective.owner = true;
      else if (r === "write" || r === "contributor" || r === "edit") effective.write = true;
      else if (r === "read" || r === "view" || r === "reader") effective.read = true;
    }
    if (!sharingLink && p.link) {
      const kind = p.link.type || "view";
      sharingLink = {
        type: String(kind).toLowerCase() === "edit" ? "edit" : "view",
        webUrl: p.link.webUrl || p.link.webHtml || null,
        scope: p.link.scope || null,
      };
    }
  }
  const access = effective.owner ? "admin" : effective.write ? "write" : effective.read ? "read" : "none";
  const roles = [];
  if (effective.owner) roles.push("owner");
  if (effective.write) roles.push("write");
  if (effective.read) roles.push("read");
  return {
    access,
    canRead: effective.read || effective.write || effective.owner,
    canWrite: effective.write || effective.owner,
    canAdmin: effective.owner,
    effectiveRoles: roles,
    directPermissionCount: direct.length,
    inheritedPermissionCount: inherited.length,
    directPermissions: direct,
    inheritedPermissions: inherited,
    sharingLink,
  };
}

// Human-readable summary for display / logging.
export function describeAccess(v) {
  const labels = { admin: "admin (full control)", write: "read/write", read: "read-only", none: "no access" };
  return labels[v.access] || v.access;
}

export function normalizePermission(p) {
  if (!p) return null;
  const identityOf = (g) => g && g.user ? { id: g.user.id || null, email: g.user.email || null, displayName: g.user.displayName || null }
    : g && g.group ? { id: g.group.id || null, email: g.group.email || null, displayName: g.group.displayName || null }
    : g && g.application ? { id: g.application.id || null, displayName: g.application.displayName || null } : null;
  return {
    id: p.id,
    roles: (p.roles || []).map(String),
    grantedTo: identityOf(p.grantedTo),
    grantedToIdentities: (p.grantedToIdentities || []).map(identityOf).filter(Boolean),
    inheritedFrom: p.inheritedFrom ? { id: p.inheritedFrom.id || null, path: p.inheritedFrom.path || null } : null,
    link: p.link ? { type: p.link.type || null, scope: p.link.scope || null, webUrl: p.link.webUrl || p.link.webHtml || null } : null,
    hasLinks: !!p.hasLinks,
    shareId: p.shareId || null,
  };
}
