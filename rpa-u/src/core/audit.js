import { hash36 } from "./ids.js";

export const AUDIT_DIRECTIONS = ["in", "out", "internal"];

export const AUDIT_ACTIONS = {
  "identity.upserted": { action: "identity.import", label: "Imported identity", direction: "in" },
  "identity.merged": { action: "identity.merge", label: "Merged identities", direction: "internal" },
  "identity.deleted": { action: "identity.delete", label: "Deleted identity", direction: "internal" },
  "ticket.opened": { action: "ticket.open", label: "Opened ticket", direction: "in" },
  "ticket.closed": { action: "ticket.close", label: "Closed ticket", direction: "in" },
  "invoice.issued": { action: "invoice.issue", label: "Issued invoice", direction: "in" },
  "invoice.paid": { action: "invoice.pay", label: "Recorded payment", direction: "in" },
  "device.registered": { action: "device.register", label: "Registered device", direction: "in" },
  "device.checkin": { action: "device.checkin", label: "Device check-in", direction: "in" },
  "device.offline": { action: "device.offline", label: "Device offline", direction: "in" },
  "sync.requested": { action: "sync.read", label: "Requested authoritative value", direction: "out" },
  "sync.completed": { action: "sync.write", label: "Applied synced value", direction: "in" },
  "sync.failed": { action: "sync.fail", label: "Sync failed", direction: "internal" },
  "sync.job": { action: "sync.job", label: "Ran sync job", direction: "internal" },
  "conflict.detected": { action: "conflict.detect", label: "Detected conflict", direction: "internal" },
  "conflict.resolved": { action: "conflict.resolve", label: "Resolved conflict", direction: "internal" },
  "drift.detected": { action: "drift.detect", label: "Detected drift", direction: "internal" },
  "drift.cleared": { action: "drift.clear", label: "Cleared drift", direction: "internal" },
  "alert.raised": { action: "alert.raise", label: "Raised alert", direction: "internal" },
  "alert.acknowledged": { action: "alert.acknowledge", label: "Acknowledged alert", direction: "internal" },
  "alert.cleared": { action: "alert.clear", label: "Cleared alert", direction: "internal" },
  "subscription.registered": { action: "subscription.register", label: "Registered subscription", direction: "internal" },
  "subscription.removed": { action: "subscription.remove", label: "Removed subscription", direction: "internal" },
  "connector.health": { action: "connector.health", label: "Connector health report", direction: "in" },
  "monitor.heartbeat": { action: "monitor.heartbeat", label: "Ran heartbeat sweep", direction: "internal" },
  "bundle.published": { action: "bundle.publish", label: "Published bundle", direction: "out" },
  "audit.note": { action: "audit.note", label: "Recorded note", direction: "internal" },
};

export function auditActionFor(type) {
  return AUDIT_ACTIONS[type] || { action: type, label: type, direction: "internal" };
}

export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function subjectOf(event) {
  const payload = event.payload || {};
  if (event.subject && (event.subject.entityType || event.subject.entityId)) {
    return { typeId: event.subject.entityType || null, id: event.subject.entityId || null };
  }
  if (payload.entityType && payload.entityId) return { typeId: payload.entityType, id: payload.entityId };
  const singles = [
    ["companyId", "company"],
    ["customerId", "customer"],
    ["ticketId", "ticket"],
    ["invoiceId", "invoice"],
    ["deviceId", "device"],
  ];
  for (const [key, typeId] of singles) {
    if (payload[key]) return { typeId, id: payload[key] };
  }
  if (payload.bundleId) return { typeId: "bundle", id: payload.bundleId };
  return { typeId: null, id: null };
}

