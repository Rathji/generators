import { LINK_TYPES, LINK_STATUSES, linkType, linkTypesFor, linkTypeForField } from "./link-catalog.js";
import { createLinkStore } from "./link-store.js";
import { normalizeDomain, normalizeEmail, slugify } from "./ids.js";

const EXACT = 1;
const PREFIX = 0.9;
const PARTIAL = 0.7;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

export function createLinker({ identity, db = null, linkTypes = LINK_TYPES, clock = () => Date.now() } = {}) {
  if (!identity) throw new Error("createLinker requires an identity store");
  const typeById = new Map(linkTypes.map((entry) => [entry.id, entry]));
  const links = createLinkStore({ db, clock });

  function knownTypeId(id) {
    return !!typeById.get(id);
  }

  function entitiesOf(typeId) {
    return identity.all(typeId);
  }

  function tokensFor(typeId, entity) {
    const out = [clean(entity.id), clean(entity.displayName)];
    const def = identity.typeDef(typeId);
    if (def?.nameField) out.push(clean(entity.fields?.[def.nameField]));
    for (const value of Object.values(entity.fields || {})) out.push(clean(value));
    for (const ref of entity.refs || []) out.push(clean(ref.nativeId));
    return Array.from(new Set(out.filter(Boolean)));
  }

  function scoreEntity(typeId, entity, raw) {
    const q = clean(raw).toLowerCase();
    if (!q) return null;
    const qDomain = normalizeDomain(raw);
    const qEmail = normalizeEmail(raw);
    let best = null;
    const consider = (score, reason) => {
      if (!best || score > best.score) best = { score, reason };
    };

    if (qDomain && qDomain === normalizeDomain(entity.fields?.domain || "")) consider(EXACT, "domain match");
    if (qEmail && qEmail === normalizeEmail(entity.fields?.email || "")) consider(EXACT, "email match");

    for (const token of tokensFor(typeId, entity)) {
      const t = token.toLowerCase();
      if (t === q) {
        consider(EXACT, `exact “${token}”`);
      } else if (t.startsWith(q) && q.length >= 3) {
        consider(PREFIX, `starts with “${token}”`);
      } else if (t.includes(q) && q.length >= 3) {
        consider(PARTIAL, `contains “${token}”`);
      }
    }

    if (!best) return null;
    return { entityId: entity.id, name: identity.nameOf(typeId, entity), typeId, score: best.score, reason: best.reason };
  }

  function candidates(toType, raw) {
    const out = [];
    for (const entity of entitiesOf(toType)) {
      const scored = scoreEntity(toType, entity, raw);
      if (scored) out.push(scored);
    }
    return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  function manualEdgeFor(fromType, fromId, lt) {
    return links.find({ fromType, fromId, type: lt.id, origin: "manual" })[0] || null;
  }

  function autoEdgesFor(fromType, fromId, lt) {
    return links.find({ fromType, fromId, type: lt.id, origin: "auto" });
  }

  function resolveField(fromType, fromId, linkTypeId) {
    const lt = typeById.get(linkTypeId);
    if (!lt) throw new Error(`Unknown link type "${linkTypeId}"`);
    const entity = identity.get(fromType, fromId);
    if (!entity) {
      return { status: "orphan", raw: "", candidates: [], target: null, confidence: 0, origin: null };
    }
    const raw = clean(entity.fields?.[lt.field]);

    const manual = manualEdgeFor(fromType, fromId, lt);
    if (manual) {
      const target = identity.get(manual.toType, manual.toId);
      return {
        status: "manual",
        raw: manual.raw ?? raw,
        candidates: [],
        target: { typeId: manual.toType, entityId: manual.toId, name: target ? identity.nameOf(manual.toType, target) : manual.toId },
        confidence: manual.confidence ?? 1,
        origin: "manual",
      };
    }

    const auto = autoEdgesFor(fromType, fromId, lt)[0] || null;
    if (!raw) {
      const autoTarget = auto ? identity.get(auto.toType, auto.toId) : null;
      return {
        status: lt.required ? "missing" : "empty",
        raw: "",
        candidates: [],
        target: autoTarget ? { typeId: auto.toType, entityId: auto.toId, name: identity.nameOf(auto.toType, autoTarget) } : null,
        confidence: 0,
        origin: auto ? "auto" : null,
      };
    }

    const list = candidates(lt.toType, raw);
    const exact = list.filter((c) => c.score >= EXACT);
    const pool = exact.length ? exact : list;
    let status;
    let chosen = null;
    if (pool.length === 1) {
      status = "linked";
      chosen = pool[0];
    } else if (pool.length > 1) {
      status = "ambiguous";
    } else {
      status = "dangling";
    }
    return {
      status,
      raw,
      candidates: list.slice(0, 6),
      target: chosen ? { typeId: chosen.typeId, entityId: chosen.entityId, name: chosen.name } : null,
      confidence: chosen ? chosen.score : 0,
      origin: auto ? "auto" : null,
    };
  }

  async function linkField(fromType, fromId, linkTypeId) {
    const lt = typeById.get(linkTypeId);
    const resolution = resolveField(fromType, fromId, linkTypeId);
    const existing = autoEdgesFor(fromType, fromId, lt);
    let created = 0;
    let removed = 0;

    for (const edge of existing) {
      const keep = resolution.status === "linked" && resolution.target && edge.toType === resolution.target.typeId && edge.toId === resolution.target.entityId;
      if (!keep) {
        await links.remove(edge.id);
        removed += 1;
      }
    }

    let edge = existing.find((e) => resolution.status === "linked" && resolution.target && e.toType === resolution.target.typeId && e.toId === resolution.target.entityId) || null;

    if (resolution.status === "linked" && resolution.target && !edge) {
      edge = await links.put({
        type: lt.id,
        fromType,
        fromId,
        toType: resolution.target.typeId,
        toId: resolution.target.entityId,
        field: lt.field,
        raw: resolution.raw,
        origin: "auto",
        confidence: resolution.confidence,
      });
      created += 1;
    }

    return { resolution, created, removed, edgeId: edge ? edge.id : null, linkTypeId: lt.id };
  }

  async function linkEntity(typeId, entityId, { linkTypeIds = null } = {}) {
    const list = linkTypesFor(typeId).filter((lt) => !linkTypeIds || linkTypeIds.includes(lt.id));
    const result = { typeId, entityId, records: [], created: 0, removed: 0 };
    for (const lt of list) {
      const outcome = await linkField(typeId, entityId, lt.id);
      result.created += outcome.created;
      result.removed += outcome.removed;
      result.records.push({
        fromType: typeId,
        fromId: entityId,
        fromName: identity.nameOf(typeId, identity.get(typeId, entityId)),
        field: lt.field,
        linkTypeId: lt.id,
        toType: lt.toType,
        required: lt.required,
        edgeId: outcome.edgeId,
        ...outcome.resolution,
      });
    }
    return result;
  }

  async function rebuild() {
    let pruned = 0;
    for (const edge of links.all()) {
      const from = identity.get(edge.fromType, edge.fromId);
      const to = identity.get(edge.toType, edge.toId);
      if (!from || !to) {
        await links.remove(edge.id);
        pruned += 1;
      }
    }
    let created = 0;
    let removed = 0;
    for (const lt of linkTypes) {
      for (const entity of entitiesOf(lt.fromType)) {
        const outcome = await linkField(lt.fromType, entity.id, lt.id);
        created += outcome.created;
        removed += outcome.removed;
      }
    }
    return { created, removed, pruned, ...summary() };
  }

  async function override({ fromType, fromId, field, toType, toId, note = "" }) {
    const lt = linkTypeForField(fromType, field);
    if (!lt) return { ok: false, error: `No link type is declared for ${fromType}.${field}` };
    if (lt.toType !== toType) return { ok: false, error: `${lt.id} links to ${lt.toType}, not ${toType}` };
    const source = identity.get(fromType, fromId);
    if (!source) return { ok: false, error: `Unknown ${fromType} "${fromId}"` };
    const target = identity.get(toType, toId);
    if (!target) return { ok: false, error: `Unknown ${toType} "${toId}"` };

    await links.removeWhere((edge) => edge.fromType === fromType && edge.fromId === fromId && edge.field === field);
    const edge = await links.put({
      type: lt.id,
      fromType,
      fromId,
      toType,
      toId,
      field,
      raw: clean(source.fields?.[field]),
      origin: "manual",
      confidence: 1,
      note,
    });
    return { ok: true, edge, linkTypeId: lt.id };
  }

  async function clearField(fromType, fromId, field) {
    const count = await links.removeWhere((edge) => edge.fromType === fromType && edge.fromId === fromId && edge.field === field);
    const lt = linkTypeForField(fromType, field);
    if (lt) await linkField(fromType, fromId, lt.id);
    return count;
  }

  async function removeEntity(typeId, entityId) {
    return links.removeWhere((edge) => (edge.fromType === typeId && edge.fromId === entityId) || (edge.toType === typeId && edge.toId === entityId));
  }

  function decorate(edge) {
    const lt = linkType(edge.type);
    const from = identity.get(edge.fromType, edge.fromId);
    const to = identity.get(edge.toType, edge.toId);
    return {
      ...edge,
      label: lt?.label || edge.type,
      inverseLabel: lt?.inverseLabel || "",
      fromName: from ? identity.nameOf(edge.fromType, from) : "(removed)",
      toName: to ? identity.nameOf(edge.toType, to) : "(removed)",
      missing: !from || !to,
    };
  }

  function outgoing(typeId, entityId, linkTypeId = null) {
    return links
      .outgoing(typeId, entityId)
      .filter((edge) => !linkTypeId || edge.type === linkTypeId)
      .map(decorate);
  }

  function incoming(typeId, entityId, linkTypeId = null) {
    return links
      .incoming(typeId, entityId)
      .filter((edge) => !linkTypeId || edge.type === linkTypeId)
      .map(decorate);
  }

  function edgesFor(typeId, entityId) {
    return { outgoing: outgoing(typeId, entityId), incoming: incoming(typeId, entityId) };
  }

  function linkCount(typeId, entityId) {
    return links.outgoing(typeId, entityId).length + links.incoming(typeId, entityId).length;
  }

  function referenceRecords() {
    const out = [];
    for (const lt of linkTypes) {
      for (const entity of entitiesOf(lt.fromType)) {
        out.push({
          fromType: lt.fromType,
          fromId: entity.id,
          fromName: identity.nameOf(lt.fromType, entity),
          field: lt.field,
          linkTypeId: lt.id,
          toType: lt.toType,
          required: lt.required,
          ...resolveField(lt.fromType, entity.id, lt.id),
        });
      }
    }
    return out;
  }

  function report({ status = null, linkTypeId = null } = {}) {
    return referenceRecords().filter(
      (record) => (!status || (Array.isArray(status) ? status.includes(record.status) : record.status === status)) && (!linkTypeId || record.linkTypeId === linkTypeId)
    );
  }

  function summary() {
    const records = referenceRecords();
    const byStatus = {};
    for (const record of records) byStatus[record.status] = (byStatus[record.status] || 0) + 1;
    const store = links.stats();
    const byLinkType = {};
    for (const lt of linkTypes) byLinkType[lt.id] = store.byType[lt.id] || 0;
    return {
      edges: store.edges,
      byType: byLinkType,
      linkedEntities: store.entities,
      references: records.length,
      byStatus,
      byLinkTypeStatus: statusCountsByLinkType(records),
      resolved: (byStatus.linked || 0) + (byStatus.manual || 0),
      unresolved: (byStatus.ambiguous || 0) + (byStatus.dangling || 0) + (byStatus.missing || 0),
    };
  }

  function statusCountsByLinkType(records) {
    const out = {};
    for (const lt of linkTypes) out[lt.id] = { total: 0, resolved: 0, unresolved: 0 };
    for (const record of records) {
      const bucket = out[record.linkTypeId];
      if (!bucket) continue;
      bucket.total += 1;
      if (record.status === "linked" || record.status === "manual") bucket.resolved += 1;
      if (record.status === "ambiguous" || record.status === "dangling" || record.status === "missing") bucket.unresolved += 1;
    }
    return out;
  }

  async function reset() {
    await links.clear();
  }

  return {
    linkTypes,
    typeById,
    store: links,
    statuses: LINK_STATUSES,
    knownTypeId,
    candidates,
    resolveField,
    linkField,
    linkEntity,
    rebuild,
    override,
    clearField,
    removeEntity,
    decorate,
    outgoing,
    incoming,
    edgesFor,
    linkCount,
    referenceRecords,
    report,
    summary,
    reset,
  };
}
