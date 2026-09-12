// src/framework/integration.js — PSA/RMM synchronization (roadmap task 28).
//
// A connected PSA or RMM is modelled as an *integration definition* stored on
// the documentation set (alongside `lifecycle`), and synchronization is a
// deterministic TRANSFORMATION: a provider adapter (the PSA/RMM API client)
// yields plain remote records, and the engine reconciles them against the set's
// records, matched by external id in `origin`.
//
// Nothing is ever duplicated: a record already carrying the integration's
// external id is updated in place; when the integration opts into name
// matching, a record with no external id is *adopted*; otherwise a new
// integration-managed record is created (informationModel "integration",
// provenance "synchronized"). Direction is configurable per integration and per
// entity — pull (external → IT-U), push (IT-U → external), both, or off — and
// the exact field mapping is configurable per entity too.
//
// The provider is INJECTED — `{ sync({ integration, entities }), push({ … }) }`
// — so the engine is fully testable without a live API; a real PSA/RMM client
// is just another object implementing that shape. This module is pure (no I/O,
// no store): the documentation-set service owns persistence.

import { newId } from "./ids.js";
import { requireClassification } from "./classification.js";
import { CONFIGURATION_TYPES } from "./configuration.js";

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// ---- catalogs --------------------------------------------------------------
export const INTEGRATION_KINDS = [
  { id: "psa", label: "PSA — professional services automation", short: "PSA", description: "A ticketing / service-management system of record." },
  { id: "rmm", label: "RMM — remote monitoring & management", short: "RMM", description: "A device-monitoring and management platform." },
  { id: "identity", label: "Identity / directory", short: "Directory", description: "A directory of users and groups." },
  { id: "other", label: "Other system of record", short: "Other", description: "Any other external system of record." },
];
export const integrationKind = (id) => INTEGRATION_KINDS.find((k) => k.id === id) || null;

export const SYNC_DIRECTIONS = [
  { id: "pull", label: "Pull (external → IT-U)", short: "Pull" },
  { id: "push", label: "Push (IT-U → external)", short: "Push" },
  { id: "both", label: "Both ways", short: "Both" },
  { id: "none", label: "Off", short: "Off" },
];
export const syncDirection = (id) => SYNC_DIRECTIONS.find((d) => d.id === id) || null;
const validDirection = (id, fallback = "none") => (syncDirection(id) ? id : fallback);

// ---- integration-managed record governance (task 30) ----------------------
// A pulled field belongs to the external system: it is *integration-owned*. When
// a local edit to an owned field collides with an incoming remote change, the
// conflict is resolved by a RULE, configured per integration (and overridable
// per entity). Every resolution is recorded, and an integration-managed record
// carries the external system that is authoritative for it.
export const CONFLICT_POLICIES = [
  {
    id: "external",
    label: "External system wins",
    short: "External",
    description: "The connected system is the system of record: an incoming change overwrites the local edit (the overwritten value is recorded as drift).",
  },
  {
    id: "local",
    label: "Local edit wins",
    short: "Local",
    description: "Keep the local edit and mark the field for push-back to the external system.",
  },
  {
    id: "flag",
    label: "Hold for review",
    short: "Hold",
    description: "Keep the local value and raise a conflict to resolve by hand; the field is not overwritten.",
  },
  {
    id: "newest",
    label: "Newest change wins",
    short: "Newest",
    description: "Keep whichever of the local edit or the remote change is newer (by update time).",
  },
];
export const conflictPolicy = (id) => CONFLICT_POLICIES.find((p) => p.id === id) || null;
const validPolicy = (id, fallback = "external") => (conflictPolicy(id) ? id : fallback);
const policyFor = (integration, entityId) => {
  const entity = integration && integration.entities && integration.entities[entityId];
  return validPolicy((entity && entity.conflictPolicy) || (integration && integration.conflictPolicy));
};

// The record families an integration can synchronize. Core Asset data at
// minimum (task 28): organizations, contacts and configurations/devices.
export const SYNC_ENTITIES = [
  { id: "organizations", label: "Organizations", collection: "organizations", idPrefix: "org" },
  { id: "contacts", label: "Contacts", collection: "contacts", idPrefix: "con" },
  { id: "configurations", label: "Configurations & devices", collection: "configurations", idPrefix: "cfg" },
];
export const syncEntity = (id) => SYNC_ENTITIES.find((e) => e.id === id) || null;
const collectionOf = (id) => {
  const e = syncEntity(id);
  return e ? e.collection : id;
};

