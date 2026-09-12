// src/framework/network.js — the network-service vocabulary and audits
// (roadmap task 33).
//
// Task 33 asks IT-U to model the client's connectivity as structured SERVICES:
//   • internet/WAN services — the carrier, the circuits, the public addressing
//     and how circuits are aggregated — related to the edge firewalls and
//     security that guard them;
//   • LAN records — the architecture, subnets and IP addressing, internal DNS,
//     VPN network details, cabling and server topology — related to the
//     switches and servers that make it up; and
//   • wireless records — the SSIDs, security and controller — related to the
//     access-point configurations they run on and the LAN they serve.
//
// The templates (./assetLibrary.js, `atype-wan-service`, `atype-lan`,
// `atype-wireless`) carry the fields; the relationship catalog
// (./relationships.js) carries the typed links; and this module is the SHARED
// VOCABULARY both draw on. It also holds the per-service completeness audits the
// Linter folds in (./standardized.js), so a WAN service with no addressing, a
// LAN with no subnets or a wireless network with no security is flagged rather
// than silently incomplete.

import { relationsOf } from "./relationships.js";

// ---- internet / WAN --------------------------------------------------------
export const WAN_SERVICE_KINDS = [
  { id: "primary", label: "Primary internet", description: "The client's main internet connection." },
  { id: "secondary", label: "Secondary / failover", description: "A second connection used when the primary fails." },
  { id: "backup-mobile", label: "Backup (4G / 5G)", description: "A mobile connection held in reserve or used as the primary at small sites." },
  { id: "mpls", label: "MPLS", description: "A carrier-managed private WAN." },
  { id: "point-to-point", label: "Point-to-point", description: "A private link between two fixed sites." },
  { id: "sd-wan", label: "SD-WAN", description: "A software-defined overlay across several transports." },
  { id: "dark-fibre", label: "Dark fibre", description: "Unlit fibre the client or provider lights itself." },
  { id: "satellite", label: "Satellite", description: "Satellite connectivity, typically for remote sites." },
  { id: "other", label: "Other", description: "Any other WAN service." },
];

export const WAN_SERVICE_KIND_IDS = WAN_SERVICE_KINDS.map((k) => k.id);
export const wanServiceKind = (id) => WAN_SERVICE_KINDS.find((k) => k.id === id) || null;
export const wanServiceKindLabel = (id) => (wanServiceKind(id) || {}).label || "";
export const wanServiceKindOptions = () => WAN_SERVICE_KINDS.map((k) => ({ id: k.id, label: k.label }));

// The physical/contractual circuit technology. Shared with the circuit asset so
// the service and its individual circuits speak the same language.
export const NETWORK_CIRCUIT_TYPES = [
  { id: "fibre", label: "Fibre (FTTP)" },
  { id: "fttn", label: "FTTN" },
  { id: "fttc", label: "FTTC" },
  { id: "fttb", label: "FTTB" },
  { id: "hfc", label: "HFC / cable" },
  { id: "dsl", label: "DSL" },
  { id: "wireless", label: "Fixed wireless" },
  { id: "ethernet", label: "Ethernet / EoFTTC" },
  { id: "other", label: "Other" },
];

export const NETWORK_CIRCUIT_TYPE_IDS = NETWORK_CIRCUIT_TYPES.map((c) => c.id);
export const networkCircuitType = (id) => NETWORK_CIRCUIT_TYPES.find((c) => c.id === id) || null;
export const circuitTypeOptions = () => NETWORK_CIRCUIT_TYPES.map((c) => ({ id: c.id, label: c.label }));

// ---- LAN -------------------------------------------------------------------
export const LAN_ARCHITECTURES = [
  { id: "flat", label: "Flat / single subnet", description: "One broadcast domain for the whole site." },
  { id: "vlan-segmented", label: "VLAN-segmented", description: "A single switching fabric split into VLANs." },
  { id: "routed-core", label: "Routed core", description: "A layer-3 core routing between VLANs and sites." },
  { id: "collapsed-core", label: "Collapsed core", description: "A combined core/distribution layer at small sites." },
  { id: "spine-leaf", label: "Spine-leaf", description: "A datacentre-style spine-leaf fabric." },
  { id: "hub-spoke", label: "Hub and spoke", description: "Branch links back to a central hub." },
  { id: "hybrid", label: "Hybrid", description: "A mix of the above across the estate." },
  { id: "other", label: "Other", description: "Any other LAN architecture." },
];

