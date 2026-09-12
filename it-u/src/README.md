# IT-U — TSP Client Documentation

**IT-U** is a client-documentation repository for a **TSP (Technology Solutions
Provider)**, built on the perchance documentation framework below (versioned
document store + sync/conflict layer + module shell + realtime hub). It records
each client's environment as structured, relationship-linked documentation —
organizations, locations, contacts, configurations, credentials, flexible assets,
documents/runbooks and lifecycle trackers — and turns those records into the
deployment documentation needed to onboard, deploy, and operate the client's
services, including resold VoIP telephony and resold internet/ISP circuits.
Documentation and deployment bundles are published in the shared envelope format
for the company's AI assistants and knowledge base.

> The sections below document the **reusable framework** the app is built on
> (originally a knowledge base / SOP system). They remain accurate for the store,
> sync, module shell and hub code in `src/`. The IT-U *content model* — the four
> information models, the record types, the relationship conventions, the
> deployment runbooks and the publication envelope — is documented right here,
> and its contributor playbook lives in **`src/PLAYBOOK.md`** (generated from
> `src/framework/playbook.js`, shown in-app under **Settings → Playbook &
> reference**).

## The IT-U content model

IT-U records every client's environment as **structured, relationship-linked
records** inside one versioned document per client (a *documentation set*), then
turns those records into the deployment documentation needed to onboard, deploy
and operate the client's services. The model has four pieces: the information
model, provenance, relationships, and the deployment/publish flow.

### The four information models

| Model | `informationModel` | What it is |
| --- | --- | --- |
| **Core Asset** | `core-asset` | A standardized, IT-U-defined record shape the user fills in — organizations, locations, contacts, configurations, passwords, trackers, domains and certificates. |
| **Flexible Asset** | `flexible-asset` | A customizable structured record shaped by a template in the **one shared** asset-type library ([`flexibleTypes.js`](./framework/flexibleTypes.js)) — applications, licensing, email, backup, network, security, remote access, voice/PBX, and the resold internet/WAN circuit. |
| **Document** | `document` | Long-form authoring with revisions and review: documents, SOPs, checklists, site summaries, diagrams and **deployment runbooks**. |
| **Integration-managed** | `integration` | A record kept in step by an external system of record (PSA/RMM/ISP/voice platform). |

Which model a record belongs to decides how it is authored — a form, a template,
long-form prose, or nothing at all (an upstream system owns it). The choice is
enforced on save; see [`classification.js`](./framework/classification.js).

### Provenance

Every entity record also carries a **provenance** describing where its content
came from and how it is kept: *directly authored*, *imported once*,
*continuously synchronized*, *related to another record*, *linked to an external
authoritative source*, or *stored as an attachment*. A provenance may require
extra origin detail (a synchronized record must name the system that syncs it),
declared in [`classification.js`](./framework/classification.js) and enforced on
save. Relationship links are the one exempt record type — they carry
`from`/`to`/`kind` rather than content.

### Relationships — express a fact once

A relationship is a **first-class typed link** stored in `records.relationships`
as `{ id, type: "relationships", kind, from: { type, id }, to: { type, id } }`.
The point is that "application → server", "licence → application",
"circuit → firewall" and friends are expressed **once** and stay consistent —
never by re-typing the same fact into two records. The catalog
([`relationships.js`](./framework/relationships.js)) declares, per kind, which
collections a link may connect; the engine refuses duplicates and self-links,
reports a record's links in **both** directions (`relationsOf`), cascades links
away with a deleted record, and audits the whole graph (`checkIntegrity`).
[`assetRelations.js`](./framework/assetRelations.js) layers labelled groups
("Servers & workstations", "Credentials", "Vendor", …) on top so the asset
profile is navigable. The catalog currently declares ~150 kinds.

### Deployment documentation

Resold **VoIP telephony** and resold **internet/ISP circuits** are modelled as
Flexible Assets (voice/PBX, WAN circuit). Each is turned into deployable
documentation by the same five-stage flow: model the service → assemble the
**runbook** ([`runbook.js`](./framework/runbook.js) `RUNBOOK_TYPES` +
`generateVoipRunbook`) → pair it with a phased **cutover checklist**
([`cutover.js`](./framework/cutover.js)) → **cover the links and lifecycle**
([`voipCoverage.js`](./framework/voipCoverage.js), [`lifecycle.js`](./framework/lifecycle.js))
→ **publish** it as a printable packet or a machine-readable bundle.

### The publication envelope & redaction

`publication.js` emits one shared envelope (`itu-publication/1`, kind
`itu-knowledge-bundle`) holding `records`, `relationships` and `sections` for the
company's AI assistants and knowledge base. Redaction is **default-deny**:
credential records are omitted entirely unless the operator opts into a
metadata-only summary; `secret`/`otpSecret` are never written; prose is scrubbed
of PEM blocks, `otpauth://…secret=…` parameters and labelled secrets; a
relationship survives only when both endpoints do; and `validatePublication`
refuses any leaky bundle. `packet.js` renders the same data as a human packet
(markdown, on-screen HTML, and a self-contained printable HTML).

**Adding to the model** — a new asset type, template, service runbook or export —
follows a checklist: see [`src/PLAYBOOK.md`](./PLAYBOOK.md) (or the in-app
Settings card). The playbook is generated from
[`playbook.js`](./framework/playbook.js) and checked against the live catalogs by
`src/tests/playbook.test.js`, so it cannot silently drift from the code.

## Build tracking

The build follows the atomic roadmap IT-U is being implemented against:

- **`roadmap.pjs` at the workspace root** — the *working* backlog: a structured
  56-task checklist across 13 phases, with a `done` flag per task.
- **`src/ROADMAP.md`** — the *durable* copy of the same checklist, with the full
  task descriptions and the workflow rules.
- **`src/PLAYBOOK.md`** — the generated contributor playbook (task 53): the
  content model and the extension checklists, rendered from
  `src/framework/playbook.js` into the app's Settings → Playbook & reference card.

Work proceeds ONE task at a time, strictly in order: pick the first task whose
`done` is false, implement it, write its validation tests, mark it done in
`roadmap.pjs`, then stop for review. Root files are ephemeral across sessions, so
if `roadmap.pjs` is missing, re-create it from `src/ROADMAP.md`.

**Status: 58/58 complete** (task 1 — app shell & navigation; task 2 —
documentation-set storage; task 3 — record classification & provenance; task 4 —
relationship engine; task 5 — sync, conflict & backup; task 6 — capacity,
archival, versioning & templates; task 7 — organizations & locations; task 8 —
contacts & responsibility mapping; task 9 — configurations; task 10 —
configuration completeness rules; task 11 — checklists; task 12 — flexible asset
records & template designer; task 13 — template library & sharing; task 14 —
custom structured assets; task 15 — applications asset; task 16 — vendors,
licensing & subscriptions; task 17 — password records, general vs embedded;
task 18 — OTP generation; task 19 — password generation & rotation hooks;
task 20 — groups, permissions & access model; task 21 — document authoring;
task 22 — SOPs & deployment procedure documents; task 23 — site summaries,
diagrams & source files; task 24 — the Domain Tracker; task 25 — the SSL
Tracker; task 26 — expiry aggregation; task 27 — the expiry workflow &
notification engine; task 28 — PSA/RMM synchronization; task 29 — bulk import;
task 30 — integration-managed record governance; task 31 — the Email-system
asset; task 32 — the Backup asset; task 33 — the network assets (internet/WAN,
LAN and wireless); task 34 — the security, remote-access, virtualization,
file-sharing and printing assets; task 35 — library content; task 36 — the
Voice/PBX asset & service definition; task 37 — VoIP deployment documentation &
runbook; task 38 — VoIP deployment checklist & cutover; task 39 — VoIP
relationship & lifecycle coverage; task 40 — the Internet/WAN circuit & reseller
service definition; task 41 — the circuit provisioning & activation runbook;
task 42 — the circuit CPE, addressing & firewall documentation; task 43 — the
reseller billing, usage & data-cap documentation; task 44 — the circuit cutover,
migration & decommission runbooks; task 45 — search & relationship
navigation; task 46 — completeness & quality linter; task 47 — storage-model
audit; task 48 — linter report & one-click fixes; task 49 — bundle publication to
the shared bus & knowledge base; task 50 — exports & printable packets;
task 51 — field access & responsive UI; task 52 — integrity checks & fixture
suite; task 53 — README & playbook; task 54 — role & access model; task 55 —
realtime hub & collaborative editing; task 56 — multi-user audit & rate
control; task 57 — the Status station & retiring the header pills; task 58 —
identity provider / SSO with Entra ID and any OIDC directory). IT-U boots
its own fourteen-station shell — Organizations, Assets, Documents, Trackers,
Services, Library, Deployments, Integrations, Import, Search, Linter, Exports, Settings, Status — on top
of the reusable framework
(document store, sync, module shell, realtime hub).

