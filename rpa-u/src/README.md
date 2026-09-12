# RPA-U

RPA-U is the **integration hub** for the Project U family of small-business
generators (IT-U, CRM-U, PSA-U, RMM-U, …). It provides one canonical identity for
companies and customers, an integration registry that declares who owns which
field, a versioned event bus, cross-tool entity linking, drift-aware sync,
exportable data bundles, and connector monitoring.

## Purpose

Once a small business runs more than one tool, the same company, customer,
device, ticket or invoice exists in several systems — each with its own copy,
its own truth and its own permissions. RPA-U is the hub that sits between
the Project U members (IT-U, CRM-U, PSA-U, RMM-U, and anything built from
`template-u`) and makes them behave like one coherent system:

- **One canonical identity** for companies and customers, so “Acme Ltd” in
  CRM-U and “Acme Limited” in PSA-U converge on a single record.
- **One integration registry** that declares, per field, which tool owns it,
  whether it is authoritative, and how it synchronises.
- **One event bus** so tools talk through validated, versioned, auditable
  events instead of reaching into each other's data.
- **One source of truth per field** — the hub resolves references from the
  owning tool rather than duplicating values.
- **Trustworthy movement of data** — idempotent sync jobs, ownership-driven
  conflict resolution, drift detection and alerting, a hash-chained audit log,
  and exportable JSON/CSV bundles.
- **Visibility** — a live connector monitor for health, latency, errors and
  heartbeat.

## Documentation

- [`API.md`](./API.md) — the internal event bus and registry APIs, plus a map of
  every other hub subsystem.
- [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) — every config key and catalog entry to
  change when deploying your own hub.
- [`CLONING.md`](./CLONING.md) — step-by-step guide to spinning up a new Project U
  member from the template and wiring it to the hub.
- Boot configuration: [`../main.pjs`](../main.pjs) → the `pu` block.
- In-app **Help & about** screen (`#/help`) — orientation, a guide for every
  screen, and the shared vocabulary, also available from the header.
- Reference framework: template-u (`https://perchance.org/template-u`).

## Architecture

