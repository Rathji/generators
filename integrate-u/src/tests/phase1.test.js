import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Phase 1 integration", () => {
  test("hub boots in memory and seeds the demo directory", async () => {
    const hub = await getHub();
    const s = hub.identity.stats();
    assert(s.total >= 24, `expected a seeded directory, got ${s.total}`);
    assert(s.byType.company >= 6, `expected companies, got ${s.byType.company}`);
    assert(s.byType.customer >= 6, `expected customers, got ${s.byType.customer}`);
    assertEquals(hub.storageMode(), "memory");
  });

  test("records from every connector converge onto canonical identities", async () => {
    const hub = await getHub();
    const northwind = hub.identity.search("northwinddental.com", { type: "company" })[0];
    assert(northwind, "expected Northwind to exist");
    assert(northwind.refs.length >= 3, `expected cross-tool refs, got ${northwind.refs.length}`);
    assert(northwind.keys.length >= 2, "expected multiple natural keys to be recorded");
    const sources = new Set(northwind.refs.map((r) => r.connector));
    for (const connector of ["crm-u", "psa-u", "it-u", "rmm-u"]) {
      assert(sources.has(connector), `expected a ${connector} reference`);
    }
  });

  test("an unmergeable duplicate is surfaced rather than silently matched", async () => {
    const hub = await getHub();
    const duplicates = hub.identity.findDuplicates();
    assert(duplicates.length >= 1, "expected at least one duplicate suggestion");
    assert(duplicates.every((d) => d.keepId !== d.dropId));
  });

  test("the registry, entity types and connectors agree", async () => {
    const hub = await getHub();
    const report = hub.registry.validate();
    assertEquals(report.counts.error, 0);
    for (const type of hub.registry.entityTypes) {
      for (const field of hub.registry.fieldsFor(type.id)) {
        assert(hub.registry.connector(field.owner), `unknown owner ${field.owner} on ${type.id}.${field.key}`);
        assert(hub.registry.declares(field.owner, type.id), `${field.owner} does not declare ${type.id}`);
      }
    }
  });

  test("permissions and the registry agree on who may write", async () => {
    const hub = await getHub();
    assert(hub.permissions.hasCapability({ connector: "iu", toolRole: "Hub Administrator" }, "registry.write"));
    assert(!hub.permissions.hasCapability({ connector: "psa-u", toolRole: "Technician" }, "company.write"));
    assert(hub.registry.canWrite("crm-u", "company", "domain"));
    assert(!hub.registry.canWrite("psa-u", "company", "domain"));
  });
});