export const LAN_ARCHITECTURE_IDS = LAN_ARCHITECTURES.map((a) => a.id);
export const lanArchitecture = (id) => LAN_ARCHITECTURES.find((a) => a.id === id) || null;
export const lanArchitectureLabel = (id) => (lanArchitecture(id) || {}).label || "";
export const lanArchitectureOptions = () => LAN_ARCHITECTURES.map((a) => ({ id: a.id, label: a.label }));

export const LAN_CABLING = [
  { id: "cat5e", label: "Cat5e" },
  { id: "cat6", label: "Cat6" },
  { id: "cat6a", label: "Cat6a" },
  { id: "fibre", label: "Fibre" },
  { id: "mixed", label: "Mixed" },
  { id: "other", label: "Other" },
];

export const LAN_CABLING_IDS = LAN_CABLING.map((c) => c.id);
export const lanCabling = (id) => LAN_CABLING.find((c) => c.id === id) || null;
export const cablingOptions = () => LAN_CABLING.map((c) => ({ id: c.id, label: c.label }));

// ---- wireless --------------------------------------------------------------
export const WIRELESS_STANDARDS = [
  { id: "wifi4", label: "Wi-Fi 4 (802.11n)" },
  { id: "wifi5", label: "Wi-Fi 5 (802.11ac)" },
  { id: "wifi6", label: "Wi-Fi 6 (802.11ax)" },
  { id: "wifi6e", label: "Wi-Fi 6E" },
  { id: "wifi7", label: "Wi-Fi 7 (802.11be)" },
  { id: "mixed", label: "Mixed generations" },
  { id: "other", label: "Other" },
];

export const WIRELESS_STANDARD_IDS = WIRELESS_STANDARDS.map((s) => s.id);
export const wirelessStandard = (id) => WIRELESS_STANDARDS.find((s) => s.id === id) || null;
export const wirelessStandardOptions = () => WIRELESS_STANDARDS.map((s) => ({ id: s.id, label: s.label }));

export const WIRELESS_SECURITY_MODES = [
  { id: "wpa2-psk", label: "WPA2-Personal", secure: true },
  { id: "wpa2-enterprise", label: "WPA2-Enterprise", secure: true },
  { id: "wpa3-psk", label: "WPA3-Personal", secure: true },
  { id: "wpa3-enterprise", label: "WPA3-Enterprise", secure: true },
  { id: "wpa2-wpa3-mixed", label: "WPA2/WPA3 mixed", secure: true },
  { id: "captive-portal", label: "Captive portal", secure: true },
  { id: "open", label: "Open (no encryption)", secure: false },
  { id: "other", label: "Other", secure: true },
];

export const WIRELESS_SECURITY_MODE_IDS = WIRELESS_SECURITY_MODES.map((m) => m.id);
export const wirelessSecurityMode = (id) => WIRELESS_SECURITY_MODES.find((m) => m.id === id) || null;
export const wirelessSecurityModeLabel = (id) => (wirelessSecurityMode(id) || {}).label || "";
export const wirelessSecurityOptions = () => WIRELESS_SECURITY_MODES.map((m) => ({ id: m.id, label: m.label }));
export const isSecureWirelessMode = (id) => !!(wirelessSecurityMode(id) || {}).secure;

export const WIRELESS_AUTH_METHODS = [
  { id: "psk", label: "Pre-shared key" },
  { id: "dot1x-radius", label: "802.1X / RADIUS" },
  { id: "captive-portal", label: "Captive portal" },
  { id: "certificate", label: "Certificate" },
  { id: "saml", label: "SAML / SSO" },
  { id: "other", label: "Other" },
];

export const WIRELESS_AUTH_METHOD_IDS = WIRELESS_AUTH_METHODS.map((m) => m.id);
export const wirelessAuthMethod = (id) => WIRELESS_AUTH_METHODS.find((m) => m.id === id) || null;
export const wirelessAuthOptions = () => WIRELESS_AUTH_METHODS.map((m) => ({ id: m.id, label: m.label }));

export const WIRELESS_BANDS = [
  { id: "2.4ghz", label: "2.4 GHz" },
  { id: "5ghz", label: "5 GHz" },
  { id: "6ghz", label: "6 GHz" },
];

export const WIRELESS_BAND_IDS = WIRELESS_BANDS.map((b) => b.id);
export const wirelessBand = (id) => WIRELESS_BANDS.find((b) => b.id === id) || null;
export const bandOptions = () => WIRELESS_BANDS.map((b) => ({ id: b.id, label: b.label }));

