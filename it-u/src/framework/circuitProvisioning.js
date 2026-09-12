// src/framework/circuitProvisioning.js — the resold-circuit provisioning &
// activation workflow (roadmap task 41, "Provisioning & activation workflow
// documentation").
//
// Task 40 modelled the resold circuit as a record; task 41 is the PROCEDURE that
// brings one live. A technician who did not sell the circuit must be able to
// pick up the record and stand the service up in the right order — order
// capture, the upstream carrier handoff, CPE selection and configuration, IP
// addressing and reverse DNS, the firewall and routing changes, activation,
// connectivity and throughput testing, redundancy/failover, and the customer
// acceptance — with every step mapped to the records it updates.
//
// This module is the shared model and the pure generator behind that:
//   • the PHASE catalog — the nine ordered stages of a provisioning;
//   • the TARGET catalog — the kinds of record a provisioning touches (the
//     circuit itself, the upstream vendor, the CPE, the firewall, the LANs, the
//     credentials, the contacts, the documents, the contract tracker);
//   • the STEP catalog — every step, its phase, its instruction and the record
//     targets it updates (the "mapped to the records it updates" obligation);
//   • `resolveProvisioningRecords(circuit, set)` — the far-side records a step
//     touches, resolved by the typed links and record fields from task 40; and
//   • `generateCircuitProvisioningRunbook({ circuit, set, site })` — assembles
//     the runbook body from the recorded values, marking every gap TO COMPLETE
//     and returning them in `warnings`; and
//   • `circuitProvisioningIssues(set)` — the runbook audit the Linter folds in.
//
// The generated runbook is a normal `runbooks` record of type
// `circuit-provisioning` (see ./runbook.js), versioned and reviewable like any
// other, so the procedure itself is a first-class, governed document.

import { assetFieldsOf } from "./flexible.js";
import { relationsOf, findRecord } from "./relationships.js";
import { StoreError, CODES } from "./store/errors.js";
import {
  circuitProfile,
  circuitDependents,
  circuitDefinitionDrift,
  committedBandwidth,
  bandwidthSummary,
  addressingSummary,
  circuitContract,
} from "./circuit.js";

const str = (v) => String(v == null ? "" : v).trim();
const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const fieldsOf = (record) => (record ? assetFieldsOf(record) : {});

// ---- phases -----------------------------------------------------------------
// The ordered stages of bringing a resold circuit live. `order` is the sequence
// the runbook is written and executed in.
export const PROVISIONING_PHASES = [
  { id: "order", order: 1, label: "Order capture", icon: "clipboard", summary: "Capture exactly what the client bought before anything is ordered — the service definition, bandwidth, SLA and price — and stand up the contract tracker." },
  { id: "handoff", order: 2, label: "Upstream carrier handoff", icon: "link", summary: "Place the order with the upstream/wholesale carrier and exchange the handoff details — LOA, circuit ID, account and access appointment — so the carrier and the provider agree on the same circuit." },
  { id: "cpe", order: 3, label: "CPE selection & configuration", icon: "server", summary: "Choose and configure the router/CPE that terminates the circuit, matching the sold service definition and access technology." },
  { id: "addressing", order: 4, label: "IP addressing, subnets & reverse DNS", icon: "globe", summary: "Record the static-IP and subnet allocation, the gateway and the public hostname, and set up forward and reverse DNS so services that depend on the address work." },
  { id: "firewall", order: 5, label: "Firewall & routing changes", icon: "shield", summary: "Apply the firewall, NAT and routing changes the circuit needs, then hand the usable address range to the customer LAN." },
  { id: "activation", order: 6, label: "Service activation", icon: "rocket", summary: "Activate the service at the carrier, confirm the handoff is up, and verify the circuit end to end." },
  { id: "testing", order: 7, label: "Connectivity & throughput testing", icon: "check", summary: "Prove the circuit delivers what was sold — throughput at peak, latency/jitter/loss, and monitoring that will alert before the client notices." },
  { id: "redundancy", order: 8, label: "Redundancy & failover", icon: "link", summary: "Confirm the failover path across multiple circuits works, and record how the dependent services behave when the primary drops." },
  { id: "acceptance", order: 9, label: "Customer acceptance", icon: "check", summary: "Hand the service over: walk the client through it, record acceptance, and leave the documentation complete and lifecycle-aware." },
];

