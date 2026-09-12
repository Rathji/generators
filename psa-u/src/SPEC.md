# PSA-U — product specification

> **Status: Phases 1–13 delivered — tasks 1–61 of 13 phases / 61 tasks.**
> The roadmap is recorded verbatim as a phased `[x]`/`[ ]` checklist in the
> comment block at the top of `main.pjs`, and it is the single source of truth
> for scope and order. Phase 1 (Foundation), Phase 2 (Service Desk), Phase 3
> (Dispatch & Scheduling), Phase 4 (Time & Expense), Phase 5 (Agreements &
> recurring services), Phase 6 (Billing & invoicing), Phase 7 (Projects),
> Phase 8 (Sales & CRM), Phase 9 (Products, Procurement & Inventory),
> Phase 10 (Knowledge, Configuration & Client Portal), Phase 11 (Reporting &
> Analytics), Phase 12 (Integrations, Extensibility & Quality) and Phase 13
> (Multi-user & Realtime Collaboration) are implemented and validated
> (`await PSATest()` → 938 checks). The roadmap is complete.

## What PSA-U is

**PSA-U** is a *professional services automation* system — the operating system
for a services business. It connects the whole delivery lifecycle of a services
firm into one system:

    pipeline → proposal → engagement → resourcing → delivery (time & expense)
             → billing → revenue → reporting

It is built on the platform layer inherited from **Business ERP**
(`business-erp`) and runs entirely in the browser on Perchance, over the
generator's own per-user, cross-device document store.

## Relationship to the base (Business ERP)

This project was forked from Business ERP. The **platform layer is inherited
as-is** and is domain-agnostic:

| Layer | File | Carries over |
| --- | --- | --- |
| Module shell, hash router, role model, states | `src/erp.js` | yes |
| Canonical document store (versioned docs, cache, edit keys, 4 MiB ceiling) | `src/erp.store.js` | yes |
| Sync & 3-way conflict resolution | `src/erp.sync.js` | yes |
| Backup, restore, capacity & archival | `src/erp.backup.js` | yes |
| Multi-user realtime team hub + server-side roles | `index.html` server block, `src/erp.team.js`, `src/psa.collab.js` | yes (extended in Phase 13: server-authoritative roles/capabilities/scopes) |
| Shared UI toolkit | `src/erp.ui.js` | yes |

The **business-domain modules** the ERP shipped with (CRM, sales, purchasing,
projects, finance, reporting, quality) were **removed**, not merely unloaded: the
legacy controllers, the old `erp.tests.js` suite and the unused `template.js`
renderer have been deleted from `src/`, leaving only what the shipped generator
loads. PSA-U's own `psa.*` controllers are their replacements. The
platform-layer document declarations the store, backup and audit layers resolve
(parties/catalog/chart/taxes/defaults/settings/audit/archive) stay declared in
`psa.modules.js` and `erp.master.js`.

Internal names are inherited deliberately: `window.ERP` and the `erp-*` CSS
classes/ids keep the platform code compatible. PSA-U's own storage namespace is
`psa-v1-*` and the realtime hub channel is `psa` (both renamed from the ERP's
`erp-*`/`erp`). The config list's app-settings key was renamed `erp` → `psa`.

## Module map & transformation status

The nav is now PSA-U's own. See `src/README.md` → **Navigation — stations &
groups** for the full table. Phases 1–12 delivered the frame, the foundation, the
service desk, dispatch, time & expense, agreements, billing, projects, sales,
supply, knowledge/configuration/portal, the reporting & analytics capability,
and the integrations/API/quality layer:

- **Fifteen stations** across ten nav groups — the Dashboard, Service Desk,
  Dispatch, Time & Expense, Agreements, Billing, Projects, Sales, Procurement,
  Products, Knowledge, Client Portal, Companies, Admin **and Reports** stations
  are **all live**; every station on the roadmap is now built.
- **Tenancy & data model** — one deployment serves many service providers; each
  provider document holds its directory, members, teams, calendars, taxonomy and
  the service-desk engines; each company document holds that client's company,
  sites, contacts and tickets (as well as its time, agreements,
  invoices, …).
- **Members, teams & security** — role-based and record-level permissions
  enforced in code (not by hidden UI), including company/board scopes and
  financial-visibility masking.
- **Taxonomy & master configuration** — one admin console for the system-wide
  configuration every later module depends on (boards, statuses, priorities,
  types/subtypes/items, sources, work types, roles, charge codes, billing
  terms, agreement/project types, opportunity stages, product classes), with
  change history and version restore.
- **Sync, conflict, backup & versioning** — inherited from the base and wired to
  the PSA-U store namespace.
- **Service desk** — tickets with notes/activity/attachments, relationships and
  merging; service boards and rule-based routing; SLAs over business-hours
  calendars with pause/resume and breach escalation; the notification engine
  (templates, preferences, digests, dedup); a general event-driven workflow
  rules engine with dry-run and a firing log; and ticket templates plus
  recurring/scheduled tickets. See **Service desk (Phase 2)** below.
- **Dispatch & scheduling** — technician calendars & availability (work hours,
  shifts, time off, skills), a drag-and-keyboard dispatch board with conflict
  detection and capacity indicators, appointments/on-site service calls kept in
  sync with their ticket, and a scheduling assistant that recommends an assignee
  and slot with its reasoning shown. See **Dispatch & scheduling (Phase 3)**
  below.
- **Time & expense** — time entry capture (work type, role, charge code,
  start/end or duration, notes) against tickets, projects or general work, with
  quick timers and a day/week grid; weekly timesheets with a manager approval
  queue, rejection-with-comment and a locked/write-off state; expenses with
  category, markup, receipt and reimbursement; and billing-rate resolution
  through a documented, explainable precedence. See **Time & expense (Phase 4)**
  below.
- **Agreements & recurring services** — managed-services agreements with a type,
  term, billing cycle and auto-renew/escalation rules; tracked coverage lines
  (configurations/services/users) with effective dates, mid-term proration and
  missing-device warnings; recurring agreement billing (base, per-unit,
  minimum, included-hours overage) with a live preview then idempotent posting;
  per-agreement profitability against the burdened cost of servicing; and
  renewal/lifecycle with an archive. See **Agreements (Phase 5)** below.
