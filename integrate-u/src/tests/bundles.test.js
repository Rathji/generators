import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";
import { serialize, preview, filenameFor, entityColumns, csvCell } from "../core/exporters.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

suite("Bundle publisher", () => {
  test("builds a snapshot of the whole linked directory", async () => {
    const hub = await getHub();
    await hub.resetData();
    const result = hub.bundles.build({ target: "ai-assistant", scope: "all" });
    assert(result.ok);
    const bundle = result.bundle;
    assertEquals(bundle.counts.entities, hub.identity.stats().total);
    assertEquals(bundle.entities.length, bundle.counts.entities);
    assert(bundle.counts.links > 0, "the snapshot should carry the link graph");
    assertEquals(bundle.links.length, bundle.counts.links);
    assert(bundle.counts.references > 0);
    assert(bundle.fingerprint.startsWith("fp_"), "every bundle gets a content fingerprint");
    assertEquals(bundle.target, "ai-assistant");
    assertEquals(bundle.scope, "all");
  });

  test("scopes a snapshot to a slice of entity types", async () => {
    const hub = await getHub();
    await hub.resetData();
    const directory = hub.bundles.build({ scope: "directory" }).bundle;
    assert(directory.entities.every((entity) => entity.typeId === "company" || entity.typeId === "customer"));
    assertEquals(directory.counts.entities, hub.identity.count("company") + hub.identity.count("customer"));
    const service = hub.bundles.build({ scope: "service" }).bundle;
    assertEquals(service.counts.entities, hub.identity.count("ticket") + hub.identity.count("invoice"));
    assert(service.entities.some((entity) => entity.typeId === "ticket"));
    assertEquals(service.links.filter((link) => link.fromType === "company").length, 0);
  });

  test("redacts sensitive and private fields unless the caller opts in", async () => {
    const hub = await getHub();
    await hub.resetData();
    const safe = hub.bundles.build({ scope: "directory" }).bundle;
    assert(safe.counts.redactions > 0, "tax IDs should be stripped by default");
    const safeCompany = safe.entities.find((entity) => entity.typeId === "company");
    assert(!("taxId" in safeCompany.fields));
    assert(safeCompany.redacted.includes("taxId"));

    const full = hub.bundles.build({ scope: "directory", includeSensitive: true, includePrivate: true }).bundle;
    const fullCompany = full.entities.find((entity) => entity.typeId === "company");
    assert("taxId" in fullCompany.fields, "opting in should keep the sensitive field");
    assertEquals(fullCompany.redacted.length, 0);
  });

  test("publishes a bundle, persists it, and emits bundle.published", async () => {
    const hub = await getHub();
    await hub.resetData();
    const result = await hub.bundles.publish({ target: "knowledge-base", scope: "all", format: "csv", name: "KB snapshot" });
    assert(result.ok, result.error);
    assertEquals(hub.bundles.list().length, 1);
    assertEquals(hub.bundles.latest().format, "csv");
    assertEquals(hub.bundles.get(result.bundle.id).name, "KB snapshot");
    const event = hub.log.recent(50).find((entry) => entry.type === "bundle.published");
    assert(event, "publishing should log a bundle.published event");
    assertEquals(event.payload.bundleId, result.bundle.id);
    assertEquals(event.payload.format, "csv");
    assertEquals(event.payload.target, "knowledge-base");
    assertEquals(event.payload.records, result.bundle.counts.entities);
  });

  test("rejects unknown targets and formats", async () => {
    const hub = await getHub();
    await hub.resetData();
    assertEquals(hub.bundles.build({ target: "nope" }).ok, false);
    assertEquals((await hub.bundles.publish({ target: "ai-assistant", format: "xml" })).ok, false);
  });

  test("lists newest first and removes bundles", async () => {
    const hub = await getHub();
    await hub.resetData();
    await hub.bundles.publish({ target: "ai-assistant", scope: "directory" });
    await hub.bundles.publish({ target: "data-warehouse", scope: "assets" });
    const list = hub.bundles.list();
    assertEquals(list.length, 2);
    assertEquals(list[0].target, "data-warehouse");
    assertEquals(hub.bundles.stats().byTarget["data-warehouse"], 1);
    await hub.bundles.remove(list[0].id);
    assertEquals(hub.bundles.list().length, 1);
    assertEquals(hub.bundles.stats().total, 1);
  });

  test("serialises to JSON and CSV", async () => {
    const hub = await getHub();
    await hub.resetData();
    const bundle = hub.bundles.build({ scope: "directory" }).bundle;

    const json = serialize(bundle, "json");
    const parsed = JSON.parse(json);
    assertEquals(parsed.id, bundle.id);
    assertEquals(parsed.counts.entities, bundle.counts.entities);

    const csv = serialize(bundle, "csv");
    const lines = csv.split("\n");
    assertEquals(lines.length, bundle.counts.entities + 1);
    assert(lines[0].startsWith("type,id,name"), `unexpected header: ${lines[0]}`);
    assertEquals(entityColumns(bundle).slice(0, 3), ["type", "id", "name"]);

    const links = serialize(bundle, "csv", { table: "links" });
    assertEquals(links.split("\n").length, bundle.counts.links + 1);

    assertEquals(csvCell("plain"), "plain");
    assertEquals(csvCell('a,"b"'), '"a,""b"""');
  });

  test("previews are bounded and filenames are stable", async () => {
    const hub = await getHub();
    await hub.resetData();
    const bundle = hub.bundles.build({ scope: "all" }).bundle;
    const view = preview(bundle, { format: "json", maxLines: 10 });
    assertEquals(view.truncated, true);
    assert(view.text.includes("more line"));
    const filename = filenameFor(bundle, "json");
    assert(filename.endsWith(".json"));
    assert(filename.includes(bundle.id));
    assert(filenameFor(bundle, "csv", { table: "links" }).endsWith("-links.csv"));
  });
});
