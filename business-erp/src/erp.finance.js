/* ============================================================
   BUSINESS ERP — Finance: ledger, AR/AP, bank & period close
   (Tasks 28–32)
   - Double-entry journals (28): every posting is a balanced set
     of debit/credit lines with a source-document reference and
     memo; unbalanced entries are rejected; posted entries are
     immutable except through a reversing entry.
   - Automatic postings map (29): every money/stock event posts to
     the configured accounts at its correct date — invoice →
     AR+revenue+tax, credit note → reverse, bill → inventory/expense
     +AP, goods receipt → inventory+AP, goods issue → COGS+inventory,
     supplier payment → AP+bank, customer receipt → bank+AR, stock
     adjustment/opening → inventory+equity. Any posting failure
     throws (naming the offending document) so the caller's action
     stops before its document is saved.
   - Receivables & payables (30): per-party aging buckets, statement
     views, and payment application with partial payments and splits
     across invoices.
   - Bank & cash (31): manual register plus a statement-matching
     workflow marking transactions cleared so reported cash
     reconciles to the bank statement.
   - Period close & financial statements (32): trial balance with
     drill-down, P&L and balance sheet for any date range, fiscal-
     period close that locks posting periods and rolls net income
     to retained earnings, and a documented reopen procedure.
   The module also hosts the Chart of accounts / Tax / Settings
   tabs (Tasks 8–9 UI).
   Data lives in the finance document (splitByYear: true) — every
   journal carries a `date` so postings land in the right fiscal
   year. Chart codes default to: 1000 bank, 1100 AR, 1200 inventory,
   1300 tax paid, 2000 AP, 2100 tax collected, 3000 equity, 3100
   retained earnings, 4000 sales, 4100 service, 5000 COGS, 5100
   expense.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const store = ERP.store;
  const master = ERP.master;
  const F = (ERP.finance = {});
  const esc = ui.esc;

  const AC = {
    bank: "1000", ar: "1100", inventory: "1200", taxPaid: "1300",
    ap: "2000", taxCollected: "2100", equity: "3000", retainedEarnings: "3100",
    salesRevenue: "4000", serviceRevenue: "4100", cogs: "5000", expense: "5100",
  };

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const money = (n) => ui.money(n);

  /* ─────────────────────────── finance doc ─────────────────────────── */

  let fcache = null;
  async function fdocs() {
    if (fcache) return fcache;
    const r = await store.loadDoc("finance", { all: true });
    fcache = (r.records || []).slice();
    return fcache;
  }
  F.records = fdocs;
  F.invalidate = () => { fcache = null; };
  async function fsave(list) {
    const r = await store.saveDoc("finance", list || []);
    fcache = (list || []).slice();
    return r;
  }
  async function reloadFinance() { F.invalidate(); return fdocs(); }

  async function accounts() {
    const a = await master.defaultsMap();
    return Object.assign({}, AC, a || {});
  }

  /* ─────────────────────────── date / period helpers ─────────────────────────── */

  function periodOf(date) {
    return String(date || ui.today()).slice(0, 7); // YYYY-MM
  }
  function inRange(date, from, to) {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }
  function lastDayOf(period) {
    const [y, m] = period.split("-").map(Number);
    return new Date(y, m, 0).getFullYear() + "-" + String(m).padStart(2, "0") + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0");
  }
  function periodLabel(period) {
    const [y, m] = String(period).split("-").map(Number);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (MONTHS[m - 1] || m) + " " + y;
  }

  /* ─────────────────────────── journals (28) ─────────────────────────── */

  function findPosting(list, refType, refId) {
    return (list || []).find((j) => j.kind === "journal" && j.refType === refType && String(j.refId) === String(refId)) || null;
  }

  /* Post one journal entry. `entry`: {date, memo, source, refType, refId,
     refNum, lines:[{account, debit, credit, note}]}. Throws on unbalanced
     lines, unknown accounts or a closed posting period. */
  F.postJournal = async function (entry, opts) {
    opts = opts || {};
    if ((entry.source || "manual") === "manual" && ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("post_journal");
    const list = await fdocs();
    const lines = (entry.lines || []).map((l) => ({
      account: String(l.account),
      debit: round2(l.debit),
      credit: round2(l.credit),
      note: l.note || "",
    })).filter((l) => l.debit > 0 || l.credit > 0);
    if (lines.length < 2) throw new Error("A journal entry needs at least two non-zero lines.");
    const chart = await master.chart();
    const chartCodes = {};
    chart.forEach((a) => { chartCodes[a.code] = a; });
    for (const l of lines) {
      if (!chartCodes[l.account]) throw new Error("Ledger posting failed: account " + l.account + " is not on the chart of accounts.");
    }
    let db = 0, cr = 0;
    for (const l of lines) { db += l.debit; cr += l.credit; }
    db = round2(db); cr = round2(cr);
    if (Math.abs(db - cr) > 0.01) {
      throw new Error("Unbalanced journal entry — debits " + money(db) + " vs credits " + money(cr) + ".");
    }
    const date = entry.date || ui.today();
    const period = periodOf(date);
    if (!opts.allowClosed) {
      const closed = list.find((r) => r.kind === "periodClose" && r.period === period);
      if (closed) throw new Error("Ledger posting blocked: period " + periodLabel(period) + " is closed (closed " + ui.date(closed.closedAt) + "). Reopen it or use an open period.");
    }
    const journal = {
      id: master.nextId(list), kind: "journal",
      num: entry.num || (await master.allocateNumber("journal")),
      date, period, memo: String(entry.memo || ""),
      source: entry.source || "manual",
      refType: entry.refType || "", refId: entry.refId != null ? entry.refId : null, refNum: entry.refNum || "",
      lines, totalDebit: db, totalCredit: cr, balanced: true,
      reverses: entry.reverses || null, reverseAmount: entry.reverseAmount != null ? round2(entry.reverseAmount) : null,
      reversedBy: null, periodClosed: false,
      bankCleared: false, bankStatementRef: "",
      createdAt: new Date().toISOString(), createdBy: ERP.role || "owner", updatedAt: new Date().toISOString(),
    };
    list.push(journal);
    await fsave(list);
    return journal;
  };

  /* Reversal of a posted journal: negated lines, full audit trail. */
  F.reverseJournal = async function (journal, reason, opts) {
    opts = opts || {};
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("reverse_journal");
    if (!journal || journal.kind !== "journal") throw new Error("Not a journal entry.");
    if (journal.reversedBy) throw new Error("Journal " + journal.num + " has already been reversed.");
    const list = await fdocs();
    const j = findPosting(list, "journal:" + journal.num, null) || list.find((x) => x.kind === "journal" && String(x.id) === String(journal.id));
    if (!j) throw new Error("Journal not found.");
    if (j.reversedBy) throw new Error("Journal " + j.num + " has already been reversed.");
    const lines = j.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, note: l.note }));
    if (!opts.allowClosed && j.periodClosed) {
      throw new Error("Journal " + j.num + " is in a closed period — reopen the period first (Period close).");
    }
    const rev = await F.postJournal({
      date: opts.date || ui.today(), memo: "Reversal of " + j.num + (reason ? " — " + reason : ""),
      source: "reversal", refType: "reversal", refId: j.id, refNum: j.num,
      reverses: j.id, lines,
    }, opts);
    j.reversedBy = rev.id;
    await fsave(list);
    return rev;
  };

  /* All journals, optionally filtered. */
  F.journals = async function (o) {
    o = o || {};
    const list = await fdocs();
    return list.filter((r) => r.kind === "journal")
      .filter((j) => inRange(j.date, o.from, o.to))
      .filter((j) => !o.source || j.source === o.source)
      .filter((j) => {
        if (!o.account) return true;
        return (j.lines || []).some((l) => String(l.account) === String(o.account));
      })
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id);
  };

  /* ─────────────────────────── automatic postings (29) ─────────────────────────── */

  function lineTotals(l) {
    l = l || {};
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    const sub = qty * price;
    const disc = sub * (Number(l.discountPct) || 0) / 100;
    const taxable = sub - disc;
    const tax = taxable * (Number(l.taxRate) || 0) / 100;
    return { taxable, tax };
  }

  async function revenueAccountFor(inv, l) {
    if (inv && inv.source === "project") return "4100";
    if (l && l.itemId != null) {
      const item = await master.catalogItem(l.itemId);
      if (item && item.type === "service") return "4100";
    }
    return "4000";
  }

  async function pushAccount(lines, account, debit, credit) {
    debit = round2(debit); credit = round2(credit);
    if (debit <= 0 && credit <= 0) return;
    const existing = lines.find((x) => x.account === account);
    if (existing) { existing.debit = round2(existing.debit + debit); existing.credit = round2(existing.credit + credit); }
    else lines.push({ account, debit, credit });
  }

  /* Invoice → Dr AR, Cr revenue (per line, sales vs service), Cr tax collected. */
  F.postSalesInvoice = async function (inv) {
    const list = await fdocs();
    const existing = findPosting(list, "invoice", inv.id);
    if (existing) return existing;
    const acc = await accounts();
    const lines = [];
    for (const l of (inv.lines || [])) {
      const t = lineTotals(l);
      if (t.taxable > 0.005) await pushAccount(lines, await revenueAccountFor(inv, l), 0, t.taxable);
      if (t.tax > 0.005) await pushAccount(lines, acc.taxCollected, 0, t.tax);
    }
    if (round2(inv.total) > 0.005) await pushAccount(lines, acc.ar, inv.total, 0);
    if (!lines.length) return null;
    return await F.postJournal({
      date: inv.date, memo: "Invoice " + inv.num + " — " + (inv.partyName || ("customer " + inv.partyId)),
      source: "invoice", refType: "invoice", refId: inv.id, refNum: inv.num, lines,
    });
  };

  /* Credit note → reverse the invoice's revenue/tax, credit AR. */
  F.reverseInvoice = async function (cn) {
    const list = await fdocs();
    const existing = findPosting(list, "creditNote", cn.id);
    if (existing) return existing;
    const salesRes = await store.loadDoc("sales");
    const inv = (salesRes.records || []).find((r) => r.kind === "invoice" && String(r.id) === String(cn.invoiceId));
    const orig = findPosting(list, "invoice", cn.invoiceId);
    if (!orig) throw new Error("Invoice " + (inv ? inv.num : cn.invoiceNum) + " has no ledger posting — its credit note cannot be posted.");
    const acc = await accounts();
    const invTotal = inv ? Number(inv.total) : Number(orig.totalDebit) || 0;
    if (!(invTotal > 0.005)) throw new Error("Cannot reverse a zero-value invoice.");
    const scale = Number(cn.amount) / invTotal;
    const lines = [];
    if (inv) {
      for (const l of (inv.lines || [])) {
        const t = lineTotals(l);
        if (t.taxable > 0.005) await pushAccount(lines, await revenueAccountFor(inv, l), round2(t.taxable * scale), 0);
        if (t.tax > 0.005) await pushAccount(lines, acc.taxCollected, round2(t.tax * scale), 0);
      }
    } else {
      for (const l of (orig.lines || [])) {
        if (String(l.account) === String(acc.ar)) continue;
        await pushAccount(lines, l.account, round2((l.credit || 0) * scale), 0);
      }
    }
    if (round2(cn.amount) > 0.005) await pushAccount(lines, acc.ar, 0, round2(cn.amount));
    return await F.postJournal({
      date: cn.date, memo: "Credit note " + cn.num + " against " + (inv ? inv.num : cn.invoiceNum) + (cn.reason ? " — " + cn.reason : ""),
      source: "creditNote", refType: "creditNote", refId: cn.id, refNum: cn.num,
      reverses: orig.id, reverseAmount: cn.amount, lines,
    });
  };

  /* Goods receipt → Dr Inventory, Cr AP (the supplier bill that follows
     books the input VAT only, so AP ties to the bill total). */
  F.postGoodsIn = async function (m) {
    const list = await fdocs();
    const existing = findPosting(list, "goodsIn", m.id);
    if (existing) return existing;
    const acc = await accounts();
    const value = round2((Number(m.qty) || 0) * (Number(m.unitCost) || 0));
    if (value <= 0.005) return null;
    const lines = [
      { account: acc.inventory, debit: value, credit: 0 },
      { account: acc.ap, debit: 0, credit: value },
    ];
    return await F.postJournal({
      date: m.date, memo: "Goods receipt " + (m.refNum || ("#" + m.id)) + (m.note ? " — " + m.note : ""),
      source: "goodsIn", refType: "goodsIn", refId: m.id, refNum: m.refNum || "", lines,
    });
  };

  /* Goods issue → Dr COGS, Cr Inventory at the moving-average cost. */
  F.postGoodsOut = async function (m) {
    const list = await fdocs();
    const existing = findPosting(list, "goodsOut", m.id);
    if (existing) return existing;
    const acc = await accounts();
    const value = round2((Number(m.qty) || 0) * (Number(m.unitCost) || 0));
    if (value <= 0.005) return null;
    const lines = [
      { account: acc.cogs, debit: value, credit: 0 },
      { account: acc.inventory, debit: 0, credit: value },
    ];
    return await F.postJournal({
      date: m.date, memo: "Goods issue " + (m.refNum || ("#" + m.id)) + (m.note ? " — " + m.note : ""),
      source: "goodsOut", refType: "goodsOut", refId: m.id, refNum: m.refNum || "", lines,
    });
  };

  /* Stock adjustment (+/-) → Inventory ↔ Equity. */
  F.postInventoryAdjustment = async function (m) {
    const list = await fdocs();
    const existing = findPosting(list, "adjustment", m.id);
    if (existing) return existing;
    const acc = await accounts();
    const value = round2((Number(m.qty) || 0) * (Number(m.unitCost) || 0));
    if (value === 0) return null;
    const lines = value > 0
      ? [{ account: acc.inventory, debit: value, credit: 0 }, { account: acc.equity, debit: 0, credit: value }]
      : [{ account: acc.equity, debit: -value, credit: 0 }, { account: acc.inventory, debit: 0, credit: -value }];
    return await F.postJournal({
      date: m.date, memo: "Stock adjustment " + (m.refNum || ("#" + m.id)) + (m.note ? " — " + m.note : ""),
      source: "adjustment", refType: "adjustment", refId: m.id, refNum: m.refNum || "", lines,
    });
  };

  /* Opening stock → Dr Inventory, Cr Equity. */
  F.postOpening = async function (m) {
    const list = await fdocs();
    const existing = findPosting(list, "opening", m.id);
    if (existing) return existing;
    const acc = await accounts();
    const value = round2((Number(m.qty) || 0) * (Number(m.unitCost) || 0));
    if (value <= 0.005) return null;
    const lines = [
      { account: acc.inventory, debit: value, credit: 0 },
      { account: acc.equity, debit: 0, credit: value },
    ];
    return await F.postJournal({
      date: m.date, memo: "Opening stock " + (m.refNum || ("#" + m.id)) + (m.note ? " — " + m.note : ""),
      source: "opening", refType: "opening", refId: m.id, refNum: m.refNum || "", lines,
    });
  };

  /* Supplier bill → Dr Inventory/Expense + input VAT, Cr AP. A bill created
     from a goods receipt only books the input VAT (inventory+AP already
     posted at receipt) so AP stays tied to the bill total. */
  F.postSupplierBill = async function (bill) {
    const list = await fdocs();
    const existing = findPosting(list, "bill", bill.id);
    if (existing) return existing;
    const acc = await accounts();
    const lines = [];
    if (bill.fromReceipt) {
      if (round2(bill.taxTotal) > 0.005) {
        await pushAccount(lines, acc.taxPaid, round2(bill.taxTotal), 0);
        await pushAccount(lines, acc.ap, 0, round2(bill.taxTotal));
      }
    } else {
      for (const l of (bill.lines || [])) {
        const sub = round2((Number(l.qty) || 0) * (Number(l.unitCost) || 0));
        if (sub <= 0.005) continue;
        let acct = acc.expense;
        if (l.itemId != null) {
          const item = await master.catalogItem(l.itemId);
          if (item && item.type === "product") acct = acc.inventory;
        }
        await pushAccount(lines, acct, sub, 0);
      }
      if (round2(bill.taxTotal) > 0.005) await pushAccount(lines, acc.taxPaid, round2(bill.taxTotal), 0);
      if (round2(bill.total) > 0.005) await pushAccount(lines, acc.ap, 0, round2(bill.total));
    }
    if (!lines.length) return null;
    return await F.postJournal({
      date: bill.date, memo: "Supplier bill " + bill.num + (bill.notes ? " — " + bill.notes : ""),
      source: "bill", refType: "bill", refId: bill.id, refNum: bill.num, lines,
    });
  };

  /* Supplier payment → Dr AP, Cr Bank. */
  F.postSupplierPayment = async function (pay) {
    const list = await fdocs();
    const existing = findPosting(list, "supplierPayment", pay.id);
    if (existing) return existing;
    const acc = await accounts();
    const amt = round2(pay.amount);
    if (amt <= 0.005) return null;
    const lines = [
      { account: acc.ap, debit: amt, credit: 0 },
      { account: acc.bank, debit: 0, credit: amt },
    ];
    return await F.postJournal({
      date: pay.date, memo: "Supplier payment " + pay.num + (pay.ref ? " — ref " + pay.ref : ""),
      source: "supplierPayment", refType: "supplierPayment", refId: pay.id, refNum: pay.num, lines,
    });
  };

  /* ─────────────────────────── receivables & payables (30) ─────────────────────────── */

  async function loadSales() {
    const r = await store.loadDoc("sales");
    return (r.records || []).slice();
  }
  async function loadPurch() {
    const r = await store.loadDoc("purchasing");
    return (r.records || []).slice();
  }

  function bucket(days) {
    if (days <= 0) return { key: "current", label: "Current" };
    if (days <= 30) return { key: "d30", label: "1–30" };
    if (days <= 60) return { key: "d60", label: "31–60" };
    if (days <= 90) return { key: "d90", label: "61–90" };
    return { key: "d90plus", label: "90+" };
  }

  function openAmount(rec) {
    return Math.max(0, round2(Number(rec.total || 0) - Number(rec.amountPaid || 0) - Number(rec.amountCredited || 0)));
  }

  /* AR aging from sales-doc invoices (incl. project progress invoices). */
  F.receivableAging = async function () {
    const salesDocs = await loadSales();
    const invoices = salesDocs.filter((r) => r.kind === "invoice");
    const now = ui.today();
    const rows = [];
    for (const inv of invoices) {
      const open = openAmount(inv);
      if (open <= 0.005) continue;
      const due = inv.dueDate || inv.date || now;
      const days = ui.diffDays(due, now);
      const b = bucket(days);
      rows.push({
        id: inv.id, num: inv.num, partyId: inv.partyId, date: inv.date, dueDate: due,
        total: Number(inv.total) || 0, open, days, bucket: b, currency: inv.currency,
      });
    }
    rows.sort((a, b) => a.days - b.days);
    const totals = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0, overdue: 0 };
    for (const r of rows) {
      totals[r.bucket.key] = round2(totals[r.bucket.key] + r.open);
      totals.total = round2(totals.total + r.open);
      if (r.days > 0) totals.overdue = round2(totals.overdue + r.open);
    }
    return { rows, totals };
  };

  /* AP aging from purchasing-doc bills. */
  F.payableAging = async function () {
    const purchDocs = await loadPurch();
    const bills = purchDocs.filter((r) => r.kind === "bill");
    const now = ui.today();
    const rows = [];
    for (const b of bills) {
      const open = openAmount(b);
      if (open <= 0.005) continue;
      const due = b.dueDate || b.date || now;
      const days = ui.diffDays(due, now);
      const bk = bucket(days);
      rows.push({
        id: b.id, num: b.num, supplierId: b.supplierId, date: b.date, dueDate: due,
        total: Number(b.total) || 0, open, days, bucket: bk, currency: b.currency,
      });
    }
    rows.sort((a, b) => a.days - b.days);
    const totals = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0, overdue: 0 };
    for (const r of rows) {
      totals[r.bucket.key] = round2(totals[r.bucket.key] + r.open);
      totals.total = round2(totals.total + r.open);
      if (r.days > 0) totals.overdue = round2(totals.overdue + r.open);
    }
    return { rows, totals };
  };

  /* Chronological customer statement with running balance. */
  F.customerStatement = async function (partyId) {
    const salesDocs = await loadSales();
    const events = [];
    for (const inv of salesDocs.filter((r) => r.kind === "invoice" && String(r.partyId) === String(partyId))) {
      events.push({ date: inv.date, num: inv.num, type: "invoice", refId: inv.id, amount: Number(inv.total) || 0 });
    }
    for (const cn of salesDocs.filter((r) => r.kind === "creditNote" && String(r.partyId) === String(partyId))) {
      events.push({ date: cn.date, num: cn.num, type: "credit", refId: cn.id, amount: -(Number(cn.amount) || 0) });
    }
    const fin = await fdocs();
    for (const rc of fin.filter((r) => r.kind === "receipt" && String(r.partyId) === String(partyId))) {
      events.push({ date: rc.date, num: rc.num, type: "payment", refId: rc.id, amount: -(Number(rc.amount) || 0) });
    }
    events.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.num.localeCompare(b.num));
    let bal = 0;
    for (const e of events) { bal = round2(bal + e.amount); e.balance = bal; }
    return { partyId, events, balance: bal };
  };

  /* Supplier statement from bills + payments. */
  F.supplierStatement = async function (supplierId) {
    const purchDocs = await loadPurch();
    const events = [];
    for (const b of purchDocs.filter((r) => r.kind === "bill" && String(r.supplierId) === String(supplierId))) {
      events.push({ date: b.date, num: b.num, type: "bill", refId: b.id, amount: Number(b.total) || 0 });
    }
    for (const p of purchDocs.filter((r) => r.kind === "payment" && String(r.supplierId) === String(supplierId))) {
      events.push({ date: p.date, num: p.num, type: "payment", refId: p.id, amount: -(Number(p.amount) || 0) });
    }
    events.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.num.localeCompare(b.num));
    let bal = 0;
    for (const e of events) { bal = round2(bal + e.amount); e.balance = bal; }
    return { supplierId, events, balance: bal };
  };

  /* Record a customer payment, applied to one or more invoices (partial /
     split). Writes back amountPaid on the invoices (sales doc), posts
     Dr Bank / Cr AR, and stores the receipt in the finance doc. */
  F.recordCustomerReceipt = async function (data) {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("receive_payment");
    if (data.partyId == null) throw new Error("Choose a customer.");
    const total = round2(Number(data.amount) || 0);
    if (!(total > 0)) throw new Error("Enter a payment amount greater than zero.");
    const allocsIn = data.allocations || [];
    if (!allocsIn.length) throw new Error("Apply the payment to at least one invoice.");
    const salesDocs = await loadSales();
    const allocs = [];
    let sum = 0;
    for (const a of allocsIn) {
      const inv = salesDocs.find((r) => r.kind === "invoice" && String(r.id) === String(a.invoiceId));
      if (!inv) throw new Error("Invoice not found for an allocation.");
      const open = openAmount(inv);
      const amt = round2(Number(a.amount) || 0);
      if (!(amt > 0)) throw new Error("Allocation amount must be positive for " + inv.num + ".");
      if (amt > open + 0.005) throw new Error("Allocation of " + money(amt) + " exceeds the open balance (" + money(open) + ") of " + inv.num + ".");
      allocs.push({ invoiceId: inv.id, invoiceNum: inv.num, amount: amt });
      sum = round2(sum + amt);
    }
    if (Math.abs(sum - total) > 0.01) throw new Error("Allocations (" + money(sum) + ") must total the payment (" + money(total) + ").");

    let allF = await fdocs();
    const receipt = {
      id: master.nextId(allF), kind: "receipt", num: await master.allocateNumber("payment"),
      partyId: Number(data.partyId), date: data.date || ui.today(), amount: total,
      method: data.method || "bank", ref: data.ref || "", allocations: allocs, status: "posted", ledgerEntries: null,
      createdAt: new Date().toISOString(), createdBy: ERP.role || "owner", updatedAt: new Date().toISOString(),
    };
    const acc = await accounts();
    const lines = [{ account: acc.bank, debit: total, credit: 0 }];
    for (const a of allocs) await pushAccount(lines, acc.ar, 0, a.amount);
    const j = await F.postJournal({
      date: receipt.date, memo: "Payment received " + receipt.num + (receipt.ref ? " — ref " + receipt.ref : ""),
      source: "customerReceipt", refType: "customerReceipt", refId: receipt.id, refNum: receipt.num, lines,
    });
    receipt.ledgerEntries = j ? { journalId: j.id, num: j.num } : null;

    for (const a of allocs) {
      const inv = salesDocs.find((r) => String(r.id) === String(a.invoiceId));
      if (inv) {
        inv.amountPaid = round2((Number(inv.amountPaid) || 0) + a.amount);
        if (inv.status !== "credited" && inv.amountPaid >= Number(inv.total) - 0.0001) inv.status = "paid";
      }
    }
    await store.saveDoc("sales", salesDocs);
    if (ERP.sales && typeof ERP.sales.invalidate === "function") ERP.sales.invalidate();

    allF = await reloadFinance();
    allF.push(receipt);
    await fsave(allF);
    await master.audit({ action: "receive_payment", targetType: "customer", targetId: receipt.partyId, summary: "Payment " + receipt.num + " (" + money(total) + ") from customer, applied to " + allocs.length + " invoice(s)." });
    return receipt;
  };

  /* ─────────────────────────── bank & cash (31) ─────────────────────────── */

  /* Manual bank entry — a journal touching the bank account. */
  F.addBankEntry = async function (data) {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("bank_entry");
    const type = data.type || "deposit";
    const amount = round2(Number(data.amount) || 0);
    if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");
    const acc = await accounts();
    const other = data.otherAccount || (type === "withdrawal" ? acc.expense : acc.equity);
    const lines = type === "withdrawal"
      ? [{ account: other, debit: amount, credit: 0 }, { account: acc.bank, debit: 0, credit: amount }]
      : [{ account: acc.bank, debit: amount, credit: 0 }, { account: other, debit: 0, credit: amount }];
    return await F.postJournal({
      date: data.date || ui.today(), memo: data.memo || ("Bank " + type),
      source: "bank", refType: "bank", refId: null, refNum: "", lines,
    });
  };

  /* The bank register, derived from every journal touching the bank account.
     amount > 0 = money in, amount < 0 = money out; balance runs from the
     opening entry. */
  F.bankRegister = async function () {
    const acc = await accounts();
    const list = await fdocs();
    const journals = list.filter((r) => r.kind === "journal" && (r.lines || []).some((l) => String(l.account) === String(acc.bank)))
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id);
    const rows = [];
    let balance = 0;
    for (const j of journals) {
      const line = (j.lines || []).find((l) => String(l.account) === String(acc.bank));
      const amount = round2((line ? line.debit : 0) - (line ? line.credit : 0));
      balance = round2(balance + amount);
      rows.push({
        journalId: j.id, num: j.num, date: j.date, memo: j.memo, source: j.source,
        refType: j.refType, refNum: j.refNum, amount, balance,
        cleared: !!j.bankCleared, statementRef: j.bankStatementRef || "",
      });
    }
    const cleared = rows.filter((r) => r.cleared).reduce((s, r) => s + r.amount, 0);
    const uncleared = rows.filter((r) => !r.cleared).reduce((s, r) => s + r.amount, 0);
    return { rows, balance, cleared: round2(cleared), uncleared: round2(uncleared) };
  };

  /* Statement matching: mark a register transaction cleared / uncleared. */
  F.markCleared = async function (journalId, cleared, statementRef) {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("clear_bank");
    const list = await fdocs();
    const j = list.find((r) => r.kind === "journal" && String(r.id) === String(journalId));
    if (!j) throw new Error("Journal not found.");
    j.bankCleared = !!cleared;
    j.bankStatementRef = statementRef || "";
    await fsave(list);
    return j;
  };

  /* ─────────────────────────── financial statements (32) ─────────────────────────── */

  /* Net debit/credit per account over a date range. */
  F.trialBalance = async function (o) {
    o = o || {};
    const accs = await master.chart();
    const codes = accs.slice().sort((a, b) => a.code.localeCompare(b.code));
    const map = {};
    codes.forEach((a) => { map[a.code] = { code: a.code, name: a.name, type: a.type, debit: 0, credit: 0 }; });
    const journals = await F.journals({ from: o.from, to: o.to });
    let totalDebit = 0, totalCredit = 0;
    for (const j of journals) {
      for (const l of j.lines) {
        const row = map[l.account] || (map[l.account] = { code: l.account, name: "Account " + l.account, type: "asset", debit: 0, credit: 0 });
        row.debit = round2(row.debit + l.debit);
        row.credit = round2(row.credit + l.credit);
        totalDebit = round2(totalDebit + l.debit);
        totalCredit = round2(totalCredit + l.credit);
      }
    }
    const rows = codes.map((a) => map[a.code]).filter((r) => r.debit > 0 || r.credit > 0)
      .map((r) => Object.assign({}, r, { balance: round2(r.debit - r.credit), abs: round2(Math.abs(r.debit - r.credit)) }));
    return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01, journals };
  };

  /* P&L for a date range. */
  F.profitLoss = async function (o) {
    o = o || {};
    const tb = await F.trialBalance({ from: o.from, to: o.to });
    const income = tb.rows.filter((r) => r.type === "income").map((r) => Object.assign({}, r, { net: round2(r.credit - r.debit) }));
    const expense = tb.rows.filter((r) => r.type === "expense").map((r) => Object.assign({}, r, { net: round2(r.debit - r.credit) }));
    const salesRevenue = income.find((r) => r.code === "4000");
    const serviceRevenue = income.find((r) => r.code === "4100");
    const cogs = expense.find((r) => r.code === "5000");
    const grossProfit = round2((salesRevenue ? salesRevenue.net : 0) + (serviceRevenue ? serviceRevenue.net : 0) - (cogs ? cogs.net : 0));
    const totalIncome = round2(income.reduce((s, r) => s + r.net, 0));
    const totalExpense = round2(expense.reduce((s, r) => s + r.net, 0));
    const netIncome = round2(totalIncome - totalExpense);
    return { income, expense, grossProfit, totalIncome, totalExpense, netIncome };
  };

  /* Balance sheet as of a date: A = L + E (+ current-period earnings). */
  F.balanceSheet = async function (o) {
    o = o || {};
    const tb = await F.trialBalance({ to: o.asOf });
    let assets = 0, liabilities = 0, equity = 0, currentEarnings = 0;
    const assetRows = [], liabRows = [], equityRows = [];
    for (const r of tb.rows) {
      if (r.type === "asset") { const v = round2(r.debit - r.credit); if (v) { assets = round2(assets + v); assetRows.push(Object.assign({}, r, { v })); } }
      else if (r.type === "liability") { const v = round2(r.credit - r.debit); if (v) { liabilities = round2(liabilities + v); liabRows.push(Object.assign({}, r, { v })); } }
      else if (r.type === "equity") { const v = round2(r.credit - r.debit); if (v) { equity = round2(equity + v); equityRows.push(Object.assign({}, r, { v })); } }
    }
    const pl = await F.profitLoss({ to: o.asOf });
    currentEarnings = pl.netIncome;
    const totalEquity = round2(equity + currentEarnings);
    const diff = round2(assets - liabilities - totalEquity);
    return { asOf: o.asOf, assets, assetRows, liabilities, liabRows, equity, equityRows, currentEarnings, totalEquity, diff };
  };

  /* Periods present in the journal (plus existing period-close records). */
  F.periods = async function () {
    const list = await fdocs();
    const set = {};
    for (const r of list) {
      if (r.kind === "journal" && r.period) set[r.period] = true;
      if (r.kind === "periodClose" && r.period) set[r.period] = true;
    }
    return Object.keys(set).sort();
  };

  /* Close a fiscal period (YYYY-MM): lock posting, roll income/expense to
     retained earnings via a closing journal, record the close. */
  F.closePeriod = async function (period, reason) {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("close_period");
    period = String(period || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Enter a period like 2025-06.");
    let list = await fdocs();
    if (list.find((r) => r.kind === "periodClose" && r.period === period)) {
      throw new Error("Period " + periodLabel(period) + " is already closed.");
    }
    const inPeriod = list.filter((r) => r.kind === "journal" && r.period === period);
    if (!inPeriod.length) throw new Error("No journal entries exist in period " + periodLabel(period) + ".");
    const pl = await F.profitLoss({ from: period + "-01", to: lastDayOf(period) });
    const acc = await accounts();
    const lines = [];
    for (const r of pl.income) if (r.net > 0.005) lines.push({ account: r.code, debit: round2(r.net), credit: 0 });
    for (const r of pl.expense) if (r.net > 0.005) lines.push({ account: r.code, debit: 0, credit: round2(r.net) });
    if (pl.netIncome > 0.005) lines.push({ account: acc.retainedEarnings, debit: 0, credit: round2(pl.netIncome) });
    else if (pl.netIncome < -0.005) lines.push({ account: acc.retainedEarnings, debit: round2(-pl.netIncome), credit: 0 });
    const j = await F.postJournal({
      date: lastDayOf(period), memo: "Close period " + periodLabel(period) + " — net income " + money(pl.netIncome) + (reason ? " (" + reason + ")" : ""),
      source: "periodClose", refType: "periodClose", refId: null, refNum: period, lines,
    }, { allowClosed: true });

    list = await reloadFinance();
    for (const r of list) {
      if (r.kind === "journal" && r.period === period) r.periodClosed = true;
    }
    const closeRec = {
      id: master.nextId(list), kind: "periodClose", period, date: lastDayOf(period),
      journalId: j.id, journalNum: j.num, netIncome: pl.netIncome,
      closedAt: new Date().toISOString(), closedBy: ERP.role || "owner", reason: reason || "",
    };
    list.push(closeRec);
    await fsave(list);
    await master.audit({ action: "close_period", targetType: "finance", targetId: 0, summary: "Closed period " + periodLabel(period) + " — net income " + money(pl.netIncome) + "." });
    return closeRec;
  };

  /* Reopen a closed period (documented procedure): reverse the closing
     journal (dated in the same period), remove the lock. Only safe if no
     later period depends on the closed books. */
  F.reopenPeriod = async function (period, reason) {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("reopen_period");
    period = String(period || "").slice(0, 7);
    let list = await fdocs();
    const closeRec = list.find((r) => r.kind === "periodClose" && r.period === period);
    if (!closeRec) throw new Error("Period " + periodLabel(period) + " is not closed.");
    const closing = list.find((r) => r.kind === "journal" && String(r.id) === String(closeRec.journalId));
    if (closing && !closing.reversedBy) {
      await F.reverseJournal(closing, "Reopen period " + periodLabel(period) + (reason ? " — " + reason : ""), { allowClosed: true, date: lastDayOf(period) });
    }
    list = await reloadFinance();
    for (const r of list) {
      if (r.kind === "journal" && r.period === period) r.periodClosed = false;
    }
    const idx = list.findIndex((r) => r.kind === "periodClose" && r.period === period);
    if (idx >= 0) list.splice(idx, 1);
    await fsave(list);
    await master.audit({ action: "reopen_period", targetType: "finance", targetId: 0, summary: "Reopened period " + periodLabel(period) + "." });
    return { period, reopened: true };
  };

  /* ─────────────────────────── chart / tax / settings helpers (8–9 UI) ─────────────────────────── */

  F.chartAccounts = async function () {
    const list = await master.chart();
    return list.slice().sort((a, b) => a.code.localeCompare(b.code));
  };
  F.saveChart = async function (list) {
    await master.saveChart(list.slice());
    return list;
  };
  F.taxRates = master.taxes;
  F.saveTaxes = master.saveTaxes;

  /* ─────────────────────────── UI ─────────────────────────── */

  function statementTable(events, emptyText) {
    return ui.table(
      [
        { key: "date", label: "Date", render: (r) => ui.date(r.date) },
        { key: "num", label: "Ref", render: (r) => "<b>" + esc(r.num) + "</b><div class=\"erp-sub\">" + (r.type === "invoice" ? "Invoice" : r.type === "credit" ? "Credit note" : r.type === "payment" ? "Payment" : "Bill") + "</div>" },
        { key: "amount", label: "Amount", align: "right", render: (r) => ui.money(r.amount) },
        { key: "balance", label: "Balance", align: "right", render: (r) => "<b>" + ui.money(r.balance) + "</b>" },
      ],
      events, { emptyText: emptyText || "No activity." }
    );
  }

  function agingSummary(totals, overdueLabel) {
    return ui.summary([
      { label: "Current", value: money(totals.current) },
      { label: "1–30", value: money(totals.d30) },
      { label: "31–60", value: money(totals.d60) },
      { label: "61–90", value: money(totals.d90) },
      { label: "90+", value: money(totals.d90plus) },
      { label: overdueLabel, value: money(totals.overdue), tone: totals.overdue > 0 ? "danger" : "" },
      { label: "Total", value: money(totals.total) },
    ]);
  }

  async function renderLedger(panel, state, refresh) {
    const { partiesMap, cur } = state;
    const journals = await F.journals({});
    const sources = {};
    for (const j of journals) sources[j.source] = true;
    const jList = journals.slice().reverse();
    panel.innerHTML =
      ui.form(
        '<div class="erp-form-row">' +
          ui.field("Date", '<input type="date" name="j-date" value="' + ui.today() + '">') +
          ui.text("j-memo", "Memo", "") +
          ui.select("j-source", "Source", ["manual", "invoice", "creditNote", "bill", "supplierPayment", "customerReceipt", "goodsIn", "goodsOut", "adjustment", "opening", "bank", "reversal", "periodClose"], "manual") +
        "</div>" +
        '<div class="erp-form-row">' +
          ui.field("Debit account", '<input type="text" name="j-db" placeholder="1100">') +
          ui.number("j-db-amt", "Debit", 0, { min: 0 }) +
          ui.field("Credit account", '<input type="text" name="j-cr" placeholder="4000">') +
          ui.number("j-cr-amt", "Credit", 0, { min: 0 }) +
        "</div>" +
        ui.btn("Post journal entry", { primary: true, act: "j-post" }),
        '<p class="erp-sub">Manual entries are immutable once posted — reverse them via the ledger below.</p>'
      ) +
      ui.card("Journal (" + jList.length + ")", ui.table(
        [
          { key: "num", label: "Entry", render: (r) => "<b>" + esc(r.num) + "</b>" + (r.reverses ? "<div class=\"erp-sub\">reverses " + esc(r.reverses) + "</div>" : "") },
          { key: "date", label: "Date", render: (r) => ui.date(r.date) },
          { key: "memo", label: "Memo", render: (r) => esc(r.memo) + (r.source !== "manual" ? " <span class=\"erp-sub\">(" + esc(r.source) + (r.refNum ? " " + esc(r.refNum) : "") + ")</span>" : "") },
          { key: "debit", label: "Debit", align: "right", render: (r) => money(r.totalDebit) },
          { key: "credit", label: "Credit", align: "right", render: (r) => money(r.totalCredit) },
          { key: "period", label: "Period", render: (r) => (r.periodClosed ? ui.badge("closed", "muted") : esc(periodLabel(r.period))) },
          { key: "actions", label: "", render: (r) => (r.reversedBy || r.source === "reversal" ? "" : ui.btn("Reverse", { small: true, act: "j-reverse", arg: String(r.id), title: "Post a reversing entry" })) },
        ],
        jList.slice(0, 200), { emptyText: "No journal entries yet — post one above, or create invoices, bills and payments." }
      ));

    const postBtn = panel.querySelector("[data-act=j-post]");
    if (postBtn) postBtn.onclick = async () => {
      const f = ui.collect(panel, ["j-date", "j-memo", "j-source", "j-db", "j-cr", "j-db-amt", "j-cr-amt"]);
      const lines = [];
      if (f["j-db"] && f["j-db-amt"] > 0) lines.push({ account: f["j-db"], debit: f["j-db-amt"], credit: 0 });
      if (f["j-cr"] && f["j-cr-amt"] > 0) lines.push({ account: f["j-cr"], debit: 0, credit: f["j-cr-amt"] });
      try {
        await F.postJournal({ date: f["j-date"], memo: f["j-memo"], source: f["j-source"], lines });
        ui.toast("Journal entry posted.");
        refresh();
      } catch (e) { alert(e.message); }
    };
    ui.bind(panel, "click", "[data-act=j-reverse]", async (t, e, act, arg) => {
      const j = journals.find((x) => String(x.id) === String(arg));
      if (!j) return;
      try {
        await F.reverseJournal(j, "Manual reversal");
        ui.toast("Reversing entry posted.");
        refresh();
      } catch (err) { alert(err.message); }
    });
    const openJ = (j) => {
      const m = ui.modal({ title: j.num + " — journal entry", size: "lg", body: "" });
      m.querySelector(".modal-body").innerHTML =
        "<p class=\"erp-sub\">" + esc(j.memo) + " · " + ui.date(j.date) + " · " + esc(j.source) + (j.refNum ? " · " + esc(j.refNum) : "") + (j.reversedBy ? " · reversed" : "") + "</p>" +
        ui.table(
          [
            { key: "account", label: "Account", render: (r) => esc(r.account) + " <span class=\"erp-sub\">" + esc(state.chartMap[r.account] || "") + "</span>" },
            { key: "debit", label: "Debit", align: "right", render: (r) => money(r.debit) },
            { key: "credit", label: "Credit", align: "right", render: (r) => money(r.credit) },
            { key: "note", label: "Note", render: (r) => esc(r.note || "—") },
          ],
          j.lines
        );
    };
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "j-open") { const j = journals.find((x) => String(x.id) === String(arg)); if (j) openJ(j); }
    });
    panel.querySelectorAll(".erp-table-wrap tbody tr").forEach((tr) => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => {
        const j = journals.slice().reverse()[tr.rowIndex - 1];
        if (j) openJ(j);
      });
    });
  }

  function renderReceivables(panel, state, refresh) {
    const { partiesAll, cur } = state;
    (async () => {
      const aging = await F.receivableAging();
      const partiesMap = {};
      partiesAll.forEach((p) => { partiesMap[String(p.id)] = p.name; });
      panel.innerHTML =
        agingSummary(aging.totals, "Overdue") +
        ui.card("Open receivables", ui.table(
          [
            { key: "num", label: "Invoice", render: (r) => "<b>" + esc(r.num) + "</b><div class=\"erp-sub\">" + ui.date(r.date) + " · due " + ui.date(r.dueDate) + "</div>" },
            { key: "party", label: "Customer", render: (r) => esc(partiesMap[String(r.partyId)] || "—") },
            { key: "bucket", label: "Age", render: (r) => ui.badge(r.bucket.label, r.days > 0 ? "danger" : "success") },
            { key: "open", label: "Open", align: "right", render: (r) => "<b>" + money(r.open) + "</b>" },
            { key: "actions", label: "", render: (r) => ui.btn("Statement", { small: true, act: "ar-stmt", arg: String(r.partyId) }) },
          ],
          aging.rows, { emptyText: "No open receivables — nothing is owed to you right now." }
        ) + '<div class="erp-btn-row">' + ui.btn("Record customer payment", { primary: true, act: "ar-pay" }) + "</div>");
      ui.bind(panel, "click", "[data-act=ar-pay]", () => openReceiptModal(state, refresh));
      ui.bind(panel, "click", "[data-act=ar-stmt]", async (t, e, act, arg) => {
        const st = await F.customerStatement(arg);
        const name = partiesMap[String(arg)] || ("customer " + arg);
        const m = ui.modal({ title: name + " — statement", size: "lg", body: "" });
        m.querySelector(".modal-body").innerHTML =
          "<p class=\"erp-sub\">Closing balance: <b>" + money(st.balance) + "</b></p>" +
          statementTable(st.events);
      });
    })();
  }

  function openReceiptModal(state, refresh) {
    const { partiesAll, salesInvoices, cur } = state;
    const m = ui.modal({
      title: "Record customer payment", size: "lg",
      body: ui.form(
        ui.field("Customer", ui.select("r-party", "", partiesAll.filter((p) => p.type === "customer" || p.type === "both").map((p) => ({ value: p.id, label: p.name })), "")),
        '<div class="erp-form-row">' +
          ui.dateInput("r-date", "Date", ui.today()) +
          ui.number("r-amount", "Amount", 0, { min: 0 }) +
          ui.text("r-method", "Method", "bank") +
          ui.text("r-ref", "Reference", "") +
        "</div>" +
        '<div class="erp-sub" data-r-alloc-ctn>Select a customer to allocate the payment.</div>' +
        ui.btn("Record payment", { primary: true, act: "r-save" })
      ),
    });
    const allocCtn = m.querySelector("[data-r-alloc-ctn]");
    const partySel = m.querySelector("[name=r-party]");
    const renderAllocs = () => {
      const pid = partySel.value;
      const invs = salesInvoices.filter((r) => r.kind === "invoice" && String(r.partyId) === String(pid));
      const open = invs.map((inv) => ({ inv, open: Math.max(0, Number(inv.total) - Number(inv.amountPaid || 0) - Number(inv.amountCredited || 0)) })).filter((x) => x.open > 0.005);
      if (!open.length) { allocCtn.innerHTML = '<p class="erp-alert">No open invoices for this customer.</p>'; return; }
      allocCtn.innerHTML =
        "<p class=\"erp-sub\">Allocate the payment across invoices (split allowed):</p>" +
        open.map((x) =>
          '<label class="erp-check-label"><input type="checkbox" data-alloc-check value="' + x.inv.id + '" checked> <b>' + esc(x.inv.num) + "</b> — open " + money(x.open) +
          ' <input type="number" step="any" min="0" data-alloc-amt="' + x.inv.id + '" value="' + x.open + '" style="width:110px"></label>'
        ).join("");
    };
    partySel.addEventListener("change", renderAllocs);
    renderAllocs();
    m.querySelector("[data-act=r-save]").onclick = async () => {
      const f = ui.collect(m, ["r-party", "r-date", "r-amount", "r-method", "r-ref"]);
      const allocations = [];
      m.querySelectorAll("[data-alloc-check]:checked").forEach((cb) => {
        const amtEl = m.querySelector('[data-alloc-amt="' + cb.value + '"]');
        allocations.push({ invoiceId: Number(cb.value), amount: amtEl ? Number(amtEl.value) || 0 : 0 });
      });
      try {
        const rc = await F.recordCustomerReceipt({ partyId: f["r-party"], date: f["r-date"], amount: f["r-amount"], method: f["r-method"], ref: f["r-ref"], allocations });
        ui.closeModal();
        ui.toast("Payment " + rc.num + " recorded (" + money(rc.amount) + ").");
        refresh();
      } catch (e) { alert(e.message); }
    };
  }

  function renderPayables(panel, state, refresh) {
    const { partiesAll, cur } = state;
    (async () => {
      const aging = await F.payableAging();
      const partiesMap = {};
      partiesAll.forEach((p) => { partiesMap[String(p.id)] = p.name; });
      panel.innerHTML =
        agingSummary(aging.totals, "Overdue") +
        ui.card("Open payables", ui.table(
          [
            { key: "num", label: "Bill", render: (r) => "<b>" + esc(r.num) + "</b><div class=\"erp-sub\">" + ui.date(r.date) + " · due " + ui.date(r.dueDate) + "</div>" },
            { key: "party", label: "Supplier", render: (r) => esc(partiesMap[String(r.supplierId)] || "—") },
            { key: "bucket", label: "Age", render: (r) => ui.badge(r.bucket.label, r.days > 0 ? "danger" : "success") },
            { key: "open", label: "Open", align: "right", render: (r) => "<b>" + money(r.open) + "</b>" },
            { key: "actions", label: "", render: (r) => ui.btn("Statement", { small: true, act: "ap-stmt", arg: String(r.supplierId) }) },
          ],
          aging.rows, { emptyText: "No open payables — nothing is owed right now." }
        ));
      ui.bind(panel, "click", "[data-act=ap-stmt]", async (t, e, act, arg) => {
        const st = await F.supplierStatement(arg);
        const name = partiesMap[String(arg)] || ("supplier " + arg);
        const m = ui.modal({ title: name + " — supplier statement", size: "lg", body: "" });
        m.querySelector(".modal-body").innerHTML =
          "<p class=\"erp-sub\">Closing balance: <b>" + money(st.balance) + "</b> (payments are recorded under Purchasing → Bills).</p>" +
          statementTable(st.events);
      });
    })();
  }

  function renderBank(panel, state, refresh) {
    (async () => {
      const reg = await F.bankRegister();
      const clearedSum = reg.cleared, unclearedSum = reg.uncleared;
      panel.innerHTML =
        ui.summary([
          { label: "Bank balance", value: money(reg.balance) },
          { label: "Cleared", value: money(clearedSum) },
          { label: "Uncleared", value: money(unclearedSum), tone: unclearedSum ? "warn" : "" },
        ]) +
        '<div class="erp-btn-row">' +
          ui.btn("Add deposit / withdrawal", { primary: true, act: "bk-add" }) +
          ui.btn("Reconcile with statement", { act: "bk-recon" }) +
        "</div>" +
        ui.card("Bank register", ui.table(
          [
            { key: "date", label: "Date", render: (r) => ui.date(r.date) },
            { key: "num", label: "Ref", render: (r) => "<b>" + esc(r.num) + "</b><div class=\"erp-sub\">" + esc(r.source) + "</div>" },
            { key: "memo", label: "Memo", render: (r) => esc(r.memo || "—") },
            { key: "amount", label: "Amount", align: "right", render: (r) => (r.amount >= 0 ? "" : "−") + ui.money(Math.abs(r.amount)) },
            { key: "balance", label: "Balance", align: "right", render: (r) => money(r.balance) },
            { key: "cleared", label: "Cleared", render: (r) => r.cleared ? ui.badge(r.statementRef || "cleared", "success") : ui.badge("uncleared", "muted") },
          ],
          reg.rows, { emptyText: "No bank activity yet. Record payments, receipts, or add a manual entry." }
        ));
      ui.bind(panel, "click", "[data-act=bk-add]", () => openBankEntryModal(state, refresh));
      ui.bind(panel, "click", "[data-act=bk-recon]", () => openReconcileModal(state, refresh));
    })();
  }

  function openBankEntryModal(state, refresh) {
    const { chartAll, cur } = state;
    const m = ui.modal({
      title: "Bank entry", size: "lg",
      body: ui.form(
        '<div class="erp-form-row">' +
          ui.dateInput("b-date", "Date", ui.today()) +
          ui.select("b-type", "Type", [{ value: "deposit", label: "Deposit (money in)" }, { value: "withdrawal", label: "Withdrawal (money out)" }, { value: "opening", label: "Opening balance" }], "deposit") +
          ui.number("b-amount", "Amount", 0, { min: 0 }) +
        "</div>" +
        ui.field("Other account (the other side of the entry)", ui.select("b-other", "", chartAll.map((a) => ({ value: a.code, label: a.code + " — " + a.name })), state.curDefaultOther)) +
        ui.text("b-memo", "Memo", "") +
        ui.btn("Post entry", { primary: true, act: "b-save" })
      ),
    });
    const typeSel = m.querySelector("[name=b-type]");
    const otherSel = m.querySelector("[name=b-other]");
    const suggest = () => {
      const t = typeSel.value;
      otherSel.value = t === "opening" ? state.accDefault.equity : (t === "withdrawal" ? state.accDefault.expense : state.accDefault.salesRevenue);
    };
    typeSel.addEventListener("change", suggest);
    suggest();
    m.querySelector("[data-act=b-save]").onclick = async () => {
      const f = ui.collect(m, ["b-date", "b-type", "b-amount", "b-other", "b-memo"]);
      try {
        await F.addBankEntry({ date: f["b-date"], type: f["b-type"], amount: f["b-amount"], otherAccount: f["b-other"], memo: f["b-memo"] });
        ui.closeModal();
        ui.toast("Bank entry posted.");
        refresh();
      } catch (e) { alert(e.message); }
    };
  }

  function openReconcileModal(state, refresh) {
    const { cur } = state;
    (async () => {
      const reg = await F.bankRegister();
      const m = ui.modal({
        title: "Reconcile with bank statement", size: "lg",
        body: "<p class=\"erp-sub\">Tick the transactions that appear on your bank statement, then enter the statement reference. The cleared total should match your statement's closing balance.</p>" +
          ui.table(
            [
              { key: "date", label: "Date", render: (r) => ui.date(r.date) },
              { key: "num", label: "Ref", render: (r) => "<b>" + esc(r.num) + "</b>" },
              { key: "memo", label: "Memo", render: (r) => esc(r.memo || "—") },
              { key: "amount", label: "Amount", align: "right", render: (r) => ui.money(r.amount) },
              { key: "cleared", label: "Cleared", render: (r) => '<input type="checkbox" data-clear="' + r.journalId + '"' + (r.cleared ? " checked" : "") + ">" },
              { key: "ref", label: "Statement ref", render: (r) => '<input type="text" data-stref="' + r.journalId + '" value="' + esc(r.statementRef) + '" style="width:120px">' },
            ],
            reg.rows, { emptyText: "No bank transactions to reconcile." }
          ) +
          '<div class="erp-btn-row">' + ui.btn("Save reconciliation", { primary: true, act: "r-save" }) + "</div>",
      });
      m.querySelector("[data-act=r-save]").onclick = async () => {
        const updates = [];
        m.querySelectorAll("[data-clear]").forEach((cb) => {
          const strefEl = m.querySelector('[data-stref="' + cb.getAttribute("data-clear") + '"]');
          updates.push({ journalId: cb.getAttribute("data-clear"), cleared: cb.checked, statementRef: strefEl ? strefEl.value : "" });
        });
        try {
          for (const u of updates) await F.markCleared(u.journalId, u.cleared, u.statementRef);
          ui.closeModal();
          ui.toast("Reconciliation saved.");
          refresh();
        } catch (e) { alert(e.message); }
      };
    })();
  }

  function renderReports(panel, state, refresh) {
    const { cur } = state;
    const from = panel.__from || (ui.today().slice(0, 8) + "01");
    const to = panel.__to || ui.today();
    (async () => {
      const tb = await F.trialBalance({ from, to });
      const pl = await F.profitLoss({ from, to });
      const bs = await F.balanceSheet({ asOf: to });
      const periods = await F.periods();
      const closedSet = {};
      const fin = await F.records();
      fin.forEach((r) => { if (r.kind === "periodClose") closedSet[r.period] = r; });
      panel.innerHTML =
        '<div class="erp-inline-form erp-filters">' +
          ui.dateInput("r-from", "", from) +
          ui.dateInput("r-to", "", to) +
          ui.btn("Apply", { act: "r-range", small: true }) +
        "</div>" +
        ui.grid([
          ui.card("Profit & loss", (pl.income.length || pl.expense.length) ?
            ui.table(
              [
                { key: "code", label: "Account" },
                { key: "name", label: "" },
                { key: "net", label: "Amount", align: "right" },
              ],
              pl.income.map((r) => Object.assign({}, r, { name: esc(r.name), net: ui.money(r.net) }))
                .concat(pl.expense.map((r) => Object.assign({}, r, { name: esc(r.name), net: "-" + ui.money(r.net) }))),
              {}
            ) + ui.summary([
              { label: "Gross profit", value: money(pl.grossProfit) },
              { label: "Net income", value: money(pl.netIncome), tone: pl.netIncome < 0 ? "danger" : "success" },
            ]) : '<p class="erp-alert">No activity in this range.</p>'),
          ui.card("Trial balance", (tb.rows.length ?
            ui.table(
              [
                { key: "code", label: "Code" },
                { key: "name", label: "Account" },
                { key: "debit", label: "Debit", align: "right", render: (r) => r.debit ? money(r.debit) : "—" },
                { key: "credit", label: "Credit", align: "right", render: (r) => r.credit ? money(r.credit) : "—" },
              ],
              tb.rows.concat([{ code: "", name: "<b>Totals</b>", debit: tb.totalDebit, credit: tb.totalCredit }]), {}
            ) + '<p class="erp-sub">' + (tb.balanced ? "Balanced ✓" : "NOT balanced — debits " + money(tb.totalDebit) + " vs credits " + money(tb.totalCredit)) + "</p>"
            : '<p class="erp-alert">No postings in this range.</p>')),
          ui.card("Balance sheet as of " + ui.date(to),
            ui.table(
              [
                { key: "name", label: "Item" },
                { key: "v", label: "Amount", align: "right" },
              ],
              bs.assetRows.map((r) => ({ name: r.code + " " + esc(r.name), v: money(r.v) }))
                .concat([{ name: "<b>Total assets</b>", v: "<b>" + money(bs.assets) + "</b>" }])
                .concat(bs.liabRows.map((r) => ({ name: r.code + " " + esc(r.name), v: money(r.v) })))
                .concat(bs.equityRows.map((r) => ({ name: r.code + " " + esc(r.name), v: money(r.v) })))
                .concat([{ name: "Current period earnings", v: money(bs.currentEarnings) }])
                .concat([{ name: "<b>Total liabilities + equity</b>", v: "<b>" + money(bs.totalEquity) + "</b>" }]),
              {}
            ) + '<p class="erp-sub">' + (Math.abs(bs.diff) < 0.01 ? "Balanced ✓" : "Difference: " + money(bs.diff)) + "</p>"),
          ui.card("Period close", periods.length ?
            '<div class="erp-form-row">' +
              ui.select("p-period", "", periods.map((p) => ({ value: p, label: periodLabel(p) })), panel.__pPeriod || "") +
              ui.btn(closedSet[panel.__pPeriod] ? "Reopen period" : "Close period", { primary: true, act: "p-close" }) +
            "</div>" +
            (closedSet[panel.__pPeriod]
              ? '<p class="erp-sub">Closed ' + ui.date(closedSet[panel.__pPeriod].closedAt) + " · net income " + money(closedSet[panel.__pPeriod].netIncome) + " · rolled to retained earnings (" + esc(closedSet[panel.__pPeriod].journalNum) + ").</p>"
              : '<p class="erp-sub">Closing locks postings for the period and rolls its net income into retained earnings.</p>')
            : '<p class="erp-alert">No journal periods yet — post invoices, bills or payments first.</p>' +
            '<p class="erp-sub">Reopen note: reopening a period is only safe if no later period depends on its closed books; it posts a reversing entry for the closing journal and lifts the lock.</p>'),
        ]);
      const fromEl = panel.querySelector("[name=r-from]"), toEl = panel.querySelector("[name=r-to]");
      if (fromEl) fromEl.addEventListener("change", (e) => { panel.__from = e.target.value; renderReports(panel, state, refresh); });
      if (toEl) toEl.addEventListener("change", (e) => { panel.__to = e.target.value; renderReports(panel, state, refresh); });
      ui.bind(panel, "click", "[data-act=r-range]", () => renderReports(panel, state, refresh));
      const pSel = panel.querySelector("[name=p-period]");
      if (pSel) pSel.addEventListener("change", (e) => { panel.__pPeriod = e.target.value; renderReports(panel, state, refresh); });
      ui.bind(panel, "click", "[data-act=p-close]", async () => {
        const period = pSel ? pSel.value : "";
        if (!period) { alert("Choose a period."); return; }
        const closed = closedSet[period];
        if (closed) {
          try {
            await F.reopenPeriod(period, "Manual reopen");
            ui.toast("Period " + periodLabel(period) + " reopened.");
            refresh();
          } catch (e) { alert(e.message); }
        } else {
          try {
            await F.closePeriod(period);
            ui.toast("Period " + periodLabel(period) + " closed.");
            refresh();
          } catch (e) { alert(e.message); }
        }
      });
    })();
  }

  function renderChart(panel, state, refresh) {
    (async () => {
      const chart = await F.chartAccounts();
      panel.innerHTML =
        ui.form(
          '<div class="erp-form-row">' +
            ui.text("c-code", "Code", "") +
            ui.text("c-name", "Name", "") +
            ui.select("c-type", "Type", [{ value: "asset", label: "Asset" }, { value: "liability", label: "Liability" }, { value: "equity", label: "Equity" }, { value: "income", label: "Income" }, { value: "expense", label: "Expense" }], "asset") +
            ui.btn("Add account", { primary: true, act: "c-add" }) +
          "</div>",
          '<p class="erp-sub">Codes are hierarchical (1000s assets, 2000s liabilities, 3000s equity, 4000s income, 5000s expenses). Changing a code here does not rewrite past postings.</p>'
        ) +
        ui.table(
          [
            { key: "code", label: "Code", render: (r) => "<b>" + esc(r.code) + "</b>" },
            { key: "name", label: "Name", render: (r) => esc(r.name) },
            { key: "type", label: "Type", render: (r) => ui.badge(r.type, r.type === "asset" || r.type === "expense" ? "info" : "warn") },
            { key: "active", label: "Active", render: (r) => (r.active === false ? ui.badge("inactive", "muted") : ui.badge("active", "success")) },
            { key: "actions", label: "", render: (r) => ui.btn(r.active === false ? "Activate" : "Deactivate", { small: true, act: "c-toggle", arg: String(r.code) }) },
          ],
          chart, { emptyText: "No accounts yet." }
        );
      ui.bind(panel, "click", "[data-act=c-add]", async () => {
        const f = ui.collect(panel, ["c-code", "c-name", "c-type"]);
        if (!f["c-code"] || !f["c-name"]) { alert("Code and name are required."); return; }
        const chart = await F.chartAccounts();
        if (chart.some((a) => a.code === f["c-code"])) { alert("That account code already exists."); return; }
        chart.push({ id: master.nextId(chart), code: f["c-code"], name: f["c-name"], type: f["c-type"], active: true, parent: null });
        await F.saveChart(chart);
        ui.toast("Account " + f["c-code"] + " added.");
        refresh();
      });
      ui.bind(panel, "click", "[data-act=c-toggle]", async (t, e, act, arg) => {
        const chart = await F.chartAccounts();
        const a = chart.find((x) => String(x.code) === String(arg));
        if (a) { a.active = a.active === false ? true : false; await F.saveChart(chart); refresh(); }
      });
    })();
  }

  function renderTax(panel, state, refresh) {
    (async () => {
      const taxes = await F.taxRates();
      panel.innerHTML =
        ui.form(
          '<div class="erp-form-row">' +
            ui.text("t-code", "Code", "") +
            ui.text("t-name", "Name", "") +
            ui.number("t-rate", "Rate %", 0, { min: 0 }) +
            ui.btn("Add tax rate", { primary: true, act: "t-add" }) +
          "</div>",
          '<p class="erp-sub">Tax codes are applied per line on quotes, orders, invoices, POs and bills.</p>'
        ) +
        ui.table(
          [
            { key: "code", label: "Code", render: (r) => "<b>" + esc(r.code) + "</b>" },
            { key: "name", label: "Name", render: (r) => esc(r.name) },
            { key: "rate", label: "Rate", align: "right", render: (r) => ui.pct(r.rate) },
            { key: "active", label: "Active", render: (r) => (r.active === false ? ui.badge("inactive", "muted") : ui.badge("active", "success")) },
            { key: "actions", label: "", render: (r) => ui.btn(r.active === false ? "Activate" : "Deactivate", { small: true, act: "t-toggle", arg: String(r.code) }) },
          ],
          taxes, { emptyText: "No tax rates yet." }
        );
      ui.bind(panel, "click", "[data-act=t-add]", async () => {
        const f = ui.collect(panel, ["t-code", "t-name", "t-rate"]);
        if (!f["t-code"]) { alert("A tax code is required."); return; }
        const taxes = await F.taxRates();
        if (taxes.some((t) => t.code === f["t-code"])) { alert("That tax code already exists."); return; }
        taxes.push({ id: master.nextId(taxes), code: f["t-code"], name: f["t-name"] || f["t-code"], rate: Number(f["t-rate"]) || 0, active: true });
        await F.saveTaxes(taxes);
        ui.toast("Tax rate " + f["t-code"] + " added.");
        refresh();
      });
      ui.bind(panel, "click", "[data-act=t-toggle]", async (t, e, act, arg) => {
        const taxes = await F.taxRates();
        const x = taxes.find((r) => r.code === arg);
        if (x) { x.active = x.active === false ? true : false; await F.saveTaxes(taxes); refresh(); }
      });
    })();
  }

  function renderSettings(panel, state, refresh) {
    const { cur } = state;
    (async () => {
      const s = await master.settings();
      const profile = s.profile || {};
      const numbering = s.numbering || {};
      const prefixKeys = ["quote", "order", "invoice", "creditNote", "po", "bill", "supplierPayment", "project", "journal"];
      panel.innerHTML =
        ui.card("Business profile", ui.form(
          ui.text("s-company", "Company name", profile.companyName) +
          ui.text("s-legal", "Legal name", profile.legalName) +
          ui.text("s-address", "Address", profile.address) +
          ui.text("s-city", "City", profile.city) +
          ui.text("s-country", "Country", profile.country) +
          ui.text("s-currency", "Currency", profile.currency) +
          ui.number("s-fy", "Fiscal year starts in month (1–12)", profile.fiscalYearStartMonth, { min: 1, max: 12 }) +
          ui.text("s-email", "Email", profile.email) +
          ui.text("s-phone", "Phone", profile.phone) +
          ui.text("s-website", "Website", profile.website) +
          ui.btn("Save profile", { primary: true, act: "s-profile" })
        )) +
        ui.card("Document numbering", '<div class="erp-form-row">' +
          prefixKeys.map((k) => ui.text("n-" + k, k, (numbering.prefixes || {})[k] || "")).join("") +
          "</div>" +
          '<div class="erp-btn-row">' + ui.btn("Save numbering", { primary: true, act: "s-numbering" }) + "</div>");
      ui.bind(panel, "click", "[data-act=s-profile]", async () => {
        const f = ui.collect(panel, ["s-company", "s-legal", "s-address", "s-city", "s-country", "s-currency", "s-fy", "s-email", "s-phone", "s-website"]);
        const list = await store.loadDoc("settings");
        const records = (list.records || []).slice();
        const profileRec = records.find((r) => r.kind === "profile");
        const numberingRec = records.find((r) => r.kind === "numbering");
        const updated = Object.assign({}, profileRec || master.DEFAULT_PROFILE, {
          companyName: f["s-company"], legalName: f["s-legal"], address: f["s-address"], city: f["s-city"],
          country: f["s-country"], currency: f["s-currency"], fiscalYearStartMonth: Number(f["s-fy"]) || 1,
          email: f["s-email"], phone: f["s-phone"], website: f["s-website"],
        });
        await store.saveDoc("settings", [updated, numberingRec].filter(Boolean));
        master.flush();
        ui.toast("Business profile saved.");
        refresh();
      });
      ui.bind(panel, "click", "[data-act=s-numbering]", async () => {
        const f = ui.collect(panel, prefixKeys.map((k) => "n-" + k));
        const list = await store.loadDoc("settings");
        const records = (list.records || []).slice();
        const profileRec = records.find((r) => r.kind === "profile");
        const numberingRec = records.find((r) => r.kind === "numbering");
        const numbering = Object.assign({}, numberingRec || master.DEFAULT_NUMBERING, {
          prefixes: Object.assign({}, (numberingRec || master.DEFAULT_NUMBERING).prefixes || {}),
        });
        for (const k of prefixKeys) numbering.prefixes[k] = f["n-" + k] || "";
        await store.saveDoc("settings", [profileRec, numbering].filter(Boolean));
        master.flush();
        ui.toast("Numbering saved (affects future documents).");
        refresh();
      });
    })();
  }

  /* ─────────────────────────── module renderer ─────────────────────────── */

  F.renderPanel = async function (ctx) {
    const el = ctx.el;
    let state;
    try {
      const chartAll = await master.chart();
      const partiesAll = await master.parties();
      const salesInvoices = (await store.loadDoc("sales")).records || [];
      const cur = await master.currency();
      const accDefault = await accounts();
      const chartMap = {};
      chartAll.forEach((a) => { chartMap[a.code] = a.name; });
      state = { chartAll, chartMap, partiesAll, salesInvoices, cur, accDefault, el };
    } catch (e) {
      ctx.error({ title: "Could not load Finance data", message: (e && e.message) || String(e) });
      return;
    }

    const counts = {
      ledger: (await F.journals({})).length,
      receivables: (await F.receivableAging()).rows.length,
      payables: (await F.payableAging()).rows.length,
      bank: (await F.bankRegister()).rows.length,
    };
    const tabDefs = [
      { id: "ledger", label: "Ledger", badge: String(counts.ledger) },
      { id: "receivables", label: "Receivables", badge: String(counts.receivables) },
      { id: "payables", label: "Payables", badge: String(counts.payables) },
      { id: "bank", label: "Bank", badge: String(counts.bank) },
      { id: "reports", label: "Reports" },
      { id: "chart", label: "Chart" },
      { id: "tax", label: "Tax" },
      { id: "settings", label: "Settings" },
    ];
    const active = el.__tab || "ledger";
    const t = ui.tabs(tabDefs, active);
    el.innerHTML = ui.pageHead("Finance", "Double-entry ledger, receivables & payables, bank and period close.", "") + t.html;

    const panels = {};
    el.querySelectorAll("[data-panel]").forEach((p) => { panels[p.getAttribute("data-panel")] = p; });
    el.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === active));

    ui.bind(el, "click", "[data-tab]", async (tEl) => {
      el.__tab = tEl.getAttribute("data-tab");
      ui.showTab(el, el.__tab);
      await renderPanel(el.__tab);
    });

    const refresh = async () => {
      F.invalidate();
      state.chartAll = await master.chart();
      state.partiesAll = await master.parties();
      state.salesInvoices = (await store.loadDoc("sales")).records || [];
      state.cur = await master.currency();
      state.chartMap = {};
      state.chartAll.forEach((a) => { state.chartMap[a.code] = a.name; });
      await renderPanel(el.__tab || "ledger");
    };

    const renderPanel = async (id) => {
      const p = panels[id];
      if (!p) return;
      if (id === "ledger") await renderLedger(p, state, refresh);
      else if (id === "receivables") await renderReceivables(p, state, refresh);
      else if (id === "payables") await renderPayables(p, state, refresh);
      else if (id === "bank") await renderBank(p, state, refresh);
      else if (id === "reports") await renderReports(p, state, refresh);
      else if (id === "chart") await renderChart(p, state, refresh);
      else if (id === "tax") await renderTax(p, state, refresh);
      else if (id === "settings") await renderSettings(p, state, refresh);
    };

    await renderPanel(active);
  };

  F.render = F.renderPanel;
})();
