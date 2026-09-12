# PSA-U — Professional Services Automation

PSA-U is a multi-tenant **professional services automation** platform built on
Perchance: a service provider runs its clients, service desk, dispatch, time &
expense, agreements, billing, projects, sales, procurement and knowledge end to
end in one application, over a per-user, cross-device document store.

It was forked from the **Business ERP** generator (`business-erp`). The platform
layer (shell, document store, sync, backup, team hub, UI toolkit) is inherited
and domain-agnostic; the app's stations, data model and controllers are PSA-U's.

> **Status: Phases 1–13 are complete** — tasks 1–61 of the 13-phase / 61-task
> roadmap. Phase 1 is the Foundation (tenancy, records, configuration);
> Phase 2 is the Service Desk (tickets, notes/activity/attachments, boards &
> routing, SLAs & business hours, notifications & escalation, the workflow
> rules engine, templates & recurring tickets, and relationships/merging);
> Phase 3 is Dispatch & Scheduling (technician calendars & availability, the
> drag-and-keyboard dispatch board, appointments/on-site service calls, and the
> routing/scheduling assistant); Phase 4 is Time & Expense (time entry capture
> and quick timers, weekly timesheets with approval, expenses with markup and
> receipts, and explainable billing-rate resolution); Phase 5 is Agreements
> (the recurring contract with term/cycle/auto-renew/escalation, tracked
> coverage & additions with proration and missing-device warnings, derived
> agreement billing with a live preview, profitability vs the burdened cost of
> servicing, and renewal/lifecycle with an archive); Phase 6 is Billing &
> Invoicing (provider+per-client billing setup, invoice assembly from
> agreements/time/expenses with full traceability, dry-run billing runs and
> readiness gates with a draft→approve→post review stage, payments/credits/
> adjustments/write-offs, immutable posted invoices with idempotent re-runs,
> and AR/revenue/backlog reporting with CSV & print/PDF export); Phase 7 is
> Projects (reusable templates of phases and tasks, project/phase/task management
> with a schedule view and status rollup, estimated-vs-actual budget, cost and
> profitability, and milestone / fixed-fee / time-and-materials billing that
> flows into invoicing); Phase 8 is Sales & CRM (the opportunity pipeline with
> stage history and weighted forecasting, quotes & proposals with margin
> visibility and conversion into a project/agreement/procurement, sales
> activities with scheduled next steps and a stage/owner/period forecast, and
> lead capture with de-duplication and conversion); Phase 9 is Products,
> Procurement & Inventory (the product & service catalog with pricing rules and
> per-client overrides, vendors & purchase orders with approvals and a status
> flow, receiving / drop-ship / inventory over an append-only stock ledger with
> discrepancy reconciliation, and procurement approvals & margin/markup floors
> with a recorded override); Phase 10 is Knowledge, Configuration & Client
> Portal (a versioned knowledge base with categories, tags and internal/public
> visibility that suggests articles on tickets and drafts one from a resolved
> ticket; configuration/asset records synced with the MSP documentation system
> with per-field ownership and drift detection rather than silent overwrite; RMM
> alert ingestion that raises and auto-resolves tickets with de-duplication and
> relates the alerting device to its configuration record; a strictly
> company-scoped client portal for submitting/tracking tickets, reading public
> articles, viewing posted invoices and approving quotes; and approval
> workflows with client/internal routing, expiry, reminders, an audit trail and
> release actions wired into quotes, POs and invoice posting); Phase 11 is
> Reporting & Analytics (a report builder over the core entities with filters,
> grouping and saved definitions plus scheduled delivery; the operational
> dashboards — SLA compliance, aging/backlog, utilisation, response/resolution
> times, agreement margin, billing backlog and revenue trend — with drill-down;
> and the schema-stable fact/dimension BI extract through the shared envelope);
> Phase 12 is Integrations, Extensibility & Quality (the connector framework
> with per-integration direction and field-ownership rules, retry/backoff and a
> sync log; the versioned API, outbound webhooks and the shared pipeline event
> bus; the data-integrity linter; and the seed/fixture + full-loop test suite);
> Phase 13 is Multi-user & Realtime Collaboration (the server-authoritative role
> & access model — functional roles mapped to capability bits, company/board
> scopes and a financial-visibility flag, with every guarded action authorised
> on the hub rather than merely hidden in the UI; the optional realtime hub that
> broadcasts per-company change events so dispatch, ticket lists and time
> entries update within seconds, shows who else is editing a record, and
> degrades to polling refresh when the hub is unreachable; and multi-user audit
> & rate control — identity-bearing hub sessions, per-connection and per-network
> rate limits, and every remote change flowing through the same idempotent
> version-checked document layer so the signed audit ring records the true
> actor).
> The roadmap
> lives verbatim as a `[x]`/`[ ]` checklist in the top comment block of
> `main.pjs`, which is the single source of truth for scope and order. Work one
> phase at a time; keep that block, this file and `src/SPEC.md` in step as each
> phase lands.

## Run & test

The app boots automatically. Open the browser console and run:

```js
await PSATest()          // 938 checks over Phase 1 tasks 1–6, Phase 2 tasks 7–14, Phase 3 tasks 15–18, Phase 4 tasks 19–22, Phase 5 tasks 23–27, Phase 6 tasks 28–33, Phase 7 tasks 34–37, Phase 8 tasks 38–41, Phase 9 tasks 42–45, Phase 10 tasks 46–50, Phase 11 tasks 51–53, Phase 12 tasks 54–58 and Phase 13 tasks 59–61
```

`PSATest()` swaps in an isolated in-memory document backend, exercises the
phases, then restores the live store, localStorage and role — the running app is
left exactly as it was found. `PSATestPhase1()`…`PSATestPhase13()` and
`PSATest.run()` are aliases.

The **Phase-12 fixtures & loop group** seeds a throwaway service provider
(companies, boards, members, an agreement and a billing cycle) and drives the
whole operational loop — ticket → time → agreement → invoice → payment — asserting
the integrity invariants (no double-billing, posted invoices immutable, source
time locked to its invoice, security scopes enforced, exports parse, and each
dashboard/registry chain resolves). It shares the isolated-backend harness, so it
never touches live data.

The `store-recovery` group (shared infrastructure, not a phase) covers the
store's **edit-key self-heal**: if the cached editable key for a document is
lost or stale, `ERP.store` transparently re-creates the document under a fresh
editable name and records an alias, rather than erroring (`edit_key_required` /
`invalid_edit_key`) and permanently blocking writes.

## Relationship to Business ERP & internal names

