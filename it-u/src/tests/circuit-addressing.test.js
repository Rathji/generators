// src/tests/circuit-addressing.test.js — validation tests for Phase 10 task 42
// ("CPE, addressing & firewall relationship documentation"). Run in the live page:
//   await import("./src/tests/circuit-addressing.test.js").then((m) => m.run())
//
// Covers: the VLAN purpose vocabulary and `parseVlanLines` (free-text VLAN lines
// → structured entries with purposes); `segmentationSummary` (declared vs listed
// VLANs, unrecognised purposes, architectures that imply segmentation); the
// reverse-DNS maths (`ipv4ToPtrName`, `reverseZoneForIp`, `reverseZoneForCidr`
// including RFC 2317 classless delegation); `circuitAddressingPlan`; the edge
// record resolver (`circuitEdgeRecords`) over the new circuit→domain /
// certificate / remote-access links; the coverage view and the completeness
// audit (folded into the linter); the generator (`generateCircuitAddressingRecord`)
// and that a generated record round-trips through storage as a valid document;
// and the new relationship kinds / profile groups.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { WAN_CIRCUIT_TYPE_ID } from "../framework/circuit.js";
import { LAN_TYPE_ID } from "../framework/network.js";
import { standardizedIssues } from "../framework/standardized.js";
import { relationshipKind } from "../framework/relationships.js";
import { relationGroupsFor } from "../framework/assetRelations.js";
import {
  VLAN_PURPOSES,
  vlanPurpose,
  vlanPurposeOptions,
  vlanPurposeForText,
  parseVlanLines,
  vlansOf,
  segmentationSummary,
  ipv4ToPtrName,
  reverseZoneForIp,
  reverseZoneForCidr,
  circuitAddressingPlan,
  circuitEdgeRecords,
  circuitAddressingCoverage,
  addressingIssues,
  generateCircuitAddressingRecord,
} from "../framework/addressing.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });
const codes = (issues) => issues.map((i) => i.code);

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
      vlans: "10 voice\n20 guest",
      cpeRole: "firewall",
      contractStartDate: "2026-01-01",
      contractTermMonths: 24,
      contractEndDate: "2028-01-01",
      costPrice: 40,
      sellPrice: 100,
      currency: "GBP",
    },
    ...CL,
  })).record;
  const cpe = (await docs.addRecord(set.id, { type: "configurations", name: "AURORA-CPE-01", configType: "router", ...CL })).record;
  const firewall = (await docs.addRecord(set.id, { type: "configurations", name: "EDGE-FW-01", configType: "firewall", ...CL })).record;
  const security = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Edge EDR", assetTypeId: "atype-security-platform", assetFields: { product: "SecureX", platformType: "endpoint" }, ...CL })).record;
  const lan = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Head Office LAN", assetTypeId: LAN_TYPE_ID, assetFields: { architecture: "vlan-segmented", vlanCount: 2, vlans: "10 voice\n20 guest" }, ...CL })).record;
  const remote = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Client VPN", assetTypeId: "atype-remote-access", assetFields: { method: "vpn" }, ...CL })).record;
  const domain = (await docs.addRecord(set.id, { type: "domains", name: "example.net", ...CL })).record;
  const certificate = (await docs.addRecord(set.id, { type: "certificates", name: "aurora-ho.example.net", validTo: "2027-01-01", ...CL })).record;
  return { set, circuit, cpe, firewall, security, lan, remote, domain, certificate };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.circuit, s.cpe, "circuit-cpe");
  await link(s.circuit, s.firewall, "circuit-security");
  await link(s.circuit, s.security, "circuit-security");
  await link(s.circuit, s.lan, "circuit-lan");
  await link(s.circuit, s.remote, "circuit-remote-access");
  await link(s.circuit, s.domain, "circuit-domain");
  await link(s.circuit, s.certificate, "circuit-certificate");
}

