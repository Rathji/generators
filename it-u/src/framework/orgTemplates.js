// src/framework/orgTemplates.js — the shipped "starter" organization templates
// (an enhancement layered on top of the 56-task roadmap).
//
// A starter is a ready-made organization template: the records and typed links
// a particular kind of client needs from day one, so a new documentation set is
// never an empty shell. Three focused starters ship —
//   • Managed IT client             (starter-managed-it)
//   • Hosted voice (VoIP) client    (starter-voip)
//   • Internet / ISP circuit client (starter-isp-connectivity)
// — plus a composed Full-service client (starter-full-service) that is the
// union of the three, built by merging their definitions rather than by hand.
//
// A starter is shaped EXACTLY like a saved template (see ./templates.js) so the
// template service can apply it unchanged: `{ records, links }`, where each link
// stores INDEX references into the records array. The definitions below are
// authored readably with string KEYS (`org`, `hq`, `firewall`, …) and normalised
// into indices on demand.
//
// Only fields that can be applied verbatim are seeded. Intra-set `record`-type
// references (a contact's `organizationId`, an asset's `backupHost`, …) are
// deliberately left empty and expressed as typed LINKS instead, because a
// template cannot know the record ids it is about to mint. Example values
// ("Example ISP") mark the fields a technician replaces with the real details.

import { builtinAssetType } from "./assetLibrary.js";
import { RELATIONSHIP_KINDS } from "./relationships.js";

export const STARTER_PREFIX = "starter-";
export const STARTER_SCHEMA = "itu-template/1";
export const STARTER_PROVENANCE = "authored";

// The information model each record type belongs to (see ./classification.js).
const MODEL_BY_TYPE = {
  organizations: "core-asset",
  locations: "core-asset",
  contacts: "core-asset",
  configurations: "core-asset",
  passwords: "core-asset",
  flexibleAssets: "flexible-asset",
  documents: "document",
  checklists: "document",
  sites: "document",
  runbooks: "document",
  diagrams: "document",
  domains: "core-asset",
  certificates: "core-asset",
};

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// ---- authoring helpers -----------------------------------------------------
function rec(key, type, name, fields = {}) {
  return { key, type, name, fields };
}
const org = (key, name, fields) => rec(key, "organizations", name, fields);
const location = (key, name, fields) => rec(key, "locations", name, fields);
const contact = (key, name, fields) => rec(key, "contacts", name, fields);
const config = (key, name, fields) => rec(key, "configurations", name, fields);
const doc = (key, name, fields) => rec(key, "documents", name, fields);
const checklist = (key, name, fields) => rec(key, "checklists", name, fields);
const site = (key, name, fields) => rec(key, "sites", name, fields);
const runbook = (key, name, fields) => rec(key, "runbooks", name, fields);
const domain = (key, name, fields) => rec(key, "domains", name, fields);
const certificate = (key, name, fields) => rec(key, "certificates", name, fields);

// A flexible asset stores its template id on the record and its authored values
// under `assetFields`. Any REQUIRED field the author did not set is filled from
// the template itself (first option for choice fields) so a seeded asset is
// structurally valid the moment it is created.
function asset(key, name, typeId, assetFields = {}) {
  const type = builtinAssetType(typeId);
  const values = { ...assetFields };
  if (type) {
    for (const f of type.fields || []) {
      if (!f.required) continue;
      const v = values[f.key];
      const has = Array.isArray(v) ? v.length > 0 : !isBlank(v);
      if (has) continue;
      if (f.type === "select") values[f.key] = (f.options && f.options[0] && f.options[0].id) || "";
      else if (f.type === "checkbox") values[f.key] = false;
    }
  }
  return rec(key, "flexibleAssets", name, { assetTypeId: typeId, assetFields: values });
}

function link(kind, from, to, note = "") {
  return { kind, from, to, note };
}

function steps(...texts) {
  return texts.map((text, i) => ({ id: "step-" + (i + 1), text, done: false }));
}

