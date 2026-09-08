# Business ERP

A small-business ERP on Perchance — CRM & opportunities, sales (quotes → orders →
invoices), purchasing & inventory, projects & time, and double-entry bookkeeping,
all sharing one master-data core (parties, catalog, chart of accounts).

Generator: `business-erp` (https://perchance.org/business-erp). Built on the
`business-template` generator (config-driven marketing page) — the config list in
`main.pjs` is now the ERP's business-profile/branding data, and the page is the
ERP application shell.

## Build state

Task-by-task checklist lives in the comment block at the top of `main.pjs`
(Phases 1–10). Workflow: implement the first uncompleted task, add validation
tests, flip it to `[x]`, stop for review.

## Architecture

- `main.pjs` — pjs config lists (branding, theme, colors, product, `erp` app
  settings) + plugin imports (`super-fetch-plugin`, `data-visualization-plugin`,
  `upload-plugin`, `ai-text-plugin`).
- `index.html` — static ERP shell markup (sidebar, topbar, view container).
- `src/erp.js` — shell framework: module registry (`ERP.registerModule`), hash
  router (`#/moduleId`), role model (owner/manager/staff, `ERP.role`), state
  renderers (`ERP.states.loading/empty/error`), theme, responsive drawer.
- `src/erp.modules.js` — the 8 module definitions (Dashboard, CRM, Sales,
  Purchasing, Inventory, Projects, Finance, Reports). New modules register here
  via `ERP.registerModule({id, label, group, icon, roles, render})`.
- `src/erp.store.js` — the canonical document store (`window.ERP.store`):
  versioned `erp-doc` envelopes, one document per module (split by fiscal year
  for inventory & finance), fast localStorage cache, cached editable edit keys,
  monotone per-doc revision counter, 4 MiB write ceiling, throttled background
  refresh, dirty-flush retry, and a debounced store index. See "Task 2" below.
- `src/erp.sync.js` — Sync Center UI controller (Task 3): topbar sync button +
  conflict badge, attention banner, conflict modal (keep-mine / keep-theirs /
  merge, per-field decision picker), auto-commit on last field choice.
- `src/erp.ui.js` — shared UI toolkit (`ERP.ui`): `esc`, formatting
  (`fmt/money/pct/qty/date/dateTime`), `badge`/`statusBadge`, `btn`, `table`,
  `card`/`statCard`, `grid`, `tabs`, `modal`/`confirm`, form controls
  (`field/text/number/select/textarea/dateInput/check/radioGroup/form`),
  delegated `bind`, `pageHead`, `summary`, `alert`, `loading`,
  `stateEmpty/stateError`. Every module controller builds its UI through it.
- `src/erp.master.js` — master data service (Tasks 6–9): party directory
  (CRUD + merge-rewrites-everywhere), product catalog, chart of accounts, tax
  rates, posting defaults, business profile + document numbering
  (`master.allocateNumber(type)` → e.g. `INV-0001`), seeded idempotently at
  boot. Exposes `ERP.master.*` and `ERP.MASTER` doc ids; the chart/taxes/
  settings/parties/catalog/defaults/audit/archive UIs live in the visible
  modules (CRM parties tab, Finance chart/tax/settings tabs, Reports audit).
- `src/erp.backup.js` — backup & restore + capacity & archival (Tasks 4–5):
  `ERP.backup.backupBundle/downloadBackup/publishBackup/publishedBackup/
  validateBundle/restoreBundle`, `capacity()`, `archiveDoc/archivedDocs/
  viewArchived/restoreArchive`, and `renderPanel` (hosted under Reports).
- `src/erp.crm.js` — CRM controller (`ERP.crm`, Tasks 10–13): party directory
  tab (typed customers/suppliers with contacts/terms/credit/merge), CRM
  records tab (source/owner/status/tags + activity timeline + reminders),
  pipeline tab (board + list, filters, per-party history, won→project), and a
  ports tab (idea-incubator bundle import, project-seeds export). Renders
  into the CRM module view; data lives in the `crm` doc.
- `src/erp.sales.js` — sales controller (`ERP.sales`, Tasks 14–18): catalog
  tab, quotes tab (line editor, discounting, auto-tax, draft→sent→
  accepted/declined, accept→order), orders tab (per-line fulfillment,
  confirm→stock check→backorder→shortfall PO, ship/deliver/invoice), invoices
  tab (due dates from payment terms, posts to ledger when finance lands) and
  credit notes tab (reason-required, partial/full credit, ledger reversal).
  Data lives in the `sales` doc.
- `src/erp.reporting.js` — dashboard + reports & data utilities (Tasks 33–36):
  `ERP.dashboard.kpis()` + `renderPanel` (KPI grid, alerts, top customers,
  recent activity; each card deep-links to its source module tab), the report
  library (`ERP.reports`, 8 seeded definitions; `runReport` → columns/rows/
  summary; CSV export + print via `#erpPrintArea`), guided CSV import
  (`prepareImport` → preview with per-row errors → `applyImport` for parties,
  catalog, stock counts, opening balances) and the read-only searchable audit
  log tab plus a hosted backup/restore tab (`ERP.backup.renderPanel`).
- `src/erp.quality.js` — system health + quality + error copy (Tasks 37–39):
  `ERP.quality`. `Q.invariants()` runs the seven accounting invariant checks
  (every journal balances; trial balance ties; AR/AP tie to invoice/bill
  states; inventory value ties to the movement log; cash ties to the bank
  register; balance-sheet identity A = L + E). The finance mutators are
  wrapped so every finance-affecting action schedules a debounced re-check,
  surfaced as the topbar health dot (`#healthDot`) and the Reports → System
  health tab (`Q.renderHealth`). `Q.friendlyError(e)` maps every failure mode
  (document too large, quota, lost edit key, offline divergence, schema
  mismatch, unbalanced entry, storage unavailable) to plain-language copy with
  the exact next step, and `Q.guide(checkKey)` gives per-check recovery
  guidance. `Q.FIXTURES` (Task 38) provides valid fixture documents for every
  module, older-schema bundles, malformed payloads, and a
  `setup()` + full quote → order → delivery → invoice → payment `chain()`.
- `src/erp.tests.js` — validation suites; run with `await window.ERPTest()`
  (Task 1), `await window.ERPStoreTest()` (Task 2), `await window.ERPSyncTest()`
  (Task 3), `await window.ERPBackupTest()` (Tasks 4–5),
  `await window.ERPMasterTest()` (Tasks 6–9), `await window.ERPCrmTest()`
  (Tasks 10–13), `await window.ERPSalesTest()` (Tasks 14–18),
  `await window.ERPPurchTest()` (Tasks 19–23), `await window.ERPProjectsTest()`
  (Tasks 24–27), `await window.ERPFinanceTest()` (Tasks 28–32),
  `await window.ERPReportTest()` (Tasks 33–36) and `await window.ERPQualityTest()`
  (Tasks 37–39, 71 checks — invariant checks, unbalanced-entry detection +
  recovery, auto re-check, error copy, fixtures, backup/restore, sync conflict,
  system-health UI) in the live page.
- `src/template.css` — base design tokens + shared components (from
  business-template).
- `src/erp.css` — shell styles (sidebar, topbar, states, KPI cards, responsive).
- `src/template.js` — the marketing-page renderer from business-template,
  currently NOT loaded by index.html (kept for reference; its theme/panel
  utilities were folded into `src/erp.js`).

## Task 1 (done) — module shell & navigation

- Frame: header + side nav listing all 8 modules, grouped Operations / Finance.
- Role-aware visibility: `roles: []` = every role; finance/reports are
  `["owner","manager"]`. Role is a persisted local demo setting (topbar
  "Acting as") until server-authorised roles arrive in Phase 10; route guards
  redirect rather than just hide.
- Consistent states: `ERP.states.loading` (spinner), `empty` (icon + message +
  phase note + optional action), `error` (icon + message + retry) used by every
  module and the unknown-route 404 path.
- Responsive: fixed sidebar ≥1024px; off-canvas drawer + overlay <1024px.

## Task 3 (done) — sync, conflict & concurrency handling- **Sync model**: every document keeps a local *base watermark* — the exact
  canonical revision (`rev`, `updatedAt`, `updatedBy`) this device last read
  or wrote. Writes are compare-and-set: before overwriting a doc, the store
  reads the canonical revision and compares it to the base; if the canonical
  moved on (another device wrote while this one was offline), the write is
  refused with `{error:"conflict"}` rather than silently clobbering. The
  conflicted doc is parked (never auto-dropped) in a durable conflicts list
  (`LS.conflicts`) and surfaced in the UI.
- **Sync Center** (`src/erp.sync.js` + `#syncBtn`/`#syncBadge`/`#syncBanner`/
  `#syncModal` in index.html): topbar button (red badge = unresolved conflict
  count, spins while syncing), attention banner under the topbar while any
  conflict is open, and a modal listing conflict cards — human doc name,
  base/canonical revs, record counts — with three actions per conflict:
  *Keep mine*, *Keep theirs*, *Merge changes*. Sync runs at boot, on "Sync
  now", and every 60 s. The modal is a body-level sibling of `#app`, so
  full-page screenshots must capture `document.documentElement`, not `#app`.
- **3-way merge** (`threeWayMerge`): merges at *record* level using base =
  this device's last-known revision. Records changed on only one side are
  auto-taken; records changed on both sides (or added on both) surface as
  per-field conflicts needing a decision. Merging never drops a record that
  either side had. `resolveConflict(conflictId, "keep_mine"|"keep_theirs"|
  "merge")` commits the resolution; `merge` auto-commits when unambiguous,
  otherwise enters `needs_decisions` and each field is settled via
  `resolveFieldConflict(conflictId, key, which)`. The UI's field picker
  (My value / Their value chips) auto-commits once the last field is chosen.
- **Store API added**: `sync`/`syncDoc` (startup reconcile + manual),
  `conflicts`, `conflictFor`, `resolveConflict`, `resolveFieldConflict`,
  `setSyncListener`, `humanDocName`, `cachedDoc`, `pendingMerge`,
  `resetLocal`/`resetAllLocal` now also clear base/merge/conflicts state.
- **Known edges** (documented, not bugs): the editable layer's ~10 s read lag
  can produce *equal-rev, different-content* conflicts — surfaced as
  conflicts, never silent loss. Two devices writing within the lag window get
  a merge whose ancestor may be this device's own last write (slightly
  imperfect 3-way base, accepted trade-off). `flushDirty` skips conflicted
  docs; the dirty doc stays cached until resolved.
