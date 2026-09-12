// src/tests/organization.test.js — validation tests for Phase 2 task 7
// (organizations & locations). Run in the live page:
//   await import("./src/tests/organization.test.js").then((m) => m.run())
//
// Covers: the organization-kind and location-type catalogs; standardized-field
// validation enforced by the docs service (a location must declare one of the
// fixed types, an organization must declare its kind); parents (org/location
// containment) including cycle detection; address/detail display formatting;
// and the organization-* relationship kinds (correct direction accepted, wrong
// direction refused).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  validateRecordFields,
  requireRecordFields,
  recordDetailLine,
} from "../framework/standardized.js";
import {
  formatAddress,
  containmentIssues,
  ORGANIZATION_KINDS,
  LOCATION_TYPES,
  locationType,
  organizationKind,
} from "../framework/organization.js";

const C = { informationModel: "core-asset", provenance: "authored" };

export async function run() {
  return runTests([
    {
      name: "the catalogs list the standardized organization kinds and location types",
      fn: () => {
        assert(ORGANIZATION_KINDS.some((k) => k.id === "organization"), "organization kind");
        assert(ORGANIZATION_KINDS.some((k) => k.id === "department"), "department kind");
        assert(ORGANIZATION_KINDS.some((k) => k.id === "business-unit"), "business-unit kind");
        assertEq(organizationKind("department").label, "Department", "kind lookup");
        for (const t of ["office", "branch", "site", "datacentre", "other"]) {
          assert(LOCATION_TYPES.some((x) => x.id === t), "location type " + t);
        }
        assertEq(locationType("datacentre").label, "Datacentre", "type lookup");
      },
    },
    {
      name: "validateRecordFields refuses an unknown kind/type and accepts the standard ones",
      fn: () => {
        assert(!validateRecordFields("organizations", { name: "X" }).ok, "org without a kind refused");
        assert(validateRecordFields("organizations", { name: "X", orgKind: "department" }).ok, "valid org accepted");
        assert(!validateRecordFields("locations", { name: "X", locationType: "moon-base" }).ok, "unknown location type refused");
        assert(validateRecordFields("locations", { name: "X", locationType: "branch" }).ok, "valid location accepted");
        // Non-standardized types are unaffected.
        assert(!validateRecordFields("contacts", { name: "Jo" }).ok, "contacts now need a role");
        assert(validateRecordFields("contacts", { name: "Jo", contactRole: "client-primary" }).ok, "valid contact accepted");
        assert(!validateRecordFields("documents", { name: "Runbook" }).ok, "documents now need a type");
        assert(validateRecordFields("documents", { name: "Runbook", docType: "reference" }).ok, "valid document accepted");
      },
    },
    {
      name: "requireRecordFields throws a typed INVALID_DATA error",
      fn: () => {
        let threw = null;
        try {
          requireRecordFields("locations", { name: "HQ" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "typed error");
        assert(threw.message.includes("HQ"), "message names the record");
        assert(threw.message.includes("location type"), "message explains the rule");
      },
    },
    {
      name: "the docs service enforces standardized fields on add AND edit",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-org" });
        const set = await docs.create({ name: "Acme" });
        let threw = null;
        try {
          await docs.addRecord(set.id, { type: "locations", name: "HQ", ...C });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "unstandardized location refused");
        const loc = (await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", ...C })).record;
        assertEq(loc.locationType, "office", "standardized location stored");
        // an edit can't blank the standardized field
        threw = null;
        try {
          await docs.updateRecord(set.id, { type: "locations", id: loc.id }, { locationType: "" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "blanking the type on edit refused");
        assertEq((await docs.get(set.id)).records.locations[0].locationType, "office", "still standardized");
      },
    },
    {
      name: "formatAddress and recordDetailLine produce a consistent location line",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-org" });
        const set = await docs.create({ name: "Acme" });
        const loc = (
          await docs.addRecord(set.id, {
            type: "locations",
            name: "Brisbane HQ",
            locationType: "office",
            addressLine1: "1 Queen St",
            city: "Brisbane",
            region: "QLD",
            postalCode: "4000",
            ...C,
          })
        ).record;
        assertEq(formatAddress(loc), "1 Queen St, Brisbane QLD 4000", "address formatted");
        const line = recordDetailLine(loc, await docs.get(set.id));
        assert(line.startsWith("Office"), "detail line leads with the type");
        assert(line.includes("Brisbane"), "detail line includes the address");
      },
    },
    {
      name: "containmentIssues catches a missing parent and a parentage cycle",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-org" });
        const set = await docs.create({ name: "Acme" });
        const a = (await docs.addRecord(set.id, { type: "organizations", name: "A", orgKind: "organization", parentOrgId: "org-nope", ...C })).record;
        const bad = containmentIssues(await docs.get(set.id));
        assert(bad.some((i) => i.code === "missing-parent-org"), "missing parent flagged");

        const b = (await docs.addRecord(set.id, { type: "organizations", name: "B", orgKind: "department", ...C })).record;
        await docs.updateRecord(set.id, { type: "organizations", id: a.id }, { parentOrgId: b.id });
        await docs.updateRecord(set.id, { type: "organizations", id: b.id }, { parentOrgId: a.id });
        const issues = containmentIssues(await docs.get(set.id));
        assert(issues.some((i) => i.code === "org-cycle"), "cycle flagged");
        const integ = await docs.integrity(set.id);
        assert(!integ.ok, "set integrity reports the containment problem");
        assert(integ.issues.some((i) => i.code === "org-cycle"), "integrity unions containment issues");
      },
    },
    {
      name: "organization-* relationship kinds link correctly and refuse the wrong direction",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-org" });
        const set = await docs.create({ name: "Acme" });
        const org = (await docs.addRecord(set.id, { type: "organizations", name: "Head Office", orgKind: "organization", ...C })).record;
        const loc = (await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", ...C })).record;
        const link = await docs.linkRecords(set.id, {
          from: { type: "organizations", id: org.id },
          to: { type: "locations", id: loc.id },
          kind: "organization-location",
        });
        assertEq(link.relationship.kind, "organization-location", "link created");
        // The link is visible from both ends.
        assertEq((await docs.relations(set.id, { type: "organizations", id: org.id })).length, 1, "visible from the org");
        assertEq((await docs.relations(set.id, { type: "locations", id: loc.id })).length, 1, "visible from the location");

        let threw = null;
        try {
          await docs.linkRecords(set.id, {
            from: { type: "locations", id: loc.id },
            to: { type: "organizations", id: org.id },
            kind: "organization-location",
          });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "wrong-direction link refused");
      },
    },
    {
      name: "an organization can be nested under a parent organization",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-org" });
        const set = await docs.create({ name: "Acme" });
        const parent = (await docs.addRecord(set.id, { type: "organizations", name: "Acme Group", orgKind: "organization", ...C })).record;
        const child = (await docs.addRecord(set.id, { type: "organizations", name: "Acme QLD", orgKind: "business-unit", parentOrgId: parent.id, ...C })).record;
        const line = recordDetailLine(child, await docs.get(set.id));
        assert(line.includes("under Acme Group"), "detail line shows the parent");
        const issues = containmentIssues(await docs.get(set.id));
        assertEq(issues.filter((i) => i.level === "error").length, 0, "valid parentage has no issues");
      },
    },
  ]);
}
