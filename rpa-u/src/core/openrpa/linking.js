import { hash36, tokenSimilarity } from "../ids.js";
import { OPENRPA_LINKS_COLLECTION } from "./constants.js";

export const OPENRPA_TARGET_TYPES = [
  { id: "workitem", label: "Work item", plural: "Work items", collection: "openrpa_workitem", field: "automationStatus" },
  { id: "queue", label: "Work-item queue", plural: "Queues", collection: "openrpa_queue", field: "automationQueue" },
  { id: "workflow", label: "Workflow", plural: "Workflows", collection: "workflows", field: "automationWorkflow" },
  { id: "robot", label: "Robot", plural: "Robots", collection: "openrpa_robot", field: null },
  { id: "invocation", label: "Invocation", plural: "Invocations", collection: null, field: null },
  { id: "nodered", label: "Node-RED instance", plural: "Node-RED instances", collection: "nodered", field: null },
];

export const OPENRPA_TARGET_TYPE_IDS = OPENRPA_TARGET_TYPES.map((entry) => entry.id);
export const OPENRPA_LINK_ORIGINS = ["auto", "manual"];

export const OPENRPA_PAYLOAD_REFERENCES = [
  { key: "companyId", entityType: "company" },
  { key: "customerId", entityType: "customer" },
  { key: "deviceId", entityType: "device" },
  { key: "ticketId", entityType: "ticket" },
  { key: "invoiceId", entityType: "invoice" },
  { key: "hostname", entityType: "device", field: "hostname" },
];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function toRemote(target) {
  if (!target) return null;
  return {
    id: target.id,
    type: target.type,
    version: target.version == null ? null : Number(target.version),
    modified: target.modified || null,
    values: target.values || {},
    payloadValue: (key) => {
      const payload = target.payload && typeof target.payload === "object" ? target.payload : null;
      return payload && payload[key] != null ? payload[key] : null;
    },
  };
}

