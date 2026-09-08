# PSA Workspace — Specification

## System overview
A single integrated Professional Services Automation (PSA) application for small
service businesses, covering:

- clients & statements of work
- project planning (work plans, schedule/baseline, templates, scope changes)
- resource management (pool, allocations, capacity/utilization, conflicts)
- time & expense tracking (timesheets, approvals, expenses, actuals roll-up)
- project accounting & billing (budget vs actual vs forecast, profitability,
  billing methods, invoices, unbilled tracking, credit notes)
- reports & dashboards
- multi-user roles & realtime collaboration (Phase 10)

One **master core** keeps everything consistent: clients, service catalog, rate
cards, and resource pool. Booked time, budgets, utilization, and profitability
are all derived from that core — never hand-entered in multiple places.

## Pipeline integration (the small-business bus)
- **Ingest** idea bundles from idea-incubator and won-deal bundles from the CRM
  as service opportunities → SOWs → projects (value and scope carried over).
- **Exchange** project state (phases, milestones, statuses, health) with
  project-master, in both directions.
- **Publish** invoices for the-ledger to record; consume payment receipts back
  into each project's billing status (unpaid / partial / paid).
- **Exchange** expense and purchase data with the ERP so procurement costs land
  in project actuals.
- Remain open to future PSA modules.

## Data & storage rules
- All module data lives as **versioned JSON documents** under the PSA's own
  storage namespace (one document per module, split when large), with locally
  cached edit keys and a fast local cache. Canonical documents are
  cross-device; the local cache keeps the app fast offline.
- Every startup reconciles the local cache against canonical documents;
  same-document concurrent edits require explicit keep-mine / keep-theirs /
  field-level-merge resolution — neither side's changes are ever silently
  discarded.
- All writes are idempotent; one-click full backup (downloadable file +
  published backup document) and a validated restore flow.
- Integrity checks run after every write and surface as a system-health
  indicator: referential integrity, capacity/override rules,
  budget/actual/forecast tie-out, ledger tie-out, and no invoices from
  unapproved time.
- Capacity view shows each document's size against the storage ceiling;
  closed projects and past periods can be archived to a read-only,
  restorable archive.

## Billing & approval rules
- Rate cards override the catalog per client/project (role-based rates,
  effective dates, discounts) — a single source of truth for quotes and
  invoices. **Editing rate cards is admin-only.**
- Billing methods: fixed fee, time-and-materials, milestone. T&M invoices from
  approved billable time/expenses via the rate card; fixed/milestone from
  milestone completion. Invoiced time/expenses are locked to preserve the
  audit trail; credit notes reverse them with a required reason.
- Approvals: SOW draft → sent → approved/rejected (approved SOW seeds a
  project with budget + schedule); timesheet submitted → approve/reject/return
  with comment; expenses editable until posted.
- Actuals roll up automatically (hours × cost rate = cost, hours × effective
  rate = revenue, plus expenses). Forecast = remaining plan effort at current
  burn rate. Health is derived, never hand-entered.
- Allocations respect capacity (over-allocation flagged red, blockable past a
  configurable tolerance); skill-based suggestions surface free resources.

## Roles & access (Phase 10)
When connected to the realtime hub, every sensitive action is authorized
**server-side** by role (the server is the authority — hiding buttons is only a
courtesy):

- **consultant** — log timesheets & expenses, submit for approval.
- **manager** — approve/reject/return timesheets, approve SOWs, create
  invoices, mark sent, record payments, issue credit notes, publish to the
  pipeline, download backups, view the audit log.
- **admin** — everything a manager can, plus edit rate cards, close projects,
  restore backups, archive, and manage roles (setrole).

Offline (single-user), every action is allowed — roles only apply once you
join the hub. The admin password is never stored in the code (only its SHA-256
hash in the server script); the plaintext is delivered to the workspace owner
out-of-band.

## Realtime collaboration (Phase 10)
- A server-plugin hub maintains a lightweight index of document versions and
  broadcasts change events per module topic; open sessions learn of changes
  within seconds while payloads stay in the document store.
- Two users on the same record see each other's saved changes live, with a
  visible changed marker and inline conflict resolution; degrades to
  polling-based refresh whenever the hub is unreachable.
- Connections are rate-limited and grouped by coarse network signals; every
  remote change flows through the same idempotent version-checked document
  layer, and the audit log records the true actor in multi-user mode.

## Roadmap
Development is complete: all 44 milestones across 10 phases are implemented
(PSA core & document store, clients/SOWs, projects & planning, resource
management, time & expense, billing, reports & dashboards, pipeline bus,
quality & tests, and the multi-user realtime milestone). Four automated test
suites cover the system (shell/router 48, document store 30, feature chains
54, realtime hub + server authorization 19) — see `src/README.md` for how to
run them.
