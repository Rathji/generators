// src/tests/circuit.test.js — validation tests for Phase 10 task 40 ("Internet/
// WAN circuit asset & reseller service definition"). Run in the live page:
//   await import("./src/tests/circuit.test.js").then((m) => m.run())
//
// Covers: the reseller catalogs (access technologies, sourcing models, the
// service definitions/pricing tiers, SLA targets and CPE roles); the bandwidth
// helpers (committed vs burst and the contention ratio); the IPv4 CIDR parser
// and the static-IP/subnet allocation summary; the normalised `circuitProfile`;
// the sold-plan-vs-provisioned `circuitDefinitionDrift`; the dependents a
// circuit carries; and the `circuitIssues` completeness audit folded into
// standardizedIssues — all under the new atype-wan-circuit template fields.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { standardizedIssues } from "../framework/standardized.js";
import {
  ACCESS_TECHNOLOGIES,
  accessTechnology,
  accessTechnologyLabel,
  CIRCUIT_SOURCING,
  circuitSourcing,
  CIRCUIT_SLA_TARGETS,
  circuitSlaTarget,
  CPE_ROLES,
  cpeRole,
  RESELLER_SERVICE_DEFINITIONS,
  serviceDefinition,
  serviceDefinitionLabel,
  committedBandwidth,
  burstBandwidth,
  contentionRatio,
  bandwidthSummary,
  parseCidr,
  circuitSubnets,
  circuitStaticIps,
  addressingSummary,
  circuitContract,
  circuitPricing,
  circuitProfile,
  circuitDefinitionDrift,
  circuitDependents,
  circuitSummaryLine,
  circuitIssues,
  WAN_CIRCUIT_TYPE_ID,
} from "../framework/circuit.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });
const codes = (issues) => issues.map((i) => i.code);
const NOW = new Date(2026, 5, 15).getTime();

function circuit(carrier = "Aurora Telecom", fields = {}) {
  return { id: "fx-" + carrier.toLowerCase().replace(/\W/g, ""), type: "flexibleAssets", name: carrier + " circuit", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier, circuitType: "fibre", ...fields } };
}