- **Billing & invoicing** — provider-wide billing defaults with per-client
  overrides (tax codes/rates, currencies, invoice cycle, numbering); pure
  invoice assembly from agreement charges, approved billable time, marked-up
  billable expenses and project milestones, with every line traceable to its
  source; cycle dry-runs with readiness gates and a draft→approve→post review
  stage; payments, credits and adjustments against a client balance; immutable
  posted invoices with idempotent, audited re-runs that cannot double-bill a
  period; and AR-aging, revenue, backlog and summary reporting with CSV/PDF
  export. See **Billing & invoicing (Phase 6)** below.
- **Projects** — reusable project templates (phases with predefined tasks,
  owners and checklists) instantiated for a client; project/phase/task
  management with owners, start/due dates, dependencies and a schedule view;
  status and progress rolled up from tasks to phases to project, with overdue
  and blocked work surfaced; estimated-vs-actual budget, cost and profitability
  per phase and project with over-budget warnings; and milestone / fixed-fee /
  time-and-materials billing whose ready milestones flow into invoicing. See
  **Projects (Phase 7)** below.
- **Sales & CRM** — an opportunity pipeline modelled on the taxonomy stages
  (value, expected close, probability, source, owner) with a board, stage-change
  history, win/loss reasons and weighted forecast roll-ups; quotes & proposals
  built from line items with cost/sell pricing, discounts, margin visibility and
  a printable proposal, an accepted quote converting into a project, an
  agreement and/or procurement records; sales activities (calls, meetings,
  follow-ups) logged against companies/opportunities with scheduled next steps
  and a forecast by stage/owner/period; and lead capture that de-duplicates
  against existing companies/contacts and converts a qualified lead into a
  company + opportunity with the original history preserved. See **Sales & CRM
  (Phase 8)** below.
- **Products & procurement** — a product & service catalog (SKU, cost/sell,
  class/category, unit, vendor, tax) with pricing rules by scope and per-client
  overrides resolved through an explainable resolver; vendors and purchase
  orders with approvals, a status flow and expected/received dates; receiving
  (full / partial / drop-ship) and inventory over an append-only stock ledger
  with discrepancy reconciliation; and configurable PO approval thresholds plus
  margin/markup floors enforced with a recorded override. See **Products &
  procurement (Phase 9)** below.
- **Knowledge, configurations & client portal** — a versioned knowledge base
  (categories, tags, internal/public visibility, ticket suggestions and
  draft-from-ticket); configuration/asset records synced with the MSP
  documentation system with per-field ownership and drift detection; RMM alert
  ingestion that raises and auto-resolves tickets and relates a device to its
  configuration; a strictly company-scoped client portal for tickets, public
  articles, posted invoices and client approvals; and approval workflows with
  client/internal routing, expiry, reminders, an audit trail and release actions
  wired into quotes, POs and invoice posting. See **Knowledge, configurations &
  client portal (Phase 10)** below.
- **Reporting & analytics** — a report builder over thirteen live data sources
  (columns, filters, grouping and aggregation) with a definition store, saved
  reports and scheduled delivery (daily/weekly/monthly, CSV) into a delivery
  ledger that can be published to the team hub; operational dashboards
  (SLA/backlog/utilization/agreements/billing/revenue) with KPI cards, charts
  and drill-down; and a BI hand-off (a typed, versioned schema, JSON/CSV export
  and a publishable dataset envelope). See **Reporting & analytics (Phase 11)**
  below.
- **Integrations, extensibility & quality** — a documented connector framework
  (email, accounting, calendar, identity/SSO, RMM, documentation) with
  per-integration direction and field-ownership rules, retry/backoff and a sync
  log; a versioned public API, HMAC-signed outbound webhooks and the shared
  pipeline event bus; a twelve-check data-integrity linter that reports the
  offending records; and a seed/fixture suite that drives the full
  ticket→time→agreement→invoice→payment loop with integrity assertions. See
  **Integrations, API & quality (Phase 12)** below.

Module ids and document names are PSA-U's own (`psa-v1-*`); the store and
controllers resolve documents by them.

## Service desk (Phase 2)

Phase 2 turns the service desk into the operational heart of the system. All of
it is exposed through the **Service Desk** station's six tabs and is also
drivable programmatically (`ERP.tickets`, `ERP.sla`, `ERP.workflow`,
`ERP.notify`, `ERP.templates`).

**Tickets (7).** A ticket carries company/site/contact, board, type/subtype/item,
status, priority, source, summary and detail, an owner and a team, an optional
schedule, a required-by date, tags and a checklist, and a unique number from a
per-provider counter (starting at 1001). The register offers fast list and board
(kanban) views, full-text search, filters and saved filters. Ticket numbers are
allocated on the provider document so they are unique across all clients.

**Notes, activity & attachments (8).** Notes are timestamped and are either
**internal** (staff only, the default) or **customer-visible**; the distinction
is shown everywhere a note is rendered. Field changes are written to an activity
log, and attachments, links and merges are stored alongside the ticket. Merging
marks the source as a duplicate, redirects it to the target and moves its notes,
files and links across; the merged ticket renders a redirect notice.

**Boards & routing (9).** Each service board has its own defaults — default
status, team, auto-assignment (off / round-robin / least-loaded), the status
flow the board view shows and the priority set it offers. Inbound routing rules
run when a ticket is created: the first matching rule sets its board, priority,
owner and team.

**SLAs & business hours (10).** SLA policies carry separate **response** and
**resolution** targets per board/priority, and the most specific policy wins. The
clock is measured in business minutes over a business-hours calendar (opening
hours, holidays, time zone / UTC offset), so a target raised near close-of-business
rolls to the next working day. The clock can pause (waiting on the client,
scheduled maintenance), banking the paused time on resume. Each ticket carries a
live state — on track / at risk / paused / breached — and a breach sweep stamps
the breach and runs the configured escalation through the workflow engine.

**Escalation & notifications (11).** Notification rules are template-driven and
fire on status changes, assignment, breach and aging. Recipients resolve from
roles (owner, team, account manager, created-by, contact) or explicit
`member:`/`email:` targets. Each member has preferences (mute an event), rules
can be silenced by a **dedup window**, channels include in-app and e-mail, and a
**digest** rule queues notifications and flushes them as one summary. Every
delivery and suppression is logged.

