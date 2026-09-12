// src/framework/circuitMigration.js — circuit cutover, migration & decommission
// for resold circuits (roadmap task 44).
//
// Tasks 40–43 modelled the resold circuit, its provisioning runbook, its
// addressing/firewall handover and its commercial model. Task 44 is the CHANGE
// half: a circuit is not installed once and left alone — it is moved between
// carriers, re-rated up or down, renumbered, re-homed on new hardware, moved to
// a new site, and eventually offboarded. Each of those is a small project with
// an impact assessment on every dependent service, a cutover, a rollback, and a
// set of records that must be updated or archived when the change lands.
//
// This module is the shared model and the pure generators behind that:
//   • the SCENARIO catalog — carrier change, bandwidth up/downgrade, service-
//     definition change, address renumbering, CPE/firewall replacement, site
//     relocation and customer offboarding/decommission, each with a risk and the
//     flags that drive which steps and records apply;
//   • the PHASE catalog — the ordered acts of a migration;
//   • the STEP catalog — every step, its phase, the verification it proves and
//     the record targets it updates (so a migration is auditable like a
//     provisioning);
//   • `migrationImpact(circuit, set, scenario)` — the impact assessment: the
//     dependent services, the records to update or archive, the address change
//     and the commercial position;
//   • `migrationRecords(circuit, set, scenario)` — the records that must be
//     updated or archived when the circuit changes/ends;
//   • `generateCircuitMigrationRunbook({ circuit, set, scenario })` — the
//     migration/decommission runbook (a `circuit-migration` runbook record); and
//   • `generateCircuitMigrationChecklist({ circuit, set, scenario })` — the
//     cutover checklist with rollback, verification and acceptance (a checklist
//     record with `phase`/`check` steps, like the VoIP cutover checklist); and
//   • `circuitMigrationIssues(set)` — the audit the Linter folds in.
//
// Like ./circuitProvisioning.js this module is PURE (no storage): the generated
// runbook/checklist are ordinary records added through ./docsets.js.

import { relationsOf, findRecord } from "./relationships.js";
import { StoreError, CODES } from "./store/errors.js";
import { newId } from "./ids.js";
import { checklistItems, checklistProgress } from "./checklist.js";
import { circuitProfile, circuitDependents, circuitContract } from "./circuit.js";
import { circuitEdgeRecords } from "./addressing.js";
import { resolveProvisioningRecords } from "./circuitProvisioning.js";
import { makeCutoverSignOff } from "./cutover.js";

const str = (v) => String(v == null ? "" : v).trim();
const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const recordNames = (records) => (records || []).map((r) => r && r.name).filter(Boolean).join(", ");

// ---- scenarios -------------------------------------------------------------
// The changes a resold circuit goes through. `renumber` drives the addressing
// steps, `replacesHardware` the CPE steps, and `decommission` the offboarding
// steps (it retires rather than moves the service).
export const MIGRATION_SCENARIOS = [
  {
    id: "carrier-change", label: "Carrier / upstream change", icon: "link", risk: "high",
    renumber: false, replacesHardware: false, decommission: false,
    description: "Move the circuit to a different upstream/wholesale carrier while keeping the client's service.",
  },
  {
    id: "bandwidth-upgrade", label: "Bandwidth upgrade", icon: "arrow", risk: "medium",
    renumber: false, replacesHardware: false, decommission: false,
    description: "Move the circuit up to a faster service definition or higher committed bandwidth.",
  },
  {
    id: "bandwidth-downgrade", label: "Bandwidth downgrade", icon: "arrow", risk: "medium",
    renumber: false, replacesHardware: false, decommission: false,
    description: "Move the circuit down to a smaller service definition or lower committed bandwidth.",
  },
  {
    id: "service-change", label: "Service definition change", icon: "layers", risk: "medium",
    renumber: false, replacesHardware: false, decommission: false,
    description: "Re-tier the circuit — a change to the sold definition, SLA or contention without a carrier change.",
  },
  {
    id: "address-renumber", label: "Address renumbering", icon: "globe", risk: "high",
    renumber: true, replacesHardware: false, decommission: false,
    description: "Replace the circuit's static-IP/subnet allocation and re-point every service that depends on it.",
  },
  {
    id: "cpe-replacement", label: "CPE / firewall replacement", icon: "server", risk: "medium",
    renumber: false, replacesHardware: true, decommission: false,
    description: "Replace the router/CPE or edge firewall terminating the circuit.",
  },
  {
    id: "relocation", label: "Site relocation", icon: "map", risk: "high",
    renumber: true, replacesHardware: true, decommission: false,
    description: "Move the circuit and its equipment to a new site, renumbering and re-homing it.",
  },
  {
    id: "decommission", label: "Customer offboarding / decommission", icon: "trash", risk: "medium",
    renumber: false, replacesHardware: false, decommission: true,
    description: "Retire the circuit when the client offboards — disconnect, release addressing, settle and archive.",
  },
];

export const MIGRATION_SCENARIO_IDS = MIGRATION_SCENARIOS.map((s) => s.id);
export const migrationScenario = (id) => MIGRATION_SCENARIOS.find((s) => s.id === id) || null;
export const migrationScenarioLabel = (id) => (migrationScenario(id) || {}).label || "";
export const migrationScenarioOptions = () => MIGRATION_SCENARIOS.map((s) => ({ id: s.id, label: s.label }));

