export const OPENRPA_FULL_RIGHTS = 65535;

export const OPENRPA_RIGHTS = [
  { bit: 1, key: "read", label: "Read" },
  { bit: 2, key: "write", label: "Write" },
  { bit: 4, key: "create", label: "Create" },
  { bit: 8, key: "delete", label: "Delete" },
  { bit: 16, key: "execute", label: "Execute" },
  { bit: 32, key: "admin", label: "Manage" },
  { bit: 64, key: "publish", label: "Publish" },
  { bit: 128, key: "invoke", label: "Invoke" },
];

export const OPENRPA_ACTIONS = [
  { id: "read", label: "Read", right: "read" },
  { id: "create", label: "Create", right: "create" },
  { id: "update", label: "Update", right: "write" },
  { id: "delete", label: "Delete", right: "delete" },
  { id: "execute", label: "Execute", right: "execute" },
  { id: "manage", label: "Manage", right: "admin" },
  { id: "publish", label: "Publish", right: "publish" },
  { id: "invoke", label: "Invoke", right: "invoke" },
];

const RIGHT_BY_KEY = new Map(OPENRPA_RIGHTS.map((right) => [right.key, right]));
const ACTION_BY_ID = new Map(OPENRPA_ACTIONS.map((action) => [action.id, action]));

export function rightValue(key) {
  const right = RIGHT_BY_KEY.get(String(key));
  return right ? right.bit : null;
}

export function normalizeMask(mask) {
  if (Array.isArray(mask)) return mask.reduce((acc, key) => acc | (rightValue(key) || 0), 0);
  if (typeof mask === "string") return rightValue(mask) || 0;
  const value = Number(mask);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function hasRight(mask, key) {
  const bit = rightValue(key);
  if (bit == null) return false;
  return (normalizeMask(mask) & bit) === bit;
}

export function decodeRights(mask) {
  const value = normalizeMask(mask);
  const granted = [];
  const labels = [];
  let known = 0;
  for (const right of OPENRPA_RIGHTS) {
    if ((value & right.bit) === right.bit) {
      granted.push(right.key);
      labels.push(right.label);
      known |= right.bit;
    }
  }
  const extended = value & ~known & OPENRPA_FULL_RIGHTS;
  if (extended) {
    granted.push("extended");
    labels.push("Extended");
  }
  return { mask: value, granted, labels, extended, full: value === OPENRPA_FULL_RIGHTS };
}

export function normalizeAcl(raw) {
  const acl = raw && typeof raw === "object" ? raw : {};
  const aceRaw = Array.isArray(acl.ace) ? acl.ace : [];
  const ace = aceRaw
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      id: entry._id || entry.id || `ace_${index}`,
      name: entry.name || entry.username || entry.role || null,
      deny: !!entry.deny,
      rights: normalizeMask(entry.rights),
      userId: entry.userid || entry.userId || null,
      roleId: entry.roleid || entry.roleId || null,
    }));
  return {
    id: acl._id || acl.id || null,
    name: acl.name || "Unnamed ACL",
    ace,
    members: ace.length,
    denied: ace.filter((entry) => entry.deny).length,
    restricted: String(acl.name || "").toLowerCase() !== "default" || ace.some((entry) => entry.deny),
  };
}

function roleNames(roles) {
  return (Array.isArray(roles) ? roles : [])
    .map((role) => (typeof role === "string" ? role : role && role.name))
    .filter(Boolean);
}

function roleIds(roleObjects) {
  return (Array.isArray(roleObjects) ? roleObjects : [])
    .map((role) => (typeof role === "string" ? null : role && role._id))
    .filter(Boolean);
}

