import { CONNECTORS, ENTITY_TYPES, FIELD_MODEL, DIRECTIONS } from "./catalog.js";

const DIRECTION_IDS = DIRECTIONS.map((d) => d.id);

export function createRegistry({ connectors = CONNECTORS, entityTypes = ENTITY_TYPES, fieldModel = FIELD_MODEL } = {}) {
  const connectorById = new Map(connectors.map((c) => [c.id, c]));
  const typeById = new Map(entityTypes.map((t) => [t.id, t]));
  const fieldsByType = new Map();

  for (const type of entityTypes) {
    const list = (fieldModel[type.id] || []).map((field) => ({
      direction: "push",
      authoritative: true,
      computed: false,
      sensitive: false,
      ...field,
    }));
    fieldsByType.set(type.id, list);
  }

  function fieldsFor(typeId) {
    return (fieldsByType.get(typeId) || []).map((f) => ({ ...f }));
  }

  function field(typeId, key) {
    return fieldsByType.get(typeId)?.find((f) => f.key === key) || null;
  }

  function owner(typeId, key) {
    return field(typeId, key)?.owner || null;
  }

  function directionOf(typeId, key) {
    return field(typeId, key)?.direction || null;
  }

  function isAuthoritative(typeId, key) {
    return !!field(typeId, key)?.authoritative;
  }

  function connector(id) {
    return connectorById.get(id) || null;
  }

  function entityType(id) {
    return typeById.get(id) || null;
  }

  function connectorsFor(typeId) {
    return connectors.filter(
      (c) => c.entityTypes.includes(typeId) && c.id === connectorById.get(c.id)?.id
    );
  }

  function declares(connectorId, typeId) {
    const c = connectorById.get(connectorId);
    return !!c && c.entityTypes.includes(typeId);
  }

  function canWrite(connectorId, typeId, key) {
    const o = owner(typeId, key);
    return !!o && o === connectorId;
  }

  function writableFields(connectorId, typeId) {
    return fieldsFor(typeId).filter((f) => f.owner === connectorId);
  }

  function fieldsOwnedBy(connectorId) {
    const out = [];
    for (const type of entityTypes) {
      for (const f of fieldsByType.get(type.id) || []) {
        if (f.owner === connectorId) out.push({ entityType: type.id, ...f });
      }
    }
    return out;
  }

  function validate() {
    const issues = [];
    const add = (level, code, message, ref) => issues.push({ level, code, message, ref });

    for (const c of connectors) {
      if (!c.id || !c.name) add("error", "invalid-connector", "A connector is missing an id or name.", c.id);
      for (const typeId of c.entityTypes || []) {
        if (!typeById.has(typeId)) {
          add("error", "unknown-entity-type", `${c.name} declares unknown entity type "${typeId}".`, `${c.id}:${typeId}`);
        }
      }
    }

    for (const type of entityTypes) {
      const list = fieldsByType.get(type.id) || [];
      const seen = new Set();
      for (const f of list) {
        const ref = `${type.id}.${f.key}`;
        if (seen.has(f.key)) add("error", "duplicate-field", `Field "${ref}" is declared more than once.`, ref);
        seen.add(f.key);

        if (!connectorById.has(f.owner)) {
          add("error", "unknown-owner", `Field "${ref}" has unknown owner "${f.owner}".`, ref);
        } else if (!declares(f.owner, type.id)) {
          add("warn", "owner-scope-mismatch", `${connectorById.get(f.owner).name} owns "${ref}" but does not declare the ${type.label} entity type.`, ref);
        }

        if (!DIRECTION_IDS.includes(f.direction)) {
          add("error", "invalid-direction", `Field "${ref}" has invalid sync direction "${f.direction}".`, ref);
        } else if (f.direction === "none" && f.authoritative) {
          add("info", "unsynced-authoritative", `Field "${ref}" is marked authoritative but has no sync direction.`, ref);
        }
      }

      if (!list.length) add("warn", "empty-entity-type", `Entity type "${type.id}" has no fields declared.`, type.id);
    }

    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) counts[issue.level] = (counts[issue.level] || 0) + 1;
    return { ok: counts.error === 0, issues, counts };
  }

  function stats() {
    let fieldCount = 0;
    let authoritativeCount = 0;
    for (const type of entityTypes) {
      const list = fieldsByType.get(type.id) || [];
      fieldCount += list.length;
      authoritativeCount += list.filter((f) => f.authoritative).length;
    }
    return {
      connectorCount: connectors.length,
      entityTypeCount: entityTypes.length,
      fieldCount,
      authoritativeCount,
      directions: DIRECTION_IDS.length,
    };
  }

  return {
    connectors,
    entityTypes,
    directions: DIRECTIONS,
    connector,
    entityType,
    fieldsFor,
    field,
    owner,
    directionOf,
    isAuthoritative,
    connectorsFor,
    declares,
    canWrite,
    writableFields,
    fieldsOwnedBy,
    validate,
    stats,
  };
}
