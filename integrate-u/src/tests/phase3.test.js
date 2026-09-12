import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

function findEntity(hub, typeId, field, value) {
  return hub.identity.all(typeId).find((entity) => String(entity.fields?.[field]) === String(value)) || null;
}

suite("Phase 3 integration", () => {
  test("the hub builds a link graph for the seeded directory", async () => {
    const hub = await getHub();
    await hub.resetData();
    const summary = hub.linker.summary();
    assert(summary.edges >= 30, `expected a populated link graph, got ${summary.edges}`);
    assert(summary.linkedEntities > 20);
    const dangling = hub.linker.report({ status: "dangling" });
    assertEquals(dangling.length, 1);
    assertEquals(dangling[0].raw, "BHL-LT-13");
    const rebuilt = await hub.linker.rebuild();
    assertEquals(rebuilt.pruned, 0);
  });

  test("ingesting a record links it without a rebuild", async () => {
    const hub = await getHub();
    const created = await hub.ingest("it-u", "device", [{ nativeId: "IT-D-TEST-1", fields: { hostname: "NWD-TEST-99", serial: "TST-0001", company: "Northwind Dental Group" } }]);
    const edge = hub.linker.store.outgoing("device", created[0].id).find((candidate) => candidate.type === "device.company");
    assert(edge, "expected an automatic company link");
    assertEquals(hub.identity.get("company", edge.toId).fields.name, "Northwind Dental Group");
  });

  test("cross-tool search spans the whole directory", async () => {
    const hub = await getHub();
    const result = hub.search.query("blue harbor");
    assert(result.total >= 5);
    for (const typeId of ["company", "customer", "device", "ticket", "invoice"]) {
      assert(result.groups.some((group) => group.typeId === typeId), `expected a ${typeId} hit`);
    }
  });

  test("reference resolution and reconciliation agree on drift", async () => {
    const hub = await getHub();
    const references = hub.references.stats();
    const reconciliation = hub.reconciler.stats();
    assertEquals(reconciliation.byKind["stale-value"] || 0, references.stale);
    assertEquals(reconciliation.byKind["copy-drift"] || 0, references.copies);
    assertEquals(reconciliation.byKind["field-conflict"] || 0, references.conflicts);
  });

  test("a link can be resolved and then reconciled away", async () => {
    const hub = await getHub();
    const ticket = findEntity(hub, "ticket", "number", "T-10503");
    const device = findEntity(hub, "device", "hostname", "BHL-LT-12");
    await hub.linker.override({ fromType: "ticket", fromId: ticket.id, field: "linkedDevice", toType: "device", toId: device.id, note: "integration" });
    assertEquals(hub.linker.summary().byStatus.dangling || 0, 0);
    assertEquals(hub.reconciler.findings({ kind: "unresolved-reference" }).length, 0);
    await hub.linker.clearField("ticket", ticket.id, "linkedDevice");
    assertEquals(hub.linker.summary().byStatus.dangling, 1);
  });

  test("merging a duplicate keeps the link graph consistent", async () => {
    const hub = await getHub();
    const before = hub.identity.count("company");
    const duplicate = hub.identity.findDuplicates("company")[0];
    assert(duplicate);
    await hub.merge(duplicate.type, duplicate.keepId, duplicate.dropId, { confidence: duplicate.confidence });
    assertEquals(hub.identity.count("company"), before - 1);
    for (const edge of hub.linker.store.all()) {
      assert(hub.identity.get(edge.fromType, edge.fromId), `from ${edge.fromId} should still exist`);
      assert(hub.identity.get(edge.toType, edge.toId), `to ${edge.toId} should still exist`);
    }
  });
});