- **Tests**: `await window.ERPSyncTest()` (20 checks) in `src/erp.tests.js`,
  run against an in-memory fake backend (`makeServer()`) simulating two
  devices — avoids the editable layer's read lag entirely. Covers fast
  forward, offline-edit-then-push on reconnect, conflict-on-write refusal,
  conflict persistence, keep-mine/keep-theirs, unambiguous auto-merge, true
  field conflict → `needs_decisions` → per-field resolution, record-adds
  merge, `humanDocName`, and the sync report shape.

## Task 2 (done) — canonical document store

- Backend: `root.uploadPlugin.editable`, namespaced `erp-v1-<doc>[-<year>]`
  under the generator's own editable namespace, so records survive reloads and
  move across devices. Documents are versioned `erp-doc` envelopes
  (`schema`, `schemaVersion`, `doc`, `year`, `rev`, `updatedAt`, `updatedBy`,
  `records`).
- One document per data module, declared as `doc: {name, splitByYear}` on the
  module definition (`src/erp.modules.js`). Inventory & finance split by fiscal
  year (`splitByYear: true`), so growing documents stay under the ceiling;
  the rest stay in a single doc. `saveDoc`/`loadDoc` handle the split:
  `loadDoc(m, {year})` for one year, `{all:true}` merges every year in the
  index.