export const PROVISIONING_PHASE_IDS = PROVISIONING_PHASES.map((p) => p.id);
export const provisioningPhase = (id) => PROVISIONING_PHASES.find((p) => p.id === id) || null;
export const provisioningPhaseLabel = (id) => (provisioningPhase(id) || {}).label || "";
export const provisioningPhaseOptions = () => PROVISIONING_PHASES.map((p) => ({ id: p.id, label: p.label }));

// ---- record targets ---------------------------------------------------------
// The kinds of record a provisioning touches. `collection` is the record bucket
// the target lives in; `required` marks the targets every resold circuit should
// end up with. The resolver below turns a target into the actual records in a
// given documentation set.
export const PROVISIONING_TARGETS = [
  { id: "circuit", label: "Internet/WAN circuit", collection: "flexibleAssets", required: true, help: "The resold circuit asset itself — its fields are updated throughout the provisioning." },
  { id: "upstream", label: "Upstream / wholesale carrier", collection: "flexibleAssets", required: true, help: "The carrier or wholesaler the circuit is bought from." },
  { id: "cpe", label: "Router / CPE", collection: "configurations", required: true, help: "The router, firewall or ONT that terminates the circuit at the site." },
  { id: "firewall", label: "Firewall / security platform", collection: "flexibleAssets", required: false, help: "The firewall or security platform that guards the circuit edge." },
  { id: "lan", label: "LAN(s) served", collection: "flexibleAssets", required: false, help: "The internal networks this circuit feeds." },
  { id: "credential", label: "Credential(s)", collection: "passwords", required: false, help: "The CPE, carrier portal or management credentials the circuit needs." },
  { id: "contact", label: "Responsible contact", collection: "contacts", required: true, help: "The person accountable for the circuit and the carrier liaison." },
  { id: "document", label: "Supporting document(s)", collection: "documents", required: false, help: "Order confirmations, test results and handover records." },
  { id: "tracker", label: "Contract / renewal tracker", collection: "trackers", required: false, help: "The tracker that watches the circuit's contract end date." },
  { id: "runbook", label: "This deployment runbook", collection: "runbooks", required: true, help: "The provisioning runbook itself, filed against the circuit." },
];

export const PROVISIONING_TARGET_IDS = PROVISIONING_TARGETS.map((t) => t.id);
export const provisioningTarget = (id) => PROVISIONING_TARGETS.find((t) => t.id === id) || null;

