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

suite("Reconciliation", () => {
  test("reports unresolved references, stale values, copies and duplicates", async () => {
    const hub = await getHub();
    await hub.resetData();
    const stats = hub.reconciler.stats();
    assertEquals(stats.byKind["unresolved-reference"], 1);
    assert(stats.byKind["stale-value"] >= 3);
    assertEquals(stats.byKind["duplicate-identity"], 1);
    assertEquals(stats.byKind["field-conflict"] || 0, 0);
    assert(stats.byKind["copy-drift"] > 0);
    assertEquals(stats.open, stats.total);
  });

  test("findings can be filtered by severity and kind", async () => {
    const hub = await getHub();
    const important = hub.reconciler.findings({ minSeverity: "warning" });
    assert(important.length > 0);
    assert(important.every((item) => item.severity === "error" || item.severity === "warning"));
    assert(!important.some((item) => item.kind === "copy-drift"));
    const stale = hub.reconciler.findings({ kind: "stale-value" });
    assert(stale.length > 0 && stale.every((item) => item.kind === "stale-value"));
  });

  test("groupedByKind accounts for every open finding", async () => {
    const hub = await getHub();
    const groups = hub.reconciler.groupedByKind();
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    assertEquals(total, hub.reconciler.findings().length);
    const order = groups.map((group) => group.severity);
    assertEquals(order[0], "warning");
    assertEquals(order[order.length - 1], "info");
  });

  test("dismissing hides a finding and restoring brings it back", async () => {
    const hub = await getHub();
    const target = hub.reconciler.findings({ kind: "stale-value" })[0];
    assert(target);
    await hub.reconciler.dismiss(target.key, { kind: target.kind });
    assert(!hub.reconciler.findings({ kind: "stale-value" }).some((item) => item.key === target.key));
    assert(hub.reconciler.dismissedFindings().some((item) => item.key === target.key));
    await hub.reconciler.restore(target.key);
    assert(hub.reconciler.findings({ kind: "stale-value" }).some((item) => item.key === target.key));
    assertEquals(hub.reconciler.stats().dismissed, 0);
  });

  test("resolving a stale value refreshes it from the owner", async () => {
    const hub = await getHub();
    const finding = hub.reconciler.findings({ kind: "stale-value" })[0];
    const result = await hub.reconciler.resolve(finding, "refresh");
    assert(result.adopted);
    assert(!hub.reconciler.findings({ kind: "stale-value" }).some((item) => item.key === finding.key));
  });

  test("resolving the unresolved reference links it manually", async () => {
    const hub = await getHub();
    const finding = hub.reconciler.findings({ kind: "unresolved-reference" })[0];
    assertEquals(finding.status, "dangling");
    const device = findEntity(hub, "device", "hostname", "BHL-LT-12");
    const result = await hub.reconciler.resolve(finding, "link", { toId: device.id });
    assert(result.ok);
    assert(!hub.reconciler.findings({ kind: "unresolved-reference" }).some((item) => item.key === finding.key));
  });

  test("pruning removes orphan edges", async () => {
    const hub = await getHub();
    await hub.linker.store.put({ type: "device.company", fromType: "device", fromId: "dv_ghost", toType: "company", toId: "co_ghost", field: "company", origin: "auto" });
    assertEquals(hub.reconciler.findings({ kind: "orphan-link" }).length, 1);
    const result = await hub.reconciler.resolve(hub.reconciler.findings({ kind: "orphan-link" })[0], "prune");
    assert(result.ok);
    assertEquals(hub.reconciler.findings({ kind: "orphan-link" }).length, 0);
  });

  test("merging a duplicate clears the duplicate finding", async () => {
    const hub = await getHub();
    const finding = hub.reconciler.findings({ kind: "duplicate-identity" })[0];
    assert(finding);
    const result = await hub.reconciler.resolve(finding, "merge");
    assert(result.ok);
    assertEquals(hub.reconciler.findings({ kind: "duplicate-identity" }).length, 0);
  });

  test("copy hygiene groups the informational findings by record", async () => {
    const hub = await getHub();
    await hub.resetData();
    const groups = hub.reconciler.copyHygiene();
    assert(groups.length >= 1);
    const fields = groups.reduce((sum, group) => sum + group.fields.length, 0);
    assertEquals(fields, hub.reconciler.findings({ kind: "copy-drift" }).length);
    assert(groups[0].fields.length >= groups[groups.length - 1].fields.length);
  });
});
