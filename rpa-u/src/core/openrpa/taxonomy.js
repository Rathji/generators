export const OPENRPA_TAXONOMY_VERSION = 1;

const anyObject = { type: "object", open: true };

export const OPENRPA_TOPICS = ["workitem", "workflow", "robot", "collection"];

export const OPENRPA_TOPIC_PATTERNS = OPENRPA_TOPICS.map((topic) => `${topic}.*`);

export const OPENRPA_EVENT_TYPES = [
  {
    type: "workitem.enqueued",
    version: 1,
    category: "automation",
    summary: "A work item was added to an OpenFlow queue.",
    payload: {
      type: "object",
      fields: {
        queueId: { type: "string", required: true },
        itemId: { type: "string", required: true },
        priority: { type: "string" },
        state: { type: "string" },
        source: { type: "string" },
        payload: anyObject,
      },
    },
  },
  {
    type: "workitem.claimed",
    version: 1,
    category: "automation",
    summary: "A robot claimed a queued work item and started processing it.",
    payload: {
      type: "object",
      fields: {
        queueId: { type: "string", required: true },
        itemId: { type: "string", required: true },
        worker: { type: "string" },
        retries: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "workitem.completed",
    version: 1,
    category: "automation",
    summary: "A claimed work item finished successfully.",
    payload: {
      type: "object",
      fields: {
        queueId: { type: "string" },
        itemId: { type: "string", required: true },
        durationMs: { type: "number", min: 0 },
        result: anyObject,
      },
    },
  },
  {
    type: "workitem.failed",
    version: 1,
    category: "automation",
    summary: "A work item failed and was reported back to the queue.",
    payload: {
      type: "object",
      fields: {
        queueId: { type: "string" },
        itemId: { type: "string", required: true },
        error: { type: "string", required: true, maxLength: 300 },
        retries: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "workitem.retried",
    version: 1,
    category: "automation",
    summary: "A failed work item was returned to the queue for another attempt.",
    payload: {
      type: "object",
      fields: {
        queueId: { type: "string" },
        itemId: { type: "string", required: true },
        retries: { type: "number", min: 0 },
        reason: { type: "string" },
      },
    },
  },
  {
    type: "workflow.progress",
    version: 1,
    category: "automation",
    summary: "A running OpenFlow workflow instance reported a non-terminal update.",
    payload: {
      type: "object",
      fields: {
        correlationId: { type: "string", required: true },
        workflowId: { type: "string" },
        queue: { type: "string" },
        instanceId: { type: "string" },
        state: { type: "string" },
        progress: { type: "number", min: 0, max: 1 },
      },
    },
  },
  {
    type: "robot.heartbeat",
    version: 1,
    category: "automation",
    summary: "A robot reported a heartbeat with its version and metrics.",
    payload: {
      type: "object",
      fields: {
        name: { type: "string", required: true },
        version: { type: "string" },
        hostname: { type: "string" },
        lastseen: { type: "string" },
        metrics: anyObject,
      },
    },
  },
  {
    type: "robot.online",
    version: 1,
    category: "automation",
    summary: "A robot crossed back inside the online heartbeat window.",
    payload: {
      type: "object",
      fields: {
        name: { type: "string", required: true },
        version: { type: "string" },
        lastseen: { type: "string" },
        minutes: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "robot.stale",
    version: 1,
    category: "automation",
    summary: "A robot missed enough heartbeats to be flagged stale.",
    payload: {
      type: "object",
      fields: {
        name: { type: "string", required: true },
        lastseen: { type: "string" },
        minutes: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "robot.offline",
    version: 1,
    category: "automation",
    summary: "A robot passed the offline heartbeat threshold.",
    payload: {
      type: "object",
      fields: {
        name: { type: "string", required: true },
        lastseen: { type: "string" },
        minutes: { type: "number", min: 0 },
      },
    },
  },
  {
    type: "collection.changed",
    version: 1,
    category: "automation",
    summary: "A watched OpenFlow document was inserted, updated or deleted.",
    payload: {
      type: "object",
      fields: {
        collection: { type: "string", required: true },
        action: { type: "string", required: true, enum: ["inserted", "updated", "deleted"] },
        id: { type: "string" },
        docType: { type: "string" },
        version: { type: "number", min: 0 },
        watchId: { type: "string" },
      },
    },
  },
];

export const OPENRPA_TAXONOMY = [
  {
    topic: "workitem",
    label: "Work items",
    summary: "The queue lifecycle: enqueue, claim, complete, fail and retry.",
    types: ["workitem.enqueued", "workitem.claimed", "workitem.completed", "workitem.failed", "workitem.retried"],
  },
  {
    topic: "workflow",
    label: "Workflows",
    summary: "Workflow invocation and its progress and terminal results.",
    types: ["workflow.invoked", "workflow.progress", "workflow.completed", "workflow.failed"],
  },
  {
    topic: "robot",
    label: "Robots",
    summary: "Robot heartbeats and the online, stale and offline presence transitions.",
    types: ["robot.heartbeat", "robot.online", "robot.stale", "robot.offline"],
  },
  {
    topic: "collection",
    label: "Collections",
    summary: "Change-stream notifications for watched OpenFlow documents.",
    types: ["collection.changed"],
  },
];

export const OPENRPA_TAXONOMY_TYPES = OPENRPA_TAXONOMY.reduce((all, entry) => all.concat(entry.types), []);

export function topicFor(type) {
  const dot = String(type).indexOf(".");
  return dot === -1 ? String(type) : String(type).slice(0, dot);
}

export function isOpenRpaTopic(topic) {
  return OPENRPA_TOPICS.includes(topic);
}

export function registerOpenRpaTaxonomy({ catalog = null } = {}) {
  const byType = new Map();
  const list = Array.isArray(catalog) ? catalog : [];
  for (const entry of list) byType.set(entry.type, entry);
  const registered = [];
  const missing = [];
  const mismatched = [];
  for (const entry of OPENRPA_EVENT_TYPES) {
    const found = byType.get(entry.type);
    if (!found) missing.push(entry.type);
    else if (found.version !== entry.version) mismatched.push({ type: entry.type, expected: entry.version, found: found.version });
    else registered.push(entry.type);
  }
  return {
    version: OPENRPA_TAXONOMY_VERSION,
    topics: OPENRPA_TOPICS.slice(),
    types: OPENRPA_EVENT_TYPES.map((entry) => entry.type),
    registered,
    missing,
    mismatched,
    ok: missing.length === 0 && mismatched.length === 0,
  };
}

export function describeTaxonomy() {
  return OPENRPA_TAXONOMY.map((entry) => ({ ...entry, types: entry.types.slice() }));
}
