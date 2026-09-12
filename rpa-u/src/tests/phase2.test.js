import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { DEFAULT_SUBSCRIPTIONS } from "../core/subscriptions.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Phase 2 integration", () => {
  test("hub boots with a seeded event log and default subscriptions", async () => {
    const hub = await getHub();
    assert(hub.log.size() > 0, "expected the demo import to publish events");
    assert(hub.bus.stats().published > 0, "expected published events");
    assertEquals(hub.subscriptions.list().length, DEFAULT_SUBSCRIPTIONS.length);
    assertEquals(hub.storageMode(), "memory");
  });

  test("identity ingestion publishes one event per record", async () => {
    const hub = await getHub();
    const before = hub.log.size();
    await hub.ingest("crm-u", "company", [{ nativeId: "CRM-Z-9", fields: { name: "Zenith Testing Ltd", domain: "zenith-testing.example", city: "Springfield" } }]);
    assertEquals(hub.log.size(), before + 1);
    const last = hub.log.recent(1)[0];
    assertEquals(last.type, "identity.upserted");
    assertEquals(last.source, "crm-u");
    assertEquals(last.payload.created, true);
    assertEquals(last.subject.entityType, "company");
  });

  test("merging canonical records publishes an identity.merged event", async () => {
    const hub = await getHub();
    const duplicates = hub.identity.findDuplicates();
    assert(duplicates.length >= 1, "expected a duplicate suggestion to merge");
    const target = duplicates[0];
    await hub.merge(target.type, target.keepId, target.dropId, { confidence: target.confidence });
    const merged = hub.log.recent(200).filter((e) => e.type === "identity.merged");
    assert(merged.length >= 1, "expected a merge event on the log");
    const latest = merged[merged.length - 1];
    assertEquals(latest.payload.keepId, target.keepId);
    assertEquals(latest.payload.dropId, target.dropId);
    assertEquals(latest.source, "ru");
  });

  test("recovery replays only what a connector missed", async () => {
    const hub = await getHub();
    await hub.log.saveCheckpoint("it-u", hub.log.lastSeq());
    await hub.publish("device.offline", { deviceId: "dv_test", minutes: 12 }, { source: "rmm-u" });
    await hub.publish("device.checkin", { deviceId: "dv_test", at: new Date().toISOString() }, { source: "rmm-u" });
    const recovery = hub.log.recover("it-u");
    assertEquals(recovery.replayed, 2);
    assertEquals(recovery.events.map((e) => e.type), ["device.offline", "device.checkin"]);
  });

  test("a rejected publish is never written to the log", async () => {
    const hub = await getHub();
    const before = hub.log.size();
    const result = await hub.publish("ticket.opened", { ticketId: "tk_bad" }, { source: "psa-u" });
    assert(!result.ok);
    assertEquals(hub.log.size(), before);
    assert(hub.bus.stats().rejected >= 1);
  });

  test("default subscriptions route domain events to the right tools", async () => {
    const hub = await getHub();
    const offline = hub.subscriptions.matching("device.offline").map((r) => r.connector);
    assert(offline.includes("psa-u"), `expected psa-u to watch device.offline, got ${offline.join(", ")}`);
    const tickets = hub.subscriptions.matching("ticket.opened").map((r) => r.connector);
    assert(tickets.includes("crm-u"), "expected crm-u to watch tickets");
    const identities = hub.subscriptions.matching("identity.upserted").map((r) => r.connector);
    assert(identities.includes("it-u"), "expected it-u to watch identities");
    const everything = hub.subscriptions.matching("anything.at.all").map((r) => r.connector);
    assertEquals(everything, ["ru"]);
  });

  test("resetting hub data restores the default subscription matrix", async () => {
    const hub = await getHub();
    await hub.subscriptions.register({ connector: "crm-u", topic: "device.*" });
    assertEquals(hub.subscriptions.list().length, DEFAULT_SUBSCRIPTIONS.length + 1);
    await hub.resetData();
    assertEquals(hub.subscriptions.list().length, DEFAULT_SUBSCRIPTIONS.length);
    assert(hub.log.size() > 0, "expected the reseed to republish events");
  });
});
