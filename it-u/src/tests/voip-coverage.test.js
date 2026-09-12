// src/tests/voip-coverage.test.js — validation tests for Phase 9 task 39 (VoIP
// relationship & lifecycle coverage). Run in the live page:
//   await import("./src/tests/voip-coverage.test.js").then((m) => m.run())
//
// Covers: the coverage catalog (groups, levels, linter codes); the relationship
// coverage evaluation (typed links AND record-field references, direction,
// template filters); the lifecycle coverage (number/port date, support
// entitlement, subscription expiry) and the new `number-port` lifecycle kind
// surfaced through extractLifecycleItems; the combined deployment report; the
// Linter audit (voipCoverageIssues) folded into standardizedIssues without
// duplicating the codes voice.js already emits; and the summary line.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { VOICE_PBX_TYPE_ID } from "../framework/voice.js";
import { LIFECYCLE_KINDS, lifecycleKind, extractLifecycleItems } from "../framework/lifecycle.js";
import {
  VOIP_COVERAGE_GROUPS,
  VOIP_COVERAGE_REQUIREMENTS,
  voipCoverageRequirement,
  requirementsOfGroup,
  voipRequirementRecords,
  voipRelationshipCoverage,
  voipLifecycleCoverage,
  voipLifecycleItems,
  voipDeploymentCoverage,
  voipCoverageLine,
  voipCoverageIssues,
} from "../framework/voipCoverage.js";
import { standardizedIssues } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });
const codes = (issues) => issues.map((i) => i.code);

async function seed(world, voiceFields = {}) {
  const { docs } = world;
  const set = await docs.create({ name: "Acme" });
  const fx = (id) => builtinAssetType(id);
  const voice = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "Head office voice",
    assetTypeId: VOICE_PBX_TYPE_ID,
    assetFields: {
      platformType: "3cx",
      deploymentModel: "cloud",
      numberInventory: "02 5550 1000 main\n1300 555 000 support",
      portingStatus: "ported",
      portDate: "2024-01-15",
      emergencyService: "e911",
      ...voiceFields,
    },
    ...CL,
  })).record;
  const circuit = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Fibre 500", assetTypeId: fx("atype-wan-circuit").id, assetFields: { carrier: "Telstra", circuitType: "fibre" }, ...CL })).record;
  const pbxHost = (await docs.addRecord(set.id, { type: "configurations", name: "PBX-VM-01", configType: "server-virtual", supportExpiryDate: "2026-06-30", ...CL })).record;
  const sbc = (await docs.addRecord(set.id, { type: "configurations", name: "EDGE-FW-01", configType: "firewall", ...CL })).record;
  const security = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Perimeter security", assetTypeId: fx("atype-security-platform").id, assetFields: { platformType: "firewall" }, ...CL })).record;
  const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "3CX Management Console", assetTypeId: fx("atype-applications").id, assetFields: { applicationType: "server" }, ...CL })).record;
  const vendor = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "3CX", assetTypeId: fx("atype-vendor").id, assetFields: { vendorType: "voice" }, ...CL })).record;
  const licence = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "3CX 32SC licence", assetTypeId: fx("atype-licences").id, assetFields: { licenceType: "subscription", expiryDate: "2026-03-01" }, ...CL })).record;
  const password = (await docs.addRecord(set.id, { type: "passwords", name: "PBX admin console", scope: "embedded", embeddedIn: ref(pbxHost), category: "voip", ...CL })).record;
  const document = (await docs.addRecord(set.id, { type: "documents", name: "Dial plan", docType: "deployment", body: "# Dial plan", ...CL })).record;
  const checklist = (await docs.addRecord(set.id, { type: "checklists", name: "Voice cut-over", items: [], ...CL })).record;
  const contact = (await docs.addRecord(set.id, { type: "contacts", name: "Priya Nair", contactRole: "application-owner", ...CL })).record;
  return { set, voice, circuit, pbxHost, sbc, security, app, vendor, licence, password, document, checklist, contact };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.voice, s.circuit, "voice-circuit");
  await link(s.voice, s.pbxHost, "voice-configuration");
  await link(s.voice, s.sbc, "voice-sbc");
  await link(s.voice, s.security, "voice-security");
  await link(s.voice, s.app, "voice-application");
  await link(s.voice, s.vendor, "voice-vendor");
  await link(s.voice, s.password, "voice-password");
  await link(s.voice, s.document, "voice-document");
  await link(s.voice, s.checklist, "voice-checklist");
  await link(s.licence, s.voice, "licence-application");
  await link(s.contact, s.voice, "contact-voice");
}

