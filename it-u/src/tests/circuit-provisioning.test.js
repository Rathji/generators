// src/tests/circuit-provisioning.test.js — validation tests for Phase 10 task 41
// ("Provisioning & activation workflow documentation"). Run in the live page:
//   await import("./src/tests/circuit-provisioning.test.js").then((m) => m.run())
//
// Covers: the provisioning catalogs (the nine phases, the record targets, and
// the step catalog with each step's record mapping); the record resolver that
// turns a target into the actual linked/field-referenced records; the generator
// (generateCircuitProvisioningRunbook) — that it emits every required phase,
// substitutes the recorded values, names the records each step updates, and
// marks every gap TO COMPLETE; the coverage and audit functions; the new runbook
// type in the catalog; and that a generated runbook round-trips through storage
// as a valid, linked document.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { WAN_CIRCUIT_TYPE_ID } from "../framework/circuit.js";
import {
  RUNBOOK_TYPES,
  RUNBOOK_GROUPS,
  runbookType,
  runbookTypeLabel,
  runbooksOfGroup,
  runbookIssues,
} from "../framework/runbook.js";
import { standardizedIssues } from "../framework/standardized.js";
import {
  PROVISIONING_PHASES,
  PROVISIONING_PHASE_IDS,
  provisioningPhase,
  PROVISIONING_TARGETS,
  PROVISIONING_TARGET_IDS,
  provisioningTarget,
  PROVISIONING_STEPS,
  PROVISIONING_STEP_IDS,
  provisioningStep,
  provisioningStepsForPhase,
  CIRCUIT_PROVISIONING_SECTIONS,
  circuitProvisioningSection,
  resolveProvisioningRecords,
  provisioningRecordCoverage,
  provisioningStepRecords,
  circuitProvisioningCoverage,
  circuitProvisioningIssues,
  generateCircuitProvisioningRunbook,
} from "../framework/circuitProvisioning.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });
const codes = (issues) => issues.map((i) => i.code);

async function seed(world, overrides = {}) {
  const { docs } = world;
  const set = await docs.create({ name: "Aurora" });
  const circuit = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "Aurora 500 — HO",
    assetTypeId: WAN_CIRCUIT_TYPE_ID,
    assetFields: {
      carrier: "Aurora Telecom",
      upstreamCarrier: "National Wholesale",
      sourcing: "resold",
      circuitType: "fibre",
      accessTechnology: "fibre",
      serviceDefinition: "business",
      circuitId: "AUR-500-001",
      accountNumber: "NW-99",
      bandwidthDown: 100,
      bandwidthUp: 40,
      burstDown: 250,
      burstUp: 100,
      contention: "10:1",
      slaTarget: "business",
      staticIps: "203.0.113.2",
      subnets: "203.0.113.0/29",
      ipv4Range: "203.0.113.1 - 203.0.113.6",
      publicHostname: "aurora-ho.example.net",
      cpeRole: "firewall",
      costPrice: 40,
      sellPrice: 100,
      currency: "GBP",
      contractStartDate: "2026-01-01",
      contractTermMonths: 24,
      contractEndDate: "2028-01-01",
      supportPhone: "1-800-AURORA",
      supportUrl: "https://support.aurora.example",
      ...(overrides.assetFields || {}),
    },
    ...CL,
  })).record;
  const upstream = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "National Wholesale", assetTypeId: "atype-vendor", assetFields: {}, ...CL })).record;
  const cpe = (await docs.addRecord(set.id, { type: "configurations", name: "AURORA-CPE-01", configType: "router", ...CL })).record;
  const lan = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Head Office LAN", assetTypeId: "atype-lan", assetFields: {}, ...CL })).record;
  const security = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "EDGE-FW-01", assetTypeId: "atype-security-platform", assetFields: {}, ...CL })).record;
  const contact = (await docs.addRecord(set.id, { type: "contacts", name: "Priya Nair", contactRole: "isp-carrier", ...CL })).record;
  const password = (await docs.addRecord(set.id, { type: "passwords", name: "CPE admin", scope: "general", category: "network-device", ...CL })).record;
  const doc = (await docs.addRecord(set.id, { type: "documents", name: "Carrier order confirmation", docType: "reference", ...CL })).record;
  const location = (await docs.addRecord(set.id, { type: "locations", name: "Head Office", locationType: "office", ...CL })).record;
  return { set, circuit, upstream, cpe, lan, security, contact, password, doc, location };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.circuit, s.upstream, "circuit-upstream");
  await link(s.circuit, s.cpe, "circuit-cpe");
  await link(s.circuit, s.security, "circuit-security");
  await link(s.circuit, s.lan, "circuit-lan");
  await link(s.circuit, s.password, "circuit-password");
  await link(s.circuit, s.doc, "circuit-document");
  await link(s.contact, s.circuit, "contact-circuit");
}