export function aceMatches(ace, subject = {}) {
  if (!ace) return false;
  const user = subject.user || {};
  const userIds = [user._id, subject.userId].filter(Boolean);
  const ids = [subject.roleIds, roleIds(subject.roleObjects)].flat().filter(Boolean);
  if (ace.userId && userIds.includes(ace.userId)) return true;
  if (ace.roleId && ids.includes(ace.roleId)) return true;
  const name = ace.name ? String(ace.name).trim().toLowerCase() : "";
  if (!name) return false;
  if (name === "everyone" || name === "*" || name === "all users") return true;
  const candidateNames = [
    user.username,
    user.name,
    ...roleNames(subject.roles),
    ...roleNames(subject.roleObjects),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  return candidateNames.includes(name);
}

export function computeEffectiveRights(aclInput, subject = {}) {
  const acl = aclInput && Array.isArray(aclInput.ace) ? aclInput : normalizeAcl(aclInput);
  let grantedMask = 0;
  let deniedMask = 0;
  const matched = [];
  for (const ace of acl.ace) {
    if (!aceMatches(ace, subject)) continue;
    if (ace.deny) deniedMask |= ace.rights;
    else grantedMask |= ace.rights;
    matched.push({ id: ace.id, name: ace.name, deny: ace.deny, rights: ace.rights, granted: decodeRights(ace.rights).granted });
  }
  const rights = grantedMask & ~deniedMask;
  const decoded = decodeRights(rights);
  const actions = {};
  for (const action of OPENRPA_ACTIONS) actions[action.id] = hasRight(rights, action.right);
  return {
    acl: acl.id,
    aclName: acl.name,
    rights,
    grantedMask,
    deniedMask,
    granted: decoded.granted,
    labels: decoded.labels,
    extended: decoded.extended,
    full: decoded.full,
    matched,
    defaulted: matched.length === 0,
    actions,
  };
}

export function computeAction(aclInput, subject = {}, actionId) {
  const action = ACTION_BY_ID.get(String(actionId)) || OPENRPA_ACTIONS.find((entry) => entry.right === actionId) || null;
  if (!action) return { allowed: false, action: actionId, label: String(actionId), reason: `Unknown action "${actionId}".` };
  const rights = computeEffectiveRights(aclInput, subject);
  const allowed = !!rights.actions[action.id];
  let reason;
  if (allowed) {
    const granting = rights.matched.find((entry) => !entry.deny);
    reason = granting
      ? `Granted by the “${granting.name || granting.id}” ACL entry.`
      : "Granted.";
  } else if (rights.defaulted) {
    reason = "No ACL entry matches this user, and OpenFlow denies by default.";
  } else {
    reason = `The matching ACL entries do not grant ${action.label.toLowerCase()}.`;
  }
  return { allowed, action: action.id, label: action.label, reason, rights };
}

export function aclStats(aclInput) {
  const acl = normalizeAcl(aclInput);
  const masks = acl.ace.map((entry) => entry.rights);
  return {
    name: acl.name,
    members: acl.members,
    denied: acl.denied,
    restricted: acl.restricted,
    fullMembers: masks.filter((mask) => mask === OPENRPA_FULL_RIGHTS).length,
    rightKeys: Array.from(new Set(masks.flatMap((mask) => decodeRights(mask).granted))).sort(),
  };
}

export function createAclMirror({ request, clock = () => Date.now() } = {}) {
  let users = [];
  let roles = [];
  let syncedAt = null;
  let error = null;

  const iso = () => new Date(clock()).toISOString();

  async function sync() {
    try {
      const nextUsers = await request("getusers", {});
      const nextRoles = await request("getroles", {});
      users = Array.isArray(nextUsers) ? nextUsers : [];
      roles = Array.isArray(nextRoles) ? nextRoles : [];
      syncedAt = iso();
      error = null;
      return { ok: true, users: users.length, roles: roles.length, syncedAt };
    } catch (caught) {
      error = caught && caught.message ? caught.message : String(caught);
      return { ok: false, error };
    }
  }

  function userFor(username) {
    if (!username) return null;
    const needle = String(username).toLowerCase();
    return users.find((user) => String(user.username || "").toLowerCase() === needle) || null;
  }

  function rolesForUser(user) {
    if (!user) return [];
    return roleNames(user.roles);
  }

  function subjectFor(info) {
    const session = info || {};
    const username = session.username || (session.user && session.user.username) || null;
    const mirrored = userFor(username);
    const roleObjects = mirrored && Array.isArray(mirrored.roles) ? mirrored.roles.filter((role) => role && typeof role === "object") : [];
    const roleNamesOut = mirrored ? rolesForUser(mirrored) : session.roles || [];
    return {
      connected: !!mirrored,
      source: mirrored ? "mirror" : session.signedIn ? "session" : "anonymous",
      user: {
        _id: (mirrored && mirrored._id) || (session.user && session.user._id) || null,
        name: (mirrored && mirrored.name) || (session.user && session.user.name) || username || "Anonymous",
        username: username || null,
      },
      roles: roleNamesOut.slice(),
      roleObjects: roleObjects.slice(),
      roleIds: roleObjects.map((role) => role._id).filter(Boolean),
    };
  }

  function subjectForUser(user) {
    if (!user) return subjectFor({});
    return {
      connected: true,
      source: "mirror",
      user: { _id: user._id || null, name: user.name || user.username || null, username: user.username || null },
      roles: rolesForUser(user),
      roleObjects: Array.isArray(user.roles) ? user.roles.filter((role) => role && typeof role === "object") : [],
      roleIds: (user.roles || []).map((role) => (role && role._id) || null).filter(Boolean),
    };
  }

  function rightsForDocument(doc, subject) {
    const raw = doc && (doc._acl || doc.acl) ? doc._acl || doc.acl : doc && doc.ace ? doc : null;
    return computeEffectiveRights(raw, subject);
  }

  function actionForDocument(doc, subject, actionId) {
    const raw = doc && (doc._acl || doc.acl) ? doc._acl || doc.acl : doc && doc.ace ? doc : null;
    return computeAction(raw, subject, actionId);
  }

  function stats() {
    return {
      synced: syncedAt != null,
      syncedAt,
      users: users.length,
      roles: roles.length,
      error,
    };
  }

  function reset() {
    users = [];
    roles = [];
    syncedAt = null;
    error = null;
  }

  return {
    sync,
    users: () => users.map((user) => ({ ...user })),
    roles: () => roles.map((role) => ({ ...role })),
    userFor,
    rolesForUser,
    subjectFor,
    subjectForUser,
    rightsForDocument,
    actionForDocument,
    synced: () => syncedAt != null,
    stats,
    reset,
  };
}
