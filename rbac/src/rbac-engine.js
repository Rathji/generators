// src/rbac-engine.js
// ============================================================================
// RBAC pure engine — single source of truth for role/permission logic.
//
// Plain JS, ZERO platform dependencies (runs in the browser, the server-plugin
// sandbox, workers, anywhere). The two functions below are embedded into
// main.pjs (rbac.createEngine / rbac.matchPermission) and into the server core
// (src/rbac-server-core.js) by the build step documented in src/README.md.
//
// KEEP THESE FUNCTION NAMES STABLE — the build script extracts them by name:
//   __rbacMatchPermission(pattern, permission) -> boolean
//   __rbacEngine() -> engine object
//
// Semantics:
//   - Permissions are dot-separated strings ("doc.edit", "admin.users.ban").
//   - A permission PATTERN grants a request if the wildcard matches:
//       "*"     grants everything
//       "a.*"   grants "a", "a.b", "a.b.c", ...
//       "a.b"   grants exactly "a.b"
//   - Roles grant perms + denies; a deny overrides every grant (across the
//     whole role set of a user, including inherited roles).
//   - Roles may inherit other roles (transitively, cycle-safe).
//   - Users map to a set of direct roles; authorization derives from the full
//     transitive closure.
//   - Banned users are denied everything.
//   - RESOURCE SCOPING (optional): can(userId, perm, {owner, sharedWith})
//     also checks "own."+perm (when owner === userId) and "share."+perm (when
//     sharedWith includes userId). So grant "own.doc.*" to a baseline role to
//     let users manage resources they own, and "share.doc.edit" to let editors
//     touch docs shared with them. isOwner / isShared report the two
//     dimensions. Without a resource, can() is the plain global check.
// ============================================================================

function __rbacMatchPermission(pattern, permission) {
  if (pattern === "*") return true;
  if (pattern === permission) return true;
  var ps = pattern.split(".");
  var qs = permission.split(".");
  for (var i = 0; i < qs.length; i++) {
    var p = ps[i];
    if (p === undefined) return false; // pattern shorter than the request
    if (p === "*") return true;        // wildcard swallows the rest
    if (p !== qs[i]) return false;
  }
  // request fully consumed; a trailing ".*" on the pattern also matches
  return ps[qs.length] === "*";
}

