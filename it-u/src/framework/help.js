// src/framework/help.js — the contextual help system.
//
// Every station, every station detail view and every Settings card carries a
// small "?" button that opens help written for exactly that screen. The content
// lives here as a single catalog keyed by a stable help key:
//
//   • a station's list view        → the station id            (e.g. "assets")
//   • a station's detail view      → "<station>:detail"        (e.g. "assets:detail")
//   • a Settings section card      → "settings:<card>"         (e.g. "settings:backup")
//
// Help entries are plain data — no markup — so they can be tested and edited
// without touching rendering code:
//
//   { title, tagline, what:[…], tasks:[{title, steps:[…]}], fields:[{name,desc}], tips:[…], see:[{label, key|hash}] }
//
// attachHelp() is called by the router after a station renders (see
// framework/modules.js), and attachSectionHelp() by a multi-card page such as
// Settings. Both are graceful no-ops when a screen has no authored help, so
// adding a new station without help content simply means it gets no button.

import { h } from "./dom.js";
import { openModal } from "../modules/shared.js";

// The help panel currently open (if any), so a "See also" link can replace it.
let current = null;

export const HELP = {
  // =========================================================================
  // Stations — list views
  // =========================================================================
  organizations: {
    title: "Organizations",
    tagline: "Every client, department or business unit you document — one versioned document per client.",
    what: [
      "See every documentation set in the repository, split into Active and Archived.",
      "Create a new set — blank, or pre-filled from a built-in starter template.",
      "Open a set to work on its records.",
    ],
    tasks: [
      {
        title: "Create a client",
        steps: [
          "Click New documentation set.",
          "Type the client, department or business unit name.",
          "Pick a starter template (Managed IT, Hosted voice/VoIP, Internet/ISP circuit or Full-service) or start blank.",
          "Click Create — the set is written to the cloud and opened for you.",
        ],
      },
      {
        title: "Open a client",
        steps: [
          "Find it in the Active list (use the search box when the list is long).",
          "Click its name — this opens the client's record view.",
        ],
      },
      {
        title: "Archive a retired client",
        steps: [
          "Open the client's set.",
          "Use the set's state control to archive it.",
          "Archived sets move to the Archived tab, stay fully readable and restorable, and free working capacity.",
        ],
      },
    ],
    fields: [
      { name: "Documentation set", desc: "The single JSON document holding one client's every record, with typed links between them. It is versioned, so changes are tracked." },
      { name: "Starter template", desc: "A built-in (or your own saved) bundle of record types and example records a new set is seeded from." },
      { name: "Active / Archived", desc: "Active sets are in day-to-day use; archived sets are retired clients kept for reference." },
    ],
    tips: [
      "A set is the unit of storage, sync and backup — one client, one set.",
      "The starter template is only a beginning; add and edit records freely afterwards.",
    ],
    see: [
      { label: "Working inside a client", key: "organizations:detail" },
      { label: "Assets & templates", key: "assets" },
    ],
  },

  "organizations:detail": {
    title: "Working inside a client",
    tagline: "One versioned document holding every record for this client, grouped by type and linked together.",
    what: [
      "Every record in the set, grouped by record type — organizations and contacts, configurations & devices, credentials, documents, domains, certificates, applications and more.",
      "Add, open, link, unlink and remove records.",
      "A completeness reading for configurations and other rule-driven types.",
    ],
    tasks: [
      {
        title: "Add a record",
        steps: [
          "Scroll to the section for the record type you want.",
          "Click Add.",
          "Fill the fields — every record carries an information model (how it is structured) and a provenance (where the fact came from).",
          "Save; the record is added to this set and written to the store.",
        ],
      },
      {
        title: "Link two records",
        steps: [
          "Open a record, or use its link action.",
          "Choose a relationship kind — the kinds are typed and directional (runs on, protects, supplies, depends on, owns…).",
          "Pick the target record.",
          "Save; both records now show each other under Relationships.",
        ],
      },
      {
        title: "Open a record's full editor",
        steps: [
          "Use the row's Open action.",
          "Documents open the document editor; domains and certificates open the tracker editor; credentials open the credential dialog; asset instances open the asset profile.",
        ],
      },
      {
        title: "Remove a record",
        steps: [
          "Use the row's remove action and confirm.",
          "Links to and from the record cascade away, so no dangling references are left behind.",
          "Deletion is reversible only by restoring a backup.",
        ],
      },
    ],
    fields: [
      { name: "Information model", desc: "How a record is structured — core asset, flexible asset, document, integration or none. Records missing a model are flagged by the Linter." },
      { name: "Provenance", desc: "Where the fact came from — authored, imported, synchronized, related, external or attachment. It travels with the record." },
      { name: "Typed link", desc: "A named, directional relationship between two records. Links are what make traversal from a record to its neighbours possible." },
      { name: "Completeness", desc: "A per-record check (for example, a server must name its OS and hostname) shown as an OK / missing / exempt badge." },
    ],
    tips: [
      "Record the structured fact as a record and the narrative as a document, then link them — do not bury structured data in prose.",
      "Search can walk these links for you, drawing a record's neighbours as a graph.",
    ],
    see: [
      { label: "Search & relationships", key: "search" },
      { label: "Documents", key: "documents" },
    ],
  },

  assets: {
    title: "Assets",
    tagline: "The Flexible Asset template library — the field definitions behind every structured asset, shared across all clients.",
    what: [
      "Browse every asset type: the ones IT-U ships (Applications, Licensing, Virtualization and the service templates) plus any you create.",
      "Design a type: its fields, field types, required fields and allowed references.",
      "See how many instances of each type exist across the repository.",
    ],
    tasks: [
      {
        title: "Create a custom asset type",
        steps: [
          "Click New asset type.",
          "Give it a name, a category and an icon.",
          "Add fields — each with a name, a type (text, number, date, reference…) and whether it is required.",
          "Save; the type joins the shared library and is immediately available to every client.",
        ],
      },
      {
        title: "Edit a type's fields",
        steps: [
          "Open the type — this is the template designer.",
          "Add, reorder, relabel or mark fields required.",
          "Save. New instances use the new shape; existing instances keep their values.",
        ],
      },
      {
        title: "Reference another record",
        steps: [
          "Add a field of type Reference.",
          "Choose what it may point at (an organization, a contact, a configuration, another asset type…).",
          "On an instance, that field becomes a picker instead of free text.",
        ],
      },
    ],
    fields: [
      { name: "Asset type (template)", desc: "A reusable definition of a kind of structured record — its fields and rules." },
      { name: "Field type", desc: "What a field holds: text, long text, number, date, choice, reference… It controls the editor and the validation applied." },
      { name: "Required field", desc: "A field every instance must fill. Missing required fields are surfaced by the Linter and by completeness rules." },
      { name: "Category", desc: "A grouping such as Application, Licensing, Vendor or Infrastructure, used to organise the library." },
    ],
    tips: [
      "Types are global — defining a house standard here applies to every client at once.",
      "Instances are per client; open a client's set or an asset profile to fill them in.",
    ],
    see: [
      { label: "Working inside a client", key: "organizations:detail" },
      { label: "Editing a type", key: "assets:detail" },
    ],
  },

  "assets:detail": {
    title: "Editing an asset type",
    tagline: "The template designer: define this type's fields, then see every instance across the repository.",
    what: [
      "The type's fields and their settings, editable in place.",
      "Every instance of this type across all clients, with a jump to the client it belongs to.",
      "Renewal tracking for types that carry an expiry (licences, warranties, support).",
    ],
    tasks: [
      {
        title: "Add or change a field",
        steps: [
          "Click Add field, or the edit control on an existing field.",
          "Set the label, field type, and whether it is required.",
          "For a reference field, choose the record types it may point at.",
          "Save.",
        ],
      },
      {
        title: "Review instances",
        steps: [
          "Scroll to the “<type> assets” section.",
          "Each row links to the client set it lives in; open it to edit the values.",
        ],
      },
      {
        title: "Turn on renewal tracking",
        steps: [
          "Give the type an expiry field.",
          "The Renewals section then lists instances by expiry, with an amber/red alert state.",
        ],
      },
    ],
    tips: [
      "Changing a type never moves data between clients — instances stay where they are.",
      "Deleting a type is blocked while instances exist, so nothing is orphaned.",
    ],
    see: [{ label: "Assets library", key: "assets" }],
  },

  documents: {
    title: "Documents",
    tagline: "Procedures, guides, SOPs and reference material, grouped by the client they belong to.",
    what: [
      "A client picker: choose a client to see and write their documents.",
      "Guidance that turns “what are you documenting?” into a one-click structured template.",
      "A reminder that structured facts belong in structured assets, not prose.",
    ],
    tasks: [
      {
        title: "Write a document",
        steps: [
          "Pick the client.",
          "Click New document and choose a document type/group (procedures, guides, SOPs, deployment instructions, reference).",
          "Start from the seeded template or from a Library article.",
          "Author the body, link the records it concerns, then save.",
        ],
      },
      {
        title: "Open a client's documents",
        steps: ["Click the client — you land on their documents, grouped by type group."],
      },
    ],
    fields: [
      { name: "Document type", desc: "What kind of document this is (SOP, guide, deployment instruction…). It sets the seeded structure and the review cadence." },
      { name: "Revision history", desc: "Each document keeps its own independent revisions; you can review, publish and restore." },
      { name: "Review cadence", desc: "How often the document should be revisited — it feeds the Trackers lifecycle view." },
    ],
    tips: [
      "If you find yourself tabulating facts inside a document, create a structured asset instead and link it.",
      "Documents and assets cross-link; the Library supplies ready-made starting points.",
    ],
    see: [
      { label: "A client's documents", key: "documents:detail" },
      { label: "Library", key: "library" },
    ],
  },

  "documents:detail": {
    title: "A client's documents",
    tagline: "This client's documents, grouped by purpose. Open one to author its body, govern its review and link the records it concerns.",
    what: [
      "All of the client's documents grouped by type group.",
      "Open a document into the full editor — body, linked records, revisions, review state.",
      "Start a document from a Library article and keep the client's own copy.",
    ],
    tasks: [
      {
        title: "Author a document",
        steps: [
          "Click New document and choose the type.",
          "Write the body using the editor's headings and lists.",
          "Add linked records so the document points at the systems it concerns.",
          "Publish when ready — publishing is a versioned change.",
        ],
      },
      {
        title: "Start from the Library",
        steps: [
          "Open the “Start from the library” panel.",
          "Pick an article that matches the procedure.",
          "Add it to the client — it becomes an editable document.",
        ],
      },
      {
        title: "Review & revise",
        steps: [
          "Use the Revisions panel to see history.",
          "Move the document through draft / in review / published and set its review cadence.",
        ],
      },
    ],
    tips: ["Link, don't repeat: relate the document to the configuration or service it describes rather than copying their details into the text."],
    see: [
      { label: "Documents", key: "documents" },
      { label: "A library article", key: "library:detail" },
    ],
  },

  trackers: {
    title: "Trackers",
    tagline: "Every date that matters for a client, aggregated and queued by urgency.",
    what: [
      "A client picker for the lifecycle view.",
      "Domain and certificate expiries, licence and subscription renewals, warranty, support, end-of-life and document-review dates.",
      "A renewal schedule you can export.",
    ],
    tasks: [
      {
        title: "See a client's renewal outlook",
        steps: [
          "Pick the client — this opens their lifecycle view.",
          "Review the urgency queue: expiring soonest first, with owner and status.",
        ],
      },
    ],
    fields: [
      { name: "Lifecycle date", desc: "Any expiry or renewal date IT-U knows about — pulled from domains, certificates, licences, warranties and document reviews." },
      { name: "Urgency queue", desc: "The lifecycle dates ordered by how soon they fall due, with an amber/red alert state." },
    ],
    tips: [
      "Dates are harvested automatically from records, so filling in expiry fields pays off here.",
      "Export the renewal schedule to hand it to an account manager.",
    ],
    see: [
      { label: "A client's lifecycle", key: "trackers:detail" },
      { label: "Working inside a client", key: "organizations:detail" },
    ],
  },

  "trackers:detail": {
    title: "A client's lifecycle",
    tagline: "Domains, certificates and every other expiry, with live lookups and a renewal queue.",
    what: [
      "The renewal outlook for this client, queued by urgency.",
      "Domain tracker records: registration, name servers and DNS records, watched against registration expiry.",
      "SSL certificate records: host and port, issuer, SANs and validity window, watched against expiry.",
    ],
    tasks: [
      {
        title: "Add a domain",
        steps: [
          "In the Domains section click Add.",
          "Enter the domain — IT-U can do a best-effort live lookup of registration and DNS so you do not retype it.",
          "Confirm the facts and save.",
        ],
      },
      {
        title: "Add a certificate",
        steps: [
          "In the Certificates section click Add.",
          "Enter the host and port; IT-U can look up the certificate that is presented.",
          "Check the issuer, SANs and validity window, then save.",
        ],
      },
      {
        title: "Act on the queue",
        steps: [
          "Sort your attention by the urgency badges (expired / expiring / ok).",
          "Each row opens its editor; update the record's dates as you complete the work.",
        ],
      },
    ],
    tips: [
      "Domains and certificates also live as records in the client's set and are reachable from Organizations.",
      "Licence, warranty and support expiries come from asset instances — keep their expiry fields current.",
    ],
    see: [{ label: "Trackers", key: "trackers" }],
  },

  services: {
    title: "Services",
    tagline: "The client's delivered services — email, backup, network, security, virtualization, voice and resold internet.",
    what: [
      "The intended home for each delivered service: its platform, related configurations, vendors and documentation.",
      "Today, services are modelled as structured assets (the service templates) plus their deployment runbooks and documents.",
    ],
    tasks: [
      {
        title: "Model a delivered service today",
        steps: [
          "In the client's set, add the matching service asset (Email system, Backup & recovery, Network, Security, Voice/PBX, Internet/ISP circuit…).",
          "Link it to the configurations, vendor, credentials and documents it depends on.",
          "Write the deployment runbook in Deployments so a technician can rebuild it.",
        ],
      },
    ],
    tips: ["The Deployments station can generate a complete VoIP or circuit runbook from the client's service asset in one step."],
    see: [
      { label: "Assets", key: "assets" },
      { label: "Deployments", key: "deployments" },
    ],
  },

  library: {
    title: "Library",
    tagline: "Service processes and operational topics your team can follow as written, or adapt to a client.",
    what: [
      "Browse articles by topic shelf, with a search box.",
      "Every article declares the shipped asset templates it supports and the document type it reads as.",
      "Add an article to a client's set as a real, editable document.",
    ],
    tasks: [
      {
        title: "Find an article",
        steps: [
          "Type a keyword in the search box, or browse by topic shelf.",
          "Open a card to read it as a document.",
        ],
      },
      {
        title: "Reuse an article for a client",
        steps: [
          "Open the article.",
          "Click Add to a client's set and choose the client.",
          "It becomes an editable document in that client's Documents, already linked to the right type.",
        ],
      },
    ],
    tips: ["Articles are also surfaced from an asset's profile (“How-to from the library”) and from a document's editor."],
    see: [
      { label: "A library article", key: "library:detail" },
      { label: "Documents", key: "documents" },
    ],
  },

  "library:detail": {
    title: "A library article",
    tagline: "The article rendered as a document, with the assets it supports and the articles related to it.",
    what: [
      "The full article text, formatted for reading.",
      "Supports — the shipped asset templates and document types it applies to.",
      "Related articles to continue with.",
    ],
    tasks: [
      { title: "Read it", steps: ["Scroll the rendered article — headings and lists are preserved."] },
      {
        title: "Adapt it to a client",
        steps: [
          "Click Add to a client's set.",
          "Choose the client. A copy is created as an editable document you can change freely, leaving the library original intact.",
        ],
      },
    ],
    tips: ["Library articles are read-only originals; the client copy is yours to edit."],
    see: [{ label: "Library", key: "library" }],
  },

  deployments: {
    title: "Deployments",
    tagline: "The deployment runbooks — the procedural counterpart of the structured service assets.",
    what: [
      "A client picker for their runbooks.",
      "Runbooks capture the full build of a service, written so a technician who did not design it can execute it.",
      "Generation flows assemble a complete runbook from the client's service asset, flagging every gap.",
    ],
    tasks: [
      { title: "Open a client's runbooks", steps: ["Click the client — you land on their runbooks, grouped by type."] },
    ],
    tips: [
      "For VoIP, “Generate VoIP runbook” reads the client's Voice/PBX asset and writes the whole body in one step.",
      "Circuit deployments can generate a provisioning runbook and an addressing record the same way.",
    ],
    see: [
      { label: "A client's runbooks", key: "deployments:detail" },
      { label: "Assets", key: "assets" },
    ],
  },

  "deployments:detail": {
    title: "A client's runbooks",
    tagline: "Build procedures, cutover checklists and coverage, grouped by type.",
    what: [
      "The client's runbooks grouped by type — platform/PBX, cutover, circuit provisioning and more.",
      "Coverage panels showing which parts of a deployment are documented and which are still gaps.",
      "Cutover and deployment checklists with per-step sign-off.",
    ],
    tasks: [
      {
        title: "Generate a VoIP runbook",
        steps: [
          "Click Generate VoIP runbook.",
          "IT-U reads the client's Voice/PBX asset and assembles the full body: platform, dial plan and trunks, numbers and porting, emergency calling, codecs and QoS, firewall/SBC path, failover, handsets, per-site checks, cutover, verification and rollback.",
          "Review the gaps it flags, fill the missing facts in the client's set, then regenerate or edit.",
        ],
      },
      {
        title: "Generate a circuit provisioning runbook",
        steps: [
          "Choose the resold internet/ISP circuit.",
          "Generate the provisioning runbook and, if wanted, the addressing record.",
          "Check the coverage panels for anything still missing.",
        ],
      },
      {
        title: "Work a cutover checklist",
        steps: [
          "Open the cutover checklist.",
          "Tick steps off by phase; each step records who signed it off.",
          "The acceptance line turns green once the checklist is complete.",
        ],
      },
    ],
    tips: [
      "Runbooks carry the real values already filled in — generated from the client's records, not placeholders.",
      "A coverage panel that shows a gap is the fastest way to find a fact nobody has recorded yet.",
    ],
    see: [{ label: "Deployments", key: "deployments" }],
  },

  integrations: {
    title: "Integrations",
    tagline: "Connect each client's PSA or RMM to their documentation set and keep it in step.",
    what: [
      "A client picker for their integrations.",
      "Each connection is an integration definition stored on the set.",
      "Syncs are deterministic reconciliations against a remote snapshot — the same records are never duplicated.",
    ],
    tasks: [
      { title: "Open a client's integrations", steps: ["Click the client — you land on their integrations."] },
    ],
    tips: ["There is no live PSA/RMM API here, so “Sync now” runs against a clearly-labelled simulated provider. A real adapter implements the same shape."],
    see: [{ label: "A client's integrations", key: "integrations:detail" }],
  },

  "integrations:detail": {
    title: "A client's integrations",
    tagline: "Each connection with its direction, ownership and full run log.",
    what: [
      "Every integration: its kind (PSA, RMM, identity), the entities it syncs (organizations, contacts, configurations & devices) and its per-entity direction.",
      "Last sync and a complete run log.",
      "Conflict policy and field-ownership controls.",
    ],
    tasks: [
      {
        title: "Add an integration",
        steps: [
          "Click New integration and choose the kind.",
          "Name it and set the direction per entity (pull, push or two-way).",
          "Set field ownership and the conflict policy.",
          "Save.",
        ],
      },
      {
        title: "Run a sync",
        steps: [
          "Click Sync now.",
          "IT-U reconciles against a deterministic remote snapshot: existing records are matched by external id (or adopted by name if enabled), so nothing is duplicated.",
          "Read the run log for exactly what was created, updated, skipped or conflicted.",
        ],
      },
      {
        title: "Resolve a sync conflict",
        steps: [
          "Conflicts appear in the run summary and, for document data, in Settings → Conflicts.",
          "Choose keep-mine, keep-theirs, or a field-level merge.",
        ],
      },
    ],
    tips: [
      "A provider's push is recorded back so records it creates remotely get their external id.",
      "Because the provider is simulated, repeated syncs produce stable results — good for testing the mapping.",
    ],
    see: [
      { label: "Integrations", key: "integrations" },
      { label: "Import", key: "import" },
    ],
  },

  import: {
    title: "Import",
    tagline: "Turn a spreadsheet into structured records, dry-run first.",
    what: [
      "Import a CSV of organizations, contacts, configurations, credentials or flexible assets.",
      "Automatic column-to-field mapping you confirm before anything is written.",
      "A dry-run validation report: ready / duplicate / invalid / empty per row, with the exact reason.",
    ],
    tasks: [
      {
        title: "Import a CSV",
        steps: [
          "Pick the record type — and, for flexible assets, the template.",
          "Paste the CSV or upload a file (a sample is provided).",
          "Confirm the proposed column → field mapping.",
          "Review the dry-run report; fix problem rows or accept that they will be skipped.",
          "Import. Every ready row becomes a classified record, marked “imported once”.",
        ],
      },
    ],
    fields: [
      { name: "Target", desc: "What each row becomes — an organization, contact, configuration & device, credential, or flexible asset of a chosen type." },
      { name: "Column mapping", desc: "Which CSV column supplies which field. Proposed automatically from the header names; you can change it." },
      { name: "Dry run", desc: "The validation pass that classifies every row before anything is committed." },
    ],
    tips: [
      "Duplicates are detected and skipped unless you opt in to importing them.",
      "Problem rows are reported individually — never silently dropped.",
      "The import is logged, so you can see what was brought in and when.",
    ],
    see: [{ label: "The import step", key: "import:detail" }],
  },

  "import:detail": {
    title: "Mapping and dry-run",
    tagline: "The workspace for one import: mapping, validation and commit.",
    what: [
      "The row-by-row dry-run report for the chosen target and file.",
      "The column → field mapping review.",
      "The per-row outcome, with the exact reason a problem row was rejected.",
    ],
    tasks: [
      {
        title: "Fix a rejected row",
        steps: [
          "Read the reason in the dry-run report (missing required field, invalid date, unknown reference…).",
          "Either correct the source spreadsheet and re-upload, or map the column to the right field.",
          "Re-run the dry run — nothing is written until you import.",
        ],
      },
      {
        title: "Commit",
        steps: [
          "Once only the rows you expect are ready, click Import.",
          "The whole import is one transaction in the client's documentation-set service.",
        ],
      },
    ],
    tips: ["Always dry-run first — it costs nothing and catches mapping mistakes before they become records."],
    see: [{ label: "Import", key: "import" }],
  },

  search: {
    title: "Search & relationships",
    tagline: "Full-text search across every record, then walk its typed links.",
    what: [
      "Left: fast full-text search across every record in every client's set, narrowed by record type, information model, provenance, client, lifecycle status and an expiry window.",
      "Right: the traversal view — a selected result's typed links drawn as a radial graph plus labelled groups, each neighbour one click away.",
    ],
    tasks: [
      {
        title: "Find a record",
        steps: [
          "Type a term in the search box.",
          "Add filters to narrow by type, model, provenance, client, status or expiry.",
          "Click a result to select it.",
        ],
      },
      {
        title: "Walk from a record to its neighbours",
        steps: [
          "With a result selected, look at the relationship graph and the labelled groups on the right.",
          "Click a neighbour to select it and continue — this is how you get from an application to its server, credentials, vendor and documentation.",
        ],
      },
    ],
    tips: [
      "The graph only draws links that exist; if something obviously related is missing, the records may not be linked yet.",
      "Provenance filters are a quick way to find everything that was imported or synchronized.",
    ],
    see: [
      { label: "Linter", key: "linter" },
      { label: "Working inside a client", key: "organizations:detail" },
    ],
  },

  linter: {
    title: "Linter",
    tagline: "A completeness and quality audit across every client.",
    what: [
      "Findings grouped by check and by severity: a configuration missing a required field, an asset linked to nothing, a document repeating structured data in prose, a known service with no coverage, an item expired or expiring, a record gone stale.",
      "Filterable by client and by check.",
      "A one-click Fix on each row, and a saveable Markdown or CSV report.",
    ],
    tasks: [
      {
        title: "Run the audit",
        steps: [
          "Open the Linter; it audits every set.",
          "Filter by client or check, and work by severity.",
        ],
      },
      {
        title: "Apply a fix",
        steps: [
          "Read the suggested fix on the finding.",
          "Click Fix — it fills the missing field, creates the proposed link, extracts prose into a document, or converts a note into a structured asset.",
          "The audit re-runs automatically.",
        ],
      },
      {
        title: "Export the report",
        steps: ["Save the audit to the browser, or download it as Markdown/CSV grouped by severity."],
      },
    ],
    tips: ["Fix findings at their source (the record) rather than dismissing them; a clean audit is the best signal that the repository is genuinely usable."],
    see: [
      { label: "Settings → Integrity checks", key: "settings:integrity" },
      { label: "Search & relationships", key: "search" },
    ],
  },

  exports: {
    title: "Exports",
    tagline: "Publish a client's documentation as a bundle, and produce packets and printables.",
    what: [
      "Bundle publication: choose a documentation bundle (the whole set) or a deployment bundle (runbooks, checklists and related records for a service or site).",
      "A choice of destination, a preview of the exact envelope the pipeline will read, and a publish action.",
      "Packets & printables: turn records into a shareable printable page.",
    ],
    tasks: [
      {
        title: "Publish a bundle",
        steps: [
          "Pick the client and the bundle type.",
          "Choose the publication target.",
          "Review the envelope preview and the redaction summary.",
          "Publish — the action is recorded in the export log.",
        ],
      },
      {
        title: "Produce a packet",
        steps: [
          "Use the Packets & printables section.",
          "Select the records to include.",
          "Generate the packet; it is hosted at a shareable link.",
        ],
      },
    ],
    fields: [
      { name: "Bundle type", desc: "Documentation (the whole set) versus deployment (just the runbooks, checklists and related records for a service or site)." },
      { name: "Redaction", desc: "Default-deny: credentials are withheld unless you explicitly ask for a redacted summary; secrets and private keys are never published." },
      { name: "Export log", desc: "A record of every bundle published — what, when, where and what was withheld." },
    ],
    tips: [
      "Redaction is on by default — publishing without credentials is the safe path.",
      "Every publish is logged, so you can prove what left the repository.",
    ],
    see: [{ label: "Settings → Integrity checks", key: "settings:integrity" }],
  },

  status: {
    title: "Status",
    tagline: "Connection, cloud store, realtime hub and synchronization — the live state of every service IT-U depends on.",
    what: [
      "Connection — whether you are online, mid-sync, or working offline with changes waiting to push.",
      "Cloud store — whether documents are being versioned in the cloud or held only in this session, and how much is stored.",
      "Realtime hub — whether the collaboration hub is reachable, who is signed in, what they may write, and how many sessions are online.",
      "Synchronization — pending drafts, open conflicts and the result of the last reconcile.",
    ],
    tasks: [
      {
        title: "Check and fix the connection",
        steps: [
          "Read the headline — Online, Syncing, N to sync or Offline.",
          "Click Check connection now to re-test the browser's connection state.",
          "Click Sync now to push staged changes immediately instead of waiting for the automatic pass.",
        ],
      },
      {
        title: "See whether storage is really cloud-backed",
        steps: [
          "Look at the Cloud store card.",
          "“Local only” means the cloud plugin is not loaded in this session — records will not survive a reload until you open the saved generator.",
        ],
      },
      {
        title: "Sign in or review your access",
        steps: [
          "Use the Realtime hub card to see whether you are connected and signed in.",
          "Click Sign in / Manage account to sign in, or to review your scoped roles.",
        ],
      },
      {
        title: "Resolve a conflict",
        steps: [
          "The Synchronization card lists documents that two devices changed.",
          "Click Resolve — it opens the Conflicts card in Settings, where you keep mine, keep theirs, or merge.",
        ],
      },
    ],
    fields: [
      { name: "Connection", desc: "Online / syncing / pending / offline, with how long the state has held and when it was last checked." },
      { name: "Cloud store", desc: "Cloud-backed versioned storage versus an in-memory local-only session." },
      { name: "Realtime hub", desc: "The collaboration server: reachability, sign-in, your scoped roles and live session count." },
      { name: "Synchronization", desc: "Drafts waiting to push, open conflicts and the outcome of the last reconcile." },
    ],
    tips: [
      "The header no longer carries connection pills — this station is the single place to read live service state.",
      "Offline is not a failure: edits are staged on this device and pushed automatically when the connection returns.",
      "Conflicts are never resolved for you — both versions are kept until you choose.",
    ],
    see: [
      { label: "Settings → Storage & sync", key: "settings:storage" },
      { label: "Settings → Conflicts", key: "settings:conflicts" },
    ],
  },

  settings: {
    title: "Settings",
    tagline: "Appearance, storage, sync, conflicts, backup, capacity, templates and access — the operational controls.",
    what: [
      "Appearance & theme — the colour mode and the theme (presets or your own).",
      "Storage & synchronization, Conflicts, Capacity, Backup & restore and Templates.",
      "Groups & access, People & access and Activity & rate control.",
      "Identity provider (SSO) — sign in with an external directory and map its groups to IT-U roles.",
      "Integrity checks and the Playbook & reference.",
    ],
    tasks: [
      {
        title: "Find the right control",
        steps: [
          "Change how the app looks → Appearance & theme.",
          "See whether you are in sync → Storage & synchronization.",
          "Fix a clash between two devices → Conflicts.",
          "Free space → Capacity (archive a retired client).",
          "Keep a copy off-site → Backup & restore.",
          "Reuse a client as a starting point → Templates.",
        ],
      },
    ],
    tips: ["Each card has its own ? button with help specific to that section."],
    see: [
      { label: "Appearance & theme", key: "settings:appearance" },
      { label: "Storage & sync", key: "settings:storage" },
      { label: "Conflicts", key: "settings:conflicts" },
      { label: "Backup & restore", key: "settings:backup" },
    ],
  },

  "settings:appearance": {
    title: "Appearance & theme",
    tagline: "Light or dark mode, preset themes, and your own custom colour themes.",
    what: [
      "Mode — light, dark, or follow the operating system automatically.",
      "A library of preset themes, each shipping a light and a dark palette.",
      "A custom theme editor: set any colour with the picker or a hex code and preview it live.",
      "Saved themes — name a custom theme, re-apply it later, or delete it.",
    ],
    tasks: [
      {
        title: "Switch between light and dark",
        steps: [
          "Use the sun/moon button in the header to toggle quickly from anywhere.",
          "Or choose Light, Dark or System in the Mode control here. System follows your device's setting and updates automatically.",
        ],
      },
      {
        title: "Apply a preset theme",
        steps: [
          "Pick a theme from the Preset themes grid — it applies immediately.",
          "Each preset has both a light and a dark palette, so it looks right in either mode.",
        ],
      },
      {
        title: "Author a custom theme",
        steps: [
          "Edit the colours under Custom theme — click a swatch to pick, or paste a hex code.",
          "Switch between the Light palette and Dark palette tabs to theme both modes.",
          "Give it a name and click Save theme. Saved themes appear below and can be re-applied or deleted.",
        ],
      },
      {
        title: "Start over",
        steps: ["Reset fields restores the custom editor to the active theme's colours.", "Restore default returns to the shipped Indigo theme."],
      },
    ],
    fields: [
      { name: "Mode", desc: "Light, Dark, or System (follow the OS preference). The header button toggles light/dark directly." },
      { name: "Preset themes", desc: "Ready-made palettes (Indigo, Corporate Navy, Ocean, Emerald, Violet, Rose, Nord, Monochrome and more)." },
      { name: "Custom theme", desc: "Your own light and dark palettes, edited colour-by-colour and saved under a name." },
    ],
    tips: [
      "Your theme is stored on this device, so a phone and a desktop can keep different preferences.",
      "The saved theme is applied before the page paints, so a dark-mode session never flashes white on load.",
    ],
    see: [{ label: "Settings", key: "settings" }],
  },

  "settings:storage": {
    title: "Storage & synchronization",
    tagline: "Where the repository lives, and how local changes reach the cloud.",
    what: [
      "Document count, bytes stored, the storage namespace, and the last reconcile time.",
      "Open conflicts and pending drafts at a glance.",
      "A “Check for updates now” action.",
    ],
    tasks: [
      {
        title: "Force a sync",
        steps: [
          "Click Check for updates now.",
          "Documents live in the versioned cloud store with a local cache; this reconciles the two.",
          "If anything clashes, it appears under Conflicts.",
        ],
      },
    ],
    fields: [
      { name: "Documents", desc: "How many documents (sets and library docs) this repository holds." },
      { name: "Namespace", desc: "The storage namespace the cloud store writes under." },
      { name: "Pending drafts", desc: "Changes made while offline, staged locally and pushed automatically when the connection returns." },
    ],
    tips: [
      "Offline edits are never lost — they wait as drafts.",
      "Reconcile is safe to run at any time.",
    ],
    see: [
      { label: "Conflicts", key: "settings:conflicts" },
      { label: "Backup & restore", key: "settings:backup" },
    ],
  },

  "settings:conflicts": {
    title: "Conflicts",
    tagline: "When two devices change the same document, both versions are preserved here.",
    what: [
      "Every open conflict, with when it was detected and the two version numbers.",
      "A field-by-field difference between Mine and Theirs.",
      "Three resolutions: keep mine, keep theirs, or merge field-by-field.",
    ],
    tasks: [
      {
        title: "Resolve a conflict",
        steps: [
          "Click Resolve on the conflict.",
          "Read the diff table — where the two sides differ.",
          "Choose keep-mine, keep-theirs, or tick field-by-field to merge.",
          "Confirm; the resolution is written and the conflict clears.",
        ],
      },
    ],
    tips: [
      "Nothing is discarded until you choose — both sides are kept safe.",
      "Resolve conflicts before doing more editing on that document.",
    ],
    see: [{ label: "Storage & sync", key: "settings:storage" }],
  },

  "settings:capacity": {
    title: "Capacity",
    tagline: "How much each client's document takes, and how close it is to the ceiling.",
    what: [
      "A bar per documentation set: bytes used, record count, and OK / Near ceiling / Over ceiling / Archived.",
      "A link straight to the client's set.",
    ],
    tasks: [
      {
        title: "Free space",
        steps: [
          "Find a set marked Near or Over ceiling, or a retired client.",
          "Archive it — archived sets move to the Archived tab, stay fully readable and restorable, and stop counting against the working repository.",
        ],
      },
    ],
    tips: [
      "Archiving is reversible; deletion is not (though a backup can restore).",
      "One set per client keeps capacity predictable.",
    ],
    see: [
      { label: "Backup & restore", key: "settings:backup" },
      { label: "Integrity checks", key: "settings:integrity" },
    ],
  },

  "settings:backup": {
    title: "Backup & restore",
    tagline: "Keep a validated copy of the whole repository, and restore from one with a previewed plan.",
    what: [
      "Download a full backup as one JSON file.",
      "Publish a hosted backup document to a durable link.",
      "Restore from a downloaded file, pasted JSON or a hosted document — with a preview of what will change before anything is written.",
    ],
    tasks: [
      {
        title: "Take a backup",
        steps: [
          "Click Download full backup for a local file, or publish a hosted backup document.",
          "The toast confirms how many sets and records were captured.",
        ],
      },
      {
        title: "Restore",
        steps: [
          "Provide the backup — upload the file, paste the JSON, or point at a hosted document.",
          "Review the previewed plan: what will be added or replaced.",
          "Confirm to apply.",
        ],
      },
    ],
    tips: [
      "A backup is the only way back from a deletion, so take one before big changes.",
      "A hosted backup survives this browser — use it to move between machines.",
    ],
    see: [
      { label: "Capacity", key: "settings:capacity" },
      { label: "Storage & sync", key: "settings:storage" },
    ],
  },

  "settings:templates": {
    title: "Templates",
    tagline: "Starter bundles you can instantiate as a new client's documentation set.",
    what: [
      "Built-in starter templates: Managed IT, Hosted voice (VoIP), Internet/ISP circuit, and Full-service.",
      "Any templates you have saved from a client's set.",
      "Apply a template to create a fresh set in one step.",
    ],
    tasks: [
      {
        title: "Create a set from a template",
        steps: [
          "Find the template and click Apply.",
          "Type the new client, department or business unit name.",
          "Click Create — IT-U writes the whole set (record types and example records) in one go and opens it.",
        ],
      },
      {
        title: "Save your own",
        steps: [
          "Open a client's set and use its save-as-template action.",
          "The template joins this list and can seed future clients.",
          "Custom templates can be deleted; built-ins cannot.",
        ],
      },
    ],
    tips: [
      "Starter templates are a beginning — add, edit and remove records freely afterwards.",
      "Applying a template is a real cloud write, so it takes a few seconds; a busy card shows progress.",
    ],
    see: [{ label: "Organizations", key: "organizations" }],
  },

  "settings:access": {
    title: "Groups & access",
    tagline: "A group grants a set of permissions; identities are put into groups.",
    what: [
      "The group library — shipped groups plus any you create.",
      "Permissions at five levels: organization, asset, document, general password and administrative.",
      "Membership: which identities belong to each group.",
    ],
    tasks: [
      {
        title: "Create a group",
        steps: [
          "Click New group.",
          "Name it and tick the permissions it grants.",
          "Add members (identities from the hub).",
          "Save.",
        ],
      },
      {
        title: "Adjust a shipped group",
        steps: [
          "Edit a built-in group freely, or Clone it to make a variant.",
          "Reset returns a built-in group to its shipped definition.",
        ],
      },
    ],
    fields: [
      { name: "Permission level", desc: "Organization, asset, document, general password or administrative. An embedded credential is governed by the asset it belongs to rather than a grant of its own." },
      { name: "Single-user mode", desc: "An offline or unauthenticated repository is owned by you and never restricted." },
    ],
    tips: [
      "Clone a shipped group rather than editing it if you may want the original back.",
      "Roles (People & access) are enforced by the server; groups are how you assign them in bulk.",
    ],
    see: [
      { label: "People & access", key: "settings:roles" },
      { label: "Activity & rate control", key: "settings:activity" },
    ],
  },

  "settings:roles": {
    title: "People & access",
    tagline: "The three roles, and who holds which role at which scope.",
    what: [
      "The signed-in identity and its repository-wide role.",
      "The viewer / technician / administrator legend.",
      "Per-client and per-service role grants, managed by an administrator.",
    ],
    tasks: [
      {
        title: "Grant a role",
        steps: [
          "Signed in as an administrator, pick a person.",
          "Choose the role (viewer, technician, administrator).",
          "Choose the scope — a client, or a service.",
          "Save. Grants are most-specific-wins: a service grant overrides a client grant, which overrides the repository-wide one.",
        ],
      },
    ],
    fields: [
      { name: "Viewer", desc: "Reads only." },
      { name: "Technician", desc: "Edits the records and runbooks they are assigned." },
      { name: "Administrator", desc: "Manages templates, groups and publication." },
    ],
    tips: [
      "Offline, this is a single-user repository and the owner holds every permission.",
      "Only an administrator can change roles.",
    ],
    see: [
      { label: "Groups & access", key: "settings:access" },
      { label: "Activity & rate control", key: "settings:activity" },
    ],
  },

  "settings:idp": {
    title: "Identity provider (SSO)",
    tagline: "Sign in with Microsoft Entra ID, Okta, Auth0 or any OIDC directory — and map directory groups to IT-U roles.",
    what: [
      "The redirect URI to register with each provider.",
      "Providers: add one from a preset (Entra ID, Entra app roles, Okta, Auth0, Google, generic OIDC), edit it, or remove it.",
      "Discover — fetches the provider's endpoints and PUBLIC signing keys from its discovery document.",
      "Directory group → role rules: grant a role at the whole repository, one client, or one service.",
      "The built-in simulator, and a claim-mapping preview.",
    ],
    tasks: [
      {
        title: "Add Microsoft Entra ID",
        steps: [
          "In Entra ID, register a new application as a Single-page application and paste this card's redirect URI into its allowed redirect URIs.",
          "Copy the application (client) id and your tenant id.",
          "Back here, choose Add provider → Microsoft Entra ID, and enter the display name, the application id, and the issuer https://login.microsoftonline.com/<tenant-id>/v2.0.",
          "Click Discover endpoints & keys — the authorization endpoint, token endpoint and public signing keys are fetched and stored on the server.",
          "Add group → role rules (e.g. an Entra security group that should be an administrator, or it-* as a technician).",
          "Save provider. In Entra, set groupMembershipClaims to SecurityGroup (or map App roles) so the token carries the groups your rules match.",
        ],
      },
      {
        title: "Try it without a directory",
        steps: [
          "Use the built-in simulator at the bottom of the card.",
          "Pick a persona and click Sign in with the simulator — it mints a demo ID token that the SERVER verifies exactly like a real one.",
          "The simulator ships with no group rules, so it demonstrates the flow but grants read-only access. Use Preview mapping in a provider editor to see the rules work.",
        ],
      },
      {
        title: "Check a mapping before you commit",
        steps: [
          "Open a provider editor and expand Preview the claim mapping.",
          "Paste a sample set of claims (including groups) as JSON.",
          "Click Preview mapping to see the username, groups and the exact roles those rules would grant.",
        ],
      },
    ],
    fields: [
      { name: "Redirect URI", desc: "The address the provider returns to after sign-in. Register it exactly as shown; it must match character for character." },
      { name: "Issuer", desc: "The provider's issuer URL. IT-U reads the discovery document from <issuer>/.well-known/openid-configuration." },
      { name: "Client (application) id", desc: "The public identifier of the IT-U application registered in the provider. There is no client secret — sign-in uses PKCE." },
      { name: "Claim mapping", desc: "Which token claims carry the username, display name, e-mail and groups. Entra ID uses preferred_username and groups." },
      { name: "Group → role rules", desc: "A rule matches a directory group (exact, case-insensitive, or a * glob) and grants a role at a scope. Blank or * matches everyone." },
      { name: "Default role", desc: "The role granted to everyone who signs in through this provider. Viewer is the baseline; technician or administrator can be raised here." },
      { name: "Signing keys (JWKS)", desc: "The provider's PUBLIC keys, fetched by Discover and stored on the server so it can verify ID tokens offline." },
    ],
    tips: [
      "There is no client secret: IT-U is public source and runs with no trusted backend, so it is an OIDC public client using Authorization Code + PKCE. A provider that requires a secret (e.g. a plain Google Web-application client) cannot complete the exchange from the browser.",
      "The server verifies every ID token — signature, issuer, audience, expiry and nonce — and directory rules are the source of truth for an SSO user's scoped roles.",
      "An SSO sign-in never silently takes over an existing local password account: if the directory name is already used locally, IT-U gives the SSO identity its own suffixed account and says so, rather than adopting the local one.",
      "Offboarding in the directory removes access here the next time the person signs in.",
    ],
    see: [
      { label: "People & access", key: "settings:roles" },
      { label: "Activity & rate control", key: "settings:activity" },
      { label: "Groups & access", key: "settings:access" },
    ],
  },

  "settings:activity": {
    title: "Activity & rate control",
    tagline: "Who is connected, how the hub is limiting traffic, and the durable audit trail.",
    what: [
      "The live connection list and how many sessions are online.",
      "Rate-control statistics from the hub.",
      "A durable trail of every sign-in, role change, published change and allowed or denied action.",
    ],
    tasks: [
      {
        title: "Review the trail",
        steps: [
          "Signed in as an administrator, scroll the activity list.",
          "Each entry names the actor the server recorded — so a change made on another session is attributed to the person who really made it.",
        ],
      },
    ],
    tips: [
      "Administrator-only: other users see just their own recorded activity.",
      "Offline there is no shared activity to show.",
    ],
    see: [
      { label: "People & access", key: "settings:roles" },
      { label: "Groups & access", key: "settings:access" },
    ],
  },

  "settings:integrity": {
    title: "Integrity checks",
    tagline: "One audit over every client, against all six integrity checks.",
    what: [
      "Every record classified; every relationship target present and readable both ways; every required field enforced; no orphan records; no credential leaked into an export; every export parseable.",
      "Fixture sets — a healthy all-model client and an older-schema set — so you can see the checks pass and catch a known gap.",
      "A downloadable Markdown report.",
    ],
    tasks: [
      {
        title: "Run the audit",
        steps: [
          "Click Run integrity checks.",
          "Each set shows a chip per check, with a count where relevant.",
          "Download the report if you need to share it.",
        ],
      },
      {
        title: "Add a fixture set",
        steps: [
          "Pick a fixture from the list.",
          "Click Add fixture set to create it.",
          "Run the audit to see the checks exercise against known-good and known-gap data.",
        ],
      },
    ],
    tips: ["Integrity checks are about the repository's structure, not one client's completeness — use the Linter for that."],
    see: [
      { label: "Linter", key: "linter" },
      { label: "Capacity", key: "settings:capacity" },
    ],
  },

  "settings:playbook": {
    title: "Playbook & reference",
    tagline: "The content model, the conventions, and the extension guides.",
    what: [
      "The IT-U content model and the conventions every record follows.",
      "How deployment documentation is assembled and published, and the redaction rules.",
      "Checklists for adding a new asset type, template, service runbook or export.",
    ],
    tasks: [
      {
        title: "Read a reference",
        steps: [
          "Expand a section to read the model, the provenance/relationship conventions, the deployment flow or the redaction rules.",
          "The same text ships as src/PLAYBOOK.md, so it is versioned with the code.",
        ],
      },
      {
        title: "Follow an extension guide",
        steps: [
          "Open the Extension playbooks section.",
          "Pick the guide for what you are adding — an asset type, a template, a service runbook or an export.",
          "Follow its steps; each lists the files it touches.",
        ],
      },
    ],
    tips: ["When you extend IT-U, add the same guide here so the next person inherits the convention."],
    see: [
      { label: "Assets", key: "assets" },
      { label: "Deployments", key: "deployments" },
    ],
  },
};

