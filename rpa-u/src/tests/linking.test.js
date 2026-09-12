import { suite, test, assert, assertEquals, onRunStart } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";
import { LINK_TYPES, linkType, linkTypesFor, linkTypesTo, linkTypeForField, isResolved } from "../core/link-catalog.js";
import { createLinkStore } from "../core/link-store.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

onRunStart(async () => {
  await (await getHub()).resetData();
});

function findEntity(hub, typeId, field, value) {
  return hub.identity.all(typeId).find((entity) => String(entity.fields?.[field]) === String(value)) || null;
}

suite("Link catalog", () => {
  test("declares one link type per cross-entity reference", () => {
    assertEquals(LINK_TYPES.length, 6);
    assertEquals(linkType("ticket.linkedDevice").toType, "device");
    assertEquals(linkType("invoice.company").inverseLabel, "Invoices");
    assertEquals(
      linkTypesFor("ticket").map((entry) => entry.id),
      ["ticket.company", "ticket.linkedDevice"]
    );
    assertEquals(linkTypesTo("company").length, 4);
    assertEquals(linkTypeForField("device", "company").id, "device.company");
    assertEquals(linkTypeForField("device", "serial"), null);
    assert(isResolved("linked"));
    assert(isResolved("manual"));
    assert(!isResolved("dangling"));
  });
});

suite("Link store", () => {
  test("indexes, finds and removes edges", async () => {
    const store = createLinkStore({ clock: () => 1700000000000 });
    const deviceEdge = await store.put({ type: "device.company", fromType: "device", fromId: "dv_1", toType: "company", toId: "co_1", field: "company", origin: "auto" });
    const ticketEdge = await store.put({ type: "ticket.company", fromType: "ticket", fromId: "tk_1", toType: "company", toId: "co_1", field: "company", origin: "auto" });

    assertEquals(store.count(), 2);
    assertEquals(store.outgoing("device", "dv_1").length, 1);
    assertEquals(store.incoming("company", "co_1").length, 2);
    assertEquals(store.byType("device.company").length, 1);
    assertEquals(store.find({ toId: "co_1" }).length, 2);
    assertEquals(store.find({ origin: "manual" }).length, 0);
    assertEquals(store.stats().entities, 3);
    assertEquals(store.stats().byType["device.company"], 1);
    assertEquals(deviceEdge.id, store.edgeId("device", "dv_1", "device.company", "company", "co_1"));

    await store.remove(ticketEdge.id);
    assertEquals(store.count(), 1);
    assertEquals(store.incoming("company", "co_1").length, 1);

    await store.clear();
    assertEquals(store.count(), 0);
    assertEquals(store.incoming("company", "co_1").length, 0);
  });
});

suite("Entity linking", () => {
  test("seeds a resolved link for every declared reference", async () => {
    const hub = await getHub();
    const summary = hub.linker.summary();
    assertEquals(summary.references, 40);
    assertEquals(summary.byStatus.dangling, 1);
    assertEquals(summary.byStatus.empty, 3);
    assert(summary.edges >= 30, "expected the demo import to build a link graph");
    assert(summary.linkedEntities > 20);
  });

  test("a matching reference resolves to its target", async () => {
    const hub = await getHub();
    const device = findEntity(hub, "device", "hostname", "NWD-LT-01");
    const resolution = hub.linker.resolveField("device", device.id, "device.company");
    assertEquals(resolution.status, "linked");
    assertEquals(resolution.target.name, "Northwind Dental Group");
    assertEquals(resolution.confidence, 1);
  });

  test("a reference with no match is dangling", async () => {
    const hub = await getHub();
    const ticket = findEntity(hub, "ticket", "number", "T-10503");
    const resolution = hub.linker.resolveField("ticket", ticket.id, "ticket.linkedDevice");
    assertEquals(resolution.status, "dangling");
    assertEquals(resolution.raw, "BHL-LT-13");
    assertEquals(resolution.candidates.filter((candidate) => candidate.score >= 1).length, 0);
  });

  test("an optional blank reference is empty while a required one is missing", async () => {
    const hub = await getHub();
    const optional = findEntity(hub, "ticket", "number", "T-10488");
    assertEquals(hub.linker.resolveField("ticket", optional.id, "ticket.linkedDevice").status, "empty");
    const created = await hub.ingest("psa-u", "ticket", [{ nativeId: "PSA-T-9001", fields: { number: "T-9001", subject: "Broken onboarding", status: "Open" } }]);
    assertEquals(hub.linker.resolveField("ticket", created[0].id, "ticket.company").status, "missing");
  });

  test("a reference matching two records is ambiguous", async () => {
    const hub = await getHub();
    const ticket = findEntity(hub, "ticket", "number", "T-10488");
    await hub.identity.setField("ticket", ticket.id, "company", "ironwood", "psa-u");
    const resolution = hub.linker.resolveField("ticket", ticket.id, "ticket.company");
    assertEquals(resolution.status, "ambiguous");
    assert(resolution.candidates.length >= 2);
  });

  test("a manual override wins and can be cleared back", async () => {
    const hub = await getHub();
    const ticket = findEntity(hub, "ticket", "number", "T-10503");
    const device = findEntity(hub, "device", "hostname", "BHL-LT-12");
    const result = await hub.linker.override({ fromType: "ticket", fromId: ticket.id, field: "linkedDevice", toType: "device", toId: device.id, note: "test" });
    assert(result.ok);
    const resolution = hub.linker.resolveField("ticket", ticket.id, "ticket.linkedDevice");
    assertEquals(resolution.status, "manual");
    assertEquals(resolution.target.entityId, device.id);
    await hub.linker.clearField("ticket", ticket.id, "linkedDevice");
    assertEquals(hub.linker.resolveField("ticket", ticket.id, "ticket.linkedDevice").status, "dangling");
  });

  test("relinking an entity replaces a stale automatic edge", async () => {
    const hub = await getHub();
    const device = findEntity(hub, "device", "hostname", "NWD-LT-01");
    const before = hub.linker.store.outgoing("device", device.id).filter((edge) => edge.type === "device.company").length;
    assertEquals(before, 1);
    await hub.identity.setField("device", device.id, "company", "Alder & Finch Bookkeeping", "it-u");
    await hub.linker.linkEntity("device", device.id);
    const edges = hub.linker.store.outgoing("device", device.id).filter((edge) => edge.type === "device.company");
    assertEquals(edges.length, 1);
    assertEquals(hub.identity.get("company", edges[0].toId).fields.name, "Alder & Finch Bookkeeping");
  });

  test("rebuild prunes edges that point at removed records", async () => {
    const hub = await getHub();
    const ghostId = hub.linker.store.edgeId("device", "dv_ghost", "device.company", "company", "co_ghost");
    await hub.linker.store.put({ type: "device.company", fromType: "device", fromId: "dv_ghost", toType: "company", toId: "co_ghost", field: "company", origin: "auto" });
    assertEquals(hub.linker.store.get(ghostId).id, ghostId);
    const result = await hub.linker.rebuild();
    assert(result.pruned >= 1);
    assertEquals(hub.linker.store.get(ghostId), null);
  });

  test("removeEntity drops every edge touching a record", async () => {
    const hub = await getHub();
    const device = findEntity(hub, "device", "hostname", "NWD-LT-01");
    assert(hub.linker.store.outgoing("device", device.id).length > 0);
    const removed = await hub.linker.removeEntity("device", device.id);
    assert(removed >= 1);
    assertEquals(hub.linker.store.outgoing("device", device.id).length, 0);
    assertEquals(hub.linker.store.incoming("device", device.id).length, 0);
  });
});