// ---- the step catalog -------------------------------------------------------
// Every step a provisioning follows. `updates` names the record targets the step
// touches — this is the "each step mapped to the records it updates" obligation,
// and the generator prints it under every step.
export const PROVISIONING_STEPS = [
  {
    id: "capture-order", phase: "order",
    title: "Capture the order and the sold definition",
    detail: "Record on the circuit asset exactly what the client bought: the service definition (tier), the committed and burst bandwidth, the SLA target and the access technology. Everything downstream is checked against this.",
    updates: ["circuit", "contact", "tracker"],
  },
  {
    id: "confirm-commercials", phase: "order",
    title: "Confirm the commercials and the contract term",
    detail: "Record the wholesale cost and the sell price, the contract start, term and end date, and the billing cycle. Create the contract tracker so the renewal is never missed.",
    updates: ["circuit", "tracker"],
  },
  {
    id: "raise-upstream-order", phase: "handoff",
    title: "Raise the order with the upstream carrier",
    detail: "Place the order against the wholesale agreement and record the carrier's order reference and expected delivery date on the circuit.",
    updates: ["upstream", "circuit", "document"],
  },
  {
    id: "exchange-handoff", phase: "handoff",
    title: "Exchange the carrier handoff details",
    detail: "Collect the LOA, the carrier circuit ID, the account number and the handoff/interface type, and record them on the circuit and the upstream vendor record.",
    updates: ["upstream", "circuit", "credential"],
  },
  {
    id: "track-installation", phase: "handoff",
    title: "Track the installation and the access appointment",
    detail: "Track the carrier's access appointment and any site access or wayleave requirements; keep the responsible contact informed of the date and what is needed on the day.",
    updates: ["upstream", "contact", "document"],
  },
  {
    id: "select-cpe", phase: "cpe",
    title: "Select the CPE for the service definition",
    detail: "Choose a router/CPE that supports the sold bandwidth, the SLA and the access technology, and record the CPE role and the chosen device on the circuit.",
    updates: ["cpe", "circuit"],
  },
  {
    id: "configure-cpe", phase: "cpe",
    title: "Configure the CPE",
    detail: "Configure the WAN interface for the carrier handoff, the LAN side, NAT, DHCP, DNS and any firewall functions, and set a management address the provider can reach.",
    updates: ["cpe", "credential"],
  },
  {
    id: "record-cpe", phase: "cpe",
    title: "Record the CPE as documentation",
    detail: "Create (or update) the configuration record for the CPE — make, model, serial, firmware, management address — and link it to the circuit so the dependency is documented.",
    updates: ["cpe", "circuit", "credential"],
  },
  {
    id: "allocate-addresses", phase: "addressing",
    title: "Record the IP addressing and subnet allocation",
    detail: "Record the static IP(s), the subnet(s), the gateway and the usable/declared address counts on the circuit, and assign the inside addressing on the CPE.",
    updates: ["circuit", "cpe"],
  },
  {
    id: "reverse-dns", phase: "addressing",
    title: "Set up forward and reverse DNS",
    detail: "Record the public hostname for the circuit and arrange the forward (A/AAAA) and reverse (PTR) DNS that services depending on the address require. Reverse DNS is delegated by the carrier — confirm the delegation.",
    updates: ["circuit", "document"],
  },
  {
    id: "firewall-changes", phase: "firewall",
    title: "Apply the firewall and security changes",
    detail: "Open only the inbound access the service needs, restrict it to the expected sources, and record the firewall/security platform that guards the circuit.",
    updates: ["firewall", "circuit"],
  },
  {
    id: "routing-nat", phase: "firewall",
    title: "Configure routing and NAT",
    detail: "Set the default route and any static routes, decide the NAT policy, and confirm the customer's traffic takes the new circuit rather than the old path.",
    updates: ["cpe", "lan"],
  },
  {
    id: "connect-lan", phase: "firewall",
    title: "Hand the address range to the LAN",
    detail: "Connect the circuit to the internal network(s), confirm VLAN/segmentation and that the usable range is routed to the LAN. Record the LANs the circuit now serves.",
    updates: ["lan", "cpe", "circuit"],
  },
  {
    id: "activate", phase: "activation",
    title: "Activate the service at the carrier",
    detail: "Ask the carrier to activate the handoff (or confirm it is live), verifying the circuit ID and interface match the order before any traffic is trusted.",
    updates: ["upstream", "circuit", "document"],
  },
  {
    id: "verify-handoff", phase: "activation",
    title: "Verify the handoff is up",
    detail: "Confirm the WAN interface is up at the sold speed/duplex, the gateway responds, and the provider can reach the CPE's management address.",
    updates: ["circuit", "cpe"],
  },
  {
    id: "throughput-test", phase: "testing",
    title: "Run connectivity and throughput tests",
    detail: "Test the circuit end to end — throughput in both directions against the committed and burst figures, latency, jitter and packet loss — and record the measured results against the sold definition.",
    updates: ["circuit", "document"],
  },
  {
    id: "monitor", phase: "testing",
    title: "Configure monitoring and alerts",
    detail: "Add the circuit to monitoring (availability, latency, throughput, interface errors) with alerts routed to the responsible contact, and record how the circuit will be watched.",
    updates: ["circuit", "contact", "document"],
  },
  {
    id: "redundancy-design", phase: "redundancy",
    title: "Confirm the redundancy design",
    detail: "Confirm whether a second circuit exists and how failover is triggered (routing, CPE, or the carrier's own protection), and list the services that depend on this circuit.",
    updates: ["circuit", "cpe", "lan"],
  },
  {
    id: "failover-test", phase: "redundancy",
    title: "Test the failover path",
    detail: "Deliberately fail the primary circuit during a maintenance window and confirm the dependent services survive; record the interruption and the observed behaviour.",
    updates: ["circuit", "cpe", "document"],
  },
  {
    id: "handover-pack", phase: "acceptance",
    title: "Prepare the handover and acceptance pack",
    detail: "Assemble the order confirmation, the addressing and configuration details, the test results and this runbook into a pack the client can keep, filed as documents on the circuit.",
    updates: ["document", "runbook"],
  },
  {
    id: "customer-walkthrough", phase: "acceptance",
    title: "Walk the customer through the service",
    detail: "Show the client the delivered service — speeds, addressing, support route and escalation — and confirm their expectations against the sold definition.",
    updates: ["contact", "document"],
  },
  {
    id: "accept-signoff", phase: "acceptance",
    title: "Record acceptance and complete the documentation",
    detail: "Record the client's acceptance, set the runbook to complete, and confirm every dependent record and the contract tracker are updated so the documentation reflects the live service.",
    updates: ["contact", "circuit", "runbook", "tracker"],
  },
];

