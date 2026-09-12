// src/tests/contact.test.js — validation tests for Phase 2 task 8
// (contacts & responsibility mapping). Run in the live page:
//   await import("./src/tests/contact.test.js").then((m) => m.run())
//
// Covers: the contact-role catalog (client, responsibility, vendor, provider
// roles); the standardized-field rule that a contact must declare a role; the
// contact display line; the responsibility-mapping relationship kinds
// (contact → application / site / vendor / configuration / organization)
// accepting the correct direction and refusing the wrong one, and being visible
// from both ends; and the contact integrity audit (unknown role, dangling
// organization reference).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { CONTACT_ROLES, CONTACT_METHODS, contactRole, contactDetailLine, contactIssues } from "../framework/contact.js";
import { validateRecordFields } from "../framework/standardized.js";
import { relationshipKind } from "../framework/relationships.js";

const C = { informationModel: "core-asset", provenance: "authored" };

export async function run() {
  return runTests([
    {
      name: "the contact-role catalog covers client, responsibility, vendor and provider roles",
      fn: () => {
        for (const id of ["client-primary", "client-technical", "application-owner", "site-manager", "vendor-rep", "vendor-support", "isp-carrier", "support-desk", "escalation"]) {
          assert(CONTACT_ROLES.some((r) => r.id === id), "role " + id);
        }
        assertEq(contactRole("application-owner").label, "Application owner", "role lookup");
        assert(contactRole("application-owner").responsibility.includes("Applications"), "role declares its responsibility");
        assert(CONTACT_METHODS.some((m) => m.id === "email"), "contact methods catalog");
      },
    },
    {
      name: "a contact must declare a role (standardized-field rule) — on add and edit",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-contacts" });
        const set = await docs.create({ name: "Acme" });
        assert(!validateRecordFields("contacts", { name: "Jo" }).ok, "role-less contact refused by the validator");
        let threw = null;
        try {
          await docs.addRecord(set.id, { type: "contacts", name: "Jo", ...C });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "unroled contact refused by the service");
        const con = (await docs.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C })).record;
        assertEq(con.contactRole, "client-primary", "role stored");
        threw = null;
        try {
          await docs.updateRecord(set.id, { type: "contacts", id: con.id }, { contactRole: "" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "blanking the role on edit refused");
      },
    },
    {
      name: "contactDetailLine leads with the role, then organization, then a way to reach them",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-contacts" });
        const set = await docs.create({ name: "Acme" });
        const org = (await docs.addRecord(set.id, { type: "organizations", name: "Acme Pty", orgKind: "organization", ...C })).record;
        const con = (
          await docs.addRecord(set.id, {
            type: "contacts",
            name: "Jane Doe",
            contactRole: "client-technical",
            organizationId: org.id,
            email: "jane@acme.example",
            ...C,
          })
        ).record;
        const line = contactDetailLine(con, await docs.get(set.id));
        assert(line.startsWith("Client technical contact"), "leads with the role");
        assert(line.includes("Acme Pty"), "includes the organization");
        assert(line.includes("jane@acme.example"), "includes the reach method");
      },
    },
    {
      name: "responsibility mapping links a contact to what it is responsible for (both directions)",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-contacts" });
        const set = await docs.create({ name: "Acme" });
        const con = (await docs.addRecord(set.id, { type: "contacts", name: "Jane", contactRole: "application-owner", ...C })).record;
        const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Billing App", assetTypeId: "atype-applications", ...C })).record;
        const site = (await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", ...C })).record;
        const vendor = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Dell", assetTypeId: "atype-vendor", ...C })).record;
        await docs.linkRecords(set.id, { from: { type: "contacts", id: con.id }, to: { type: "flexibleAssets", id: app.id }, kind: "contact-application" });
        await docs.linkRecords(set.id, { from: { type: "contacts", id: con.id }, to: { type: "locations", id: site.id }, kind: "contact-site" });
        await docs.linkRecords(set.id, { from: { type: "contacts", id: con.id }, to: { type: "flexibleAssets", id: vendor.id }, kind: "contact-vendor" });
        assertEq((await docs.relations(set.id, { type: "contacts", id: con.id })).length, 3, "contact sees all three links");
        assertEq((await docs.relations(set.id, { type: "flexibleAssets", id: app.id })).length, 1, "the application sees its owner link");
        assert(relationshipKind("contact-vendor"), "contact-vendor kind exists");

        let threw = null;
        try {
          await docs.linkRecords(set.id, { from: { type: "locations", id: site.id }, to: { type: "contacts", id: con.id }, kind: "contact-site" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "wrong-direction responsibility link refused");
      },
    },
    {
      name: "the contact integrity audit flags an unknown role and a dangling organization reference",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-contacts" });
        const set = await docs.create({ name: "Acme" });
        const con = (await docs.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C })).record;
        // Corrupt the record directly to simulate imported/legacy data.
        const live = await docs.get(set.id);
        live.records.contacts[0].contactRole = "made-up";
        live.records.contacts[0].organizationId = "org-nope";
        const issues = contactIssues(live);
        assert(issues.some((i) => i.code === "unknown-contact-role"), "unknown role flagged");
        assert(issues.some((i) => i.code === "missing-contact-org"), "dangling organization flagged");
        const integ = await docs.integrity(set.id);
        assert(!integ.ok, "set integrity reports the contact problems");
        assert(integ.issues.some((i) => i.recordId === con.id), "the issues name the record");
      },
    },
  ]);
}