| Layer | Kept name | Why |
| --- | --- | --- |
| Framework namespace | `window.ERP` | the whole shell/store/sync/backup/team/UI stack is addressed through it |
| CSS classes & element ids | `erp-*` | the inherited stylesheet and markup use them |
| Store documents | `psa-v1-*` | PSA-U's own namespace (renamed from `erp-v1-*`) |
| Realtime hub channel | `psa` | the server-plugin pub/sub channel |
| Editable upload namespace | generator name (`psa-u` or the fork's name) | documents are `psa-v1-<doc>[-<year>]` under the generator's editable space |

The inherited ERP business modules (crm/sales/purchasing/projects/finance/
reporting/quality) were **removed entirely** — they were dropped from
`index.html` when PSA-U's own stations replaced them, and their controller
source, the legacy `erp.tests.js` suite and the unused `template.js` renderer
have since been deleted from `src/` (see the historical note at the bottom of
this file). What remains in `src/` is only what the shipped generator loads.

## Architecture — files loaded by `index.html`

Load order (as declared in `index.html`):

| File | Role |
| --- | --- |
| `src/erp.js` | shell framework: module registry (`ERP.registerModule`), hash router (`#/moduleId` / `#/module:tab`), role model (`ERP.role`, owner/manager/staff), loading/empty/error states, theme, responsive drawer, `navGroups()` |
| `src/erp.ui.js` | shared UI toolkit (`ERP.ui`): `esc`, `fmt/money/pct/qty/date/dateTime`, `badge`, `btn`, `table`, `card`/`statCard`, `grid`, `tabs`, `modal`/`confirm`, form controls (`field`/`text`/`number`/`select`/`textarea`/`dateInput` — each associates its `<label for>` with the control and accepts an `aria` name for unlabelled toolbar controls), delegated `bind`, `pageHead`, `summary`, `alert`, `toast` |
| `src/psa.modules.js` | **PSA-U's station registry** — `ERP.groups` (nav groups) + 15 stations + hidden documents |
| `src/erp.store.js` | canonical document store: versioned `psa-doc` envelopes, local cache, cached edit keys, per-document revisions, CAS writes, 4 MiB ceiling, debounced index (`psa-v1-index`), namespace `psa`; self-heals a lost or stale edit key by re-creating the document under a fresh editable name + alias |
| `src/erp.sync.js` | Sync Center UI: topbar sync button, conflict badge/banner, 3-way conflict modal (keep-mine / keep-theirs / field-level merge) |
| `src/erp.master.js` | master-data service (parties, catalog, chart, taxes, posting defaults, settings/profile, audit, archive) seeded idempotently at boot |
| `src/erp.backup.js` | backup/restore + capacity & archival: `backupBundle`, `downloadBackup`, `publishBackup` (`psa-v1-backup`), `validateBundle`, `restoreBundle`, `capacity()`, `archiveDoc`/`archivedDocs`/`restoreArchive`, `renderPanel` |
| `src/erp.team.js` | realtime team hub client (**Phase 13**): socket connect with a stable per-user identity, `hello`/`whoami`/`peers`, richer `me` (system role, functional role, financials, company/board scopes, capability bits), `T.setOnMessage`, admin unlock, presence (`pres`) and per-record editing focus (`focus`), company `watch`, `T.guard(perm, ctx)` (capability-, scope- and financial-aware message copy), `T.signAudit` (records the true actor's `perm`), live `chg` re-sync via `scheduleSync`, and status/identity change hooks into `ERP.collab`; a mock transport (`T.setTransport`) drives deterministic tests |
| `src/psa.collab.js` | **Phase 13** — multi-user collaboration façade (`ERP.collab`): a client mirror of the hub's capability model (`FUNC_IDS`/`FUNC_CAPS`/`CAP`/`requiredCap`/`permSystemRole`/`permKnown`/`PERM_FINANCIAL`/`boardBit`), the equality-based `roleCan` preview, `authoritative()`/`serverActor()`/`serverCan`, the presence & editor-chip layer (`noteEditing`/`clearEditing`/`editorsFor`/`editorsChip`/`refreshEditorChips`), the graceful-degradation polling loop (`pollOnce`/`startPolling`/`stopPolling`), change-stream handling (`refreshActive`/`scheduleRefresh`/`onDocSynced`/`onHubEvent`/`onIdentity`), and the Admin → **Collaboration** panel (hub status, identity, peers, change stream, rate control, user registry + access modal, signed audit ring) |
| `src/psa.history.js` | version history (`psa-v1-versions`): snapshots on commit, prune, `entries/documents/count/restore/clear` |
| `src/psa.taxonomy.js` | system taxonomy: 17 categories + seeded defaults (including the Phase-4 `expenseCategory`), `list/all/find/label/optionList/upsert/remove/seedProvider/ensureCategory` |
| `src/psa.tenancy.js` | tenancy & data storage: provider registry, per-provider and per-company documents, company index, active provider/company |
| `src/psa.members.js` | members, teams and business-hours calendars, stored in the provider document; members carry `skills`, `territory`, a personal `workHours` override and a `dispatchable` flag (Phase 3) |
| `src/psa.security.js` | role/record security: permission matrix, functional roles, record scopes, actor member, `can/require/enforce/canViewCompany/money/scopeSummary`; includes the Phase-3 `dispatch.*`, `appointments.*`, `schedule.*`, `timeoff.*`, the Phase-4 `time.*`, `expenses.*`, `rates.*` and the Phase-5 `agreements.*` permissions |
| `src/psa.sla.js` | **Phase 2** — SLA engine (`ERP.sla`): policy CRUD + most-specific match, business-hours math (`businessMinutesBetween`/`addBusinessMinutes`, holiday- & weekend-aware), per-ticket clock state (response/resolution targets, pause/resume & stop-clock, breach/at-risk), process/sweep/escalate, and the config UI (Policies / Business hours / Breach monitor) |
| `src/psa.workflow.js` | **Phase 2** — event-driven rules engine (`ERP.workflow`): condition model + `matchConditions`/`testCondition`, action model (assign/set status/priority/board, add note, notify, escalate, create task, add tag), rule + routing-rule CRUD, `route()`, `run()`, `emit()` (depth-guarded; runs rules then hands to notify), `dryRun()`, firing log, and reusable condition/action editors |
| `src/psa.notify.js` | **Phase 2** — notification & escalation engine (`ERP.notify`): rule + template CRUD, recipient resolution (owner/team/account manager/created-by/contact + `member:`/`email:`), token rendering, channel/digest/mute/dedup delivery, `emit`/`dispatchNow`/`flushDigests`, and the config UI (Rules / Templates / Preferences / Activity) |
| `src/psa.tickets.js` | **Phase 2** — ticket register (`ERP.tickets`): ticket CRUD + unique numbering, list/board views, search & saved filters, notes (internal vs customer-visible), activity log, attachments, relationships, merge + redirect resolution, board configs with auto-assign (round-robin / least-loaded), and inbound routing; tickets carry `requiredSkills` for dispatch matching (Phase 3) |
| `src/psa.templates.js` | **Phase 2** — ticket templates (`ERP.templates`): prefilled ticket templates with checklists and procedures, plus recurring/scheduled tickets (`due`/`runDue`/`advance`) with skip-ahead vs catch-up behaviour |
| `src/psa.scheduling.js` | **Phase 3** — technician calendars & availability (`ERP.scheduling`): per-member work hours (personal override falling back to the assigned business-hours calendar), time off (CRUD), skills/territory, commitment/availability math (`memberWindows`, `availability`, `subtractWindows`), conflict detection (`conflicts`: double-booking, outside hours, time off, skill mismatch), `requiredSkillsFor` (ticket → taxonomy), `nextFreeSlot`, `recommend` (scored, explained), and `capacity` |
| `src/psa.appointments.js` | **Phase 3** — appointments & on-site service calls (`ERP.appointments`): the appointment record (window, travel, site/contact, technician, on-site notes & sign-off, on-site/remote, `scheduled→dispatched→in-progress→completed/cancelled`), `schedule`/`reschedule`/`complete`/`cancel`, ticket sync (owner/schedule/status), the appointments table and its modals |
| `src/psa.dispatch.js` | **Phase 3** — Dispatch station (`ERP.dispatch`): the four-tab workspace — Dispatch board (technician rows × hourly columns, unassigned queue, drag-and-drop + keyboard scheduling via `applyMove`, capacity bars, conflict badges), Appointments (delegates to `ERP.appointments`), Calendars & availability (work hours, skills/territory, time off, 14-day availability strip), and Scheduling assistant (ranked suggestions with reasons) |
| `src/psa.time.js` | **Phase 4** — time entries, quick timers & the Time & Expense station (`ERP.time`): entry CRUD with start/end or straight minutes, work type / charge role / charge code, notes and billable derivation; one running timer per member (`startTimer`/`stopTimer`/`cancelTimer`); shared date/week helpers (`weekStart`/`weekDays`/`minutesLabel`); the totals engine (`totals` → minutes, billable minutes, value, by member/client); and **billing-rate resolution** (`RATE_SCOPES`, `rateRules`, `resolve`/`resolveFor`, `chain`/`source`/`reason`) with the four-tab station (Entries & timers, Timesheets & approval, Expenses, Billing rates) |
| `src/psa.timesheets.js` | **Phase 4** — weekly timesheets (`ERP.timesheets`): the member-week lifecycle (open → submitted → approved → locked, with rejected sending entries back to draft), `build`/`submit`/`approve`/`reject(comment)`/`lock`/`reopen`, `pending` approval queue, `rollup` totals per member & client, and the approval UI it renders into the Time & Expense station |
| `src/psa.expenses.js` | **Phase 4** — expenses (`ERP.expenses`): expense records with category, amount, date, billable flag, receipt (file via `upload-plugin` or URL), markup (none/percent/flat), and reimbursable flag; `draft → submitted → approved → reimbursed` with `rejected`/`locked`; `billableAmount`, `rollup` (cost/billable/reimbursable + by client/category), `forTicket`, and the expenses table / approval queue / client-billable roll-up UI |
| `src/psa.agreements.js` | **Phase 5** — agreements, coverage, billing, profitability & renewals (`ERP.agreements`): agreement CRUD + unique numbering (`AGR-####`) and term/cycle/auto-renew/escalation rules; tracked coverage lines with effective dates, mid-term proration and missing-device warnings; the derived charge (base + per-unit + minimum + included-hours overage + escalation + proration) computed as a pure preview (`deriveCharge`/`previewCharge`) then posted idempotently to the `agreementCharge` ledger (`postCharge`/`voidCharge`/`generateDue`) for Phase 6 to assemble; per-agreement profitability against labour at member `hourlyCost` plus expenses with revenue-pro-rata attribution (`profitability`/`utilization`); and the lifecycle (`renewalQueue`/`renew`/`setStatus`/`activate`/`suspend`/`terminate`/`archive`/`runLifecycle`) with the five-tab station (Agreements, Coverage & additions, Agreement billing, Profitability, Renewals & lifecycle) |
| `src/psa.billing.js` | **Phase 6** — billing setup, invoice assembly, generation runs & safety (`ERP.billing`): provider+per-client billing config with a documented precedence (`settings`/`companyProfile`/`configFor`), tax rates & CAS-safe invoice numbering, pure invoice assembly from agreement charges + approved time + marked-up expenses + project milestones grouped per the template with every line traceable (`assemble`/`dryRun`/`lineTotals`), readiness gates (`readiness`), non-writing run previews (`preview`) and the writing run (`generate`/`run`/`approve`/`post`/`void`), immutable posted invoices with source locks (`markInvoiced`) and audit/workflow events, plus the five-tab station (Invoices, Billing runs, Payments & credits, Financial reports, Billing setup) |
| `src/psa.payments.js` | **Phase 6** — payments, credits & adjustments (`ERP.payments`): payment records against posted invoices (`record`/`voidPayment`, idempotency keys), client credit notes held on account or applied (`issueCredit`/`applyCredit`/`voidCredit`), signed adjustments and write-offs (`adjust`/`writeOff`), balance & payment-status recompute through `ERP.billing.recalc`, company balances, and the Payments & credits tab |
| `src/psa.ar.js` | **Phase 6** — financial reporting (`ERP.ar`): AR aging buckets (current/1–30/31–60/61–90/90+), revenue by client and by service, billing backlog / unbilled WIP (approved time + billable expenses + unposted agreement charges), invoice & payment summaries, and CSV + print/PDF export (`toCsv`/`downloadCsv`/`printHtml`) with the Financial reports tab |
| `src/psa.projects.js` | **Phase 7** — projects, tasks, budgets & milestone billing (`ERP.projects`): reusable project templates (phases + predefined tasks with owners/estimates/checklists) and one-click instantiation; project phase/task/milestone CRUD with owners, dates, dependencies, estimates and checklists; `rollup` deriving phase/project status & progress (auto-releasing phase/auto milestones); budget, cost and profitability (`estimate`/`actuals`/`budgetStatus`/`profitability`) from estimated vs actual hours and expenses; and the billing seam (`billableMilestones`/`readyMilestones`/`markMilestonesInvoiced`) that Phase 6 assembles into invoices — with the five-tab Projects station (Projects, Templates, Schedule, Budget, Billing) |
| `src/psa.sales.js` | **Phase 8** — sales & CRM (`ERP.sales`): the opportunity pipeline on the taxonomy stages with stage-change history, win/loss reasons and weighted forecasts (`pipeline`/`forecast`); quotes & proposals with line-level cost/sell/discount, margin visibility, printable proposal (`proposalHtml`/`printProposal`) and conversion of an accepted quote into a project, an agreement and/or procurement intents (`convertQuote`); sales activities against companies/opportunities/leads with next steps and overdue tracking; and lead capture with de-duplication and conversion to a company + opportunity preserving the lead history — with the four-tab Sales station (Pipeline, Quotes, Activities & forecast, Leads); the quote editor can add **catalog items** (Phase 9) and posting/sending a quote is gated by the Phase-9 **margin floor** |
| `src/psa.catalog.js` | **Phase 9** — product & service catalog + pricing engine (`ERP.catalog`): catalog-item CRUD (SKU, cost/sell, class/category, unit, vendor, tax, stock flags), pricing rules (scope global/vendor/class/category/item; mode markup/margin/percent/fixed; rounding, priority, effective dates), per-client price overrides, an explainable `resolvePrice` (returning the winning rule + the considered `chain` + `source`), the margin engine (`margin`/`lineMargin`/`marginCheck`/`checkQuoteFloors`/`checkPoFloors`/`recordMarginOverride`), settings, seeds, and the four-tab Products station (Catalog, Pricing rules, Client overrides, Margin rules) |
| `src/psa.procurement.js` | **Phase 9** — vendors, purchase orders & approvals (`ERP.procurement`): vendor CRUD; PO CRUD + totals + the `draft→pending_approval→approved→ordered→partially_received→received→closed/cancelled` flow; links to client/opportunity/project/ticket and lead-time-derived expected dates; `fromIntents` raising a PO from Phase-8 `procurementIntent`s; configurable approval threshold + margin/markup floors (`submit`/`approve`/`reject`, `policy`/`savePolicy`/`approvalQueue`), and the five-tab Procurement station (Purchase orders, Vendors, Receiving & drop-ship, Inventory, Approvals & rules) |
| `src/psa.inventory.js` | **Phase 9** — receiving, drop-ship & inventory (`ERP.inventory`): warehouses, an append-only `stockMove` ledger (on-hand = Σ deltas) with `adjust`/`transfer`/`issue`, full/partial `receive` and drop-ship (no stock), the receipt register with variance/discrepancy tracking and a reconcile queue, low-stock vs reorder point, valuation, and the Receiving & drop-ship + Inventory tabs |
| `src/psa.kb.js` | **Phase 10** — knowledge base (`ERP.kb`): `kbCategory` + versioned `kbArticle` (draft→published→archived, internal/public visibility, previous-version snapshots + `restoreVersion`), `search`/`scoreArticle`/`suggestForTicket` (ticket→article suggestions) and `fromTicket` (draft an article from a resolved ticket), `linkText` (link an article into a reply), view/helpful counters, and the Articles + Categories tab renderers with their modals |
| `src/psa.configurations.js` | **Phase 10** — configuration/asset records (`ERP.configurations`, `kind:"configuration"` in the **client company document**): asset CRUD (type, make/model, serial, hostname/IP/MAC/OS, location, warranty/support dates, relationships), per-field **field ownership** (`DEFAULT_OWNERSHIP` — docs-owned descriptive fields, psa-owned status/notes/relationships) with `setOwnership`/`ownerOf`, `syncFromDocs` applying docs-owned fields and filing mismatches as **drift** (created/updated/drifted/unchanged report) with `drift`/`resolveDrift`, a `sampleFeed` stand-in and `expiringWarranties`, plus the Assets tab + asset/relationship/sync modals |
| `src/psa.rmm.js` | **Phase 10** — RMM / monitoring (`ERP.rmm`): `rmmAlert` + ordered `rmmRule` matching (severity/type/device) + `rmmSettings`; `ingest` normalises and de-duplicates events (externalId, or device+type while open, within a window), matches a rule and **auto-creates a ticket** via `ERP.tickets.save` (source `monitoring`), `locateDevice` links the alert to its configuration record by externalId/serial/hostname/name, clears/`resolve`s with **auto-resolve** of the ticket, `acknowledge`/`ignore`, `stats`, and the Monitoring tab + ingest/rule modals |
| `src/psa.approvals.js` | **Phase 10** — approval workflows (`ERP.approvals`): `approvalRequest` for quotes/tickets/change requests/POs/invoices with client-vs-internal `route` (a client's portal contact vs its account manager/manager), `request`/`decide`/`cancel`/`sweep` (expiry + reminders), `THEN_ACTIONS` release hooks (send/accept quote, approve PO, post invoice, note ticket) + `REJECT_ACTIONS`, `gateFor`/`canProceed`, convenience creators `forQuote`/`forPO`/`forInvoice`/`forTicket`, stats/settings/ensure, and the Approvals tab + decision/request modals |
| `src/psa.portal.js` | **Phase 10** — client portal & self-service (`ERP.portal`): a company+contact session (`enter`/`leave`/`requireSession`, localStorage `psa.portal.session`) scoped strictly to the session company — `submitTicket`/`tickets`/`ticket` (customer-visible notes only)/`addComment`, published+public `articles`/`article`, posted-only `invoices`/`invoice`, pending `approvals` + `decide` (delegating to `ERP.approvals.decide` as `byType:"client"`), `stats`, and the sign-in screen + four-tab station |
| `src/psa.knowledge.js` | **Phase 10** — Knowledge station controller (`ERP.knowledge`): composes five tabs — Articles & Categories (`ERP.kb`), Assets & configurations (`ERP.configurations`), Monitoring (`ERP.rmm`) and Approvals (`ERP.approvals`) — seeding the starter kb/rmm/approvals data idempotently on first visit and re-rendering the active tab in place |
| `src/psa.reports.js` | **Phase 11** — report builder & scheduling (`ERP.reports`): 13 source adapters (tickets, time, expenses, invoices, payments, agreements, opportunities, quotes, projects, purchase orders, configurations, articles, members) each flattening records to typed rows; declarative filters (eq/ne/contains/in/gt…/between/truthy/is_empty), grouping with count/sum/avg/min/max/countDistinct, saved `reportDef` definitions, CSV export, `reportSchedule` cadences (daily/weekly/monthly) with `nextRunAt`/`deliver`/`sweep` producing `reportDelivery` artifacts (payload + optional published link), idempotent starter seeds, a safe `chart()` wrapper over the imported `data-visualization-plugin`, and the **Reports station** which composes the Dashboards/Builder/Schedules/Export tabs |
| `src/psa.dashboards.js` | **Phase 11** — operational dashboards (`ERP.dashboards`): live KPI computations — `sla` (response/resolution compliance, open breach/at-risk, by board/priority), `backlog` (open tickets aged into current/1-30/31-60/61-90/90+ by board/priority/owner), `utilization` (captured vs business-hours capacity per technician, billable hours/value), `agreements` (profitability), `billing` (backlog + AR aging + summary), `revenueTrend` (invoiced vs received by month), a combined `overview`, `drill(kind,key)` returning the records behind any figure, and the Dashboards tab renderer (KPI grid, SVG charts, tables, period selector) |
| `src/psa.bi.js` | **Phase 11** — data export & BI handoff (`ERP.bi`): a versioned `SCHEMA` (conformed dimensions + typed fact columns), `dimensions`/`facts` builders (ticket, time, expense, invoice, payment, opportunity, agreement, purchase_order), the shared `ERP.envelope()` wrapper, `extract` (envelope + dims + facts + counts), `toCsv`/`downloadJson`, and `publish`/`handoffs` (upload the extract JSON and record a `biHandoff`) plus the BI export tab |
| `src/psa.integrations.js` | **Phase 12** — connector framework (`ERP.integrations`): six documented connectors (email, accounting, calendar, identity/SSO, RMM, MSP documentation) declared with direction (`pull`/`push`/`both`) and per-field **ownership** (`psa`/`external`); per-provider connection state (enable/disable, last run/status) and per-run `integrationRun` records; a driver registry (`registerDriver`/`DRIVERS`) so a connector can be implemented/replaced, a **retry/backoff** runner (`withRetry`, `run`/`runAll`) and a sync log (`syncLog`/`clearLog`), plus the Integrations admin tab (connector cards with Pull/Push/Enable, field-ownership tables, sync log) |
| `src/psa.api.js` | **Phase 12** — public API, webhooks & pipeline bus (`ERP.api`, aliased `ERP.pipeline`): a versioned API surface (`API_VERSION`, `ENDPOINTS`/`describe`/`call`) gated by permissions; `webhook` subscriptions (events, secret) with HMAC-signed `deliver` (retry, `webhookDelivery` records); and the shared event bus — `publish` wraps an event in the pipeline **envelope** and stores a `pipelineEvent`, `consume`/`HANDLERS` let other pipeline tools subscribe, with the API & webhooks admin tab and the webhook editor + envelope viewer modals |
| `src/psa.integrity.js` | **Phase 12** — data-integrity linter (`ERP.integrity`): twelve named checks over the accumulated record set (tickets never assigned/never closed, closed without resolution, agreement coverage for devices that no longer exist, billable time never invoiced, invoices posted without source lines, SLA policies referencing missing statuses, companies missing billing terms, orphaned time/expenses, negative balances) each returning the offending records; `lint`/`summary`/`severityMeta` and the Data-integrity admin tab (severity filter, findings table, re-run) |
| `src/psa.companies.js` | Companies controller (`ERP.companies`): tabs Clients / Sites / Contacts, search, modals, permission enforcement, topbar client selector |
| `src/psa.dashboard.js` | Dashboard controller (`ERP.dashboard`): provider profile, stats, storage/sync summary, station tiles with phase badges |
| `src/psa.admin.js` | Admin console (`ERP.admin`): Overview, Members/Teams/Calendars, Configuration (taxonomy CRUD + change history + version restore), Security (matrix, actor, scopes), Data & sync (sync centre, backup panel, version history, tenant doc sizes), the Phase-12 **Integrations**, **API & webhooks** and **Data integrity** tabs, and the Phase-13 **Collaboration** tab (`ERP.collab.renderPanel`) |
| `src/psa.servicedesk.js` | **Phase 2** — Service Desk station (`ERP.servicedesk`): hosts the six tabs (Tickets, Boards & routing, SLAs & business hours, Templates & recurring, Automation, Notifications), seeds defaults on first visit, and re-renders the active tab in place |
| `src/psa.tests.js` | Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6 + Phase 7 + Phase 8 + Phase 9 + Phase 10 + Phase 11 + Phase 12 + Phase 13 test harness (`window.PSATest()`), isolated backend (the Phase-13 groups `phase13-model`/`phase13-hub`/`phase13-stations` stop the collaboration poller and use a mock transport, then restore them) |
| `src/erp.css` | shell styles + appended PSA-U Phase 1–12 styles (`.erp-tiles`, `.erp-defs`, `.erp-split`, `.erp-cat-list`, `.erp-cal-days`, `.erp-client-select`, `.erp-tk-*`, `.erp-notes`, `.erp-checklist`, `.erp-cond-row`/`.erp-act-row`, `.erp-db-*` dispatch board, `.erp-avail-*`, `.erp-hours-*`, `.erp-suggest`/`.erp-reasons`, `.erp-time-*` week grid & cards, `.erp-timer*`, `.erp-ts-entry`, `.erp-rate-*`, `.erp-file-row`, `.erp-proj-*` project phases/milestones, `.erp-sales-*` pipeline board & quote lines, `.erp-po-line`/`.erp-rcv-line` PO & receiving line grids, `.erp-toolbar`, `.erp-kb-meta`/`.erp-kb-tags`/`.erp-kb-summary`/`.erp-kb-body`/`.erp-kb-link`, the Phase-11 `.erp-kpi-grid`/`.erp-kpi.tone-*`/`.erp-chart-box`/`.erp-builder-grid`/`.erp-filter-row`/`.erp-check-grid`/`.erp-inline-field`/`.erp-muted-note`, the Phase-12 `.erp-int-grid`/`.erp-int-actions`/`.erp-envelope`/`.erp-finding-row`, the phone overrides, …) |
| `src/template.css` | base design tokens |
| _(server block)_ | `index.html` holds the `<script type="text/x-server-plugin">` team hub (roles, rate limiting, audit ring, document-version fan-out) |

## Conventions & gotchas

- **`ERP.ui.table` cell values are trusted HTML.** Callers must `esc()` their
  own dynamic text; columns built with coloured badges/buttons pass HTML strings
  directly. (A regression guard lives in the `ui:` test group.)
- Controllers read/write through `ERP.tenancy`/`ERP.companies` — they never name
  documents. Permissions are enforced in code (`ERP.security`), never by hidden
  UI alone.
- The top bar collapses on narrow phones (≤520px) by hiding the decorative team
  dot and the acting-as selector (the latter is available in Admin → Security),
  so nothing overflows at 390px.
- Everything is async and backed by a lazily-hydrated canonical store: render
  functions `await` what they need. The store is cache-first, so a cold device
  fetches canonical documents on first read.

## Data model

PSA-U is multi-tenant: one deployment serves many **service providers**, and
each provider holds many **client companies**.

```
psa-v1-tenancy                       root registry — the service providers
psa-v1-tenant-<pid>                  one provider document
    kind: companyIndex  (directory entries: id, name, status, type, AM, counts)
    kind: member        (technician/staff: role, teams, skills, territory, personal workHours override, dispatchable, scopes, cost/charge rate)
    kind: team
    kind: calendar      (business hours + holidays)
    kind: <taxonomy cat> (serviceBoard, ticketStatus, priority, ticketType, … 17 categories)
    kind: boardConfig   (per-board defaults: status flow, priority set, team, auto-assign)   [P2]
    kind: savedFilter   (named ticket-register filters)                                     [P2]
    kind: ticketCounter (the unique ticket-number sequence)                                 [P2]
    kind: slaPolicy     (response/resolution targets, stop-clock & escalation)              [P2]
    kind: ticketTemplate / recurringTicket                                                  [P2]
    kind: workflowRule / routingRule / workflowLog                                          [P2]
    kind: notificationRule / notificationTemplate / memberPref                              [P2]
    kind: notification / notificationLog / notificationDigest / outboundEmail               [P2]
    kind: timeOff       (member time off: from/to, all-day, reason)                         [P3]
    kind: timeEntry     (billable time: member, date, minutes or start/end, work type/role/code, billable, rate stamp) [P4]
    kind: timer         (the one running stopwatch a member may have)                       [P4]
    kind: rateRule      (billing-rate precedence rules: scope, filters, amount)             [P4]
    kind: timesheet     (a member's submitted/approved/locked week + totals)                [P4]
    kind: expense       (category, amount, markup, receipt, billable/reimbursable, status)  [P4]
    kind: billingSettings (provider invoice/quote defaults, tax codes & rates, currencies, invoice cycle, numbering prefixes) [P6]
    kind: projectTemplate (reusable blueprint: phases, predefined tasks with owners/estimates/checklists, milestone defs) [P7]
    kind: lead          (inbound prospect: contact, source, status, value, history, converted links) [P8]
    kind: salesActivity (call/meeting/email/demo/follow-up/task against a company, opportunity or lead) [P8]
    kind: procurementIntent (a converted quote's product line awaiting a Phase-9 purchase order)      [P8]
    kind: catalogItem   (SKU, cost/sell, class/category, unit, vendor, tax, inventory flags)          [P9]
    kind: priceRule     (scope global/vendor/class/category/item; markup/margin/percent/fixed; dates)  [P9]
    kind: priceOverride (per-client fixed price or discount on a catalog item)                        [P9]
    kind: catalogSettings (margin/markup floors + pricing defaults)                                   [P9]
    kind: vendor        (name, contact, email/phone, terms, lead time, status)                        [P9]
    kind: purchaseOrder (vendor, lines, totals, status, links to client/opportunity/project/ticket, expected vs received) [P9]
    kind: procurementSettings (PO approval threshold + margin/markup floors + enforcement flags)      [P9]
    kind: warehouse / stockMove / receipt (locations, the append-only stock ledger, receiving)        [P9]
    kind: marginOverride (a recorded, reason-stamped override of a margin/markup floor)               [P9]
    kind: kbCategory    (article filing: name, description, order)                                    [P10]
    kind: kbArticle     (versioned knowledge article: category, tags, visibility, status, versions)   [P10]
    kind: rmmSettings   (the monitoring feed's enabled/dedupe/auto-create/auto-resolve policy)        [P10]
    kind: rmmRule       (an ordered ingestion rule: match + ticket/priority/board/auto-resolve)       [P10]
    kind: rmmAlert      (an ingested device alert: severity, count, first/last seen, ticket link)     [P10]
    kind: approvalSettings (enabled + default due days + reminder interval)                           [P10]
    kind: approvalRequest  (what is being approved, routing, due/reminders, audit, release action)    [P10]
    kind: reportDef     (a saved report: source, filters, grouping, metrics, viz)                     [P11]
    kind: reportSchedule (a report's cadence/hour/recipients/format + next & last run)                 [P11]
    kind: reportDelivery (a produced report payload: CSV + summary + optional published link)          [P11]
    kind: biHandoff     (a published BI extract: url, schema version, counts, generatedAt)             [P11]
    kind: integration   (a connector's per-provider state: enabled, direction, config, cursor, last run) [P12]
    kind: integrationRun (one sync run: connector, direction, status, counts, attempts, error, times)   [P12]
    kind: webhook       (an outbound subscription: name, url, events, active, secret)                   [P12]
    kind: webhookDelivery (one delivery attempt: webhook, event, status, attempts, error)                [P12]
    kind: pipelineEvent (the shared bus log: event, entity, envelope bytes)                             [P12]
psa-v1-company-<cid>                 one client company document
    kind: company       (status, type, addresses, billing terms, tax, account manager)
    kind: site          (billing / shipping / service locations)
    kind: contact       (roles, phone/email, site, portal access)
    kind: configuration (asset/configuration record: type, serial, location, warranty, relationships, fieldOwners, drift) [P10]
    kind: ticket        (status, priority, board, owner/team, SLA stamp, checklist, tags, requiredSkills) [P2/P3]
    kind: ticketNote / ticketActivity / ticketAttachment / ticketRelation / ticketMerge     [P2]
    kind: appointment   (window, travel, site/contact, technician, on-site notes & sign-off, type/status) [P3]
    kind: agreement     (type, term/cycle, auto-renew & escalation, status, service codes + coverage lines, renewals) [P5]
    kind: agreementCharge (the derived recurring charge posted for a period, with its lines + inputs)             [P5]
    kind: billingProfile (per-client billing overrides: currency, tax, terms, cycle, PO, numbering)               [P6]
    kind: invoice       (number, status draft/approved/posted/void, period + runKey, lines, tax, totals, balance, due date) [P6]
    kind: payment       (receipt against a posted invoice: date, method, amount, reference, idempotency key)      [P6]
    kind: creditNote    (client credit held on account or applied to an invoice; adjustments & write-offs)        [P6]
    kind: project       (template-derived phase/task tree with milestones, estimates, billing method, status & rolled-up progress) [P7]
    kind: opportunity   (deal: stage, probability, value, expected close, source, owner, stage history, win/loss) [P8]
    kind: quote         (proposal: lines with cost/sell/discount, totals & margin, status, conversion links)       [P8]
psa-v1-versions                      restorable version history (snapshots on commit)
psa-v1-backup                        the published backup bundle
psa-v1-index                         the store's document index
```

Every Phase-2 record kind is namespaced by `companyId` (company document) or by
the provider (tenant document), so tickets stay with their client and the
engines (SLA, workflow, notify) live with the provider that owns them.

Later phases add each company's tickets, time, agreements, invoices, projects,
opportunities, quotes, POs, configurations and articles into the **company
document**, so a tenant's data is self-contained and portable.

`ERP.tenancy` resolves the active provider/company and hands out read/write
handles; controllers never name documents directly. Documents go through the
inherited store, which caches locally, keeps an editable edit key, bumps a
per-document revision and refuses conflicting overwrites (see Sync below).

## Security model

`ERP.security` (Task 4) is a permission matrix over the system roles
(owner/manager/staff), enforced in code — hiding UI is never the boundary:

- Permissions include `companies.view/edit/delete`, `members.edit`,
  `taxonomy.view/edit`, `financials.view`, `data.view/manage`, `sync.manage`,
  `backup.manage`, `security.view/edit`, and the Phase-2 service-desk set:
  `tickets.view/edit/delete/merge`, `boards.edit`, `routing.edit`,
  `sla.view/edit`, `templates.view/edit`, `workflow.view/edit`,
  `notifications.view/edit`, the Phase-3 delivery set: `dispatch.view/edit`,
  `appointments.view/edit`, `schedule.view/edit`, `timeoff.view/edit`, the
  Phase-4 time & money set: `time.view/edit/delete/approve`,
  `expenses.view/edit/approve` and `rates.view/edit` (rate rules are
  **owner-only**), and the Phase-5 agreements set:
  `agreements.view` (everyone), `agreements.edit`, `agreements.bill` and
  `agreements.terminate` (owner & manager), and the Phase-6 billing set:
  `billing.view` (everyone) with `billing.edit` and `billing.post`,
  `payments.view` (everyone) with `payments.edit` and `payments.void`, and
  `reports.financial`, the Phase-7 projects set (`projects.view` everyone;
  `projects.edit`/`projects.bill` owner & manager), the Phase-8 sales set:
  `sales.view` (everyone), `sales.edit` and `sales.convert` (owner & manager)
  and `sales.activity` (owner, manager & staff), and the Phase-9 supply set:
  `catalog.view`/`procurement.view`/`inventory.view` (everyone) with
  `catalog.edit`, `procurement.edit`, `procurement.approve`, `inventory.edit`,
  `inventory.adjust` and `catalog.margins` (owner-only), plus
  `procurement.receive` (owner, manager & staff), and the Phase-10
  knowledge/configuration/monitoring/portal/approval set: `kb.view`,
  `configuration.view`, `rmm.view`, `approvals.view` and `portal.view` are open
  to every role; `kb.edit`, `configuration.edit`, `rmm.edit`, `approvals.decide`,
  `approvals.manage` and `portal.manage` are owner & manager; and
  `approvals.request` (raise an approval) is open to owner, manager & staff; and
  the Phase-11 reporting set: `reports.view` is open to every role while
  `reports.build`, `reports.schedule` and `reports.export` are owner & manager
  (with `reports.financial` gating financial figures); and the Phase-12
  integration/API set: `integrations.view`, `api.view` and `integrity.view` are
  open to every role while `integrations.edit`, `integrations.run` and
  `api.manage` are owner & manager. The `.view` permissions are
  open to every role, everything else owner & manager (`[]` = every role,
  unknown = denied).
- **Record-level scopes** on a member restrict which companies and boards they
  can see (`canViewCompany`), and `scopes.financials === false` hides money
  (`security.money()` renders `•••`).
- The **actor member** is selected in Admin → Security, so a restricted member's
  real experience is testable without re-logging.
- When the realtime hub is online the server is the authority: `ERP.security`'s
  `actor`/`can` defer to it, and guarded actions go through `T.guard(perm, ctx)`,
  which is re-authorised on the hub against the system role, the functional
  capability, the company/board scope and the financial-visibility flag (Phase
  13 — see *Multi-user & realtime collaboration*). The client role is then
  demo-only.

## Navigation — stations & groups

`ERP.groups` (in `src/psa.modules.js`) drives the sidebar. Fifteen stations:

| Group | Stations |
| --- | --- |
| _(ungrouped)_ | Dashboard |
| Service desk | Service Desk |
| Delivery | Dispatch · Time & Expense |
| Revenue | Agreements · Billing |
| Projects | Projects |
| Sales | Sales |
| Supply | Procurement · Products |
| Knowledge | Knowledge |
| Directory | Companies · Client Portal |
| Insight & admin | Reports · Admin |

Every station is built — there are no roadmap-pending stations left. The live
controllers are: Dashboard, Service Desk, Dispatch, Time & Expense, Agreements,
Billing, Companies, Projects, Sales, Procurement, Products, Knowledge, Client
Portal, Reports and Admin (plus the hidden Admin sub-panels — including the
Phase-12 Integrations, API & webhooks and Data integrity tabs — and the Service
Desk, Dispatch, Time & Expense, Agreements, Billing, Projects, Sales,
Procurement, Products, Knowledge and Reports sub-tabs).

## Service desk (Phase 2)

The Service Desk station (`ERP.servicedesk`) composes six tabs, each backed by a
module that can also be driven programmatically:

| Tab | Module | What it does |
| --- | --- | --- |
| Tickets | `ERP.tickets` | Register (list + board kanban), new-ticket modal, full detail modal (Details / Notes / Activity / Files / Links), search + saved filters |
| Boards & routing | `ERP.tickets` + `ERP.workflow` | Per-board defaults and the inbound routing table |
| SLAs & business hours | `ERP.sla` | Policies, business-hours calendars, live breach/at-risk monitor |
| Templates & recurring | `ERP.templates` | Prefilled templates and scheduled/recurring ticket runs |
| Automation | `ERP.workflow` | Event rules, routing rules and the firing log; dry-run previews |
| Notifications | `ERP.notify` | Rules, templates, per-member preferences and the delivery log |

**Event flow.** A ticket write calls `ERP.tickets.emitEvent` → `ERP.workflow.emit`
(which applies matching rules) → `ERP.notify.emit` (recipient resolution,
mute/dedup, channel & digest). The SLA clock is stamped by `ERP.sla.sync` on
save and swept by `ERP.sla.sweep`, whose breach path emits through the same
workflow pipeline. Every engine is depth-guarded so a rule cannot loop.

**Seeds.** Opening the station idempotently seeds a starter set: board configs
and a saved filter, SLA policies (Standard support, Critical incident) and a
default business-hours calendar, notification rules + a template, workflow rules
and routing, and two ticket templates. Seeds are keyed so they are added once and
never duplicated.

## Dispatch & scheduling (Phase 3)

The Dispatch station (`ERP.dispatch`) is the delivery workspace and composes four
tabs, each backed by a module that can also be driven programmatically:

| Tab | Module | What it does |
| --- | --- | --- |
| Dispatch board | `ERP.dispatch` | Technician rows × hourly columns (06:00–20:00), an unassigned queue, drag-and-drop scheduling/rescheduling, capacity/overload bars and conflict badges |
| Appointments | `ERP.appointments` | The appointment register and its new/edit/complete modals |
| Calendars & availability | `ERP.scheduling` | Per-member work hours, skills/territory, time off and a 14-day availability strip |
| Scheduling assistant | `ERP.scheduling.recommend` | Ranked, explained assignee suggestions a dispatcher can accept or override |

**Availability math.** `ERP.scheduling.memberWindows(pid, memberId, dayMs)`
resolves a member's effective working windows — their personal `workHours`
override if set, otherwise the business-hours calendar from `ERP.sla` — then
subtracts time off (`subtractWindows`) and existing appointments/tickets to give
`availability()` (work vs available vs booked minutes) and `capacity()`.
Everything is computed in local wall-clock time, so the board, the appointment
modals and the assistant all agree.

**Conflicts.** `conflicts(pid, candidate, {exclude})` flags `double_book`,
`outside_hours`, `time_off` and `skill_mismatch` for a proposed window; the
board renders each as a badge and the assistant factors it into the score.
`requiredSkillsFor(ticket)` derives the needed skills from the ticket's explicit
`requiredSkills`, falling back to its item/subtype/type taxonomy entries, and
`skillMatches` scores the overlap.

**The board.** A drag payload (`blockPayload`) moves an appointment/ticket/queue
job onto a member's hour cell; `ERP.dispatch.applyMove` is the single shared
core that reschedules (or schedules from the queue) and refreshes. The same move
is available from the keyboard — Tab to a block, arrow keys nudge it an hour or
to the next member, Enter edits, Delete unschedules. State (date, team, selected
member/ticket) hangs off the station element (`host.__db`) so it survives tab
re-renders.

**Appointments & ticket sync.** Appointments live in the client's company
document (`kind:"appointment"`) so visits travel with the client. Saving one
keeps the ticket in step: the appointment takes the ticket's owner and schedule
and the ticket moves to **Scheduled** (unless it is closed/resolved); completing
the visit records the on-site notes and sign-off and writes them back to the
ticket as an internal note. All of this emits `appointment.*` events through the
Phase-2 workflow engine.

## Time & expense (Phase 4)

The Time & Expense station (`ERP.time`) is the delivery ledger every later
billing phase reads from. It composes four tabs, each backed by a module that can
also be driven programmatically:

| Tab | Module | What it does |
| --- | --- | --- |
| Entries & timers | `ERP.time` | Day/week grid of time entries, the new/edit-entry modal, and the quick timer (start/stop/discard) |
| Timesheets & approval | `ERP.timesheets` | A member's Monday–Sunday week, submit / approve / reject-with-comment / lock / reopen, the approval queue and per-member totals |
| Expenses | `ERP.expenses` | Expense register with category, amount, markup, receipt and reimbursement state, the approval queue and the client-billable roll-up |
| Billing rates | `ERP.time` | Rate-rule CRUD, the documented precedence explainer, and a rate checker that shows which rule wins |

**Time entries (19).** A `timeEntry` lives in the provider document and carries
its member, client/ticket (or internal general work), date, work type, charge
role and charge code, notes, and either a start/end pair or a straight number of
minutes. **Billable** defaults from the work type and charge code (either can
declare itself non-billable) but an explicit operator override always wins.
Duration is normalised to minutes (`normaliseDuration`) so a stopwatch and a
typed "2h 30m" are the same thing. A member can keep **one running timer**;
stopping it turns the elapsed time into a normal entry (`source:"timer"`).
`ERP.time.totals` computes minutes, billable minutes and billable value, grouped
by member and by client, and is shared by the timesheet and expense roll-ups.

**Timesheets & approval (20).** A week runs Monday–Sunday in local calendar
time. An untouched week is *open* (derived, never stored); submitting freezes its
entries to `submitted` and puts the sheet in the manager's queue; approving
marks the entries `approved` and read-only for billing; rejecting **with a
comment** returns the entries to `draft` so they can be corrected; an approved
week can be locked (e.g. once invoiced) — and a locked week cannot be reopened.
Approval is the enforced `time.approve` permission, not a hidden button, and the
week's totals are always computed from the entries themselves so they agree with
the ledger. A manager can also **write off** an individual entry — it stays in
the ledger for utilisation and audit but stops contributing to the billable
value, reversibly.

**Expenses (21).** An `expense` carries a category, amount, date, client/ticket
(or internal), description, a billable flag derived from its category (overridable),
a reimbursable flag, a **receipt** (uploaded through `upload-plugin`, or a pasted
URL), and a **markup** (none / percent / flat). It moves
`draft → submitted → approved → reimbursed`, with `rejected` (comment required)
and `locked` states, enforced by `expenses.edit` / `expenses.approve`.
`billableAmount` applies the markup, `rollup` reports cost, client-billable value
and reimbursable totals grouped by client and category, and the tab renders the
approval queue and a client-billable roll-up card.

**Billing-rate resolution (22).** Every entry records *which rule produced its
rate*, resolved through a fixed, documented precedence (most specific first):

1. **Agreement override** — a rate on the client's active agreement.
2. **Work type / role** — a provider rate for a work type + charge role pair.
3. **Ticket priority** — a rate for work on tickets of a given priority.
4. **Client-specific** — a rate negotiated for one client.
5. **Default** — the charge role's configured rate, else the member's standard
   charge rate.

`ERP.time.resolve(pid, ctx)` returns the winning amount **and** the rule, the
scope label, a human-readable reason, and a `chain` describing every rung it
considered (so the UI's *rate checker* and an eventual invoice can both explain
the number). A saved entry stamps the resolved rate onto itself, so invoice math
stays explainable and testable after the fact. Rules are owner-only to edit.

## Agreements (Phase 5)

The Agreements station (`ERP.agreements`) is the recurring-revenue engine every
later billing phase reads from. It composes five tabs, each backed by functions
that can also be driven programmatically:

| Tab | What it does |
| --- | --- |
| Agreements | The agreement register (number, client, type, status, term, cycle, covered units, recurring value) with filter, new/edit modal and activate/suspend/resume/terminate actions |
| Coverage & additions | The tracked coverage lines — configuration / service / user, each with quantity, unit price and effective dates — with proration preview and missing-device warnings |
| Agreement billing | The live charge preview (every derived line and every input that produced it), plus posting, voiding and the run-due sweep, over the posted-charge ledger |
| Profitability | Revenue vs the burdened cost of servicing, margin and margin % per agreement/client, included-hours consumed/remaining, overage and flags |
| Renewals & lifecycle | The expiry queue (lead time, auto-renew vs explicit), the renew action (term + escalation), and the archive of expired/terminated agreements |

**The agreement record (23).** An `agreement` lives in the **client company
document** (`kind:"agreement"`) — the same place the Phase-4 rate resolver looks
for its agreement-override rung, so the moment an agreement is active its rate
rules apply. It carries a type (managed / per-device / per-user / block-of-hours
/ one-off), a start date and term (or open), a billing cycle and anchor day,
automatic renewal + renewal term + notice days, a pricing model (flat / per-unit
/ block-of-hours / one-off) with base amount, included hours, overage rate and a
minimum commitment, an optional price escalation (percent every N months),
`serviceCodes` for cost attribution, and the coverage/renewal histories. A new
agreement is always `draft` and gets the next `AGR-####` number; status then
moves `draft → active → suspended → expired/terminated/cancelled`.

**Coverage (24).** A coverage line states exactly what the agreement covers —
`configuration` (device), `service` or `user` — with a reference id, quantity,
unit price and effective dates. Adds and cancellations are *dated*, never
destructive: ending a line sets its `effectiveTo` and keeps it for history.
`coverageValue`/`coverageUnits` value the active lines as of a date, and
`coverageWarnings` flags any covered device whose id is absent from the client's
configuration records (those records arrive in Phase 10; until then a covered
device reports as uncatalogued).

**Billing (25).** `deriveCharge(pid, agreement, period, opts)` is a pure
preview — it reads time to compute included-hours overage but writes nothing —
and returns every line (base, per-unit, escalation, minimum top-up, overage) and
every input. The maths: base + per-unit coverage each prorated over its effective
window **and clamped to the agreement term**; an escalation multiplier applied
after the first interval; a minimum-commitment top-up; and overage above the
included hours at the overage rate. `postCharge` re-derives and writes an
immutable `agreementCharge` (with its lines + inputs) into the company document,
idempotently — posting the same period twice is blocked unless `replace` is set.
`generateDue` is the seam Phase 6 calls: it posts the current period for every
active agreement and skips the ones already posted (and skips agreements with
nothing to bill). A charge can be voided until it has been invoiced.

**Profitability (26).** `profitability(pid, {from, to, …})` reports agreement
revenue (posted charges, or the derived estimate) against cost: labour at each
member's burdened `hourlyCost`, plus expenses (parts / third-party). Cost is
attributed to an agreement by its covered `serviceCodes` when set, all of the
client's work when the client has a single agreement, otherwise pro-rata by
revenue — and the basis is shown. Each row carries revenue, labour, other cost,
margin, margin %, included hours consumed/remaining, overage hours and flags
(`Unprofitable`, `Overage`, `Hours nearly used`, `Suspended`). `utilization` is an
alias.

**Lifecycle (27).** `renewalQueue` lists active agreements expiring within a lead
time (default 60 days) with their days-to-expiry; `renew` extends the term from
the current end date, optionally applies an escalation to the base amount, and
records the renewal on the agreement. `runLifecycle` is the sweep: agreements
past their end date that renew automatically are renewed (using the renewal
term), and those set to explicit renewal are archived as `expired`; both emit
`agreement.*` events through the Phase-2 workflow engine. Archiving keeps the
coverage and charges intact, so historical and profitability reporting stay
correct.

## Billing & invoicing (Phase 6)

The Billing station (`ERP.billing`) turns everything Phase 4–5 captured into
invoices and cash. It composes five tabs, each backed by functions that can also
be driven programmatically:

| Tab | Module | What it does |
| --- | --- | --- |
| Invoices | `ERP.billing` | The invoice register (number, client, period, status, total, balance) with a filter, the invoice detail modal (lines, tax, totals, payments/credits/adjustments), and the draft→approve→post→void actions |
| Billing runs | `ERP.billing` | A cycle dry-run across every active client — what *would* be invoiced, what is blocked by a readiness gate, and what was already billed — then generate the drafts |
| Payments & credits | `ERP.payments` | Record a payment, void one, issue/apply/void a credit note, and post signed adjustments or write-offs, over the client's account balance |
| Financial reports | `ERP.ar` | AR aging, revenue by client/service, billing backlog (unbilled WIP), invoice/payment summaries, with CSV download and print/PDF |
| Billing setup | `ERP.billing` | Provider-wide defaults and per-client overrides: currency, tax codes & rates, invoice cycle, payment terms, PO/reference, and CAS-safe numbering |

**Billing setup (28).** Billing configuration has a documented precedence: a
provider-wide default (a `billingSettings` record in the **provider document**)
that a client can override (a `billingProfile` record in its **company
document**). `configFor(pid, companyId)` resolves each field and reports whether
the winning value came from the provider default or the client override. Tax
codes and rates, currencies, the invoice cycle (on demand / weekly / monthly)
and numbering prefixes are all configurable; invoice numbers are allocated from
the inherited master sequence (`ERP.master.allocateNumber`), so they never
collide and are safe under concurrent writes.

**Invoice assembly (29).** `assemble(pid, companyId, opts)` builds an invoice
**purely** — it reads sources and writes nothing. It pulls, per the invoice
cycle: posted **agreement charges** (`ERP.agreements`), **approved billable
time** valued at its stamped resolved rate (`ERP.time`), **approved billable
expenses** with their markup (`ERP.expenses`), and project milestones (a seam
for Phase 7). Lines are grouped per the template and **every line carries its
source** — kind, id and a human-readable reference — so any figure on a printed
invoice can be traced back to the record that produced it. Tax is applied per
line from the resolved tax code, and subtotal/tax/total are rolled up.

**Generation runs (30).** A run has a pre-invoice review stage: `dryRun`
assembles every active client for a period and classifies each as *draft*,
*blocked*, *empty* or *existing* (already invoiced), showing the totals and
every readiness gate — `period_invoiced`, `unapproved_time`,
`unapproved_expense`, `unrated_time`, `agreement_unposted`. `generate` writes
the drafts for the ready clients without posting anything; the operator reviews
and corrects, then `approve`/`post` releases the invoice. The gate that blocks a
period already invoiced only counts **posted** invoices, so a draft or void does
not lock a period. A dry-run never writes.

**Payments, credits & adjustments (31).** `ERP.payments` records a payment
against a **posted** invoice (date, method, amount, reference) with an
idempotency key so a double-submit cannot double-count; a payment can be voided
(reversing it). Credit notes can be issued to the client's account and later
applied to an invoice, or voided. Signed adjustments and write-offs (a positive
write-off capped at the balance) are recorded with an audit trail. All of these
live in the client's company document and are mirrored into the invoice, and
every change recomputes the invoice balance and payment status through
`ERP.billing.recalc` — balance = total − credits − adjustments − write-offs −
amount paid.

**Immutability & idempotency (32).** A **posted invoice is immutable**: editing
it is refused in code (`ERP.billing.isImmutable`), and corrections must go
through a credit or adjustment. Re-running billing for a period **cannot
double-bill** — each invoice carries a `runKey` (`companyId:periodKey`) and a
posted invoice with that key blocks the run. The sources it consumed (time
entries, expenses, agreement charges) are **locked** by `markInvoiced`, so they
cannot be silently pulled into a second invoice. Every billing action writes an
audit entry and emits `invoice.*` / `payment.received` / `credit.issued` events
through the Phase-2 workflow engine.

**Financial reporting (33).** `ERP.ar` reports AR **aging** (current, 1–30,
31–60, 61–90, 90+ — bucketed by days past due from posted, unpaid invoices),
**revenue** by client and by service, the **billing backlog** / unbilled WIP
(approved time + billable expenses + unposted agreement charges), and invoice
and payment summaries. Any report exports to **CSV** (`toCsv`/`downloadCsv`)
and to a print/PDF-ready view (`printHtml`).

## Projects (Phase 7)

The Projects station (`ERP.projects`) plans and runs client engagements. It
composes five tabs, each backed by functions that can also be driven
programmatically:

| Tab | What it does |
| --- | --- |
| Projects | The project register (number, client, status, billing method, owner, dates, progress, plan value) with a client/status filter, the new/edit modal, and a drill-down detail view (phases & tasks, milestones, summary) |
| Templates | Reusable blueprints — phases, predefined tasks with owners/estimates/checklists, and milestone definitions — with a drill-down editor and one-click instantiation for a client |
| Schedule | Every project's phases and tasks in one chronological view, with owners, start/due dates, dependencies, status and overdue/blocked flags |
| Budget | Estimated vs actual hours and cost per phase and project, plan value, margin and margin %, with over-budget / trending-over warnings |
| Billing | Milestones ready to bill (by project and client), the fixed-fee auto milestone, and the released / invoiced / void ledger that feeds invoicing |

**Templates & phases (34).** A `projectTemplate` lives in the **provider
document** (`kind:"projectTemplate"`) and is a blueprint of phases, each holding
predefined tasks (name, owner role, relative due offset, estimate, checklist) and
milestone definitions. `seedTemplates` idempotently seeds three starter
blueprints; `instantiate(pid, templateId, {companyId, name, ownerId})` creates a
numbered `PRJ-####` project in the client's **company document**
(`kind:"project"`) with every phase, task and milestone copied in, ready to run.

**Tasks & scheduling (35).** A project is a tree of phases, each with tasks
(owner, start/due dates, dependencies, estimate hours, status, checklist) and
milestones. `rollup(project)` derives each phase's status and progress from its
tasks and the project's from its phases — completing every task completes the
phase, completing every phase completes the project — and surfaces overdue or
blocked work. Tasks are added/edited/reordered/completed/removed through
`addPhase`/`addTask`/`setTaskStatus`/`completeTask`/`removeTask` and checklist
items ticked with `toggleChecklist`; the Schedule tab renders the whole tree
chronologically.

**Budget, cost & profitability (36).** `estimate(project)` sums the estimated
hours and, at each owner's charge rate, the planned cost and revenue;
`actuals(project)` burdens captured **time** (at each member's `hourlyCost`) plus
**expenses** against the project, grouped by task; `budgetStatus(project)`
compares actual vs estimate (cost %, hours %, margin) and flags over-budget or
trending-over projects; `profitability()` reports margin per project and in
total. Time entries and expenses carry `projectId`/`taskId` (Phase 4), so the
ledger attributes itself to the engagement.

**Billing (37).** A project bills by **time & materials** (its approved time and
expenses flow through normal invoice assembly), **fixed fee** (an auto-generated
fee milestone created with the project), or **milestone** (milestones tied to
phases). `billableMilestones(pid, companyId, period)` is the billing seam Phase 6
assembles: a milestone becomes `ready` when its phase completes (`rollup`) or is
released manually (`releaseMilestone`), and once invoiced it is stamped
`invoiced` with its `invoiceId` (`markMilestonesInvoiced`, called by
`ERP.billing.markInvoiced`'s project branch). Voiding the invoice releases it
back to `ready`. An invoiced milestone cannot be edited, and a project with
billed milestones cannot be deleted (cancel it instead).

## Sales & CRM (Phase 8)

The Sales station (`ERP.sales`) is the growth engine that feeds the rest of the
practice. It composes four tabs, each backed by functions that can also be
driven programmatically:

| Tab | What it does |
| --- | --- |
| Pipeline | The opportunity board (a column per taxonomy stage, cards per deal) with client/owner filters, a list view, win/loss actions and a stage-history modal |
| Quotes | The quote register (number, client, title, status, total, margin, validity) with a line-item editor and a detail modal (send / accept / decline / print proposal / convert) |
| Activities & forecast | The activity log and next-step queue (open/overdue) plus the forecast by stage, by owner and by period |
| Leads | The lead register with de-duplication hints, capture/edit and conversion into a company + opportunity |

**Opportunities & pipeline (38).** An `opportunity` lives in the **client
company document** (`kind:"opportunity"`) and carries a value, an expected
close, a stage (from the taxonomy `opportunityStage` set, each with a
probability), an optional probability override, a source, an owner, notes and a
**stage-change history**. `save` records each stage move; `setStage`/`win`/`lose`
drive it explicitly and stamp a win/loss reason. `probOf`/`weightedValue` derive
the probability and the probability-weighted value, `pipeline` groups deals by
stage with per-column and overall totals, and `isClosed` follows the taxonomy's
closed flags. A stage with `closed:true` closes the deal as won (or lost for the
`lost` stage) and emits `opportunity.stage_changed`/`.won`/`.lost`.

**Quotes & proposals (39).** A `quote` lives in the client company document
(`kind:"quote"`) with line items — each with a kind (service/product/
subscription/labour), description, quantity, unit, unit cost, unit price and
discount % — plus a tax rate, terms and notes. `computeQuote` is a pure
calculation returning subtotal, discount, tax, total, cost, margin and margin %
per line and overall, so margin is always visible. A quote numbers itself
(`QTE-####`), moves `draft → sent → accepted/declined` (only an accepted quote
can convert), and `proposalHtml`/`printProposal` render a printable proposal
through the AR print frame. `convertQuote` turns an accepted quote into a
project (`ERP.projects`), an agreement (`ERP.agreements`) and/or **procurement
intents** (one per product line, queued for Phase 9's purchase orders), and
records the created ids on the quote so it cannot be converted twice. Quotes
read `catalogItem` records when a catalog exists (Phase 9) and otherwise accept
free-form lines.

**Activities & forecasting (40).** A `salesActivity` lives in the **provider
document** and attaches to a company, an opportunity and/or a lead; it carries a
type (call/meeting/email/demo/follow-up/task/note), subject, notes, an optional
due date and a done flag. `logActivity`/`completeActivity`/`nextSteps` give the
next-step queue and overdue tracking, and `forecast` rolls opportunities up by
**stage, owner and period** (month or quarter of the expected close) with open,
weighted, won and lost values and a win rate.

**Lead capture & conversion (41).** A `lead` lives in the provider document with
contact details, a source, a status and an append-only **history**. `dedupe`
matches a lead against existing companies, contacts and other leads on
normalised name, email, phone and website domain, so duplicates surface before
they are created. `convertLead` creates (or attaches) a company, optionally a
primary contact, and an opportunity whose `origin` preserves the lead and its
history; the lead is kept as `converted` with links to both, and its activities
are re-pointed at the new opportunity.

## Products & procurement (Phase 9)

Two stations share the supply engine: the **Products** station (`ERP.catalog`)
maintains what the practice sells, and the **Procurement** station
(`ERP.procurement` over `ERP.inventory`) buys and receives it. Both can be
driven programmatically.

### Products — `ERP.catalog`

| Tab | What it does |
| --- | --- |
| Catalog | The product & service register (SKU, class/category, cost, sell, margin, unit, vendor, tax, tracked flag) with add/edit |
| Pricing rules | The rule list (scope, mode, value, rounding, priority, effective dates) with add/edit |
| Client overrides | Per-client fixed prices or discounts on a specific item |
| Margin rules | The margin/markup floors and the recorded-override log |

**Catalog & pricing (42).** A `catalogItem` carries a SKU, a product class and
category (taxonomy), a unit, a cost and sell price, tax, an optional default
vendor, and `trackInventory`/`reorderPoint` flags. Pricing is evaluated by
specificity: a `priceRule`'s scope may be **global**, per-**vendor**,
per-**class**, per-**category** or per-**item**, and it computes either a
**markup** on cost, a target **margin** %, a **percent** off sell or a **fixed**
price, with optional rounding, a priority tie-break and effective dates; a
`priceOverride` then pins a client's price for one item (fixed price or
discount). `resolvePrice(pid, {itemId, companyId, qty, date})` returns the
winning price **and** how it was reached — a `source` label and the full
considered `chain` of rules (which applied and which did not), with the resulting
margin/markup — so a quote, ticket, project or invoice can show exactly where a
price came from. `catalogSettings` carries the margin/markup floors; `ensure`
seeds a starter catalog (items + example rules + settings).

### Procurement — `ERP.procurement` + `ERP.inventory`

The Procurement station composes five tabs:

| Tab | Module | What it does |
| --- | --- | --- |
| Purchase orders | `ERP.procurement` | The PO register (number, vendor, client, status, total, expected/received dates), the line editor and the status actions |
| Vendors | `ERP.procurement` | The vendor register (contact, terms, lead time, ordered value) |
| Receiving & drop-ship | `ERP.inventory` | The receipt register, the receive form (full / partial / drop-ship) and the discrepancy queue |
| Inventory | `ERP.inventory` | Stock on hand and value per warehouse/item, warehouse management, and the adjust/transfer actions |
| Approvals & rules | `ERP.procurement` | The approval threshold + margin/markup floors, the approval queue and the recorded-override log |

**Vendors & purchase orders (43).** A `purchaseOrder` lives in the **provider
document** (`kind:"purchaseOrder"`) and carries a vendor, lines
(item/description, qty, unit cost, tax), computed totals, a status, links to the
client / opportunity / project / ticket that needs the goods, and
expected-vs-received dates (the expected date derives from the vendor's lead
time). The status flow is `draft → pending_approval → approved → ordered →
partially_received → received → closed/cancelled`. `fromIntents` turns a
converted quote's pending `procurementIntent`s into a PO and marks them ordered,
and `applyReceipt` advances the PO as stock lands. Vendors are provider records
carrying contact details, terms and a lead time.

**Receiving, drop-ship & inventory (44).** Stock is an **append-only
`stockMove` ledger** in the provider document — on-hand is the sum of the deltas
— so the quantity is always reconstructible and auditable. `receive` records a
receipt against a PO (full, partial, or **drop-ship**, which moves no stock),
tracks the line variance and files any shortage/overage in a **discrepancy /
reconcile queue**; `adjust`/`transfer`/`issue` write further moves; `levels`,
`onHand`, `lowStock` (against each item's reorder point) and `valuation` read the
ledger back. Warehouses are provider records (one is the default); `ensure` seeds
a main warehouse.

**Approvals & margin rules (45).** `procurementSettings` holds a PO **approval
threshold**; a PO at or above it must pass `submit → approve` before it can be
ordered, and `approvalQueue` lists what is waiting. The catalog settings hold a
**quote margin floor** and a **PO markup floor**; `checkQuoteFloors` /
`checkPoFloors` refuse to send/accept a quote or submit a PO below the floor
unless the operator supplies an explicit reason — in which case a
`marginOverride` record (reference, actual %, floor, reason, who, when) is
written to the **recorded-override log**. The quote gate is wired into
`ERP.sales.setQuoteStatus`, so `sent`/`accepted` is where the floor is enforced,
and `recordMarginOverride` logs an approval-time override.

## Knowledge, configurations & client portal (Phase 10)

Three stations and one engine land together here: the **Knowledge** station
(`ERP.knowledge`) hosts the knowledge base, configuration records, monitoring
and approvals; the **Client Portal** station (`ERP.portal`) is the client-facing
self-service view; and `ERP.approvals` is the approval engine the rest of the
app raises requests into.

### Knowledge — `ERP.kb` (Task 46)

A `kbCategory` files a **versioned** `kbArticle` (number `KB-####`, slug, tags,
summary, body). An article moves `draft → published → archived` and carries a
**visibility** — `internal` or `public` — so only published *and* public
articles reach the portal. Editing the content (title/summary/body/category/
tags/visibility) snapshots the previous copy into `versions` and bumps the
`version`; a no-op save does not. `versionList`/`restoreVersion` restore an
earlier copy (recording a new version, so history is never rewritten). Articles
track `views`/`helpful`/`notHelpful`.

The knowledge base plugs into the service desk: `suggestForTicket` scores
published articles against a ticket's summary/detail/type/subtype/item/tags
(title hits weigh more; shared tags add more), `linkText` renders an article as
a link to paste into a reply, and `fromTicket` drafts an article from a resolved
ticket (with its detail under *Issue*, a *Resolution* section and a back-link to
the ticket). The ticket detail modal gained a **Knowledge** tab that shows the
suggestions and offers *Use in reply* / *Draft an article*.

### Configuration & asset records — `ERP.configurations` (Task 47)

Asset/configuration records live in the **client company document**
(`kind:"configuration"`) so they travel with the client — the same place
`ERP.agreements.coverageWarnings` already looks to decide whether a covered
device exists. A record carries its type, make/model, serial, asset tag,
hostname/IP/MAC/OS, location, purchase/warranty/support dates, a status, notes
and relationships.

Each field has an **owner**: `C.DEFAULT_OWNERSHIP` marks the descriptive fields
**docs-owned** (the MSP documentation system wins) and the operational fields
(status, notes, relationships, site/contact) **psa-owned**. `syncFromDocs`
applies an external feed: it matches on externalId / serial / asset tag / name,
**creates** unknown devices, applies only docs-owned changed fields, and files
any changed psa-owned field as **drift** (local vs external) rather than
silently overwriting it — returning a created/updated/drifted/unchanged report.
`drift` lists the queue and `resolveDrift(field, "local"|"external")` keeps the
psa value or adopts the docs one. `setOwnership` reassigns a field's owner;
`sampleFeed` is a stand-in connector, and `expiringWarranties` surfaces
warranties about to lapse. Drift and save emit
`configuration.created/updated/drift`.

### RMM / monitoring — `ERP.rmm` (Task 48)

`rmmSettings` controls the feed (enabled, dedupe window, auto-create,
auto-resolve, ticket source). `ingest` normalises each event, **de-duplicates**
it against an open alert (by externalId, or device+type within the window,
counting recurrences and keeping the latest message), matches the first ordered
`rmmRule` (by severity, alert type or device type) and, when the rule says so
(or severity isn't `info`), **auto-creates a ticket** through `ERP.tickets.save`
(source `monitoring`, severity-derived priority, monitor tags). `locateDevice`
ties the alert to its configuration record by externalId, serial, hostname or
device name. A `cleared`/`resolved` event clears the alert and **auto-resolves**
the ticket (moving it to a closed status and leaving a customer-visible note),
unless the alert was flagged no-auto-resolve. `acknowledge`, `ignore` (with a
reason) and `stats` (open/critical/ticketed/devices) round it out; alerts emit
`alert.received`/`repeated`/`ticket_created`/`resolved`.

### Approval workflows — `ERP.approvals` (Task 50)

An `approvalRequest` (number `APR-####`) names what is being approved (a quote,
ticket, change request, purchase order or invoice), its amount and its release
action. `route` sends **client** references (quote/ticket/change request) to the
client's portal contact and **internal** ones (PO/invoice) to the client's
account manager (else a manager/owner). `request` stamps a due date and an audit
trail; `decide` (by an internal approver, or `byType:"client"` from the portal)
records who/when/why and then runs the **release action** — accept/send a quote,
approve a PO, post an invoice, or note a ticket — with a matching reject action
(POs go back to draft). `sweep` expires overdue requests and raises reminders;
`gateFor`/`canProceed` tell a caller whether a reference is still blocked.
Convenience creators (`forQuote`/`forPO`/`forInvoice`/`forTicket`) are wired in:
`ERP.procurement.submit` raises a PO approval when a PO needs one, and
`ERP.billing.post` refuses with `awaiting_approval` until the invoice's request
is approved (the release action posts it with `{viaApproval:true}`). Requests
emit `approval.requested/approved/rejected/expired/cancelled/reminder`.

### Client portal — `ERP.portal` (Task 49)

Signing in (`enter`) as a company **contact** creates a session
(`psa.portal.session`) scoped strictly to that contact's company, and
`requireSession` gates every read. A client can raise a ticket
(`submitTicket` → a `source:"portal"` ticket plus a customer-visible note), read
**only customer-visible** notes on their own tickets (`ticket`), add a comment,
read published+public articles only, see **posted** invoices only (printable
through the AR print frame), and approve/reject pending **client** approvals
(`decide` delegates to `ERP.approvals.decide` with `byType:"client"`). Attempts
to reach another company's records return nothing. The station renders a
sign-in screen (owner/manager only — `portal.manage`) and a four-tab portal
(Support, Knowledge, Invoices, Approvals).

## Reporting & analytics (Phase 11)

The Reports station (`ERP.reports.render`) is the insight workspace. It composes
four tabs, each backed by a module that can also be driven programmatically:

| Tab | Module | What it does |
| --- | --- | --- |
| Dashboards | `ERP.dashboards` | Live KPIs (SLA compliance, backlog/aging, utilisation, agreement margin, billing backlog, revenue trend) with SVG charts and click-through drill-down |
| Report builder | `ERP.reports` | Pick a source, add filters, group and aggregate, chart it, save it as a named definition, and export to CSV |
| Scheduled delivery | `ERP.reports` | Cadences (daily/weekly/monthly at an hour) over a saved report, with a due-sweep that produces deliveries |
| BI export | `ERP.bi` | A schema-stable fact/dimension extract through the shared envelope, previewed, downloadable and publishable |

**The report model (51).** A report is a small JSON definition, not code: a
`source`, a list of `filters` (`{field, op, value}`), a `groupBy`, a list of
`metrics` (`{agg, field}`), presentation (`sort`/`desc`/`limit`/`viz`) and — for
flat reports — the chosen `columns`. Thirteen **source adapters** each flatten
one entity into typed rows and declare their columns, so the builder offers the
right fields, type-appropriate operators (`eq`, `ne`, `contains`, `in`, `gt`,
`gte`, `lt`, `lte`, `between`, `truthy`, `falsy`, `is_empty`) and numeric
metrics without any per-source UI. `R.run(pid, def)` applies filters, sorts,
groups and reduces (count / countDistinct / sum / avg / min / max), returning the
columns, the rows (or groups), a `matched` count and an optional chart series.
`R.saveDef` validates and stores a `reportDef` in the provider document; a set of
starter reports is seeded idempotently on first visit.

**Scheduling (51).** A `reportSchedule` names a report, a cadence (daily /
weekly / monthly, at an hour, on a weekday or day-of-month), recipients and a
format. `nextRunAt` computes the next due instant; `sweep` delivers every
schedule whose run has passed, producing a `reportDelivery` — the run's CSV plus
a summary — and advances the schedule (so a second sweep at the same instant is
a no-op). Nothing is emailed by the platform itself: a delivery is the durable
payload a Phase-12 connector (or a human) picks up, and `publishDelivery` can
push it to a long-lived URL through `upload-plugin`.

**Dashboards (52).** Every figure is computed live from the records the other
modules own — no stored rollups — by a named method so it is testable and
drivable: `sla` (response/resolution targets met vs applicable, open breach and
at-risk work, averages, split by board and priority), `backlog` (open tickets
aged into current / 1-30 / 31-60 / 61-90 / 90+ by board, priority and owner),
`utilization` (each technician's captured hours against their business-hours
capacity, plus billable hours and value), `agreements` (the Phase-5 profitability
engine), `billing` (the Phase-6 backlog + AR aging + summary) and `revenueTrend`
(invoiced vs received by month). `overview` assembles the KPI set and `drill`
returns the records behind any figure, so a dashboard row opens its detail.

**BI export (53).** `ERP.bi` projects the whole practice into a clean,
fact/dimension shape so the separate BI tool never has to understand psa-u's
record layout. `SCHEMA` pins the contract (a `SCHEMA_VERSION` plus every
dimension and typed fact column): conformed dimensions (`company`, `member`,
`board`, `status`, `priority`, `work_type`, `month`) keyed by stable `*_key`
values, and facts (`ticket`, `time`, `expense`, `invoice`, `payment`,
`opportunity`, `agreement`, `purchase_order`) that reference them by key. An
`extract` is wrapped in the pipeline's **shared envelope**
(`{schema:"psa-envelope", schemaVersion, kind, version, producer, generatedAt,
provider, counts, dimensions, facts}`) — `ERP.envelope()` is exported for any
module to use. `toCsv` flattens one fact/dimension using the documented column
order, `downloadJson` exports the whole extract, and `publish` uploads it and
records a `biHandoff`. Nothing here writes back — the extract is a one-way
projection.

## Integrations, API & quality (Phase 12)

Phase 12 makes PSA-U a good citizen of the wider toolchain and gives the whole
system a way to prove itself. It surfaces through three new **Admin** tabs —
Integrations, API & webhooks and Data integrity — each backed by a module that
can also be driven programmatically.

| Tab | Module | What it does |
| --- | --- | --- |
| Integrations | `ERP.integrations` | Connector cards (email, accounting, calendar, identity/SSO, RMM, documentation) with direction, ownership rules, Pull/Push, enable/disable, a run-all and a sync log |
| API & webhooks | `ERP.api` (`ERP.pipeline`) | The versioned API surface, webhook subscriptions with HMAC-signed deliveries, and the shared event-bus log with an envelope viewer |
| Data integrity | `ERP.integrity` | A twelve-check audit of the accumulated records, with a severity filter, the offending records and a re-run |

**The connector framework (54).** A connector is *declared*, not hard-coded:
each of the six connectors has a stable `id`, a `label`/`desc`, a `direction`
(`pull`, `push` or `both`) and an **ownership map** naming, per field, whether
PSA-U or the external system is the system of record (`psa` or `external`).
Ownership matters because Phase 10's configuration sync and this framework's
identity/email connectors must never silently overwrite a field the other side
owns: `applyOwnership` only copies external-owned fields, leaving PSA-owned ones
alone. Per-provider state lives in an `integration` record (enabled, chosen
direction, config, incremental `cursor`, last run/status); each run is an
`integrationRun` (connector, direction, status, per-kind counts, attempts,
error, times). The runner wraps a connector's driver (`DRIVERS` /
`registerDriver`) in `withRetry` (bounded attempts with backoff), so a flaky
remote is retried and then recorded as failed rather than throwing. `runAll`
sweeps every enabled connector; `syncLog`/`clearLog` expose and prune the run
history. `outboundEmail` records from Phase 2 are read back as the email
connector's outbound queue, and the RMM and documentation connectors reuse the
Phase-10 modules' feeds, so the framework is a thin, honest façade over real
work rather than a stub.

**The API, webhooks & pipeline bus (55).** `ERP.api` declares a versioned
surface (`API_VERSION`, each endpoint with a method, path, required permission
and description) and a `call(name, args)` dispatcher that authorises against
`ERP.security` before invoking the owning module — so an integration or another
perchance tool can act on PSA-U without bypassing permissions. A `webhook`
subscription names a URL and a list of events plus a generated secret; when a
matching event fires, `deliver` signs the envelope with HMAC-SHA256
(`X-PSA-Signature`/`X-PSA-Timestamp`) and POSTs it, retrying on failure and
recording a `webhookDelivery`. The **pipeline bus** is the shared vocabulary:
`ERP.pipeline.publish(event, ctx)` wraps an event in the common `ERP.envelope()`
and appends it to a bounded `pipelineEvent` log, and `consume(envelope)` routes
an inbound envelope to a registered `HANDLERS` entry — so other tools in the
small-business pipeline can subscribe to PSA-U events (ticket created/closed,
agreement renewed, invoice posted, SLA breached) and PSA-U can accept their
commands. `ERP.workflow.emit` publishes through the same bus as rules run, and
`ERP.tickets` emits `ticket.closed`/`ticket.reopened` across the status
boundary, so the bus reflects real domain events.

**The data-integrity linter (56).** A PSA accumulates quiet rot — tickets that
were never assigned or never closed, agreement coverage lines pointing at
devices that no longer exist, billable time that never reached an invoice,
posted invoices with no source lines, SLA policies referencing deleted
statuses, companies with no billing terms, orphaned time/expenses and negative
balances. `ERP.integrity.lint(pid)` runs twelve named checks, each returning the
offending records (with their ids so they can be opened), and `summary` reduces
them to counts by severity. The Data-integrity tab renders the findings with a
severity filter and a re-run; nothing is auto-fixed, because the point is to
*witness* the drift and act deliberately.

**Fixtures & the loop suite (57).** The Phase-12 test groups seed a throwaway
service provider — companies, boards, members, an agreement and a billing cycle
— and drive the whole operational loop end to end (ticket → time → agreement →
invoice → payment), then assert the invariants a PSA must never break: no
double-billing, posted invoices immutable, source time locked to its invoice,
security scopes enforced, and every export parses. They run inside the isolated
in-memory backend, so no live data is touched.

**The playbook (58).** This document plus `src/SPEC.md` and the roadmap block in
`main.pjs` are the playbook: the architecture and module map above, the security
matrix, the data model, the billing and SLA rules in their phase sections, and
the "Adding a station" checklist below. To extend the system:

- **A new module** — register it in `psa.modules.js`, build `ERP.<id>` in a new
  `src/psa.<id>.js`, add the `<script>` after `psa.modules.js`, add its
  permissions to `psa.security.js`, declare any new document kinds in
  `psa.tenancy.js`, and add a test group.
- **A new connector** — add a def to `ERP.integrations.CONNECTORS` (direction +
  ownership) and a driver via `registerDriver`; no UI change is needed.
- **A new API endpoint** — add it to `ERP.api.ENDPOINTS` with a permission, and
  a `HANDLERS` entry to consume the matching inbound envelope.
- **A new integrity check** — add it to `ERP.integrity.CHECKS` returning the
  offending records; the tab and summary pick it up automatically.
- **A new report** — it is data, not code: save a `reportDef` (or seed one) and
  the builder/scheduler/dashboards work with it.

`main.pjs` is the pjs config file. `config.branding/theme/colors/product/…` is
legacy marketing config (mostly unused by the app shell). The keys the app reads:

```pjs
psa
  version = 0.1.0
  roleDefault = owner          // owner | manager | staff (until the hub authorises)
  defaultCurrency = USD        // applied to a new service provider
  defaultTimezone = UTC
  fiscalYearStartMonth = 1     // drives fiscal-year document splits
```

## Multi-user & realtime collaboration (Phase 13)

Phase 13 makes PSA-U genuinely multi-user. It is **optional** — the app is fully
functional single-user — but when the companion hub is reachable the client
hands authority to it and participates in live collaboration.

**Role & access model (59).** The hub models *functional roles* — administrator,
dispatcher, account_manager, finance, technician — as sets of **capability
bits** (`view`, `work`, `dispatch`, `sales`, `supply`, `finance`, `manage`).
A permission maps to a required capability (`requiredCap`), to a system-role
floor (owner / manager / staff, mirroring `psa.security.js`), and, for money,
to the financial-visibility flag. Each server user record also carries
**company** and **board** scope bitfields (128 bits each; all-zero = all). An
action is authorised by `authorizePerm` against **all four** — system role,
capability, scope and financial flag — so hiding a button is never the boundary.
`ERP.collab` mirrors the same model on the client for instant preview and for
the offline case, but the mirror is never the authority.

**Realtime hub & collaborative dispatch (60).** The client connects with a
stable identity (`psa.team.userId`), sends `hello`, and receives its role,
capabilities, scopes and financial flag plus the user list. Presence (`pres`)
tracks who is online; `focus` broadcasts which record someone is editing, and
the dispatch board and ticket detail render an **editor chip** naming them.
Document changes are announced (`announce` → `chg`) on two topics — a global
`psa:chg` for all-company watchers and per-company `psa:co:<id>` for scoped
users (`watch`) — so other sessions re-sync within seconds through the same
idempotent, version-checked store. If the hub is unreachable, polling
(`pollOnce`/`startPolling`, on by default) refreshes the active station on a
timer, and the status line says so; the app never blocks on the socket.

**Multi-user audit & rate control (61).** The hub rate-limits connections and
key actions per-connection *and* per coarse network signal, so a noisy or
abusive client is throttled without harming others. Every remote change flows
through the version-checked document layer, and sensitive actions are **signed
into the hub's durable audit ring** with the true actor (user id, system role,
functional role, flags, permission, target). The document *payloads* continue
to live in the client's upload-plugin editable files; the hub indexes versions,
signs audit entries and relays change/editing presence.

**Durable state.** The server block in `index.html` stores a versioned binary
state (v2): 256 user slots × 128 bytes (id, name, system role, functional role,
flags, last-seen, company & board scopes) followed by the audit-ring header and
96-byte entries. A v1 hub migrates on boot, preserving users, names, roles and
the audit ring. The whole block is public source; only the SHA-256 hash of the
first-time owner password lives in it (never the plaintext), and anything
unrecognised is logged-only rather than silently dropped, so the audit ring has
no gaps.

**Admin → Collaboration.** The tab shows hub status (with Reconnect / Stop
polling / Auto-refresh / Poll now), your identity and capabilities, who else is
online, the live change stream, connection & rate-control stats, the user
registry (with the **Edit access** modal for role, functional role, financials
and company/board scopes), and the server audit ring.

## Workflow

1. The roadmap checklist in `main.pjs`'s top comment block is the scope/order
   source of truth. Only the first uncompleted task runs at a time.
2. Implement the task, add validation checks to `src/psa.tests.js` (or a new
   `src/*.tests.js`), flip its `[ ]` to `[x]`, run `await PSATest()`, stop.
3. Keep this file and `src/SPEC.md` current in the same change.

## Adding a station

1. Add its definition to `src/psa.modules.js` via `ERP.registerModule({id,
   label, group, icon, roles, desc, render})`; it appears in the nav and router
   automatically. `group` is an `ERP.groups` key; omit it for top-level.
2. Build the controller as `ERP.<id> = { render(ctx) {…} }` in a new
   `src/psa.<id>.js`, or start with `planned({icon,title,message,phase})`.
3. Add the `<script src="src/psa.<id>.js">` tag to `index.html` **after**
   `psa.modules.js` and the store.
4. If it owns a document, declare `doc: {name, splitByYear}` on the module and
   register it in `psa.tenancy.js`/the store as appropriate. Document names are
   `psa-v1-<name>`.
5. Add checks to the test suite.

## Reference modules — HISTORICAL (removed)

> **HISTORICAL.** Before the cleanup these inherited Business ERP controllers
> were kept **on disk but not loaded** by `index.html`, as reference
> implementations. They have since been deleted because nothing loaded or
> referenced them: `erp.modules.js`, `erp.crm.js`, `erp.sales.js`, `erp.purch.js`,
> `erp.projects.js`, `erp.finance.js`, `erp.reporting.js`, `erp.quality.js`, the
> legacy `erp.tests.js` suite, and `template.js` (the business-template marketing
> renderer).
>
> Their live replacements are the PSA-U `psa.*` controllers. The platform layer
> they depended on (`erp.js`, `erp.store.js`, `erp.sync.js`, `erp.backup.js`,
> `erp.master.js`, `erp.team.js`, `erp.ui.js`) is unchanged and still loaded, and
> `template.css` is still loaded (it supplies the base design tokens). The old
> controllers can be recovered from the `business-erp` generator they were forked
> from.
