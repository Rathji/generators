import { EVENT_TYPES, topicMatches } from "./event-catalog.js";
import { CONNECTORS } from "./catalog.js";
import { hash36 } from "./ids.js";

export const DEFAULT_SUBSCRIPTIONS = [
  { connector: "psa-u", topic: "device.*", label: "Open a ticket when a device goes offline" },
  { connector: "psa-u", topic: "invoice.*", label: "Track billing activity against jobs" },
  { connector: "it-u", topic: "identity.*", label: "Keep documentation bound to canonical identities" },
  { connector: "it-u", topic: "device.registered", label: "Add new assets to the inventory" },
  { connector: "rmm-u", topic: "sync.requested", label: "Answer authoritative-value requests" },
  { connector: "rmm-u", topic: "device.checkin", label: "Refresh monitoring state" },
  { connector: "crm-u", topic: "ticket.*", label: "Surface open work on the customer record" },
  { connector: "crm-u", topic: "identity.merged", label: "Re-key customer records after a merge" },
  { connector: "iu", topic: "*", label: "Hub audit trail — records every event" },
];

let counter = 0;

export function createSubscriptionManager({
  bus,
  db = null,
  connectors = CONNECTORS,
  catalog = EVENT_TYPES,
  clock = () => Date.now(),
  deliveryLimit = 100,
  emit = null,
} = {}) {
  const COLLECTION = "subscriptions";
  const records = new Map();
  const handles = new Map();
  const deliveries = [];
  const connectorIds = new Set(connectors.map((c) => c.id));
  const knownTypes = catalog.map((entry) => entry.type);

  function topicIsKnown(pattern) {
    if (pattern === "*") return true;
    return knownTypes.some((type) => topicMatches(pattern, type));
  }

  function newId(connector, topic) {
    let id;
    do {
      counter += 1;
      id = `sub_${hash36(`${connector}:${topic}:${counter}`)}`;
    } while (records.has(id));
    return id;
  }

  function recordFor(id) {
    return records.get(id) || null;
  }

  function attach(record, sink = null) {
    const handle = bus.subscribe(
      record.topic,
      async (event) => {
        record.delivered += 1;
        record.lastSeq = event.seq;
        record.lastEventAt = event.time;
        deliveries.unshift({ subscriptionId: record.id, connector: record.connector, topic: record.topic, type: event.type, seq: event.seq, at: event.time });
        deliveries.length = Math.min(deliveries.length, deliveryLimit);
        if (typeof sink === "function") await sink(event, record);
      },
      { id: record.id, connector: record.connector, label: record.label, priority: record.priority }
    );
    handles.set(record.id, handle);
    return handle;
  }

  async function persist(record) {
    if (!db) return;
    await db.put(COLLECTION, record.id, { ...record });
  }

  async function register({ connector, topic, label = "", description = "", priority = 0, sink = null } = {}) {
    const issues = [];
    if (!connectorIds.has(connector)) issues.push({ level: "error", code: "unknown-connector", message: `Unknown connector "${connector}".` });
    if (!topic) issues.push({ level: "error", code: "missing-topic", message: "A topic is required." });
    else if (!topicIsKnown(topic)) issues.push({ level: "error", code: "unknown-topic", message: `Topic "${topic}" matches no known event type.` });
    else if (list().some((r) => r.connector === connector && r.topic === topic))
      issues.push({ level: "error", code: "duplicate-subscription", message: `"${connector}" already subscribes to "${topic}".` });

    if (issues.length) return { ok: false, record: null, issues };

    const id = newId(connector, topic);
    const now = new Date(clock()).toISOString();
    const record = {
      id,
      connector,
      topic,
      label,
      description,
      priority,
      active: true,
      delivered: 0,
      lastSeq: null,
      lastEventAt: null,
      createdAt: now,
    };
    records.set(id, record);
    attach(record, sink);
    await persist(record);
    if (emit) await emit("subscription.registered", { subscriptionId: id, connector, topic }, { source: connector, subject: { entityType: "subscription", entityId: id } });
    return { ok: true, record, issues: [] };
  }

  async function unregister(id) {
    const record = records.get(id);
    if (!record) return false;
    const handle = handles.get(id);
    if (handle) handle.unsubscribe();
    handles.delete(id);
    records.delete(id);
    if (db) await db.remove(COLLECTION, id);
    if (emit) await emit("subscription.removed", { subscriptionId: id, connector: record.connector, topic: record.topic }, { source: record.connector });
    return true;
  }

  function list() {
    return Array.from(records.values()).slice().sort((a, b) => a.connector.localeCompare(b.connector) || a.topic.localeCompare(b.topic));
  }

  function forConnector(connectorId) {
    return list().filter((r) => r.connector === connectorId);
  }

  function matching(eventType) {
    return list().filter((r) => topicMatches(r.topic, eventType));
  }

  function forTopic(pattern) {
    return list().filter((r) => r.topic === pattern);
  }

  function recentDeliveries(n = 20) {
    return deliveries.slice(0, Math.max(0, n));
  }

  function countFor(connectorId) {
    return list().filter((r) => r.connector === connectorId).length;
  }

  function stats() {
    const byConnector = {};
    const byTopic = {};
    for (const record of records.values()) {
      byConnector[record.connector] = (byConnector[record.connector] || 0) + 1;
      byTopic[record.topic] = (byTopic[record.topic] || 0) + 1;
    }
    return {
      subscriptions: records.size,
      connectors: Object.keys(byConnector).length,
      byConnector,
      byTopic,
      delivered: deliveries.length ? deliveries[0].seq : 0,
      recentDeliveries: deliveries.length,
    };
  }

  async function seedDefaults() {
    for (const seed of DEFAULT_SUBSCRIPTIONS) {
      if (list().some((r) => r.connector === seed.connector && r.topic === seed.topic)) continue;
      await register(seed);
    }
    return list();
  }

  async function ready() {
    if (db) {
      for (const stored of db.all(COLLECTION)) {
        if (!stored || !stored.id || records.has(stored.id)) continue;
        const record = { ...stored, delivered: stored.delivered || 0, active: true };
        records.set(record.id, record);
        attach(record, null);
      }
    }
    return list();
  }

  async function reset() {
    for (const [id, handle] of handles) {
      handle.unsubscribe();
      handles.delete(id);
    }
    if (db) {
      const ids = Array.from(records.keys());
      for (const id of ids) await db.remove(COLLECTION, id);
    }
    records.clear();
    deliveries.length = 0;
  }

  return {
    collection: COLLECTION,
    defaults: DEFAULT_SUBSCRIPTIONS,
    register,
    unregister,
    recordFor,
    list,
    forConnector,
    forTopic,
    matching,
    recentDeliveries,
    countFor,
    stats,
    seedDefaults,
    ready,
    reset,
    topicIsKnown,
    topicMatches,
  };
}