export async function run() {
  return runTests([
    {
      name: "the provisioning catalog orders the phases, the steps and the record targets",
      fn: () => {
        assertEq(PROVISIONING_PHASES.length, 9, "nine provisioning phases");
        assertEq(PROVISIONING_PHASE_IDS.length, new Set(PROVISIONING_PHASE_IDS).size, "phase ids are unique");
        const orders = PROVISIONING_PHASES.map((p) => p.order);
        assertEq(orders.join(","), [...orders].sort((a, b) => a - b).join(","), "phases are in order");
        for (const p of PROVISIONING_PHASES) assert(p.label && p.summary && p.icon, `phase ${p.id} is complete`);
        assertEq(provisioningPhase("order").label, "Order capture", "phase lookup");
        assertEq(provisioningPhase("bogus"), null, "unknown phase is null");

        assert(PROVISIONING_STEPS.length >= 18, "the step catalog is populated");
        assertEq(PROVISIONING_STEP_IDS.length, new Set(PROVISIONING_STEP_IDS).size, "step ids are unique");
        for (const s of PROVISIONING_STEPS) {
          assert(s.id && s.title && s.detail, `step ${s.id} is complete`);
          assert(provisioningPhase(s.phase), `step ${s.id} names a real phase`);
          assert(Array.isArray(s.updates) && s.updates.length, `step ${s.id} maps to at least one record`);
          for (const u of s.updates) assert(PROVISIONING_TARGET_IDS.includes(u), `step ${s.id} updates the known target ${u}`);
        }
        for (const p of PROVISIONING_PHASES) assert(provisioningStepsForPhase(p.id).length >= 1, `phase ${p.id} has at least one step`);
        assertEq(provisioningStep("capture-order").phase, "order", "step lookup");
        assertEq(provisioningStep("bogus"), null, "unknown step is null");
        assertEq(provisioningStep("accept-signoff").updates.includes("runbook"), true, "the final step updates the runbook itself");

        assert(PROVISIONING_TARGETS.length >= 8, "the record-target catalog is populated");
        assertEq(PROVISIONING_TARGET_IDS.length, new Set(PROVISIONING_TARGET_IDS).size, "target ids are unique");
        for (const t of PROVISIONING_TARGETS) assert(t.label && t.collection, `target ${t.id} is complete`);
        for (const id of ["circuit", "upstream", "cpe", "contact", "runbook"]) {
          assert(provisioningTarget(id).required, `target ${id} is required`);
        }
        assertEq(provisioningTarget("bogus"), null, "unknown target is null");
      },
    },
    {
      name: "resolveProvisioningRecords finds the linked and field-referenced records, and coverage flags the gaps",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-prov" });
        const s = await seed(world);
        await linkAll(world, s);
        let set = await world.docs.get(s.set.id, { force: true });
        const resolved = resolveProvisioningRecords(s.circuit, set);
        assertEq(resolved.circuit[0].id, s.circuit.id, "the circuit resolves to itself");
        assert(resolved.upstream.some((r) => r.id === s.upstream.id), "the upstream carrier resolves");
        assert(resolved.cpe.some((r) => r.id === s.cpe.id), "the CPE resolves");
        assert(resolved.firewall.some((r) => r.id === s.security.id), "the firewall resolves");
        assert(resolved.lan.some((r) => r.id === s.lan.id), "the LAN resolves");
        assert(resolved.credential.some((r) => r.id === s.password.id), "the credential resolves");
        assert(resolved.contact.some((r) => r.id === s.contact.id), "the contact resolves");
        assert(resolved.document.some((r) => r.id === s.doc.id), "the document resolves");

        const cov = provisioningRecordCoverage(s.circuit, set);
        assertEq(cov.length, PROVISIONING_TARGETS.length, "coverage mirrors the targets");
        for (const t of ["circuit", "upstream", "cpe", "firewall", "lan", "credential", "contact", "document"]) {
          assert(cov.find((c) => c.target === t).present, `${t} is resolved`);
        }
        assertEq(cov.find((c) => c.target === "runbook").present, false, "there is no provisioning runbook yet");
        assertEq(cov.filter((c) => c.required && !c.present).length, 1, "the only missing required record is the runbook itself");

        // A field reference (not a typed link) still resolves.
        const fielded = { ...s.circuit, assetFields: { ...s.circuit.assetFields, cpeRecord: s.cpe.id } };
        assert(resolveProvisioningRecords(fielded, set).cpe.some((r) => r.id === s.cpe.id), "a cpeRecord field reference resolves");

        // A bare circuit flags its required gaps.
        const bare = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Bare", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "X" }, ...CL })).record;
        set = await world.docs.get(s.set.id, { force: true });
        const bareCov = provisioningRecordCoverage(bare, set);
        assertEq(bareCov.find((c) => c.target === "upstream").present, false, "a bare circuit has no upstream");
        assertEq(bareCov.find((c) => c.target === "upstream").required, true, "upstream is a required target");
        assertEq(bareCov.find((c) => c.target === "circuit").present, true, "the circuit itself is present");
      },
    },
    {
      name: "provisioningStepRecords resolves each step's record mapping",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-prov" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const mapped = provisioningStepRecords(provisioningStep("activate"), s.circuit, set);
        assertEq(mapped.length, provisioningStep("activate").updates.length, "one entry per target");
        const upstream = mapped.find((m) => m.target === "upstream");
        assert(upstream.records.some((r) => r.id === s.upstream.id), "the step names the upstream record");
        const circuit = mapped.find((m) => m.target === "circuit");
        assert(circuit.records.some((r) => r.id === s.circuit.id), "the step names the circuit");
      },
    },
    {
      name: "generateCircuitProvisioningRunbook assembles every required phase with the recorded values and the step mapping",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-prov" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitProvisioningRunbook({ circuit: s.circuit, set, site: s.location, preparedBy: "Tom" });

        assertEq(gen.runbookType, "circuit-provisioning", "the generated runbook is a circuit provisioning");
        assertEq(gen.service.id, s.circuit.id, "it references the circuit");
        assertEq(gen.site.id, s.location.id, "it references the site");
        assertEq(gen.warnings.length, 0, "a fully recorded circuit raises no gaps: " + JSON.stringify(gen.warnings));

        const cov = circuitProvisioningCoverage({ body: gen.body });
        for (const sec of CIRCUIT_PROVISIONING_SECTIONS) assert(cov[sec.id], `the body contains the “${sec.heading}” section`);
        assertEq(gen.sections.filter((x) => x.required).length, CIRCUIT_PROVISIONING_SECTIONS.filter((x) => x.required).length, "every required section is declared");
        assertEq(gen.phases.length, PROVISIONING_PHASES.length, "the phase map is returned");

        assert(gen.body.includes("Aurora Telecom"), "the carrier is substituted");
        assert(gen.body.includes("National Wholesale"), "the upstream carrier is substituted");
        assert(gen.body.includes("Fibre (FTTP)"), "the access technology is substituted");
        assert(gen.body.includes("Business"), "the service definition is substituted");
        assert(gen.body.includes("203.0.113.0/29"), "the subnet is substituted");
        assert(gen.body.includes("aurora-ho.example.net"), "the public hostname is substituted");
        assert(gen.body.includes("AURORA-CPE-01"), "the linked CPE is named");
        assert(gen.body.includes("Priya Nair"), "the linked contact is named");
        assert(gen.body.includes("National Wholesale"), "the linked upstream record is named");
        assert(gen.body.includes("Records updated:"), "each step prints the records it updates");
        for (const step of PROVISIONING_STEPS) assert(gen.body.includes(step.title), `the body includes the step “${step.title}”`);
      },
    },
    {
      name: "generateCircuitProvisioningRunbook marks missing facts TO COMPLETE and warns about them",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-prov" });
        const s = await seed(world);
        const bare = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Bare circuit", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "Aurora" }, ...CL })).record;
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitProvisioningRunbook({ circuit: bare, set });
        const warnCodes = gen.warnings.map((w) => w.code);
        for (const code of ["missing-service-definition", "missing-upstream", "missing-access", "missing-committed", "missing-addressing", "missing-contract", "missing-pricing", "missing-cpe", "missing-contact"]) {
          assert(warnCodes.includes(code), "warns " + code);
        }
        assert(gen.body.includes("TO COMPLETE"), "the gaps are marked TO COMPLETE in the body");

        let threw = null;
        try {
          generateCircuitProvisioningRunbook({ circuit: { type: "documents" }, set });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "generating from a non-asset is refused");
      },
    },
    {
      name: "the provisioning audit flags a missing phase and an unlinked runbook, and folds into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-prov" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });

        const full = generateCircuitProvisioningRunbook({ circuit: s.circuit, set, site: s.location });
        await world.docs.addRunbook(s.set.id, { name: "Full provisioning", runbookType: "circuit-provisioning", body: full.body, service: ref(s.circuit), ...CL });
        let withRun = await world.docs.get(s.set.id, { force: true });
        assertEq(circuitProvisioningIssues(withRun).length, 0, "a complete generated runbook raises no issues: " + JSON.stringify(circuitProvisioningIssues(withRun)));
        assertEq(runbookIssues(withRun).length, 0, "…and no general runbook issues");

        const partial = (await world.docs.addRunbook(s.set.id, { name: "Partial", runbookType: "circuit-provisioning", body: "# Circuit\n\n## Overview & scope\n\nonly this", ...CL })).record;
        withRun = await world.docs.get(s.set.id, { force: true });
        const issues = circuitProvisioningIssues(withRun);
        assert(codes(issues).includes("circuit-runbook-missing-order"), "a missing required phase is flagged");
        assert(codes(issues).includes("circuit-runbook-no-circuit"), "an unlinked provisioning runbook is flagged");
        assert(issues.every((i) => i.level === "warning"), "provisioning findings are warnings");

        const folded = standardizedIssues(withRun);
        assert(codes(folded).includes("circuit-runbook-missing-order"), "the linter folds the provisioning audit in");
        assert((await world.docs.integrity(s.set.id)).ok, "provisioning gaps never fail the graph audit");
        void partial;
      },
    },
    {
      name: "a generated circuit runbook round-trips through storage as a valid, linked document",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-prov" });
        const s = await seed(world);
        await linkAll(world, s);
        let set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitProvisioningRunbook({ circuit: s.circuit, set, site: s.location, preparedBy: "Tom" });
        const r = (await world.docs.addRunbook(s.set.id, {
          name: gen.name,
          runbookType: gen.runbookType,
          summary: gen.summary,
          body: gen.body,
          service: gen.service,
          site: gen.site,
          origin: { source: "circuit-asset", circuitId: s.circuit.id, warnings: gen.warnings },
          ...CL,
        })).record;
        set = await world.docs.get(s.set.id, { force: true });
        const stored = set.records.runbooks.find((x) => x.id === r.id);
        assertEq(stored.body.length, gen.body.length, "the full generated body is stored");
        assertEq(circuitProvisioningCoverage(stored).acceptance, true, "the stored runbook still covers acceptance");
        assertEq(circuitProvisioningIssues(set).length, 0, "no issues for the stored generated runbook: " + JSON.stringify(circuitProvisioningIssues(set)));
        assert((await world.docs.integrity(s.set.id)).ok, "the set's graph audit still passes");
      },
    },
    {
      name: "the runbook catalog exposes the circuit provisioning type in the Internet group",
      fn: () => {
        assert(runbookType("circuit-provisioning"), "the circuit provisioning type exists");
        assertEq(runbookTypeLabel("circuit-provisioning"), "Internet/ISP circuit provisioning", "the type is labelled");
        assertEq(runbookType("circuit-provisioning").group, "Internet", "it sits in the Internet group");
        assert(RUNBOOK_GROUPS.includes("Internet"), "the Internet group is catalogued");
        assertEq(runbooksOfGroup("Internet").every((t) => t.group === "Internet"), true, "runbooksOfGroup filters by group");
        assert(RUNBOOK_TYPES.some((t) => t.id === "circuit-provisioning" && t.checklistProne), "the provisioning type is checklist-prone");
        assertEq(circuitProvisioningSection("acceptance").required, true, "the acceptance section is required");
        assertEq(circuitProvisioningSection("overview").required, false, "the overview section is optional");
        assertEq(circuitProvisioningSection("bogus"), null, "an unknown section id is null");
      },
    },
  ]);
}
