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

suite("Reference resolution", () => {
  test("a field held from a connector that does not own it is a copy", async () => {
    const hub = await getHub();
    const company = findEntity(hub, "company", "name", "Northwind Dental Group");
    const reference = hub.references.fieldReference("company", company.id, "name");
    assertEquals(reference.status, "copy");
    assertEquals(reference.owner, "crm-u");
    assertEquals(reference.ownerName, "CRM-U");
    assert(reference.heldSource && reference.heldSource !== "crm-u", "expected a non-owner to have written the value");
    assert(reference.drift === false);
  });

  test("the owner's own field stays authoritative", async () => {
    const hub = await getHub();
    const company = findEntity(hub, "company", "name", "Northwind Dental Group");
    const reference = hub.references.fieldReference("company", company.id, "phone");
    assertEquals(reference.status, "owner");
    assertEquals(reference.resolver, "owner-fetch");
    assertEquals(reference.authoritative.kind, "held-from-owner");
  });

  test("hub-local fields are private and unknown fields are unregistered", async () => {
    const hub = await getHub();
    const company = findEntity(hub, "company", "name", "Northwind Dental Group");
    assertEquals(hub.references.fieldReference("company", company.id, "accountNotes").status, "private");
    const unknown = hub.references.fieldReference("company", company.id, "mysteryField");
    assertEquals(unknown.status, "unregistered");
    assertEquals(unknown.owner, null);
  });

  test("computed fields resolve through hub derivations", async () => {
    const hub = await getHub();
    const company = findEntity(hub, "company", "name", "Northwind Dental Group");
    const reference = hub.references.fieldReference("company", company.id, "assetCount");
    assertEquals(reference.owner, "rmm-u");
    assert(reference.computed);
    assert(["derived", "stale"].includes(reference.status));
    assertEquals(reference.authoritative.kind, "derived");
  });

  test("ownerValue reads the owning connector's feed", async () => {
    const hub = await getHub();
    const company = findEntity(hub, "company", "name", "Northwind Dental Group");
    assertEquals(hub.references.ownerValue("company", company.id, "name"), "Northwind Dental Group");
    assertEquals(hub.references.ownerValue("company", company.id, "accountNotes"), undefined);
  });

  test("fetch records a sync round-trip on the event log", async () => {
    const hub = await getHub();
    const company = findEntity(hub, "company", "name", "Northwind Dental Group");
    const before = hub.log.size();
    const result = await hub.references.fetch("company", company.id, "assetCount");
    assert(result.fetched, "expected a fetched payload");
    assertEquals(hub.log.size(), before + 2);
    const events = hub.log.recent(20).filter((event) => event.type === "sync.requested" || event.type === "sync.completed");
    const requested = events[events.length - 2];
    const completed = events[events.length - 1];
    assertEquals(requested.type, "sync.requested");
    assertEquals(requested.payload.entityId, company.id);
    assertEquals(completed.type, "sync.completed");
    assertEquals(completed.payload.jobId, result.fetched.jobId);
  });

  test("a copy that disagrees with its owner is a conflict, and refreshing clears it", async () => {
    const hub = await getHub();
    const company = findEntity(hub, "company", "name", "Marigold Bakery Co");
    await hub.identity.setField("company", company.id, "name", "Marigold Bakery", "it-u");
    const reference = hub.references.fieldReference("company", company.id, "name");
    assertEquals(reference.status, "conflict");
    assert(reference.drift);
    assertEquals(reference.ownerHeld, "Marigold Bakery Co");
    const before = hub.references.stats().conflicts;
    const refreshed = await hub.references.refresh("company", company.id, "name");
    assert(refreshed.adopted);
    assertEquals(hub.identity.get("company", company.id).fields.name, "Marigold Bakery Co");
    assertEquals(hub.references.stats().conflicts, before - 1);
  });

  test("refreshing an out-of-date derived value adopts the recomputed one", async () => {
    const hub = await getHub();
    const company = findEntity(hub, "company", "name", "Northwind Dental Group");
    const staleBefore = hub.references.stats().stale;
    const reference = hub.references.fieldReference("company", company.id, "assetCount");
    assertEquals(reference.status, "stale");
    const refreshed = await hub.references.refresh("company", company.id, "assetCount");
    assert(refreshed.adopted);
    assertEquals(hub.identity.get("company", company.id).fields.assetCount, refreshed.adoptedValue);
    assertEquals(hub.references.stats().stale, staleBefore - 1);
    assertEquals(hub.references.fieldReference("company", company.id, "assetCount").status, "derived");
  });
});
