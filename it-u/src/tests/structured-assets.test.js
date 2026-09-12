// src/tests/structured-assets.test.js — validation tests for Phase 3 task 14
// (custom structured assets: user roles, software builds & structured-first
// guidance). Run in the live page:
//   await import("./src/tests/structured-assets.test.js").then((m) => m.run())
//
// Covers: the workforce catalogs (workstation tiers, operating systems); the
// two new shipped templates and the enriched rich-asset templates (all valid);
// the structured-vs-document guidance and the free-text template suggester; the
// library version upgrade (adds missing shipped templates + refreshes
// un-customised ones, preserves custom types and customisations); and the
// relation-group mapping with its generic fallback.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { createMemoryCache } from "../framework/store/backends.js";
import { createFlexibleTypeService, LIBRARY_DOC } from "../framework/flexibleTypes.js";
import { BUILTIN_ASSET_TYPES, builtinAssetType, BUILTIN_ASSET_TYPE_IDS } from "../framework/assetLibrary.js";
import { ASSET_CATEGORIES, ASSET_LIBRARY_VERSION, assetCategory, makeAssetType, validateAssetType, validateAssetRecord } from "../framework/flexible.js";
import { WORKSTATION_TIERS, WORKSTATION_TIER_IDS, OPERATING_SYSTEMS, OPERATING_SYSTEM_IDS, workstationTier, operatingSystem, tierOptions, osOptions } from "../framework/workforce.js";
import { STRUCTURED_GUIDANCE, suggestAssetTypes } from "../framework/guidance.js";
import { relationGroupsFor, groupLinks, relationCandidates, linkParamsFor, RELATION_GROUPS } from "../framework/assetRelations.js";



