// src/framework/roles.js — the IT-U role & scope model (roadmap task 54).
//
// TASK 54 — a role model with three roles (viewer / technician / administrator)
// SCOPED PER CLIENT and PER SERVICE, so access is granted exactly where the
// work happens:
//
//   • Viewer        reads documentation. Cannot change anything.
//   • Technician    edits the records and runbooks they are assigned — its
//                   assignments are scoped to a client (a documentation set) or
//                   a single service (a record within one), never implicitly to
//                   the whole repository.
//   • Administrator manages templates, groups and publication (and users).
//
// A scope is one of:
//   *                          the whole repository (global)
//   client:<clientId>          one client / documentation set
//   service:<clientId>/<id>    one service record inside one client
//
// Resolution is MOST-SPECIFIC-WINS with each scope falling back outward:
// a service assignment overrides a client assignment, which overrides the
// global one; within a single scope the highest rank wins. A more specific
// LOWER role therefore deliberately overrides a broader higher one (a viewer
// can be pinned onto one service inside a client where they are otherwise a
// technician), which is what makes per-service scoping meaningful.
//
// This module is the pure model (roles, actions, scopes, assignments and the
// decision function); the stateful service that persists the group library and
// consults the hub's server-assigned roles lives in ./access.js, and the server
// that enforces it lives in index.html. Nothing here touches the DOM or the
// network, so a decision can be made synchronously (and tested) anywhere.
//
// The role -> default group mapping is the one ./groups.js already ships
// (viewer -> Viewers, technician -> Technicians, administrator -> the
// Administrators group whose permissions are the whole matrix), so a scoped
// role flows straight into the existing group/permission machinery.

export const GLOBAL_SCOPE = "*";
export const CLIENT_PREFIX = "client:";
export const SERVICE_PREFIX = "service:";

// ---- roles -----------------------------------------------------------------

// Ordered lowest -> highest rank.
export const ROLES = [
  {
    id: "viewer",
    label: "Viewer",
    rank: 0,
    group: "group-viewers",
    summary: "Read the documentation they can reach.",
    description:
      "Reads records, runbooks and documents in the clients and services they are granted — and nothing else. A viewer can never change a record or reveal a secret.",
  },
  {
    id: "technician",
    label: "Technician",
    rank: 1,
    group: "group-technicians",
    summary: "Edit the records and runbooks they are assigned.",
    description:
      "Creates and edits records, runbooks and checklists inside the clients and services they are assigned, and uses or rotates the credentials those records carry. A technician cannot administer the repository, manage groups, or publish bundles.",
  },
  {
    id: "administrator",
    label: "Administrator",
    rank: 2,
    group: "group-administrators",
    summary: "Manage templates, groups and publication across the repository.",
    description:
      "Everything a technician can do, everywhere — plus the repository-wide controls: asset templates, the group library, publication to the shared bus and knowledge base, imports, backups, and user roles.",
  },
];

export const ROLE_IDS = ROLES.map((r) => r.id);
export const ROLE_RANK = { viewer: 0, technician: 1, administrator: 2 };
export const ROLE_LABELS = { viewer: "Viewer", technician: "Technician", administrator: "Administrator" };
export const ROLE_GROUP_IDS = { viewer: "group-viewers", technician: "group-technicians", administrator: "group-administrators" };

// Legacy/spoken aliases fold onto the three IT-U roles. `editor` is the base
// framework's technician; `reviewer` is a technician who may sign off; `admin`
// is an administrator.
const ROLE_ALIASES = {
  editor: "technician",
  reviewer: "technician",
  admin: "administrator",
  owner: "administrator",
  helpdesk: "viewer",
};

export function normalizeRoleId(id) {
  const s = String(id == null ? "" : id).trim().toLowerCase();
  if (ROLE_RANK[s] !== undefined) return s;
  return ROLE_ALIASES[s] || null;
}

export function isRoleId(id) {
  return normalizeRoleId(id) !== null;
}

export function roleDef(id) {
  const n = normalizeRoleId(id);
  return n ? ROLES.find((r) => r.id === n) || null : null;
}

export function roleRank(id) {
  const n = normalizeRoleId(id);
  return n === null ? null : ROLE_RANK[n];
}

// The higher-ranked of two roles (null-safe).
export function highestRole(a, b) {
  const ra = roleRank(a);
  const rb = roleRank(b);
  if (ra === null) return normalizeRoleId(b);
  if (rb === null) return normalizeRoleId(a);
  return ra >= rb ? normalizeRoleId(a) : normalizeRoleId(b);
}

export function roleAtLeast(role, minRole) {
  const r = roleRank(role);
  const m = roleRank(minRole);
  return r !== null && m !== null && r >= m;
}

// ---- actions ---------------------------------------------------------------