The **Organizations** station is the first real working surface: each client is
one versioned documentation set (one JSON document holding every record type),
records carry an information-model + provenance classification (saving an
unclassified record is refused), and records are joined by first-class typed
relationships (duplicate free-form records are refused with a suggestion to link
instead; links are bidirectionally visible and cascade away with a deleted
record). The **Settings** station is the second: it hosts storage & sync
controls, the conflict queue with a field-level diff and merge, per-set capacity
against the storage ceiling, full backup (download + published editable file)
with validated restore, and the saved-template library. Organizations and
locations are now **standardized records**: an organization must declare a kind
(client / department / business unit) and a location must declare one of the
fixed location types (office / branch / site / datacentre / other), with the rest
of their fields captured by a schema the add-record dialog renders; sets can be
archived (read-only), versioned (history + restore), duplicated and saved as
templates. Contacts and configurations are standardized the same way — a contact
must declare one of thirteen roles (client-primary through vendor/support/
escalation); a configuration must declare one of fifteen device types (physical/
virtual server through UPS and storage) — with the schema driving both the add
and edit dialogs. Configurations carry the classic attribute set (manufacturer,
model, serial, hostname, IPs, MAC, location, support/warranty expiry) and are
audited against a **per-set, configurable completeness rule set**: incomplete
configurations are flagged (an "Incomplete · N" badge + a completeness strip on
the set view), never blocked, and a field that genuinely does not apply can
carry an explicit recorded exception (who / why / when). The **Documents**
station is the third working surface: each set's documents are authored in
markdown with a live preview and a per-type seeded template, governed by a
document type + review cadence, versioned independently of the set (every save
appends a revision; restore writes a new one), linked to the organizations,
assets, services and locations they concern, and — where a procedural body fits
a checklist better than prose — convertible into a linked checklist. Task 23 adds
**site summaries and diagrams**: a structured facility record, and diagram
records that keep each drawing's editable source alongside its rendered
versions. Tasks 24–25 make the **Trackers** station a real surface — the Domain
Tracker and the SSL Tracker, each with a best-effort live lookup (DNS-over-HTTPS
+ RDAP for a domain, the Certificate Transparency logs for a certificate) and a
renewal outlook. Tasks 26–27 turn the same Trackers station into a full
**lifecycle** surface: every dated item in a client's set (domain registration,
certificate, licence/subscription, warranty/support, hardware end-of-life, plus
flexible-asset renewal dates and document review dates) is aggregated into one
view — attention queues (due-soon / overdue), owner assignment, escalation, a
per-asset roll-up and an exportable renewal schedule. Task 28 adds PSA/RMM
**integration sync**: a connected PSA or RMM is defined as an integration on the
set (kind, match-on, per-entity direction and field maps), and a sync reconciles
remote records into integration-managed Core Asset data — organizations, contacts
and configurations — adopting or updating in place rather than duplicating. The
remaining stations (services, deployments, linter, exports)
are still scaffolds (description + "planned
capabilities" list + empty state) that later phases fill in. The KB/SOP *content
model* described further below has been removed; those sections now serve only as
a record of the framework it was built on, and will be replaced as the IT-U
content model is built task by task.

Task 29 adds a **Bulk Import** station — user-initiated, one-way CSV import
into a set. The pure engine `src/framework/importer.js` parses RFC-4180 CSV
(quotes, embedded delimiters/newlines, doubled quotes, CRLF, BOM, delimiter
auto-detection), auto-maps headers to a target's fields by key/label/alias/fuzzy
match, and builds a **dry-run plan** that classifies every row as
ready / duplicate / invalid / empty with per-row errors and the resolved
candidate. Five targets are supported — organizations, contacts,
configurations, passwords and flexible assets — with select values resolved
label→id and `record`-type fields resolved by id/name against existing records.
`docsets.js` gains `importRecords(id, {target, plan, source, allowDuplicates})`
(commits ready rows in one mutation, reports duplicates as skipped, logs to the
set's import history) and `importHistory(id)`. The station drives a four-step
wizard: pick a target (+ template for flexible assets), paste/upload a CSV,
review the auto-mapped columns (editable), then review the dry-run KPIs and the
per-row attention report before importing. Sample data and a download-template
button make it testable without a real file.

Task 30 adds **integration-managed record governance**. A pulled field is
*integration-owned*, and the integration definition gains a `conflictPolicy`
(`external` / `local` / `flag` / `newest`, overridable per entity). Every
managed record stamps `origin.authority` (the external system that is
authoritative for it) and `origin.synced` — the value baseline the sync last
wrote. Re-syncing now tells the three cases apart: an external change with an
untouched local value applies cleanly; an unchanged external value never
clobbers a local edit; and a local edit colliding with an external change is
resolved by the policy (external overwrites and records drift; local keeps the
edit and queues a push-back; hold raises an open conflict; newest compares
update times). Conflicts are recorded on the record (`syncConflicts`) and rolled
up by `governanceOverview` into the Integrations station's **Record governance**
section — KPIs, per-record owned fields, drift, and open conflicts with a
resolution dialog (keep external / keep local, per field or all). The
docs-service methods are `integrationGovernance`, `recordGovernanceOf` and
`resolveIntegrationConflict`.

Task 31 adds the **Email-system asset** — the client's email infrastructure
modelled as a structured service. The shared vocabulary lives in
`src/framework/email.js`: the platform catalog (Microsoft 365, Exchange hybrid
and on-premises, Google Workspace, Zimbra, MDaemon, hosted IMAP), the deployment
models (cloud / hybrid / on-premises / hosted), the email-authentication
mechanisms (SPF, DKIM, DMARC, MTA-STS, TLS-RPT, ARC, BIMI), the archiving modes
and the migration states — each with option builders the template and the
designer draw on. The shipped `atype-email-system` template is rebuilt around
them: platform and deployment, tenant, primary + accepted domains, mailbox and
seat counts, mail flow/connectors, MX record, authentication posture, spam
filtering, archiving, distribution lists, admin/support URLs, and five
record-reference fields (host configuration, mail application, primary domain
record, administrator credential, vendor). Typed `email-*` relationship kinds and
a labelled `RELATION_GROUPS` entry give the asset profile ten groups — Hosting &
mail flow, Mail applications, Mail domains, Credentials, Documents, Security &
filtering, Vendor, Licensing, TLS certificates and Owner & contacts — so the
mail service's dependencies are navigable from the record itself. `emailCoverage`
reports which groups are linked and `emailSystemIssues` audits completeness; the
Linter folds that audit in (`standardizedIssues`), flagging a service with no
platform, no mail domain, no hosting configuration or no administrator
credential. `domains` was added to the referenceable record collections so a
template can point at (and reference) the Domain tracker.

Tasks 32–34 extend the same structured-service pattern to the rest of the
service library:

- **Task 32 — Backup service.** `src/framework/backup.js` holds the backup
  vocabulary (architectures, deployment models, destinations with an `offsite`
  flag, schedules, restore-test results) and the completeness audit. The
  `atype-backup-service` template is rebuilt around it — what the backup
  protects, its architecture/deployment/destinations, schedule and RPO/RTO and
  retention, encryption/immutability/off-site flags, the protected systems and
  data volume, the last restore test and its result, client business rules and
  the procedure/recovery notes, plus record references to the backup
  application, host, storage, vendor, credential, recovery/procedure documents
  and the reference checklist. Nine `backup-*` relationship kinds and nine
  labelled groups make it navigable; `backupCoverage` and `backupIssues` report
  and audit it.
- **Task 33 — Network assets (internet/WAN, LAN, wireless).** `src/framework/network.js`
  holds the WAN service kinds, circuit types, LAN architectures and cabling,
  wireless standards, security modes (with `isSecureWirelessMode`), auth methods
  and bands. The coarse `atype-network-service` template is replaced by three
  shipped templates — `atype-wan-service`, `atype-lan` and `atype-wireless` —
  each with its record-reference fields, its `RELATION_GROUPS` and its audit
  (`wanServiceIssues`, `lanIssues`, `wirelessIssues`, combined by
  `networkServiceIssues`). WAN services link to their edge firewalls, security
  and carrier and the LANs they feed; LANs to their switches, servers and
  wireless networks; wireless to its access points, LAN and security.
- **Task 34 — Security, remote access, virtualization, file sharing & printing.**
  `src/framework/serviceAssets.js` holds the security-platform types and
  deployment models, remote-access methods, virtualization platforms,
  file-storage types and protocols, and printing device types and print service
  models, plus five completeness audits and their combination
  `serviceAssetIssues`. The five templates (`atype-security-platform`,
  `atype-remote-access`, `atype-virtualization`, `atype-file-sharing`,
  `atype-printing`) are rebuilt around them, and a `security-*`/`remote-access-*`/
  `virtualization-*`/`file-sharing-*`/`printing-*`/`contact-*` set of relationship
  kinds with labelled `RELATION_GROUPS` gives each record its profile buckets — a
  security platform groups everything it protects (configurations, remote access,
  wireless, WAN, email, file sharing) alongside its applications, credentials,
  vendor, licensing and documents.
- **Task 36 — Voice/PBX asset & service definition.** `src/framework/voice.js`
  holds the voice vocabulary — the platform catalog (Teams Phone, RingCentral,
  3CX, FreePBX, on-premises PBX, …), deployment models, trunk types, SIP
  transports, codecs, the voice services delivered, number types, porting
  statuses (with `isPortComplete`), emergency services (with
  `isEmergencyConfigured`) and endpoint types — plus `voiceCoverage` and the
  `voicePlatformIssues` audit (folded into the linter by `standardizedIssues`).
  The shipped `atype-voice-pbx` template (category *applications*, the `phone`
  icon) is rebuilt around them: 31 fields covering platform/product/deployment,
  provider/tenant/extension/handset/channel counts, SIP domain and trunking,
  codecs, the services delivered, emergency calling and its dispatchable
  location, the number inventory and porting status/date, failover and QoS
  notes, and record references to the PBX/host and SBC/firewall configurations,
  the security platform, the voice application, the internet/WAN circuit, the
  voice vendor, the administrator credential and the deployment checklist. Ten
  new relationship kinds (`voice-circuit`, `voice-configuration`, `voice-sbc`,
  `voice-security`, `voice-application`, `voice-vendor`, `voice-password`,
  `voice-document`, `voice-checklist`, `contact-voice`) and the
  `RELATION_GROUPS["atype-voice-pbx"]` buckets make the profile navigable under
  *Internet/WAN circuits*, *PBX/host configuration*, *SBC/firewall*, *Security*,
  *Voice applications*, *Vendor*, *Credentials*, *Licensing & subscriptions*,
  *Documents*, *Deployment checklists* and *Owner & contacts*. Tests:
  `src/tests/voice.test.js` (7).

**Task 37 — VoIP deployment documentation & runbook.** `src/framework/runbook.js`
is the runbook model and the VoIP runbook generator. A runbook is a long-form,
versioned operational document attached to a client set: `RUNBOOK_TYPES` /
`runbookType` / `runbookTypeLabel` / `runbookTypeOptions` classify it
(service-deployment, cutover, migration, decommission, maintenance, recovery,
other) and `RUNBOOK_GROUPS` buckets a record's links. Statuses
(`RUNBOOK_STATUSES` / `runbookStatus` / `runbookStatusLabel` /
`runbookStatusOptions`) run draft → in-review → approved → published →
superseded → archived, and `RUNBOOK_FIELDS` is what `validateRunbook` /
`requireRunbook` enforce (a known type, a non-empty body, a unique name within
the set). Revision history is capped at `RUNBOOK_HISTORY_MAX = 25`:
`runbookRevision` snapshots a record, `normalizeRunbookTags` folds tags,
`makeRunbookRevision` builds a history entry (by/at/note/body/summary), and
`runbookVersionList` renders v-numbered entries for the editor's restore list;
`runbookReviewStatus` reports the review-due state and `runbookDetailLine` is
the one-line summary shown in lists.

VoIP runbooks are **generated** rather than hand-written: `VOIP_RUNBOOK_SECTIONS`
declares the 16 sections of a deployment runbook (13 required — overview,
prerequisites, platform/PBX configuration, dial plan, SIP trunk(s), DID/number
inventory & porting, emergency calling, codecs & QoS, firewall/SBC/NAT,
failover & redundancy, handsets, per-site network readiness, cutover, and
roles/sign-off), and `generateVoipRunbook({voice, set, site, preparedBy, title,
now})` fills each from a Voice/PBX asset's fields and the records it links to
(configurations, circuit, vendor, contacts, locations, credentials), returning
`{name, summary, body, runbookType, service, site, sections, warnings,
generatedAt}`. `voipRunbookCoverage` reports which sections are present and
which are gaps; `voipRunbookIssues` / `runbookIssues` audit a generated runbook
(required sections missing, an unreadable service link, …) and feed the linter
via `standardizedIssues`. The **document store** (`src/framework/docsets.js`)
gains `addRunbook` / `saveRunbook` / `runbookRevisions` /
`restoreRunbookRevision` / `markRunbookReviewed`; adding a runbook defaults it
to a draft v1.0 revision and auto-links its `runbook-service` reference to the
voice asset it documents. `src/framework/relationships.js` adds six runbook
kinds (`runbook-service`, `runbook-location`, `runbook-configuration`,
`runbook-document`, `runbook-contact`, `runbook-organization`) and
`assetRelations.js` gives the Voice/PBX type a *Runbooks* group. The
**Deployments** station (`src/modules/deployments.js`) lists docsets, and its
set detail groups runbooks by type with status/version/review chips and Open /
Remove actions, offering **+ Generate VoIP runbook** (when the set holds a
Voice/PBX asset) and **+ New runbook**; both open the runbook editor
(`src/modules/runbook-view.js`) — header badges, the field set, a body textarea
with markdown preview, the VoIP *Deployment coverage* chips with a regenerate
action, the linked-record block and the revision restore list. Tests:
`src/tests/runbook.test.js` (9).

**Task 38 — VoIP deployment checklist & cutover.** `src/framework/cutover.js` is
the cutover-checklist model and the VoIP cutover generator. Where task 37's
runbook is the *written* build (what to do), a cutover checklist is the
*driven and proofed* switch: an ordinary checklist record (task 11 shape) whose
steps carry a `phase` id and, for the verifications that must be proven, a
`check` id. `CUTOVER_PHASES` / `cutoverPhase` / `cutoverPhaseLabel` /
`cutoverPhaseOptions` declare the three acts — **Pre-deployment**, **Cutover**
and **Post-cutover**; `CUTOVER_CHECKS` / `cutoverCheck` / `cutoverCheckLabel`
declare the nine required verifications task 38 names (number-port,
inbound-calls, outbound-calls, emergency-calls, voicemail, call-recording,
failover, monitoring, rollback), each mapped to its phase. `VOIP_CUTOVER_TEMPLATE`
is the shipped 22-step template (9 pre / 6 live / 7 post) with a `hint` on every
step saying what "verified" means.

`generateVoipCutoverChecklist({voice, set, site, assignee, preparedBy, title,
now})` reads the Voice/PBX asset's fields (platform, porting status, emergency
configuration) and returns a checklist input ready for `docs.addChecklist()` —
with `phases`, phased `items`, a pending `signOff`, the auto-link `service` /
`site` refs, and `warnings` for the gaps it finds (missing emergency
configuration, an in-flight number port, no site chosen). `voipCutoverCoverage`
reports which of the nine required checks a record contains
(`{total, present, missing, complete, percent, byCheck}`) and
`cutoverPhaseProgress` rolls a checklist up per phase (plus an `other` bucket for
unphased steps). Acceptance is modelled by `CUTOVER_DECISIONS` (`pending`,
`accepted`, `accepted-with-issues`, `rejected`, each with a tone),
`makeCutoverSignOff` / `validateCutoverSignOff` / `cutoverSignOff` /
`cutoverAcceptanceLine` / `cutoverAcceptanceTone`; recording any non-pending
decision requires the name of who accepted it. `isCutoverChecklist` recognises a
cutover record, `cutoverIssues(set)` is the integrity audit (a missing required
verification, a malformed sign-off, a fully-ticked-but-unsigned cutover, a
rejected-but-unresolved cutover) folded into `standardizedIssues`, and
`formatCutoverText(record, {set, site})` renders the phase-grouped sharing text.

The **document store** (`src/framework/docsets.js`) gains `addChecklist(id,
input, opts)` (shapes and stores a generated checklist, preserving the extra
`phase`/`check`/`hint` step fields via `normalizeChecklistStep`, de-duplicating
the name and auto-linking the `checklist-service` reference), `signOffChecklist`
and `clearChecklistSignOff`. `src/framework/relationships.js` adds
`checklist-service` and `checklist-location` (reusing the task-11
`checklist-runbook`), and `recordDetailLine` appends the acceptance line to a
cutover checklist's details. The **Deployments** station
(`src/modules/deployments.js`) now also lists the set's checklists in a *Cutover
& deployment checklists* section — progress bar, coverage chip
(`present/total`, "ok" when complete) and an acceptance chip — and offers
**+ Generate cutover checklist** (when the set holds a Voice/PBX asset) alongside
**+ New checklist**. The checklist editor (`src/modules/checklist-view.js`)
renders a cutover record phase-grouped with per-phase counts and step hints, adds
a phase picker for new steps, shows an **Acceptance & sign-off** panel (decision,
accepted-by, notes, "Save acceptance" → `docs.signOffChecklist`), and uses
`formatCutoverText` for "Copy as text". Tests: `src/tests/cutover.test.js` (9).

**Task 39 — VoIP relationship & lifecycle coverage.** `src/framework/voipCoverage.js`
is the coverage guarantee. Task 36 describes the Voice/PBX asset itself, task 37
writes the runbook and task 38 drives the switch; task 39 asks whether the *whole
deployment* is linked and lifecycle-aware. `VOIP_COVERAGE_GROUPS` declares the two
faces — **Relationships** and **Lifecycle** — and `VOIP_COVERAGE_REQUIREMENTS` the
thirteen requirements (ten relationship, three lifecycle; ten required, three
recommended). Each relationship requirement is satisfied by a typed relationship
(`kinds`, optionally bounded by `direction`, `collections`, `filterTypes`) **or**
by a record-field reference on the voice asset (`fieldKeys`), so a platform wired
by field rather than link still counts; `voipRequirementRecords` resolves both and
`voipRelationshipCoverage` reports each requirement met/unmet with the records
found. `voipLifecycleCoverage` checks the three lifecycle requirements —
number/port (a recorded `portDate`, or an explicit completed porting status),
support entitlement (a linked configuration's support/warranty expiry, or a
licence renewal date) and subscription expiry (a linked licence's renewal date);
`voipLifecycleItems` filters the task-26 lifecycle extraction down to the
deployment's own records so the new `number-port` kind and the standard
support/licence kinds all appear. `voipDeploymentCoverage` combines both into the
report the UI renders (per-group requirements plus `requiredMet` / `requiredTotal`
/ `complete` / `percent` / `missing`). `voipCoverageIssues` is the Linter audit,
deliberately using codes `voice.js` does **not** emit (`voip-no-endpoints`,
`voip-no-licensing`, `voip-no-vendor`, `voip-no-contact`, `voip-no-port-date`,
`voip-no-support`, `voip-no-subscription`) so a gap is reported once; it is folded
into `standardizedIssues` (after `voicePlatformIssues`). `./lifecycle.js` gains the
eighth kind, `number-port` (group *Voice & numbering*, 30-day lead, 7-day
due-soon), whose date is read from the voice asset's `portDate` field. The
**Deployments** station's detail view gains a **Deployment coverage** card per
Voice/PBX asset — group-labelled chip rows (green met / red required-missing /
dashed recommended-missing, each hinting its fix in a tooltip) plus a lifecycle-date
list. Tests: `src/tests/voip-coverage.test.js` (7).

**Task 40 — Internet/WAN circuit asset & reseller service definition.**
`src/framework/circuit.js` is the resold-circuit model that turns task 33's thin
internet/WAN record into a full commercial + technical definition. Five catalogs
describe the reseller's product: `ACCESS_TECHNOLOGIES` (12, ids preserved from
the old `circuitType` vocabulary so existing records still resolve — each with a
`medium` and `symmetric` flag), `CIRCUIT_SOURCING` (6), `CIRCUIT_SLA_TARGETS`
(4 — best-effort / standard / business / premium, each carrying availability,
response and restore targets), `CPE_ROLES` (8) and
`RESELLER_SERVICE_DEFINITIONS` (6 tiers — essential / business / business-plus /
premium / dedicated / custom — each with committed down/up, burst down/up,
contention ratio and an SLA target). Helpers derive the numbers a technician
actually needs: `committedBandwidth` / `burstBandwidth` (falling back from burst
to committed and from `bandwidthDown` to the committed pair), `contentionRatio`
(an explicit `contention` string, else burst ÷ committed like `2.5:1`),
`bandwidthSummary`, `parseCidr` (IPv4 only, with `/29` → 6 usable, `/31` → 2,
`/32` → 1, and a clean rejection of IPv6 or free text), `circuitSubnets` /
`circuitStaticIps`, and `addressingSummary` (subnets, static IPs, usable count,
declared count, IPv4/IPv6 ranges, public hostname, `hasAddressing`/`hasSubnets`).
`circuitContract` reads the term dates local-safely (`toLocalDate` parses
`YYYY-MM-DD` as local so a timezone can never shift the day) and reports
`daysLeft` / `expired` / `expiringSoon` / `hasTerm`. `circuitPricing` computes
cost, sell price (`sellPrice` ?? `monthlyCost`), margin, margin percent and
`hasPricing`. `circuitProfile` assembles the normalised view the profile modal
renders, and `circuitDefinitionDrift` compares the configured committed/burst
bandwidth and SLA against the sold service-definition tier — the reseller's
"have we delivered what we sold?" check — while `circuitDependents` lists the
records that consume the circuit. `circuitIssues` is the Linter audit (codes
`circuit-no-upstream`, `circuit-no-access`, `circuit-no-committed`,
`circuit-no-addressing`, `circuit-no-cpe`, `circuit-no-sla`,
`circuit-no-contract-term`, `circuit-no-service-definition`,
`circuit-no-pricing`, `circuit-plan-drift`; all warnings), folded into
`standardizedIssues` (after `networkServiceIssues`). The shipped
`atype-wan-circuit` template in `assetLibrary.js` is rewritten to **32 fields**
(upstream/wholesale carrier, sourcing, service-definition tier, access
technology, committed and burst bandwidth, contention, SLA target, static IPs,
subnets, IPv4/IPv6 ranges, reverse-DNS hostname, CPE role and the router /
firewall / vendor records, wholesale cost and sell price, currency, contract
start/term/end, support contacts, notes) and the asset-type library's shipped
version is bumped (`ASSET_LIBRARY_VERSION` 8 → 9) so the reconciler refreshes
the template for any workspace that had not customised it. New typed
relationship kinds (`circuit-upstream`, `circuit-cpe`, `circuit-security`,
`circuit-lan`, `circuit-password`, `circuit-document`, `contact-circuit`) and a
matching `assetRelations.js` profile group (upstream, CPE, firewall/security,
LANs served, dependent services, credentials, documents, contacts) wire a
circuit to everything around it. Tests: `src/tests/circuit.test.js` (10).

**Task 41 — Provisioning & activation workflow documentation.**
`src/framework/circuitProvisioning.js` is the procedure that brings a resold
circuit live, and the generator that writes it down. Three catalogs describe it:
`PROVISIONING_PHASES` (9 ordered stages — order capture, upstream carrier
handoff, CPE selection & configuration, IP addressing/subnets/reverse DNS,
firewall & routing, activation, connectivity & throughput testing,
redundancy & failover, and customer acceptance), `PROVISIONING_TARGETS` (the 10
kinds of record a provisioning touches — the circuit, the upstream vendor, the
CPE, the firewall, the LANs, credentials, contacts, documents, the contract
tracker and the runbook itself, with `circuit`/`upstream`/`cpe`/`contact`/`runbook`
marked required) and `PROVISIONING_STEPS` (21 steps, each naming its phase, its
instruction and — the task's core obligation — the record targets it updates).
`resolveProvisioningRecords(circuit, set)` turns a target into the actual records
in a set, reading the typed links first (`circuit-upstream`, `circuit-cpe`,
`circuit-security`, `circuit-lan`, `circuit-password`, `circuit-document`,
`contact-circuit`) and falling back to the circuit's record fields
(`vendorRecord`, `cpeRecord`, `firewallRecord`), so a deployment wired by field
still counts; `provisioningRecordCoverage` reports which required targets are
still missing and `provisioningStepRecords` resolves a single step's mapping.
`generateCircuitProvisioningRunbook({ circuit, set, site })` assembles the body:
an overview built from task 40's `circuitProfile` (carrier, upstream, sourcing,
access technology, service definition, committed/burst bandwidth, contention,
SLA, addressing, contract), then a `## <phase>` section per phase whose steps name
the records each one updates, phase-specific fact tables (the pricing and
contract in *Order capture*, the addressing/subnet allocation in *IP addressing*,
the dependent records and failover notes in *Redundancy & failover*), a
consolidated **Records this deployment updates** table, and sign-off; every
recorded gap is written `TO COMPLETE` and returned in `warnings`. The runbook is
stored as a normal `circuit-provisioning` runbook (a new type in `runbook.js`,
group *Internet*), versioned and reviewable like any other, and the new
`circuitProvisioningCoverage` / `circuitProvisioningIssues` read a runbook's body
back for the required phase headings and flag one that is not linked to a
circuit (folded into `standardizedIssues`; all warnings). The **Deployments**
station gains a **+ Generate circuit runbook** button (when the set holds a WAN
circuit) and a **Circuit provisioning coverage** card per circuit — the record
chips (green present / red required-missing / dashed optional) plus, once a
runbook exists, a chip per phase. Tests: `src/tests/circuit-provisioning.test.js` (8).

**Task 42 — CPE, addressing & firewall relationship documentation.**
`src/framework/addressing.js` turns a resold circuit's free-text addressing
fields into a checkable plan and links it to everything around it. A VLAN
vocabulary (`VLAN_PURPOSES` — voice, management, guest, wireless, servers,
storage, CCTV, security, IoT, printers, DMZ, WAN, data) and `parseVlanLines`
parse a "VLANs & purposes" textarea ("10 voice", "VLAN 20 - Guest", "30 CCTV")
into structured entries with a recognised purpose, and `segmentationSummary`
reports the declared-vs-listed VLAN count, the purpose-less entries and whether
the recorded architecture implies segmentation. The reverse-DNS maths lives here
too: `ipv4ToPtrName` (203.0.113.2 → 2.113.0.203.in-addr.arpa), `reverseZoneForIp`
(the enclosing /24) and `reverseZoneForCidr` (the /24, /16 or /8 delegation
boundary, plus the RFC 2317 classless sub-zone for a block smaller than a /24,
e.g. `0-7.113.0.203.in-addr.arpa`). `circuitAddressingPlan(circuit)` returns the
parsed subnets with their reverse zones, the static IPs with their PTR names, the
distinct reverse zones and the forward record the public hostname implies.
`circuitEdgeRecords(circuit, set)` resolves the CPE, firewall and security
platform, LANs, domains, TLS certificates and remote-access records a circuit is
documented against — via the new `circuit-domain`, `circuit-certificate` and
`circuit-remote-access` relationship kinds (with profile groups on both the
circuit and the remote-access asset) and the circuit's own `cpeRecord` /
`firewallRecord` fields. `circuitAddressingCoverage` powers the UI card and
`addressingIssues` (folded into `standardizedIssues`; all warnings) flags a
circuit that records addressing but no reverse DNS, a public hostname with no
addressing or certificate, a circuit with no edge firewall, and a LAN whose
recorded segmentation has no VLANs, a count mismatch or purpose-less entries.
`generateCircuitAddressingRecord({ circuit, set })` assembles a
`client-technical` document — subnet allocation, static IP/PTR table, reverse
zones to arrange with the carrier, forward DNS, VLANs & segmentation, the CPE and
firewall relationship, and a linked-records table — with gaps marked TO COMPLETE.
The **Deployments** station gains an **Addressing & firewall coverage** card per
circuit (8 chips: addressing, reverse DNS, VLANs, CPE, firewall, domain,
certificate, remote access, plus a detail block of the parsed plan) and a
**+ Generate addressing record** button that stores the document and opens it in
the editor. The circuit template gains a **VLANs & segmentation** textarea and a
**CPE make / model** field (asset-library version 10). Tests:
`src/tests/circuit-addressing.test.js` (10).

**Task 43 — Reseller billing, usage & data-cap documentation.**
`src/framework/billing.js` documents the *money* half of a resold circuit: what
it costs wholesale versus what it is sold for, how it is invoiced, any data cap
and how overage is handled, and where the usage figures come from — then
reconciles the plan that was sold against what actually happened. The catalogs
are `BILLING_CYCLES` (monthly/quarterly/annual, with a `months` normaliser),
`PRORATION_POLICIES` (actual-days/thirty-day/full-period/none),
`DATA_CAP_PERIODS` (monthly/quarterly/annual), `OVERAGE_TREATMENTS`
(charge/throttle/notify/suspend/none) and `USAGE_SOURCES` (carrier portal, CPE /
SNMP counters, RMM, provider API, manual) with a `usageSourcesForText` matcher so
a free-text monitoring field is recognised. `normalizePeriod` accepts
`2026-07`, `2026/7`, `Jul 2026` and `July 2026`; `parseUsageReadings` parses a
per-period usage/cost textarea in comma, pipe or space form with GB/TB/MB units
(`"2026-07, 812 GB, 120.50"`, `"2026-08 | 940 | 138.25"`, `"2026-09 1020 GB"`),
tolerating blanks, `#` comments and junk lines; `circuitUsage` aggregates the
totals, averages and latest period. `billingProfile(circuit)` composes
`circuitPricing` and `circuitContract` with the cycle, billing day, proration,
cap (normalised to a **monthly allowance** so plans with different cap periods
compare), overage rate/treatment and monitoring sources, and derives the
per-cycle and annualised cost/sell/margin. `usageReconciliation(circuit)` is the
reconciliation view: it compares the average billed cost against the expected
cost (drift % with a tolerance), the latest usage against the monthly cap
(utilisation, over/near cap, overage GB and an estimated overage charge at the
recorded rate) and the freshness of the readings, returning `flags`
(`{code, level, message}`) and `ok`. `clientBillingSummary(set)` rolls every
circuit up to one client picture (monthly/annual cost/sell/margin, capped /
over-cap / drift / stale counts, estimated overage, cycles breakdown), and
`billingIssues(set)` (folded into `standardizedIssues`; all warnings) flags a
priced circuit with no cycle, a cycle with no proration, a below-cost margin,
missing monitoring, a cap with no overage treatment or no readings, usage over
cap, cost drift and stale readings. `generateCircuitBillingRecord({ circuit, set })`
assembles a `client-technical` document (commercial summary, billing cycle &
proration, data cap & overage, usage monitoring, a readings table and the
reconciliation with its findings), and `generateClientBillingRecord({ set })`
rolls the whole client up into a per-circuit table with the totals and findings.
The **Deployments** station gains a client-level **Reseller billing & usage**
card (four stat tiles — monthly cost/sell/margin and annual margin — plus the
capped/over-cap counts and the cycle breakdown) and a per-circuit **Commercial &
usage reconciliation** card (6 chips: cost & sell price, billing cycle,
proration, usage monitoring, data cap, overage treatment; detail lines for
cost→sell, margin, billing, cap, latest usage and usage source; and the red
findings), plus a **+ Generate billing record** button that generates either the
per-circuit record or the client summary (asset-library version 11). Tests:
`src/tests/billing.test.js` (11).

**Task 44 — Circuit cutover, migration & decommission runbooks.**
`src/framework/circuitMigration.js` is the *change* half of a resold circuit:
tasks 40–43 model what a circuit **is**, this models everything that happens when
it changes. The catalogs are `MIGRATION_SCENARIOS` (carrier/upstream change,
bandwidth upgrade, bandwidth downgrade, service-definition change, address
renumbering, CPE/firewall replacement, site relocation and customer offboarding /
decommission, each with an `icon`, a `risk` and the `renumber`/`replacesHardware`/
`decommission` flags that drive which steps and records apply),
`MIGRATION_PHASES` (seven ordered acts: impact assessment, approval & scheduling,
preparation & rollback plan, migration/cutover, verification, records update &
decommission, handover & closure), `MIGRATION_CHECKS` (the nine required
verifications, each tied to a phase) and `MIGRATION_STEPS` (~29 steps, each
declaring the `scenarios` it applies to, the `checks` it satisfies and the
`updates` record targets, resolved through the task-41 provisioning resolver).
`migrationRecords(circuit, set, scenario)` resolves every record the change
touches — the circuit, upstream carrier, CPE, firewall/security, LANs, domains,
certificates, remote access, credentials, contacts, documents and contract
tracker — with a per-scenario `action` (`update`, or `archive` for the circuit
on a decommission and the CPE on a replacement), and `recordsToArchive` is its
archive subset. `migrationImpact(circuit, set, scenario)` is the impact
assessment: the **blast radius** (the records that link to the circuit — voice,
contacts — plus the services it serves: LANs, remote access, published domains
and certificates), the records to update/archive, the address change (only for
renumbering scenarios, listing the current subnets/static IPs), the commercial
position from `circuitPricing`/`circuitContract`, and the findings
(`no-dependents`, `contract-expiring`, `renumber-no-addressing`,
`hardware-no-cpe`, `decommission-dependents`; all warnings/info).
`generateCircuitMigrationRunbook({ circuit, set, scenario })` assembles a
`circuit-migration` runbook record: an overview & impact-assessment section (the
recorded values, the dependent-service blast radius, the address change and the
findings), one section per phase with numbered steps that each print the records
they update, a **records to update or archive** table, and a roles & sign-off
table — marking every gap `TO COMPLETE`.
`generateCircuitMigrationChecklist({ circuit, set, scenario })` assembles a
cutover checklist whose steps carry `phase`/`check`/`hint` (like the VoIP
cutover), with `migrationChecklistCoverage` scoring it against the checks **the
scenario calls for** (a pure carrier change needs no DNS step; a renumber does),
`migrationPhaseProgress` rolling progress up per phase and `formatMigrationText`
rendering it grouped by phase. `circuitMigrationIssues(set)` (folded into
`standardizedIssues`; all warnings) flags a runbook missing a required section or
not linked to its circuit, and a checklist missing a required check, left
unsigned after completion or rejected. The **Deployments** station gains a
per-circuit **Migration & decommission readiness** card (5 chips — dependents
mapped, records to update, migration runbook, migration checklist, decommission
plan — plus the dependent-services, contract and records-to-update lines and the
red findings) and two buttons that generate the runbook or the checklist from a
chosen circuit and scenario. Tests: `src/tests/circuit-migration.test.js` (13).

**Task 45 — Search & relationship navigation.**
`src/framework/search.js` is the pure cross-set engine behind the **Search**
station. `recordSearchText(record)` flattens a record's nested fields into one
lowercased haystack (skipping the `secret`/`otpSecret` credential fields so
secrets never leak into results), and `buildSearchIndex(set, { client, now,
typeOf })` walks every non-relationship, non-deleted record of a documentation
set and produces one entry per record carrying its key, collection, ref, type,
name, client, information-model + provenance classification (with human labels),
lifecycle, expiry window and searchable text. `searchRecords(index, query,
filters)` runs a token AND-match over the haystack, ranks name hits above body
hits, and applies the six filters (collection, information model, provenance,
client, lifecycle — including the `attention` pseudo-state, and an expiry
window); `searchFacets(index)` returns the filter values with counts for the UI
and `buildCombinedIndex(docSets)` merges many clients' sets into one index,
deriving each set's own client id/name. Relationship traversal is the second
half: `recordNeighbors(set, ref)` resolves every first-class typed link into
grouped, labelled neighbours, `relationshipGraph(set, ref, { depth })` expands
that into a radial node/link graph (with `shortestPath` between any two records
via BFS), and `summarizeRecord` / `typeLabel` / `modelLabel` render the panel
badges. The **Search** station (`src/modules/search.js`, rebuilt from its
scaffold) is a query box with the six live filters and a result list on the
left, and a traversal panel on the right showing the selected record's
classification badges, a radial SVG relationship graph (drawn with
`createElementNS`), grouped neighbour chips and its shortest-path history trail,
with "Open in client" / "Open asset profile" / "Close" actions. Tests:
`src/tests/search.test.js` (13).

**Task 46 — Completeness & quality linter.**
`src/framework/linter.js` is the pure auditing engine behind the **Linter**
station. Where the integrity audit answers "is this a valid, referentially
consistent graph?", the linter answers "is it *good*?" — it reads a
documentation set and returns FINDINGS (each naming the check that produced it,
a severity from `LINT_SEVERITIES` — error / warning / notice, with
`severityRank`/`severityLabel`/`severityDef` — the record it concerns, a message,
a detail and a suggested fix), which `summarizeLint` groups by severity, by
check and by record (reporting `counts`, `ok` and `clean`). Six checks ship in
`LINT_CHECKS` / `lintDocumentationSet`, and `lintAllSets` merges every client's
set (tagging each finding with its `setId`): **configuration-completeness**
(`lintConfigurationCompleteness` reuses the task-10 `completenessReport`, one
finding per missing required field); **service-coverage** (`lintServiceCoverage`
walks `KNOWN_SERVICES` — voice, WAN service, WAN circuit, email, backup — and
flags a service with no relationships, a service with no
device/credential/documentation surface, and each unmet coverage requirement via
`requirementSatisfied`, which honors the template `typeIds` so a vendor link
cannot satisfy a circuit requirement); **document-duplication**
(`lintDocumentDuplication` builds `structuredTokens` from configuration
hostnames/serials/MACs/IPs, domains, certificates and flexible-asset string
fields — `isStructuredToken` recognises IPs, MACs, FQDNs and mixed alphanumeric
serials — and flags a document whose text repeats a value that also lives in an
unlinked structured record, matching on token boundaries so `acme.example` does
not fire inside `srv-01.acme.example`); **expiry-attention**
(`lintExpiryAttention` promotes `collectLifecycle`'s overdue/due-soon/undated
items to error/warning/notice); **orphan-records** (`lintOrphanRecords` flags an
asset type in `ORPHAN_AUDIT_TYPES` with no typed link either way, exempting
embedded credentials); and **stale-records** (`lintStaleRecords` flags records
untouched for `DEFAULT_STALE_DAYS` = 540 days). The **Linter** station
(`src/modules/linter.js`, rebuilt from its scaffold) has a client selector, a
severity summary, the six check filters as chips, and findings grouped by check
with severity badges, a "Suggested fix" line and **Open in client** / **Find in
search** actions, plus a Re-run audit button and loading/empty/error states. It
carries a `fix` descriptor on every finding, which task 48 consumes for
one-click fixes. Tests: `src/tests/linter.test.js` (12 task-46 cases; extended in
task 47).

**Task 47 — Storage-model audit.**
The storage-model check extends the task-46 linter with a question the other six
cannot answer: *is this information in the right home?* It ships four signals,
all under `lintStorageModel` / the `storage-model` check.
`scanStructuredValues(text)` finds the identifying values in free text — emails,
URLs, IPs, MACs, hostnames and serial-like tokens (serial-like needs a digit, a
letter, a separator and either a digit run, an upper case or an underscore) —
and `lintFreeTextStructure` flags a document or runbook whose text carries at
least `FREE_TEXT_MIN_VALUES` (2) such values that **no** structured record holds:
that text is standing in for an asset, so it suggests creating one and linking.
`isProse(value)` recognises a paragraph (long, multi-sentence, not a token) and
`lintStructuredProse` flags a paragraph sitting in a record's free-text field
(`notes`, or a flexible asset's own text/textarea fields, resolved through
`opts.typeOf`) — the fix is to move it into a Document, and linking a document to
the record clears the finding. `noteFieldPairs` / `lintAssetAsNote` detect a
note-shaped document (an `operational-notes` or `reference` doc whose body is
mostly `Label: value` lines, `>= NOTE_PAIR_MIN` 3 pairs at `>= NOTE_PAIR_RATIO`
0.5 of its lines) that should really be a Flexible Asset. Finally
`lintDuplicatedValues` reuses `structuredTokens` to find the same identifying
value held by two records that are not linked — a domain and a certificate both
recording `example.com`, say — and proposes the relationship instead of the
duplicate. Every finding carries a `fix` descriptor (`convert-to-asset`,
`extract-document`, `convert-note-to-asset`, `link-records`) for task 48. Tests:
`src/tests/linter.test.js` (18, covering tasks 46–47).

**Task 48 — Linter report & one-click fixes.**
Task 48 closes the loop the linter opened: every finding already carried a `fix`
descriptor, and `src/framework/linterFixes.js` now turns it into a write.
`fixPlan(finding)` describes what a row's Fix button should do — whether it is
`auto` (one click, no further input), what it `needs` (a `value` for a missing
text field, or a `target` record for a link), and whether it is `destructive`;
`applyLintFix(ctx, finding, opts)` then performs it — fill a missing required
field, create the proposed relationship (`pickLink` picks the catalog kind,
trying the natural direction then the reverse, and refuses when no kind can join
the two types), move duplicated prose out of a record into a Document and link
it back, create a structured asset from a document's identifying values, or
convert a note-shaped document into a Flexible Asset (re-pointing its surviving
links). A new generic `atype-custom` "Custom asset" template in
`assetLibrary.js` (`ASSET_LIBRARY_VERSION` 12) is where converted note/free-text
records land, to be cloned into a purpose-built template once the shape is
known. `src/framework/linterReport.js` builds the human artifact:
`buildLintReport` groups the audit by severity (with clients, checks, totals and
an `ok` flag), and `reportToMarkdown` / `reportToCsv` / `reportFilename` /
`reportSummaryLine` render and name it. The **Linter** station
(`src/modules/linter.js`) gained a **Report** button opening the report in a
modal with Download Markdown / Download CSV and **Save report** (kept in
`localStorage` under `itu:linter-reports`, capped at 10, with a "last saved"
line), plus a per-row **Fix** button that applies its fix — prompting for a value
or offering a record picker when the fix needs one, confirming destructive
conversions — then re-runs the audit and toasts the result. Tests:
`src/tests/linter-fixes.test.js` (9).

**Task 49 — Bundle publication to the shared bus & knowledge base.**
`src/framework/publication.js` is the pure publication engine. It defines the
SHARED envelope (`PUBLICATION_SCHEMA` `itu-publication/1`, kind
`itu-knowledge-bundle`) that a downstream assistant or the knowledge base reads
without knowing anything about the store — `records`, `relationships` and
`sections` — plus the two bundle kinds (`BUNDLE_TYPES`: documentation / deployment)
and the three `PUBLICATION_TARGETS`. Redaction is **default-deny**: `redactRecord`
OMITS credential records entirely unless the operator opts into a metadata-only
summary (`credentialSummaries`), and even then `secret` / `otpSecret` are never
written and usernames are withheld unless explicitly requested
(`credentialUsernames`); embedded credentials stay out unless opted in. Private-key
references on certificates are stripped and `scrubText` removes PEM blocks,
`otpauth://…secret=…` parameters and labelled secrets from prose (leaving genuine
cross-references like "password: see the credential record" alone).
`redactForPublication` works on deep copies (the stored set is never mutated),
keeps a relationship only when BOTH endpoints survive, and aggregates what was
withheld (type + reason + count, no names) for the operator preview.
`buildDocumentationBundle` assembles the whole set into overview / inventory /
document / runbook / checklist sections; `buildDeploymentBundle` carries only the
runbooks, checklists and related records for a chosen service or site.
`validatePublication` is the default-deny guarantee: it re-scans any envelope for
secret fields and private-key material (and schema/kind/type) and REFUSES a leaky
bundle, whatever built it. `createPublicationService({store, cache, upload, now})`
adds the hosted upload (via the upload plugin) and the bounded export log
(`PUBLICATION_LOG_KEY`) — `buildDocumentation` / `buildDeployment` / `publish`
(re-validates, then refuses to upload if `upload` is unavailable) / `listLog` /
`removeLogEntry` / `clearLog`. The **Exports** station (`src/modules/exports.js`)
is a real surface: choose a client, bundle type, publish target and (for a
deployment) scope; opt into the credential-summary redactions; **Preview** the
exact envelope, its summary line and withheld line, then **Download** or
**Publish** it, with the export log below listing what, when, where and what was
withheld. Tests: `src/tests/publication.test.js` (11).

**Task 50 — Exports & printable packets.**
Where task 49 publishes a raw envelope to a downstream consumer, task 50 turns the
same data into a *human-facing packet*: `src/framework/packet.js` is the packet
engine, built directly **on top of** `buildDocumentationBundle` /
`buildDeploymentBundle`, so every packet inherits the default-deny redaction and
the leak guard for free. It defines `PACKET_SCHEMA` (`itu-packet/1`) and
`PACKET_KINDS` (`documentation` / `deployment`); `buildDocumentationPacket`
produces the per-client packet (overview, inventory, organizations, locations,
contacts, documents, configurations and a relationship map) and
`buildDeploymentPacket` the site/service packet (its runbooks, checklists and
related records; `deploymentScopeLabel` names the scope). A packet is a title, a
subtitle, a `client`, a `generatedAt`, the `redaction` summary and an ordered list
of `blocks`, each `{ heading, markdown }`. `packetToMarkdown` renders the packet to
a real `.md` file (with a `## Contents` list of anchor links `slugify`d to match the
renderer's heading ids); `packetToHtml` runs the same markdown through
`renderMarkdown` for the on-screen preview; `packetToStandaloneHtml` wraps it in a
complete, self-contained printable HTML document (embedded `STANDALONE_CSS`, a
Print toolbar that hides itself when printed, `@media print` rules) — that string is
what both **Download HTML** and the hosted link serve. `createPacketService({store,
cache, upload, generatorName, now, getAssetTypes})` exposes `buildDocumentation` /
`buildDeployment` / `host` (uploads the standalone HTML via the upload plugin and
appends a `packetFilename`-named entry to the bounded log at `PACKET_LOG_KEY`) /
`listLog` / `removeLogEntry` / `clearLog` / `loadSet`, plus re-exports of the
render helpers. The **Exports** station gains a *Packets & printables* card — choose
a client, packet type and (for a deployment) a runbook scope, optionally opt into
credential summaries, then **Preview packet** (summary line, withheld line and the
rendered packet sheet), **Open printable view** (a full-screen overlay whose Print
button calls `window.print()`, with the app chrome hidden by the print CSS),
**Download HTML** / **Download MD**, or **Host packet** — followed by a *Hosted
packets* card listing what was hosted, with copy-link and remove actions. Tests:
`src/tests/packet.test.js` (11).

**Task 51 — Field access & responsive UI.** Task 51 makes the whole system usable
from a phone in the field, and (the second half) offline-tolerant. The pure
engine is `src/framework/field.js`: `isStagedWrite` / `stagedWriteNotice` /
`pendingDraftsSummary` recognise a write the store staged locally because the
connection was down, and `createConnectivity({ store, onChange })` +
`connectivitySummary` track the online/offline/syncing state and the pending
draft count; `setChecklistStepDone` / `toggleChecklistStep` / `nextOpenStep`
drive a field checklist step; `parseQuickQuery` / `quickSearch` / `quickChips` /
`QUICK_QUERY_HELP` implement the `type:` / `client:` / `model:` / `prov:` /
`life:` / `due:` field-query syntax over the task-45 combined search index. The
**quick-find palette** (`src/modules/quickfind.js`, `openQuickFind(ctx,
{initialQuery})` / `invalidateQuickFindCache()`) is a global overlay reachable
from the header search box, Cmd/Ctrl+K or `/` — a big input with live token chips,
a ranked result list that jumps straight to the record (opening the Search
station with the picked record selected), and arrow-key/Enter support. The
**field checklist** (`openFieldChecklist(ctx, {setId, recordId})`, in
`checklist-view.js`) is a full-screen, phone-first view of one checklist where
every tap ticks a step and saves it *immediately* through the per-step
`toggleChecklistItem` API (no Save button), shows a live progress bar and a
status line that distinguishes "Ticked" from a locally-staged "will sync when the
connection returns"; the checklist editor gains the **Field view** toolbar
button. `docsets.js`'s `mutate()` now catches a staged edit failure, memoizes the
set and returns `{ …, staged: true, draftId }` so an offline tick is not lost,
and `src/app.js` wires the connectivity layer (auto-reconcile on reconnect, a
visibility/interval refresh loop, `store.onChange` and a `statusControl` surface
the Status station reads — task 57), the quick-find shortcuts and the
`window.__kb` debug handles.
`src/styles.css` gains the quick-find/field-checklist styles with a
`≤620px` pass (the palette goes
full-screen). The `isCutoverChecklist` test was tightened to
`record.phases.length` / a phased step, so a plain checklist no longer renders
cutover phase grouping. Tests: `src/tests/field.test.js` (13).

**Task 52 — Integrity checks & fixture suite.** Task 52 gathers the system's
scattered per-record rules into one audit that can be run over any documentation
set, and ships fixture sets that exercise it. The pure engine is
`src/framework/integrity.js`: `INTEGRITY_CHECKS` declares six checks —
**classification** (every record carries an information model and a provenance),
**relationships** (every target exists and reads consistently from both ends),
**required-fields** (each record satisfies its type's required-field rule set),
**orphans** (no record stranded outside the relationship graph),
**credentials** (no secret leaks into a non-credential export, even when the
operator opts into credential summaries), and **exports** (every bundle + packet
parses and validates). `INTEGRITY_RUNNERS` maps each id to its function
(`integrityClassification` / `integrityRelationships` / `integrityRequiredFields` /
`integrityOrphans` / `integrityCredentials` / `integrityExports`), each reusing the
existing engine (`validateClassification`, `checkIntegrity`, `relationsOf`,
`validateRecordFields`, `lintOrphanRecords`, `findLeakedSecrets`,
`validatePublication`, the packet builders, `SECRET_FIELDS`) rather than
re-implementing a rule — so there is one definition of each. `runIntegritySuite(set,
{now})` returns a report `{ setId, client, ok, counts, checks, findings }` and
**never throws**: a check that itself fails is recorded as `status: "error"`, and
`ok` is false when any check reported an error (warnings alone do not fail the
suite). `runIntegritySuiteAll(sets, {now})` rolls those into
`{ summary: { sets, clean, failing, errors, warnings, ok }, reports }`;
`integrityStatusLabel`, `integritySummaryLine` and `integrityReportToMarkdown`
render the human artifact. The companion `src/framework/fixtures.js` ships two
fixture documentation sets — `buildTspDemoFixture()` (a healthy client covering
all four information models plus the imported and synchronized cases) and
`buildLegacyFixture()` (schema `itu-docset/0`, missing buckets, an unclassified
organization, an invalid contact role and a dangling relationship) — exposed
through `FIXTURE_SPECS` / `fixtureSpec` / `buildFixtureSet` / `fixtureCatalog` /
`fixtureModelCoverage`, with `seedFixture(docs, id, {name, createdBy})` writing a
fixture into a real set through the ordinary `create` / `addRecord` / `linkRecords`
API. The **Settings** station gains an *Integrity checks* card (`integrityCard` in
`src/modules/settings.js`): **Run integrity checks** audits every client
(including archived) and renders a summary line, error/warning count pills and a
per-set row with its Passed/Failed badge, error/warning meta, six check chips and
the top error findings; **Download report** saves the markdown report; and a
fixture dropdown + **Add fixture set** seeds a chosen fixture so the checks can be
seen passing (and catching the legacy set's deliberate gap). `src/styles.css`
gains the `.kb-int-*` card styles with a `≤620px` pass. Tests:
`src/tests/integrity.test.js` (14).

**Task 53 — README & playbook.** Task 53 documents the IT-U content model and the
extension playbooks, and — so the documentation cannot silently drift from the
code — makes the playbook a build artifact checked against the live catalogs.
The source is `src/framework/playbook.js`: it derives its catalog sections from
the real engines (`INFORMATION_MODELS`/`PROVENANCE` from `classification.js`,
`RECORD_TYPES` from `docsets.js`, `RELATIONSHIP_KINDS` from `relationships.js`,
`RUNBOOK_TYPES` / `BUNDLE_TYPES` / `PACKET_KINDS`), so a rename fails a test
instead of leaving a stale sentence. It exports `contentModelReference()`,
`provenanceReference()`, `relationshipReference()`, the curated
`RELATIONSHIP_CONVENTIONS` / `DEPLOYMENT_FLOW` / `REDACTION_RULES`, the
`EXTENSION_KINDS` / `extensionGuides()` / `extensionGuide(id)` checklists (a new
asset type, template, service runbook, or export, each step naming the file it
touches), `playbookCoverage()`, `PLAYBOOK_FILES`, and `playbookToMarkdown()` —
the generator for **`src/PLAYBOOK.md`** (checked in; a test asserts the file
matches the generator). The **Settings** station gains a *Playbook & reference*
card (`playbookCard`): collapse-and-expand reference sections for the information
model, provenance, relationship conventions, deployment-doc flow and redaction,
the four extension guides as numbered file-annotated steps, plus **Download
playbook** / **Copy markdown**. The **README** now leads with the content model
(replacing the old "superseded by task 53" placeholder). Tests:
`src/tests/playbook.test.js` (9, including the drift guard).

**Task 54 — role & access model.** Task 54 replaces the old coarse access levels
with the IT-U role model — **viewer / technician / administrator** — granted *at
a scope*, and enforced by the server rather than only hidden in the UI. The pure
model lives in `src/framework/roles.js`: `ROLES` (with `ROLE_RANK`, labels and
`ROLE_GROUP_IDS`), `ACTIONS` + `roleAllows`/`actionsForRole`, and the scope
algebra (`GLOBAL_SCOPE = "*"`, `clientScope`/`serviceScope`, `parseScope`,
`scopeFor({scope,setId,record})` — the scope a record resolves to, its own service
id or the whole repository, `scopeLabel`/`scopeTitle`, `ancestorScopes`,
`scopeApplies`). A person holds a list of `{scope, role}` assignments; the role in
force at a scope is **most-specific-wins** (`resolveRole`), and
`can({assignments,scope,action,…})` decides a single action there, returning the
matched scope and role so the UI can explain *why*.

- `src/framework/access.js` (`createAccessService({ store, cache, getRole,
  getAssignments, now })`) resolves the signed-in principal (including its
  assignments) and exposes `effectiveAccess(principal, scope)`, scope-aware
  `can(action, scope)` / `canAtScope` / `scopedRole` / `explainRole` /
  `describe(scope)`. When a scoped grant does not reach a scope the answer is a
  default-deny *viewer*, never the old legacy group's permissions.
- `src/framework/docsets.js` `gate()` now injects each record's `setId`, so every
  create/edit/administer/delete call authorizes the record at the scope it belongs
  to (a client, or the service inside it).
- `src/framework/hub.js` normalizes the server's integer/legacy roles to IT-U
  names and adds `roleFor(scope)`, `assignments()`, `scopedRole(scope)`,
  `can(action, scope)`, `grantRole(username, scope, role)` / `revokeRole`, and
  scope-aware `authorize` / `require`; `subscribeCategory` / `watchArticle` /
  `catchUp` / `announce` carry the scope.
- The **Settings** station gains a *People & access* card (`src/modules/roles-view.js`,
  the ninth settings card): a three-role legend, the signed-in identity and its
  repository-wide role, and — for an administrator — the people list with each
  person's scoped grant chips (solid role chip + dashed scope chip, removableView)
  and a **Grant role** dialog that picks role × scope kind (whole repository / one
  client / one service). A signed-in non-administrator sees a read-only account of
  their own grants.
- `src/framework/account.js` shows the IT-U role label, the highest role and the
  assignment scope chips.

The **server** (the `<script type="text/x-server-plugin">` block in `index.html`)
is bumped to **store format v2**: a durable scope table (`SCOPE_REC`) records
`{user, scope, role}` grants, with a one-time `upgradeV1()` migrating the old
per-user role slots into scopes while preserving users, tokens, audit and edit
keys. The change ring is widened to carry each change's scope. The new RPCs
`grantRole` / `revokeRole` / `checkAction` / `announceChange` / `getChanges` /
`subscribeCat` are scope-aware, and `login` / `auth` return the caller's
`rolesOfUser`. `canDo` is the single server-side gate every mutating RPC consults,
so the client can never authorize itself. Tests: `src/tests/roles.test.js` (13)
and `src/tests/access.test.js` (9).

**Task 55 — realtime hub & collaborative editing.** Task 55 makes the optional
companion hub do more than presence: when one session commits a documentation
set, every other session watching that client receives a live change event and
open editors reconcile instead of silently clobbering each other. The pure
decision logic lives in `src/framework/collab.js` — `sortedJson`, `deepEqual`,
`recordStamp` (a stable content stamp that *ignores* `updatedAt`/`updatedBy`/
`lastSeenAt`/`reviewedAt`, so bookkeeping is not mistaken for an edit),
`classifyRemoteChange({base,mine,theirs})` (→ `unchanged` | `remote-only` |
`converged` | `conflict`), `mergeRecords` (three-way; adopts remote-only fields,
keeps mine-only fields, flags real conflicts), `describeField`/`previewValue`
(one-line, whitespace-collapsed diffs), and the editor-presence helpers
(`EDIT_TTL_MS`, `pruneEditors`, `editorNames`, `editingSummary`,
`editorInitials`).

- `src/modules/collab-bar.js` renders the shared **presence strip**
  (`collabBar(ctx,{scope,recordId,label})` — claims a marker, refreshes it,
  shows the other people editing and releases on close, with honest states for
  signed-out and offline) and the **inline conflict banner**
  (`conflictNotice({title,detail,fields,actions})`).
- `src/modules/runbook-view.js` drops the strip at the top of the runbook
  editor, subscribes to the client's change scope, and on a remote save either
  reloads (remote-only), converges, or shows the conflict banner with
  **Merge (keep both) / Reload (take theirs) / Keep mine** and highlights the
  genuinely conflicted fields. Saving re-reads the live record first and refuses
  to overwrite a newer version without resolving. When the hub is unreachable it
  **falls back to polling** the set, so a change synced in from elsewhere still
  surfaces.
- `index.html` (server) gains an ephemeral **editing registry** and the RPCs
  `claimEdit` / `releaseEdit` / `getEditors` (scoped, TTL-pruned, released on
  disconnect); `announceChange` now records the true server-side actor and a
  numeric `updatedAt`.
- `src/framework/hub.js` handles the `edit` broadcast, exposes `editors` /
  `onEditors` / `watchScope` / `claimEdit` / `releaseEdit` / `getEditors`,
  re-claims open editors on reconnect, and **de-duplicates** repeated change
  events by sequence (the same event can arrive on more than one subscription).
- `src/app.js` announces each documentation-set write on its client scope (only
  when signed in and permitted).

Verified live with two connections: both see each other's editing marker, a
scoped technician's save raises exactly one conflict banner in the runbook
editor, and Merge keeps the local value while flagging the field. Tests:
`src/tests/collab.test.js` (12).

**Task 56 — multi-user audit & rate control.** Task 56 closes the loop on the
server-authoritative model: the hub now keeps a **durable audit trail** of every
sign-in, role change, published change and allowed-or-denied action (attributed
to the **true actor** the server recorded, not what the client claims), exposes
**who is connected right now**, and reports the **rate-limit buckets** in force —
and the Settings station surfaces all of it in a single administrator-only
*Activity & rate control* card. The pure decision logic lives in
`src/framework/audit.js`: `AUDIT_ACTIONS` (the canonical action ids),
`AUDIT_GROUPS` (all / changes / actions / denied / access / accounts),
`RATE_LABELS` + `rateLabel(prefix)` (bucket prefix → readable name),
`actionLabel(verb)` (verb → label, reusing `actionDef` from `roles.js`),
`classifyAudit(action)` (→ `{key,group,tone,label,verb,kind}`, including the
`denied:` prefix), `describeAudit(rec)` (one plain-English sentence),
`summarizeAudit(records)` (totals by group / actor + denied count), and
`filterAudit(records,{group,actor,query})`. `networkLabel(net)` renders the
coarse network bucket and `rateSummary(stats)` turns the raw bucket snapshot into
`{buckets,events,groups,byNetwork,openNetworks,topNetwork}` for the counters.

- `index.html` (server) is bumped to **store format v3**; `upgradeV2()` preserves
  users, tokens, edit-keys and scoped roles while discarding the (ephemeral by
  nature) audit and change rings. The audit ring is widened to `AUDIT_REC = 96`
  bytes × `AUDIT_MAX = 400` entries and now stores the **full** action name (not
  a one-character code), so `readAudit(limit,sinceSeq)` returns a complete,
  newest-first trail. `netGroup(conn)` buckets a connection by a coarse 12-char
  network signal (never a raw IP), each session stores that `netKey`, and the
  `announceChange` / `checkAction` paths gain **per-network** limits
  (`ann:net:` 180 proxy / 600 per minute; `act:net:` 720 / 2400) on top of the
  existing per-connection ones — so one noisy client, or a whole address, cannot
  flood the hub. New **admin-only** RPCs `getAudit` / `getSessions` /
  `getRateStats` expose the trail, the live sessions and the rate snapshot.
- `src/framework/hub.js` adds `audit({limit,since})`, `sessions()` and
  `rateStats()`, each degrading to an empty result when offline or when the
  caller is not an administrator (the server is the gate either way).
- `src/modules/activity-view.js` renders the **Activity & rate control** card
  (`renderActivityCard`): the *Connected now* board (each session's username,
  role badge, `net …` pill and last-seen, with a coarse-network summary), the
  *Rate control* panel (bucket/event counts and per-network counts), and the
  *Audit trail* — group filter chips with live counts, a search box and a
  Refresh button, each row a sentence plus an action tag, scope and relative
  time and a tone dot. Signed-out, offline and non-administrator states are
  explained honestly rather than shown empty.
- `src/modules/settings.js` appends the card between *People & access* and
  *Integrity checks*; `src/styles.css` styles the audit/session/rate block
  (including a ≤620px pass).

Verified live with two connections: an administrator sees both sessions, the
rate counters, and the audit rows for a registration, the sign-ins, a granted
role and denied actions — each attributed to the right actor — with the filter
chips and search narrowing the list correctly. Tests:
`src/tests/audit.test.js` (10, including a drift guard asserting every
`roles.js` action id maps to its declared audit label).

**Task 58 — identity provider (SSO).** Task 58 lets people sign in with their
own directory — **Microsoft Entra ID**, Okta, Auth0, Google or any OIDC
provider — and maps directory groups onto IT-U's scoped roles. IT-U is public
source with no trusted backend, so it is an **OIDC public client**: the flow is
**Authorization Code + PKCE with no client secret**, and every ID token is
verified **on the server** against the provider's public JWKS. Because the whole
generator ships as source (and runs as a server script any visitor can read), the
design deliberately puts the trust decision in the authoritative server, never in
the client. The card lives in Settings → *Identity provider (SSO)*
(`src/modules/idp-view.js`, `data-card="idp"`) and the account modal gains a
"sign in with your directory" block (`src/framework/account.js`).

- `src/framework/idp.js` — the pure, DOM-free model: `PROVIDER_PRESETS`
  (Entra ID, an Entra app-roles variant, Okta, Auth0, Google, generic OIDC),
  `providerFromPreset`, `simulatorProvider`, `normalizeProvider(s)` /
  `validateProvider` / `sanitizeProvider(s)` (a provider is never stored or
  echoed with a client secret it should not have), `discoveryUrlFor` /
  `applyDiscovery` (fold a `.well-known/openid-configuration` document into the
  endpoints), `normalizeJwks` (keep only public RSA keys), claim helpers
  (`claimValue` / `claimString` / `claimList`, path-aware), `extractIdentity`,
  `normalizeUsername` + `shortHash` (directory name → an IT-U-safe slug, and the
  suffixed form used when a local account already owns the plain name),
  `groupMatches` (exact, case-insensitive, or `*` glob), `rolesFromRules`
  (directory groups → `{scope, role}` grants; blank/`*` matches everyone),
  `ruleSummary` / `validateRule`, `buildAuthorizeUrl` / `parseCallback`,
  base64url helpers, `decodeJwt` / `audienceIncludes` / `describeClaims`, and
  `createPkce` / `randomBytes` / `sha256Base64Url` / `hmacSha256Base64Url` /
  `mintSimulatorIdToken` (the demo signer used by the simulator).
- `src/framework/sso.js` — the client flow service (`createSsoService`):
  `redirectUri()` (resolves `src/sso-callback.html` the same way the page's own
  relative `src/…` refs do), `loadConfig`/`providers`/`canEdit`, `resolve`,
  `begin(providerId)` (calls the server for state + nonce, builds the authorize
  URL, stores the PKCE verifier, opens a named popup and detects a blocked one),
  `simulate(personaId)` (mints a demo ID token and submits it exactly like a real
  one), `complete({code,state})` (exchanges the code at the token endpoint and
  hands the ID token to the server), `discover(provider)`, `personas()`,
  `handlePopupMessage(evt)` (accepts only same-origin `itu-sso-callback`
  messages) and `onResult` listeners. A sign-in result carries `username`,
  `naturalUsername` and `adjusted`, so the UI can explain when a directory
  identity had to be given its own suffixed account.
- `src/sso-callback.html` — the popup's landing page. It is served as real HTML
  by the platform (verified: `text/html`, no engine processing), reads the
  authorization response, and `postMessage`s `{type:"itu-sso-callback", code,
  state, error, errorDescription}` back to the page origin. It holds no secrets.
- `index.html` (`<script type="text/x-server-plugin">`) — the trust boundary.
  Adds durable provider storage (a length-prefixed SSO block in the hub's byte
  state, schema-versioned with `upgradeV3()`), and four RPCs: `ssoGetConfig`
  (public, secret-free provider view), `ssoBegin` (mint one-shot state + nonce,
  held in a short-lived map with `ssoPrunePending`), **`ssoSetConfig`
  (administrator-only)**, and **`ssoLogin`** (pre-auth, rate-limited). `ssoLogin`
  consumes the state, verifies the ID token, provisions/links the account,
  **replaces the user's scoped grants** from the provider's rules (the directory
  is the source of truth for an SSO user), and opens a hub session. The token
  verification is hand-rolled for the sandbox (no `crypto`, `TextEncoder` or
  async): UTF-8 encode/decode, hex/bytes helpers, `sha256Bin`, `hmacSha256`,
  base64url decode, `bytesToBigInt` / `bigIntToBytes` / `modPow`, an RSASSA-PKCS1
  SHA-256 verify, `findJwksKey` + `sanitizeJwks`, `decodeJwtParts`, and
  `verifyIdToken` — which checks the signature (RS256), `iss`, `aud`
  (`idpAudIncludes`), `exp`/`nbf`, and the nonce, and rejects a replay. Claims
  map through `idpClaim*`, `idpGroups` and `idpGroupMatches` / `idpRoles` to
  scoped roles via `removeAllScopeRoles` + `setScopeRole`. `idpIdentityName`
  returns `{username, natural, adjusted}`: an existing **SSO** account of the
  same slug is reused (the same person returning), but a taken **local password**
  account is never adopted — the identity gets a `natural-hash4` account and
  `adjusted:true`, which the client surfaces as a warning.
- `src/framework/hub.js` — `ssoConfig()`, `ssoBegin(providerId)`,
  `ssoLogin({idToken,state})` (sets the session and emits auth-changed) and
  `ssoSetConfig(providers)`; all degrade gracefully when the hub is offline.
- `src/modules/idp-view.js` — the Settings card: the redirect URI to register,
  the provider list with Add-from-preset / Edit / Remove, the modal editor
  (issuer, client id, endpoints, claim mapping, group → role rule rows with a
  glob matcher, JWKS), a **Discover** action that fetches the discovery document
  and public keys, **Preview the claim mapping**, and the built-in simulator.
- `src/framework/account.js` — the "or sign in with your directory" block:
  one button per provider plus the simulator persona picker; a suffixed identity
  is reported with a warning toast.
- Wiring: `src/framework/help.js` gains the `settings:idp` help entry (and the
  card is listed in `SETTINGS_CARDS` in `src/framework/ai-context.js` and
  `src/tests/help.test.js` so Ask AI and the help-drift guard stay in sync);
  `src/modules/settings.js` registers the card, `src/framework/icons.js` gains a
  `key` icon, `src/kb-config.js` / `main.pjs` expose `ssoEnabled` and
  `showSimulator`, and `src/app.js` creates the service, routes the popup
  `message` events and adds `sso` to the router ctx / `window.__kb`.
  `src/framework/modules.js` builds the station `ctx` from an explicit
  whitelist, so `sso` must be added there for a station to see it.

The built-in **simulator** is a complete, offline provider: it mints an ID token
signed with a key that ships in public source, which the server verifies through
the very same code path as a real provider. It is a demonstration only — it has
no group rules, so a simulated sign-in is always a viewer, and it can never
escalate privileges. To wire a real directory you register the card's redirect URI
as a Single-page application, paste the application id and issuer, click
**Discover**, add group → role rules, and save; in Entra you also set
`groupMembershipClaims` so the token carries the groups the rules match. There is
no client secret anywhere: a provider that mandates one (e.g. a plain Google
"Web application" client) cannot complete the exchange from the browser. The
server verifies signature, issuer, audience, expiry and nonce on every sign-in,
and offboarding in the directory removes access the next time the person signs
in. Tests: `src/tests/idp.test.js` (25) and `src/tests/sso.test.js` (15); the
server half was verified live against the real socket (a unicode+JWKS config
round-trip is byte-exact, RS256 verifies and rejects tampered/expired/wrong-aud/
wrong-nonce/unsigned tokens, HS256 simulator signs in, replay is blocked, an
unknown provider is blocked, `ssoSetConfig` is administrator-gated, a local
account of the same name is not adopted, and a returning SSO user reuses their
account).

## The service library (task 35)

Task 35 adds the **Library** station — a browsable, searchable library of service
processes and operational topics whose articles a technician can follow as
written or adapt to a client. The catalog (`src/framework/library.js`) holds nine
topic shelves and ~26 markdown articles spanning client onboarding, email,
backup, network, security, voice, resold internet, endpoints and operations. Each
article declares which shipped asset templates it supports and which document
type it reads as, which is what makes it *cross-linked*: the **asset profile**
gains a "How-to from the library" block (`libraryForAssetType`) listing the
processes covering that asset, and the **document editor** gains a "Start from
the library" block (`libraryForDocType`) offering the articles that read as that
document's type — with **Insert** (append `articleInsertionText` into the body,
freely editable) and **Read** (open it in the Library). The station itself
(`src/modules/library.js`) is a search box + topic tabs over a card grid, and an
article detail route (`#/library/<id>`) that renders the markdown body, its
"Supports" cross-links to asset templates and document types, its related
articles, and an **Add to a client's set** action that adapts the article into a
real document (`articleToDocumentInput` → `docs.addDocument`) and opens it in the
editor. The Library is the 13th station (after Services). The article catalog is
shared content, like the Flexible Asset template library — what a client's set
holds is the *document* an article is adapted into. Tests:
`src/tests/library.test.js` (8).

## Document store

Every content module's data is persisted as a **versioned JSON document** under the
KB's own storage namespace (`kb-system`). Implementation lives in `src/framework/store/`:

- `index.js` — `createDocumentStore(...)`: the store itself. Documents are
  versioned (bump on every real change; identical rewrites are free no-ops),
  split into ceiling-bounded chunks (no single write can exceed the storage
  ceiling), cached locally for fast reads, and written with a registry
  compare-and-set guard so concurrent writers are detected rather than
  silently clobbered. Public API: `readDocument`, `writeDocument`,
  `writeMany`, `ensure`/`ensureMany`, `deleteDocument`, `listDocuments`,
  `documentStats`, `meta`, `sync`, `getStatus`, `onChange`.
- `sync.js` — `createSyncEngine(...)`: the sync/conflict layer.
- `chunking.js` — byte-accurate chunk splitting (never splits a surrogate
  pair) + a 64-bit content hash (change detection + integrity checks).
- `backends.js` — cloud channels (upload-plugin editable files = canonical,
  one physical file per name; in-memory Map for tests) and local caches
  (kv-plugin folder per namespace; in-memory for tests).
- `records.js` — the cache record shapes shared by the store and the sync
  engine (`KEYS`, `makeDraft`, `makeConflict`) so a draft/conflict staged by the
  store is immediately visible to the engine and vice-versa. (The KB's canonical
  document set that used to live here was removed with the KB content model.)
- `errors.js` — typed `StoreError`s with stable codes
  (`STORAGE_UNAVAILABLE`, `EDIT_KEY_REQUIRED`, `INTEGRITY`, …).

Physical layout in the cloud (editable files, all lowercase-hyphen names):

    kb-system-registry          small versioned JSON index of every document
    kb-system-<docId>-v<ver>-<hash8>-<i>   one file per chunk (content-addressed)

The registry is the commit point (written last, with a `rev` guard). Chunk
names embed the version AND a content-hash prefix, so different content never
reuses a physical file — the losing side of a conflict physically survives.
Edit keys for the editable files are cached locally in kv (per physical name) —
only the device that created a file can update it; a device without the key
gets a typed `EDIT_KEY_REQUIRED` error and the cloud doc stays intact. Reads
work from any device (cold-start tested).

**Quota note:** the canonical channel is upload-plugin editable files, so
editable-file writes count against the daily upload quota. Heavy automated
testing can exhaust it (writes then fail with a typed "over_daily_allowance"
→ surfaced as "Could not save… Please try again" until quota resets). Reads are
unaffected.

## IT-U documentation-set layer (tasks 2–4)

Everything above the raw store that models one client's documentation:

- `docsets.js` — `createDocSetService({ store, cache })`. A **documentation set**
  is ONE versioned JSON document per client (`docset-<slug>`), holding every
  record type (`organizations`, `locations`, `contacts`, `configurations`,
  `passwords`, `documents`, `checklists`, `flexibleAssets`, `trackers`,
  `relationships`, `runbooks`). The service rides on the document store, so it
  inherits versioning, chunking, the local edit-key cache, the fast local cache,
  cross-device survival and the concurrency guard, and adds an in-memory memo +
  a serialized mutation queue. API: `create`, `get`, `peek`, `list`,
  `summaries`, `meta`, `counts`, `countRecords`, `listRecords`, `relations`,
  `linksFor`, `integrity`, `rename`, `remove`, `addRecord`, `updateRecord`,
  `removeRecord`, `linkRecords`, `unlinkRecords`, plus the re-exported catalogs.
- `classification.js` — the two required classifications. `INFORMATION_MODELS`
  (Core Asset / Flexible Asset / Document / Integration-managed) and
  `PROVENANCE` (directly authored / imported once / continuously synchronized /
  related to another record / linked to an external source / stored as an
  attachment), each provenance declaring any required origin fields (e.g. a
  synchronized record must name the system that syncs it). `validateClassification`
  never throws (forms + the linter use it); `requireClassification` throws the
  typed `UNCLASSIFIED_RECORD` error — the "refuse to save an unclassified record"
  guarantee, applied on both add and update.
- `relationships.js` — the typed-link engine. `RELATIONSHIP_KINDS` is the catalog
  of allowed link kinds (each naming which record collections it may join);
  `validateLink` checks the kind, both endpoints and duplicates; `makeRelationship`
  mints a link; `relationsOf` returns a record's links in BOTH directions (the
  bidirectional-consistency guarantee — a link is stored once and read from both
  ends); `cascadedRelationships` returns the links removed with a deleted record;
  `findDuplicate` + `suggestLinks` back the "link the existing record instead of
  duplicating it" behaviour; `checkIntegrity` audits a set's whole graph (dangling
  endpoints, unknown kinds, self-links, duplicate links) and is used by the Linter
  station in a later phase.
- `ids.js` — `newId(prefix)` and `slugify` (document-set ids are slugged from the
  client name, e.g. `docset-acme-corp`).

The **Organizations** station (`src/modules/organizations.js`) is the UI on top:
a list of documentation sets (cards showing record count, version, last-updated
and per-type chips) and a detail view (`#/organizations/<id>`) with a KPI row,
per-type record tables showing information-model + provenance badges, an
add-record dialog (dynamic origin fields per provenance, duplicate → "Create
anyway" override), a link dialog, unlink, cascade-on-remove and delete-set.
Dialogs are in-app modals (never native `confirm`/`prompt` — those block the
preview).

## Backup, archival, versioning, templates & standardization (tasks 5–10)

The services that extend the documentation-set layer:

- `store/backup.js` — `createBackupService({ store, sync, docs, cache, uploadPlugin, generatorName })`.
  `BACKUP_SCHEMA = "itu-backup/1"`. `collect()` gathers every documentation set
  (via `docs`) into one portable JSON envelope; `serialize()`, `validateEnvelope()`
  (typed `INVALID_BACKUP` on failure) and `preview()`; `restore(envelope, {mode})`
  merges (default) or replaces — **merge is idempotent** and buckets the outcome
  as `created` / `merged` / `replaced` / `unchanged`. `download()` returns a Blob;
  `publish()` writes the whole backup to a single plain editable file
  (`itu-backup-<ts>`) and `listPublished()` / `removePublished()` manage them.
- `archive.js` — `createArchiveService({ store, docs, cache, ceiling })`.
  `DEFAULT_STORAGE_CEILING = 2 MiB`, `NEAR_CEILING_RATIO = 0.8`. `archive(id)` /
  `unarchive(id)` toggle a `archived` flag + `archivedAt` on the set; an archived
  set is **read-only** (docsets' `mutate` refuses unless `{ allowArchived: true }`,
  throwing `ARCHIVED_SET`). `purge(id)` deletes for real; `listArchived()`,
  `capacity()` (per-set bytes/records vs the ceiling + a near-ceiling flag) and
  `versionStats()` back the Settings capacity card.
- `templates.js` — `createTemplateService({ store, docs, cache })`. `saveAsTemplate(setId, name)`
  snapshots a set's structure (record types, links, classifications — not live
  data) into a named template; `list`/`get`/`apply(templateId, name)` creates a new
  set from it; `duplicate(setId, name)` copies a set outright; `remove(id)`.
  `listBuiltin()` / `listAll()` fold in the shipped **starter templates** (below)
  and `apply()` seeds a starter's whole structure during the single
  `docs.create()` write (create-with-records), so applying one is one cloud
  round-trip rather than create-then-bulk.
- `orgTemplates.js` — the **starter** (built-in, code-defined) templates: four
  ready-made client documentation sets — **managed IT**, **hosted voice (VoIP)**,
  **internet / ISP circuit**, and a composed **full-service** superset
  (IT + voice + circuits). Each is a pure `{records, links}` definition (no stored
  document, so it can never be deleted), built with small `rec`/`asset`/`link`
  builders, merged by record key via `composeDefs()`, and self-checked by
  `validateStarterDefinitions()`. See *Starter templates* below.
- `organization.js` — the org/location catalogs and their schema. `ORGANIZATION_KINDS`
  (organization / department / business-unit) and `LOCATION_TYPES` (office / branch
  / site / datacentre / other); `ORGANIZATION_FIELDS` / `LOCATION_FIELDS` (the
  per-type add/edit form fields — `select`/`record`/`text`/`textarea`); `formatAddress`,
  `organizationDetailLine` + `locationDetailLine` (the table Details column); and
  `containmentIssues(set)` (missing/self parent, cycles, unknown kind/type).
- `contact.js` — the **contacts** module (task 8). `CONTACT_ROLES` (13 roles:
  client primary/technical/billing/after-hours, application owner, site manager,
  security officer, vendor rep/support, ISP/carrier, support desk, escalation,
  other), `CONTACT_METHODS`, `CONTACT_FIELDS` (role required; organization link;
  job title, email, phone/mobile/after-hours, preferred method, notes),
  `contactDetailLine` and `contactIssues` (unknown role / dangling organization).
- `configuration.js` — the **configurations** module (tasks 9–10). `CONFIGURATION_TYPES`
  (15 device types grouped server / endpoint / network / peripheral / security /
  infrastructure / other), `CONFIGURATION_FIELDS` (type required; manufacturer,
  model, serial, hostname, IPs, MAC, location link, asset tag, support/warranty
  expiry, notes), `parseIpAddresses`/`isValidIpAddress`/`invalidIpAddresses`,
  `configurationDetailLine`, and `configurationIssues` (unknown type / dangling
  location = error, malformed IP = warning). Task 10's **completeness engine**:
  `COMPLETENESS_RULES` (name, manufacturer, model, location, serial, MAC, IPs,
  expiry, credential link, hostname, asset tag), `DEFAULT_REQUIRED_FIELDS` (the
  classic nine), `normalizeCompletenessConfig`, `isRuleSatisfied`,
  `configurationCompleteness` / `isConfigurationComplete`, `makeExemption`,
  `recordExemptions`, and `completenessReport` (per-set roll-up).
- `standardized.js` — the **combined registry**: `RECORD_FIELD_SCHEMAS`
  (`organizations`/`locations`/`contacts`/`configurations`/`passwords`),
  `STANDARDIZED_TYPES`, `validateRecordFields` / `requireRecordFields` (throws
  `INVALID_DATA`; applied by docsets on add and update), `recordDetailLine`
  (dispatch by type), and `standardizedIssues(set)` (containment + contact +
  configuration + credential issues, unioned into `integrity()`).
- `store/index.js` — **version history**: `HISTORY_MAX = 25`; every write stores a
  `meta.history` descriptor; `history(id)`, `readVersion(id, n)` and
  `restoreVersion(id, n)` (restore is itself a new version, so history is never
  lost).

The Organizations station has grown the matching UI: Active/Archived tabs, cards
that badge+dash archived sets (with a Restore action), and a detail view with a
capacity strip, a read-only archived banner, standardized-field add-record modals
(plus the Details column on the standardized tables), and History / Duplicate /
Save-as-template / Archive actions. Tasks 8–10 add the matching surfaces: the
add-record dialog renders the contact-role / configuration-type schema for those
types, each configuration row shows an "Incomplete · N" badge (and a "· N N/A"
badge when rules are exempted), a **Config completeness** strip summarises the
set, an **Edit** dialog offers the standardized fields plus a per-rule exemption
editor (tick "not applicable" + a required reason), and a **Completeness rules**
dialog lets the required set be chosen per documentation set (with "Restore
defaults"). The Settings station renders eight cards — storage & sync, conflicts
(with a field-level diff table + Merge both), capacity, backup & restore,
templates, groups & permissions, integrity checks (see task 52) and the playbook
& reference (see task 53).

## Starter templates (org templates)

`src/framework/orgTemplates.js` ships four **built-in starter templates** so a new
documentation set can be created already holding a realistic, correctly-linked
structure instead of an empty shell. They are pure code definitions (no stored
document), surfaced everywhere a template is chosen and marked "Built-in" so they
can never be edited or deleted:

- **Managed IT client** (25 records) — the organization + head office; the
  primary/technical/after-hours contacts; the network and server estate; a
  credential; and the core services (internet, email, file sharing, backup,
  security, remote access, printing) linked to the assets they ride on.
- **Hosted voice (VoIP) client** (18) — the org + site; the voice platform and its
  SIP trunking; the circuit that carries it; the firewall/SBC and LAN behind it;
  plus a deployment runbook and a cutover checklist.
- **Internet / ISP circuit client** (21) — the org + site; a primary and a failover
  circuit; router/CPE and firewall; LAN + wireless; the upstream carrier; and the
  public domain + TLS certificate, with a provisioning runbook and checklist.
- **Full-service client (IT + voice + circuits)** (42) — a composed superset: the
  union of the three focused starters sharing ONE organization and head office, so
  the network, voice and circuit records interlink instead of duplicating.

Each starter is a `{ records, links }` definition: records carry the type, name,
information model and provenance every seeded record must have, plus their fields
(asset records are filled with the required fields of their built-in asset type);
links reference records by index with a declared relationship kind. `composeDefs()`
merges definitions by record key and de-dupes links. `validateStarterDefinitions()`
self-checks every definition (unique keys, known link kinds, link endpoints, index
bounds) and is asserted by `src/tests/org-templates.test.js`.

Applying a starter (`templates.apply(id, { name })`) creates the set and seeds the
whole structure in **one** store write — `docs.create({ records, links })` seeds via
`seedRecordsInto`, shared with `docs.addRecordsBulk`, so a from-template create is a
single cloud round-trip rather than create-then-bulk. The UI is the **New
documentation set** dialog on the Organizations station (a "Start from" list of
Blank set + the four built-ins, with a progress spinner on Create) and the
Settings → Templates card, which shows the built-ins with a "Built-in" badge and no
Delete action.

## Contextual help

Every station, every station detail view and every Settings section card carries a
small **"?"** button that opens a help panel written for exactly that screen — what
it is for, the common tasks with numbered steps, the key terms, tips and "See also"
links to related topics. The content is one plain-data catalog in
`src/framework/help.js`, keyed by a stable help key:

- a station's list view → the station id (e.g. `assets`);
- a station's detail view → `<station>:detail` (e.g. `assets:detail`);
- a Settings section card → `settings:<card>` (e.g. `settings:backup`).

The router calls `attachHelp(container, key)` after each station renders, injecting
the button into the station's `.kb-view-title-row`; Settings calls
`attachSectionHelp(body)`, which injects a button into each `.kb-settings-card`'s
section head from its `data-card` value. Both are graceful no-ops when a screen has
no authored help, so a new station without help content simply gets no button.
`openHelp(key)` renders the panel (replacing any panel already open, so "See also"
links step between topics). The catalog, its coverage of every screen, and the DOM
wiring are asserted by `src/tests/help.test.js` (9).

## Ask AI

Next to the "?" button, every station, station detail view and Settings section
card also carries an **Ask AI** button (a labelled pill, so it reads as an action
rather than a reference). It opens a question panel scoped to that screen: the
assistant answers from a compact, bounded digest of the live context for exactly
what is on screen — the client's records and relationships, an asset's fields,
the runbooks and coverage, the storage status — so "what credentials are about to
expire for this client?" is answered from the client being viewed, not from a
generic model.

- The context is built by `src/framework/ai-context.js`. `buildScreenContext(key,
  { ctx, sub })` takes the same key scheme as the help catalog (station id,
  `<station>:detail`, `settings:<card>`) plus the live services and returns
  `{ title, subtitle, digest, suggestions }`. The digest is plain text, capped at
  9,000 characters (a truncation line says how much was dropped), and **never
  includes credential material** — a secret is named, never rendered. Missing
  data degrades gracefully to the screen's help text rather than throwing.
- The panel lives in `src/framework/ai.js`. `attachAsk(container, key, { ctx,
  sub })` injects the button into the station's `.kb-view-title-row` (immediately
  left of the "?"), and `attachSectionAsk(body, { ctx })` injects one into each
  `.kb-settings-card`'s section head; both are no-ops for a screen with no
  context. `openAsk(key, { ctx, sub })` renders the modal — a context chip naming
  what is in scope, a streaming transcript, suggestion chips, and a composer
  (Enter sends, Shift+Enter newlines) with an Ask/Stop toggle plus Clear and
  Close actions.
- Generation goes through the ai-text-plugin (`root.generateText`). The prompt
  is assembled by `buildPrompt(context, turns, meta)` in a prefix-cache-friendly
  shape — the system preamble and the static screen context form the stable
  prefix, the conversation is append-only, and the task sits last — so follow-up
  questions on the same screen hit the model's prefix cache. When the transcript
  would exceed the model budget the oldest turns are dropped. Failures show a
  plain error bubble; the assistant says so when the answer is not in its context.
- The registry, coverage of every screen, digest bounds, prompt assembly/token
  trimming and the DOM wiring are asserted by `src/tests/ask-ai.test.js` (11).

## Appearance & themes

The whole UI is painted from CSS custom properties on `<html>` (`--primary`,
`--bg`, `--surface`, `--text`, …). A **theme** is just a map of those
properties, so applying one repaints the entire app with no per-component CSS.

- `src/framework/theme.js` is the engine. A theme has a light and a dark
  palette. The 16 **presets** each declare only an accent colour; `buildPalette`
  expands it into a full, coherent palette per mode (deriving
  `--primary-strong`/`--primary-soft`, a readable `--on-primary`, borders,
  overlays, toasts and the semantic tint families used by status badges and
  banners). `PRESETS` is the library (Indigo, Corporate Navy, Slate, Ocean,
  Teal, Emerald, Forest, Violet, Grape, Rose, Sunset, Amber, Nord, Solarized,
  Midnight, Monochrome); adding one is a single line.
- **Custom themes** edit the 16 editable tokens (`TOKEN_GROUPS`) per mode — each
  row is a native colour picker plus a hex field, previewing live as you type.
  A custom theme is saved under a name and can be re-applied or deleted. State
  (mode, active theme id, saved custom themes) persists to `localStorage` under
  `kb:theme:v1`; `applyTokens` writes the active palette as inline styles on
  `<html>` and sets `data-mode`.
- **Mode** is light / dark / system; `system` follows `prefers-color-scheme` and
  updates live. The header carries a sun/moon toggle (`#kbThemeBtn`) that flips
  light/dark from anywhere, and both the header and the Settings card stay in
  sync through `onThemeChange`.
- A boot snippet at the top of `index.html` reads the last resolved palette from
  `localStorage` and applies it **before first paint**, so a dark-mode session
  never flashes the light default. `bootScript()` in theme.js is the same shell
  and should be kept in step with it.
- The Settings UI is `src/modules/theme-view.js` (`renderAppearanceCard`), which
  mounts the shared `renderThemeControls` into an **Appearance & theme** card
  (first in Settings). The old header "online users" count pill was removed in
  favour of the theme toggle (`wireTheme` in `src/app.js`).
- Tests: `src/tests/theme.test.js` (13) — colour helpers, palette completeness
  for every preset/mode, token catalog, `applyTokens`, the mode/theme mutations
  and their persistence, the custom save/list/delete round-trip, and the DOM
  controls (mode switch, preset grid, hex/picker fields, save, saved list).

## Checklists, the flexible-asset template engine & the rich-asset model (tasks 11–16)

- `checklist.js` (task 11) — `createChecklist(...)`. A checklist is a record with
  an **ordered list of items** (`{ id, text, done, assignee, note, completedAt }`)
  supporting delegation (per-item assignee), completion tracking (`toggleItem`,
  `itemProgress`, `checklistProgress`, `isChecklistComplete`), reordering
  (`moveItem`), add/update/remove, validation (`validateChecklist` — non-empty
  title + no blank items) and reuse (`cloneChecklist`, `checklistFromItems`). Also
  the text/CSV serializers and `checklistDetailLine` used by the tables.
- `flexible.js` (task 12) — the customizable asset model. `FIELD_TYPES` is the
  field-type catalog (text, textarea, number, date, select/single-choice,
  multi-choice, checkbox, url, email, reference); `makeAssetType` /
  `normalizeAssetType` / `validateAssetType` define an asset type's **fields**
  (key, label, type, required, placeholder, options, `of` reference target) and
  its **allowed references**; `validateAssetRecord` / `normalizeAssetRecord` type
  and validate an instance against its type (required fields, choice options,
  reference targets), `assetRecordDetailLine` drives the tables and
  `flexibleIntegrityAudit(set, types)` reports unknown types / dangling refs.
  (Task 31 added `domains` to the referenceable record collections, so a template
  may point at a Domain tracker record.)
- `assetLibrary.js` (tasks 13–16) — the shipped **prebuilt template library**:
  `BUILTIN_ASSET_TYPES`, **seventeen** templates across Applications, Workforce,
  Commercial, Infrastructure, Security and Connectivity — including the required
  **Applications**, **Licensing** and **Virtualization** types plus the service
  templates used by later phases (Email, Backup, WAN/LAN/Wireless, Security,
  Remote Access, File Sharing, Printing, VoIP, Internet Circuit) and the task-14
  **User Role** and **Software Build** workforce types. Each carries its field
  set, icon, category and allowed references. Task 15 enriched **Applications**
  (vendor link, environment, support URL); task 16 enriched **Licensing**
  (start date, billing cycle, account number, renewal alert window, currency,
  and an expiry-flagged date field) and **Vendor** (website, support email,
  account-manager contact link), and flagged the expiry fields on the Security
  Platform and WAN Circuit templates. Task 31 rebuilt **Email system** into a
  full structured service — the shared platform/deployment/authentication/
  archiving/migration catalogs from `email.js`, mail-flow and MX fields, an
  anti-spoofing multiselect, and record-reference fields to its host
  configuration, mail application, primary domain, administrator credential and
  vendor. Tasks 32–34 rebuilt the Backup, Security Platform, Remote Access,
  Virtualization, File Sharing and Printing templates the same way, and replaced
  the coarse Network template with the three WAN/LAN/Wireless templates.
- `workforce.js` (task 14) — the workforce catalogs used by the User Role and
  Software Build templates: `WORKSTATION_TIERS` (standard / power / mobile /
  thin-client / kiosk / executive / virtual), `OPERATING_SYSTEMS` (Windows 11,
  Windows 10, Windows Server, macOS, Ubuntu, other Linux, ChromeOS), the id
  arrays, lookup/label helpers and `tierOptions()` / `osOptions()`.
- `email.js` (task 31) — the email vocabulary and audit: `EMAIL_PLATFORMS`
  (Microsoft 365, Exchange hybrid/on-premises, Google Workspace, Zimbra, MDaemon,
  hosted IMAP), `EMAIL_DEPLOYMENT_MODELS`, `EMAIL_AUTH_MECHANISMS` (SPF, DKIM,
  DMARC, MTA-STS, TLS-RPT, ARC, BIMI), `EMAIL_ARCHIVE_MODES`,
  `EMAIL_MIGRATION_STATES`, their lookup/label/id helpers and `*Options()`
  builders; plus `emailCoverage(record, set)` (which relation groups are linked)
  and `emailSystemIssues(set)` (the completeness audit the Linter folds in).
- `backup.js` (task 32) — the backup vocabulary and audit: `BACKUP_ARCHITECTURES`,
  `BACKUP_DEPLOYMENT_MODELS`, `BACKUP_DESTINATIONS` (with `isOffsiteDestination`
  and `OFFSITE_DESTINATION_IDS`), `BACKUP_SCHEDULES` and `BACKUP_TEST_RESULTS`,
  their lookup/label helpers and `*Options()` builders; plus
  `backupCoverage(record, set)` and `backupIssues(set)` (the completeness audit
  the Linter folds in).
- `network.js` (task 33) — the network vocabulary and audits: the WAN service
  kinds and circuit types, LAN architectures and cabling, wireless standards,
  security modes (with `isSecureWirelessMode`), authentication methods and bands,
  their lookup/label helpers and `*Options()` builders; plus `wanServiceCoverage`
  / `lanCoverage` / `wirelessCoverage`, the three audits (`wanServiceIssues`,
  `lanIssues`, `wirelessIssues`) and their combination `networkServiceIssues(set)`.
- `serviceAssets.js` (task 34) — the security/remote-access/virtualization/
  file-sharing/printing vocabulary and audits: security-platform types and
  deployment models, remote-access methods, virtualization platforms,
  file-storage types and protocols, and printing device types and print service
  models, with their lookup/label helpers and `*Options()` builders; plus the
  five coverage helpers and audits (`securityPlatformIssues`, `remoteAccessIssues`,
  `virtualizationIssues`, `fileSharingIssues`, `printingIssues`) and their
  combination `serviceAssetIssues(set)`.
- `library.js` (task 35) — the **in-application service library**: the catalog of
  service processes and operational topics. `LIBRARY_TOPICS` (nine shelves —
  onboarding, email, backup, network, security, voice, internet, endpoint,
  operations) and `LIBRARY_AUDIENCES` (provider process / technician runbook /
  client-facing). `LIBRARY_ARTICLES` is the catalog of markdown articles, each
  declaring its topic, audience, tags, the shipped asset templates it supports
  (`assetTypeIds`), the document type it reads as (`docTypes`) and its related
  articles — the cross-links the rest of the app surfaces it by. Reads:
  `libraryArticle` / `libraryArticleExists`, `libraryArticles({topic, audience,
  assetTypeId, docType, query, ids})`, `searchLibrary`, `libraryForAssetType`
  (the asset profile) and `libraryForDocType` (the document editor),
  `relatedLibraryArticles`, `libraryStats` and `libraryAssetTypeIds`. The
  "usable as written or adapted" half: `articleDocumentType` picks the article's
  first *real* document type, `articleToDocumentInput(article, overrides)` shapes
  it into the input `docs.addDocument` accepts (validated by `validateDocument`),
  and `articleInsertionText(article)` produces the header block an article is
  appended into an existing document with.
- `runbook.js` (task 37) — the **runbook model and VoIP runbook generator**: the
  type/status/field catalogs and validation, the revision/version helpers, the
  sixteen-section VoIP deployment-runbook generator and its coverage/audit
  functions (see the section above).
- `cutover.js` (task 38) — the **cutover-checklist model and VoIP cutover
  generator**: the phase and required-check catalogs, the 22-step shipped
  template, `generateVoipCutoverChecklist`, the per-phase progress and coverage
  roll-ups, the acceptance/sign-off vocabulary and helpers, the
  `cutoverIssues` integrity audit and the phase-grouped text renderer (see the
  section above).
- `voipCoverage.js` (task 39) — the **VoIP relationship & lifecycle coverage**
  layer: the coverage-group and requirement catalogs, the relationship/field
  resolver (`voipRequirementRecords`), the relationship and lifecycle coverage
  evaluations, the per-deployment report the Deployments panel renders, and the
  deduplicated `voipCoverageIssues` Linter audit (see the section above).
- `circuit.js` (task 40) — the **resold-circuit model and reseller service
  definition**: the access-technology, sourcing, SLA-target, CPE-role and
  service-definition tier catalogs; committed/burst bandwidth and contention
  helpers; IPv4/CIDR parsing and the addressing summary (subnets, static IPs,
  usable count, reverse-DNS hostname); the local-date-safe contract helper; the
  pricing/margin helper; `circuitProfile` (the normalised view) and
  `circuitDefinitionDrift` (sold tier vs configured bandwidth/SLA);
  `circuitDependents`; and the `circuitIssues` Linter audit (see the section
  above).
- `circuitProvisioning.js` (task 41) — the **resold-circuit provisioning &
  activation workflow**: the phase, record-target and step catalogs (each step
  naming the records it updates), the resolver that maps a target to the actual
  linked/field-referenced records, the record and phase coverage helpers,
  `generateCircuitProvisioningRunbook` (the runbook generator) and the
  `circuitProvisioningIssues` Linter audit (see the section above).
- `addressing.js` (task 42) — the **circuit CPE, addressing, DNS/reverse-DNS,
  VLAN/segmentation and firewall documentation**: the VLAN purpose vocabulary and
  `parseVlanLines`/`segmentationSummary`, the reverse-DNS helpers
  (`ipv4ToPtrName`, `reverseZoneForIp`, `reverseZoneForCidr` with RFC 2317
  classless delegation), `circuitAddressingPlan`, `circuitEdgeRecords` (the CPE,
  firewall/security, LAN, domain, certificate and remote-access records),
  `circuitAddressingCoverage`, the `addressingIssues` Linter audit and
  `generateCircuitAddressingRecord` (the client-technical document generator;
  see the section above).
- `billing.js` (task 43) — the **reseller commercial model, usage and data-cap
  documentation**: the billing-cycle / proration / data-cap-period /
  overage-treatment / usage-source catalogs, `normalizePeriod` and
  `parseUsageReadings` (`circuitUsage` aggregation), `billingProfile` (cost vs
  sell and margin, cycle, cap normalised to a monthly allowance, annualised
  figures), `usageReconciliation` (cost drift, over/near cap, overage estimate,
  stale readings, `flags`/`ok`), `clientBillingSummary`, the `billingIssues`
  Linter audit and the `generateCircuitBillingRecord` /
  `generateClientBillingRecord` document generators (see the section above).
- `circuitMigration.js` (task 44) — the **circuit cutover, migration &
  decommission runbooks**: the scenario / phase / required-verification / step
  catalogs, `migrationRecords` (the records to update or archive, with a
  per-scenario action), `migrationImpact` (the dependent-service blast radius,
  the records, the address change and the findings),
  `generateCircuitMigrationRunbook` (the migration/decommission runbook
  generator), `generateCircuitMigrationChecklist` with
  `migrationChecklistCoverage`/`migrationPhaseProgress`/`formatMigrationText`
  (the scenario-aware cutover checklist) and the `circuitMigrationIssues` Linter
  audit (see the section above).
- `search.js` (task 45) — the **cross-set search & relationship-navigation
  engine**: `recordSearchText` / `buildSearchIndex` / `buildCombinedIndex` (the
  flattened, secret-safe search index over one or many clients),
  `searchRecords` / `searchFacets` (token AND-match, name-over-body ranking and
  the six filters with counts), `recordNeighbors` / `relationshipGraph` /
  `shortestPath` (the radial typed-link graph and BFS pathfinding across a
  record's relationships) and the `summarizeRecord` / `typeLabel` / `modelLabel`
  panel labels (see the section above).
- `linter.js` (task 46; storage-model checks in task 47) — the **documentation
  quality linter**: the `LINT_SEVERITIES` / `LINT_CHECKS` catalogs with
  `lintCheck`/`severityRank`/`severityLabel`, the seven checks
  (`lintConfigurationCompleteness`, `lintServiceCoverage` with
  `KNOWN_SERVICES`/`requirementSatisfied`, `lintDocumentDuplication` with
  `isStructuredToken`/`structuredTokens`, `lintExpiryAttention`,
  `lintOrphanRecords` with `ORPHAN_AUDIT_TYPES`, `lintStaleRecords` with
  `DEFAULT_STALE_DAYS`, and the task-47 storage-model checks
  `lintFreeTextStructure`/`lintStructuredProse`/`lintAssetAsNote`/
  `lintDuplicatedValues` via `lintStorageModel`, built on `scanStructuredValues`
  and `isProse`/`noteFieldPairs`), and the
  `summarizeLint` / `lintDocumentationSet` / `lintAllSets` assemblers that group
  findings by severity, check and record and tag each with its set id (see the
  sections above).
- `linterFixes.js` (task 48) — the **one-click fix engine** that turns a
  finding's `fix` descriptor into a write. `CUSTOM_ASSET_TYPE_ID` names the
  general `custom` template a converted note/free-text record lands in
  (`assetLibrary.js`); `linkKindsFor` / `pickLink` choose the relationship kind
  for a proposed link (natural direction, then the reverse, or `null` when the
  strict catalog cannot join the two types); `fixPlan(finding)` describes what a
  finding's fix would do (`auto`, what it `needs` — a `value` or a `target`
  record — and whether it is `destructive`); `canAutoFix` is the single-click
  predicate; and `applyLintFix(ctx, finding, opts)` performs it — fill a missing
  field, create the link, extract prose into a Document (then link it back and
  stub the field), create a structured asset from a document's identifying
  values, or convert a note into a structured asset and re-point its surviving
  links. It never touches credential material.
- `linterReport.js` (task 48) — the **saved & exported linter report**:
  `buildLintReport(result, { sets, title, generatedAt, notes })` turns a
  `lintAllSets` result into a severity-grouped report object (clients, checks,
  totals, `ok`, `rowCount`) under the `LINT_REPORT_SCHEMA` version;
  `reportToMarkdown` / `reportToCsv` render it, `reportFilename` names the
  download and `reportSummaryLine` is the one-line summary. The report is built
  from finding messages and suggestions only, so it is safe to hand to a client
  or publish.
- `publication.js` (task 49) — the **bundle-publication engine**. The shared
  envelope (`PUBLICATION_SCHEMA` / `PUBLICATION_KIND`), `BUNDLE_TYPES`
  (documentation / deployment) and `PUBLICATION_TARGETS` are the contract a
  downstream assistant or knowledge base reads. `normalizeRedaction` /
  `DEFAULT_REDACTION` encode the default-deny posture; `redactRecord` /
  `redactForPublication` (which keeps a relationship only when both endpoints
  survive, and aggregates the withheld counts) omit credentials unless opted into
  a metadata-only summary and never write secrets; `scrubText` /
  `findLeakedSecrets` remove PEM keys, `otpauth` secrets and labelled secrets
  from prose and scan a value for leaks; `buildDocumentationBundle` /
  `buildDeploymentBundle` assemble the sections; `serializePublication` /
  `validatePublication` (which REFUSES a leaky bundle) / `publicationFilename` /
  `bundleSummaryLine` / `withheldSummary` render and check it; and
  `createPublicationService({ store, cache, upload, now })` adds the hosted
  upload + the bounded export log (`buildDocumentation`, `buildDeployment`,
  `publish`, `listLog`, `removeLogEntry`, `clearLog`).
- `packet.js` (task 50) — the **printable-packet engine**, built on top of the
  task-49 bundles so packets inherit the same default-deny redaction. Defines
  `PACKET_SCHEMA` / `PACKET_KINDS`; `buildDocumentationPacket` /
  `buildDeploymentPacket` (with `deploymentScopeLabel`) assemble a title, subtitle,
  client, timestamp, redaction summary and ordered `{ heading, markdown }` blocks;
  `packetToMarkdown` / `packetToHtml` (`{ html, toc }`) / `packetToStandaloneHtml`
  (a self-contained printable document with embedded `STANDALONE_CSS`) render it;
  `formatPacketDate` / `packetSummaryLine` / `packetFilename` are the helpers; and
  `createPacketService({ store, cache, upload, generatorName, now, getAssetTypes })`
  adds `buildDocumentation` / `buildDeployment` / `host` (upload + bounded log at
  `PACKET_LOG_KEY`) / `listLog` / `removeLogEntry` / `clearLog` / `loadSet`, plus
  re-exports of the render helpers.
- `field.js` (task 51) — the **field-access engine**: the staged-write
  recognisers (`isStagedWrite`, `stagedWriteNotice`, `pendingDraftsSummary`), the
  connectivity tracker (`createConnectivity({ store, onChange })` /
  `connectivitySummary`), the field-checklist step helpers (`setChecklistStepDone`
  / `toggleChecklistStep` / `nextOpenStep`) and the field-query parser/matcher
  (`parseQuickQuery` / `quickSearch` / `quickChips` / `QUICK_QUERY_HELP`) over the
  task-45 combined index (see the section above).
- `integrity.js` (task 52) — the **integrity-check suite**: `INTEGRITY_CHECKS` /
  `INTEGRITY_RUNNERS` for the six checks (classification, relationships,
  required-fields, orphans, credentials, exports), the per-check functions
  (`integrityClassification` / `integrityRelationships` /
  `integrityRequiredFields` / `integrityOrphans` / `integrityCredentials` /
  `integrityExports`), `runIntegritySuite(set, {now})` (never throws — a failed
  check becomes `status: "error"`) / `runIntegritySuiteAll(sets, {now})`, and the
  `integrityStatusLabel` / `integritySummaryLine` / `integrityReportToMarkdown`
  renderers.
- `fixtures.js` (task 52) — the **fixture documentation sets** used to exercise
  the integrity checks: `buildTspDemoFixture()` (a healthy all-model client) /
  `buildLegacyFixture()` (schema `itu-docset/0` with deliberate gaps),
  `FIXTURE_SPECS` / `fixtureSpec` / `buildFixtureSet` / `fixtureCatalog` /
  `fixtureModelCoverage`, and `seedFixture(docs, id, {name, createdBy})` (writes
  a fixture through the ordinary `create` / `addRecord` / `linkRecords` API).
- `playbook.js` (task 53) — the **content-model reference and extension
  playbook**, derived from the live catalogs so it cannot drift: the
  `contentModelReference()` / `provenanceReference()` / `relationshipReference()`
  sections, the curated `RELATIONSHIP_CONVENTIONS` / `DEPLOYMENT_FLOW` /
  `REDACTION_RULES`, the `EXTENSION_KINDS` / `extensionGuides()` /
  `extensionGuide(id)` checklists (new asset type / template / service runbook /
  export), `playbookCoverage()`, `PLAYBOOK_FILES`, and `playbookToMarkdown()`
  (the generator for `src/PLAYBOOK.md`).
- `flexibleTypes.js` (task 12) — `createFlexibleTypeService({ store, cache })`:
  the **shared, global template library** (one versioned `asset-type-library`
  document, so types are available to every client). API: `load`, `list`,
  `get`, `peek`, `libraryMeta`, `assetTypeOptions`, `create`, `update`,
  `cloneType`, `remove`, `reset` (restore a builtin to shipped defaults),
  `restoreLibrary` (re-add any missing builtins), `exportType` / `parseExport` /
  `importType` (share a template as portable JSON), and `isBuiltin`. House
  standards = edit a builtin (it is marked `customized`) or clone it; Reset puts
  it back to the shipped definition. The library is stamped with
  `ASSET_LIBRARY_VERSION`; `load()` runs a guarded, once-per-session
  `reconcile()` that upgrades an older library — adding missing shipped
  templates, refreshing non-`customized` builtins, removing shipped templates
  that are no longer shipped (retired builtins, unless customised), and
  preserving custom types and user customisations. `libraryMeta()` returns
  `version` + `shippedVersion`.
- `assetRelations.js` (tasks 14–16, 31–34) — the **named relationship groups** that
  give a record's links a human shape instead of one flat list. `RELATION_GROUPS`
  declares the groups for the applications / licences / vendor / user-role /
  software-build types (e.g. Vendor, Covered applications, Account contacts,
  Documents), the ten task-31 email-system groups (Hosting & mail flow, Mail
  applications, Mail domains, Credentials, Documents, Security & filtering,
  Vendor, Licensing, TLS certificates, Owner & contacts), the task-32/33/34
  structured-service groups (the backup service's protected systems and storage;
  the WAN/LAN/Wireless groups; and security/remote-access/virtualization/
  file-sharing/printing, e.g. a security platform's Protected configurations,
  Remote access protected, Wireless/WAN/Email/File sharing protected,
  Credentials, Vendor, Licensing and Documents); `relationGroupsFor(type)` returns them, falling back to one generic
  group per reference collection (`asset-reference`); `groupLinks(record, set,
  type)` buckets a record's links into `{ groups, leftovers, total }`;
  `linkParamsFor` / `relationCandidates` drive the per-group "+ Link" picker and
  `isGroupedType` says whether a type has named groups.
- `renewals.js` (tasks 15–16) — the **expiry / renewal engine**. `expiryFieldOf(type)`
  finds a type's expiry-flagged date field; `parseDate` / `isoDate`;
  `alertDaysFor` reads a record's own renewal window (default
  `DEFAULT_ALERT_DAYS = 60`, `DUE_SOON_DAYS = 14`); `renewalStatus(record, type, {now, alertDays})`
  returns `{ field, date, iso, daysUntil, alert, state }` where state is one of
  `none` / `ok` / `upcoming` / `due-soon` / `overdue`; `renewalsReport(entries, typeOf, {...})`
  rolls a whole set up into `{ items, attention, counts, total }`; `renewalPhrase`
  renders the human wording.
