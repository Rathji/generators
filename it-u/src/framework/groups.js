// src/framework/groups.js — groups, permissions & the access model (roadmap
// Phase 4, task 20).
//
// A GROUP is the access-control unit. Rather than permissioning people
// individually, IT-U grants a group a set of permissions and puts people (or,
// once the hub is connected, remote identities) into groups. A permission is a
// `level.action` token:
//
//   • LEVELS       — where the permission applies: organization, asset,
//                    document, general-password, or administrative.
//   • ACTIONS      — what may be done there: view, use, edit, create, delete,
//                    rotate, share, administer.
//
// The levels are exactly the ones the roadmap names — permissions apply at
// organization, asset, document, general-password and administrative levels.
// Not every action is meaningful at every level, so ACCESS_MATRIX declares the
// combinations that may be granted (e.g. `rotate` is a credential action).
//
// This module is pure data + pure functions (the catalog, normalization,
// validation and the union of several groups' permissions). The stateful
// service that persists the group library and answers authorization questions
// lives in ./access.js.
//
// TWO RULES THIS MODULE ENCODES:
//   • An EMBEDDED credential does not carry its own access permissions — it
//     INHERITS the permissions of the record it belongs to.
//     `credentialActionLevelAction` maps a credential action onto the owning
//     record's level, so a technician allowed to edit a server is the one who
//     may change or rotate that server's embedded credential, while one allowed
//     only to view it may not. The owning record may ALSO declare a
//     credential-permission set; access.js requires both the group token and
//     that set, so without a declared set the safe minimum (view + use) applies
//     and rotation stays refused until the owner allows it.
//   • The OWNER — the single-user local mode, or the platform owner — holds
//     every permission. Groups only restrict identified, non-owner identities.

import { StoreError, CODES } from "./store/errors.js";

export const ACCESS_LEVELS = [
  {
    id: "organization",
    label: "Organization",
    description: "Client, department and business-unit documentation sets — their existence, records and structure.",
  },
  {
    id: "asset",
    label: "Asset",
    description: "Core Assets (organizations' locations, contacts, configurations) and Flexible Assets, plus the trackers and runbooks that describe them.",
  },
  {
    id: "document",
    label: "Document",
    description: "Long-form documents, SOPs and deployment procedures.",
  },
  {
    id: "general-password",
    label: "General password",
    description: "Standalone credentials. Embedded credentials are governed by their owning asset instead.",
  },
  {
    id: "administrative",
    label: "Administrative",
    description: "Groups, templates, exports and the other repository-wide controls.",
  },
];

export const ACCESS_ACTIONS = [
  { id: "view", label: "View", description: "Read the record and its details." },
  { id: "use", label: "Use", description: "Use or copy a secret for work on a system." },
  { id: "edit", label: "Edit", description: "Change the record's fields, status or body." },
  { id: "create", label: "Create", description: "Add new records of this kind." },
  { id: "delete", label: "Delete", description: "Remove records (and their cascade)." },
  { id: "rotate", label: "Rotate", description: "Change a credential's secret and record the rotation." },
  { id: "share", label: "Share", description: "Include the record in a shared bundle or export." },
  { id: "administer", label: "Administer", description: "Manage groups, members and repository-wide settings." },
];

// Which actions may be granted at which level.
export const ACCESS_MATRIX = {
  organization: ["view", "edit", "create", "delete"],
  asset: ["view", "edit", "create", "delete"],
  document: ["view", "edit", "create", "delete"],
  "general-password": ["view", "use", "edit", "create", "delete", "rotate", "share"],
  administrative: ["view", "administer"],
};

export const levelDef = (id) => ACCESS_LEVELS.find((l) => l.id === id) || null;
export const actionDef = (id) => ACCESS_ACTIONS.find((a) => a.id === id) || null;

export function permissionToken(level, action) {
  return level + "." + action;
}

export function parsePermission(token) {
  const s = String(token || "");
  const i = s.indexOf(".");
  if (i <= 0) return null;
  const level = s.slice(0, i);
  const action = s.slice(i + 1);
  return levelDef(level) && actionDef(action) ? { level, action } : null;
}

export function permissionLabel(token) {
  const p = parsePermission(token);
  if (!p) return String(token || "");
  const l = levelDef(p.level);
  const a = actionDef(p.action);
  return (l ? l.label : p.level) + " · " + (a ? a.label : p.action);
}

// A permission token is known when its level exists and the action is allowed
// at that level (e.g. `general-password.rotate` is valid, `asset.rotate` is not).
export function isKnownPermission(token) {
  const p = parsePermission(token);
  return !!(p && ACCESS_MATRIX[p.level] && ACCESS_MATRIX[p.level].includes(p.action));
}

// Every grantable token, in a stable order (used by the Administrators group
// and by the group editor to render the matrix).
export function allPermissions() {
  const out = [];
  for (const level of ACCESS_LEVELS) for (const action of ACCESS_MATRIX[level.id] || []) out.push(permissionToken(level.id, action));
  return out;
}

export const OWNER_PERMISSIONS = allPermissions();

const tokensFor = (level, actions) => (actions || []).map((a) => permissionToken(level, a));

