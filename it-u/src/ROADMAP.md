# IT-U — Atomic Build Roadmap

**IT-U** is a client-documentation repository for a **TSP (Technology Solutions
Provider)**, built on the existing perchance documentation framework (versioned
document store + sync/conflict layer + module shell + realtime hub). It records
each client's environment as structured, relationship-linked documentation and
turns those records into the deployment documentation needed to onboard, deploy,
and operate the client's services — including resold VoIP telephony and resold
internet/ISP circuits.

It encodes the working model of a professional IT documentation platform: four
information models (**Core Asset**, **Flexible Asset**, **Document**, and
**integration-managed record**); organizations as top-level containers for
locations, contacts, configurations, passwords, documents, domains/certificates
and flexible assets; standardized Core Assets that cannot be re-shaped; a
customizable Flexible Asset template library; long-form documents, SOPs and
checklists; lifecycle trackers; relationship mapping instead of duplication;
group-based permissions; PSA/RMM synchronization and one-way CSV import; and a
provenance classification on every record. It also participates in the existing
small-business pipeline by publishing documentation and deployment bundles for
the company's AI assistants and knowledge base.

> **Naming note.** The source roadmap document used "MSP". IT-U targets a TSP
> (Technology Solutions Provider); the two are the same model. Task titles below
> use the neutral word "service" where the original said "MSP".

## Working checklist

The **working** backlog is `roadmap.pjs` at the workspace root — a structured
perchance-js checklist with a `done` boolean per task. This file is the durable
copy of the task list (root files are ephemeral across sessions); if
`roadmap.pjs` is missing, re-create it from here. The ticked count and per-task
status are recorded in `roadmap.pjs`.

Status: **58 / 58 complete.**

### Post-roadmap enhancements

Beyond the numbered tasks, the app accretes enhancements that are recorded here
so an empty `roadmap.pjs` never implies the feature is missing:

- **Starter (org) templates** — `src/framework/orgTemplates.js` ships four
  built-in starters (Managed IT client, Hosted voice/VoIP client, Internet/ISP
  circuit client, and a composed Full-service client) offered in the New
  documentation set dialog and the Settings → Templates card. Applying one is a
  single store write (`docs.create({ records, links })`). Validation suite:
  `src/tests/org-templates.test.js`.
- **Contextual help** — every station, station detail view and Settings section
  card carries a "?" button opening help written for that screen (what it is for,
  numbered task steps, key terms, tips, "See also"). Content is the plain-data
  catalog in `src/framework/help.js` (34 entries); the router auto-attaches the
  page button (`attachHelp`) and Settings attaches one per card
  (`attachSectionHelp`). Validation suite: `src/tests/help.test.js`.
- **Ask AI** — next to the "?" button, every station, station detail view and
  Settings section card carries an **Ask AI** pill opening a streaming question
  panel scoped to that screen. The context digest is built by
  `src/framework/ai-context.js` (`buildScreenContext`, 34 keys, bounded and
  secret-free) and the panel + prompt live in `src/framework/ai.js` (`attachAsk`
  / `attachSectionAsk` / `openAsk` / `buildPrompt`), answering through
  `root.generateText`. Validation suite: `src/tests/ask-ai.test.js`.
- **Appearance & themes** — light / dark / system mode plus a theme library and
  a custom-theme editor, driven by CSS custom properties on `<html>`. The engine
  is `src/framework/theme.js` (16 preset themes each expanded into a light and a
  dark palette by `buildPalette`; custom themes edited per colour token and saved
  by name; state persisted and applied before first paint). The header carries a
  sun/moon toggle (the old online-users count pill was removed) and the Settings
  **Appearance & theme** card (`src/modules/theme-view.js`) hosts the full
  controls. Validation suite: `src/tests/theme.test.js`.

## Workflow & execution rules

1. `roadmap.pjs` (root) is the backlog; mark a task `done = true` when it
   completes.
2. The backlog has been approved; implementation proceeds task-by-task in order.
3. Pick ONLY the first task whose `done` is false, in order.
4. Implement that single task, write its validation tests, update `roadmap.pjs`
   to mark it complete, and stop to await review before the next task.

---

## Phase 1: Foundation — Storage Model, Relationships & Sync

