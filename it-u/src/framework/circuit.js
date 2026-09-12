// src/framework/circuit.js — the resold internet / WAN circuit model
// (roadmap task 40, "Internet/WAN circuit asset & reseller service definition").
//
// Task 33 modelled the client's CONNECTIVITY as network services and gave the
// `atype-wan-circuit` template its first fields (carrier, circuit type,
// bandwidth, static IPs, contract end). Task 40 is the RESELLER half: a resold
// circuit is a product the provider buys wholesale and sells on, so the record
// must capture *who it is bought from* and *what it is sold as* as well as the
// technical service — the upstream/wholesale carrier, the sourcing model, the
// access technology, committed vs burst bandwidth, the static-IP/subnet
// allocation, the router/CPE, the SLA target, the contract term, and the
// reseller's own service definition and pricing tier.
//
// This module is the shared vocabulary and the pure helpers behind that record:
//   • the catalogs — access technologies, sourcing models, the reseller's
//     service definitions (its product/pricing tiers), SLA targets and CPE roles;
//   • the bandwidth helpers — committed vs burst and the contention ratio;
//   • the addressing helpers — IPv4 CIDR parsing and the static-IP/subnet
//     allocation summary (also used by task 42's addressing documentation);
//   • `circuitProfile(record, opts)` — the normalised view the UI and the runbook
//     generators read; and
//   • `circuitIssues(set)` — the completeness audit the Linter folds in.
//
// Like ./network.js this module is PURE (no storage): the template
// (./assetLibrary.js) carries the fields, ./relationships.js the typed links,
// ./assetRelations.js the profile groups, and ./standardized.js runs the audit.

import { assetFieldsOf } from "./flexible.js";
import { relationsOf } from "./relationships.js";

const str = (v) => String(v == null ? "" : v).trim();
const blank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const numOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const fieldsOf = (record) => (record ? assetFieldsOf(record) : {});
const splitList = (v) => String(v == null ? "" : v).split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

// ---- access technology ------------------------------------------------------
// How the site is actually reached. `medium` groups the technologies for
// reporting; `symmetric` notes whether up and down are usually equal.
export const ACCESS_TECHNOLOGIES = [
  { id: "fibre", label: "Fibre (FTTP)", medium: "fibre", symmetric: true, description: "Fibre to the premises." },
  { id: "fttn", label: "FTTN", medium: "copper", symmetric: false, description: "Fibre to the node, copper on the last leg." },
  { id: "fttc", label: "FTTC", medium: "copper", symmetric: false, description: "Fibre to the cabinet, copper on the last leg." },
  { id: "fttb", label: "FTTB", medium: "fibre", symmetric: false, description: "Fibre to the building." },
  { id: "hfc", label: "HFC / cable", medium: "coaxial", symmetric: false, description: "Hybrid fibre-coaxial cable access." },
  { id: "dsl", label: "DSL", medium: "copper", symmetric: false, description: "Copper DSL, usually the slowest option." },
  { id: "ethernet", label: "Ethernet / EoFTTC", medium: "fibre", symmetric: true, description: "Carrier Ethernet or Ethernet over FTTC." },
  { id: "wireless", label: "Fixed wireless", medium: "wireless", symmetric: false, description: "A licensed or unlicensed radio link." },
  { id: "mobile", label: "4G / 5G", medium: "wireless", symmetric: false, description: "Mobile data as a primary or backup path." },
  { id: "satellite", label: "Satellite", medium: "satellite", symmetric: false, description: "Satellite access, typically for remote sites." },
  { id: "dark-fibre", label: "Dark fibre", medium: "fibre", symmetric: true, description: "Unlit fibre the provider or client lights itself." },
  { id: "other", label: "Other", medium: "other", symmetric: false, description: "Any other access technology." },
];

export const ACCESS_TECHNOLOGY_IDS = ACCESS_TECHNOLOGIES.map((a) => a.id);
export const accessTechnology = (id) => ACCESS_TECHNOLOGIES.find((a) => a.id === id) || null;
export const accessTechnologyLabel = (id) => (accessTechnology(id) || {}).label || "";
export const accessTechnologyOptions = () => ACCESS_TECHNOLOGIES.map((a) => ({ id: a.id, label: a.label }));