- Fast local cache (localStorage) serves reads instantly; the canonical copy
  is only written when something changes. Cached editable edit keys mean
  rewrites never lose the right to edit. `rev` is bumped from the newest
  revision this device has seen (cache, else canonical on a cold device), so a
  fresh device can't blindly overwrite another device's newer doc.
- Write ceiling `maxDocBytes` (4 MiB) — oversized writes are refused with
  `document_too_large` (message suggests splitting/archiving). Identical
  re-saves are idempotent no-ops. Failed/superseded canonical writes are
  retried by `flushDirty` from the local cache.
- Index (`erp-v1-index`) records every written document (bytes, recordCount,
  year, rev) — updated locally on write, synced to canonical debounced 600 ms.
- Gotcha: the editable layer's reads lag a write by ~10 s, so the tests assert
  index state from the synchronous local copy, not a force-refreshed
  canonical read. Tests use `erp-v1-test-*` docs + throwaway modules and clean
  local state in `finally`; `useBackend(null)` restores the real editable layer.
  API on `window.ERP.store`: `loadDoc/saveDoc`, `get/set`, `getIndex`,
  `refreshIndex`, `status`, `docName/docConfig/declaredDocs`, `fiscalYearOf`,
  `currentFiscalYear`, `useBackend`, `resetLocal/resetAllLocal`,
  `canonicalAvailable`, `fmtBytes`.

## Task 4+5 (done) — backup/restore + capacity & archival

- `ERP.backup.backupBundle()` collects every owned document (index + declared
  docs, byte-complete `erp-doc` envelopes) into an `erp-backup` bundle and
  never includes the backup doc itself. `downloadBackup()` saves it as a JSON
  file. `publishBackup()` force-writes the same bundle to the ERP's own
  namespace (`erp-v1-backup`); re-publishing with identical document content
  is a true no-op (exportedAt ignored). `publishedBackup()` reads it back for
  cross-device restore.
- `validateBundle()` schema-checks every document (skips anything not a
  versioned `erp-doc`); `restoreBundle(bundle, {allowPartial})` force-writes
  the valid ones (bypassing CAS deliberately) and resets the local cache.
- `capacity()` reports every declared module document's size/records/rev vs
  the 4 MiB ceiling. `archiveDoc(moduleId, year)` moves a closed period's
  records into the read-only archive (`erp-v1-archive-<year>`) and empties the
  live doc; `archivedDocs()/viewArchived()/restoreArchive()` list, view and
  restore (restore clears the specific archive year's doc, keeping the
  archive accurate). Archival is audited. UI: Reports → Data utilities.
- Store additions: `readCanonical(name)` (fresh canonical read), `forceSet`
  (bypasses CAS), `clearDoc(moduleId, year)`, `cachedDocNames()`. `store.set`
  /`forceSet` now wrap plain records with the module's logical doc name and
  always update the store index (local + debounced canonical), so ad-hoc docs
  written through them behave like module docs.
- **Tests**: `await window.ERPBackupTest()` (20 checks, fake backend) — bundle
  assembly/schema, validation of malformed docs, restore roundtrip
  byte-faithfulness, publish + idempotent re-publish, capacity rows vs
  ceiling, and the full archive → view → restore → entry-removed lifecycle.

## Task 6+7+8+9 (done) — master data & configuration

- `ERP.master` (in `src/erp.master.js`) is the single source for parties,
  catalog, chart of accounts, taxes, posting defaults and settings. All are
  persisted as module documents under `ERP.MASTER` ids (`parties`, `catalog`,
  `chart`, `taxes`, `defaults`, `settings`, `audit`, `archive`) and loaded
  through a memoised cache (`master.flush()` clears it — tests call this
  after switching backends).
- Parties: typed `customer`/`supplier`/`both`, with contacts, addresses, tax
  id, payment terms, credit limit, active flag. `master.mergeParties(fromId,
  intoId)` rewrites every `partyId`/`supplierId`/`customerId` reference across
  crm/sales/purchasing/projects/audit/finance docs and removes the merged
  party — one rename/merge updates the whole system.
- Catalog: `product`/`service` items with uom, default sale price, default
  cost, tax treatment, active flag. Chart: account codes/names/classes with
  defaults for AR (1100), AP (2000), inventory (1200), COGS (5000), sales
  revenue, tax collected (2100), tax paid (1300). Taxes: NONE/VAT0/VAT10/VAT20.
- Settings: business profile (company name, address, currency, fiscal-year
  start month, tax scheme) + per-type document numbering (prefixes QT/SO/INV/
  CN/PO/REC/BILL/PAY/PRJ/JRNL/BK, zero-padded counter). `master.allocateNumber(
  type)` bumps the counter CAS-style (keep-theirs on conflict) and returns the
  next number. `master.seed()` is idempotent and runs at boot.
- `master.audit({action, targetType, targetId, summary})` appends a
  chronological, read-only audit entry (split by fiscal year); `auditLog()`
  reads it back.
- **Tests**: `await window.ERPMasterTest()` (17 checks) — idempotent seed,
  party CRUD with full profile, merge rewriting across real module docs (crm/
  purchasing) + directory cleanup, catalog CRUD, chart/tax/defaults seeding,
  settings persistence + no-op re-seed, and audit log capture.

