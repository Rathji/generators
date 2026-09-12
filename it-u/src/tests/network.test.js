// src/tests/network.test.js — validation tests for Phase 8 task 33 (network
// assets — internet/WAN, LAN, wireless). Run in the live page:
//   await import("./src/tests/network.test.js").then((m) => m.run())
//
// Covers: the network vocabulary catalogs (WAN service kinds, circuit types,
// LAN architectures, cabling, wireless standards, security modes, auth methods
// and bands); the three shipped templates (`atype-wan-service`, `atype-lan`,
// `atype-wireless`) and their record-reference fields; the typed relationships
// each holds; the labelled relationship GROUPS the profile shows; the
// link-parameter/candidate computation behind those groups; and the
// per-service completeness audits folded into the Linter.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { validateAssetType } from "../framework/flexible.js";
import { relationGroupsFor, groupLinks, relationCandidates, linkParamsFor } from "../framework/assetRelations.js";
import {
  WAN_SERVICE_KINDS,
  NETWORK_CIRCUIT_TYPES,
  LAN_ARCHITECTURES,
  LAN_CABLING,
  WIRELESS_STANDARDS,
  WIRELESS_SECURITY_MODES,
  WIRELESS_AUTH_METHODS,
  WIRELESS_BANDS,
  wanServiceKind,
  wanServiceKindLabel,
  wanServiceKindOptions,
  networkCircuitType,
  circuitTypeOptions,
  lanArchitecture,
  lanArchitectureLabel,
  lanArchitectureOptions,
  lanCabling,
  cablingOptions,
  wirelessStandard,
  wirelessStandardOptions,
  wirelessSecurityMode,
  wirelessSecurityModeLabel,
  wirelessSecurityOptions,
  isSecureWirelessMode,
  wirelessAuthMethod,
  wirelessAuthOptions,
  wirelessBand,
  bandOptions,
  wanServiceCoverage,
  lanCoverage,
  wirelessCoverage,
  wanServiceIssues,
  lanIssues,
  wirelessIssues,
  networkServiceIssues,
  WAN_SERVICE_TYPE_ID,
  LAN_TYPE_ID,
  WIRELESS_TYPE_ID,
} from "../framework/network.js";
import { standardizedIssues } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });

async function seed(world) {
  const { docs } = world;
  const set = await docs.create({ name: "Acme" });
  const fx = (id) => builtinAssetType(id);
  const wan = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme fibre", assetTypeId: WAN_SERVICE_TYPE_ID, assetFields: { carrier: "BT", serviceKind: "primary", addressScheme: "81.2.3.0/29", contractEndDate: "2027-03-01" }, ...CL })).record;
  const lan = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme LAN", assetTypeId: LAN_TYPE_ID, assetFields: { architecture: "vlan-segmented", subnets: "10.0.0.0/24", internalDns: "10.0.0.10", dnsDomain: "corp.acme.example" }, ...CL })).record;
  const wireless = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme Wi-Fi", assetTypeId: WIRELESS_TYPE_ID, assetFields: { ssids: "ACME-Corp", securityMode: "wpa3-enterprise", apCount: 12 }, ...CL })).record;
  const firewall = (await docs.addRecord(set.id, { type: "configurations", name: "EDGE-FW01", configType: "firewall", ...CL })).record;
  const switchRec = (await docs.addRecord(set.id, { type: "configurations", name: "SW-CORE01", configType: "switch", ...CL })).record;
  const server = (await docs.addRecord(set.id, { type: "configurations", name: "SRV-01", configType: "server-virtual", ...CL })).record;
  const ap = (await docs.addRecord(set.id, { type: "configurations", name: "AP-FLOOR2", configType: "access-point", ...CL })).record;
  const security = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Edge Protection", assetTypeId: fx("atype-security-platform").id, assetFields: { product: "FortiGate", platformType: "firewall" }, ...CL })).record;
  const vendor = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "BT", assetTypeId: fx("atype-vendor").id, assetFields: { vendorType: "isp-carrier" }, ...CL })).record;
  const wanDoc = (await docs.addRecord(set.id, { type: "documents", name: "Circuit handover", docType: "reference", ...CL })).record;
  const lanDoc = (await docs.addRecord(set.id, { type: "documents", name: "LAN diagram notes", docType: "reference", ...CL })).record;
  const wifiDoc = (await docs.addRecord(set.id, { type: "documents", name: "Wireless survey", docType: "reference", ...CL })).record;
  const wanContact = (await docs.addRecord(set.id, { type: "contacts", name: "BT account manager", contactRole: "vendor-rep", ...CL })).record;
  const lanContact = (await docs.addRecord(set.id, { type: "contacts", name: "Network owner", contactRole: "application-owner", ...CL })).record;
  const wifiContact = (await docs.addRecord(set.id, { type: "contacts", name: "Wi-Fi owner", contactRole: "application-owner", ...CL })).record;
  return { set, wan, lan, wireless, firewall, switchRec, server, ap, security, vendor, wanDoc, lanDoc, wifiDoc, wanContact, lanContact, wifiContact };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.wan, s.firewall, "wan-firewall");
  await link(s.wan, s.security, "wan-security");
  await link(s.wan, s.vendor, "wan-vendor");
  await link(s.wan, s.wanDoc, "wan-document");
  await link(s.wanContact, s.wan, "contact-wan");

  await link(s.lan, s.switchRec, "lan-switch");
  await link(s.lan, s.server, "lan-server");
  await link(s.lan, s.wireless, "lan-wireless");
  await link(s.lan, s.wan, "lan-wan");
  await link(s.lan, s.lanDoc, "lan-document");
  await link(s.lanContact, s.lan, "contact-lan");

  await link(s.wireless, s.ap, "wireless-ap");
  await link(s.wireless, s.security, "wireless-security");
  await link(s.wireless, s.wifiDoc, "wireless-document");
  await link(s.wifiContact, s.wireless, "contact-wireless");
}