// ---- 1. Managed IT client --------------------------------------------------
const MANAGED_IT = {
  id: "starter-managed-it",
  name: "Managed IT client",
  description:
    "A standard managed-IT client: the organization, its site and people, the network and server estate, and the core services — internet, email, file sharing, backup, security, remote access and printing — wired together with typed links.",
  icon: "server",
  records: [
    org("org", "Client", {
      orgKind: "organization",
      tradingName: "Client",
      website: "https://example.com",
      notes: "Set the client's legal name, trading name, registration and primary contact details.",
    }),
    location("hq", "Head office", { locationType: "office", siteCode: "HQ-01" }),
    contact("contactPrimary", "Primary contact", { contactRole: "client-primary", jobTitle: "Operations manager", preferredMethod: "email" }),
    contact("contactTech", "IT liaison", { contactRole: "client-technical", jobTitle: "IT manager", preferredMethod: "email" }),
    contact("contactBilling", "Accounts payable", { contactRole: "client-billing", preferredMethod: "email" }),
    config("firewall", "Edge firewall", { configType: "firewall" }),
    config("switch", "Core switch", { configType: "switch" }),
    config("ap", "Access point", { configType: "access-point" }),
    config("server", "Primary server", { configType: "server-physical" }),
    config("printer", "Network printer", { configType: "printer" }),
    asset("lan", "LAN", "atype-lan", { architecture: "vlan-segmented" }),
    asset("wifi", "Wireless", "atype-wireless", { ssids: "Corp\nGuest", securityMode: "wpa2-wpa3-mixed", authentication: "psk" }),
    asset("wanService", "Internet / WAN service", "atype-wan-service", { carrier: "Example ISP", serviceKind: "primary" }),
    asset("email", "Email system", "atype-email-system", { platform: "microsoft365", deployment: "cloud" }),
    asset("files", "File sharing & storage", "atype-file-sharing", { storageType: "on-prem" }),
    asset("backup", "Backup service", "atype-backup-service", { product: "Example backup product", architecture: "hybrid" }),
    asset("security", "Security platform", "atype-security-platform", { product: "Example EDR", platformType: "edr" }),
    asset("remote", "Remote access", "atype-remote-access", { method: "vpn" }),
    asset("printing", "Printing", "atype-printing", { printerType: "mfp" }),
    asset("apps", "Business applications", "atype-applications", { applicationType: "line-of-business" }),
    asset("licences", "Licensing & subscriptions", "atype-licences", { product: "Example licence", licenceType: "subscription" }),
    asset("supplier", "Technology supplier", "atype-vendor", { vendorType: "services", website: "https://example.com" }),
    doc("overviewDoc", "Client environment overview", {
      docType: "client-technical",
      summary: "How this client's environment is put together.",
      body: [
        "# Client environment overview",
        "",
        "## At a glance",
        "",
        "- Sites: 1 (head office)",
        "- Users and seats: to confirm",
        "- Internet: single primary link",
        "",
        "## Infrastructure",
        "",
        "The head office runs an edge firewall, a core switch, an access point, a primary server and a network printer. Capture the manufacturer, model, serial, hostname and IP addressing on each configuration record.",
        "",
        "## Services",
        "",
        "Internet, email, file sharing, backup, security, remote access and printing are each recorded as a structured service asset and linked to the estate it touches.",
        "",
        "## Support",
        "",
        "- Primary contact: escalate day-to-day requests",
        "- IT liaison: technical decisions and after-hours escalation",
        "- Provider support desk: first-line triage",
      ].join("\n"),
      tags: "onboarding, environment",
    }),
    checklist("onboarding", "Onboarding checklist", {
      defaultAssignee: "Provider support desk",
      items: steps(
        "Confirm the client's legal and trading details and record them on the organization.",
        "Record the site address, access notes and time zone on the head-office location.",
        "Capture the primary, technical and billing contacts.",
        "Inventory the network and server estate as configuration records.",
        "Document the internet/WAN service, LAN and wireless.",
        "Document email, file sharing, backup, security, remote access and printing.",
        "Confirm the support model and escalation path with the client.",
        "Schedule a review of the completed documentation with the customer.",
      ),
    }),
    site("site", "Site summary", {
      siteType: "office",
      accessNotes: "Business hours, door codes, key-holders and any escort requirements.",
      connectivityNotes: "Where the carrier circuit enters the building and the main comms cabinet.",
      emergencyNotes: "After-hours contacts and the power-down procedure.",
    }),
  ],
  links: [
    link("organization-location", "org", "hq"),
    link("organization-contact", "org", "contactPrimary"),
    link("organization-contact", "org", "contactTech"),
    link("organization-contact", "org", "contactBilling"),
    link("organization-configuration", "org", "firewall"),
    link("organization-configuration", "org", "switch"),
    link("organization-configuration", "org", "ap"),
    link("organization-configuration", "org", "server"),
    link("organization-configuration", "org", "printer"),
    link("organization-flexible-asset", "org", "lan"),
    link("organization-flexible-asset", "org", "wifi"),
    link("organization-flexible-asset", "org", "wanService"),
    link("organization-flexible-asset", "org", "email"),
    link("organization-flexible-asset", "org", "files"),
    link("organization-flexible-asset", "org", "backup"),
    link("organization-flexible-asset", "org", "security"),
    link("organization-flexible-asset", "org", "remote"),
    link("organization-flexible-asset", "org", "printing"),
    link("organization-flexible-asset", "org", "apps"),
    link("organization-flexible-asset", "org", "licences"),
    link("organization-flexible-asset", "org", "supplier"),
    link("organization-document", "org", "overviewDoc"),
    link("organization-checklist", "org", "onboarding"),
    link("location-record", "hq", "firewall"),
    link("location-record", "hq", "switch"),
    link("location-record", "hq", "ap"),
    link("location-record", "hq", "server"),
    link("location-record", "hq", "printer"),
    link("location-record", "hq", "lan"),
    link("location-record", "hq", "site"),
    link("configuration-location", "firewall", "hq"),
    link("configuration-location", "switch", "hq"),
    link("configuration-location", "ap", "hq"),
    link("configuration-location", "server", "hq"),
    link("configuration-location", "printer", "hq"),
    link("configuration-contact", "server", "contactTech"),
    link("lan-switch", "lan", "switch"),
    link("lan-server", "lan", "server"),
    link("lan-wireless", "lan", "wifi"),
    link("lan-wan", "lan", "wanService"),
    link("wan-firewall", "wanService", "firewall"),
    link("wan-security", "wanService", "security"),
    link("wan-vendor", "wanService", "supplier"),
    link("wireless-ap", "wifi", "ap"),
    link("wireless-security", "wifi", "security"),
    link("security-configuration", "security", "server"),
    link("remote-access-configuration", "remote", "firewall"),
    link("remote-access-security", "remote", "security"),
    link("file-sharing-configuration", "files", "server"),
    link("file-sharing-security", "files", "security"),
    link("printing-configuration", "printing", "printer"),
    link("backup-protected-configs", "backup", "server"),
    link("email-security", "email", "security"),
    link("email-vendor", "email", "supplier"),
    link("application-server", "apps", "server"),
    link("application-vendor", "apps", "supplier"),
    link("licence-application", "licences", "apps"),
    link("contact-owner", "contactTech", "server"),
    link("document-asset", "overviewDoc", "server"),
    link("document-location", "overviewDoc", "hq"),
    link("checklist-configuration", "onboarding", "server"),
    link("checklist-contact", "onboarding", "contactTech"),
    link("site-location", "site", "hq"),
    link("site-asset", "site", "server"),
    link("site-asset", "site", "lan"),
  ],
};

