import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Phase 5 integration", () => {
  test("the ready hub audits the seeded baseline with an intact chain", async () => {
    const hub = await getHub();
    await hub.resetData();
    assert(hub.audit.all().length > 0);
    assert(hub.audit.verify().ok);
    assertEquals(hub.bundles.list().length, 0);
    assertEquals(hub.audit.stats().outbound, 0);
  });

  test("a published bundle becomes both a stored snapshot and an outbound audit entry", async () => {
    const hub = await getHub();
    await hub.resetData();
    const result = await hub.bundles.publish({ target: "ai-assistant", scope: "all", format: "json" });
    assert(result.ok);
    await hub.audit.refresh();
    const entry = hub.audit.filter({ action: "bundle.publish" })[0];
    assert(entry, "the publish should be audited");
    assertEquals(entry.direction, "out");
    assertEquals(entry.entityId, result.bundle.id);
    assertEquals(hub.audit.stats().outbound, 1);
    assert(hub.audit.verify().ok);
  });

  test("a CSV export reflects the same records as its source bundle", async () => {
    const hub = await getHub();
    await hub.resetData();
    const result = await hub.bundles.publish({ target: "data-warehouse", scope: "directory", format: "csv" });
    const bundle = result.bundle;
    const csv = hub.bundles.get(bundle.id);
    assertEquals(csv.counts.entities, bundle.counts.entities);
    assertEquals(csv.target, "data-warehouse");
  });

  test("resetting clears bundles but rebuilds a valid audit baseline", async () => {
    const hub = await getHub();
    await hub.bundles.publish({ target: "backup-archive", scope: "all" });
    await hub.audit.note({ message: "Pre-reset note" });
    assert(hub.bundles.list().length > 0);
    await hub.resetData();
    assertEquals(hub.bundles.list().length, 0);
    assertEquals(hub.audit.stats().outbound, 0);
    assert(!hub.audit.all().some((entry) => entry.action === "audit.note"));
    assert(hub.audit.verify().ok);
  });

  test("the phase logs its versioned event types", async () => {
    const hub = await getHub();
    await hub.resetData();
    await hub.bundles.publish({ target: "knowledge-base", scope: "all" });
    await hub.audit.refresh();
    await hub.audit.note({ message: "phase five verification", actor: "tests" });
    const types = new Set(hub.log.recent(500).map((event) => event.type));
    assert(types.has("bundle.published"));
    assert(types.has("audit.note"));
    const bundleEvent = hub.log.recent(500).find((event) => event.type === "bundle.published");
    assertEquals(bundleEvent.version, 1);
    assert(bundleEvent.payload.bundleId);
  });
});