## Task 10+11+12+13 (done) — CRM module

- `ERP.crm` (in `src/erp.crm.js`) is the CRM controller. It keeps two kinds of
  records in the `crm` doc (single, not split by year): `record` (a per-party
  CRM record) and `opportunity` (a pipeline deal). `ERP.crm.records()` is the
  cached read; `C.invalidate()` clears the cache (call after any external
  write, e.g. `mergeParties`). `byKind(list, kind)` splits the two kinds.
- **Parties tab** (Task 6 UI): typed customer/supplier/both directory with
  contacts, addresses, tax id, payment terms, credit limit and active flag;
  add/edit/merge/deactivate all operate through `master.saveParties` /
  `master.mergeParties`, so one rename/merge updates the whole system.
- **CRM records tab** (Task 10): records with source (website/referral/event/
  cold call/ad/partner/other), owner, status (new/contacted/active/inactive),
  tags, first contact, notes, a chronological activity timeline (add notes
  inline) and dated reminders with a "Reminders due" summary + overdue banner.
  A per-party detail modal shows the party's opportunities and activity.
- **Pipeline tab** (Tasks 11–12): stages lead → qualified → proposal → won/
  lost. Board view (column per stage with counts + totals and move ‹/›
  buttons), list view, filters by owner/party/search, per-party history via
  the opportunity detail modal, and timestamped `wonAt`/`lostAt` when a deal
  closes. `ERP.crm.wonToProject(opp)` turns a won opportunity into a project
  record (`projects` doc, `source: "opportunity:<id>"`) — deduplicated, so
  calling it twice never creates a second project.
- **Ports tab** (Task 13): `ERP.crm.parseIdeas(raw)` flexibly parses an
  idea-incubator bundle (`{ideas:[{title,summary,tags,category,partyName,
  value}]}` or a bare array) and `ERP.crm.importIdeas(ideas, recs, parties)`
  imports each idea as a CRM record + a **qualified** pipeline lead; ideas
  naming a known party link to it, unknown names create a party. Won
  opportunities export as a project-seeds bundle (download / clipboard).
- **Tests**: `await window.ERPCrmTest()` (14 checks, fake backend) — record
  lifecycle, stage moves + wonAt stamping, won→project handoff + dedupe,
  bundle parse/import (records + qualified leads + party reuse/creation),
  and merge-rewrites-crm-references.

## Task 14+15+16+17+18 (done) — Sales module

- `ERP.sales` (in `src/erp.sales.js`) is the sales controller over the `sales`
  doc (single, not split by year). `S.records()` is the cached read,
  `S.invalidate()` clears it; `S.byKind(list, kind)` splits quotes / orders /
  invoices / credit notes. Line + doc math: `S.lineTotals(l)` and
  `S.computeTotals(lines)` (subtotal − discount + tax).
- **Catalog tab** (Task 7 UI): product/service catalog with sku, uom, default
  sale price, default cost and tax treatment — stored in master data via
  `master.saveCatalog`, shared with purchasing/inventory later.
- **Quotes tab** (Task 14): catalog line items with a manual line editor
  (item autofill, per-line discount %, auto tax from the party-inherited tax
  codes), validity/expiry, states draft → sent → accepted / declined.
  `S.sendQuote` stamps `sentAt`, `S.declineQuote` stamps `declinedAt`;
  `S.acceptQuote` converts a sent quote into a sales order without retyping
  (source + quoteId/quoteNum kept, quote marked accepted with
  `acceptedOrderId`). `S.createQuote`/`S.updateDoc` persist form data.
- **Orders tab** (Task 15): sales orders entered directly or from an accepted
  quote; per-line fulfillment (shipped/delivered/invoiced/backordered),
  delivery promise dates, status stamps open → confirmed → shipped →
  delivered → invoiced. `S.recordShipment`/`S.recordDelivery` take a
  `{lineNo: qty}` map (partial quantities allowed); the status advances only
  when every line is complete. `S.confirmOrder` is the stock gate (see 17).
- **Stock checks & backorders** (Task 17): `S.confirmOrder` calls
  `ERP.inventory.available(itemId)` when the inventory module exists (Phase 5;
  `Infinity` until then), splits shippable vs backordered, sets
  `order.hasBackorder` + per-line `qtyBackordered`, and calls
  `S.raiseShortfall(order, backordered)` which drafts a PO
  (`kind: "po"`, `source: "shortfall"`, linked to the order) into the
  purchasing doc. Backorders are relieved in order-date order as goods
  receipts land (wired up in Phase 5).
- **Invoicing** (Task 16): `S.invoiceFromOrder(order, qtyMap)` invoices
  selected delivered lines (partial invoicing allowed), computes the due date
  from the party's payment terms (immediate/net15/30/60/90), posts the
  invoice with order + party refs, marks lines `qtyInvoiced` and stamps the
  order invoiced when complete. `postInvoice()` calls
  `ERP.finance.postSalesInvoice(inv)` when the Phase-7 finance module exists
  (no-op until then).
- **Credit notes** (Task 18): `S.createCreditNote(inv, amount, reason)` — a
  reason is required, amount cannot exceed what's left (total − credited −
  paid); marks the invoice credited/partially_credited and calls
  `reverseInvoice(cn)` → `ERP.finance.reverseInvoice` (guarded until Phase 7).
- **Tests**: `await window.ERPSalesTest()` (25 checks, fake backend) — totals
  math, quote lifecycle + errors, accept→order, confirm with a stubbed
  `ERP.inventory.available` forcing backorders + shortfall PO in purchasing,
  ship/deliver/invoice, credit-note validation and full credit, direct-order
  numbering, and delete.

