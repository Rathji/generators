import { hash36 } from "./ids.js";

export function createLinkStore({ db = null, collection = "links", clock = () => Date.now() } = {}) {
  const edges = new Map();
  const outIndex = new Map();
  const inIndex = new Map();

  function keyOf(typeId, entityId) {
    return `${typeId}:${entityId}`;
  }

  function edgeId(fromType, fromId, type, toType, toId) {
    return `ln_${hash36(`${fromType}:${fromId}|${type}|${toType}:${toId}`)}`;
  }

  function addTo(index, key, id) {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(id);
  }

  function dropFrom(index, key, id) {
    const set = index.get(key);
    if (!set) return;
    set.delete(id);
    if (!set.size) index.delete(key);
  }

  function index(edge) {
    addTo(outIndex, keyOf(edge.fromType, edge.fromId), edge.id);
    addTo(inIndex, keyOf(edge.toType, edge.toId), edge.id);
  }

  function unindex(edge) {
    dropFrom(outIndex, keyOf(edge.fromType, edge.fromId), edge.id);
    dropFrom(inIndex, keyOf(edge.toType, edge.toId), edge.id);
  }

  function hydrate() {
    for (const stored of db ? db.all(collection) : []) {
      if (!stored || !stored.id || edges.has(stored.id)) continue;
      edges.set(stored.id, stored);
      index(stored);
    }
    return edges.size;
  }

  async function put(edge) {
    const id = edge.id || edgeId(edge.fromType, edge.fromId, edge.type, edge.toType, edge.toId);
    const existing = edges.get(id);
    if (existing) unindex(existing);
    const record = { ...edge, id, updatedAt: new Date(clock()).toISOString() };
    if (!record.createdAt) record.createdAt = record.updatedAt;
    edges.set(id, record);
    index(record);
    if (db) await db.put(collection, id, record);
    return record;
  }

  async function remove(id) {
    const edge = edges.get(id);
    if (!edge) return false;
    unindex(edge);
    edges.delete(id);
    if (db) await db.remove(collection, id);
    return true;
  }

  async function removeWhere(predicate) {
    const ids = Array.from(edges.values())
      .filter(predicate)
      .map((edge) => edge.id);
    for (const id of ids) await remove(id);
    return ids.length;
  }

  function all() {
    return Array.from(edges.values());
  }

  function get(id) {
    return edges.get(id) || null;
  }

  function outgoing(typeId, entityId) {
    const ids = outIndex.get(keyOf(typeId, entityId));
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => edges.get(id))
      .filter(Boolean);
  }

  function incoming(typeId, entityId) {
    const ids = inIndex.get(keyOf(typeId, entityId));
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => edges.get(id))
      .filter(Boolean);
  }

  function linksBetween(typeId, entityId) {
    return { outgoing: outgoing(typeId, entityId), incoming: incoming(typeId, entityId) };
  }

  function find({ fromType, fromId, toType, toId, type, origin, field } = {}) {
    return all().filter(
      (edge) =>
        (fromType == null || edge.fromType === fromType) &&
        (fromId == null || edge.fromId === fromId) &&
        (toType == null || edge.toType === toType) &&
        (toId == null || edge.toId === toId) &&
        (type == null || edge.type === type) &&
        (origin == null || edge.origin === origin) &&
        (field == null || edge.field === field)
    );
  }

  function byType(linkTypeId) {
    return all().filter((edge) => edge.type === linkTypeId);
  }

  function count() {
    return edges.size;
  }

  async function clear() {
    if (db) await db.clear(collection);
    edges.clear();
    outIndex.clear();
    inIndex.clear();
  }

  function stats() {
    const byType = {};
    const entities = new Set();
    for (const edge of edges.values()) {
      byType[edge.type] = (byType[edge.type] || 0) + 1;
      entities.add(keyOf(edge.fromType, edge.fromId));
      entities.add(keyOf(edge.toType, edge.toId));
    }
    return { edges: edges.size, byType, entities: entities.size };
  }

  return {
    collection,
    edgeId,
    hydrate,
    put,
    remove,
    removeWhere,
    all,
    get,
    outgoing,
    incoming,
    linksBetween,
    find,
    byType,
    count,
    clear,
    stats,
  };
}