export const PROVISIONING_STEP_IDS = PROVISIONING_STEPS.map((s) => s.id);
export const provisioningStep = (id) => PROVISIONING_STEPS.find((s) => s.id === id) || null;
export const provisioningStepsForPhase = (phaseId) => PROVISIONING_STEPS.filter((s) => s.phase === phaseId);
export const provisioningStepOptions = () => PROVISIONING_STEPS.map((s) => ({ id: s.id, label: s.title }));

// ---- record resolution ------------------------------------------------------
// Find a record by id across every collection of a set.
function findAnyRecord(set, id) {
  if (!id || !set || !set.records) return null;
  for (const t of Object.keys(set.records)) {
    if (!Array.isArray(set.records[t])) continue;
    const hit = set.records[t].find((r) => r.id === id);
    if (hit) return hit;
  }
  return null;
}

const uniqRecords = (arr) => [...new Map((arr || []).filter(Boolean).map((r) => [r.id, r])).values()];

// The actual records each provisioning target resolves to in a given set, for a
// given circuit. Typed links are the primary source; the circuit's record
// fields (cpeRecord, firewallRecord, vendorRecord) are the fallback, so a
// deployment wired by field still counts.
export function resolveProvisioningRecords(circuit, set) {
  const out = {};
  for (const t of PROVISIONING_TARGETS) out[t.id] = [];
  if (!circuit || !set) return out;
  out.circuit = [circuit];
  const links = relationsOf(set, { type: circuit.type, id: circuit.id });
  const far = (kinds) => links.filter((l) => kinds.includes(l.relationship.kind)).map((l) => findRecord(set, l.other)).filter(Boolean);
  const fieldRef = (key) => findAnyRecord(set, fieldsOf(circuit)[key]);
  const records = set.records || {};
  out.upstream = uniqRecords([...far(["circuit-upstream"]), fieldRef("vendorRecord")]);
  out.cpe = uniqRecords([...far(["circuit-cpe"]), fieldRef("cpeRecord")]);
  out.firewall = uniqRecords([...far(["circuit-security"]), fieldRef("firewallRecord")]);
  out.lan = uniqRecords(far(["circuit-lan"]));
  out.credential = uniqRecords(far(["circuit-password"]));
  out.contact = uniqRecords(far(["contact-circuit"]));
  out.document = uniqRecords(far(["circuit-document"]));
  out.tracker = uniqRecords((records.trackers || []).filter((t) => JSON.stringify(t).includes(circuit.id)));
  out.runbook = uniqRecords(
    (records.runbooks || []).filter(
      (r) => r.runbookType === "circuit-provisioning" && ((r.service && r.service.id === circuit.id) || (r.origin && r.origin.circuitId === circuit.id)),
    ),
  );
  return out;
}

// Which record targets a circuit currently satisfies, and which are missing.
// `required` targets are the ones every resold circuit should end up with.
export function provisioningRecordCoverage(circuit, set) {
  const resolved = resolveProvisioningRecords(circuit, set);
  return PROVISIONING_TARGETS.map((t) => ({
    target: t.id,
    label: t.label,
    collection: t.collection,
    required: t.required,
    present: (resolved[t.id] || []).length > 0,
    count: (resolved[t.id] || []).length,
    records: resolved[t.id] || [],
  }));
}

