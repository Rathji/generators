// src/tests/circuit-migration.test.js — validation tests for Phase 10 task 44
// ("Circuit cutover, migration & decommission runbooks"). Run in the live page:
//   await import("./src/tests/circuit-migration.test.js").then((m) => m.run())
//
// Covers: the scenario / phase / required-verification / step catalogs and their
// option helpers; `migrationRecords` / `recordsToArchive` (a decommission
// archives the circuit, a CPE replacement archives the CPE); `migrationImpact`
// (dependents resolved, address change only when renumbering, and the findings);
// both generators (`generateCircuitMigrationRunbook`,
// `generateCircuitMigrationChecklist`) — that they emit every required section,
// name the dependents and records, mark gaps TO COMPLETE, and carry the checks
// the scenario calls for; `circuitMigrationCoverage` /
// `migrationChecklistCoverage` / `migrationPhaseProgress` / `formatMigrationText`;
// `circuitMigrationIssues` and that the linter folds it in; the new runbook type
// in the catalog; and that generated records round-trip through storage.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { WAN_CIRCUIT_TYPE_ID } from "../framework/circuit.js";
import { LAN_TYPE_ID } from "../framework/network.js";
import { runbookType, runbookTypeLabel } from "../framework/runbook.js";
import { standardizedIssues } from "../framework/standardized.js";
import {
  MIGRATION_SCENARIOS,
  MIGRATION_SCENARIO_IDS,
  migrationScenario,
  migrationScenarioLabel,
  migrationScenarioOptions,
  MIGRATION_PHASES,
  MIGRATION_PHASE_IDS,
  migrationPhase,
  migrationPhaseLabel,
  migrationPhaseOptions,
  MIGRATION_CHECKS,
  MIGRATION_CHECK_IDS,
  migrationCheck,
  migrationCheckLabel,
  MIGRATION_STEPS,
  MIGRATION_STEP_IDS,
  migrationStep,
  migrationStepsForPhase,
  stepsForScenario,
  migrationStepOptions,
  migrationRecords,
  recordsToArchive,
  migrationImpact,
  CIRCUIT_MIGRATION_SECTIONS,
  circuitMigrationSection,
  circuitMigrationCoverage,
  generateCircuitMigrationRunbook,
  generateCircuitMigrationChecklist,
  migrationChecklistCoverage,
  migrationPhaseProgress,
  formatMigrationText,
  isMigrationChecklist,
  circuitMigrationIssues,
} from "../framework/circuitMigration.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });
const codes = (issues) => issues.map((i) => i.code);
const targets = (records) => records.map((r) => r.target);

async function seed(world) {
  const { docs } = world;
  const set = await docs.create({ name: "Aurora" });
  const circuit = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "Aurora 500 — HO",
    assetTypeId: WAN_CIRCUIT_TYPE_ID,
    assetFields: {
      carrier: "Aurora Telecom",
      upstreamCarrier: "National Wholesale",
      accessTechnology: "fibre",
      serviceDefinition: "business",
      circuitId: "AUR-500-001",
      bandwidthDown: 100,
      bandwidthUp: 40,
      staticIps: "203.0.113.2\n203.0.113.3",
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
      billingCycle: "monthly",
    },
    ...CL,
  })).record;
  const upstream = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "National Wholesale", assetTypeId: "atype-vendor", assetFields: {}, ...CL })).record;
  const cpe = (await docs.addRecord(set.id, { type: "configurations", name: "AURORA-CPE-01", configType: "router", ...CL })).record;
  const firewall = (await docs.addRecord(set.id, { type: "configurations", name: "EDGE-FW-01", configType: "firewall", ...CL })).record;
  const security = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Edge EDR", assetTypeId: "atype-security-platform", assetFields: { platformType: "endpoint" }, ...CL })).record;
  const lan = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Head Office LAN", assetTypeId: LAN_TYPE_ID, assetFields: {}, ...CL })).record;
  const remote = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Client VPN", assetTypeId: "atype-remote-access", assetFields: { method: "vpn" }, ...CL })).record;
  const domain = (await docs.addRecord(set.id, { type: "domains", name: "example.net", ...CL })).record;
  const certificate = (await docs.addRecord(set.id, { type: "certificates", name: "aurora-ho.example.net", validTo: "2027-01-01", ...CL })).record;
  const password = (await docs.addRecord(set.id, { type: "passwords", name: "CPE admin", scope: "general", category: "network-device", ...CL })).record;
  const doc = (await docs.addRecord(set.id, { type: "documents", name: "Carrier order confirmation", docType: "reference", ...CL })).record;
  const contact = (await docs.addRecord(set.id, { type: "contacts", name: "Priya Nair", contactRole: "isp-carrier", ...CL })).record;
  const location = (await docs.addRecord(set.id, { type: "locations", name: "Head Office", locationType: "office", ...CL })).record;
  const tracker = (await docs.addRecord(set.id, { type: "trackers", name: "Aurora WAN renewal", detail: "Renewal for " + circuit.id, ...CL })).record;
  return { set, circuit, upstream, cpe, firewall, security, lan, remote, domain, certificate, password, doc, contact, location, tracker };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.circuit, s.upstream, "circuit-upstream");
  await link(s.circuit, s.cpe, "circuit-cpe");
  await link(s.circuit, s.firewall, "circuit-security");
  await link(s.circuit, s.security, "circuit-security");
  await link(s.circuit, s.lan, "circuit-lan");
  await link(s.circuit, s.remote, "circuit-remote-access");
  await link(s.circuit, s.domain, "circuit-domain");
  await link(s.circuit, s.certificate, "circuit-certificate");
  await link(s.circuit, s.password, "circuit-password");
  await link(s.circuit, s.doc, "circuit-document");
  await link(s.contact, s.circuit, "contact-circuit");
}