// ---- sourcing model ---------------------------------------------------------
// How the reseller obtains the circuit — the commercial relationship the record
// must make explicit so billing and support obligations are unambiguous.
export const CIRCUIT_SOURCING = [
  { id: "resold", label: "Resold", description: "Bought wholesale and sold on under the provider's own brand." },
  { id: "wholesale", label: "Wholesale", description: "Held on a wholesale agreement, often billed directly by the carrier." },
  { id: "brokered", label: "Brokered", description: "Sourced through a broker or aggregator who manages the order." },
  { id: "managed", label: "Fully managed", description: "The upstream provider manages the service end to end." },
  { id: "own-infrastructure", label: "Own infrastructure", description: "The provider's own network reaches the site." },
  { id: "other", label: "Other", description: "Any other sourcing arrangement." },
];

export const CIRCUIT_SOURCING_IDS = CIRCUIT_SOURCING.map((s) => s.id);
export const circuitSourcing = (id) => CIRCUIT_SOURCING.find((s) => s.id === id) || null;
export const circuitSourcingLabel = (id) => (circuitSourcing(id) || {}).label || "";
export const circuitSourcingOptions = () => CIRCUIT_SOURCING.map((s) => ({ id: s.id, label: s.label }));

// ---- SLA targets ------------------------------------------------------------
// The availability/response targets the provider sells. `availability` is a
// percentage; the response/restore windows are hours.
export const CIRCUIT_SLA_TARGETS = [
  { id: "best-effort", label: "Best effort", availability: null, responseHours: null, restoreHours: null, tone: "muted" },
  { id: "standard", label: "Standard", availability: 99.5, responseHours: 8, restoreHours: 48, tone: "info" },
  { id: "business", label: "Business", availability: 99.9, responseHours: 4, restoreHours: 24, tone: "info" },
  { id: "premium", label: "Premium", availability: 99.99, responseHours: 2, restoreHours: 8, tone: "ok" },
];

export const CIRCUIT_SLA_TARGET_IDS = CIRCUIT_SLA_TARGETS.map((s) => s.id);
export const circuitSlaTarget = (id) => CIRCUIT_SLA_TARGETS.find((s) => s.id === id) || null;
export const circuitSlaTargetLabel = (id) => (circuitSlaTarget(id) || {}).label || "";
export const circuitSlaTargetOptions = () => CIRCUIT_SLA_TARGETS.map((s) => ({ id: s.id, label: s.label }));

// ---- CPE roles --------------------------------------------------------------
export const CPE_ROLES = [
  { id: "router", label: "Router" },
  { id: "firewall", label: "Firewall / security gateway" },
  { id: "modem", label: "Modem / NTU" },
  { id: "ont", label: "ONT / fibre termination" },
  { id: "media-converter", label: "Media converter" },
  { id: "switch", label: "Edge switch" },
  { id: "wireless-bridge", label: "Wireless bridge" },
  { id: "none", label: "None (carrier handoff only)" },
];

export const CPE_ROLE_IDS = CPE_ROLES.map((r) => r.id);
export const cpeRole = (id) => CPE_ROLES.find((r) => r.id === id) || null;
export const cpeRoleLabel = (id) => (cpeRole(id) || {}).label || "";
export const cpeRoleOptions = () => CPE_ROLES.map((r) => ({ id: r.id, label: r.label }));

// ---- the reseller's own service definitions (its product/pricing tiers) -----
// Each definition is a product the provider sells: the committed and burst
// bandwidth, the contention it is sold at and the SLA target it promises. A
// circuit records which definition it was sold as, and task 43 reconciles the
// sold plan against what is actually provisioned.
export const RESELLER_SERVICE_DEFINITIONS = [
  { id: "essential", label: "Essential", tier: 1, description: "A small-site business line.", committedDown: 50, committedUp: 20, burstDown: 100, burstUp: 40, contention: "20:1", sla: "standard" },
  { id: "business", label: "Business", tier: 2, description: "A standard office connection.", committedDown: 100, committedUp: 40, burstDown: 250, burstUp: 100, contention: "10:1", sla: "business" },
  { id: "business-plus", label: "Business Plus", tier: 3, description: "A larger office or multi-service site.", committedDown: 250, committedUp: 100, burstDown: 500, burstUp: 250, contention: "5:1", sla: "business" },
  { id: "premium", label: "Premium", tier: 4, description: "A high-bandwidth, low-contention service.", committedDown: 500, committedUp: 500, burstDown: 1000, burstUp: 1000, contention: "2:1", sla: "premium" },
  { id: "dedicated", label: "Dedicated", tier: 5, description: "Uncontended dedicated bandwidth.", committedDown: 1000, committedUp: 1000, burstDown: 1000, burstUp: 1000, contention: "1:1", sla: "premium" },
  { id: "custom", label: "Custom", tier: 0, description: "A bespoke arrangement — record the details in the free-text fields.", committedDown: null, committedUp: null, burstDown: null, burstUp: null, contention: null, sla: null },
];