// The IT-U action catalog. Each action names the MINIMUM role that holds it;
// scoping then narrows WHERE it may be exercised. `group` links the action to
// the group-permission it ultimately needs (see ./groups.js), so the coarse
// server gate and the fine-grained token check agree.
export const ACTIONS = [
  { id: "view", label: "View", minRole: "viewer", description: "Read the record, runbook or document." },
  { id: "create", label: "Create", minRole: "technician", description: "Add a record, runbook or checklist." },
  { id: "edit", label: "Edit", minRole: "technician", description: "Change a record, runbook or checklist." },
  { id: "delete", label: "Delete", minRole: "technician", description: "Remove a record and its relationships." },
  { id: "useCredential", label: "Use a credential", minRole: "technician", description: "Use or copy a stored secret while working." },
  { id: "rotateCredential", label: "Rotate a credential", minRole: "technician", description: "Change a stored secret and record the rotation." },
  { id: "share", label: "Share", minRole: "administrator", description: "Include records in a published bundle or export." },
  { id: "manageTemplates", label: "Manage templates", minRole: "administrator", description: "Create and change asset templates and template libraries." },
  { id: "manageGroups", label: "Manage groups", minRole: "administrator", description: "Create groups and grant roles and permissions." },
  { id: "managePublication", label: "Manage publication", minRole: "administrator", description: "Publish bundles to the shared bus and knowledge base." },
  { id: "manageUsers", label: "Manage users", minRole: "administrator", description: "Assign roles and disable accounts." },
  { id: "administer", label: "Administer", minRole: "administrator", description: "Change repository-wide controls and settings." },
];

export const ACTION_IDS = ACTIONS.map((a) => a.id);

// Legacy spellings map onto the IT-U actions.
const ACTION_ALIASES = {
  read: "view",
  write: "edit",
  approve: "edit",
  review: "view",
  return: "edit",
  submit: "edit",
  archive: "edit",
  restore: "edit",
  announce: "edit",
  publish: "managePublication",
  manageCats: "manageGroups",
  manageUsers: "manageUsers",
  backup: "administer",
  restoreBackup: "administer",
  rotate: "rotateCredential",
  use: "useCredential",
  useCredential: "useCredential",
};

export function normalizeAction(id) {
  const s = String(id == null ? "" : id).trim();
  if (!s) return null;
  if (ACTION_IDS.includes(s)) return s;
  return ACTION_ALIASES[s] || null;
}

export function actionDef(id) {
  const n = normalizeAction(id);
  return n ? ACTIONS.find((a) => a.id === n) || null : null;
}

export function roleAllows(role, action) {
  const def = actionDef(action);
  if (!def) return false;
  return roleAtLeast(role, def.minRole);
}

export function actionsForRole(role) {
  return ACTIONS.filter((a) => roleAllows(role, a.id)).map((a) => a.id);
}

// ---- scopes ----------------------------------------------------------------

// A scope string is validated before it is stored or sent to the server. Client
// and service ids are docset/record ids (lowercase slug + hex); the total is
// capped so it always fits the server's fixed 64-byte scope field.
const SCOPE_PART = "[a-z0-9][a-z0-9._-]*";
const SCOPE_RE = new RegExp("^(\\*|client:" + SCOPE_PART + "|service:" + SCOPE_PART + "/" + SCOPE_PART + ")$");
export const SCOPE_MAX_LENGTH = 64;

export function isScope(scope) {
  const s = String(scope == null ? "" : scope);
  return s.length > 0 && s.length <= SCOPE_MAX_LENGTH && SCOPE_RE.test(s);
}

export function clientScope(clientId) {
  return CLIENT_PREFIX + String(clientId == null ? "" : clientId);
}

export function serviceScope(clientId, serviceId) {
  return SERVICE_PREFIX + String(clientId == null ? "" : clientId) + "/" + String(serviceId == null ? "" : serviceId);
}

// Parse a scope into its parts. Always returns an object (`kind:"global"` for
// anything unrecognized, so callers cannot crash on a legacy category string).
export function parseScope(scope) {
  const raw = String(scope == null ? "" : scope);
  if (raw === GLOBAL_SCOPE || raw === "") return { kind: "global", raw: GLOBAL_SCOPE, clientId: null, serviceId: null };
  if (raw.startsWith(CLIENT_PREFIX)) {
    const clientId = raw.slice(CLIENT_PREFIX.length);
    return clientId ? { kind: "client", raw, clientId, serviceId: null } : { kind: "global", raw: GLOBAL_SCOPE, clientId: null, serviceId: null };
  }
  if (raw.startsWith(SERVICE_PREFIX)) {
    const rest = raw.slice(SERVICE_PREFIX.length);
    const i = rest.indexOf("/");
    if (i > 0 && i < rest.length - 1) {
      return { kind: "service", raw, clientId: rest.slice(0, i), serviceId: rest.slice(i + 1) };
    }
    return { kind: "client", raw, clientId: rest, serviceId: null };
  }
  // Anything else (e.g. a base-framework category id) is treated as a client-less
  // token: it matches only itself, with global as its fallback.
  return { kind: "custom", raw, clientId: null, serviceId: null };
}

