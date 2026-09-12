// src/framework/assetRelations.js — the relationship GROUPS the asset profile
// shows (roadmap tasks 14–16).
//
// Every Flexible Asset shares one record collection, so the relationship engine
// (./relationships.js) validates at the collection level ("Flexible asset →
// Supporting document"). That is too coarse for the UI: an Application should
// say "Runs on …", "Licensing …", "Vendor …", not "Flexible asset links".
//
// This module bridges the two. For the named rich assets it declares labelled
// GROUPS (each backed by one or more relationship kinds and a direction), so
// the profile can present "Servers & workstations", "Credentials", "Vendor",
// "Licensing", "Supporting documents", "Members" and so on — and can offer the
// right link picker for each. A template with no named groups falls back to one
// group per allowed reference collection using the generic `asset-reference`
// kind, so EVERY flexible asset is still navigable.

import { relationsOf, refKey } from "./relationships.js";
import { referenceType } from "./flexible.js";

const refOf = (r) => ({ type: r.type, id: r.id });

// Named groups, keyed by shipped template id. `kinds` are the relationship
// kinds merged into the group (primary first); `direction` says which end of
// the link the asset sits at; `collections` are the far-side collections a
// candidate may come from; `filterTypes` narrows a flexible-asset far side to
// particular templates.
export const RELATION_GROUPS = {
  // Task 31 — the Email system modelled as a structured service. Each group is
  // backed by its own `email-*` relationship kind so the profile shows the mail
  // service's hosting, applications, domains, credentials, documents, filtering,
  // vendor, licensing, certificates and people as separate labelled buckets.
  "atype-email-system": [
    { id: "configurations", label: "Hosting & mail flow", kinds: ["email-configuration"], direction: "out", collections: ["configurations"], hint: "The servers, appliances and connectors that host or relay the mail." },
    { id: "applications", label: "Mail applications", kinds: ["email-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "The Application records for the mail platform and its supporting software." },
    { id: "domains", label: "Mail domains", kinds: ["email-domain"], direction: "out", collections: ["domains"], hint: "The Domain tracker records this service sends and receives mail for." },
    { id: "passwords", label: "Credentials", kinds: ["email-password"], direction: "out", collections: ["passwords"], hint: "Administrator and service credentials for the mail platform." },
    { id: "documents", label: "Documents", kinds: ["email-document"], direction: "out", collections: ["documents"], hint: "Migration plans, mail-flow diagrams and platform documentation." },
    { id: "security", label: "Security & filtering", kinds: ["email-security"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-security-platform"], hint: "The spam-filtering, anti-phishing or email-security platform in front of the mailboxes." },
    { id: "vendor", label: "Vendor", kinds: ["email-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The supplier or provider the mail service is held with." },
    { id: "licence", label: "Licensing & subscriptions", kinds: ["licence-application"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-licences"], hint: "Licences and subscriptions that cover the mail service." },
    { id: "certificates", label: "TLS certificates", kinds: ["email-certificate"], direction: "out", collections: ["certificates"], hint: "Certificates securing the mail service's TLS endpoints." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-email"], direction: "in", collections: ["contacts"], hint: "People responsible for the mail service." },
  ],
  // Task 32 — the Backup service as a structured service. Groups the protected
  // configurations, the backup application and its storage, the vendor, its
  // credentials, the procedures and recovery documents, the reference checklist
  // and the people responsible.
  "atype-backup-service": [
    { id: "configurations", label: "Protected systems", kinds: ["backup-protected-configs"], direction: "out", collections: ["configurations"], hint: "The servers, workstations and other configurations this backup protects." },
    { id: "applications", label: "Backup application", kinds: ["backup-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "The Application record for the backup platform." },
    { id: "storage", label: "Backup storage", kinds: ["backup-storage"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-file-sharing"], hint: "Where the copies land — file servers, NAS/SAN or cloud storage." },
    { id: "vendor", label: "Vendor", kinds: ["backup-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The supplier the backup service is held with." },
    { id: "passwords", label: "Credentials", kinds: ["backup-password"], direction: "out", collections: ["passwords"], hint: "Administrator and service credentials for the backup platform." },
    { id: "procedures", label: "Procedures & recovery", kinds: ["backup-procedure", "backup-recovery"], direction: "out", collections: ["documents"], hint: "How the backup is run and how a restore is performed." },
    { id: "documents", label: "Supporting documents", kinds: ["backup-document"], direction: "out", collections: ["documents"], hint: "Platform documentation and client-specific business rules." },
    { id: "checklists", label: "Reference checklists", kinds: ["backup-checklist"], direction: "out", collections: ["checklists"], hint: "The restore / recovery checklist used when a restore is needed." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-backup"], direction: "in", collections: ["contacts"], hint: "People responsible for the backup service." },
  ],
  // Task 33 — network services. The WAN service groups its edge firewalls,
  // security, carrier/vendor, documents, the LANs it feeds and its people; the
  // LAN groups its switches, servers, wireless networks, WAN services,
  // documents and people; the wireless network groups its access points, LAN,
  // security, documents and people.
  "atype-wan-service": [
    { id: "firewalls", label: "Edge firewalls", kinds: ["wan-firewall"], direction: "out", collections: ["configurations"], hint: "The firewall or edge device this service terminates on." },
    { id: "security", label: "Security", kinds: ["wan-security"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-security-platform"], hint: "The security platform guarding the WAN edge." },
    { id: "vendor", label: "Carrier / vendor", kinds: ["wan-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The carrier or ISP the service is held with." },
    { id: "documents", label: "Documents", kinds: ["wan-document"], direction: "out", collections: ["documents"], hint: "Contract details, provisioning notes and circuit documentation." },
    { id: "lan", label: "LAN segments fed", kinds: ["lan-wan"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-lan"], hint: "The LAN records this WAN service feeds." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-wan"], direction: "in", collections: ["contacts"], hint: "People responsible for the WAN service." },
  ],
  // Task 40 — a resold internet/WAN circuit: the wholesale/upstream provider it
  // is bought from, the router/CPE that terminates it, the firewall/security
  // that guards it, the LANs it serves, its credentials and documents, and the
  // services (voice, remote access) that run over it.
  "atype-wan-circuit": [
    { id: "upstream", label: "Upstream / wholesale provider", kinds: ["circuit-upstream"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The carrier or wholesale provider the circuit is bought from." },
    { id: "cpe", label: "Router / CPE", kinds: ["circuit-cpe"], direction: "out", collections: ["configurations"], hint: "The router, firewall or ONT that terminates the circuit." },
    { id: "security", label: "Firewall & security", kinds: ["circuit-security"], direction: "out", collections: ["configurations", "flexibleAssets"], hint: "The firewall or security platform guarding the circuit edge." },
    { id: "lan", label: "LANs served", kinds: ["circuit-lan"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-lan"], hint: "The LAN records this circuit feeds." },
    { id: "domains", label: "Public domains", kinds: ["circuit-domain"], direction: "out", collections: ["domains"], hint: "Domains whose public records resolve to this circuit's addressing." },
    { id: "certificates", label: "TLS certificates", kinds: ["circuit-certificate"], direction: "out", collections: ["certificates"], hint: "Certificates protecting services published on this circuit." },
    { id: "remoteAccess", label: "Remote access", kinds: ["circuit-remote-access"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-remote-access"], hint: "Remote-access services that reach in through this circuit." },
    { id: "services", label: "Dependent services", kinds: ["voice-circuit"], direction: "in", collections: ["flexibleAssets"], hint: "Services running over this circuit — voice platforms and the like." },
    { id: "credentials", label: "Credentials", kinds: ["circuit-password"], direction: "out", collections: ["passwords"], hint: "Provider-portal or CPE credentials for the circuit." },
    { id: "documents", label: "Documents", kinds: ["circuit-document"], direction: "out", collections: ["documents"], hint: "Contracts, provisioning notes and addressing documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-circuit"], direction: "in", collections: ["contacts"], hint: "People responsible for the circuit." },
  ],
  "atype-lan": [
    { id: "switches", label: "Switches & wiring", kinds: ["lan-switch"], direction: "out", collections: ["configurations"], hint: "The switches that make up this LAN." },
    { id: "servers", label: "Servers", kinds: ["lan-server"], direction: "out", collections: ["configurations"], hint: "The servers living on this LAN." },
    { id: "wireless", label: "Wireless networks", kinds: ["lan-wireless"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-wireless"], hint: "The wireless networks this LAN serves." },
    { id: "wan", label: "WAN services", kinds: ["lan-wan"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-wan-service"], hint: "The WAN services feeding this LAN." },
    { id: "documents", label: "Documents", kinds: ["lan-document"], direction: "out", collections: ["documents"], hint: "Network diagrams and LAN documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-lan"], direction: "in", collections: ["contacts"], hint: "People responsible for the LAN." },
  ],
  "atype-wireless": [
    { id: "accessPoints", label: "Access points", kinds: ["wireless-ap"], direction: "out", collections: ["configurations"], hint: "The access-point configurations this wireless network runs on." },
    { id: "lan", label: "LAN", kinds: ["lan-wireless"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-lan"], hint: "The LAN this wireless network is part of." },
    { id: "security", label: "Security", kinds: ["wireless-security"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-security-platform"], hint: "The security platform protecting the wireless network." },
    { id: "documents", label: "Documents", kinds: ["wireless-document"], direction: "out", collections: ["documents"], hint: "Wireless design and coverage documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-wireless"], direction: "in", collections: ["contacts"], hint: "People responsible for the wireless network." },
  ],
  // Task 34 — the security, remote-access, virtualization, file-sharing and
  // printing services. A security platform groups everything it protects (the
  // configurations, the remote access, wireless, WAN and email services), what
  // it runs as and on (applications), its credentials, vendor, licensing,
  // documents and people. Remote access groups the gateway it terminates on,
  // the security protecting it, its applications, credentials, documents and
  // people. Virtualization groups its hosts, applications, credentials, vendor,
  // licensing, documents and people. File sharing groups its server, the
  // applications and security around it, the backup that protects it, its
  // credentials, documents and people. Printing groups its device
  // configurations, its supplier, documents and people.
  "atype-security-platform": [
    { id: "configurations", label: "Protected configurations", kinds: ["security-configuration"], direction: "out", collections: ["configurations"], hint: "The servers, firewalls and other configurations this platform protects." },
    { id: "remoteAccess", label: "Remote access protected", kinds: ["remote-access-security"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-remote-access"], hint: "The remote-access services this platform protects." },
    { id: "wireless", label: "Wireless networks protected", kinds: ["wireless-security"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-wireless"], hint: "The wireless networks this platform protects." },
    { id: "wan", label: "WAN services protected", kinds: ["wan-security"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-wan-service"], hint: "The internet/WAN services this platform guards." },
    { id: "email", label: "Email systems protected", kinds: ["email-security"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-email-system"], hint: "The mail services this platform filters or protects." },
    { id: "fileSharing", label: "File sharing protected", kinds: ["file-sharing-security"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-file-sharing"], hint: "The file-storage services this platform covers." },
    { id: "applications", label: "Security applications", kinds: ["security-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "The Application records for the platform and its supporting software." },
    { id: "credentials", label: "Credentials", kinds: ["security-password"], direction: "out", collections: ["passwords"], hint: "Administrator and service credentials for the platform." },
    { id: "vendor", label: "Vendor", kinds: ["security-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The supplier the platform is held with." },
    { id: "licensing", label: "Licensing & subscriptions", kinds: ["licence-application"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-licences"], hint: "Licences and subscriptions covering the platform." },
    { id: "documents", label: "Documents", kinds: ["security-document"], direction: "out", collections: ["documents"], hint: "Deployment notes, runbooks and platform documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-security-platform"], direction: "in", collections: ["contacts"], hint: "People responsible for the security platform." },
  ],
  "atype-remote-access": [
    { id: "configurations", label: "Gateway & configuration", kinds: ["remote-access-configuration"], direction: "out", collections: ["configurations"], hint: "The appliance or server that terminates the remote connection." },
    { id: "security", label: "Security", kinds: ["remote-access-security"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-security-platform"], hint: "The security platform protecting this remote access." },
    { id: "applications", label: "Applications", kinds: ["remote-access-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "The Application records for the remote-access platform." },
    { id: "circuits", label: "Internet / WAN circuits", kinds: ["circuit-remote-access"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-wan-circuit"], hint: "The circuits this remote-access service reaches in through." },
    { id: "credentials", label: "Credentials", kinds: ["remote-access-password"], direction: "out", collections: ["passwords"], hint: "Credentials for the remote-access platform or gateway." },
    { id: "documents", label: "Documents", kinds: ["remote-access-document"], direction: "out", collections: ["documents"], hint: "Connection guides, prerequisite checklists and platform documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-remote-access"], direction: "in", collections: ["contacts"], hint: "People responsible for remote access." },
  ],
  "atype-virtualization": [
    { id: "hosts", label: "Hosts", kinds: ["virtualization-host"], direction: "out", collections: ["configurations"], hint: "The physical hosts running this virtualization platform." },
    { id: "applications", label: "Applications", kinds: ["virtualization-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "The Application records for the platform and its management tools." },
    { id: "credentials", label: "Credentials", kinds: ["virtualization-password"], direction: "out", collections: ["passwords"], hint: "Administrator and service credentials for the hypervisor." },
    { id: "vendor", label: "Vendor", kinds: ["virtualization-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The supplier the platform is held with." },
    { id: "licensing", label: "Licensing & subscriptions", kinds: ["licence-application"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-licences"], hint: "Licences and subscriptions covering the platform." },
    { id: "documents", label: "Documents", kinds: ["virtualization-document"], direction: "out", collections: ["documents"], hint: "Design documents, build notes and DR documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-virtualization"], direction: "in", collections: ["contacts"], hint: "People responsible for the virtualization platform." },
  ],
  "atype-file-sharing": [
    { id: "configurations", label: "File server & host", kinds: ["file-sharing-configuration"], direction: "out", collections: ["configurations"], hint: "The file server, NAS or host providing this storage." },
    { id: "applications", label: "Applications", kinds: ["file-sharing-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "The Application records for the file-sharing service." },
    { id: "security", label: "Security", kinds: ["file-sharing-security"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-security-platform"], hint: "The security platform covering this storage." },
    { id: "backup", label: "Backup service", kinds: ["backup-storage"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-backup-service"], hint: "The backup service that protects this storage." },
    { id: "credentials", label: "Credentials", kinds: ["file-sharing-password"], direction: "out", collections: ["passwords"], hint: "Administrator and service credentials for the storage." },
    { id: "documents", label: "Documents", kinds: ["file-sharing-document"], direction: "out", collections: ["documents"], hint: "Share maps, permission matrices and storage documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-file-sharing"], direction: "in", collections: ["contacts"], hint: "People responsible for the file-sharing service." },
  ],
  "atype-printing": [
    { id: "configurations", label: "Device configurations", kinds: ["printing-configuration"], direction: "out", collections: ["configurations"], hint: "The device, print-server and queue configurations behind this printing." },
    { id: "vendor", label: "Supplier", kinds: ["printing-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The vendor supplying the device, consumables or managed print service." },
    { id: "documents", label: "Documents", kinds: ["printing-document"], direction: "out", collections: ["documents"], hint: "Device notes, contracts and print-procedure documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-printing"], direction: "in", collections: ["contacts"], hint: "People responsible for printing." },
  ],
  // Task 36 — the Voice/PBX platform as a structured service. Groups the
  // internet/WAN circuits it runs over, the PBX/host and SBC/firewall
  // configurations, the security guarding it, the voice application and its
  // vendor, its administrator credential, the licensing and supporting
  // documents, the build/cut-over checklist and the people responsible.
  "atype-voice-pbx": [
    { id: "circuits", label: "Internet / WAN circuits", kinds: ["voice-circuit"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-wan-circuit"], hint: "The internet/WAN circuits carrying the voice traffic." },
    { id: "configurations", label: "PBX / host configuration", kinds: ["voice-configuration"], direction: "out", collections: ["configurations"], hint: "The server, appliance or virtual host running the PBX." },
    { id: "sbc", label: "SBC / firewall", kinds: ["voice-sbc"], direction: "out", collections: ["configurations"], hint: "The session border controller or firewall the voice traffic traverses." },
    { id: "security", label: "Security", kinds: ["voice-security"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-security-platform"], hint: "The security platform protecting the voice service." },
    { id: "applications", label: "Voice applications", kinds: ["voice-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "The Application records for the voice platform and its management tools." },
    { id: "vendor", label: "Vendor", kinds: ["voice-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The provider or carrier the voice service is held with." },
    { id: "credentials", label: "Credentials", kinds: ["voice-password"], direction: "out", collections: ["passwords"], hint: "Administrator and service credentials for the voice platform." },
    { id: "licensing", label: "Licensing & subscriptions", kinds: ["licence-application"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-licences"], hint: "Licences and subscriptions covering the voice platform." },
    { id: "documents", label: "Documents", kinds: ["voice-document"], direction: "out", collections: ["documents"], hint: "Dial plans, deployment notes and platform documentation." },
    { id: "checklists", label: "Deployment checklists", kinds: ["voice-checklist"], direction: "out", collections: ["checklists"], hint: "The build and cut-over checklists followed for this voice service." },
    { id: "runbooks", label: "Deployment runbooks", kinds: ["runbook-service"], direction: "in", collections: ["runbooks"], hint: "The deployment runbooks that stand this voice service up." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-voice"], direction: "in", collections: ["contacts"], hint: "People responsible for the voice platform." },
  ],
  "atype-applications": [
    { id: "configurations", label: "Runs on", kinds: ["application-server", "application-workstation"], direction: "out", collections: ["configurations"], hint: "Servers, workstations and other configurations hosting this application." },
    { id: "passwords", label: "Credentials", kinds: ["application-password"], direction: "out", collections: ["passwords"], hint: "Service accounts and login records for this application." },
    { id: "vendor", label: "Vendor", kinds: ["application-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The supplier record for this application." },
    { id: "licence", label: "Licensing & subscriptions", kinds: ["licence-application"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-licences"], hint: "Licences and subscriptions that cover this application." },
    { id: "documents", label: "Supporting documents", kinds: ["application-document"], direction: "out", collections: ["documents"], hint: "Manuals, install notes and vendor documentation." },
    { id: "contacts", label: "Owner & contacts", kinds: ["contact-application"], direction: "in", collections: ["contacts"], hint: "People responsible for this application." },
    { id: "roles", label: "User roles", kinds: ["role-application"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-user-role"], hint: "Roles that use this application." },
    { id: "builds", label: "Software builds", kinds: ["build-application"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-software-build"], hint: "Builds that install this application." },
  ],
  "atype-licences": [
    { id: "vendor", label: "Vendor", kinds: ["licence-vendor"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-vendor"], hint: "The supplier this licence is held with." },
    { id: "applications", label: "Covered applications", kinds: ["licence-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "Applications this licence entitles." },
    { id: "contacts", label: "Account contacts", kinds: ["contact-licence"], direction: "in", collections: ["contacts"], hint: "People who manage this licence." },
    { id: "documents", label: "Documents", kinds: ["asset-reference"], direction: "out", collections: ["documents"], hint: "Licence agreements, order confirmations and entitlement letters." },
  ],
  "atype-vendor": [
    { id: "applications", label: "Applications supplied", kinds: ["application-vendor"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "Applications bought through this vendor." },
    { id: "licences", label: "Licences & subscriptions", kinds: ["licence-vendor"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-licences"], hint: "Licences held with this vendor." },
    { id: "contacts", label: "Contacts", kinds: ["contact-vendor"], direction: "in", collections: ["contacts"], hint: "Account managers and support contacts." },
    { id: "documents", label: "Documents", kinds: ["asset-reference"], direction: "out", collections: ["documents"], hint: "Contracts, quotes and statements of work." },
  ],
  "atype-user-role": [
    { id: "applications", label: "Applications used", kinds: ["role-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "Applications this role is entitled to." },
    { id: "builds", label: "Software builds", kinds: ["role-build"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-software-build"], hint: "The software build this role receives." },
    { id: "members", label: "Members", kinds: ["role-member"], direction: "out", collections: ["contacts"], hint: "People who hold this role." },
    { id: "documents", label: "Documents", kinds: ["asset-reference"], direction: "out", collections: ["documents"], hint: "Role definitions, access matrices and onboarding notes." },
  ],
  "atype-software-build": [
    { id: "applications", label: "Installed applications", kinds: ["build-application"], direction: "out", collections: ["flexibleAssets"], filterTypes: ["atype-applications"], hint: "Applications installed by this build." },
    { id: "roles", label: "Applicable roles", kinds: ["role-build"], direction: "in", collections: ["flexibleAssets"], filterTypes: ["atype-user-role"], hint: "Roles this build is assigned to." },
    { id: "documents", label: "Documents", kinds: ["asset-reference"], direction: "out", collections: ["documents"], hint: "Build documentation and deployment notes." },
  ],
};

// The groups for a template: its named groups, or one generic group per allowed
// reference collection when it has none.
export function relationGroupsFor(type) {
  if (!type) return [];
  const named = RELATION_GROUPS[type.id];
  if (named && named.length) return named.map((g) => ({ ...g }));
  const refs = Array.isArray(type.references) ? type.references : [];
  return refs.map((collection) => {
    const meta = referenceType(collection) || { label: collection };
    return {
      id: "ref-" + collection,
      label: meta.label,
      kinds: ["asset-reference"],
      direction: "out",
      collections: [collection],
      generic: true,
      hint: "Any " + String(meta.label).toLowerCase() + " this asset relates to.",
    };
  });
}

const matchesGroup = (rel, direction, group) =>
  group.kinds.includes(rel.relationship.kind) && rel.direction === direction;

// Whether a candidate record belongs to a group's far side (respecting the
// template filter for flexible assets).
function candidateAllowed(record, group) {
  if (!group.collections.includes(record.type)) return false;
  if (record.type === "flexibleAssets" && group.filterTypes && group.filterTypes.length) {
    return group.filterTypes.includes(record.assetTypeId);
  }
  return true;
}

// Split a record's links into its groups (with the far-side record resolved)
// plus any links the groups don't cover. `record` may be a bare ref or a full
// record; `set` is the documentation set holding the graph.
export function groupLinks(record, set, type) {
  const groups = relationGroupsFor(type);
  const rels = relationsOf(set, refOf(record));
  const buckets = groups.map((g) => ({ ...g, links: [] }));
  const leftovers = [];
  const findFar = (rel) => {
    const ref = rel.other;
    const arr = (set && set.records && set.records[ref.type]) || [];
    return arr.find((r) => r.id === ref.id) || null;
  };
  for (const rel of rels) {
    const far = findFar(rel);
    const g = buckets.find((b) => matchesGroup(rel, b.direction, b));
    if (g) g.links.push({ relationship: rel.relationship, other: far, otherRef: rel.other, direction: rel.direction });
    else leftovers.push({ relationship: rel.relationship, other: far, otherRef: rel.other, direction: rel.direction });
  }
  return {
    groups: buckets.filter((g) => g.links.length || !g.generic),
    leftovers,
    total: rels.length,
  };
}

// The link parameters that connect `record` to `other` for a group, honouring
// the group's direction and primary kind.
export function linkParamsFor(record, group, other) {
  const kind = group.kinds[0];
  if (group.direction === "in") {
    return { from: refOf(other), to: refOf(record), kind };
  }
  return { from: refOf(record), to: refOf(other), kind };
}

// Candidate far-side records a group could link to: everything in its
// collections that is not the record itself and not already linked through any
// of the group's kinds (in either direction).
export function relationCandidates(record, set, group) {
  if (!set || !set.records) return [];
  const selfKey = refKey(refOf(record));
  const linked = new Set(
    relationsOf(set, refOf(record))
      .filter((r) => group.kinds.includes(r.relationship.kind))
      .map((r) => refKey(r.other)),
  );
  const out = [];
  for (const collection of group.collections) {
    for (const rec of set.records[collection] || []) {
      if (refKey(refOf(rec)) === selfKey) continue;
      if (linked.has(refKey(refOf(rec)))) continue;
      if (!candidateAllowed(rec, group)) continue;
      out.push(rec);
    }
  }
  return out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export const isGroupedType = (type) => !!(type && RELATION_GROUPS[type.id]);
