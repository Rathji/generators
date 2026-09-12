export const CONCEPTS = [
  {
    term: "Canonical identity",
    detail: "Every company, customer, device, ticket and invoice gets one stable ID derived from its natural keys. Different tools' spellings converge on the same record instead of forking it.",
  },
  {
    term: "Integration registry",
    detail: "The single declaration of who owns what. For every entity type and field the registry records the owning connector, whether that value is authoritative, and which way it synchronises.",
  },
  {
    term: "Field ownership",
    detail: "Each field has exactly one owner. Only the owner writes it; every other tool reads it. This is what lets the hub settle disagreements without guessing.",
  },
  {
    term: "Reference, don't copy",
    detail: "Shared values are fetched from their owning tool on demand rather than duplicated. Where a copy does exist, the hub checks it for drift.",
  },
  {
    term: "Event envelope",
    detail: "The only way tools communicate. Every envelope carries its type, version, source, monotonic sequence number and a validated payload.",
  },
  {
    term: "Subscription",
    detail: "A connector's declaration of the event topics it cares about. The manager persists subscriptions and delivers matching events; registering or removing one is itself an event.",
  },
  {
    term: "Idempotent sync job",
    detail: "Cross-tool work runs as a keyed job with an effect ledger. Retries, replays and duplicate submissions apply a change exactly once.",
  },
  {
    term: "Conflict & settlement rule",
    detail: "When two tools disagree about a field, the registry maps the field's sync direction to a settlement rule (owner-authoritative, owner-wins-two-way, hub-derivation or hub-local) and resolves it deterministically.",
  },
  {
    term: "Drift",
    detail: "A linked value that no longer matches its authoritative source. Drift is recorded in a ledger, grouped into an alert, and offered a one-click fix.",
  },
  {
    term: "Alert",
    detail: "One administrator notification per entity and kind of problem. Repeats escalate the same alert instead of piling up, and can be acknowledged or cleared.",
  },
  {
    term: "Bundle",
    detail: "A frozen, redacted snapshot of the linked directory — with a content fingerprint — packaged as JSON or CSV for an AI assistant, knowledge base, warehouse or backup.",
  },
  {
    term: "Audit chain",
    detail: "An immutable ledger where each entry hashes the one before it. Re-verifying the chain proves no stored entry was edited, reordered or removed.",
  },
  {
    term: "Connector",
    detail: "A Project U member tool the hub integrates with (IT-U, CRM-U, PSA-U, RMM-U). Each connector declares its fields, roles and subscriptions once in the registry.",
  },
];

