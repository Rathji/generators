// src/tests/applications.test.js — validation tests for Phase 3 task 15 (the
// Applications asset). Run in the live page:
//   await import("./src/tests/applications.test.js").then((m) => m.run())
//
// Covers: the application-type catalog covering line-of-business, server,
// cloud, internal, security, remote-access and intranet applications; the
// applications template relating to configurations, contacts, passwords,
// vendors, licensing and documents through the relationship engine; the
// collection-level link validation (a link that breaks the catalog is refused,
// duplicates are refused); the labelled relationship GROUPS the profile shows;
// and link-parameter/candidate computation for those groups.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { relationGroupsFor, groupLinks, relationCandidates, linkParamsFor } from "../framework/assetRelations.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });

async function seed(world) {
  const { docs } = world;
  const set = await docs.create({ name: "Acme" });
  const appType = builtinAssetType("atype-applications");
  const vendorType = builtinAssetType("atype-vendor");
  const licType = builtinAssetType("atype-licences");
  const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme ERP", assetTypeId: appType.id, assetFields: { applicationType: "line-of-business", environment: "production" }, ...CL })).record;
  const vendor = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme Software Ltd", assetTypeId: vendorType.id, assetFields: { vendorType: "software" }, ...CL })).record;
  const licence = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme ERP seats", assetTypeId: licType.id, assetFields: { product: "Acme ERP", licenceType: "subscription", expiryDate: "2026-02-10" }, ...CL })).record;
  const contact = (await docs.addRecord(set.id, { type: "contacts", name: "Jo Bloggs", contactRole: "application-owner", ...CL })).record;
  const config = (await docs.addRecord(set.id, { type: "configurations", name: "APP-01", configType: "server-virtual", ...CL })).record;
  const password = (await docs.addRecord(set.id, { type: "passwords", name: "ERP service account", scope: "general", category: "service-account", ...CL })).record;
  const doc = (await docs.addRecord(set.id, { type: "documents", name: "ERP administrator guide", docType: "reference", ...CL })).record;
  return { set, appType, vendorType, licType, app, vendor, licence, contact, config, password, doc };
}

export async function run() {
  return runTests([
    {
      name: "the applications template models every requested application category",
      fn: () => {
        const type = builtinAssetType("atype-applications");
        assertEq(type.category, "applications", "applications live in the applications category");
        const field = type.fields.find((f) => f.key === "applicationType");
        assert(field && field.required, "application type is required");
        const ids = field.options.map((o) => o.id).sort();
        for (const want of ["cloud", "internal", "intranet", "line-of-business", "remote-access", "security", "server"]) {
          assert(ids.includes(want), "application type covers " + want);
        }
        assert(type.references.includes("configurations"), "may reference configurations");
        assert(type.references.includes("contacts"), "may reference contacts");
        assert(type.references.includes("passwords"), "may reference passwords");
        assert(type.references.includes("flexibleAssets"), "may reference vendors/licences (flexible assets)");
        assert(type.references.includes("documents"), "may reference documents");
      },
    },
    {
      name: "an application relates to configurations, contacts, passwords, vendors, licensing and documents",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-apps" });
        const s = await seed(world);
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.config), kind: "application-server" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.password), kind: "application-password" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.vendor), kind: "application-vendor" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.doc), kind: "application-document" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.contact), to: ref(s.app), kind: "contact-application" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.licence), to: ref(s.app), kind: "licence-application" });

        const rels = await world.docs.relations(s.set.id, ref(s.app));
        assertEq(rels.length, 6, "six relationships touch the application");
        const kinds = rels.map((r) => r.relationship.kind).sort();
        assertEq(kinds.join(","), ["application-document", "application-password", "application-server", "application-vendor", "contact-application", "licence-application"].join(","), "every requested relation kind is present");
        const incoming = rels.filter((r) => r.direction === "in").map((r) => r.relationship.kind).sort();
        assertEq(incoming.join(","), "contact-application,licence-application", "owner and licence attach from their own side, visible from the application");

        const integrity = await world.docs.integrity(s.set.id);
        assert(integrity.ok, "the graph audit passes: " + JSON.stringify(integrity.issues));
      },
    },
    {
      name: "the relationship catalog refuses links that break it, and duplicate links",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-apps" });
        const s = await seed(world);
        let threw = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.contact), kind: "application-server" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "an application→server link to a contact is refused");

        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.config), kind: "application-server" });
        let dup = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.config), kind: "application-server" });
        } catch (e) {
          dup = e;
        }
        assert(dup && dup.code === "INVALID_DATA", "a duplicate link is refused");
        let self = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.app), kind: "application-vendor" });
        } catch (e) {
          self = e;
        }
        assert(self && self.code === "INVALID_DATA", "a self-link is refused");
      },
    },
    {
      name: "the profile groups an application's links into labelled buckets",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-apps" });
        const s = await seed(world);
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.config), kind: "application-server" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.password), kind: "application-password" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.vendor), kind: "application-vendor" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.doc), kind: "application-document" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.contact), to: ref(s.app), kind: "contact-application" });
        await world.docs.linkRecords(s.set.id, { from: ref(s.licence), to: ref(s.app), kind: "licence-application" });

        const set = await world.docs.get(s.set.id, { force: true });
        const grouped = groupLinks(s.app, set, s.appType);
        assertEq(grouped.total, 6, "all six links are accounted for");
        const byId = Object.fromEntries(grouped.groups.map((g) => [g.id, g]));
        assertEq(byId.configurations.links.length, 1, "one configuration");
        assertEq(byId.passwords.links.length, 1, "one credential");
        assertEq(byId.vendor.links.length, 1, "one vendor");
        assertEq(byId.documents.links.length, 1, "one document");
        assertEq(byId.contacts.links.length, 1, "one owner contact");
        assertEq(byId.licence.links.length, 1, "one licence");
        assertEq(byId.licence.direction, "in", "the licence group attaches from the licence side");
        assertEq(grouped.leftovers.length, 0, "no links fall outside the named groups");
        assert(byId.configurations.links[0].other.name === "APP-01", "the far-side record is resolved");
      },
    },
    {
      name: "group link parameters and candidate lists drive the profile's link pickers",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-apps" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });
        const byId = Object.fromEntries(relationGroupsFor(s.appType).map((g) => [g.id, g]));

        const outParams = linkParamsFor(s.app, byId.configurations, s.config);
        assertEq(outParams.from.id, s.app.id, "an out group links from the asset");
        assertEq(outParams.to.id, s.config.id, "…to the candidate");
        assertEq(outParams.kind, "application-server", "…with the group's primary kind");
        const inParams = linkParamsFor(s.app, byId.licence, s.licence);
        assertEq(inParams.from.id, s.licence.id, "an in group links from the candidate");
        assertEq(inParams.to.id, s.app.id, "…to the asset");

        assert(relationCandidates(s.app, set, byId.vendor).some((r) => r.id === s.vendor.id), "an unlinked vendor is offered");
        await world.docs.linkRecords(s.set.id, { from: ref(s.app), to: ref(s.vendor), kind: "application-vendor" });
        const after = await world.docs.get(s.set.id, { force: true });
        assert(!relationCandidates(s.app, after, byId.vendor).some((r) => r.id === s.vendor.id), "a linked vendor drops out of the candidates");
        assert(!relationCandidates(s.app, after, byId.licence).some((r) => r.id === s.app.id), "a group never offers the asset itself");
      },
    },
  ]);
}
