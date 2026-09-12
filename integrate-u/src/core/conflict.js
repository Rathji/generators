export const SETTLEMENT_RULES = [
  {
    id: "owner-authoritative",
    direction: "push",
    title: "Owner wins",
    settlement: "The connector that owns the field is authoritative; a value written by anyone else is replaced.",
  },
  {
    id: "owner-wins-two-way",
    direction: "bidirectional",
    title: "Owner breaks the tie",
    settlement: "Either side may propose a change, but when the values differ the owner's value is adopted.",
  },
  {
    id: "hub-derivation",
    direction: "pull",
    title: "Recompute from the graph",
    settlement: "Derived fields are recomputed from linked records rather than read from any single connector.",
  },
  {
    id: "hub-local",
    direction: "none",
    title: "Hub keeps it",
    settlement: "Fields that are never synced stay exactly as the hub holds them.",
  },
];

const RULE_BY_DIRECTION = Object.fromEntries(SETTLEMENT_RULES.map((rule) => [rule.direction, rule]));

function text(value) {
  return value == null ? null : String(value);
}

export function createConflictResolver({ identity, registry, references, db = null, collection = "conflicts", emit = null, clock = () => Date.now() } = {}) {
  if (!identity || !registry || !references) throw new Error("createConflictResolver requires identity, registry and references");

  function iso(at = clock()) {
    return new Date(at).toISOString();
  }

  function keyOf(typeId, entityId, field) {
    return `${typeId}:${entityId}:${field}`;
  }

  function fingerprint(decision) {
    return `${keyOf(decision.entityType, decision.entityId, decision.field)}|${decision.rule}|${text(decision.held)}->${text(decision.ownerHeld)}`;
  }

  function detect() {
    return references.scanDrift().conflicts;
  }

  function ruleFor(reference) {
    const field = registry.field(reference.typeId, reference.field);
    const direction = reference.direction || field?.direction || "push";
    const ownerName = reference.ownerName || reference.owner || "The owner";
    const base = {
      key: keyOf(reference.typeId, reference.entityId, reference.field),
      entityType: reference.typeId,
      entityId: reference.entityId,
      entityName: reference.entityName,
      field: reference.field,
      label: reference.label || reference.field,
      owner: reference.owner || null,
      ownerName: reference.ownerName || reference.owner || null,
      direction,
      sensitive: !!reference.sensitive,
      held: text(reference.held),
      heldSource: reference.heldSource || null,
      heldSourceName: reference.heldSourceName || null,
      ownerHeld: text(reference.ownerHeld),
    };

    if (!field) {
      return { ...base, rule: "unregistered", winner: "hub", value: reference.held ?? null, auto: false, reason: "This field is not declared in the integration registry, so no ownership rule applies." };
    }
    if (direction === "none") {
      return {
        ...base,
        rule: "hub-local",
        winner: "hub",
        value: reference.held ?? null,
        auto: false,
        reason: `${base.label} is hub-local — it is not shared with any connector, so the hub value stands.`,
      };
    }
    if (field.computed || direction === "pull") {
      const derived = reference.authoritative && reference.authoritative.kind === "derived" ? reference.authoritative.value : undefined;
      if (derived != null) {
        return {
          ...base,
          rule: "hub-derivation",
          winner: "derived",
          value: derived,
          auto: true,
          reason: `${base.label} is derived by the hub from linked records, so the recomputed value wins over anything cached.`,
        };
      }
      if (reference.ownerHeld != null) {
        return {
          ...base,
          rule: "owner-pull",
          winner: "owner",
          value: reference.ownerHeld,
          auto: true,
          reason: `${base.label} is pulled on demand from ${ownerName}, so its value is adopted.`,
        };
      }
      return { ...base, rule: "owner-silent", winner: "hub", value: reference.held ?? null, auto: false, reason: "No authoritative value is available; the hub keeps what it holds." };
    }
    if (reference.ownerHeld == null) {
      return {
        ...base,
        rule: "owner-silent",
        winner: "hub",
        value: reference.held ?? null,
        auto: false,
        reason: `${ownerName} reports no value for ${base.label}, so the hub value is retained.`,
      };
    }
    const rule = direction === "bidirectional" ? "owner-wins-two-way" : "owner-authoritative";
    const reason =
      direction === "bidirectional"
        ? `${ownerName} owns ${base.label} and wins ties on two-way fields — the hub value was only a proposal.`
        : `${ownerName} is the authoritative source for ${base.label}, so the hub copy is replaced.`;
    return { ...base, rule, winner: "owner", value: reference.ownerHeld, auto: true, reason };
  }

  function plan() {
    return detect()
      .map((reference) => {
        const decision = ruleFor(reference);
        return { ...decision, fingerprint: fingerprint(decision), status: "open" };
      })
      .sort((a, b) => Number(b.auto) - Number(a.auto) || a.entityName.localeCompare(b.entityName) || a.field.localeCompare(b.field));
  }

  function history() {
    return (db ? db.all(collection) : [])
      .map((record) => ({ ...record }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  function recordFor(decision) {
    if (!db) return null;
    return db.get(collection, decision.key) || null;
  }

  async function resolve(decision, { apply = true } = {}) {
    const fp = decision.fingerprint || fingerprint(decision);
    const existing = recordFor(decision);
    if (existing && existing.fingerprint === fp) {
      return { ok: true, applied: false, reused: true, decision, record: existing };
    }
    if (apply && decision.value != null && decision.entityType && decision.entityId) {
      const source = decision.winner === "owner" ? decision.owner || "iu" : "iu";
      await identity.setField(decision.entityType, decision.entityId, decision.field, decision.value, source);
    }
    const record = {
      id: decision.key,
      key: decision.key,
      entityType: decision.entityType,
      entityId: decision.entityId,
      entityName: decision.entityName,
      field: decision.field,
      label: decision.label,
      owner: decision.owner,
      ownerName: decision.ownerName,
      direction: decision.direction,
      rule: decision.rule,
      winner: decision.winner,
      held: decision.held,
      ownerHeld: decision.ownerHeld,
      value: decision.value,
      fingerprint: fp,
      applied: !!apply,
      at: iso(),
    };
    if (db) await db.put(collection, record.key, record);
    if (emit) {
      await emit(
        "conflict.resolved",
        { entityType: record.entityType, entityId: record.entityId, field: record.field, owner: record.owner, winner: record.winner, rule: record.rule },
        { source: "iu", subject: { entityType: record.entityType, entityId: record.entityId } }
      );
    }
    return { ok: true, applied: !!apply, reused: false, decision, record };
  }

  async function resolveAll() {
    const decisions = plan();
    let resolved = 0;
    let skipped = 0;
    for (const decision of decisions) {
      if (!decision.auto || decision.value == null) {
        skipped += 1;
        continue;
      }
      const result = await resolve(decision);
      if (result.applied) resolved += 1;
      else skipped += 1;
    }
    return { resolved, skipped, remaining: plan().filter((decision) => !decision.auto).length };
  }

  async function announce() {
    let count = 0;
    for (const decision of plan()) {
      if (emit) {
        await emit(
          "conflict.detected",
          { entityType: decision.entityType, entityId: decision.entityId, field: decision.field, owner: decision.owner, held: decision.held, ownerHeld: decision.ownerHeld },
          { source: "iu", subject: { entityType: decision.entityType, entityId: decision.entityId } }
        );
      }
      count += 1;
    }
    return count;
  }

  async function simulate({ entityType, entityId, field, value, source = null }) {
    const fieldDef = registry.field(entityType, field);
    const ownerId = fieldDef?.owner || null;
    const writer = source || registry.connectors.find((connector) => connector.id !== ownerId && connector.id !== "iu")?.id || "iu";
    const entity = identity.get(entityType, entityId);
    if (!entity) return { ok: false, error: `Unknown ${entityType} "${entityId}".` };
    const before = entity.fields?.[field] ?? null;
    await identity.setField(entityType, entityId, field, value, writer);
    const reference = references.fieldReference(entityType, entityId, field);
    const decision = reference.status === "conflict" ? ruleFor(reference) : null;
    if (decision && emit) {
      await emit(
        "conflict.detected",
        { entityType, entityId, field, owner: decision.owner, held: decision.held, ownerHeld: decision.ownerHeld },
        { source: writer, subject: { entityType, entityId } }
      );
    }
    return { ok: true, reference, decision, before, writer, owner: ownerId };
  }

  function stats() {
    const open = plan();
    const records = history();
    const byDirection = {};
    const byWinner = {};
    for (const decision of open) byDirection[decision.direction] = (byDirection[decision.direction] || 0) + 1;
    for (const record of records) byWinner[record.winner] = (byWinner[record.winner] || 0) + 1;
    return {
      open: open.length,
      auto: open.filter((decision) => decision.auto).length,
      manual: open.filter((decision) => !decision.auto).length,
      resolved: records.length,
      byDirection,
      byWinner,
      sensitive: open.filter((decision) => decision.sensitive).length,
    };
  }

  async function reset() {
    if (db) await db.clear(collection);
  }

  return {
    collection,
    rules: SETTLEMENT_RULES,
    ruleForDirection: (direction) => RULE_BY_DIRECTION[direction] || null,
    ruleFor,
    plan,
    detect,
    history,
    resolve,
    resolveAll,
    announce,
    simulate,
    stats,
    reset,
    keyOf,
    fingerprint,
  };
}
