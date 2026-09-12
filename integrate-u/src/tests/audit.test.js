import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Audit log", () => {
  test("derives a hash-chained ledger from the event stream", async () => {
    const hub = await getHub();
    await hub.resetData();
    const entries = hub.audit.all();
    assert(entries.length > 0, "the seeded baseline should produce audit entries");
    const verify = hub.audit.verify();
    assert(verify.ok, `expected an intact chain, broke at ${verify.brokenAt}`);
    assertEquals(verify.checked, entries.length);
    for (let i = 1; i < entries.length; i++) {
      assertEquals(entries[i].prevHash, entries[i - 1].hash, "each entry links to the one before it");
    }
  });

  test("classifies inbound imports and outbound bundles", async () => {
    const hub = await getHub();
    await hub.resetData();
    const inbound = hub.audit.moves({ direction: "in" });
    assert(inbound.length > 0);
    const imported = inbound.find((entry) => entry.action === "identity.import");
    assert(imported, "identity imports are inbound movements");
    assertEquals(imported.direction, "in");
    assertEquals(imported.movement.to, "iu");

    await hub.bundles.publish({ target: "ai-assistant", scope: "directory" });
    await hub.audit.refresh();
    const outbound = hub.audit.moves({ direction: "out" });
    const published = outbound.find((entry) => entry.action === "bundle.publish");
    assert(published, "publishing a bundle is an outbound movement");
    assertEquals(published.entityType, "bundle");
    assertEquals(published.movement.from, "iu");
    assertEquals(published.movement.to, "ai-assistant");
  });

  test("filters by action, entity type, connector, direction and text", async () => {
    const hub = await getHub();
    await hub.resetData();
    const imports = hub.audit.filter({ action: "identity.import" });
    assert(imports.length > 0);
    assert(imports.every((entry) => entry.action === "identity.import"));

    const companies = hub.audit.filter({ entityType: "company" });
    assert(companies.length > 0);
    assert(companies.every((entry) => entry.entityType === "company"));

    const inbound = hub.audit.filter({ direction: "in" });
    assert(inbound.every((entry) => entry.direction === "in"));

    const byConnector = hub.audit.filter({ connector: "crm-u" });
    assert(byConnector.length > 0);
    assert(byConnector.every((entry) => [entry.source, entry.movement?.from, entry.movement?.to].includes("crm-u")));

    const searched = hub.audit.search("northwind");
    assert(searched.length > 0, "search should match entity names");
    assert(searched.every((entry) => JSON.stringify(entry).toLowerCase().includes("northwind")));
  });

  test("traces a single entity lifecycle in order", async () => {
    const hub = await getHub();
    await hub.resetData();
    const company = hub.identity.all("company")[0];
    const life = hub.audit.lifecycle("company", company.id);
    assert(life.count > 0, "a seeded company should have history");
    assertEquals(life.entityId, company.id);
    assertEquals(life.entityName, hub.identity.nameOf("company", company));
    assert(life.actions.includes("identity.import"));
    for (let i = 1; i < life.entries.length; i++) {
      assert(life.entries[i].seq > life.entries[i - 1].seq, "lifecycle entries are chronological");
    }
  });

  test("exposes facets for the filter toolbar", async () => {
    const hub = await getHub();
    await hub.resetData();
    const facets = hub.audit.facets();
    assert(facets.actions.length > 0);
    assert(facets.actions.every((facet) => typeof facet.value === "string" && facet.count > 0));
    assert(facets.directions.some((facet) => facet.value === "in"));
  });

  test("records operator notes and keeps the chain valid", async () => {
    const hub = await getHub();
    await hub.resetData();
    const before = hub.audit.all().length;
    const result = await hub.audit.note({ message: "Manually verified the Northwind links.", actor: "auditor" });
    assert(result.ok, result.error);
    assert(result.entry);
    assertEquals(result.entry.action, "audit.note");
    assertEquals(result.entry.actor, "auditor");
    assertEquals(result.entry.summary, "Manually verified the Northwind links.");
    assertEquals(hub.audit.all().length, before + 1);
    assert(hub.audit.verify().ok);
    assertEquals((await hub.audit.note({ message: "   " })).ok, false);
  });

  test("detects a tampered entry", async () => {
    const hub = await getHub();
    await hub.resetData();
    const entry = hub.audit.all()[0];
    const original = entry.summary;
    entry.summary = "tampered summary";
    const verify = hub.audit.verify();
    assert(!verify.ok, "editing an entry must break the chain");
    assert(verify.brokenAt, "the broken entry should be identified");
    entry.summary = original;
    assert(hub.audit.verify().ok, "restoring the entry repairs the chain");
  });

  test("counts inbound and outbound movements", async () => {
    const hub = await getHub();
    await hub.resetData();
    const stats = hub.audit.stats();
    assertEquals(stats.inbound, stats.byDirection.in);
    assertEquals(stats.outbound, stats.byDirection.out);
    assert(stats.total >= stats.inbound + stats.outbound);
    assert(stats.chain.ok);
  });
});
