import { OPENRPA_SYNC_COLLECTION } from "./constants.js";
import { OPENRPA_REMOTE_FIELDS } from "./ownership.js";

export const OPENRPA_DRIFT_KINDS = ["field", "record", "relationship"];

export const OPENRPA_DRIFT_SEVERITY = {
  field: "warning",
  record: "info",
  relationship: "error",
};

export const OPENRPA_DRIFT_LABELS = {
  field: "Field drift",
  record: "Record drift",
  relationship: "Relationship drift",
};

function clean(value) {
  return value == null ? "" : String(value);
}

function blank(value) {
  return value == null || String(value).trim() === "";
}

export function createOpenRpaDriftMonitor({
  identity = null,
  registry = null,
  linking = null,
  db = null,
  collection = OPENRPA_SYNC_COLLECTION,
  clock = () => Date.now(),
} = {}) {
  const ledger = new Map();
  const snapshots = new Map();
  const counters = { scans: 0, captured: 0, errors: 0 };
  let lastScanAt = null;

  const iso = () => new Date(clock()).toISOString();

  function automationFields(typeId) {
    if (!registry) return [];
    return registry.fieldsFor(typeId).filter((field) => field.owner === "openrpa" || field.automation);
  }

  function snapshotKey(targetType, targetId) {
    return `snapshot:${targetType}:${targetId}`;
  }

  function signalKey(signal) {
    return `drift:${signal.kind}:${signal.entityType}:${signal.entityId}:${signal.field || "-"}:${signal.targetType || "-"}:${signal.targetId || "-"}`;
  }

  async function persist(record) {
    if (db) await db.put(collection, record.key, record);
    return record;
  }

  async function removeRecord(key) {
    if (db) await db.remove(collection, key);
  }

  function snapshotFor(targetType, targetId) {
    return snapshots.get(snapshotKey(targetType, targetId)) || null;
  }

  async function captureTarget({ targetType, targetId, targetName = null }) {
    if (!linking) return null;
    const remote = linking.remoteFor(targetType, targetId);
    if (!remote) return null;
    const key = snapshotKey(targetType, targetId);
    const record = { key, targetType, targetId: String(targetId), targetName: targetName || remote.name || String(targetId), version: remote.version, modified: remote.modified, values: { ...(remote.values || {}) }, at: iso() };
    snapshots.set(key, record);
    counters.captured += 1;
    await persist(record);
    return record;
  }

  async function captureTargets({ targetTypes = null } = {}) {
    if (!linking) return { ok: false, captured: 0 };
    const types = targetTypes && targetTypes.length ? targetTypes : null;
    let captured = 0;
    for (const edge of linking.all()) {
      if (types && !types.includes(edge.targetType)) continue;
      const record = await captureTarget({ targetType: edge.targetType, targetId: edge.targetId });
      if (record) captured += 1;
    }
    return { ok: true, captured };
  }

  async function forgetTarget(targetType, targetId) {
    const key = snapshotKey(targetType, targetId);
    if (!snapshots.has(key)) return false;
    snapshots.delete(key);
    await removeRecord(key);
    return true;
  }

  function fieldSignals(edge, remote, entity) {
    const out = [];
    const fields = automationFields(edge.entityType);
    for (const field of fields) {
      const spec = OPENRPA_REMOTE_FIELDS[field.key];
      if (!spec) continue;
      const remoteValue = spec.read(remote);
      const hubValue = entity && entity.fields ? entity.fields[field.key] : null;
      if (remoteValue == null || blank(hubValue)) continue;
      if (clean(remoteValue) === clean(hubValue)) continue;
      out.push({
        kind: "field",
        severity: OPENRPA_DRIFT_SEVERITY.field,
        entityType: edge.entityType,
        entityId: edge.entityId,
        entityName: edge.entityName,
        targetType: edge.targetType,
        targetId: edge.targetId,
        targetName: edge.targetName,
        field: field.key,
        label: field.label,
        held: clean(hubValue),
        expected: clean(remoteValue),
        detail: `The hub holds ${JSON.stringify(clean(hubValue))} for ${field.label}, but the linked ${edge.targetType} ${edge.targetId} reports ${JSON.stringify(clean(remoteValue))}.`,
        source: "openrpa",
      });
    }
    return out;
  }

  function recordSignal(edge, remote, snapshot) {
    if (!snapshot || !remote) return null;
    const versionMoved = remote.version != null && snapshot.version != null && Number(remote.version) !== Number(snapshot.version);
    const modifiedMoved = remote.modified && snapshot.modified && String(remote.modified) !== String(snapshot.modified);
    if (!versionMoved && !modifiedMoved) return null;
    return {
      kind: "record",
      severity: OPENRPA_DRIFT_SEVERITY.record,
      entityType: edge.entityType,
      entityId: edge.entityId,
      entityName: edge.entityName,
      targetType: edge.targetType,
      targetId: edge.targetId,
      targetName: edge.targetName,
      field: null,
      label: "Document version",
      held: snapshot.version == null ? clean(snapshot.modified) : `v${snapshot.version}`,
      expected: remote.version == null ? clean(remote.modified) : `v${remote.version}`,
      detail: `The linked ${edge.targetType} ${edge.targetId} moved from ${snapshot.version == null ? clean(snapshot.modified) : `version ${snapshot.version}`} to ${remote.version == null ? clean(remote.modified) : `version ${remote.version}`} since the hub last synchronised it.`,
      source: "openrpa",
    };
  }

  function relationshipSignal(edge, remote) {
    return {
      kind: "relationship",
      severity: OPENRPA_DRIFT_SEVERITY.relationship,
      entityType: edge.entityType,
      entityId: edge.entityId,
      entityName: edge.entityName,
      targetType: edge.targetType,
      targetId: edge.targetId,
      targetName: edge.targetName,
      field: null,
      label: "Linked record",
      held: `${edge.targetType}:${edge.targetId}`,
      expected: null,
      detail: `The link points at ${edge.targetType} ${edge.targetId}, which no longer exists in OpenFlow.`,
      source: "openrpa",
    };
  }

  function orphanSignal(orphan) {
    return {
      kind: "relationship",
      severity: OPENRPA_DRIFT_SEVERITY.relationship,
      entityType: orphan.entityType,
      entityId: orphan.entityId,
      entityName: "(unknown)",
      targetType: orphan.targetType,
      targetId: orphan.targetId,
      targetName: orphan.targetId,
      field: null,
      label: "Referenced entity",
      held: `${orphan.entityType}:${orphan.entityId}`,
      expected: null,
      detail: orphan.note,
      source: "openrpa",
    };
  }

  function signals() {
    const out = [];
    if (!linking) return out;
    for (const edge of linking.all()) {
      const remote = linking.remoteFor(edge.targetType, edge.targetId);
      if (!remote) {
        out.push(relationshipSignal(edge, remote));
        continue;
      }
      const entity = identity ? identity.get(edge.entityType, edge.entityId) : null;
      out.push(...fieldSignals(edge, remote, entity));
      const record = recordSignal(edge, remote, snapshotFor(edge.targetType, edge.targetId));
      if (record) out.push(record);
    }
    for (const orphan of linking.orphanReferences()) out.push(orphanSignal(orphan));
    return out;
  }

  async function scan({ refresh = true, capture = false } = {}) {
    if (refresh && linking) await linking.refreshTargets();
    if (capture) await captureTargets();
    const now = iso();
    const found = signals();
    const seen = new Set();
    let opened = 0;
    let updated = 0;
    let resolved = 0;
    for (const signal of found) {
      const key = signalKey(signal);
      seen.add(key);
      const existing = ledger.get(key);
      if (!existing) {
        const record = { key, ...signal, status: "open", firstSeenAt: now, lastSeenAt: now, seenCount: 1, resolvedAt: null };
        ledger.set(key, record);
        await persist(record);
        opened += 1;
        continue;
      }
      const wasResolved = existing.status === "resolved";
      Object.assign(existing, signal, { status: "open", lastSeenAt: now, seenCount: (existing.seenCount || 0) + 1, resolvedAt: null });
      await persist(existing);
      if (wasResolved) opened += 1;
      else updated += 1;
    }
    for (const record of Array.from(ledger.values())) {
      if (record.status === "open" && !seen.has(record.key)) {
        record.status = "resolved";
        record.resolvedAt = now;
        await persist(record);
        resolved += 1;
      }
    }
    counters.scans += 1;
    lastScanAt = now;
    return { at: now, found: found.length, opened, updated, resolved, open: open().length };
  }

  function entries() {
    return Array.from(ledger.values());
  }

  function open() {
    return entries()
      .filter((record) => record.status === "open")
      .sort((a, b) => (a.severity === "error" ? -1 : b.severity === "error" ? 1 : 0) || String(a.entityName).localeCompare(String(b.entityName)) || String(a.field || "").localeCompare(String(b.field || "")));
  }

  function resolved() {
    return entries()
      .filter((record) => record.status === "resolved")
      .sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt)));
  }

  function forEntity(entityType, entityId) {
    return entries().filter((record) => record.entityType === entityType && record.entityId === entityId);
  }

  function stats() {
    const openRecords = open();
    const byKind = {};
    const bySeverity = {};
    for (const record of openRecords) {
      byKind[record.kind] = (byKind[record.kind] || 0) + 1;
      bySeverity[record.severity] = (bySeverity[record.severity] || 0) + 1;
    }
    return { total: ledger.size, open: openRecords.length, resolved: resolved().length, byKind, bySeverity, snapshots: snapshots.size, lastScanAt, ...counters };
  }

  async function hydrate() {
    if (!db) return { drift: ledger.size, snapshots: snapshots.size };
    for (const stored of db.all(collection)) {
      if (!stored || !stored.key) continue;
      if (String(stored.key).startsWith("snapshot:")) snapshots.set(stored.key, stored);
      else if (String(stored.key).startsWith("drift:")) ledger.set(stored.key, stored);
    }
    return { drift: ledger.size, snapshots: snapshots.size };
  }

  async function reset() {
    ledger.clear();
    snapshots.clear();
    lastScanAt = null;
    for (const key of Object.keys(counters)) counters[key] = 0;
    if (db) await db.clear(collection);
  }

  return {
    collection,
    kinds: OPENRPA_DRIFT_KINDS,
    severity: OPENRPA_DRIFT_SEVERITY,
    labels: OPENRPA_DRIFT_LABELS,
    automationFields,
    signals,
    scan,
    snapshotFor,
    snapshots: () => Array.from(snapshots.values()).map((snapshot) => ({ ...snapshot })),
    captureTarget,
    captureTargets,
    forgetTarget,
    entries,
    open,
    resolved,
    forEntity,
    stats,
    hydrate,
    reset,
  };
}
