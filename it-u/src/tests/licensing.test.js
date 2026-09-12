// src/tests/licensing.test.js — validation tests for Phase 3 task 16 (vendors,
// licensing & subscriptions). Run in the live page:
//   await import("./src/tests/licensing.test.js").then((m) => m.run())
//
// Covers: the vendor and licensing templates (licence types, billing cycle,
// expiry field flagged for alerting, a per-record alert window); the renewals
// engine — finding the expiry field, classifying overdue / due-soon / upcoming
// / ok against the alert window, per-record and per-call overrides; the
// renewals report (counts, soonest-first attention); and linking a licence to
// its applications, vendor and contacts, grouped for the profile.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { expiryFieldOf, renewalStatus, renewalsReport, renewalPhrase, DEFAULT_ALERT_DAYS } from "../framework/renewals.js";
import { groupLinks, relationGroupsFor } from "../framework/assetRelations.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });
const NOW = new Date(2026, 0, 15, 9, 0, 0).getTime();

export async function run() {
  return runTests([
    {
      name: "the vendor and licensing templates model suppliers, licence types and a flagged renewal date",
      fn: () => {
        const vendor = builtinAssetType("atype-vendor");
        assertEq(vendor.category, "commercial", "vendors are commercial");
        const vt = vendor.fields.find((f) => f.key === "vendorType" && f.required);
        assert(vt, "vendor type is required");
        for (const want of ["hardware", "software", "isp-carrier", "voice", "security", "services"]) {
          assert(vt.options.some((o) => o.id === want), "vendor types include " + want);
        }
        assert(vendor.fields.some((f) => f.key === "accountNumber"), "vendors record an account number");
        assert(vendor.fields.some((f) => f.key === "supportEmail" && f.type === "email"), "vendors record a support email");

        const lic = builtinAssetType("atype-licences");
        assertEq(lic.category, "commercial", "licensing is commercial");
        const lt = lic.fields.find((f) => f.key === "licenceType" && f.required);
        for (const want of ["perpetual", "subscription", "saas", "volume", "oem", "open-source"]) {
          assert(lt.options.some((o) => o.id === want), "licence types include " + want);
        }
        assert(lic.fields.find((f) => f.key === "expiryDate").expiry === true, "the renewal date is flagged for alerting");
        assert(lic.fields.some((f) => f.key === "billingCycle"), "a billing cycle is recorded");
        assert(lic.fields.some((f) => f.key === "renewalAlertDays"), "a per-record alert window is available");
      },
    },
    {
      name: "the renewals engine finds each template's expiry field",
      fn: () => {
        assertEq(expiryFieldOf(builtinAssetType("atype-licences")).key, "expiryDate", "licences expire by expiryDate");
        assertEq(expiryFieldOf(builtinAssetType("atype-security-platform")).key, "expiryDate", "security platforms expire by expiryDate");
        assertEq(expiryFieldOf(builtinAssetType("atype-wan-circuit")).key, "contractEndDate", "circuits expire by contract end");
        assertEq(expiryFieldOf(builtinAssetType("atype-vendor")), null, "vendors have no expiry date");
        assertEq(expiryFieldOf(builtinAssetType("atype-applications")), null, "applications have no expiry date");
        assertEq(expiryFieldOf(null), null, "no template, no expiry field");
      },
    },
    {
      name: "each record's renewal is classified overdue / due-soon / upcoming / ok against its alert window",
      fn: () => {
        const lic = builtinAssetType("atype-licences");
        const at = (expiryDate, extra = {}) => renewalStatus({ assetFields: { expiryDate, ...extra } }, lic, { now: NOW });
        assertEq(at("2025-12-01").state, "overdue", "a past date is overdue");
        assert(at("2025-12-01").daysUntil < 0, "overdue has a negative day count");
        assertEq(at("2026-01-20").state, "due-soon", "within a fortnight is due soon");
        assertEq(at("2026-02-10").state, "upcoming", "inside the alert window is upcoming");
        assertEq(at("2027-01-01").state, "ok", "beyond the window is ok");
        assertEq(at("").state, "none", "no date is none");
        assertEq(at("2026-01-20").daysUntil, 5, "day count is from the start of today");
        assertEq(at("2026-02-10").alert, DEFAULT_ALERT_DAYS, "the default alert window is 60 days");

        assertEq(renewalStatus({ assetFields: { expiryDate: "2026-01-20" } }, lic, { now: NOW, alertDays: 3 }).state, "ok", "a tighter per-call window changes the verdict");
        assertEq(at("2026-02-10", { renewalAlertDays: 30 }).state, "upcoming", "a per-record window widens the warning");
        assertEq(at("2026-02-10").iso, "2026-02-10", "the ISO date is echoed back");
      },
    },
    {
      name: "the renewals report counts states and lists what needs attention soonest-first",
      fn: () => {
        const lic = builtinAssetType("atype-licences");
        const vendor = builtinAssetType("atype-vendor");
        const entry = (name, assetTypeId, expiryDate) => ({ setId: "docset-a", setName: "Acme", record: { id: "fx_" + name, name, assetTypeId, assetFields: expiryDate ? { expiryDate } : {} } });
        const entries = [
          entry("Overdue licence", lic.id, "2025-11-01"),
          entry("Due soon licence", lic.id, "2026-01-20"),
          entry("Upcoming licence", lic.id, "2026-02-10"),
          entry("Far-off licence", lic.id, "2027-06-01"),
          { setId: "docset-b", setName: "Beta", record: { id: "fx_vendor", name: "A vendor", assetTypeId: vendor.id, assetFields: {} } },
        ];
        const typeById = new Map([[lic.id, lic], [vendor.id, vendor]]);
        const report = renewalsReport(entries, (r) => typeById.get(r.assetTypeId) || null, { now: NOW });
        assertEq(report.total, 5, "every entry is accounted for");
        assertEq(report.counts.overdue, 1, "one overdue");
        assertEq(report.counts["due-soon"], 1, "one due soon");
        assertEq(report.counts.upcoming, 1, "one upcoming");
        assertEq(report.counts.ok, 1, "one ok");
        assertEq(report.counts.none, 1, "one with no date");
        assertEq(report.counts.tracked, 4, "four have a date to track");
        assertEq(report.attention.length, 3, "only the urgent three are surfaced");
        assertEq(report.attention[0].record.name, "Overdue licence", "soonest / most urgent first");
        assertEq(report.attention[1].record.name, "Due soon licence", "then due-soon");
        assertEq(report.attention[2].record.name, "Upcoming licence", "then upcoming");
        assertEq(renewalsReport(entries, (r) => typeById.get(r.assetTypeId) || null, { now: NOW, includeOk: true }).attention.length, 4, "ok can be included on request");

        assertEq(renewalPhrase({ daysUntil: 0 }), "today", "today phrase");
        assertEq(renewalPhrase({ daysUntil: 1 }), "in 1 day", "singular future phrase");
        assertEq(renewalPhrase({ daysUntil: -3 }), "3 days ago", "past phrase");
        assertEq(renewalPhrase({ daysUntil: null }), "no date", "missing phrase");
      },
    },
    {
      name: "a licence links to its applications, vendor and contacts, grouped for the profile",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-lic" });
        const set = await world.docs.create({ name: "Acme" });
        const licType = builtinAssetType("atype-licences");
        const appType = builtinAssetType("atype-applications");
        const vendorType = builtinAssetType("atype-vendor");
        const licence = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "M365 E3", assetTypeId: licType.id, assetFields: { product: "Microsoft 365 E3", licenceType: "subscription", quantity: 40, expiryDate: "2026-02-10" }, ...CL })).record;
        const app = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Microsoft 365", assetTypeId: appType.id, assetFields: { applicationType: "cloud" }, ...CL })).record;
        const vendor = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Microsoft Partner", assetTypeId: vendorType.id, assetFields: { vendorType: "software" }, ...CL })).record;
        const contact = (await world.docs.addRecord(set.id, { type: "contacts", name: "Sam Lee", contactRole: "vendor-rep", ...CL })).record;

        await world.docs.linkRecords(set.id, { from: ref(licence), to: ref(app), kind: "licence-application" });
        await world.docs.linkRecords(set.id, { from: ref(licence), to: ref(vendor), kind: "licence-vendor" });
        await world.docs.linkRecords(set.id, { from: ref(contact), to: ref(licence), kind: "contact-licence" });

        const integrity = await world.docs.integrity(set.id);
        assert(integrity.ok, "the licence graph audit passes: " + JSON.stringify(integrity.issues));

        const live = await world.docs.get(set.id, { force: true });
        const grouped = groupLinks(licence, live, licType);
        const byId = Object.fromEntries(grouped.groups.map((g) => [g.id, g]));
        assertEq(byId.applications.links.length, 1, "one covered application");
        assertEq(byId.vendor.links.length, 1, "one vendor");
        assertEq(byId.contacts.links.length, 1, "one account contact");
        assertEq(grouped.total, 3, "all three licence links are grouped");
        assert(relationGroupsFor(licType).some((g) => g.collections.includes("documents")), "licences also offer a documents group");

        const status = renewalStatus(licence, licType, { now: NOW });
        assertEq(status.iso, "2026-02-10", "the licence's renewal date is tracked");
        assertEq(status.state, "upcoming", "26 days out is upcoming");
      },
    },
  ]);
}