1. **[x] App shell & navigation** — Provide the application frame and navigation across the system's stations (Organizations, Assets, Documents, Trackers, Services, Deployments, Search, Linter, Exports, Settings), with consistent empty/loading/error states and layouts that work at phone and desktop widths.
2. **[x] Documentation-set storage** — Treat each client's documentation as one versioned JSON document in the system's own storage namespace holding every record type (organizations, locations, contacts, configurations, passwords, documents, checklists, flexible assets, trackers, relationships, and deployment runbooks) — with a locally cached edit key and a fast local cache so documentation survives across devices and reloads.
3. **[x] Record classification & provenance** — Require every record to carry an information-model classification (Core Asset, Flexible Asset, Document, Integration-managed) and a provenance classification (directly authored, imported once, continuously synchronized, related to another record, linked to an external authoritative source, or stored as an attachment/document), and refuse to save a record without one.
4. **[x] Relationship engine** — Make relationships first-class typed links between records (application → server, application → password, application → vendor, licence → application, firewall → security documentation, switch → LAN documentation, access point → wireless documentation, backup service → protected configurations, email system → domains and passwords, voice platform → configurations and vendors, circuit → firewall, and so on), refuse free-form duplicates of related data, suggest linking existing records instead, and keep links bidirectionally consistent when a record is edited or deleted.
5. **[x] Sync, conflict & backup** — Reconcile every documentation set against its canonical document on startup; when two devices edited it since the last sync, offer keep-mine / keep-theirs / field-level-merge before overwriting; provide one-click full backup (download plus a published backup document) and a validated restore flow; all writes are idempotent.
6. **[x] Capacity, archival, versioning & templates** — Show per-set size against the storage ceiling with guided archival of retired clients or old revisions to a read-only archive; give every documentation set a version history with restore, plus duplicate and save-as-template actions so a proven client documentation structure is reusable.

## Phase 2: Core Assets — Organizations, Locations, People & Hardware

7. **[x] Organizations & locations** — Model organizations as top-level containers representing clients, departments, or business units, and standardized location records (office, branch, site, datacentre, other) that can be related to configurations, contacts, documents, and flexible assets.
8. **[x] Contacts & responsibility mapping** — Store client-contact records (including application owners, vendor reps, and support contacts) and relate them to applications, configurations, sites, licensing, security systems, and vendors.
9. **[x] Configurations** — Model physical and virtual devices as standardized configuration records — servers (physical and virtual), workstations, laptops, firewalls, switches, access points, printers/scanners, displays, cameras, security panels/alarms, backup power supplies, storage devices, and other managed equipment — with attributes for configuration name, type, manufacturer, model, serial number, hostname, IP address, MAC address, physical location, and support/warranty expiry.
10. **[x] Configuration completeness rules** — Enforce a configurable required-field set on configurations (the classic expectation being common name, manufacturer, model, precise location, serial number, MAC address, one or more IP addresses, warranty or support expiry, and at least one associated credential), flag incomplete records as such, and allow an explicit, recorded exception where a field genuinely does not apply.
11. **[x] Checklists** — Provide checklist records as ordered task lists supporting delegation, sharing with assigned personnel, completion tracking, and reuse across clients or deployments.

## Phase 3: Flexible Assets & Template Engine

12. **[x] Flexible asset records & template designer** — Provide customizable structured records for information that does not fit the Core Assets, with a template designer that defines the fields, field types, required fields, and allowed references for each asset type.
13. **[x] Template library & sharing** — Ship a library of prebuilt templates (at minimum Applications, Licensing, and Virtualization, plus the service templates used later in this roadmap), allow templates to be shared globally across organizations, and allow the provider to adapt its own templates to house standards.
14. **[x] Custom structured assets** — Support organization-specific structured types such as user roles (role name, typical tasks, associated software configurations, members, typical workstation tier) and software configurations/builds (build name, supported operating systems, installed applications, applicable user roles, typical workstation tier), and steer users toward structured assets rather than burying structured data in documents.
15. **[x] Applications asset** — Model line-of-business, server, cloud, internal, security, remote-access, and intranet applications, each able to relate to configurations, contacts, passwords, vendors, licensing, and supporting documents.
16. **[x] Vendors, licensing & subscriptions** — Model technology suppliers and service providers, and licensing/subscription records (software licences, Microsoft licensing, third-party subscriptions, entitlements) that link to applications, contacts, vendors, expiry dates, and any associated alerting.

