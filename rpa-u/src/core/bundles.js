import { hash36 } from "./ids.js";

export const BUNDLE_TARGETS = [
  { id: "ai-assistant", label: "AI assistant", description: "A retrieval-friendly snapshot an assistant can ground answers on." },
  { id: "knowledge-base", label: "Knowledge base", description: "Structured documents for an internal help centre or wiki sync." },
  { id: "data-warehouse", label: "Data warehouse", description: "Tabular extracts for reporting and analytics pipelines." },
  { id: "backup-archive", label: "Backup archive", description: "A frozen, verifiable copy of the linked directory for retention." },
];

export const BUNDLE_SCOPES = [
  { id: "all", label: "Everything", description: "Every canonical record type plus the links between them.", entityTypes: null },
  { id: "directory", label: "Directory", description: "Companies and customers only.", entityTypes: ["company", "customer"] },
  { id: "assets", label: "Assets", description: "Managed devices and their assignments.", entityTypes: ["device"] },
  { id: "service", label: "Service desk", description: "Tickets and invoices.", entityTypes: ["ticket", "invoice"] },
];

export const BUNDLE_FORMATS = ["json", "csv"];

const TARGET_BY_ID = new Map(BUNDLE_TARGETS.map((entry) => [entry.id, entry]));
const SCOPE_BY_ID = new Map(BUNDLE_SCOPES.map((entry) => [entry.id, entry]));

function decodeRef(connector, nativeId) {
  return `${connector}:${nativeId}`;
}