- `guidance.js` (task 14) — the **"structured vs documents" steerage**.
  `STRUCTURED_GUIDANCE` contrasts what belongs in a structured asset with what
  belongs in a long-form document; `TOPIC_KEYWORDS` maps common topics to asset
  types; `suggestAssetTypes(text, types, { limit })` scores a free-text
  description against the library so the Documents station can suggest "make
  this a structured asset instead".

The **Assets** station (`src/modules/assets.js`) is now a real surface: a library
grid of template cards (category tabs, summary chips, per-card Edit / Clone /
Reset / Export / Delete), a type-detail view (field table, allowed references,
instances across clients), the wide **template designer** modal (name, category,
icon, description, a repeating field-row editor with per-field help text and a
"renewal / expiry date" toggle on date fields, required toggles and the
allowed-references checkboxes), and an **Import template** modal. The library view
also carries a **renewals board** (task 16): a summary chip row plus a card of
overdue / due-soon / upcoming renewal rows, each colour-coded and linked to its
record. `asset-fields.js` renders a schema-driven record form (one control per
field type) used by both the instance dialog and the client-side record editor.
Instance and flexible-asset rows open the **asset profile** (`asset-profile.js`,
`openAssetProfile(ctx, { setId, record, type, reload })`): a modal with the
record's badges, a Fields table, a Renewal card when the type is expiry-tracked,
and its **grouped relationships** — one section per named group (Vendor, Covered
applications, Account contacts, Documents, …) with per-group "+ Link" and
per-record "Unlink", falling back to generic reference groups. Checklists get
`checklist-view.js` (the ordered task-list editor with per-item assignee +
completion) and are surfaced in Organizations alongside the other standardized
record tables; flexible-asset instances also appear there with a template badge
and open the typed instance editor.

