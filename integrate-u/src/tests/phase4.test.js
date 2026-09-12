import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Phase 4 integration", () => {
  test("the ready hub queues a fix for every open drift signal", async () => {
    const hub = await getHub();
    await hub.resetData();
    const open = hub.drift.open();
    assert(open.length > 0, "expected drift in the seed data");
    assertEquals(hub.jobs.runnable().length, open.length);
    assert(hub.jobs.runnable().every((job) => job.kind === "sync.field"));
    assertEquals(hub.jobs.stats().queued, open.length);
  });

  test("running the queue converges drift without touching the directory", async () => {
    const hub = await getHub();
    await hub.resetData();
    const identities = hub.identity.stats().total;
    const edges = hub.linker.summary().edges;
    const copies = hub.references.stats().copies;
    const references = hub.identity.stats().refs;
    const summary = await hub.jobs.executeAll();
    assert(summary.succeeded > 0 && summary.failed === 0);
    const scan = await hub.drift.scan();
    assertEquals(scan.open, 0, "every signal converged");
    assertEquals(hub.references.stats().stale, 0);
    assertEquals(hub.identity.stats().total, identities);
    assertEquals(hub.linker.summary().edges, edges);
    assertEquals(hub.references.stats().copies, copies);
    assertEquals(hub.identity.stats().refs, references);
  });

  test("a conflict feeds drift detection and raises an alert", async () => {
    const hub = await getHub();
    await hub.resetData();
    const company = hub.identity.all("company").find((entity) => entity.fields?.name);
    await hub.conflicts.simulate({ entityType: "company", entityId: company.id, field: "name", value: "Bogus name" });
    assertEquals(hub.conflicts.plan().length, 1);
    const scan = await hub.drift.scan();
    assert((scan.byKind["field-conflict"] || 0) >= 1, "the conflict becomes a drift signal");
    const record = hub.drift.open().find((candidate) => candidate.kind === "field-conflict");
    assert(record);
    assertEquals(record.severity, "error");
    const alert = hub.alerts.open().find((candidate) => candidate.key.includes("field-conflict"));
    assert(alert, "field conflicts must alert administrators");
  });

  test("the phase logs its new versioned event types", async () => {
    const hub = await getHub();
    await hub.resetData();
    await hub.jobs.executeAll();
    await hub.drift.scan();
    const recent = hub.log.recent(500);
    const types = new Set(recent.map((event) => event.type));
    assert(types.has("sync.job"), "sync job outcomes should be logged");
    assert(types.has("drift.detected"), "detected drift should be logged");
    assert(types.has("drift.cleared"), "resolved drift should be logged");
    assert(types.has("alert.raised"), "raised alerts should be logged");
    const envelope = recent.find((event) => event.type === "sync.job");
    assertEquals(envelope.version, 1);
    assert(envelope.payload.jobId && envelope.payload.status, "the sync.job payload carries its key and status");
  });

  test("a drift scan can itself be queued as a job", async () => {
    const hub = await getHub();
    await hub.resetData();
    const queued = await hub.jobs.enqueue({ kind: "drift.scan", target: {} });
    const result = await hub.jobs.execute(queued.job.key);
    assert(result.ok);
    assertEquals(result.job.result.open, hub.drift.open().length);
  });

  test("resetting restores the seeded Phase 4 baseline", async () => {
    const hub = await getHub();
    const company = hub.identity.all("company").find((entity) => entity.fields?.name);
    await hub.conflicts.simulate({ entityType: "company", entityId: company.id, field: "name", value: "Junk" });
    await hub.jobs.executeAll();
    await hub.drift.scan();
    await hub.resetData();
    const drift = hub.drift.stats();
    const references = hub.references.stats();
    assertEquals(drift.open, 6);
    assertEquals(hub.alerts.openCount(), 5);
    assertEquals(hub.conflicts.plan().length, 0);
    assertEquals(hub.conflicts.history().length, 0);
    assertEquals(hub.jobs.runnable().length, drift.open);
    assertEquals(references.stale, 6);
    assertEquals(references.conflicts, 0);
    assertEquals(references.copies, 45);
  });
});
