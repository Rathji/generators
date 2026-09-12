import { hash36 } from "./ids.js";

const CLOSED_TICKET_STATUSES = ["closed", "resolved", "cancelled"];

function isOpenTicket(entity) {
  const status = String(entity?.fields?.status ?? "").toLowerCase();
  if (!status) return false;
  return !CLOSED_TICKET_STATUSES.includes(status);
}

export const DERIVATIONS = {
  "company.assetCount": ({ linker, id }) => linker.incoming("company", id, "device.company").length,
  "company.openTicketCount": ({ linker, identity, id }) =>
    linker.incoming("company", id, "ticket.company").filter((edge) => isOpenTicket(identity.get("ticket", edge.fromId))).length,
  "device.openTicketCount": ({ linker, identity, id }) =>
    linker.incoming("device", id, "ticket.linkedDevice").filter((edge) => isOpenTicket(identity.get("ticket", edge.fromId))).length,
  "customer.openTicketCount": ({ linker, identity, id }) => {
    let total = 0;
    for (const edge of linker.outgoing("customer", id, "customer.company")) {
      total += linker.incoming("company", edge.toId, "ticket.company").filter((e) => isOpenTicket(identity.get("ticket", e.fromId))).length;
    }
    return total;
  },
  "customer.lastSeenDevice": ({ linker, identity, id }) => {
    let best = null;
    for (const edge of linker.incoming("customer", id, "device.assignedTo")) {
      const device = identity.get("device", edge.fromId);
      const at = device?.fields?.lastCheckIn;
      if (at && (!best || String(at) > String(best.at))) best = { at, name: identity.nameOf("device", device) };
    }
    return best ? best.name : null;
  },
};

