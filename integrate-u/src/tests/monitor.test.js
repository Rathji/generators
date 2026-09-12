import { suite, test, assert, assertEquals, assertThrows } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";
import { summarize, percentile, fraction, createMonitor } from "../core/monitor.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Connector monitor", () => {
  test("probes every member connector and reports status", async () => {
    const hub = await getHub();
    await hub.resetData();
    const summary = hub.monitor.summary();
    assertEquals(summary.total, 4);
    assertEquals(summary.up, 4);
    assertEquals(summary.down, 0);
    assertEquals(summary.availability, 100);
    assert(summary.averageLatencyMs > 0, "probes should record a latency");
    for (const connector of hub.monitor.connectors()) {
      assertEquals(connector.status, "up");
      assert(connector.latencyMs > 0, `${connector.id} should have a measured latency`);
      assert(connector.checkedAt, `${connector.id} should record when it was checked`);
      assertEquals(connector.uptime, 100);
    }
  });

  test("a heartbeat emits a health report and a sweep event", async () => {
    const hub = await getHub();
    await hub.resetData();
    const before = hub.log.size();
    const summary = await hub.monitor.heartbeat({ announce: true, force: true, trigger: "manual" });
    assertEquals(summary.probed, 4);
    assertEquals(summary.trigger, "manual");
    const added = hub.log.recent(50);
    assertEquals(added.filter((event) => event.type === "connector.health").length, 4);
    assertEquals(added.filter((event) => event.type === "monitor.heartbeat").length, 1);
    assert(hub.log.size() > before);
    const sweep = added.find((event) => event.type === "monitor.heartbeat");
    assertEquals(sweep.payload.probed, 4);
    assertEquals(sweep.payload.up, 4);
  });

  test("an injected outage drives a connector down and raises a connectivity error", async () => {
    const hub = await getHub();
    await hub.resetData();
    assert(hub.monitor.injectIncident("rmm-u", { status: "down" }));
    await hub.monitor.heartbeat({ announce: true, force: true });
    const connector = hub.monitor.connector("rmm-u");
    assertEquals(connector.status, "down");
    assert(connector.streak >= 1);
    const errors = hub.monitor.errors({ category: "connectivity" });
    assert(errors.total >= 1, "a down connector is a connectivity error");
    assert(errors.items.some((entry) => entry.connector === "rmm-u" && entry.severity === "error"));
    assertEquals(hub.monitor.summary().down, 1);
    assertEquals(hub.monitor.summary().availability, 75);

    assert(hub.monitor.clearIncident("rmm-u"));
    await hub.monitor.heartbeat({ announce: true, force: true });
    assertEquals(hub.monitor.connector("rmm-u").status, "up");
    assertEquals(hub.monitor.errors({ category: "connectivity" }).total, 0);
  });

  test("latency tracking measures the bus and sync jobs", async () => {
    const hub = await getHub();
    await hub.resetData();
    await hub.publish("sync.job", { jobId: "job_probe01", kind: "sync.field", status: "succeeded", durationMs: 42 });
    await hub.publish("sync.job", { jobId: "job_probe02", kind: "link.rebuild", status: "succeeded", durationMs: 18 });
    const latency = hub.monitor.latency();
    assert(latency.bus && latency.bus.count > 0, "publishes should be timed");
    assert(latency.bus.p95 >= latency.bus.p50);
    assertEquals(latency.jobs.count, 2);
    assertEquals(latency.jobs.avg, 30);
    assertEquals(latency.jobsByKind["sync.field"].avg, 42);
    assertEquals(latency.jobsByKind["link.rebuild"].last, 18);
    assert(latency.probe && latency.probe.count >= 4, "probe samples should be summarised");
    assert(latency.probeByConnector["crm-u"].count >= 1);
  });

  test("rejected events are aggregated as validation errors", async () => {
    const hub = await getHub();
    await hub.resetData();
    const result = await hub.publish("connector.health", {});
    assertEquals(result.ok, false);
    const errors = hub.monitor.errors({ category: "validation" });
    assert(errors.total >= 1);
    assert(errors.items.some((entry) => entry.title.includes("connector.health")));
  });

  test("a throwing subscriber becomes a delivery error", async () => {
    const hub = await getHub();
    await hub.resetData();
    const sub = hub.bus.subscribe("audit.*", () => {
      throw new Error("subscriber exploded");
    }, { label: "faulty" });
    try {
      await hub.publish("audit.note", { message: "hello", actor: "tester" });
    } finally {
      sub.unsubscribe();
    }
    const errors = hub.monitor.errors({ category: "delivery" });
    assert(errors.total >= 1, "a subscriber that throws is a delivery error");
    assert(errors.items.some((entry) => entry.detail.includes("audit.note")));
  });

  test("repeated failures collapse into one counted entry", async () => {
    const hub = await getHub();
    await hub.resetData();
    hub.monitor.recordError({ key: "sync:dupe", category: "sync", severity: "error", title: "Boom", detail: "first" });
    hub.monitor.recordError({ key: "sync:dupe", category: "sync", severity: "error", title: "Boom", detail: "second" });
    const errors = hub.monitor.errors({ category: "sync" });
    const entry = errors.items.find((item) => item.id === "sync:dupe");
    assertEquals(entry.count, 2);
    assertEquals(entry.detail, "second");
    assertEquals(errors.total, 2);
    assertEquals(errors.bySeverity.error, 2);
  });

  test("heartbeat scheduling can start and stop", async () => {
    const hub = await getHub();
    await hub.resetData();
    assertEquals(hub.monitor.running(), false);
    const result = hub.monitor.start({ intervalMs: 1000 });
    assert(result.ok, result.error);
    assertEquals(hub.monitor.running(), true);
    hub.monitor.stop();
    assertEquals(hub.monitor.running(), false);
  });

  test("summarise computes count, range and percentiles", () => {
    const stats = summarize([10, 20, 30, 40]);
    assertEquals(stats.count, 4);
    assertEquals(stats.min, 10);
    assertEquals(stats.max, 40);
    assertEquals(stats.avg, 25);
    assertEquals(stats.p50, 20);
    assertEquals(stats.p95, 40);
    assertEquals(stats.last, 40);
    assertEquals(summarize([]), null);
    assertEquals(summarize([null, undefined, NaN]), null);
    assertEquals(percentile([5], 95), 5);
    assert(fraction("abc") >= 0 && fraction("abc") < 1);
    assertEquals(fraction("abc"), fraction("abc"), "the wave is deterministic");
  });

  test("a custom transport can force degraded and down states", async () => {
    const hub = await getHub();
    await hub.resetData();
    const probe = async ({ connector, attempt }) => {
      if (connector === "it-u") return { ok: true, latencyMs: 900 };
      if (connector === "crm-u") return { ok: false, error: "connect ECONNREFUSED" };
      return { ok: true, latencyMs: 40 + attempt };
    };
    const monitor = createMonitor({ connectors: hub.registry.connectors, transport: probe });
    const summary = await monitor.heartbeat({ announce: false });
    assertEquals(summary.up, 2);
    assertEquals(summary.degraded, 1);
    assertEquals(summary.down, 1);
    assertEquals(monitor.connector("it-u").status, "degraded");
    assertEquals(monitor.connector("crm-u").status, "down");
    assertEquals(monitor.connector("crm-u").error, "connect ECONNREFUSED");
    assertEquals(monitor.connector("psa-u").status, "up");
  });
});
