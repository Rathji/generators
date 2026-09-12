import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";
import { SETTLEMENT_RULES } from "../core/conflict.js";

let hubPromise = null;
function getHub() {
  if (!hubPromise) hubPromise = createHub({ kv: null, config: getConfig() }).ready();
  return hubPromise;
}

function companyWithName(hub) {
  return hub.identity.all("company").find((entity) => entity.fields?.name);
}

suite("Conflict resolution", () => {
  test("maps every sync direction to exactly one ownership rule", async () => {
    const hub = await getHub();
    assertEquals(hub.conflicts.rules.length, 4);
    assertEquals(hub.conflicts.ruleForDirection("push").id, "owner-authoritative");
    assertEquals(hub.conflicts.ruleForDirection("bidirectional").id, "owner-wins-two-way");
    assertEquals(hub.conflicts.ruleForDirection("pull").id, "hub-derivation");
    assertEquals(hub.conflicts.ruleForDirection("none").id, "hub-local");
    assertEquals(hub.conflicts.ruleForDirection("sideways"), null);
    const directions = SETTLEMENT_RULES.map((rule) => rule.direction).sort();
    assertEquals(directions, ["bidirectional", "none", "pull", "push"]);
  });

  test("a competing write opens a conflict the owner wins", async () => {
    const hub = await getHub();
    await hub.resetData();
    const company = companyWithName(hub);
    const original = company.fields.name;
    const result = await hub.conflicts.simulate({ entityType: "company", entityId: company.id, field: "name", value: "Conflicting write from another tool" });
    assert(result.ok, "the simulation should write the value");
    assert(result.decision, "a conflict should be detected");
    assertEquals(result.decision.rule, "owner-authoritative");
    assertEquals(result.decision.winner, "owner");
    assertEquals(result.decision.owner, "crm-u");
    assertEquals(result.decision.value, result.decision.ownerHeld);
    const plan = hub.conflicts.plan();
    assertEquals(plan.length, 1);
    assertEquals(plan[0].entityId, company.id);
    assert(plan[0].auto, "a push conflict is auto-resolvable");
  });

  test("resolving adopts the owner value and is idempotent", async () => {
    const hub = await getHub();
    await hub.resetData();
    const company = companyWithName(hub);
    const original = company.fields.name;
    await hub.conflicts.simulate({ entityType: "company", entityId: company.id, field: "name", value: "Wrong" });
    const decision = hub.conflicts.plan()[0];
    const first = await hub.conflicts.resolve(decision);
    const second = await hub.conflicts.resolve(decision);
    assert(first.applied && !first.reused);
    assert(second.reused && !second.applied, "resolving twice must reuse the recorded decision");
    assertEquals(hub.identity.get("company", company.id).fields.name, original, "the owner value wins");
    assertEquals(hub.conflicts.plan().length, 0, "the conflict is settled");
    assertEquals(hub.conflicts.history().length, 1, "one settlement is recorded");
  });

  test("resolveAll settles every automatic conflict and leaves manual ones", async () => {
    const hub = await getHub();
    await hub.resetData();
    const company = companyWithName(hub);
    await hub.conflicts.simulate({ entityType: "company", entityId: company.id, field: "name", value: "Wrong A" });
    const other = hub.identity.all("company").find((entity) => entity.id !== company.id && entity.fields?.name);
    await hub.conflicts.simulate({ entityType: "company", entityId: other.id, field: "name", value: "Wrong B" });
    assertEquals(hub.conflicts.stats().open, 2);
    const summary = await hub.conflicts.resolveAll();
    assertEquals(summary.resolved, 2);
    assertEquals(hub.conflicts.plan().length, 0);
    assertEquals(hub.conflicts.history().length, 2);
  });

  test("derived and hub-local fields resolve under their own rules", async () => {
    const hub = await getHub();
    await hub.resetData();
    const stale = hub.references.scanDrift().stale.find((reference) => reference.field === "assetCount");
    assert(stale, "expected a stale derived count");
    const derived = hub.conflicts.ruleFor(stale);
    assertEquals(derived.rule, "hub-derivation");
    assertEquals(derived.winner, "derived");
    assert(derived.auto, "derivation is automatic");
    const company = companyWithName(hub);
    const local = hub.conflicts.ruleFor(hub.references.fieldReference("company", company.id, "accountNotes"));
    assertEquals(local.rule, "hub-local");
    assertEquals(local.winner, "hub");
    assert(!local.auto, "hub-local fields need no automatic settlement");
  });
});