```
index.html            App shell: header, sidebar, main region, toasts
main.pjs              $meta + the `pu` boot/identity/branding configuration
src/app.js            Boot sequence: config → shell → router → first render
src/styles.css        Design tokens (light/dark) and shared components
src/README.md         Project README: purpose, architecture, conventions (this file)
src/API.md            Internal event-bus and registry API reference
src/CUSTOMIZATION.md  What to rename/configure when deploying the hub
src/CLONING.md        Guide to spinning up a new Project U member
src/framework/        Reusable, feature-agnostic primitives
  config.js             Reads and normalises the `pu` block
  dom.js                Tiny element builder / DOM helpers
  router.js             Hash router
  shell.js              Header, nav, page-head helpers
  theme.js              Light/dark mode + branding tokens
  toast.js              Transient notifications
src/core/             Domain systems
  ids.js                Canonical identifier primitives (prefixes, slugify,
                        normalise, FNV-1a hash, token similarity)
  db.js                 kv-backed collection store with write-through + memory fallback
  catalog.js            Static model: connectors, entity types, field model,
                        capabilities, canonical roles, per-tool role maps
  registry.js           Field ownership / authoritative source / sync direction
  permissions.js        Canonical roles + capability resolution across tools
  identity.js           Canonical entity store: matching, refs, merge, search
  event-catalog.js      Event types, payload field specs, categories + topics
  event-schema.js       Envelope/payload validation, sample + field descriptions
  event-log.js          Durable short-term event log: append, replay, checkpoints
  event-bus.js          Publish/subscribe with validation, history and stats
  subscriptions.js      Per-connector topic subscriptions, persisted + delivered
  demo-data.js          Ground-truth demo feeds for the four connectors
  link-catalog.js       The six cross-entity link types + status vocabulary
  link-store.js         Indexed edge store (outgoing/incoming) persisted to `links`
  linker.js             Resolves references to canonical targets, builds edges
  reference.js          Owner lookup + hub derivations; copy / conflict / drift
  search.js             Weighted cross-tool search with link-state filters
  reconcile.js          Findings (unresolved, inconsistent, stale, duplicate…)
  sync-jobs.js          Idempotent keyed job runner + effect ledger
  conflict.js           Ownership-driven conflict detection and settlement
  alerts.js             Administrator alert inbox: raise, dedupe, escalate, clear
  drift.js              Drift ledger + scan: stale values, field conflicts, link drift
  exporters.js          JSON/CSV serialisation of a bundle (columns, quoting, preview)
  bundles.js            Bundle publisher: snapshot/scopes/redaction, persist + prune
  audit.js              Hash-chained audit ledger derived from the event stream
  monitor.js            Connector monitor: heartbeat probes, connectivity status,
                        latency samples and the aggregated error ledger
  openrpa/constants.js  The OpenRPA connector descriptor, capability set,
                        connection fields and OpenFlow command catalogue
  openrpa/profiles.js   OpenFlow connection profiles: validation + persistence
  openrpa/protocol.js   The OpenRPA wire protocol: envelope, correlation,
                        timeouts, retry-with-backoff, connection-state events
  openrpa/emulator.js   An in-browser OpenFlow endpoint (fixtures + commands)
  openrpa/session.js    JWT decode/mint + username/JWT sign-in, expiry and
                        OpenFlow-role → canonical-role mapping
  openrpa/documents.js  The typed document model (normalise/serialise, lossless
                        unknown-field preservation), the query builder, named
                        queries, paging and the CRUD/optimistic-concurrency
                        document service
  openrpa/workflows.js  Presents workflow documents — parameters, flags, queue
                        binding — without exposing raw XAML
  openrpa/acl.js        The OpenFlow users/roles/ACL mirror, rights bitmask and
                        effective-rights computation (deny wins, deny-by-default)
  openrpa/workitems.js  Work-item queues and the item lifecycle: the state
                        machine, retry-policy routing, single/bulk enqueue,
                        claim, completion, the filterable board and the queue CRUD
  openrpa/files.js      File storage: metadata + content upload, listing,
                        checksum verify, download data URLs, and attachment
                        wiring into work items
  openrpa/invocation.js Workflow invocation: correlation ids, the pending-reply
                        registry, timeout/cancel handling and the normalised
                        success/failed/timeout/cancelled invocation record
  openrpa/robots.js     Robot registry: presence (online/stale/offline) from
                        heartbeat age, heartbeat writes and the fleet summary
  openrpa/nodered.js    Node-RED instance registry: ensure, restart, remove and
                        hub link/unlink over the OpenFlow document store
  openrpa/taxonomy.js   The OpenRPA event taxonomy: the workitem/workflow/robot/
                        collection topic declarations and their registration
                        against the hub's versioned bus catalog
  openrpa/bridge.js     The real-time event bridge: exchange/queue registration,
                        document watches, server-push translation, the bounded
                        ordered buffer and the replayable event journal
  openrpa/ownership.js  Field ownership: the OpenRPA-owned fields per entity type,
                        per-connector conflict priorities and the ownership
                        validation report
  openrpa/linking.js    Entity links to OpenRPA workflows, queues, work items,
                        robots, invocations and Node-RED instances, with target
                        discovery, suggestions, auto-linking and orphan detection
  openrpa/drift.js      Drift monitor: compares hub snapshots against OpenFlow
                        document versions/values and flags field-, record- and
                        relationship-level drift
  openrpa/sync.js       Ownership-driven reconciliation under a chosen policy,
                        logging every applied change and its source
  openrpa/conflicts.js  Conflict review: reconciliation proposals, diffs,
                        approve/reject and the persisted decision history
  openrpa/bundles.js    Portable bundle store: snapshot/build, format validation,
                        dry-run planning, import and the published history
  openrpa/connector.js  Composes profiles, emulator, protocol, session, documents,
                        ACL, work items, file storage, invocation, robots,
                        Node-RED, the event bridge, entity linking, the drift
                        monitor, reconciliation, conflict review and portable
                        bundles, and exposes the composed health() probe
  openrpa/fixtures.js   The demo workflows, queues, work items, robots, docs
  hub.js                Wires the systems together; seed / reset / ready
src/views/            One module per screen; each exports a route object
  home.js               Overview + live hub stats
  identity.js           Canonical identity directory + duplicate merge
  registry.js           Connector field-ownership registry
  permissions.js        Role mapping + capability checker
  links.js              Entity links: type matrix, unresolved refs, explorer
  search.js             Cross-tool search across every connector
  sync.js               Sync queue: enqueue, run, retry, idempotency ledger
  reconcile.js          Reconciliation: field resolution + findings + hygiene
  conflicts.js          Conflict settlement rules + competing-write simulator
  drift.js              Drift signals + fix jobs + alert inbox
  bundles.js            Data bundles: build/preview/publish + published history
  audit.js              Audit log: filters, entity lifecycle tracer, chain verify
  monitor.js            Connector monitor: health dashboard, latency tables,
                        error aggregator, heartbeat controls
  openrpa.js            OpenRPA / OpenFlow connector: profiles, connection,
                        authentication, protocol stats and the offline emulator
  openrpa-data.js       OpenRPA data: collection browser + query builder,
                        document detail (typed fields, workflow presentation,
                        ACL), document writing with optimistic concurrency, and
                        the users/roles/access mirror
  openrpa-work.js       OpenRPA work board: queue CRUD with retry/routing policy,
                        single & bulk enqueue, claim/lifecycle/retry/cancel
                        actions, the filterable item board with payload and error
                        inspection, and file storage with attach/detach
  openrpa-automation.js Automation & monitoring: correlated workflow invocation
                        with awaited or fire-and-forget dispatch, the pending and
                        history view, the robot fleet with heartbeats, Node-RED
                        instance management, and live connector health
  openrpa-events.js     Event bus bridge: register OpenFlow exchanges and queues,
                        subscribe to document change streams, the normalized
                        work-item/robot/collection event stream with ordering and
                        backpressure, and journal replay/audit with filters
  openrpa-sync.js       Sync & conflicts: the field-ownership matrix, entity
                        links with auto-link/unlink, drift scanning, policy-driven
                        reconciliation, proposal review and the change/decision
                        history
  openrpa-bundles.js    Export & import: build a versioned, secret-free bundle
                        from profiles, ownership, links, documents and assets,
                        validate/dry-run/import one, and the published history
  openrpa-guide.js      OpenRPA guide: the connection checklist, a topic index
                        and step-by-step help for every OpenRPA capability,
                        including troubleshooting a failed connection
  events.js             Event bus: publish composer, live stream, subscriptions
  tests.js              Validation test runner UI
  help.js               Help & about: quick start, per-screen guides, glossary
  guides.js             The guide + glossary content used by help.js and every
                        screen's “How to use this screen” panel
src/tests/            In-browser validation harness + suites
  harness.js            suite()/test()/assert/onRunStart helpers + runTests()
  *.test.js             Suites grouped by concern
```

