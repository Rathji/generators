export const EVENT_VERSION = 1;

const scalarFields = { type: "object", open: true };

export const EVENT_TYPES = [
  {
    type: "identity.upserted",
    version: EVENT_VERSION,
    category: "identity",
    summary: "A connector supplied a record that converged on a canonical identity.",
    payload: {
      type: "object",
      fields: {
        entityType: { type: "string", required: true, enum: ["company", "customer", "device", "ticket", "invoice"] },
        entityId: { type: "string", required: true },
        connector: { type: "string", required: true },
        nativeId: { type: "string" },
        created: { type: "boolean", required: true },
        refs: { type: "number", min: 0 },
        fields: scalarFields,
      },
    },
  },
  {
    type: "identity.merged",
    version: EVENT_VERSION,
    category: "identity",
    summary: "Two canonical records were merged into one.",
    payload: {
      type: "object",
      fields: {
        entityType: { type: "string", required: true, enum: ["company", "customer"] },
        keepId: { type: "string", required: true },
        dropId: { type: "string", required: true },
        confidence: { type: "number", min: 0, max: 1 },
      },
    },
  },
  {
    type: "identity.deleted",
    version: EVENT_VERSION,
    category: "identity",
    summary: "A canonical record was removed from the directory.",
    payload: {
      type: "object",
      fields: {
        entityType: { type: "string", required: true },
        entityId: { type: "string", required: true },
      },
    },
  },
  {
    type: "ticket.opened",
    version: EVENT_VERSION,
    category: "service",
    summary: "A ticket was opened against a company or customer.",
    payload: {
      type: "object",
      fields: {
        ticketId: { type: "string", required: true },
        companyId: { type: "string", required: true },
        customerId: { type: "string" },
        subject: { type: "string", maxLength: 200 },
        priority: { type: "string", required: true, enum: ["low", "normal", "high", "urgent"] },
      },
    },
  },
  {
    type: "ticket.closed",
    version: EVENT_VERSION,
    category: "service",
    summary: "A ticket was resolved and closed.",
    payload: {
      type: "object",
      fields: {
        ticketId: { type: "string", required: true },
        resolution: { type: "string", required: true, enum: ["resolved", "wont_fix", "duplicate"] },
        minutes: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "invoice.issued",
    version: EVENT_VERSION,
    category: "service",
    summary: "An invoice was issued to a company.",
    payload: {
      type: "object",
      fields: {
        invoiceId: { type: "string", required: true },
        companyId: { type: "string", required: true },
        amount: { type: "number", min: 0 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
      },
    },
  },
  {
    type: "invoice.paid",
    version: EVENT_VERSION,
    category: "service",
    summary: "An invoice was paid in full.",
    payload: {
      type: "object",
      fields: {
        invoiceId: { type: "string", required: true },
        amount: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "device.registered",
    version: EVENT_VERSION,
    category: "device",
    summary: "A managed device was registered to a company.",
    payload: {
      type: "object",
      fields: {
        deviceId: { type: "string", required: true },
        companyId: { type: "string", required: true },
        serial: { type: "string", required: true },
        hostname: { type: "string" },
      },
    },
  },
  {
    type: "device.checkin",
    version: EVENT_VERSION,
    category: "device",
    summary: "A managed device reported in to the RMM agent.",
    payload: {
      type: "object",
      fields: {
        deviceId: { type: "string", required: true },
        at: { type: "string", required: true },
        latencyMs: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "device.offline",
    version: EVENT_VERSION,
    category: "device",
    summary: "A device stopped checking in and was flagged offline.",
    payload: {
      type: "object",
      fields: {
        deviceId: { type: "string", required: true },
        minutes: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "sync.requested",
    version: EVENT_VERSION,
    category: "sync",
    summary: "The hub asked a connector for the authoritative value of a record.",
    payload: {
      type: "object",
      fields: {
        connector: { type: "string", required: true },
        entityType: { type: "string", required: true },
        entityId: { type: "string", required: true },
        fields: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    type: "sync.completed",
    version: EVENT_VERSION,
    category: "sync",
    summary: "A sync job finished successfully.",
    payload: {
      type: "object",
      fields: {
        jobId: { type: "string", required: true },
        connector: { type: "string", required: true },
        entityType: { type: "string", required: true },
        entityId: { type: "string", required: true },
        changes: { type: "number", min: 0 },
        durationMs: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "sync.failed",
    version: EVENT_VERSION,
    category: "sync",
    summary: "A sync job failed and needs attention.",
    payload: {
      type: "object",
      fields: {
        jobId: { type: "string", required: true },
        connector: { type: "string", required: true },
        entityType: { type: "string" },
        entityId: { type: "string" },
        error: { type: "string", required: true, maxLength: 300 },
      },
    },
  },
  {
    type: "sync.job",
    version: EVENT_VERSION,
    category: "sync",
    summary: "An idempotent sync job succeeded, failed or was retried.",
    payload: {
      type: "object",
      fields: {
        jobId: { type: "string", required: true },
        kind: { type: "string", required: true },
        status: { type: "string", required: true, enum: ["succeeded", "failed", "retried"] },
        attempts: { type: "number", min: 0 },
        changes: { type: "number", min: 0 },
        durationMs: { type: "number", min: 0 },
        idempotent: { type: "boolean" },
        error: { type: "string", maxLength: 300 },
      },
    },
  },
  {
    type: "conflict.detected",
    version: EVENT_VERSION,
    category: "integrity",
    summary: "A field held by the hub disagrees with the connector that owns it.",
    payload: {
      type: "object",
      fields: {
        entityType: { type: "string", required: true },
        entityId: { type: "string", required: true },
        field: { type: "string", required: true },
        owner: { type: "string", required: true },
        held: { type: "string" },
        ownerHeld: { type: "string" },
      },
    },
  },
  {
    type: "conflict.resolved",
    version: EVENT_VERSION,
    category: "integrity",
    summary: "Registry ownership rules settled a conflicting field.",
    payload: {
      type: "object",
      fields: {
        entityType: { type: "string", required: true },
        entityId: { type: "string", required: true },
        field: { type: "string", required: true },
        owner: { type: "string" },
        winner: { type: "string", required: true, enum: ["owner", "hub", "derived"] },
        rule: { type: "string" },
      },
    },
  },
  {
    type: "drift.detected",
    version: EVENT_VERSION,
    category: "integrity",
    summary: "Linked data stopped matching its authoritative source.",
    payload: {
      type: "object",
      fields: {
        entityType: { type: "string", required: true },
        entityId: { type: "string", required: true },
        field: { type: "string", required: true },
        kind: { type: "string", required: true },
        severity: { type: "string", required: true, enum: ["info", "warning", "error", "critical"] },
        held: { type: "string" },
        expected: { type: "string" },
      },
    },
  },
  {
    type: "drift.cleared",
    version: EVENT_VERSION,
    category: "integrity",
    summary: "A drifting field converged back to its authoritative source.",
    payload: {
      type: "object",
      fields: {
        entityType: { type: "string", required: true },
        entityId: { type: "string", required: true },
        field: { type: "string", required: true },
        reason: { type: "string" },
      },
    },
  },
  {
    type: "alert.raised",
    version: EVENT_VERSION,
    category: "integrity",
    summary: "An integrity alert was raised for administrators.",
    payload: {
      type: "object",
      fields: {
        alertId: { type: "string", required: true },
        severity: { type: "string", required: true, enum: ["info", "warning", "error", "critical"] },
        category: { type: "string" },
        title: { type: "string", required: true, maxLength: 200 },
        key: { type: "string" },
      },
    },
  },
  {
    type: "alert.acknowledged",
    version: EVENT_VERSION,
    category: "integrity",
    summary: "An administrator acknowledged an open alert.",
    payload: {
      type: "object",
      fields: {
        alertId: { type: "string", required: true },
        actor: { type: "string" },
      },
    },
  },
  {
    type: "alert.cleared",
    version: EVENT_VERSION,
    category: "integrity",
    summary: "An alert was cleared because the condition is gone.",
    payload: {
      type: "object",
      fields: {
        alertId: { type: "string", required: true },
        reason: { type: "string" },
      },
    },
  },
  {
    type: "subscription.registered",
    version: EVENT_VERSION,
    category: "config",
    summary: "A tool subscribed to an event topic on the bus.",
    payload: {
      type: "object",
      fields: {
        subscriptionId: { type: "string", required: true },
        connector: { type: "string", required: true },
        topic: { type: "string", required: true },
      },
    },
  },
  {
    type: "subscription.removed",
    version: EVENT_VERSION,
    category: "config",
    summary: "A tool cancelled an event subscription.",
    payload: {
      type: "object",
      fields: {
        subscriptionId: { type: "string", required: true },
        connector: { type: "string", required: true },
        topic: { type: "string", required: true },
      },
    },
  },
  {
    type: "connector.health",
    version: EVENT_VERSION,
    category: "monitor",
    summary: "A connector reported its health to the hub.",
    payload: {
      type: "object",
      fields: {
        connector: { type: "string", required: true },
        status: { type: "string", required: true, enum: ["up", "degraded", "down"] },
        latencyMs: { type: "number", min: 0 },
        checkedAt: { type: "string" },
      },
    },
  },
  {
    type: "monitor.heartbeat",
    version: EVENT_VERSION,
    category: "monitor",
    summary: "The hub swept every connector to check reachability and latency.",
    payload: {
      type: "object",
      fields: {
        probed: { type: "number", required: true, min: 0 },
        up: { type: "number", min: 0 },
        degraded: { type: "number", min: 0 },
        down: { type: "number", min: 0 },
        averageLatencyMs: { type: "number", min: 0 },
        durationMs: { type: "number", min: 0 },
        trigger: { type: "string", required: true, enum: ["manual", "scheduled"] },
      },
    },
  },
  {
    type: "bundle.published",
    version: EVENT_VERSION,
    category: "publish",
    summary: "A data bundle was published for downstream consumers.",
    payload: {
      type: "object",
      fields: {
        bundleId: { type: "string", required: true },
        records: { type: "number", min: 0 },
        format: { type: "string", enum: ["json", "csv"] },
        target: { type: "string" },
      },
    },
  },
  {
    type: "audit.note",
    version: EVENT_VERSION,
    category: "audit",
    summary: "An operator recorded a note against the integration log.",
    payload: {
      type: "object",
      fields: {
        message: { type: "string", required: true, maxLength: 500 },
        actor: { type: "string" },
      },
    },
  },
];

export const EVENT_TYPE_MAP = new Map(EVENT_TYPES.map((entry) => [entry.type, entry]));

export const EVENT_CATEGORIES = Array.from(new Set(EVENT_TYPES.map((entry) => entry.category)));

export const TOPICS = Array.from(new Set(EVENT_TYPES.map((entry) => entry.type.split(".")[0])));

export function eventType(type) {
  return EVENT_TYPE_MAP.get(type) || null;
}

export function topicOf(type) {
  const dot = String(type).indexOf(".");
  return dot === -1 ? String(type) : String(type).slice(0, dot);
}

export function topicMatches(pattern, type) {
  if (!pattern) return false;
  if (pattern === "*") return true;
  if (pattern === type) return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1);
    return String(type).startsWith(prefix);
  }
  if (pattern.endsWith("*")) return String(type).startsWith(pattern.slice(0, -1));
  return false;
}