const tests = [
  ["the reseller catalogs describe every access technology, tier, SLA and CPE role", () => {
    assert(ACCESS_TECHNOLOGIES.length >= 10, "several access technologies");
    for (const a of ACCESS_TECHNOLOGIES) assert(a.id && a.label && a.medium, `access tech ${a.id} has identity`);
    assertEq(accessTechnologyLabel("fibre"), "Fibre (FTTP)");
    assertEq(accessTechnology("nope"), null);
    assert(ACCESS_TECHNOLOGIES.every((a) => a.symmetric != null), "every access tech records symmetry");

    assertEq(CIRCUIT_SOURCING.length, 6, "six sourcing models");
    assert(circuitSourcing("resold"), "resold is a sourcing model");

    assertEq(CIRCUIT_SLA_TARGETS.length, 4, "four SLA targets");
    assertEq(circuitSlaTarget("business").availability, 99.9, "business availability");
    assertEq(circuitSlaTarget("best-effort").availability, null, "best-effort has no percentage");

    assertEq(CPE_ROLES.length, 8, "eight CPE roles");
    assertEq(cpeRole("ont").label, "ONT / fibre termination");

    assert(RESELLER_SERVICE_DEFINITIONS.length >= 5, "several reseller service definitions");
    const business = serviceDefinition("business");
    assertEq(business.committedDown, 100);
    assertEq(business.sla, "business");
    assertEq(serviceDefinitionLabel("dedicated"), "Dedicated");
    assertEq(serviceDefinition("nope"), null);
  }],

  ["committed and burst bandwidth resolve, and contention is computed", () => {
    const rec = circuit("Aurora", { bandwidthDown: 100, bandwidthUp: 40, burstDown: 250, burstUp: 100 });
    const comm = committedBandwidth(rec);
    assertEq(comm.down, 100);
    assertEq(comm.up, 40);
    assertEq(comm.symmetric, false);
    assertEq(comm.recorded, true);
    const burst = burstBandwidth(rec);
    assertEq(burst.down, 250);
    assertEq(burst.recorded, true);
    assertEq(contentionRatio(rec), "2.5:1", "computed from burst ÷ committed");
    // An explicit contention override wins.
    assertEq(contentionRatio(circuit("Aurora", { bandwidthDown: 100, burstDown: 250, contention: "10:1" })), "10:1");
    // No burst → no computed contention.
    assertEq(contentionRatio(circuit("Aurora", { bandwidthDown: 100 })), null);
    // Committed-only fallback for a symmetric line.
    const sym = committedBandwidth(circuit("Aurora", { bandwidthDown: 500, bandwidthUp: 500 }));
    assertEq(sym.symmetric, true);
    assertEq(burstBandwidth(circuit("Aurora", { bandwidthDown: 500 })).down, 500, "burst falls back to committed");
    assert(/100 \/ 40 Mbps committed/.test(bandwidthSummary(rec)), "summary names committed");
    assert(/burst 250 \/ 100/.test(bandwidthSummary(rec)), "summary names burst");
    assertEq(bandwidthSummary(circuit("Aurora", {})), "", "no bandwidth → no summary");
  }],

  ["pricing reports cost, sell price and the margin", () => {
    const p = circuitPricing(circuit("Aurora", { costPrice: 40, sellPrice: 100, currency: "GBP" }));
    assertEq(p.cost, 40);
    assertEq(p.sell, 100);
    assertEq(p.margin, 60);
    assertEq(p.marginPct, 60);
    assertEq(p.period, "month");
    assertEq(p.hasPricing, true);
    // `monthlyCost` is the legacy sell-price field.
    assertEq(circuitPricing(circuit("Aurora", { costPrice: 10, monthlyCost: 30 })).sell, 30);
    // A sell price with no cost gives no margin.
    const noCost = circuitPricing(circuit("Aurora", { sellPrice: 100 }));
    assertEq(noCost.margin, null);
    assertEq(noCost.hasPricing, true);
    assertEq(circuitPricing(circuit("Aurora", {})).hasPricing, false);
  }],

  ["parseCidr understands IPv4 blocks and their usable hosts", () => {
    const slash29 = parseCidr("203.0.113.0/29");
    assertEq(slash29.network, "203.0.113.0");
    assertEq(slash29.broadcast, "203.0.113.7");
    assertEq(slash29.mask, "255.255.255.248");
    assertEq(slash29.size, 8);
    assertEq(slash29.usable, 6);
    assertEq(slash29.cidr, "203.0.113.0/29");
    // A host address snaps to its network.
    assertEq(parseCidr("203.0.113.5/29").network, "203.0.113.0");
    // A bare address is a /32 with one usable host.
    assertEq(parseCidr("198.51.100.7").prefix, 32);
    assertEq(parseCidr("198.51.100.7").usable, 1);
    // A /31 point-to-point has two usable addresses.
    assertEq(parseCidr("198.51.100.0/31").usable, 2);
    // Rejections.
    assertEq(parseCidr("not an ip"), null);
    assertEq(parseCidr("203.0.113.0/33"), null);
    assertEq(parseCidr("2001:db8::1"), null);
    assertEq(parseCidr(""), null);
  }],

  ["the addressing summary totals the static IPs and subnets", () => {
    const rec = circuit("Aurora", {
      subnets: "203.0.113.0/29\n198.51.100.0/30",
      staticIps: "203.0.113.2\n203.0.113.3",
      publicHostname: "edge.acme.example",
    });
    const a = addressingSummary(rec);
    assertEq(a.subnets.length, 2);
    assertEq(a.subnetStrings.length, 2);
    assertEq(a.usable, 8, "6 + 2 usable hosts");
    assertEq(a.staticIps.length, 2);
    assertEq(a.declared, 2, "declared count is the number of static IPs");
    assertEq(a.hasAddressing, true);
    assertEq(a.hasSubnets, true);
    assertEq(a.publicHostname, "edge.acme.example");
    assertEq(circuitSubnets(rec).length, 2);
    assertEq(circuitStaticIps(rec).length, 2);
    // A circuit with no addressing reports so.
    assertEq(addressingSummary(circuit("Aurora", {})).hasAddressing, false);
    // An explicit static-IP count wins over the parsed one.
    assertEq(addressingSummary(circuit("Aurora", { staticIps: "203.0.113.2", staticIpCount: 5 })).declared, 5);
  }],

  ["the profile normalises the reseller and technical view", () => {
    const rec = circuit("Aurora Telecom", {
      upstreamCarrier: "National Wholesale",
      sourcing: "resold",
      circuitId: "CIR-9912",
      serviceDefinition: "business",
      bandwidthDown: 100,
      bandwidthUp: 40,
      burstDown: 250,
      burstUp: 100,
      slaTarget: "business",
      subnets: "203.0.113.0/29",
      cpeRole: "firewall",
      costPrice: 40,
      sellPrice: 100,
      contractStartDate: "2026-01-01",
      contractTermMonths: 24,
      contractEndDate: "2027-12-31",
    });
    const p = circuitProfile(rec);
    assertEq(p.carrier, "Aurora Telecom");
    assertEq(p.upstreamCarrier, "National Wholesale");
    assertEq(p.upstreamIsWholesale, true);
    assertEq(p.sourcingLabel, "Resold");
    assertEq(p.accessLabel, "Fibre (FTTP)");
    assertEq(p.serviceDefinitionLabel, "Business");
    assertEq(p.slaTarget.label, "Business");
    assertEq(p.contention, "2.5:1");
    assertEq(p.cpeLabel, "Firewall / security gateway");
    assertEq(p.staticIpCount, 6);
    assertEq(p.pricing.margin, 60);
    // A record with no upstream falls back to the carrier.
    assertEq(circuitProfile(circuit("Aurora")).upstreamCarrier, "Aurora");
    assertEq(circuitProfile(circuit("Aurora")).upstreamIsWholesale, false);
    assertEq(circuitProfile(null), null);
    assert(/National Wholesale/.test(circuitSummaryLine(rec)), "summary names the upstream");
    assert(/Business tier/.test(circuitSummaryLine(rec)), "summary names the tier");
  }],

  ["the contract tracks its term and expiry", () => {
    const rec = circuit("Aurora", { contractStartDate: "2026-01-01", contractTermMonths: 24, contractEndDate: "2026-07-01" });
    const c = circuitContract(rec, { now: NOW });
    assertEq(c.termMonths, 24);
    assertEq(c.daysLeft, 16);
    assertEq(c.expiringSoon, true);
    assertEq(c.expired, false);
    assertEq(c.hasTerm, true);
    assertEq(circuitContract(circuit("Aurora", { contractEndDate: "2026-05-01" }), { now: NOW }).expired, true);
    assertEq(circuitContract(circuit("Aurora"), { now: NOW }).hasTerm, false);
  }],

  ["the sold service definition is compared with what is provisioned", () => {
    // Sold as Business (100/40, burst 250/100, business SLA) — provisioned lower.
    const under = circuit("Aurora", { serviceDefinition: "business", bandwidthDown: 50, bandwidthUp: 20, burstDown: 100, burstUp: 40, slaTarget: "standard" });
    const drift = circuitDefinitionDrift(under);
    assertEq(drift.definition.id, "business");
    assertEq(drift.matches, false);
    const fields = drift.rows.map((r) => r.field);
    assert(fields.includes("committedDown"), "committed bandwidth drift");
    assert(fields.includes("burstDown"), "burst drift");
    assert(fields.includes("slaTarget"), "SLA drift");
    assertEq(drift.rows.find((r) => r.field === "committedDown").direction, "below");
    // A circuit that matches its plan has no drift.
    const match = circuit("Aurora", { serviceDefinition: "business", bandwidthDown: 100, bandwidthUp: 40, burstDown: 250, burstUp: 100, slaTarget: "business" });
    assertEq(circuitDefinitionDrift(match).matches, true);
    assertEq(circuitDefinitionDrift(match).rows.length, 0);
    // No definition → nothing to compare.
    assertEq(circuitDefinitionDrift(circuit("Aurora", {})), null);
  }],

  ["circuitDependents finds the services and people linked to a circuit", async () => {
    const world = makeWorld({ namespace: "kb-circuit" });
    const set = await world.docs.create({ name: "Acme" });
    const c = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Aurora circuit", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "Aurora", circuitType: "fibre" }, ...CL })).record;
    const voice = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Voice platform", assetTypeId: "atype-voice-pbx", assetFields: { platformType: "3cx" }, ...CL })).record;
    const contact = (await world.docs.addRecord(set.id, { type: "contacts", name: "Priya Nair", contactRole: "isp-carrier", ...CL })).record;
    await world.docs.linkRecords(set.id, { from: ref(voice), to: ref(c), kind: "voice-circuit" });
    await world.docs.linkRecords(set.id, { from: ref(contact), to: ref(c), kind: "contact-circuit" });
    const deps = circuitDependents(c, await world.docs.get(set.id, { force: true }));
    assertEq(deps.length, 2, "voice + contact depend on the circuit");
    assert(deps.some((d) => d.target.id === voice.id), "the voice platform is a dependent");
    assert(deps.every((d) => d.relationship.kind), "each dependent names its link kind");
  }],

  ["the audit flags an incomplete resold circuit and passes a complete one", async () => {
    const world = makeWorld({ namespace: "kb-circuit" });
    const set = await world.docs.create({ name: "Acme" });
    const freshType = builtinAssetType(WAN_CIRCUIT_TYPE_ID);
    assert(freshType, "the shipped circuit template exists");
    assert(freshType.fields.some((f) => f.key === "serviceDefinition"), "the template records a service definition");
    assert(freshType.fields.some((f) => f.key === "upstreamCarrier"), "the template records an upstream carrier");
    assert(freshType.fields.some((f) => f.key === "burstDown"), "the template records burst bandwidth");
    assert(freshType.fields.some((f) => f.key === "subnets"), "the template records subnets");

    const bare = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Bare circuit", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "Aurora", circuitType: "fibre" }, ...CL })).record;
    const full = (await world.docs.addRecord(set.id, {
      type: "flexibleAssets",
      name: "Complete circuit",
      assetTypeId: WAN_CIRCUIT_TYPE_ID,
      assetFields: {
        carrier: "Aurora", upstreamCarrier: "National Wholesale", sourcing: "resold", circuitType: "fibre",
        serviceDefinition: "business", bandwidthDown: 100, bandwidthUp: 40, burstDown: 250, burstUp: 100,
        slaTarget: "business", subnets: "203.0.113.0/29", cpeRole: "firewall",
        costPrice: 40, sellPrice: 100, contractStartDate: "2026-01-01", contractTermMonths: 24,
      },
      ...CL,
    })).record;
    const set2 = await world.docs.get(set.id, { force: true });
    const issues = circuitIssues(set2);
    const bareCodes = codes(issues.filter((i) => i.recordId === bare.id));
    for (const c of ["circuit-no-committed", "circuit-no-addressing", "circuit-no-cpe", "circuit-no-sla", "circuit-no-contract-term", "circuit-no-service-definition", "circuit-no-pricing"]) {
      assert(bareCodes.includes(c), `bare circuit flagged ${c}`);
    }
    assertEq(issues.filter((i) => i.recordId === full.id).length, 0, "the complete circuit is clean");
    assertEq(issues.find((i) => i.recordId === bare.id).level, "warning", "circuit findings are warnings");
    // A drift is a warning too.
    const drifty = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Drift circuit", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "Aurora", circuitType: "fibre", serviceDefinition: "business", bandwidthDown: 50, slaTarget: "business" }, ...CL })).record;
    const codes2 = codes(circuitIssues(await world.docs.get(set.id, { force: true })));
    assert(codes2.includes("circuit-plan-drift"), "a plan drift is flagged");
    // Folded into the standardized audit.
    assert(codes(standardizedIssues(await world.docs.get(set.id, { force: true }))).includes("circuit-no-committed"), "circuit audit is part of standardizedIssues");
    void drifty;
  }],
];

export async function run() {
  return runTests(tests.map(([name, fn]) => ({ name, fn })));
}