// The default field mapping per entity, as [localField, remoteField] pairs.
// Administrators can override any of this per integration.
export const DEFAULT_FIELD_MAPS = {
  organizations: [
    ["name", "name"],
    ["legalName", "legalName"],
    ["tradingName", "tradingName"],
    ["taxId", "taxId"],
    ["website", "website"],
    ["primaryPhone", "primaryPhone"],
  ],
  contacts: [
    ["name", "name"],
    ["jobTitle", "jobTitle"],
    ["email", "email"],
    ["phone", "phone"],
    ["mobile", "mobile"],
    ["afterHoursPhone", "afterHoursPhone"],
  ],
  configurations: [
    ["name", "name"],
    ["configType", "configType"],
    ["manufacturer", "manufacturer"],
    ["model", "model"],
    ["serialNumber", "serialNumber"],
    ["hostname", "hostname"],
    ["ipAddresses", "ipAddresses"],
    ["macAddress", "macAddress"],
    ["assetTag", "assetTag"],
    ["operatingSystem", "operatingSystem"],
    ["supportExpiryDate", "supportExpiryDate"],
    ["warrantyExpiryDate", "warrantyExpiryDate"],
  ],
};

// A sensible default configuration type when the remote gives one we don't
// recognise (the integration's `typeMap` provides the real translation).
const DEFAULT_CONFIG_TYPE = "other";
const knownConfigType = (id) => CONFIGURATION_TYPES.some((t) => t.id === id);

// Per-entity defaults that keep a created record valid for the standardized
// field schema (organizations need orgKind, contacts need contactRole,
// configurations need configType).
function defaultsFor(entityId, remote, integration) {
  if (entityId === "organizations") return { orgKind: "organization" };
  if (entityId === "contacts") return { contactRole: "client-primary" };
  if (entityId === "configurations") return { configType: mapConfigType(remote && remote.fields ? remote.fields.configType : remote && remote.configType, integration) };
  return {};
}

function mapConfigType(remoteValue, integration) {
  if (isBlank(remoteValue)) return DEFAULT_CONFIG_TYPE;
  const key = String(remoteValue);
  const mapped = integration && integration.typeMap ? integration.typeMap[key] : null;
  if (mapped && knownConfigType(mapped)) return mapped;
  return knownConfigType(key) ? key : DEFAULT_CONFIG_TYPE;
}

// ---- normalizers -----------------------------------------------------------
const normalizeFieldMap = (fields, entityId, entityDir) => {
  let list = null;
  if (Array.isArray(fields) && fields.length) {
    list = fields.map((f) => (Array.isArray(f) ? { local: f[0], remote: f[1] || f[0] } : { local: f && f.local, remote: (f && f.remote) || (f && f.local), direction: f && f.direction }));
  } else if (fields && typeof fields === "object") {
    list = Object.entries(fields).map(([local, remote]) => {
      if (remote && typeof remote === "object") return { local, remote: remote.remote || local, direction: remote.direction };
      return { local, remote: remote == null ? local : remote };
    });
  } else {
    list = (DEFAULT_FIELD_MAPS[entityId] || []).map(([local, remote]) => ({ local, remote }));
  }
  return list
    .filter((f) => f && !isBlank(f.local))
    .map((f) => ({ local: f.local, remote: isBlank(f.remote) ? f.local : f.remote, direction: f.direction && validDirection(f.direction, null) ? f.direction : null }));
};

export function normalizeEntities(entities, { defaultEnabled = true } = {}) {
  const out = {};
  for (const entity of SYNC_ENTITIES) {
    const src = (entities && entities[entity.id]) || null;
    const enabled = src ? src.enabled !== false : defaultEnabled;
    const direction = validDirection(src && src.direction, enabled ? "pull" : "none");
    out[entity.id] = {
      enabled: enabled && direction !== "none",
      direction,
      fields: normalizeFieldMap(src && src.fields, entity.id, direction),
      conflictPolicy: src && conflictPolicy(src.conflictPolicy) ? src.conflictPolicy : null,
    };
  }
  return out;
}