// ---- 2. Hosted voice (VoIP) client -----------------------------------------
const VOIP = {
  id: "starter-voip",
  name: "Hosted voice (VoIP) client",
  description:
    "A hosted-voice client: the organization and site, the voice platform and its trunking, the internet circuit that carries it, the firewall/SBC and network behind it, plus a deployment runbook and cutover checklist.",
  icon: "phone",
  records: [
    org("org", "Client", {
      orgKind: "organization",
      tradingName: "Client",
      website: "https://example.com",
      notes: "Set the client's legal and trading details, and who owns the voice service.",
    }),
    location("hq", "Head office", { locationType: "office", siteCode: "HQ-01" }),
    contact("contactPrimary", "Primary contact", { contactRole: "client-primary", jobTitle: "Operations manager", preferredMethod: "email" }),
    contact("contactTech", "IT liaison", { contactRole: "client-technical", jobTitle: "IT manager", preferredMethod: "email" }),
    contact("carrierContact", "Voice carrier contact", { contactRole: "isp-carrier", preferredMethod: "phone" }),
    config("firewall", "Edge firewall", { configType: "firewall", notes: "SIP ALG disabled; voice VLAN and QoS marked here or on the SBC." }),
    config("sbc", "Session border controller / voice gateway", { configType: "other" }),
    config("switch", "Core switch", { configType: "switch", notes: "Voice VLAN and PoE for handsets." }),
    asset("voice", "Voice / PBX platform", "atype-voice-pbx", {
      platformType: "ringcentral",
      product: "Example hosted voice",
      deploymentModel: "cloud",
      trunkType: "hosted",
      sipTransport: "tls",
    }),
    asset("circuit", "Internet / WAN circuit", "atype-wan-circuit", {
      carrier: "Example ISP",
      circuitType: "fibre",
      serviceDefinition: "business",
    }),
    asset("wanService", "Internet / WAN service", "atype-wan-service", { carrier: "Example ISP", serviceKind: "primary" }),
    asset("lan", "LAN", "atype-lan", { architecture: "vlan-segmented" }),
    asset("security", "Security platform", "atype-security-platform", { product: "Example firewall security", platformType: "firewall" }),
    asset("licences", "Voice licensing", "atype-licences", { product: "Example voice licences", licenceType: "subscription" }),
    asset("voiceVendor", "Voice provider", "atype-vendor", { vendorType: "voice", supportPhone: "", website: "https://example.com" }),
    doc("voiceDoc", "Voice environment overview", {
      docType: "client-technical",
      summary: "How this client's telephony is provided and supported.",
      body: [
        "# Voice environment overview",
        "",
        "## Platform",
        "",
        "Record the platform, deployment model, tenant reference and administrator portal on the Voice / PBX record.",
        "",
        "## Numbers",
        "",
        "List the main number, DIDs, toll-free and fax numbers and the porting status on the Voice record.",
        "",
        "## Emergency calling",
        "",
        "Confirm the emergency service and the dispatchable location for every site.",
        "",
        "## Network readiness",
        "",
        "Voice rides the internet circuit and the voice VLAN. Record the circuit, the firewall/SBC and the switch that carries it, and the QoS marking applied to voice traffic.",
      ].join("\n"),
      tags: "voice, voip",
    }),
    runbook("voipRunbook", "VoIP deployment runbook", {
      runbookType: "voip-deployment",
      status: "draft",
      version: "1.0",
      summary: "Stand up the hosted voice service end to end.",
      reviewIntervalDays: 365,
      body: [
        "# VoIP deployment runbook",
        "",
        "## 1. Platform & PBX configuration",
        "",
        "1. Confirm the tenant, licences and administrator access.",
        "2. Record the platform, deployment model and admin portal on the Voice/PBX record.",
        "",
        "## 2. Dial plan, extensions & ring groups",
        "",
        "1. Define the numbering plan and extension ranges.",
        "2. Create ring/hunt groups and call queues.",
        "",
        "## 3. SIP trunk(s)",
        "",
        "1. Confirm the trunk type, transport and codec preference.",
        "2. Verify registration / IP authentication.",
        "",
        "## 4. DID & number inventory (+ porting)",
        "",
        "1. List every number and its type.",
        "2. Track porting status and the port date.",
        "",
        "## 5. Emergency calling",
        "",
        "1. Configure the emergency service and dispatchable location per site.",
        "2. Test an emergency call routing check.",
        "",
        "## 6. Codecs & QoS",
        "",
        "1. Agree codec order.",
        "2. Mark voice traffic (VLAN, DSCP) and confirm bandwidth per call.",
        "",
        "## 7. Firewall, SBC & NAT traversal",
        "",
        "1. Open only the required SIP/RTP ranges.",
        "2. Disable SIP ALG where the SBC handles NAT.",
        "",
        "## 8. Failover & redundancy",
        "",
        "1. Record what happens if the platform, trunk or site link fails.",
        "",
        "## 9. Handsets & softphones",
        "",
        "1. Register and label every endpoint.",
        "",
        "## 10. Per-site network readiness",
        "",
        "1. Confirm the circuit, LAN and switch readiness at each site.",
        "",
        "## 11. Cutover, verification & rollback",
        "",
        "1. Work the cutover checklist.",
        "2. Verify inbound, outbound, internal and emergency calls.",
        "3. Record the rollback plan and the decision point.",
      ].join("\n"),
      tags: "voice, deployment",
    }),
    checklist("cutover", "Voice cutover checklist", {
      defaultAssignee: "Provider support desk",
      items: steps(
        "Confirm the deployment runbook is reviewed and ready.",
        "Confirm the internet circuit is live and stable.",
        "Confirm the firewall/SBC is configured and voice traffic is marked.",
        "Confirm the voice VLAN and PoE on the switch.",
        "Register and label all handsets and softphones.",
        "Test inbound calls, outbound calls and internal extension dialling.",
        "Test ring groups, call queues and voicemail.",
        "Confirm emergency calling and the dispatchable location.",
        "Confirm number porting completed and update the number inventory.",
        "Hand over to the client and schedule a post-cutover review.",
      ),
    }),
  ],
  links: [
    link("organization-location", "org", "hq"),
    link("organization-contact", "org", "contactPrimary"),
    link("organization-contact", "org", "contactTech"),
    link("organization-contact", "org", "carrierContact"),
    link("organization-configuration", "org", "firewall"),
    link("organization-configuration", "org", "sbc"),
    link("organization-configuration", "org", "switch"),
    link("organization-flexible-asset", "org", "voice"),
    link("organization-flexible-asset", "org", "circuit"),
    link("organization-flexible-asset", "org", "wanService"),
    link("organization-flexible-asset", "org", "lan"),
    link("organization-flexible-asset", "org", "security"),
    link("organization-flexible-asset", "org", "licences"),
    link("organization-flexible-asset", "org", "voiceVendor"),
    link("organization-document", "org", "voiceDoc"),
    link("organization-checklist", "org", "cutover"),
    link("location-record", "hq", "firewall"),
    link("location-record", "hq", "sbc"),
    link("location-record", "hq", "switch"),
    link("configuration-location", "firewall", "hq"),
    link("configuration-location", "sbc", "hq"),
    link("configuration-location", "switch", "hq"),
    link("voice-circuit", "voice", "circuit"),
    link("voice-configuration", "voice", "sbc"),
    link("voice-sbc", "voice", "firewall"),
    link("voice-security", "voice", "security"),
    link("voice-vendor", "voice", "voiceVendor"),
    link("voice-document", "voice", "voiceDoc"),
    link("voice-checklist", "voice", "cutover"),
    link("contact-voice", "contactTech", "voice"),
    link("circuit-upstream", "circuit", "voiceVendor"),
    link("circuit-cpe", "circuit", "firewall"),
    link("circuit-lan", "circuit", "lan"),
    link("wan-firewall", "wanService", "firewall"),
    link("wan-vendor", "wanService", "voiceVendor"),
    link("lan-wan", "lan", "wanService"),
    link("lan-switch", "lan", "switch"),
    link("security-configuration", "security", "firewall"),
    link("contact-owner", "carrierContact", "circuit"),
    link("runbook-organization", "voipRunbook", "org"),
    link("runbook-service", "voipRunbook", "voice"),
    link("runbook-location", "voipRunbook", "hq"),
    link("runbook-configuration", "voipRunbook", "sbc"),
    link("runbook-contact", "voipRunbook", "contactTech"),
    link("checklist-service", "cutover", "voice"),
    link("checklist-location", "cutover", "hq"),
    link("checklist-runbook", "cutover", "voipRunbook"),
    link("checklist-contact", "cutover", "contactTech"),
  ],
};