export const hasHelp = (key) => !!HELP[key];

export function helpKeys() {
  return Object.keys(HELP);
}

// The "?" button for a given help key. Kept small and round so it reads as an
// affordance rather than an action.
export function helpButton(key, label = "Help with this page") {
  return h(
    "button",
    {
      class: "kb-help-btn",
      type: "button",
      title: label,
      "aria-label": label,
      dataset: { help: key },
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        openHelp(key);
      },
    },
    "?",
  );
}

// Inject a "?" button into the first .kb-view-title-row inside `container`.
// Returns true when a button is present (an existing one counts), false when the
// screen has no title row or no authored help.
export function attachHelp(container, key) {
  if (!container || !hasHelp(key)) return false;
  const row = container.querySelector(".kb-view-title-row");
  if (!row) return false;
  if (row.querySelector(".kb-help-btn")) return true;
  row.append(helpButton(key, "Help with this page"));
  return true;
}

// Inject a "?" into the section head of every card that has authored help.
// `container` defaults to the whole document; `prefix` builds the key from each
// element's `data-<attr>` (used for Settings, where cards carry data-card).
export function attachSectionHelp(container = document, { prefix = "settings", attr = "card" } = {}) {
  if (!container) return 0;
  let n = 0;
  for (const card of container.querySelectorAll("[data-" + attr + "]")) {
    const value = card.dataset[attr];
    if (!value) continue;
    const key = prefix ? prefix + ":" + value : value;
    if (!hasHelp(key)) continue;
    const head = card.querySelector(".kb-section-head");
    if (!head || head.querySelector(".kb-help-btn")) continue;
    const title = head.querySelector(".kb-section-name");
    if (title && title.nextSibling) title.after(helpButton(key, "Help with this section"));
    else head.append(helpButton(key, "Help with this section"));
    n += 1;
  }
  return n;
}