**Workflow / rules engine (12).** A general, event-driven engine runs conditions
and actions over ticket (and later agreement/project/invoice) events. Actions
include assign owner/team, set status/priority/board, add a note, notify,
escalate, create a task and add a tag. Rules run in order, are depth-guarded so
they cannot loop, support a **dry-run** preview that changes nothing, and every
firing is written to a log. The notification engine is a downstream consumer of
this engine, so one event pipeline drives both.

**Templates & recurring tickets (13).** Ticket templates prefill fields and
attach a checklist and procedure. Recurring tickets regenerate on a calendar
(daily/weekly/monthly, every-N, at a time of day) for one client or every active
client, with **skip-ahead** (raise one ticket and move on) or **catch-up** (raise
one ticket per missed run) behaviour.

**Relationships & merging (14).** Tickets link as parent/child, related,
duplicate or knowledge-linked, shown in a lightweight relationship map on the
detail modal, alongside the merge flow from (8).

## Dispatch & scheduling (Phase 3)

Phase 3 makes the system deliver: it turns the service desk's work into
scheduled visits on technicians' calendars. It is exposed through the **Dispatch**
station's four tabs and is also drivable programmatically (`ERP.scheduling`,
`ERP.appointments`, `ERP.dispatch`).

**Technician calendars & availability (15).** Every member carries skills, a
territory, a `dispatchable` flag and an optional personal `workHours` override;
without an override they follow their assigned business-hours calendar (the same
calendar the SLA engine uses). **Time off** is recorded per member (with
all-day/partial windows and a reason) and subtracted from the schedule.
`availability()` computes a member's work, booked and still-free minutes for a
day, and `capacity()` summarises a whole day across the team. Availability is
surfaced wherever work is scheduled — the dispatch board, the appointment modal
and the assistant.

**Dispatch board (16).** A live board shows technicians as rows and hour columns
from 06:00 to 20:00. Unscheduled open tickets sit in an **unassigned queue**;
dragging a queue item or an existing block onto a member's hour cell schedules or
reschedules it, and the same move is available from the keyboard (arrow keys
nudge by the hour or to the next member, Enter opens it, Delete unschedules) so
the board is usable without a pointer. Each technician shows a **capacity load
bar** that turns amber near full and red when overbooked. **Conflicts** are
detected continuously — double-booking, outside working hours, time off and
skill mismatch — and rendered as badges on the affected block.

**Appointments & on-site calls (17).** An appointment models the *when and where*
of a visit — a booked window with a travel allowance, the client site and the
on-site contact, the assigned technician, on-site notes captured during the visit
and a sign-off captured on completion, and an on-site/remote type with a
`scheduled → dispatched → in progress → completed / cancelled` lifecycle. It is
modelled separately from the ticket it serves but stays in sync with it: saving
an appointment takes the ticket's owner and schedule and moves the ticket to
**Scheduled** (unless it is already closed or resolved), and completing the visit
writes the on-site notes and sign-off back to the ticket as an internal note.
Appointments are stored in the client's company document, so a client's visit
history travels with the client.

**Routing & scheduling assistant (18).** Given a ticket, the assistant scores
every dispatchable member on the things that matter — required-skill coverage,
territory/geography, today's load, the earliest free slot within a two-week
horizon, and SLA risk (breached / at risk work is prioritised) — then presents
the ranked suggestions with a score, the proposed time and a plain-language
**list of reasons** ("Has every required skill (3/3)", "Covers North", "150 min
booked today", "Next free Mon 08:00"). A dispatcher can accept the top suggestion
in one click or **override** it with an arbitrary time, so the assistant advises
rather than dictates.

## Time & expense (Phase 4)

Phase 4 turns delivery into a billable ledger. It is exposed through the **Time &
Expense** station's four tabs and is also drivable programmatically (`ERP.time`,
`ERP.timesheets`, `ERP.expenses`). Time entries, timers, timesheets, expenses and
rate rules all live in the **provider document**, so a weekly timesheet can span
clients and approval is a provider-level action.

**Time entry capture (19).** A time entry captures who did the work, when, how
long, and for what: a member, a client and optional ticket (or internal general
work), work type, charge role, charge code, notes, and either a start/end pair or
a straight number of minutes. Billability derives from the work type and charge
code — either can declare itself non-billable — with an explicit operator
override always winning. Duration is normalised to minutes, so a stopwatch and a
typed duration are the same thing. A member may keep **one running timer**;
stopping it converts the elapsed time into an ordinary entry. A day/week grid
shows each member's entries, and `totals` produces minutes, billable minutes and
billable value grouped by member and by client.

**Timesheets & approval (20).** Weeks run Monday–Sunday in local calendar time.
An untouched week is *open*; **submitting** freezes its entries for review and
queues the sheet; a manager can **approve** (entries become read-only and
ready to bill) or **reject with a comment** (entries return to draft so they can
be corrected and resubmitted). An approved week can be **locked** once invoiced,
after which it cannot be edited or reopened. Approval is an enforced permission
(`time.approve`), not a hidden button. Totals are always computed from the
entries themselves so the sheet and the ledger never disagree, and individual
entries can be written off (kept for utilisation/audit but excluded from the
billable value) and restored.

**Expenses (21).** An expense captures category, amount, date, client/ticket (or
internal), description, a billable flag derived from its category (overridable),
a reimbursable flag, a receipt (uploaded or linked), and a markup (none, percent
or flat). It moves `draft → submitted → approved → reimbursed`, with `rejected`
(comment required) and `locked` states, gated by `expenses.edit` /
`expenses.approve`. The engine computes the marked-up **billable amount** and
rolls expenses up by client and category (cost, billable, reimbursable), feeding
the client-billable roll-up and, later, invoice assembly.

**Billing-rate resolution (22).** The applicable billable rate is resolved from a
fixed precedence — **agreement override → work type/role → ticket priority →
client-specific → default** — where the default falls back to the charge role's
configured rate and then the member's standard charge rate. Every resolution
returns the winning amount **and** which rule produced it (rule, scope, reason)
plus the full chain of rungs considered, and every time entry stores its resolved
rate. That makes invoice math explainable after the fact and testable: the
station's **rate checker** shows the chain, and a rate-rule table lets an owner
manage the rules each rung uses.

## Agreements (Phase 5)