// ---- 3. Internet / ISP circuit client --------------------------------------
const ISP = {
  id: "starter-isp-connectivity",
  name: "Internet / ISP circuit client",
  description:
    "An internet/connectivity client: the organization and site, a primary and a failover circuit, the router/CPE and firewall, the LAN and wireless, the upstream carrier, and the public domain and TLS certificate, with a provisioning runbook and checklist.",
  icon: "globe",
  records: [
    org("org", "Client", {
      orgKind: "organization",
      tradingName: "Client",
      website: "https://example.com",
      notes: "Set the client's legal and trading details and the circuits they hold.",
    }),
    location("hq", "Head office", { locationType: "office", siteCode: "HQ-01" }),
    contact("contactPrimary", "Primary contact", { contactRole: "client-primary", jobTitle: "Operations manager", preferredMethod: "email" }),
    contact("contactTech", "IT liaison", { contactRole: "client-technical", jobTitle: "IT manager", preferredMethod: "email" }),
    contact("carrierContact", "Upstream carrier contact", { contactRole: "isp-carrier", preferredMethod: "phone" }),
    config("firewall", "Edge firewall", { configType: "firewall" }),
    config("router", "Router / CPE", { configType: "router" }),
    config("switch", "Core switch", { configType: "switch" }),
    config("ap", "Access point", { configType: "access-point" }),
    asset("circuitPrimary", "Primary internet circuit", "atype-wan-circuit", {
      carrier: "Example ISP",
      circuitType: "fibre",
      serviceDefinition: "business",
      slaTarget: "business",
      bandwidthDown: 100,
      bandwidthUp: 100,
    }),
    asset("circuitFailover", "Failover internet circuit", "atype-wan-circuit", {
      carrier: "Example Mobile",
      circuitType: "mobile",
      serviceDefinition: "essential",
      slaTarget: "standard",
    }),
    asset("wanService", "Internet / WAN service", "atype-wan-service", {
      carrier: "Example ISP",
      serviceKind: "primary",
      failover: true,
      aggregated: false,
    }),
    asset("lan", "LAN", "atype-lan", { architecture: "vlan-segmented" }),
    asset("wifi", "Wireless", "atype-wireless", { ssids: "Corp\nGuest", securityMode: "wpa2-wpa3-mixed", authentication: "psk" }),
    asset("security", "Security platform", "atype-security-platform", { product: "Example firewall security", platformType: "firewall" }),
    asset("upstreamVendor", "Upstream carrier", "atype-vendor", { vendorType: "isp-carrier", website: "https://example.com" }),
    domain("domain", "example.com", {
      registrar: "Example Registrar",
      provider: "Example DNS",
      registrationStatus: "active",
    }),
    certificate("certificate", "vpn.example.com", {
      port: 443,
      issuer: "Example CA",
      subject: "vpn.example.com",
      keyType: "RSA-2048",
    }),
    doc("connectivityDoc", "Connectivity overview", {
      docType: "client-technical",
      summary: "How this client is connected to the internet and what depends on it.",
      body: [
        "# Connectivity overview",
        "",
        "## Circuits",
        "",
        "Record the primary and failover circuits, their carriers, access technology and bandwidth, and the service definition each is sold as.",
        "",
        "## Addressing",
        "",
        "Record the static IPs, subnet allocation and reverse DNS on each circuit.",
        "",
        "## Edge",
        "",
        "The carrier handoff terminates on the router/CPE, behind which the edge firewall controls traffic into the LAN.",
        "",
        "## Dependencies",
        "",
        "The public domain and TLS certificate that front any hosted service are tracked here and linked to the circuits they depend on.",
      ].join("\n"),
      tags: "connectivity, internet",
    }),
    runbook("ispRunbook", "Circuit provisioning runbook", {
      runbookType: "circuit-provisioning",
      status: "draft",
      version: "1.0",
      summary: "Bring a resold internet/WAN circuit live end to end.",
      reviewIntervalDays: 365,
      body: [
        "# Circuit provisioning runbook",
        "",
        "## 1. Order & carrier handoff",
        "",
        "1. Capture the order reference, service definition and contract term.",
        "2. Record the carrier, account number and circuit ID.",
        "",
        "## 2. Access & build",
        "",
        "1. Confirm the access technology and the expected build date.",
        "2. Record the carrier entry point and any building access requirements.",
        "",
        "## 3. Handoff & CPE",
        "",
        "1. Confirm the handoff type and the router/CPE role.",
        "2. Record the CPE make, model and configuration.",
        "",
        "## 4. Addressing & DNS",
        "",
        "1. Record the static IPs, subnet allocation and reverse DNS.",
        "",
        "## 5. Edge & firewall",
        "",
        "1. Confirm the edge firewall configuration and NAT.",
        "",
        "## 6. Throughput, SLA & acceptance",
        "",
        "1. Test committed upload and download.",
        "2. Confirm the SLA target and monitoring.",
        "",
        "## 7. Billing reconciliation",
        "",
        "1. Confirm wholesale cost, sell price and billing cycle.",
        "",
        "## 8. Handover",
        "",
        "1. Update the documentation and close the provisioning checklist.",
      ].join("\n"),
      tags: "circuit, provisioning",
    }),
    checklist("provisioning", "Circuit provisioning checklist", {
      defaultAssignee: "Provider support desk",
      items: steps(
        "Capture the order reference, service definition and contract term.",
        "Confirm the carrier, account number and circuit ID.",
        "Confirm the access technology and build/activation date.",
        "Record the carrier entry point and building access requirements.",
        "Confirm the handoff and install the router/CPE.",
        "Record the static IPs, subnet allocation and reverse DNS.",
        "Confirm the edge firewall configuration and NAT.",
        "Test committed upload and download throughput.",
        "Confirm the SLA target and monitoring is in place.",
        "Reconcile wholesale cost, sell price and billing cycle.",
        "Update the documentation and hand over to the client.",
      ),
    }),
  ],
  links: [
    link("organization-location", "org", "hq"),
    link("organization-contact", "org", "contactPrimary"),
    link("organization-contact", "org", "contactTech"),
    link("organization-contact", "org", "carrierContact"),
    link("organization-configuration", "org", "firewall"),
    link("organization-configuration", "org", "router"),
    link("organization-configuration", "org", "switch"),
    link("organization-configuration", "org", "ap"),
    link("organization-flexible-asset", "org", "circuitPrimary"),
    link("organization-flexible-asset", "org", "circuitFailover"),
    link("organization-flexible-asset", "org", "wanService"),
    link("organization-flexible-asset", "org", "lan"),
    link("organization-flexible-asset", "org", "wifi"),
    link("organization-flexible-asset", "org", "security"),
    link("organization-flexible-asset", "org", "upstreamVendor"),
    link("organization-document", "org", "connectivityDoc"),
    link("organization-checklist", "org", "provisioning"),
    link("location-record", "hq", "firewall"),
    link("location-record", "hq", "router"),
    link("location-record", "hq", "switch"),
    link("location-record", "hq", "ap"),
    link("location-record", "hq", "lan"),
    link("configuration-location", "firewall", "hq"),
    link("configuration-location", "router", "hq"),
    link("configuration-location", "switch", "hq"),
    link("configuration-location", "ap", "hq"),
    link("configuration-contact", "router", "contactTech"),
    link("circuit-upstream", "circuitPrimary", "upstreamVendor"),
    link("circuit-upstream", "circuitFailover", "upstreamVendor"),
    link("circuit-cpe", "circuitPrimary", "router"),
    link("circuit-security", "circuitFailover", "firewall"),
    link("circuit-lan", "circuitPrimary", "lan"),
    link("circuit-document", "circuitPrimary", "connectivityDoc"),
    link("circuit-domain", "circuitPrimary", "domain"),
    link("circuit-certificate", "circuitPrimary", "certificate"),
    link("contact-owner", "carrierContact", "circuitPrimary"),
    link("contact-circuit", "carrierContact", "circuitPrimary"),
    link("wan-firewall", "wanService", "firewall"),
    link("wan-vendor", "wanService", "upstreamVendor"),
    link("lan-wan", "lan", "wanService"),
    link("lan-switch", "lan", "switch"),
    link("lan-wireless", "lan", "wifi"),
    link("wireless-ap", "wifi", "ap"),
    link("wireless-security", "wifi", "security"),
    link("security-configuration", "security", "firewall"),
    link("domain-asset", "domain", "circuitPrimary"),
    link("certificate-service", "certificate", "circuitPrimary"),
    link("document-asset", "connectivityDoc", "circuitPrimary"),
    link("document-location", "connectivityDoc", "hq"),
    link("runbook-organization", "ispRunbook", "org"),
    link("runbook-service", "ispRunbook", "circuitPrimary"),
    link("runbook-location", "ispRunbook", "hq"),
    link("runbook-configuration", "ispRunbook", "router"),
    link("runbook-contact", "ispRunbook", "contactTech"),
    link("checklist-service", "provisioning", "circuitPrimary"),
    link("checklist-location", "provisioning", "hq"),
    link("checklist-runbook", "provisioning", "ispRunbook"),
    link("checklist-contact", "provisioning", "contactTech"),
  ],
};