The **Documents** station (`src/modules/documents.js`, task 14) is no longer a
scaffold: it renders a **structured-vs-documents guidance panel** (what belongs in
a structured asset versus a long-form document) and a "What are you documenting?"
tool that takes a free-text description, runs `suggestAssetTypes`, and offers the
best-matching library types as one-click "create this asset" buttons — the
"steer users toward structured assets" requirement — alongside the station's
empty state.

## Credentials & the security model (tasks 17–19)

Passwords are a **standardized record type** like organizations and
configurations, so the whole credential estate can be listed, filtered, audited
and (in the export phases) redacted consistently:

- `password.js` (task 17) — the credential model. `PASSWORD_SCOPES`
  (`general` / `embedded`), `PASSWORD_CATEGORIES` (15: local-admin, domain-admin,
  service-account, user-account, application, database, network-device, wireless,
  email, cloud-service, backup, voip, api-key, certificate, other),
  `PASSWORD_PERMISSIONS` (view / use / edit / rotate / share) with
  `DEFAULT_PASSWORD_PERMISSIONS` and `DEFAULT_INHERITED_PERMISSIONS` (the safe
  minimum), and `PASSWORD_FIELDS` (the schema driving both the add/edit dialog and
  the Details column). A **general** credential stands alone, links to many
  assets and carries its own permission set; an **embedded** credential is created
  inside an owner's context (its `embeddedIn` reference points at one of the
  ownable collections — configurations, flexibleAssets, organizations, locations,
  documents, checklists, trackers, runbooks) and **inherits** the owner's
  `credentialPermissions` (falling back to the safe minimum). `validatePassword` /
  `requirePassword` are shape-only (unknown scope/category, malformed owner
  reference and unusable OTP secret are refused); `effectivePermissions(record,
  set)` resolves the permission set in force; `passwordDetailLine`, `credentialsFor`,
  `generalCredentials` / `embeddedCredentials`, `redactPassword` (over `SECRET_FIELDS`
  = secret + otpSecret) and `passwordIssues` (the integrity audit — unknown
  scope/category, embedded with no/dangling owner, malformed OTP = warning,
  unknown rotation path) round it out.