export const SERVICE_DEFINITION_IDS = RESELLER_SERVICE_DEFINITIONS.map((d) => d.id);
export const serviceDefinition = (id) => RESELLER_SERVICE_DEFINITIONS.find((d) => d.id === id) || null;
export const serviceDefinitionLabel = (id) => (serviceDefinition(id) || {}).label || "";
export const serviceDefinitionOptions = () => RESELLER_SERVICE_DEFINITIONS.map((d) => ({ id: d.id, label: d.label }));

// ---- bandwidth --------------------------------------------------------------
// Committed (CIR) bandwidth is what the provider guarantees; burst (EIR) is the
// ceiling it may climb to. The legacy `bandwidthDown`/`bandwidthUp` fields are
// the committed values; `burstDown`/`burstUp` the ceiling.
export function committedBandwidth(record) {
  const f = fieldsOf(record);
  const down = numOrNull(f.committedDown) != null ? numOrNull(f.committedDown) : numOrNull(f.bandwidthDown);
  const up = numOrNull(f.committedUp) != null ? numOrNull(f.committedUp) : numOrNull(f.bandwidthUp);
  return { down, up, symmetric: down != null && up != null && down === up, recorded: Number.isFinite(down) || Number.isFinite(up) };
}

export function burstBandwidth(record) {
  const f = fieldsOf(record);
  const committed = committedBandwidth(record);
  const down = numOrNull(f.burstDown) != null ? numOrNull(f.burstDown) : committed.down;
  const up = numOrNull(f.burstUp) != null ? numOrNull(f.burstUp) : committed.up;
  return { down, up, recorded: numOrNull(f.burstDown) != null || numOrNull(f.burstUp) != null };
}

// The contention (oversubscription) the circuit runs at, as a ratio string. A
// recorded free-text `contention` wins; else it is computed from burst/committed.
export function contentionRatio(record) {
  const f = fieldsOf(record);
  if (!blank(f.contention)) return str(f.contention);
  const comm = committedBandwidth(record);
  const burst = burstBandwidth(record);
  if (comm.down == null || burst.down == null || comm.down <= 0 || burst.down <= comm.down) return null;
  const ratio = Math.round((burst.down / comm.down) * 10) / 10;
  return (Number.isInteger(ratio) ? ratio : ratio.toFixed(1)) + ":1";
}

// A short human phrase for the circuit's bandwidth.
export function bandwidthSummary(record) {
  const comm = committedBandwidth(record);
  const burst = burstBandwidth(record);
  if (!comm.recorded && !burst.recorded) return "";
  const committed = comm.down != null || comm.up != null ? (comm.down || "?") + " / " + (comm.up || "?") + " Mbps" : "";
  const parts = [];
  if (committed) parts.push(committed + " committed");
  if (burst.recorded && (burst.down !== comm.down || burst.up !== comm.up)) parts.push("burst " + (burst.down || "?") + " / " + (burst.up || "?"));
  return parts.join(" · ");
}

// ---- IP addressing ----------------------------------------------------------
function ipv4ToInt(ip) {
  const parts = String(ip).trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

const intToIpv4 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

// Parse an IPv4 address or CIDR block. Returns null for anything that is not a
// valid IPv4 (a hostname, an IPv6 block, free text). `usable` counts host
// addresses: size-2 for a normal subnet, 2 for a /31 point-to-point, 1 for a /32.
export function parseCidr(input) {
  const s = str(input);
  if (!s) return null;
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\s*\/\s*(\d{1,2}))?$/);
  if (!m) return null;
  const base = ipv4ToInt(m[1]);
  if (base == null) return null;
  const prefix = m[2] == null ? 32 : Number(m[2]);
  if (prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const size = Math.pow(2, 32 - prefix);
  const usable = prefix === 32 ? 1 : prefix === 31 ? 2 : size - 2;
  return {
    input: s,
    cidr: intToIpv4(network) + "/" + prefix,
    network: intToIpv4(network),
    broadcast: intToIpv4(broadcast),
    mask: intToIpv4(mask),
    prefix,
    size,
    usable,
  };
}

export const circuitSubnets = (record) => splitList(fieldsOf(record).subnets);
export const circuitStaticIps = (record) => splitList(fieldsOf(record).staticIps);