export function makeIntegration(def = {}, { now = Date.now(), createdBy = "system" } = {}) {
  const name = String(def.name == null ? "" : def.name).trim();
  if (!name) throw new Error("An integration needs a name.");
  return {
    id: def.id || newId("intg"),
    name,
    kind: integrationKind(def.kind) ? def.kind : "other",
    provider: isBlank(def.provider) ? "generic" : String(def.provider),
    baseUrl: isBlank(def.baseUrl) ? "" : String(def.baseUrl),
    credentialId: isBlank(def.credentialId) ? null : String(def.credentialId),
    enabled: def.enabled !== false,
    matchOn: def.matchOn === "name" ? "name" : "externalId",
    prune: !!def.prune,
    conflictPolicy: validPolicy(def.conflictPolicy),
    typeMap: def.typeMap && typeof def.typeMap === "object" ? { ...def.typeMap } : {},
    entities: normalizeEntities(def.entities, { defaultEnabled: def.entities ? false : true }),
    createdAt: now,
    updatedAt: now,
    createdBy,
    lastRunAt: null,
    lastRunId: null,
    lastStatus: null,
    lastSummary: null,
  };
}

export function updateIntegration(current, patch = {}, { now = Date.now(), by = "system" } = {}) {
  const next = { ...current, ...patch };
  next.id = current.id;
  next.createdAt = current.createdAt;
  next.updatedAt = now;
  next.updatedBy = by;
  if (patch.entities) next.entities = normalizeEntities(patch.entities, { defaultEnabled: false });
  else next.entities = current.entities;
  if (patch.kind && !integrationKind(patch.kind)) next.kind = "other";
  if (patch.matchOn && patch.matchOn !== "name") next.matchOn = "externalId";
  if (patch.conflictPolicy != null) next.conflictPolicy = validPolicy(patch.conflictPolicy);
  else if (!next.conflictPolicy) next.conflictPolicy = "external";
  return next;
}

export function normalizeIntegrations(state) {
  const integrations = Array.isArray(state && state.integrations) ? state.integrations : [];
  const runs = Array.isArray(state && state.runs) ? state.runs : [];
  return {
    integrations,
    runs,
    updatedAt: (state && state.updatedAt) || null,
    updatedBy: (state && state.updatedBy) || null,
  };
}

// ---- entity & direction helpers -------------------------------------------
export const integrationEntityIds = (integration) => SYNC_ENTITIES.map((e) => e.id);
export const enabledEntityIds = (integration) => SYNC_ENTITIES.filter((e) => integration.entities[e.id] && integration.entities[e.id].enabled).map((e) => e.id);
export const pullEntityIds = (integration) => SYNC_ENTITIES.filter((e) => integration.entities[e.id] && integration.entities[e.id].enabled && (integration.entities[e.id].direction === "pull" || integration.entities[e.id].direction === "both")).map((e) => e.id);
export const pushEntityIds = (integration) => SYNC_ENTITIES.filter((e) => integration.entities[e.id] && integration.entities[e.id].enabled && (integration.entities[e.id].direction === "push" || integration.entities[e.id].direction === "both")).map((e) => e.id);

const fieldAppliesTo = (mapping, entityDir, phase) => {
  const dir = mapping.direction || entityDir;
  if (dir === "none") return false;
  if (phase === "pull") return dir === "pull" || dir === "both";
  return dir === "push" || dir === "both";
};

export const externalKey = (externalId) => (isBlank(externalId) ? "" : String(externalId));

// ---- ownership, authority & drift (task 30) --------------------------------
// Which local fields a pull from this integration OWNS (the external system is
// authoritative for them). A field mapped with push-only direction is not owned.
export function ownedFields(integration, entityId) {
  const entity = integration && integration.entities && integration.entities[entityId];
  if (!entity || !entity.enabled) return [];
  return entity.fields.filter((m) => fieldAppliesTo(m, entity.direction, "pull")).map((m) => m.local);
}
export const ownedFieldKeys = (integration, entityId) => new Set(ownedFields(integration, entityId));

