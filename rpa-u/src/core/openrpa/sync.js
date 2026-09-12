import { hash36 } from "../ids.js";
import { OPENRPA_SYNC_COLLECTION } from "./constants.js";
import { OPENRPA_REMOTE_FIELDS, priorityOf } from "./ownership.js";

export const OPENRPA_SYNC_POLICIES = ["manual", "prefer-hub", "prefer-openrpa"];

export const OPENRPA_SYNC_POLICY_LABELS = {
  manual: "Manual review",
  "prefer-hub": "Prefer hub",
  "prefer-openrpa": "Prefer OpenRPA",
};

export const OPENRPA_SYNC_POLICY_NOTES = {
  manual: "Nothing is applied automatically — every proposal waits for an operator to approve or reject it.",
  "prefer-hub": "The hub's value wins: divergences are pushed back into OpenFlow.",
  "prefer-openrpa": "OpenRPA wins: the hub adopts the value its linked OpenFlow record reports.",
};

export const OPENRPA_SYNC_ACTIONS = {
  adopt: "Adopt the OpenRPA value into the hub",
  push: "Push the hub value into OpenFlow",
  capture: "Accept the OpenFlow version as the new baseline",
  unlink: "Remove the dangling link",
  review: "Leave for manual review",
};

function clean(value) {
  return value == null ? "" : String(value);
}

function parsePayload(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }
  return {};
}