export function openHelp(key) {
  const entry = HELP[key];
  if (!entry) return null;
  // Replace any help panel that is already open, so following a "See also"
  // link steps to the next topic instead of stacking panels.
  if (current && current.overlay && current.overlay.isConnected) current.close();
  const { overlay, actions, close } = openModal({
    title: "Help — " + entry.title,
    description: entry.tagline,
    wide: true,
    children: [helpBody(entry)],
  });
  actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: close }, "Got it"));
  current = { overlay, close };
  return current;
}

export function helpBody(entry) {
  const parts = [h("div", { class: "kb-help" })];

  if (entry.what && entry.what.length) {
    parts.push(helpSection("What you can do here", h("ul", { class: "kb-help-list" }, entry.what.map((x) => h("li", null, x)))));
  }

  if (entry.tasks && entry.tasks.length) {
    parts.push(
      helpSection(
        "Common tasks",
        h(
          "div",
          { class: "kb-help-tasks" },
          entry.tasks.map((t) =>
            h(
              "div",
              { class: "kb-help-task" },
              h("h4", { class: "kb-help-task-title" }, t.title),
              h("ol", { class: "kb-help-steps" }, t.steps.map((s) => h("li", null, s))),
            ),
          ),
        ),
      ),
    );
  }

  if (entry.fields && entry.fields.length) {
    parts.push(
      helpSection(
        "Key terms",
        h("dl", { class: "kb-help-defs" }, entry.fields.flatMap((f) => [h("dt", null, f.name), h("dd", null, f.desc)])),
      ),
    );
  }

  if (entry.tips && entry.tips.length) {
    parts.push(
      h(
        "div",
        { class: "kb-help-tips" },
        entry.tips.map((t) => h("div", { class: "kb-help-tip" }, h("span", { class: "kb-help-tip-icon", "aria-hidden": "true" }, "!"), h("span", null, t))),
      ),
    );
  }

  if (entry.see && entry.see.length) {
    parts.push(
      helpSection(
        "See also",
        h(
          "div",
          { class: "kb-help-see" },
          entry.see.map((s) => {
            if (s.key) {
              return h("button", { class: "kb-help-link", type: "button", onClick: () => openHelp(s.key) }, s.label + " →");
            }
            return h("a", { class: "kb-help-link", href: s.hash || "#/" }, s.label + " →");
          }),
        ),
      ),
    );
  }

  return parts;
}

function helpSection(title, body) {
  return h("section", { class: "kb-help-sec" }, h("h3", { class: "kb-help-sec-title" }, title), body);
}