function __rbacEngine() {
  var roles = new Map();      // name -> { perms:[], denies:[], inherits:[] }
  var userRoles = new Map();  // userId -> Set(roleName)
  var banned = new Set();     // userIds denied everything

  function defineRole(name, def) {
    def = def || {};
    if (typeof name !== "string" || name === "") throw new Error("rbac: role name must be a non-empty string");
    roles.set(name, {
      perms: (def.perms || []).slice(),
      denies: (def.denies || []).slice(),
      inherits: (def.inherits || []).slice()
    });
  }

  function deleteRole(name) {
    roles.delete(name);
    userRoles.forEach(function (set) { set.delete(name); });
  }

  function grant(userId, role) {
    if (typeof userId !== "string" || userId === "") throw new Error("rbac: userId must be a non-empty string");
    var set = userRoles.get(userId);
    if (!set) { set = new Set(); userRoles.set(userId, set); }
    set.add(role);
  }

  function revoke(userId, role) {
    var set = userRoles.get(userId);
    if (set) set.delete(role);
  }

  function setUserRoles(userId, list) {
    userRoles.set(userId, new Set(list || []));
  }

  function removeUser(userId) { userRoles.delete(userId); }
  function ban(userId) { banned.add(userId); }
  function unban(userId) { banned.delete(userId); }
  function isBanned(userId) { return banned.has(userId); }
  function roleExists(name) { return roles.has(name); }

  // all role names a user holds, including inherited (transitive closure)
  function rolesOf(userId) {
    var out = new Set();
    var seen = new Set();
    function visit(r) {
      if (seen.has(r)) return;
      seen.add(r);
      out.add(r);
      var d = roles.get(r);
      if (d) for (var i = 0; i < d.inherits.length; i++) visit(d.inherits[i]);
    }
    var mine = userRoles.get(userId);
    if (mine) mine.forEach(visit);
    return out;
  }

  // direct role names only (what was granted), used for storage/admin view
  function directRoles(userId) {
    return new Set(userRoles.get(userId) || []);
  }

  function hasRole(userId, role) { return rolesOf(userId).has(role); }

  // Does the user hold the given permission STRING (a plain permission, or a
  // scoped "own.x" / "share.x")? Deny overrides grant across the whole
  // inherited role set for that string.
  //
  // IMPORTANT: the traversal must NOT stop at the first grant. A grant in one
  // role must not shadow a deny in a role it inherits (or a sibling role), so
  // grants are accumulated (anyGrant) while the whole role set — including
  // inherited roles — is still visited for denies. Once a deny is found the
  // rest of the traversal is skipped (denied stays true, the outcome is fixed).
  function grantCheck(userId, permission) {
    if (banned.has(userId)) return false;
    var seen = new Set();
    var denied = false;
    var anyGrant = false;
    function visit(r) {
      if (seen.has(r) || denied) return;
      seen.add(r);
      var d = roles.get(r);
      if (!d) return;
      for (var i = 0; i < d.denies.length; i++) {
        if (__rbacMatchPermission(d.denies[i], permission)) { denied = true; return; }
      }
      for (var i = 0; i < d.perms.length; i++) {
        if (__rbacMatchPermission(d.perms[i], permission)) { anyGrant = true; }
      }
      for (var i = 0; i < d.inherits.length; i++) visit(d.inherits[i]);
    }
    var mine = userRoles.get(userId);
    if (mine) mine.forEach(visit);
    return !denied && anyGrant;
  }

  // Resource-scoped authorization. `permission` is a plain permission string
  // ("doc.edit"). `resource` (optional) is { owner: userId, sharedWith: [ids] }.
  // The check succeeds if ANY applicable dimension grants:
  //   - global:    the plain permission
  //   - ownership: "own." + permission — only when resource.owner === userId
  //   - sharing:   "share." + permission — only when sharedWith includes userId
  // Each dimension is a full grantCheck, so a deny on any applicable dimension
  // defeats that dimension's grant. Without `resource` this is the plain check.
  function can(userId, permission, resource) {
    if (banned.has(userId)) return false;
    var checks = [permission];
    if (resource && typeof resource === "object") {
      if (resource.owner === userId) checks.push("own." + permission);
      if (resource.sharedWith && resource.sharedWith.indexOf(userId) !== -1) checks.push("share." + permission);
    }
    for (var i = 0; i < checks.length; i++) {
      if (grantCheck(userId, checks[i])) return true;
    }
    return false;
  }

  function isOwner(userId, resource) {
    return !!(resource && resource.owner === userId);
  }

  function isShared(userId, resource) {
    return !!(resource && resource.sharedWith && resource.sharedWith.indexOf(userId) !== -1);
  }

  // the permission PATTERNS the user effectively holds (not expanded)
  function effectivePermissions(userId) {
    var out = new Set();
    rolesOf(userId).forEach(function (r) {
      var d = roles.get(r);
      if (d) for (var i = 0; i < d.perms.length; i++) out.add(d.perms[i]);
    });
    return out;
  }

  function listRoles() { return Array.from(roles.keys()); }
  function listUsers() { return Array.from(userRoles.keys()); }
  function roleDef(name) {
    var d = roles.get(name);
    if (!d) return null;
    return { perms: d.perms.slice(), denies: d.denies.slice(), inherits: d.inherits.slice() };
  }

  function serialize() {
    return {
      v: 1,
      roles: Array.from(roles.entries()).map(function (e) {
        return [e[0], e[1].perms.slice(), e[1].denies.slice(), e[1].inherits.slice()];
      }),
      users: Array.from(userRoles.entries()).map(function (e) { return [e[0], Array.from(e[1])]; }),
      banned: Array.from(banned)
    };
  }

  function load(data) {
    roles.clear(); userRoles.clear(); banned.clear();
    if (!data || data.v !== 1) return;
    (data.roles || []).forEach(function (r) {
      roles.set(r[0], { perms: (r[1] || []).slice(), denies: (r[2] || []).slice(), inherits: (r[3] || []).slice() });
    });
    (data.users || []).forEach(function (u) { userRoles.set(u[0], new Set(u[1] || [])); });
    (data.banned || []).forEach(function (b) { banned.add(b); });
  }

  return {
    defineRole: defineRole,
    deleteRole: deleteRole,
    grant: grant,
    revoke: revoke,
    setUserRoles: setUserRoles,
    removeUser: removeUser,
    ban: ban,
    unban: unban,
    isBanned: isBanned,
    roleExists: roleExists,
    rolesOf: rolesOf,
    directRoles: directRoles,
    hasRole: hasRole,
    can: can,
    isOwner: isOwner,
    isShared: isShared,
    effectivePermissions: effectivePermissions,
    listRoles: listRoles,
    listUsers: listUsers,
    roleDef: roleDef,
    serialize: serialize,
    load: load
  };
}
