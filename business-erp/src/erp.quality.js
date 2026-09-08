/* ============================================================
   BUSINESS ERP — quality & system health (Tasks 37–39)
   - Q.invariants() (Task 37) — accounting invariant checks:
     every posted journal sums to zero, the trial balance is
     balanced, AR/AP tie to invoice/bill states, inventory value
     ties to the movement log, cash ties to the bank register,
     and the balance-sheet identity holds (A = L + E). The
     finance module's posting methods are wrapped so every
     finance-affecting action schedules a debounced re-check,
     surfaced as a topbar health dot and the Reports →
     "System health" tab.
   - Q.FIXTURES (Task 38) — fixture documents for every module
     document, older-schema bundles and malformed payloads, plus
     a setup + full quote → order → delivery → invoice → payment
     chain. ERPQualityTest exercises store save/load, sync
     conflicts, backup/restore and the chain against them.
   - Q.friendlyError / Q.guide (Task 39) — every failure mode
     (document too large, quota reached, lost edit key, offline
     divergence, schema mismatch, unbalanced entry) maps to
     plain-language, actionable copy with the exact next step.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const store = ERP.store;
  const master = ERP.master;
  const Q = (ERP.quality = {});

  const esc = ui.esc;
  const EPS = 0.01;
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const f = () => ERP.finance;
  const i = () => ERP.inventory;

  /* Default posting accounts (mirrors finance's internal map; the
     user's defaults document may override each account). */
  async function accounts() {
    const a = await master.defaultsMap();
    return Object.assign({
      bank: "1000", ar: "1100", inventory: "1200", taxPaid: "1300",
      ap: "2000", taxCollected: "2100", equity: "3000", retainedEarnings: "3100",
      salesRevenue: "4000", serviceRevenue: "4100", cogs: "5000", expense: "5100",
    }, a || {});
  }

  /* Net balance (debit − credit) of one account across all journals. */
  async function accBalance(code) {
    const tb = await f().trialBalance({});
    const row = tb.rows.find((r) => String(r.code) === String(code));
    return row ? round2(row.debit - row.credit) : 0;
  }

  /* ─────────────────────────── invariants (37) ─────────────────────────── */

  Q.invariants = async function () {
    const fin = f();
    const inv = i();
    if (fin) fin.invalidate();
    if (inv) inv.invalidate();

    const checks = [];
    const add = (key, label, status, detail) => checks.push({ key, label, status, detail });
    const fail = (key, label, e) => add(key, label, "error", "could not run — " + ((e && e.message) || String(e)));

    /* 1. Every posted journal sums to zero. */
    try {
      const journals = await fin.journals({});
      const bad = journals.filter((j) => Math.abs((Number(j.totalDebit) || 0) - (Number(j.totalCredit) || 0)) > EPS);
      add("journal_balance", "Every posted journal entry balances to zero",
        bad.length ? "fail" : "ok",
        bad.length
          ? bad.length + " of " + journals.length + " entries are out of balance (first: " + bad[0].num + ")"
          : journals.length + " journal entries, all in balance");
    } catch (e) { fail("journal_balance", "Every posted journal entry balances to zero", e); }

    /* 2. Trial balance. */
    try {
      const tb = await fin.trialBalance({});
      add("trial_balance", "The trial balance is balanced",
        tb.balanced ? "ok" : "fail",
        tb.balanced
          ? "debits " + ui.money(tb.totalDebit) + " = credits " + ui.money(tb.totalCredit)
          : "debits " + ui.money(tb.totalDebit) + " ≠ credits " + ui.money(tb.totalCredit));
    } catch (e) { fail("trial_balance", "The trial balance is balanced", e); }

    /* 3. AR ties: open invoices equal the AR ledger balance. */
    try {
      const acc = await accounts();
      const salesDocs = (await store.loadDoc("sales")).records || [];
      const arOpen = round2(salesDocs.filter((r) => r.kind === "invoice")
        .reduce((s, r) => s + Math.max(0, (Number(r.total) || 0) - (Number(r.amountPaid) || 0) - (Number(r.amountCredited) || 0)), 0));
      const arLedger = await accBalance(acc.ar);
      add("ar_ties", "Receivables tie: open invoices = AR ledger",
        Math.abs(arOpen - arLedger) < EPS ? "ok" : "fail",
        Math.abs(arOpen - arLedger) < EPS
          ? "open " + ui.money(arOpen) + " = AR " + ui.money(arLedger)
          : "open invoices " + ui.money(arOpen) + " vs AR ledger " + ui.money(arLedger));
    } catch (e) { fail("ar_ties", "Receivables tie: open invoices = AR ledger", e); }

    /* 4. AP ties: open bills equal the AP ledger balance. */
    try {
      const acc = await accounts();
      const purchDocs = (await store.loadDoc("purchasing")).records || [];
      const apOpen = round2(purchDocs.filter((r) => r.kind === "bill")
        .reduce((s, r) => s + Math.max(0, (Number(r.total) || 0) - (Number(r.amountPaid) || 0)), 0));
      const apLedger = -(await accBalance(acc.ap)); // a liability holds a credit balance
      add("ap_ties", "Payables tie: open bills = AP ledger",
        Math.abs(apOpen - apLedger) < EPS ? "ok" : "fail",
        Math.abs(apOpen - apLedger) < EPS
          ? "open " + ui.money(apOpen) + " = AP " + ui.money(apLedger)
          : "open bills " + ui.money(apOpen) + " vs AP ledger " + ui.money(apLedger));
    } catch (e) { fail("ap_ties", "Payables tie: open bills = AP ledger", e); }

    /* 5. Inventory value ties to the ledger. */
    try {
      const acc = await accounts();
      const v = await inv.valuation();
      const invLedger = await accBalance(acc.inventory);
      add("inventory_ties", "Inventory value ties to the ledger",
        Math.abs(v.totalValue - invLedger) < EPS ? "ok" : "fail",
        Math.abs(v.totalValue - invLedger) < EPS
          ? "stock " + ui.money(v.totalValue) + " = ledger " + ui.money(invLedger)
          : "stock value " + ui.money(v.totalValue) + " vs ledger " + ui.money(invLedger));
    } catch (e) { fail("inventory_ties", "Inventory value ties to the ledger", e); }

    /* 6. Cash ties: the bank register equals the bank ledger balance. */
    try {
      const acc = await accounts();
      const reg = await fin.bankRegister();
      const bankLedger = await accBalance(acc.bank);
      add("cash_ties", "Cash ties: bank register = bank ledger",
        Math.abs(reg.balance - bankLedger) < EPS ? "ok" : "fail",
        Math.abs(reg.balance - bankLedger) < EPS
          ? "register " + ui.money(reg.balance) + " = ledger " + ui.money(bankLedger)
          : "register " + ui.money(reg.balance) + " vs ledger " + ui.money(bankLedger));
    } catch (e) { fail("cash_ties", "Cash ties: bank register = bank ledger", e); }

    /* 7. Balance-sheet identity (assets = liabilities + equity). */
    try {
      const bs = await fin.balanceSheet({ asOf: ui.today() });
      add("balance_sheet", "Balance sheet holds (assets = liabilities + equity)",
        Math.abs(bs.diff) < EPS ? "ok" : "fail",
        Math.abs(bs.diff) < EPS
          ? "assets " + ui.money(bs.assets) + " = L+E " + ui.money(bs.totalEquity)
          : "assets " + ui.money(bs.assets) + " vs L+E " + ui.money(bs.totalEquity) + " (diff " + ui.money(bs.diff) + ")");
    } catch (e) { fail("balance_sheet", "Balance sheet holds (assets = liabilities + equity)", e); }

    const failCount = checks.filter((c) => c.status === "fail").length;
    const errorCount = checks.filter((c) => c.status === "error").length;
    return {
      ok: failCount === 0 && errorCount === 0,
      failCount, errorCount, checks,
      ranAt: new Date().toISOString(),
    };
  };

  /* ─────────────────────────── auto re-check on finance actions (37) ─────────────────────────── */

  const MUTATORS = [
    "postJournal", "reverseJournal", "postSalesInvoice", "reverseInvoice",
    "postGoodsIn", "postGoodsOut", "postInventoryAdjustment", "postOpening",
    "postSupplierBill", "postSupplierPayment", "recordCustomerReceipt",
    "addBankEntry", "markCleared", "closePeriod", "reopenPeriod",
  ];

  let autoTimer = null;
  Q.autoEnabled = true;
  Q.setAuto = function (v) {
    Q.autoEnabled = !!v;
    if (!Q.autoEnabled && autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  };

  /* Schedule a (debounced) re-check after a finance mutation. */
  Q.scheduleAuto = function () {
    if (!Q.autoEnabled) return;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { autoTimer = null; Q.check(); }, 800);
  };

  /* Wrap the finance mutators so a successful posting re-checks the books.
     Transparent: same this/args/return; never throws into the caller. */
  function installWraps() {
    const fin = f();
    if (!fin || fin.__qualityWrapped) return;
    fin.__qualityWrapped = true;
    for (const name of MUTATORS) {
      const orig = fin[name];
      if (typeof orig !== "function") continue;
      fin[name] = async function (...args) {
        const res = await orig.apply(this, args);
        Q.scheduleAuto();
        return res;
      };
    }
  }

  /* ─────────────────────────── health state, dot & UI ─────────────────────────── */

  Q.lastResult = null;
  Q.onHealthChange = null;

  /* Run the invariants, store the result and surface it. Never throws. */
  Q.check = async function () {
    let res;
    try {
      res = await Q.invariants();
    } catch (e) {
      res = {
        ok: false, failCount: 0, errorCount: 1,
        checks: [{ key: "harness", label: "Health check itself ran", status: "error", detail: (e && e.message) || String(e) }],
        ranAt: new Date().toISOString(), error: true,
      };
    }
    Q.lastResult = res;
    updateDot(res);
    if (typeof Q.onHealthChange === "function") { try { Q.onHealthChange(res); } catch (e) {} }
    return res;
  };

  function updateDot(res) {
    const dot = document.getElementById("healthDot");
    if (!dot) return;
    const state = !res ? "gray" : (res.failCount ? "red" : (res.errorCount ? "amber" : "green"));
    dot.className = "erp-health-dot " + state;
    dot.title = !res
      ? "System health — not checked yet"
      : (res.failCount || res.errorCount) ? "System health — some checks need attention" : "System health — all checks passed";
  }

  /* The health modal opened from the topbar dot button. */
  Q.openHealthModal = async function () {
    const m = ui.modal({ title: "System health", size: "lg", body: '<div class="erp-health" data-qh></div>' });
    const body = m.querySelector("[data-qh]");
    if (body) await renderHealthInto(body, null);
  };

  /* The Reports → System health tab panel. */
  Q.renderHealth = async function (panel, refresh) {
    panel.innerHTML =
      ui.pageHead("System health", "The books always balance — these checks verify the double-entry ledger ties to every module, and re-run after every finance-affecting action.", "") +
      '<div class="erp-health" data-qh></div>';
    const body = panel.querySelector("[data-qh]");
    if (body) await renderHealthInto(body, refresh);
  };

  async function renderHealthInto(el, refresh) {
    el.innerHTML = '<div class="erp-state" data-state="loading"><div class="spinner"></div><h2>Running checks…</h2></div>';
    const res = Q.lastResult || await Q.check();
    const when = ui.dateTime(res.ranAt);
    const badge = res.ok
      ? ui.badge("All checks passed", "success")
      : ui.badge((res.failCount ? res.failCount + " failed" : "") + (res.errorCount ? (res.failCount ? " · " : "") + res.errorCount + " couldn't run" : ""), "danger");
    const rows = res.checks.map((c) => ({
      check: "<b>" + esc(c.label) + "</b>",
      status: ui.badge(c.status === "ok" ? "OK" : c.status === "fail" ? "FAIL" : "ERROR", c.status === "ok" ? "success" : c.status === "fail" ? "danger" : "warn"),
      detail: esc(c.detail || "—"),
      next: esc(Q.guide(c.key).nextStep),
    }));
    el.innerHTML =
      ui.summary([
        { label: "Status", value: badge },
        { label: "Checks", value: String(res.checks.length) },
        { label: "Last run", value: when },
      ]) +
      (rows.length ? ui.table([
        { key: "check", label: "Check" },
        { key: "status", label: "Status" },
        { key: "detail", label: "Detail" },
        { key: "next", label: "If it fails" },
      ], rows, { scroll: true }) : "") +
      '<div class="erp-btn-row">' + ui.btn("Run checks now", { primary: true, act: "q-run" }) + "</div>";
    const runBtn = el.querySelector("[data-act=q-run]");
    if (runBtn) runBtn.onclick = async () => { await Q.check(); await renderHealthInto(el, refresh); };
  }

  /* ─────────────────────────── recovery copy (39) ─────────────────────────── */

  /* Per-check guidance shown on the health screens. */
  const CHECK_GUIDES = {
    journal_balance: { nextStep: "Find the out-of-balance entry in Finance → Ledger and post a correcting or reversing entry so debits equal credits." },
    trial_balance: { nextStep: "Open Finance → Reports → Trial balance and drill into the difference — a missing or duplicated posting explains it." },
    ar_ties: { nextStep: "Compare Finance → Receivables with Sales → Invoices. A customer payment or credit note may be mis-applied; fix it from Finance → Receivables." },
    ap_ties: { nextStep: "Compare Finance → Payables with Purchasing → Bills. A supplier payment may be missing a bill allocation; record it under Purchasing." },
    inventory_ties: { nextStep: "Compare Inventory → Stock value with Finance → Reports. Post a stock adjustment (Inventory → Stock) so the movement log matches the ledger." },
    cash_ties: { nextStep: "Compare Finance → Bank with Finance → Ledger. Add or reconcile a bank entry so the register matches the ledger." },
    balance_sheet: { nextStep: "The balance-sheet identity broke — run the other checks first; an AR, AP, inventory or cash mismatch will show up there." },
    harness: { nextStep: "Reload the module and run checks again. If it persists, export a backup and share the error above." },
  };
  Q.guide = function (key) {
    return CHECK_GUIDES[key] || { nextStep: "Export a backup (Reports → Backup & restore), reload, and re-run the checks." };
  };

  /* Map a thrown error / error string to { title, message, nextStep }. */
  const ERROR_GUIDES = [
    { test: (s) => /document_too_large|too large|above the .* ceiling/i.test(s),
      title: "Document too large",
      message: "One document has grown past the per-document ceiling (4 MiB), so the save was refused.",
      nextStep: "Archive older fiscal years (Reports → Backup & restore → Archival) or split the data, then retry." },
    { test: (s) => /quota|over_daily_allowance|allowance/i.test(s),
      title: "Storage quota reached",
      message: "This device or the shared document store has used its daily storage allowance.",
      nextStep: "Wait for the allowance to reset, delete an old backup, or export a backup and trim the documents it holds." },
    { test: (s) => /edit ?key|editKey|edit key|key_not_found|not_found/i.test(s),
      title: "Lost edit key",
      message: "The document's edit key no longer matches the stored copy, so the save was refused.",
      nextStep: "Open Sync & conflicts, review the document and choose keep-theirs or keep-mine to re-establish a writable copy." },
    { test: (s) => /conflict|changed on another device/i.test(s),
      title: "Offline divergence",
      message: "The document changed on another device since this one last synced, so nothing was overwritten.",
      nextStep: "Open Sync & conflicts and review the divergence — keep mine, keep theirs, or merge field by field. Nothing has been lost." },
    { test: (s) => /corrupt_document|not valid JSON|schema mismatch|schema/i.test(s),
      title: "Schema mismatch or corrupt document",
      message: "A stored document is not a valid ERP document.",
      nextStep: "Restore from the latest backup (Reports → Backup & restore → Restore) or open Sync & conflicts to review the affected document." },
    { test: (s) => /unbalanced/i.test(s),
      title: "Unbalanced entry",
      message: "The entry's debits and credits don't match, so it was not posted.",
      nextStep: "Check the debit and credit lines — they must total the same amount. Adjust the entry and post again." },
    { test: (s) => /upload_plugin_unavailable/i.test(s),
      title: "Storage unavailable",
      message: "The document store could not reach its storage backend.",
      nextStep: "Check your connection and retry. Unsaved changes are kept locally and will sync when storage is available again." },
  ];
  Q.friendlyError = function (e) {
    const s = String((e && (e.message || e.error)) || e || "");
    const hit = ERROR_GUIDES.find((g) => g.test(s));
    if (hit) return { title: hit.title, message: hit.message, nextStep: hit.nextStep };
    return { title: "Something went wrong", message: s || "An unexpected error occurred.", nextStep: "Export a backup (Reports → Backup & restore) before retrying; contact support if it persists." };
  };

  /* ─────────────────────────── fixtures (38) ─────────────────────────── */

  Q.FIXTURES = {};

  /* Valid records for every module document (current schema). The
     round-trip suite saves each, loads it back and compares. */
  Q.FIXTURES.docs = {
    parties() {
      return [
        { id: 1, name: "Fixture Co", type: "customer", taxId: "F-1", paymentTerms: "net30", creditLimit: 5000, active: true, contacts: [{ id: 1, name: "Ann", email: "ann@fixture.co", phone: "", role: "manager" }], addresses: [], source: "fixture" },
        { id: 2, name: "Fixture Supplies", type: "supplier", taxId: "F-2", paymentTerms: "net60", creditLimit: 0, active: true, contacts: [], addresses: [], source: "fixture" },
      ];
    },
    catalog() {
      return [
        { id: 1, name: "Fixture Widget", sku: "FW-1", type: "product", uom: "ea", salePrice: 50, cost: 20, reorderPoint: 5, taxCode: "VAT20", active: true, supplierId: 2 },
        { id: 2, name: "Fixture Service", sku: "FS-1", type: "service", uom: "hr", salePrice: 120, cost: 0, reorderPoint: 0, taxCode: "VAT0", active: true, supplierId: null },
      ];
    },
    chart() {
      return [
        { id: 1, code: "1000", name: "Bank & cash", type: "asset", active: true, parent: null },
        { id: 2, code: "4000", name: "Sales revenue", type: "income", active: true, parent: null },
      ];
    },
    taxes() {
      return [
        { id: 1, code: "NONE", name: "No tax", rate: 0, active: true },
        { id: 2, code: "VAT20", name: "VAT 20%", rate: 20, active: true },
      ];
    },
    defaults() {
      return [{ id: "defaults", kind: "defaults", accounts: { bank: "1000", ar: "1100", inventory: "1200", taxPaid: "1300", ap: "2000", taxCollected: "2100", equity: "3000", retainedEarnings: "3100", salesRevenue: "4000", serviceRevenue: "4100", cogs: "5000", expense: "5100" } }];
    },
    settings() {
      return [
        { id: "profile", kind: "profile", companyName: "Fixture Ltd", legalName: "Fixture Ltd", address: "", city: "", country: "", currency: "USD", fiscalYearStartMonth: 1, taxScheme: "vat", email: "", phone: "", website: "" },
        { id: "numbering", kind: "numbering", prefixes: { invoice: "INV", quote: "QT", order: "SO", po: "PO" }, counters: { invoice: 3 }, pattern: "{prefix}-{seq}", pad: 4 },
      ];
    },
    crm() {
      return [
        { id: 1, kind: "record", partyId: 1, title: "Fixture follow-up", source: "phone", status: "open", owner: "", notes: "", dueDate: ui.addDays(ui.today(), 7), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 2, kind: "opportunity", partyId: 1, title: "Fixture deal", stage: "proposal", value: 1000, probability: 50, expectedClose: ui.addDays(ui.today(), 30), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ];
    },
    sales() {
      return [
        { id: 1, kind: "quote", num: "QT-0001", partyId: 1, date: ui.today(), validUntil: ui.addDays(ui.today(), 14), status: "sent", total: 120, subtotal: 100, taxTotal: 20, currency: "USD", lines: [{ lineNo: 1, itemId: 1, description: "Fixture Widget", qty: 2, unitPrice: 50, discountPct: 0, taxCode: "VAT20", taxRate: 20 }], notes: "" },
        { id: 2, kind: "invoice", num: "INV-0001", partyId: 1, date: ui.today(), status: "posted", total: 120, subtotal: 100, taxTotal: 20, amountPaid: 0, amountCredited: 0, currency: "USD", lines: [], dueDate: ui.addDays(ui.today(), 14) },
      ];
    },
    purchasing() {
      return [
        { id: 1, kind: "po", num: "PO-0001", supplierId: 2, date: ui.today(), expectedDate: ui.addDays(ui.today(), 7), status: "sent", total: 100, currency: "USD", lines: [{ lineNo: 1, itemId: 1, description: "Fixture Widget", qty: 5, unitCost: 20, taxCode: "VAT20", taxRate: 20 }], notes: "" },
        { id: 2, kind: "bill", num: "BILL-0001", supplierId: 2, date: ui.today(), status: "open", total: 120, subtotal: 100, taxTotal: 20, amountPaid: 0, currency: "USD", lines: [], dueDate: ui.addDays(ui.today(), 30) },
      ];
    },
    inventory() {
      return [
        { id: 100001, kind: "movement", type: "opening", itemId: 1, location: "Main", qty: 50, unitCost: 20, date: ui.today(), refType: "opening", refId: null, refNum: "", note: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ];
    },
    projects() {
      return [
        { id: 1, kind: "project", title: "Fixture project", projNum: "PRJ-0001", partyId: 1, status: "in_progress", budget: 5000, currency: "USD", startDate: ui.today(), endDate: "", source: "manual", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activity: [] },
        { id: 2, kind: "time", projectId: 1, date: ui.today(), hours: 3, description: "Fixture work", billable: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ];
    },
    finance() {
      return [
        { id: 1, kind: "journal", num: "JRNL-0001", date: ui.today(), period: ui.today().slice(0, 7), memo: "Fixture opening", source: "bank", refType: "", refId: null, refNum: "", lines: [{ account: "1000", debit: 1000, credit: 0, note: "" }, { account: "3000", debit: 0, credit: 1000, note: "" }], totalDebit: 1000, totalCredit: 1000, balanced: true, reverses: null, reversedBy: null, periodClosed: false, bankCleared: false, bankStatementRef: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ];
    },
    audit() {
      return [
        { id: Date.now(), ts: new Date().toISOString(), date: new Date().toISOString(), actor: "owner", action: "quality_fixture", targetType: "test", targetId: null, summary: "Quality fixture audit entry", meta: null },
      ];
    },
    archive() {
      return [
        { id: 1, originModule: "finance", originYear: 2025, originLabel: "Finance FY 2025", archivedAt: new Date().toISOString(), records: [{ id: 99, kind: "journal", num: "JRNL-OLD", date: "2025-06-01", memo: "Old", lines: [], totalDebit: 0, totalCredit: 0 }] },
      ];
    },
  };

  /* An older-schema document bundle (pre-dates fields the current
     pipeline writes) that consumers must still tolerate. */
  Q.FIXTURES.olderSchema = function (moduleId) {
    const m = ERP.getModule(moduleId);
    const logical = (m && m.doc && m.doc.name) || moduleId;
    return {
      schema: "erp-doc", schemaVersion: 0, doc: logical, year: null, rev: 2,
      updatedAt: new Date().toISOString(), updatedBy: "legacy",
      records: moduleId === "parties"
        ? [{ id: 5, name: "Legacy Co", type: "customer" }] // missing contacts/addresses/active/taxId
        : [{ id: 5, name: "Legacy", legacy: true }],
    };
  };

  /* Malformed payloads the store / modules must reject cleanly. */
  Q.FIXTURES.malformed = {
    badJson: "{ this is not json ",
    notErpDoc: { schema: "something-else", records: [] },
    missingRecords: { schema: "erp-doc", schemaVersion: 1 },
    unbalancedEntry: {
      date: null, memo: "Bad fixture entry", source: "manual",
      lines: [{ account: "1000", debit: 100, credit: 0 }, { account: "4000", debit: 0, credit: 90 }],
    },
    unknownAccountEntry: {
      date: null, memo: "Bad account", source: "manual",
      lines: [{ account: "1000", debit: 50, credit: 0 }, { account: "9999", debit: 0, credit: 50 }],
    },
  };

  /* Seed a small but complete world (party, supplier, product, stock,
     opening cash) for the chain fixture. Returns the created refs. */
  Q.FIXTURES.setup = async function () {
    await master.seed();
    const parties = await master.parties();
    const pCust = { id: master.nextId(parties), name: "Chain Co", type: "customer", taxId: "C-1", paymentTerms: "net30", creditLimit: 10000, active: true, contacts: [], addresses: [] };
    const pSupp = { id: master.nextId(parties.concat([pCust])), name: "Chain Supplies", type: "supplier", taxId: "S-1", paymentTerms: "net30", creditLimit: 0, active: true, contacts: [], addresses: [] };
    await master.saveParties(parties.concat([pCust, pSupp]));
    const cat = await master.catalog();
    const widget = { id: master.nextId(cat), name: "Chain Widget", sku: "CW-1", type: "product", uom: "ea", salePrice: 100, cost: 40, reorderPoint: 0, taxCode: "VAT20", active: true, supplierId: pSupp.id };
    await master.saveCatalog(cat.concat([widget]));
    await ERP.inventory.postOpening({ itemId: widget.id, qty: 50, unitCost: 40, location: "Main", date: ui.today() });
    await ERP.finance.addBankEntry({ type: "opening", amount: 10000, date: ui.today(), memo: "Opening cash", otherAccount: "3000" });
    if (f()) f().invalidate();
    if (i()) i().invalidate();
    return { cust: pCust, supp: pSupp, widget };
  };

  /* The full quote → order → delivery → invoice → payment chain. */
  Q.FIXTURES.chain = async function (refs) {
    const S = ERP.sales, F = ERP.finance;
    const line = { itemId: refs.widget.id, description: refs.widget.name, qty: 3, unitPrice: refs.widget.salePrice, discountPct: 0, taxCode: "VAT20", taxRate: 20 };
    const q = await S.createQuote({ partyId: refs.cust.id, date: ui.today(), validUntil: ui.addDays(ui.today(), 30), lines: [line], currency: "USD", notes: "" });
    await S.sendQuote(q);
    const o = await S.acceptQuote(q);
    await S.confirmOrder(o);
    await S.recordShipment(o, { [refs.widget.id]: 3 });
    await S.recordDelivery(o, { [refs.widget.id]: 3 });
    const inv = await S.invoiceFromOrder(o, { [refs.widget.id]: 3 });
    const rc = await F.recordCustomerReceipt({ partyId: refs.cust.id, date: ui.today(), amount: inv.total, method: "bank", ref: "CH-1", allocations: [{ invoiceId: inv.id, amount: inv.total }] });
    return { quote: q, order: o, invoice: inv, receipt: rc };
  };

  /* ─────────────────────────── boot ─────────────────────────── */

  function wireHealthButton() {
    const btn = document.getElementById("healthBtn");
    if (!btn || btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", () => Q.openHealthModal());
  }

  installWraps();
  wireHealthButton();
  // First health check shortly after boot so the dot means something
  // from the start (gated on auto so test runs can disable it).
  setTimeout(() => { if (Q.autoEnabled) Q.check(); }, 1500);
})();