Phase 5 turns recurring service into a billable, renewable contract. It is
exposed through the **Agreements** station's five tabs (Agreements, Coverage &
additions, Agreement billing, Profitability, Renewals & lifecycle) and is also
drivable programmatically (`ERP.agreements`). Agreements and their posted charges
live in the **client company document**, so a contract travels with its client
and sits beside the records the invoices and projects modules assemble.

**Agreements (23).** An agreement models the commercial shape of a recurring
service: a type (managed/recurring service, per-device, per-user, block-of-hours,
one-off), a start date and term (or open-ended), a billing cycle and anchor day,
automatic renewal with a renewal term and notice period, a pricing model (flat,
per-unit, block-of-hours, one-off) with base amount, included hours, overage rate
and minimum commitment, and an optional price escalation (a percent applied every
N months). Every agreement gets a unique number (`AGR-####`), links to its client
company and the services it covers, and moves through
`draft → active → suspended → expired/terminated/cancelled`.

**Coverage & additions (24).** Coverage states exactly what the agreement covers
— a configuration/device, a service, or a user — each line with a reference,
quantity, unit price and effective dates. Additions and exclusions are tracked
with effective dates, so a mid-term add or cancellation is prorated by the days
it was actually in force; ending a line keeps its history rather than deleting
it. The engine warns when a covered device is not present in the client's
configuration records (those records arrive in Phase 10).

**Agreement billing (25).** The recurring charge is *derived* from the
agreement's inputs — base fee, per-unit coverage (prorated and clamped to the
term), escalation, minimum-commitment top-up, and overage above the included
hours at the overage rate. The derivation is a pure preview that returns every
line and every input, so the operator sees exactly how the number was reached
before approving it; approving **posts** an immutable agreement charge to the
ledger, idempotently (a period cannot be double-billed), for Phase 6 to assemble
into invoices. A run-due sweep posts the current period for every active
agreement and skips the ones already posted.

**Profitability & utilization (26).** Each agreement's revenue (posted charges,
or the derived estimate) is reported against the cost of servicing it — labour at
each member's burdened cost plus parts and third-party expenses — giving margin
and margin % per agreement and client, hours consumed vs remaining against the
included block, and flags for overage or unprofitable agreements. Cost is
attributed by covered work types where set, to the whole client when they have a
single agreement, otherwise pro-rata by revenue.

**Renewal & lifecycle (27).** A renewal queue surfaces agreements nearing expiry
(within a lead time) with their days-to-expiry and whether they auto-renew or
need explicit renewal. Renewing extends the term from the current end date, may
apply an escalation to the base, and records the renewal. A lifecycle sweep
auto-renews due agreements that renew automatically and archives the rest as
expired; the archive keeps coverage and charges intact so historical and
profitability reporting remain correct.

## Billing & invoicing (Phase 6)

Phase 6 turns everything captured in Phases 4–5 into invoices and cash. It is
exposed through the **Billing** station's five tabs (Invoices, Billing runs,
Payments & credits, Financial reports, Billing setup) and is also drivable
programmatically (`ERP.billing`, `ERP.payments`, `ERP.ar`). Invoices live in the
**client company document** (`kind:"invoice"`) beside the agreement charges and
time they were assembled from, and payments and credit notes live there too
(`kind:"payment"` / `kind:"creditNote"`), so a client's billing history travels
with the client. Provider-wide billing defaults are a `billingSettings` record in
the provider document.

**Billing setup (28).** Billing configuration follows a documented precedence:
a provider-wide default that each client may override (currency, tax codes and
rates, invoice cycle — on demand / weekly / monthly — payment terms, PO/reference
and numbering). Every resolved field reports whether it came from the provider
default or the client override. Invoice numbers are allocated from the master
sequence so they are unique and CAS-safe under concurrent writes, and a client's
terms (net days, tax treatment) flow through to its invoices' due dates and tax.

**Invoice assembly (29).** Assembly is *pure* — it reads sources and writes
nothing — and pulls from the correct origins: **agreement recurring charges**
(posted to the Phase-5 ledger), **approved billable time** valued at its stamped
resolved rate, **billable expenses** with their markup applied, and **project
milestones** released for billing (Phase 7). Lines are grouped per the invoice
template, tax is applied per line from the resolved tax code, and **every line
records its source** (kind, id, reference) so each figure on an invoice can be
traced back to the record that produced it.

**Invoice generation runs (30).** Billing runs on a cycle with a pre-invoice
review stage. A **dry-run** assembles every active client for a period and
classifies each as draft, blocked, empty or already-invoiced, showing totals and
the **readiness gates** that would catch a problem before a client is billed
(unapproved time, unapproved or unrated expenses, unposted agreement charges, a
period already invoiced). Generating writes **draft** invoices without posting
anything; the operator reviews and corrects, then **approves and posts**. The
already-invoiced gate counts only *posted* invoices, so a draft or void never
locks a period, and a dry-run never writes.

**Payments, credits & adjustments (31).** A payment is recorded against a
**posted** invoice (date, method, amount, reference) with an idempotency key so a
duplicate submission cannot double-count, and can be voided. **Credit notes** can
be issued to a client's account and later applied to an invoice, or voided.
**Signed adjustments** and **write-offs** (a positive write-off capped at the
outstanding balance) are recorded with an audit trail. Every change recomputes
the invoice's amount paid / credited / adjusted / written-off state and its
balance (`total − credits − adjustments − write-offs − paid`), flows into the
company balance, and feeds the financial reports.

**Immutability & idempotency (32).** A **posted invoice is immutable** — edits
are refused in code, and corrections go through a credit or adjustment instead.
Re-running billing for a period **cannot double-bill** it: each invoice carries a
run key (`companyId:periodKey`) that blocks a second posting, and the source
records it consumed (time entries, expenses, agreement charges) are **locked** so
they cannot be pulled into another invoice. Every billing action is idempotent
where it can be and is audited, emitting `invoice.*`, `payment.received` and
`credit.issued` events through the Phase-2 workflow engine.

**Financial reporting (33).** `ERP.ar` reports **AR aging** (current, 1–30,
31–60, 61–90, 90+ — bucketed by days past due from posted, unpaid invoices),
**revenue by client and by service**, the **billing backlog / unbilled WIP**
(approved time plus billable expenses plus unposted agreement charges), and
invoice and payment summaries. Any report exports to **CSV** and to a
print/PDF-ready view.

## Projects (Phase 7)