// How specific is a scope? Bigger = more specific.
export function scopeSpecificity(scope) {
  const p = parseScope(scope);
  if (p.kind === "service") return 2;
  if (p.kind === "client" || p.kind === "custom") return 1;
  return 0;
}

// The chain from the given scope outward to the global scope, most specific
// first — the order in which assignments are consulted.
export function ancestorScopes(scope) {
  const p = parseScope(scope);
  if (p.kind === "service") return [p.raw, clientScope(p.clientId), GLOBAL_SCOPE];
  if (p.kind === "client") return [p.raw, GLOBAL_SCOPE];
  if (p.kind === "custom") return [p.raw, GLOBAL_SCOPE];
  return [GLOBAL_SCOPE];
}

// Does an assignment made at `assignmentScope` apply to `scope`? An assignment
// applies to its own scope and to anything nested inside it.
export function scopeApplies(assignmentScope, scope) {
  const a = parseScope(assignmentScope);
  const s = parseScope(scope);
  if (a.raw === GLOBAL_SCOPE) return true;
  if (a.raw === s.raw) return true;
  if (a.kind === "client" && (s.kind === "client" || s.kind === "service")) return a.clientId === s.clientId;
  return false;
}

// The scope a request targets: an explicit scope wins; otherwise a record's
// service (its own `service` reference when it has one, else its own id), then
// the documentation set, then global.
export function scopeFor({ scope = null, setId = null, record = null } = {}) {
  if (scope) return String(scope);
  if (record && setId) {
    const ref = record.service && record.service.id ? record.service : { id: record.id };
    return ref && ref.id ? serviceScope(setId, ref.id) : clientScope(setId);
  }
  if (setId) return clientScope(setId);
  return GLOBAL_SCOPE;
}

export function scopeLabel(scope) {
  const p = parseScope(scope);
  if (p.kind === "service") return "service " + p.serviceId + " in " + p.clientId;
  if (p.kind === "client") return "client " + p.clientId;
  if (p.kind === "custom") return p.raw;
  return "the whole repository";
}

// A stable short label for a scope (used in chips).
export function scopeTitle(scope) {
  const p = parseScope(scope);
  if (p.kind === "service") return { kind: "service", label: p.serviceId, sub: p.clientId, scope: p.raw };
  if (p.kind === "client") return { kind: "client", label: p.clientId, sub: "", scope: p.raw };
  if (p.kind === "custom") return { kind: "custom", label: p.raw, sub: "", scope: p.raw };
  return { kind: "global", label: "Whole repository", sub: "", scope: GLOBAL_SCOPE };
}

// ---- assignments -----------------------------------------------------------

// One role grant: an identity holds `role` at `scope`.
export function normalizeAssignment(a, { now = () => Date.now() } = {}) {
  const src = a && typeof a === "object" ? a : {};
  const scope = src.scope != null ? String(src.scope) : src.cat != null ? String(src.cat) : GLOBAL_SCOPE;
  const role = src.role != null ? normalizeRoleId(src.role) : null;
  const by = src.by != null ? String(src.by) : src.grantedBy != null ? String(src.grantedBy) : "";
  const at = Number(src.at != null ? src.at : src.updatedAt != null ? src.updatedAt : now()) || 0;
  return { scope: scope === "" ? GLOBAL_SCOPE : scope, role: role || "viewer", by, at };
}

export function assignmentKey(a) {
  const n = normalizeAssignment(a);
  return n.scope + "::" + (normalizeRoleId(n.role) || n.role);
}

export function validateAssignment(a) {
  const errors = [];
  if (!a || typeof a !== "object") return { ok: false, errors: ["An assignment must be an object."] };
  const scope = a.scope != null ? a.scope : a.cat;
  if (!isScope(scope)) errors.push(`“${scope}” is not a valid scope (use “*”, “client:<id>” or “service:<id>/<id>”).`);
  if (normalizeRoleId(a.role) === null) errors.push(`“${a.role}” is not one of the IT-U roles (viewer, technician, administrator).`);
  return { ok: errors.length === 0, errors };
}