const ALL_SCENARIOS = MIGRATION_SCENARIO_IDS;
const NON_DECOM = MIGRATION_SCENARIO_IDS.filter((id) => id !== "decommission");
const RENUMBER_SCENARIOS = ["address-renumber", "relocation"];
const HARDWARE_SCENARIOS = ["cpe-replacement", "relocation"];
const CARRIER_SCENARIOS = ["carrier-change", "relocation"];
const CAPACITY_SCENARIOS = ["bandwidth-upgrade", "bandwidth-downgrade", "service-change"];

// ---- phases ----------------------------------------------------------------
export const MIGRATION_PHASES = [
  { id: "assess", order: 1, label: "Impact assessment", icon: "eye", summary: "Work out exactly what the change touches — every dependent service, the commercial position, and the records that must change — before anything is ordered." },
  { id: "approve", order: 2, label: "Approval & scheduling", icon: "clipboard", summary: "Get the change approved, agree the maintenance window and notify everyone affected, inside and outside the client." },
  { id: "prepare", order: 3, label: "Preparation & rollback plan", icon: "layers", summary: "Capture the baseline, raise the order, stage the hardware/config and write the rollback plan before the window opens." },
  { id: "migrate", order: 4, label: "Migration / cutover", icon: "rocket", summary: "Perform the switch itself — the new carrier/bandwidth/hardware/addresses — in the agreed window." },
  { id: "verify", order: 5, label: "Verification", icon: "check", summary: "Prove the change worked: throughput, DNS, every dependent service, failover and monitoring." },
  { id: "records", order: 6, label: "Records update & decommission", icon: "database", summary: "Update every record the change altered and archive or decommission what the circuit left behind." },
  { id: "close", order: 7, label: "Handover & closure", icon: "check", summary: "Hand the changed service back to the client, record acceptance and close the change." },
];

export const MIGRATION_PHASE_IDS = MIGRATION_PHASES.map((p) => p.id);
export const migrationPhase = (id) => MIGRATION_PHASES.find((p) => p.id === id) || null;
export const migrationPhaseLabel = (id) => (migrationPhase(id) || {}).label || "";
export const migrationPhaseOptions = () => MIGRATION_PHASES.map((p) => ({ id: p.id, label: p.label }));

// ---- required verifications ------------------------------------------------
// A generated migration checklist is "covered" when a step carrying each of
// these `check` ids is present, so coverage survives reordering and renaming.
export const MIGRATION_CHECKS = [
  { id: "rollback", label: "Rollback plan", phase: "prepare" },
  { id: "dependents", label: "Dependent services verified", phase: "verify" },
  { id: "throughput", label: "Throughput & latency verified", phase: "verify" },
  { id: "dns", label: "Forward & reverse DNS verified", phase: "verify" },
  { id: "failover", label: "Failover verified", phase: "verify" },
  { id: "monitoring", label: "Monitoring reconfigured", phase: "verify" },
  { id: "records", label: "Records updated & linked", phase: "records" },
  { id: "archive", label: "Old service retired / archived", phase: "records" },
  { id: "acceptance", label: "Client acceptance recorded", phase: "close" },
];

export const MIGRATION_CHECK_IDS = MIGRATION_CHECKS.map((c) => c.id);
export const migrationCheck = (id) => MIGRATION_CHECKS.find((c) => c.id === id) || null;
export const migrationCheckLabel = (id) => (migrationCheck(id) || {}).label || "";