export function summarizeEvent(event, { actionLabel, subject, entityName, typeId } = {}) {
  const payload = event.payload || {};
  const name = entityName || subject?.id || "the record";
  switch (event.type) {
    case "identity.upserted":
      return `${event.source} supplied ${typeId || "record"} ${name}${payload.created ? " as a new canonical identity" : " and matched an existing identity"}.`;
    case "identity.merged":
      return `Merged ${payload.dropId || "a duplicate"} into ${payload.keepId || name}${payload.confidence != null ? ` at ${Math.round(payload.confidence * 100)}% confidence` : ""}.`;
    case "identity.deleted":
      return `Removed ${typeId || "identity"} ${name} from the directory.`;
    case "ticket.opened":
      return `${event.source} opened ticket ${name}${payload.priority ? ` at ${payload.priority} priority` : ""}.`;
    case "ticket.closed":
      return `${name} was closed (${payload.resolution || "resolved"}).`;
    case "invoice.issued":
      return `Issued invoice ${name}${payload.amount != null ? ` for ${payload.amount}` : ""}.`;
    case "invoice.paid":
      return `Recorded payment for invoice ${name}.`;
    case "device.registered":
      return `${event.source} registered device ${name}${payload.hostname ? ` (${payload.hostname})` : ""}.`;
    case "device.checkin":
      return `Device ${name} checked in.`;
    case "device.offline":
      return `Device ${name} went offline.`;
    case "sync.requested":
      return `Asked ${payload.connector} for ${name}${payload.fields?.length ? ` (${payload.fields.join(", ")})` : ""}.`;
    case "sync.completed":
      return `Applied ${payload.changes || 0} change${payload.changes === 1 ? "" : "s"} to ${name} from ${payload.connector}.`;
    case "sync.failed":
      return `Sync of ${name} from ${payload.connector} failed: ${payload.error}.`;
    case "sync.job":
      return `${payload.kind} ${payload.status}${payload.changes ? ` (${payload.changes} change${payload.changes === 1 ? "" : "s"})` : ""} for ${name}.`;
    case "conflict.detected":
      return `${name}.${payload.field} conflicts with ${payload.owner}: the hub holds “${payload.held}” but the owner reports “${payload.ownerHeld}”.`;
    case "conflict.resolved":
      return `Settled ${name}.${payload.field} in favour of ${payload.winner}${payload.rule ? ` via ${payload.rule}` : ""}.`;
    case "drift.detected":
      return `${name}.${payload.field} drifted (${payload.kind}, ${payload.severity}).`;
    case "drift.cleared":
      return `${name}.${payload.field} converged with its authoritative source.`;
    case "alert.raised":
      return `Raised a ${payload.severity} alert: “${payload.title}”.`;
    case "alert.acknowledged":
      return `Acknowledged alert ${payload.alertId}.`;
    case "alert.cleared":
      return `Cleared alert ${payload.alertId}.`;
    case "subscription.registered":
      return `${payload.connector} subscribed to ${payload.topic}.`;
    case "subscription.removed":
      return `${payload.connector} unsubscribed from ${payload.topic}.`;
    case "connector.health":
      return `${payload.connector} reported ${payload.status}.`;
    case "monitor.heartbeat":
      return `Heartbeat sweep probed ${payload.probed} connectors: ${payload.up || 0} up, ${payload.degraded || 0} degraded, ${payload.down || 0} down.`;
    case "bundle.published":
      return `Published bundle ${payload.bundleId} for ${payload.target} (${payload.records} records, ${payload.format}).`;
    case "audit.note":
      return payload.message;
    default:
      return `${actionLabel || event.type} from ${event.source}.`;
  }
}