// ---- structured-service audits ---------------------------------------------
export const WAN_SERVICE_TYPE_ID = "atype-wan-service";
export const LAN_TYPE_ID = "atype-lan";
export const WIRELESS_TYPE_ID = "atype-wireless";

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const refOf = (r) => ({ type: r.type, id: r.id });

function coverage(record, set, kinds) {
  const linked = new Set(relationsOf(set, refOf(record)).map((r) => r.relationship.kind));
  return Object.fromEntries(kinds.map(([key, id]) => [key, linked.has(id)]));
}

// Which of a WAN service's relation groups are linked.
export const wanServiceCoverage = (record, set) =>
  coverage(record, set, [["firewalls", "wan-firewall"], ["security", "wan-security"], ["vendor", "wan-vendor"], ["documents", "wan-document"], ["lan", "lan-wan"], ["contacts", "contact-wan"]]);
// Which of a LAN's relation groups are linked.
export const lanCoverage = (record, set) =>
  coverage(record, set, [["switches", "lan-switch"], ["servers", "lan-server"], ["wireless", "lan-wireless"], ["wan", "lan-wan"], ["documents", "lan-document"], ["contacts", "contact-lan"]]);
// Which of a wireless network's relation groups are linked.
export const wirelessCoverage = (record, set) =>
  coverage(record, set, [["accessPoints", "wireless-ap"], ["lan", "lan-wireless"], ["security", "wireless-security"], ["documents", "wireless-document"], ["contacts", "contact-wireless"]]);

// Completeness/quality audit for the set's WAN services. Warnings never fail the
// graph audit (./docsets.js treats only errors as failures).
export function wanServiceIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || WAN_SERVICE_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = wanServiceCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.carrier)) rec("warning", "wan-no-carrier", `WAN service “${r.name}” records no carrier or ISP.`);
    if (isBlank(v.serviceKind)) rec("warning", "wan-no-service-kind", `WAN service “${r.name}” records no service kind.`);
    if (isBlank(v.addressScheme) && isBlank(v.ipv4Range) && isBlank(v.ipv6Range)) rec("warning", "wan-no-addressing", `WAN service “${r.name}” records no public IP addressing.`);
    if (!cov.firewalls && !cov.security && isBlank(v.firewallRecord)) rec("warning", "wan-no-edge-protection", `WAN service “${r.name}” is not linked to an edge firewall or security platform.`);
    if (!cov.vendor && isBlank(v.vendorRecord)) rec("warning", "wan-no-vendor", `WAN service “${r.name}” has no carrier/vendor record linked.`);
  }
  return issues;
}

// Completeness/quality audit for the set's LAN records.
export function lanIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || LAN_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = lanCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.architecture)) rec("warning", "lan-no-architecture", `LAN “${r.name}” records no architecture.`);
    if (isBlank(v.subnets) && isBlank(v.addressing)) rec("warning", "lan-no-addressing", `LAN “${r.name}” records no subnets or IP addressing.`);
    if (!cov.switches) rec("warning", "lan-no-switches", `LAN “${r.name}” is not linked to any switch.`);
    if (!cov.servers) rec("warning", "lan-no-servers", `LAN “${r.name}” is not linked to any server.`);
    if (isBlank(v.internalDns) && isBlank(v.dnsDomain)) rec("warning", "lan-no-dns", `LAN “${r.name}” records no internal DNS.`);
  }
  return issues;
}

// Completeness/quality audit for the set's wireless records.
export function wirelessIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || WIRELESS_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = wirelessCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.ssids)) rec("warning", "wireless-no-ssid", `Wireless network “${r.name}” records no SSID.`);
    if (isBlank(v.securityMode)) rec("warning", "wireless-no-security", `Wireless network “${r.name}” records no security mode.`);
    else if (!isSecureWirelessMode(v.securityMode)) rec("warning", "wireless-open", `Wireless network “${r.name}” is recorded as open / unencrypted.`);
    if (!cov.accessPoints && isBlank(v.apCount)) rec("warning", "wireless-no-access-points", `Wireless network “${r.name}” is not linked to any access-point configuration.`);
    if (!cov.lan && isBlank(v.lanRecord)) rec("warning", "wireless-no-lan", `Wireless network “${r.name}” is not linked to a LAN record.`);
  }
  return issues;
}

// Fold all three network-service audits together (used by ./standardized.js).
export function networkServiceIssues(set, opts = {}) {
  return [...wanServiceIssues(set, opts), ...lanIssues(set, opts), ...wirelessIssues(set, opts)];
}