// ---- the step catalog ------------------------------------------------------
// Every step, the scenarios it applies to, the verification it proves and the
// record targets it updates. `updates` uses the provisioning target ids
// (circuit/upstream/cpe/firewall/lan/credential/contact/document/tracker/runbook)
// so the resolver in ./circuitProvisioning.js can turn them into records.
export const MIGRATION_STEPS = [
  // assess
  { id: "assess-dependents", phase: "assess", scenarios: ALL_SCENARIOS, updates: ["circuit", "lan", "firewall", "contact"], title: "Map every dependent service", detail: "List the services, sites and people that run over this circuit — the LANs, voice platform, remote access, published DNS names and edge security — so nothing is missed when it changes." },
  { id: "assess-commercial", phase: "assess", scenarios: ALL_SCENARIOS, updates: ["circuit", "tracker"], title: "Assess the commercial impact", detail: "Work out the change in wholesale cost and sell price, any early-termination or reconnection fee, the proration on the final invoice, and the effect on the contract tracker." },
  { id: "assess-risk", phase: "assess", scenarios: ALL_SCENARIOS, updates: ["document"], title: "Assess the risk and the outage", detail: "Record the downtime risk, the blast radius, the fallback if the change fails, and the evidence the change is safe to make." },
  { id: "assess-plandrift", phase: "assess", scenarios: CAPACITY_SCENARIOS, updates: ["circuit"], title: "Compare the current plan with the target", detail: "Record the current service definition, committed/burst bandwidth and SLA against the target so the change is measured, not assumed." },
  { id: "assess-offboard", phase: "assess", scenarios: ["decommission"], updates: ["circuit", "contact", "tracker"], title: "Confirm the offboarding scope", detail: "Confirm the end date, what the client keeps (numbers, addresses, equipment), who owns the disconnect and what the contractual notice requires." },
  // approve
  { id: "approve-change", phase: "approve", scenarios: ALL_SCENARIOS, updates: ["contact", "document"], title: "Get the change approved", detail: "Record who approved the change and against which authority — the client for a service change, the provider for an internal one." },
  { id: "book-window", phase: "approve", scenarios: ALL_SCENARIOS, updates: ["contact", "document"], title: "Agree and book the window", detail: "Agree the maintenance window with the carrier and the client, record the start/end and the out-of-hours contacts." },
  { id: "notify-stakeholders", phase: "approve", scenarios: ALL_SCENARIOS, updates: ["contact"], title: "Notify the affected people", detail: "Tell every responsible contact — internal and client-side — what is changing, when, and what they may notice during the window." },
  // prepare
  { id: "backup-config", phase: "prepare", scenarios: ALL_SCENARIOS, checks: ["rollback"], updates: ["cpe", "document"], title: "Capture the pre-change baseline", detail: "Export the current configuration, addressing, firewall rules and call flows as the baseline to roll back to." },
  { id: "rollback-plan", phase: "prepare", scenarios: ALL_SCENARIOS, checks: ["rollback"], updates: ["document", "runbook"], title: "Write the rollback plan", detail: "Record the rollback criteria (when to abort), who decides, and the exact steps back to the pre-change state." },
  { id: "order-target", phase: "prepare", scenarios: CARRIER_SCENARIOS, updates: ["upstream", "circuit", "document"], title: "Order the new carrier / service", detail: "Place the order with the new upstream provider, record the order reference and exchange the LOA and handoff details." },
  { id: "raise-capacity", phase: "prepare", scenarios: CAPACITY_SCENARIOS, updates: ["upstream", "circuit"], title: "Raise the re-rate or service change", detail: "Raise the bandwidth/service-definition change with the carrier and record the effective date and the new committed values." },
  { id: "plan-addressing", phase: "prepare", scenarios: RENUMBER_SCENARIOS, checks: ["dns"], updates: ["circuit", "cpe"], title: "Plan the new addressing", detail: "Record the new static IP(s)/subnet(s), the reverse zones to arrange with the carrier and the mapping of old address to new." },
  { id: "update-dns-plan", phase: "prepare", scenarios: RENUMBER_SCENARIOS, updates: ["domains", "certificates", "circuit"], title: "Plan the DNS and certificate changes", detail: "Identify every forward (A/AAAA) and reverse (PTR) record and TLS certificate that names the old address and plan the change." },
  { id: "stage-cpe", phase: "prepare", scenarios: HARDWARE_SCENARIOS, updates: ["cpe", "credential"], title: "Stage the new CPE", detail: "Configure and stage the replacement router/CPE with its management address and credentials, ready to swap in." },
  { id: "configure-firewall", phase: "prepare", scenarios: [...HARDWARE_SCENARIOS, ...RENUMBER_SCENARIOS], updates: ["firewall", "cpe"], title: "Prepare the firewall changes", detail: "Stage the edge firewall/NAT/routing changes so the new path is ready to enable during the window." },
  // migrate
  { id: "perform-cutover", phase: "migrate", scenarios: NON_DECOM, updates: ["circuit", "cpe", "upstream"], title: "Perform the cutover", detail: "In the agreed window, bring up the new carrier/bandwidth/hardware and confirm the handoff is live before trusting traffic." },
  { id: "apply-addressing", phase: "migrate", scenarios: RENUMBER_SCENARIOS, updates: ["circuit", "cpe", "domains"], title: "Apply the new addressing", detail: "Cut over to the new static IP(s)/subnet(s), update the forward and reverse DNS, and confirm the new reverse delegation." },
  { id: "switch-routing", phase: "migrate", scenarios: NON_DECOM, updates: ["cpe", "lan", "firewall"], title: "Switch routing and NAT", detail: "Move the default route/NAT to the new path and confirm traffic takes the new circuit rather than the old one." },
  { id: "cancel-old-service", phase: "migrate", scenarios: ["decommission"], updates: ["upstream", "circuit", "document"], title: "Disconnect and cancel the service", detail: "Ask the carrier to end the service, record the ceasing date, the disconnect reference and any equipment return." },
  { id: "disconnect-cpe", phase: "migrate", scenarios: ["decommission"], updates: ["cpe", "credential"], title: "Disconnect and recover the equipment", detail: "Power down and recover the CPE/firewall, wipe or retain the configuration per the agreement, and record what happened to it." },
  { id: "release-addressing", phase: "migrate", scenarios: ["decommission"], updates: ["circuit", "domains"], title: "Release the addressing and DNS", detail: "Hand the static IP(s)/subnets back to the carrier and remove or repoint the forward and reverse DNS records that named them." },
  // verify
  { id: "verify-throughput", phase: "verify", scenarios: NON_DECOM, checks: ["throughput"], updates: ["circuit", "document"], title: "Verify throughput and latency", detail: "Test the changed circuit against the target committed/burst figures, latency, jitter and loss, and record the measured results." },
  { id: "verify-dns", phase: "verify", scenarios: RENUMBER_SCENARIOS, checks: ["dns"], updates: ["domains", "certificates"], title: "Verify forward and reverse DNS", detail: "Resolve every advertised name from outside and confirm the PTR names for the new addresses are correct." },
  { id: "verify-dependents", phase: "verify", scenarios: ALL_SCENARIOS, checks: ["dependents"], updates: ["lan", "firewall", "contact"], title: "Verify every dependent service", detail: "Walk the list of dependent services and confirm each one works over the changed circuit — don't rely on the link being up." },
  { id: "verify-failover", phase: "verify", scenarios: NON_DECOM, checks: ["failover"], updates: ["circuit", "cpe"], title: "Verify failover and redundancy", detail: "Test the failover path and confirm the dependent services behave as designed with the changed circuit." },
  { id: "reconfigure-monitoring", phase: "verify", scenarios: ALL_SCENARIOS, checks: ["monitoring"], updates: ["circuit", "contact"], title: "Reconfigure monitoring and alerts", detail: "Update monitoring for the new addresses, carrier and thresholds, and confirm alerts reach the right person." },
  // records
  { id: "update-records", phase: "records", scenarios: ALL_SCENARIOS, checks: ["records"], updates: ["circuit", "cpe", "firewall", "lan", "credential", "contact", "document", "tracker"], title: "Update every changed record", detail: "Update the circuit asset (carrier, bandwidth, addressing, dates), re-point the typed links, rotate credentials and update the dependent records and the contract tracker." },
  { id: "archive-old", phase: "records", scenarios: [...CARRIER_SCENARIOS, ...HARDWARE_SCENARIOS, "decommission"], checks: ["archive"], updates: ["cpe", "circuit", "document"], title: "Archive or decommission what was left behind", detail: "Archive the retired CPE, carrier account or old circuit, close the superseded links and mark the records that are no longer live." },
  { id: "settle-finance", phase: "records", scenarios: ["decommission", ...CARRIER_SCENARIOS], updates: ["tracker", "document"], title: "Settle the final invoice", detail: "Confirm the final invoice, any ceasing charges or credits, the proration and the closure of the contract tracker." },
  // close
  { id: "handover-change", phase: "close", scenarios: ALL_SCENARIOS, updates: ["contact", "document"], title: "Hand the service back", detail: "Confirm the client understands the changed service — the new speeds, addresses or arrangements — and knows how to raise an issue." },
  { id: "accept-signoff", phase: "close", scenarios: ALL_SCENARIOS, checks: ["acceptance"], updates: ["runbook", "contact"], title: "Record acceptance and close the change", detail: "Record the client's acceptance, mark the runbook and checklist complete, and confirm the documentation reflects the live service." },
];

