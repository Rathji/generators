# PSA Workspace — README & Playbook

Professional Services Automation (PSA) for Perchance — a single integrated
application for service businesses covering clients & statements of work,
project planning, resource management, time & expense tracking, and project
accounting & billing. Everything derives from one master core (clients,
service catalog, rate cards, resource pool), so booked time, budgets,
utilization and profitability stay consistent across modules.

The system is **feature-complete**: all 44 development milestones (across 10
phases — PSA core & document store, clients/SOWs, projects & planning,
resource management, time & expense, billing, reports & dashboards, pipeline
bus, quality & tests, and multi-user realtime) are done and covered by four
automated test suites totaling **151 checks**.

## How the system functions

### The master core and the derivation rule

One set of **master records** feeds everything else, and every derived number
is computed live — never hand-entered twice:

- **Clients**, **service catalog** (units, default rates, tax treatment) and
  **rate cards** (per-client/project overrides, role-based rates, effective
  dates, discounts) are the single source of truth for quoting and billing.
- **Resources** (people: roles, skills, cost rates, target utilization,
  availability) are the single source of truth for scheduling, capacity and
  utilization.
- **SOWs** (approved) seed **projects**; projects carry **work plans** (tasks),
  **allocations** (people → tasks), **milestones** and a **baseline**.
- **Timesheets** and **expenses** are the only hand-entered *actuals*; every
  other number rolls up from them.

The derivation layer (`src/psa/derive.js`) is a set of pure functions over a
`snapshot()` of all collections. Because it recomputes on every change, budget
vs actual, forecast (EAC at current burn rate), profitability, utilization,
unbilled, invoice-able items and project health are always current by
construction.

### The data lifecycle (entry → invoice → ledger)

A traceable chain connects every hour logged to the ledger:

1. **Record** — A timesheet entry (person, project, task, date, hours,
   billable) or expense (type, amount, project/task, receipt) is captured as a
   draft.
2. **Approve** — The entry is submitted and a manager approves/rejects/returns
   it (with a comment); the actor and timestamp are stamped. Approved SOWs
   seed their project.
3. **Actuals** — Approved time and expenses roll into the project's actuals:
   `hours × resource cost rate = cost`, `hours × effective rate = revenue`,
   plus expenses. Non-billable time counts toward hours/cost but not revenue.
4. **Unbilled** — Approved-but-not-invoiced work is the unbilled queue per
   project.
5. **Invoice** — T&M projects invoice from approved billable time/expenses via
   the rate card; fixed/milestone projects invoice from milestone completion.
   Invoiced time/expenses are **locked** (`postedToInvoiceId`) to preserve the
   audit trail.
6. **Pay** — Recording payments moves the invoice sent → partial → paid;
   outstanding balance is tracked.
7. **Ledger** — Invoices and payment receipts are published as pipeline
   bundles for the ledger to record; credit notes (with a required reason)
   reverse the corresponding postings.

### Storage, sync & conflict resolution

Every collection lives in **versioned JSON documents** (one document per
module, auto-split into shards past a per-document ceiling) in the PSA's own
editable-file namespace, with locally cached edit keys and a fast local cache
(kv). Behavior depends on mode:

- **Unsaved preview** — local-only (single device, no cloud documents yet).
- **Saved (cloud mode)** — documents live on the server; every startup
  reconciles the local cache against them. Same-document concurrent edits
  surface as explicit **keep-mine / keep-theirs / field-level-merge**
  resolution in Settings → Sync & conflicts — neither side's changes are ever
  silently discarded. Writes are idempotent and coalesced, so re-publishing
  identical content is a safe no-op.

Integrity checks re-run after every write and surface as the system-health
indicator (Settings → Data integrity): referential integrity, allocation
capacity/overrides, budget/actual/forecast tie-out, ledger tie-out, and "no
invoices from unapproved time".

### The realtime hub & roles

When multiple people use the same saved generator, the realtime hub keeps them
in sync and enforces roles. The **server** (a server-plugin script in
`index.html`, public source) is the authority: it holds a compact durable
roster + audit ring, broadcasts per-collection change events + presence +
audit topics, rate-limits by coarse network group, and authorizes every
sensitive action against a role PERMS table. The client (`src/psa/hub.js`)
keeps a persistent identity, reconnects with capped backoff, and falls back to
60-second polling whenever the hub is unreachable. Offline (or before joining),
the app runs in permissive single-user mode.

### The pipeline bus

The PSA participates in a shared small-business bus:

- **Ingest** idea bundles from idea-incubator and won-deal bundles from the
  CRM as service opportunities → SOWs → projects.
- **Exchange** project state (phases, milestones, statuses, health) with
  project-master, both directions.
