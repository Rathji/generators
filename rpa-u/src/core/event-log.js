import { topicMatches } from "./event-catalog.js";

export function createEventLog({ db = null, limit = 500, clock = () => Date.now() } = {}) {
  const COLLECTION = "events";
  const CHECKPOINTS = "checkpoints";
  const entries = [];
  const byId = new Map();
  let dropped = 0;

  function keyOf(event) {
    return String(event.seq).padStart(12, "0") + ":" + event.id;
  }

  function sortEntries() {
    entries.sort((a, b) => a.seq - b.seq);
  }

  async function hydrate() {
    if (!db) return;
    for (const stored of db.all(COLLECTION)) {
      if (!stored || !stored.id) continue;
      entries.push(stored);
      byId.set(stored.id, stored);
    }
    sortEntries();
    if (entries.length > limit) await prune(limit);
  }

  async function append(event) {
    if (!event || !event.id) return null;
    if (byId.has(event.id)) return byId.get(event.id);
    entries.push(event);
    byId.set(event.id, event);
    sortEntries();
    if (db) {
      await db.put(COLLECTION, keyOf(event), { ...event, loggedAt: new Date(clock()).toISOString() });
    }
    if (entries.length > limit) await prune(limit);
    return event;
  }

  async function prune(keep = limit) {
    const excess = entries.length - keep;
    if (excess <= 0) return 0;
    const removed = entries.splice(0, excess);
    for (const event of removed) {
      byId.delete(event.id);
      if (db) await db.remove(COLLECTION, keyOf(event));
    }
    dropped += removed.length;
    return removed.length;
  }

  function all() {
    return entries.slice();
  }

  function size() {
    return entries.length;
  }

  function get(id) {
    return byId.get(id) || null;
  }

  function recent(n = 20) {
    return entries.slice(-Math.max(0, n));
  }

  function since(seq, { inclusive = false } = {}) {
    return entries.filter((e) => (inclusive ? e.seq >= seq : e.seq > seq));
  }

  function byType(type) {
    return entries.filter((e) => e.type === type);
  }

  function byTopic(pattern) {
    return entries.filter((e) => topicMatches(pattern, e.type));
  }

  function bySource(source) {
    return entries.filter((e) => e.source === source);
  }

  function lastSeq() {
    return entries.length ? entries[entries.length - 1].seq : 0;
  }

  function range(fromSeq, toSeq) {
    const lo = Math.min(fromSeq, toSeq);
    const hi = Math.max(fromSeq, toSeq);
    return entries.filter((e) => e.seq >= lo && e.seq <= hi);
  }

  function replay(handler, { since: fromSeq = 0, to = null } = {}) {
    const list = entries.filter((e) => e.seq > fromSeq && (to == null || e.seq <= to));
    let handled = 0;
    for (const event of list) {
      if (handler) handler(event);
      handled++;
    }
    return handled;
  }

  async function saveCheckpoint(connectorId, seq = lastSeq(), meta = {}) {
    const record = { connector: connectorId, seq, at: new Date(clock()).toISOString(), ...meta };
    if (db) await db.put(CHECKPOINTS, connectorId, record);
    return record;
  }

  function checkpointOf(connectorId) {
    if (!db) return null;
    return db.get(CHECKPOINTS, connectorId) || null;
  }

  function recover(connectorId) {
    const checkpoint = checkpointOf(connectorId);
    if (!checkpoint) return { connector: connectorId, from: 0, events: entries.slice(), replayed: entries.length };
    const events = since(checkpoint.seq);
    return { connector: connectorId, from: checkpoint.seq, events, replayed: events.length };
  }

  async function clear() {
    entries.length = 0;
    byId.clear();
    dropped = 0;
    if (db) {
      await db.clear(COLLECTION);
      await db.clear(CHECKPOINTS);
    }
  }

  function stats() {
    const byTypeMap = {};
    const bySourceMap = {};
    for (const e of entries) {
      byTypeMap[e.type] = (byTypeMap[e.type] || 0) + 1;
      bySourceMap[e.source] = (bySourceMap[e.source] || 0) + 1;
    }
    return {
      size: entries.length,
      limit,
      lastSeq: lastSeq(),
      dropped,
      byType: byTypeMap,
      bySource: bySourceMap,
      checkpoints: db ? db.count(CHECKPOINTS) : 0,
    };
  }

  return {
    collection: COLLECTION,
    checkpointCollection: CHECKPOINTS,
    hydrate,
    append,
    prune,
    all,
    size,
    get,
    recent,
    since,
    range,
    byType,
    byTopic,
    bySource,
    lastSeq,
    replay,
    saveCheckpoint,
    checkpointOf,
    recover,
    clear,
    stats,
  };
}