- `otp.js` (task 18) — dependency-free one-time passwords: a synchronous SHA-1 +
  HMAC-SHA-1, Base32 encode/normalize/decode (`normalizeOtpSecret`,
  `decodeBase32`, `encodeBase32`), `validateOtpSecret` (clear, specific errors for
  empty / bad characters / too short), the RFC 4226 `hotp` and RFC 6238 `totp` /
  `generateOtp` (six digits, 30s period, returns `{ code, counter,
  secondsRemaining, expiresAt }`), `verifyOtp` with a configurable skew window,
  `otpAuthUrl` (the `otpauth://` enrolment URI) and `randomOtpSecret`. Verified
  against the published RFC test vectors.
- `credentialTools.js` (task 19) — password generation and the rotation hooks.
  `CREDENTIAL_CHARSETS` + `generatePassword(...)` (length-clamped, guarantees one
  of each enabled class, optional ambiguity avoidance, injectable RNG),
  `passwordStrength` (entropy bits + a 0–4 score + label), the rotation catalog
  (`ROTATION_METHODS` = manual / connected-product; `ROTATION_PRODUCTS` = the
  common password managers, vaults and secret stores), `rotationCapability` (the
  product is required for a connected path), `rotationStatus` (tracked / due /
  overdue / days-until against a per-record interval, accepting a timestamp or a
  `YYYY-MM-DD` string) and `ROTATION_DISCLAIMER` — the honest statement that
  rotation capability depends on the connected product and IT-U itself does not
  change passwords.