// The reference to the authoritative external system, stamped onto every
// integration-managed record.
export function authorityRef(integration) {
  if (!integration) return null;
  const kind = integrationKind(integration.kind);
  return { id: integration.id, name: integration.name, kind: integration.kind, kindLabel: kind ? kind.short : integration.kind };
}

export function isIntegrationManaged(record) {
  const o = (record && record.origin) || {};
  return !!(o.integrationId || o.externalId);
}

// The value baseline the integration last wrote (per owned field), used to tell
// a local edit apart from an external change.
export const recordBaseline = (record) => (record && record.origin && record.origin.synced) || {};

// Fields whose local value has diverged from the last synchronized baseline —
// i.e. a local edit that a future external change would collide with.
export function driftFields(record) {
  const base = recordBaseline(record);
  const out = [];
  for (const [field, synced] of Object.entries(base)) {
    if (!valuesEqual(record ? record[field] : undefined, synced)) out.push({ field, localValue: (record || {})[field], syncedValue: synced });
  }
  return out;
}

export const openConflictsOf = (record) => (Array.isArray(record && record.syncConflicts) ? record.syncConflicts.filter((c) => c.state === "open") : []);

// A per-record governance summary: whether it is integration-managed, which
// system is authoritative, which fields that system owns, current drift, any
// push-backs and open conflicts.
export function recordGovernance(record) {
  if (!isIntegrationManaged(record)) return { managed: false };
  const o = record.origin || {};
  return {
    managed: true,
    authority: o.authority || { id: o.integrationId || null, name: o.source || "External system", kind: null, kindLabel: null },
    externalId: o.externalId || null,
    syncedAt: o.syncedAt || null,
    remoteDeletedAt: o.remoteDeletedAt || null,
    ownedFields: Object.keys(recordBaseline(record)),
    drift: driftFields(record),
    pushBack: Array.isArray(o.pushBack) ? o.pushBack.slice() : [],
    conflicts: openConflictsOf(record),
  };
}

let CONFLICT_SEQ = 0;
function makeConflictEntry({ integration, entityId, field, localValue, remoteValue, baselineValue, outcome, now }) {
  CONFLICT_SEQ += 1;
  return {
    id: "conf-" + now.toString(36) + "-" + CONFLICT_SEQ.toString(36),
    entityId,
    field,
    localValue,
    remoteValue,
    baselineValue,
    policy: outcome.policy,
    resolution: outcome.resolution,
    state: outcome.held ? "open" : "resolved",
    at: now,
    integrationId: integration.id,
    system: integration.name,
  };
}
const capConflicts = (list, max = 40) => {
  if (list.length <= max) return list;
  const open = list.filter((c) => c.state === "open");
  const closed = list.filter((c) => c.state !== "open");
  return [...open, ...closed.slice(0, Math.max(0, max - open.length))].slice(0, max);
};

// Resolve a single owned-field collision by the integration's rule.
function resolveByPolicy(integration, entityId, { record, field, remote, remoteRecord, now }) {
  const policy = policyFor(integration, entityId);
  if (policy === "local") return { policy, applyExternal: false, pushBack: true, held: false, resolution: "local" };
  if (policy === "flag") return { policy, applyExternal: false, pushBack: false, held: true, resolution: "open" };
  if (policy === "newest") {
    const remoteAt = Number(remoteRecord && (remoteRecord.updatedAt != null ? remoteRecord.updatedAt : remoteRecord.updated_at)) || 0;
    const localAt = Number(record && record.updatedAt) || 0;
    if (remoteAt && remoteAt >= localAt) return { policy, applyExternal: true, pushBack: false, held: false, resolution: "external" };
    return { policy, applyExternal: false, pushBack: true, held: false, resolution: "local" };
  }
  return { policy: "external", applyExternal: true, pushBack: false, held: false, resolution: "external" };
}

