import { createDb } from "./db.js";
import { createRegistry } from "./registry.js";
import { createPermissions } from "./permissions.js";
import { createIdentityStore } from "./identity.js";
import { createEventLog } from "./event-log.js";
import { createEventBus } from "./event-bus.js";
import { createSubscriptionManager } from "./subscriptions.js";
import { createLinker } from "./linker.js";
import { createReferenceResolver } from "./reference.js";
import { createSearch } from "./search.js";
import { createReconciler } from "./reconcile.js";
import { createSyncJobRunner } from "./sync-jobs.js";
import { createConflictResolver } from "./conflict.js";
import { createAlertManager } from "./alerts.js";
import { createDriftMonitor } from "./drift.js";
import { createBundlePublisher } from "./bundles.js";
import { createAuditMonitor } from "./audit.js";
import { createMonitor } from "./monitor.js";
import { createOpenRpaConnector } from "./openrpa/connector.js";
import { OPENRPA_COLLECTIONS } from "./openrpa/constants.js";
import { createIdentitySession, SESSION_COLLECTION } from "./identity/session.js";
import { buildDemoFeeds, buildFeedIndex } from "./demo-data.js";
import { getConfig } from "../framework/config.js";

export function createHub({ kv = null, config = getConfig() } = {}) {
  const registry = createRegistry();
  const permissions = createPermissions();
  const collections = [
    ...registry.entityTypes.map((t) => t.collection),
    "keys",
    "refs",
    "meta",
    "events",
    "checkpoints",
    "subscriptions",
    "links",
    "reconcile",
    "jobs",
    "effects",
    "conflicts",
    "drift",
    "alerts",
    "bundles",
    "audit",
    "monitor",
    SESSION_COLLECTION,
    ...OPENRPA_COLLECTIONS,
  ];
  const db = createDb({ kv, namespace: config.storageNamespace, collections });
  const auth = createIdentitySession({ config: config.identity, db, collection: SESSION_COLLECTION });
  const identity = createIdentityStore({ db, entityTypes: registry.entityTypes, registry });
  const log = createEventLog({ db });
  const bus = createEventBus({ log, connectors: registry.connectors });
  const subscriptions = createSubscriptionManager({
    bus,
    db,
    connectors: registry.connectors,
    emit: publishEvent,
  });
  const linker = createLinker({ identity, db });
  const references = createReferenceResolver({
    identity,
    registry,
    linker,
    sources: (connectorId, typeId, nativeId) => sourceFields(connectorId, typeId, nativeId),
    emit: publishEvent,
  });
  const search = createSearch({ identity, registry, linker });
  const reconciler = createReconciler({
    identity,
    registry,
    linker,
    references,
    db,
    merge: (typeId, keepId, dropId, options) => merge(typeId, keepId, dropId, options),
  });
  const alerts = createAlertManager({ db, emit: publishEvent });
  const conflicts = createConflictResolver({
    identity,
    registry,
    references,
    db,
    emit: publishEvent,
  });
  const jobs = createSyncJobRunner({ db, emit: publishEvent });
  const drift = createDriftMonitor({
    identity,
    registry,
    linker,
    references,
    conflicts,
    alerts,
    db,
    emit: publishEvent,
  });
  const bundles = createBundlePublisher({
    identity,
    registry,
    linker,
    references,
    drift,
    alerts,
    conflicts,
    db,
    emit: publishEvent,
  });
  const audit = createAuditMonitor({
    log,
    identity,
    db,
    emit: publishEvent,
  });
  const monitor = createMonitor({
    connectors: registry.connectors,
    bus,
    log,
    db,
    emit: publishEvent,
  });
  const openrpa = createOpenRpaConnector({
    db,
    permissions,
    roleMaps: permissions.roleMaps,
    emit: publishEvent,
    identity,
    registry,
  });

  async function publishEvent(type, payload = {}, options = {}) {
    const started = Date.now();
    const result = await bus.publish(type, payload, options);
    monitor.recordPublish({ type, ok: !result || result.ok !== false, deliveries: result && result.deliveries, durationMs: Date.now() - started });
    return result;
  }

  jobs.register("sync.field", async (job) => {
    const { entityType, entityId, field } = job.target || {};
    if (!entityType || !entityId || !field) return { error: "sync.field needs entityType, entityId and field." };
    const result = await references.refresh(entityType, entityId, field, { adopt: true });
    if (result.ok === false) return { error: result.error || "Field could not be resolved." };
    const adopted = !!result.adopted;
    return { result: { field, value: result.adoptedValue ?? result.value ?? null, adopted, status: result.status }, changes: adopted ? 1 : 0 };
  });

  jobs.register("sync.entity", async (job) => {
    const { entityType, entityId } = job.target || {};
    if (!entityType || !entityId) return { error: "sync.entity needs entityType and entityId." };
    const fields = registry.fieldsFor(entityType).filter((field) => field.owner && field.direction !== "none").map((field) => field.key);
    let adopted = 0;
    let values = 0;
    for (const field of fields) {
      const result = await references.refresh(entityType, entityId, field, { adopt: true });
      if (result.ok === false) continue;
      if (result.adopted) adopted += 1;
      values += 1;
    }
    return { result: { entityType, entityId, fields: values, adopted }, changes: adopted };
  });

  jobs.register("link.rebuild", async () => {
    const result = await linker.rebuild();
    return { result: { created: result.created, removed: result.removed, pruned: result.pruned }, changes: result.created + result.removed + result.pruned };
  });

  jobs.register("link.set", async (job) => {
    const { fromType, fromId, field, toType, toId, note } = job.target || {};
    if (!fromType || !fromId || !field || !toType || !toId) return { error: "link.set needs fromType, fromId, field, toType and toId." };
    const result = await linker.override({ fromType, fromId, field, toType, toId, note: note || "queued sync job" });
    if (!result.ok) return { error: result.error || "Link could not be set." };
    return { result: { linkTypeId: result.linkTypeId, toId }, changes: 1 };
  });

  jobs.register("identity.merge", async (job) => {
    const { typeId, keepId, dropId, confidence = null } = job.target || {};
    if (!typeId || !keepId || !dropId) return { error: "identity.merge needs typeId, keepId and dropId." };
    const keep = await merge(typeId, keepId, dropId, { confidence });
    return { result: { keepId: keep.id }, changes: 1 };
  });

  jobs.register("conflict.resolve", async (job) => {
    const { entityType, entityId, field } = job.target || {};
    if (!entityType || !entityId || !field) return { error: "conflict.resolve needs entityType, entityId and field." };
    const decision = conflicts.plan().find((entry) => entry.key === `${entityType}:${entityId}:${field}`);
    if (!decision) return { result: { entityType, entityId, field, alreadySettled: true }, changes: 0 };
    const result = await conflicts.resolve(decision);
    return { result: { entityType, entityId, field, winner: decision.winner, rule: decision.rule }, changes: result.applied ? 1 : 0 };
  });

  jobs.register("drift.scan", async () => {
    const summary = await drift.scan();
    return { result: summary, changes: summary.opened + summary.resolved };
  });

  jobs.register("alert.notify", async (job) => {
    const { key, category = "integrity", severity = "warning", title, detail = "", entity = null } = job.payload || {};
    if (!title) return { error: "alert.notify needs a title." };
    const result = await alerts.raise({ key: key || job.key, category, severity, title, detail, entity, source: "manual" });
    if (result.ok === false) return { error: result.error };
    return { result: { alertId: result.alert.key, deduped: result.deduped }, changes: result.deduped ? 0 : 1 };
  });

  let feedIndex = null;
  function sourceFields(connectorId, typeId, nativeId) {
    if (!feedIndex) feedIndex = buildFeedIndex();
    return feedIndex.get(`${connectorId}:${typeId}:${nativeId}`) || null;
  }

  function publish(type, payload = {}, options = {}) {
    return publishEvent(type, payload, options);
  }

  async function ingest(connectorId, typeId, records) {
    const results = [];
    for (const record of records) {
      const { entity, created } = await identity.upsert(typeId, {
        fields: record.fields || {},
        connector: connectorId,
        nativeId: record.nativeId,
      });
      await linker.linkEntity(typeId, entity.id);
      results.push({ id: entity.id, created });
      await publish(
        "identity.upserted",
        {
          entityType: typeId,
          entityId: entity.id,
          connector: connectorId,
          nativeId: record.nativeId,
          created,
          refs: (entity.refs || []).length,
        },
        { source: connectorId, subject: { entityType: typeId, entityId: entity.id } }
      );
    }
    return results;
  }

  async function merge(typeId, keepId, dropId, { confidence = null } = {}) {
    const keep = await identity.merge(typeId, keepId, dropId);
    await linker.rebuild();
    await publish(
      "identity.merged",
      { entityType: typeId, keepId, dropId, ...(confidence != null ? { confidence } : {}) },
      { source: "ru", subject: { entityType: typeId, entityId: keepId } }
    );
    return keep;
  }

  async function seed() {
    const feeds = buildDemoFeeds();
    const summary = {};
    for (const [connectorId, byType] of Object.entries(feeds)) {
      summary[connectorId] = {};
      for (const [typeId, records] of Object.entries(byType)) {
        const results = await ingest(connectorId, typeId, records);
        summary[connectorId][typeId] = { records: records.length, created: results.filter((r) => r.created).length };
      }
    }
    await linker.rebuild();
    await db.put("meta", "seed", { at: new Date().toISOString(), summary });
    return summary;
  }

  async function seedIfEmpty() {
    if (db.get("meta", "seed")) return false;
    if (identity.stats().total > 0) return false;
    await seed();
    return true;
  }

  async function seedDriftJobs() {
    let queued = 0;
    for (const record of drift.open()) {
      const suggestion = drift.suggest(record);
      const result = await jobs.enqueue({
        kind: suggestion.kind,
        target: suggestion.target,
        key: suggestion.kind === "link.rebuild" ? "link.rebuild|scheduled" : null,
        payload: { entityType: record.entityType, entityId: record.entityId, field: record.field, reason: record.kind },
        note: `${record.entityName} · ${record.label}`,
      });
      if (result.ok && !result.deduped) queued += 1;
    }
    return queued;
  }

  async function primeIntegrity({ announce = true } = {}) {
    const summary = await drift.scan({ announce });
    const queued = await seedDriftJobs();
    return { ...summary, queued };
  }

  async function resetData({ reseed = true } = {}) {
    await identity.reset();
    await subscriptions.reset();
    await linker.reset();
    await reconciler.reset();
    await jobs.reset();
    await alerts.reset();
    await drift.reset();
    await conflicts.reset();
    await bundles.reset();
    await audit.reset();
    await monitor.reset();
    await openrpa.reset();
    await db.clear("meta");
    await log.clear();
    bus.resetStats();
    await subscriptions.seedDefaults();
    if (reseed) await seed();
    await primeIntegrity();
    await audit.catchUp();
    await monitor.catchUp();
    await monitor.heartbeat({ announce: false, trigger: "scheduled" });
  }

  const api = {
    config,
    db,
    auth,
    registry,
    permissions,
    identity,
    log,
    bus,
    subscriptions,
    linker,
    references,
    search,
    reconciler,
    jobs,
    conflicts,
    alerts,
    drift,
    bundles,
    audit,
    monitor,
    openrpa,
    sourceFields,
    publish,
    ingest,
    merge,
    seed,
    seedIfEmpty,
    seedDriftJobs,
    primeIntegrity,
    resetData,
    ready: async () => {
      await db.ready();
      await auth.start();
      await log.hydrate();
      await audit.hydrate();
      await bundles.hydrate();
      await subscriptions.ready();
      linker.store.hydrate();
      await reconciler.hydrate();
      await jobs.hydrate();
      await alerts.hydrate();
      await drift.hydrate();
      await monitor.hydrate();
      await openrpa.ready();
      if (!subscriptions.list().length) await subscriptions.seedDefaults();
      await seedIfEmpty();
      api.seeded = !!db.get("meta", "seed");
      await primeIntegrity();
      await audit.catchUp();
      await monitor.catchUp();
      await monitor.heartbeat({ announce: false, trigger: "scheduled" });
      return api;
    },
    seeded: false,
    storageMode: () => db.mode,
  };

  return api;
}