// ---- 4. Full-service client (composed) -------------------------------------
// The union of the three focused starters. Records are merged by key (the first
// definition that authors a record wins, so the three share one organization,
// one head-office location, one firewall and so on) and duplicate links collapse.
function composeDefs(defs) {
  const byKey = new Map();
  const order = [];
  const links = [];
  const seen = new Set();
  for (const def of defs) {
    for (const r of def.records) {
      if (byKey.has(r.key)) continue;
      byKey.set(r.key, r);
      order.push(r.key);
    }
    for (const l of def.links) {
      const sig = l.kind + "|" + l.from + "|" + l.to;
      if (seen.has(sig)) continue;
      seen.add(sig);
      links.push(l);
    }
  }
  return { records: order.map((k) => byKey.get(k)), links };
}

const FULL_SERVICE = {
  id: "starter-full-service",
  name: "Full-service client (IT + voice + circuits)",
  description:
    "Everything a client who buys managed IT, hosted voice and internet circuits from one provider needs — the merged union of the managed-IT, hosted-voice and internet-client starters.",
  icon: "layers",
  ...composeDefs([MANAGED_IT, VOIP, ISP]),
};

const DEFINITIONS = [MANAGED_IT, VOIP, ISP, FULL_SERVICE];

// ---- public API ------------------------------------------------------------
export function isStarterId(id) {
  return typeof id === "string" && id.startsWith(STARTER_PREFIX);
}