## Phase 4: Credentials & Security Model

17. **[x] Password records — general vs embedded** — Support both general passwords (standalone, linkable to many assets, with their own permissions) and embedded passwords (created in a specific asset's context and inheriting its permissions), storing name, category/type, username or email, password, one-time-password secret, URL, notes, permissions, and related assets for either.
18. **[x] OTP generation** — Generate a six-digit one-time code from a stored Base32 OTP secret, with correct validation of the secret and a clear error when the secret is malformed.
19. **[x] Password generation & rotation hooks** — Provide credential generation from the web interface and record the rotation path for each credential (manual, or via a designated connected password-management product), noting explicitly that rotation capability depends on the connected product and is not guaranteed by the documentation system itself.
20. **[x] Groups, permissions & access model** — Implement groups as the access-control unit, applying permissions at organization, asset, document, general-password, and administrative levels; enforce that embedded passwords inherit their parent's permissions; and authorize every sensitive action in code rather than relying on hidden UI.

## Phase 5: Documents, SOPs, Site Summaries & Diagrams

21. **[x] Document authoring** — Provide long-form documents for procedures and reference material (installation procedures, troubleshooting guides, help-desk instructions, recovery procedures, operational notes, client-specific technical documentation, public-facing instructions) with a seeded set of reusable templates and a rule that procedures a client must follow become checklists where a checklist fits better than prose.
22. **[x] SOPs & deployment procedure documents** — Provide standard-operating-procedure and deployment-instruction documents that can be linked to the assets and services they concern, versioned independently, and stamped with a review date.
23. **[x] Site summaries, diagrams & source files** — Store structured facility/site summary assets and attach or relate site maps, network diagrams, rack diagrams, floor plans, infrastructure images, editable source-file references, and client-facing PDF renditions, keeping the editable source alongside any rendered version.

## Phase 6: Lifecycle Trackers & Expiry Workflows

24. **[x] Domain Tracker** — Capture internet-facing domains, retrieving DNS entries and domain expiration dates where possible, and relate each domain to email systems, applications, passwords, vendors, and other assets.
25. **[x] SSL Tracker** — Capture SSL certificates for internet-facing services, retrieving publicly available certificate details automatically, allowing a private key to be added, and recording certificate-protected service, hostname, public certificate information, and expiry.
26. **[x] Expiry aggregation** — Aggregate every datable item across the documentation set — domain expiry, certificate expiry, licence and subscription expiry, warranty and support dates, and hardware end-of-life where recorded — into one lifecycle view per client and per asset.
27. **[x] Expiry workflow & notification engine** — Turn lifecycle data into actionable workflows (due-soon and overdue queues, owner assignment, escalation, and a record of action taken), with configurable lead times per item type and an exportable renewal schedule.

## Phase 7: Integrations, Import & Synchronization

28. **[x] PSA/RMM synchronization** — Implement integration sync that creates and maintains Core Asset data (at minimum organizations, contacts, and configurations, plus device information) from a connected PSA or RMM, with the exact fields and synchronization direction configurable per integration.
29. **[x] Bulk import** — Support user-initiated, one-way CSV import to populate organizations, contacts, configurations, passwords, and flexible assets, with a column-mapping step, a dry-run validation report, duplicate detection, and a per-row error report instead of silent drops.
30. **[x] Integration-managed record governance** — Protect continuously synchronized records from conflicting local edits — mark which fields are integration-owned, resolve conflicts by rule, surface drift when a local edit would be overwritten, and record for every integration-managed record which external system is authoritative.

## Phase 8: Service Documentation Library

31. **[x] Email-system asset** — Model the client's email infrastructure as a structured service related to configurations, applications, documents, domains, passwords, and other relevant records.
32. **[x] Backup asset** — Model backup platform/service, protected configurations, associated applications, backup procedures, recovery documents, client-specific business rules, and reference checklists, related to configurations, applications, and documents.
33. **[x] Network assets — internet/WAN, LAN, wireless** — Model internet/WAN services (ISP/carrier, circuits, public connectivity, circuit aggregation and details, related to firewalls and security), LAN records (architecture, subnets, IP addressing, internal DNS, VPN network details, cabling, server topology, related to servers/switches), and wireless records (related to access-point configurations, security, and LAN).
34. **[x] Security, remote access, virtualization, file sharing & printing assets** — Model security platforms (antivirus/endpoint, spam filtering, firewalls, VPN security, services, vendors, contacts, related to configurations, remote access, wireless, and WAN), remote access (VPN, webmail, remote-support systems, linked to configurations, security, passwords, applications, documents), virtualization (VMware, Hyper-V, others, related to hosts, virtual servers, applications, and documentation), file sharing/storage (file servers, shared folders, NAS, SAN, DAS, cloud file services, related to configurations, applications, contacts, documents, security), and printing (printers, scanners, plotters, print services and workflows, related to the physical device configurations).
35. **[x] Library content** — Provide an in-application library of service processes and operational topics (articles usable as written or adapted to the provider's own context), cross-linked from the assets and procedures they support.

## Phase 9: VoIP Deployment — Documentation & Runbooks

36. **[x] Voice/PBX asset & service definition** — Model the voice platform as a structured Voice/PBX asset (phone system, PBX platform, voice services, related applications, voice vendors, associated configurations) that relates forward to circuits, firewalls/security, passwords, licensing, contacts, and the number inventory.
37. **[x] VoIP deployment documentation & runbook** — Produce a deployment runbook covering the full build — platform/PBX configuration, dial plan and extensions/ring groups, SIP trunk(s), DID/number inventory and porting status, emergency/911 addressing per site, codec and QoS requirements, firewall/SBC and NAT traversal, failover and redundancy, handset/softphone configuration, and the per-site network readiness checks (VLAN, PoE, bandwidth, latency/jitter limits) — written so a technician who did not design the deployment can execute it.
38. **[x] VoIP deployment checklist & cutover** — Provide a pre-deployment, cutover, and post-cutover checklist (number port verification, inbound/outbound test calls, voicemail, call recording, failover test, emergency-call test, monitoring/alerts, and rollback steps) with completion tracking, assignment, and a recorded acceptance/sign-off.
39. **[x] VoIP relationship & lifecycle coverage** — Ensure the deployment's documentation is fully linked and lifecycle-aware — every handset/PBX/SBC as a configuration, every credential as a password (embedded where it belongs to a device), every trunk as an internet/WAN circuit relationship, every subscription through licensing, every vendor through the vendors asset, and every number/port date and support entitlement captured in the trackers.

## Phase 10: Internet & ISP Reselling — Documentation & Deployment

40. **[x] Internet/WAN circuit asset & reseller service definition** — Model resold internet service as a structured Internet/WAN asset that records the underlying wholesale/upstream carrier or ISP, circuit type and access technology, committed vs burst bandwidth, static IP allocation and subnet(s), router/CPE, SLA/targets, contract term, and the reseller's own service definition and pricing tier.
41. **[x] Provisioning & activation workflow documentation** — Produce a deployment runbook for bringing a resold circuit live — order capture, upstream carrier handoff, CPE selection and configuration, IP addressing and reverse DNS, firewall and routing changes, service activation, connectivity and throughput testing, redundancy/failover across multiple circuits, and customer acceptance — with each step mapped to the records it updates.
42. **[x] CPE, addressing & firewall relationship documentation** — Document customer-premises equipment, IP addressing and subnet allocation, DNS/reverse-DNS assignment, VLAN/segmentation, and the firewall relationship for each resold circuit, and keep the circuit's public addressing linked to the domain and SSL trackers, security assets, and remote-access records that depend on it.
43. **[x] Reseller billing, usage & data-cap documentation** — Document the reseller commercial model per circuit and per client — upstream cost versus sell price, billing cycle and proration, data caps/quotas and overage treatment, usage monitoring and reporting sources, and a reconciliation view that flags circuits whose consumption or cost has drifted from the sold plan.
44. **[x] Circuit cutover, migration & decommission runbook** — Produce migration and decommission runbooks for resold circuits (carrier change, bandwidth upgrade, address renumbering, customer offboarding) including impact assessment on dependent services, a cutover checklist, rollback, and the records that must be updated or archived when the circuit ends.

## Phase 11: Search, Completeness & Linter

45. **[x] Search & relationship navigation** — Provide fast search across all records with filters by classification, client, type, lifecycle status, and expiry window, plus a relationship graph/traversal view so a user can move from an application to its server, credentials, vendor, licence, and supporting documentation without knowing where any of it lives.
46. **[x] Completeness & quality linter** — Audit the documentation set for configuration records missing required fields, assets with no relationships, documents duplicating structured data, clients with no surface/relationship coverage for known services, expired or imminent-expiry items, and stale records; report each finding with the record it concerns.
47. **[x] Storage-model audit** — Detect information stored in the wrong model — structured data buried in free-text documents (or vice versa), records that should be Flexible Assets being kept as notes, and duplicated values that should have been relationships — and propose the correct home and links for each finding.
48. **[x] Linter report & one-click fixes** — Save and export a linter report by severity with one-click fixes that apply the suggested change (add the missing field, create the link, convert the document section into a structured asset) and re-run the audit.

## Phase 12: Exports, Publication, Field Access & Quality

49. **[x] Bundle publication to shared bus and knowledge base** — Publish documentation and deployment bundles in the shared envelope format for the company's AI assistants and knowledge base, with a strict default-deny posture that keeps credential material and private keys out of published bundles unless the user explicitly includes a redacted summary, and an export log showing what was published when.
50. **[x] Exports & printable packets** — Export a client documentation packet (per-client summary, inventory, services, relationships, lifecycle/renewal schedule, and open exceptions) and a deployment packet (the VoIP and internet/ISP runbooks and checklists for a specific site or service), as hosted downloadable files and printable views.
51. **[x] Field access & responsive UI** — Make records and runbooks usable in the field — mobile-friendly views, quick search, checklist ticking, and offline-tolerant edits that reconcile when connectivity returns — and verify layouts at phone and desktop widths.
52. **[x] Integrity checks & fixture suite** — Run automated integrity checks — every record has a classification, every relationship target exists and is consistent both ways, every required-field rule is enforced, no orphan records, no credentials leaked into non-credential exports, and every export parses — plus fixture documentation sets covering all four information models, the integration-managed and imported cases, and older schema versions.
53. **[x] README & playbook** — Document the architecture, the information model it implements (Core vs Flexible Asset vs Document vs integration-managed record), the provenance classifications, the relationship conventions, how the VoIP and internet/ISP deployment documentation is assembled and used, the publication envelope and its redaction rules, and the checklist for adding a new asset type, template, service runbook, or export.

## Phase 13: Optional — Multi-User & Realtime Collaboration

54. **[x] Role & access model** — Roles (viewer / technician / administrator) scoped per client and per service — viewers read documentation, technicians edit the records and runbooks they are assigned, administrators manage templates, groups, and publication — with every action authorized server-side rather than only hidden in the UI.
55. **[x] Realtime hub & collaborative editing** — An optional companion hub broadcasts per-client change events so open sessions update within seconds, with two technicians editing the same runbook or record seeing each other's changes live with a marker and inline conflict resolution, degrading gracefully to polling refresh when the hub is unreachable.
56. **[x] Multi-user audit & rate control** — Users authenticate to the hub with their role, connections are rate-limited and grouped by coarse network signals against abuse, and every remote change flows through the same idempotent version-checked document layer so the documentation history records the true actor.
57. **[x] Status station — live service health** — A dedicated Status station reads the live state of every service IT-U depends on (connection, cloud store, realtime hub and synchronization) with the actions that act on each; the crowded header Online/Cloud pills were removed so the chrome stays clean.
58. **[x] Identity provider (SSO)** — Sign in with Microsoft Entra ID, Okta, Auth0, Google or any OIDC directory as an OIDC public client (Authorization Code + PKCE, no client secret), with the server verifying each ID token's signature, issuer, audience, expiry and nonce against the provider's public JWKS; directory groups map through wildcard rules to scoped IT-U roles that replace the user's grants on every sign-in; a built-in, role-free simulator exercises the real verification path offline; and a local password account is never silently taken over by a directory identity of the same name.