export function createBundlePublisher({
  identity,
  registry,
  linker,
  references = null,
  drift = null,
  alerts = null,
  conflicts = null,
  db = null,
  collection = "bundles",
  emit = null,
  clock = () => Date.now(),
  limit = 25,
} = {}) {
  if (!identity || !registry || !linker) throw new Error("createBundlePublisher requires identity, registry and linker");
  const bundles = new Map();
  let counter = 0;

  function iso(at = clock()) {
    return new Date(at).toISOString();
  }

  function scopeTypes(scopeId) {
    const scope = SCOPE_BY_ID.get(scopeId) || SCOPE_BY_ID.get("all");
    return scope.entityTypes ? new Set(scope.entityTypes) : new Set(registry.entityTypes.map((type) => type.id));
  }

  function fieldPolicy(typeId, field, { includeSensitive, includePrivate }) {
    if (!field) return { include: true, redacted: false };
    if (field.sensitive && !includeSensitive) return { include: false, redacted: true, reason: "sensitive" };
    if (field.direction === "none" && !includePrivate) return { include: false, redacted: true, reason: "private" };
    return { include: true, redacted: false };
  }

  function visibleEntity(typeId, entity, options) {
    const fields = {};
    const redacted = [];
    for (const [key, value] of Object.entries(entity.fields || {})) {
      const policy = fieldPolicy(typeId, registry.field(typeId, key), options);
      if (policy.include) fields[key] = value;
      else redacted.push(key);
    }
    return {
      typeId,
      id: entity.id,
      name: identity.nameOf(typeId, entity),
      fields,
      fieldSources: entity.fieldSources || {},
      refs: entity.refs || [],
      redacted,
      createdAt: entity.createdAt || null,
      updatedAt: entity.updatedAt || null,
    };
  }

  function integritySnapshot() {
    const snapshot = {
      driftOpen: drift ? drift.open().length : 0,
      alertsOpen: alerts ? alerts.openCount() : 0,
      conflictsOpen: conflicts ? conflicts.plan().length : 0,
      staleValues: references ? references.stats().stale : 0,
    };
    snapshot.healthy = snapshot.driftOpen === 0 && snapshot.alertsOpen === 0 && snapshot.conflictsOpen === 0;
    return snapshot;
  }

  function build({
    target = "ai-assistant",
    scope = "all",
    includeLinks = true,
    includeRegistry = true,
    includeSensitive = false,
    includePrivate = false,
    createdBy = "operator",
    name = null,
    at = null,
  } = {}) {
    const targetDef = TARGET_BY_ID.get(target);
    if (!targetDef) return { ok: false, error: `Unknown bundle target "${target}".` };
    const scopeDef = SCOPE_BY_ID.get(scope) || SCOPE_BY_ID.get("all");
    const types = scopeTypes(scope);
    const createdAt = iso(at);
    const entities = [];
    const redactions = [];

    for (const typeId of types) {
      for (const entity of identity.all(typeId)) {
        const snapshot = visibleEntity(typeId, entity, { includeSensitive, includePrivate });
        if (snapshot.redacted.length) redactions.push({ typeId, entityId: entity.id, fields: snapshot.redacted.sort() });
        entities.push(snapshot);
      }
    }

    const links = includeLinks
      ? linker.store
          .all()
          .filter((edge) => types.has(edge.fromType) && types.has(edge.toType))
          .map((edge) => {
            const decorated = linker.decorate(edge);
            return {
              id: decorated.id,
              type: decorated.type,
              fromType: decorated.fromType,
              fromId: decorated.fromId,
              fromName: decorated.fromName,
              toType: decorated.toType,
              toId: decorated.toId,
              toName: decorated.toName,
              field: decorated.field,
              origin: decorated.origin,
              confidence: decorated.confidence,
              missing: decorated.missing,
            };
          })
          .sort((a, b) => a.id.localeCompare(b.id))
      : [];

    const refs = linker
      .referenceRecords()
      .filter((record) => types.has(record.fromType))
      .map((record) => ({
        fromType: record.fromType,
        fromId: record.fromId,
        field: record.field,
        linkTypeId: record.linkTypeId,
        toType: record.toType,
        status: record.status,
        target: record.target ? `${record.target.typeId}:${record.target.entityId}` : null,
        confidence: record.confidence,
      }));

    const registrySnapshot = includeRegistry
      ? Array.from(types).map((typeId) => ({
          typeId,
          fields: registry.fieldsFor(typeId).map((field) => ({
            key: field.key,
            label: field.label,
            owner: field.owner,
            direction: field.direction,
            computed: !!field.computed,
            sensitive: !!field.sensitive,
          })),
        }))
      : [];

    const fieldCount = entities.reduce((total, entity) => total + Object.keys(entity.fields).length, 0);
    const redactionCount = redactions.reduce((total, entry) => total + entry.fields.length, 0);
    counter += 1;
    const sequence = counter;
    const seed = `${target}:${scope}:${createdAt}:${sequence}:${entities.length}`;
    const id = `bundle_${hash36(seed)}`;

    return {
      ok: true,
      bundle: {
        id,
        seq: sequence,
        name: name || `${targetDef.label} · ${scopeDef.label}`,
        target,
        targetLabel: targetDef.label,
        scope: scopeDef.id,
        scopeLabel: scopeDef.label,
        createdAt,
        createdBy,
        format: "json",
        includeSensitive,
        includePrivate,
        counts: { entities: entities.length, links: links.length, references: refs.length, fields: fieldCount, redactions: redactionCount },
        entities,
        links,
        references: refs,
        registry: registrySnapshot,
        integrity: integritySnapshot(),
        redactions,
        fingerprint: `fp_${hash36(entities.map((entity) => `${entity.typeId}:${entity.id}`).join("|"))}`,
      },
    };
  }

  function persist(bundle) {
    if (!db) return Promise.resolve(bundle);
    return db.put(collection, bundle.id, bundle);
  }

  function compareDesc(a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt)) || (b.seq || 0) - (a.seq || 0);
  }

  async function prune() {
    if (bundles.size <= limit) return 0;
    const ordered = Array.from(bundles.values()).sort((a, b) => -compareDesc(a, b));
    let removed = 0;
    while (bundles.size > limit && ordered.length) {
      const oldest = ordered.shift();
      bundles.delete(oldest.id);
      if (db) await db.remove(collection, oldest.id);
      removed += 1;
    }
    return removed;
  }

  async function publish(options = {}) {
    const format = String(options.format || "json").toLowerCase();
    if (!BUNDLE_FORMATS.includes(format)) return { ok: false, error: `Unsupported export format "${options.format}".` };
    const { ok, error, bundle } = build(options);
    if (!ok) return { ok: false, error };
    bundle.format = format;
    bundles.set(bundle.id, bundle);
    await persist(bundle);
    await prune();
    if (emit) {
      await emit(
        "bundle.published",
        { bundleId: bundle.id, records: bundle.counts.entities, format, target: bundle.target },
        { source: "ru" }
      );
    }
    return { ok: true, bundle };
  }

  async function hydrate() {
    if (!db) return bundles.size;
    for (const stored of db.all(collection)) {
      if (!stored || !stored.id) continue;
      bundles.set(stored.id, stored);
    }
    return bundles.size;
  }

  function list() {
    return Array.from(bundles.values()).sort(compareDesc);
  }

  function get(id) {
    return bundles.get(id) || null;
  }

  function latest() {
    return list()[0] || null;
  }

  async function remove(id) {
    if (!bundles.has(id)) return false;
    bundles.delete(id);
    if (db) await db.remove(collection, id);
    return true;
  }

  function stats() {
    const all = list();
    const byTarget = {};
    const byScope = {};
    const byFormat = {};
    let records = 0;
    for (const bundle of all) {
      byTarget[bundle.target] = (byTarget[bundle.target] || 0) + 1;
      byScope[bundle.scope] = (byScope[bundle.scope] || 0) + 1;
      byFormat[bundle.format || "json"] = (byFormat[bundle.format || "json"] || 0) + 1;
      records += bundle.counts?.entities || 0;
    }
    return { total: all.length, records, byTarget, byScope, byFormat, limit, lastAt: all[0]?.createdAt || null };
  }

  async function reset() {
    bundles.clear();
    counter = 0;
    if (db) await db.clear(collection);
  }

  return {
    targets: BUNDLE_TARGETS,
    scopes: BUNDLE_SCOPES,
    formats: BUNDLE_FORMATS,
    collection,
    refKey: decodeRef,
    build,
    publish,
    hydrate,
    list,
    get,
    latest,
    remove,
    stats,
    reset,
  };
}