## Task 19+20+21+22+23 (done) — Purchasing & Inventory

- `ERP.purchasing` + `ERP.inventory` (in `src/erp.purch.js`, one IIFE exposing
  both controllers). Purchasing data lives in the `purchasing` doc (single),
  inventory movements in the `inventory` doc (`splitByYear: true`, so reads
  use `{all: true}`). Both have cached reads + `invalidate()`.
- **Movement log & derived stock** (Task 19): inventory is an append-only
  movement log — `I.postReceipt/postIssue/postOpening/postAdjustment/
  postTransfer` each append a movement (type, itemId, location, qty, unitCost,
  date, refType/refId/refNum, note). Current quantity is always derived from
  the log, never free-edited. `I.stock()` returns per-product rows with on-hand
  qty per location, moving-average cost, value and reorder point;
  `I.available(itemId)` = on-hand; `I.valuation()` totals by type.
- **Moving-average cost & COGS** (Task 23): receipts/openings update the
  weighted average; issues/adjustments keep it (issues cost at the then-current
  average, i.e. COGS); transfers are valuation-neutral. `postReceipt` also
  auto-relieves any backorders for that item (`I.relieveBackorders`) in
  order-date order.
- **Purchase orders** (Task 20): `P.createPO(data)` (lines required, totals
  stored, `PO-xxxx` numbering), `sendPO` (draft→sent), `deletePO` (draft/sent
  only), `receivePO(po, qtyMap)` — per-line receipt posts stock-in at purchase
  cost, auto-relieves backorders, and creates the supplier bill from the goods
  receipt in the same action. PO status advances received/partial.
- **Bills & supplier payments** (Task 21): `createBillFromPO(po, received)`
  (from goods receipt) or `createBill(data)` (direct, due date from supplier
  terms), `payBill(bill, amount, method, date, ref)` (partial/full, never
  overpay), `supplierBalance(supplierId)` ties to open bills.
- **Reorder suggestions** (Task 22): `I.reorderSuggestions()` lists products
  with `reorderPoint > 0` currently below it (suggested qty = reorder point,
  supplier/unit cost/tax from the catalog); `I.createReorderPOs(suggestions)`
  groups by supplier into draft POs (`source: "reorder"`) ready to send.
- **Ledger hooks**: goods receipts/bills/payments/inventory movements call
  `ERP.finance.postGoodsIn/postGoodsOut/postInventoryAdjustment/postBill/
  postSupplierPayment` (guarded; since Phase 7 these post for real, and
  always before the source doc saves). Sales shipments post their own stock
  issue at moving-average cost via `I.postIssue`.
- **Tests**: `await window.ERPPurchTest()` (29 checks, fake backend) — movement
  log + derived stock/valuation/available, PO lifecycle (draft→send→receive →
  stock-in + auto supplier bill + payment), backorder relief on receipt (with
  the COGS issue movement at moving-average cost), reorder suggestions → PO,
  direct bills + partial/full payments + supplier balance, and guards
  (unsent PO can't be received, overpay rejected, received PO can't be
  deleted).

## Task 24+25+26+27 (done) — Projects, time & service delivery

- `ERP.projects` (in `src/erp.projects.js`) is the projects controller over
  the `projects` doc (single, not split by year). `P.records()` is the cached
  read, `P.invalidate()` clears it; `P.byKind(list, kind)` splits projects /
  milestones / tasks / timeEntry / expense records.
- **Projects** (Task 24): `P.createProject(data)` (title required, `PRJ-xxxx`
  numbering, linked to a party and optionally a sales order, budget,
  currency, start/end dates, description, tags, status), `updateProject`,
  `setProjectStatus` (planned/active/on_hold/completed/cancelled — each
  transition is recorded on the project activity timeline). Milestones sit
  under projects with a billing value, status (planned/in_progress/completed/
  cancelled) and planned/due dates.
- **Tasks & timesheets** (Task 25): tasks under a project (optionally under a
  milestone) with assignee, due date, estimated hours, states todo/in_progress/
  done. Time entries carry date, hours, billable flag, billable rate, loaded
  cost-per-hour, note; `P.projectTimeTotals` rolls up hours / billable hours /
  billable value / unbilled backlog. The Tasks tab is a cross-project view with
  filters (project/status/assignee + overdue badges); Timesheets tab is the
  cross-project time ledger.
- **Expenses & progress billing** (Task 26): `P.addExpense` (category, amount,
  vendor, optional supplier-bill link) plus `P.deleteExpense`. `P.progressInvoice(
  project, {mode: "milestones"|"time", ids})` generates a progress invoice
  from completed, uninvoiced milestones (with a billing value) or billable,
  uninvoiced time (aggregated by task) — written into the **sales** doc as a
  regular invoice (`kind: "invoice"`, `source: "project"`), so it shares the
  same numbering, due-date-from-party-terms logic and guarded
  `ERP.finance.postSalesInvoice` hook as sales invoices, and appears in
  Sales → Invoices and AR aging. Milestones/time entries are stamped with the
  invoice so double-invoicing is rejected.
- **Profitability** (`P.projectMetrics`): billed = progress-invoice total in
  the sales doc only (never double-counted), unbilled = uninvoiced billable
  time × rate, cost = expenses + labour (hours × loaded cost), profit =
  billed − cost, plus % of budget billed, milestone/task completion counts and
  the invoice list.
- **Timeline & ports** (Task 27): every project keeps a chronological activity
  timeline (`P.projectTimeline`). `P.exportBundle()` publishes an
  `erp-project-bundles` JSON; `P.ingestBundle()` ingests
  `erp-project-seeds` (from CRM won opportunities), `erp-project-bundles` and
  `erp-ledger-receipts`, matching by source key / projNum so re-imports never
  duplicate.
