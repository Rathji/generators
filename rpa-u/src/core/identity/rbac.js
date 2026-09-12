export const ENTRA_DEFAULT_AUTHORITY = "https://login.microsoftonline.com";

export const RBAC_ROLES = {
  administrator: {
    id: "administrator",
    label: "Administrator",
    rank: 5,
    readOnly: false,
    description: "Full control of the hub, including identity configuration, settings and every connector action.",
    entraHint: "RPAU.Administrator",
  },
  integration_manager: {
    id: "integration_manager",
    label: "Integration Manager",
    rank: 4,
    readOnly: false,
    description: "Owns the integration registry, sync rules and conflict resolution, and may export hub configuration.",
    entraHint: "RPAU.IntegrationManager",
  },
  operator: {
    id: "operator",
    label: "Operator",
    rank: 3,
    readOnly: false,
    description: "Runs day-to-day automation: connects to OpenFlow, triggers workflows and works queues and tickets.",
    entraHint: "RPAU.Operator",
  },
  auditor: {
    id: "auditor",
    label: "Auditor",
    rank: 2,
    readOnly: true,
    description: "Read-only oversight of connector health, sync drift and the audit trail. Cannot change anything.",
    entraHint: "RPAU.Auditor",
  },
  viewer: {
    id: "viewer",
    label: "Viewer",
    rank: 1,
    readOnly: true,
    description: "Read-only access to the directory and dashboards. No mutation controls are available.",
    entraHint: "RPAU.Viewer",
  },
};

export const RBAC_ROLE_ORDER = ["administrator", "integration_manager", "operator", "auditor", "viewer"];

export const ROLE_IDS = {
  administrator: "administrator",
  admin: "administrator",
  "integration manager": "integration_manager",
  integration_manager: "integration_manager",
  integrationmanager: "integration_manager",
  manager: "integration_manager",
  operator: "operator",
  auditor: "auditor",
  viewer: "viewer",
  reader: "viewer",
};

export const DEFAULT_ROLE_ID = "viewer";

export const RBAC_RESOURCES = [
  { id: "registry", label: "Integration registry", group: "Configuration", description: "Field ownership, authoritative sources and sync directions per connector." },
  { id: "settings", label: "Hub settings", group: "Configuration", description: "Deployment configuration, storage and branding controls." },
  { id: "sync", label: "Sync rules & jobs", group: "Operations", description: "The idempotent job queue, reconciliation and drift remediation." },
  { id: "conflicts", label: "Conflict resolution", group: "Operations", description: "Ownership-driven settlement of competing writes." },
  { id: "events", label: "Event bus", group: "Operations", description: "Publishing and subscribing to versioned event topics." },
  { id: "links", label: "Entity links", group: "Operations", description: "The cross-tool link graph between canonical records." },
  { id: "monitor", label: "Connector monitoring", group: "Operations", description: "Health probes, heartbeats, latency and the error ledger." },
  { id: "openrpa", label: "OpenRPA / OpenFlow", group: "Automation", description: "The RPA connector: connection profiles, documents, queues, robots and workflow invocation." },
  { id: "identity", label: "Canonical identity", group: "Data", description: "The canonical company, customer, device, ticket and invoice directory." },
  { id: "bundles", label: "Data bundles", group: "Data", description: "Exporting and publishing redacted directory snapshots and hub configuration." },
  { id: "audit", label: "Audit log", group: "Governance", description: "The hash-chained audit ledger and its verification." },
  { id: "access", label: "Identity & access", group: "Governance", description: "Roles, the permission matrix and identity diagnostics." },
];

export const RBAC_ACTIONS = [
  { id: "view", label: "View", description: "Open the resource and read its data." },
  { id: "write", label: "Create & edit", description: "Create, modify or delete records in the resource." },
  { id: "run", label: "Run & trigger", description: "Execute work: sync jobs, workflow invocation, automation." },
  { id: "publish", label: "Publish & export", description: "Publish or export data out of the hub." },
  { id: "manage", label: "Manage & configure", description: "Change configuration, policy or connections." },
];

