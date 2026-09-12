// src/framework/access.js — the access-control service (roadmap Phase 4,
// task 20).
//
// The stateful half of the access model in ./groups.js. It persists the group
// library as ONE versioned document (`access-groups`) in IT-U's storage
// namespace — the same shape as the Flexible Asset template library — so the
// provider's groups, permissions and membership are shared across every client
// and survive reloads/devices.
//
// It answers the two questions the interface and the documentation layer must
// ask before ANY sensitive action:
//
//   can(principal, request)  → { allow, reason, code, ... }   — never throws
//   require(principal, request)                               — throws FORBIDDEN
//
// A request is `{ action, record?, set?, level? }`. When a record is supplied
// the level is derived from its type (organization / asset / document /
// general-password), and — the task's second rule — an EMBEDDED credential is
// resolved through the record it belongs to: it has no independent grant, it
// inherits the owner's level and (where the owner declares one) the owner's
// credential-permission set. See `authorizeRecord`.
//
// The OWNER (single-user local mode, or the platform owner) holds every
// permission: groups only restrict identified, non-owner identities. That
// mirrors the hub's degrade-gracefully behaviour — nothing about IT-U is
// blocked by the absence of an access model.

import { StoreError, CODES } from "./store/errors.js";
import {
  ACCESS_LEVELS,
  ACCESS_ACTIONS,
  ACCESS_MATRIX,
  OWNER_PERMISSIONS,
  BUILTIN_GROUPS,
  BUILTIN_GROUP_IDS,
  ROLE_GROUPS,
  ROLE_LABELS,
  builtinGroup,
  isBuiltinGroup,
  levelForType,
  credentialActionLevelAction,
  permissionToken,
  permissionLabel,
  isKnownPermission,
  normalizeGroup,
  validateGroup,
  requireGroup,
  groupAllows,
  groupPermissionsFor,
  combinePermissions,
} from "./groups.js";
import { findRecord, normalizeRef, sameRef } from "./relationships.js";
import { isEmbedded, ownerRef, effectivePermissions } from "./password.js";
import {
  ROLES as ITU_ROLES,
  ROLE_IDS as ITU_ROLE_IDS,
  ROLE_LABELS as ITU_ROLE_LABELS,
  ROLE_GROUP_IDS as ITU_ROLE_GROUP_IDS,
  ACTIONS as ITU_ACTIONS,
  GLOBAL_SCOPE,
  clientScope,
  serviceScope,
  parseScope,
  scopeLabel,
  scopeFor,
  normalizeAssignments,
  summarizeAssignments,
  resolveRole as resolveScopedRole,
  roleAllows,
  actionsForRole,
  can as roleCan,
  explain as roleExplain,
} from "./roles.js";

export const LIBRARY_DOC = "access-groups";
export const ACCESS_SCHEMA = "itu-access-groups/1";

const clone = (v) => JSON.parse(JSON.stringify(v));

function seedData(now) {
  return {
    schema: ACCESS_SCHEMA,
    groups: BUILTIN_GROUPS.map(clone),
    createdAt: now,
    updatedAt: now,
    updatedBy: "system",
  };
}