export const MIGRATION_STEP_IDS = MIGRATION_STEPS.map((s) => s.id);
export const migrationStep = (id) => MIGRATION_STEPS.find((s) => s.id === id) || null;
export const migrationStepsForPhase = (phaseId, scenarioId) => MIGRATION_STEPS.filter((s) => s.phase === phaseId && (!scenarioId || (s.scenarios || []).includes(scenarioId)));
export const stepsForScenario = (scenarioId) => MIGRATION_STEPS.filter((s) => (s.scenarios || []).includes(scenarioId));
export const migrationStepOptions = () => MIGRATION_STEPS.map((s) => ({ id: s.id, label: s.title }));

// ---- the affected records --------------------------------------------------
// The records a migration must update or archive, resolved from the circuit's
// typed links and record fields, with a per-scenario action for each.
export function migrationRecords(circuit, set, scenarioId) {
  const scenario = migrationScenario(scenarioId) || migrationScenario("carrier-change");
  const edge = circuitEdgeRecords(circuit, set);
  const rows = [];
  const add = (target, label, collection, records, action, why) => {
    if (records && records.length) rows.push({ target, label, collection, action, why, records });
  };
  const hardwareAction = scenario.replacesHardware ? "archive" : "update";
  add("circuit", "Internet/WAN circuit", "flexibleAssets", [circuit], scenario.decommission ? "archive" : "update", scenario.decommission ? "mark the circuit ceased and keep it as the historical record" : "record the new carrier, bandwidth, addressing and dates, and re-point the links");
  add("upstream", "Upstream / wholesale carrier", "flexibleAssets", edge.upstream, "update", scenario.decommission ? "note the service end and close the account" : "update to the new upstream/wholesale provider");
  add("cpe", "Router / CPE", "configurations", edge.cpe, hardwareAction, scenario.replacesHardware ? "archive the retired CPE and link the replacement" : "record the changed config / management address");
  add("firewall", "Firewall & security platform", "configurations", [...edge.firewalls, ...edge.securityPlatforms], "update", scenario.decommission ? "remove the circuit's rules and close the edge" : "update the edge rules, NAT and routing for the new path");
  add("lan", "LAN(s) served", "flexibleAssets", edge.lan, "update", scenario.renumber ? "update the recorded hand-off addressing/VLANs" : "confirm the LAN routing still points at the circuit");
  add("domain", "Public domain(s)", "domains", edge.domains, "update", scenario.renumber ? "re-point forward DNS to the new addresses" : "confirm the published name still resolves");
  add("certificate", "TLS certificate(s)", "certificates", edge.certificates, "update", scenario.renumber ? "reissue/validate against the new addresses" : "confirm the certificate still covers the service");
  add("remoteAccess", "Remote access", "flexibleAssets", edge.remoteAccess, "update", scenario.decommission ? "remove or re-home the remote access that used this circuit" : "update the endpoint/port-forward to the new address");
  add("credential", "Credential(s)", "passwords", edge.credentials, "update", scenario.replacesHardware ? "rotate the replaced device's credentials" : "rotate the carrier/CPE credentials as the path changes");
  add("contact", "Responsible contact(s)", "contacts", edge.contacts, "update", "notify and, where ownership changes, reassign responsibility");
  add("document", "Supporting document(s)", "documents", edge.documents, "update", "file order confirmations, test results and the closure evidence");
  const trackers = (set && set.records && set.records.trackers ? set.records.trackers : []).filter((t) => JSON.stringify(t).includes(circuit.id));
  add("tracker", "Contract / renewal tracker", "trackers", trackers, "update", scenario.decommission ? "close the tracker at the ceasing date" : "update the contract dates and renewal");
  return rows;
}