export async function run() {
  return runTests([
    {
      name: "the migration scenario catalog and its option helpers are populated and consistent",
      fn: () => {
        assert(MIGRATION_SCENARIOS.length >= 8, "the scenario catalog is populated");
        assertEq(MIGRATION_SCENARIO_IDS.length, new Set(MIGRATION_SCENARIO_IDS).size, "scenario ids are unique");
        for (const s of MIGRATION_SCENARIOS) assert(s.id && s.label && s.icon && s.risk && s.description, `scenario ${s.id} is complete`);
        assertEq(migrationScenario("carrier-change").risk, "high", "a carrier change is high risk");
        assertEq(migrationScenario("bandwidth-upgrade").renumber, false, "a bandwidth upgrade does not renumber");
        assertEq(migrationScenario("address-renumber").renumber, true, "an address change renumbers");
        assertEq(migrationScenario("cpe-replacement").replacesHardware, true, "a CPE replacement replaces hardware");
        assertEq(migrationScenario("decommission").decommission, true, "offboarding is a decommission");
        assertEq(migrationScenario("bogus"), null, "an unknown scenario is null");
        assertEq(migrationScenarioLabel("relocation"), "Site relocation", "the scenario is labelled");
        assertEq(migrationScenarioOptions().length, MIGRATION_SCENARIOS.length, "scenario options mirror the catalog");
      },
    },
    {
      name: "the phase and required-verification catalogs are ordered and complete",
      fn: () => {
        assertEq(MIGRATION_PHASES.length, 7, "seven migration phases");
        assertEq(MIGRATION_PHASE_IDS.length, new Set(MIGRATION_PHASE_IDS).size, "phase ids are unique");
        const orders = MIGRATION_PHASES.map((p) => p.order);
        assertEq(orders.join(","), [...orders].sort((a, b) => a - b).join(","), "phases are in order");
        for (const p of MIGRATION_PHASES) assert(p.label && p.summary && p.icon, `phase ${p.id} is complete`);
        assertEq(migrationPhase("migrate").label, "Migration / cutover", "phase lookup");
        assertEq(migrationPhase("bogus"), null, "an unknown phase is null");
        assertEq(migrationPhaseOptions().length, MIGRATION_PHASES.length, "phase options mirror the catalog");

        assert(MIGRATION_CHECKS.length >= 9, "the required-verification catalog is populated");
        assertEq(MIGRATION_CHECK_IDS.length, new Set(MIGRATION_CHECK_IDS).size, "check ids are unique");
        for (const c of MIGRATION_CHECKS) assert(c.label && migrationPhase(c.phase), `check ${c.id} names a real phase`);
        assertEq(migrationCheck("rollback").phase, "prepare", "rollback is a preparation check");
        assertEq(migrationCheck("acceptance").phase, "close", "acceptance is a closure check");
        assertEq(migrationCheckLabel("dns"), "Forward & reverse DNS verified", "the check is labelled");
        assertEq(migrationCheck("bogus"), null, "an unknown check is null");
      },
    },
    {
      name: "the step catalog maps every step to a real phase, known scenarios and record targets",
      fn: () => {
        assert(MIGRATION_STEPS.length >= 24, "the step catalog is populated");
        assertEq(MIGRATION_STEP_IDS.length, new Set(MIGRATION_STEP_IDS).size, "step ids are unique");
        for (const s of MIGRATION_STEPS) {
          assert(s.id && s.title && s.detail, `step ${s.id} is complete`);
          assert(migrationPhase(s.phase), `step ${s.id} names a real phase`);
          assert(Array.isArray(s.scenarios) && s.scenarios.length, `step ${s.id} names at least one scenario`);
          for (const sc of s.scenarios) assert(migrationScenario(sc), `step ${s.id} names the known scenario ${sc}`);
          for (const c of s.checks || []) assert(migrationCheck(c), `step ${s.id} carries the known check ${c}`);
        }
        for (const p of MIGRATION_PHASES) assert(migrationStepsForPhase(p.id).length >= 1, `phase ${p.id} has at least one step`);
        assertEq(migrationStep("perform-cutover").phase, "migrate", "step lookup");
        assertEq(migrationStep("bogus"), null, "an unknown step is null");
        assert(migrationStep("accept-signoff").updates.includes("runbook"), "the final step updates the runbook itself");

        const carrierSteps = stepsForScenario("carrier-change").map((s) => s.id);
        assert(carrierSteps.includes("order-target"), "a carrier change orders the new carrier");
        assert(!carrierSteps.includes("plan-addressing"), "a carrier change renumbers nothing");
        const renumberSteps = stepsForScenario("address-renumber").map((s) => s.id);
        assert(renumberSteps.includes("apply-addressing"), "an address change applies new addressing");
        assert(!renumberSteps.includes("order-target"), "an address change does not order a carrier");
        const decomSteps = stepsForScenario("decommission").map((s) => s.id);
        assert(decomSteps.includes("cancel-old-service"), "a decommission disconnects the service");
        assert(decomSteps.includes("disconnect-cpe"), "a decommission recovers the equipment");
        assert(!decomSteps.includes("perform-cutover"), "a decommission has no cutover");

        assertEq(migrationStepsForPhase("verify", "address-renumber").some((s) => s.id === "verify-dns"), true, "the DNS check is part of a renumber's verification");
        assertEq(migrationStepsForPhase("verify", "carrier-change").some((s) => s.id === "verify-dns"), false, "a carrier change does not verify DNS");
        assertEq(migrationStepOptions().length, MIGRATION_STEPS.length, "step options mirror the catalog");
      },
    },
    {
      name: "migrationRecords resolves the records to update or archive with a per-scenario action",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });

        const carrier = migrationRecords(s.circuit, set, "carrier-change");
        const byTarget = Object.fromEntries(carrier.map((r) => [r.target, r]));
        for (const id of ["circuit", "upstream", "cpe", "firewall", "lan", "domain", "certificate", "remoteAccess", "credential", "contact", "document", "tracker"]) {
          assert(byTarget[id], `carrier change touches the ${id} record`);
        }
        assertEq(byTarget.circuit.action, "update", "a carrier change updates the circuit");
        assertEq(byTarget.cpe.action, "update", "a carrier change keeps the CPE");
        assertEq(byTarget.firewall.collection, "configurations", "the firewall resolves from configurations");
        assert(byTarget.firewall.records.some((r) => r.id === s.firewall.id), "the firewall record is named");
        assert(byTarget.firewall.records.some((r) => r.id === s.security.id), "the security platform is named");
        assert(byTarget.tracker.records.some((r) => r.id === s.tracker.id), "the contract tracker resolves");
        assertEq(recordsToArchive(s.circuit, set, "carrier-change").length, 0, "a carrier change archives nothing");

        const decom = migrationRecords(s.circuit, set, "decommission");
        assertEq(decom.find((r) => r.target === "circuit").action, "archive", "a decommission archives the circuit");
        assertEq(recordsToArchive(s.circuit, set, "decommission").some((r) => r.target === "circuit"), true, "the circuit is in the archive list");

        const replace = migrationRecords(s.circuit, set, "cpe-replacement");
        assertEq(replace.find((r) => r.target === "cpe").action, "archive", "a CPE replacement archives the CPE");
        assertEq(recordsToArchive(s.circuit, set, "cpe-replacement").map((r) => r.target).join(","), "cpe", "only the CPE is archived");

        const relocate = migrationRecords(s.circuit, set, "relocation");
        assertEq(relocate.find((r) => r.target === "cpe").action, "archive", "a relocation replaces the CPE");
        assertEq(relocate.find((r) => r.target === "circuit").action, "update", "a relocation keeps the circuit record");
      },
    },
    {
      name: "migrationImpact resolves the dependents, the address change and the commercial position",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });

        const impact = migrationImpact(s.circuit, set, "carrier-change");
        assertEq(impact.scenario.id, "carrier-change", "the scenario is echoed");
        assertEq(impact.scenarioLabel, "Carrier / upstream change", "the scenario is labelled");
        assertEq(impact.risk, "high", "a carrier change is high risk");
        assert(impact.dependents.length >= 5, "the inbound dependents resolve: " + impact.dependents.map((d) => d.kind).join(", "));
        assert(impact.dependents.every((d) => d.record), "every dependent resolves to a record");
        assert(impact.dependents.some((d) => d.record.id === s.lan.id), "the LAN is a dependent");
        assert(impact.dependents.some((d) => d.record.id === s.contact.id), "the contact is a dependent");
        assertEq(impact.affected, impact.dependents.length, "the affected count matches the dependents");
        assertEq(impact.addressChange, null, "a carrier change makes no address change");
        assertEq(impact.commercial.sell, 100, "the sell price is carried");
        assertEq(impact.commercial.currency, "GBP", "the currency is carried");
        assertEq(impact.warnings.length, 0, "a fully-linked circuit raises no findings: " + JSON.stringify(impact.warnings));

        const renumber = migrationImpact(s.circuit, set, "address-renumber");
        assert(renumber.addressChange, "an address change carries the current addressing");
        assert(renumber.addressChange.current.includes("203.0.113.0/29"), "the subnet is listed");
        assert(renumber.addressChange.current.includes("203.0.113.2"), "the static IPs are listed");

        const decom = migrationImpact(s.circuit, set, "decommission");
        assert(codes(decom.warnings).includes("decommission-dependents"), "a decommission flags remote-access/certificate dependents");
      },
    },
    {
      name: "migrationImpact flags the findings that make a change risky",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        const bare = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Bare circuit", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "Aurora" }, ...CL })).record;
        const set = await world.docs.get(s.set.id, { force: true });

        assert(codes(migrationImpact(bare, set, "carrier-change").warnings).includes("no-dependents"), "a circuit with no dependents is flagged");
        assert(codes(migrationImpact(bare, set, "address-renumber").warnings).includes("renumber-no-addressing"), "a renumber with no recorded addressing is flagged");
        assert(codes(migrationImpact(bare, set, "cpe-replacement").warnings).includes("hardware-no-cpe"), "a CPE replacement with no CPE is flagged");
        assert(codes(migrationImpact(bare, set, "carrier-change").warnings).every((c) => c !== "renumber-no-addressing"), "a carrier change does not flag addressing");

        const impact = migrationImpact(bare, set, "cpe-replacement");
        assert(impact.warnings.every((w) => w.level === "warning" || w.level === "info"), "findings carry a level");
        assert(impact.warnings.every((w) => w.message), "findings carry a message");
      },
    },
    {
      name: "generateCircuitMigrationRunbook assembles every required section with the recorded values and the records each step touches",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitMigrationRunbook({ circuit: s.circuit, set, scenario: "carrier-change", site: s.location, preparedBy: "Tom" });

        assertEq(gen.runbookType, "circuit-migration", "the generated runbook is a circuit migration");
        assertEq(gen.service.id, s.circuit.id, "it references the circuit");
        assertEq(gen.site.id, s.location.id, "it references the site");
        assertEq(gen.scenario, "carrier-change", "it echoes the scenario");
        assertEq(gen.warnings.length, 0, "a fully-recorded circuit raises no gaps: " + JSON.stringify(gen.warnings));

        const cov = circuitMigrationCoverage({ body: gen.body });
        for (const sec of CIRCUIT_MIGRATION_SECTIONS) assert(cov[sec.id], `the body contains the “${sec.heading}” section`);
        assertEq(gen.sections.filter((x) => x.required).length, CIRCUIT_MIGRATION_SECTIONS.filter((x) => x.required).length, "every required section is declared");
        assertEq(gen.phases.length, MIGRATION_PHASES.length, "the phase map is returned");
        assertEq(gen.steps.length, stepsForScenario("carrier-change").length, "the scenario's steps are returned");

        assert(gen.body.startsWith("# Circuit migration & cutover runbook"), "the title is the first line");
        assert(gen.body.includes("National Wholesale"), "the upstream carrier is substituted");
        assert(gen.body.includes("aurora-ho.example.net"), "the public hostname is substituted");
        assert(gen.body.includes("2028-01-01"), "the contract end is substituted");
        assert(gen.body.includes("100 GBP"), "the sell price is substituted");
        assert(gen.body.includes("Head Office LAN"), "the dependent LAN is named");
        assert(gen.body.includes("Client VPN"), "the dependent remote access is named");
        assert(gen.body.includes("Records updated:"), "each step prints the records it updates");
        assert(gen.body.includes("## Records to update or archive"), "the records section is present");
        assert(gen.body.includes("| Record | Kind | Action | Why |"), "the records table is rendered");
        for (const step of stepsForScenario("carrier-change")) assert(gen.body.includes(step.title), `the body includes the step “${step.title}”`);

        const ren = generateCircuitMigrationRunbook({ circuit: s.circuit, set, scenario: "address-renumber", site: s.location });
        assert(ren.body.includes("203.0.113.0/29"), "a renumber runbook names the current subnet");
        assert(ren.body.includes("203.0.113.2"), "a renumber runbook names the current static IP");
        assert(ren.body.includes("Address change:"), "a renumber runbook carries the address-change note");
      },
    },
    {
      name: "generateCircuitMigrationRunbook marks missing facts TO COMPLETE, warns, and refuses a non-asset or unknown scenario",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        const bare = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Bare circuit", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "Aurora" }, ...CL })).record;
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitMigrationRunbook({ circuit: bare, set, scenario: "relocation" });
        const warnCodes = gen.warnings.map((w) => w.code);
        for (const code of ["no-dependents", "renumber-no-addressing", "hardware-no-cpe"]) {
          assert(warnCodes.includes(code), "warns " + code);
        }
        assert(gen.body.includes("TO COMPLETE"), "the gaps are marked TO COMPLETE in the body");

        const decom = generateCircuitMigrationRunbook({ circuit: bare, set, scenario: "decommission" });
        assert(decom.body.startsWith("# Circuit decommission & offboarding runbook"), "a decommission is titled as an offboarding");
        assert(decom.body.includes("Disconnect and cancel the service"), "a decommission lists the disconnect step");

        let threw = null;
        try {
          generateCircuitMigrationRunbook({ circuit: { type: "documents" }, set, scenario: "carrier-change" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "generating from a non-asset is refused");

        let threw2 = null;
        try {
          generateCircuitMigrationRunbook({ circuit: bare, set, scenario: "nope" });
        } catch (e) {
          threw2 = e;
        }
        assert(threw2 && threw2.code === "INVALID_DATA", "an unknown scenario is refused");
      },
    },
    {
      name: "generateCircuitMigrationChecklist emits the checks the scenario calls for, with phase/check steps and a pending sign-off",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });

        const gen = generateCircuitMigrationChecklist({ circuit: s.circuit, set, scenario: "relocation", assignee: "Tom", preparedBy: "Priya" });
        assertEq(gen.service.id, s.circuit.id, "it references the circuit");
        assertEq(gen.scenario, "relocation", "it echoes the scenario");
        assertEq(gen.defaultAssignee, "Tom", "the default assignee is stored");
        assertEq(gen.items.length, stepsForScenario("relocation").length, "one step per scenario step");
        assert(gen.items.every((i) => i.phase && migrationPhase(i.phase)), "every step carries a real phase");
        assert(gen.items.filter((i) => i.check).every((i) => migrationCheck(i.check)), "every tagged step carries a real check");
        assert(gen.items.every((i) => i.done === false), "generated steps start un-ticked");
        assertEq(gen.signOff.decision, "pending", "the sign-off starts pending");
        assertEq(gen.signOff.preparedBy, "Priya", "the preparer is recorded");
        assertEq(gen.coverage.complete, true, "a relocation covers every applicable check");
        for (const c of ["rollback", "dependents", "throughput", "dns", "failover", "monitoring", "records", "archive", "acceptance"]) {
          assert(gen.coverage.byCheck[c], `the checklist covers the ${c} check`);
        }

        const carrier = generateCircuitMigrationChecklist({ circuit: s.circuit, set, scenario: "carrier-change" });
        assertEq(carrier.coverage.complete, true, "a carrier change covers the checks that scenario calls for");
        assertEq(carrier.coverage.missing.length, 0, "nothing applicable is missing");
        assert(!carrier.coverage.required.includes("dns"), "a carrier change does not require the DNS check");

        const decom = generateCircuitMigrationChecklist({ circuit: s.circuit, set, scenario: "decommission" });
        assert(decom.name.toLowerCase().includes("decommission"), "a decommission checklist is named for the offboarding");
        assert(decom.items.some((i) => i.text === "Disconnect and cancel the service"), "the disconnect step is listed");
        assert(decom.items.some((i) => i.text === "Release the addressing and DNS"), "the address-release step is listed");
        assertEq(decom.coverage.complete, true, "a decommission covers its applicable checks");
        assert(!decom.coverage.required.includes("failover"), "a decommission does not require the failover check");
      },
    },
    {
      name: "migrationChecklistCoverage, migrationPhaseProgress, formatMigrationText and isMigrationChecklist read a generated checklist",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitMigrationChecklist({ circuit: s.circuit, set, scenario: "relocation", assignee: "Tom" });

        assert(isMigrationChecklist(gen), "a generated checklist is recognised as a migration checklist");
        const cov = migrationChecklistCoverage(gen);
        assertEq(cov.complete, true, "coverage reports complete");
        assertEq(cov.present, cov.total, "every required check is present");
        assertEq(cov.percent, 100, "coverage is 100%");

        const progress = migrationPhaseProgress(gen);
        assert(progress.assess && progress.assess.total >= 1, "the assess phase rolls up");
        assert(progress.prepare.total >= 1, "the prepare phase rolls up");
        assertEq(progress.other, undefined, "no unphased steps are present");
        assertEq(progress.assess.done, 0, "nothing is done yet");

        const text = formatMigrationText(gen, { set, site: s.location });
        assert(text.includes("# " + gen.name), "the text starts with the name");
        assert(text.includes("## Preparation & rollback plan"), "the text groups by phase");

        const graded = { ...gen, items: gen.items.map((i, n) => ({ ...i, done: n < 3 })) };
        const p2 = migrationPhaseProgress(graded);
        const doneTotal = Object.values(p2).reduce((sum, ph) => sum + ph.done, 0);
        assertEq(doneTotal, 3, "the graded progress totals the completed steps");
      },
    },
    {
      name: "a generated migration runbook and checklist round-trip through storage as valid, linked records",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        await linkAll(world, s);
        let set = await world.docs.get(s.set.id, { force: true });

        const genR = generateCircuitMigrationRunbook({ circuit: s.circuit, set, scenario: "carrier-change", site: s.location, preparedBy: "Tom" });
        const runbook = (await world.docs.addRunbook(s.set.id, {
          name: genR.name,
          runbookType: genR.runbookType,
          summary: genR.summary,
          body: genR.body,
          service: genR.service,
          site: genR.site,
          scenario: genR.scenario,
          origin: { source: "circuit-asset", circuitId: s.circuit.id, scenario: genR.scenario, warnings: genR.warnings },
          ...CL,
        })).record;

        const genC = generateCircuitMigrationChecklist({ circuit: s.circuit, set, scenario: "relocation", assignee: "Tom", preparedBy: "Tom" });
        const checklist = (await world.docs.addChecklist(s.set.id, {
          name: genC.name,
          description: genC.description,
          defaultAssignee: genC.defaultAssignee,
          phases: genC.phases,
          items: genC.items,
          signOff: genC.signOff,
          service: genC.service,
          scenario: genC.scenario,
          origin: { source: "circuit-asset", circuitId: s.circuit.id, scenario: genC.scenario, warnings: genC.warnings },
          ...CL,
        })).record;

        set = await world.docs.get(s.set.id, { force: true });
        const storedR = set.records.runbooks.find((x) => x.id === runbook.id);
        const storedC = set.records.checklists.find((x) => x.id === checklist.id);
        assertEq(storedR.body.length, genR.body.length, "the full generated runbook body is stored");
        assertEq(storedR.runbookType, "circuit-migration", "the runbook type is stored");
        assertEq(circuitMigrationCoverage(storedR).migrate, true, "the stored runbook still covers the cutover");
        assertEq(storedC.items.length, genC.items.length, "the checklist steps are stored");
        assertEq(storedC.items.every((i) => i.phase && migrationPhase(i.phase)), true, "the stored steps keep their phase");
        assertEq(storedC.scenario, "relocation", "the checklist scenario is stored");
        assertEq(migrationChecklistCoverage(storedC).complete, true, "the stored checklist still covers every check");
        assertEq(circuitMigrationIssues(set).length, 0, "a stored generated runbook+checklist raises no issues: " + JSON.stringify(circuitMigrationIssues(set)));
        assert((await world.docs.integrity(s.set.id)).ok, "the set's graph audit still passes");
      },
    },
    {
      name: "circuitMigrationIssues flags missing sections, a missing check, an unsigned or rejected checklist, and folds into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-migration" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });

        const gen = generateCircuitMigrationChecklist({ circuit: s.circuit, set, scenario: "carrier-change" });
        const full = await world.docs.addChecklist(s.set.id, {
          name: "Complete, unsigned",
          phases: gen.phases,
          items: gen.items.map((i) => ({ ...i, done: true })),
          signOff: { decision: "pending" },
          service: gen.service,
          scenario: gen.scenario,
          ...CL,
        });
        const partial = await world.docs.addChecklist(s.set.id, {
          name: "Partial",
          items: [{ text: "Just started", check: "rollback", phase: "prepare" }],
          scenario: "carrier-change",
          ...CL,
        });
        const rejected = (await world.docs.addChecklist(s.set.id, {
          name: "Rejected",
          phases: gen.phases,
          items: gen.items,
          signOff: { decision: "rejected", acceptedBy: "Client" },
          service: gen.service,
          scenario: gen.scenario,
          ...CL,
        })).record;
        const badRunbook = (await world.docs.addRunbook(s.set.id, { name: "Partial runbook", runbookType: "circuit-migration", body: "# x\n\n## Overview & impact assessment\n\nonly this", ...CL })).record;
        void full;

        const after = await world.docs.get(s.set.id, { force: true });
        const issues = circuitMigrationIssues(after);
        assert(issues.every((i) => i.level === "warning"), "migration findings are warnings");
        assert(codes(issues).includes("migration-runbook-missing-assess"), "a missing required runbook phase is flagged");
        assert(codes(issues).includes("migration-runbook-missing-recordActions"), "the missing records section is flagged");
        assert(codes(issues).includes("migration-runbook-no-circuit"), "an unlinked runbook is flagged");
        assert(codes(issues).includes("migration-checks-missing-dependents"), "a checklist missing a required check is flagged");
        assert(codes(issues).includes("migration-checks-unsigned"), "a fully-ticked but unsigned checklist is flagged");
        assert(codes(issues).includes("migration-checks-rejected"), "a rejected checklist is flagged");
        assert(issues.some((i) => i.recordId === badRunbook.id), "the finding names the runbook");
        assert(issues.some((i) => i.recordId === rejected.id), "the finding names the checklist");

        const folded = standardizedIssues(after);
        assert(codes(folded).includes("migration-runbook-missing-assess"), "the linter folds the migration audit in");
        assert(codes(folded).includes("migration-checks-missing-dependents"), "the linter folds the checklist audit in");
        assert((await world.docs.integrity(s.set.id)).ok, "migration gaps never fail the graph audit");
      },
    },
    {
      name: "the runbook catalog exposes the circuit migration type in the Internet group",
      fn: () => {
        assert(runbookType("circuit-migration"), "the circuit migration type exists");
        assertEq(runbookTypeLabel("circuit-migration"), "Internet/ISP circuit migration", "the type is labelled");
        assertEq(runbookType("circuit-migration").group, "Internet", "it sits in the Internet group");
        assertEq(circuitMigrationSection("migrate").required, true, "the cutover section is required");
        assertEq(circuitMigrationSection("signoff").required, false, "the sign-off section is optional");
        assertEq(circuitMigrationSection("bogus"), null, "an unknown section id is null");
        assertEq(circuitMigrationSection("assess").heading, "Impact assessment", "the impact section is named");
      },
    },
  ]);
}
