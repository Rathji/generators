// src/framework/addressing.js — CPE, addressing, DNS/reverse-DNS,
// VLAN/segmentation and firewall relationship documentation for resold circuits
// (roadmap task 42).
//
// Tasks 40/41 modelled the resold circuit and its provisioning runbook. Task 42
// is the ADDRESSING half: every circuit hands over a block of public addresses,
// a router/CPE that terminates it, a firewall/security edge that guards it, and
// — where the customer publishes services — a public hostname that needs forward
// (A/AAAA) and reverse (PTR) DNS. This module turns those free-text fields into
// a consistent, checkable plan:
//   • the VLAN VOCABULARY and `parseVlanLines`, so "10 voice" / "VLAN 20 — Guest"
//     in a circuit or LAN record becomes a structured list with purposes;
//   • the reverse-DNS maths — `ipv4ToPtrName`, `reverseZoneForIp` and
//     `reverseZoneForCidr` (including RFC 2317 classless sub-/24 delegation);
//   • `circuitAddressingPlan` — the parsed subnets, static IPs, PTR names,
//     reverse zones and the forward record the public hostname implies;
//   • `circuitEdgeRecords` — the CPE, firewall/security, LAN, domain, certificate
//     and remote-access records a circuit is documented against (via the typed
//     links in ./relationships.js); and
//   • `circuitAddressingCoverage` / `addressingIssues` — what the UI card shows
//     and what the Linter folds in (./standardized.js).
//
// Like ./circuit.js and ./network.js this module is PURE (no storage): the
// template (./assetLibrary.js) carries the fields, ./relationships.js the links,
// ./assetRelations.js the profile groups.

import { assetFieldsOf } from "./flexible.js";
import { relationsOf, findRecord } from "./relationships.js";
import { addressingSummary, parseCidr, circuitProfile, WAN_CIRCUIT_TYPE_ID } from "./circuit.js";
import { LAN_TYPE_ID, lanArchitecture } from "./network.js";

const str = (v) => String(v == null ? "" : v).trim();
const blank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const fieldOf = (record, key) => {
  const f = record ? assetFieldsOf(record) : {};
  return f && typeof f === "object" ? f[key] : undefined;
};

// ---- VLAN vocabulary -------------------------------------------------------
// The purposes an IT provider segments a client's traffic into. `keywords` let
// a free-text VLAN line ("10 voice", "VLAN 30 CCTV") be matched to a purpose
// without the technician having to use a controlled vocabulary.
export const VLAN_PURPOSES = [
  { id: "voice", label: "Voice / VoIP", description: "Phones, desksets and the call platform.", keywords: ["voice", "voip", "phone", "phones", "telephony", "sip"] },
  { id: "management", label: "Management", description: "Switch/router/AP and out-of-band management.", keywords: ["management", "mgmt", "admin", "oob"] },
  { id: "guest", label: "Guest", description: "Guest and visitor access, isolated from the corporate network.", keywords: ["guest", "visitor", "visitors"] },
  { id: "wireless", label: "Wireless / Wi-Fi", description: "Wireless client traffic and access-point control.", keywords: ["wireless", "wifi", "wi-fi", "wlan"] },
  { id: "servers", label: "Servers / compute", description: "Physical and virtual servers.", keywords: ["server", "servers", "compute", "virtual", "vm"] },
  { id: "storage", label: "Storage / backup", description: "SAN/NAS traffic and backup/replication.", keywords: ["storage", "san", "nas", "backup", "iscsi"] },
  { id: "cctv", label: "CCTV / cameras", description: "IP cameras and the recording server.", keywords: ["cctv", "camera", "cameras", "video"] },
  { id: "security", label: "Security / access control", description: "Alarms, door access and other physical security.", keywords: ["security", "alarm", "access-control", "door"] },
  { id: "iot", label: "IoT / building systems", description: "Building management, HVAC, sensors and other IoT.", keywords: ["iot", "bms", "sensor", "sensors", "hvac", "building"] },
  { id: "printers", label: "Printers", description: "MFPs, laser and label printers.", keywords: ["print", "printer", "printers", "mfp"] },
  { id: "dmz", label: "DMZ / public services", description: "Internet-facing services in a screened subnet.", keywords: ["dmz", "public", "screened"] },
  { id: "wan", label: "WAN / transit", description: "Uplinks, transit and router-to-router links.", keywords: ["wan", "transit", "uplink", "internet"] },
  { id: "data", label: "Data / user devices", description: "General corporate user and workstation traffic.", keywords: ["data", "user", "users", "workstation", "pc", "corporate", "lan"] },
  { id: "other", label: "Other", description: "Any other purpose.", keywords: [] },
];