// Resolve an open conflict by hand. "external" applies the remote value;
// "local" keeps the local value and queues it for push-back.
export function resolveSyncConflict(record, field, choice, { now = Date.now(), by = "system" } = {}) {
  if (!record) return null;
  const conflicts = Array.isArray(record.syncConflicts) ? record.syncConflicts.slice() : [];
  const idx = conflicts.findIndex((c) => c.field === field && c.state === "open");
  if (idx < 0) return null;
  const c = conflicts[idx];
  const origin = { ...(record.origin || {}) };
  const baseline = { ...(origin.synced || {}) };
  if (choice === "external") {
    record[field] = c.remoteValue;
    baseline[field] = c.remoteValue;
  } else {
    const pb = new Set(origin.pushBack || []);
    pb.add(field);
    origin.pushBack = [...pb];
  }
  origin.synced = baseline;
  record.origin = origin;
  conflicts[idx] = { ...c, state: "resolved", resolution: choice === "external" ? "external" : "local", resolvedAt: now, resolvedBy: by };
  record.syncConflicts = conflicts;
  record.updatedAt = now;
  record.updatedBy = by;
  return { conflict: conflicts[idx], record };
}

export function resolveAllSyncConflicts(record, choice, opts = {}) {
  const open = openConflictsOf(record).map((c) => c.field);
  const resolved = [];
  for (const field of open) {
    const r = resolveSyncConflict(record, field, choice, opts);
    if (r) resolved.push(r.conflict);
  }
  return resolved;
}

const entityForCollection = (collection) => SYNC_ENTITIES.find((e) => e.collection === collection) || null;

// Roll every integration-managed record in a set into one governance view:
// which external system is authoritative for each, the fields that system owns,
// any drift from a local edit, and any open conflicts / push-backs.
export function governanceOverview(set, integrations = []) {
  const byId = new Map((integrations || []).map((i) => [i.id, i]));
  const items = [];
  const bySystem = {};
  let managed = 0;
  let driftCount = 0;
  let openCount = 0;
  let pushCount = 0;
  for (const entity of SYNC_ENTITIES) {
    const rows = (set && set.records && set.records[entity.collection]) || [];
    for (const record of rows) {
      const g = recordGovernance(record);
      if (!g.managed) continue;
      managed += 1;
      const sysName = g.authority.name || "External system";
      bySystem[sysName] = (bySystem[sysName] || 0) + 1;
      const integration = g.authority.id ? byId.get(g.authority.id) : null;
      const owned = integration ? ownedFields(integration, entity.id) : g.ownedFields;
      items.push({
        id: record.id,
        collection: entity.collection,
        entityId: entity.id,
        entityLabel: entity.label,
        name: record.name,
        system: sysName,
        integrationId: g.authority.id,
        externalId: g.externalId,
        syncedAt: g.syncedAt,
        ownedFields: owned.length ? owned : g.ownedFields,
        drift: g.drift,
        conflicts: g.conflicts,
        pushBack: g.pushBack,
      });
      driftCount += g.drift.length;
      openCount += g.conflicts.length;
      pushCount += g.pushBack.length;
    }
  }
  return { managed, driftCount, openCount, pushCount, bySystem, items };
}

export { entityForCollection };

// ---- matching --------------------------------------------------------------
// The local record for a remote record, or null. A record already carrying this
// integration's external id is matched directly. When the integration opts into
// name matching, any record carrying that external id is offered first (so two
// integrations never end up owning the same external id), and failing that, an
// unlinked record with the same name is offered for adoption.
export function findLinkedRecord(set, integration, entityId, remote) {
  const collection = collectionOf(entityId);
  const rows = (set && set.records && set.records[collection]) || [];
  const key = externalKey(remote && (remote.externalId != null ? remote.externalId : remote.id));
  if (key) {
    const byId = rows.find((r) => {
      const o = r.origin || {};
      return externalKey(o.externalId) === key && (!o.integrationId || o.integrationId === integration.id);
    });
    if (byId) return byId;
    if (integration.matchOn === "name") {
      const anyId = rows.find((r) => externalKey((r.origin || {}).externalId) === key);
      if (anyId) return anyId;
    }
  }
  if (integration.matchOn === "name" && !isBlank(remote && remote.name)) {
    const name = String(remote.name).trim().toLowerCase();
    const byName = rows.find((r) => {
      const o = r.origin || {};
      if (o.externalId) return false; // already owned by some external record
      return String(r.name || "").trim().toLowerCase() === name;
    });
    if (byName) return byName;
  }
  return null;
}

// ---- value extraction ------------------------------------------------------
function remoteFieldValue(remote, remoteKey) {
  if (!remote) return undefined;
  const fields = remote.fields && typeof remote.fields === "object" ? remote.fields : null;
  if (fields && remoteKey in fields) return fields[remoteKey];
  return remote[remoteKey];
}

