import { OPENRPA_BRIDGE_COLLECTION, OPENRPA_BRIDGE_EXCHANGE, OPENRPA_BRIDGE_WATCH_COLLECTIONS } from "./constants.js";
import { OPENRPA_TAXONOMY_VERSION, topicFor } from "./taxonomy.js";
import { topicMatches } from "../event-catalog.js";

export const OPENRPA_BRIDGE_DROP_POLICIES = ["drop-oldest", "drop-newest", "coalesce"];
export const OPENRPA_BRIDGE_COMMANDS = ["workitem", "queuemessage", "watchevent", "collectionchanged", "robot", "workflowinstance"];

const WORKITEM_ENQUEUED = ["new", "enqueued", "added", "created", "queued"];
const WORKITEM_CLAIMED = ["processing", "claimed", "started", "running"];
const WORKITEM_COMPLETED = ["success", "completed", "complete", "succeeded"];
const WORKITEM_FAILED = ["failed", "error", "faulted"];
const WORKITEM_RETRIED = ["retry", "retrying", "retried", "requeued"];
const WORKFLOW_TERMINAL = ["success", "failed", "timeout", "cancelled", "complete", "completed", "succeeded", "error", "canceled"];
const COLLECTION_ACTIONS = ["inserted", "updated", "deleted"];

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function lower(value) {
  return value == null ? "" : String(value).toLowerCase();
}

function toInt(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.round(num)) : fallback;
}

function asObject(value) {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }
  return null;
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(1, Math.max(0, num));
}

function normalizeCollectionAction(value) {
  const action = lower(value);
  if (action === "inserted" || action === "insert" || action === "insertone" || action === "created" || action === "createdone") return "inserted";
  if (action === "deleted" || action === "delete" || action === "deleteone" || action === "removed") return "deleted";
  if (action === "updated" || action === "update" || action === "updateone" || action === "changed" || action === "modified" || action === "insertorupdateone") return "updated";
  return null;
}

function withOptional(target, key, value) {
  if (value !== undefined && value !== null) target[key] = value;
  return target;
}

