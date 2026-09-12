// src/framework/guidance.js — "structure it, don't bury it" guidance (task 14).
//
// Task 14 asks IT-U to STEER users toward structured assets rather than burying
// structured data in documents. Two things support that:
//   • STRUCTURED_GUIDANCE — the standing explanation, shown in the Documents
//     station, of what belongs in a structured record versus a document; and
//   • suggestAssetTypes — a keyword matcher that turns a free-text "what are you
//     documenting?" query into concrete templates from the shared library, so
//     the guidance ends in a one-click "record it properly" action.

export const STRUCTURED_GUIDANCE = {
  structured: [
    { title: "Things with identity and relationships", detail: "Anything another record points at — a device, an application, a licence, a person, a role. Structure keeps the links consistent." },
    { title: "Anything you filter, count or report on", detail: "Estates, seats, renewal dates, tiers, departments. Structured fields can be sorted, totalled and alerted on; prose cannot." },
    { title: "Anything with a lifecycle or a date", detail: "Renewals, warranties, contract ends. Flag a date field and IT-U tracks it on the renewals board." },
    { title: "Anything a technician looks up under pressure", detail: "IP addresses, credentials, who to call, which build a role gets. Findable, not buried in paragraph nine." },
  ],
  documents: [
    { title: "Narrative and rationale", detail: "Why a decision was made, how a system is used, background for the next engineer." },
    { title: "Procedures and runbooks", detail: "Step-by-step instructions — SOPs, install guides, cutover plans (tracked as documents and checklists)." },
    { title: "Diagrams and source files", detail: "Network diagrams, rack elevations, site photos and their editable sources." },
    { title: "Agreements and supporting paperwork", detail: "Signed contracts, quotes and letters — attached to the structured record they belong to." },
  ],
};

// Keyword → shipped template id. Deliberately broad synonyms so a free-text
// query finds the right template; matching is substring-based on a normalised
// string.
export const TOPIC_KEYWORDS = {
  "atype-applications": ["application", "app", "software", "saas", "business system", "line of business", "erp", "crm", "accounting", "payroll", "database app"],
  "atype-licences": ["licence", "license", "subscription", "renewal", "seats", "entitlement", "microsoft licensing", "volume licensing", "office 365 licence"],
  "atype-vendor": ["vendor", "supplier", "provider", "account manager", "purchase", "procurement", "contract", "supplier account"],
  "atype-user-role": ["role", "user role", "permissions", "access level", "staff type", "department staff", "job title"],
  "atype-software-build": ["build", "image", "soe", "standard operating environment", "deployment package", "gold image", "provisioning"],
  "atype-virtualization": ["virtualization", "vmware", "vsphere", "esxi", "hyper-v", "hyperv", "proxmox", "hypervisor", "cluster", "virtual machine", "host cluster", "datastore"],
  "atype-email-system": ["email", "mail", "exchange", "microsoft 365", "google workspace", "mailbox", "tenant", "smtp", "imap", "mx record", "spf", "dkim", "dmarc", "mail flow"],
  "atype-backup-service": ["backup", "restore", "retention", "disaster recovery", "offsite copy", "rpo", "rto", "backup appliance", "backup service", "immutable backup"],
  "atype-wan-service": ["internet", "wan", "isp", "carrier", "circuit", "broadband", "fibre", "fiber", "sd-wan", "leased line", "mpls", "public ip"],
  "atype-lan": ["lan", "subnet", "vlan", "ip addressing", "internal dns", "switch", "cabling", "network topology"],
  "atype-wireless": ["wireless", "wifi", "wi-fi", "wlan", "ssid", "access point", "wireless controller"],
  "atype-security-platform": ["security platform", "antivirus", "anti-virus", "edr", "endpoint protection", "endpoint detection", "mfa", "multi-factor", "siem", "phishing", "spam filter", "email security", "web filter", "vulnerability", "patch management", "identity protection", "firewall"],
  "atype-remote-access": ["remote access", "vpn", "ssl vpn", "site-to-site", "rdp", "remote desktop", "rd gateway", "zero trust", "remote gateway", "remote support", "rmm", "webmail", "split tunnel"],
  "atype-file-sharing": ["file share", "file server", "file storage", "shared folder", "shared drive", "network drive", "storage", "nas", "san", "das", "onedrive", "sharepoint", "smb", "cloud storage"],
  "atype-printing": ["printer", "printing", "mfp", "copier", "multifunction", "scanner", "plotter", "wide format", "label printer", "thermal printer", "print server", "managed print", "toner"],
  "atype-voice-pbx": ["phone system", "voip", "pbx", "telephony", "sip", "extension", "handset", "phone"],
  "atype-wan-circuit": ["internet", "circuit", "wan", "broadband", "fibre", "fiber", "fttp", "isp", "bandwidth", "leased line"],
};

// Suggest templates from the library for a free-text query. Returns the best
// matches (score = number of distinct keywords matched), filtered to templates
// that actually exist in `types`.
export function suggestAssetTypes(text, types, { limit = 4 } = {}) {
  const q = String(text || "").toLowerCase().trim();
  if (!q) return [];
  const available = new Map();
  for (const t of types || []) if (t && t.id) available.set(t.id, t);
  const results = [];
  for (const [typeId, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const type = available.get(typeId);
    if (!type) continue;
    const matched = keywords.filter((k) => q.includes(k));
    if (!matched.length) continue;
    results.push({ type, matched, score: matched.length, best: Math.max(...matched.map((m) => m.length)) });
  }
  results.sort((a, b) => b.score - a.score || b.best - a.best || String(a.type.name).localeCompare(String(b.type.name)));
  return results.slice(0, limit);
}