export const VLAN_PURPOSE_IDS = VLAN_PURPOSES.map((p) => p.id);
export const vlanPurpose = (id) => VLAN_PURPOSES.find((p) => p.id === id) || null;
export const vlanPurposeLabel = (id) => (vlanPurpose(id) || {}).label || "";
export const vlanPurposeOptions = () => VLAN_PURPOSES.map((p) => ({ id: p.id, label: p.label }));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Match a purpose by the words present in a free-text VLAN description, most
// specific first (see the catalog order). Returns null when nothing matches.
export function vlanPurposeForText(text) {
  const t = str(text);
  if (!t) return null;
  for (const p of VLAN_PURPOSES) {
    for (const kw of p.keywords || []) {
      if (new RegExp("\\b" + escapeRe(kw) + "\\b", "i").test(t)) return p;
    }
  }
  return null;
}

// Parse a "VLANs & purposes" textarea into structured entries. Each line may
// lead with the VLAN id ("10", "VLAN 10", "10:", "10 -"), and the remainder is
// matched to a purpose where possible. Never throws.
export function parseVlanLines(value) {
  return String(value == null ? "" : value)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(?:vlan\s*)?(\d{1,4})\b\s*[:\-–—,.)]?\s*(.*)$/i);
      let number = null;
      let rest = line;
      if (m) {
        number = Number(m[1]);
        rest = m[2] || "";
      }
      const purpose = vlanPurposeForText(rest) || vlanPurposeForText(line);
      return {
        raw: line,
        number: Number.isFinite(number) ? number : null,
        name: str(rest).replace(/^[\-–—:.\s]+/, ""),
        purposeId: purpose ? purpose.id : null,
        purposeLabel: purpose ? purpose.label : "",
        recognized: !!purpose && purpose.id !== "other",
      };
    });
}

// The parsed VLANs of a circuit or LAN record (from its `vlans` textarea, or a
// supplied key).
export function vlansOf(record, key = "vlans") {
  const value = fieldOf(record, key);
  return parseVlanLines(value);
}

// The segmentation picture of a circuit/LAN: how many VLANs are declared vs
// listed, which have a recognisable purpose, and whether the recorded
// architecture implies segmentation at all.
export function segmentationSummary(record, opts = {}) {
  const key = opts.key || "vlans";
  const architecture = str(fieldOf(record, "architecture")) || null;
  const arch = architecture ? lanArchitecture(architecture) : null;
  const declaredRaw = fieldOf(record, "vlanCount");
  const declared = !blank(declaredRaw) && Number.isFinite(Number(declaredRaw)) ? Number(declaredRaw) : null;
  const vlans = vlansOf(record, key);
  const withoutPurpose = vlans.filter((v) => !v.recognized);
  return {
    architecture,
    architectureLabel: arch ? arch.label : "",
    declared,
    vlans,
    count: vlans.length,
    withPurpose: vlans.length - withoutPurpose.length,
    withoutPurpose,
    hasVlans: vlans.length > 0,
    mismatch: declared != null && vlans.length > 0 && declared !== vlans.length,
    requiresSegmentation: ["vlan-segmented", "routed-core", "spine-leaf", "hybrid"].includes(architecture),
  };
}

// ---- reverse DNS -----------------------------------------------------------
function ipv4Octets(ip) {
  const m = str(ip).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some((x) => x > 255) ? null : o;
}