export async function run() {
  return runTests([
    {
      name: "the workforce catalogs expose workstation tiers and operating systems",
      fn: () => {
        assert(WORKSTATION_TIERS.length >= 6, "the workstation-tier catalog is populated");
        assertEq(new Set(WORKSTATION_TIER_IDS).size, WORKSTATION_TIERS.length, "tier ids are unique");
        assertEq(workstationTier("power").label, "Power / high-spec", "tier lookup");
        assertEq(workstationTier("bogus"), null, "unknown tier is null");
        assert(WORKSTATION_TIER_IDS.includes("thin-client"), "thin client is a tier");
        assert(OPERATING_SYSTEMS.length >= 5, "the OS catalog is populated");
        assertEq(operatingSystem("windows-11").label, "Windows 11", "OS lookup");
        assertEq(operatingSystem("bogus"), null, "unknown OS is null");
        assertEq(tierOptions().length, WORKSTATION_TIERS.length, "tier options mirror the catalog");
        assertEq(osOptions().length, OPERATING_SYSTEMS.length, "OS options mirror the catalog");
        assert(tierOptions().every((o) => o.id && o.label), "tier options are well formed");
      },
    },
    {
      name: "the workforce and enriched rich-asset templates ship, validate, and carry the right fields",
      fn: () => {
        assert(assetCategory("workforce"), "the workforce category exists");
        assert(ASSET_CATEGORIES.length >= 7, "the category list grew for workforce");
        assert(BUILTIN_ASSET_TYPE_IDS.includes("atype-user-role"), "user role template shipped");
        assert(BUILTIN_ASSET_TYPE_IDS.includes("atype-software-build"), "software build template shipped");

        const role = builtinAssetType("atype-user-role");
        assertEq(role.category, "workforce", "role is workforce");
        assert(validateAssetType(role).ok, "the role template validates");
        assert(role.fields.some((f) => f.key === "roleClassification" && f.required), "role requires a classification");
        assert(role.fields.some((f) => f.key === "typicalTasks" && f.type === "textarea"), "role captures typical tasks");
        const tierField = role.fields.find((f) => f.key === "typicalWorkstationTier");
        assert(tierField && tierField.type === "select" && tierField.options.length === WORKSTATION_TIERS.length, "role references the shared tier catalog");

        const build = builtinAssetType("atype-software-build");
        assertEq(build.category, "workforce", "build is workforce");
        assert(validateAssetType(build).ok, "the build template validates");
        const os = build.fields.find((f) => f.key === "supportedOs");
        assert(os && os.type === "multiselect" && os.required && os.options.length === OPERATING_SYSTEMS.length, "build supports the shared OS catalog");

        const apps = builtinAssetType("atype-applications");
        assert(validateAssetType(apps).ok, "applications still validates");
        assert(apps.fields.some((f) => f.key === "environment"), "applications gained an environment field");
        assert(apps.fields.some((f) => f.key === "supportUrl" && f.type === "url"), "applications gained a support URL");
        assert(apps.fields.some((f) => f.key === "vendorRecord" && f.type === "record" && f.of === "flexibleAssets"), "applications can point at a vendor record");

        const lic = builtinAssetType("atype-licences");
        assert(validateAssetType(lic).ok, "licensing still validates");
        assert(lic.fields.find((f) => f.key === "expiryDate").expiry === true, "the licence expiry date is flagged");
        assert(lic.fields.some((f) => f.key === "renewalAlertDays"), "licensing can override the alert window");
        assert(lic.fields.some((f) => f.key === "billingCycle" && f.type === "select"), "licensing records a billing cycle");

        assert(builtinAssetType("atype-security-platform").fields.find((f) => f.key === "expiryDate").expiry === true, "security renewal is flagged");
        assert(builtinAssetType("atype-wan-circuit").fields.find((f) => f.key === "contractEndDate").expiry === true, "circuit contract end is flagged");

        const vendor = builtinAssetType("atype-vendor");
        assert(vendor.fields.some((f) => f.key === "supportEmail" && f.type === "email"), "vendor gained a support email");
        assert(vendor.fields.some((f) => f.key === "website" && f.type === "url"), "vendor gained a website");

        assert(BUILTIN_ASSET_TYPES.every((t) => validateAssetType(t).ok), "every shipped template validates");
        assert(BUILTIN_ASSET_TYPES.every((t) => assetCategory(t.category)), "every shipped template uses a known category");
      },
    },
    {
      name: "guidance separates structure from documents and the suggester maps free text to templates",
      fn: () => {
        assert(STRUCTURED_GUIDANCE.structured.length >= 3, "structured guidance is populated");
        assert(STRUCTURED_GUIDANCE.documents.length >= 3, "document guidance is populated");
        assert(STRUCTURED_GUIDANCE.structured.every((g) => g.title && g.detail), "guidance items are complete");

        const suggester = (q) => suggestAssetTypes(q, BUILTIN_ASSET_TYPES, { limit: 5 }).map((s) => s.type.id);
        assert(suggester("we need to renew the M365 licences and seats").includes("atype-licences"), "licence query finds licensing");
        assert(suggester("the warehouse wifi access points").includes("atype-wireless"), "wifi query finds the wireless record");
        assert(suggester("the head office lan subnets and vlans").includes("atype-lan"), "lan query finds the LAN record");
        assert(suggester("the fibre internet circuit from our isp").includes("atype-wan-service"), "internet query finds the WAN service");
        assert(suggester("the accountant laptop build").includes("atype-software-build"), "build query finds software builds");
        assert(suggester("who has access — the finance user role").includes("atype-user-role"), "role query finds user roles");
        assert(suggester("our new phone system and sip trunk").includes("atype-voice-pbx"), "voice query finds the voice platform");

        assertEq(suggester("").length, 0, "an empty query suggests nothing");
        assertEq(suggester("zzzz nothing relevant").length, 0, "an unmatched query suggests nothing");
        assert(suggestAssetTypes("licences", BUILTIN_ASSET_TYPES, { limit: 1 }).length <= 1, "limit is respected");
        assertEq(suggestAssetTypes("licences", [], {}).length, 0, "only templates that exist are suggested");
      },
    },
    {
      name: "loading an older library upgrades it: adds missing shipped templates, refreshes un-customised ones, preserves custom work",
      fn: async () => {
        const { store } = makeWorld({ namespace: "kb-struct", assetTypes: true });
        const appShips = builtinAssetType("atype-applications");
        const customizedApps = { ...appShips, name: "Apps (ours)", customized: true, fields: [...appShips.fields, { key: "house", label: "House approval", type: "text" }] };
        const staleLicences = { ...builtinAssetType("atype-licences"), name: "Licensing", customized: false, fields: [{ key: "product", label: "Product", type: "text", required: true }] };
        const custom = makeAssetType({ name: "House Widget", category: "custom", fields: [{ label: "Serial", type: "text" }], createdBy: "tester" });
        await store.writeDocument(LIBRARY_DOC, { schema: "itu-flexible-types/1", version: 1, types: [customizedApps, staleLicences, custom] });

        const assetTypes = createFlexibleTypeService({ store, cache: createMemoryCache() });
        const types = await assetTypes.list();
        const ids = types.map((t) => t.id);
        assert(ids.includes("atype-user-role"), "a missing shipped template was added");
        assert(ids.includes("atype-virtualization"), "another missing shipped template was added");
        assert(ids.includes(custom.id), "a custom type is preserved");
        assert(ids.includes("atype-applications"), "the customised builtin stays");

        const apps = await assetTypes.get("atype-applications");
        assertEq(apps.name, "Apps (ours)", "a customised builtin keeps its name");
        assertEq(apps.customized, true, "a customised builtin keeps its flag");
        assert(apps.fields.some((f) => f.key === "house"), "a customised builtin keeps its extra field");

        const lic = await assetTypes.get("atype-licences");
        assertEq(lic.customized, false, "the un-customised builtin is refreshed");
        assert(lic.fields.length > 1, "the refreshed builtin gained the shipped fields");
        assert(lic.fields.some((f) => f.key === "renewalAlertDays"), "the refreshed builtin has the latest fields");
        assert(lic.fields.find((f) => f.key === "expiryDate").expiry === true, "the refreshed builtin carries the expiry flag");

        const meta = await assetTypes.libraryMeta();
        assertEq(meta.version, ASSET_LIBRARY_VERSION, "the library is stamped with the shipped version");
        assertEq(meta.customCount, 1, "the custom type is counted");

        const before = (await assetTypes.list()).length;
        await assetTypes.list();
        assertEq((await assetTypes.list()).length, before, "the upgrade is idempotent");
      },
    },
    {
      name: "every rich template maps to labelled relationship groups, with a generic fallback for the rest",
      fn: () => {
        const appGroups = relationGroupsFor(builtinAssetType("atype-applications"));
        assert(appGroups.length >= 5, "applications have several labelled groups");
        assert(appGroups.some((g) => g.kinds.includes("application-server") && g.collections.includes("configurations")), "applications group their configurations");
        const licenceGroup = appGroups.find((g) => g.kinds.includes("licence-application"));
        assertEq(licenceGroup.direction, "in", "licensing attaches from the licence side");
        assertEq(licenceGroup.filterTypes.join(","), "atype-licences", "the licence group filters to the licensing template");
        assert(appGroups.some((g) => g.collections.includes("documents")), "applications group their documents");

        const roleGroups = relationGroupsFor(builtinAssetType("atype-user-role"));
        assert(roleGroups.some((g) => g.kinds.includes("role-member") && g.collections.includes("contacts")), "roles group their members");
        assert(roleGroups.some((g) => g.kinds.includes("role-build")), "roles group their builds");

        const custom = makeAssetType({ name: "Widget", category: "custom", references: ["configurations", "contacts"], fields: [{ label: "X", type: "text" }] });
        const generic = relationGroupsFor(custom);
        assertEq(generic.length, 2, "a template without named groups gets one per reference");
        assert(generic.every((g) => g.generic && g.kinds[0] === "asset-reference" && g.direction === "out"), "the fallback uses the generic asset-reference kind");
        assert(generic.some((g) => g.collections[0] === "configurations" && g.collections[0] === "configurations"), "the fallback covers configurations");
        assertEq(RELATION_GROUPS["atype-applications"].length, relationGroupsFor(builtinAssetType("atype-applications")).length, "named groups come straight from the catalog");
      },
    },
  ]);
}