- `docsets.js` — the credential convenience flow: `addEmbeddedCredential(setId,
  owner, input, opts)` forces `scope: "embedded"`, stores the owner, then creates
  the `password-embedded-in` ownership link in one step; `credentialsFor(setId,
  owner)` and `credentialPermissions(setId, ref)` read them back.
- `relationships.js` — three credential kinds were added: `password-organization`,
  `password-location` and `password-embedded-in` (alongside the existing
  `application-password` and `configuration-credential`).

The UI is `src/modules/credential-view.js` — the wide credential dialog
(`openCredentialDialog`) opened from a password row in the Organizations station
and, for an embedded credential, from an asset profile's **Credentials**
group's "+ Add credential" button (`asset-profile.js`, which pre-fills the
owner and locks the scope to embedded). The dialog carries the Credential /
Login / Second factor / Permissions / Rotation / Notes sections: a Reveal/Generate
password field with a live strength meter, a validated OTP-secret field showing
the live six-digit code with a per-second countdown, inherited permission chips
for an embedded credential versus checkboxes for a general one, and the rotation
path with its product picker and disclaimer. `organizations.js` renders the
credential table (Details line via `passwordDetailLine`) with an **Open** action,
and its `buildStandardizedFields` now renders `password`, `multiselect`,
`checkbox`, `number` and `record`-with-`of` controls.

## Groups & access (task 20)

Two modules, split pure from stateful:

- `src/framework/groups.js` — PURITY. The catalogs (`ACCESS_LEVELS` =
  organization / asset / document / general-password / administrative;
  `ACCESS_ACTIONS` = view / use / edit / create / delete / rotate / share /
  administer) and `ACCESS_MATRIX`, which declares which actions may be granted at
  which level (e.g. `general-password.rotate` is valid, `asset.rotate` is not).
  A permission is a `level.action` token (`permissionToken`, `parsePermission`,
  `isKnownPermission`, `permissionLabel`, `allPermissions`). The shipped groups
  (`BUILTIN_GROUPS`: Administrators, Technicians, Help desk, Viewers, Credential
  custodians) and the `ROLE_GROUPS` role→group map; group normalization /
  validation (`normalizeGroup`, `validateGroup`, `requireGroup` — unknown
  permissions are refused, never stored) and the union helper
  `combinePermissions`. Resource mapping: `levelForType` (records → level) and
  `credentialActionLevelAction`, which folds a credential action onto the owning
  record's level (view/use → view, edit/rotate/share → edit) so an embedded
  credential has no independent grant.
