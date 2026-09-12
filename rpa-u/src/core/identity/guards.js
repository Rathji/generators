import {
  can as rbacCan,
  check as rbacCheck,
  readOnly as rbacReadOnly,
  highestRole as rbacHighestRole,
  roleLabel,
  permissionsFor,
  matrixFor,
  PERMISSION_MAP,
  DEFAULT_ROLE_ID,
} from "./rbac.js";

export const ROUTE_PERMISSIONS = {
  home: null,
  identity: "identity.view",
  registry: "registry.view",
  permissions: "registry.view",
  links: "links.view",
  search: "identity.view",
  sync: "sync.view",
  reconcile: "sync.view",
  conflicts: "conflicts.view",
  drift: "monitor.view",
  bundles: "bundles.view",
  audit: "audit.view",
  monitor: "monitor.view",
  openrpa: "openrpa.view",
  "openrpa-data": "openrpa.view",
  "openrpa-work": "openrpa.view",
  "openrpa-automation": "openrpa.view",
  "openrpa-events": "openrpa.view",
  "openrpa-sync": "openrpa.view",
  "openrpa-bundles": "openrpa.view",
  "openrpa-guide": "openrpa.view",
  events: "events.view",
  access: "access.view",
  oversight: "audit.view",
  signin: null,
  tests: null,
  help: null,
};

export const DEFAULT_PUBLISH_PERMISSION = "events.run";
export const DEFAULT_SUBSCRIBE_PERMISSION = "events.manage";

export const EVENT_TOPIC_ACCESS = {
  identity: { publish: "identity.write", subscribe: "identity.view" },
  ticket: { publish: "events.run", subscribe: "events.view" },
  invoice: { publish: "events.run", subscribe: "events.view" },
  device: { publish: "events.run", subscribe: "events.view" },
  sync: { publish: "sync.run", subscribe: "sync.view" },
  conflict: { publish: "conflicts.resolve", subscribe: "conflicts.view" },
  drift: { publish: "sync.run", subscribe: "monitor.view" },
  alert: { publish: "monitor.manage", subscribe: "monitor.view" },
  subscription: { publish: "events.manage", subscribe: "events.view" },
  connector: { publish: "monitor.manage", subscribe: "monitor.view" },
  monitor: { publish: "monitor.manage", subscribe: "monitor.view" },
  bundle: { publish: "bundles.publish", subscribe: "bundles.view" },
  audit: { publish: "audit.write", subscribe: "audit.view" },
  workflow: { publish: "openrpa.run", subscribe: "openrpa.view" },
  workitem: { publish: "openrpa.run", subscribe: "openrpa.view" },
  robot: { publish: "openrpa.manage", subscribe: "openrpa.view" },
  collection: { publish: "openrpa.write", subscribe: "openrpa.view" },
  openrpa: { publish: "openrpa.run", subscribe: "openrpa.view" },
};

export const OPENRPA_GUARDS = [
  ["invocation.invoke", "openrpa.run"],
  ["invocation.cancel", "openrpa.run"],
  ["workitems.enqueue", "openrpa.run"],
  ["workitems.enqueueMany", "openrpa.run"],
  ["workitems.claim", "openrpa.run"],
  ["workitems.claimMany", "openrpa.run"],
  ["workitems.complete", "openrpa.run"],
  ["workitems.setState", "openrpa.run"],
  ["workitems.retry", "openrpa.run"],
  ["workitems.requeue", "openrpa.run"],
  ["workitems.cancel", "openrpa.run"],
  ["workitems.updateItem", "openrpa.write"],
  ["workitems.deleteItem", "openrpa.write"],
  ["workitems.deleteMany", "openrpa.write"],
  ["workitems.createQueue", "openrpa.write"],
  ["workitems.updateQueue", "openrpa.write"],
  ["workitems.deleteQueue", "openrpa.write"],
  ["workitems.purgeQueue", "openrpa.write"],
  ["documents.insert", "openrpa.write"],
  ["documents.insertMany", "openrpa.write"],
  ["documents.upsert", "openrpa.write"],
  ["documents.update", "openrpa.write"],
  ["documents.remove", "openrpa.write"],
  ["documents.removeMany", "openrpa.write"],
  ["files.upload", "openrpa.write"],
  ["files.remove", "openrpa.write"],
  ["files.removeMany", "openrpa.write"],
  ["files.attachToWorkItem", "openrpa.write"],
  ["profiles.create", "openrpa.manage"],
  ["profiles.update", "openrpa.manage"],
  ["profiles.remove", "openrpa.manage"],
  ["profiles.setActive", "openrpa.manage"],
  ["nodered.ensure", "openrpa.manage"],
  ["nodered.restart", "openrpa.manage"],
  ["nodered.remove", "openrpa.manage"],
  ["nodered.link", "openrpa.manage"],
  ["nodered.unlink", "openrpa.manage"],
  ["linking.link", "links.write"],
  ["linking.unlink", "links.write"],
  ["linking.autolink", "links.write"],
  ["sync.apply", "sync.run"],
  ["sync.reconcile", "sync.run"],
  ["conflicts.approve", "conflicts.resolve"],
  ["conflicts.reject", "conflicts.resolve"],
  ["conflicts.undo", "conflicts.resolve"],
  ["bundles.build", "bundles.publish"],
  ["bundles.export", "bundles.publish"],
  ["bundles.import", "bundles.publish"],
  ["connect", "openrpa.manage"],
  ["disconnect", "openrpa.manage"],
  ["signIn", "openrpa.manage"],
  ["signOut", "openrpa.manage"],
];