const MATRIX = [
  { resource: "registry", action: "view", minRole: "viewer", label: "View the registry", description: "Read field ownership, authoritative sources and sync directions." },
  { resource: "registry", action: "write", minRole: "integration_manager", label: "Edit the registry", description: "Add, change or remove field-ownership declarations." },
  { resource: "registry", action: "manage", minRole: "administrator", label: "Manage registry policy", description: "Change registry-wide validation and policy settings." },

  { resource: "settings", action: "view", minRole: "viewer", label: "View settings", description: "Read the deployment configuration." },
  { resource: "settings", action: "manage", minRole: "administrator", label: "Manage settings", description: "Change deployment configuration." },

  { resource: "sync", action: "view", minRole: "viewer", label: "View sync work", description: "Read the job queue, reconciliation findings and drift." },
  { resource: "sync", action: "run", minRole: "operator", label: "Run sync jobs", description: "Enqueue, execute, retry and cancel sync work." },
  { resource: "sync", action: "write", minRole: "integration_manager", label: "Change sync rules", description: "Dismiss findings and change reconciliation policy." },

  { resource: "conflicts", action: "view", minRole: "viewer", label: "View conflicts", description: "Read settlement rules and conflict history." },
  { resource: "conflicts", action: "resolve", minRole: "integration_manager", label: "Resolve conflicts", description: "Approve, reject or undo a conflict settlement." },

  { resource: "events", action: "view", minRole: "viewer", label: "View the event bus", description: "Read the event stream and topic catalogue." },
  { resource: "events", action: "run", minRole: "operator", label: "Publish events", description: "Publish a validated event envelope onto the bus." },
  { resource: "events", action: "manage", minRole: "integration_manager", label: "Manage subscriptions", description: "Register or remove persisted topic subscriptions." },

  { resource: "links", action: "view", minRole: "viewer", label: "View links", description: "Read the link graph and unresolved references." },
  { resource: "links", action: "write", minRole: "operator", label: "Edit links", description: "Resolve, create or remove entity links." },

  { resource: "monitor", action: "view", minRole: "viewer", label: "View monitoring", description: "Read connector health, latency and the error ledger." },
  { resource: "monitor", action: "manage", minRole: "integration_manager", label: "Manage monitoring", description: "Heartbeat connectors and inject or clear outages." },

  { resource: "openrpa", action: "view", minRole: "viewer", label: "View OpenRPA", description: "Read OpenFlow documents, queues, robots and invocations." },
  { resource: "openrpa", action: "run", minRole: "operator", label: "Run OpenRPA", description: "Connect to OpenFlow, trigger workflows and work queues." },
  { resource: "openrpa", action: "write", minRole: "integration_manager", label: "Write OpenRPA data", description: "Create and edit OpenFlow documents, queues, files and links." },
  { resource: "openrpa", action: "manage", minRole: "integration_manager", label: "Manage OpenRPA", description: "Create connection profiles and manage Node-RED instances." },

  { resource: "identity", action: "view", minRole: "viewer", label: "View the directory", description: "Read canonical records and search across connectors." },
  { resource: "identity", action: "write", minRole: "operator", label: "Edit the directory", description: "Create or update canonical records." },
  { resource: "identity", action: "merge", minRole: "integration_manager", label: "Merge identities", description: "Merge duplicate canonical records." },

  { resource: "bundles", action: "view", minRole: "viewer", label: "View bundles", description: "Read bundle previews and published history." },
  { resource: "bundles", action: "publish", minRole: "integration_manager", label: "Export & publish bundles", description: "Build, export or publish a hub data bundle." },

  { resource: "audit", action: "view", minRole: "auditor", label: "View the audit log", description: "Read entries and verify the hash chain." },
  { resource: "audit", action: "write", minRole: "integration_manager", label: "Record audit notes", description: "Append a manual note to the audit ledger." },

  { resource: "access", action: "view", minRole: "viewer", label: "View identity & access", description: "Read roles, the permission matrix and diagnostics." },
  { resource: "access", action: "manage", minRole: "administrator", label: "Manage identity & access", description: "Inspect raw claims and change identity-mapping guidance." },
];

export const RBAC_PERMISSIONS = MATRIX.map((entry) => ({ ...entry, key: `${entry.resource}.${entry.action}` }));
export const PERMISSION_MAP = new Map(RBAC_PERMISSIONS.map((entry) => [entry.key, entry]));
export const MUTATION_KEYS = RBAC_PERMISSIONS.filter((entry) => entry.action !== "view").map((entry) => entry.key);

export function roleIdOf(value) {
  if (!value) return null;
  if (RBAC_ROLES[value]) return value;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (RBAC_ROLES[normalized]) return normalized;
  return ROLE_IDS[String(value).trim().toLowerCase().replace(/[\s_-]+/g, " ")] || null;
}

export function knownRole(id) {
  return !!RBAC_ROLES[id];
}

export function roleRank(id) {
  const role = RBAC_ROLES[id];
  return role ? role.rank : 0;
}

export function roleLabel(id) {
  return RBAC_ROLES[id] ? RBAC_ROLES[id].label : id || "Unknown role";
}

export function highestRole(roleIds) {
  let best = null;
  for (const id of roleIds || []) {
    if (!knownRole(id)) continue;
    if (!best || roleRank(id) > roleRank(best)) best = id;
  }
  return best;
}

export function isAdministrator(roleIds) {
  return (roleIds || []).includes("administrator");
}