export function listStarterDefinitions() {
  return DEFINITIONS.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    icon: d.icon || "layers",
  }));
}

// Normalise a definition into the exact template shape templates.js applies.
function buildTemplate(def) {
  const index = new Map();
  const records = [];
  for (const r of def.records) {
    if (index.has(r.key)) continue;
    index.set(r.key, records.length);
    records.push({
      type: r.type,
      name: r.name,
      informationModel: MODEL_BY_TYPE[r.type] || "core-asset",
      provenance: STARTER_PROVENANCE,
      origin: {},
      fields: { ...r.fields },
    });
  }
  const links = [];
  for (const l of def.links) {
    const from = index.get(l.from);
    const to = index.get(l.to);
    if (from === undefined || to === undefined) continue; // defensive: skip a bad ref
    links.push({ kind: l.kind, from, to, note: l.note || "" });
  }
  return {
    schema: STARTER_SCHEMA,
    id: def.id,
    name: def.name,
    description: def.description,
    icon: def.icon || "layers",
    kind: "organization",
    builtin: true,
    records,
    links,
    counts: { records: records.length, links: links.length },
  };
}

export function starterTemplate(id) {
  const def = DEFINITIONS.find((d) => d.id === id);
  return def ? buildTemplate(def) : null;
}

export function listStarterTemplates() {
  return DEFINITIONS.map((def) => {
    const t = buildTemplate(def);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      kind: t.kind,
      builtin: true,
      counts: t.counts,
      version: 1,
    };
  });
}