export const HUB_GUARDS = [
  ["publish", "events.run"],
  ["ingest", "identity.write"],
  ["merge", "identity.merge"],
  ["seed", "identity.write"],
  ["resetData", "settings.manage"],
  ["bundles.publish", "bundles.publish"],
  ["identity.merge", "identity.merge"],
  ["conflicts.resolve", "conflicts.resolve"],
  ["conflicts.resolveAll", "conflicts.resolve"],
  ["jobs.enqueue", "sync.run"],
  ["jobs.execute", "sync.run"],
  ["jobs.executeAll", "sync.run"],
  ["jobs.retry", "sync.run"],
  ["jobs.cancel", "sync.run"],
  ["jobs.remove", "sync.run"],
  ["monitor.heartbeat", "monitor.manage"],
  ["monitor.injectIncident", "monitor.manage"],
  ["monitor.clearIncident", "monitor.manage"],
  ["monitor.start", "monitor.manage"],
  ["monitor.stop", "monitor.manage"],
  ["reconciler.dismiss", "sync.write"],
  ["reconciler.restore", "sync.write"],
  ["reconciler.resolve", "sync.write"],
  ["subscriptions.register", "events.manage"],
  ["subscriptions.unregister", "events.manage"],
  ["audit.note", "audit.write"],
];

export function routePermission(routeId) {
  return Object.prototype.hasOwnProperty.call(ROUTE_PERMISSIONS, routeId) ? ROUTE_PERMISSIONS[routeId] : null;
}

export function topicPermission(topic, action = "publish") {
  const base = String(topic || "").split(".")[0];
  const entry = EVENT_TOPIC_ACCESS[base];
  if (entry && entry[action]) return entry[action];
  return action === "subscribe" ? DEFAULT_SUBSCRIBE_PERMISSION : DEFAULT_PUBLISH_PERMISSION;
}

export function resolvePath(root, path) {
  const parts = String(path).split(".");
  let owner = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!owner || typeof owner !== "object") return null;
    owner = owner[parts[i]];
  }
  if (!owner || typeof owner !== "object") return null;
  const key = parts[parts.length - 1];
  if (typeof owner[key] !== "function") return null;
  return { owner, key };
}

const DENIED = Symbol("access-denied");

