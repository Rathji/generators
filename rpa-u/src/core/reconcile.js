const SEVERITY = {
  "unresolved-reference": "warning",
  "inconsistent-link": "error",
  "field-conflict": "error",
  "copy-drift": "info",
  "stale-value": "warning",
  "duplicate-identity": "info",
  "orphan-link": "error",
};

export const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

export function createReconciler({ identity, registry, linker, references, merge = null, db = null, collection = "reconcile", clock = () => Date.now() } = {}) {
  if (!identity || !registry) throw new Error("createReconciler requires identity and registry");
  const dismissed = new Set();

  async function hydrate() {
    for (const record of db ? db.all(collection) : []) {
      if (record && record.id) dismissed.add(record.id);
    }
    return dismissed.size;
  }

  function finding(base) {
    return { severity: SEVERITY[base.kind] || "warning", actions: [], ...base };
  }

  function unresolvedFindings() {
    const out = [];
    if (!linker) return out;
    for (const record of linker.report({ status: ["dangling", "ambiguous", "missing"] })) {
      const exact = record.candidates.filter((candidate) => candidate.score >= 1).length;
      const detail =
        record.status === "dangling"
          ? `No ${record.toType} in the directory matches “${record.raw}”.`
          : record.status === "ambiguous"
            ? `${exact} ${record.toType} records match “${record.raw}”.`
            : `A required ${record.toType} reference is empty.`;
      out.push(
        finding({
          key: `unresolved:${record.fromType}:${record.fromId}:${record.field}`,
          kind: "unresolved-reference",
          title: `${record.fromName} → ${record.field} is unresolved`,
          detail,
          entity: { typeId: record.fromType, id: record.fromId, name: record.fromName },
          field: record.field,
          linkTypeId: record.linkTypeId,
          toType: record.toType,
          status: record.status,
          raw: record.raw,
          candidates: record.candidates,
          actions: record.status === "missing" ? ["dismiss"] : ["link", "dismiss"],
        })
      );
    }
    return out;
  }

  function inconsistentLinkFindings() {
    const out = [];
    if (!linker) return out;
    for (const edge of linker.store.byType("ticket.linkedDevice")) {
      const ticket = identity.get("ticket", edge.fromId);
      const device = identity.get("device", edge.toId);
      if (!ticket || !device) continue;
      const ticketCompany = linker.store.outgoing("ticket", ticket.id).find((e) => e.type === "ticket.company");
      const deviceCompany = linker.store.outgoing("device", device.id).find((e) => e.type === "device.company");
      if (!ticketCompany || !deviceCompany || ticketCompany.toId === deviceCompany.toId) continue;
      const ticketCompanyEntity = identity.get("company", ticketCompany.toId);
      const deviceCompanyEntity = identity.get("company", deviceCompany.toId);
      out.push(
        finding({
          key: `inconsistent:ticket:${ticket.id}`,
          kind: "inconsistent-link",
          title: `${identity.nameOf("ticket", ticket)} links a device from another company`,
          detail: `The ticket is raised for ${identity.nameOf("company", ticketCompanyEntity)} but ${identity.nameOf("device", device)} belongs to ${identity.nameOf("company", deviceCompanyEntity)}.`,
          entity: { typeId: "ticket", id: ticket.id, name: identity.nameOf("ticket", ticket) },
          field: "company",
          linkTypeId: "ticket.company",
          toType: "company",
          candidates: [
            { typeId: "company", entityId: deviceCompany.toId, name: identity.nameOf("company", deviceCompanyEntity), score: 1, reason: "company of the linked device" },
            { typeId: "company", entityId: ticketCompany.toId, name: identity.nameOf("company", ticketCompanyEntity), score: 1, reason: "current ticket company" },
          ],
          actions: ["link", "dismiss"],
        })
      );
    }
    return out;
  }

  function driftFindings() {
    const out = [];
    if (!references) return out;
    const { copies, conflicts, stale } = references.scanDrift();
    for (const reference of conflicts) {
      out.push(
        finding({
          key: `conflict:${reference.typeId}:${reference.entityId}:${reference.field}`,
          kind: "field-conflict",
          title: `${reference.entityName} · ${reference.label} disagrees with its owner`,
          detail: `${reference.ownerName} owns this field and reports “${reference.ownerHeld}”, but the hub holds “${reference.held}” from ${reference.heldSourceName || "an unknown source"}.`,
          entity: { typeId: reference.typeId, id: reference.entityId, name: reference.entityName },
          field: reference.field,
          owner: reference.owner,
          ownerName: reference.ownerName,
          held: reference.held,
          ownerHeld: reference.ownerHeld,
          heldSource: reference.heldSource,
          heldSourceName: reference.heldSourceName,
          actions: ["refresh", "dismiss"],
        })
      );
    }
    for (const reference of copies) {
      out.push(
        finding({
          key: `copy:${reference.typeId}:${reference.entityId}:${reference.field}`,
          kind: "copy-drift",
          title: `${reference.entityName} · ${reference.label} is a copy, not a reference`,
          detail: `The hub holds “${reference.held}” from ${reference.heldSourceName || "an unknown source"}, but ${reference.ownerName} owns this field. The value happens to agree, so this is hygiene rather than a conflict.`,
          entity: { typeId: reference.typeId, id: reference.entityId, name: reference.entityName },
          field: reference.field,
          owner: reference.owner,
          ownerName: reference.ownerName,
          held: reference.held,
          ownerHeld: reference.ownerHeld,
          heldSource: reference.heldSource,
          heldSourceName: reference.heldSourceName,
          actions: ["refresh", "dismiss"],
        })
      );
    }
    for (const reference of stale) {
      out.push(
        finding({
          key: `stale:${reference.typeId}:${reference.entityId}:${reference.field}`,
          kind: "stale-value",
          title: `${reference.entityName} · ${reference.label} is out of date`,
          detail: `The hub cached ${JSON.stringify(reference.held)}, but recomputing from the linked records gives ${JSON.stringify(reference.authoritative?.value)}.`,
          entity: { typeId: reference.typeId, id: reference.entityId, name: reference.entityName },
          field: reference.field,
          owner: reference.owner,
          ownerName: reference.ownerName,
          held: reference.held,
          derived: reference.authoritative?.value ?? null,
          actions: ["refresh", "dismiss"],
        })
      );
    }
    return out;
  }

  function duplicateFindings() {
    const out = [];
    for (const duplicate of identity.findDuplicates()) {
      const keep = identity.get(duplicate.type, duplicate.keepId);
      const drop = identity.get(duplicate.type, duplicate.dropId);
      if (!keep || !drop) continue;
      out.push(
        finding({
          key: `duplicate:${duplicate.type}:${duplicate.keepId}:${duplicate.dropId}`,
          kind: "duplicate-identity",
          title: `${identity.nameOf(duplicate.type, keep)} may be the same as ${identity.nameOf(duplicate.type, drop)}`,
          detail: duplicate.reason,
          entity: { typeId: duplicate.type, id: duplicate.keepId, name: identity.nameOf(duplicate.type, keep) },
          type: duplicate.type,
          keepId: duplicate.keepId,
          dropId: duplicate.dropId,
          confidence: duplicate.confidence,
          actions: ["merge", "dismiss"],
        })
      );
    }
    return out;
  }

  function orphanFindings() {
    const out = [];
    if (!linker) return out;
    for (const edge of linker.store.all()) {
      const from = identity.get(edge.fromType, edge.fromId);
      const to = identity.get(edge.toType, edge.toId);
      if (from && to) continue;
      out.push(
        finding({
          key: `orphan:${edge.id}`,
          kind: "orphan-link",
          title: `Dangling link ${edge.fromType} → ${edge.toType}`,
          detail: `${edge.fromType} ${edge.fromId} or ${edge.toType} ${edge.toId} no longer exists.`,
          entity: { typeId: edge.fromType, id: edge.fromId, name: edge.fromId },
          linkTypeId: edge.type,
          edgeId: edge.id,
          actions: ["prune", "dismiss"],
        })
      );
    }
    return out;
  }

  function allFindings() {
    const out = [
      ...inconsistentLinkFindings(),
      ...driftFindings(),
      ...unresolvedFindings(),
      ...duplicateFindings(),
      ...orphanFindings(),
    ];
    return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  }

  function findings({ includeDismissed = false, minSeverity = null, kind = null } = {}) {
    const max = minSeverity == null ? null : SEVERITY_ORDER[minSeverity];
    return allFindings().filter((item) => {
      if (!includeDismissed && dismissed.has(item.key)) return false;
      if (max != null && SEVERITY_ORDER[item.severity] > max) return false;
      if (kind && item.kind !== kind) return false;
      return true;
    });
  }

  function groupedByKind(opts = {}) {
    const groups = {};
    for (const item of findings(opts)) {
      if (!groups[item.kind]) groups[item.kind] = { kind: item.kind, severity: item.severity, items: [] };
      groups[item.kind].items.push(item);
    }
    return Object.values(groups).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.kind.localeCompare(b.kind));
  }

  function copyHygiene() {
    const groups = new Map();
    for (const item of allFindings()) {
      if (item.kind !== "copy-drift" || dismissed.has(item.key)) continue;
      const key = `${item.entity.typeId}:${item.entity.id}`;
      if (!groups.has(key)) groups.set(key, { entity: item.entity, ownerNames: new Set(), fields: [] });
      const group = groups.get(key);
      group.ownerNames.add(item.ownerName);
      group.fields.push({ field: item.field, label: item.title.split(" · ")[1] || item.field, held: item.held, heldSourceName: item.heldSourceName, ownerName: item.ownerName, key: item.key });
    }
    return Array.from(groups.values())
      .map((group) => ({ ...group, ownerNames: Array.from(group.ownerNames) }))
      .sort((a, b) => b.fields.length - a.fields.length || a.entity.name.localeCompare(b.entity.name));
  }

  function dismissedFindings() {
    return allFindings().filter((item) => dismissed.has(item.key));
  }

  async function dismiss(key, meta = {}) {
    dismissed.add(key);
    if (db) await db.put(collection, key, { id: key, at: new Date(clock()).toISOString(), ...meta });
    return true;
  }

  async function restore(key) {
    dismissed.delete(key);
    if (db) await db.remove(collection, key);
    return true;
  }

  async function reset() {
    dismissed.clear();
    if (db) await db.clear(collection);
    return true;
  }

  async function resolve(item, action, payload = {}) {
    switch (action) {
      case "link": {
        const targetId = payload.toId || (item.candidates && item.candidates[0] && item.candidates[0].entityId);
        if (!targetId) return { ok: false, error: "No target entity supplied." };
        const result = await linker.override({
          fromType: item.entity.typeId,
          fromId: item.entity.id,
          field: item.field,
          toType: item.toType || "company",
          toId: targetId,
          note: `reconciled ${item.kind}`,
        });
        return result;
      }
      case "merge": {
        if (!merge) return { ok: false, error: "Merging is unavailable." };
        const keep = await merge(item.type, item.keepId, item.dropId, { confidence: item.confidence });
        return { ok: true, keep };
      }
      case "refresh": {
        if (!references) return { ok: false, error: "Reference resolution is unavailable." };
        return references.refresh(item.entity.typeId, item.entity.id, item.field);
      }
      case "prune": {
        if (!linker) return { ok: false, error: "Linking is unavailable." };
        const removed = await linker.store.removeWhere((edge) => !identity.get(edge.fromType, edge.fromId) || !identity.get(edge.toType, edge.toId));
        return { ok: true, removed };
      }
      case "dismiss":
        await dismiss(item.key, { kind: item.kind });
        return { ok: true, dismissed: true };
      default:
        return { ok: false, error: `Unknown reconciliation action "${action}".` };
    }
  }

  function stats() {
    const out = allFindings();
    const byKind = {};
    const bySeverity = {};
    let open = 0;
    for (const item of out) {
      byKind[item.kind] = (byKind[item.kind] || 0) + 1;
      bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
      if (!dismissed.has(item.key)) open += 1;
    }
    return { total: out.length, open, dismissed: out.length - open, byKind, bySeverity };
  }

  return {
    collection,
    hydrate,
    findings,
    groupedByKind,
    copyHygiene,
    dismissedFindings,
    allFindings,
    dismiss,
    restore,
    reset,
    resolve,
    stats,
  };
}
