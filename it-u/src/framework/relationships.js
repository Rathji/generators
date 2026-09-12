// src/framework/relationships.js — the relationship engine (roadmap Phase 1,
// task 4).
//
// Relationships are FIRST-CLASS typed links between records, stored as records
// of their own (`records.relationships`) inside the client's documentation set.
// A link is `{ id, type:"relationships", kind, from:{type,id}, to:{type,id} }`.
//
// Why typed links rather than copied fields: the roadmap's whole point is that
// "application → server", "firewall → security documentation", "licence →
// application", "circuit → firewall" and friends should be expressed ONCE and
// stay consistent — never by re-typing the same fact into two records. So this
// layer:
//   • validates every link against a catalog of allowed kinds (which record
//     types a kind may start from and point at);
//   • refuses duplicates and self-links;
//   • refuses free-form duplicates of an existing record (findDuplicate) and
//     suggests linking the existing one instead (suggestLinks);
//   • reports a record's links in BOTH directions (relationsOf), so the link is
//     bidirectionally visible without storing it twice;
//   • cascades a record's links away with it (cascadedRelationships), keeping
//     the graph consistent when a record is deleted;
//   • audits the whole graph (checkIntegrity) for dangling endpoints, unknown
//     kinds, self-links and duplicate links — used by the Linter station.