// The record targets a single step updates, resolved to records.
export function provisioningStepRecords(step, circuit, set) {
  if (!step) return [];
  const resolved = resolveProvisioningRecords(circuit, set);
  return (step.updates || []).map((id) => {
    const target = provisioningTarget(id);
    return { target: id, label: target ? target.label : id, required: !!(target && target.required), records: resolved[id] || [] };
  });
}

// ---- runbook structure ------------------------------------------------------
// Each phase is a `## <heading>` section of the generated body; the audit reads
// the body back for those headings. The final "Records this deployment updates"
// section is the consolidation of every step's record mapping.
export const CIRCUIT_PROVISIONING_SECTIONS = [
  { id: "overview", heading: "Overview & scope", required: false },
  ...PROVISIONING_PHASES.map((p) => ({ id: p.id, heading: p.label, phase: p.id, required: true })),
  { id: "records", heading: "Records this deployment updates", required: true },
  { id: "signoff", heading: "Roles, contacts & sign-off", required: false },
];

export const circuitProvisioningSection = (id) => CIRCUIT_PROVISIONING_SECTIONS.find((s) => s.id === id) || null;

const headingsOf = (body) =>
  new Set(
    String(body || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.match(/^##\s+(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => m[1].trim().toLowerCase()),
  );

// Which sections a circuit-provisioning runbook's body actually contains.
export function circuitProvisioningCoverage(record) {
  const heads = headingsOf(record && record.body);
  const out = {};
  for (const s of CIRCUIT_PROVISIONING_SECTIONS) out[s.id] = heads.has(s.heading.toLowerCase());
  return out;
}

// ---- the generator ----------------------------------------------------------
const factLines = (pairs) =>
  pairs.map(([label, value]) => {
    if (isBlank(value)) return `- **${label}:** _[TO COMPLETE: record the ${label.toLowerCase()}]_`;
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    return `- **${label}:** ${text}`;
  });

const recordNames = (records) => (records || []).map((r) => r.name).join(", ");

// Assemble a provisioning & activation runbook from a resold circuit asset. The
// body uses the recorded values throughout, names every linked record, and marks
// each gap as TO COMPLETE; `warnings` lists the gaps the UI should surface.
export function generateCircuitProvisioningRunbook({ circuit, set, site, preparedBy, title, now = Date.now() } = {}) {
  if (!circuit || circuit.type !== "flexibleAssets") {
    throw new StoreError(CODES.INVALID_DATA, "A circuit provisioning runbook needs an Internet/WAN circuit asset to generate from.");
  }
  const profile = circuitProfile(circuit);
  const resolved = resolveProvisioningRecords(circuit, set);
  const addressing = profile.addressing || addressingSummary(circuit);
  const pricing = profile.pricing || {};
  const contract = profile.contract || circuitContract(circuit);
  const drift = circuitDefinitionDrift(circuit);
  const dependents = circuitDependents(circuit, set);
  const warnings = [];
  const warn = (code, message) => warnings.push({ code, message });
  const L = [];
  const push = (...lines) => L.push(...lines);
  const section = (heading) => push("", "## " + heading, "");

  const siteLabel = site && (site.name || site.label) ? site.name || site.label : "";
  const generatedOn = new Date(now).toISOString().slice(0, 10);
  const cover = provisioningRecordCoverage(circuit, set);

  // Circuit field gaps worth calling out before the technician starts.
  if (isBlank(profile.serviceDefinitionLabel)) warn("missing-service-definition", "The circuit records no resold service definition.");
  if (isBlank(profile.upstreamCarrier)) warn("missing-upstream", "The circuit records no upstream/wholesale carrier.");
  if (isBlank(profile.accessLabel)) warn("missing-access", "The circuit records no access technology.");
  if (!committedBandwidth(circuit).recorded) warn("missing-committed", "The circuit records no committed bandwidth.");
  if (!addressing.hasAddressing) warn("missing-addressing", "The circuit records no static-IP or subnet allocation.");
  if (!contract.hasTerm) warn("missing-contract", "The circuit records no contract term.");
  if (!pricing.hasPricing) warn("missing-pricing", "The circuit records no cost or sell price.");
  for (const c of cover) {
    if (c.required && !c.present && c.target !== "runbook") warn("missing-" + c.target, `No ${c.label.toLowerCase()} is recorded or linked for the circuit.`);
  }

  push(`# Circuit provisioning & activation runbook — ${circuit.name}`, "");
  push(`Bringing **${circuit.name}** live${siteLabel ? " at **" + siteLabel + "**" : ""}${profile.upstreamCarrier ? " on the " + profile.upstreamCarrier + " network" : ""}.`, "");
  push(`_Generated from the Internet/WAN circuit asset “${circuit.name}” on ${generatedOn}${preparedBy ? " by " + preparedBy : ""}. Every step uses the recorded values and names the records it updates; every gap is marked TO COMPLETE._`);

  // ---- overview ----
  section("Overview & scope");
  push("This runbook covers the full provisioning and activation of a resold internet/WAN circuit, in the order it must happen: order capture, the upstream carrier handoff, CPE selection and configuration, IP addressing and reverse DNS, the firewall and routing changes, activation, connectivity and throughput testing, redundancy/failover, and customer acceptance. It ends with the record mapping — every record the provisioning updates.", "");
  push(...factLines([
    ["Circuit asset", circuit.name],
    ["Site", siteLabel],
    ["Carrier (branded)", profile.carrier],
    ["Upstream / wholesale carrier", profile.upstreamCarrier],
    ["Sourcing model", profile.sourcingLabel],
    ["Access technology", profile.accessLabel],
    ["Service definition", profile.serviceDefinitionLabel],
    ["Committed bandwidth", bandwidthSummary(circuit)],
    ["Contention / CIR", profile.contention],
    ["SLA target", profile.sla],
    ["Static IP(s) / subnets", addressing.hasAddressing ? addressing.staticIps.concat(addressing.subnetStrings) : ""],
    ["Contract end", contract.end || ""],
  ]));
  if (drift && drift.rows.length) {
    push("", `> **Plan drift:** the configured values do not match the “${drift.definition.label}” service definition (${drift.rows.map((r) => r.field).join(", ")}). Reconcile before handover.`);
  }

  // ---- each phase ----
  for (const phase of PROVISIONING_PHASES) {
    section(phase.label);
    push(phase.summary, "");
    const steps = provisioningStepsForPhase(phase.id);
    steps.forEach((step, i) => {
      push(`${i + 1}. **${step.title}** — ${step.detail}`);
      const mapped = provisioningStepRecords(step, circuit, set);
      const parts = mapped.map((m) => {
        const names = recordNames(m.records);
        return `${m.label}: ${names || (m.required ? "_[TO COMPLETE]_" : "none recorded")}`;
      });
      push(`   - _Records updated:_ ${parts.join(" · ")}`);
    });

    // phase-specific facts the technician needs at hand.
    if (phase.id === "order") {
      push("");
      push(...factLines([
        ["Service definition (tier)", profile.serviceDefinitionLabel],
        ["Committed bandwidth", bandwidthSummary(circuit)],
        ["Contention / CIR", profile.contention],
        ["SLA target", profile.sla],
        ["Wholesale cost / month", pricing.cost != null ? pricing.cost + " " + (pricing.currency || "") : ""],
        ["Sell price / month", pricing.sell != null ? pricing.sell + " " + (pricing.currency || "") : ""],
        ["Margin", pricing.marginPct != null ? pricing.marginPct + "%" : ""],
        ["Contract", contract.hasTerm ? (contract.start || "?") + " → " + (contract.end || "?") : ""],
      ]));
    } else if (phase.id === "addressing") {
      push("");
      push(...factLines([
        ["Access technology", profile.accessLabel],
        ["Static IP address(es)", addressing.staticIps],
        ["Subnet allocation", addressing.subnetStrings],
        ["IPv4 range", addressing.ipv4Range],
        ["IPv6 range", addressing.ipv6Range],
        ["Public hostname / reverse DNS", addressing.publicHostname],
        ["Usable / declared addresses", addressing.hasAddressing ? addressing.usable + " usable / " + addressing.declared + " declared" : ""],
      ]));
      push("", "| Subnet | Usable | Network / broadcast |", "| --- | --- | --- |", "| _[TO COMPLETE]_ | | | ");
    } else if (phase.id === "redundancy") {
      push("");
      push("**Records that depend on this circuit**", "");
      push(...(dependents.length ? dependents.map((d) => `- ${d.kind} → ${(findRecord(set, d.target) || {}).name || d.target.id}`) : ["- _[TO COMPLETE: link the LANs, voice platform and other services that run over this circuit.]_"]));
      push("");
      push(...factLines([["Recorded failover notes", fieldsOf(circuit).failoverNotes]]));
    }
  }

  // ---- the consolidated record mapping ----
  section("Records this deployment updates");
  push("Every record this provisioning creates, updates or links, consolidated for the handover. A required record marked TO COMPLETE is a gap to close before the service is accepted.", "");
  push("| Record | Kind | Status |", "| --- | --- | --- |");
  for (const c of cover) {
    const names = recordNames(c.records);
    const status = c.present ? (names || "present") : c.required ? "**[TO COMPLETE]**" : "where used";
    push(`| ${c.label} | ${c.collection} | ${status} |`);
  }

  // ---- sign-off ----
  section("Roles, contacts & sign-off");
  push("**Responsible contacts**", "");
  push(...(resolved.contact.length ? resolved.contact.map((c) => `- ${c.name}`) : ["- _[TO COMPLETE: link the people responsible for this circuit and the carrier liaison.]_"]));
  push("", "| Role | Name | Contact |", "| --- | --- | --- |",
    "| Provisioning lead | | |",
    "| Carrier / upstream provider | | |",
    "| Client approver | | |", "");
  push(`_Runbook generated for “${circuit.name}” on ${generatedOn}. Re-verify the recorded values and re-run the tests before every subsequent change to this circuit._`);

  const body = L.join("\n");
  const summary = `Provisioning & activation of ${circuit.name}` + (siteLabel ? ` at ${siteLabel}` : "") + (profile.accessLabel ? ` — ${profile.accessLabel}` : "") + ".";
  const name = title && !isBlank(title) ? title : `Circuit provisioning — ${circuit.name}` + (siteLabel ? ` (${siteLabel})` : "");

  return {
    name,
    summary,
    body,
    runbookType: "circuit-provisioning",
    service: { type: circuit.type, id: circuit.id },
    site: site && site.id ? { type: site.type, id: site.id } : null,
    sections: CIRCUIT_PROVISIONING_SECTIONS.map((s) => ({ id: s.id, heading: s.heading, required: s.required })),
    phases: PROVISIONING_PHASES.map((p) => ({ id: p.id, label: p.label, steps: provisioningStepsForPhase(p.id).map((s) => s.id) })),
    coverage: cover,
    warnings,
    generatedAt: now,
  };
}

// ---- the audit --------------------------------------------------------------
// Flags a circuit-provisioning runbook that is missing a required phase, or that
// is not linked to the circuit it stands up. A runbook without a body is left to
// runbookIssues. Every finding is a warning — a gap in a procedure is a quality
// flag, never a broken graph.
export function circuitProvisioningIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.runbooks || []) {
    if (r.runbookType !== "circuit-provisioning") continue;
    if (isBlank(r.body)) continue;
    const cov = circuitProvisioningCoverage(r);
    for (const s of CIRCUIT_PROVISIONING_SECTIONS) {
      if (!s.required || cov[s.id]) continue;
      issues.push({ level: "warning", code: "circuit-runbook-missing-" + s.id, recordId: r.id, message: `Circuit provisioning runbook “${r.name}” is missing the “${s.heading}” section.` });
    }
    const linkedByKind = relationsOf(set, { type: r.type, id: r.id }).some((x) => ["runbook-service", "asset-reference"].includes(x.relationship.kind));
    const hasCircuit = !!(r.service && r.service.id) || linkedByKind || !!(r.origin && r.origin.circuitId);
    if (!hasCircuit) {
      issues.push({ level: "warning", code: "circuit-runbook-no-circuit", recordId: r.id, message: `Circuit provisioning runbook “${r.name}” is not linked to the circuit it provisions.` });
    }
  }
  return issues;
}