Phase 7 plans and runs client engagements. It is exposed through the **Projects**
station's five tabs (Projects, Templates, Schedule, Budget, Billing) and is also
drivable programmatically (`ERP.projects`). A project lives in the **client
company document** (`kind:"project"`), so an engagement travels with its client;
reusable blueprints live in the **provider document** (`kind:"projectTemplate"`).

**Project templates & phases (34).** A project template is a blueprint of phases
and predefined tasks — each task with an owner, an estimated effort, a relative
due date and a checklist — plus the milestones the project should raise. A
standard deployment or onboarding project is instantiated for a client in one
step, copying every phase, task, owner and checklist into a numbered `PRJ-####`
project, so a repeatable engagement starts complete rather than blank. Starter
templates are seeded idempotently.

**Project tasks & scheduling (35).** A project is a tree of phases and tasks with
owners, start/due dates, dependencies, effort estimates, checklists and status.
Phase status and progress roll up from their tasks, and project status and
progress roll up from their phases — completing every task completes the phase,
and completing every phase completes the project. A schedule view presents the
whole tree on a timeline and surfaces overdue or blocked phases, so slippage is
visible before it is reported.

**Project budget, cost & profitability (36).** The estimate sums planned hours
and, at each owner's charge rate, planned cost and revenue. Actuals burden
captured time at each member's cost and add project expenses, attributed to the
project and its tasks, and report actual vs estimate (cost and hours %) with
margin and margin % per phase, per project and in total — warning when a project
has exceeded its budget or is trending over.

**Project billing (37).** A project bills by **time and materials** (its approved
time and marked-up expenses flow through ordinary invoice assembly), by **fixed
fee** (a generated fee milestone), or by **milestone** (milestones raised against
phases and released when their phase completes, or manually). Released milestones
are offered to invoice assembly as billable lines, and posting an invoice stamps
them invoiced with their invoice id so they cannot be billed twice; voiding the
invoice releases them. Project billing is reconciled against project cost through
the profitability report.

## Sales & CRM (Phase 8)

Phase 8 is the growth engine that feeds the rest of the practice. It is exposed
through the **Sales** station's four tabs (Pipeline, Quotes, Activities &
forecast, Leads) and is also drivable programmatically (`ERP.sales`).
Opportunities and quotes live in the **client company document**
(`kind:"opportunity"` / `kind:"quote"`), so a deal and its proposal travel with
the client; leads, activities and procurement intents live in the **provider
document** (`kind:"lead"` / `"salesActivity"` / `"procurementIntent"`). The
pipeline stages are PSA-U taxonomy (`opportunityStage`), so a provider can
rename stages or change their probability and the board, forecast and quote math
all follow.

**Opportunities & pipeline (38).** An opportunity models a deal: a value, an
expected close date, a stage with a probability, an optional probability
override, a source, an owner, notes and a full **stage-change history**. Stages
carry a `closed` flag, so moving an opportunity into a won (or lost) stage
closes it and records the win/loss reason. The pipeline board groups
opportunities into a column per stage with per-column and overall totals, and
the forecast uses each stage's probability to weight the pipeline. Every change
emits `opportunity.*` events through the Phase-2 workflow engine.

**Quotes & proposals (39).** A quote is built from line items — each with a kind
(service, product, subscription or labour), a description, quantity, unit, unit
cost, unit price and discount — plus a tax rate, terms and notes. The totals
(subtotal, discount, tax, total), cost, margin and margin % are derived purely
from the lines so margin is visible on every quote, and each quote numbers
itself (`QTE-####`). A quote moves `draft → sent → accepted / declined`, and a
printable proposal (client, lines, totals, terms) can be produced as PDF.
Converting an **accepted** quote creates a project (via Phase 7), an agreement
(via Phase 5) and/or **procurement records** (one intent per product line,
queued for Phase 9 to turn into purchase orders), recording the created ids on
the quote so it cannot be converted twice. Quotes read catalog items when the
(Phase 9) catalog exists, and otherwise accept free-form lines.

**Activities & forecasting (40).** A sales activity — a call, meeting, email,
demo, follow-up, task or note — is logged against a company, an opportunity
and/or a lead, with an optional due date and a done flag. The activity log and
the **next-step queue** (open items, overdue flagged) keep follow-up on track,
and the forecast rolls opportunities up by **stage, by owner and by period**
(month or quarter of the expected close), reporting open value, weighted
(probability-adjusted) value, committed (won) value, lost value and a win rate.

**Lead capture & conversion (41).** A lead carries contact details (company,
contact, email, phone, website), a source, a status, an estimated value and an
append-only history. **De-duplication** matches a lead against existing
companies, contacts and other leads on normalised name, email, phone and website
domain, so a duplicate is surfaced before it is created. Converting a qualified
lead creates (or attaches to) a company, optionally a primary contact, and an
opportunity whose `origin` preserves the lead and its history; the lead is kept
as `converted` with links to both records and its activities are re-pointed at
the new opportunity.

## Products & procurement (Phase 9)

Phase 9 adds the supply side of the practice: what it sells, what it buys, the
stock it holds, and the approval/margin controls over both. Two stations expose
it — **Products** (`ERP.catalog`) and **Procurement** (`ERP.procurement` +
`ERP.inventory`) — and every function is also callable programmatically.

**Product & service catalog (42).** The catalog holds products and services with
a SKU, a product class and category (taxonomy), a unit, a cost price, a sell
price, a tax rate, an optional default vendor, and per-item inventory flags
(`trackInventory`, `reorderPoint`). Pricing is not a single number on the item:
it is a list of rules evaluated **by specificity** — the scope may be global,
per-vendor, per-class, per-category or per-item — each computing either a markup
on cost, a target margin percent, a percent off the sell price or a fixed price,
with optional rounding, a priority tie-break and effective dates. On top of the
rules a client-specific **price override** pins a price (or discount) for one
company and item. `resolvePrice` returns the winning price together with how it
was derived — the `source` and the full considered `chain` (which rules applied
and which did not) plus the resulting margin/markup — so quotes, tickets,
projects and invoices can all show and explain the price they used. Quotes
(Phase 8) consume the catalog, where a line can reference a catalog item.