export function createReferenceResolver({ identity, registry, linker, sources = null, emit = null, clock = () => Date.now() } = {}) {
  if (!identity || !registry) throw new Error("createReferenceResolver requires identity and registry");

  function sourceFields(connectorId, typeId, nativeId) {
    if (!sources) return null;
    const fields = sources(connectorId, typeId, nativeId);
    return fields && typeof fields === "object" ? fields : null;
  }

  function ownerValue(typeId, entityId, fieldKey) {
    const field = registry.field(typeId, fieldKey);
    if (!field || !field.owner) return undefined;
    const entity = identity.get(typeId, entityId);
    if (!entity) return undefined;
    const ref = (entity.refs || []).find((entry) => entry.connector === field.owner);
    if (!ref) return undefined;
    const fields = sourceFields(field.owner, typeId, ref.nativeId);
    if (!fields || !(fieldKey in fields)) return undefined;
    return fields[fieldKey];
  }

  function fieldReference(typeId, entityId, fieldKey) {
    const entity = identity.get(typeId, entityId);
    if (!entity) return { ok: false, error: `Unknown ${typeId} "${entityId}"` };
    const field = registry.field(typeId, fieldKey);
    const held = entity.fields?.[fieldKey] ?? null;
    const heldPresent = held != null && String(held).trim() !== "";
    const heldSource = entity.fieldSources?.[fieldKey] || null;
    const heldSourceName = heldSource ? registry.connector(heldSource)?.name || heldSource : null;

    if (!field) {
      return {
        ok: true,
        typeId,
        entityId,
        entityName: identity.nameOf(typeId, entity),
        field: fieldKey,
        label: fieldKey,
        owner: null,
        ownerName: null,
        direction: null,
        status: "unregistered",
        held,
        heldPresent,
        heldSource,
        heldSourceName,
        value: held,
        drift: false,
        authoritative: null,
      };
    }

    const connector = registry.connector(field.owner);
    const base = {
      ok: true,
      typeId,
      entityId,
      entityName: identity.nameOf(typeId, entity),
      field: fieldKey,
      label: field.label,
      owner: field.owner,
      ownerName: connector ? connector.name : field.owner,
      direction: field.direction,
      computed: !!field.computed,
      sensitive: !!field.sensitive,
      held,
      heldPresent,
      heldSource,
      heldSourceName,
    };

    if (field.direction === "none") {
      return { ...base, status: "private", resolver: "local", value: held, drift: false, authoritative: { value: held, kind: "hub-local" } };
    }

    if (field.computed || field.direction === "pull") {
      const derive = DERIVATIONS[`${typeId}.${fieldKey}`];
      const derived = derive ? derive({ identity, linker, registry, typeId, entityId, id: entityId, entity }) : undefined;
      const derivable = derived !== undefined;
      const drift = derivable && heldPresent && derived != null && String(derived) !== String(held);
      return {
        ...base,
        status: drift ? "stale" : derivable ? "derived" : heldPresent ? "cached" : "missing",
        resolver: derivable ? "hub-derivation" : "owner-fetch",
        value: derivable ? derived : held,
        drift,
        authoritative: derivable ? { value: derived, kind: "derived" } : { value: null, kind: "owner-only" },
      };
    }

    const isOwner = !!heldSource && heldSource === field.owner;
    const ownerHeld = ownerValue(typeId, entityId, fieldKey);
    const hasOwnerHeld = ownerHeld !== undefined;
    const conflict = !isOwner && heldPresent && hasOwnerHeld && String(ownerHeld) !== String(held);
    const status = !heldPresent ? "missing" : isOwner ? "owner" : conflict ? "conflict" : "copy";
    return {
      ...base,
      status,
      resolver: "owner-fetch",
      value: isOwner ? held : hasOwnerHeld ? ownerHeld : held,
      drift: conflict,
      conflict,
      ownerHeld: hasOwnerHeld ? ownerHeld : null,
      authoritative: isOwner ? { value: held, kind: "held-from-owner" } : hasOwnerHeld ? { value: ownerHeld, kind: "owner" } : { value: null, kind: "owner-only" },
    };
  }

  function entityReference(typeId, entityId) {
    const entity = identity.get(typeId, entityId);
    if (!entity) return [];
    const declared = registry.fieldsFor(typeId).map((field) => field.key);
    const extra = Object.keys(entity.fields || {}).filter((key) => !declared.includes(key));
    return [...declared, ...extra].map((key) => fieldReference(typeId, entityId, key));
  }

  async function fetch(typeId, entityId, fieldKey) {
    const reference = fieldReference(typeId, entityId, fieldKey);
    if (!reference.ok) return reference;
    const entity = identity.get(typeId, entityId);
    const jobId = `job_${hash36(`${typeId}:${entityId}:${fieldKey}:${clock()}`)}`;

    if (emit && reference.owner) {
      await emit("sync.requested", { connector: reference.owner, entityType: typeId, entityId, fields: [fieldKey] }, { source: "iu", subject: { entityType: typeId, entityId } });
    }

    let value = null;
    let source = null;
    if (reference.authoritative && reference.authoritative.kind === "derived" && reference.authoritative.value != null) {
      value = reference.authoritative.value;
      source = "hub-derivation";
    }
    if (value == null && reference.owner && entity) {
      const ownerRef = (entity.refs || []).find((ref) => ref.connector === reference.owner);
      if (ownerRef) {
        const fields = sourceFields(reference.owner, typeId, ownerRef.nativeId);
        if (fields && fieldKey in fields) {
          value = fields[fieldKey];
          source = "owner";
        }
      }
    }
    if (value == null) {
      value = reference.held ?? null;
      source = "cached";
    }

    const differs = value != null && String(value) !== String(reference.held ?? "");
    if (emit && reference.owner) {
      await emit("sync.completed", { jobId, connector: reference.owner, entityType: typeId, entityId, changes: differs ? 1 : 0 }, { source: "iu", subject: { entityType: typeId, entityId } });
    }

    return { ...reference, fetched: { jobId, value, source, differs } };
  }

  async function refresh(typeId, entityId, fieldKey, { adopt = true } = {}) {
    const result = await fetch(typeId, entityId, fieldKey);
    if (!result.ok) return result;
    if (!adopt || !result.fetched) return result;
    const value = result.fetched.value;
    if (value == null) return { ...result, adopted: false };
    const sourceConnector = result.fetched.source === "owner" ? result.owner : "iu";
    await identity.setField(typeId, entityId, fieldKey, value, sourceConnector);
    return { ...result, adopted: true, adoptedValue: value, adoptedSource: sourceConnector };
  }

  function scanDrift() {
    const copies = [];
    const conflicts = [];
    const stale = [];
    for (const type of registry.entityTypes) {
      for (const entity of identity.all(type.id)) {
        for (const reference of entityReference(type.id, entity.id)) {
          if (reference.status === "copy") copies.push(reference);
          else if (reference.status === "conflict") conflicts.push(reference);
          else if (reference.status === "stale") stale.push(reference);
        }
      }
    }
    return { copies, conflicts, stale, total: copies.length + conflicts.length + stale.length };
  }

  function stats() {
    const { copies, conflicts, stale } = scanDrift();
    return { copies: copies.length, conflicts: conflicts.length, stale: stale.length, total: copies.length + conflicts.length + stale.length };
  }

  return {
    derivations: DERIVATIONS,
    fieldReference,
    entityReference,
    ownerValue,
    fetch,
    refresh,
    scanDrift,
    stats,
  };
}
