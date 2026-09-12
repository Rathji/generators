import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Phase 6 integration", () => {
  test("the ready hub reports a healthy connector baseline", async () => {
    const hub = await getHub();
    const summary = hub.monitor.summary();
    assertEquals(summary.total, 4);
    assertEquals(summary.up, 4);
    assertEquals(summary.availability, 100);
    assertEquals(summary.down, 0);
    assertEquals(hub.monitor.errors().total, 0);
    assert(hub.monitor.latency().probe.count >= 4, "the ready hub probes every connector");
    assert(hub.audit.verify().ok, "monitoring must not disturb the audit chain");
  });

  test("an outage flows from heartbeat to the dashboard, aggregator and audit", async () => {
    const hub = await getHub();
    await hub.resetData();
    hub.monitor.injectIncident("it-u", { status: "down" });
    const sweep = await hub.monitor.heartbeat({ announce: true, force: true, trigger: "manual" });
    assertEquals(sweep.down, 1);
    assertEquals(hub.monitor.connector("it-u").status, "down");
    assertEquals(hub.monitor.summary().availability, 75);
    assert(hub.monitor.errors({ category: "connectivity" }).total >= 1);

    await hub.audit.refresh();
    const health = hub.audit.filter({ action: "connector.health" });
    assert(health.some((entry) => entry.payload.connector === "it-u" && entry.payload.status === "down"), "the outage should be audited");
    const severity = hub.monitor.errors().items.find((entry) => entry.connector === "it-u");
    assertEquals(severity.severity, "error");

    hub.monitor.clearIncident("it-u");
    await hub.monitor.heartbeat({ announce: true, force: true });
    assertEquals(hub.monitor.connector("it-u").status, "up");
    assertEquals(hub.monitor.errors({ category: "connectivity" }).total, 0);
  });

  test("running sync jobs feeds latency tracking", async () => {
    const hub = await getHub();
    await hub.resetData();
    const runnable = hub.jobs.runnable();
    assert(runnable.length > 0, "the seeded baseline should queue fix jobs");
    const result = await hub.jobs.executeAll();
    assert(result.succeeded >= 1, "at least one queued job should succeed");
    const latency = hub.monitor.latency();
    assert(latency.jobs.count >= result.succeeded, "every executed job should record a duration");
    assert(Object.keys(latency.jobsByKind).length >= 1);
    for (const stats of Object.values(latency.jobsByKind)) {
      assert(stats.avg >= 0 && stats.count >= 1);
    }
  });

  test("the phase logs its versioned event types", async () => {
    const hub = await getHub();
    await hub.resetData();
    await hub.monitor.heartbeat({ announce: true, force: true, trigger: "manual" });
    const recent = hub.log.recent(50);
    const health = recent.find((event) => event.type === "connector.health");
    const heartbeat = recent.find((event) => event.type === "monitor.heartbeat");
    assert(health, "a health report should be logged");
    assert(heartbeat, "a heartbeat sweep should be logged");
    assertEquals(heartbeat.version, 1);
    await hub.audit.refresh();
    assert(hub.audit.filter({ action: "monitor.heartbeat" }).length >= 1);
    assert(hub.audit.verify().ok);
  });

  test("resetting restores the seeded monitoring baseline", async () => {
    const hub = await getHub();
    hub.monitor.injectIncident("psa-u", { status: "down" });
    await hub.monitor.heartbeat({ announce: true, force: true });
    assert(hub.monitor.errors().total > 0);
    await hub.resetData();
    const summary = hub.monitor.summary();
    assertEquals(summary.total, 4);
    assertEquals(summary.up, 4);
    assertEquals(summary.down, 0);
    assertEquals(summary.availability, 100);
    assertEquals(hub.monitor.incidents().length, 0);
    assertEquals(hub.monitor.errors().total, 0);
    assertEquals(hub.monitor.running(), false);
  });
});