export function translateOpenRpaCommand(command, raw) {
  const payload = raw && typeof raw === "object" ? raw : {};
  if (command === "workitem" || command === "queuemessage") {
    const state = lower(payload.state) || (command === "queuemessage" ? "new" : "");
    const queueId = pick(payload.queueId, payload.queueid, payload.wiqid, payload.wiq, payload.queue, payload.queueName);
    const itemId = pick(payload.itemId, payload.itemid, payload.id, payload._id, payload.item && payload.item._id);
    const retries = toInt(payload.retries, null);
    if (!state) return null;
    let type = null;
    if (WORKITEM_ENQUEUED.includes(state)) type = "workitem.enqueued";
    else if (WORKITEM_CLAIMED.includes(state)) type = "workitem.claimed";
    else if (WORKITEM_COMPLETED.includes(state)) type = "workitem.completed";
    else if (WORKITEM_FAILED.includes(state)) type = "workitem.failed";
    else if (WORKITEM_RETRIED.includes(state)) type = "workitem.retried";
    if (!type) return null;
    const id = itemId || "(unidentified)";
    const boundQueue = queueId || "(unbound)";
    let body;
    if (type === "workitem.enqueued") {
      body = withOptional({ queueId: boundQueue, itemId: id, state, source: pick(payload.source, "openflow") }, "priority", pick(payload.priority, null));
      const doc = asObject(payload.payload);
      if (doc) body.payload = doc;
    } else if (type === "workitem.claimed") {
      body = withOptional({ queueId: boundQueue, itemId: id }, "worker", pick(payload.worker, payload.username, payload.robot, null));
      if (retries != null) body.retries = retries;
    } else if (type === "workitem.completed") {
      body = withOptional({ itemId: id }, "queueId", queueId);
      const duration = toInt(payload.durationMs, null);
      if (duration != null) body.durationMs = duration;
      const result = asObject(payload.result);
      if (result) body.result = result;
    } else if (type === "workitem.failed") {
      body = { itemId: id, error: String(pick(payload.error, payload.errorMessage, payload.reason, "The work item failed.")) };
      if (queueId) body.queueId = queueId;
      if (retries != null) body.retries = retries;
    } else {
      body = withOptional({ itemId: id }, "queueId", queueId);
      if (retries != null) body.retries = retries;
      const reason = pick(payload.reason, payload.retryReason, null);
      if (reason != null) body.reason = String(reason);
    }
    return { type, payload: body, options: { source: "openrpa", subject: { entityType: "workitem", entityId: id } }, coalesceKey: null };
  }

  if (command === "watchevent" || command === "collectionchanged") {
    const collection = pick(payload.collection, payload.coll, payload.collectionName);
    if (!collection) return null;
    const action = normalizeCollectionAction(payload.action) || normalizeCollectionAction(payload.op) || "updated";
    const id = pick(payload.id, payload._id, payload.documentId, payload.docId);
    const docType = pick(payload.docType, payload.docTypeName);
    const version = toInt(pick(payload.version, payload._version), null);
    const watchId = pick(payload.watchId, payload.watch, null);
    const body = { collection, action };
    if (id) body.id = String(id);
    if (docType) body.docType = String(docType);
    if (version != null) body.version = version;
    if (watchId) body.watchId = String(watchId);
    return { type: "collection.changed", payload: body, options: { source: "openrpa", subject: { entityType: docType ? String(docType) : "document", entityId: id ? String(id) : String(collection) } }, coalesceKey: null };
  }

  if (command === "robot") {
    const name = pick(payload.name, payload.robot, payload.id, payload._id);
    if (!name) return null;
    const presence = lower(pick(payload.state, payload.presence, ""));
    const lastseen = pick(payload.lastseen, payload.lastSeen, payload.at, null);
    const minutes = toInt(pick(payload.minutes, payload.ageMinutes), null);
    const body = { name: String(name) };
    if (lastseen) body.lastseen = String(lastseen);
    if (minutes != null) body.minutes = minutes;
    let type = "robot.heartbeat";
    if (presence === "offline") type = "robot.offline";
    else if (presence === "stale") type = "robot.stale";
    else if (type === "robot.heartbeat") {
      if (presence && presence !== "online" && presence !== "heartbeat") return null;
      withOptional(body, "version", pick(payload.version, null));
      withOptional(body, "hostname", pick(payload.hostname, null));
      const metrics = asObject(payload.metrics);
      if (metrics) body.metrics = metrics;
    }
    return { type, payload: body, options: { source: "openrpa", subject: { entityType: "robot", entityId: String(name) } }, coalesceKey: type === "robot.heartbeat" ? `robot.heartbeat:${name}` : null };
  }

  if (command === "workflowinstance") {
    const correlationId = pick(payload.correlationId, payload.correlationid);
    if (!correlationId) return null;
    const state = lower(payload.state) || "pending";
    if (WORKFLOW_TERMINAL.includes(state)) return null;
    const body = { correlationId: String(correlationId), state };
    withOptional(body, "workflowId", pick(payload.workflowId, payload.workflowid, null));
    withOptional(body, "queue", pick(payload.queue, null));
    withOptional(body, "instanceId", pick(payload.instanceId, payload.instanceid, null));
    const progress = clamp01(pick(payload.progress, null));
    if (progress != null) body.progress = progress;
    return { type: "workflow.progress", payload: body, options: { source: "openrpa", correlationId: String(correlationId), subject: { entityType: "workflow", entityId: String(correlationId) } }, coalesceKey: `workflow.progress:${correlationId}` };
  }

  return null;
}

