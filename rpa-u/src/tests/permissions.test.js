import { suite, test, assert, assertEquals } from "./harness.js";
import { createPermissions } from "../core/permissions.js";

suite("Permission mapping", () => {
  const permissions = createPermissions();

  test("translates tool roles into canonical roles", () => {
    assertEquals(permissions.canonicalRolesFor("psa-u", "Dispatcher"), ["dispatcher"]);
    assertEquals(permissions.canonicalRolesFor("crm-u", "Sales Rep"), ["account_manager"]);
    assertEquals(permissions.canonicalRolesFor("rmm-u", "NOC Engineer"), ["technician"]);
    assertEquals(permissions.canonicalRolesFor("crm-u", "Nonexistent"), []);
    assertEquals(permissions.canonicalRolesFor("nope", "anything"), []);
  });

  test("grants capabilities consistently across tools", () => {
    assert(permissions.hasCapability({ connector: "psa-u", toolRole: "Technician" }, "ticket.write"));
    assert(!permissions.hasCapability({ connector: "psa-u", toolRole: "Technician" }, "invoice.write"));
    assert(permissions.hasCapability({ connector: "psa-u", toolRole: "Accountant" }, "invoice.write"));
    assert(!permissions.hasCapability({ connector: "psa-u", toolRole: "Accountant" }, "device.control"));
  });

  test("two connectors' equivalent roles agree", () => {
    const a = { connector: "psa-u", toolRole: "Technician" };
    const b = { connector: "rmm-u", toolRole: "NOC Engineer" };
    for (const capability of ["device.read", "device.control", "ticket.write", "ticket.read"]) {
      assertEquals(permissions.hasCapability(a, capability), permissions.hasCapability(b, capability), capability);
    }
  });

  test("the owner role is unrestricted", () => {
    assert(permissions.hasCapability({ connector: "ru", toolRole: "Hub Owner" }, "registry.write"));
    assert(permissions.hasCapability({ connector: "ru", toolRole: "Hub Owner" }, "capability.that.does.not.exist"));
  });

  test("explain reports the resolved roles and capabilities", () => {
    const report = permissions.explain({ connector: "rmm-u", toolRole: "NOC Engineer" }, "device.control");
    assertEquals(report.allowed, true);
    assertEquals(report.roles, ["technician"]);
    assert(report.capabilities.length >= 5);
  });

  test("unmapped subjects get nothing", () => {
    assert(!permissions.hasCapability({ connector: "crm-u", toolRole: "Unknown" }, "company.read"));
    assert(!permissions.hasCapability(null, "company.read"));
  });

  test("the shipped role maps validate without errors", () => {
    assertEquals(permissions.validate().counts.error, 0);
  });

  test("validation detects unknown roles and capabilities", () => {
    const bad = createPermissions({
      roleMaps: { "crm-u": { "Weird Role": "ghost" } },
      roles: { custom: { label: "Custom", capabilities: ["teleport"] } },
    });
    const report = bad.validate();
    assert(report.issues.some((i) => i.code === "unknown-role"), "expected unknown-role");
    assert(report.issues.some((i) => i.code === "unknown-capability"), "expected unknown-capability");
  });

  test("stats summarise the model", () => {
    const s = permissions.stats();
    assert(s.roleCount >= 6, "expected several canonical roles");
    assert(s.mappingCount >= 10, "expected tool role mappings");
    assert(s.capabilityCount >= 15, "expected a capability catalogue");
  });
});