const byId = (coverage) => Object.fromEntries(coverage.requirements.map((r) => [r.id, r]));

export async function run() {
  return runTests([
    {
      name: "the coverage catalog declares the relationship and lifecycle requirements with distinct linter codes",
      fn: () => {
        assertEq(VOIP_COVERAGE_GROUPS.map((g) => g.id).join(","), "relationships,lifecycle", "two coverage groups");
        assert(VOIP_COVERAGE_GROUPS.every((g) => g.label && g.description), "every group is described");
        assertEq(requirementsOfGroup("relationships").length + requirementsOfGroup("lifecycle").length, VOIP_COVERAGE_REQUIREMENTS.length, "the groups partition the catalog");
        assert(VOIP_COVERAGE_REQUIREMENTS.every((r) => r.id && r.label && ["required", "recommended"].includes(r.level) && r.fix), "every requirement is well formed");

        // The task-39 relationships.
        for (const id of ["endpoints", "credentials", "circuit", "security", "licensing", "vendor", "application", "documents", "checklists", "contacts"]) {
          assert(voipCoverageRequirement(id), "declares the " + id + " relationship requirement");
        }
        for (const id of ["number-port", "support-entitlement", "subscription-expiry"]) {
          assert(voipCoverageRequirement(id), "declares the " + id + " lifecycle requirement");
          assertEq(voipCoverageRequirement(id).group, "lifecycle", id + " is a lifecycle requirement");
        }
        // Linter codes are distinct from the ones voice.js owns, so nothing is double-reported.
        const codes = VOIP_COVERAGE_REQUIREMENTS.map((r) => r.linterCode).filter(Boolean);
        assertEq(new Set(codes).size, codes.length, "linter codes are unique");
        for (const forbidden of ["voip-no-circuit", "voip-no-security", "voip-no-credential", "voice-no-circuit", "voice-no-security"]) {
          assert(!codes.includes(forbidden), "does not re-report " + forbidden);
        }
        assert(voipCoverageRequirement("bogus") === null, "an unknown requirement is null");
      },
    },
    {
      name: "voipRequirementRecords resolves typed links and record-field references",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voipcov" });
        const s = await seed(world);
        let set = await world.docs.get(s.set.id, { force: true });
        const endpoints = voipCoverageRequirement("endpoints");

        // Nothing linked yet.
        assertEq(voipRequirementRecords(s.voice, set, endpoints).length, 0, "no configurations are linked initially");

        await world.docs.linkRecords(s.set.id, { from: ref(s.voice), to: ref(s.pbxHost), kind: "voice-configuration" });
        set = await world.docs.get(s.set.id, { force: true });
        const linked = voipRequirementRecords(s.voice, set, endpoints);
        assertEq(linked.length, 1, "the linked configuration is found");
        assertEq(linked[0].id, s.pbxHost.id, "…and it is the PBX host");

        // A field reference also satisfies it.
        const viaField = { ...s.voice, assetFields: { ...s.voice.assetFields, sbcRecord: s.sbc.id } };
        assert(voipRequirementRecords(viaField, set, endpoints).some((r) => r.id === s.sbc.id), "a record-field reference satisfies the requirement too");

        // Template filter keeps a non-vendor out of the vendor requirement.
        const vendor = voipCoverageRequirement("vendor");
        assertEq(voipRequirementRecords(s.voice, set, vendor).length, 0, "the application does not satisfy the vendor requirement");
        await world.docs.linkRecords(s.set.id, { from: ref(s.voice), to: ref(s.vendor), kind: "voice-vendor" });
        set = await world.docs.get(s.set.id, { force: true });
        assertEq(voipRequirementRecords(s.voice, set, vendor).length, 1, "the vendor satisfies the vendor requirement");

        // Direction: a licence-application link is incoming from the voice platform.
        await world.docs.linkRecords(s.set.id, { from: ref(s.licence), to: ref(s.voice), kind: "licence-application" });
        set = await world.docs.get(s.set.id, { force: true });
        assertEq(voipRequirementRecords(s.voice, set, voipCoverageRequirement("licensing")).length, 1, "the incoming licence link is resolved");
      },
    },
    {
      name: "voipRelationshipCoverage reports each requirement, and a fully linked platform satisfies them all",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voipcov" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const cov = voipRelationshipCoverage(s.voice, set);
        assertEq(cov.total, requirementsOfGroup("relationships").length, "every relationship requirement is covered");
        assert(cov.requirements.every((r) => r.met), "a fully linked platform meets every relationship" + JSON.stringify(cov.requirements.filter((r) => !r.met)));
        assertEq(cov.requiredMet, cov.requiredTotal, "every required relationship is met");
        assert(cov.complete, "the relationship coverage is complete");
        const creds = byId(cov).credentials;
        assert(creds.detail.includes("embedded"), "the credential detail names how the credential is scoped");

        // A bare platform fails every required relationship.
        const bare = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Untested voice", assetTypeId: VOICE_PBX_TYPE_ID, assetFields: {}, ...CL })).record;
        const set2 = await world.docs.get(s.set.id, { force: true });
        const bareCov = voipRelationshipCoverage(bare, set2);
        assertEq(bareCov.requiredMet, 0, "a bare platform meets no required relationship");
        assert(!bareCov.complete, "a bare platform is incomplete");
        assert(bareCov.requirements.every((r) => !r.met), "nothing is met on a bare platform");
      },
    },
    {
      name: "voipLifecycleCoverage tracks the number port, support entitlement and subscription expiry",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voipcov" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const life = voipLifecycleCoverage(s.voice, set);
        assert(life.complete, "the fully linked deployment is lifecycle-covered: " + JSON.stringify(life.requirements));
        const reqs = byId(life);
        assert(reqs["number-port"].met && reqs["number-port"].detail.includes("2024-01-15"), "the port date is recorded");
        assert(reqs["support-entitlement"].met && reqs["support-entitlement"].detail.includes("PBX-VM-01"), "the support entitlement is found on the PBX host");
        assert(reqs["subscription-expiry"].met && reqs["subscription-expiry"].detail.includes("3CX 32SC"), "the licence expiry is found");

        // No port date but porting "not required" counts as covered.
        const nr = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "No-port voice", assetTypeId: VOICE_PBX_TYPE_ID, assetFields: { portingStatus: "not-required" }, ...CL })).record;
        const set3 = await world.docs.get(s.set.id, { force: true });
        assert(byId(voipLifecycleCoverage(nr, set3))["number-port"].met, "an explicit “not required” port is covered");

        // In-flight porting with no date and no support/lifecycle dates is not.
        const bare = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Bare voice", assetTypeId: VOICE_PBX_TYPE_ID, assetFields: { portingStatus: "in-progress" }, ...CL })).record;
        const set4 = await world.docs.get(s.set.id, { force: true });
        const bareLife = voipLifecycleCoverage(bare, set4);
        assert(!bareLife.complete, "an in-flight port with no date is incomplete");
        assert(!byId(bareLife)["number-port"].met, "the number port is not covered");
        assert(!byId(bareLife)["support-entitlement"].met, "no support entitlement is covered");
        assert(!byId(bareLife)["subscription-expiry"].met, "no subscription expiry is covered");
      },
    },
    {
      name: "the number-port lifecycle kind surfaces a voice asset's port date to the trackers",
      fn: async () => {
        assert(lifecycleKind("number-port"), "the number-port kind is catalogued");
        assertEq(lifecycleKind("number-port").group, "Voice & numbering", "it has its own group");
        assertEq(lifecycleKind("number-port").dynamic, "voice-port", "it is a dynamic kind");

        const world = makeWorld({ namespace: "kb-voipcov" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });
        const items = extractLifecycleItems(set);
        const port = items.find((i) => i.kind === "number-port");
        assert(port, "a port-date item is extracted for the voice asset");
        assertEq(port.source.id, s.voice.id, "…from the voice asset");
        assertEq(port.iso, "2024-01-15", "…carrying the recorded date");

        // A non-voice asset with a portDate field is ignored.
        const other = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Not voice", assetTypeId: builtinAssetType("atype-applications").id, assetFields: { portDate: "2024-02-02" }, ...CL })).record;
        const items2 = extractLifecycleItems(await world.docs.get(s.set.id, { force: true }));
        assert(!items2.some((i) => i.kind === "number-port" && i.source.id === other.id), "a non-voice asset does not produce a port item");

        // voipLifecycleItems scopes to the deployment (voice + linked records).
        await linkAll(world, s);
        const typeOf = (r) => builtinAssetType(r.assetTypeId);
        const scoped = voipLifecycleItems(s.voice, await world.docs.get(s.set.id, { force: true }), { typeOf });
        assert(scoped.some((i) => i.kind === "number-port"), "the deployment items include the port");
        assert(scoped.some((i) => i.kind === "support-expiry"), "the deployment items include the support expiry");
        assert(scoped.some((i) => i.kind === "asset-expiry"), "the deployment items include the licence expiry");
      },
    },
    {
      name: "voipDeploymentCoverage combines relationships and lifecycle into one report, and voipCoverageLine summarises it",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voipcov" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const report = voipDeploymentCoverage(s.voice, set);
        assertEq(report.voice.id, s.voice.id, "the report names the voice asset");
        assertEq(report.groups.length, 2, "both groups are present");
        assertEq(report.groups.map((g) => g.id).join(","), "relationships,lifecycle", "groups in catalog order");
        assertEq(report.total, VOIP_COVERAGE_REQUIREMENTS.length, "the report covers every requirement");
        assert(report.complete, "a fully linked and dated deployment is complete");
        assertEq(report.requiredMet, report.requiredTotal, "every required requirement is met");
        assertEq(report.percent, 100, "the coverage percentage is 100");
        assertEq(report.missing.length, 0, "nothing is missing");
        assert(Array.isArray(report.lifecycle.items) && report.lifecycle.items.length >= 2, "the report carries the deployment's lifecycle items");

        const bare = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Bare voice", assetTypeId: VOICE_PBX_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareReport = voipDeploymentCoverage(bare, await world.docs.get(s.set.id, { force: true }));
        assert(!bareReport.complete, "a bare deployment is incomplete");
        assert(bareReport.missing.length > 0, "its gaps are listed");
        assertEq(voipCoverageLine(s.voice, set), `${report.requiredMet}/${report.requiredTotal} required · 100%`, "the summary line reads back");
      },
    },
    {
      name: "voipCoverageIssues flags the gaps voice.js does not, and folds into the linter without duplicates",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voipcov" });
        const s = await seed(world, { portDate: "", portingStatus: "in-progress" });
        const set = await world.docs.get(s.set.id, { force: true });
        const issues = voipCoverageIssues(set);
        const found = codes(issues);
        for (const code of ["voip-no-endpoints", "voip-no-licensing", "voip-no-vendor", "voip-no-contact", "voip-no-port-date", "voip-no-support", "voip-no-subscription"]) {
          assert(found.includes(code), "flags " + code);
        }
        assert(!found.includes("voip-no-circuit"), "does not duplicate the circuit check voice.js owns");
        assert(!found.includes("voip-no-security"), "does not duplicate the security check voice.js owns");
        assert(!found.includes("voip-no-credential"), "does not duplicate the credential check voice.js owns");
        assert(issues.every((i) => i.level === "warning"), "coverage gaps are warnings");
        assert(issues.every((i) => i.recordId === s.voice.id), "every issue names the voice asset");

        const folded = standardizedIssues(set);
        assert(codes(folded).includes("voip-no-licensing"), "the linter folds the coverage audit in");
        assert(codes(folded).includes("voice-no-platform") === false, "the seeded platform is complete enough not to trip the voice checks: " + JSON.stringify(codes(folded)));
        // No code appears twice from the coverage audit.
        const covCodes = codes(issues);
        for (const code of covCodes) {
          assertEq(folded.filter((i) => i.code === code).length, 1, code + " appears exactly once in the linter");
        }
        assert((await world.docs.integrity(s.set.id)).ok, "coverage gaps never fail the graph audit");

        // A fully linked and dated platform raises no coverage issues.
        const world2 = makeWorld({ namespace: "kb-voipcov" });
        const s2 = await seed(world2);
        await linkAll(world2, s2);
        const clean = await world2.docs.get(s2.set.id, { force: true });
        assertEq(voipCoverageIssues(clean).length, 0, "a fully covered deployment raises no coverage issues");
      },
    },
  ]);
}