const valuesEqual = (a, b) => {
  const na = isBlank(a) ? "" : a;
  const nb = isBlank(b) ? "" : b;
  if (Array.isArray(na) || Array.isArray(nb) || (na && typeof na === "object") || (nb && typeof nb === "object")) {
    return JSON.stringify(na) === JSON.stringify(nb);
  }
  return String(na) === String(nb);
};

// The local field values a pull should set, honouring the field directions.
export function pullFieldValues(integration, entityId, remote) {
  const entity = integration.entities[entityId] || { direction: "pull", fields: [] };
  const out = {};
  for (const mapping of entity.fields) {
    if (!fieldAppliesTo(mapping, entity.direction, "pull")) continue;
    const value = remoteFieldValue(remote, mapping.remote);
    if (value === undefined) continue;
    if (mapping.local === "configType") {
      out.configType = mapConfigType(value, integration);
    } else {
      out[mapping.local] = value;
    }
  }
  return out;
}

// The remote-shaped values a push would send for one local record.
export function pushFieldValues(integration, entityId, record) {
  const entity = integration.entities[entityId] || { direction: "push", fields: [] };
  const out = {};
  for (const mapping of entity.fields) {
    if (!fieldAppliesTo(mapping, entity.direction, "push")) continue;
    const value = record[mapping.local];
    if (value === undefined) continue;
    out[mapping.remote] = value;
  }
  return out;
}

// ---- pull application (pure) ----------------------------------------------
const emptyTally = () => ({ created: 0, updated: 0, adopted: 0, unchanged: 0, skipped: 0, deleted: 0, remoteDeleted: 0, conflicts: 0, overwritten: 0, held: 0, pushBack: 0, drifts: [], errors: [] });

export function applyPull(set, integration, entityId, remoteRecords, { now = Date.now() } = {}) {
  const tally = emptyTally();
  const collection = collectionOf(entityId);
  if (!set.records) set.records = {};
  if (!Array.isArray(set.records[collection])) set.records[collection] = [];
  const rows = set.records[collection];
  const list = Array.isArray(remoteRecords) ? remoteRecords : [];

  for (const remote of list) {
    const key = externalKey(remote && (remote.externalId != null ? remote.externalId : remote.id));
    if (!key) {
      tally.skipped += 1;
      continue;
    }
    const existing = findLinkedRecord(set, integration, entityId, remote);

    if (remote.deleted) {
      if (existing && integration.prune) {
        const idx = rows.indexOf(existing);
        if (idx >= 0) rows.splice(idx, 1);
        cascadeRelationships(set, { type: collection, id: existing.id });
        tally.deleted += 1;
      } else if (existing) {
        existing.origin = { ...(existing.origin || {}), remoteDeletedAt: now };
        tally.remoteDeleted += 1;
      } else {
        tally.skipped += 1;
      }
      continue;
    }

    const values = pullFieldValues(integration, entityId, remote);
    if (!existing) {
      // Another integration already owns this external id — never create a
      // second record for it.
      const clash = rows.find((r) => externalKey((r.origin || {}).externalId) === key);
      if (clash) {
        tally.skipped += 1;
        continue;
      }
      const rec = makeIntegrationRecord(integration, entityId, key, remote, values, now);
      if (!rec) {
        tally.skipped += 1;
        continue;
      }
      rows.push(rec);
      tally.created += 1;
      continue;
    }

    // A record linked to a *different* integration is not ours to overwrite.
    const owner = existing.origin && existing.origin.integrationId;
    if (owner && owner !== integration.id) {
      tally.skipped += 1;
      continue;
    }

    const adopted = !(existing.origin && existing.origin.externalId);
    const baseline = { ...recordBaseline(existing) };
    const conflicts = Array.isArray(existing.syncConflicts) ? existing.syncConflicts.slice() : [];
    const pushBack = new Set((existing.origin && existing.origin.pushBack) || []);
    const changed = [];
    let touchedConflict = false;

    for (const [k, remoteVal] of Object.entries(values)) {
      const base = baseline[k];
      const local = existing[k];
      const localChanged = !valuesEqual(local, base);
      const remoteChanged = !valuesEqual(remoteVal, base);
      if (!remoteChanged) continue; // external value unchanged — never clobber a local edit
      if (!localChanged) {
        // Only the external system changed: apply it cleanly.
        existing[k] = remoteVal;
        baseline[k] = remoteVal;
        changed.push(k);
        continue;
      }
      if (valuesEqual(local, remoteVal)) {
        baseline[k] = remoteVal; // both sides converged on the same value
        continue;
      }
      // Genuine conflict: local edit vs. external change.
      const outcome = resolveByPolicy(integration, entityId, { record: existing, field: k, remote: remoteVal, remoteRecord: remote, now });
      if (outcome.applyExternal) {
        existing[k] = remoteVal;
        baseline[k] = remoteVal;
        changed.push(k);
        tally.overwritten += 1;
        tally.drifts.push({ recordId: existing.id, collection, name: existing.name, field: k, action: "overwritten", localValue: local, remoteValue: remoteVal });
      } else if (outcome.pushBack) {
        pushBack.add(k);
        tally.pushBack += 1;
        tally.drifts.push({ recordId: existing.id, collection, name: existing.name, field: k, action: "kept-local", localValue: local, remoteValue: remoteVal });
      } else {
        tally.held += 1;
        tally.drifts.push({ recordId: existing.id, collection, name: existing.name, field: k, action: "held", localValue: local, remoteValue: remoteVal });
      }
      conflicts.push(makeConflictEntry({ integration, entityId, field: k, localValue: local, remoteValue: remoteVal, baselineValue: base, outcome, now }));
      tally.conflicts += 1;
      touchedConflict = true;
    }

    if (touchedConflict) existing.syncConflicts = capConflicts(conflicts);
    existing.origin = {
      ...(existing.origin || {}),
      source: integration.name,
      externalId: key,
      integrationId: integration.id,
      authority: authorityRef(integration),
      syncedAt: now,
      synced: baseline,
      ...(pushBack.size ? { pushBack: [...pushBack] } : {}),
    };
    if (adopted) {
      existing.informationModel = "integration";
      existing.provenance = "synchronized";
    }
    if (adopted || changed.length || touchedConflict) {
      existing.updatedAt = now;
      existing.updatedBy = integration.name || "integration";
    }
    if (adopted) tally.adopted += 1;
    else if (changed.length) tally.updated += 1;
    else tally.unchanged += 1;
  }
  return tally;
}

