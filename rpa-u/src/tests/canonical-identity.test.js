import { suite, test, assert, assertEquals, assertMatch } from "./harness.js";
import { createDb } from "../core/db.js";
import { createIdentityStore, naturalKey } from "../core/identity.js";
import { ENTITY_TYPES } from "../core/catalog.js";

function freshStore() {
  const collections = [...ENTITY_TYPES.map((t) => t.collection), "keys", "refs", "meta"];
  const db = createDb({ kv: null, namespace: "test", collections });
  return { db, store: createIdentityStore({ db }) };
}

suite("Canonical identity", () => {
  test("natural keys prefer the strongest available identifier", () => {
    assertEquals(naturalKey("company", { name: "Acme", domain: "https://www.Acme.com/x" }), "domain:acme.com");
    assertEquals(naturalKey("company", { name: "Acme", city: "Boston" }), "name:acme@boston");
    assertEquals(naturalKey("customer", { email: "A@B.com" }), "email:a@b.com");
    assertEquals(naturalKey("customer", { fullName: "Dana Whitfield", company: "Northwind" }), "name:dana-whitfield@northwind");
    assertEquals(naturalKey("device", { serial: "NWD-2231" }), "serial:nwd-2231");
    assertEquals(naturalKey("ticket", {}, { connector: "psa-u", nativeId: "PSA-T-1" }), "ref:psa-u:PSA-T-1");
  });

  test("the same domain yields the same id in two independent hubs", async () => {
    const a = freshStore();
    const b = freshStore();
    const first = await a.store.upsert("company", { fields: { name: "Acme", domain: "acme.com" }, connector: "crm-u", nativeId: "C-1" });
    const second = await b.store.upsert("company", { fields: { name: "Acme Ltd", domain: "acme.com" }, connector: "rmm-u", nativeId: "R-1" });
    assertEquals(first.entity.id, second.entity.id);
    assertMatch(first.entity.id, /^co_[0-9a-z]{7}$/);
  });

  test("records from different tools converge on one entity", async () => {
    const { store } = freshStore();
    await store.upsert("company", { fields: { name: "Northwind Dental Group", domain: "northwinddental.com" }, connector: "crm-u", nativeId: "CRM-C-1" });
    await store.upsert("company", { fields: { name: "Northwind Dental Group" }, connector: "it-u", nativeId: "IT-C-1" });
    assertEquals(store.count("company"), 1);
    assertEquals(store.all("company")[0].refs.length, 2);
  });

  test("matching by email merges customers with different display names", async () => {
    const { store } = freshStore();
    await store.upsert("customer", { fields: { fullName: "Dana Whitfield", email: "dana@northwinddental.com" }, connector: "crm-u", nativeId: "P-1" });
    await store.upsert("customer", { fields: { fullName: "D. Whitfield", email: "dana@northwinddental.com" }, connector: "psa-u", nativeId: "P-2" });
    assertEquals(store.count("customer"), 1);
  });

  test("customers with different emails stay separate", async () => {
    const { store } = freshStore();
    await store.upsert("customer", { fields: { fullName: "Dana Whitfield", email: "dana@a.com" }, connector: "crm-u", nativeId: "1" });
    await store.upsert("customer", { fields: { fullName: "Dana Whitfield", email: "dana@b.com" }, connector: "crm-u", nativeId: "2" });
    assertEquals(store.count("customer"), 2);
  });

  test("references resolve back to the canonical entity", async () => {
    const { store } = freshStore();
    const { entity } = await store.upsert("device", { fields: { hostname: "NWD-LT-01", serial: "NWD-2231" }, connector: "rmm-u", nativeId: "RMM-D-1" });
    assertEquals(store.findByRef("rmm-u", "RMM-D-1").id, entity.id);
    assertEquals(store.findByRef("rmm-u", "missing"), null);
  });

  test("merging keeps the surviving id and combines refs, keys and fields", async () => {
    const { store } = freshStore();
    const keep = (await store.upsert("company", { fields: { name: "Ironwood Manufacturing", domain: "ironwoodmfg.com" }, connector: "crm-u", nativeId: "C-1" })).entity;
    const drop = (await store.upsert("company", { fields: { name: "Ironwood Mfg.", assetCount: 18 }, connector: "rmm-u", nativeId: "R-1" })).entity;
    assertEquals(store.count("company"), 2);
    const merged = await store.merge("company", keep.id, drop.id);
    assertEquals(merged.id, keep.id);
    assertEquals(store.count("company"), 1);
    assertEquals(merged.refs.length, 2);
    assertEquals(merged.fields.assetCount, 18);
    assertEquals(store.findByRef("rmm-u", "R-1").id, keep.id);
  });

  test("duplicate detection suggests likely pairs", async () => {
    const { store } = freshStore();
    await store.upsert("company", { fields: { name: "Ironwood Manufacturing", domain: "ironwoodmfg.com" }, connector: "crm-u", nativeId: "C-1" });
    await store.upsert("company", { fields: { name: "Ironwood Mfg." }, connector: "rmm-u", nativeId: "R-1" });
    const duplicates = store.findDuplicates();
    assertEquals(duplicates.length, 1);
    assertEquals(duplicates[0].type, "company");
  });

  test("search matches names, ids, references and field values", async () => {
    const { store } = freshStore();
    await store.upsert("company", { fields: { name: "Blue Harbor Logistics", domain: "blueharborlogistics.com" }, connector: "crm-u", nativeId: "CRM-C-9" });
    assertEquals(store.search("harbor").length, 1);
    assertEquals(store.search("CRM-C-9").length, 1);
    assertEquals(store.search("blueharborlogistics.com").length, 1);
    assertEquals(store.search("nothing-here").length, 0);
  });

  test("stats summarise the directory", async () => {
    const { store } = freshStore();
    await store.upsert("company", { fields: { name: "A", domain: "a.com" }, connector: "crm-u", nativeId: "1" });
    await store.upsert("customer", { fields: { fullName: "X", email: "x@a.com" }, connector: "crm-u", nativeId: "2" });
    const s = store.stats();
    assertEquals(s.total, 2);
    assertEquals(s.byType.company, 1);
    assertEquals(s.byType.customer, 1);
    assertEquals(s.refs, 2);
    assert(s.sources >= 1);
  });
});
