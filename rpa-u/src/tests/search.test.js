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

suite("Cross-tool search", () => {
  test("finds matching records across several entity types", async () => {
    const hub = await getHub();
    const result = hub.search.query("northwind");
    assert(result.total >= 5, `expected several hits, got ${result.total}`);
    const types = result.groups.map((group) => group.typeId);
    for (const typeId of ["company", "customer", "device", "ticket", "invoice"]) {
      assert(types.includes(typeId), `expected a ${typeId} hit`);
    }
    assertEquals(result.stats.types, result.groups.length);
  });

  test("exact identifiers rank above partial matches", async () => {
    const hub = await getHub();
    const device = findEntity(hub, "device", "hostname", "NWD-LT-01");
    const result = hub.search.query(device.id);
    assertEquals(result.groups[0].results[0].id, device.id);
    assertEquals(result.groups[0].results[0].matches[0].kind, "id");
  });

  test("multi-token queries require every token to match", async () => {
    const hub = await getHub();
    const result = hub.search.query("northwind dental");
    assert(result.groups.some((group) => group.typeId === "company"));
    for (const group of result.groups) {
      for (const item of group.results) {
        assertEquals(item.matches.length, 2);
      }
    }
    assertEquals(hub.search.query("northwind zzzzzz").total, 0);
  });

  test("results carry connector references and link counts", async () => {
    const hub = await getHub();
    const result = hub.search.query("northwind");
    const company = result.groups.find((group) => group.typeId === "company").results[0];
    assert(company.refs.length >= 2);
    assert(company.connectors.includes("crm-u"));
    assert(company.connectorNames.includes("CRM-U"));
    assert(company.linkCount > 0);
  });

  test("queries can be filtered by type and connector", async () => {
    const hub = await getHub();
    const byType = hub.search.query("northwind", { type: "company" });
    assertEquals(byType.groups.map((group) => group.typeId), ["company"]);
    const byConnector = hub.search.query("northwind", { connector: "crm-u" });
    assert(byConnector.groups.length >= 1);
    assert(byConnector.groups.every((group) => group.results.every((item) => item.connectors.includes("crm-u"))));
  });

  test("queries can be filtered by link state", async () => {
    const hub = await getHub();
    const duplicate = hub.identity.all("company").find((entity) => entity.fields.name === "Ironwood Mfg.");
    assert(duplicate, "expected the unmatched Ironwood record");
    const unlinked = hub.search.query(duplicate.id, { only: "unlinked" });
    assertEquals(unlinked.total, 1);
    assert(unlinked.groups.every((group) => group.results.every((item) => item.linkCount === 0)));
    const linked = hub.search.query(duplicate.id, { only: "linked" });
    assertEquals(linked.total, 0);
    const unresolved = hub.search.query("T-10503", { only: "unresolved" });
    assertEquals(unresolved.groups[0].results[0].fields.number, "T-10503");
    assert(unresolved.groups[0].results[0].unresolved);
    assertEquals(hub.search.query("NWD-LT-01", { only: "unresolved" }).total, 0);
  });

  test("byRef, byId and suggestions resolve known records", async () => {
    const hub = await getHub();
    const device = findEntity(hub, "device", "hostname", "NWD-LT-01");
    const ref = device.refs[0];
    assertEquals(hub.search.byRef(ref.connector, ref.nativeId).id, device.id);
    assertEquals(hub.search.byRef("it-u", "does-not-exist"), null);
    assertEquals(hub.search.byId(device.id).id, device.id);
    assertEquals(hub.search.byId("nope"), null);
    const suggestions = hub.search.suggestions("north");
    assert(suggestions.length >= 1);
    assert(suggestions.every((item) => item.score > 0 && item.name && item.typeId));
  });
});