export function createAccessService({ store, cache, getRole = null, getAssignments = null, now = () => Date.now() } = {}) {
  let memo = null;
  let queue = Promise.resolve();
  const run = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.then(
      () => {},
      () => {},
    );
    return p;
  };

  async function load(force = false) {
    if (memo && !force) return memo;
    let doc = await store.readDocument(LIBRARY_DOC, force ? { force: true } : undefined).catch(() => null);
    if (!doc || !doc.data) {
      await store.ensure(LIBRARY_DOC, () => seedData(now()));
      doc = await store.readDocument(LIBRARY_DOC, { force: true }).catch(() => null);
    }
    memo = doc && doc.data ? doc.data : seedData(now());
    if (!Array.isArray(memo.groups)) memo.groups = [];
    // Guarantee the shipped groups always exist, so a corrupt/partial library
    // can never lock the owner out of group management.
    const present = new Set(memo.groups.map((g) => g.id));
    let repaired = false;
    for (const g of BUILTIN_GROUPS) {
      if (!present.has(g.id)) {
        memo.groups.push(clone(g));
        repaired = true;
      }
    }
    if (repaired) await store.writeDocument(LIBRARY_DOC, memo, { updatedBy: "system" }).catch(() => {});
    return memo;
  }

  function write(mutator, updatedBy = "system") {
    return run(async () => {
      const lib = await load(true);
      const data = { ...lib, groups: (lib.groups || []).map(clone) };
      const result = mutator(data) || {};
      data.schema = ACCESS_SCHEMA;
      data.updatedAt = now();
      data.updatedBy = updatedBy;
      const w = await store.writeDocument(LIBRARY_DOC, data, { updatedBy });
      memo = data;
      return { ...result, library: data, changed: !!(w && w.changed) };
    });
  }

  function peek() {
    return memo;
  }

  async function list() {
    const lib = await load();
    return (lib.groups || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function get(id) {
    const lib = await load();
    return (lib.groups || []).find((g) => g.id === id) || null;
  }

  async function libraryMeta() {
    const lib = await load();
    const groups = lib.groups || [];
    return {
      count: groups.length,
      builtinCount: groups.filter((g) => g.builtin).length,
      customCount: groups.filter((g) => !g.builtin).length,
      customizedCount: groups.filter((g) => g.builtin && g.updatedAt && g.createdAt && g.updatedAt > g.createdAt).length,
      updatedAt: lib.updatedAt,
      updatedBy: lib.updatedBy,
    };
  }

  function groupId(name, ids) {
    const base = "group-" + (String(name || "group").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom");
    if (!ids.includes(base)) return base;
    let n = 2;
    while (ids.includes(base + "-" + n)) n += 1;
    return base + "-" + n;
  }

  async function create(input = {}) {
    return write((lib) => {
      const ids = lib.groups.map((g) => g.id);
      const group = normalizeGroup({ ...input, id: input.id || groupId(input.name, ids), builtin: false });
      requireGroup(group);
      lib.groups.push(group);
      return { group };
    }, input.createdBy || "system");
  }

  async function update(id, patch = {}, opts = {}) {
    return write((lib) => {
      const group = lib.groups.find((g) => g.id === id);
      if (!group) throw new StoreError(CODES.UNKNOWN_GROUP, `No group “${id}”.`);
      if (patch.name != null) group.name = String(patch.name).trim();
      if (patch.description != null) group.description = String(patch.description).trim();
      if (patch.permissions != null) group.permissions = normalizeGroup({ permissions: patch.permissions }).permissions;
      if (patch.members != null) group.members = normalizeGroup({ members: patch.members }).members;
      group.id = id;
      group.updatedAt = now();
      requireGroup(group);
      return { group };
    }, opts.updatedBy || "system");
  }

  async function cloneGroup(id, { name, createdBy = "system" } = {}) {
    return write(
      (lib) => {
        const source = lib.groups.find((g) => g.id === id);
        if (!source) throw new StoreError(CODES.UNKNOWN_GROUP, `No group “${id}”.`);
        const ids = lib.groups.map((g) => g.id);
        const copy = normalizeGroup({
          ...clone(source),
          id: groupId(name || source.name + " (copy)", ids),
          name: String(name || source.name + " (copy)").trim(),
          builtin: false,
          createdAt: now(),
          updatedAt: now(),
        });
        requireGroup(copy);
        lib.groups.push(copy);
        return { group: copy };
      },
      createdBy,
    );
  }

  async function remove(id, opts = {}) {
    return write((lib) => {
      const idx = lib.groups.findIndex((g) => g.id === id);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_GROUP, `No group “${id}”.`);
      const group = lib.groups[idx];
      if (group.builtin && !opts.force) {
        throw new StoreError(CODES.INVALID_DATA, `“${group.name}” is a shipped group — reset it to its default permissions, or delete it explicitly.`);
      }
      lib.groups.splice(idx, 1);
      return { removed: group };
    }, opts.updatedBy || "system");
  }

  async function reset(id, opts = {}) {
    return write((lib) => {
      const idx = lib.groups.findIndex((g) => g.id === id);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_GROUP, `No group “${id}”.`);
      const shipped = builtinGroup(id);
      if (!shipped) throw new StoreError(CODES.INVALID_DATA, `“${lib.groups[idx].name}” is not a shipped group — there is nothing to reset it to.`);
      const restored = normalizeGroup({ ...clone(shipped), createdAt: lib.groups[idx].createdAt || now(), updatedAt: now() });
      lib.groups[idx] = restored;
      return { group: restored };
    }, opts.updatedBy || "system");
  }

  async function restoreLibrary(opts = {}) {
    return write((lib) => {
      const present = new Set(lib.groups.map((g) => g.id));
      const added = [];
      for (const g of BUILTIN_GROUPS) {
        if (present.has(g.id)) continue;
        lib.groups.push(clone(g));
        added.push(g.id);
      }
      return { added };
    }, opts.updatedBy || "system");
  }

  // Assign an identity to a set of groups (replacing its memberships). The
  // caller passes the full desired list, matching the group-permission model.
  async function assignGroups(identity, groupIds = [], opts = {}) {
    const who = String(identity || "").trim();
    if (!who) throw new StoreError(CODES.INVALID_DATA, "An identity is required to assign groups.");
    const wanted = new Set(groupIds.map(String));
    return write((lib) => {
      const applied = [];
      for (const group of lib.groups) {
        const has = (group.members || []).some((m) => m.toLowerCase() === who.toLowerCase());
        const want = wanted.has(group.id);
        if (want && !has) {
          group.members = [...(group.members || []), who];
          group.updatedAt = now();
          applied.push(group.id);
        } else if (!want && has) {
          group.members = group.members.filter((m) => m.toLowerCase() !== who.toLowerCase());
          group.updatedAt = now();
        }
      }
      return { identity: who, groups: wanted.size };
    }, opts.updatedBy || "system");
  }

  async function groupsFor(identity) {
    const who = String(identity || "").trim().toLowerCase();
    const groups = await list();
    return groups.filter((g) => (g.members || []).some((m) => m.toLowerCase() === who));
  }

  // ---- principals & authorization ------------------------------------------

  function resolvePrincipal(actor) {
    if (actor && typeof actor === "object") {
      const local = !!actor.local || actor.role === "owner";
      return {
        id: String(actor.id || actor.name || "unknown"),
        name: String(actor.name || actor.id || "unknown"),
        role: String(actor.role || (actor.isAdmin ? "admin" : local ? "owner" : "viewer")),
        groups: Array.isArray(actor.groups) ? actor.groups.map(String) : [],
        local,
        // Roadmap task 54: the hub's server-assigned, scoped roles for this
        // identity. Present only when the caller supplies them (or the hub is
        // connected); absent, the single global role governs exactly as before.
        assignments: Array.isArray(actor.assignments) ? normalizeAssignments(actor.assignments) : null,
      };
    }
    if (actor == null || actor === "" || actor === "owner") {
      return { id: "owner", name: "Owner", role: "owner", groups: [], local: true, assignments: null };
    }
    const role = (getRole && getRole(String(actor))) || "viewer";
    const raw = getAssignments ? getAssignments(String(actor)) : null;
    return {
      id: String(actor),
      name: String(actor),
      role,
      groups: [],
      local: role === "owner",
      assignments: raw ? normalizeAssignments(raw) : null,
    };
  }

  // The resolved permissions in force for a principal AT A SCOPE: the owner's
  // full set; otherwise the scoped role's default group, the explicitly
  // assigned groups, and every group whose member list names the principal.
  // (task 54: `scope` narrows the role a scoped assignment resolves to.)
  function effectiveAccess(principal, scope = GLOBAL_SCOPE) {
    const p = resolvePrincipal(principal);
    const target = scopeFor({ scope });
    if (p.local || p.role === "owner") {
      return { principal: p, owner: true, role: "owner", roleLabel: "Owner", scope: target, scoped: false, groupIds: [], groups: [], tokens: new Set(OWNER_PERMISSIONS), groupObjects: [] };
    }
    let role = p.role;
    let matchedScope = GLOBAL_SCOPE;
    let scoped = false;
    if (p.assignments && p.assignments.length) {
      scoped = true;
      const resolved = resolveScopedRole(p.assignments, target, null);
      if (resolved) {
        role = resolved.role;
        matchedScope = resolved.scope;
      } else {
        // Scoped assignments exist but none reach this scope: default-deny to
        // the read-only role rather than inheriting an unrelated broad role.
        role = "viewer";
      }
    }
    const lib = memo || null;
    const all = (lib && lib.groups) || [];
    const ids = new Set();
    const scopedGroup = ITU_ROLE_GROUP_IDS[role] || ROLE_GROUPS[role];
    if (scopedGroup) ids.add(scopedGroup);
    // Legacy global-role group only when the principal has no scoped roles.
    if (!scoped) {
      const roleGroup = ROLE_GROUPS[p.role];
      if (roleGroup) ids.add(roleGroup);
    }
    for (const id of p.groups) ids.add(id);
    for (const g of all) {
      if ((g.members || []).some((m) => m.toLowerCase() === p.id.toLowerCase())) ids.add(g.id);
    }
    const groups = all.filter((g) => ids.has(g.id));
    return {
      principal: p,
      owner: false,
      role,
      roleLabel: ITU_ROLE_LABELS[role] || ROLE_LABELS[role] || role,
      scope: target,
      scoped,
      matchedScope,
      groupIds: [...ids],
      groups: groups.map((g) => ({ id: g.id, name: g.name })),
      tokens: combinePermissions(groups),
      groupObjects: groups,
    };
  }

  // Derive the level + action a request targets, resolving an embedded
  // credential through the record it belongs to (its permission source).
  function resolveResource(record, set, action) {
    if (!record || !record.type) return { level: null, action, inheritedFrom: null, ownerName: null };
    if (record.type === "passwords" && isEmbedded(record)) {
      const ref = ownerRef(record);
      const owner = ref ? findRecord(set, ref) : null;
      return {
        level: levelForType(owner ? owner.type : "configurations"),
        action: credentialActionLevelAction(action),
        inheritedFrom: ref,
        ownerName: owner ? owner.name : null,
        embedded: true,
      };
    }
    return { level: levelForType(record.type), action, inheritedFrom: null, ownerName: null, embedded: false };
  }

  const CREDENTIAL_SCOPED_ACTIONS = ["view", "use", "edit", "rotate", "share"];

  // The single authorization decision. Never throws. A request is
  // `{ action, record?, set?, setId?, level?, scope? }`; the scope narrows the
  // role when the identity carries scoped assignments (task 54).
  function can(principal, request = {}) {
    const scope = scopeFor({
      scope: request.scope || null,
      setId: (request.set && request.set.id) || request.setId || null,
      record: request.record || null,
    });
    const access = effectiveAccess(principal, scope);
    let { level, action, record, set } = request;
    let inheritedFrom = null;
    let ownerName = null;
    if (record) {
      const r = resolveResource(record, set, action || "view");
      level = r.level;
      action = r.action;
      inheritedFrom = r.inheritedFrom;
      ownerName = r.ownerName;
    }
    if (!level || !action) {
      return { allow: true, code: "unscoped", reason: "No access rule applies to this action.", level: null, action: null, scope, role: access.role, principal: access };
    }
    const token = permissionToken(level, action);
    if (!isKnownPermission(token)) {
      return { allow: true, code: "unscoped", reason: `“${token}” is not a gated permission.`, level, action, scope, role: access.role, principal: access };
    }
    if (!access.owner && !access.tokens.has(token)) {
      return {
        allow: false,
        code: "FORBIDDEN",
        reason: `The ${access.roleLabel} role does not hold “${permissionLabel(token)}”${access.scoped ? ` at ${scopeLabel(scope)}` : ""}.`,
        level,
        action,
        token,
        scope,
        role: access.role,
        matchedScope: access.matchedScope,
        inheritedFrom,
        ownerName,
        principal: access,
      };
    }
    // Second gate for credentials: the record's own (or its owner's) declared
    // permission set must also permit the action. This is what makes an
    // embedded credential's permissions genuinely inherited rather than
    // assumed, and keeps a general credential's declared set authoritative.
    if (record && record.type === "passwords" && CREDENTIAL_SCOPED_ACTIONS.includes(action)) {
      const eff = effectivePermissions(record, set);
      if (!eff.permissions.includes(action)) {
        return {
          allow: false,
          code: "FORBIDDEN",
          reason: eff.inherited
            ? `This embedded credential inherits “${eff.ownerName || "its owner"}”'s permissions, which do not include “${action}”.`
            : `This credential's permission set does not include “${action}”.`,
          level,
          action,
          token,
          scope,
          role: access.role,
          inheritedFrom,
          ownerName,
          principal: access,
        };
      }
    }
    return {
      allow: true,
      code: "GRANTED",
      reason: access.owner ? "Owner access." : `Granted by ${access.groups.map((g) => g.name).join(", ") || access.roleLabel}${access.scoped ? ` at ${scopeLabel(scope)}` : ""}.`,
      level,
      action,
      token,
      scope,
      role: access.role,
      matchedScope: access.matchedScope,
      inheritedFrom,
      ownerName,
      principal: access,
    };
  }

  // The IT-U role decision at a scope (task 54): the coarse, role-only check the
  // server also performs, independent of the record-level permission tokens.
  function canAtScope(actor, scope, action) {
    const p = resolvePrincipal(actor);
    const owner = p.local || p.role === "owner";
    const admin = p.role === "admin" || p.role === "administrator";
    return roleCan({ assignments: p.assignments || [], scope: scopeFor({ scope }), action, isOwner: owner, isAdmin: admin });
  }

  // The role in force for an identity at a scope, with its effective tokens
  // (for the account panel and the people & access card).
  function scopedRole(actor, scope = GLOBAL_SCOPE) {
    const a = effectiveAccess(actor, scope);
    return {
      role: a.role,
      roleLabel: a.roleLabel,
      scope: a.scope,
      matchedScope: a.matchedScope,
      scoped: a.scoped,
      owner: a.owner,
      tokens: [...a.tokens],
      groups: a.groups,
      actions: a.owner ? ITU_ACTIONS.map((x) => x.id) : actionsForRole(a.role),
    };
  }

  function require(principal, request) {
    const res = can(principal, request);
    if (!res.allow) {
      const who = res.principal && res.principal.name ? res.principal.name : "This user";
      throw new StoreError(CODES.FORBIDDEN, `${who} is not allowed to ${res.action || "do that"}${res.level ? ` at the ${res.level} level` : ""} — ${res.reason}`);
    }
    return res;
  }

  // A per-action summary for the UI: does this principal hold each credential
  // action on this record? `level` is the level actually consulted (the owner's
  // level for an embedded credential).
  function describe(principal, { record, set, scope = null } = {}) {
    const resolved = record ? resolveResource(record, set, "view") : { level: null };
    const out = { level: resolved.level, embedded: !!resolved.embedded, inheritedFrom: resolved.inheritedFrom, ownerName: resolved.ownerName };
    for (const action of ACCESS_ACTIONS.map((a) => a.id)) {
      out[action] = can(principal, { record, set, scope, action }).allow;
    }
    out.access = effectiveAccess(principal, scopeFor({ scope, setId: set && set.id, record }));
    return out;
  }

  // A per-action role breakdown at a scope (task 54's people & access view).
  function explainRole(actor, scope = GLOBAL_SCOPE) {
    const p = resolvePrincipal(actor);
    const owner = p.local || p.role === "owner";
    const admin = p.role === "admin" || p.role === "administrator";
    return roleExplain({ assignments: p.assignments || [], scope: scopeFor({ scope }), isOwner: owner, isAdmin: admin });
  }

  return {
    LIBRARY_DOC,
    ACCESS_SCHEMA,
    // catalogs (re-exported so callers read one source of truth)
    ACCESS_LEVELS,
    ACCESS_ACTIONS,
    ACCESS_MATRIX,
    OWNER_PERMISSIONS,
    ROLE_GROUPS,
    ROLE_LABELS,
    BUILTIN_GROUP_IDS,
    // library
    load,
    peek,
    list,
    get,
    libraryMeta,
    create,
    update,
    clone: cloneGroup,
    remove,
    reset,
    restoreLibrary,
    assignGroups,
    groupsFor,
    groupId,
    // model helpers
    isBuiltin: isBuiltinGroup,
    isKnownPermission,
    normalizeGroup,
    validateGroup,
    requireGroup,
    groupAllows,
    groupPermissionsFor,
    levelForType,
    permissionLabel,
    // IT-U roles & scopes (task 54)
    ROLES: ITU_ROLES,
    ROLE_IDS: ITU_ROLE_IDS,
    ROLE_LABELS: ITU_ROLE_LABELS,
    ROLE_ACTIONS: ITU_ACTIONS,
    GLOBAL_SCOPE,
    clientScope,
    serviceScope,
    parseScope,
    scopeLabel,
    scopeFor,
    roleAllows,
    actionsForRole,
    summarizeAssignments,
    normalizeAssignments,
    // authorization
    resolvePrincipal,
    effectiveAccess,
    resolveResource,
    can,
    canAtScope,
    scopedRole,
    explainRole,
    require,
    describe,
  };
}