- **Publish** invoices for the-ledger to record; **consume** payment receipts
  back into each project's billing status.
- **Exchange** expense/purchase data with the ERP so procurement costs land in
  project actuals.

## Usage guide

### Recommended setup order

1. **Settings → Users & realtime** — join the hub with your identity (optional
   for single-user; roles only apply once joined). If you own the workspace,
   claim admin to unlock rate-card editing, project closing, restore and role
   management.
2. **Clients → Clients** — add the firms you work for (industry, tax ID,
   payment terms, contacts, currency, active).
3. **Clients → Service catalog** — add the services you sell (unit, default
   rate, tax treatment, active). This is the fallback rate source.
4. **Clients → Rate cards** — (admin) add per-client or per-project role-based
   rates, effective dates and discounts. Anything referencing rates now
   reflects these.
5. **Clients → Statements of work** — draft a SOW (scope, deliverables,
   pricing, budget, timeline), send it, and approve it — approving seeds a
   project with its budget, milestones and schedule.
6. **Projects** — confirm the seeded project (or create one manually), set the
   billing method (time & materials / fixed fee / milestone), then build the
   **Work plans** tab (task breakdown with dates, effort, dependencies, role)
   and save a **baseline** on the **Schedule** tab. Optionally save reusable
   **Templates** and log **Scope changes** later.
7. **Resources** — add people to the **Pool** (roles, skills, cost rate,
   target utilization, availability), then create **Allocations** (people →
   tasks with planned hours/week and date range). Check the **Capacity**
   heatmap for over-allocation, use **Suggestions** to find free matching
   people, and review **Conflicts**.
8. **Timesheets** — each person logs **Entries** (project/task default from
   their allocations where possible); submit them; managers approve on the
   **Approval** tab.
9. **Expenses** — capture out-of-pocket and project costs with optional
   receipts; they stay editable until posted to billing, then lock.
10. **Billing** — review **Unbilled**, generate **Invoices** (preview line
    items, apply the rate card, publish to the ledger), record **payments**,
    and issue **Credit notes** when needed.
11. **Reports** — define and run saved reports (utilization, profitability,
    budget vs actual, timesheet detail, unbilled, availability), export to
    CSV or print; or bulk-import resources/work plans from CSV.
12. **Settings** — periodically run **Backup & restore** (one click),
    **Archive** closed projects and past periods, watch **Storage capacity**
    and **Data integrity**, and use **Pipeline** for bus exchanges.

### Module-by-module walkthrough

- **Dashboard** — live KPIs: billable utilization, project health, budget
  burn, unbilled hours/value, open SOWs, upcoming milestone invoices — every
  card deep-links to its source. Also shows the system-health indicator and
  pending sync conflicts.
- **Clients** (`#/clients`, `catalog`, `ratecards`, `sows`) — client CRUD;
  service catalog; rate cards (admin-only editing); SOW lifecycle
  draft → sent → approved/rejected with comments, and approved SOWs seed
  projects.
- **Projects** (`#/projects`, `workplans`, `schedule`, `templates`,
  `changes`) — project records with phases/milestones/budget/billing method
  and derived health; the work-plan task breakdown; a Gantt-style schedule
  with dependencies and a saveable baseline for variance; reusable templates;
  scope changes that move budget/schedule and keep a versioned SOW revision
  history. Closing a project is admin-only.
- **Resources** (`#/resources`, `allocations`, `capacity`, `suggestions`,
  `conflicts`) — the resource pool; task allocations that respect capacity; a
  weekly capacity heatmap (over-allocation flagged red, tolerance configurable
  here); skill/role-based suggestions filtered by free capacity; and a
  conflicts list for over-allocation and skill gaps.
- **Timesheets** (`#/timesheets`, `approval`) — weekly entries per person with
  weekly totals against booked hours, and a manager approval queue
  (submit → approve/reject/return with comment, actor + timestamps on every
  change).
- **Expenses** (`#/expenses`) — expense capture with type, amount, currency,
  project/task, billable flag, note and an optional receipt image; editable
  until posted to billing, then locked for the audit trail.
- **Billing** (`#/billing`, `unbilled`, `creditnotes`) — invoice generation
  (T&M from approved billable time/expenses; fixed/milestone from milestone
  completion) with number/date/due date/currency and status tracking plus
  payment recording; the per-project unbilled view; and credit notes that
  reverse ledger postings with a required reason.
- **Reports** (`#/reports`, `csv-import`) — saved report definitions
  (utilization, profitability, budget vs actual, timesheet detail, unbilled,
  availability) each runnable to CSV or print; and CSV import of resources and
  work plans with a preview-and-fix step that reports row-level errors before
  anything is committed.