export function createOpenRpaSyncService({
  identity = null,
  registry = null,
  drift = null,
  linking = null,
  documents = null,
  db = null,
  collection = OPENRPA_SYNC_COLLECTION,
  clock = () => Date.now(),
} = {}) {
  const changes = [];
  const counters = { reconciles: 0, applied: 0, adopted: 0, pushed: 0, captured: 0, unlinked: 0, skipped: 0, errors: 0 };
  let seqCounter = 0;
  let lastPolicy = "manual";
  let lastAt = null;
  let lastError = null;

  const iso = () => new Date(clock()).toISOString();

  function fieldDef(entityType, fieldKey) {
    return registry ? registry.field(entityType, fieldKey) : null;
  }

  function targetDescriptor(targetType) {
    if (!linking) return null;
    return linking.targetTypes.find((entry) => entry.id === targetType) || null;
  }

  function decide(signal, policy) {
    const field = signal.field ? fieldDef(signal.entityType, signal.field) : null;
    const direction = field ? field.direction : null;
    const owner = field ? field.owner : null;
    const base = {
      kind: signal.kind,
      entityType: signal.entityType,
      entityId: signal.entityId,
      entityName: signal.entityName,
      field: signal.field || null,
      label: signal.label,
      targetType: signal.targetType,
      targetId: signal.targetId,
      targetName: signal.targetName,
      hubValue: signal.kind === "field" ? signal.held : null,
      remoteValue: signal.kind === "field" ? signal.expected : null,
      held: signal.held,
      expected: signal.expected,
      direction,
      owner,
      ownerName: owner && registry && registry.connector(owner) ? registry.connector(owner).name : owner,
      priority: owner ? priorityOf(owner) : 0,
      severity: signal.severity,
    };

    if (signal.kind === "relationship") {
      return {
        ...base,
        winner: null,
        action: policy === "manual" ? "review" : "unlink",
        auto: policy !== "manual",
        reason: "A dangling link cannot be repaired automatically — the OpenFlow record is gone.",
      };
    }
    if (signal.kind === "record") {
      return {
        ...base,
        winner: policy === "prefer-hub" ? "hub" : "openrpa",
        action: policy === "manual" ? "review" : "capture",
        auto: policy !== "manual",
        reason: "The linked record moved on; accepting its version re-baselines the drift without changing any field.",
      };
    }
    if (direction === "none") {
      return { ...base, winner: "hub", action: "review", auto: false, reason: "This field is hub-local and is not synchronised with OpenRPA." };
    }
    if (policy === "prefer-openrpa") {
      return { ...base, winner: "openrpa", action: "adopt", auto: true, reason: `${base.ownerName || "OpenRPA"} wins under the prefer-OpenRPA policy.` };
    }
    if (policy === "prefer-hub") {
      return { ...base, winner: "hub", action: "push", auto: true, reason: "The hub wins under the prefer-hub policy and pushes its value back into OpenFlow." };
    }
    const defaultWinner = direction === "push" ? "openrpa" : priorityOf(owner) >= priorityOf("ru") ? "openrpa" : "hub";
    return { ...base, winner: defaultWinner, action: "review", auto: false, reason: "Manual review: nothing is applied until an operator decides." };
  }

  function proposals({ policy = lastPolicy } = {}) {
    if (!drift) return [];
    return drift.open().map((signal) => {
      const decision = decide(signal, policy);
      return { id: signal.key, policy, ...decision };
    });
  }

  async function mergePayload(collectionName, document, patch) {
    const merged = { ...patch };
    if (patch.payload) {
      const existing = parsePayload(document.values ? document.values.payload : null);
      merged.payload = { ...existing, ...patch.payload };
    }
    return merged;
  }

  async function pushField(proposal) {
    const descriptor = targetDescriptor(proposal.targetType);
    if (!documents) return { ok: false, error: "No OpenFlow document service is available." };
    if (!descriptor || !descriptor.collection) return { ok: false, error: `Cannot write to a ${proposal.targetType} target.` };
    const spec = OPENRPA_REMOTE_FIELDS[proposal.field];
    if (!spec) return { ok: false, error: `Field "${proposal.field}" has no OpenFlow mapping.` };
    const got = await documents.get(descriptor.collection, proposal.targetId);
    if (!got || got.ok === false) return { ok: false, error: got && got.error ? got.error.message : "The linked document could not be read." };
    if (!got.document) return { ok: false, error: `The ${proposal.targetType} ${proposal.targetId} no longer exists.` };
    const patch = await mergePayload(descriptor.collection, got.document, spec.write(proposal.hubValue));
    const result = await documents.update(descriptor.collection, { _id: proposal.targetId, _version: got.document.version, ...patch });
    if (!result || result.ok === false) return { ok: false, error: result && result.error ? result.error.message : "The update was rejected." };
    return { ok: true, document: result.document, patch };
  }

  async function apply(proposal) {
    if (!proposal || !proposal.action || proposal.action === "review") {
      return { ok: true, applied: false, proposal, pending: true };
    }
    let outcome = { ok: true, applied: true };
    if (proposal.action === "adopt") {
      const entity = identity ? identity.get(proposal.entityType, proposal.entityId) : null;
      if (!entity) outcome = { ok: false, error: `Unknown ${proposal.entityType} "${proposal.entityId}".` };
      else if (identity) await identity.setField(proposal.entityType, proposal.entityId, proposal.field, proposal.remoteValue, "openrpa");
    } else if (proposal.action === "push") {
      const pushed = await pushField(proposal);
      outcome = pushed.ok ? { ok: true, applied: true } : { ok: false, applied: false, error: pushed.error };
      if (pushed.ok && identity) await identity.setField(proposal.entityType, proposal.entityId, proposal.field, proposal.hubValue, "openrpa");
    } else if (proposal.action === "capture") {
      if (drift) await drift.captureTarget({ targetType: proposal.targetType, targetId: proposal.targetId });
    } else if (proposal.action === "unlink") {
      if (linking) {
        const removed = await linking.unlinkWhere(
          (edge) => edge.entityType === proposal.entityType && edge.entityId === proposal.entityId && edge.targetType === proposal.targetType && edge.targetId === String(proposal.targetId)
        );
        await linking.refreshTargets();
        outcome = { ok: true, applied: removed.removed > 0, alreadyRemoved: removed.removed === 0 };
      }
    }

    if (outcome.ok && outcome.applied !== false && drift) await drift.captureTarget({ targetType: proposal.targetType, targetId: proposal.targetId });

    const record = await logChange(proposal, outcome);
    if (outcome.ok && outcome.applied !== false) {
      counters.applied += 1;
      if (proposal.action === "adopt") counters.adopted += 1;
      if (proposal.action === "push") counters.pushed += 1;
      if (proposal.action === "capture") counters.captured += 1;
      if (proposal.action === "unlink") counters.unlinked += 1;
    } else if (outcome.pending || (outcome.ok && outcome.applied === false)) {
      counters.skipped += 1;
    } else {
      counters.errors += 1;
      lastError = outcome.error || null;
    }
    return { ...outcome, proposal, record };
  }

  async function logChange(proposal, outcome) {
    seqCounter += 1;
    const at = iso();
    const key = `change:${String(seqCounter).padStart(8, "0")}:${hash36(`${proposal.id}:${at}:${seqCounter}`)}`;
    const record = {
      key,
      seq: seqCounter,
      at,
      proposalId: proposal.id,
      policy: proposal.policy,
      kind: proposal.kind,
      action: proposal.action,
      winner: proposal.winner,
      applied: outcome.ok && outcome.applied !== false,
      ok: outcome.ok !== false,
      error: outcome.error || null,
      entityType: proposal.entityType,
      entityId: proposal.entityId,
      entityName: proposal.entityName,
      field: proposal.field,
      label: proposal.label,
      targetType: proposal.targetType,
      targetId: proposal.targetId,
      targetName: proposal.targetName,
      from: proposal.winner === "hub" ? proposal.remoteValue : proposal.hubValue,
      to: proposal.winner === "hub" ? proposal.hubValue : proposal.remoteValue,
      held: proposal.held,
      expected: proposal.expected,
      source: proposal.action === "push" ? "hub" : "openrpa",
      reason: proposal.reason,
    };
    changes.push(record);
    if (db) await db.put(collection, record.key, record);
    lastAt = at;
    return record;
  }

  async function reconcile({ policy = lastPolicy, apply: shouldApply = true } = {}) {
    const chosen = OPENRPA_SYNC_POLICIES.includes(policy) ? policy : lastPolicy;
    lastPolicy = chosen;
    if (drift) await drift.scan({ refresh: true });
    const list = proposals({ policy: chosen });
    let applied = 0;
    let pending = 0;
    const failed = [];
    for (const proposal of list) {
      if (!shouldApply || !proposal.auto) {
        pending += 1;
        continue;
      }
      const result = await apply(proposal);
      if (result.ok && result.applied !== false) applied += 1;
      else failed.push({ id: proposal.id, error: result.error || "The change could not be applied." });
    }
    counters.reconciles += 1;
    if (drift) await drift.scan({ refresh: false });
    return { ok: true, policy: chosen, planned: list.length, applied, pending, failed, changes: changes.length };
  }

  function history({ limit = 100 } = {}) {
    return changes.slice().reverse().slice(0, Math.max(0, limit));
  }

  function stats() {
    const list = proposals({});
    const byAction = {};
    for (const proposal of list) byAction[proposal.action] = (byAction[proposal.action] || 0) + 1;
    return {
      policy: lastPolicy,
      proposals: list.length,
      auto: list.filter((proposal) => proposal.auto).length,
      manual: list.filter((proposal) => !proposal.auto).length,
      changes: changes.length,
      byAction,
      lastAt,
      lastError,
      ...counters,
    };
  }

  async function hydrate() {
    if (!db) return changes.length;
    const stored = db.all(collection).filter((record) => record && String(record.key || "").startsWith("change:"));
    stored.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    changes.length = 0;
    for (const record of stored) changes.push(record);
    seqCounter = changes.length ? changes[changes.length - 1].seq || changes.length : 0;
    return changes.length;
  }

  async function reset() {
    if (db) for (const record of changes) await db.remove(collection, record.key);
    changes.length = 0;
    seqCounter = 0;
    lastAt = null;
    lastError = null;
    for (const key of Object.keys(counters)) counters[key] = 0;
  }

  return {
    collection,
    policies: OPENRPA_SYNC_POLICIES,
    policyLabels: OPENRPA_SYNC_POLICY_LABELS,
    policyNotes: OPENRPA_SYNC_POLICY_NOTES,
    actions: OPENRPA_SYNC_ACTIONS,
    decide,
    proposals,
    apply,
    reconcile,
    history,
    stats,
    hydrate,
    reset,
  };
}