// The PTR owner name for a host address: 203.0.113.8 → 8.113.0.203.in-addr.arpa.
export function ipv4ToPtrName(ip) {
  const o = ipv4Octets(ip);
  if (!o) return null;
  return o[3] + "." + o[2] + "." + o[1] + "." + o[0] + ".in-addr.arpa";
}

// The reverse zone an individual address lives in (the enclosing /24).
export function reverseZoneForIp(ip) {
  const o = ipv4Octets(ip);
  if (!o) return null;
  return o[2] + "." + o[1] + "." + o[0] + ".in-addr.arpa";
}

// The reverse (in-addr.arpa) delegation for an IPv4 CIDR block. Delegation
// happens on /24, /16 or /8 boundaries (RFC 1035); a block smaller than a /24
// is delegated classlessly using RFC 2317 CNAMEs, so `delegatedZone` names the
// sub-zone the carrier would actually delegate (e.g. 8-15.113.0.203.in-addr.arpa).
// Accepts a CIDR string or a parsed subnet from ./circuit.js `parseCidr`.
export function reverseZoneForCidr(input) {
  const subnet =
    typeof input === "string"
      ? parseCidr(input)
      : input && input.network && input.prefix != null
        ? input
        : input && input.cidr
          ? parseCidr(input.cidr)
          : null;
  if (!subnet) return null;
  const o = subnet.network.split(".").map(Number);
  const prefix = subnet.prefix;
  let boundary;
  let zone;
  if (prefix >= 24) {
    boundary = 24;
    zone = o[2] + "." + o[1] + "." + o[0] + ".in-addr.arpa";
  } else if (prefix >= 16) {
    boundary = 16;
    zone = o[1] + "." + o[0] + ".in-addr.arpa";
  } else if (prefix >= 8) {
    boundary = 8;
    zone = o[0] + ".in-addr.arpa";
  } else {
    boundary = 0;
    zone = "in-addr.arpa";
  }
  let classless = false;
  let delegatedZone = null;
  if (prefix > 24) {
    const first = Number(subnet.network.split(".")[3]);
    const last = Number(subnet.broadcast.split(".")[3]);
    classless = true;
    delegatedZone = first + "-" + last + "." + o[2] + "." + o[1] + "." + o[0] + ".in-addr.arpa";
  }
  return { zone, boundary, classless, delegatedZone, prefix, cidr: subnet.cidr };
}

// The forward record(s) a published hostname implies, given the addressing.
function forwardRecordsFor(publicHostname, addressing, staticIps) {
  const host = str(publicHostname);
  if (!host) return [];
  const out = [];
  const v4 = (staticIps[0] && staticIps[0].ip) || (addressing.subnets[0] && addressing.subnets[0].network) || null;
  if (v4) out.push({ type: "A", name: host, value: v4 });
  if (addressing.ipv6Range) out.push({ type: "AAAA", name: host, value: addressing.ipv6Range });
  return out;
}

// The full addressing/DNS plan for a circuit: the parsed subnets with their
// reverse zones, the static IPs with their PTR names, the distinct reverse zones
// involved and the forward record(s) the public hostname implies.
export function circuitAddressingPlan(circuit) {
  const addressing = circuit ? addressingSummary(circuit) : { subnets: [], subnetStrings: [], staticIps: [], usable: null, declared: null, ipv4Range: null, ipv6Range: null, publicHostname: null, hasAddressing: false, hasSubnets: false };
  const subnets = (addressing.subnets || []).map((s) => ({ ...s, reverse: reverseZoneForCidr(s) }));
  const staticIps = (addressing.staticIps || [])
    .map((ip) => ({ ip, ptrName: ipv4ToPtrName(ip), zone: reverseZoneForIp(ip) }))
    .filter((x) => x.ptrName);
  const zones = new Map();
  for (const s of subnets) {
    const r = s.reverse;
    if (!r) continue;
    const key = r.delegatedZone || r.zone;
    const entry = zones.get(key) || { zone: key, parent: r.zone, classless: r.classless, subnets: [], ips: [] };
    entry.subnets.push(s.cidr);
    zones.set(key, entry);
  }
  for (const ip of staticIps) {
    const key = ip.zone;
    const entry = zones.get(key) || { zone: key, parent: key, classless: false, subnets: [], ips: [] };
    entry.ips.push(ip.ip);
    zones.set(key, entry);
  }
  return {
    addressing,
    subnets,
    staticIps,
    reverseZones: [...zones.values()],
    publicHostname: addressing.publicHostname || null,
    forwardRecords: forwardRecordsFor(addressing.publicHostname, addressing, staticIps),
  };
}

