import { ENTITY_TYPES } from "./catalog.js";
import { makeId, normalizeDomain, normalizeEmail, slugify, tokenSimilarity } from "./ids.js";

export function refKey(connectorId, nativeId) {
  return `${connectorId}:${nativeId}`;
}

export function naturalKey(typeId, fields = {}, ctx = {}) {
  const value = (key) => (fields[key] == null ? "" : String(fields[key]));

  if (typeId === "company") {
    const domain = normalizeDomain(value("domain") || value("website"));
    if (domain) return `domain:${domain}`;
    const name = slugify(value("name"));
    if (name) return `name:${name}${value("city") ? "@" + slugify(value("city")) : ""}`;
  }
  if (typeId === "customer") {
    const email = normalizeEmail(value("email"));
    if (email) return `email:${email}`;
    const name = slugify(value("fullName") || value("name"));
    if (name) return `name:${name}${value("company") ? "@" + slugify(value("company")) : ""}`;
  }
  if (typeId === "device") {
    const serial = slugify(value("serial"));
    if (serial) return `serial:${serial}`;
    const host = slugify(value("hostname"));
    if (host) return `hostname:${host}`;
  }
  if (typeId === "invoice") {
    const number = slugify(value("number"));
    if (number) return `number:${number}`;
  }
  if (ctx.connector && ctx.nativeId) return `ref:${ctx.connector}:${ctx.nativeId}`;
  return "";
}