export function readOnly(roleIds) {
  const known = (roleIds || []).filter(knownRole);
  if (!known.length) return true;
  return known.every((id) => RBAC_ROLES[id].readOnly);
}

export function minRoleFor(key) {
  const entry = PERMISSION_MAP.get(key);
  return entry ? entry.minRole : null;
}

export function permissionExists(key) {
  return PERMISSION_MAP.has(key);
}

export function can(roleIds, key) {
  const entry = PERMISSION_MAP.get(key);
  if (!entry) return false;
  if (isAdministrator(roleIds)) return true;
  const need = roleRank(entry.minRole);
  return (roleIds || []).some((id) => knownRole(id) && roleRank(id) >= need);
}

export function check(roleIds, key) {
  const entry = PERMISSION_MAP.get(key) || null;
  const allowed = can(roleIds, key);
  let reason;
  if (!entry) reason = `“${key}” is not a recognised permission.`;
  else if (allowed) reason = `Allowed by ${describeRoles(roleIds)}.`;
  else reason = `${entry.minRole === "administrator" ? "Administrator" : roleLabel(entry.minRole)} role or higher is required.`;
  return {
    allowed,
    key,
    permission: entry,
    label: entry ? entry.label : key,
    resource: entry ? entry.resource : null,
    action: entry ? entry.action : null,
    requiredRole: entry ? entry.minRole : "administrator",
    requiredLabel: entry ? roleLabel(entry.minRole) : "Administrator",
    roles: (roleIds || []).slice(),
    reason,
  };
}

function describeRoles(roleIds) {
  const known = (roleIds || []).filter(knownRole);
  if (!known.length) return "no role";
  return known.map(roleLabel).join(", ");
}

export function permissionsFor(roleIds) {
  return RBAC_PERMISSIONS.filter((entry) => can(roleIds, entry.key)).map((entry) => entry.key);
}

export function matrixFor(roleIds) {
  return RBAC_PERMISSIONS.map((entry) => ({ ...entry, allowed: can(roleIds, entry.key), requiredLabel: roleLabel(entry.minRole) }));
}

export function matrixRows() {
  return RBAC_RESOURCES.map((resource) => ({
    ...resource,
    actions: RBAC_ACTIONS.filter((action) => PERMISSION_MAP.has(`${resource.id}.${action.id}`)).map((action) => ({
      action: action.id,
      label: action.label,
      key: `${resource.id}.${action.id}`,
      minRole: PERMISSION_MAP.get(`${resource.id}.${action.id}`).minRole,
      requiredLabel: roleLabel(PERMISSION_MAP.get(`${resource.id}.${action.id}`).minRole),
      description: PERMISSION_MAP.get(`${resource.id}.${action.id}`).description,
    })),
  }));
}

export function resourceFor(key) {
  const [resource] = String(key || "").split(".");
  return RBAC_RESOURCES.find((entry) => entry.id === resource) || null;
}

export function describe(key) {
  const entry = PERMISSION_MAP.get(key);
  return entry ? entry.label : key;
}

export function validateMatrix() {
  const issues = [];
  const add = (level, code, message, ref) => issues.push({ level, code, message, ref });
  const resources = new Set(RBAC_RESOURCES.map((entry) => entry.id));
  const actions = new Set(RBAC_ACTIONS.map((entry) => entry.id));
  const seen = new Set();
  for (const entry of RBAC_PERMISSIONS) {
    if (!resources.has(entry.resource)) add("error", "unknown-resource", `Permission “${entry.key}” uses unknown resource “${entry.resource}”.`, entry.key);
    if (!actions.has(entry.action)) add("error", "unknown-action", `Permission “${entry.key}” uses unknown action “${entry.action}”.`, entry.key);
    if (!knownRole(entry.minRole)) add("error", "unknown-role", `Permission “${entry.key}” requires unknown role “${entry.minRole}”.`, entry.key);
    if (seen.has(entry.key)) add("error", "duplicate", `Permission “${entry.key}” is declared twice.`, entry.key);
    seen.add(entry.key);
  }
  for (const role of RBAC_ROLE_ORDER) if (!RBAC_ROLES[role]) add("error", "missing-role", `Role “${role}” is listed but not declared.`, role);
  const counts = { error: 0, warn: 0, info: 0 };
  for (const issue of issues) counts[issue.level] = (counts[issue.level] || 0) + 1;
  return { ok: counts.error === 0, issues, counts };
}

export function stats() {
  return {
    roleCount: Object.keys(RBAC_ROLES).length,
    resourceCount: RBAC_RESOURCES.length,
    actionCount: RBAC_ACTIONS.length,
    permissionCount: RBAC_PERMISSIONS.length,
    mutationCount: MUTATION_KEYS.length,
    readOnlyRoles: RBAC_ROLE_ORDER.filter((id) => RBAC_ROLES[id].readOnly),
  };
}