// The groups IT-U ships, modelled on the roles a TSP actually works with.
export const BUILTIN_GROUPS = [
  {
    id: "group-administrators",
    builtin: true,
    name: "Administrators",
    description: "Full access to every level, including groups and repository-wide settings.",
    permissions: OWNER_PERMISSIONS.slice(),
  },
  {
    id: "group-technicians",
    builtin: true,
    name: "Technicians",
    description: "Build and maintain documentation: create and edit organizations, assets and documents, and use and rotate credentials — but not administer the repository or share secrets.",
    permissions: [
      ...tokensFor("organization", ["view", "edit", "create"]),
      ...tokensFor("asset", ["view", "edit", "create"]),
      ...tokensFor("document", ["view", "edit", "create"]),
      ...tokensFor("general-password", ["view", "use", "edit", "rotate"]),
    ],
  },
  {
    id: "group-helpdesk",
    builtin: true,
    name: "Help desk",
    description: "Read client documentation and use credentials to resolve tickets, without editing the record or rotating secrets.",
    permissions: [
      ...tokensFor("organization", ["view"]),
      ...tokensFor("asset", ["view"]),
      ...tokensFor("document", ["view"]),
      ...tokensFor("general-password", ["view", "use"]),
    ],
  },
  {
    id: "group-viewers",
    builtin: true,
    name: "Viewers",
    description: "Read documentation and see that credentials exist, without ever revealing a secret.",
    permissions: [
      ...tokensFor("organization", ["view"]),
      ...tokensFor("asset", ["view"]),
      ...tokensFor("document", ["view"]),
    ],
  },
  {
    id: "group-credential-custodians",
    builtin: true,
    name: "Credential custodians",
    description: "Own the credential estate: create, view, use, rotate and share credentials, with read access to the assets they belong to.",
    permissions: [
      ...tokensFor("asset", ["view"]),
      ...tokensFor("document", ["view"]),
      ...tokensFor("general-password", ["view", "use", "edit", "create", "delete", "rotate", "share"]),
    ],
  },
];

export const BUILTIN_GROUP_IDS = BUILTIN_GROUPS.map((g) => g.id);
export const isBuiltinGroup = (id) => BUILTIN_GROUP_IDS.includes(id);
export const builtinGroup = (id) => BUILTIN_GROUPS.find((g) => g.id === id) || null;

// The role -> default group mapping. A hub identity's role selects its base
// group; assignment to further groups is additive.
export const ROLE_GROUPS = {
  owner: "group-administrators",
  admin: "group-administrators",
  technician: "group-technicians",
  viewer: "group-viewers",
  helpdesk: "group-helpdesk",
};

export const ROLE_LABELS = {
  owner: "Owner",
  admin: "Administrator",
  technician: "Technician",
  viewer: "Viewer",
  helpdesk: "Help desk",
};

// ---- group model -----------------------------------------------------------

export function normalizeGroup(group) {
  const g = group && typeof group === "object" ? { ...group } : {};
  const now = Date.now();
  const perms = Array.isArray(g.permissions) ? g.permissions.filter(isKnownPermission) : [];
  return {
    id: String(g.id || ""),
    name: String(g.name == null ? "" : g.name).trim(),
    description: String(g.description == null ? "" : g.description).trim(),
    permissions: [...new Set(perms)].sort(),
    members: Array.isArray(g.members) ? [...new Set(g.members.map((m) => String(m).trim()).filter(Boolean))] : [],
    builtin: !!g.builtin || isBuiltinGroup(g.id),
    createdAt: g.createdAt || now,
    updatedAt: g.updatedAt || now,
  };
}

export function validateGroup(group) {
  const errors = [];
  if (!group || typeof group !== "object") return { ok: false, errors: ["A group must be an object."] };
  if (!String(group.name == null ? "" : group.name).trim()) errors.push("A group needs a name.");
  const perms = Array.isArray(group.permissions) ? group.permissions : [];
  const bad = perms.filter((p) => !isKnownPermission(p));
  if (bad.length) errors.push(`Unknown permission${bad.length === 1 ? "" : "s"}: ${bad.join(", ")}.`);
  if (group.members != null && !Array.isArray(group.members)) errors.push("A group's members must be a list.");
  return { ok: errors.length === 0, errors };
}

export function requireGroup(group) {
  const { ok, errors } = validateGroup(group);
  if (!ok) {
    const name = group && group.name ? String(group.name) : "this group";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return group;
}

// Does a single group hold `action` at `level`?
export function groupAllows(group, level, action) {
  if (!group) return false;
  const want = permissionToken(level, action);
  return (group.permissions || []).includes(want);
}

// The actions a group holds at one level (for the group summary UI).
export function groupPermissionsFor(group, level) {
  return (ACCESS_MATRIX[level] || []).filter((a) => groupAllows(group, level, a));
}

// Union the permissions of several groups into one Set of tokens.
export function combinePermissions(groups) {
  const set = new Set();
  for (const g of groups || []) for (const p of (g && g.permissions) || []) set.add(p);
  return set;
}

// ---- resource -> level -----------------------------------------------------

export function levelForType(type) {
  if (type === "organizations") return "organization";
  if (type === "documents") return "document";
  if (type === "passwords") return "general-password";
  return "asset";
}

// Where does a credential action sit on the OWNING record's level? An embedded
// credential has no independent permissions, so viewing it needs `view` on the
// owner, and changing or rotating it needs `edit` on the owner.
export const CREDENTIAL_ACTION_MAP = {
  view: "view",
  use: "view",
  edit: "edit",
  rotate: "edit",
  share: "edit",
  delete: "delete",
  create: "create",
};

export function credentialActionLevelAction(action) {
  return CREDENTIAL_ACTION_MAP[action] || "view";
}
