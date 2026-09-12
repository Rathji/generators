import { suite, test, assert, assertEquals } from "./harness.js";
import { createRegistry } from "../core/registry.js";

suite("Integration registry", () => {
  const registry = createRegistry();

  test("resolves the owner of each field", () => {
    assertEquals(registry.owner("company", "domain"), "crm-u");
    assertEquals(registry.owner("company", "assetCount"), "rmm-u");
    assertEquals(registry.owner("company", "documentationUrl"), "it-u");
    assertEquals(registry.owner("ticket", "status"), "psa-u");
    assertEquals(registry.owner("company", "doesNotExist"), null);
  });

  test("only the owning connector may write a field", () => {
    assert(registry.canWrite("crm-u", "company", "name"));
    assert(!registry.canWrite("rmm-u", "company", "name"));
    assert(!registry.canWrite("crm-u", "company", "assetCount"));
    assert(!registry.canWrite("ghost", "company", "name"));
  });

  test("connectors declare the entity types they participate in", () => {
    assert(registry.declares("rmm-u", "device"));
    assert(!registry.declares("rmm-u", "ticket"));
    assert(!registry.declares("ghost", "company"));
  });

  test("the shipped registry validates without errors", () => {
    const report = registry.validate();
    assertEquals(report.counts.error, 0);
    assert(report.ok, "expected the shipped registry to be valid");
  });

  test("validation detects a duplicated field owner", () => {
    const bad = createRegistry({
      fieldModel: {
        company: [
          { key: "name", label: "Name", owner: "crm-u" },
          { key: "name", label: "Name again", owner: "it-u" },
        ],
      },
    });
    const report = bad.validate();
    assert(report.issues.some((i) => i.code === "duplicate-field"), "expected duplicate-field");
    assertEquals(report.ok, false);
  });

  test("validation detects unknown owners and invalid directions", () => {
    const bad = createRegistry({
      fieldModel: { company: [{ key: "x", label: "X", owner: "ghost", direction: "telepathy" }] },
    });
    const report = bad.validate();
    assert(report.issues.some((i) => i.code === "unknown-owner"), "expected unknown-owner");
    assert(report.issues.some((i) => i.code === "invalid-direction"), "expected invalid-direction");
  });

  test("validation warns when an owner does not declare the entity type", () => {
    const bad = createRegistry({
      fieldModel: { ticket: [{ key: "subject", label: "Subject", owner: "crm-u" }] },
    });
    const report = bad.validate();
    assert(report.issues.some((i) => i.code === "owner-scope-mismatch"), "expected owner-scope-mismatch");
  });

  test("summarises owned fields per connector", () => {
    const owned = registry.fieldsOwnedBy("rmm-u");
    assert(owned.length >= 3, "rmm-u should own several fields");
    assert(owned.every((f) => f.owner === "rmm-u"));
  });
});