// ---- the edge records a circuit documents ---------------------------------
const unique = (arr) => {
  const seen = new Set();
  return arr.filter((x) => {
    if (!x || !x.id) return false;
    const key = (x.type || "flexibleAssets") + ":" + x.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const ref = (set, type, id) => (set && id ? findRecord(set, { type, id }) : null);

// Everything a circuit is documented against at the network edge: the router/
// CPE, the firewall and security platform, the LANs it serves, the domains and
// TLS certificates its public addressing resolves/publishes, the remote-access
// records that reach through it, its upstream provider, credentials and
// documents. Combines the typed links with the circuit's own record fields.
export function circuitEdgeRecords(circuit, set) {
  const f = circuit ? assetFieldsOf(circuit) : {};
  const rels = circuit && set ? relationsOf(set, { type: circuit.type || "flexibleAssets", id: circuit.id }) : [];
  const pick = (kind) => rels.filter((r) => r.relationship.kind === kind).map((r) => findRecord(set, r.other) || r.other).filter(Boolean);
  const security = pick("circuit-security");
  return {
    cpe: unique([...pick("circuit-cpe"), ref(set, "configurations", f.cpeRecord)]),
    firewalls: unique([...security.filter((r) => r.type === "configurations"), ref(set, "configurations", f.firewallRecord)]),
    securityPlatforms: security.filter((r) => r.type === "flexibleAssets"),
    lan: pick("circuit-lan"),
    upstream: unique([...pick("circuit-upstream"), ref(set, "flexibleAssets", f.vendorRecord)]),
    domains: pick("circuit-domain"),
    certificates: pick("circuit-certificate"),
    remoteAccess: pick("circuit-remote-access"),
    credentials: pick("circuit-password"),
    documents: pick("circuit-document"),
    contacts: rels.filter((r) => r.relationship.kind === "contact-circuit" && r.direction === "in").map((r) => findRecord(set, r.other) || r.other).filter(Boolean),
  };
}

// ---- the coverage view the UI card renders ---------------------------------
// One entry per part of an addressing/firewall handover, with whether it is
// present and which records satisfy it. Required parts are the ones a resold
// circuit cannot be handed over without (addressing, DNS, CPE, firewall).
export function circuitAddressingCoverage(circuit, set) {
  const plan = circuitAddressingPlan(circuit);
  const edge = circuitEdgeRecords(circuit, set);
  const seg = segmentationSummary(circuit, { key: "vlans" });
  const f = circuit ? assetFieldsOf(circuit) : {};
  const a = plan.addressing;
  const addressingDetail = a.hasAddressing
    ? a.subnetStrings.length + " subnet(s), " + a.staticIps.length + " static IP(s)"
    : "";
  return [
    { id: "addressing", label: "IP addressing & subnets", required: true, present: a.hasAddressing, records: [], detail: addressingDetail },
    { id: "reverseDns", label: "Forward / reverse DNS", required: true, present: !!plan.publicHostname || plan.reverseZones.length > 0, records: edge.domains, detail: plan.publicHostname || (plan.reverseZones[0] ? plan.reverseZones[0].zone : "") },
    { id: "vlans", label: "VLANs & segmentation", required: false, present: seg.hasVlans || !blank(fieldOf(circuit, "vlanCount")), records: [], detail: seg.hasVlans ? seg.count + " VLAN(s)" : "" },
    { id: "cpe", label: "Router / CPE", required: true, present: edge.cpe.length > 0 || !blank(fieldOf(circuit, "cpeRole")), records: edge.cpe, detail: str(fieldOf(circuit, "cpeRole")) },
    { id: "firewall", label: "Edge firewall & security", required: true, present: edge.firewalls.length + edge.securityPlatforms.length > 0, records: [...edge.firewalls, ...edge.securityPlatforms], detail: "" },
    { id: "domain", label: "Public domain", required: false, present: edge.domains.length > 0, records: edge.domains, detail: "" },
    { id: "certificate", label: "TLS certificate", required: false, present: edge.certificates.length > 0, records: edge.certificates, detail: "" },
    { id: "remoteAccess", label: "Remote access", required: false, present: edge.remoteAccess.length > 0, records: edge.remoteAccess, detail: "" },
  ];
}

// ---- the completeness audit ------------------------------------------------
// Folded in by ./standardized.js. Warnings never fail the graph audit.
export function addressingIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  const rec = (code, recordId, message) => issues.push({ level: "warning", code, recordId, message });
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId === WAN_CIRCUIT_TYPE_ID) {
      const plan = circuitAddressingPlan(r);
      const edge = circuitEdgeRecords(r, set);
      const a = plan.addressing;
      if (a.hasAddressing && !plan.publicHostname && !edge.domains.length) {
        rec("circuit-no-reverse-dns", r.id, `Circuit “${r.name}” records IP addressing but no public hostname or linked domain for forward/reverse DNS.`);
      }
      if (plan.publicHostname && !a.hasAddressing) {
        rec("circuit-hostname-no-addressing", r.id, `Circuit “${r.name}” records a public hostname but no static IP or subnet allocation.`);
      }
      if (!edge.firewalls.length && !edge.securityPlatforms.length) {
        rec("circuit-no-edge-firewall", r.id, `Circuit “${r.name}” is not linked to an edge firewall or security platform.`);
      }
      if (plan.publicHostname && !edge.certificates.length) {
        rec("circuit-hostname-no-certificate", r.id, `Circuit “${r.name}” publishes “${plan.publicHostname}” but is not linked to a TLS certificate.`);
      }
      const seg = segmentationSummary(r, { key: "vlans" });
      if (seg.withoutPurpose.length) {
        rec("circuit-vlan-no-purpose", r.id, `Circuit “${r.name}” has ${plural(seg.withoutPurpose.length, "VLAN entry", "VLAN entries")} with no recognisable purpose.`);
      }
    }
    if (r.assetTypeId === LAN_TYPE_ID) {
      const seg = segmentationSummary(r, { key: "vlans" });
      if (seg.requiresSegmentation && !seg.hasVlans) {
        rec("lan-segmented-no-vlans", r.id, `LAN “${r.name}” is recorded as ${seg.architectureLabel || "segmented"} but lists no VLANs.`);
      }
      if (seg.mismatch) {
        rec("lan-vlan-count-mismatch", r.id, `LAN “${r.name}” records a VLAN count of ${seg.declared} but lists ${seg.count} VLAN(s).`);
      }
      if (seg.withoutPurpose.length) {
        rec("lan-vlan-no-purpose", r.id, `LAN “${r.name}” has ${plural(seg.withoutPurpose.length, "VLAN entry", "VLAN entries")} with no recognisable purpose.`);
      }
    }
  }
  return issues;
}