// A strict self-check of the shipped definitions, used by the test suite: every
// link names a real record key and a known relationship kind, every
// (type, name) is unique within a starter, and every flexible asset uses a
// shipped asset type.
export function validateStarterDefinitions() {
  const problems = [];
  for (const def of DEFINITIONS) {
    const keys = new Set();
    const typeName = new Set();
    for (const r of def.records) {
      if (keys.has(r.key)) problems.push(def.id + ": duplicate record key “" + r.key + "”");
      keys.add(r.key);
      const tn = r.type + ":" + r.name;
      if (typeName.has(tn)) problems.push(def.id + ": duplicate record “" + tn + "”");
      typeName.add(tn);
      if (r.type === "flexibleAssets" && !builtinAssetType(r.fields.assetTypeId)) {
        problems.push(def.id + ": unknown asset type “" + r.fields.assetTypeId + "”");
      }
    }
    for (const l of def.links) {
      if (!keys.has(l.from)) problems.push(def.id + ": link “" + l.kind + "” has unknown from “" + l.from + "”");
      if (!keys.has(l.to)) problems.push(def.id + ": link “" + l.kind + "” has unknown to “" + l.to + "”");
      if (!RELATIONSHIP_KINDS.some((k) => k.id === l.kind)) problems.push(def.id + ": unknown link kind “" + l.kind + "”");
    }
  }
  return problems;
}