- **Tests**: `await window.ERPProjectsTest()` (44 checks, fake backend) —
  project/milestone/task/time/expense lifecycle + validation, metrics math
  (incl. billed-no-double-count, cost = expenses+labour, unbilled tracking),
  milestone & time progress invoicing (stamps, rejects, lands in the sales
  doc, due-date from party terms), timeline chronology, export/ingest with
  dedupe, and cross-call invoice protection.

## Task 28+29+30+31+32 (done) — Finance: ledger, AR/AP, bank & period close

- `ERP.finance` (in `src/erp.finance.js`) is the finance controller over the
  **finance** doc (split by fiscal year — every journal carries a `date`, so
  postings land in the right year). `F.records()` is the cached read,
  `F.invalidate()` clears it; `F.journals({from,to,source,account})` filters
  and sorts the journal.
- **Double-entry journals** (Task 28): `F.postJournal({date,memo,source,refType,
  refId,refNum,lines})` — every posting is a balanced set of debit/credit lines
  (`lines.length ≥ 2`, debits must equal credits within 0.01, every account must
  be on the chart), auto-numbered `JRNL-xxxx` with a `period` (YYYY-MM). Posted
  entries are immutable; `F.reverseJournal(j, reason, {date})` posts a negated
  reversing entry and stamps `reversedBy`/`reverses` (double reversal rejected).
- **Automatic postings map** (Task 29) — guarded cross-module hooks that fire
  when `ERP.finance` exists, and always POST BEFORE the source doc saves so a
  posting failure throws (naming the offending document) and stops the action:
  `postSalesInvoice` (Dr AR / Cr revenue per line — 4000 sales vs 4100 service/
  project — Cr tax collected), `reverseInvoice` (credit note, scaled),
  `postGoodsIn` (Dr Inventory / Cr AP), `postGoodsOut` (Dr COGS / Cr Inventory
  at moving-average cost), `postInventoryAdjustment`, `postOpening`,
  `postSupplierBill` (from-receipt bills book only input VAT so AP ties to the
  bill total; direct bills Dr Inventory/Expense + input VAT / Cr AP),
  `postSupplierPayment` (Dr AP / Cr Bank), `recordCustomerReceipt` (Dr Bank /
  Cr AR, writes back `amountPaid` and flips invoices to `status:"paid"`).
  All are idempotent via `findPosting(refType, refId)`.
- **Receivables & payables** (Task 30): `F.receivableAging()`/`F.payableAging()`
  return `{rows, totals}` bucketed current/1-30/31-60/61-90/90+ with overdue
  totals; `F.customerStatement(partyId)`/`F.supplierStatement(supplierId)` are
  chronological running-balance statements (receipts/payments negative).
  `F.recordCustomerReceipt` applies a payment to one or more invoices (partial /
  split), rejects over-allocation and sum mismatches.
- **Bank & cash** (Task 31): `F.addBankEntry({type:deposit|withdrawal, ...})`
  posts bank journal entries; `F.bankRegister()` derives the register (every
  journal touching the bank account, running balance, chronological);
  `F.markCleared(journalId, cleared, statementRef)` implements statement
  matching so reported cash reconciles to the bank statement.
- **Period close & financial statements** (Task 32): `F.trialBalance({from,to})`
  (per-account net debit/credit + totals + drill-down), `F.profitLoss(...)`,
  `F.balanceSheet({asOf})` (A = L + E + current earnings). `F.closePeriod("YYYY-MM",
  reason)` locks the period, rolls income/expense to retained earnings via a
  closing journal, and marks every journal `periodClosed`; `F.reopenPeriod`
  reverses the closing journal (dated in the same period) and removes the lock.
  Posting into a closed period is blocked. The module also hosts the Chart of
  accounts / Tax / Settings tabs: `F.chartAccounts()/saveChart()`,
  `F.taxRates()` (= master.taxes).
- **UI**: `F.renderPanel` renders 8 tabs (Ledger / Receivables / Payables /
  Bank / Reports / Chart / Tax / Settings), each with its own render function;
  the Finance nav module wraps it (`F.render = F.renderPanel`).
- **Tests**: `await window.ERPFinanceTest()` (54 checks, fake backend) — journal
  semantics + reversal audit trail, the full posting pipeline with a trial
  balance that ties out (820/820), P&L + balance sheet (A = L + E), AR/AP aging
  + statements + partial/split receipts + allocation errors, bank register +
  statement matching, period close/reopen (net income −100, closing journal,
  closed-period lock/unlock), project-invoice → service revenue, direct bills,
  idempotent re-posting, and chart/tax CRUD.

## Task 33+34+35+36 (done) — Dashboard, reports & data utilities

- **Dashboard KPIs** (Task 33): `ERP.dashboard.kpis()` computes cash (bank
  register), receivables/payables totals + overdue, open orders/POs/bills,
  revenue this month vs last, stock value, low-stock (catalog items past their
  reorder point with no/insufficient on-hand), and top customers by invoiced
  revenue. The dashboard grid renders each KPI as a `statCard` that
  deep-links to its source module tab (`#/finance:bank`, `#/sales:orders`,
  …) via the hash-tab router; the "Needs attention" panel lists overdue
  invoices/bills and low-stock alerts; recent activity shows the latest audit
  entries. `renderPanel` is `render` for the Dashboard nav module.