export function createAuditMonitor({
  log,
  identity = null,
  db = null,
  collection = "audit",
  emit = null,
  clock = () => Date.now(),
  limit = 2000,
} = {}) {
  if (!log) throw new Error("createAuditMonitor requires an event log");
  const entries = [];
  const byId = new Map();
  let lastSeq = 0;

  function hashFor(prevHash, entry) {
    const body = stableStringify({
      seq: entry.seq,
      id: entry.id,
      type: entry.type,
      at: entry.at,
      source: entry.source,
      actor: entry.actor,
      action: entry.action,
      direction: entry.direction,
      entityType: entry.entityType,
      entityId: entry.entityId,
      field: entry.field,
      summary: entry.summary,
      movement: entry.movement,
      payload: entry.payload,
    });
    return hash36(`${prevHash}|${body}`);
  }

  function resolveName(typeId, id) {
    if (!identity || !typeId || !id) return null;
    let entity;
    try {
      entity = identity.get(typeId, id);
    } catch (error) {
      return null;
    }
    if (!entity) return null;
    return identity.nameOf(typeId, entity) || null;
  }

  function describe(event) {
    const meta = auditActionFor(event.type);
    const payload = event.payload || {};
    const subject = subjectOf(event);
    const entityName = resolveName(subject.typeId, subject.id) || subject.id || null;
    const direction = meta.direction;
    let movement = null;
    if (direction === "in") movement = { from: event.source, to: "ru", kind: "inbound" };
    else if (direction === "out") movement = { from: "ru", to: payload.target || payload.connector || "downstream", kind: "outbound" };
    const field = payload.field || (Array.isArray(payload.fields) && payload.fields.length === 1 ? payload.fields[0] : null);
    const actor = payload.actor || (event.source === "ru" ? "hub" : event.source);
    const entry = {
      id: event.id,
      seq: event.seq,
      at: event.time,
      type: event.type,
      topic: String(event.type).split(".")[0],
      source: event.source,
      actor,
      action: meta.action,
      actionLabel: meta.label,
      direction,
      entityType: subject.typeId,
      entityId: subject.id,
      entityName,
      field,
      movement,
      summary: summarizeEvent(event, { actionLabel: meta.label, subject, entityName, typeId: subject.typeId }),
      payload,
      hash: "",
      prevHash: "",
    };
    return entry;
  }

  function persist(entry) {
    if (!db) return Promise.resolve(entry);
    return db.put(collection, entry.id, entry);
  }

  async function appendEvent(event) {
    if (!event || byId.has(event.id)) return null;
    const entry = describe(event);
    const previous = entries.length ? entries[entries.length - 1] : null;
    entry.prevHash = previous ? previous.hash : "";
    entry.hash = hashFor(entry.prevHash, entry);
    entries.push(entry);
    byId.set(entry.id, entry);
    lastSeq = Math.max(lastSeq, entry.seq);
    await persist(entry);
    if (entries.length > limit) {
      const removed = entries.splice(0, entries.length - limit);
      for (const old of removed) byId.delete(old.id);
    }
    return entry;
  }

  async function catchUp() {
    const pending = log
      .all()
      .filter((event) => event && event.seq > lastSeq)
      .sort((a, b) => a.seq - b.seq);
    let appended = 0;
    for (const event of pending) {
      const entry = await appendEvent(event);
      if (entry) appended += 1;
    }
    return appended;
  }

  async function refresh() {
    const appended = await catchUp();
    return { appended, total: entries.length };
  }

  async function hydrate() {
    if (!db) return entries.length;
    for (const stored of db.all(collection)) {
      if (!stored || !stored.id) continue;
      entries.push(stored);
      byId.set(stored.id, stored);
      lastSeq = Math.max(lastSeq, stored.seq || 0);
    }
    entries.sort((a, b) => a.seq - b.seq);
    return entries.length;
  }

  function all() {
    return entries.slice();
  }

  function get(id) {
    return byId.get(id) || null;
  }

  function haystack(entry) {
    return [
      entry.type,
      entry.action,
      entry.actionLabel,
      entry.entityType,
      entry.entityId,
      entry.entityName,
      entry.source,
      entry.actor,
      entry.field,
      entry.summary,
      entry.movement?.from,
      entry.movement?.to,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function matches(entry, query = {}) {
    if (query.entityType && entry.entityType !== query.entityType) return false;
    if (query.entityId && entry.entityId !== query.entityId) return false;
    if (query.action && entry.action !== query.action) return false;
    if (query.direction && entry.direction !== query.direction) return false;
    if (query.topic && entry.topic !== query.topic) return false;
    if (query.actor && entry.actor !== query.actor) return false;
    if (query.connector && ![entry.source, entry.movement?.from, entry.movement?.to].includes(query.connector)) return false;
    if (query.seqFrom != null && entry.seq < query.seqFrom) return false;
    if (query.seqTo != null && entry.seq > query.seqTo) return false;
    if (query.text && !haystack(entry).includes(String(query.text).trim().toLowerCase())) return false;
    return true;
  }

  function filter(query = {}) {
    const order = query.order === "asc" ? 1 : -1;
    const list = entries.filter((entry) => matches(entry, query));
    list.sort((a, b) => (a.seq - b.seq) * order);
    return query.limit != null ? list.slice(0, query.limit) : list;
  }

  function search(text, query = {}) {
    return filter({ ...query, text });
  }

  function recent(n = 50) {
    return entries.slice(-Math.max(0, n)).reverse();
  }

  function lifecycle(typeId, entityId) {
    const list = entries
      .filter((entry) => entry.entityType === typeId && entry.entityId === entityId)
      .sort((a, b) => a.seq - b.seq);
    const actions = Array.from(new Set(list.map((entry) => entry.action)));
    const connectors = Array.from(new Set(list.flatMap((entry) => [entry.source, entry.movement?.from, entry.movement?.to]).filter((value) => value && value !== "ru")));
    const fields = Array.from(new Set(list.map((entry) => entry.field).filter(Boolean)));
    return {
      entityType: typeId,
      entityId,
      entityName: resolveName(typeId, entityId) || entityId,
      count: list.length,
      firstAt: list[0]?.at || null,
      lastAt: list[list.length - 1]?.at || null,
      actions,
      connectors,
      fields,
      entries: list,
    };
  }

  function moves({ direction = null, ...query } = {}) {
    return filter(query).filter((entry) => entry.movement && (!direction || entry.direction === direction));
  }

  function facets() {
    const tally = (values) => {
      const counts = new Map();
      for (const value of values) {
        if (value == null) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
    };
    return {
      actions: tally(entries.map((entry) => entry.action)),
      connectors: tally(entries.flatMap((entry) => [entry.source, entry.movement?.from, entry.movement?.to]).filter((value) => value && value !== "ru")),
      entityTypes: tally(entries.map((entry) => entry.entityType)),
      directions: tally(entries.map((entry) => entry.direction)),
      topics: tally(entries.map((entry) => entry.topic)),
    };
  }

  function verify() {
    let previous = "";
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const expected = hashFor(previous, entry);
      if (entry.prevHash !== previous || entry.hash !== expected) {
        return { ok: false, length: entries.length, checked: index, brokenAt: entry.id, seq: entry.seq };
      }
      previous = entry.hash;
    }
    return { ok: true, length: entries.length, checked: entries.length, brokenAt: null, seq: null };
  }

  function stats() {
    const byDirection = {};
    for (const direction of AUDIT_DIRECTIONS) byDirection[direction] = 0;
    const byAction = {};
    const byConnector = {};
    for (const entry of entries) {
      byDirection[entry.direction] = (byDirection[entry.direction] || 0) + 1;
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      byConnector[entry.source] = (byConnector[entry.source] || 0) + 1;
    }
    return {
      total: entries.length,
      lastSeq,
      byDirection,
      byAction,
      byConnector,
      inbound: byDirection.in || 0,
      outbound: byDirection.out || 0,
      chain: verify(),
    };
  }

  async function note({ message, actor = "operator" } = {}) {
    const text = String(message == null ? "" : message).trim();
    if (!text) return { ok: false, error: "A note needs a message." };
    if (text.length > 500) return { ok: false, error: "Keep the note under 500 characters." };
    if (!emit) return { ok: false, error: "The audit log cannot publish notes yet." };
    const result = await emit("audit.note", { message: text, actor }, { source: "ru" });
    if (result && result.ok === false) return { ok: false, error: "The note was rejected by the event bus." };
    await catchUp();
    const entry = result?.event ? byId.get(result.event.id) : null;
    return { ok: true, entry: entry || null };
  }

  async function reset() {
    entries.length = 0;
    byId.clear();
    lastSeq = 0;
    if (db) await db.clear(collection);
  }

  return {
    collection,
    actions: AUDIT_ACTIONS,
    hydrate,
    catchUp,
    refresh,
    appendEvent,
    all,
    get,
    recent,
    filter,
    search,
    matches,
    lifecycle,
    moves,
    facets,
    verify,
    stats,
    note,
    reset,
  };
}
