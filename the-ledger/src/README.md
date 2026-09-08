# The Ledger — Small-Business Bookkeeping (src/)

A comprehensive small-business bookkeeping app, built **one roadmap task at a
time** from the atomic plan in [`ROADMAP.md`](./ROADMAP.md). This project
started as the perchance "business-template" generator and keeps its
architecture: **config-driven** pages (all identity/theme/content in `main.pjs`
→ `config`), a themable component system, and JS-rendered UI.

**Status: all 9 phases / 47 roadmap tasks are implemented.** The live app
routes each module through `window.Modules.<key>.render` (see app.js
`openView`); ledger and ap are additionally registered as `window.Ledger` /
`window.AP` for backwards compatibility.

## Files

| Path | Purpose |
|---|---|
| `main.pjs` | `config` (identity/theme/colors/app), `kv = {import:kv-plugin}`, `generateText = {import:ai-text-plugin}` (used by OCR extraction), and the **FEATURES CHECKLIST** (`features` list) — all 47 tasks `status = done`. |
| `src/ROADMAP.md` | The completed feature roadmap: phases 1–9, tasks 1–47, all marked done (canonical copy is `main.pjs` → `features`). |
| `src/theme.css` | Component styles: app shell, buttons, cards, chips, tables, forms, modals, ledger tabs, stat grids. Semantic CSS vars; light/dark via `[data-mode]`. |
| `src/framework.js` | `window.FW` — reads pjs lists, applies theme, DOM/money/toast/modal helpers, kv-backed `FW.store` (folder `ledgerly`). |
| `src/ledger.js` | `window.Ledger` — Phase 1 (tasks 1–6): CoA & accounts, double-entry journal & posting, period closing (locks ranges, carries net income to retained earnings), append-only audit trail, as-of trial balance. Also `window.Modules.ledger`. Keys: `coa`, `journal`, `closings`, `audit`. |
| `src/ap.js` | `window.AP` — Phase 2 (tasks 7–12): purchase orders (lifecycle + conversion to bills), vendor bills (PO line matching, posting DR expenses / CR A/P), recurring-expense rules → auto draft bills, **line-item matching engine** (qty/price/amount variance flags), payment disbursement (ACH/CHK refs, DR A/P / CR cash), **A/P aging**. Bills support optional `projectId` (Phase 9 hook). Keys: `pos`, `bills`, `recurring`. |
| `src/ar.js` | `window.AR` — Phase 3 (tasks 13–18): customers, quotes → convert to invoices, invoice editor (line items, tax via `window.Tax`, currency via `window.Tax`, **project attribution** via `window.Projects`), posting (DR A/R / CR revenue + tax), recurring billing, payment capture (card/bank/cash/check) with `ar_payment.confirm` webhook-style flow, automated reminders, **A/R aging**. Posting/voiding hooks `window.Inventory.onInvoicePosted/onInvoiceVoided` for stock + COGS. Keys: `ar_customers`, `ar_quotes`, `ar_invoices`, `ar_recurring`. |
| `src/tax.js` | `window.Tax` — Phase 4 (tasks 19–23): base currency definition, exchange-rate table (per-currency rates + per-transaction fxRate override stored on AR/AP docs), dynamic tax calculation (GST/HST/PST/VAT/US sales tax by jurisdiction + date), tax liability routing to the 2100 account on posting, **tax preparation report** (output vs input tax, by type & jurisdiction, over a range). Keys: `tax_currency`, `tax_rates`, `tax_rules`. |
| `src/ocr.js` | `window.OCR` — Phase 5 (tasks 24–28): receipt/document capture (image downscale → base64), **AI extraction via `root.generateText` vision**, CoA category suggestion from vendor history + keyword map, review/edit fields, **commit** → draft AP bill (via `window.AP.saveBill`) or draft journal entry, doc↔ledger linkage for audit. Keys: `ocr_docs`. |
| `src/payroll.js` | `window.Payroll` — Phase 6 (tasks 29–33): employees (hourly/salary, fed/state/other withholding %), timesheets (draft→submitted→approved), pay runs with gross/net computation and payslips, posting (DR 5600 payroll expense / CR 1010 cash net / CR 2210 fed / CR 2220 state / CR 2200 other liabilities). Keys: `pay_employees`, `pay_timesheets`, `pay_runs`. |
| `src/reports.js` | `window.Reports` — Phase 7 (tasks 34–39): **KPI dashboard** (revenue, expenses, cash, A/R, A/P, net income, margins), **P&L** (trial balance at range end − day-before-start), **Balance Sheet** (assets = liabilities + equity + unclosed net income; balanced check), **Cash Flow (indirect)** (operating/investing/financing, reconciles to Δcash), **A/R + A/P aging**. Reads `window.AR` / `window.AP` aging helpers. |
| `src/inventory.js` | `window.Inventory` — Phase 8 (tasks 40–43): item catalog (SKU, unit, price), **weighted-average cost** stock movements (purchase in / sale out / adjustment), automatic **COGS posting** (DR 5000 / CR 1200) when a sales invoice with inventory items is posted, reversal on void, inventory valuation report. **Synchronous `itemById`/`itemOptions` via an in-memory cache** (required by ar.js's sync line-render loops) — refreshed on every save. Keys: `inv_items`, `inv_moves`. |
| `src/projects.js` | `window.Projects` — Phase 9 (tasks 44–47): project definitions (code, color, status), revenue/expense attribution carried through invoice & bill posting to ledger entries, per-project **profitability report** (revenue, expenses, profit, margin) with roll-up. Used by ar.js/ap.js invoice/bill modals for the project picker. Key: `proj_projects`. |
| `src/app.js` | `window.Ledgerly` — app shell, view switching (`openView` routes `ledger`/`ap` directly and any `window.Modules[key].render`), features-list dashboard, Roadmap/checklist UI, and the **User manual** (`#manual`). |
| `src/README.md` | This file. |

## Checklist conventions

- Canonical copy: `main.pjs` → `features` → `phases` → `p1..p9` → `items` →
  each item has `id` (1–47), `task`, `detail`, `status`. All are `done`.
- Module keys ↔ phases: `ledger`(1) · `ap`(2) · `ar`(3) · `tax`(4) · `ocr`(5) ·
  `payroll`(6) · `reports`(7) · `inventory`(8) · `projects`(9).

## Architecture for feature work

- **Data lives in kv-plugin** (per-browser, IndexedDB) under the `ledgerly`
  folder. Keys (per module): `roadmap`, `ui`, `coa`, `journal`, `closings`,
  `audit`, `pos`, `bills`, `recurring`, `ar_customers`, `ar_quotes`,
  `ar_invoices`, `ar_recurring`, `tax_currency`, `tax_rates`, `tax_rules`,
  `ocr_docs`, `pay_employees`, `pay_timesheets`, `pay_runs`, `inv_items`,
  `inv_moves`, `proj_projects`. Wrap reads in `FW.store.get/set` (localStorage
  fallback), always guard with `Array.isArray(v) ? v : []`.
- **Audit entities/actions** are extended in ledger.js's
  `AU_ENTITIES`/`AU_ACTIONS`/`AU_LABEL`/`AU_ENTITY_LABEL` (currently covering
  all module record kinds). Every module logs via `Ledger.auditLog(action,
  {entity, entityId, entityLabel, summary, prev, next})`.
- **Module conventions** (follow for new modules): IIFE + `"use strict"`;
  `const FW = window.FW, esc = FW.esc, Ledger = window.Ledger, K = {...}`;
  helpers `round2/amt/today/uid`; `render(ctn)` builds page content with
  `ledger-tabs` + `ledger-tab-ctn` and async per-tab renderers; export
  `const X = {...}; window.Modules = window.Modules || {}; window.Modules.key =
  X; window.<Key> = X;`. Cross-module calls are always guarded
  (`window.X && window.X.fn`) and happen at runtime, never at load.
- **Money** is stored as plain numbers; the transaction's own `currency` +
  `fxRate` are retained on each AR/AP document. Display with `FW.money(n)`
  or `window.Tax.format(n, code)`; convert with `window.Tax.toBase`.
- **Tests**: every module exposes `selfTest()` → array of
  `{name, ok, extra}`. Run via
  `page_eval: return await window.Modules.<key>.selfTest()`.

## Runtime hooks

- `window.Ledgerly` — `cfg`, `features`, `progress`, `openView(key)`,
  `setFeatureStatus(id, 'done'|'pending')`, `resetProgress()`, `currentView()`.
- `window.Modules` — `ledger`, `ap`, `ar`, `tax`, `ocr`, `payroll`, `reports`,
  `inventory`, `projects` (each: `render(ctn)`, `selfTest()`, domain API).
- Hash routing: `#dashboard`, `#roadmap`, `#manual`, `#<module-key>`. The dashboard presents a product-style **Features list** (one card per module with its feature checklist); the **Manual** (`#manual`) is the in-app user documentation.

## Quirks / notes

- Index.html contains only the shell + script tags; `src/theme.css` +
  framework/app render everything. All external files load via the perchance
  src/ resolver (needs a save or service-worker-capable browser to preview
  outside the editor).
- Load order in index.html matters only for the initial `window.*` registrations;
  all cross-module usage is guarded and lazy, so modules tolerate any order.
- OCR extraction calls `root.generateText` (ai-text-plugin) — this is an
  async AI call that can take ~30s; the OCR UI shows a spinner while running.
- Perchance pjs leaf values auto-parse numbers/booleans; `FW.scalar` normalizes.
- To change branding/colors: edit `config` in main.pjs and refresh — no JS edits.