- `src/framework/access.js` — `createAccessService({ store, cache, getRole,
  now })`. Persists the group library as ONE versioned document
  (`access-groups`, schema `itu-access-groups/1`) seeded from the shipped groups,
  with self-repair so a corrupt library can never lock the owner out. Library API:
  `load/peek/list/get/libraryMeta/create/update/clone/remove/reset/restoreLibrary/
  assignGroups/groupsFor/groupId`. Authorization: `resolvePrincipal` (owner /
  local ⇒ everything; an object actor is honoured; a string maps through
  `getRole`), `effectiveAccess` (union of the role-default group, explicitly
  assigned groups and every group whose member list names the principal),
  `resolveResource` (an embedded password resolves through its owner),
  `can(principal, { action, level, record, set })` — never throws, and applies a
  SECOND gate for credentials, requiring the record's own (or its owner's
  declared) `effectivePermissions` to include the action — `require(...)` which
  throws `StoreError(FORBIDDEN)`, and `describe(...)` (a per-action allow map for
  the UI). `LEVELS`/`ACTIONS`/matrix are re-exported so there is one source of
  truth.

Enforcement lives in `docsets.js`: `createDocSetService({ store, cache, access })`
gates `create` (organization.create), `addRecord` (create at the record's level —
except a new embedded credential, which needs `edit` on its owner),
`updateRecord` (edit), `removeRecord` (delete), `remove`/`rename`
(organization.edit/delete) and `configureCompleteness`
(administrative.administer) through `access.require(opts.actor, …)`. The check is
skipped when no access service is configured OR the caller passes no `actor`, so
single-user local mode and every existing test degrade gracefully. Two new
methods make the credential acts first-class: `revealCredential(setId, ref,
{action:"view"|"use"})` and `rotateCredential(setId, ref, input)`.

`src/app.js` builds the service and wires the role lookup to the realtime hub
(offline/absent ⇒ owner; connected ⇒ the signed-in identity's hub role, everyone
else a viewer until an administrator assigns groups), injects it into the docs
service, the router context (`ctx.access`) and `window.__kb.access`.
`src/modules/groups-view.js` renders the **Groups & access** card in Settings
(group rows with Shipped badges, permission/member counts, Edit/Clone/Reset or
Delete) and the group editor (name, description, members, and the permission
matrix built from `ACCESS_LEVELS` × `ACCESS_MATRIX`). `credential-view.js` gates
Reveal/Generate/OTP display and Save on `ctx.access.describe(actor, { record,
set })` and shows an access banner; `organizations.js` passes the actor on every
gated mutation.

## Documents, SOPs & deployment procedures (tasks 21–22)

Long-form documents are records of the standardized `documents` type, defined by
`src/framework/document.js`. `DOCUMENT_TYPES` is the catalog of ten types — the
seven procedure/reference kinds (`installation-procedure`, `troubleshooting`,
`help-desk`, `recovery`, `operational-notes`, `client-technical`,
`public-instruction`), plain `reference`, and the two **standard-procedure**
types `sop` and `deployment` (`SOP_TYPES`; `isSopDoc(record)` is the test the UI
and validation share). Each type carries its section group, icon, a default
review interval, a `checklistProne` hint and a seeded markdown template
(`documentTemplate(docType)`); `documentsOfGroup(group)` splits them into the
four sections the Documents station renders (Procedures / Standard procedures /
Reference / Client-facing).

Validation (`validateDocument`, wired into `standardized.js` as the `documents`
schema): a document must declare a known `docType`; a **SOP or deployment must
carry a body** (they are procedures, so they can never be saved blank, though
`addDocument` seeds the template); `reviewIntervalDays`, when set, must be
positive; `tags` normalize to a deduped list. `documentReviewStatus(record,
{now})` computes none / due / ok / due-soon / overdue against the interval and
`reviewedAt`, and `documentIssues(set)` adds the audit findings
(`unknown-document-type`, `sop-missing-body`, `document-review-overdue`,
`prose-could-be-checklist`).

The **task-21 rule** lives in `extractProcedureSteps(body)` (reads ordered-list
steps, skips fenced code and checkbox lists, falls back to `##` headings) and
`checklistSuitability(record)` (a procedural type + ≥3 steps, or a long
procedural body): where a procedure fits a checklist better than prose,
`documentToChecklist` creates a linked `checklists` record from the steps and a
`document-checklist` relationship, recording the source document in the
checklist's `origin`.

**Independent versioning** is the task-22 requirement made real: `saveDocument`
snapshots the *previous* state into `record.revisions` (capped at
`DOCUMENT_HISTORY_MAX`) and bumps `revision`, so every document carries its own
history separate from the set's version. `documentVersionList` returns the
revisions oldest-first with the current one flagged; `restoreDocumentRevision`
writes an old revision back as a **new** revision (nothing is lost);
`markDocumentReviewed` stamps `reviewedAt`/`reviewedBy`.

Documents link through six relationship kinds (`relationships.js`):
`document-organization`, `document-asset`, `document-service`,
`document-location`, `document-checklist` and `document-related` — so a
deployment procedure is discoverable from the asset or service it concerns.

