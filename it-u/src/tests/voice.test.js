// src/tests/voice.test.js — validation tests for Phase 8 task 36 (the Voice/PBX
// asset). Run in the live page:
//   await import("./src/tests/voice.test.js").then((m) => m.run())
//
// Covers: the voice vocabulary catalogs (platforms, deployment models, trunk
// types, SIP transports, codecs, services, number types, porting statuses,
// emergency services, endpoint types); the enriched `atype-voice-pbx` template
// and its record-reference fields; the typed relationships a voice platform
// holds to its internet/WAN circuits, PBX/SBC configurations, security, voice
// application, vendor, credentials, licensing, documents, checklists and
// people; the labelled relationship GROUPS the profile shows; the
// link-parameter/candidate computation behind those groups; and the structured
// Voice/PBX completeness audit folded into the Linter.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { validateAssetType } from "../framework/flexible.js";
import { relationGroupsFor, groupLinks, relationCandidates, linkParamsFor } from "../framework/assetRelations.js";
import {
  VOICE_PLATFORMS,
  VOICE_DEPLOYMENT_MODELS,
  VOICE_TRUNK_TYPES,
  VOICE_SIP_TRANSPORTS,
  VOICE_CODECS,
  VOICE_SERVICES,
  VOICE_NUMBER_TYPES,
  PORTING_STATUSES,
  EMERGENCY_SERVICES,
  VOICE_ENDPOINT_TYPES,
  voicePlatform,
  voicePlatformLabel,
  voiceDeployment,
  voiceTrunkType,
  voiceSipTransport,
  voiceCodec,
  voiceService,
  voiceServiceLabels,
  voiceNumberType,
  portingStatus,
  portingStatusLabel,
  isPortComplete,
  emergencyService,
  emergencyServiceLabel,
  isEmergencyConfigured,
  voiceEndpointType,
  voicePlatformOptions,
  voiceDeploymentOptions,
  voiceTrunkTypeOptions,
  voiceSipTransportOptions,
  voiceCodecOptions,
  voiceServiceOptions,
  portingStatusOptions,
  emergencyServiceOptions,
  voiceCoverage,
  voicePlatformIssues,
  VOICE_PBX_TYPE_ID,
} from "../framework/voice.js";
import { standardizedIssues } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });

async function seed(world) {
  const { docs } = world;
  const set = await docs.create({ name: "Acme" });
  const fx = (id) => builtinAssetType(id);
  const voice = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "Head office voice",
    assetTypeId: VOICE_PBX_TYPE_ID,
    assetFields: { platformType: "3cx", product: "3CX v20", deploymentModel: "cloud", numberInventory: "02 5550 1000\n02 5550 10xx\n1300 555 000", emergencyService: "e911", emergencyAddress: "1 Example St" },
    ...CL,
  })).record;
  const circuit = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Fibre 500", assetTypeId: fx("atype-wan-circuit").id, assetFields: { carrier: "Telstra", circuitType: "fibre" }, ...CL })).record;
  const pbxHost = (await docs.addRecord(set.id, { type: "configurations", name: "PBX-VM-01", configType: "server-virtual", ...CL })).record;
  const sbc = (await docs.addRecord(set.id, { type: "configurations", name: "EDGE-FW-01", configType: "firewall", ...CL })).record;
  const security = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Perimeter security", assetTypeId: fx("atype-security-platform").id, assetFields: { platformType: "firewall" }, ...CL })).record;
  const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "3CX Management Console", assetTypeId: fx("atype-applications").id, assetFields: { applicationType: "server" }, ...CL })).record;
  const vendor = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "3CX", assetTypeId: fx("atype-vendor").id, assetFields: { vendorType: "voice" }, ...CL })).record;
  const licence = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "3CX 32SC licence", assetTypeId: fx("atype-licences").id, assetFields: { licenceType: "subscription" }, ...CL })).record;
  const password = (await docs.addRecord(set.id, { type: "passwords", name: "PBX admin console", scope: "general", category: "voip", ...CL })).record;
  const document = (await docs.addRecord(set.id, { type: "documents", name: "Dial plan & deployment notes", docType: "deployment", body: "# Dial plan\n\n- 1xxx extensions", ...CL })).record;
  const checklist = (await docs.addRecord(set.id, { type: "checklists", name: "Voice cut-over checklist", items: [], ...CL })).record;
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
  await link(s.licence, s.voice, "licence-application");
  await link(s.voice, s.document, "voice-document");
  await link(s.voice, s.checklist, "voice-checklist");
  await link(s.contact, s.voice, "contact-voice");
}