- **Report library** (Task 34): `ERP.reports` seeds 8 definitions into the
  `reports` doc (id/title/desc/module/type). `R.runReport(def)` returns
  `{title, subtitle, columns, rows, summary}` for sales by period/customer/
  product, purchasing spend, project profitability, aged receivables,
  inventory valuation and tax summary. The Reports tab lists them as cards;
  each Run opens a modal table, Export CSV downloads via `R.toCsv` +
  `R.downloadCsv`, Print renders into `#erpPrintArea` (`@media print`).
- **Guided CSV import** (Task 35): `R.prepareImport(kind, text)` parses
  (quoting-aware, header-mapped) and validates every row — parties (name
  required, dup check, creditLimit via headers), catalog (tax-code + sku-dup
  checks), stock-counts (resolves items by SKU, unknown-item flagged) and
  opening-balances (unknown account, unbalanced = fatal). The Import tab shows
  a preview table with per-row OK/Error badges before anything is committed;
  `R.applyImport` commits only valid rows and audits the result. Stock counts
  post opening-style movements; opening balances post one balanced journal.
- **Audit log** (Task 36): `master.audit({action, summary, targetType,
  targetId, meta})` appends (never throws; split by year) and
  `master.auditLog({all:true})` merges all years. The Audit tab is read-only,
  sorted newest-first, with a free-text filter (`R.filterAudit` matches
  summary/actor/action/target) and per-action counts. Every state-changing
  action across the app calls `master.audit`.
- **Hash-tab deep-linking**: `navigate("module:tab")` sets `#view.__tab` and
  `onHashChange` parses `#/module:tab`; module renderPanels read `el.__tab` to
  open the right tab on load.
- **Tests**: `await window.ERPReportTest()` (50 checks, fake backend) — full
  setup pipeline, every KPI value (cash 1000, AR 540/300 overdue, AP 620/500
  overdue, open orders/POs/bills, revenue 200 vs 0, stock 5000, Gizmo
  low-stock, top customers Zeta→Acme), deep-link navigation, all 8 reports,
  CSV parse/export round-trips, all 4 import kinds (+ re-import dup detection,
  unbalanced-fatal), and audit search semantics.

## Task 37+38+39 (done) — system health, fixtures & error copy

- **Accounting invariants** (`Q.invariants()` in `src/erp.quality.js`): seven
  checks — every posted journal sums to zero; the trial balance is balanced;
  AR ties open invoices to the AR ledger; AP ties open bills to the AP ledger;
  inventory value ties to the movement log; the bank register ties to the bank
  ledger; and the balance-sheet identity holds (A = L + E). Returns
  `{ok, failCount, errorCount, checks:[{key,label,status,detail}], ranAt}` and
  never throws. Each check carries a recovery `nextStep` from `Q.guide(key)`.
- **Auto re-check** (Task 37): every finance mutator (`postJournal`,
  `reverseJournal`, `postSalesInvoice`, `reverseInvoice`, `postGoodsIn/Out`,
  `postInventoryAdjustment`, `postOpening`, `postSupplierBill`,
  `postSupplierPayment`, `recordCustomerReceipt`, `addBankEntry`, `markCleared`,
  `closePeriod`, `reopenPeriod`) is wrapped transparently at boot so a
  successful posting schedules a debounced (800 ms) `Q.check()`. The result
  drives the topbar health dot (`#healthDot` — green/amber/red/gray, in
  `index.html` next to the sync button) and the Reports → System health tab
  (`Q.renderHealth`, a summary + per-check table with "If it fails" guidance
  and a Run-checks-now button). `Q.setAuto(false)` disables the auto re-check
  (tests rely on it).
- **Friendly error copy** (Task 39): `Q.friendlyError(e)` recognises
  `document_too_large`, quota/over_daily_allowance, lost edit key, offline
  divergence, corrupt/schema-mismatched documents, unbalanced entries and
  storage-unavailable failures and returns `{title, message, nextStep}` in
  plain language — anything unrecognised falls back to a generic message that
  still tells the user to back up first.
- **Fixtures** (Task 38): `Q.FIXTURES.docs` provides valid records for every
  module document (parties, catalog, chart, taxes, defaults, settings, crm,
  sales, purchasing, inventory, projects, finance, audit, archive);
  `Q.FIXTURES.olderSchema(moduleId)` builds an earlier-pipeline `erp-doc`
  (schemaVersion 0, records missing the fields the current pipeline writes);
  `Q.FIXTURES.malformed` covers bad JSON, non-ERP documents, missing record
  arrays, and unbalanced/unknown-account journal entries. `Q.FIXTURES.setup()`
  seeds a complete world (customer, supplier, product, opening stock, opening
  cash) and `Q.FIXTURES.chain(refs)` drives the full quote → order → delivery →
  invoice → payment chain, verifying the books stay tied (invoice 360, payment
  settles it, bank 10360, all seven invariants green).
- **Tests**: `await window.ERPQualityTest()` (71 checks, fake backend) — clean
  invariants, chain invariants, unbalanced-entry detection + recovery, auto
  re-check, all error-copy cases + generic fallback + per-check guides,
  older-schema tolerance in store & master, malformed JSON → `corrupt_document`,
  validateBundle rejection/partial, document_too_large refusal,
  backup/restore round-trip (undoes a temp write), sync conflict + keep-theirs,
  the system-health UI (dot turns green, Reports → System health table ≥ 7
  rows), and a save/load fixture round-trip for every module document.

## User workflow per module (the day-to-day playbook)

**Dashboard** — the landing view. Read the KPI grid: cash, receivables,
payables, open orders/POs/bills, this month's revenue vs last, stock value and
low-stock alerts, top customers. Click any KPI card to jump to the module tab
that produced it. Act on the "Needs attention" panel (overdue invoices/bills,
low stock) and the recent-activity feed.