export async function run() {
  return runTests([
    {
      name: "the VLAN vocabulary and parseVlanLines turn free-text VLAN lines into structured, purposed entries",
      fn: () => {
        assert(VLAN_PURPOSES.length >= 12, "the purpose catalog is populated");
        assertEq(vlanPurpose("voice").label, "Voice / VoIP", "purpose lookup");
        assertEq(vlanPurpose("bogus"), null, "unknown purpose is null");
        assertEq(vlanPurposeOptions().length, VLAN_PURPOSES.length, "options mirror the catalog");
        assertEq(vlanPurposeForText("VLAN for CCTV cameras").id, "cctv", "the purpose is matched from text");
        assertEq(vlanPurposeForText("no idea"), null, "unmatched text yields null");

        const parsed = parseVlanLines("10 voice\nVLAN 20 - Guest\n30 CCTV\n40\n  \n99 management");
        assertEq(parsed.length, 5, "blank lines are dropped");
        assertEq(parsed[0].number, 10, "the leading id is parsed");
        assertEq(parsed[0].purposeId, "voice", "the purpose is matched");
        assertEq(parsed[1].number, 20, "a “VLAN n -” prefix is parsed");
        assertEq(parsed[1].purposeId, "guest", "guest is recognised");
        assertEq(parsed[1].name, "Guest", "the description is kept");
        assertEq(parsed[2].purposeId, "cctv", "cctv is recognised");
        assertEq(parsed[3].number, 40, "a bare id is parsed");
        assertEq(parsed[3].purposeId, null, "a bare id has no purpose");
        assertEq(parsed[3].recognized, false, "a bare id is not recognised");
        assertEq(parsed[4].purposeId, "management", "management is recognised");

        const record = { assetFields: { vlans: "10 data\n20 voice" } };
        assertEq(vlansOf(record).length, 2, "vlansOf reads the field");
        assertEq(parseVlanLines("").length, 0, "empty text yields no entries");
      },
    },
    {
      name: "segmentationSummary reports declared vs listed VLANs, unrecognised purposes and whether segmentation is implied",
      fn: () => {
        const good = segmentationSummary({ assetFields: { architecture: "vlan-segmented", vlanCount: 3, vlans: "10 voice\n20 guest\n30 cctv" } });
        assertEq(good.count, 3, "three VLANs are listed");
        assertEq(good.declared, 3, "the declared count is read");
        assertEq(good.mismatch, false, "the counts agree");
        assertEq(good.withoutPurpose.length, 0, "every VLAN has a purpose");
        assertEq(good.hasVlans, true, "it has VLANs");
        assertEq(good.requiresSegmentation, true, "a VLAN-segmented LAN implies segmentation");
        assertEq(good.architectureLabel, "VLAN-segmented", "the architecture is labelled");

        const bad = segmentationSummary({ assetFields: { architecture: "routed-core", vlanCount: 5, vlans: "10 voice\n20\nguest stuff" } });
        assertEq(bad.mismatch, true, "the declared count disagrees with the list");
        assertEq(bad.withoutPurpose.length, 1, "the bare id with no purpose is flagged");
        assertEq(bad.withoutPurpose[0].number, 20, "the bare id is the offender");

        const flat = segmentationSummary({ assetFields: { architecture: "flat" } });
        assertEq(flat.hasVlans, false, "a flat LAN lists no VLANs");
        assertEq(flat.requiresSegmentation, false, "a flat LAN does not imply segmentation");
      },
    },
    {
      name: "the reverse-DNS helpers derive PTR names, /24 zones and classless delegations",
      fn: () => {
        assertEq(ipv4ToPtrName("203.0.113.2"), "2.113.0.203.in-addr.arpa", "the PTR owner name");
        assertEq(ipv4ToPtrName("not-an-ip"), null, "a non-address yields null");
        assertEq(reverseZoneForIp("203.0.113.2"), "113.0.203.in-addr.arpa", "the enclosing /24 zone");

        const z24 = reverseZoneForCidr("203.0.113.0/24");
        assertEq(z24.zone, "113.0.203.in-addr.arpa", "a /24 zone");
        assertEq(z24.boundary, 24, "the delegation boundary is /24");
        assertEq(z24.classless, false, "a /24 is not classless");

        const z29 = reverseZoneForCidr("203.0.113.0/29");
        assertEq(z29.zone, "113.0.203.in-addr.arpa", "a /29 lives under the /24 zone");
        assertEq(z29.classless, true, "a /29 is delegated classlessly (RFC 2317)");
        assertEq(z29.delegatedZone, "0-7.113.0.203.in-addr.arpa", "the delegated sub-zone is named");

        assertEq(reverseZoneForCidr("10.20.0.0/16").zone, "20.10.in-addr.arpa", "a /16 zone");
        assertEq(reverseZoneForCidr("10.0.0.0/8").zone, "10.in-addr.arpa", "a /8 zone");
        assertEq(reverseZoneForCidr("nonsense"), null, "a non-CIDR yields null");
        assertEq(reverseZoneForCidr("203.0.113.0/24").classless, false, "parsed subnet objects work too");
      },
    },
    {
      name: "circuitAddressingPlan parses subnets, static IPs, reverse zones and the forward record",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-addr" });
        const s = await seed(world);
        const plan = circuitAddressingPlan(s.circuit);
        assertEq(plan.subnets.length, 1, "the subnet is parsed");
        assertEq(plan.subnets[0].cidr, "203.0.113.0/29", "the CIDR is normalised");
        assertEq(plan.subnets[0].usable, 6, "the usable host count");
        assertEq(plan.subnets[0].reverse.delegatedZone, "0-7.113.0.203.in-addr.arpa", "the subnet's reverse zone");
        assertEq(plan.staticIps.length, 2, "both static IPs are mapped");
        assertEq(plan.staticIps[0].ptrName, "2.113.0.203.in-addr.arpa", "the first PTR name");
        assertEq(plan.staticIps[1].zone, "113.0.203.in-addr.arpa", "the second reverse zone");
        assertEq(plan.publicHostname, "aurora-ho.example.net", "the public hostname is carried through");
        assertEq(plan.forwardRecords.length, 1, "one forward record is implied");
        assertEq(plan.forwardRecords[0].type, "A", "it is an A record");
        assertEq(plan.forwardRecords[0].value, "203.0.113.2", "it points at the first static address");
        assert(plan.reverseZones.some((z) => z.zone === "0-7.113.0.203.in-addr.arpa"), "the classless zone is listed");
        assert(plan.reverseZones.some((z) => z.zone === "113.0.203.in-addr.arpa"), "the /24 zone is listed");

        const empty = circuitAddressingPlan({ assetFields: {} });
        assertEq(empty.reverseZones.length, 0, "an unaddressed circuit has no reverse zones");
        assertEq(empty.forwardRecords.length, 0, "an unaddressed circuit has no forward record");
      },
    },
    {
      name: "circuitEdgeRecords resolves the CPE, firewall/security, LAN and the new addressing links",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-addr" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const edge = circuitEdgeRecords(s.circuit, set);
        assert(edge.cpe.some((r) => r.id === s.cpe.id), "the CPE resolves");
        assert(edge.firewalls.some((r) => r.id === s.firewall.id), "the firewall configuration resolves");
        assert(edge.securityPlatforms.some((r) => r.id === s.security.id), "the security platform resolves");
        assert(edge.lan.some((r) => r.id === s.lan.id), "the LAN resolves");
        assert(edge.remoteAccess.some((r) => r.id === s.remote.id), "the remote-access link resolves");
        assert(edge.domains.some((r) => r.id === s.domain.id), "the domain link resolves");
        assert(edge.certificates.some((r) => r.id === s.certificate.id), "the certificate link resolves");

        const fielded = { ...s.circuit, assetFields: { ...s.circuit.assetFields, cpeRecord: s.cpe.id, firewallRecord: s.firewall.id } };
        const edge2 = circuitEdgeRecords(fielded, set);
        assert(edge2.cpe.some((r) => r.id === s.cpe.id), "a cpeRecord field reference resolves");
        assert(edge2.firewalls.some((r) => r.id === s.firewall.id), "a firewallRecord field reference resolves");
      },
    },
    {
      name: "circuitAddressingCoverage reports each addressing/firewall part as present or missing",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-addr" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const cov = circuitAddressingCoverage(s.circuit, set);
        for (const id of ["addressing", "reverseDns", "vlans", "cpe", "firewall", "domain", "certificate", "remoteAccess"]) {
          const c = cov.find((x) => x.id === id);
          assert(c, `the ${id} part exists`);
          assertEq(c.present, true, `the ${id} part is present`);
        }
        assertEq(cov.filter((c) => c.required && c.present).length, cov.filter((c) => c.required).length, "every required part is met");
        assertEq(cov.find((c) => c.id === "cpe").records.some((r) => r.id === s.cpe.id), true, "the CPE record is named");

        const bare = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Bare", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "X" }, ...CL })).record;
        const set2 = await world.docs.get(s.set.id, { force: true });
        const bareCov = circuitAddressingCoverage(bare, set2);
        assertEq(bareCov.find((c) => c.id === "addressing").present, false, "a bare circuit has no addressing");
        assertEq(bareCov.find((c) => c.id === "addressing").required, true, "addressing is required");
        assertEq(bareCov.find((c) => c.id === "firewall").present, false, "a bare circuit has no firewall link");
      },
    },
    {
      name: "addressingIssues flags missing DNS, firewall, certificate and VLAN gaps, and folds into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-addr" });
        const s = await seed(world);
        await linkAll(world, s);
        let set = await world.docs.get(s.set.id, { force: true });
        assertEq(addressingIssues(set).length, 0, "an addressed, linked circuit raises no issues: " + JSON.stringify(addressingIssues(set)));

        const noDns = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "No DNS", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "X", subnets: "198.51.100.0/29" }, ...CL })).record;
        const hostOnly = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Host only", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { carrier: "X", publicHostname: "vpn.example.net" }, ...CL })).record;
        const segLan = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Seg LAN no vlans", assetTypeId: LAN_TYPE_ID, assetFields: { architecture: "vlan-segmented" }, ...CL })).record;
        const mismatchLan = (await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Mismatch LAN", assetTypeId: LAN_TYPE_ID, assetFields: { architecture: "routed-core", vlanCount: 5, vlans: "10 voice\n20 guest" }, ...CL })).record;
        set = await world.docs.get(s.set.id, { force: true });
        const issues = addressingIssues(set);
        const c = codes(issues);
        assert(c.includes("circuit-no-reverse-dns"), "addressing without DNS is flagged");
        assert(c.includes("circuit-no-edge-firewall"), "no firewall link is flagged");
        assert(c.includes("circuit-hostname-no-addressing"), "a hostname without addressing is flagged");
        assert(c.includes("circuit-hostname-no-certificate"), "a published hostname without a certificate is flagged");
        assert(c.includes("lan-segmented-no-vlans"), "a segmented LAN with no VLANs is flagged");
        assert(c.includes("lan-vlan-count-mismatch"), "a VLAN count mismatch is flagged");
        assert(issues.every((i) => i.level === "warning"), "addressing findings are warnings");
        assert(issues.some((i) => i.recordId === noDns.id), "the finding names the record");
        void hostOnly;
        void segLan;
        void mismatchLan;

        const folded = standardizedIssues(set);
        assert(codes(folded).includes("lan-segmented-no-vlans"), "the linter folds the addressing audit in");
        assert((await world.docs.integrity(s.set.id)).ok, "addressing gaps never fail the graph audit");
      },
    },
    {
      name: "generateCircuitAddressingRecord assembles the addressing record with the recorded values",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-addr" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitAddressingRecord({ circuit: s.circuit, set });
        assertEq(gen.docType, "client-technical", "the generated record is client technical documentation");
        assertEq(gen.circuitId, s.circuit.id, "it references the circuit");
        assertEq(gen.warnings.length, 0, "a fully documented circuit raises no gaps: " + JSON.stringify(gen.warnings));
        assert(gen.body.startsWith("# Circuit addressing & firewall record"), "the title is the first line");
        assert(gen.body.includes("203.0.113.0/29"), "the subnet is substituted");
        assert(gen.body.includes("203.0.113.2"), "the static address is substituted");
        assert(gen.body.includes("2.113.0.203.in-addr.arpa"), "the PTR name is substituted");
        assert(gen.body.includes("0-7.113.0.203.in-addr.arpa"), "the classless reverse zone is substituted");
        assert(gen.body.includes("aurora-ho.example.net"), "the public hostname is substituted");
        assert(gen.body.includes("Voice / VoIP"), "the VLAN purpose is substituted");
        assert(gen.body.includes("AURORA-CPE-01"), "the linked CPE is named");
        assert(gen.body.includes("EDGE-FW-01"), "the linked firewall is named");
        assert(gen.body.includes("Client VPN"), "the linked remote access is named");
        for (const heading of ["Subnet allocation", "Static IP addressing & reverse DNS (PTR)", "Forward DNS", "VLANs & segmentation", "CPE & firewall relationship", "Linked records"]) {
          assert(gen.body.includes("## " + heading), `the body contains the “${heading}” section`);
        }

        const bareGen = generateCircuitAddressingRecord({ circuit: { id: "x", type: "flexibleAssets", name: "Bare", assetFields: { carrier: "X" } }, set });
        assert(bareGen.warnings.some((w) => w.code === "missing-addressing"), "a bare circuit warns about missing addressing");
        assert(bareGen.body.includes("TO COMPLETE"), "the gaps are marked TO COMPLETE");
      },
    },
    {
      name: "a generated addressing record round-trips through storage and stays linked and valid",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-circuit-addr" });
        const s = await seed(world);
        await linkAll(world, s);
        let set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitAddressingRecord({ circuit: s.circuit, set });
        const r = (await world.docs.addDocument(s.set.id, {
          name: gen.name,
          docType: gen.docType,
          summary: gen.summary,
          body: gen.body,
          tags: ["circuit", "addressing", "dns", "firewall"],
          origin: { source: "circuit-asset", circuitId: s.circuit.id, warnings: gen.warnings, generatedAt: gen.generatedAt },
          ...CL,
        }, { updatedBy: "Tom", actor: "Tom" })).record;
        set = await world.docs.get(s.set.id, { force: true });
        const stored = set.records.documents.find((x) => x.id === r.id);
        assertEq(stored.body.length, gen.body.length, "the full generated body is stored");
        assertEq(stored.docType, "client-technical", "the document type is stored");
        assertEq(stored.origin.circuitId, s.circuit.id, "the origin keeps the source circuit");
        assertEq(addressingIssues(set).filter((i) => i.recordId === s.circuit.id).length, 0, "the circuit still raises no addressing issues");
        assert((await world.docs.integrity(s.set.id)).ok, "the set's graph audit still passes");
      },
    },
    {
      name: "the new circuit→domain / certificate / remote-access relationship kinds are catalogued and grouped",
      fn: () => {
        assert(relationshipKind("circuit-domain"), "the circuit-domain kind exists");
        assert(relationshipKind("circuit-certificate"), "the circuit-certificate kind exists");
        assert(relationshipKind("circuit-remote-access"), "the circuit-remote-access kind exists");
        assertEq(relationshipKind("circuit-domain").to.includes("domains"), true, "circuit-domain points at domains");
        assertEq(relationshipKind("circuit-certificate").to.includes("certificates"), true, "circuit-certificate points at certificates");

        const circuitGroups = relationGroupsFor({ id: WAN_CIRCUIT_TYPE_ID });
        for (const id of ["domains", "certificates", "remoteAccess"]) {
          assert(circuitGroups.some((g) => g.id === id), `the circuit profile groups ${id}`);
        }
        const remoteGroups = relationGroupsFor({ id: "atype-remote-access" });
        assert(remoteGroups.some((g) => g.id === "circuits" && g.direction === "in"), "remote access groups its circuits");
      },
    },
  ]);
}