function makeIntegrationRecord(integration, entityId, externalId, remote, values, now) {
  const name = String((remote && remote.name) || values.name || externalId).trim();
  const record = {
    id: newId((syncEntity(entityId) || {}).idPrefix || "rec"),
    type: collectionOf(entityId),
    name: name || externalId,
    informationModel: "integration",
    provenance: "synchronized",
    origin: { source: integration.name, externalId, integrationId: integration.id, authority: authorityRef(integration), syncedAt: now, synced: { ...values } },
    createdAt: now,
    updatedAt: now,
    createdBy: integration.name || "integration",
    ...defaultsFor(entityId, remote, integration),
    ...values,
  };
  try {
    requireClassification(record);
  } catch {
    return null;
  }
  return record;
}

// Drop relationships that pointed at a record we just removed (a minimal
// cascade — mirrors removeRecord, kept inline so the pull stays a pure set
// transformation).
function cascadeRelationships(set, ref) {
  if (!set.records || !Array.isArray(set.records.relationships)) return;
  set.records.relationships = set.records.relationships.filter((rel) => {
    const a = rel.from || {};
    const b = rel.to || {};
    return !((a.type === ref.type && a.id === ref.id) || (b.type === ref.type && b.id === ref.id));
  });
}

// ---- push application (pure) ----------------------------------------------
// The local records an integration manages (linked to it), as remote-shaped
// payloads. Records with no external id yet are marked `_new` so the provider
// knows to create them and hand back an id.
export function pushPayload(set, integration, entityId) {
  const collection = collectionOf(entityId);
  const rows = (set && set.records && set.records[collection]) || [];
  return rows
    .filter((r) => r.origin && r.origin.integrationId === integration.id)
    .map((r) => ({
      localId: r.id,
      externalId: externalKey(r.origin.externalId) || null,
      isNew: !externalKey(r.origin.externalId),
      name: r.name,
      fields: pushFieldValues(integration, entityId, r),
    }));
}