export function createAccessControl({ session = null, onDenied = null, defaultRole = DEFAULT_ROLE_ID } = {}) {
  function enabled() {
    return !!(session && session.enabled());
  }

  function snapshot() {
    return session ? session.snapshot() : null;
  }

  function roles() {
    if (!enabled()) return null;
    const snap = snapshot();
    if (snap.authenticated) return snap.roles.slice();
    if (!snap.requireSignIn) return [snap.config ? snap.config.defaultRole : defaultRole].filter(Boolean);
    return [];
  }

  function can(key) {
    const list = roles();
    if (list === null) return true;
    if (!key) return true;
    return rbacCan(list, key);
  }

  function check(key) {
    const list = roles();
    if (list === null) {
      return { allowed: true, key, roles: [], unrestricted: true, reason: "Access control is disabled.", requiredRole: null };
    }
    return rbacCheck(list, key);
  }

  function readOnly() {
    if (!enabled()) return false;
    const list = roles();
    if (list === null) return false;
    const snap = snapshot();
    if (!snap.authenticated && !snap.requireSignIn) return rbacReadOnly(list);
    return rbacReadOnly(list);
  }

  function highestRole() {
    const list = roles();
    return list === null ? null : rbacHighestRole(list);
  }

  function permissionList() {
    const list = roles();
    if (list === null) return matrixFor([]).map((entry) => entry.key);
    return permissionsFor(list);
  }

  function canRoute(routeId) {
    return can(routePermission(routeId));
  }

  function denialFor(key) {
    const result = check(key);
    const permission = PERMISSION_MAP.get(key) || null;
    return {
      ok: false,
      allowed: false,
      code: "forbidden",
      key,
      permission,
      requiredRole: permission ? permission.minRole : "administrator",
      requiredLabel: permission ? roleLabel(permission.minRole) : "Administrator",
      message: permission
        ? `Your role does not permit “${permission.label}”. ${result.reason}`
        : `“${key}” is not a recognised permission.`,
    };
  }

  function notifyDenied(key, context = {}) {
    const denial = denialFor(key);
    if (typeof onDenied === "function") {
      try {
        onDenied(denial, context);
      } catch (error) {}
    }
    return denial;
  }

  function guardFn(fn, permission, { sync = null, context = null } = {}) {
    if (!permission) return fn;
    const isAsync = sync === false || (sync === null && fn.constructor && fn.constructor.name === "AsyncFunction");
    if (!enabled()) return fn;
    if (isAsync) {
      return async function guarded(...args) {
        if (!can(permission)) return denialFor(permission);
        return fn.apply(this, args);
      };
    }
    return function guarded(...args) {
      if (!can(permission)) return denialFor(permission);
      return fn.apply(this, args);
    };
  }

  function wrapMethod(target, key, permission, options = {}) {
    if (!target || typeof target[key] !== "function") return false;
    if (target[key][DENIED]) return true;
    const original = target[key];
    const wrapped = guardFn(original, permission, options);
    if (wrapped === original) return false;
    try {
      Object.defineProperty(wrapped, DENIED, { value: true });
    } catch (error) {}
    target[key] = wrapped;
    return true;
  }

  function applyTable(root, table) {
    let count = 0;
    for (const [path, permission] of table) {
      const parts = String(path).split(".");
      const leaf = parts.pop();
      let owner = root;
      let ok = true;
      for (const part of parts) {
        if (!owner || typeof owner !== "object") {
          ok = false;
          break;
        }
        owner = owner[part];
      }
      if (!ok || !owner) continue;
      if (wrapMethod(owner, leaf, permission)) count += 1;
    }
    return count;
  }

  function applyHub(hub) {
    if (!enabled()) return { wrapped: 0, skipped: true };
    let wrapped = 0;
    if (hub.openrpa) wrapped += applyTable(hub.openrpa, OPENRPA_GUARDS);
    wrapped += applyTable(hub, HUB_GUARDS);
    return { wrapped, skipped: false };
  }

  function applyElement(node) {
    if (!node || node.nodeType !== 1) return;
    const permission = node.getAttribute("data-permission");
    const mode = node.getAttribute("data-permission-mode") || "disable";
    const mutating = node.hasAttribute("data-mutating");
    if (permission && !can(permission)) {
      if (mode === "hide") {
        node.hidden = true;
        return;
      }
      node.disabled = true;
      node.setAttribute("aria-disabled", "true");
      node.classList.add("pu-denied");
      const info = PERMISSION_MAP.get(permission);
      if (!node.getAttribute("title")) node.setAttribute("title", info ? `Requires ${roleLabel(info.minRole)} — ${info.label}` : "Not permitted for your role");
      return;
    }
    if (mutating && readOnly() && node.tagName === "BUTTON") {
      node.disabled = true;
      node.setAttribute("aria-disabled", "true");
      node.classList.add("pu-denied");
      if (!node.getAttribute("title")) node.setAttribute("title", "Read-only role — mutation controls are disabled");
    }
  }

  function applyDom(root = document) {
    if (!enabled() || !root || typeof root.querySelectorAll !== "function") return 0;
    const nodes = root.querySelectorAll("[data-permission], [data-mutating]");
    for (const node of nodes) applyElement(node);
    return nodes.length;
  }

  function describeDenied(denial) {
    if (!denial) return "";
    return denial.message || "You are not authorised to perform this action.";
  }

  return {
    enabled,
    roles,
    can,
    check,
    readOnly,
    highestRole,
    permissions: permissionList,
    routePermission,
    canRoute,
    topicPermission,
    denialFor,
    notifyDenied,
    describeDenied,
    wrapMethod,
    applyTable,
    applyHub,
    applyElement,
    applyDom,
    snapshot,
  };
}
