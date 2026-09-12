import { EVENT_TYPES, TOPICS, topicMatches, topicOf } from "./event-catalog.js";
import { validateEnvelope, knownEventTypes } from "./event-schema.js";
import { hash36 } from "./ids.js";

export { topicMatches };

let counter = 0;

function defaultId(prefix, seed) {
  counter += 1;
  return `${prefix}_${hash36(`${seed}:${counter}`)}`;
}

export function createEventBus({
  catalog = EVENT_TYPES,
  log = null,
  connectors = null,
  clock = () => Date.now(),
  historyLimit = 200,
  validator = validateEnvelope,
  idFactory = defaultId,
} = {}) {
  const subscriptions = new Map();
  const history = [];
  const topicCounts = new Map();
  const typeCounts = new Map();
  const recentRejections = [];
  let seq = 0;
  let published = 0;
  let rejected = 0;
  let deliveryCount = 0;
  let failureCount = 0;

  function knownType(type) {
    return catalog.some((entry) => entry.type === type);
  }

  function nextSeq() {
    const last = seq;
    seq += 1;
    return last + 1;
  }

  function buildEnvelope(type, payload, options = {}) {
    const source = options.source || "iu";
    const time = options.time || new Date(clock()).toISOString();
    const id = options.id || idFactory("ev", `${type}:${source}:${time}:${seq + 1}`);
    const subject = options.subject || null;
    const envelope = {
      id,
      type,
      version: options.version != null ? options.version : (catalog.find((e) => e.type === type)?.version ?? 1),
      source,
      time,
      seq: options.seq != null ? options.seq : nextSeq(),
      payload: payload && typeof payload === "object" ? payload : {},
    };
    if (subject) envelope.subject = subject;
    if (options.correlationId) envelope.correlationId = options.correlationId;
    if (options.causationId) envelope.causationId = options.causationId;
    if (options.meta && Object.keys(options.meta).length) envelope.meta = options.meta;
    return envelope;
  }

  function matchingSubscriptions(type) {
    const out = [];
    for (const sub of subscriptions.values()) {
      if (!sub.active) continue;
      if (topicMatches(sub.pattern, type)) out.push(sub);
    }
    return out.sort((a, b) => (b.priority - a.priority) || (a.order - b.order));
  }

  async function deliver(envelope) {
    const targets = matchingSubscriptions(envelope.type);
    const deliveries = [];
    for (const sub of targets) {
      sub.delivered += 1;
      sub.lastSeq = envelope.seq;
      sub.lastDelivery = envelope.time;
      deliveryCount += 1;
      try {
        const result = await sub.handler(envelope);
        deliveries.push({ subscriptionId: sub.id, pattern: sub.pattern, ok: true });
        if (typeof result === "function") sub.dispose = result;
      } catch (error) {
        failureCount += 1;
        deliveries.push({ subscriptionId: sub.id, pattern: sub.pattern, ok: false, error: error && error.message ? error.message : String(error) });
        if (typeof console !== "undefined") console.warn(`Integrate-U: subscriber "${sub.pattern}" threw while handling ${envelope.type}`, error);
      }
    }
    return deliveries;
  }

  async function publish(type, payload = {}, options = {}) {
    if (!knownType(type)) {
      rejected += 1;
      const result = { ok: false, event: null, issues: [{ level: "error", code: "unknown-type", path: "type", message: `Unknown event type "${type}".` }], deliveries: [] };
      recentRejections.unshift({ type, at: new Date(clock()).toISOString(), issues: result.issues });
      recentRejections.length = Math.min(recentRejections.length, 10);
      return result;
    }

    const envelope = buildEnvelope(type, payload, options);
    const report = validator(envelope, { connectors });
    if (!report.ok && options.strict !== false) {
      rejected += 1;
      recentRejections.unshift({ type, at: new Date(clock()).toISOString(), issues: report.issues });
      recentRejections.length = Math.min(recentRejections.length, 10);
      return { ok: false, event: envelope, issues: report.issues, deliveries: [] };
    }

    published += 1;
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    const topic = topicOf(type);
    topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);

    if (log && options.persist !== false) await log.append(envelope);

    history.push(envelope);
    if (history.length > historyLimit) history.splice(0, history.length - historyLimit);

    const deliveries = await deliver(envelope);
    return { ok: true, event: envelope, issues: report.issues, deliveries };
  }

  function subscribe(pattern, handler, options = {}) {
    if (typeof pattern !== "string" || !pattern) throw new Error("A subscription pattern is required");
    if (typeof handler !== "function") throw new Error("A subscription handler is required");
    const id = options.id || idFactory("sub", `${pattern}:${subscriptions.size}`);
    if (subscriptions.has(id)) throw new Error(`Subscription "${id}" already exists`);
    const sub = {
      id,
      pattern,
      handler,
      priority: options.priority || 0,
      once: !!options.once,
      label: options.label || "",
      connector: options.connector || null,
      order: subscriptions.size,
      active: true,
      delivered: 0,
      lastSeq: null,
      lastDelivery: null,
      createdAt: new Date(clock()).toISOString(),
      dispose: null,
    };
    if (sub.once) {
      const original = sub.handler;
      sub.handler = async (event) => {
        sub.active = false;
        subscriptions.delete(id);
        return original(event);
      };
    }
    subscriptions.set(id, sub);
    return subscriptionHandle(sub);
  }

  function subscriptionHandle(sub) {
    return {
      id: sub.id,
      pattern: sub.pattern,
      get active() {
        return sub.active;
      },
      get delivered() {
        return sub.delivered;
      },
      unsubscribe() {
        sub.active = false;
        subscriptions.delete(sub.id);
        return true;
      },
    };
  }

  function unsubscribe(id) {
    const sub = subscriptions.get(id);
    if (!sub) return false;
    sub.active = false;
    subscriptions.delete(id);
    return true;
  }

  function subscribersOf(type) {
    return matchingSubscriptions(type).map((sub) => ({ id: sub.id, pattern: sub.pattern, connector: sub.connector, delivered: sub.delivered }));
  }

  function subscriberList() {
    return Array.from(subscriptions.values()).map((sub) => ({
      id: sub.id,
      pattern: sub.pattern,
      connector: sub.connector,
      label: sub.label,
      once: sub.once,
      priority: sub.priority,
      delivered: sub.delivered,
      lastSeq: sub.lastSeq,
      createdAt: sub.createdAt,
    }));
  }

  function recentPublished(n = 20) {
    return history.slice(-Math.max(0, n));
  }

  function stats() {
    return {
      published,
      rejected,
      deliveryCount,
      failureCount,
      subscriberCount: subscriptions.size,
      activeSubscribers: Array.from(subscriptions.values()).filter((s) => s.active).length,
      types: knownEventTypes().length,
      topics: TOPICS.length,
      byTopic: Object.fromEntries(topicCounts),
      byType: Object.fromEntries(typeCounts),
      recentRejections: recentRejections.slice(0, 5),
    };
  }

  async function reset() {
    for (const sub of subscriptions.values()) sub.active = false;
    subscriptions.clear();
    history.length = 0;
    seq = 0;
    published = 0;
    rejected = 0;
    deliveryCount = 0;
    failureCount = 0;
    topicCounts.clear();
    typeCounts.clear();
    recentRejections.length = 0;
  }

  function resetStats() {
    history.length = 0;
    published = 0;
    rejected = 0;
    deliveryCount = 0;
    failureCount = 0;
    topicCounts.clear();
    typeCounts.clear();
    recentRejections.length = 0;
  }

  return {
    catalog,
    publish,
    subscribe,
    unsubscribe,
    subscribersOf,
    subscriberList,
    recentPublished,
    matchingSubscriptions,
    stats,
    reset,
    resetStats,
    knownType,
    lastSeq: () => seq,
  };
}
