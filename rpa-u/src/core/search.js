const WEIGHTS = {
  id: 120,
  name: 110,
  ref: 100,
  field: 90,
};

const PREFIX_WEIGHTS = { id: 95, name: 85, ref: 78, field: 70 };
const PARTIAL_WEIGHTS = { id: 65, name: 58, ref: 50, field: 42 };

export function createSearch({ identity, registry, linker } = {}) {
  if (!identity) throw new Error("createSearch requires an identity store");

  function tokensOf(typeId, entity) {
    const out = [{ value: entity.id, kind: "id" }];
    if (entity.displayName) out.push({ value: entity.displayName, kind: "name" });
    for (const [key, value] of Object.entries(entity.fields || {})) {
      if (value == null || value === "") continue;
      out.push({ value: String(value), kind: "field", key });
    }
    for (const ref of entity.refs || []) out.push({ value: String(ref.nativeId), kind: "ref", connector: ref.connector });
    return out;
  }

  function bestMatch(typeId, entity, token) {
    const q = token.toLowerCase();
    if (!q) return null;
    let best = null;
    const consider = (score, match) => {
      if (!best || score > best.score) best = { score, ...match };
    };
    for (const candidate of tokensOf(typeId, entity)) {
      const value = candidate.value.toLowerCase();
      const exact = value === q;
      const prefix = !exact && value.startsWith(q);
      const partial = !exact && !prefix && value.includes(q);
      if (exact) consider(WEIGHTS[candidate.kind], { value: candidate.value, kind: candidate.kind, key: candidate.key, connector: candidate.connector, how: "exact" });
      else if (prefix) consider(PREFIX_WEIGHTS[candidate.kind], { value: candidate.value, kind: candidate.kind, key: candidate.key, connector: candidate.connector, how: "prefix" });
      else if (partial) consider(PARTIAL_WEIGHTS[candidate.kind], { value: candidate.value, kind: candidate.kind, key: candidate.key, connector: candidate.connector, how: "partial" });
    }
    return best;
  }

  function scoreEntity(typeId, entity, query) {
    const tokens = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    const matches = [];
    for (const token of tokens) {
      const match = bestMatch(typeId, entity, token);
      if (!match) return null;
      matches.push({ token, ...match });
    }
    const score = matches.reduce((sum, match) => sum + match.score, 0) / matches.length;
    return { score, matches };
  }

  function unresolvedKeys() {
    const set = new Set();
    if (!linker) return set;
    for (const record of linker.report({ status: ["ambiguous", "dangling", "missing"] })) {
      set.add(`${record.fromType}:${record.fromId}`);
    }
    return set;
  }

  function decorate(typeId, entity, score, matches) {
    const connectors = Array.from(new Set((entity.refs || []).map((ref) => ref.connector)));
    return {
      typeId,
      entity,
      id: entity.id,
      name: identity.nameOf(typeId, entity),
      score: Math.round(score),
      matches,
      refs: entity.refs || [],
      connectors,
      connectorNames: connectors.map((id) => registry?.connector(id)?.name || id),
      linkCount: linker ? linker.linkCount(typeId, entity.id) : 0,
      links: linker ? linker.edgesFor(typeId, entity.id) : { outgoing: [], incoming: [] },
      fields: entity.fields || {},
    };
  }

  function query(text, { type = null, connector = null, only = null, limit = 40 } = {}) {
    const q = String(text == null ? "" : text).trim();
    const typeIds = type ? [type] : identity.entityTypes.map((t) => t.id);
    const unresolved = unresolvedKeys();
    const groups = [];
    let total = 0;
    const connectorsSeen = new Set();

    for (const typeId of typeIds) {
      const def = identity.typeDef(typeId);
      const results = [];
      for (const entity of identity.all(typeId)) {
        const scored = scoreEntity(typeId, entity, q);
        if (!scored) continue;
        if (connector && !(entity.refs || []).some((ref) => ref.connector === connector)) continue;
        const key = `${typeId}:${entity.id}`;
        if (only === "unresolved" && !unresolved.has(key)) continue;
        if (only === "linked" && linker && linker.linkCount(typeId, entity.id) === 0) continue;
        if (only === "unlinked" && linker && linker.linkCount(typeId, entity.id) > 0) continue;
        const decorated = decorate(typeId, entity, scored.score, scored.matches);
        decorated.unresolved = unresolved.has(key);
        for (const id of decorated.connectors) connectorsSeen.add(id);
        results.push(decorated);
        total += 1;
      }
      results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      if (results.length) {
        groups.push({ typeId, label: def.label, plural: def.plural, count: results.length, results: results.slice(0, limit) });
      }
    }

    groups.sort((a, b) => b.results[0].score - a.results[0].score);
    return {
      query: q,
      total,
      groups,
      stats: {
        types: groups.length,
        connectors: connectorsSeen.size,
        results: total,
        unresolved: groups.reduce((sum, group) => sum + group.results.filter((r) => r.unresolved).length, 0),
      },
    };
  }

  function byRef(connectorId, nativeId) {
    const entity = identity.findByRef(connectorId, nativeId);
    if (!entity) return null;
    return decorate(entity.type, entity, WEIGHTS.id, [{ token: nativeId, value: nativeId, kind: "ref", connector: connectorId, how: "exact" }]);
  }

  function byId(id) {
    for (const type of identity.entityTypes) {
      const entity = identity.get(type.id, id);
      if (entity) return decorate(type.id, entity, WEIGHTS.id, [{ token: id, value: id, kind: "id", how: "exact" }]);
    }
    return null;
  }

  function suggestions(text, limit = 6) {
    const result = query(text, { limit: 2 });
    const out = [];
    for (const group of result.groups) {
      for (const item of group.results) {
        out.push({ id: item.id, typeId: item.typeId, name: item.name, score: item.score });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  return { query, byRef, byId, suggestions, scoreEntity };
}
