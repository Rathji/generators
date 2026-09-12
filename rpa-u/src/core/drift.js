export const DRIFT_SEVERITY = {
  "field-conflict": "error",
  "stale-value": "warning",
  "link-drift": "error",
};

export const DRIFT_LABEL = {
  "field-conflict": "Field conflict",
  "stale-value": "Stale derived value",
  "link-drift": "Link drift",
};

function text(value) {
  return value == null ? null : String(value);
}

export function alertSeverityFor(signals) {
  const errors = signals.filter((signal) => signal.severity === "error");
  if (errors.some((signal) => signal.sensitive) || errors.length >= 2) return "critical";
  if (errors.length) return "error";
  if (signals.some((signal) => signal.severity === "warning")) return "warning";
  return "info";
}

export function alertKeyFor(record) {
  return `drift:${record.kind}:${record.entityType}:${record.entityId}`;
}

export function createDriftMonitor({
  identity,
  registry,
  linker,
  references,
  conflicts = null,
  alerts = null,
  db = null,
  collection = "drift",
  emit = null,
  clock = () => Date.now(),
} = {}) {
  if (!identity || !registry || !references) throw new Error("createDriftMonitor requires identity, registry and references");
  const ledger = new Map();

  function iso(at = clock()) {
    return new Date(at).toISOString();
  }

  function keyOf(signal) {
    return `${signal.kind}:${signal.entityType}:${signal.entityId}:${signal.field}`;
  }

  function persist(record) {
    if (!db) return Promise.resolve(record);
    return db.put(collection, record.key, record);
  }

  async function hydrate() {
    if (!db) return ledger.size;
    for (const stored of db.all(collection)) {
      if (!stored || !stored.key) continue;
      ledger.set(stored.key, stored);
    }
    return ledger.size;
  }

  function signalFromReference(kind, reference) {
    const expected = kind === "field-conflict" ? reference.ownerHeld : reference.authoritative?.value;
    return {
      kind,
      severity: DRIFT_SEVERITY[kind] || "warning",
      entityType: reference.typeId,
      entityId: reference.entityId,
      entityName: reference.entityName,
      field: reference.field,
      label: reference.label || reference.field,
      owner: reference.owner || null,
      ownerName: reference.ownerName || reference.owner || null,
      direction: reference.direction || null,
      sensitive: !!reference.sensitive,
      held: text(reference.held),
      expected: text(expected),
      detail:
        kind === "field-conflict"
          ? `${reference.ownerName || "The owner"} reports “${text(reference.ownerHeld)}” but the hub holds “${text(reference.held)}”.`
          : `The hub cached “${text(reference.held)}” but recomputing from linked records gives “${text(expected)}”.`,
      source: "references",
    };
  }

  function linkDrift() {
    const out = [];
    if (!linker || !linker.store) return out;
    for (const linkType of linker.linkTypes) {
      for (const edge of linker.store.byType(linkType.id)) {
        if (edge.origin !== "auto") continue;
        const from = identity.get(edge.fromType, edge.fromId);
        const to = identity.get(edge.toType, edge.toId);
        const entityName = from ? identity.nameOf(edge.fromType, from) : edge.fromId;
        if (!from || !to) {
          out.push({
            kind: "link-drift",
            severity: "error",
            entityType: edge.fromType,
            entityId: edge.fromId,
            entityName,
            field: edge.field,
            label: linkType.label,
            owner: null,
            ownerName: null,
            direction: null,
            sensitive: false,
            held: `${edge.toType}:${edge.toId}`,
            expected: null,
            detail: `The stored link points at ${edge.toType} ${edge.toId}, which no longer exists.`,
            source: "linker",
          });
          continue;
        }
        const resolution = linker.resolveField(edge.fromType, edge.fromId, linkType.id);
        const matches = resolution.status === "linked" && resolution.target && resolution.target.entityId === edge.toId;
        if (matches) continue;
        const expected = resolution.status === "linked" && resolution.target ? `${resolution.target.typeId}:${resolution.target.entityId}` : `no ${linkType.toType} match`;
        out.push({
          kind: "link-drift",
          severity: "error",
          entityType: edge.fromType,
          entityId: edge.fromId,
          entityName,
          field: edge.field,
          label: linkType.label,
          owner: null,
          ownerName: null,
          direction: null,
          sensitive: false,
          held: `${edge.toType}:${edge.toId}`,
          expected,
          detail: `The stored link points at ${edge.toType} ${edge.toId}, but “${text(from.fields?.[edge.field])}” now resolves to ${expected}.`,
          source: "linker",
        });
      }
    }
    return out;
  }

  function signals() {
    const drift = references.scanDrift();
    const out = [];
    for (const reference of drift.conflicts) out.push(signalFromReference("field-conflict", reference));
    for (const reference of drift.stale) out.push(signalFromReference("stale-value", reference));
    out.push(...linkDrift());
    return out;
  }

  function groupSignals(list) {
    const map = new Map();
    for (const signal of list) {
      const key = alertKeyFor(signal);
      if (!map.has(key)) map.set(key, { key, kind: signal.kind, entityType: signal.entityType, entityId: signal.entityId, entityName: signal.entityName, signals: [] });
      map.get(key).signals.push(signal);
    }
    return map;
  }

  function alertSummary(group) {
    const fields = group.signals.map((signal) => signal.label);
    const unique = Array.from(new Set(fields));
    const kindLabel = DRIFT_LABEL[group.kind] || group.kind;
    const detail =
      group.kind === "link-drift"
        ? `${group.entityName} has ${group.signals.length} link${group.signals.length === 1 ? "" : "s"} that no longer match the source field: ${unique.join(", ")}.`
        : `${group.entityName} has ${group.signals.length} ${group.kind === "field-conflict" ? "field conflict" : "derived value"}${group.signals.length === 1 ? "" : "s"} diverging from the authoritative source: ${unique.join(", ")}.`;
    return {
      key: group.key,
      category: "drift",
      severity: alertSeverityFor(group.signals),
      title: `${group.entityName} · ${kindLabel}`,
      detail,
      entity: { typeId: group.entityType, id: group.entityId, name: group.entityName },
      source: "drift",
      items: group.signals.map((signal) => ({ kind: signal.kind, field: signal.field, label: signal.label, held: signal.held, expected: signal.expected, severity: signal.severity })),
    };
  }

  async function scan({ announce = true, notify = true } = {}) {
    const now = iso();
    const found = signals();
    const seen = new Set();
    let opened = 0;
    let updated = 0;
    let resolved = 0;
    const changed = [];

    for (const signal of found) {
      const key = keyOf(signal);
      seen.add(key);
      const existing = ledger.get(key);
      if (!existing) {
        const record = { id: key, key, ...signal, status: "open", firstSeenAt: now, lastSeenAt: now, seenCount: 1, resolvedAt: null };
        ledger.set(key, record);
        opened += 1;
        changed.push(record);
        await persist(record);
        continue;
      }
      const wasResolved = existing.status === "resolved";
      Object.assign(existing, signal, { status: "open", lastSeenAt: now, seenCount: (existing.seenCount || 0) + 1, resolvedAt: null });
      if (wasResolved) {
        opened += 1;
        changed.push(existing);
      } else {
        updated += 1;
      }
      await persist(existing);
    }

    for (const record of Array.from(ledger.values())) {
      if (record.status === "open" && !seen.has(record.key)) {
        record.status = "resolved";
        record.resolvedAt = now;
        resolved += 1;
        await persist(record);
        if (announce && emit) {
          await emit(
            "drift.cleared",
            { entityType: record.entityType, entityId: record.entityId, field: record.field, reason: "converged with the authoritative source" },
            { source: "ru", subject: { entityType: record.entityType, entityId: record.entityId } }
          );
        }
      }
    }

    if (announce && emit) {
      for (const record of changed) {
        await emit(
          "drift.detected",
          { entityType: record.entityType, entityId: record.entityId, field: record.field, kind: record.kind, severity: record.severity, held: record.held, expected: record.expected },
          { source: "ru", subject: { entityType: record.entityType, entityId: record.entityId } }
        );
      }
    }

    const openRecords = open();
    let alertsRaised = 0;
    let alertsCleared = 0;
    if (notify && alerts) {
      const groups = groupSignals(openRecords);
      for (const group of groups.values()) {
        const result = await alerts.raise(alertSummary(group));
        if (!result.deduped) alertsRaised += 1;
      }
      const liveKeys = new Set(groups.keys());
      for (const alert of alerts.list({ category: "drift", openOnly: true })) {
        if (!liveKeys.has(alert.key)) {
          await alerts.clear(alert.key, { reason: "drift resolved" });
          alertsCleared += 1;
        }
      }
    }

    const byKind = {};
    const bySeverity = {};
    for (const record of openRecords) {
      byKind[record.kind] = (byKind[record.kind] || 0) + 1;
      bySeverity[record.severity] = (bySeverity[record.severity] || 0) + 1;
    }

    return {
      at: now,
      found: found.length,
      opened,
      updated,
      resolved,
      open: openRecords.length,
      alertsRaised,
      alertsCleared,
      byKind,
      bySeverity,
    };
  }

  function entries() {
    return Array.from(ledger.values());
  }

  function open() {
    return entries()
      .filter((record) => record.status === "open")
      .sort((a, b) => (b.severity === "error" ? 1 : 0) - (a.severity === "error" ? 1 : 0) || a.entityName.localeCompare(b.entityName) || a.field.localeCompare(b.field));
  }

  function resolved() {
    return entries()
      .filter((record) => record.status === "resolved")
      .sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt)));
  }

  function forEntity(typeId, entityId) {
    return entries().filter((record) => record.entityType === typeId && record.entityId === entityId);
  }

  function stage(record) {
    return (conflicts && record.kind === "field-conflict") ? conflicts.ruleFor({
      typeId: record.entityType,
      entityId: record.entityId,
      entityName: record.entityName,
      field: record.field,
      label: record.label,
      owner: record.owner,
      ownerName: record.ownerName,
      direction: record.direction,
      sensitive: record.sensitive,
      held: record.held,
      ownerHeld: record.expected,
    }) : null;
  }

  function suggest(record) {
    if (record.kind === "link-drift") return { kind: "link.rebuild", target: {}, label: "Rebuild the link graph" };
    return { kind: "sync.field", target: { entityType: record.entityType, entityId: record.entityId, field: record.field }, label: "Sync this field from its owner" };
  }

  function stats() {
    const openRecords = open();
    const resolvedRecords = resolved();
    const byKind = {};
    const bySeverity = {};
    for (const record of openRecords) {
      byKind[record.kind] = (byKind[record.kind] || 0) + 1;
      bySeverity[record.severity] = (bySeverity[record.severity] || 0) + 1;
    }
    return {
      total: ledger.size,
      open: openRecords.length,
      resolved: resolvedRecords.length,
      critical: openRecords.filter((record) => record.sensitive).length,
      byKind,
      bySeverity,
    };
  }

  async function reset() {
    ledger.clear();
    if (db) await db.clear(collection);
  }

  return {
    collection,
    scan,
    signals,
    entries,
    open,
    resolved,
    forEntity,
    stage,
    suggest,
    stats,
    hydrate,
    reset,
    alertSeverityFor,
    alertKeyFor,
  };
}
