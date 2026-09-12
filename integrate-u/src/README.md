# Integrate-U

Integrate-U is the **integration hub** for the Project U family of small-business
generators (IT-U, CRM-U, PSA-U, RMM-U, …). It provides one canonical identity for
companies and customers, an integration registry that declares who owns which
field, a versioned event bus, cross-tool entity linking, drift-aware sync,
exportable data bundles, and connector monitoring.

## Purpose

Once a small business runs more than one tool, the same company, customer,
device, ticket or invoice exists in several systems — each with its own copy,
its own truth and its own permissions. Integrate-U is the hub that sits between
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
  events.js             Event bus: publish composer, live stream, subscriptions
  tests.js              Validation test runner UI
  help.js               Help & about: quick start, per-screen guides, glossary
  guides.js             The guide + glossary content used by help.js and every
                        screen's “How to use this screen” panel
src/tests/            In-browser validation harness + suites
  harness.js            suite()/test()/assert helpers + runTests()
  *.test.js             Suites grouped by concern
```

Persistence: the hub stores everything in `kv-plugin` folders named
`<storageNamespace>__<collection>` (e.g. `pu_integrate_u__company`). If kv is
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

`event-catalog.js` is the single source of truth for the 27 versioned event
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
polish pass. 219 validation tests.

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
from the console run `await window.puTests.run()`.
