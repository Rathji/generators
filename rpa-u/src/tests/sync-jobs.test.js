import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Idempotent sync jobs", () => {
  test("keys a job by kind and target, and deduplicates repeats", async () => {
    const hub = await getHub();
    await hub.resetData();
    const company = hub.identity.all("company")[0];
    const target = { entityType: "company", entityId: company.id, field: "name" };
    const key = hub.jobs.jobKey("sync.field", target);
    const other = hub.jobs.jobKey("sync.field", { ...target, field: "domain" });
    assert(key !== other, "different targets must produce different keys");
    const before = hub.jobs.list().length;
    const first = await hub.jobs.enqueue({ kind: "sync.field", target });
    const second = await hub.jobs.enqueue({ kind: "sync.field", target });
    assert(!first.deduped, "the first submission should create a job");
    assert(second.deduped, "the identical submission should fold into the same job");
    assertEquals(hub.jobs.list().length, before + 1);
    assertEquals(hub.jobs.get(key).dedupeCount, 1);
  });

  test("replays a recorded effect instead of running the handler twice", async () => {
    const hub = await getHub();
    await hub.resetData();
    let calls = 0;
    hub.jobs.register("test.counter", async () => {
      calls += 1;
      return { result: { calls }, changes: 1 };
    });
    const queued = await hub.jobs.enqueue({ kind: "test.counter", target: { tag: "counter-1" } });
    const first = await hub.jobs.execute(queued.job.key);
    const second = await hub.jobs.execute(queued.job.key);
    assertEquals(calls, 1, "the handler must only run once");
    assert(first.applied, "the first run applies the effect");
    assert(second.reused, "the second run reuses the effect");
    assertEquals(second.changes, 0);
    assert(hub.jobs.hasEffect(queued.job.key), "the effect is recorded in the ledger");
    assertEquals(hub.jobs.get(queued.job.key).runCount, 1);
    await hub.jobs.remove(queued.job.key);
  });

  test("re-running a field sync never duplicates directory or link data", async () => {
    const hub = await getHub();
    await hub.resetData();
    const stale = hub.references.scanDrift().stale[0];
    assert(stale, "expected a stale field in the seed data");
    const target = { entityType: stale.typeId, entityId: stale.entityId, field: stale.field };
    const queued = await hub.jobs.enqueue({ kind: "sync.field", target });
    const identities = hub.identity.stats().total;
    const edges = hub.linker.summary().edges;
    const first = await hub.jobs.execute(queued.job.key);
    const second = await hub.jobs.execute(queued.job.key);
    assert(first.ok && first.applied, "the first run applies the sync");
    assert(second.ok && second.reused, "the replay is idempotent");
    assertEquals(hub.identity.stats().total, identities);
    assertEquals(hub.linker.summary().edges, edges);
  });

  test("a failing job retries and then dead-letters", async () => {
    const hub = await getHub();
    await hub.resetData();
    hub.jobs.register("test.flaky", async () => {
      throw new Error("connector unavailable");
    });
    const queued = await hub.jobs.enqueue({ kind: "test.flaky", target: { tag: "flaky-1" }, maxAttempts: 2 });
    const first = await hub.jobs.execute(queued.job.key);
    assert(!first.ok && !first.dead, "the first failure should schedule a retry");
    assertEquals(hub.jobs.get(queued.job.key).status, "queued");
    const second = await hub.jobs.execute(queued.job.key);
    assert(!second.ok && second.dead, "the second failure should dead-letter");
    assertEquals(hub.jobs.get(queued.job.key).status, "failed");
    assert(hub.jobs.deadLetters().some((job) => job.key === queued.job.key));
    const retried = await hub.jobs.retry(queued.job.key);
    assert(retried.ok);
    assertEquals(hub.jobs.get(queued.job.key).status, "queued");
    assertEquals(hub.jobs.get(queued.job.key).attempts, 0);
    await hub.jobs.remove(queued.job.key);
  });

  test("only registered job kinds can be queued", async () => {
    const hub = await getHub();
    const result = await hub.jobs.enqueue({ kind: "not.a.real.job", target: {} });
    assert(!result.ok);
    assert(!result.job);
    assert(hub.jobs.kinds().includes("sync.field"));
    assert(hub.jobs.kinds().includes("drift.scan"));
  });

  test("running the pending queue drains every queued job", async () => {
    const hub = await getHub();
    await hub.resetData();
    const queued = hub.jobs.runnable().length;
    assert(queued > 0, "the ready hub should have drift fixes queued");
    const summary = await hub.jobs.executeAll();
    assertEquals(summary.attempted, queued);
    assertEquals(summary.failed, 0);
    assertEquals(hub.jobs.runnable().length, 0);
  });
});