// The records a migration must archive (a subset of migrationRecords).
export const recordsToArchive = (circuit, set, scenarioId) => migrationRecords(circuit, set, scenarioId).filter((r) => r.action === "archive");

// ---- the impact assessment -------------------------------------------------
// The pre-change picture the runbook and the UI render: the dependent services,
// the records to update or archive, the address change and the commercial
// position, plus the findings that make this change risky.
export function migrationImpact(circuit, set, scenarioId) {
  const scenario = migrationScenario(scenarioId) || migrationScenario("carrier-change");
  const profile = circuitProfile(circuit);
  const contract = profile.contract || circuitContract(circuit);
  const edge = circuitEdgeRecords(circuit, set);
  // The blast radius: the records that declare they depend on the circuit (a
  // voice platform or contact links TO it) plus the services the circuit serves
  // (the LANs, remote access, published domains and certificates linked FROM it).
  const inbound = circuitDependents(circuit, set)
    .map((d) => ({ kind: d.kind, record: findRecord(set, d.target) || null, ref: d.target, source: "linked" }))
    .filter((d) => d.record);
  const edgeService = (kind, records) => (records || []).map((r) => ({ kind, record: r, ref: { type: r.type, id: r.id }, source: "edge" }));
  const seen = new Set();
  const dependents = [
    ...inbound,
    ...edgeService("circuit-lan", edge.lan),
    ...edgeService("circuit-remote-access", edge.remoteAccess),
    ...edgeService("circuit-domain", edge.domains),
    ...edgeService("circuit-certificate", edge.certificates),
  ].filter((d) => {
    const key = (d.record.type || "") + ":" + d.record.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const records = migrationRecords(circuit, set, scenario.id);
  const toUpdate = records.filter((r) => r.action === "update");
  const toArchive = records.filter((r) => r.action === "archive");
  const warnings = [];
  const warn = (code, level, message) => warnings.push({ code, level, message });
  if (!dependents.length) {
    warn("no-dependents", "warning", `No dependent service is linked to “${circuit.name}” — the impact of changing it cannot be assessed from the documentation.`);
  }
  if (contract.expiringSoon) warn("contract-expiring", "info", `The circuit contract ends in ${contract.daysLeft} day(s) — the change may be better timed with the renewal.`);
  if (scenario.renumber && !(profile.addressing && profile.addressing.hasAddressing)) warn("renumber-no-addressing", "warning", `An address change is planned but “${circuit.name}” records no static-IP or subnet allocation to renumber.`);
  if (scenario.replacesHardware && !edge.cpe.length) warn("hardware-no-cpe", "warning", `A CPE replacement is planned but no router/CPE is linked to “${circuit.name}”.`);
  if (scenario.decommission && (edge.remoteAccess.length || edge.certificates.length)) warn("decommission-dependents", "warning", `Remote-access or certificate records still depend on “${circuit.name}” — re-home them before the circuit ends.`);
  return {
    scenario,
    scenarioLabel: scenario.label,
    risk: scenario.risk,
    profile,
    contract,
    dependents,
    edge,
    recordsToUpdate: toUpdate,
    recordsToArchive: toArchive,
    addressChange: scenario.renumber
      ? { current: profile.addressing ? profile.addressing.subnetStrings.concat(profile.addressing.staticIps) : [], note: "Every service published on the old addresses must move to the new block." }
      : null,
    commercial: {
      currency: profile.pricing.currency,
      cost: profile.pricing.cost,
      sell: profile.pricing.sell,
      margin: profile.pricing.margin,
      marginPct: profile.pricing.marginPct,
      contractEnd: contract.end,
      daysLeft: contract.daysLeft,
    },
    affected: dependents.length,
    warnings,
  };
}

// ---- resolution for the runbook --------------------------------------------
// A target id → its records, using the provisioning resolver plus the migration
// runbooks for the "runbook" target.
function resolveTargets(circuit, set) {
  const base = resolveProvisioningRecords(circuit, set);
  const migrations = ((set && set.records && set.records.runbooks) || []).filter(
    (r) => r.runbookType === "circuit-migration" && ((r.service && r.service.id === circuit.id) || (r.origin && r.origin.circuitId === circuit.id)),
  );
  return { ...base, runbook: migrations };
}
const resolvedNames = (resolved, targets) => {
  const out = [];
  for (const t of targets || []) {
    const records = resolved[t] || [];
    out.push({ target: t, records, names: recordNames(records) });
  }
  return out;
};

// ---- the runbook generator -------------------------------------------------
export const CIRCUIT_MIGRATION_SECTIONS = [
  { id: "overview", heading: "Overview & impact assessment", required: true },
  ...MIGRATION_PHASES.map((p) => ({ id: p.id, heading: p.label, phase: p.id, required: true })),
  { id: "recordActions", heading: "Records to update or archive", required: true },
  { id: "signoff", heading: "Roles, contacts & sign-off", required: false },
];

export const circuitMigrationSection = (id) => CIRCUIT_MIGRATION_SECTIONS.find((s) => s.id === id) || null;

const headingsOf = (body) =>
  new Set(
    String(body || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.match(/^##\s+(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => m[1].trim().toLowerCase()),
  );

export function circuitMigrationCoverage(record) {
  const heads = headingsOf(record && record.body);
  const out = {};
  for (const s of CIRCUIT_MIGRATION_SECTIONS) out[s.id] = heads.has(s.heading.toLowerCase());
  return out;
}

const factLines = (pairs) =>
  pairs.map(([label, value]) => {
    if (isBlank(value)) return `- **${label}:** _[TO COMPLETE: record the ${label.toLowerCase()}]_`;
    return `- **${label}:** ${Array.isArray(value) ? value.join(", ") : String(value)}`;
  });

// Assemble a migration / decommission runbook from a resold circuit and a
// scenario. The body names every dependent service and every record to update or
// archive, marks each gap TO COMPLETE, and returns them in `warnings`.
export function generateCircuitMigrationRunbook({ circuit, set, scenario: scenarioId, site, preparedBy, title, now = Date.now() } = {}) {
  if (!circuit || circuit.type !== "flexibleAssets") {
    throw new StoreError(CODES.INVALID_DATA, "A circuit migration runbook needs an Internet/WAN circuit asset to generate from.");
  }
  const scenario = migrationScenario(scenarioId);
  if (!scenario) throw new StoreError(CODES.INVALID_DATA, `Unknown migration scenario “${scenarioId}”.`);
  const impact = migrationImpact(circuit, set, scenario.id);
  const resolved = resolveTargets(circuit, set);
  const profile = impact.profile;
  const siteLabel = site && (site.name || site.label) ? site.name || site.label : "";
  const generatedOn = new Date(now).toISOString().slice(0, 10);
  const steps = stepsForScenario(scenario.id);
  const warnings = impact.warnings.map((w) => ({ code: w.code, message: w.message }));
  const L = [];
  const push = (...lines) => L.push(...lines);
  const section = (heading) => push("", "## " + heading, "");

  push(`# Circuit ${scenario.decommission ? "decommission & offboarding" : "migration & cutover"} runbook — ${circuit.name}`, "");
  push(`**Scenario: ${scenario.label}**${siteLabel ? " · " + siteLabel : ""} — ${scenario.description}`, "");
  push(`_Generated from the Internet/WAN circuit asset “${circuit.name}” on ${generatedOn}${preparedBy ? " by " + preparedBy : ""}. Every step names the records it updates; every gap is marked TO COMPLETE._`);

  // ---- overview & impact assessment ----
  section("Overview & impact assessment");
  push(...factLines([
    ["Scenario", scenario.label],
    ["Risk", scenario.risk],
    ["Circuit asset", circuit.name],
    ["Site", siteLabel],
    ["Carrier (branded)", profile.carrier],
    ["Upstream / wholesale carrier", profile.upstreamCarrier],
    ["Access technology", profile.accessLabel],
    ["Service definition", profile.serviceDefinitionLabel],
    ["Committed bandwidth", profile.bandwidth],
    ["SLA target", profile.sla],
    ["Contract end", impact.contract.end || ""],
    ["Contract days left", impact.contract.daysLeft != null ? String(impact.contract.daysLeft) : ""],
    ["Wholesale cost / month", impact.commercial.cost != null ? impact.commercial.cost + " " + impact.commercial.currency : ""],
    ["Sell price / month", impact.commercial.sell != null ? impact.commercial.sell + " " + impact.commercial.currency : ""],
    ["Margin", impact.commercial.marginPct != null ? impact.commercial.marginPct + "%" : ""],
  ]));
  push("", "**Dependent services (the blast radius)**", "");
  push(...(impact.dependents.length ? impact.dependents.map((d) => `- ${d.kind} → **${d.record.name}**`) : ["- _[TO COMPLETE: link the LANs, voice platform, remote access, domains, certificates and contacts that depend on this circuit.]_"]));
  if (impact.addressChange) {
    push("", `> **Address change:** ${impact.addressChange.note} Current addressing: ${impact.addressChange.current.length ? impact.addressChange.current.join(", ") : "_[TO COMPLETE]_"}.`);
  }
  if (impact.warnings.length) {
    push("", "**Findings**", "");
    for (const w of impact.warnings) push(`- ${w.level === "warning" ? "⚠" : "ℹ"} ${w.message}`);
  }

  // ---- each phase ----
  for (const phase of MIGRATION_PHASES) {
    section(phase.label);
    push(phase.summary, "");
    const phaseSteps = migrationStepsForPhase(phase.id, scenario.id);
    if (!phaseSteps.length) {
      push("_[No steps for this phase in this scenario.]_");
      continue;
    }
    phaseSteps.forEach((step, i) => {
      push(`${i + 1}. **${step.title}** — ${step.detail}`);
      const mapped = resolvedNames(resolved, step.updates);
      push(`   - _Records updated:_ ${mapped.map((m) => `${m.target}: ${m.names || "none recorded"}`).join(" · ") || "—"}`);
    });
  }

  // ---- the records to update or archive ----
  section("Records to update or archive");
  push("Every record this change touches, and whether it is updated or archived when the circuit changes or ends.", "");
  push("| Record | Kind | Action | Why |", "| --- | --- | --- | --- |");
  for (const r of [...impact.recordsToUpdate, ...impact.recordsToArchive]) {
    const names = recordNames(r.records);
    push(`| ${r.label}${names ? " — " + names : ""} | ${r.collection} | ${r.action} | ${r.why} |`);
  }

  // ---- sign-off ----
  section("Roles, contacts & sign-off");
  push("| Role | Name | Contact |", "| --- | --- | --- |", "| Change lead | | |", "| Carrier / upstream provider | | |", "| Client approver | | |", "");
  push(`_Runbook generated for “${circuit.name}” on ${generatedOn}. Update every listed record when the change lands, and archive what the circuit left behind._`);

  const name = !isBlank(title) ? title : `Circuit ${scenario.decommission ? "decommission" : "migration"} — ${circuit.name} (${scenario.label})`;
  const summary = `${scenario.label} for ${circuit.name}` + (siteLabel ? ` at ${siteLabel}` : "") + ` — ${impact.dependents.length} dependent service(s).`;
  return {
    name,
    summary,
    body: L.join("\n"),
    runbookType: "circuit-migration",
    service: { type: circuit.type, id: circuit.id },
    site: site && site.id ? { type: site.type, id: site.id } : null,
    scenario: scenario.id,
    sections: CIRCUIT_MIGRATION_SECTIONS.map((s) => ({ id: s.id, heading: s.heading, required: s.required })),
    phases: MIGRATION_PHASES.map((p) => ({ id: p.id, label: p.label, steps: migrationStepsForPhase(p.id, scenario.id).map((s) => s.id) })),
    steps: steps.map((s) => s.id),
    impact,
    warnings,
    generatedAt: now,
  };
}

// ---- the checklist generator ----------------------------------------------
function makeStepItem(step, now, assignee = "") {
  return {
    id: newId("step"),
    text: step.title,
    phase: migrationPhase(step.phase) ? step.phase : "",
    check: (step.checks || []).find((c) => migrationCheck(c)) || "",
    hint: step.detail || "",
    done: false,
    assignee: str(assignee),
    dueDate: "",
    notes: "",
    doneAt: null,
    doneBy: "",
    createdAt: now,
  };
}

export const isMigrationChecklist = (record) =>
  !!(record && ((Array.isArray(record.phases) && record.phases.some((p) => MIGRATION_PHASE_IDS.includes(p.id))) || checklistItems(record).some((i) => i && MIGRATION_CHECK_IDS.includes(i.check))));

// Assemble a migration cutover checklist (with rollback and acceptance) from a
// circuit and scenario, ready for docs.addChecklist().
export function generateCircuitMigrationChecklist({ circuit, set, scenario: scenarioId, assignee, preparedBy, title, now = Date.now() } = {}) {
  if (!circuit || circuit.type !== "flexibleAssets") {
    throw new StoreError(CODES.INVALID_DATA, "A circuit migration checklist needs an Internet/WAN circuit asset to generate from.");
  }
  const scenario = migrationScenario(scenarioId);
  if (!scenario) throw new StoreError(CODES.INVALID_DATA, `Unknown migration scenario “${scenarioId}”.`);
  const impact = migrationImpact(circuit, set, scenario.id);
  const items = stepsForScenario(scenario.id).map((step) => makeStepItem(step, now, assignee));
  const name = !isBlank(title) ? title : `Circuit ${scenario.decommission ? "decommission" : "migration"} checklist — ${circuit.name} (${scenario.label})`;
  const description = `Cutover checklist for the ${scenario.label.toLowerCase()} of “${circuit.name}”, covering the impact assessment, preparation and rollback, the cutover, verification of every dependent service, the records to update or archive and the client's acceptance.`;
  return {
    name,
    description,
    defaultAssignee: str(assignee),
    phases: MIGRATION_PHASES.map((p) => ({ id: p.id, label: p.label })),
    items,
    signOff: makeCutoverSignOff({ preparedBy }, now),
    service: { type: circuit.type, id: circuit.id },
    scenario: scenario.id,
    generatedAt: now,
    warnings: impact.warnings.map((w) => ({ code: w.code, message: w.message })),
    coverage: migrationChecklistCoverage({ items, scenario: scenario.id }),
  };
}

// Which verifications a migration checklist must contain. The scenario decides
// which apply — a pure carrier change needs no DNS step, a renumber does — so a
// checklist is "complete" when it carries every check the scenario's step
// catalog calls for. Without a scenario the full catalog is required.
export function migrationChecklistCoverage(record) {
  const items = checklistItems(record);
  const scenario = record && record.scenario ? migrationScenario(record.scenario) : null;
  const required = scenario
    ? MIGRATION_CHECKS.filter((c) => stepsForScenario(scenario.id).some((s) => (s.checks || []).includes(c.id)))
    : MIGRATION_CHECKS;
  const present = new Set(items.map((i) => i && i.check).filter(Boolean));
  const byCheck = {};
  for (const c of MIGRATION_CHECKS) byCheck[c.id] = present.has(c.id);
  const missing = required.filter((c) => !present.has(c.id)).map((c) => c.id);
  const count = required.length - missing.length;
  return {
    total: required.length,
    present: count,
    missing,
    required: required.map((c) => c.id),
    complete: missing.length === 0,
    percent: required.length ? Math.round((count / required.length) * 100) : 100,
    byCheck,
  };
}

// Progress rolled up per phase (plus an `other` bucket for unphased steps).
export function migrationPhaseProgress(record) {
  const items = checklistItems(record);
  const out = {};
  const claimed = new Set();
  for (const p of MIGRATION_PHASES) {
    const sub = items.filter((i) => i && i.phase === p.id);
    sub.forEach((i) => claimed.add(i.id));
    out[p.id] = { id: p.id, label: p.label, ...checklistProgress(sub) };
  }
  const extras = items.filter((i) => i && !claimed.has(i.id));
  if (extras.length) out.other = { id: "other", label: "Other", ...checklistProgress(extras) };
  return out;
}

// A migration-specific text rendering grouped by phase (copy-as-text).
export function formatMigrationText(record, { set, site } = {}) {
  const lines = ["# " + (str(record && record.name) || "Migration checklist")];
  if (set && set.name) lines.push("Client: " + set.name);
  if (site && site.name) lines.push("Site: " + site.name);
  if (record && str(record.description)) lines.push("", str(record.description));
  const p = checklistProgress(record);
  lines.push("", `Progress: ${p.done}/${p.total} complete${p.complete ? " ✓" : ""}`);
  const byPhase = migrationPhaseProgress(record);
  for (const phase of MIGRATION_PHASES) {
    const sub = checklistItems(record).filter((i) => i && i.phase === phase.id);
    if (!sub.length) continue;
    lines.push("", `## ${phase.label} (${byPhase[phase.id].done}/${byPhase[phase.id].total})`);
    for (const item of sub) {
      let line = `- ${item.done ? "[x]" : "[ ]"} ${item.text}`;
      if (item.assignee) line += ` (@${item.assignee})`;
      lines.push(line);
    }
  }
  return lines.join("\n");
}

// ---- the audit -------------------------------------------------------------
// Flags a circuit-migration runbook missing a required section or not linked to
// its circuit, and a migration checklist missing a required verification, left
// unsigned after completion, or rejected. Every finding is a warning.
export function circuitMigrationIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.runbooks || []) {
    if (r.runbookType !== "circuit-migration") continue;
    if (isBlank(r.body)) continue;
    const cov = circuitMigrationCoverage(r);
    for (const s of CIRCUIT_MIGRATION_SECTIONS) {
      if (!s.required || cov[s.id]) continue;
      issues.push({ level: "warning", code: "migration-runbook-missing-" + s.id, recordId: r.id, message: `Circuit migration runbook “${r.name}” is missing the “${s.heading}” section.` });
    }
    const linked = relationsOf(set, { type: r.type, id: r.id }).some((x) => ["runbook-service", "asset-reference"].includes(x.relationship.kind));
    if (!(r.service && r.service.id) && !linked && !(r.origin && r.origin.circuitId)) {
      issues.push({ level: "warning", code: "migration-runbook-no-circuit", recordId: r.id, message: `Circuit migration runbook “${r.name}” is not linked to the circuit it migrates.` });
    }
  }
  for (const r of set.records.checklists || []) {
    if (!isMigrationChecklist(r)) continue;
    const cov = migrationChecklistCoverage(r);
    for (const id of cov.missing) {
      issues.push({ level: "warning", code: "migration-checks-missing-" + id, recordId: r.id, message: `Migration checklist “${r.name}” is missing the “${migrationCheckLabel(id)}” step.` });
    }
    const p = checklistProgress(r);
    const decision = r.signOff && r.signOff.decision;
    if (p.complete && (!decision || decision === "pending")) {
      issues.push({ level: "warning", code: "migration-checks-unsigned", recordId: r.id, message: `Migration checklist “${r.name}” is fully ticked but no client acceptance has been recorded.` });
    }
    if (decision === "rejected") {
      issues.push({ level: "warning", code: "migration-checks-rejected", recordId: r.id, message: `Migration checklist “${r.name}” was rejected — resolve the issues and re-run the change.` });
    }
  }
  return issues;
}