Persistence: the hub stores everything in `kv-plugin` folders named
`<storageNamespace>__<collection>` (e.g. `pu_rpa_u__company`). If kv is
unavailable the same API is backed by an in-memory store, so the app degrades
gracefully (see `createDb().mode`). On first load the hub seeds the demo
directory from `src/core/demo-data.js`; the Canonical identity screen can re-run
the import or reset the data.

The event system (Phase 2) layers onto the same storage:

```
publish(type, payload)  → event-bus validates against event-schema
                        → appends the envelope to event-log (collection `events`)
                        → delivers to matching subscriptions (pattern → handler)
subscriptions.register  → emits `subscription.registered` / `.removed` events
event-log.recover(id)   → replays only the events after a connector's checkpoint
```

`event-catalog.js` is the single source of truth for the 41 versioned event
types, their payload fields (required/optional), categories and topics. The
`hub` exposes `log`, `bus`, `subscriptions`, `publish`, `ingest` and `merge`;
`ingest`/`merge` publish the corresponding `identity.*` events automatically.
Reset (`hub.resetData()`) clears identity data, the event log and subscriptions,
then restores the default subscription matrix and re-seeds the demo directory.

Status: all eight phases are complete. Phases 1–6 deliver the functionality above
(canonical identity, integration registry, permission mapping, event bus, event
validation, subscription manager, event persistence, entity linking,
reference-not-copy resolution, cross-tool search, reconciliation, idempotent
sync jobs, ownership-driven conflict resolution, drift detection, drift
alerting, bundle publishing, export formats, the audit log, log filtering, the
connectivity dashboard, latency tracking, the error aggregator and the system
heartbeat); Phase 7 adds the developer documentation set — this README plus
[`API.md`](./API.md), [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) and
[`CLONING.md`](./CLONING.md); Phase 8 adds the in-app **Help & about** centre
(with a collapsible “How to use this screen” guide on every route), a full
end-to-end code review, the removal of the internal build checklist, and a final
polish pass. The OpenRPA connector (Phases 1–2 of the OpenRPA roadmap) adds
first-class OpenRPA / OpenFlow automation: connection profiles, a wire-protocol
client with retries, session and role mapping, an offline emulator, the typed
document model with lossless unknown-field preservation, a query builder with
named aliases and paging, CRUD with optimistic concurrency, workflow-document
presentation and the users/roles/ACL mirror — surfaced by the **OpenRPA** and
**OpenRPA data** screens. Phase 3 of the OpenRPA roadmap adds the **OpenRPA work
board**: work-item queues with a retry/routing policy, single and bulk enqueue,
claiming by priority and due time, the new → processing → success/failed
lifecycle with business-rule failures, and OpenFlow file storage wired into work
item attachments. Phase 4 of the OpenRPA roadmap adds workflow invocation, the
robot fleet and Node-RED management: a correlation service that dispatches
`createworkflowinstance` and resolves the terminal `workflowinstance` push into a
`success` / `failed` / `timeout` / `cancelled` invocation record (emitting
`workflow.invoked`, `workflow.completed` and `workflow.failed` on the bus), a
robot registry with online / stale / offline presence derived from heartbeat age,
a Node-RED instance registry that can ensure, restart, link and delete instances,
and a `health()` probe that folds protocol counters, queue depths, reconnects,
latency and error rate into one status. All of it is surfaced by the
**Automation & monitoring** screen. Phase 5 of the OpenRPA roadmap adds the
**Event bus bridge**: the connector registers an OpenFlow exchange and every
queue, subscribes to document watches, and translates work-item, robot,
collection and non-terminal workflow pushes into normalized, versioned hub
events taken from a dedicated OpenRPA event taxonomy (four topics, eleven types,
registered against the bus catalog). Events are buffered with per-correlation
ordering and a bounded backpressure policy (drop-oldest, drop-newest or coalesce
keyed heartbeats), drained in bounded batches so the UI thread stays responsive,
and journaled with sequence numbers for filtered replay and audit by topic,
correlation id and time range. 349 validation tests.