// Apply the provider's push result: it may hand back external ids for records
// that were created remotely. `result.assigned` is [{ localId, externalId }].
export function applyPushResult(set, integration, entityId, result, { now = Date.now() } = {}) {
  const collection = collectionOf(entityId);
  const rows = (set && set.records && set.records[collection]) || [];
  const tally = { pushed: 0, assigned: 0, skipped: 0, errors: [] };
  let assigned = 0;
  for (const item of (result && result.assigned) || []) {
    const rec = rows.find((r) => r.id === item.localId);
    if (!rec || isBlank(item.externalId)) {
      tally.skipped += 1;
      continue;
    }
    rec.origin = { ...(rec.origin || {}), source: integration.name, externalId: String(item.externalId), integrationId: integration.id, authority: authorityRef(integration), syncedAt: now };
    rec.updatedAt = now;
    assigned += 1;
  }
  tally.assigned = assigned;
  tally.pushed = Number(result && result.pushed) || 0;
  return tally;
}

// ---- a whole run -----------------------------------------------------------
// Reconcile every enabled entity against the remote snapshot the provider
// returned. Pure: `remote` is plain data (`{ organizations: [...], contacts:
// [...], configurations: [...] }`).
export function applySync(set, integration, remote, { now = Date.now() } = {}) {
  const entities = {};
  const totals = { created: 0, updated: 0, adopted: 0, unchanged: 0, skipped: 0, deleted: 0, remoteDeleted: 0, conflicts: 0, overwritten: 0, held: 0, pushBack: 0 };
  const drifts = [];
  for (const entityId of pullEntityIds(integration)) {
    const tally = applyPull(set, integration, entityId, remote ? remote[entityId] : [], { now });
    entities[entityId] = tally;
    totals.created += tally.created;
    totals.updated += tally.updated;
    totals.adopted += tally.adopted;
    totals.unchanged += tally.unchanged;
    totals.skipped += tally.skipped;
    totals.deleted += tally.deleted;
    totals.remoteDeleted += tally.remoteDeleted;
    totals.conflicts += tally.conflicts || 0;
    totals.overwritten += tally.overwritten || 0;
    totals.held += tally.held || 0;
    totals.pushBack += tally.pushBack || 0;
    for (const d of tally.drifts || []) drifts.push({ entityId, ...d });
  }
  return { entities, totals, drifts };
}

export function makeSyncRun({ integration, summary, startedAt, finishedAt = Date.now(), mode = "pull", status = "ok", errors = [] } = {}) {
  return {
    id: newId("run"),
    integrationId: integration.id,
    integrationName: integration.name,
    mode,
    status,
    startedAt,
    finishedAt,
    entities: (summary && summary.entities) || {},
    totals: (summary && summary.totals) || { created: 0, updated: 0, adopted: 0, unchanged: 0, skipped: 0, deleted: 0, remoteDeleted: 0, conflicts: 0, overwritten: 0, held: 0, pushBack: 0 },
    drifts: (summary && summary.drifts) || [],
    errors: errors || [],
  };
}

export function runSummaryLine(run) {
  if (!run) return "Never run";
  const t = run.totals || {};
  if (run.status === "error") return "Failed — " + ((run.errors && run.errors[0]) || "unknown error");
  const parts = [];
  if (t.created) parts.push(t.created + " created");
  if (t.updated) parts.push(t.updated + " updated");
  if (t.adopted) parts.push(t.adopted + " adopted");
  if (t.remoteDeleted) parts.push(t.remoteDeleted + " removed remotely");
  if (t.conflicts) parts.push(t.conflicts + " conflict" + (t.conflicts === 1 ? "" : "s"));
  if (!parts.length) parts.push(t.unchanged ? t.unchanged + " already current" : "no changes");
  return parts.join(", ");
}

export function integrationSummary(integration) {
  const entities = enabledEntityIds(integration);
  const dirs = entities.map((id) => {
    const e = integration.entities[id];
    const d = syncDirection(e.direction);
    return (d ? d.short : "Off") + " " + (syncEntity(id) || {}).label;
  });
  return { entityCount: entities.length, directions: dirs };
}
