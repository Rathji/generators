import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

function breakLink(hub) {
  const edge = hub.linker.store
    .byType("ticket.linkedDevice")
    .filter((candidate) => candidate.origin === "auto")
    .find((candidate) => hub.identity.get("device", candidate.toId));
  const ticket = hub.identity.get("ticket", edge.fromId);
  const other = hub.identity.all("device").find((device) => hub.identity.nameOf("device", device) !== ticket.fields.linkedDevice);
  return hub.identity.setField("ticket", ticket.id, "linkedDevice", hub.identity.nameOf("device", other), "psa-u");
}

suite("Drift detection & alerting", () => {
  test("a scan records stale derived values and raises warning alerts", async () => {
    const hub = await getHub();
    await hub.resetData();
    const stats = hub.drift.stats();
    assert(stats.open >= 6, `expected seeded drift, got ${stats.open}`);
    assert((stats.byKind["stale-value"] || 0) >= 6);
    const alerts = hub.alerts.list({ category: "drift" });
    assert(alerts.length >= 1, "drift should raise alerts");
    assert(alerts.every((alert) => alert.category === "drift"));
    assert(alerts.some((alert) => alert.severity === "warning"));
  });

  test("repeated scans escalate one alert instead of duplicating it", async () => {
    const hub = await getHub();
    await hub.resetData();
    const before = hub.alerts.list({ category: "drift" });
    const key = before[0].key;
    const initial = hub.alerts.get(key).count;
    await hub.drift.scan();
    await hub.drift.scan();
    const after = hub.alerts.list({ category: "drift" });
    assertEquals(after.length, before.length, "no duplicate alerts");
    assert(hub.alerts.get(key).count > initial, "the alert count should escalate");
    assert(hub.alerts.get(key).lastSeenAt >= before[0].firstSeenAt);
  });

  test("scanning twice leaves the drift ledger stable and updates seen counts", async () => {
    const hub = await getHub();
    await hub.resetData();
    await hub.drift.scan();
    const keys = hub.drift.entries().map((record) => record.key).sort();
    await hub.drift.scan();
    assertEquals(hub.drift.entries().map((record) => record.key).sort(), keys);
    assert(hub.drift.entries().every((record) => record.seenCount >= 2));
    assertEquals(hub.drift.stats().open, keys.length);
  });

  test("link drift is detected when a source field stops matching its edge", async () => {
    const hub = await getHub();
    await hub.resetData();
    const ticket = await breakLink(hub);
    await hub.drift.scan();
    const record = hub.drift.open().find((candidate) => candidate.kind === "link-drift");
    assert(record, "expected link drift");
    assertEquals(record.severity, "error");
    assertEquals(record.entityId, ticket.id);
    assertEquals(hub.drift.suggest(record).kind, "link.rebuild");
    const alert = hub.alerts.open().find((candidate) => candidate.key.includes("link-drift"));
    assert(alert, "link drift should raise an alert");
    assertEquals(alert.severity, "error");
  });

  test("a queued fix resolves the drift and clears its alert", async () => {
    const hub = await getHub();
    await hub.resetData();
    await breakLink(hub);
    await hub.drift.scan();
    assertEquals(hub.drift.open().filter((record) => record.kind === "link-drift").length, 1);
    await hub.jobs.enqueue({ kind: "link.rebuild", target: {}, key: "link.rebuild|scheduled" });
    const result = await hub.jobs.execute("link.rebuild|scheduled");
    assert(result.ok, "the rebuild job should succeed");
    await hub.drift.scan();
    assertEquals(hub.drift.open().filter((record) => record.kind === "link-drift").length, 0);
    assert(!hub.alerts.open().some((alert) => alert.key.includes("link-drift")), "the alert is cleared");
    assert(hub.drift.resolved().some((record) => record.kind === "link-drift"), "the ledger keeps the resolved record");
  });

  test("suggest maps each signal kind to the job that fixes it", async () => {
    const hub = await getHub();
    await hub.resetData();
    const stale = hub.drift.open().find((record) => record.kind === "stale-value");
    assertEquals(hub.drift.suggest(stale).kind, "sync.field");
    assertEquals(hub.drift.suggest(stale).target.field, stale.field);
    await breakLink(hub);
    await hub.drift.scan();
    const link = hub.drift.open().find((record) => record.kind === "link-drift");
    assertEquals(hub.drift.suggest(link).kind, "link.rebuild");
  });

  test("an alert can be acknowledged and cleared, then reopens on new drift", async () => {
    const hub = await getHub();
    await hub.resetData();
    const alert = hub.alerts.open()[0];
    const ack = await hub.alerts.acknowledge(alert.key);
    assert(ack.ok && !ack.reused);
    assertEquals(hub.alerts.get(alert.key).status, "acknowledged");
    const ackAgain = await hub.alerts.acknowledge(alert.key);
    assert(ackAgain.reused, "acknowledging twice is idempotent");
    const cleared = await hub.alerts.clear(alert.key, { reason: "test" });
    assert(cleared.ok && !cleared.reused);
    assertEquals(hub.alerts.get(alert.key).status, "cleared");
    assert(!hub.alerts.list({ openOnly: true }).some((candidate) => candidate.key === alert.key));
    const reopened = await hub.alerts.raise({ key: alert.key, category: "drift", severity: "warning", title: alert.title, detail: alert.detail });
    assert(reopened.reopened, "raising a cleared alert should reopen it");
    assertEquals(hub.alerts.get(alert.key).status, "open");
  });
});