export function createOpenRpaLinker({
  identity = null,
  db = null,
  collection = OPENRPA_LINKS_COLLECTION,
  documents = null,
  workitems = null,
  robots = null,
  nodered = null,
  invocation = null,
  clock = () => Date.now(),
} = {}) {
  const edges = new Map();
  const typeById = new Map(OPENRPA_TARGET_TYPES.map((entry) => [entry.id, entry]));
  let targetIndex = new Map();
  let targetList = [];
  const counters = { refreshes: 0, errors: 0 };
  let lastRefreshedAt = null;
  let lastError = null;

  const iso = () => new Date(clock()).toISOString();
  const keyOf = (targetType, targetId) => `${targetType}:${targetId}`;

  function edgeId(entityType, entityId, targetType, targetId) {
    return `ol_${hash36(`${entityType}:${entityId}|${targetType}:${targetId}`)}`;
  }

  function payloadReferences(payload) {
    const refs = [];
    if (!payload || typeof payload !== "object") return refs;
    const explicitType = clean(payload.entityType || payload.entitytype);
    const explicitId = clean(payload.entityId || payload.entityid);
    if (explicitType && explicitId) refs.push({ entityType: explicitType, value: explicitId, field: null, explicit: true });
    for (const spec of OPENRPA_PAYLOAD_REFERENCES) {
      const value = clean(payload[spec.key]);
      if (!value) continue;
      refs.push({ entityType: spec.entityType, value, field: spec.field || null, explicit: false });
    }
    return refs;
  }

  function resolveEntity(ref, companyDocs) {
    if (!identity) return null;
    const direct = identity.get(ref.entityType, ref.value);
    if (direct) return direct;
    if (ref.entityType === "company" && companyDocs) {
      const doc = companyDocs.get(ref.value);
      if (doc) {
        for (const token of [doc.values && doc.values.domain, (doc.values && doc.values.name) || doc.name].filter(Boolean)) {
          const found = identity.search(token, { type: "company" });
          if (found.length) return found[0];
        }
      }
    }
    const found = identity.search(ref.value, { type: ref.entityType });
    return found.length ? found[0] : null;
  }

  async function companyDocIndex() {
    const map = new Map();
    if (!documents) return map;
    try {
      const docs = await documents.query("companies", {});
      if (Array.isArray(docs)) for (const doc of docs) map.set(doc.id, doc);
    } catch (error) {
      return map;
    }
    return map;
  }

  function target(targetType, targetId) {
    return targetIndex.get(keyOf(targetType, String(targetId))) || null;
  }

  function remoteFor(targetType, targetId) {
    return toRemote(target(targetType, targetId));
  }

  function push(type, id, patch = {}) {
    if (!id) return;
    const record = { type, id: String(id), name: patch.name || String(id), version: patch.version == null ? null : Number(patch.version), modified: patch.modified || null, values: patch.values || {}, payload: patch.payload || null };
    targetList.push(record);
  }

  async function refreshTargets() {
    try {
      targetList = [];
      if (documents) {
        const workflows = await documents.query("workflows", {});
        if (Array.isArray(workflows)) {
          for (const doc of workflows) push("workflow", doc.id, { name: doc.name || (doc.values && doc.values.filename) || doc.id, version: doc.version, modified: doc.modified, values: doc.values || {} });
        }
        const nrDocs = await documents.query("nodered", {});
        if (Array.isArray(nrDocs)) {
          for (const doc of nrDocs) push("nodered", doc.id, { name: doc.name || (doc.values && doc.values.instance) || doc.id, version: doc.version, modified: doc.modified, values: doc.values || {} });
        }
      }
      if (workitems) {
        const queues = await workitems.listQueues();
        if (queues && queues.ok) {
          for (const queue of queues.queues) push("queue", queue.id, { name: queue.name || queue.id, values: { workflowid: queue.workflowId || null } });
        }
        const board = await workitems.board({ pageSize: 500 });
        if (board && board.ok) {
          for (const item of board.items) {
            push("workitem", item.id, { name: item.id, version: item.version, modified: item.modified, values: { state: item.state, wiqid: item.queueId, wiq: item.queue, lastrun: item.lastRun }, payload: item.payload });
          }
        }
      }
      if (robots) {
        const list = await robots.list();
        if (list && list.ok) {
          for (const robot of list.robots) push("robot", robot.id, { name: robot.name, version: robot.version, modified: robot.lastseen, values: { presence: robot.presence, lastseen: robot.lastseen } });
        }
      }
      if (nodered) {
        const list = await nodered.list();
        if (list && list.ok) {
          for (const instance of list.instances) push("nodered", instance.id, { name: instance.name || instance.id, values: { state: instance.state } });
        }
      }
      if (invocation) {
        const history = invocation.history({ limit: 200 });
        if (Array.isArray(history)) {
          for (const record of history) push("invocation", record.correlationId, { name: record.correlationId, values: { state: record.state, workflowId: record.workflowId || null } });
        }
      }
      const companyDocs = await companyDocIndex();
      for (const record of targetList) {
        if (record.type !== "workitem") continue;
        record.references = payloadReferences(record.payload).map((ref) => {
          const entity = resolveEntity(ref, companyDocs);
          return { entityType: ref.entityType, value: ref.value, field: ref.field, entityId: entity ? entity.id : null, entityName: entity && identity ? identity.nameOf(ref.entityType, entity) : null };
        });
      }
      const index = new Map();
      for (const record of targetList) index.set(keyOf(record.type, record.id), record);
      targetIndex = index;
      counters.refreshes += 1;
      lastRefreshedAt = iso();
      lastError = null;
      return { ok: true, targets: targetList.length, refreshedAt: lastRefreshedAt };
    } catch (error) {
      counters.errors += 1;
      lastError = error && error.message ? error.message : String(error);
      return { ok: false, error: lastError, targets: targetList.length };
    }
  }

  function targets({ targetType = null } = {}) {
    const list = targetType ? targetList.filter((entry) => entry.type === targetType) : targetList;
    return list.map((entry) => ({ type: entry.type, id: entry.id, name: entry.name, version: entry.version, modified: entry.modified }));
  }

  function decorate(edge) {
    const type = typeById.get(edge.targetType);
    const resolved = target(edge.targetType, edge.targetId);
    const entity = identity ? identity.get(edge.entityType, edge.entityId) : null;
    return {
      ...edge,
      targetLabel: type ? type.label : edge.targetType,
      targetCollection: type ? type.collection : null,
      entityName: entity ? identity.nameOf(edge.entityType, entity) : edge.entityId,
      resolved: !!resolved,
      missing: !resolved,
      targetName: edge.targetName || (resolved ? resolved.name : edge.targetId),
      targetVersion: resolved ? resolved.version : null,
      targetModified: resolved ? resolved.modified : null,
    };
  }

  async function link(input = {}) {
    const { entityType, entityId, targetType, targetId, targetName = null, origin = "manual", confidence = 1, field = null, note = "" } = input;
    if (!entityType || !entityId) return { ok: false, error: "A hub entity type and id are required." };
    if (!typeById.has(targetType)) return { ok: false, error: `Unknown OpenRPA target type "${targetType}".` };
    if (!targetId) return { ok: false, error: "A target id is required." };
    const entity = identity ? identity.get(entityType, entityId) : null;
    if (identity && !entity) return { ok: false, error: `Unknown ${entityType} "${entityId}".` };
    const resolved = target(targetType, targetId);
    const id = edgeId(entityType, entityId, targetType, targetId);
    const existing = edges.get(id);
    const now = iso();
    const record = {
      id,
      entityType,
      entityId,
      entityName: entity ? identity.nameOf(entityType, entity) : null,
      targetType,
      targetId: String(targetId),
      targetName: targetName || (resolved ? resolved.name : String(targetId)),
      origin: OPENRPA_LINK_ORIGINS.includes(origin) ? origin : "manual",
      confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : 1,
      field,
      note,
      resolved: !!resolved,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };
    edges.set(id, record);
    if (db) await db.put(collection, id, record);
    return { ok: true, created: !existing, link: record };
  }

  async function unlink(id) {
    const edge = edges.get(id);
    if (!edge) return { ok: false, error: `No link with id "${id}".` };
    edges.delete(id);
    if (db) await db.remove(collection, id);
    return { ok: true, removed: edge };
  }

  async function unlinkWhere(predicate) {
    const ids = Array.from(edges.values())
      .filter(predicate)
      .map((edge) => edge.id);
    for (const id of ids) await unlink(id);
    return { ok: true, removed: ids.length, ids };
  }

  function unlinkEntity(entityType, entityId) {
    return unlinkWhere((edge) => edge.entityType === entityType && edge.entityId === entityId);
  }

  function unlinkTarget(targetType, targetId) {
    return unlinkWhere((edge) => edge.targetType === targetType && edge.targetId === String(targetId));
  }

  function all() {
    return Array.from(edges.values());
  }

  function get(id) {
    return edges.get(id) || null;
  }

  function linksFor(entityType, entityId) {
    return all().filter((edge) => edge.entityType === entityType && edge.entityId === entityId);
  }

  function forTarget(targetType, targetId) {
    return all().filter((edge) => edge.targetType === targetType && edge.targetId === String(targetId));
  }

  function browse({ entityType = null, entityId = null, targetType = null, targetId = null, origin = null, query = "" } = {}) {
    const needle = clean(query).toLowerCase();
    return all()
      .filter((edge) => {
        if (entityType && edge.entityType !== entityType) return false;
        if (entityId && edge.entityId !== entityId) return false;
        if (targetType && edge.targetType !== targetType) return false;
        if (targetId && edge.targetId !== String(targetId)) return false;
        if (origin && edge.origin !== origin) return false;
        return true;
      })
      .map(decorate)
      .filter((edge) => !needle || `${edge.entityName} ${edge.entityType} ${edge.targetType} ${edge.targetId} ${edge.targetName}`.toLowerCase().includes(needle))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function suggestions(entityType, entityId, { limit = 6 } = {}) {
    const entity = identity ? identity.get(entityType, entityId) : null;
    if (!entity) return [];
    const tokens = [identity.nameOf(entityType, entity), entity.id, ...Object.values(entity.fields || {})].map(clean).filter(Boolean);
    const out = [];
    for (const entry of targetList) {
      let best = 0;
      for (const token of tokens) best = Math.max(best, tokenSimilarity(token, entry.name), tokenSimilarity(token, entry.id), token === entry.id ? 1 : 0);
      if (best >= 0.5) out.push({ targetType: entry.type, targetId: entry.id, targetName: entry.name, confidence: Number(best.toFixed(2)), field: (typeById.get(entry.type) || {}).field || null });
    }
    return out.sort((a, b) => b.confidence - a.confidence).slice(0, Math.max(0, limit));
  }

  async function autolink({ entityTypes = null } = {}) {
    const types = entityTypes && entityTypes.length ? entityTypes : identity ? identity.entityTypes.map((type) => type.id) : [];
    let created = 0;
    let removed = 0;
    const autoIds = new Set();
    if (identity) {
      for (const typeId of types) {
        for (const entity of identity.all(typeId)) {
          const workflow = clean(entity.fields && entity.fields.automationWorkflow);
          const queue = clean(entity.fields && entity.fields.automationQueue);
          const candidates = [];
          if (workflow) {
            const found = targetList.find((entry) => entry.type === "workflow" && (entry.id === workflow || entry.name === workflow));
            if (found) candidates.push({ targetType: "workflow", targetId: found.id, field: "automationWorkflow" });
            const queueTarget = targetList.find((entry) => entry.type === "queue" && (entry.id === workflow || entry.name === workflow));
            if (queueTarget) candidates.push({ targetType: "queue", targetId: queueTarget.id, field: "automationWorkflow" });
          }
          if (queue) {
            const found = targetList.find((entry) => entry.type === "queue" && (entry.id === queue || entry.name === queue));
            if (found) candidates.push({ targetType: "queue", targetId: found.id, field: "automationQueue" });
          }
          for (const candidate of candidates) {
            const result = await link({ entityType: typeId, entityId: entity.id, targetType: candidate.targetType, targetId: candidate.targetId, origin: "auto", confidence: 1, field: candidate.field, note: "matched the entity's own automation field" });
            autoIds.add(edgeId(typeId, entity.id, candidate.targetType, candidate.targetId));
            if (result.created) created += 1;
          }
        }
      }
    }
    for (const entry of targetList) {
      if (entry.type !== "workitem" || !Array.isArray(entry.references)) continue;
      for (const ref of entry.references) {
        if (!ref.entityId) continue;
        const result = await link({ entityType: ref.entityType, entityId: ref.entityId, targetType: "workitem", targetId: entry.id, origin: "auto", confidence: 1, field: ref.field || "automationStatus", note: "referenced from the work item payload" });
        autoIds.add(edgeId(ref.entityType, ref.entityId, "workitem", entry.id));
        if (result.created) created += 1;
      }
    }
    for (const edge of all()) {
      if (edge.origin !== "auto" || autoIds.has(edge.id)) continue;
      await unlink(edge.id);
      removed += 1;
    }
    return { ok: true, created, removed, total: edges.size };
  }

  function orphanReferences() {
    const out = [];
    for (const entry of targetList) {
      if (entry.type !== "workitem" || !Array.isArray(entry.references)) continue;
      for (const ref of entry.references) {
        if (ref.entityId) continue;
        out.push({ targetType: "workitem", targetId: entry.id, entityType: ref.entityType, entityId: ref.value, note: `Work item ${entry.id} references ${ref.entityType} "${ref.value}", which is not in the canonical directory.` });
      }
    }
    return out;
  }

  function stats() {
    const byTargetType = {};
    const byOrigin = {};
    const entities = new Set();
    let resolvedLinks = 0;
    let unresolvedLinks = 0;
    for (const edge of edges.values()) {
      byTargetType[edge.targetType] = (byTargetType[edge.targetType] || 0) + 1;
      byOrigin[edge.origin] = (byOrigin[edge.origin] || 0) + 1;
      entities.add(`${edge.entityType}:${edge.entityId}`);
      if (target(edge.targetType, edge.targetId)) resolvedLinks += 1;
      else unresolvedLinks += 1;
    }
    return {
      links: edges.size,
      entities: entities.size,
      byTargetType,
      byOrigin,
      resolved: resolvedLinks,
      unresolved: unresolvedLinks,
      targets: targetList.length,
      targetsByType: targetList.reduce((all, entry) => ({ ...all, [entry.type]: (all[entry.type] || 0) + 1 }), {}),
      lastRefreshedAt,
      lastError,
      ...counters,
    };
  }

  async function hydrate() {
    if (!db) return edges.size;
    for (const stored of db.all(collection)) {
      if (!stored || !stored.id) continue;
      edges.set(stored.id, stored);
    }
    return edges.size;
  }

  async function reset() {
    edges.clear();
    targetIndex = new Map();
    targetList = [];
    lastRefreshedAt = null;
    lastError = null;
    for (const key of Object.keys(counters)) counters[key] = 0;
    if (db) await db.clear(collection);
  }

  return {
    collection,
    targetTypes: OPENRPA_TARGET_TYPES,
    origins: OPENRPA_LINK_ORIGINS,
    edgeId,
    refreshTargets,
    targets,
    target,
    remoteFor,
    link,
    unlink,
    unlinkWhere,
    unlinkEntity,
    unlinkTarget,
    all,
    get,
    linksFor,
    forTarget,
    browse,
    suggestions,
    autolink,
    orphanReferences,
    payloadReferences,
    references: () => targetList.filter((entry) => entry.type === "workitem" && Array.isArray(entry.references)).map((entry) => ({ targetId: entry.id, references: entry.references.map((ref) => ({ ...ref })) })),
    stats,
    hydrate,
    reset,
  };
}