The linking layer (Phase 3) turns each declared cross-entity field (a ticket's
`linkedDevice`, an invoice's `company`, …) into a directed edge stored in the
`links` collection. `link-catalog.js` declares the six link types; `linker.js`
resolves a field to a canonical target by exact/prefix/partial token matching
(plus domain and email normalisation) and reports `linked` / `ambiguous` /
`dangling` / `empty` / `missing`; manual overrides win over automatic matches.

`reference.js` answers "who owns this value?" using the registry: it classifies
each field as `owner`, `copy`, `conflict`, `stale`, `derived`, `private` or
`unregistered`, computes derived counts (`assetCount`, `openTicketCount`,
`lastSeenDevice`, …) from the link graph, and can `fetch`/`refresh` a value from
its owning connector (emitting `sync.requested` / `sync.completed`).
`reconcile.js` composes those checks into dismissible findings:
`unresolved-reference`, `inconsistent-link`, `field-conflict`, `copy-drift`,
`stale-value`, `duplicate-identity` and `orphan-link`, each with a resolve
action (link, merge, refresh, prune, dismiss). `search.js` scores every entity
by id/name/reference/field match so one query spans all connectors.

The integrity layer (Phase 4) keeps the hub honest as data moves:

```
sync-jobs.js  → keyed jobs (kind + target) with an effect ledger, so retries,
                replays and duplicate submissions apply a change exactly once
                (applyOnce), retry to a limit, then dead-letter
conflict.js   → maps each field's sync direction to a settlement rule
                (owner-authoritative / owner-wins-two-way / hub-derivation /
                hub-local), resolves conflicts idempotently by fingerprint
drift.js      → scans the graph and field registry for stale derived values,
                field conflicts and link drift; maintains a drift ledger and
                groups signals into one alert per entity + kind
alerts.js     → raise / acknowledge / clear inbox that dedupes repeats,
                escalates severity and reopens cleared alerts
```

`hub.ready()` primes integrity: it scans for drift, raises alerts, and enqueues a
`sync.field` (or `link.rebuild`) fix job for every open signal — queued, not run,
so the seeded baseline stays intact until the operator (or a test) runs the
queue. New events (`sync.job`, `conflict.detected`/`resolved`,
`drift.detected`/`cleared`, `alert.raised`/`acknowledged`/`cleared`) flow through
the validated bus. The **Sync jobs**, **Conflicts** and **Drift & alerts**
screens expose the queue, the settlement rules and the alert inbox; the sidebar
shows an open-alert badge.

The output layer (Phase 5) turns the linked directory into shippable artefacts
and a tamper-evident record of everything that moved:

```
exporters.js  → serialises a bundle to JSON or CSV: stable entity/link columns,
                RFC-4180 quoting, bounded previews, stable filenames
bundles.js    → build() snapshots the directory (scopes: all / directory /
                assets / service), strips sensitive and hub-private fields unless
                the caller opts in, records a content fingerprint and integrity
                snapshot; publish() persists it (newest 25) and emits
                `bundle.published`; targets are ai-assistant, knowledge-base,
                data-warehouse and backup-archive
audit.js      → derives an immutable, hash-chained ledger from the event stream;
                each entry carries action, direction (in / out / internal),
                actor, subject entity, field movement and payload; verify()
                recomputes the chain and pinpoints any edited entry
```

Because the chain hashes the previous entry, audit entries stay verifiable even
after the short-term event log prunes. `hub.ready()` hydrates bundles and audits
the seeded baseline (the audit monitor catches up on every logged event), and
`resetData()` clears bundles and rebuilds a valid audit baseline. The **Data
bundles** screen builds, previews and publishes snapshots and re-exports
published bundles as JSON/CSV; the **Audit log** screen filters the ledger by
action, connector, entity type, direction and free text, traces a single
record's lifecycle and verifies the chain.

The monitoring layer (Phase 6) is the live health view of the whole hub:

```
monitor.js    → probes every connector (defaultTransport honours injected
                incidents), records reachability + round-trip latency, and
                maintains a status per connector (up / degraded / down) against
                configurable thresholds (degradedMs, downMs)
              → heartbeat({trigger}) sweeps all connectors on demand or on a
                setInterval; start()/stop() control the schedule; each sweep
                emits `connector.health` transitions and one `monitor.heartbeat`
              → recordPublish times every bus publish, so latency is tracked for
                the event bus (by topic), sync jobs (by kind) and probes (by
                connector); errors aggregate failed syncs, validation
                rejections, throwing subscribers and unreachable connectors,
                collapsing repeats into counted rows
```

Connectivity `status` is persisted to the `monitor` collection; the error ledger
is deliberately not persisted — it is rebuilt from the durable event log on
`catchUp()`, so a reload never double-counts. `hub.ready()` hydrates the
monitor, catches up and runs one silent heartbeat so the seeded baseline stays
clean; `resetData()` does the same after clearing state. `hub.publish` routes
through the monitor's timing wrapper, so bus latency is captured for every
event regardless of source. The **Connector monitor** screen shows the
availability/health/latency/error stat row, heartbeat controls with an interval
selector, the per-connector connectivity dashboard (with outage injection),
three latency tables and the filterable error aggregator.

The OpenRPA connector (Phase 1 of the OpenRPA roadmap) adds the hub's first
automation endpoint:

```
openrpa/constants.js → the connector descriptor registered in the catalog
                        (id, brand, capability set, connection fields) plus the
                        OpenFlow command catalogue
openrpa/profiles.js  → validates an endpoint (full ws:// URL, or scheme + host +
                        port + path, tenant, TLS choice, optional REST base) and
                        persists one or more named profiles
openrpa/protocol.js  → the OpenRPA / OpenFlow envelope { id, replyto, command,
                        data }: promise correlation by reply-to, per-request
                        timeouts, retry-with-backoff on transport failure, and
                        connection-state events; a guarded WebSocket transport
                        plus a loopback transport for tests and the emulator
openrpa/emulator.js  → a full in-browser OpenFlow endpoint: sign-in, document
                        query/count/insert/upsert/update/delete, work-item and
                        queue operations, robots, Node-RED instances, file
                        storage, watches and server push — seeded with demo
                        workflows, queues, work items, robots and documents
openrpa/session.js   → username/password or pasted-JWT sign-in, JWT decode/mint,
                        expiry tracking, refresh, and OpenFlow-role →
                        canonical-role mapping
openrpa/documents.js → the typed document model: normalise a raw OpenFlow
                        document into { id, type, name, timestamps, authors,
                        version, ACL, typed values, unmapped fields } and
                        serialise it back losslessly; a JSON query builder
                        (query / order-by / projection) with named-query
                        aliases and paging; and the CRUD service (insert,
                        insertMany, upsert-by-uniqueness-key, update with
                        expected-version optimistic concurrency, delete/deleteMany)
                        that classifies conflicts, validation and transport
                        failures distinctly
openrpa/workflows.js → presents a workflow document's queue binding, RPA/web
                        flags, parameter list (name/type/direction/required/
                        default), filename and background/serializable flags —
                        never the raw XAML by default
openrpa/acl.js       → mirrors OpenFlow users, roles and per-document ACL
                        entries, decodes the rights bitmask, and computes the
                        effective rights for a subject (deny always wins, no
                        matching entry means denied)
openrpa/workitems.js → the queue + work-item service: normalize a queue and an
                        item, the state machine (new → processing → success /
                        failed), retry-policy planning (max retries, retry delay,
                        business-rule failures), success/failed queue routing,
                        single/bulk enqueue with validation, claim-by-priority-and-
                        due-time, completion, retry/requeue/cancel/update/delete,
                        and the filterable board with per-state counts
openrpa/files.js     → file storage mirroring OpenRPA.PS/Files/AddFile.cs +
                        GetFile.cs: metadata plus content upload, listing,
                        checksum verification, download data URLs, and work-item
                        attach/detach; the storage layer Phase 7's asset export
                        reuses
openrpa/invocation.js → the workflow-invocation service: generate a correlation
                        id, register the pending reply before dispatching
                        `createworkflowinstance`, resolve the terminal
                        `workflowinstance` server push (or time out / cancel)
                        into a normalised success/failed/timeout/cancelled
                        record, and emit workflow.invoked/completed/failed
openrpa/robots.js    → the robot registry: list machines from OpenFlow, derive
                        online/stale/offline presence from the last heartbeat
                        age, write heartbeats with metrics, and summarise the
                        fleet (online/stale/offline counts)
openrpa/nodered.js   → the Node-RED instance registry: list, ensure (idempotent
                        by name), restart, remove, and link/unlink an instance
                        to a hub connector, tracking the document version
openrpa/taxonomy.js  → the OpenRPA event taxonomy: the topic/type declarations,
                        payload schemas, schema version and topic patterns, plus
                        a registration check against the hub's event catalog
openrpa/bridge.js    → the real-time event bridge: register the exchange and
                        every queue, subscribe to OpenFlow document watches,
                        translate work-item / robot / collection / workflow
                        pushes into normalized bus envelopes, buffer them with
                        ordering and a bounded backpressure policy, drain in
                        batches, and journal every envelope for replay and audit
openrpa/ownership.js → declares the OpenRPA-owned fields per entity type, the
                        per-connector conflict priority, the hub↔OpenFlow value
                        mapping, and validates the whole declaration against the
                        shipped registry
openrpa/linking.js   → discovers every OpenRPA target (workflows, queues, work
                        items, robots, invocations, Node-RED instances), binds
                        canonical entities to them (manually, by similarity, or
                        automatically from payload references), and reports
                        work items that reference unknown entities
openrpa/drift.js     → compares the hub snapshot against the linked OpenFlow
                        documents and records field drift (value mismatch),
                        record drift (version past the captured baseline) and
                        relationship drift (target gone / orphan reference)
openrpa/sync.js      → turns each open drift signal into a proposal and, under
                        manual / prefer-hub / prefer-openrpa, adopts, pushes or
                        re-baselines it, logging every applied change and source
openrpa/conflicts.js → the review surface over those proposals: diff, approve,
                        reject, undo and the persisted decision history
openrpa/bundles.js   → snapshots profiles (allow-listed, secrets stripped),
                        ownership, links, OpenRPA documents and workflow assets
                        into a versioned bundle with a checksum manifest, then
                        validates, dry-runs and imports one
openrpa/connector.js → composes the modules above into hub.openrpa, and folds
                        their counters plus the protocol stats into health()
```

`hub.openrpa` hydrates with the rest of the hub (`ready()`) and is cleared by
`resetData()`. The connector monitor probes OpenRPA alongside the Project U
members. The **OpenRPA** screen manages connection profiles, connects (offline
emulator or a live endpoint), signs in and shows the mapped roles and
capabilities, reports protocol statistics, and explores the emulator's fixtures —
including simulated endpoint failures for exercising retries. The **OpenRPA
data** screen browses every OpenFlow collection with a JSON query builder and
named-query aliases, inspects a typed document (workflow definitions, unmapped
fields, ACL, raw JSON behind a disclosure), writes documents with optimistic
concurrency and typed error reporting, and shows the mirrored users/roles with an
effective-rights evaluation per document. See
[`API.md`](./API.md#openrpa-connector) for the full `hub.openrpa` surface. The
**OpenRPA work board** screen manages queues and their retry/routing policy,
enqueues single and bulk items, claims the next due item by priority, drives the
lifecycle with retry/cancel/requeue actions and a payload/error inspector, and
stores files wired into work-item attachments.

Phase 4 of the OpenRPA roadmap turns the connector into something you can drive:

```
invocation.invoke({ workflowId, queue, payload })
  → generate a correlation id, register the pending reply
  → dispatch `createworkflowinstance` (or fire-and-forget)
  → resolve the terminal `workflowinstance` push into a record:
      success | failed | timeout | cancelled
  → emit workflow.invoked, then workflow.completed or workflow.failed
robots.list()      → presence for each machine: online | stale | offline,
                     derived from the heartbeat age against tunable thresholds
nodered.ensure() / .restart() / .remove() / .link() / .unlink()
health()           → state, latency, reconnects, queue depths, error rate,
                     attempts and the thresholds, with one rolled-up status
```

Every invocation is correlated: the service keeps a pending map keyed by
correlation id, so a late or mismatched server push is ignored rather than
corrupting another call's result, and a caller can `cancel()` a pending
invocation. The service emits onto the hub bus when it is wired through the hub,
so the audit trail, event log and subscriptions all see the invocation lifecycle.
The **Automation & monitoring** screen invokes workflows (awaited or
fire-and-forget) with a JSON payload and an optional simulated failure, lists
pending and historical invocations, heartbeats the robot fleet, ensures and links
Node-RED instances, and shows the composed connector health with a live probe and
an injectable/restorable outage.

Phase 5 of the OpenRPA roadmap turns the connector's real-time surface into
normalized hub events:

```
bridge.enable()          → register the exchange + every queue, subscribe to the
                           configured watches, and start the emulator/live stream
bridge.handleState(evt)  → re-register and re-watch automatically on reconnect
bridge.watch(collection) / unwatch(id) / watchMany(list)
  → OpenFlow document watches; a matching insert/update/delete becomes
    collection.changed { collection, action, id, docType, version, watchId }
translateOpenRpaCommand(command, payload)
  workitem / queuemessage → workitem.enqueued | claimed | completed | failed | retried
  watchevent / collectionchanged → collection.changed
  robot   → robot.heartbeat | robot.stale | robot.offline
  workflowinstance → workflow.progress (non-terminal only; the invocation service
                     owns the terminal workflow.completed / workflow.failed)
bridge.push(message)     → buffer with per-correlation ordering; when full the
                           policy drops the oldest, refuses the newest, or
                           coalesces keyed heartbeats
bridge.drain() / flush() → emit in bounded batches so the UI thread stays responsive
bridge.audit(filter) / replay(filter, handler) / recent(n)
  → filtered journal by topic, type, correlation id and time range
```

The bridge journals every emitted envelope with its own monotonic sequence
number (persisted in the `openrpa_bridge` collection, hydrated on `ready()` and
cleared by `resetData()`), so a replay or audit survives a page reload. The
**Event bus bridge** screen drives enable/disable, the registration and watch
lists, the backpressure policy, and the filtered replay/audit over the bridged
stream.

Phase 6 of the OpenRPA roadmap gives OpenRPA first-class ownership of part of
every mapped entity, and makes divergence between the hub and OpenFlow a
first-class, reviewable thing:

```
ownership.js  → OPENRPA_FIELD_MODEL declares the OpenRPA-owned fields per entity
                type (automationStatus/Workflow/Queue/LastRun); OWNERSHIP_PRIORITIES
                gives every connector a conflict priority; registerOwnership()
                validates the declaration against the shipped registry
linking.js    → entity → {workitem, queue, workflow, robot, invocation, nodered}
                links; refreshTargets() reads the live endpoint and resolves each
                work-item payload reference back to a canonical entity (directly,
                or through the mirrored OpenFlow companies), then autolink()
                writes the auto edges and orphanReferences() surfaces the rest
drift.js      → compares the hub snapshot against the linked OpenFlow documents:
                field drift (hub value ≠ OpenFlow value), record drift (document
                version moved past the captured baseline) and relationship drift
                (the linked record is gone, or a work item points at an unknown
                entity)
sync.js       → proposes one change per open drift signal and, under
                manual / prefer-hub / prefer-openrpa, adopts, pushes or
                re-baselines it — logging every applied change with its source
conflicts.js  → the review surface: diff, approve, reject, undo and the
                persisted decision history
```

The **Sync & conflicts** screen (`#/openrpa-sync`) shows the ownership matrix,
discovers and links entities, scans for the three drift kinds, reconciles under
the chosen policy, and reviews every proposal with its hub-vs-OpenRPA diff. Its
state lives in the `openrpa_links` and `openrpa_sync` collections, hydrated on
`ready()` and cleared by `resetData()`.

Phase 7 of the OpenRPA roadmap makes an integration portable, and documents the
connector in-app:

```
bundles.build()          → snapshot profiles (allow-listed, secrets stripped),
                           ownership, entity links, OpenRPA documents and
                           workflow assets, each with a checksum, plus a
                           fingerprint over the whole manifest
bundles.export()         → build + (by default) publish, returning downloadable
                           JSON and a slugged filename
bundles.validate(input)  → format, version and section-shape checks with counts
bundles.plan() / preview() → a dry run: what would be created, updated or
                           skipped, with warnings for unknown target types,
                           missing entities and already-stored assets
bundles.import(input)    → apply the plan through profiles.create,
                           linking.link, documents.upsert and files.upload,
                           reporting every failure per section
```

A bundle never carries a credential: the profile writer copies only the
allow-listed connection fields and reports every stripped secret-like key. The
**Export & import** screen (`#/openrpa-bundles`) builds, previews, downloads,
publishes, validates and imports bundles and lists what this hub has published.
The **OpenRPA guide** screen (`#/openrpa-guide`) is the in-app walkthrough —
connecting, collections, queues and work items, invocation, events, ownership
and troubleshooting a failed connection — built from the same `OPENRPA_HELP`
notes shown in any OpenRPA screen's guide panel. Bundle state lives in the
`openrpa_bundles` collection, hydrated on `ready()` and cleared by
`resetData()`.

## Conventions

These are the rules every part of the hub follows — keep them in mind when
extending it.

- **One identity, one registry.** Companies and customers are matched onto a
  single canonical record; every field has exactly one owning connector
  declared in `src/core/catalog.js`. Nothing decides “who is right” on the fly.
- **Events are the only integration surface.** Tools communicate by publishing
  validated, versioned envelopes on the bus. They never write into each other's
  stores.
- **Reference, don't copy.** Shared values are fetched from their owner, not
  duplicated; copies that do exist are checked for drift.
- **Own it or derive it.** A field is either owned by one tool or computed by
  the hub — never independently edited on both sides.
- **Idempotent by construction.** Sync work goes through keyed jobs with an
  effect ledger, so retries and replays apply a change exactly once.
- **Everything is auditable.** Meaningful movement flows through the event log
  and the hash-chained audit ledger.
- **Degrade gracefully.** Persistence falls back to memory when `kv-plugin` is
  unavailable (`hub.storageMode()`), and the UI shows empty/loading/error states
  rather than breaking.
- **Feature-agnostic primitives live in `src/framework/`; domain logic in
  `src/core/`; screens in `src/views/`; tests in `src/tests/`.**
- Every screen is a route object: `{ id, title, group, icon, nav, render(ctx) }`.
- Read configuration through `src/framework/config.js` (`getConfig()`), never by
  poking at `window.root.pu` directly.
- Every roadmap task must add or update tests in `src/tests/` and leave the
  preview free of console errors at phone and desktop widths.

## Running the tests

Open the **Validation tests** section in the sidebar, press *Run all tests*, or
from the console run `await window.puTests.run()`. Suites that share a cached hub
register an `onRunStart()` reset, so the suite stays green when run repeatedly
within one page load.