const codes = (issues) => issues.map((i) => i.code);

export async function run() {
  return runTests([
    {
      name: "the three network templates model internet/WAN, LAN and wireless as structured records",
      fn: () => {
        const wan = builtinAssetType("atype-wan-service");
        const lan = builtinAssetType("atype-lan");
        const wireless = builtinAssetType("atype-wireless");
        for (const t of [wan, lan, wireless]) {
          assert(validateAssetType(t).ok, t.name + " validates");
          assertEq(t.category, "connectivity", t.name + " lives in the connectivity category");
        }

        assert(wan.fields.find((f) => f.key === "carrier" && f.required), "WAN carrier is required");
        const kind = wan.fields.find((f) => f.key === "serviceKind" && f.required);
        assert(kind && kind.options.length === WAN_SERVICE_KINDS.length, "WAN service kind comes from the catalog");
        assert(wan.fields.find((f) => f.key === "addressScheme" && f.type === "textarea"), "WAN public addressing is captured");
        assert(wan.fields.find((f) => f.key === "circuitIds"), "WAN circuit aggregation is captured");
        assert(wan.fields.find((f) => f.key === "bandwidthDown" && f.type === "number"), "WAN bandwidth is numeric");
        assert(wan.fields.find((f) => f.key === "contractEndDate" && f.expiry === true), "WAN contract end drives renewals");
        assert(wan.fields.find((f) => f.key === "firewallRecord" && f.type === "record" && f.of === "configurations"), "WAN points at an edge firewall");

        const arch = lan.fields.find((f) => f.key === "architecture" && f.required);
        assert(arch && arch.options.length === LAN_ARCHITECTURES.length, "LAN architecture comes from the catalog");
        assert(lan.fields.find((f) => f.key === "subnets" && f.type === "textarea"), "LAN subnets are captured");
        assert(lan.fields.find((f) => f.key === "internalDns"), "LAN internal DNS is captured");
        assert(lan.fields.find((f) => f.key === "vpnNetwork"), "LAN VPN network details are captured");
        assert(lan.fields.find((f) => f.key === "cabling" && f.type === "select"), "LAN cabling is recorded");
        assert(lan.fields.find((f) => f.key === "serverTopology"), "LAN server topology is captured");

        assert(wireless.fields.find((f) => f.key === "ssids" && f.required), "wireless SSIDs are required");
        const sec = wireless.fields.find((f) => f.key === "securityMode" && f.required);
        assert(sec && sec.options.length === WIRELESS_SECURITY_MODES.length, "wireless security comes from the catalog");
        assert(wireless.fields.find((f) => f.key === "bands" && f.type === "multiselect"), "wireless bands are a multi-choice");
        assert(wireless.fields.find((f) => f.key === "securityRecord" && f.type === "record" && f.of === "flexibleAssets"), "wireless points at a security platform");
        assert(wireless.fields.find((f) => f.key === "lanRecord" && f.type === "record" && f.of === "flexibleAssets"), "wireless points at a LAN record");

        for (const t of [wan, lan, wireless]) {
          for (const r of ["configurations", "contacts", "flexibleAssets", "documents"]) {
            assert(t.references.includes(r), t.name + " may reference " + r);
          }
        }
      },
    },
    {
      name: "the network catalogs expose service kinds, circuits, LAN, wireless and bands",
      fn: () => {
        assertEq(wanServiceKind("primary").label, "Primary internet", "WAN service kind lookup");
        assertEq(wanServiceKindLabel("sd-wan"), "SD-WAN", "WAN service kind label");
        assertEq(wanServiceKind("bogus"), null, "an unknown WAN kind is null");
        assertEq(networkCircuitType("fibre").label, "Fibre (FTTP)", "circuit type lookup");
        assertEq(lanArchitecture("spine-leaf").label, "Spine-leaf", "LAN architecture lookup");
        assertEq(lanArchitectureLabel("vlan-segmented"), "VLAN-segmented", "LAN architecture label");
        assertEq(lanCabling("cat6a").label, "Cat6a", "cabling lookup");
        assertEq(wirelessStandard("wifi6").label, "Wi-Fi 6 (802.11ax)", "wireless standard lookup");
        assertEq(wirelessSecurityMode("wpa3-enterprise").label, "WPA3-Enterprise", "wireless security lookup");
        assertEq(wirelessSecurityModeLabel("open"), "Open (no encryption)", "wireless security label");
        assert(isSecureWirelessMode("wpa3-enterprise") && !isSecureWirelessMode("open"), "open is flagged insecure");
        assertEq(wirelessAuthMethod("dot1x-radius").label, "802.1X / RADIUS", "auth method lookup");
        assertEq(wirelessBand("6ghz").label, "6 GHz", "band lookup");
        assertEq(wanServiceKindOptions().length, WAN_SERVICE_KINDS.length, "WAN kind options mirror the catalog");
        assertEq(circuitTypeOptions().length, NETWORK_CIRCUIT_TYPES.length, "circuit options mirror the catalog");
        assertEq(lanArchitectureOptions().length, LAN_ARCHITECTURES.length, "LAN architecture options mirror the catalog");
        assertEq(cablingOptions().length, LAN_CABLING.length, "cabling options mirror the catalog");
        assertEq(wirelessStandardOptions().length, WIRELESS_STANDARDS.length, "wireless standard options mirror the catalog");
        assertEq(wirelessSecurityOptions().length, WIRELESS_SECURITY_MODES.length, "wireless security options mirror the catalog");
        assertEq(wirelessAuthOptions().length, WIRELESS_AUTH_METHODS.length, "auth options mirror the catalog");
        assertEq(bandOptions().length, WIRELESS_BANDS.length, "band options mirror the catalog");
        assert([wanServiceKindOptions(), circuitTypeOptions(), lanArchitectureOptions(), cablingOptions(), wirelessStandardOptions(), wirelessSecurityOptions(), wirelessAuthOptions(), bandOptions()].every((opts) => opts.every((o) => o.id && o.label)), "every option is well formed");
      },
    },
    {
      name: "a WAN service, LAN and wireless network relate to their firewalls, switches, servers, access points, security, vendors, documents and people",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-network" });
        const s = await seed(world);
        await linkAll(world, s);

        const wanRels = await world.docs.relations(s.set.id, ref(s.wan));
        assertEq(wanRels.length, 6, "six relationships touch the WAN service");
        assertEq(wanRels.map((r) => r.relationship.kind).sort().join(","), ["contact-wan", "lan-wan", "wan-document", "wan-firewall", "wan-security", "wan-vendor"].join(","), "the WAN service's link kinds");

        const lanRels = await world.docs.relations(s.set.id, ref(s.lan));
        assertEq(lanRels.length, 6, "six relationships touch the LAN");
        assertEq(lanRels.map((r) => r.relationship.kind).sort().join(","), ["contact-lan", "lan-document", "lan-server", "lan-switch", "lan-wan", "lan-wireless"].join(","), "the LAN's link kinds");

        const wifiRels = await world.docs.relations(s.set.id, ref(s.wireless));
        assertEq(wifiRels.length, 5, "five relationships touch the wireless network");
        assertEq(wifiRels.map((r) => r.relationship.kind).sort().join(","), ["contact-wireless", "lan-wireless", "wireless-ap", "wireless-document", "wireless-security"].join(","), "the wireless network's link kinds");

        const integrity = await world.docs.integrity(s.set.id);
        assert(integrity.ok, "the graph audit passes: " + JSON.stringify(integrity.issues));
      },
    },
    {
      name: "the relationship catalog refuses links that break it, duplicates and self-links",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-network" });
        const s = await seed(world);
        let threw = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.wan), to: ref(s.wanDoc), kind: "wan-firewall" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "a WAN→firewall link to a document is refused");

        await world.docs.linkRecords(s.set.id, { from: ref(s.lan), to: ref(s.switchRec), kind: "lan-switch" });
        let dup = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.lan), to: ref(s.switchRec), kind: "lan-switch" });
        } catch (e) {
          dup = e;
        }
        assert(dup && dup.code === "INVALID_DATA", "a duplicate link is refused");
        let self = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.wireless), to: ref(s.wireless), kind: "wireless-ap" });
        } catch (e) {
          self = e;
        }
        assert(self && self.code === "INVALID_DATA", "a self-link is refused");
      },
    },
    {
      name: "the profile groups each network service's links into labelled buckets",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-network" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });

        const wan = groupLinks(s.wan, set, builtinAssetType("atype-wan-service"));
        assertEq(wan.total, 6, "the WAN service's links are accounted for");
        assertEq(wan.leftovers.length, 0, "no WAN links fall outside the named groups");
        const wanById = Object.fromEntries(wan.groups.map((g) => [g.id, g]));
        for (const id of ["firewalls", "security", "vendor", "documents", "lan", "contacts"]) assert(wanById[id], "the WAN " + id + " group exists");
        assertEq(wanById.lan.direction, "in", "the LAN group attaches from the LAN side");
        assertEq(wanById.firewalls.links[0].other.name, "EDGE-FW01", "the far-side firewall is resolved");

        const lan = groupLinks(s.lan, set, builtinAssetType("atype-lan"));
        assertEq(lan.total, 6, "the LAN's links are accounted for");
        assertEq(lan.leftovers.length, 0, "no LAN links fall outside the named groups");
        const lanById = Object.fromEntries(lan.groups.map((g) => [g.id, g]));
        for (const id of ["switches", "servers", "wireless", "wan", "documents", "contacts"]) assert(lanById[id], "the LAN " + id + " group exists");
        assertEq(lanById.wireless.links[0].other.name, "Acme Wi-Fi", "the LAN resolves its wireless network");

        const wifi = groupLinks(s.wireless, set, builtinAssetType("atype-wireless"));
        assertEq(wifi.total, 5, "the wireless network's links are accounted for");
        assertEq(wifi.leftovers.length, 0, "no wireless links fall outside the named groups");
        const wifiById = Object.fromEntries(wifi.groups.map((g) => [g.id, g]));
        for (const id of ["accessPoints", "lan", "security", "documents", "contacts"]) assert(wifiById[id], "the wireless " + id + " group exists");
        assertEq(wifiById.lan.direction, "in", "the wireless LAN group attaches from the LAN side");
      },
    },
    {
      name: "group link parameters and candidate lists drive the profile's link pickers",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-network" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });

        const wanById = Object.fromEntries(relationGroupsFor(builtinAssetType("atype-wan-service")).map((g) => [g.id, g]));
        const outParams = linkParamsFor(s.wan, wanById.firewalls, s.firewall);
        assertEq(outParams.from.id, s.wan.id, "an out group links from the WAN service");
        assertEq(outParams.to.id, s.firewall.id, "…to the candidate");
        assertEq(outParams.kind, "wan-firewall", "…with the group's primary kind");
        const inParams = linkParamsFor(s.wan, wanById.lan, s.lan);
        assertEq(inParams.from.id, s.lan.id, "an in group links from the candidate LAN");
        assertEq(inParams.to.id, s.wan.id, "…to the WAN service");

        assert(relationCandidates(s.wan, set, wanById.vendor).some((r) => r.id === s.vendor.id), "an unlinked vendor is offered");
        assert(!relationCandidates(s.wan, set, wanById.security).some((r) => r.id === s.vendor.id), "the template filter keeps a vendor out of the security group");
        assert(!relationCandidates(s.wan, set, wanById.firewalls).some((r) => r.id === s.wan.id), "a group never offers the WAN service itself");

        const lanById = Object.fromEntries(relationGroupsFor(builtinAssetType("atype-lan")).map((g) => [g.id, g]));
        await world.docs.linkRecords(s.set.id, { from: ref(s.lan), to: ref(s.switchRec), kind: "lan-switch" });
        const after = await world.docs.get(s.set.id, { force: true });
        assert(!relationCandidates(s.lan, after, lanById.switches).some((r) => r.id === s.switchRec.id), "a linked switch drops out of the candidates");
      },
    },
    {
      name: "the network audits flag incomplete WAN, LAN and wireless services and fold into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-network" });
        const set = await world.docs.create({ name: "Bare" });
        const bareWan = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned WAN", assetTypeId: WAN_SERVICE_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareLan = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned LAN", assetTypeId: LAN_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareWifi = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned Wi-Fi", assetTypeId: WIRELESS_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareSet = await world.docs.get(set.id, { force: true });

        assert(!wanServiceCoverage(bareWan, bareSet).firewalls && !lanCoverage(bareLan, bareSet).switches && !wirelessCoverage(bareWifi, bareSet).accessPoints, "bare services cover nothing");

        const wan = wanServiceIssues(bareSet);
        assertEq(wan.length, 5, "five gaps flagged for a bare WAN service");
        for (const code of ["wan-no-carrier", "wan-no-service-kind", "wan-no-addressing", "wan-no-edge-protection", "wan-no-vendor"]) assert(codes(wan).includes(code), "WAN flags " + code);
        const lan = lanIssues(bareSet);
        assertEq(lan.length, 5, "five gaps flagged for a bare LAN");
        for (const code of ["lan-no-architecture", "lan-no-addressing", "lan-no-switches", "lan-no-servers", "lan-no-dns"]) assert(codes(lan).includes(code), "LAN flags " + code);
        const wifi = wirelessIssues(bareSet);
        assertEq(wifi.length, 4, "four gaps flagged for a bare wireless network");
        for (const code of ["wireless-no-ssid", "wireless-no-security", "wireless-no-access-points", "wireless-no-lan"]) assert(codes(wifi).includes(code), "wireless flags " + code);
        assert([...wan, ...lan, ...wifi].every((i) => i.level === "warning"), "gaps are warnings, not errors");

        const folded = standardizedIssues(bareSet);
        assert(codes(folded).includes("wan-no-carrier") && codes(folded).includes("lan-no-architecture") && codes(folded).includes("wireless-no-ssid"), "the linter folds the network audits in");
        assertEq(networkServiceIssues(bareSet).length, 14, "the combined network audit reports every gap");
        assert((await world.docs.integrity(set.id)).ok, "completeness gaps never fail the graph audit");

        const openWifi = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Open guest Wi-Fi", assetTypeId: WIRELESS_TYPE_ID, assetFields: { ssids: "GUEST", securityMode: "open" }, ...CL })).record;
        const openSet = await world.docs.get(set.id, { force: true });
        const openIssues = wirelessIssues(openSet).filter((i) => i.recordId === openWifi.id);
        assert(codes(openIssues).includes("wireless-open"), "an open wireless network is flagged");

        const s = await seed(world);
        await linkAll(world, s);
        const fullSet = await world.docs.get(s.set.id, { force: true });
        assertEq(wanServiceIssues(fullSet).length, 0, "a fully documented WAN service raises no issues: " + JSON.stringify(wanServiceIssues(fullSet)));
        assertEq(lanIssues(fullSet).length, 0, "a fully documented LAN raises no issues: " + JSON.stringify(lanIssues(fullSet)));
        assertEq(wirelessIssues(fullSet).length, 0, "a fully documented wireless network raises no issues: " + JSON.stringify(wirelessIssues(fullSet)));
      },
    },
  ]);
}