const codes = (issues) => issues.map((i) => i.code);

export async function run() {
  return runTests([
    {
      name: "the voice template models the client's telephony as a structured service",
      fn: () => {
        const type = builtinAssetType("atype-voice-pbx");
        assert(validateAssetType(type).ok, "the shipped template validates");
        assertEq(type.category, "applications", "the voice platform lives in the applications category");
        assertEq(type.icon, "phone", "the voice platform carries the phone icon");

        const platform = type.fields.find((f) => f.key === "platformType");
        assert(platform && platform.required && platform.type === "select", "platform type is a required choice");
        assertEq(platform.options.length, VOICE_PLATFORMS.length, "platform options come from the shared catalog");
        const deploy = type.fields.find((f) => f.key === "deploymentModel");
        assert(deploy && deploy.required && deploy.type === "select", "deployment model is a required choice");
        assertEq(deploy.options.length, VOICE_DEPLOYMENT_MODELS.length, "deployment options come from the catalog");
        assert(type.fields.find((f) => f.key === "trunkType" && f.type === "select"), "trunk type is recorded");
        assert(type.fields.find((f) => f.key === "sipTransport" && f.type === "select"), "SIP transport is recorded");
        const codecs = type.fields.find((f) => f.key === "codecs");
        assert(codecs && codecs.type === "multiselect" && codecs.options.length === VOICE_CODECS.length, "codecs are a multi-choice over the codec catalog");
        const services = type.fields.find((f) => f.key === "services");
        assert(services && services.type === "multiselect" && services.options.length === VOICE_SERVICES.length, "services are a multi-choice over the service catalog");
        assert(type.fields.find((f) => f.key === "emergencyService" && f.type === "select"), "emergency calling is recorded");
        assert(type.fields.find((f) => f.key === "numberInventory" && f.type === "textarea"), "the number inventory is captured");
        assert(type.fields.find((f) => f.key === "portingStatus" && f.type === "select"), "number porting status is recorded");
        assert(type.fields.find((f) => f.key === "portDate" && f.type === "date"), "the port date is dated");
        assert(type.fields.find((f) => f.key === "failoverNotes" && f.type === "textarea"), "failover/redundancy notes are captured");
        assert(type.fields.find((f) => f.key === "qualityNotes" && f.type === "textarea"), "QoS/call-quality notes are captured");

        assert(type.fields.find((f) => f.key === "pbxHostRecord" && f.type === "record" && f.of === "configurations"), "points at a PBX/host configuration");
        assert(type.fields.find((f) => f.key === "sbcRecord" && f.type === "record" && f.of === "configurations"), "points at an SBC/firewall configuration");
        assert(type.fields.find((f) => f.key === "securityRecord" && f.type === "record" && f.of === "flexibleAssets"), "points at a security platform");
        assert(type.fields.find((f) => f.key === "voiceApplication" && f.type === "record" && f.of === "flexibleAssets"), "points at the voice application");
        assert(type.fields.find((f) => f.key === "circuit" && f.type === "record" && f.of === "flexibleAssets"), "points at the internet/WAN circuit");
        assert(type.fields.find((f) => f.key === "adminCredential" && f.type === "record" && f.of === "passwords"), "points at an administrator credential");
        assert(type.fields.find((f) => f.key === "deploymentChecklist" && f.type === "record" && f.of === "checklists"), "points at a deployment checklist");

        for (const r of ["configurations", "contacts", "passwords", "flexibleAssets", "documents", "checklists"]) {
          assert(type.references.includes(r), "may reference " + r);
        }
      },
    },
    {
      name: "the voice catalogs expose platforms, media, services, numbering and emergency calling",
      fn: () => {
        assertEq(voicePlatform("3cx").label, "3CX", "platform lookup");
        assertEq(voicePlatformLabel("teams-phone"), "Microsoft Teams Phone", "platform label");
        assertEq(voicePlatform("bogus"), null, "an unknown platform is null");
        assertEq(voiceDeployment("cloud").label, "Cloud / hosted", "deployment lookup");
        assertEq(voiceTrunkType("sip-trunk").label, "SIP trunk", "trunk lookup");
        assertEq(voiceSipTransport("tls").label, "SIP over TLS (SIPS)", "SIP transport lookup");
        assertEq(voiceCodec("g711u").label, "G.711 µ-law", "codec lookup");
        assertEq(voiceService("auto-attendant").label, "Auto attendant / IVR", "service lookup");
        assertEq(voiceServiceLabels(["extensions", "voicemail"]).join(", "), "Extension dialling, Voicemail", "service labels");
        assertEq(voiceNumberType("toll-free").label, "Toll-free", "number type lookup");
        assertEq(portingStatus("in-progress").label, "Port in progress", "porting status lookup");
        assertEq(portingStatusLabel("ported"), "Ported", "porting status label");
        assert(isPortComplete("ported") && isPortComplete("not-required"), "a ported (or not-required) number is complete");
        assert(!isPortComplete("submitted") && !isPortComplete("failed") && !isPortComplete("in-progress"), "an in-flight port is not complete");
        assertEq(emergencyService("e911").label, "E911 (per-site dispatchable location)", "emergency service lookup");
        assertEq(emergencyServiceLabel("none"), "None recorded", "emergency service label");
        assert(isEmergencyConfigured("e911") && isEmergencyConfigured("911"), "e911 and basic 911 count as configured");
        assert(!isEmergencyConfigured("none") && !isEmergencyConfigured(""), "none/blank does not count as configured");
        assertEq(voiceEndpointType("ata").label, "ATA / analogue adapter", "endpoint lookup");

        assertEq(voicePlatformOptions().length, VOICE_PLATFORMS.length, "platform options mirror the catalog");
        assertEq(voiceDeploymentOptions().length, VOICE_DEPLOYMENT_MODELS.length, "deployment options mirror the catalog");
        assertEq(voiceTrunkTypeOptions().length, VOICE_TRUNK_TYPES.length, "trunk options mirror the catalog");
        assertEq(voiceSipTransportOptions().length, VOICE_SIP_TRANSPORTS.length, "SIP transport options mirror the catalog");
        assertEq(voiceCodecOptions().length, VOICE_CODECS.length, "codec options mirror the catalog");
        assertEq(voiceServiceOptions().length, VOICE_SERVICES.length, "service options mirror the catalog");
        assertEq(portingStatusOptions().length, PORTING_STATUSES.length, "porting options mirror the catalog");
        assertEq(emergencyServiceOptions().length, EMERGENCY_SERVICES.length, "emergency options mirror the catalog");
        assertEq(VOICE_NUMBER_TYPES.length > 0 && VOICE_ENDPOINT_TYPES.length > 0, true, "number types and endpoint types are catalogued");
        assert(
          [voicePlatformOptions(), voiceDeploymentOptions(), voiceTrunkTypeOptions(), voiceSipTransportOptions(), voiceCodecOptions(), voiceServiceOptions(), portingStatusOptions(), emergencyServiceOptions()].every((opts) => opts.every((o) => o.id && o.label)),
          "every option is well formed",
        );
      },
    },
    {
      name: "a voice platform relates to its circuit, configurations, security, application, vendor, credential, licence, documents, checklist and people",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voice" });
        const s = await seed(world);
        await linkAll(world, s);
        const rels = await world.docs.relations(s.set.id, ref(s.voice));
        assertEq(rels.length, 11, "eleven relationships touch the voice platform");
        assertEq(
          rels.map((r) => r.relationship.kind).sort().join(","),
          [
            "contact-voice",
            "licence-application",
            "voice-application",
            "voice-checklist",
            "voice-circuit",
            "voice-configuration",
            "voice-document",
            "voice-password",
            "voice-sbc",
            "voice-security",
            "voice-vendor",
          ].join(","),
          "every requested relation kind is present",
        );
        const incoming = rels.filter((r) => r.direction === "in").map((r) => r.relationship.kind).sort();
        assertEq(incoming.join(","), "contact-voice,licence-application", "the licence and owner attach from the far side, visible from the voice platform");

        const integrity = await world.docs.integrity(s.set.id);
        assert(integrity.ok, "the graph audit passes: " + JSON.stringify(integrity.issues));
      },
    },
    {
      name: "the relationship catalog refuses links that break it, duplicates and self-links",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voice" });
        const s = await seed(world);
        let threw = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.voice), to: ref(s.contact), kind: "voice-checklist" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "a voice→checklist link to a contact is refused");

        await world.docs.linkRecords(s.set.id, { from: ref(s.voice), to: ref(s.circuit), kind: "voice-circuit" });
        let dup = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.voice), to: ref(s.circuit), kind: "voice-circuit" });
        } catch (e) {
          dup = e;
        }
        assert(dup && dup.code === "INVALID_DATA", "a duplicate link is refused");
        let self = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.voice), to: ref(s.voice), kind: "voice-application" });
        } catch (e) {
          self = e;
        }
        assert(self && self.code === "INVALID_DATA", "a self-link is refused");
      },
    },
    {
      name: "the profile groups a voice platform's links into labelled buckets",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voice" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const type = builtinAssetType("atype-voice-pbx");
        const grouped = groupLinks(s.voice, set, type);
        assertEq(grouped.total, 11, "all eleven links are accounted for");
        assertEq(grouped.leftovers.length, 0, "no links fall outside the named groups");
        const byId = Object.fromEntries(grouped.groups.map((g) => [g.id, g]));
        for (const id of ["circuits", "configurations", "sbc", "security", "applications", "vendor", "credentials", "licensing", "documents", "checklists", "contacts"]) {
          assert(byId[id], "the " + id + " group exists");
        }
        assertEq(byId.licensing.direction, "in", "the licensing group attaches from the licence side");
        assertEq(byId.contacts.direction, "in", "the contacts group attaches from the contact side");
        assertEq(byId.configurations.links[0].other.name, "PBX-VM-01", "the far-side configuration is resolved");
        assertEq(byId.sbc.label, "SBC / firewall", "the SBC group is labelled");
        assertEq(byId.circuits.links[0].other.name, "Fibre 500", "the far-side circuit is resolved");
      },
    },
    {
      name: "group link parameters and candidate lists drive the profile's link pickers",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voice" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });
        const byId = Object.fromEntries(relationGroupsFor(builtinAssetType("atype-voice-pbx")).map((g) => [g.id, g]));

        const outParams = linkParamsFor(s.voice, byId.circuits, s.circuit);
        assertEq(outParams.from.id, s.voice.id, "an out group links from the voice platform");
        assertEq(outParams.to.id, s.circuit.id, "…to the candidate");
        assertEq(outParams.kind, "voice-circuit", "…with the group's primary kind");
        const inParams = linkParamsFor(s.voice, byId.contacts, s.contact);
        assertEq(inParams.from.id, s.contact.id, "an in group links from the candidate");
        assertEq(inParams.to.id, s.voice.id, "…to the voice platform");

        assert(relationCandidates(s.voice, set, byId.vendor).some((r) => r.id === s.vendor.id), "an unlinked vendor is offered");
        await world.docs.linkRecords(s.set.id, { from: ref(s.voice), to: ref(s.vendor), kind: "voice-vendor" });
        const after = await world.docs.get(s.set.id, { force: true });
        assert(!relationCandidates(s.voice, after, byId.vendor).some((r) => r.id === s.vendor.id), "a linked vendor drops out of the candidates");
        assert(!relationCandidates(s.voice, after, byId.configurations).some((r) => r.id === s.voice.id), "a group never offers the voice platform itself");
        assert(!relationCandidates(s.voice, after, byId.applications).some((r) => r.id === s.circuit.id), "the template filter keeps a circuit record out of the application group");
      },
    },
    {
      name: "voicePlatformIssues audits the structured platform's completeness and folds into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-voice" });
        const set = await world.docs.create({ name: "Bare" });
        const bare = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Untested voice", assetTypeId: VOICE_PBX_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareSet = await world.docs.get(set.id, { force: true });
        const cov = voiceCoverage(bare, bareSet);
        assert(!cov.circuits && !cov.configurations && !cov.security && !cov.applications && !cov.vendor && !cov.credentials && !cov.licensing && !cov.documents && !cov.checklists && !cov.contacts, "an empty platform covers nothing");
        const issues = voicePlatformIssues(bareSet);
        assertEq(issues.length, 7, "seven gaps flagged for a bare platform");
        for (const code of ["voice-no-platform", "voice-no-deployment", "voice-no-circuit", "voice-no-numbers", "voice-no-security", "voice-no-credential", "voice-no-emergency"]) {
          assert(codes(issues).includes(code), "flags " + code);
        }
        assert(issues.every((i) => i.recordId === bare.id), "every issue names the record it concerns");
        assert(issues.every((i) => i.level === "warning"), "gaps are warnings, not errors");

        const folded = standardizedIssues(bareSet);
        assert(codes(folded).includes("voice-no-platform"), "the linter folds the voice audit in");
        assert((await world.docs.integrity(set.id)).ok, "completeness gaps never fail the graph audit");

        const s = await seed(world);
        await linkAll(world, s);
        const fullSet = await world.docs.get(s.set.id, { force: true });
        const full = voicePlatformIssues(fullSet);
        assertEq(full.length, 0, "a fully documented and linked platform raises no issues: " + JSON.stringify(full));
      },
    },
  ]);
}