// ---- the generated addressing & firewall record -----------------------------
function factLines(pairs) {
  return pairs.filter(([, v]) => !blank(v)).map(([k, v]) => `- **${k}:** ${Array.isArray(v) ? v.join(", ") : v}`);
}
const recordNames = (records) => (records || []).map((x) => x.name).filter(Boolean).join(", ");

// Assemble a client-technical referencing document that documents a circuit's
// public addressing, reverse DNS, VLANs/segmentation, CPE and firewall
// relationship, naming every record it is linked to. Returns markdown plus any
// gaps flagged as warnings.
export function generateCircuitAddressingRecord({ circuit, set, title, now = Date.now() } = {}) {
  if (!circuit) throw new Error("A circuit is required to generate an addressing record.");
  const profile = circuitProfile(circuit);
  const plan = circuitAddressingPlan(circuit);
  const edge = circuitEdgeRecords(circuit, set);
  const seg = segmentationSummary(circuit, { key: "vlans" });
  const a = plan.addressing;
  const warnings = [];
  const warn = (code, message) => warnings.push({ code, message });
  if (!a.hasAddressing) warn("missing-addressing", "The circuit records no static-IP or subnet allocation.");
  if (!plan.publicHostname && !edge.domains.length) warn("missing-reverse-dns", "No public hostname or linked domain is recorded for forward/reverse DNS.");
  if (!edge.firewalls.length && !edge.securityPlatforms.length) warn("missing-firewall", "No edge firewall or security platform is linked.");
  if (plan.publicHostname && !edge.certificates.length) warn("missing-certificate", `“${plan.publicHostname}” is published but no TLS certificate is linked.`);
  if (!edge.cpe.length && blank(fieldOf(circuit, "cpeRole"))) warn("missing-cpe", "No router/CPE is linked or recorded.");
  if (seg.withoutPurpose.length) warn("vlan-no-purpose", seg.withoutPurpose.length + " VLAN entries have no recognisable purpose.");

  const generatedOn = new Date(now).toISOString().slice(0, 10);
  const L = [];
  const push = (...lines) => L.push(...lines);
  const section = (heading) => push("", "## " + heading, "");

  push(`# Circuit addressing & firewall record — ${circuit.name}`, "");
  push(`Public addressing, DNS/reverse-DNS, VLANs and the firewall relationship for **${circuit.name}**${profile.upstreamCarrier ? " on the " + profile.upstreamCarrier + " network" : ""}.`, "");
  push(`_Generated from the Internet/WAN circuit asset on ${generatedOn}. Values follow the circuit's recorded addressing; gaps are marked TO COMPLETE._`);

  section("Circuit");
  push(...factLines([
    ["Carrier (branded)", profile.carrier],
    ["Upstream / wholesale carrier", profile.upstreamCarrier],
    ["Access technology", profile.accessLabel],
    ["Service definition", profile.serviceDefinitionLabel],
    ["Committed bandwidth", profile.bandwidth],
    ["Router / CPE role", profile.cpeLabel],
    ["Public hostname / reverse DNS", plan.publicHostname],
    ["IPv4 range", a.ipv4Range],
    ["IPv6 range", a.ipv6Range],
  ]));

  section("Subnet allocation");
  if (plan.subnets.length) {
    push("| Subnet | Network | Broadcast | Prefix | Usable | Reverse zone |", "| --- | --- | --- | --- | --- | --- |");
    for (const s of plan.subnets) {
      const r = s.reverse || {};
      push(`| ${s.cidr} | ${s.network} | ${s.broadcast} | /${s.prefix} | ${s.usable} | ${r.delegatedZone || r.zone || ""} |`);
    }
    push("", `_${a.usable != null ? a.usable + " usable host addresses across " + plan.subnets.length + " block(s)" : ""}${a.declared != null ? " · " + a.declared + " declared" : ""}_.`);
  } else {
    push("_[TO COMPLETE: record the allocated subnet block(s) in CIDR form on the circuit.]_");
  }

  section("Static IP addressing & reverse DNS (PTR)");
  if (plan.staticIps.length) {
    push("| Address | PTR name | Reverse zone |", "| --- | --- | --- |");
    for (const ip of plan.staticIps) push(`| ${ip.ip} | ${ip.ptrName} | ${ip.zone} |`);
  } else if (a.ipv4Range || a.ipv6Range) {
    push(...factLines([["IPv4 range", a.ipv4Range], ["IPv6 range", a.ipv6Range]]));
    push("_[TO COMPLETE: list the individual static addresses and their PTR names.]_");
  } else {
    push("_[TO COMPLETE: record the static address(es) allocated on this circuit.]_");
  }
  if (plan.reverseZones.length) {
    push("", "**Reverse zones to arrange with the carrier**", "");
    for (const z of plan.reverseZones) {
      const of = [z.subnets.length ? "subnets " + z.subnets.join(", ") : "", z.ips.length ? "addresses " + z.ips.join(", ") : ""].filter(Boolean).join("; ");
      push(`- \`${z.zone}\`${z.classless ? " (classless / RFC 2317 delegation of the " + z.parent + " zone)" : ""}${of ? " — " + of : ""}`);
    }
  }

  section("Forward DNS");
  if (plan.forwardRecords.length) {
    push("| Type | Name | Value |", "| --- | --- | --- |");
    for (const r of plan.forwardRecords) push(`| ${r.type} | ${r.name} | ${r.value || "_[TO COMPLETE]_"} |`);
  } else {
    push("_[TO COMPLETE: record the public hostname published over this circuit and its A/AAAA record.]_");
  }
  if (edge.domains.length) push("", `Linked domain tracker${edge.domains.length === 1 ? "" : "s"}: ${recordNames(edge.domains)}.`);
  else push("", "_No Domain Tracker record is linked for the public name._");

  section("VLANs & segmentation");
  if (seg.hasVlans) {
    push("| VLAN | Purpose | Description |", "| --- | --- | --- |");
    for (const v of seg.vlans) push(`| ${v.number != null ? v.number : "_?_"} | ${v.purposeLabel || "_[TO COMPLETE]_"} | ${v.name || ""} |`);
    if (seg.mismatch) push("", `> The record declares ${seg.declared} VLANs but lists ${seg.count}. Reconcile the count.`);
  } else {
    push("_[TO COMPLETE: list the VLANs delivered over this circuit and what each is for.]_");
  }

  section("CPE & firewall relationship");
  push(...factLines([
    ["Router / CPE", recordNames(edge.cpe) || profile.cpeRecord],
    ["Edge firewall", recordNames(edge.firewalls) || profile.firewallRecord],
    ["Security platform", recordNames(edge.securityPlatforms)],
  ]));
  if (!edge.cpe.length && !profile.cpeRecord && blank(fieldOf(circuit, "cpeRole"))) push("", "_[TO COMPLETE: record the router/CPE that terminates the circuit.]_");
  if (!edge.firewalls.length && !edge.securityPlatforms.length && blank(fieldOf(circuit, "firewallRecord"))) push("", "_[TO COMPLETE: link the edge firewall or security platform guarding this circuit.]_");
  if (edge.remoteAccess.length) push("", `Remote access reaching through this circuit: ${recordNames(edge.remoteAccess)}.`);
  if (edge.lan.length) push("", `LANs served: ${recordNames(edge.lan)}.`);

  section("Linked records");
  push("| Relationship | Records |", "| --- | --- |");
  push(`| Router / CPE | ${recordNames(edge.cpe) || "—"} |`);
  push(`| Firewall & security | ${[...edge.firewalls, ...edge.securityPlatforms].map((x) => x.name).join(", ") || "—"} |`);
  push(`| LANs served | ${recordNames(edge.lan) || "—"} |`);
  push(`| Public domains | ${recordNames(edge.domains) || "—"} |`);
  push(`| TLS certificates | ${recordNames(edge.certificates) || "—"} |`);
  push(`| Remote access | ${recordNames(edge.remoteAccess) || "—"} |`);
  push(`| Credentials | ${recordNames(edge.credentials) || "—"} |`);
  push(`| Upstream provider | ${recordNames(edge.upstream) || "—"} |`);
  push(`| Documents | ${recordNames(edge.documents) || "—"} |`);
  push("", `_Addressing & firewall record generated for “${circuit.name}” on ${generatedOn}. Re-verify after every renumber, CPE change or carrier migration (see the cutover runbook)._`);

  const name = !blank(title) ? title : `Addressing & firewall — ${circuit.name}`;
  const summary = `Public addressing, reverse DNS, VLANs, CPE and firewall relationship for ${circuit.name}` + (profile.accessLabel ? ` (${profile.accessLabel})` : "") + ".";
  return { name, docType: "client-technical", summary, body: L.join("\n"), warnings, generatedAt: now, circuitId: circuit.id, source: "circuit-asset" };
}