export function createEventBridge({
  request = null,
  onCommand = null,
  emit = null,
  db = null,
  clock = () => Date.now(),
  streaming = null,
  exchange = OPENRPA_BRIDGE_EXCHANGE,
  watchCollections = [],
  bufferLimit = 500,
  journalLimit = 500,
  batchSize = 25,
  dropPolicy = "drop-oldest",
} = {}) {
  const iso = () => new Date(clock()).toISOString();
  const call = (command, data, options) => (typeof request === "function" ? request(command, data, options) : Promise.reject(new Error("No OpenFlow connection is available.")));

  let enabled = false;
  let seqCounter = 0;
  let orderCounter = 0;
  let drainTimer = null;
  let drainPromise = null;
  let flushing = false;
  let lastAt = null;
  let lastError = null;
  let connected = false;
  let policy = OPENRPA_BRIDGE_DROP_POLICIES.includes(dropPolicy) ? dropPolicy : "drop-oldest";

  const buffered = [];
  const journal = [];
  const watchList = [];
  let watchedCollections = Array.isArray(watchCollections) ? watchCollections.slice() : [];
  let registration = { exchange, connected: false, registeredAt: null, attempts: 0, errors: 0, queues: [], lastError: null };
  const counters = { received: 0, translated: 0, ignored: 0, emitted: 0, rejected: 0, dropped: 0, droppedOldest: 0, droppedNewest: 0, coalesced: 0, errors: 0, reconnects: 0, watchesRegistered: 0, replayed: 0 };

  function keyOf(seq) {
    return String(seq).padStart(12, "0");
  }

  function messageOf(result) {
    return result && result.message ? result.message : String(result || "OpenFlow command failed.");
  }

  function schedule() {
    if (drainTimer != null || draining() || flushing || !buffered.length) return;
    const run = () => {
      drainTimer = null;
      drainPromise = drain()
        .catch(() => {})
        .finally(() => {
          drainPromise = null;
          if (buffered.length && !flushing) schedule();
        });
    };
    if (typeof setTimeout === "function") drainTimer = setTimeout(run, 0);
    else drainTimer = Promise.resolve().then(run);
  }

  function draining() {
    return drainPromise != null;
  }

  async function persist(entry) {
    if (!db) return;
    try {
      await db.put(OPENRPA_BRIDGE_COLLECTION, keyOf(entry.seq), entry);
    } catch (error) {
      lastError = messageOf(error);
    }
  }

  async function emitOne(item) {
    const seq = ++seqCounter;
    const entry = {
      seq,
      at: item.pushedAt || iso(),
      type: item.type,
      topic: topicFor(item.type),
      correlationId: item.correlationId || null,
      source: "openrpa",
      subject: item.subject || null,
      coalesceKey: item.coalesceKey || null,
      command: item.command || null,
      payload: item.payload,
    };
    if (typeof emit === "function") {
      try {
        const result = await emit(item.type, item.payload, item.options || {});
        if (result && result.ok === false) {
          counters.rejected += 1;
          entry.delivered = false;
          lastError = result.issues && result.issues[0] ? result.issues[0].message : `Event "${item.type}" was rejected.`;
        } else {
          counters.emitted += 1;
          entry.delivered = true;
          entry.eventId = result && result.event ? result.event.id : null;
        }
      } catch (error) {
        counters.errors += 1;
        entry.delivered = false;
        lastError = messageOf(error);
      }
    } else {
      entry.delivered = false;
    }
    journal.push(entry);
    if (journal.length > journalLimit) {
      const removed = journal.splice(0, journal.length - journalLimit);
      for (const old of removed) if (db) await db.remove(OPENRPA_BRIDGE_COLLECTION, keyOf(old.seq));
    }
    await persist(entry);
    lastAt = entry.at;
    return entry;
  }

  async function drain() {
    if (!buffered.length) return 0;
    const batch = buffered.splice(0, Math.max(1, batchSize));
    let count = 0;
    for (const item of batch) {
      await emitOne(item);
      count += 1;
    }
    return count;
  }

  async function flush() {
    flushing = true;
    try {
      let total = 0;
      while (drainPromise || buffered.length) {
        if (drainPromise) {
          await drainPromise;
          continue;
        }
        total += await drain();
      }
      return total;
    } finally {
      flushing = false;
    }
  }

  function push(item) {
    if (buffered.length >= bufferLimit) {
      if (policy === "coalesce" && item.coalesceKey) {
        const index = buffered.findIndex((entry) => entry.coalesceKey === item.coalesceKey);
        if (index !== -1) {
          buffered[index] = item;
          counters.coalesced += 1;
          return { ok: true, queued: true, coalesced: true, buffered: buffered.length };
        }
      }
      if (policy === "drop-newest") {
        counters.dropped += 1;
        counters.droppedNewest += 1;
        return { ok: false, dropped: true, reason: "buffer-full", buffered: buffered.length };
      }
      buffered.shift();
      counters.dropped += 1;
      counters.droppedOldest += 1;
    }
    buffered.push(item);
    schedule();
    return { ok: true, queued: true, buffered: buffered.length };
  }

  function deliver(command, payload) {
    counters.received += 1;
    const translated = translateOpenRpaCommand(command, payload);
    if (!translated) {
      counters.ignored += 1;
      return null;
    }
    counters.translated += 1;
    const item = {
      command,
      type: translated.type,
      payload: translated.payload,
      options: translated.options,
      correlationId: translated.options && translated.options.correlationId ? translated.options.correlationId : null,
      subject: translated.options ? translated.options.subject : null,
      coalesceKey: translated.coalesceKey || null,
      order: ++orderCounter,
      pushedAt: iso(),
    };
    const result = push(item);
    return { type: item.type, payload: item.payload, correlationId: item.correlationId, order: item.order, push: result };
  }

  function handleServerCommand(env) {
    const command = env && (env.command || env.type);
    if (!command) return null;
    const data = env.data !== undefined ? env.data : env.payload;
    return deliver(command, data);
  }

  async function register(name = registration.exchange) {
    registration = { ...registration, exchange: name, attempts: registration.attempts + 1 };
    const errors = [];
    try {
      await call("registerexchange", { name });
      registration.exchangeRegistered = true;
    } catch (error) {
      errors.push(`exchange: ${messageOf(error)}`);
      registration.exchangeRegistered = false;
    }
    let queues = [];
    try {
      const docs = await call("query", { collection: "openrpa_queue" });
      queues = (Array.isArray(docs) ? docs : []).map((doc) => doc && (doc.amqpqueue || doc.robotqueue || doc.name)).filter(Boolean);
      for (const queue of queues) {
        try {
          await call("registerqueue", { name: queue });
        } catch (error) {
          errors.push(`queue ${queue}: ${messageOf(error)}`);
        }
      }
    } catch (error) {
      errors.push(`queues: ${messageOf(error)}`);
    }
    registration.queues = queues;
    registration.connected = errors.length === 0;
    registration.lastError = errors.length ? errors[0] : null;
    if (errors.length) {
      counters.errors += errors.length;
      registration.errors += 1;
      lastError = errors[0];
    } else {
      registration.registeredAt = iso();
    }
    return { ok: errors.length === 0, exchange: name, queues, errors };
  }

  async function watch(collection, { filter = null } = {}) {
    if (!collection) return { ok: false, error: "A collection name is required to watch." };
    try {
      const result = await call("watch", { collection, filter });
      const watchId = result && (result.watchId || result.id) ? String(result.watchId || result.id) : null;
      const entry = { watchId, collection, filter, at: iso() };
      watchList.push(entry);
      counters.watchesRegistered += 1;
      return { ok: true, watch: entry };
    } catch (error) {
      counters.errors += 1;
      lastError = messageOf(error);
      return { ok: false, error: lastError };
    }
  }

  async function watchMany(collections = OPENRPA_BRIDGE_WATCH_COLLECTIONS) {
    const list = Array.isArray(collections) ? collections.filter(Boolean) : [];
    const watches = [];
    const errors = [];
    for (const collection of list) {
      const result = await watch(collection);
      if (result.ok) watches.push(result.watch);
      else errors.push(result.error);
      if (!watchedCollections.includes(collection)) watchedCollections.push(collection);
    }
    return { ok: errors.length === 0, watches, errors };
  }

  async function unwatch(watchId) {
    const index = watchList.findIndex((entry) => entry.watchId === watchId);
    if (index === -1) return { ok: false, error: `No watch with id "${watchId}".` };
    try {
      await call("unwatch", { watchId });
    } catch (error) {
      counters.errors += 1;
      lastError = messageOf(error);
    }
    const [removed] = watchList.splice(index, 1);
    return { ok: true, removed };
  }

  async function unwatchAll() {
    const ids = watchList.map((entry) => entry.watchId).filter(Boolean);
    for (const id of ids) await unwatch(id);
    watchList.length = 0;
    watchedCollections = [];
    return { ok: true, removed: ids.length };
  }

  function applyStreaming(next) {
    if (typeof streaming !== "function") return null;
    try {
      return streaming(next);
    } catch (error) {
      return null;
    }
  }

  async function enable({ collections = watchedCollections, exchange: name = registration.exchange } = {}) {
    enabled = true;
    const result = await register(name);
    const list = Array.isArray(collections) ? collections.filter(Boolean) : [];
    if (list.length) await watchMany(list);
    applyStreaming(true);
    return { ok: result.ok, enabled, registration: registrationCopy(), queues: result.queues, watches: watchList.length, errors: result.errors };
  }

  async function disable() {
    enabled = false;
    applyStreaming(false);
    return { ok: true, enabled };
  }

  function registrationCopy() {
    return { ...registration, queues: registration.queues.slice() };
  }

  function handleState(event = {}) {
    const to = event.to || event.state || null;
    if (to === "connected") {
      connected = true;
      registration.connected = true;
      if (enabled) {
        counters.reconnects += 1;
        register(registration.exchange).catch(() => {});
        if (watchedCollections.length) watchMany(watchedCollections).catch(() => {});
      }
    } else if (to === "reconnecting") {
      connected = false;
      registration.connected = false;
      counters.reconnects += 1;
    } else if (to === "error" || to === "disconnected") {
      connected = false;
      registration.connected = false;
    }
    return { state: to, connected, enabled };
  }

  function matchesFilter(entry, { topic = null, type = null, correlationId = null, from = null, to = null } = {}) {
    if (type && !(entry.type === type || topicMatches(type, entry.type))) return false;
    if (topic && !(entry.topic === topic || topicMatches(topic, entry.type))) return false;
    if (correlationId && entry.correlationId !== correlationId) return false;
    if (from != null) {
      const bound = typeof from === "number" ? from : Date.parse(from);
      const at = typeof from === "number" ? entry.seq : Date.parse(entry.at);
      if (!Number.isNaN(bound) && at < bound) return false;
    }
    if (to != null) {
      const bound = typeof to === "number" ? to : Date.parse(to);
      const at = typeof to === "number" ? entry.seq : Date.parse(entry.at);
      if (!Number.isNaN(bound) && at > bound) return false;
    }
    return true;
  }

  function filtered(options = {}) {
    return journal.filter((entry) => matchesFilter(entry, options));
  }

  async function replay(options = {}, handler = null) {
    let opts = options;
    let fn = handler;
    if (typeof options === "function") {
      fn = options;
      opts = {};
    }
    const events = filtered(opts);
    let replayed = 0;
    if (typeof fn === "function") {
      for (const entry of events) {
        await fn(entry);
        replayed += 1;
      }
    }
    counters.replayed += replayed;
    return { ok: true, matched: events.length, replayed, events };
  }

  function audit({ limit = 100, ...options } = {}) {
    const events = filtered(options);
    const byTopic = {};
    const byType = {};
    for (const entry of events) {
      byTopic[entry.topic] = (byTopic[entry.topic] || 0) + 1;
      byType[entry.type] = (byType[entry.type] || 0) + 1;
    }
    const newest = events.slice().reverse();
    return { ok: true, total: journal.length, matched: events.length, events: newest.slice(0, Math.max(0, limit)), byTopic, byType };
  }

  function recent(n = 20) {
    return journal.slice(-Math.max(0, n));
  }

  function setDropPolicy(next) {
    if (!OPENRPA_BRIDGE_DROP_POLICIES.includes(next)) return policy;
    policy = next;
    return policy;
  }

  async function ready() {
    if (!db) return { ok: true, hydrated: 0, seq: seqCounter };
    let hydrated = 0;
    try {
      const stored = db.all(OPENRPA_BRIDGE_COLLECTION).filter((entry) => entry && typeof entry.seq === "number");
      stored.sort((a, b) => a.seq - b.seq);
      const trimmed = stored.slice(-journalLimit);
      journal.length = 0;
      for (const entry of trimmed) journal.push(entry);
      hydrated = journal.length;
      seqCounter = journal.length ? journal[journal.length - 1].seq : 0;
    } catch (error) {
      lastError = messageOf(error);
    }
    return { ok: true, hydrated, seq: seqCounter };
  }

  function stats() {
    return {
      enabled,
      connected,
      exchange: registration.exchange,
      queues: registration.queues.length,
      watches: watchList.length,
      buffered: buffered.length,
      journal: journal.length,
      seq: seqCounter,
      taxonomyVersion: OPENRPA_TAXONOMY_VERSION,
      dropPolicy: policy,
      bufferLimit,
      journalLimit,
      batchSize,
      lastAt,
      lastError,
      ...counters,
    };
  }

  async function reset() {
    enabled = false;
    connected = false;
    buffered.length = 0;
    journal.length = 0;
    watchList.length = 0;
    watchedCollections = Array.isArray(watchCollections) ? watchCollections.slice() : [];
    seqCounter = 0;
    orderCounter = 0;
    lastAt = null;
    lastError = null;
    registration = { exchange, connected: false, registeredAt: null, attempts: 0, errors: 0, queues: [], lastError: null };
    for (const key of Object.keys(counters)) counters[key] = 0;
    if (drainTimer != null && typeof clearTimeout === "function") clearTimeout(drainTimer);
    drainTimer = null;
    drainPromise = null;
    flushing = false;
    applyStreaming(false);
    if (db) await db.clear(OPENRPA_BRIDGE_COLLECTION);
  }

  if (typeof onCommand === "function") {
    for (const command of OPENRPA_BRIDGE_COMMANDS) onCommand(command, (data) => deliver(command, data));
  }

  return {
    dropPolicies: OPENRPA_BRIDGE_DROP_POLICIES,
    commands: OPENRPA_BRIDGE_COMMANDS,
    watchCollections: OPENRPA_BRIDGE_WATCH_COLLECTIONS.slice(),
    exchange,
    enable,
    disable,
    register,
    registration: registrationCopy,
    watch,
    watchMany,
    unwatch,
    unwatchAll,
    watches: () => watchList.map((entry) => ({ ...entry })),
    handleState,
    handleServerCommand,
    deliver,
    push,
    drain,
    flush,
    journal: () => journal.map((entry) => ({ ...entry })),
    recent,
    replay,
    audit,
    setDropPolicy,
    translate: translateOpenRpaCommand,
    ready,
    stats,
    reset,
    enabled: () => enabled,
    buffered: () => buffered.length,
  };
}