export const GUIDES = [
  {
    id: "home",
    title: "Overview",
    purpose: "The landing screen: the live size of the hub, a card per capability, the Project U family, and a pointer to the guide.",
    steps: [
      "Read the four stat cards — directory records and links, events logged, subscribers, and canonical roles — to gauge the hub at a glance.",
      "Select any capability card to jump to the screen that implements it.",
      "If you are new, open Help & about for a five-step orientation and a guide to every screen.",
    ],
    tip: "The stat cards read straight from the live hub, so they update as you work elsewhere.",
  },
  {
    id: "identity",
    title: "Canonical identity",
    purpose: "The single directory of companies, customers, devices, tickets and invoices — one canonical record per real-world thing.",
    steps: [
      "Switch between the Companies, Customers, Devices, Tickets and Invoices tabs.",
      "Select a record to expand its field values, natural keys, references, aliases and merge history.",
      "Check Possible duplicates at the top; press Merge to fold one record into another (the weaker ID is kept as an alias).",
      "Use Re-run demo import to reload the demo directory, or Reset hub data for a clean baseline. Both ask for confirmation.",
    ],
    tip: "A field marked “awaiting owner value” has no value yet from the connector that owns it — that is a gap to resolve, not a copy you can edit here.",
  },
  {
    id: "registry",
    title: "Integration registry",
    purpose: "The declaration of who owns what: every connector's fields, their authoritative source and their sync direction.",
    steps: [
      "Pick an entity type tab (Companies, Customers, Devices, Tickets, Invoices).",
      "Read the connector cards down the field-ownership table columns to see which tool owns each field and how the value reaches the hub.",
      "Scroll to Registry validation: a green row means every field has exactly one owner, that owner declares the entity type, and the direction is valid.",
    ],
    tip: "If validation ever turns red, fix the declaration in src/core/catalog.js — everything downstream trusts it.",
  },
  {
    id: "permissions",
    title: "Permission mapping",
    purpose: "One permission model for the whole family: connector-specific roles translated into shared canonical roles.",
    steps: [
      "Read the canonical role columns (Owner, Administrator, Dispatcher, Technician, Account manager, Billing, Auditor, Viewer).",
      "Scan the Tool role mapping table to see how each tool's own role names translate.",
      "Use the Permission checker: choose a connector, one of its tool roles, and an action, then read the answer.",
    ],
    tip: "Because translation is centralised, an access question has one answer everywhere rather than one per tool.",
  },
  {
    id: "links",
    title: "Entity links",
    purpose: "The graph that connects records across tools — a device in RMM-U to a ticket in PSA-U, a ticket to its company, and so on.",
    steps: [
      "Review the Link types table: every reference the hub understands, the direction, and how many edges are resolved.",
      "Open Unresolved references and pick the correct target for a reference that could not be matched, or Rebuild link graph after the source data is fixed.",
      "Use the Link explorer to follow a record's outgoing references and the incoming references that point back at it.",
    ],
    tip: "Links are derived, not hand-maintained. Rebuilding the graph re-resolves every declared reference from scratch while keeping your manual overrides.",
  },
  {
    id: "search",
    title: "Cross-tool search",
    purpose: "One query across every connector, showing which tools know about a record and what it links to.",
    steps: [
      "Type a company name, person, device, ticket or invoice ID — or select one of the sample queries.",
      "Narrow the results with the entity-type, connector and link-state filters.",
      "Expand a result to see its connector references, canonical record and outgoing/incoming links.",
    ],
    tip: "Search spans connectors even when a record is unresolved or unlinked, so it doubles as a cleanup finder.",
  },
  {
    id: "sync",
    title: "Sync jobs",
    purpose: "The idempotent work queue: every cross-tool change runs as a keyed job so retries never double-apply.",
    steps: [
      "Queue a job: choose its kind, entity type, record and (for field work) the field, then press Queue job.",
      "Use Queue jobs for open drift to enqueue a fix for every open drift signal in one go.",
      "Press Run pending to drain the queue, or Run on a single row. Remove succeeds / Remove clears individual rows.",
      "Open a job to inspect its effect ledger — the record of what each attempt actually changed.",
    ],
    tip: "Submitting the same job twice is safe by design: the second submission is recognised as a duplicate and returns the first attempt's effect.",
  },
  {
    id: "reconcile",
    title: "Reconciliation",
    purpose: "Where the tools disagree, this screen says so and offers a one-click way to put it right.",
    steps: [
      "In Field resolution, choose an entity and read each field's status; use Fetch from owner to pull the authoritative value, then Adopt owner value to take it.",
      "Work down the Findings list — stale values, unresolved references, copy drift and possible duplicates — each with its own action (Link, Merge, Adopt, Prune or Dismiss).",
      "Check Copy hygiene for duplicated values, and restore any Dismissed findings if you change your mind.",
    ],
    tip: "Dismissing a finding hides it without touching the underlying data, so it is always safe to dismiss and revisit.",
  },
  {
    id: "conflicts",
    title: "Conflict resolution",
    purpose: "The rules that decide which value wins when two tools write the same field.",
    steps: [
      "Read the Settlement rules table: each field's sync direction maps to the rule that will settle it.",
      "Use Simulate a competing write to write a value from a non-owning tool and watch the conflict appear.",
      "In Open conflicts, read what the hub holds beside what the owner reports, then adopt the winning value or Resolve all automatic.",
      "Review the Settlement history to see every conflict the hub has resolved.",
    ],
    tip: "The hub never guesses and never lets the last writer win by default — the registry's ownership rules always decide.",
  },
  {
    id: "drift",
    title: "Drift & alerts",
    purpose: "Continuous checking for linked data that has stopped matching its authoritative source, and the alert inbox.",
    steps: [
      "Press Scan now to sweep the graph for stale values, field conflicts and link drift.",
      "For each Detected drift row press Queue & run fix, or use Run all suggested fixes for the whole ledger.",
      "In the Alert inbox, press Acknowledge to record that someone is on it, or Clear to dismiss it early.",
      "Check the Resolved log for signals that have converged or been cleared.",
    ],
    tip: "Repeated scans of the same problem escalate one alert rather than raising duplicates, so the inbox stays quiet and meaningful.",
  },
  {
    id: "bundles",
    title: "Data bundles",
    purpose: "Package the linked directory into a redacted, fingerprinted snapshot for downstream consumers.",
    steps: [
      "In Build a bundle, choose a Target, Scope and Format, name it, and decide whether to include links, registry metadata, sensitive and hub-private fields.",
      "Press Refresh preview to inspect the payload, then Download preview to save it, or Publish bundle to freeze it.",
      "In Published bundles, expand any entry to Copy JSON or Download it again as JSON, CSV or link CSV; Delete removes a snapshot.",
    ],
    tip: "Sensitive and hub-private fields are stripped unless you explicitly opt in, so a default bundle is safe to hand to an external assistant.",
  },
  {
    id: "audit",
    title: "Audit log",
    purpose: "The immutable, hash-chained record of every cross-tool movement and modification.",
    steps: [
      "Use Filter the ledger (free text plus action, connector, entity type, direction and order) to isolate entries; Reset filters clears them.",
      "Press Details on a row to expand its actor, subject, field movement and payload.",
      "Use Entity lifecycle to trace one record across every tool that touched it.",
      "Press Verify chain to re-hash the ledger and prove nothing was edited, reordered or removed; Record note appends an operator entry.",
    ],
    tip: "Each entry hashes the one before it, so the chain stays verifiable even after the short-term event log prunes old events.",
  },
  {
    id: "monitor",
    title: "Connector monitor",
    purpose: "Live health for every connector, plus latency and a single aggregator for every failure.",
    steps: [
      "Read the stat row, then press Send heartbeat for a one-off sweep or Start auto heartbeat and choose an Interval for continuous checks.",
      "In the Connectivity dashboard, press Simulate outage on a connector to see the dashboard, latency and error aggregator react; press Restore connector to recover.",
      "Review the three Latency tracking tables — event bus publishes, sync jobs and connector probes.",
      "Filter the Error aggregator by category and severity; repeated failures are collapsed into one counted row.",
    ],
    tip: "Heartbeats, latency and aggregated errors are derived from the durable event log, so a page reload never double-counts them.",
  },
  {
    id: "events",
    title: "Event bus",
    purpose: "The messaging surface: publish validated envelopes, watch the stream, and manage subscriptions.",
    steps: [
      "In Publish an event, choose the event type and source, edit the JSON payload, and press Publish. Reset to sample restores the sample payload.",
      "An invalid payload is rejected before any subscriber sees it — read the rejection message to correct it.",
      "Use the Event stream (filter by topic, Clear log) to watch envelopes arrive newest-first.",
      "In Subscriptions, Register subscription for a connector and topic, or Remove one you no longer need.",
    ],
    tip: "Registering or removing a subscription is itself an event, so subscription changes show up in the stream and the audit ledger.",
  },
  {
    id: "tests",
    title: "Validation tests",
    purpose: "The in-browser test suite that proves the hub behaves after every change.",
    steps: [
      "Press Run all tests and wait for the suite to finish.",
      "Read the per-suite results; any failure shows the test name and the assertion message.",
      "You can also run them from the browser console with await window.puTests.run().",
    ],
    tip: "The suite runs entirely in your browser against an in-memory hub, so it never disturbs your saved data.",
  },
  {
    id: "help",
    title: "Help & about",
    purpose: "This screen: a quick-start orientation, a guide for every screen, the shared vocabulary and deployment details.",
    steps: [
      "Read the five quick-start steps to get oriented in under a minute.",
      "Select a screen in What each screen is for to jump to it, or open its step-by-step guide below.",
      "Check Key concepts if a term in another screen is unfamiliar, and About for the version, maintainer and storage mode.",
    ],
    tip: "Every screen also carries a collapsible “How to use this screen” panel at the bottom, with the same steps.",
  },
];
