import { CAPABILITIES, CANONICAL_ROLES, TOOL_ROLE_MAPS, CONNECTORS } from "./catalog.js";

export function createPermissions({ capabilities = CAPABILITIES, roles = CANONICAL_ROLES, roleMaps = TOOL_ROLE_MAPS, connectors = CONNECTORS } = {}) {
  const capabilityIds = new Set(capabilities.map((c) => c.id));
  const connectorIds = new Set(connectors.map((c) => c.id));
  const cache = new Map();

  function canonicalRolesFor(connectorId, toolRole) {
    const map = roleMaps[connectorId];
    if (!map) return [];
    const value = map[toolRole];
    if (!value) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function capabilitiesFor(roleIds) {
    const key = roleIds.join("|");
    if (cache.has(key)) return cache.get(key);
    const out = new Set();
    for (const roleId of roleIds) {
      const role = roles[roleId];
      if (!role) continue;
      for (const cap of role.capabilities) {
        if (cap === "*") for (const id of capabilityIds) out.add(id);
        else out.add(cap);
      }
    }
    cache.set(key, out);
    return out;
  }

  function rolesFor(subject) {
    if (!subject) return [];
    if (Array.isArray(subject.roles)) return subject.roles.slice();
    return canonicalRolesFor(subject.connector, subject.toolRole);
  }

  function hasCapability(subject, capability) {
    const caps = capabilitiesFor(rolesFor(subject));
    return caps.has(capability) || caps.has("*");
  }

  function hasAny(subject, list) {
    const caps = capabilitiesFor(rolesFor(subject));
    return list.some((c) => caps.has(c));
  }

  function hasAll(subject, list) {
    const caps = capabilitiesFor(rolesFor(subject));
    return list.every((c) => caps.has(c) || caps.has("*"));
  }

  function explain(subject, capability) {
    const roleIds = rolesFor(subject);
    const caps = capabilitiesFor(roleIds);
    const allowed = caps.has(capability) || caps.has("*");
    return { allowed, roles: roleIds, capabilities: Array.from(caps).sort() };
  }

  function toolRoles(connectorId) {
    return Object.keys(roleMaps[connectorId] || {});
  }

  function mappings() {
    const out = [];
    for (const [connectorId, map] of Object.entries(roleMaps)) {
      for (const [toolRole, value] of Object.entries(map)) {
        const roleIds = Array.isArray(value) ? value : [value];
        out.push({ connector: connectorId, toolRole, canonicalRoles: roleIds });
      }
    }
    return out;
  }

  function validate() {
    const issues = [];
    const add = (level, code, message, ref) => issues.push({ level, code, message, ref });

    for (const [connectorId, map] of Object.entries(roleMaps)) {
      if (!connectorIds.has(connectorId)) add("error", "unknown-connector", `Role map references unknown connector "${connectorId}".`, connectorId);
      for (const [toolRole, value] of Object.entries(map)) {
        const roleIds = Array.isArray(value) ? value : [value];
        if (!roleIds.length) add("error", "empty-mapping", `"${toolRole}" (${connectorId}) maps to no canonical role.`, `${connectorId}:${toolRole}`);
        for (const roleId of roleIds) {
          if (!roles[roleId]) add("error", "unknown-role", `"${toolRole}" (${connectorId}) maps to unknown role "${roleId}".`, `${connectorId}:${toolRole}`);
        }
      }
    }

    for (const [roleId, role] of Object.entries(roles)) {
      for (const cap of role.capabilities) {
        if (!capabilityIds.has(cap)) add("error", "unknown-capability", `Role "${roleId}" grants unknown capability "${cap}".`, roleId);
      }
      if (!role.capabilities.length) add("warn", "empty-role", `Role "${roleId}" grants no capabilities.`, roleId);
    }

    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) counts[issue.level] = (counts[issue.level] || 0) + 1;
    return { ok: counts.error === 0, issues, counts };
  }

  function stats() {
    const grantedRoles = new Set(Object.values(roleMaps).flatMap((m) => Object.values(m).flat()));
    return {
      roleCount: Object.keys(roles).length,
      capabilityCount: capabilities.filter((c) => !c.wildcard).length,
      mappingCount: mappings().length,
      mappedConnectors: Object.keys(roleMaps).length,
      unusedRoles: Object.keys(roles).filter((r) => !grantedRoles.has(r)),
    };
  }

  return {
    capabilities,
    roles,
    roleMaps,
    canonicalRolesFor,
    toolRoles,
    rolesFor,
    capabilitiesFor,
    hasCapability,
    hasAny,
    hasAll,
    explain,
    mappings,
    validate,
    stats,
  };
}