**CRM** — start with the **Parties** tab: add customers and suppliers (typed,
with contacts, payment terms, credit limits; merge duplicates to rewrite every
reference in one step). The **CRM records** tab tracks leads/accounts with an
owner, status and a dated activity timeline + reminders. The **Pipeline** tab
is the deal board: drag (‹/›) opportunities through lead → qualified →
proposal → won/lost; a won deal becomes a project in one click. **Ports**
imports idea bundles from the idea incubator as qualified leads.

**Sales** — the **Catalog** tab holds products/services (default prices and tax
treatment). **Quotes**: build a quote from catalog lines (discounts, auto-tax),
send it; an accepted quote becomes an order without retyping. **Orders**: track
per-line fulfillment (ship/deliver/invoice); confirming an order checks stock
and flags backorders — a shortfall auto-drafts a PO. **Invoices**: invoice
delivered lines (partial allowed), due date from the customer's terms;
**Credit notes** require a reason and reverse the ledger.

**Purchasing & Inventory** — **Purchase orders**: draft → send → receive;
receiving posts stock in at purchase cost, auto-relieves backorders and raises
the supplier bill. **Bills & payments**: pay bills fully or partially (never
overpay); supplier balances tie to open bills. **Stock**: the movement log
receipts/issues/openings/adjustments/transfers drives on-hand quantity,
moving-average cost and valuation; **reorder suggestions** draft POs for items
below their reorder point.

**Projects** — set up a project (linked to a party, budget, dates, tags), add
milestones (with billing values) and tasks, log time and expenses. When work is
done, **progress invoice** bills completed milestones or billable time straight
into Sales as a regular invoice (double-invoicing is rejected); the
profitability panel shows billed vs unbilled vs cost.

**Finance** — the **Ledger** tab is the double-entry journal (auto-numbered,
immutable, reversal via a negated entry with a reason). **Receivables** /
**Payables** show aging buckets and per-party statements; record customer
receipts by applying payments to one or more invoices (partial/split allowed).
**Bank**: add deposits/withdrawals, read the derived register, mark statement
lines cleared to reconcile. **Reports**: trial balance, P&L and balance sheet
(every posting flows in automatically from sales/purchasing/inventory). Close a
period when done; posting into a closed period is blocked.

**Reports** — run the 8 saved report definitions (sales by period/customer/
product, purchasing spend, project profitability, aged receivables, inventory
valuation, tax summary), export any to CSV or print. **CSV import** previews
every row with per-row errors before committing (parties, catalog, stock
counts, opening balances). **Audit log** is the read-only, searchable history
of every state-changing action. **Backup & restore** downloads/publishes a full
bundle, restores it, archives closed fiscal years to keep documents under the
ceiling, and shows capacity. **System health** runs the seven accounting
invariant checks (also surfaced as the topbar dot) with recovery guidance per
check.

## Adding a new ERP module (the full playbook)

1. **Register the module** — add `ERP.registerModule({id, label, group,
   icon, roles, render})` to `src/erp.modules.js`. `group` is `ops` or `fin`
   (or absent for a top-level module); `roles: []` means every role, otherwise
   an explicit list. It appears in the nav and router automatically — no other
   wiring.
2. **Declare the document(s)** — set `doc: {name, splitByYear}` on the module
   definition. One document per data module, `erp-v1-<name>` (add `-<year>` and
   `splitByYear: true` when records accumulate, e.g. movements, journals, audit
   — fiscal-year partitioning keeps documents under the 4 MiB ceiling).
   Everything else (cache, edit keys, revisions, conflict handling, index,
   dirty-flush) comes free from `src/erp.store.js`.
3. **Add document numbering** — if records carry human-readable numbers, add a
   prefix + counter to `master.DEFAULT_NUMBERING` (and the seed settings doc)
   and allocate with `master.allocateNumber(type)` — CAS-style, so concurrent
   devices never reuse a number.
4. **Add automatic postings** — if the module touches the books, add a guarded
   hook to the finance posting map (`src/erp.finance.js`, Tasks 29): POST
   BEFORE the source document saves so a posting failure throws and stops the
   action, make it idempotent via `findPosting(refType, refId)`, and invalidate
   the finance cache after. The system-health auto re-check picks it up
   automatically if the new posting goes through an existing finance mutator.
5. **Wire the UI** — build the controller as a `renderPanel(ctx)` (reads
   `ctx.el`, `ctx.error`) using the `ERP.ui` toolkit; expose `render =
   renderPanel`. Deep-linkable tabs (`el.__tab`, `#/module:tab`) follow the
   other modules. Dashboard KPI cards can deep-link to your tab.
6. **Audit + test + document** — call `master.audit({action, targetType,
   targetId, summary})` for every state-changing action. Add a `window.ERPXTest`
   suite to `src/erp.tests.js` against `makeServer()` (fake backend), add a
   fixture to `Q.FIXTURES.docs` if you want round-trip coverage, and keep this
   README's workflow + file-list entries up to date. Flip the checklist task in
   `main.pjs` only after the new suite passes in the live page.

## Backup & continuity schedule

- **Continuous**: every write lands locally first (fast cache) and flushes to
  the canonical editable store; sync runs at boot, on "Sync now", and every
  60 s. Conflicts are parked, never auto-dropped.
- **On demand**: Reports → Backup & restore → Download (JSON file) or Publish
  (to the ERP's own namespace, idempotent) any time; restore force-writes a
  validated bundle. Keep a downloaded copy off the device.
- **Periodic**: at the end of each fiscal period, close the period in Finance
  (locks posting, rolls net income to retained earnings) and archive the closed
  year's records (Reports → Backup & restore → Archival) so live documents
  stay small. System health (topbar dot) confirms the books still balance after
  every finance-affecting action.