// The circuit's public addressing: the parsed subnets, the static IPs, the
// usable-host count and whether anything was recorded at all. Shared with the
// domain/SSL and firewall documentation (task 42) so a renumber is visible.
export function addressingSummary(record) {
  const f = fieldsOf(record);
  const subnetStrings = circuitSubnets(record);
  const subnets = subnetStrings.map(parseCidr).filter(Boolean);
  const staticIps = circuitStaticIps(record);
  const usable = subnets.reduce((sum, s) => sum + s.usable, 0);
  const recordedCount = numOrNull(f.staticIpCount);
  return {
    subnets,
    subnetStrings,
    staticIps,
    usable: usable || null,
    declared: recordedCount != null ? recordedCount : (staticIps.length || usable || null),
    ipv4Range: str(f.ipv4Range) || null,
    ipv6Range: str(f.ipv6Range) || null,
    publicHostname: str(f.publicHostname) || str(f.reverseDns) || null,
    hasAddressing: subnets.length > 0 || staticIps.length > 0 || !!str(f.ipv4Range) || !!str(f.ipv6Range) || !!str(f.addressScheme),
    hasSubnets: subnets.length > 0,
  };
}

// ---- contract & pricing -----------------------------------------------------
function toLocalDate(v) {
  const m = String(v == null ? "" : v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysFromNow(dateStr, now) {
  if (!dateStr) return null;
  const d = toLocalDate(dateStr);
  if (!d) return null;
  const n = new Date(now);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}

export function circuitContract(record, opts = {}) {
  const f = fieldsOf(record);
  const now = opts.now != null ? opts.now : Date.now();
  const start = str(f.contractStartDate) || null;
  const end = str(f.contractEndDate) || null;
  const termMonths = numOrNull(f.contractTermMonths);
  const daysLeft = end ? daysFromNow(end, now) : null;
  return {
    start,
    end,
    termMonths,
    daysLeft,
    expired: daysLeft != null && daysLeft < 0,
    expiringSoon: daysLeft != null && daysLeft >= 0 && daysLeft <= 60,
    hasTerm: !!start || !!end || termMonths != null,
  };
}

// The commercial picture: what the circuit costs the provider, what it is sold
// for, and the margin between them (per month).
export function circuitPricing(record) {
  const f = fieldsOf(record);
  const cost = numOrNull(f.costPrice);
  const sell = numOrNull(f.sellPrice) != null ? numOrNull(f.sellPrice) : numOrNull(f.monthlyCost);
  const currency = str(f.currency) || "GBP";
  const margin = cost != null && sell != null ? Math.round((sell - cost) * 100) / 100 : null;
  const marginPct = margin != null && sell ? Math.round((margin / sell) * 1000) / 10 : null;
  return { cost, sell, currency, margin, marginPct, period: "month", hasPricing: cost != null || sell != null };
}

// ---- the normalised profile -------------------------------------------------
export function circuitProfile(record, opts = {}) {
  if (!record) return null;
  const f = fieldsOf(record);
  const access = accessTechnology(str(f.accessTechnology) || str(f.circuitType));
  const sourcing = circuitSourcing(str(f.sourcing));
  const slaTarget = circuitSlaTarget(str(f.slaTarget));
  const definition = serviceDefinition(str(f.serviceDefinition));
  const committed = committedBandwidth(record);
  const burst = burstBandwidth(record);
  const addressing = addressingSummary(record);
  const contract = circuitContract(record, opts);
  const pricing = circuitPricing(record);
  const upstreamCarrier = str(f.upstreamCarrier) || str(f.wholesaleCarrier) || str(f.carrier);
  const cpe = cpeRole(str(f.cpeRole));
  return {
    id: record.id,
    name: record.name,
    carrier: str(f.carrier),
    upstreamCarrier,
    upstreamIsWholesale: !!str(f.upstreamCarrier) && str(f.upstreamCarrier) !== str(f.carrier),
    circuitId: str(f.circuitId),
    sourcing,
    sourcingLabel: sourcing ? sourcing.label : "",
    access,
    accessLabel: access ? access.label : "",
    accessMedium: access ? access.medium : "",
    serviceDefinition: definition,
    serviceDefinitionLabel: definition ? definition.label : "",
    accountNumber: str(f.accountNumber),
    committed,
    burst,
    contention: contentionRatio(record),
    bandwidth: bandwidthSummary(record),
    sla: str(f.sla) || circuitSlaTargetLabel(str(f.slaTarget)),
    slaTarget,
    addressing,
    staticIpCount: addressing.declared,
    cpe,
    cpeLabel: cpe ? cpe.label : "",
    cpeRecord: str(f.cpeRecord) || null,
    firewallRecord: str(f.firewallRecord) || null,
    vendorRecord: str(f.vendorRecord) || null,
    contract,
    pricing,
    supportPhone: str(f.supportPhone),
    supportUrl: str(f.supportUrl),
    notes: str(f.notes),
  };
}

// How a circuit's provisioned values compare to the service definition it was
// sold as. Returns null when no definition is recorded.
export function circuitDefinitionDrift(record) {
  const f = fieldsOf(record);
  const definition = serviceDefinition(str(f.serviceDefinition));
  if (!definition) return null;
  const committed = committedBandwidth(record);
  const rows = [];
  const cmp = (field, plan, actual) => {
    if (plan == null || actual == null || plan === actual) return;
    rows.push({ field, plan, actual, direction: actual < plan ? "below" : "above" });
  };
  cmp("committedDown", definition.committedDown, committed.down);
  cmp("committedUp", definition.committedUp, committed.up);
  cmp("burstDown", definition.burstDown, numOrNull(f.burstDown));
  cmp("burstUp", definition.burstUp, numOrNull(f.burstUp));
  const sla = str(f.slaTarget);
  if (sla && definition.sla && sla !== definition.sla) rows.push({ field: "slaTarget", plan: definition.sla, actual: sla, direction: "differs" });
  return { definition, rows, matches: rows.length === 0 };
}

// ---- dependents -------------------------------------------------------------
// The records that depend on a circuit (via an inbound typed link — a LAN, a
// voice platform, a contact). Used by task 42's impact assessment and the
// cutover/decommission runbook (task 44) to know what a change touches.
export function circuitDependents(record, set) {
  if (!record || !set) return [];
  return relationsOf(set, { type: record.type, id: record.id })
    .filter((rel) => rel.direction === "in")
    .map((rel) => ({ kind: rel.relationship.kind, rule: rel.relationship, target: rel.other, relationship: rel.relationship }))
    .filter((d) => d.target);
}

// A one-line summary for a table cell: carrier · technology · bandwidth · tier.
export function circuitSummaryLine(record) {
  const p = circuitProfile(record);
  if (!p) return "";
  const bits = [p.upstreamCarrier || p.carrier, p.accessLabel, p.bandwidth, p.serviceDefinitionLabel ? p.serviceDefinitionLabel + " tier" : ""];
  return bits.filter(Boolean).join(" · ");
}

// ---- the completeness audit -------------------------------------------------
const CIRCUIT_TYPE_ID = "atype-wan-circuit";
export const WAN_CIRCUIT_TYPE_ID = CIRCUIT_TYPE_ID;

export function circuitIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || CIRCUIT_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const f = fieldsOf(r);
    const rec = (code, message) => issues.push({ level: "warning", code, recordId: r.id, message });
    if (blank(f.upstreamCarrier) && blank(f.carrier)) rec("circuit-no-upstream", `Circuit “${r.name}” records no wholesale/upstream carrier.`);
    if (blank(f.circuitType) && blank(f.accessTechnology)) rec("circuit-no-access", `Circuit “${r.name}” records no access technology.`);
    const comm = committedBandwidth(r);
    if (!comm.recorded) rec("circuit-no-committed", `Circuit “${r.name}” records no committed bandwidth.`);
    const addressing = addressingSummary(r);
    if (!addressing.hasAddressing) rec("circuit-no-addressing", `Circuit “${r.name}” records no static-IP or subnet allocation.`);
    if (blank(f.cpeRecord) && blank(f.cpeRole)) rec("circuit-no-cpe", `Circuit “${r.name}” records no router/CPE.`);
    if (blank(f.sla) && blank(f.slaTarget)) rec("circuit-no-sla", `Circuit “${r.name}” records no SLA target.`);
    if (!circuitContract(r).hasTerm) rec("circuit-no-contract-term", `Circuit “${r.name}” records no contract term.`);
    if (blank(f.serviceDefinition)) rec("circuit-no-service-definition", `Circuit “${r.name}” is not sold as any reseller service definition.`);
    if (!circuitPricing(r).hasPricing) rec("circuit-no-pricing", `Circuit “${r.name}” records no cost or sell price.`);
    const drift = circuitDefinitionDrift(r);
    if (drift && drift.rows.length) {
      const fields = [...new Set(drift.rows.map((d) => d.field))].join(", ");
      rec("circuit-plan-drift", `Circuit “${r.name}” does not match its “${drift.definition.label}” service definition (${fields}).`);
    }
  }
  return issues;
}
