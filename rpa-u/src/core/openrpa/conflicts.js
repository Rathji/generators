import { OPENRPA_SYNC_COLLECTION } from "./constants.js";
import { OPENRPA_SYNC_POLICIES as POLICIES } from "./sync.js";

export const OPENRPA_DECISIONS = ["approved", "rejected"];
export const OPENRPA_DECISION_LABELS = { approved: "Approved", rejected: "Rejected" };

function defaultResolution(proposal) {
  if (!proposal) return "review";
  if (proposal.action && proposal.action !== "review") return proposal.action;
  if (proposal.kind === "relationship") return "unlink";
  if (proposal.kind === "record") return "capture";
  if (proposal.kind === "field") {
    if (proposal.direction === "none") return "review";
    return proposal.direction === "push" ? "adopt" : "push";
  }
  return "review";
}

export function createOpenRpaConflictReview({ sync = null, drift = null, db = null, collection = OPENRPA_SYNC_COLLECTION, clock = () => Date.now() } = {}) {
  const decisionRecords = new Map();

  const iso = () => new Date(clock()).toISOString();

  function decisions() {
    return Array.from(decisionRecords.values()).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  function decisionFor(id) {
    return decisionRecords.get(id) || null;
  }

  function proposals({ policy = "manual", includeDecided = false } = {}) {
    if (!sync) return [];
    return sync
      .proposals({ policy: POLICIES.includes(policy) ? policy : "manual" })
      .map((proposal) => ({ ...proposal, decision: decisionFor(proposal.id) || null }))
      .filter((proposal) => includeDecided || !proposal.decision);
  }

  function diff(proposal) {
    if (!proposal) return null;
    return {
      id: proposal.id,
      kind: proposal.kind,
      entity: `${proposal.entityName || proposal.entityId} (${proposal.entityType})`,
      target: proposal.targetType ? `${proposal.targetName || proposal.targetId} (${proposal.targetType})` : null,
      field: proposal.field,
      label: proposal.label,
      hub: proposal.hubValue != null ? proposal.hubValue : proposal.kind === "field" ? proposal.held : null,
      openrpa: proposal.remoteValue != null ? proposal.remoteValue : proposal.kind === "field" ? proposal.expected : null,
      winner: proposal.winner,
      action: proposal.action,
      resolution: defaultResolution(proposal),
    };
  }

  async function persistDecision(id, patch) {
    const entry = { key: `decision:${id}`, id, at: iso(), ...patch };
    decisionRecords.set(id, entry);
    if (db) await db.put(collection, entry.key, entry);
    return entry;
  }

  async function approve(id, { policy = "prefer-openrpa", resolution = null, note = "" } = {}) {
    if (!sync) return { ok: false, error: "No reconciliation service is available." };
    const proposal = sync.proposals({ policy: POLICIES.includes(policy) ? policy : "prefer-openrpa" }).find((entry) => entry.id === id);
    if (!proposal) return { ok: false, error: `No open proposal "${id}".` };
    const action = resolution || defaultResolution(proposal);
    if (action === "review") return { ok: false, error: "This proposal has no safe automatic resolution — resolve it at the source instead." };
    const result = await sync.apply({ ...proposal, action, auto: true, policy });
    const entry = await persistDecision(id, { decision: "approved", policy, resolution: action, note, result: result.ok && result.applied !== false ? "applied" : result.error || "failed" });
    return { ok: result.ok !== false && result.applied !== false, applied: result.applied !== false, action, result, decision: entry };
  }

  async function reject(id, { reason = "", policy = "manual" } = {}) {
    const entry = await persistDecision(id, { decision: "rejected", policy, resolution: "rejected", note: reason, result: "rejected" });
    return { ok: true, decision: entry };
  }

  async function undo(id) {
    if (!decisionRecords.has(id)) return false;
    decisionRecords.delete(id);
    if (db) await db.remove(collection, `decision:${id}`);
    return true;
  }

  function stats() {
    const records = decisions();
    return {
      pending: proposals({ policy: "manual" }).length,
      total: (sync ? proposals({ policy: "manual", includeDecided: true }).length : 0),
      approved: records.filter((entry) => entry.decision === "approved").length,
      rejected: records.filter((entry) => entry.decision === "rejected").length,
      decisions: records.length,
    };
  }

  async function hydrate() {
    if (!db) return decisionRecords.size;
    for (const stored of db.all(collection)) {
      if (!stored || !String(stored.key || "").startsWith("decision:")) continue;
      decisionRecords.set(stored.id, stored);
    }
    return decisionRecords.size;
  }

  async function reset() {
    if (db) for (const record of decisionRecords.values()) await db.remove(collection, record.key);
    decisionRecords.clear();
  }

  return {
    collection,
    decisions: OPENRPA_DECISIONS,
    decisionLabels: OPENRPA_DECISION_LABELS,
    policies: POLICIES,
    proposals,
    diff,
    approve,
    reject,
    undo,
    decisionFor,
    decisionRecords: decisions,
    stats,
    hydrate,
    reset,
  };
}