**Purchase orders & vendors (43).** A vendor carries contact details, payment
terms and a **lead time**. A purchase order carries a vendor, lines (item or
free description, quantity, unit cost, tax), computed totals, references to the
client / opportunity / project / ticket that motivated it, and expected and
received dates (the expected date derives from the vendor's lead time). Its
status flows `draft → pending_approval → approved → ordered →
partially_received → received → closed` (or `cancelled`). A converted quote's
pending **procurement intents** (Phase 8) can be raised into a PO in one action,
which marks those intents ordered.

**Receiving, drop-ship & inventory (44).** Inventory quantities are never stored
as a mutable number: every change is an **append-only `stockMove`** and on-hand
is the sum of its deltas, so stock is reconstructible and auditable. A receipt
records goods arriving against a PO — **full**, **partial** or **drop-ship**
(which ships to the client without touching stock) — computes each line's
variance and files any shortage/overage as a **discrepancy** in a reconcile
queue that can be closed with a note. Transfers move stock between warehouses,
adjustments correct a count (a stocktake) and issues consume stock. Levels,
on-hand, low-stock (against each item's reorder point) and valuation are all read
back from the ledger. Warehouses are provider records; one is the default.

**Procurement approvals & margin rules (45).** A configurable **approval
threshold** on purchase orders means a PO at or above it must be submitted and
approved before it can be ordered, with an approval queue for the approver.
Separately, a **quote margin floor** and a **PO markup floor** are enforced: a
quote cannot be sent or accepted, and a PO cannot be submitted, below its floor
without an explicit, reason-stamped override — which is written to a
**recorded-override log** (reference, actual %, floor, reason, who, when). The
quote gate is enforced inside the Phase-8 quote status transition, so the
control lives in code, not in the UI.

## Knowledge, configurations & client portal (Phase 10)

Phase 10 adds the knowledge and asset layer under the service desk, the
monitoring seam that turns device alerts into work, an approval engine, and the
client-facing portal. The **Knowledge** station (`ERP.knowledge`) hosts five tabs
(Articles, Categories, Assets & configurations, Monitoring, Approvals); the
**Client Portal** station (`ERP.portal`) is the client self-service view; and
`ERP.approvals` is the shared approval engine. Knowledge, monitoring and
approval records live in the **provider document**; configuration records live
in the **client company document** (`kind:"configuration"`).

**Knowledge base (46).** A `kbCategory` files a **versioned** `kbArticle`
(number `KB-####`, slug, tags, summary, body) that moves
`draft → published → archived` and is either **internal** or **public** — only
published *and* public articles reach the client portal. Editing the content
snapshots the previous copy and bumps the version; history can be listed and an
earlier version restored (which itself records a new version, so history is never
rewritten). The base plugs into the service desk: `suggestForTicket` scores
published articles against a ticket (title hits weigh more, shared tags more
still), `linkText` renders an article as a link to paste into a reply, and
`fromTicket` drafts an article from a resolved ticket with a back-link. The
ticket detail modal's **Knowledge** tab surfaces the suggestions and the
*use-in-reply* / *draft-an-article* actions.

**Configuration & asset records (47).** A configuration/asset record (device,
type, make/model, serial, asset tag, hostname/IP/MAC/OS, location, purchase/
warranty/support dates, status, notes, relationships) is stored in the client's
company document, so it travels with the client and sits where the Phase-5
coverage check already looks. Each field has an **owner**: descriptive fields are
**docs-owned** (the MSP documentation system is authoritative) and operational
fields (status, notes, relationships) are **psa-owned**. `syncFromDocs` matches
an external feed on externalId/serial/asset tag/name, creates unknown devices,
applies changed docs-owned fields silently, and files changed **psa-owned** fields
as **drift** (local vs external) instead of silently overwriting them, returning a
created/updated/drifted/unchanged report. The drift queue can be resolved field by
field (keep the psa value, or adopt the docs value), and a device's expiring
warranties are surfaced. Save and drift emit `configuration.*` events.

**RMM / monitoring integration (48).** A monitoring feed posts device/alert
events to `ingest`, which normalises them, **de-duplicates** against an open
alert (by external id, or device+type within a configurable window, counting
recurrences), matches the first ordered `rmmRule` (severity / alert type / device
type), and **auto-creates a ticket** through `ERP.tickets.save` (source
`monitoring`, severity-derived priority) unless the rule suppresses it or the
severity is `info`. The alerting device is tied to its configuration record
(`locateDevice`, by externalId/serial/hostname/name). A `cleared`/`resolved`
event clears the alert and **auto-resolves** the ticket (moving it to a closed
status with a customer-visible note) unless auto-resolve is off. Alerts can be
acknowledged or ignored; `stats` reports open, critical, ticketed and device
counts.

**Client portal & self-service (49).** A client contact signs in to a session
scoped strictly to their company. Within it they can submit a ticket (which
becomes a `source:"portal"` ticket with a customer-visible note), track their
tickets and read **only customer-visible** notes, add a comment, read **published
+ public** knowledge articles, view and print **posted** invoices only, and
approve or reject pending **client** approvals. Reads of any other company's
records return nothing. Signing in requires the `portal.manage` permission
(owner/manager), and the portal renders a sign-in screen plus four tabs
(Support, Knowledge, Invoices, Approvals).

**Approval workflows (50).** An `approvalRequest` names what is being approved
(quote, ticket, change request, purchase order or invoice), its amount and its
release action, with an audit trail. Routing sends **client** references to the
client's portal contact and **internal** ones (POs, invoices) to the client's
account manager (else a manager/owner). A request carries a due date; `sweep`
expires overdue requests and raises reminders at the configured interval, and
`decide` records who/when/why and runs the **release action** — accept/send a
quote, approve a PO, post an invoice or note a ticket — with a matching reject
action. `gateFor`/`canProceed` let a caller check whether a reference is still
blocked, and the engine is wired in: `ERP.procurement.submit` raises a PO
approval when a PO needs one, and `ERP.billing.post` refuses with
`awaiting_approval` until the invoice's request is approved (the release action
then posts it). Every transition emits `approval.*` events.

## Reporting & analytics (Phase 11)

Phase 11 makes the whole system answerable. The **Reports** station
(`ERP.reports`) is the hub — a self-serve report builder, schedules and an
export/BI tab — while `ERP.dashboards` renders the operational KPI dashboards and
`ERP.bi` owns the typed export contract. Report definitions, schedules,
deliveries and BI hand-offs live in the **provider document**. Charts are drawn
by the platform `data-visualization-plugin` (`root.charts`).

**Report builder & scheduling (51).** A `reportDef` names a **source** — one of
thirteen adapters (companies, contacts, tickets, time entries, expenses,
agreements, invoices, projects, opportunities, products, purchase orders,
configurations, approvals) that project live records into flat, typed rows — plus
a selected set of **columns**, **filters** (all/any, a full operator set —
equals, not-equals, contains, starts/ends, `>`, `>=`, `<`, `<=`, `is
empty/not-empty`, between — evaluated per column type) and optional **grouping**
with per-group **aggregations** (count, sum, avg, min, max). `run` executes a
definition against live data and returns rows plus computed aggregates and
groups; `csv` renders the result and `downloadCsv` saves it. Definitions are
stored (`saveDef`/`defs`/`removeDef`) so a report can be saved, re-run and
shared. A `reportSchedule` carries a cadence (daily/weekly/monthly), a format
(CSV) and recipients; `nextRunAt` computes the next due time, `sweep` runs any
schedule that is due, saves the rendered result as a `reportDelivery` and
records it in a delivery ledger; `deliver` runs one on demand and `publishDelivery`
shares a delivery's text (via the team hub). The station seeds a handful of
starter definitions (open tickets by status, time by work type, invoices by
status, etc.).

**Operational dashboards (52).** `ERP.dashboards` computes the operational
picture from the same engines: **SLA** compliance and at-risk tickets,
**backlog** by status/priority/board, technician **utilization** (billable vs.
available), **agreements** (active, expiring, recurring value), **billing**
(invoiced, outstanding, overdue, draft) and a **revenue trend** over periods,
rolled into an **overview**. The KPI grid (`.erp-kpi`, tone-classed) shows money-metric
cards, charts render through `ERP.reports.chartBox`, and tables are drillable
(`drill`) so a KPI opens the underlying records in `#dashDrill`. A period
selector scopes the period-aware dashboards.

**Data export & BI hand-off (53).** `ERP.bi` declares a **versioned schema**
(`SCHEMA_VERSION`, dimensions + typed facts) so downstream consumers have a
stable contract. `extract` projects live records into typed fact/dimension rows,
`schema`/`dimensions`/`facts` describe and enumerate them, and `toCsv` /
`downloadJson` export. A `biHandoff` bundles the envelope (schema version +
generated timestamp + payload, also exported as `ERP.envelope`) so a dataset can
be published for another system; `newHandoff`/`publish`/`removeHandoff` manage
them and `renderExport` is the station's export tab.

## Integrations, API & quality (Phase 12)

Phase 12 connects PSA-U to the systems around it and gives the build a way to
prove itself. Three **Admin** tabs host it — Integrations, API & webhooks and
Data integrity — over `ERP.integrations`, `ERP.api` (aliased `ERP.pipeline`) and
`ERP.integrity`.

**Integration framework (54).** A connector is declared with a stable `id`, a
`direction` (`pull`, `push` or `both`) and an **ownership map** that names, per
field, whether PSA-U (`psa`) or the external system (`external`) is the system of
record; `applyOwnership` only copies external-owned fields, so an inbound sync
never silently overwrites a field PSA-U owns. Six connectors are declared: email
(inbound ticket creation / outbound replies, backed by `outboundEmail`),
accounting (invoice/payment sync), calendar, identity/SSO (members), RMM
(Phase-10 alerts) and the MSP documentation system (Phase-10 configurations).
Per-provider state is an `integration` record (enabled, direction, config,
incremental `cursor`, last run/status); each run is an `integrationRun`
(connector, direction, status, per-kind counts, attempts, error, times). Drivers
are pluggable (`DRIVERS`/`registerDriver`) and every run is wrapped in
`withRetry` (bounded attempts + backoff) before the outcome is written to the
sync log (`syncLog`/`clearLog`); `run`/`runAll` drive them, and `ensure` seeds the
provider's connection rows idempotently.

**Public API, webhooks & pipeline bus (55).** `ERP.api` declares a versioned
surface (`API_VERSION` plus `ENDPOINTS`, each with a method, path, permission and
description) and `call(name, args)` authorises against `ERP.security` before
dispatching to the owning module. A `webhook` subscription stores a URL, event
list and generated secret; delivery signs the payload with HMAC-SHA256 and POSTs
it with retry, recording a `webhookDelivery`. The **pipeline bus** is the shared
vocabulary: `publish(event, ctx)` wraps an event in the common `ERP.envelope()`
and appends it to a bounded `pipelineEvent` log, while `consume(envelope)` routes
an inbound envelope to a registered `HANDLERS` entry — so other tools in the
small-business pipeline can subscribe to PSA-U events and PSA-U can accept their
commands. `ERP.workflow.emit` publishes through the bus as rules run, and
`ERP.tickets` emits `ticket.closed`/`ticket.reopened` across the closed-status
boundary, so the bus carries real domain events.

**Data-integrity linter (56).** `ERP.integrity.lint(pid)` runs twelve named
checks over the accumulated records — tickets never assigned or never closed,
closed without resolution, agreement coverage for devices that no longer exist,
billable time never invoiced, invoices posted without source lines, SLA policies
referencing missing statuses, companies missing billing terms, orphaned
time/expenses and negative balances — each returning the offending records by id.
`summary` reduces them to counts by severity; the tab renders findings with a
severity filter and a re-run and never auto-fixes, so drift is witnessed rather
than silently repaired.

**Fixtures, loop & playbook (57, 58).** The Phase-12 test groups seed a
throwaway provider (companies, boards, members, an agreement, a billing cycle)
and drive ticket → time → agreement → invoice → payment end to end, asserting no
double-billing, posted-invoice immutability, source-time locking, enforced
scopes and parseable exports. The playbook is this spec plus `src/README.md`
(architecture, security matrix, data model, billing/SLA rules, "Adding a
station") and the roadmap block in `main.pjs`.

These are the standard building blocks of a PSA system, listed only to give the
roadmap a vocabulary. **They are not a commitment** — the roadmap will select,
rename, merge and order them.

- **Clients & contacts** — the customer directory, billing/shipping details,
  contracts and rate agreements.
- **Engagements & projects** — statements of work, milestones, deliverables,
  phases and budgets.
- **Resources & skills** — the people who deliver, their roles, skills,
  availability and cost/charge rates.
- **Resourcing & scheduling** — matching people to engagements, capacity,
  bookings and utilisation targets.
- **Time & expenses** — timesheets and expense capture against engagements and
  tasks, with approval.
- **Rate cards & billing** — time-and-materials, fixed-fee and milestone
  billing; discounts; tax.
- **Invoicing & revenue recognition** — invoices/credit notes, WIP, deferred and
  recognised revenue, accounting hand-off.
- **Pipeline & forecasting** — opportunities, weighted pipeline, revenue and
  utilisation forecasts.
- **Reporting & dashboards** — utilisation, realisation, project profitability,
  revenue by client/period, margin.
- **Administration** — roles & access, business profile, fiscal settings,
  document numbering, audit log, backup & restore.

## Multi-user & realtime collaboration (Phase 13)

Phase 13 adds an optional companion hub so a service provider's staff can work
the same records at once. It is off by default in effect — the app is fully
usable single-user — and the client never blocks on the socket.

**Role & access model (59).** Authorization moves from "hidden in the UI" to
"denied on the hub". A user record carries a system role (owner / manager /
staff), a functional role (administrator / dispatcher / account_manager /
finance / technician) expressed as **capability bits** (`view`, `work`,
`dispatch`, `sales`, `supply`, `finance`, `manage`), a financial-visibility
flag, and company & board scope bitfields. Every guarded action is checked
server-side against the system-role floor, the required capability, the
company/board scope and the financial flag; a denial returns a specific reason
(`role` / `capability` / `scope` / `financial` / `unknown`). The client mirrors
the same model (`ERP.collab`) for preview and offline use, but the server is
the authority whenever the hub is connected.

**Realtime hub & collaborative dispatch (60).** Sessions identify themselves to
the hub, which broadcasts presence and per-record editing focus; the dispatch
board and ticket detail show an **editor chip** naming anyone else editing the
same record. Document changes are announced and fan out on a global topic (for
all-company watchers) and per-company topics (for scoped watchers), so other
sessions re-sync within seconds through the same idempotent, version-checked
store. When the hub is unreachable the client falls back to **polling** the
active station (with a visible status and a manual Poll now), rather than
failing.

**Multi-user audit & rate control (61).** Connections and key actions are
rate-limited per-connection and per coarse network signal. Sensitive actions
are signed into the hub's durable audit ring with the true actor — user id,
system role, functional role, flags, permission and target — and every remote
change flows through the version-checked document layer. Unknown actions are
still logged (never silently dropped), so the audit ring has no gaps.

The server block in `index.html` holds a versioned binary state (v2 user slots +
audit ring) that migrates a v1 hub on boot; the block is public source, so only
the SHA-256 hash of the first-time owner password is stored, and admin unlock
happens by sending the password over the socket to be hashed server-side. The
Admin → **Collaboration** tab surfaces hub status, identity & capabilities,
online peers, the change stream, rate control, the user registry (with scoped
access editing) and the audit ring.

## Cross-cutting requirements (inherited from the base)

- Every record is persisted through the versioned document store: local-first,
  cross-device, conflict-detected, restorable.
- Role-aware access enforced in code, and server-side when the realtime hub is
  online.
- Every state-changing action is audited; the data-integrity linter (Phase 12)
  covers the invariant checks — double-billing, unbilled time, orphaned records,
  missing billing terms and the like.
- Consistent loading / empty / error states; responsive phone & desktop layouts.

## Roadmap

The roadmap was supplied by the product owner and is recorded verbatim (as a
phased `[x]`/`[ ]` checklist) in the top comment block of `main.pjs` — **that
block is the single source of truth for scope and task order, not this
document.**

**13 phases / 61 tasks:** (✓ = delivered)

1. **Foundation — tenancy, records & configuration** (1–6) ✓ : app shell & nav;
   tenancy & data storage; companies/sites/contacts; members, teams & security;
   taxonomy & master configuration; sync, conflict, backup & versioning.
2. **Service desk** (7–14) ✓ : tickets; notes/activity/attachments; service boards
   & routing; SLAs & business-hours calendars; escalation & notifications;
   workflow/rules engine; templates & recurring tickets; relationships &
   merging.
3. **Dispatch & scheduling** (15–18) ✓ : technician calendars & availability;
   dispatch board; appointments & on-site calls; scheduling assistant.
4. **Time & expense** (19–22) ✓ : time capture; timesheets & approval; expenses;
   billing-rate resolution.
5. **Agreements & recurring services** (23–27) ✓ : agreements; coverage &
   additions; agreement billing; profitability & utilization; renewal &
   lifecycle.
6. **Billing & invoicing** (28–33) ✓ : billing setup; invoice assembly; generation
   runs; payments/credits/adjustments; billing configuration safety; financial
   reporting.
7. **Projects** (34–37) ✓ : templates & phases; tasks & scheduling; budget/cost/
   profitability; project billing.
8. **Sales & CRM** (38–41) ✓ : opportunities & pipeline; quotes & proposals;
   activities & forecasting; lead capture & conversion.
9. **Products, procurement & inventory** (42–45) ✓ : product & service catalog;
   purchase orders & vendors; receiving/drop-ship/inventory; approvals & margin
   rules.
10. **Knowledge, configuration & client portal** (46–50) ✓ : knowledge base;
    configuration/asset records; RMM/monitoring integration; client portal &
    self-service; approval workflows.
11. **Reporting & analytics** (51–53) ✓ : report builder & scheduling;
    operational dashboards; data export & BI handoff.
12. **Integrations, extensibility & quality** (54–58) ✓ : integration framework;
    public API/webhooks/pipeline bus; data-integrity linter; test fixtures &
    integrity suite; README & playbook.
13. **Optional — multi-user & realtime collaboration** (59–61) ✓ : role & access
    model; realtime hub & collaborative dispatch; multi-user audit & rate
    control.

The workflow rules (strict hold → one task at a time with tests → `[x]` → stop
for review) are stated in the same `main.pjs` comment block.

## Roadmap-driven deliverables

When the roadmap lands, expect to update, in the same change that adds a task:

1. the backlog block in `main.pjs` (task wording, phases, `[ ]`/`[x]` state);
2. a validation suite in `src/psa.tests.js` (or a new test file) for that task;
3. `src/README.md` architecture + workflow notes;
4. this spec, when a task changes the product's constraints.