The service functions live in `docsets.js` (`addDocument`, `saveDocument`,
`documentRevisions`, `restoreDocumentRevision`, `markDocumentReviewed`,
`documentToChecklist`) and are exposed on `root.__kb.docs`. The UI is
`src/modules/documents.js` (the Documents station: per-set grid + guidance +
suggester on the list, grouped document sections on the set detail, and the
"+ New document" dialog) and `src/modules/document-view.js`
(`openDocumentEditor` — the wide editor modal: title/type/summary/tags/review
form, markdown textarea with live preview and template/clear toolbar, the
checklist-suitability banner, the typed link picker, and the revision rail with
restore; the Organizations station's Documents table row opens it). The editor
is a fixed-height scroll region with pinned Save/Cancel so it stays usable at
phone and desktop widths. Tests: `src/tests/documents.test.js` (12).

## Sites, diagrams & the lifecycle trackers (tasks 23–25)

**Task 23 — sites, diagrams & source files.** A **site summary** is a
standardized record (`src/framework/site.js`) describing one physical facility
(datacentre, comms room/MDF, colocation, office, branch, warehouse, other) as the
structured facts a technician needs before walking in the door: the location
reference plus access/hours, power, cooling, connectivity/entry, security,
environment and emergency/escalation notes. `SITE_FIELDS` drives the shared form,
`siteDetailLine` the table Details line and `siteIssues` the audit (unknown type
= error, no location = warning, dangling location = error).

A **diagram** record (`src/framework/diagram.js`) is one drawing *and, crucially,
both its editable source and its rendered versions* — the task's "keep the
editable source alongside any rendered version" rule. `DIAGRAM_TYPES` covers
network/rack/logical diagrams, site maps, floor plans, infrastructure images and
other; `RENDITION_FORMATS` (png/jpg/svg/webp/pdf/other, with an `image` flag) and
`SOURCE_FORMATS` (draw.io, Visio, Lucidchart, OmniGraffle, Sketch, PSD, XML,
other) describe the two halves. `render.*` helpers (`normalizeRenditions`,
`makeRendition`, `addRendition`, `removeRendition`, `primaryRendition`,
`renditionLabel`, `hasEditableSource`) back the editor's rendition list, and
`diagramIssues` enforces the rule: renditions with no source = warning,
source with no rendition = info. New relationship kinds (`site-location`,
`site-contact`, `site-diagram`, `site-asset`, `diagram-location`,
`diagram-asset`, `diagram-document`) tie sites and drawings into the graph.

The UI is `src/modules/site-view.js` (`openSiteView` — header, standardized
fields, a diagrams gallery fed by `site-diagram` links, and a "new diagram"
dialog that creates a diagram record and opens its editor) and
`src/modules/diagram-view.js` (`openDiagramEditor` — the diagram fields plus the
rendition block: upload through `root.uploadPlugin` or paste a URL, image
thumbnails, remove, and the diagram's links). Sites are reached from the
Organizations station's Sites table.

**Tasks 24–25 — the lifecycle trackers.** The **Trackers** station is no longer a
scaffold: it lists the client documentation sets and, for a chosen set
(`#/trackers/<id>`), shows a KPI row (domains, certificates, expired, due soon, no
date recorded), a soonest-first **renewal outlook**, and the domains and SSL
certificates tables — each row carrying an expiry badge and an Open action.

- `src/framework/domain.js` (task 24) — the domain record: registrar, registrant,
  DNS provider, registration status, expiry, auto-renew, DNSSEC, name servers and
  a per-record alert lead time. `DNS_RECORD_TYPES` (A/AAAA/CNAME/MX/TXT/NS/SOA/
  SRV/CAA, with numeric codes and priority flags), `normalizeDomainName` /
  `isValidDomainName`, the DNS-record helpers (`normalizeDnsRecords`,
  `makeDnsRecord`, `dnsRecordsOfType`, `dnsSummary`) and `domainExpiryStatus`
  (overdue / due-soon / upcoming / ok / none against `renewalAlertDays`, default
  60, due-soon 14). `lookupDomain(value, { fetchImpl })` does a best-effort live
  lookup: DNS entries over **DNS-over-HTTPS** (Cloudflare, `Accept:
  application/dns-json`) and registration details over **RDAP** (`rdap.org`),
  folding both into `{ dns, registration, errors }`. Every failure is collected,
  not thrown, so a partial result is still useful. The lookup is isolated behind
  an injectable `fetchImpl` so it is unit-tested without touching the network.
- `src/framework/certificate.js` (task 25) — the certificate record: host and
  port, subject, subject alternative names, issuer, serial, signature algorithm,
  key type, valid-from/to, SHA-256 fingerprint, a `protectedServiceRef` (a
  configuration, flexible asset or domain) and a `privateKeyRef` pointing at a
  **password** record (the key is never inlined — it inherits the credential
  model's access rules). `normalizeHostname` / `isValidHostname` / `isWildcard`,
  `subjectAltNames` / `coversHostname` (a `*.` wildcard covers exactly one level),
  `certificateExpiryStatus` (default lead 30, due-soon 14) and
  `certificateIssues` (invalid host, expired, expiring, no date, and a dangling
  private-key or protected-service reference). `lookupCertificate(value, {
  fetchImpl })` reads the **public** details from the Certificate Transparency
  logs (`crt.sh?output=json`), choosing the newest entry whose common name
  matches, again behind an injectable `fetchImpl`.

The two trackers' editors live in `src/modules/tracker-view.js`
(`openDomainEditor` — the domain fields plus a draft DNS-record list and the
"Look up DNS & registration" button; `openCertificateEditor` — the certificate
fields, SAN chips and "Look up certificate"). Both lookups show a confirmation
modal listing the proposed changes and any errors; **nothing is written until the
user applies it**. New kinds `domain-credential`, `domain-asset`,
`certificate-credential` and `certificate-service` join the graph. Tests:
`src/tests/site-diagrams.test.js` (12) and `src/tests/trackers.test.js` (17).

## Lifecycle & integrations (tasks 26–28)

**Task 26 — expiry aggregation (`src/framework/lifecycle.js`).** Task 16's
renewals engine watches one kind of thing (a flexible asset's renewal date);
task 26 gathers *every* dated item in a client's documentation set into one
place. `LIFECYCLE_KINDS` is the catalog — one entry per kind of dated item,
naming the record collection + field it comes from, its default lead time and
due-soon window. `collectLifecycle(set, opts)` walks the set, extracts each dated
item, classifies it (overdue / due-soon / upcoming / ok / none) against its
effective lead time and returns the items plus the roll-ups (by kind, by group,
by source asset) that the Trackers station renders. Two kinds are resolved
dynamically: a flexible asset's expiry field depends on its template (an injected
`typeOf` resolver), and a document's next review date is computed from its
cadence — both folded into the same item shape. The module is pure (no storage /
network); it reuses `renewals.js`'s date and state vocabulary.

**Task 27 — expiry workflow & notification engine
(`src/framework/workflow.js`).** Turns the aggregated lifecycle data into work:
due-soon and overdue queues, owner assignment, escalation once an item has been
overdue long enough, and a record of action taken (`LIFECYCLE_ACTIONS` — assigned
/ noted / renewed / snoozed / escalated / dismissed). Lead times are configurable
per item kind (`DEFAULT_LIFECYCLE_CONFIG`), and the renewal schedule is
exportable. "Notification" is the surfaces the Trackers station renders — the
attention queues, escalation markers and exportable schedule; no transport is
invented. The workflow state (config + assignments + action log, capped at
`ACTION_LOG_MAX`) is a plain object persisted under `set.lifecycle` by the
documentation-set service, so it version-travels with the client's documentation.

**Task 28 — PSA/RMM synchronization (`src/framework/integration.js`).** A
connected PSA or RMM is modelled as an *integration definition* stored on the set
(alongside `lifecycle`); a sync is a deterministic transformation. A provider
adapter — `{ sync({integration, entities}), push({…}) }` — yields plain remote
records; the engine reconciles them against the set's records matched by external
id in `origin`. `INTEGRATION_KINDS` (psa / rmm / identity / other),
`SYNC_DIRECTIONS` (pull / push / both / off) and `SYNC_ENTITIES` (organizations /
contacts / configurations) are configurable per integration, as is each entity's
field map (`DEFAULT_FIELD_MAPS`). `applySync` / `applyPull` / `applyPushResult`
update a record that already carries the integration's external id in place,
*adopt* a name-matched record when the integration opts in, and otherwise create
a new integration-managed record (informationModel `integration`, provenance
`synchronized`) — never a duplicate. `makeSyncRun` / `runSummaryLine` produce the
run log. The provider is injected, so the engine is fully testable without a live
API and a real PSA/RMM client is just another object of that shape.

The UI is in the **Trackers** station (`src/modules/lifecycle-view.js` — the
lifecycle queues, per-item dialog with owner/escalation/snooze/action-log, the
by-asset roll-up, the configurable schedule and `exportRenewalSchedule`) and the
new **Integrations** station (`src/modules/integrations.js` — per-set cards with
KPIs, per-integration cards showing kind, enabled state, per-entity direction
badges and last-run line, a recent-runs table, and an add/edit dialog for the
kind, match-on, base URL, credential, enabled/prune flags, type map and per-entity
direction + field map; a clearly-labelled simulated provider fabricates
deterministic remote data, while `docs.syncIntegration(setId, id, {provider})`
accepts a real adapter). The docs-service methods (`integrationsStateOf`,
`listIntegrations`, `integrationRuns`, `addIntegration`, `updateIntegration`,
`removeIntegration`, `syncIntegration`) live in `src/framework/docsets.js`; state
is at `set.integrations`. Tests: `src/tests/lifecycle.test.js` (13),
`src/tests/workflow.test.js` (13) and `src/tests/integration.test.js` (15).

The **Import** station (`src/modules/import.js`) exposes the task-29 bulk-import
wizard on top of the pure `src/framework/importer.js` engine, and the docs-service
methods `importRecords` and `importHistory` (state at `set.imports`). Tests:
`src/tests/import.test.js` (15). The **Integrations** station also carries the
task-30 **Record governance** surface (managed records, authoritative system,
integration-owned fields, drift, and a conflict-resolution dialog) over the
governance helpers in `src/framework/integration.js`; tests:
`src/tests/governance.test.js` (13). The task-31 **email-system asset** — its
shared vocabulary in `src/framework/email.js`, the enriched shipped template and
its labelled relationship groups — ships with tests:
`src/tests/email.test.js` (7).

## Sync, conflict & concurrency

`createSyncEngine({ store, cache })` in `src/framework/store/sync.js`. Public
API: `reconcile()`, `stageDraft(id, data, opts)`, `listDrafts()`,
`listConflicts()`, `resolveConflict(id, "mine"|"theirs"|"merge")`,
`getDocStatus(id)`, `getOverview()`, `attach(store)`. Wired in `src/app.js`:
reconcile runs on boot, and Home renders the sync card — summary, per-doc
status, conflict rows (Keep mine / Keep theirs / Merge), and "Check for updates".

- **Reconcile** refreshes the local cache against the canonical registry,
  auto-pushes offline-staged drafts (when the canonical hasn't moved), and
  detects conflicts. Nothing is ever silently discarded.
- **Offline / concurrent writes** never clobber the canonical: a write that
  fails to reach the cloud is preserved as a **draft**; a write that lands but
  finds the canonical moved becomes a **conflict** with BOTH sides preserved.
- **Resolution** (`resolveConflict`): keep-mine writes the draft (bumps the
  version past theirs); keep-theirs adopts the canonical (mine recorded in
  history); merge does a field-level 3-way merge (`merge3`: scalars — the side
  that changed it wins; arrays/objects — unioned by key, so each side's unique
  additions survive). Every resolution is appended to a per-doc resolution
  history in cache.
- **Deleted-remote** is reported as its own state; the local copy is retained,
  never auto-deleted.
- **Chunks are never destroyed on delete** — only the registry entry goes; the
  content-addressed chunk files stay as inert orphans (a stale registry read
  can therefore never find destroyed content).
- **Editable-channel gotcha:** the live channel serves ~10s+ stale reads after
  a write. The store defends with a session-authoritative registry merge
  (re-assert own writes only over provably-stale reads) so a sequential write
  is never misreported as a concurrent conflict.

## Architecture

- **`main.pjs`** — `$meta` (IT-U) + the `kb` boot config (app title/short title,
  tagline, storage namespace `kb-system`) + plugin imports. Editable content lives
  in the app's document store, not here.
- **`index.html`** — static shell only: header (logo, search, account button +
  light/dark theme toggle + settings shortcut — the old connection/status pills
  were retired in task 57), sidebar
  (station
  navigation via `#moduleNav`), main view, toast container. Also hosts the
  **server-plugin script** (`<script type="text/x-server-plugin">`): the
  authoritative hub server — users, sessions and tokens, the durable **scoped**
  role table (store format v2; task 54), the SSO provider configuration (store
  format v3; task 58), the change ring carrying each change's
  scope, the ephemeral editing-presence registry (`claimEdit`/`getEditors`;
  task 55), the edit-key table and the rate limits. Its `canDo` gate authorizes
  every mutating RPC server-side. No client logic in the shell markup itself.
- **`src/app.js`** — boot: applies the saved theme, fills header, renders the
  station nav, starts the hash router (default route `#/organizations`), wires
  the hub (roles, role-gated header actions) and the theme toggle, exposes
  `window.__kb` for tests/debug (`store`, `sync`, `router`, `toast`, `hub`,
  `theme`, `config`, …).
- **`src/kb-config.js`** — normalizes `root.kb` into plain JS (with defaults).
- **`src/framework/`** — the module framework:
  - `dom.js` — `h()` element builder, selectors, `clear`, `esc`, `tick`.
  - `icons.js` — inline SVG icon set (incl. the station icons).
  - `states.js` — the ONE consistent set of empty/loading/error states.
  - `toast.js` — transient notifications.
  - `modules.js` — module registry + hash router (`resolve`, `start`; takes a
    `defaultId`).
  - `help.js` — the contextual-help catalog + renderer. Every station, station
    detail view and Settings card carries a "?" button that opens help written
    for exactly that screen (`attachHelp` / `attachSectionHelp` / `openHelp`;
    invoked by the router and by Settings). See "Contextual help" below.
  - `ai-context.js` — the per-screen context digests the **Ask AI** assistant
    answers from. `buildScreenContext(key, { ctx, sub })` turns a screen key (the
    same scheme as help.js) plus the live services into a bounded plain-text
    digest of the client/asset/section on screen — records, relationships,
    config completeness, lifecycle dates, runbooks, storage status — never
    including credential material. See "Ask AI" below.
  - `ai.js` — the **Ask AI** button and its question panel: `askButton` /
    `attachAsk` / `attachSectionAsk` inject the button next to the "?" help
    button, and `openAsk` renders a streaming chat scoped to that screen through
    the ai-text-plugin, with a prefix-cache-friendly prompt (`buildPrompt`). See
    "Ask AI" below.
  - `theme.js` — the appearance system: light / dark / system mode, the preset
    theme library (16 themes, each expanded into a coherent light **and** dark
    palette by `buildPalette`), and user-authored custom themes edited
    colour-by-colour (a hex field + picker per editable token) and saved by name.
    Applying a theme writes CSS custom properties onto `<html>`; a boot snippet in
    index.html applies the saved theme before first paint. See "Appearance &
    themes" below.
  - `nav.js` — station nav renderer + the mobile drawer (`openDrawer`/`closeDrawer`).
  - `hub.js` — the Phase 9 realtime-hub client (`createHub(...)`): connect/
    reconnect, register/login/logout/change-password + token re-auth, role
    helpers, admin RPCs, live change events (de-duplicated by sequence),
    scoped change broadcasts (`announce`), editing presence (`claimEdit` /
    `watchScope` / `editors`), presence, shared edit keys, and the polling
    fallback when the hub is unreachable.
  - `account.js` — the account modal + `renderAccountButton` for the header.
  - `idp.js`, `sso.js` — the identity-provider / SSO layer (task 58; see the
    section above). `idp.js` is the pure OIDC model (provider presets and
    normalization, claim extraction, username slugging, group → role rules,
    discovery, JWKS sanitizing, PKCE and the demo signer); `sso.js`
    (`createSsoService`) drives the browser half — the authorize redirect, the
    popup and its `postMessage` callback, the code exchange, discovery and the
    simulator. The popup's landing page is `src/sso-callback.html`, and the trust
    boundary (token verification, account provisioning, scoped-role replacement)
    is the `ssoLogin` RPC in the server script in index.html.
  - `markdown.js` — markdown renderer, heading/TOC extraction, link parsing.
    **Retained framework primitive** for later document phases.
  - `diff.js` — line-level diff. **Retained framework primitive** for later
    review/merge phases.
  - `docsets.js`, `classification.js`, `relationships.js`, `ids.js` — the IT-U
    documentation-set layer (tasks 2–4; see the section above).
  - `organization.js`, `contact.js`, `configuration.js`, `standardized.js`,
    `archive.js`, `templates.js`, `store/backup.js` — the standardized record
    model (org/location + contacts + configurations + the combined registry and
    completeness engine), archival, templates and backup/restore (tasks 5–10;
    see the section above).
  - `checklist.js`, `flexible.js`, `assetLibrary.js`, `flexibleTypes.js`,
    `workforce.js`, `assetRelations.js`, `renewals.js`, `guidance.js` — the
    checklist model, the flexible-asset field/record model, the shipped prebuilt
    template library, the global template service, the workforce catalogs, the
    named relationship groups, the expiry/renewal engine and the structured-vs-
    documents guidance (tasks 11–16; see the section above).
  - `password.js`, `otp.js`, `credentialTools.js` — the credential model, the
    one-time-password generator/validator and the password generation + rotation
    hooks (tasks 17–19; see the section above).
  - `document.js`, `site.js`, `diagram.js`, `domain.js`, `certificate.js` — the
    document model and its SOP/deployment rules (tasks 21–22), the site-summary
    and diagram models with the editable-source rule (task 23), and the domain +
    SSL-certificate models with their best-effort live lookups (tasks 24–25; see
    the section above).
  - `lifecycle.js`, `workflow.js`, `integration.js` — the unified lifecycle /
    expiry aggregation layer (task 26), the expiry workflow & notification engine
    (task 27) and the PSA/RMM synchronization engine (task 28; see the section
    above).
  - `email.js`, `backup.js`, `network.js`, `serviceAssets.js`, `voice.js` — the
    structured service library's shared vocabulary and completeness audits
    (tasks 31–34, 36; see the section above).
  - `runbook.js` — the runbook model and the VoIP deployment-runbook generator
    with its coverage/audit functions (task 37; see the section above).
  - `library.js` — the in-application service library: the topic/audience
    catalogs, the article catalog and the cross-link/adaptation reads (task 35;
    see the section above).
  - `roles.js`, `access.js` — the IT-U role/scope model (viewer / technician /
    administrator granted at a repository, client or service scope,
    most-specific-wins) and the scope-aware authorization service every gate
    consults (task 54; see the section above).
  - `collab.js` — the collaborative-editing model: record content stamps, the
    four-way remote-change classification, the three-way merge, and the
    editor-presence helpers (task 55; see the section above).
  - `audit.js` — the multi-user audit & rate-control model: the canonical action
    / group / rate-bucket catalogs, audit classification and sentence
    rendering, the trail summary and filter, and the rate-snapshot summary
    (task 56; see the section above).
  - `store/` — the canonical document store (above), now with per-document
    version history (`history`/`readVersion`/`restoreVersion`).- **`src/modules/`** — the fourteen IT-U stations, one file each: `organizations`,
  `assets`, `documents`, `trackers`, `services`, `library`, `deployments`,
  `integrations`, `import`, `search`, `linter`, `exports`, `settings`, `status`, plus `station.js` (the shared station
  scaffold:
  `createStation({id,label,desc,icon,capabilities,emptyTitle,emptyDesc})`) and
  `shared.js` (generic view helpers) + `index.js` (registry). A module is
  `{ id, label, desc, icon, render(ctx), renderDetail(ctx, sub), hidden }` — a
  module may implement `renderDetail(ctx, sub)` to take over a `#/<id>/<sub>`
  sub-route (Organizations does, for `#/organizations/<setId>`; Trackers does, for
  `#/trackers/<setId>`). `organizations`, `assets`, `documents`, `trackers` and
  `integrations`, `library`, `deployments` and `linter` are real stations, and `settings`
  is a real station (ten control cards); the remaining two — `services`,
  `linter`, `exports` — are scaffolds built with `createStation`. `settings` is
  backed by its control cards including `roles-view.js` (people & access) and
  `activity-view.js` (activity & rate control). `status` is a real station —
  the live connection / cloud store / realtime hub / synchronization surface
  (task 57); the header's old Online and Cloud pills now live there. `deployments`
  is backed by `runbook-view.js` (the runbook editor modal, with the shared
  collaborative-editing strip + conflict banner from `collab-bar.js`). `assets` is backed by `asset-fields.js` (the
  schema-driven field form), `asset-profile.js` (the record profile modal with
  grouped relationships) and `checklist-view.js` (the ordered checklist editor);
  `organizations` is backed by `credential-view.js` (the credential dialog,
  opened from a password row and from an asset profile's Credentials group);
  `documents` is a custom station (the structured-vs-documents guidance + asset
  suggester); `trackers` is backed by `tracker-view.js` (the domain and
  certificate editors with their live lookups), `site-view.js` (the site summary
  and diagrams gallery) and `diagram-view.js` (the diagram editor with its
  rendition list and source uploads); `trackers` also renders the lifecycle
  surface (`lifecycle-view.js`); `integrations` is backed by its own station
  module (the sync-integration list, detail, add/edit dialog and run log).
  `search` is
  a custom station (reads
  `window.__kb.pendingSearch`). Add a station: create the file (usually via
  `createStation`), export it from `index.js` — nav + routing pick it up.
- **`src/styles.css`** — full stylesheet; responsive (sidebar → mobile drawer at
  ≤820px, content max-width 1500px, prose max-width 900px) + `.kb-station*`
  scaffold styles + the rich-asset section (renewal board/chips/badges, the asset
  profile modal, relationship groups/items, the structured-guidance columns and
  the asset suggester), plus the credential dialog (scope/owner, secret +
  strength meter, OTP digit boxes + countdown, permission chips and the rotation
  disclaimer), plus the lifecycle section (attention queues, state badges, the
  workflow dialog, the renewal schedule) and the integrations section
  (integration cards, per-entity direction badges, the sync-run log), plus the
  people/access and activity/rate sections (session rows, the network pills, the
  rate counters and the audit trail with its filter chips and tone dots), with a
  `≤720px` responsive pass.
- **`src/tests/`** — the test suites. `harness.js` is the mini runner: `runTests`
  takes `{name, fn, skip?}` cases, supports a per-test `timeoutMs`, and returns
  `{passed, failed, skipped, total, failures, skips}`; `skip(reason)` reports a
  case as skipped instead of silently passing. `testFixtures.js` builds the
  shared in-memory world (`makeWorld` / `makeAccessWorld` / `makeBackends` /
  `assertThrowsCode`) so a suite only names its namespace and the services it
  needs. `run-all.js` imports and runs every suite in one call and aggregates
  the result.
  Run everything in the live page:
  `await import("./src/tests/run-all.js").then(m => m.runAll())` (add
  `{live:true}` to let store.test.js make its real cloud round-trip; otherwise
  it reports as skipped). A single suite is
  `await import("./src/tests/theme.test.js").then(m => m.run())`.
  The `ui-*.test.js` suites exercise the DOM modules against the real document:
  `ui-shared` (view panel, breadcrumb, dialogs, format helpers), `ui-station`,
  `ui-std-fields`, `ui-asset-fields` and `ui-groups-view`.
  Current (650 total across 66 suites): **store 12 +1 skip, docsets 10,
  documents 12, classification 8, relationships 8, sync 17, sync-backup 11,
  versioning 9, organization 8, contact 5, configuration 6, completeness 8,
  shell 10, checklist 8, flexible 8, template-library 6, org-templates 8,
  structured-assets 5, applications 5, licensing 5, passwords 6, otp 6,
  credential-tools 5, access 9, site-diagrams 12, trackers 17, lifecycle 13,
  workflow 13, integration 15, import 15, governance 13, email 7, backup 7,
  network 7, service-assets 7, library 8, voice 7, runbook 9, cutover 9,
  voip-coverage 7, circuit 10, circuit-provisioning 8, circuit-addressing 10,
  billing 11, circuit-migration 13, search 13, linter 18, linter-fixes 9,
  publication 11, packet 11, field 13, integrity 14, playbook 9, roles 13,
  collab 12, audit 10, help 9, ask-ai 11, theme 13, idp 25, sso 15,
  ui-shared 9, ui-station 5, ui-std-fields 6, ui-asset-fields 5,
  ui-groups-view 5**.

## The content layer (`src/framework/content.js`) — REMOVED (superseded)

> **Superseded.** The KB content layer, the category tree, and the KB content
> documents were removed when IT-U's station shell replaced the KB shell. The
> reference below is retained as a record of the framework the app is built on;
> the IT-U content model is defined by the roadmap and built task by task.

Everything above the raw store: `createContentService({ store, cache, activity,
uploadPlugin, generatorName, announce })`. `announce` is an optional Phase 9 hub
hook called after any article-affecting mutation (fire-and-forget) so other open
sessions see a live "updated" event with the true actor. `cache` = kv-backed cache for the namespace;
`activity` = a second kv folder for per-device state (article "seen" timestamps,
follows, checklist ticks). Public API (via `window.__kb.content` / `ctx.content`):
`readDoc`, `writeDoc`, `listArticles`, `getArticle`, `saveArticle`,
`createArticle`, `deleteArticle`, `submitForReview`, `approveArticle`,
`returnArticle`, `markReviewed`, `sendForReReview`, `consistencyCheck`,
`backlinks`, `related`, `search`, `audit`, `backup`, `restore`, `capacity`,
`getCategoryTree`, `getTemplates`, `getSnippets`, `feedback`, `bundleForArticle`,
`refreshBundles`, `publishBundlesPublic`, `getBundles`, `integrityCheck`.

### Article record shape

    { id, title, summary, body, tags[], categoryId, docType, owner, status
      (draft|in_review|published|archived), created{at,by}, updated{at,by},
      reviewedAt, reviewIntervalDays, publishedVersion, versions[{n,at,by,summary,data,status}],
      attachments[], blocks[], links[], processRefs[], feedback[], flags{} }

`normRecord(r)` copies/normalizes — always use it rather than mutating a record
returned by `getArticle` (it is a live reference into the store cache; mutating
it before `saveArticle` corrupts the version diff).

### Document-type templates (task 8)

`templates` document holds one template per doc type. Editor applies the
template's body skeleton on new-article creation:
- **sop** — `# Purpose`, `## Scope`, `## Prerequisites`, `## Procedure`
  (numbered steps), `## Roles & responsibilities`, `## Safety & compliance
  notes`, `## References`
- **policy** — `# Purpose`, `## Policy statements`, `## Compliance &
  enforcement`, `## Review`
- **how-to** — `# Overview`, `## What you need`, `## Steps`, `## Troubleshooting`
- **reference** — `# Overview`, `## Definitions`, `## Details`
- **faq** — `# Questions` with `## question` headings

### Structured SOP blocks (task 9)

SOP articles can carry `blocks[]` = `{ step, ownerRole, expectedOutcome, safety,
notes, checklist[] }`. Editor renders a structured block editor ("+ Add step",
per-step fields + checklist items); the reader renders them as ordered steps with
a checkable checklist; print output emits a printable step-by-step form.

### Review workflow (task 13)

Lifecycle: `draft` → `in_review` (submitForReview, records submitter+time) →
`published` (approveArticle) or back to `draft` (returnArticle, with reviewer
comment). `publishedVersion` pins the version shown as live; when a published
article is edited again it goes to `in_review` with a **pending revision** —
readers keep seeing the last approved version until a reviewer approves the new
one. Transitions are recorded in `reviewLog` and `auditLog`.

### Review scheduling (task 16)

Each article has `reviewIntervalDays` + `reviewedAt`. Articles whose
`reviewedAt + interval < now` appear in the **Stale Content** queue with days
overdue. "Reviewed — no change" calls `markReviewed` (refreshes `reviewedAt`,
keeps version); "Send through workflow" (`sendForReReview`) routes it back to
`in_review`.

### KB bundles (tasks 26, 27)

`refreshBundles()` writes the `kbBundles` document:

    { schema: "kb-bundles/1", updatedAt, count,
      manifest: { format: "kb-bundle/1", generatedAt, generatorName, version },
      articles: { <id>: { schema:"kb-bundle/1", id, title, summary, categoryId,
                          categoryPath, tags, docType, body, version,
                          publishedVersion, updatedAt, permalink:"#/article/<id>",
                          status } },
      categoryIndex: { <categoryId>: [articleIds] } }

Refreshed on every publish (fire-and-forget). `publishBundlesPublic()` additionally
publishes the whole set as ONE plain editable file (`kb-system-bundles`) so any
consumer (AI assistants, scripts) can fetch a single URL
`https://editable.uploads.dev/file/<generatorName>/kb-system-bundles` without
knowing the chunk layout. Idempotent — republishing identical content is a no-op.

### Cross-linking, backlinks, related (tasks 11, 20)

`[[Title|id]]` in markdown = article link. Editor inserts these via a
search-as-you-type picker; `markdown.js` parses them out of bodies; every
article shows a **backlinks** list (who links to it) and **related** articles
from shared tags/category + term overlap.

## Module user workflows (historical — KB modules removed)

> **Superseded.** These screens belonged to the KB content modules
> (`home`/`browse`/`review`/`stale`/`reports`/`article`/`editor`/`admin`), which
> were removed. IT-U ships the eleven station scaffolds instead; equivalent
> workflows are built by the roadmap's later phases.

- **Home** — KPIs: articles by status, stale count + oldest overdue, published
  this month, most-updated, recent activity (each clickable through to its
  source), system-health banner (integrity check result), sync & conflicts card.
- **Browse** — category tree + facet filters (category, tag, doc type, status)
  and sort (recently updated / reviewed / popularity); in-list search.
- **Search** — full-text over title/summary/tags/body, ranked by relevance +
  recency, snippets with matching context, no-results state with "Did you mean"
  term suggestions.
- **Review Queue** — submitted articles with base/target version pickers and a
  line-level diff; Approve & publish or Return with comment (goes back to draft).
- **Stale Content** — overdue articles with days overdue; mark reviewed or send
  through workflow.
- **Reports** — KPIs + system health, coverage by category, review compliance %,
  activity by author, low-rated/commented articles, recent activity; CSV export
  and print for any list/report.
- **Article reader** (route `#/article/<id>`) — breadcrumb, TOC from headings,
  structured SOP steps + checklist, backlinks, related, feedback (was this
  helpful 👍👎 + free text), version history (view/restore), follow button with
  "updated since seen" indicator, copy-link permalink.
- **Editor** (route `#/editor/<id>` or `#/editor/` new) — title/summary/body,
  tags, category, owner, doc type + template, review interval; markdown toolbar
  (B/I/H2/H3/lists/checklist/code/link/article-link/snippet/image), live preview
  + TOC chips, structured SOP blocks, attachments, cross-link picker, snippets
  picker, AI draft / polish / what-changed, pre-submit consistency check,
  Save draft / Save & submit.
- **Admin** — 9 tabs: Backup & restore, Capacity & archive, Categories
  (add/rename/move/delete), Templates, Snippets, Identity, Audit log (searchable),
  Users & roles (hub users: grant/revoke roles per category, ban/unban, refresh —
  admins only, enforced server-side), Integrations (bundle publication + process
  links).

## Checklist: adding a new document type

1. Add it to `DOC_TYPES`/`DOC_TYPE_LABELS` in `src/framework/content.js` and the
   editor's `docTypeSel` options (`src/modules/editor.js`).
2. Define its template (body skeleton + structured-blocks section, if any) in the
   `templates` document (Admin → Templates) and the AI outline in `docTypeBlurb()`.
3. If it needs structured blocks, mirror the SOP `blocks[]` handling in the
   editor + reader (or reuse `blocks[]` directly).
4. Make sure it flows through retrieval export automatically — bundles are
   doc-type-agnostic (`bundleForArticle` includes `docType`), so nothing extra
   is needed for task 26/27.
5. Register in navigation/reports — doc types appear in facet filters and
   reports automatically from `listArticles()`; add any report rows in
   `src/modules/reports.js`.

## Phase 9: multi-user roles & the realtime hub

Everything in Phases 1–8 works single-user with zero hub code. Phase 9 layers a
`server-plugin`-based hub (`createServerSocket` imported in `main.pjs`) on top so
a team can share one KB with roles and live updates. **While the generator is
unsaved (or the hub is otherwise unreachable) it degrades gracefully to the same
single-user local mode** — roles only apply once a session is authenticated, and
the editor falls back to a 12s document-store poll for remote changes.

### How it fits together

- **`index.html` server script** — the authoritative hub. Durable `state`
  layout: user table (username → password-hash/roles/flags + last-seen), token
  table, a seq-stamped change ring, an audit ring, and a shared edit-key table.
  Handlers: `register`, `login`, `auth` (token), `logout`, `changePassword`,
  `grantRole`, `revokeRole`, `setBanned`, `listUsers`, `checkAction`,
  `announceChange`, `getChanges`, `subscribeCat`, `getPresence`,
  `getOnlineUsers`, `storeEditKey`, `getEditKey`. Pubsub topics: `kb:all` (every
  connected conn subscribes on open) and `cat:<categoryId>` (subscribed via
  `subscribeCat`).
- **Roles & authorization** — every RPC that changes something re-checks the
  caller's server-side session (`canDo(s, action, cat)`, banned first).
  `checkAction` is what the UI gates on (`ctx.hub.authorize`/`require`), but
  nothing is trusted client-side: all writes happen through RPCs that verify
  roles again. Offline ⇒ `authorize` returns `{allow:true, reason:"local"}` so
  the single-user app is never blocked by hub absence.
- **Admin bootstrap** — the server embeds only the SHA-256 of a generated
  high-entropy admin password. Anyone who registers/logs in with that password
  becomes admin. The plaintext is delivered to the owner out-of-band (in the
  agent's final report) — it is **not** stored in any file. If the plaintext is
  ever lost, regenerate: pick a new 32+ byte random password, put its SHA-256 in
  `ADMIN_PASSWORD_SHA256`, and deliver the plaintext to the owner again.
- **Edit keys (multi-writer documents)** — the upload-plugin editable files can
  only be updated by the creator's edit key. The hub keeps a shared edit-key
  table: any writer with a write role reports its keys (`storeEditKey`) and can
  fetch keys it lacks (`getEditKey`), and `syncEditKeys()` pushes the device's
  known keys on connect/login — so the whole team can update the same documents.
  The client keyStore in `src/app.js` prefers `hub.getEditKey` before falling
  back to its local copy, and reports new keys to the hub after creating docs.
- **Concurrent editing** — `ctx.hub.watchArticle(id, cat, read, cb)` (used by
  the editor and the article reader) filters for that article's change events,
  ignores the current user's own announces and stale versions, and shows a live
  banner ("Updated by X just now" → Load updated copy / Dismiss). Watches are
  auto-cleaned via `ctx.onUnmount`. When the hub is down, `watchArticle` also
  starts a polling fallback that watches the document store directly.
- **Rate control** — per-conn and per-`conn.net`-group limits on register/login/
  grant/announce/action/getChanges/edit-key RPCs; registration is stricter for
  proxy connections (`conn.isProxy`). Sessions are ephemeral and rebuilt from
  tokens on reconnect.

### Server-script security notes

The `<script type="text/x-server-plugin">` element is **public source** — every
client can read it. Never put secrets there (or anywhere client-visible). The
embedded `ADMIN_PASSWORD_SHA256` is only safe because the real password is high
entropy. The hub uses a plain synchronous SHA-256 (server handlers cannot use
`crypto.subtle`/`TextEncoder`/imports). Password hashes in the user table are
stored as raw bytes; `hashToRaw()` converts the hex digest for byte-compare.

### Production caveat

Real multi-user requires the generator to be **saved** (the unsaved preview runs
a single-document local emulator: same code, but no cross-tab multiplayer and
state resets on reload). Production server sockets also only work on
perchance.org (embedded-on-other-site frames get closed with `4403`).

## Module ctx

Every module's `render(ctx)` receives: `{ kb, providers, states, toast, modules,
container, mod, current, navigate, go, store, sync, content, hub, docs, backup,
archive, templates, integrity, onUnmount }`.
`hub` is the Phase 9 realtime hub (null/offline-safe — guard with
`ctx.hub && ctx.hub.connected`); `onUnmount(fn)` registers a cleanup that the
router calls when the module is navigated away from (used to unsubscribe live
watches). `states.empty/loading/error(...)` return ready-made state cards —
always use them instead of ad-hoc markup.