// Collapse a list of assignments to at most one per scope (highest rank wins),
// dropping blanks, invalid scopes and duplicates. Stable order: most specific
// scope first, then alphabetical.
export function normalizeAssignments(assignments = []) {
  const byScope = new Map();
  for (const raw of Array.isArray(assignments) ? assignments : []) {
    if (!raw || typeof raw !== "object") continue;
    const scope = raw.scope != null ? String(raw.scope) : raw.cat != null ? String(raw.cat) : GLOBAL_SCOPE;
    const role = normalizeRoleId(raw.role);
    if (!isScope(scope) || !role) continue;
    const existing = byScope.get(scope);
    if (!existing || roleRank(role) > roleRank(existing.role)) byScope.set(scope, normalizeAssignment({ ...raw, scope, role }, { now: () => 0 }));
  }
  return [...byScope.values()].sort((a, b) => scopeSpecificity(b.scope) - scopeSpecificity(a.scope) || String(a.scope).localeCompare(String(b.scope)));
}

// The assignment that governs `scope`, if any: walk the scope chain from most
// to least specific and take the first (equivalently most specific) match.
export function resolveRole(assignments, scope, fallback = null) {
  for (const s of ancestorScopes(scope)) {
    const hit = (assignments || []).find((a) => a.scope === s && normalizeRoleId(a.role));
    if (hit) return { role: normalizeRoleId(hit.role), scope: s, assignment: hit };
    const applies = (assignments || []).find((a) => a.scope === s);
    if (applies) return { role: normalizeRoleId(applies.role) || "viewer", scope: s, assignment: applies };
  }
  return fallback === null ? null : { role: normalizeRoleId(fallback) || "viewer", scope: GLOBAL_SCOPE, assignment: null, fallback: true };
}

// Unused-scope filter for a client (used by the UI's scope picker).
export function assignmentsFor(assignments, clientId) {
  return (assignments || []).filter((a) => {
    const p = parseScope(a.scope);
    return p.raw === GLOBAL_SCOPE || p.clientId === clientId;
  });
}

// ---- the decision ----------------------------------------------------------

// The pure authorization decision. Owner (single-user local mode / platform
// owner) and server administrator bypass every check; otherwise the scoped role
// decides. Returns a detailed result the UI and the server can both act on.
export function can({ assignments = [], scope = GLOBAL_SCOPE, action, role = null, isOwner = false, isAdmin = false } = {}) {
  const def = actionDef(action);
  const target = scopeFor({ scope });
  if (isOwner || isAdmin) {
    return { allow: true, code: "OWNER", role: isAdmin && !isOwner ? "administrator" : "administrator", action: normalizeAction(action), scope: target, reason: "Owner access." };
  }
  if (!def) {
    return { allow: false, code: "UNKNOWN_ACTION", role: null, action: String(action == null ? "" : action), scope: target, reason: `“${action}” is not a known IT-U action.` };
  }
  const resolved = role ? { role: normalizeRoleId(role), scope: GLOBAL_SCOPE, assignment: null } : resolveRole(assignments, target, "viewer");
  const effRole = resolved ? resolved.role : "viewer";
  const allow = roleAllows(effRole, def.id);
  return {
    allow,
    code: allow ? "GRANTED" : "FORBIDDEN",
    role: effRole,
    action: def.id,
    scope: target,
    matchedScope: resolved ? resolved.scope : GLOBAL_SCOPE,
    minRole: def.minRole,
    reason: allow
      ? `${ROLE_LABELS[effRole] || effRole} holds “${def.label}” at ${scopeLabel(target)}.`
      : `The ${ROLE_LABELS[effRole] || effRole} role does not hold “${def.label}” at ${scopeLabel(target)} — a ${ROLE_LABELS[def.minRole] || def.minRole} is required.`,
  };
}

// A per-action breakdown for the UI: which actions this assignment set holds at
// a scope.
export function explain({ assignments = [], scope = GLOBAL_SCOPE, isOwner = false, isAdmin = false } = {}) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = can({ assignments, scope, action: a.id, isOwner, isAdmin });
  const eff = isOwner || isAdmin ? { role: "administrator", scope: GLOBAL_SCOPE } : resolveRole(assignments, scope, "viewer");
  return { scope: scopeFor({ scope }), role: eff ? eff.role : "viewer", matchedScope: eff ? eff.scope : GLOBAL_SCOPE, actions: out };
}

// A compact summary of a user's assignments, for listing.
export function summarizeAssignments(assignments = []) {
  const list = normalizeAssignments(assignments);
  const counts = { viewer: 0, technician: 0, administrator: 0 };
  for (const a of list) counts[a.role] = (counts[a.role] || 0) + 1;
  return {
    total: list.length,
    counts,
    clients: list.filter((a) => parseScope(a.scope).kind === "client").length,
    services: list.filter((a) => parseScope(a.scope).kind === "service").length,
    global: list.some((a) => a.scope === GLOBAL_SCOPE) ? list.find((a) => a.scope === GLOBAL_SCOPE).role : null,
    list,
  };
}