// The relationship catalog. `from`/`to` list the record collections a kind may
// connect. (Applications, licences, vendors and backup/voice/email services are
// Flexible Assets until their dedicated templates arrive in Phase 3; the ref may
// carry a `template` for finer typing later without changing the link shape.)
export const RELATIONSHIP_KINDS = [
  { id: "application-server", label: "Application → Server", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "application-workstation", label: "Application → Workstation", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "application-password", label: "Application → Password", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "application-vendor", label: "Application → Vendor", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "licence-application", label: "Licence → Application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "firewall-security-doc", label: "Firewall → Security documentation", from: ["configurations"], to: ["documents"] },
  { id: "switch-lan-doc", label: "Switch → LAN documentation", from: ["configurations"], to: ["documents"] },
  { id: "access-point-wireless-doc", label: "Access point → Wireless documentation", from: ["configurations"], to: ["documents"] },
  { id: "backup-protected-configs", label: "Backup service → Protected configurations", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "email-domains-passwords", label: "Email system → Domains & passwords", from: ["flexibleAssets"], to: ["trackers", "domains", "passwords"] },
  // Task 31 — the Email system as a structured service. One specific kind per
  // relation group, so the asset profile can present "Hosting & mail flow",
  // "Mail applications", "Mail domains", "Credentials", "Documents",
  // "Security & filtering", "Vendor", "Licensing" and "Certificates" as labelled
  // buckets rather than one undifferentiated list. (The coarse
  // `email-domains-passwords` kind above is left in place for any links already
  // recorded with it.)
  { id: "email-configuration", label: "Email system → Hosting configuration", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "email-application", label: "Email system → Mail application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "email-domain", label: "Email system → Mail domain", from: ["flexibleAssets"], to: ["domains"] },
  { id: "email-password", label: "Email system → Credential", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "email-document", label: "Email system → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "email-security", label: "Email system → Security platform", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "email-vendor", label: "Email system → Vendor", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "email-certificate", label: "Email system → TLS certificate", from: ["flexibleAssets"], to: ["certificates"] },
  { id: "contact-email", label: "Contact → Email system", from: ["contacts"], to: ["flexibleAssets"] },
  // Task 32 — the Backup service as a structured service. The coarse
  // `backup-protected-configs` kind above already links the service to the
  // configurations it protects; these add the backup application, where copies
  // land, the procedures and recovery documents, the reference checklist, its
  // credentials, its vendor and its responsible people.
  { id: "backup-application", label: "Backup service → Backup application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "backup-storage", label: "Backup service → Backup storage", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "backup-vendor", label: "Backup service → Vendor", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "backup-password", label: "Backup service → Credential", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "backup-document", label: "Backup service → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "backup-procedure", label: "Backup service → Procedure document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "backup-recovery", label: "Backup service → Recovery document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "backup-checklist", label: "Backup service → Reference checklist", from: ["flexibleAssets"], to: ["checklists"] },
  { id: "contact-backup", label: "Contact → Backup service", from: ["contacts"], to: ["flexibleAssets"] },
  // Task 33 — network services (internet/WAN, LAN, wireless). A WAN service
  // links to the edge firewall and security platform that guard it and to the
  // LANs it feeds; a LAN links to its switches and servers and the wireless it
  // serves; a wireless network links to its access-point configurations, its
  // LAN and its security platform.
  { id: "wan-firewall", label: "WAN service → Edge firewall", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "wan-security", label: "WAN service → Security platform", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "wan-vendor", label: "WAN service → Carrier / vendor", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "wan-document", label: "WAN service → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-wan", label: "Contact → WAN service", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "lan-switch", label: "LAN → Switch", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "lan-server", label: "LAN → Server", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "lan-wireless", label: "LAN → Wireless network", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "lan-wan", label: "LAN → WAN service", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "lan-document", label: "LAN → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-lan", label: "Contact → LAN", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "wireless-ap", label: "Wireless → Access point", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "wireless-security", label: "Wireless → Security platform", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "wireless-document", label: "Wireless → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-wireless", label: "Contact → Wireless network", from: ["contacts"], to: ["flexibleAssets"] },
  // Task 40 — resold internet/WAN circuits as structured services. A circuit
  // links to the wholesale/upstream provider it is bought from, the router/CPE
  // that terminates it, the firewall/security that guards it, the LANs it
  // serves, its credentials, its documents and the people responsible; services
  // that run over it (voice, remote access) point back at it.
  { id: "circuit-upstream", label: "Circuit → Upstream / wholesale provider", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "circuit-cpe", label: "Circuit → Router / CPE", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "circuit-security", label: "Circuit → Firewall / security platform", from: ["flexibleAssets"], to: ["configurations", "flexibleAssets"] },
  { id: "circuit-lan", label: "Circuit → LAN served", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "circuit-password", label: "Circuit → Credential", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "circuit-document", label: "Circuit → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-circuit", label: "Contact → Circuit", from: ["contacts"], to: ["flexibleAssets"] },
  // Task 42 — the addressing / DNS / firewall documentation around a resold
  // circuit. The public addresses the circuit hands over resolve to domains and
  // are published under TLS certificates, and remote-access services reach in
  // through it, so those records are linked rather than re-typed.
  { id: "circuit-domain", label: "Circuit → Public domain", from: ["flexibleAssets"], to: ["domains"] },
  { id: "circuit-certificate", label: "Circuit → TLS certificate", from: ["flexibleAssets"], to: ["certificates"] },
  { id: "circuit-remote-access", label: "Circuit → Remote access", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  // Task 34 — the security, remote-access, virtualization, file-sharing and
  // printing services. A security platform links to the configurations, remote
  // access, wireless, WAN and email it protects; remote access links to the
  // configurations behind it, its security, applications, credentials and
  // documents; virtualization links to its hosts, applications, credentials,
  // vendor and documents; file sharing links to its configurations,
  // applications, security, backup, credentials and documents; printing links
  // to the physical device configurations, its supplier and its documents.
  { id: "security-configuration", label: "Security platform → Protected configuration", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "security-application", label: "Security platform → Application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "security-password", label: "Security platform → Credential", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "security-vendor", label: "Security platform → Vendor", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "security-document", label: "Security platform → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-security-platform", label: "Contact → Security platform", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "remote-access-configuration", label: "Remote access → Configuration", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "remote-access-security", label: "Remote access → Security platform", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "remote-access-application", label: "Remote access → Application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "remote-access-password", label: "Remote access → Credential", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "remote-access-document", label: "Remote access → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-remote-access", label: "Contact → Remote access", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "virtualization-host", label: "Virtualization → Host", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "virtualization-application", label: "Virtualization → Application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "virtualization-password", label: "Virtualization → Credential", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "virtualization-vendor", label: "Virtualization → Vendor", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "virtualization-document", label: "Virtualization → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-virtualization", label: "Contact → Virtualization", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "file-sharing-configuration", label: "File sharing → Configuration", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "file-sharing-application", label: "File sharing → Application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "file-sharing-security", label: "File sharing → Security platform", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "file-sharing-password", label: "File sharing → Credential", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "file-sharing-document", label: "File sharing → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-file-sharing", label: "Contact → File sharing", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "printing-configuration", label: "Printing → Device configuration", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "printing-vendor", label: "Printing → Supplier", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "printing-document", label: "Printing → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "contact-printing", label: "Contact → Printing", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "voice-platform", label: "Voice platform → Configurations & vendors", from: ["flexibleAssets"], to: ["configurations", "flexibleAssets"] },
  // Task 36 — the Voice/PBX platform as a structured service. One specific kind
  // per relation group, so the asset profile presents the internet/WAN circuits
  // it runs over, the PBX/SBC configurations, the firewalls/security that guard
  // it, the voice application, its vendor, its administrator credential, the
  // licensing and supporting documents, the build/cut-over checklist and the
  // people responsible. (The coarse `voice-platform` kind above is left in place
  // for any links already recorded with it.)
  { id: "voice-circuit", label: "Voice platform → Internet / WAN circuit", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "voice-configuration", label: "Voice platform → PBX / host configuration", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "voice-sbc", label: "Voice platform → SBC / firewall", from: ["flexibleAssets"], to: ["configurations"] },
  { id: "voice-security", label: "Voice platform → Security platform", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "voice-application", label: "Voice platform → Voice application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "voice-vendor", label: "Voice platform → Vendor", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "voice-password", label: "Voice platform → Credential", from: ["flexibleAssets"], to: ["passwords"] },
  { id: "voice-document", label: "Voice platform → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "voice-checklist", label: "Voice platform → Deployment checklist", from: ["flexibleAssets"], to: ["checklists"] },
  { id: "contact-voice", label: "Contact → Voice platform", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "circuit-firewall", label: "Circuit → Firewall", from: ["trackers"], to: ["configurations"] },
  { id: "contact-owner", label: "Contact → Owned record", from: ["contacts"], to: ["configurations", "flexibleAssets", "documents", "passwords", "trackers", "sites", "diagrams", "domains", "certificates"] },
  { id: "location-record", label: "Location → Located record", from: ["locations"], to: ["configurations", "contacts", "documents", "flexibleAssets", "sites", "diagrams"] },
  // Task 7 — organizations as top-level containers. An organization record can
  // go down to its locations/people/assets/documents, and up to its parent
  // organization (a department or business unit inside the client).
  { id: "organization-location", label: "Organization → Location", from: ["organizations"], to: ["locations"] },
  { id: "organization-parent", label: "Organization → Parent organization", from: ["organizations"], to: ["organizations"] },
  { id: "organization-contact", label: "Organization → Contact", from: ["organizations"], to: ["contacts"] },
  { id: "organization-configuration", label: "Organization → Configuration", from: ["organizations"], to: ["configurations"] },
  { id: "organization-document", label: "Organization → Document", from: ["organizations"], to: ["documents"] },
  { id: "organization-flexible-asset", label: "Organization → Flexible asset", from: ["organizations"], to: ["flexibleAssets"] },
  // Task 8 — responsibility mapping. A contact's role says what it is
  // responsible for; these links connect the contact to the records it is
  // responsible for, so "who owns this?" is one link, visible from both ends.
  { id: "contact-organization", label: "Contact → Organization", from: ["contacts"], to: ["organizations"] },
  { id: "contact-site", label: "Contact → Site", from: ["contacts"], to: ["locations"] },
  { id: "contact-application", label: "Contact → Application", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "contact-configuration", label: "Contact → Configuration", from: ["contacts"], to: ["configurations"] },
  { id: "contact-licence", label: "Contact → Licence / subscription", from: ["contacts"], to: ["flexibleAssets"] },
  { id: "contact-security", label: "Contact → Security system", from: ["contacts"], to: ["configurations", "documents"] },
  { id: "contact-vendor", label: "Contact → Vendor", from: ["contacts"], to: ["flexibleAssets"] },
  // Task 9/10 — configurations. A device lives at a location, has at least one
  // credential, may be hosted on another configuration (a VM on a host), and has
  // a responsible contact.
  { id: "configuration-location", label: "Configuration → Location", from: ["configurations"], to: ["locations"] },
  { id: "configuration-credential", label: "Configuration → Credential", from: ["configurations"], to: ["passwords"] },
  { id: "configuration-hosted-on", label: "Configuration → Hosted on", from: ["configurations"], to: ["configurations"] },
  { id: "configuration-contact", label: "Configuration → Responsible contact", from: ["configurations"], to: ["contacts"] },
  // Task 11 — checklists in the graph. A checklist can be attached to an
  // organization or a site (its home), and can reference the configurations,
  // applications, contacts, documents or runbooks it is about — so a deployment
  // or onboarding checklist is part of the client's linked documentation, not a
  // loose note.
  { id: "organization-checklist", label: "Organization → Checklist", from: ["organizations"], to: ["checklists"] },
  { id: "location-checklist", label: "Location → Checklist", from: ["locations"], to: ["checklists"] },
  { id: "checklist-configuration", label: "Checklist → Configuration", from: ["checklists"], to: ["configurations"] },
  { id: "checklist-application", label: "Checklist → Application", from: ["checklists"], to: ["flexibleAssets"] },
  { id: "checklist-contact", label: "Checklist → Assigned contact", from: ["checklists"], to: ["contacts"] },
  { id: "checklist-document", label: "Checklist → Document", from: ["checklists"], to: ["documents"] },
  { id: "checklist-runbook", label: "Checklist → Runbook", from: ["checklists"], to: ["runbooks"] },
  // Tasks 12–13 — a Flexible Asset references any documented record through one
  // generic kind, since an asset type's fields (and its allowed references) are
  // user-defined. The type-specific link kinds above remain for the Core Assets.
  {
    id: "asset-reference",
    label: "Flexible asset → Referenced record",
    from: ["flexibleAssets"],
    to: ["organizations", "locations", "contacts", "configurations", "passwords", "documents", "checklists", "flexibleAssets", "trackers", "runbooks", "sites", "diagrams", "domains", "certificates"],
  },
  // Tasks 14–16 — the named rich assets. Applications relate to the servers they
  // run on, their owners, their credentials, their vendor, the licence that
  // covers them and their documentation; a licence relates to the applications
  // it covers and its vendor; a vendor relates up to its applications, licences
  // and contacts; a user role relates to its applications, software builds and
  // members; a software build relates to its applications and the roles it
  // applies to. (Every Flexible Asset shares one collection, so these kinds are
  // collection-level; the asset profile groups the far side by template.)
  { id: "application-document", label: "Application → Supporting document", from: ["flexibleAssets"], to: ["documents"] },
  { id: "licence-vendor", label: "Licence → Vendor", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "role-application", label: "User role → Application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "role-build", label: "User role → Software build", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  { id: "role-member", label: "User role → Member", from: ["flexibleAssets"], to: ["contacts"] },
  { id: "build-application", label: "Software build → Application", from: ["flexibleAssets"], to: ["flexibleAssets"] },
  // Tasks 17–19 — credentials in the graph. A general credential is linked to
  // the assets it unlocks (applications and configurations already have their
  // kinds above; organizations, locations and the provider's own records get
  // these), while an EMBEDDED credential is linked to the record it belongs to
  // — the record whose permissions it inherits.
  { id: "password-organization", label: "Password → Organization", from: ["passwords"], to: ["organizations"] },
  { id: "password-location", label: "Password → Location", from: ["passwords"], to: ["locations"] },
  {
    id: "password-embedded-in",
    label: "Embedded credential → Owning record",
    from: ["passwords"],
    to: ["configurations", "flexibleAssets", "organizations", "locations", "documents", "checklists", "trackers", "runbooks", "sites", "diagrams", "domains", "certificates"],
  },
  // Tasks 21–22 — documents in the graph. A document belongs to an organization
  // and is linked to the assets, services and locations it concerns, so "where
  // is this documented?" and "what documents cover this server?" are the same
  // link seen from either end. A checklist generated from a procedure keeps a
  // link back to its source document.
  { id: "document-organization", label: "Document → Organization", from: ["documents"], to: ["organizations"] },
  { id: "document-asset", label: "Document → Asset", from: ["documents"], to: ["configurations", "flexibleAssets", "trackers"] },
  { id: "document-service", label: "Document → Service", from: ["documents"], to: ["flexibleAssets", "runbooks"] },
  { id: "document-location", label: "Document → Location", from: ["documents"], to: ["locations"] },
  { id: "document-checklist", label: "Document → Generated checklist", from: ["documents"], to: ["checklists"] },
  { id: "document-related", label: "Document → Related document", from: ["documents"], to: ["documents"] },
  // Task 23 — sites & diagrams in the graph. A site summary is the structured
  // facility record; it links down to its location, its responsible contacts,
  // the drawings of it and the assets inside it. A diagram links to the site and
  // location it depicts, the assets it shows and any document it accompanies.
  { id: "site-location", label: "Site → Location", from: ["sites"], to: ["locations"] },
  { id: "site-contact", label: "Site → Responsible contact", from: ["sites"], to: ["contacts"] },
  { id: "site-diagram", label: "Site → Diagram", from: ["sites"], to: ["diagrams"] },
  { id: "site-asset", label: "Site → Asset", from: ["sites"], to: ["configurations", "flexibleAssets"] },
  { id: "diagram-location", label: "Diagram → Location", from: ["diagrams"], to: ["locations"] },
  { id: "diagram-asset", label: "Diagram → Depicted asset", from: ["diagrams"], to: ["configurations", "flexibleAssets"] },
  { id: "diagram-document", label: "Diagram → Accompanying document", from: ["diagrams"], to: ["documents"] },
  // Tasks 24–25 — the Domain and SSL trackers in the graph. A domain links to
  // the credentials that manage it and the assets that depend on it; a
  // certificate links to the service it protects (a configuration, flexible
  // asset or domain) and to the private-key credential that must never be
  // inlined. Both inherit the standard contact-owner / asset-reference links.
  { id: "domain-credential", label: "Domain → Managing credential", from: ["domains"], to: ["passwords"] },
  { id: "domain-asset", label: "Domain → Dependent asset", from: ["domains"], to: ["flexibleAssets", "configurations"] },
  { id: "certificate-credential", label: "Certificate → Private-key credential", from: ["certificates"], to: ["passwords"] },
  { id: "certificate-service", label: "Certificate → Protected service", from: ["certificates"], to: ["configurations", "flexibleAssets", "domains"] },
  // Task 37 — deployment runbooks in the graph. A runbook records HOW to stand
  // up a service, so it links to the service it deploys, the site it is
  // performed at, and the configurations, documents and people involved; a
  // checklist can be generated from it (checklist-runbook covers that side).
  { id: "runbook-service", label: "Runbook → Service deployed", from: ["runbooks"], to: ["flexibleAssets"] },
  { id: "runbook-location", label: "Runbook → Deployment site", from: ["runbooks"], to: ["locations"] },
  { id: "runbook-configuration", label: "Runbook → Configuration", from: ["runbooks"], to: ["configurations"] },
  { id: "runbook-document", label: "Runbook → Supporting document", from: ["runbooks"], to: ["documents"] },
  { id: "runbook-contact", label: "Runbook → Responsible contact", from: ["runbooks"], to: ["contacts"] },
  { id: "runbook-organization", label: "Runbook → Organization", from: ["runbooks"], to: ["organizations"] },
  // Task 38 — cutover checklists. A checklist proves the deployment of a
  // service (checklist→service), is performed at a site (checklist→location),
  // and follows the runbook that describes it (checklist-runbook, defined with
  // the task-11 checklist kinds above).
  { id: "checklist-service", label: "Checklist → Service covered", from: ["checklists"], to: ["flexibleAssets"] },
  { id: "checklist-location", label: "Checklist → Site", from: ["checklists"], to: ["locations"] },
];

export const relationshipKind = (id) => RELATIONSHIP_KINDS.find((k) => k.id === id) || null;

export const normalizeRef = (ref) => (ref && ref.type && ref.id ? { type: ref.type, id: ref.id } : null);
export const refKey = (ref) => (ref && ref.type && ref.id ? ref.type + ":" + ref.id : null);
export const sameRef = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id;

export function findRecord(docset, ref) {
  if (!docset || !ref || !ref.type || !ref.id) return null;
  const arr = docset.records && docset.records[ref.type];
  if (!Array.isArray(arr)) return null;
  return arr.find((r) => r.id === ref.id) || null;
}

// Validate a proposed link against the catalog and the current graph.
export function validateLink(docset, { from, to, kind }) {
  const errors = [];
  const k = relationshipKind(kind);
  if (!k) errors.push(`Unknown relationship kind “${kind}”.`);
  const fr = findRecord(docset, from);
  const tr = findRecord(docset, to);
  if (!fr) errors.push("The source of this link does not exist in this documentation set.");
  if (!tr) errors.push("The target of this link does not exist in this documentation set.");
  if (fr && tr && sameRef(from, to)) errors.push("A record cannot be linked to itself.");
  if (k && fr && !k.from.includes(fr.type)) {
    errors.push(`“${k.label}” cannot start from a ${fr.type} record.`);
  }
  if (k && tr && !k.to.includes(tr.type)) {
    errors.push(`“${k.label}” cannot point at a ${tr.type} record.`);
  }
  if (k && fr && tr) {
    const existing = (docset.records.relationships || []).find(
      (r) => r.kind === kind && sameRef(r.from, from) && sameRef(r.to, to),
    );
    if (existing) errors.push(`These two records are already linked with “${k.label}”.`);
  }
  return { ok: errors.length === 0, errors };
}

export function makeRelationship({ from, to, kind, note = "", id, createdBy = "system", now = Date.now() }) {
  return {
    id: id || "rel_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4),
    type: "relationships",
    kind,
    from: normalizeRef(from),
    to: normalizeRef(to),
    note,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// Every link touching `ref`, in both directions. `other` is the record on the
// far side; `direction` says whether `ref` is the link's from ("out") or to
// ("in"). Storing a link once and reporting both directions IS the bidirectional
// consistency guarantee.
export function relationsOf(docset, ref) {
  const key = refKey(ref);
  if (!key) return [];
  const out = [];
  for (const r of (docset && docset.records && docset.records.relationships) || []) {
    if (refKey(r.from) === key) out.push({ relationship: r, direction: "out", other: r.to });
    else if (refKey(r.to) === key) out.push({ relationship: r, direction: "in", other: r.from });
  }
  return out;
}

// The links removed when `ref` is deleted.
export function cascadedRelationships(docset, ref) {
  const key = refKey(ref);
  if (!key) return [];
  return ((docset && docset.records && docset.records.relationships) || []).filter(
    (r) => refKey(r.from) === key || refKey(r.to) === key,
  );
}

// The existing records that could be linked to `ref` with `kindId` (respecting
// the catalog's allowed direction), excluding ones already linked. This is the
// "suggest linking existing records instead" path.
export function suggestLinks(docset, ref, kindId) {
  const k = relationshipKind(kindId);
  if (!k || !ref || !ref.type) return [];
  let side = null;
  if (k.from.includes(ref.type)) side = "from";
  else if (k.to.includes(ref.type)) side = "to";
  if (!side) return [];
  const allowedTypes = side === "from" ? k.to : k.from;
  const key = refKey(ref);
  const already = new Set(
    relationsOf(docset, ref)
      .filter((x) => x.relationship.kind === kindId)
      .map((x) => refKey(x.other)),
  );
  const out = [];
  for (const t of allowedTypes) {
    for (const rec of (docset.records && docset.records[t]) || []) {
      if (sameRef(rec, ref)) continue;
      if (already.has(refKey(rec))) continue;
      out.push(rec);
    }
  }
  return out;
}

// Find a record in `type` whose name matches `name` (case-insensitively) —
// the free-form duplicate this system refuses to create.
export function findDuplicate(docset, { type, name, excludeId }) {
  const n = String(name == null ? "" : name).trim().toLowerCase();
  if (!n || !type) return null;
  const arr = (docset && docset.records && docset.records[type]) || [];
  return arr.find((r) => r.id !== excludeId && String(r.name || "").trim().toLowerCase() === n) || null;
}

// Audit the whole relationship graph of one documentation set.
export function checkIntegrity(docset) {
  const issues = [];
  const rels = (docset && docset.records && docset.records.relationships) || [];
  const seen = new Set();
  for (const r of rels) {
    const k = relationshipKind(r.kind);
    if (!k) {
      issues.push({ level: "error", code: "unknown-kind", relationshipId: r.id, message: `Relationship ${r.id} uses an unknown kind “${r.kind}”.` });
    }
    const fr = findRecord(docset, r.from);
    const tr = findRecord(docset, r.to);
    if (!fr) {
      issues.push({ level: "error", code: "dangling-from", relationshipId: r.id, message: `Relationship ${r.id} starts from a record that no longer exists.` });
    }
    if (!tr) {
      issues.push({ level: "error", code: "dangling-to", relationshipId: r.id, message: `Relationship ${r.id} points at a record that no longer exists.` });
    }
    if (sameRef(r.from, r.to)) {
      issues.push({ level: "error", code: "self-link", relationshipId: r.id, message: `Relationship ${r.id} links a record to itself.` });
    }
    const key = `${r.kind}|${refKey(r.from)}|${refKey(r.to)}`;
    if (seen.has(key)) {
      issues.push({ level: "error", code: "duplicate-link", relationshipId: r.id, message: `Relationship ${r.id} duplicates an existing link.` });
    }
    seen.add(key);
  }
  return { ok: issues.length === 0, issues };
}