- **Settings** (`#/settings`, `backup`, `capacity`, `archive`, `integrity`,
  `pipeline`, `users`) — sync-now + per-document conflict resolution; one-click
  backup/restore; storage capacity per document vs the ceiling; guided archival
  of closed projects and past periods (read-only, restorable); data-integrity
  checks with a system-health result; the pipeline bus (discover/ingest
  opportunities, publish project state/invoices/purchases, ingest receipts);
  and Users & realtime (identity, join, claim admin, live roster, change feed,
  audit log, roles).

### Daily / weekly / monthly rhythms

- **Daily** — consultants log timesheet entries and expenses, submit them;
  managers clear the approval queues.
- **Weekly** — check the capacity heatmap and utilization; catch over-allocation
  before it becomes a problem.
- **Monthly (or per billing cycle)** — review unbilled, generate invoices and
  record payments, run the reports you care about, and publish a backup.

## Architecture

- **Module framework** — `src/psa/core.js` holds the registry
  (`registerModule`, `MODULES`, `MODULES_BY_ID`), DOM helpers (`el`, `h`,
  `icon`, `moduleShell`, `pageHeader`), state components (`emptyState`,
  `loadingState`, `errorState`), toasts/modals, and the hash router
  (`parseRoute`, `startRouter`) with loading state and error boundary. Each
  module is one file in `src/psa/modules/*.js` that self-registers.
  `dispatch()` returns a promise that resolves once the module has finished
  rendering, so route changes and tests await actual completion.
- **Document store** — `src/psa/store.js` is the canonical persistence layer:
  every collection lives in versioned JSON documents (per-generator editable
  files, split across shards past a per-document ceiling). Locally cached edit
  keys (kv + localStorage) + a fast kv cache. Versioned (`rev`), idempotent,
  coalesced writes; unsaved-preview degrades to local-only; cloud mode syncs
  across devices. Collections are declared in `src/psa/collections.js`
  (`registerAllCollections`). Exposed on `window.__psaStore`.
- **Derivation layer** — `src/psa/derive.js` computes everything derived:
  project actuals (approved billable/non-billable time + expenses), unbilled,
  budget-vs-actual-vs-forecast, utilization, capacity heatmap, profitability,
  invoice-able items, health. Pure functions over `snapshot()`. Configurable
  settings (over-alloc tolerance, target utilization, week hours, currency)
  in `src/psa/settings.js`, stored in kv, exposed as `window.__psaSettings`.
- **Workflow rules** — `src/psa/workflow.js` owns state transitions
  (timesheet draft→submitted→approved/rejected/returned, expense
  draft→submitted→posted, SOW draft→sent→approved/rejected, project
  planned→active→closed) with actor/timestamp stamps.
- **Integrity checks** — `src/psa/integrity.js` runs after every write and on
  demand (Settings → Data integrity): referential integrity, allocation
  capacity/override, budget/actual/forecast tie-out, ledger tie-out, no
  invoices from unapproved time. Results in `window.__psaHealth`.
- **Backup & restore** — `src/psa/backup.js`: one-click downloadable backup +
  published backup document (upload-plugin editable file in the generator
  namespace), validated restore, idempotent re-publish.
- **Pipeline bus** — `src/psa/pipeline.js`: discover/ingest opportunity,
  receipt and purchase bundles; publish project-state, invoice and purchase
  bundles to the shared small-business bus. UI in Settings → Pipeline.
- **Realtime hub (Phase 10)** — the authoritative multi-user layer is a
  **server-plugin script in `index.html`** (public source, no secrets): a
  compact durable roster + audit ring buffer in server state, per-collection
  change topics + presence + audit subscriptions, coarse-network rate
  limiting, and a role PERMS table (consultant / manager / admin) that
  authorizes every sensitive action server-side. The admin password is never
  in the code — only its SHA-256 hash is embedded; the plaintext is delivered
  once to the workspace owner. `src/psa/hub.js` is the client (persistent
  identity, reconnect, server-verified authorize with permissive offline
  single-user fallback, change broadcasting, live presence/audit feeds, 60s
  polling fallback). Remote changes route through the version-checked conflict
  layer so concurrent edits surface as keep-mine / keep-theirs / merge.

## Key business rules

- **Rate cards** (`ratecards` collection) override the service catalog by
  client/project: role-based billing rates, effective dates, discounts. A
  change to a rate card is reflected in every quote/invoice using it (single
  source of truth). Editing rate cards is **admin-only**.
- **Billing methods** per project: fixed fee, time-and-materials, milestone.
  T&M invoices from approved billable time/expenses via the rate card;
  fixed/milestone from milestone completion. Invoiced time/expenses are
  locked (`locked`, `postedToInvoiceId`) to preserve the audit trail; credit
  notes reverse them with a required reason.