export function createIdentityStore({ db, entityTypes = ENTITY_TYPES, registry = null, clock = () => Date.now() } = {}) {
  const types = entityTypes && entityTypes.length ? entityTypes : ENTITY_TYPES;
  const typeById = new Map(types.map((t) => [t.id, t]));

  function typeDef(typeId) {
    const def = typeById.get(typeId);
    if (!def) throw new Error(`Unknown entity type "${typeId}"`);
    return def;
  }

  function collectionFor(typeId) {
    return typeDef(typeId).collection;
  }

  function all(typeId) {
    return db.all(collectionFor(typeId));
  }

  function get(typeId, id) {
    return db.get(collectionFor(typeId), id);
  }

  function count(typeId) {
    return db.count(collectionFor(typeId));
  }

  function nameOf(typeId, entity) {
    const def = typeDef(typeId);
    return (entity && entity.fields && entity.fields[def.nameField]) || (entity && entity.displayName) || entity?.id || "";
  }

  function findByRef(connectorId, nativeId) {
    const entry = db.get("refs", refKey(connectorId, nativeId));
    if (!entry) return null;
    return get(entry.type, entry.entityId);
  }

  function findByKey(key) {
    const entry = db.get("keys", key);
    if (!entry) return null;
    return get(entry.type, entry.entityId);
  }

  function fieldValue(fields, ...keys) {
    for (const key of keys) {
      const value = fields?.[key];
      if (value != null && String(value).trim() !== "") return value;
    }
    return "";
  }

  function matchEntity(typeId, fields) {
    const list = all(typeId);
    const domain = normalizeDomain(fieldValue(fields, "domain", "website"));
    const name = slugify(fieldValue(fields, "name", "fullName"));
    const email = normalizeEmail(fieldValue(fields, "email"));
    const serial = slugify(fieldValue(fields, "serial"));
    const hostname = slugify(fieldValue(fields, "hostname"));
    const number = slugify(fieldValue(fields, "number"));

    for (const entity of list) {
      const f = entity.fields || {};
      if (typeId === "company") {
        if (domain && normalizeDomain(fieldValue(f, "domain", "website")) === domain) return entity;
        if (name && slugify(fieldValue(f, "name")) === name) return entity;
      } else if (typeId === "customer") {
        const existingEmail = normalizeEmail(fieldValue(f, "email"));
        if (email && existingEmail === email) return entity;
        if (email && existingEmail && existingEmail !== email) continue;
        if (name && slugify(fieldValue(f, "fullName", "name")) === name) return entity;
      } else if (typeId === "device") {
        if (serial && slugify(fieldValue(f, "serial")) === serial) return entity;
        if (hostname && slugify(fieldValue(f, "hostname")) === hostname) return entity;
      } else if (typeId === "invoice") {
        if (number && slugify(fieldValue(f, "number")) === number) return entity;
      }
    }
    return null;
  }

  function allocateId(typeId, key) {
    const def = typeDef(typeId);
    const base = makeId(def.idPrefix, key || `${typeId}:${clock()}`);
    let candidate = base;
    let suffix = 2;
    while (db.has(def.collection, candidate)) {
      candidate = `${base}_${suffix++}`;
    }
    return candidate;
  }

  function dedupe(list) {
    return Array.from(new Set(list.filter(Boolean)));
  }

  async function upsert(typeId, { fields = {}, connector = "iu", nativeId = null } = {}) {
    const def = typeDef(typeId);
    const collection = def.collection;
    const clean = {};
    for (const [key, value] of Object.entries(fields || {})) {
      if (value == null) continue;
      if (typeof value === "string" && !value.trim()) continue;
      clean[key] = value;
    }

    const key = naturalKey(typeId, clean, { connector, nativeId });
    let entity = null;
    let created = false;

    if (connector && nativeId) entity = findByRef(connector, nativeId);
    if (!entity && key) entity = findByKey(key);
    if (!entity) entity = matchEntity(typeId, clean);

    const now = new Date(clock()).toISOString();

    if (!entity) {
      const id = allocateId(typeId, key);
      entity = {
        id,
        type: typeId,
        fields: {},
        fieldSources: {},
        keys: [],
        refs: [],
        aliases: [],
        createdAt: now,
        updatedAt: now,
      };
      created = true;
    }

    for (const [field, value] of Object.entries(clean)) {
      entity.fields[field] = value;
      entity.fieldSources[field] = connector;
    }

    entity.displayName = String(entity.fields[def.nameField] || entity.displayName || entity.id);
    entity.keys = dedupe([...(entity.keys || []), key]);
    if (connector && nativeId) {
      const existing = (entity.refs || []).some((r) => r.connector === connector && r.nativeId === nativeId);
      if (!existing) entity.refs = [...(entity.refs || []), { connector, nativeId }];
    }
    entity.updatedAt = now;

    await db.put(collection, entity.id, entity);
    if (key) await db.put("keys", key, { entityId: entity.id, type: typeId, key });
    if (connector && nativeId) {
      await db.put("refs", refKey(connector, nativeId), { entityId: entity.id, type: typeId, connector, nativeId });
    }
    return { entity, created };
  }

  async function merge(typeId, keepId, dropId) {
    const def = typeDef(typeId);
    const collection = def.collection;
    const keep = get(typeId, keepId);
    const drop = get(typeId, dropId);
    if (!keep || !drop) throw new Error("Both entities must exist to merge");
    if (keep.id === drop.id) return keep;

    const now = new Date(clock()).toISOString();

    for (const [field, value] of Object.entries(drop.fields || {})) {
      const current = keep.fields[field];
      if (current == null || current === "") {
        keep.fields[field] = value;
        keep.fieldSources[field] = drop.fieldSources?.[field] || keep.fieldSources[field] || "merged";
      }
    }

    const refMap = new Map();
    for (const ref of [...(keep.refs || []), ...(drop.refs || [])]) refMap.set(refKey(ref.connector, ref.nativeId), ref);
    keep.refs = Array.from(refMap.values());
    keep.keys = dedupe([...(keep.keys || []), ...(drop.keys || [])]);
    keep.aliases = dedupe([...(keep.aliases || []), ...(drop.aliases || []), drop.displayName]);
    keep.mergedFrom = [...(keep.mergedFrom || []), { id: drop.id, at: now, displayName: drop.displayName }];
    keep.updatedAt = now;

    for (const key of drop.keys || []) {
      await db.put("keys", key, { entityId: keep.id, type: typeId, key });
    }
    for (const ref of drop.refs || []) {
      await db.put("refs", refKey(ref.connector, ref.nativeId), { entityId: keep.id, type: typeId, connector: ref.connector, nativeId: ref.nativeId });
    }
    await db.put(collection, keep.id, keep);
    await db.remove(collection, drop.id);
    return keep;
  }

  function leadTokenOf(value) {
    return slugify(value).split("-")[0] || "";
  }

  async function setField(typeId, id, field, value, source = "iu") {
    const entity = get(typeId, id);
    if (!entity) return null;
    entity.fields = { ...(entity.fields || {}), [field]: value };
    entity.fieldSources = { ...(entity.fieldSources || {}), [field]: source };
    entity.updatedAt = new Date(clock()).toISOString();
    await db.put(collectionFor(typeId), entity.id, entity);
    return entity;
  }

  function findDuplicates(typeId = null) {
    const targetTypes = typeId ? [typeId] : ["company", "customer"];
    const out = [];
    for (const t of targetTypes) {
      const list = all(t);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const aDomain = normalizeDomain(a.fields?.domain || "");
          const bDomain = normalizeDomain(b.fields?.domain || "");
          const similarity = tokenSimilarity(nameOf(t, a), nameOf(t, b));
          const aEmail = normalizeEmail(a.fields?.email || "");
          const bEmail = normalizeEmail(b.fields?.email || "");

          if (aDomain && aDomain === bDomain) {
            out.push({ type: t, keepId: a.id, dropId: b.id, confidence: 1, reason: `Both resolve to ${aDomain}` });
          } else if (aEmail && aEmail === bEmail) {
            out.push({ type: t, keepId: a.id, dropId: b.id, confidence: 1, reason: `Both share ${aEmail}` });
          } else if (similarity >= 0.5 && leadTokenOf(nameOf(t, a)) === leadTokenOf(nameOf(t, b))) {
            const keep = (a.refs?.length || 0) >= (b.refs?.length || 0) ? a : b;
            const drop = keep === a ? b : a;
            out.push({ type: t, keepId: keep.id, dropId: drop.id, confidence: similarity, reason: `${Math.round(similarity * 100)}% name match` });
          }
        }
      }
    }
    return out.sort((x, y) => y.confidence - x.confidence);
  }

  function search(query, { type = null } = {}) {
    const q = String(query || "").trim().toLowerCase();
    const typeList = type ? [type] : types.map((t) => t.id);
    const out = [];
    for (const t of typeList) {
      for (const entity of all(t)) {
        const haystack = [
          entity.id,
          entity.displayName,
          ...Object.values(entity.fields || {}),
          ...(entity.refs || []).map((r) => `${r.connector} ${r.nativeId}`),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!q || haystack.includes(q)) out.push(entity);
      }
    }
    return out;
  }

  function stats() {
    const byType = {};
    let total = 0;
    for (const t of types) {
      const n = count(t.id);
      byType[t.id] = n;
      total += n;
    }
    return {
      total,
      byType,
      refs: db.count("refs"),
      keys: db.count("keys"),
      sources: new Set(
        types.flatMap((t) => all(t.id).flatMap((e) => (e.refs || []).map((r) => r.connector)))
      ).size,
      duplicates: findDuplicates().length,
    };
  }

  async function reset() {
    for (const t of types) await db.clear(t.collection);
    await db.clear("keys");
    await db.clear("refs");
  }

  return {
    entityTypes: types,
    typeDef,
    collectionFor,
    all,
    get,
    count,
    nameOf,
    findByRef,
    findByKey,
    matchEntity,
    upsert,
    merge,
    setField,
    findDuplicates,
    search,
    stats,
    reset,
    refKey,
    naturalKey,
  };
}