- **Approval workflows**: SOW draft → sent → approved/rejected (approved SOW
  seeds a project with budget + schedule); timesheet submitted →
  approve/reject/return with comment; expense editable until posted.
- **Budget/actuals**: actuals roll up automatically (hours × cost rate = cost,
  hours × effective rate = revenue, plus expenses). Forecast = remaining plan
  effort at current burn rate. Health (on track / at risk / over budget) is
  derived, never hand-entered.
- **Allocations** respect capacity (default 40h/wk, configurable); over-allocation
  flags red and is blockable past a configurable tolerance. Skill-based
  suggestions surface free matching resources.
- **Roles (when connected to the hub)**: consultants log time/expenses;
  managers approve timesheets & SOWs, create invoices, record payments, issue
  credit notes, publish to the pipeline, download backups; admins additionally
  edit rate cards, close projects, restore backups, manage roles, archive.
  Offline, every action is allowed (single-user mode).

## Collections

Every collection is a versioned document (auto-sharded past its ceiling).
Data modules: `clients`, `projects`, `resources`, `timesheets`, `expenses`,
`billing`. Supporting collections: `catalog` (service catalog), `ratecards`,
`sows`, `workplans`, `templates`, `scopechanges`, `allocations`, `reports`,
`archive`, `opportunities`, `pipeline`, `conflicts`, `audit`.

## Layout

- `main.pjs` — `$meta`, plugin imports (kv, uploadPlugin, superFetch,
  createServerSocket) and the small `psa` config list (firmName,
  defaultCurrency, weekStartsOn).
- `index.html` — app shell + the Phase 10 server-plugin script.
- `src/psa/styles.css` — all styles (CSS variables, layout grid, state cards,
  buttons, tables, responsive drawer, hub UI).
- `src/psa/main.js` — boot: nav, drawer, router, store boot, integrity +
  refresh on change, hub init, test-suite exports.
- `src/psa/modules/*.js` — dashboard, clients (incl. catalog/ratecards/SOWs
  tabs), projects, resources, timesheets, expenses, billing, reports,
  settings (sync/backup/capacity/archive/integrity/pipeline/users tabs).
- `src/psa/store.js` + `collections.js`, `derive.js`, `workflow.js`,
  `integrity.js`, `backup.js`, `pipeline.js`, `settings.js`, `store-ui.js`,
  `crud.js`, `core.js`, `hub.js` — the architecture described above.
- `src/psa/tests.js` / `tests-store.js` / `tests-features.js` / `tests-hub.js`
  — the four validation suites.

## Running the test suites

In the live preview console / page_eval:
```js
await window.runPsaTests()        // shell/navigation/router (48 checks)
await window.runPsaStoreTests()   // document store (30 checks)
await window.runPsaFeatureTests() // cross-module feature chains (54 checks)
await window.runPsaHubTests()     // realtime hub + server auth (19 checks)
```
Each returns `{total, passed, failed, results}`. Browser console and the
perchance error log should stay clean. Note: the 6 "state card" and 1
invoice-number checks assert the empty state / first invoice number, so they
only pass on a clean store (they fail while demo seed data is present).
`runPsaHubTests()` opens a dedicated throwaway connection so it never disturbs
your own session.

## Backup schedule

Recommended: publish a backup (Settings → Backup & restore) after any
significant data entry period or before a big change. Restoring is idempotent.
Archival (Settings → Archive) moves closed projects and past periods into a
read-only archive to keep live documents small.

## Adding a new PSA module (playbook)

1. Declare its collection in `src/psa/collections.js` (`registerCollection`
   with `{id, label, maxDocBytes}`); the store handles sharding.
2. Add any derived calculations to `src/psa/derive.js` (pure functions over
   `snapshot()`), and add integrity checks to `src/psa/integrity.js`.
3. Create `src/psa/modules/<id>.js` calling `registerModule({id, label, icon,
   render})`; use the generic CRUD (`openList`/`openForm`/`openDetail` from
   `src/psa/crud.js`) with a field schema + column config, and add the module
   import to `src/psa/main.js`.
4. Gate sensitive actions: add a `edit.<collection>` (or custom) action to the
   **server** PERMS table in `index.html` AND the client PERMS mirror in
   `src/psa/hub.js` — keep them identical, and cover it in `tests-hub.js`.
5. If the module publishes/exchanges data, add bundle support in
   `src/psa/pipeline.js` and surface it in Settings → Pipeline.
6. Register in navigation (automatic via registry) and add a dashboard KPI
   card in `src/psa/modules/dashboard.js` that deep-links to the new module.
7. Add fixtures + assertions to `tests-features.js` and re-run all four suites.
