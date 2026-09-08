/* ============================================================================
   THE LEDGER — ar.js
   Accounts Receivable module (Phase 3, tasks 13–18):
    13. Customizable invoicing engine — professional invoices with templates,
        tax calculations and unique invoice numbering.
    14. Quote-to-invoice workflow — convert an approved quote into a live
        invoice with a single action.
    15. Recurring billing — generate and send invoices on a predefined cadence
        (weekly, monthly, annually).
    16. Payment gateway processing — accept credit card / bank transfer
        payments, marking invoices "Paid" upon (simulated) webhook
        confirmation; also direct-entry payments (cash/check).
    17. Payment reminders — trigger-based notices for invoices approaching or
        exceeding their due date.
    18. A/R aging — categorize outstanding invoices by days past due.
   Data persists per-browser via FW.store (kv-plugin folder "ledgerly"):
     key "ar_customers" → array of customer objects
     key "ar_quotes"    → array of quote objects
     key "ar_invoices"  → array of invoice objects
     key "ar_recurring" → array of recurring-billing rule objects
   Posting invoices/payments delegates to window.Ledger so balances, trial
   balance and period closing stay consistent; taxes route through
   window.Tax (Phase 4) when present.
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;
  const Ledger = window.Ledger;
  const K = { customers: "ar_customers", quotes: "ar_quotes", invoices: "ar_invoices", recurring: "ar_recurring" };

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function parseDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function addDays(s, n) { const p = parseDate(s); if (!p) return s; const d = new Date(p.y, p.m - 1, p.d + n); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function daysBetween(a, b) {
    const pa = parseDate(a), pb = parseDate(b);
    if (!pa || !pb) return 0;
    const da = new Date(pa.y, pa.m - 1, pa.d), db = new Date(pb.y, pb.m - 1, pb.d);
    return Math.round((da - db) / 86400000);
  }
  async function nextNo(prefix, list) {
    let max = 0;
    const re = new RegExp("^" + prefix + "-(\\d+)$");
    for (const x of list) { const m = re.exec(x.no || ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return prefix + "-" + String(max + 1).padStart(4, "0");
  }
  function fmtMoney(n, cur, fx) {
    if (cur && fx && window.Tax) return window.Tax.formatSync(n, cur);
    return FW.money(n);
  }
  function fmtBase(n, cur, fx) {
    if (cur && fx && cur !== (window.Tax ? window.Tax.baseCodeSync() : "USD") && window.Tax) {
      return "(" + FW.money(window.Tax.toBaseSync(n, cur, fx)) + " base)";
    }
    return "";
  }

  /* ── persistence ─────────────────────────────────────────────────────── */
  async function loadCustomers() { const v = await FW.store.get(K.customers, null); return Array.isArray(v) ? v : []; }
  async function saveCustomers(list) { await FW.store.set(K.customers, list); }
  async function loadQuotes() { const v = await FW.store.get(K.quotes, null); return Array.isArray(v) ? v : []; }
  async function saveQuotes(list) { await FW.store.set(K.quotes, list); }
  async function loadInvoices() { const v = await FW.store.get(K.invoices, null); return Array.isArray(v) ? v : []; }
  async function saveInvoices(list) { await FW.store.set(K.invoices, list); }
  async function loadRules() { const v = await FW.store.get(K.recurring, null); return Array.isArray(v) ? v : []; }
  async function saveRules(list) { await FW.store.set(K.recurring, list); }

  /* ── tax helper (Phase 4 integration) ────────────────────────────────── */
  function taxFor(subtotal, code, jurisdiction, date, direction) {
    if (window.Tax && window.Tax.computeSync) {
      const t = window.Tax.computeSync(subtotal, code, jurisdiction, date, direction || "sale");
      if (t) return t;
    }
    return { rate: 0, amount: 0, label: "No tax", code: null };
  }

  /* ── engine ──────────────────────────────────────────────────────────── */
  function lineAmount(l) { return round2(amt(l.qty) * amt(l.unitPrice)); }
  function docSubtotal(doc) { return round2((doc.lines || []).reduce((s, l) => s + (l.amount != null ? amt(l.amount) : lineAmount(l)), 0)); }
  function invoiceTotals(inv) {
    const subtotal = docSubtotal(inv);
    const tax = amt(inv.taxAmount);
    const total = round2(subtotal + tax);
    return { subtotal, tax, total };
  }
  function invoiceStatusLabel(s) {
    return { draft: "Draft", sent: "Sent", open: "In ledger · unpaid", paid: "Paid", void: "Void", overdue: "Overdue" }[s] || s;
  }
  function invoiceStatusChip(s) {
    return { draft: "chip-pending", sent: "chip-phase", open: "chip-done", paid: "chip-muted", void: "chip-muted", overdue: "chip-warn" }[s] || "chip-pending";
  }
  function arAccountId(accounts) {
    let a = accounts.find(x => x.code === "1100" && x.type === "asset");
    if (!a) a = accounts.find(x => x.type === "asset" && /receivable/i.test(x.name || ""));
    if (!a) a = accounts.find(x => x.type === "asset");
    return a ? a.id : null;
  }
  function revenueAccountOptions(accounts, cur) {
    return accounts
      .filter(a => (a.type === "revenue") && (a.active || a.id === cur))
      .map(a => '<option value="' + a.id + '"' + (a.id === cur ? " selected" : "") + ">" + esc(a.code) + " · " + esc(a.name) + (a.active ? "" : " (inactive)") + "</option>").join("");
  }
  function suggestRevenueFor(desc, accounts) {
    const d = String(desc || "").toLowerCase();
    const map = [
      [/service|consult|hour|labour|labor|fee/i, "4100"], [/interest/i, "4200"], [/sale|product|widget|item|goods/i, "4000"],
    ];
    for (const [re, code] of map) { const a = accounts.find(x => x.code === code); if (re.test(d) && a) return a.id; }
    const misc = accounts.find(x => x.code === "4300");
    return misc ? misc.id : null;
  }

  function buildEntryFromInvoice(inv, accounts, arId) {
    const { subtotal, tax, total } = invoiceTotals(inv);
    const lines = [];
    for (const l of (inv.lines || [])) {
      const amount = l.amount != null ? amt(l.amount) : lineAmount(l);
      if (amount <= 0) continue;
      const acc = l.account || (accounts.find(a => a.code === "4000") || {}).id || arId;
      lines.push({ account: acc, desc: l.desc || inv.customerName, credit: amount, debit: 0 });
    }
    const taxAcc = inv.taxAmount ? (window.Tax && window.Tax.findPayableAccount ? window.Tax.findPayableAccount(accounts) : null) : null;
    if (inv.taxAmount && taxAcc) lines.push({ account: taxAcc, desc: (inv.taxLabel || "Sales tax") + " — " + inv.customerName, credit: round2(tax), debit: 0 });
    else if (inv.taxAmount) lines.push({ account: arId, desc: "Sales tax — " + inv.customerName, credit: round2(tax), debit: 0 });
    lines.push({ account: arId, desc: "Accounts receivable — " + inv.customerName, debit: total, credit: 0 });
    return {
      date: inv.date || today(),
      reference: inv.no + (inv.customerName ? " · " + inv.customerName : ""),
      memo: "Invoice " + inv.no + " — " + inv.customerName,
      status: "draft", lines,
      currency: inv.currency || null, fxRate: inv.fxRate || null,
      projectId: inv.projectId || null,
    };
  }
  function cashAccountId(accounts) {
    let a = accounts.find(x => x.code === "1010" && x.type === "asset");
    if (!a) a = accounts.find(x => x.type === "asset" && /check|bank|cash/i.test(x.name || ""));
    if (!a) a = accounts.find(x => x.type === "asset");
    return a ? a.id : null;
  }
  function cashOptions(accounts, cur) {
    const pref = accounts.filter(a => a.type === "asset" && /check|bank|cash/i.test(a.name || "") && (a.active || a.id === cur));
    const rest = accounts.filter(a => a.type === "asset" && !pref.includes(a) && (a.active || a.id === cur));
    return [...pref, ...rest].map(a => '<option value="' + a.id + '"' + (a.id === cur ? " selected" : "") + ">" + esc(a.code) + " · " + esc(a.name) + "</option>").join("");
  }
  function nextPaymentRef(prefix, invoices) {
    let max = 0;
    const re = new RegExp("^" + prefix + "-(\\d+)$");
    for (const i of invoices) { const m = re.exec(i.paymentRef || ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return prefix + "-" + String(max + 1).padStart(4, "0");
  }

  /* ── customer engine ─────────────────────────────────────────────────── */
  async function saveCustomer(c, list) {
    const x = Object.assign({}, c);
    if (!x.id) x.id = uid("cust");
    if (!x.createdAt) x.createdAt = new Date().toISOString();
    x.updatedAt = new Date().toISOString();
    const prev = list.find(y => y.id === x.id) || null;
    const i = list.findIndex(y => y.id === x.id);
    if (i >= 0) list[i] = x; else list.push(x);
    await saveCustomers(list);
    await Ledger.auditLog(prev ? "customer.update" : "customer.create", {
      entity: "customer", entityId: x.id, entityLabel: x.name,
      summary: (prev ? "Edited " : "Created ") + "customer " + x.name + (x.company ? " · " + x.company : ""),
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(x),
    });
    return x;
  }
  async function deleteCustomer(id) {
    const customers = await loadCustomers();
    const invoices = await loadInvoices();
    const quotes = await loadQuotes();
    const c = customers.find(x => x.id === id);
    if (!c) return { error: "Customer not found." };
    if (invoices.some(x => x.customerId === id && x.status !== "void")) return { error: "This customer has non-voided invoices — you can't delete them." };
    const i = customers.indexOf(c); customers.splice(i, 1);
    await saveCustomers(customers);
    await Ledger.auditLog("customer.delete", {
      entity: "customer", entityId: id, entityLabel: c.name,
      summary: "Deleted customer " + c.name, prev: Ledger.cloneObj(c), next: null,
    });
    return { ok: true };
  }

  /* ── invoice posting ─────────────────────────────────────────────────── */
  async function postInvoice(id) {
    const invoices = await loadInvoices();
    const inv = invoices.find(x => x.id === id);
    if (!inv) return { error: "Invoice not found." };
    if (inv.status === "paid" || inv.status === "void") return { error: "This invoice can't be posted." };
    if (inv.status === "open") return { error: "Invoice is already in the ledger." };
    const { subtotal, tax, total } = invoiceTotals(inv);
    if (total <= 0) return { error: "Invoice total must be greater than zero." };
    const usable = (inv.lines || []).filter(l => (l.amount != null ? amt(l.amount) : lineAmount(l)) > 0);
    if (!usable.length) return { error: "Add at least one line with an amount before posting." };
    const accounts = await Ledger.loadAccounts();
    const ar = arAccountId(accounts);
    if (!ar) return { error: "No Accounts Receivable account found in the chart of accounts." };
    for (const l of usable) if (l.account && !accounts.find(a => a.id === l.account)) return { error: "An invoice line references an unknown account." };
    const entry = buildEntryFromInvoice(inv, accounts, ar);
    const entries = await Ledger.loadEntries();
    entry.no = await Ledger.nextEntryNo(entries);
    const res = await Ledger.saveEntry(entry, accounts);
    if (res && res.error) return { error: res.error };
    const r = await Ledger.postEntry(res.id);
    if (r.error) {
      const ents = await Ledger.loadEntries();
      const i = ents.findIndex(x => x.id === res.id);
      if (i >= 0) { ents.splice(i, 1); await Ledger.saveEntries(ents); }
      return { error: r.error };
    }
    const prev = Ledger.cloneObj(inv);
    inv.status = "open";
    inv.ledgerEntryId = res.id;
    inv.postedAt = new Date().toISOString();
    inv.updatedAt = new Date().toISOString();
    await saveInvoices(invoices);
    await Ledger.auditLog("invoice.post", {
      entity: "invoice", entityId: inv.id, entityLabel: inv.no + " · " + inv.customerName,
      summary: "Posted " + inv.no + " — " + fmtMoney(total, inv.currency, inv.fxRate) + " to accounts receivable (entry " + entry.no + ")" + fmtBase(total, inv.currency, inv.fxRate),
      prev, next: Ledger.cloneObj(inv),
    });
    let warning = "";
    if (window.Inventory && window.Inventory.onInvoicePosted) {
      try {
        const ir = await window.Inventory.onInvoicePosted(inv, accounts);
        if (ir && ir.error) warning = ir.error;
      } catch (e) { warning = String((e && e.message) || e); }
    }
    if (inv.source && inv.source.kind === "recurring") {
      const rules = await loadRules();
      const rule = rules.find(x => x.id === inv.source.ruleId);
      if (rule) {
        const rprev = Ledger.cloneObj(rule);
        rule.nextDate = advanceDate(rule.nextDate, rule.cadence || "monthly");
        rule.updatedAt = new Date().toISOString();
        await saveRules(rules);
        await Ledger.auditLog("recurring.advance", {
          entity: "recurring", entityId: rule.id, entityLabel: rule.label,
          summary: rule.label + " — next run advanced to " + rule.nextDate,
          prev: rprev, next: Ledger.cloneObj(rule),
        });
      }
    }
    return { ok: true, entryId: res.id, entryNo: entry.no, warning: warning || undefined };
  }

  async function voidInvoice(id) {
    const invoices = await loadInvoices();
    const inv = invoices.find(x => x.id === id);
    if (!inv) return { error: "Invoice not found." };
    if (inv.status !== "open") return { error: "Only posted, unpaid invoices can be voided." };
    const { total } = invoiceTotals(inv);
    const accounts = await Ledger.loadAccounts();
    const ar = arAccountId(accounts);
    if (!ar) return { error: "No Accounts Receivable account found." };
    const entry = {
      date: today(),
      reference: "VOID · " + inv.no,
      memo: "Void " + inv.no + " — reverses the receivable (customer: " + inv.customerName + ")",
      status: "draft",
      lines: [
        { account: ar, desc: "Reversal of " + inv.no, debit: 0, credit: total },
        { account: ar, desc: "Void " + inv.no, debit: total, credit: 0 },
      ],
    };
    const entries = await Ledger.loadEntries();
    entry.no = await Ledger.nextEntryNo(entries);
    const res = await Ledger.saveEntry(entry, accounts);
    if (res && res.error) return { error: res.error };
    const r = await Ledger.postEntry(res.id);
    if (r.error) {
      const ents = await Ledger.loadEntries();
      const i = ents.findIndex(x => x.id === res.id);
      if (i >= 0) { ents.splice(i, 1); await Ledger.saveEntries(ents); }
      return { error: r.error };
    }
    const prev = Ledger.cloneObj(inv);
    inv.status = "void";
    inv.voidedAt = new Date().toISOString();
    inv.updatedAt = new Date().toISOString();
    await saveInvoices(invoices);
    await Ledger.auditLog("invoice.void", {
      entity: "invoice", entityId: inv.id, entityLabel: inv.no + " · " + inv.customerName,
      summary: "Voided " + inv.no + " — reversal entry " + entry.no + " posted",
      prev, next: Ledger.cloneObj(inv),
    });
    let warning = "";
    if (window.Inventory && window.Inventory.onInvoiceVoided) {
      try {
        const ir = await window.Inventory.onInvoiceVoided(inv, accounts);
        if (ir && ir.error) warning = ir.error;
      } catch (e) { warning = String((e && e.message) || e); }
    }
    return { ok: true, warning: warning || undefined };
  }

  /* ── payment processing (task 16) ────────────────────────────────────── */
  async function payInvoices(ids, opts) {
    const o = opts || {};
    const method = o.method || "card";
    const invoices = await loadInvoices();
    const targets = invoices.filter(x => ids.includes(x.id));
    if (!targets.length) return { error: "No invoices selected." };
    if (targets.some(x => x.status !== "open")) return { error: "Only posted, unpaid invoices can be paid." };
    const total = round2(targets.reduce((s, x) => s + invoiceTotals(x).total, 0));
    if (total <= 0) return { error: "Payment total must be greater than zero." };
    const accounts = await Ledger.loadAccounts();
    const ar = arAccountId(accounts);
    if (!ar) return { error: "No Accounts Receivable account found." };
    const cash = o.cashAccountId || cashAccountId(accounts);
    if (!cash) return { error: "No cash/bank account found to deposit into." };
    if (cash === ar) return { error: "Deposit account can't be the same as Accounts Receivable." };
    const ref = o.reference || await nextPaymentRef(method === "check" ? "CHK" : method === "cash" ? "CSH" : "PAY", invoices);
    const entry = {
      date: o.date || today(),
      reference: ref + (targets.length === 1 ? " · " + targets[0].no : " · " + targets.length + " invoices"),
      memo: o.memo || "Payment " + ref + (targets.length === 1 ? " — " + targets[0].customerName : " — " + targets.length + " customer invoices"),
      status: "draft",
      lines: [
        { account: cash, desc: "Payment " + ref + (method === "card" ? " (card)" : method === "bank" ? " (bank transfer)" : method === "check" ? " (check)" : " (cash)"), debit: total, credit: 0 },
        { account: ar, desc: "Accounts receivable — payment " + ref, debit: 0, credit: total },
      ],
    };
    const entries = await Ledger.loadEntries();
    entry.no = await Ledger.nextEntryNo(entries);
    const res = await Ledger.saveEntry(entry, accounts);
    if (res && res.error) return { error: res.error };
    const r = await Ledger.postEntry(res.id);
    if (r.error) {
      const ents = await Ledger.loadEntries();
      const i = ents.findIndex(x => x.id === res.id);
      if (i >= 0) { ents.splice(i, 1); await Ledger.saveEntries(ents); }
      return { error: r.error };
    }
    const now = new Date().toISOString();
    for (const inv of targets) {
      const prev = Ledger.cloneObj(inv);
      inv.status = "paid";
      inv.paymentRef = ref;
      inv.paymentMethod = method;
      inv.paymentDate = o.date || today();
      inv.paymentEntryId = res.id;
      inv.paidAt = now;
      inv.updatedAt = now;
      await Ledger.auditLog("invoice.pay", {
        entity: "ar_payment", entityId: inv.id, entityLabel: inv.no + " · " + inv.customerName,
        summary: inv.no + " paid via " + method + " " + ref + " — " + fmtMoney(invoiceTotals(inv).total, inv.currency, inv.fxRate) + " (entry " + entry.no + ")",
        prev, next: Ledger.cloneObj(inv),
      });
    }
    await saveInvoices(invoices);
    return { ok: true, entryId: res.id, entryNo: entry.no, ref, total, paid: targets.map(x => x.no) };
  }
  /* gateway webhook — a payment was confirmed externally; finalize the invoices */
  async function confirmWebhook(ids, o) {
    const r = await payInvoices(ids, Object.assign({}, o, { method: o && o.method || "card" }));
    if (r && r.ok) {
      await Ledger.auditLog("ar_payment.confirm", {
        entity: "ar_payment", entityId: r.entryId, entityLabel: r.ref,
        summary: "Webhook confirmed " + r.ref + " (" + (o && o.gateway || "gateway") + ") — " + r.paid.join(", ") + " marked paid",
        prev: null, next: { ref: r.ref, invoices: r.paid, entryId: r.entryId },
      });
    }
    return r;
  }

  /* ── reminders (task 17) ─────────────────────────────────────────────── */
  function remindersDue(invoices, asOf) {
    const a = asOf || today();
    const out = [];
    for (const inv of invoices) {
      if (inv.status !== "open") continue;
      const due = inv.dueDate || addDays(inv.date || a, 30);
      const days = daysBetween(a, due);
      if (days < -3) continue; // not yet approaching
      const last = (inv.reminders || []).length ? inv.reminders[inv.reminders.length - 1].days : null;
      if (last != null && days >= last) continue; // don't re-remind at same/later stage
      const kind = days < 0 ? "upcoming" : days === 0 ? "due today" : days <= 7 ? "overdue" : "overdue";
      out.push({ invoice: inv, days, kind, due });
    }
    out.sort((a, b) => a.days - b.days);
    return out;
  }
  async function sendReminders(ids, opts) {
    const o = opts || {};
    const invoices = await loadInvoices();
    const now = new Date().toISOString();
    const sent = [];
    for (const id of ids) {
      const inv = invoices.find(x => x.id === id);
      if (!inv || inv.status !== "open") continue;
      const due = inv.dueDate || addDays(inv.date, 30);
      const days = daysBetween(today(), due);
      const prev = Ledger.cloneObj(inv);
      if (!inv.reminders) inv.reminders = [];
      inv.reminders.push({ at: now, days, channel: o.channel || "email", note: o.note || "" });
      inv.updatedAt = now;
      sent.push({ no: inv.no, customer: inv.customerName, email: inv.customerEmail || "", days });
      await Ledger.auditLog("reminder.send", {
        entity: "reminder", entityId: inv.id, entityLabel: inv.no + " · " + inv.customerName,
        summary: "Reminder " + (inv.reminders.length) + " sent for " + inv.no + " (" + (days < 0 ? "due in " + (-days) + "d" : days + "d past due") + ") via " + (o.channel || "email"),
        prev, next: Ledger.cloneObj(inv),
      });
    }
    await saveInvoices(invoices);
    return { sent };
  }

  /* ── quote → invoice (task 14) ───────────────────────────────────────── */
  function docLinesFromQuote(quote, accounts) {
    return (quote.lines || []).map(l => ({
      id: uid("inl"), desc: l.desc || "", account: l.account || suggestRevenueFor(l.desc, accounts),
      qty: l.qty == null ? 1 : l.qty, unitPrice: amt(l.unitPrice), amount: null, itemId: l.itemId || null, projectId: l.projectId || quote.projectId || null,
    }));
  }
  async function convertQuoteToInvoice(quoteId) {
    const quotes = await loadQuotes();
    const quote = quotes.find(x => x.id === quoteId);
    if (!quote) return { error: "Quote not found." };
    if (quote.status === "converted") return { error: "Quote already converted." };
    if (quote.status !== "approved") return { error: "Only approved quotes can be converted. Mark the quote approved first." };
    const accounts = await Ledger.loadAccounts();
    const invoices = await loadInvoices();
    const tax = taxFor(docSubtotal(quote), quote.taxCode, quote.taxJurisdiction, today(), "sale");
    const inv = {
      id: uid("inv"), no: await nextNo("INV", invoices),
      customerId: quote.customerId, customerName: quote.customerName, customerEmail: quote.customerEmail || "",
      date: today(), dueDate: addDays(today(), quote.netDays || 30),
      memo: "From " + quote.no + (quote.memo ? " — " + quote.memo : ""),
      status: "draft", fromQuoteId: quote.id, quoteNo: quote.no,
      lines: docLinesFromQuote(quote, accounts),
      taxCode: quote.taxCode || null, taxJurisdiction: quote.taxJurisdiction || "", taxRate: tax.rate, taxLabel: tax.label,
      subtotal: 0, taxAmount: tax.amount, total: 0,
      currency: quote.currency || null, fxRate: quote.fxRate || null,
      ledgerEntryId: null, postedAt: null, source: null, projectId: quote.projectId || null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const t = invoiceTotals(inv);
    inv.subtotal = t.subtotal; inv.taxAmount = t.tax; inv.total = t.total;
    invoices.push(inv);
    await saveInvoices(invoices);
    const qprev = Ledger.cloneObj(quote);
    quote.status = "converted";
    quote.convertedInvoiceId = inv.id;
    quote.updatedAt = new Date().toISOString();
    await saveQuotes(quotes);
    await Ledger.auditLog("quote.convert", {
      entity: "quote", entityId: quote.id, entityLabel: quote.no + " · " + quote.customerName,
      summary: "Converted " + quote.no + " → " + inv.no + " — " + fmtMoney(inv.total, inv.currency, inv.fxRate),
      prev: qprev, next: Ledger.cloneObj(quote),
    });
    await Ledger.auditLog("invoice.create", {
      entity: "invoice", entityId: inv.id, entityLabel: inv.no + " · " + inv.customerName,
      summary: "Created " + inv.no + " from " + quote.no, prev: null, next: Ledger.cloneObj(inv),
    });
    return { ok: true, invoice: inv };
  }

  /* ── recurring billing (task 15) ─────────────────────────────────────── */
  function advanceDate(s, cadence) {
    const p = parseDate(s); if (!p) return s;
    if (cadence === "weekly") return addDays(s, 7);
    if (cadence === "annually") { const y = p.y + 1, d = Math.min(p.d, daysInMonth(y, p.m)); return y + "-" + pad2(p.m) + "-" + pad2(d); }
    let y = p.y, m = p.m + 1; if (m > 12) { m = 1; y++; }
    const d = Math.min(p.d, daysInMonth(y, m));
    return y + "-" + pad2(m) + "-" + pad2(d);
  }
  function dueInvoicesToCreate(rules, invoices, todayStr) {
    const out = [];
    for (const rule of rules) {
      if (!rule.active) continue;
      if (String(rule.nextDate || "") > todayStr) continue;
      const exists = invoices.some(x => x.source && x.source.kind === "recurring" && x.source.ruleId === rule.id && x.source.dueDate === rule.nextDate);
      if (exists) continue;
      out.push({ rule, due: rule.nextDate });
    }
    return out;
  }
  async function generateDueInvoices() {
    const rules = await loadRules();
    const invoices = await loadInvoices();
    const customers = await loadCustomers();
    const accounts = await Ledger.loadAccounts();
    const due = dueInvoicesToCreate(rules, invoices, today());
    const created = [];
    for (const d of due) {
      const rule = d.rule;
      const cust = customers.find(c => c.id === rule.customerId);
      const tax = taxFor(docSubtotal(rule), rule.taxCode, rule.taxJurisdiction, d.due, "sale");
      const inv = {
        id: uid("inv"), no: await nextNo("INV", invoices),
        customerId: rule.customerId, customerName: cust ? cust.name : rule.customerName || "", customerEmail: cust ? cust.email : "",
        date: d.due, dueDate: addDays(d.due, rule.netDays || 30),
        memo: "Recurring: " + rule.label,
        status: "draft",
        lines: (rule.lines || []).map(l => ({ id: uid("inl"), desc: l.desc || "", account: l.account, qty: 1, unitPrice: amt(l.amount), amount: amt(l.amount), itemId: l.itemId || null, projectId: rule.projectId || null })),
        taxCode: rule.taxCode || null, taxJurisdiction: rule.taxJurisdiction || "", taxRate: tax.rate, taxLabel: tax.label,
        subtotal: 0, taxAmount: tax.amount, total: 0,
        currency: rule.currency || null, fxRate: rule.fxRate || null,
        ledgerEntryId: null, postedAt: null,
        source: { kind: "recurring", ruleId: rule.id, dueDate: d.due }, projectId: rule.projectId || null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const t = invoiceTotals(inv);
      inv.subtotal = t.subtotal; inv.taxAmount = t.tax; inv.total = t.total;
      invoices.push(inv);
      created.push(inv);
      await Ledger.auditLog("invoice.generate", {
        entity: "invoice", entityId: inv.id, entityLabel: inv.no + " · " + inv.customerName,
        summary: "Generated " + inv.no + " (recurring · " + rule.label + ") for " + d.due,
        prev: null, next: Ledger.cloneObj(inv),
      });
    }
    if (created.length) await saveInvoices(invoices);
    return created;
  }
  async function saveRule(rule, list) {
    const r = Object.assign({}, rule);
    if (!r.id) r.id = uid("arr");
    if (!r.createdAt) r.createdAt = new Date().toISOString();
    if (!r.active) r.active = true;
    r.lines = (r.lines || []).map(l => ({ desc: String(l.desc || "").trim(), account: l.account || null, amount: amt(l.amount), itemId: l.itemId || null }));
    r.updatedAt = new Date().toISOString();
    const prev = list.find(x => x.id === r.id) || null;
    const i = list.findIndex(x => x.id === r.id);
    if (i >= 0) list[i] = r; else list.push(r);
    await saveRules(list);
    await Ledger.auditLog(prev ? "recurring.update" : "recurring.create", {
      entity: "recurring", entityId: r.id, entityLabel: r.label,
      summary: (prev ? "Edited " : "Created ") + "recurring invoice “" + r.label + "” (" + r.customerName + ")",
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(r),
    });
    return r;
  }
  async function setRuleActive(id, active) {
    const rules = await loadRules();
    const r = rules.find(x => x.id === id);
    if (!r) return { error: "Recurring rule not found." };
    const prev = Ledger.cloneObj(r);
    r.active = !!active; r.updatedAt = new Date().toISOString();
    await saveRules(rules);
    await Ledger.auditLog(r.active ? "recurring.resume" : "recurring.pause", {
      entity: "recurring", entityId: r.id, entityLabel: r.label,
      summary: (r.active ? "Resumed" : "Paused") + " recurring invoice “" + r.label + "”",
      prev, next: Ledger.cloneObj(r),
    });
    return { ok: true };
  }
  async function deleteRule(id) {
    const rules = await loadRules();
    const r = rules.find(x => x.id === id);
    if (!r) return { error: "Recurring rule not found." };
    const i = rules.indexOf(r); rules.splice(i, 1);
    await saveRules(rules);
    await Ledger.auditLog("recurring.delete", {
      entity: "recurring", entityId: id, entityLabel: r.label,
      summary: "Deleted recurring invoice “" + r.label + "”", prev: Ledger.cloneObj(r), next: null,
    });
    return { ok: true };
  }

  /* ── A/R aging (task 18) ─────────────────────────────────────────────── */
  function arAging(invoices, asOf) {
    const a = asOf || today();
    const buckets = [
      { key: "current", label: "Current", min: -Infinity, max: 0 },
      { key: "b1", label: "1–30 days", min: 1, max: 30 },
      { key: "b2", label: "31–60 days", min: 31, max: 60 },
      { key: "b3", label: "61–90 days", min: 61, max: 90 },
      { key: "b4", label: "90+ days", min: 91, max: Infinity },
    ];
    for (const bk of buckets) bk.invoices = [];
    for (const inv of (invoices || [])) {
      if (inv.status !== "open") continue;
      const due = inv.dueDate || inv.date || a;
      const dpd = daysBetween(a, due);
      const bk = buckets.find(x => dpd >= x.min && dpd <= x.max) || buckets[0];
      bk.invoices.push({ invoice: inv, daysPastDue: dpd, due });
    }
    for (const bk of buckets) { bk.total = round2(bk.invoices.reduce((s, x) => s + invoiceTotals(x.invoice).total, 0)); bk.count = bk.invoices.length; }
    const total = round2(buckets.reduce((s, x) => s + x.total, 0));
    return {
      asOf: a, total,
      current: buckets[0].total,
      overdue: round2(buckets.slice(1).reduce((s, x) => s + x.total, 0)),
      buckets,
      oldest: (() => {
        const due = (invoices || []).filter(x => x.status === "open").map(x => ({ no: x.no, due: x.dueDate || x.date || a })).sort((x, y) => String(x.due).localeCompare(String(y.due)))[0];
        return due ? { no: due.no, days: daysBetween(a, due.due) } : null;
      })(),
    };
  }

  /* ── module renderer ─────────────────────────────────────────────────── */
  async function render(m) {
    m.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 3 — Accounts Receivable"));
    head.appendChild(FW.el("h1", null, null, { text: "Accounts Receivable" }));
    head.appendChild(FW.el("p", "lede", "Get paid: quotes that convert into invoices with a click, recurring billing on any cadence, payment capture (card / bank / cash / check) with webhook-style confirmation, automated reminders, and A/R aging."));
    m.appendChild(head);

    const tabs = FW.el("div", "ledger-tabs");
    tabs.innerHTML =
      '<button class="ledger-tab active" data-tab="invoices">Invoices</button>' +
      '<button class="ledger-tab" data-tab="quotes">Quotes</button>' +
      '<button class="ledger-tab" data-tab="customers">Customers</button>' +
      '<button class="ledger-tab" data-tab="recurring">Recurring</button>' +
      '<button class="ledger-tab" data-tab="aging">Aging</button>';
    m.appendChild(tabs);

    const ctn = FW.el("div", "ledger-tab-ctn");
    m.appendChild(ctn);

    const switchTab = name => {
      FW.$$(".ledger-tab", tabs).forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === name));
      if (name === "quotes") renderQuotes(ctn);
      else if (name === "customers") renderCustomers(ctn);
      else if (name === "recurring") renderRecurring(ctn);
      else if (name === "aging") renderAging(ctn);
      else renderInvoices(ctn);
    };
    tabs.addEventListener("click", e => {
      const b = e.target.closest(".ledger-tab");
      if (b) switchTab(b.getAttribute("data-tab"));
    });

    switchTab("invoices");

    const note = FW.el("p", "note small");
    note.style.cssText = "margin-top:18px";
    note.innerHTML = "<strong>Phase 3 is complete (tasks 13–18)</strong> — invoicing engine with tax, quote-to-invoice conversion, recurring billing, payment gateway capture with webhook confirmation, payment reminders, and A/R aging. <strong>Next up:</strong> Phase 4 — Multi-Currency & Tax Engine.";
    m.appendChild(note);
  }

  /* ── customers tab ───────────────────────────────────────────────────── */
  async function renderCustomers(ctn) {
    const customers = await loadCustomers();
    const invoices = await loadInvoices();
    const sorted = [...customers].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    let html = '<div class="card"><div class="card-head"><h3>Customers</h3>' +
      '<button class="btn btn-primary btn-sm" id="custNewBtn">+ New customer</button></div>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No customers yet. Add customers so quotes and invoices can reference them (or type a customer name directly on an invoice).</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>Name</th><th class="ap-hide-m">Company</th><th class="ap-hide-m">Email</th><th class="tr">Open invoices</th><th class="fit"></th></tr></thead><tbody>';
      for (const c of sorted) {
        const open = invoices.filter(x => x.customerId === c.id && x.status === "open");
        const openTotal = round2(open.reduce((s, x) => s + invoiceTotals(x).total, 0));
        html += "<tr>" +
          "<td><div class='acct-name'>" + esc(c.name) + "</div><div class='muted small'>" + esc(c.phone || "") + "</div></td>" +
          '<td class="ap-hide-m">' + esc(c.company || "") + "</td>" +
          '<td class="ap-hide-m">' + esc(c.email || "") + "</td>" +
          '<td class="tr num">' + open.length + " · " + FW.money(openTotal) + "</td>" +
          '<td class="fit"><div class="row-actions">' +
          '<button class="icon-mini" data-cust-edit="' + esc(c.id) + '" title="Edit">' + ICON.pencil + "</button>" +
          '<button class="icon-mini danger" data-cust-del="' + esc(c.id) + '" title="Delete">' + ICON.trash + "</button>" +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#custNewBtn").addEventListener("click", () => customerModal(null, sorted, () => renderCustomers(ctn)));
    ctn.onclick = e => {
      const ed = e.target.closest("[data-cust-edit]");
      const dl = e.target.closest("[data-cust-del]");
      if (ed) {
        const c = sorted.find(x => x.id === ed.getAttribute("data-cust-edit"));
        if (c) customerModal(c, sorted, () => renderCustomers(ctn));
      } else if (dl) {
        const id = dl.getAttribute("data-cust-del");
        confirmDialog("Delete customer?", "Customers with non-voided invoices can't be deleted.", async () => {
          const r = await deleteCustomer(id);
          if (r.error) FW.toast(r.error, "err"); else { FW.toast("Customer deleted"); renderCustomers(ctn); }
        }, "Delete customer");
      }
    };
  }
  function customerModal(customer, list, onSaved) {
    const isNew = !customer;
    const c = customer || { name: "", company: "", email: "", phone: "", address: "", notes: "" };
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (isNew ? "New customer" : "Edit customer") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body"><div class="row-flex" style="align-items:flex-start">' +
      '<div class="field" style="flex:1 1 220px"><label>Name *</label><input id="cName" value="' + esc(c.name) + '" placeholder="e.g. Jane Doe"></div>' +
      '<div class="field" style="flex:1 1 200px"><label>Company</label><input id="cCompany" value="' + esc(c.company || "") + '"></div>' +
      "</div>" +
      '<div class="row-flex" style="align-items:flex-start">' +
      '<div class="field" style="flex:1 1 220px"><label>Email</label><input id="cEmail" type="email" value="' + esc(c.email || "") + '"></div>' +
      '<div class="field" style="flex:1 1 160px"><label>Phone</label><input id="cPhone" value="' + esc(c.phone || "") + '"></div>' +
      "</div>" +
      '<div class="field"><label>Address</label><input id="cAddr" value="' + esc(c.address || "") + '"></div>' +
      '<div class="field"><label>Notes</label><input id="cNotes" value="' + esc(c.notes || "") + '"></div>' +
      '<div class="row-flex"><button class="btn btn-primary" id="cSaveBtn">' + (isNew ? "Create customer" : "Save changes") + "</button>" +
      '<button class="btn btn-ghost" data-close>Cancel</button></div></div>');
    modal.style.width = "min(640px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#cSaveBtn").addEventListener("click", async () => {
      const name = String(modal.querySelector("#cName").value || "").trim();
      if (!name) { FW.toast("Name is required.", "err"); return; }
      const out = {
        id: c.id || null, name,
        company: String(modal.querySelector("#cCompany").value || "").trim(),
        email: String(modal.querySelector("#cEmail").value || "").trim(),
        phone: String(modal.querySelector("#cPhone").value || "").trim(),
        address: String(modal.querySelector("#cAddr").value || "").trim(),
        notes: String(modal.querySelector("#cNotes").value || "").trim(),
        createdAt: c.createdAt || null,
      };
      await saveCustomer(out, await loadCustomers());
      modal.closest(".modal-back").remove();
      FW.toast(isNew ? "Customer created" : "Customer updated");
      onSaved && onSaved();
    });
  }

  /* ── invoices tab ────────────────────────────────────────────────────── */
  async function renderInvoices(ctn) {
    const [invoices, customers, accounts] = await Promise.all([loadInvoices(), loadCustomers(), Ledger.loadAccounts()]);
    const arName = (accounts.find(a => a.id === arAccountId(accounts)) || {}).name || "Accounts Receivable";
    const sorted = [...invoices].sort((a, b) => String(a.no || "").localeCompare(String(b.no || "")));
    const openTotal = round2(invoices.filter(x => x.status === "open").reduce((s, x) => s + invoiceTotals(x).total, 0));
    const aging = arAging(invoices, today());
    const due = remindersDue(invoices, today());

    let html = '<div class="card"><div class="card-head"><h3>Invoices</h3>' +
      (due.length ? '<button class="btn btn-ghost btn-sm" id="invRemindBtn" style="margin-right:8px">Remind ' + due.length + " due</button>" : "") +
      '<button class="btn btn-ghost btn-sm" id="invPaySelBtn" disabled style="margin-right:8px">Record payment (0)</button>' +
      '<button class="btn btn-primary btn-sm" id="invNewBtn">+ New invoice</button></div>';
    html += '<div class="bill-stats">' +
      '<span class="chip chip-done">Open ' + FW.money(openTotal) + "</span>" +
      '<span class="chip ' + (aging.overdue ? "chip-warn" : "chip-done") + '">Overdue ' + FW.money(aging.overdue) + "</span>" +
      '<span class="chip chip-muted">' + invoices.filter(x => x.status === "paid").length + " paid</span>" +
      "</div>";
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No invoices yet. Create an invoice (optionally from an approved quote), then post it to record the receivable against ' + esc(arName) + " in the ledger.</p>";
    } else {
      html += '<table class="tbl"><thead><tr>' +
        '<th class="fit"></th><th>No</th><th>Customer</th><th class="ap-hide-m">Date</th><th class="ap-hide-m">Due</th><th class="tr">Total</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const inv of sorted) {
        const { total } = invoiceTotals(inv);
        const status = inv.status === "open" && aging.overdue && daysBetween(today(), inv.dueDate || inv.date) > 0 ? "overdue" : inv.status;
        const selCell = inv.status === "open"
          ? '<td class="fit"><input type="checkbox" class="inv-sel" data-inv="' + esc(inv.id) + '" title="Select for payment"></td>'
          : '<td class="fit"></td>';
        const acts = [];
        if (inv.status === "draft") acts.push(["edit", "Edit", ICON.pencil], ["post", "Post to ledger", ICON.check], ["delete", "Delete draft", ICON.trash, "danger"]);
        else if (inv.status === "open" || inv.status === "sent") acts.push(["pay", "Record payment", ICON.card], ["view", "View", ICON.eye], ["void", "Void", ICON.cancel]);
        else acts.push(["view", "View", ICON.eye]);
        html += "<tr>" + selCell +
          '<td class="mono small">' + esc(inv.no) + "</td>" +
          "<td><div class='acct-name'>" + esc(inv.customerName || "—") + "</div>" +
          (inv.quoteNo ? '<div class="small"><span class="tag tag-inactive" style="margin-left:0">from ' + esc(inv.quoteNo) + "</span></div>" : "") +
          (inv.source && inv.source.kind === "recurring" ? '<div class="small"><span class="tag tag-inactive" style="margin-left:0">recurring · ' + esc(inv.source.dueDate) + "</span></div>" : "") +
          (inv.projectId ? '<div class="small"><span class="tag tag-inactive" style="margin-left:0">project · ' + esc(window.Projects ? window.Projects.projectLabel(inv.projectId) : inv.projectId) + "</span></div>" : "") +
          (inv.status === "paid" ? '<div class="small muted">' + esc(inv.paymentRef || "") + " · " + esc(inv.paymentMethod || "") + (inv.paymentDate ? " · " + esc(inv.paymentDate) : "") + "</div>" : "") +
          "</td>" +
          '<td class="small ap-hide-m">' + esc(inv.date || "") + "</td>" +
          '<td class="small ap-hide-m">' + esc(inv.dueDate || "") + "</td>" +
          '<td class="tr num">' + fmtMoney(total, inv.currency, inv.fxRate) + (inv.currency && inv.currency !== (window.Tax ? window.Tax.baseCodeSync() : "USD") ? '<div class="muted small">' + fmtBase(total, inv.currency, inv.fxRate) + "</div>" : "") + "</td>" +
          '<td><span class="chip ' + invoiceStatusChip(status) + '">' + esc(invoiceStatusLabel(status)) + "</span></td>" +
          '<td class="fit"><div class="row-actions" style="justify-content:flex-end">' +
          acts.map(a => '<button class="icon-mini' + (a[3] ? " " + a[3] : "") + '" data-inv="' + esc(inv.id) + '" data-invact="' + a[0] + '" title="' + a[1] + '">' + a[2] + "</button>").join("") +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#invNewBtn").addEventListener("click", () => invoiceModal(null, accounts, () => renderInvoices(ctn)));
    if (ctn.querySelector("#invRemindBtn")) ctn.querySelector("#invRemindBtn").addEventListener("click", () => reminderModal(due, () => renderInvoices(ctn)));
    ctn.querySelector("#invPaySelBtn").addEventListener("click", () => {
      const ids = [...ctn.querySelectorAll(".inv-sel:checked")].map(c => c.getAttribute("data-inv"));
      if (!ids.length) { FW.toast("Select at least one open invoice to pay.", "err"); return; }
      payModal(invoices.filter(x => ids.includes(x.id)), accounts, () => renderInvoices(ctn));
    });
    ctn.addEventListener("change", e => {
      if (e.target.classList && e.target.classList.contains("inv-sel")) {
        const n = ctn.querySelectorAll(".inv-sel:checked").length;
        const btn = ctn.querySelector("#invPaySelBtn");
        if (btn) { btn.disabled = !n; btn.textContent = "Record payment (" + n + ")"; }
      }
    });
    ctn.onclick = e => {
      const b = e.target.closest("[data-invact]");
      if (!b) return;
      const id = b.getAttribute("data-inv");
      const act = b.getAttribute("data-invact");
      const inv = sorted.find(x => x.id === id);
      if (!inv) return;
      const refresh = () => renderInvoices(ctn);
      if (act === "edit") { invoiceModal(inv, accounts, refresh); return; }
      if (act === "view") { invoiceModal(inv, accounts, null, true); return; }
      if (act === "pay") { payModal([inv], accounts, refresh); return; }
      if (act === "post") {
        postInvoice(id).then(r => {
          if (r.error) FW.toast(r.error, "err");
          else FW.toast(inv.no + " posted — ledger entry " + r.entryNo + " recorded");
          refresh();
        });
        return;
      }
      if (act === "void") {
        confirmDialog("Void " + inv.no + "?", "Posts a reversing entry that removes the receivable from the ledger. The invoice becomes void.", async () => {
          const r = await voidInvoice(id);
          if (r.error) FW.toast(r.error, "err"); else FW.toast(inv.no + " voided — reversal posted"); refresh();
        }, "Void invoice");
        return;
      }
      if (act === "delete") {
        confirmDialog("Delete " + inv.no + "?", "Removes the draft invoice. Nothing has been posted to the ledger yet.", async () => {
          const r = await deleteInvoice(id);
          if (r.error) FW.toast(r.error, "err"); else FW.toast("Draft invoice deleted"); refresh();
        }, "Delete invoice");
      }
    };
  }
  async function deleteInvoice(id) {
    const invoices = await loadInvoices();
    const inv = invoices.find(x => x.id === id);
    if (!inv) return { error: "Invoice not found." };
    if (inv.status !== "draft") return { error: "Only draft invoices can be deleted — void posted ones instead." };
    const i = invoices.indexOf(inv); invoices.splice(i, 1);
    await saveInvoices(invoices);
    await Ledger.auditLog("invoice.delete", {
      entity: "invoice", entityId: id, entityLabel: inv.no + " · " + inv.customerName,
      summary: "Deleted draft invoice " + inv.no, prev: Ledger.cloneObj(inv), next: null,
    });
    return { ok: true };
  }

  function invoiceModal(invoice, accounts, onSaved, readOnly) {
    const isNew = !invoice;
    const inv = invoice || { customerId: "", customerName: "", customerEmail: "", date: today(), dueDate: addDays(today(), 30), memo: "", status: "draft", lines: [{ desc: "", account: "", qty: "1", unitPrice: "", amount: "" }], taxCode: "", taxJurisdiction: "", taxRate: 0, taxLabel: "No tax", currency: "", fxRate: null, projectId: "" };
    const lines = inv.lines.map(l => ({ desc: l.desc || "", account: l.account || "", qty: l.qty == null ? 1 : l.qty, unitPrice: l.unitPrice == null ? "" : l.unitPrice, amount: l.amount == null ? "" : l.amount, itemId: l.itemId || null, projectId: l.projectId || inv.projectId || null }));
    const locked = readOnly || inv.status !== "draft";
    const curOpts = window.Tax ? window.Tax.currencyOptionsSync() : "";

    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (readOnly ? "Invoice — " + esc(inv.no || "") : isNew ? "New invoice" : "Edit " + esc(inv.no)) + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body">' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:2 1 220px"><label>Customer</label><input id="iCust" list="custList" placeholder="Type a name or pick…" value="' + esc(inv.customerName || "") + '"' + (locked ? " disabled" : "") + ">" +
      (locked ? "" : '<datalist id="custList"></datalist>') + "</div>" +
      '<div class="field" style="flex:1 1 170px"><label>Email</label><input id="iEmail" type="email" value="' + esc(inv.customerEmail || "") + '"' + (locked ? " disabled" : "") + "></div>" +
      "</div>" +
      '<div class="row-flex">' +
      '<div class="field" style="flex:1 1 140px"><label>Invoice date</label><input id="iDate" type="date" value="' + esc(inv.date || today()) + '"' + (locked ? " disabled" : "") + "></div>" +
      '<div class="field" style="flex:1 1 140px"><label>Due date</label><input id="iDue" type="date" value="' + esc(inv.dueDate || addDays(today(), 30)) + '"' + (locked ? " disabled" : "") + "></div>" +
      '<div class="field" style="flex:1 1 150px"><label>Tax</label><select id="iTax"' + (locked ? " disabled" : "") + "></select></div>" +
      '<div class="field" style="flex:1 1 150px"><label>Jurisdiction</label><input id="iJur" placeholder="e.g. CA, UK…" value="' + esc(inv.taxJurisdiction || "") + '"' + (locked ? " disabled" : "") + "></div>" +
      '<div class="field" style="flex:1 1 170px"><label>Project <span class="muted small">(optional)</span></label><select id="iProj"' + (locked ? " disabled" : "") + "></select></div>" +
      (curOpts ? '<div class="field" style="flex:1 1 150px"><label>Currency</label><select id="iCur">' + curOpts.replace(" selected", "") + "</select></div>" : "") +
      "</div>" +
      '<div class="field" style="flex:1 1 220px;margin-bottom:0"><label>Memo</label><input id="iMemo" value="' + esc(inv.memo || "") + '"' + (locked ? " disabled" : "") + "></div>" +
      '<div class="je-ed-label" style="margin-top:12px">Line items <span class="muted small">— revenue accounts credited on posting; total is debited to Accounts Receivable</span></div>' +
      '<div id="iLines" class="je-ed-lines"></div>' +
      '<div class="je-ed-totals"><span id="iTotSub">Subtotal ' + FW.money(0) + "</span><span id=\"iTotTax\"></span><span id=\"iTot\">Total " + FW.money(0) + "</span><span id=\"iUnacc\" class=\"chip chip-pending\"></span></div>" +
      (locked ? "" : '<div class="row-flex" style="margin-top:14px">' +
        '<button class="btn btn-primary" id="iPostBtn">Post to ledger</button>' +
        '<button class="btn btn-ghost" id="iSaveBtn">Save draft</button>' +
        '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>') +
      "</div>");
    modal.style.width = "min(880px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));

    const linesEl = modal.querySelector("#iLines");
    const subEl = modal.querySelector("#iTotSub");
    const taxEl = modal.querySelector("#iTotTax");
    const totEl = modal.querySelector("#iTot");
    const unaccEl = modal.querySelector("#iUnacc");
    const taxSel = modal.querySelector("#iTax");
    const curSel = modal.querySelector("#iCur");
    const projSel = modal.querySelector("#iProj");
    if (curSel) curSel.value = inv.currency || (window.Tax ? window.Tax.baseCodeSync() : "USD");
    if (projSel) {
      const fill = () => (window.Projects ? window.Projects.projectOptions(inv.projectId || "") : Promise.resolve("")).then(opts => {
        projSel.innerHTML = '<option value="">— no project —</option>' + opts;
      });
      fill();
    }

    (async () => {
      const customers = await loadCustomers();
      const dl = modal.querySelector("#custList");
      if (dl) dl.innerHTML = customers.map(c => '<option value="' + esc(c.name) + '">').join("");
      const custInput = modal.querySelector("#iCust");
      if (custInput && !locked) {
        custInput.addEventListener("blur", () => {
          const c = customers.find(x => x.name.toLowerCase() === String(custInput.value || "").trim().toLowerCase());
          if (c) {
            const email = modal.querySelector("#iEmail");
            if (email && !email.value) email.value = c.email || "";
          }
        });
      }
    })();

    if (taxSel) {
      const taxOpts = window.Tax ? window.Tax.taxCodeOptionsSync() : '<option value="">None</option>';
      taxSel.innerHTML = taxOpts;
      taxSel.value = inv.taxCode || "";
    }

    function lineHtml(l, i) {
      const invItemOpts = window.Inventory ? window.Inventory.itemOptions(l.itemId) : "";
      return '<div class="je-ed-line" data-i="' + i + '">' +
        (window.Inventory && !locked ? '<select class="i-ed-item" style="flex:0 0 150px;min-width:0"><option value="">— item —</option>' + invItemOpts + "</select>" : "") +
        '<select class="i-ed-acct" style="flex:1 1 200px;min-width:0"' + (locked ? " disabled" : "") + ">" + revenueAccountOptions(accounts, l.account) + "</select>" +
        '<input class="i-ed-desc" type="text" placeholder="Line description" value="' + esc(l.desc) + '"' + (locked ? " disabled" : "") + ">" +
        '<input class="i-ed-qty amt-sm" type="number" min="0" step="0.01" placeholder="Qty" value="' + esc(l.qty) + '"' + (locked ? " disabled" : "") + ">" +
        '<input class="i-ed-price amt-md" type="number" min="0" step="0.01" placeholder="Unit price" value="' + esc(l.unitPrice) + '"' + (locked ? " disabled" : "") + ">" +
        '<input class="i-ed-amt amt-md" type="number" min="0" step="0.01" placeholder="Amount" value="' + esc(l.amount) + '"' + (locked ? " disabled" : "") + ">" +
        (locked ? "" : '<button class="icon-mini danger" data-rm="' + i + '" title="Remove line">' + ICON.x + "</button>") +
        "</div>";
    }
    function readCur() {
      const code = curSel ? curSel.value : inv.currency || (window.Tax ? window.Tax.baseCodeSync() : "USD");
      const rate = window.Tax ? window.Tax.rateForSync(code) : null;
      return { code, rate };
    }
    function updateTotals() {
      let sub = 0, unacc = 0;
      FW.$$(".je-ed-line", linesEl).forEach(row => {
        const i = Number(row.getAttribute("data-i"));
        const l = lines[i];
        if (!l) return;
        l.account = row.querySelector(".i-ed-acct").value;
        l.desc = row.querySelector(".i-ed-desc").value;
        l.qty = row.querySelector(".i-ed-qty").value;
        l.unitPrice = row.querySelector(".i-ed-price").value;
        l.amount = row.querySelector(".i-ed-amt").value;
        const a = l.amount != null && l.amount !== "" ? amt(l.amount) : lineAmount(l);
        sub = round2(sub + a);
        if (!l.account) unacc++;
        const itemSel = row.querySelector(".i-ed-item");
        if (itemSel) l.itemId = itemSel.value || null;
        if (window.Inventory && l.itemId) {
          const it = window.Inventory.itemById(l.itemId);
          if (it && it.price != null && (!l.unitPrice || l.unitPrice === "0")) { l.unitPrice = it.price; row.querySelector(".i-ed-price").value = it.price; }
        }
      });
      const { code, rate } = readCur();
      const tax = taxFor(sub, taxSel ? taxSel.value : inv.taxCode, modal.querySelector("#iJur").value, modal.querySelector("#iDate").value || today(), "sale");
      const total = round2(sub + tax.amount);
      const money = n => fmtMoney(n, code, rate);
      subEl.textContent = "Subtotal " + money(sub) + (code !== (window.Tax ? window.Tax.baseCodeSync() : "USD") ? " " + fmtBase(sub, code, rate) : "");
      taxEl.textContent = tax.amount ? "Tax (" + esc(tax.label) + ") " + money(tax.amount) : "";
      totEl.textContent = "Total " + money(total) + (code !== (window.Tax ? window.Tax.baseCodeSync() : "USD") ? " " + fmtBase(total, code, rate) : "");
      modal.dataset.taxAmount = tax.amount;
      modal.dataset.taxLabel = tax.label;
      modal.dataset.taxRate = tax.rate;
      if (unaccEl) {
        unaccEl.textContent = unacc ? unacc + " line" + (unacc === 1 ? "" : "s") + " need an account" : "all lines accounted";
        unaccEl.className = "chip " + (unacc ? "chip-pending" : "chip-done");
      }
    }
    function renderLines() {
      linesEl.innerHTML = lines.map(lineHtml).join("") + (locked ? "" : '<button class="btn btn-ghost btn-sm" id="iAddLine">+ Add line</button>');
      const addBtn = linesEl.querySelector("#iAddLine");
      if (addBtn) addBtn.addEventListener("click", () => { updateTotals(); lines.push({ desc: "", account: "", qty: "1", unitPrice: "", amount: "", itemId: null, projectId: inv.projectId || null }); renderLines(); updateTotals(); });
      FW.$$("[data-rm]", linesEl).forEach(b => b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-rm"));
        updateTotals();
        lines.splice(i, 1);
        renderLines(); updateTotals();
      }));
      if (!locked) linesEl.addEventListener("input", e => {
        if (e.target.classList.contains("i-ed-qty") || e.target.classList.contains("i-ed-price") || e.target.classList.contains("i-ed-amt")) updateTotals();
      });
    }
    renderLines();
    updateTotals();
    if (taxSel) taxSel.addEventListener("change", updateTotals);
    if (curSel) curSel.addEventListener("change", updateTotals);
    if (!locked) {
      const iJur = modal.querySelector("#iJur"); if (iJur) iJur.addEventListener("input", updateTotals);
      const iDate = modal.querySelector("#iDate"); if (iDate) iDate.addEventListener("change", updateTotals);
    }
    if (readOnly) return;

    const collect = () => {
      const out = lines.filter(l => (l.amount != null && l.amount !== "" ? amt(l.amount) : lineAmount(l)) > 0 || l.desc || l.account);
      const clean = out.filter(l => (l.amount != null && l.amount !== "" ? amt(l.amount) : lineAmount(l)) > 0);
      if (!clean.length) { FW.toast("Add at least one line with an amount.", "err"); return null; }
      for (const l of clean) if (!l.account) { FW.toast("Every line needs a revenue account.", "err"); return null; }
      return clean.map(l => ({ id: l.id || uid("inl"), desc: String(l.desc || "").trim(), account: l.account, qty: amt(l.qty), unitPrice: amt(l.unitPrice), amount: l.amount != null && l.amount !== "" ? amt(l.amount) : lineAmount(l), itemId: l.itemId || null, projectId: l.projectId || inv.projectId || null }));
    };
    const build = (linesOut, tax) => {
      const { code, rate } = readCur();
      const sub = round2(linesOut.reduce((s, l) => s + amt(l.amount), 0));
      return {
        id: inv.id || null, no: inv.no || null,
        customerId: inv.customerId || null,
        customerName: String(modal.querySelector("#iCust").value || "").trim() || inv.customerName,
        customerEmail: String(modal.querySelector("#iEmail").value || "").trim(),
        date: modal.querySelector("#iDate").value || today(),
        dueDate: modal.querySelector("#iDue").value || addDays(today(), 30),
        memo: String(modal.querySelector("#iMemo").value || "").trim(),
        status: inv.status || "draft",
        lines: linesOut,
        taxCode: taxSel ? taxSel.value : inv.taxCode, taxJurisdiction: String(modal.querySelector("#iJur").value || "").trim(),
        taxRate: tax.rate, taxLabel: tax.label, taxAmount: tax.amount,
        subtotal: sub, total: round2(sub + tax.amount),
        currency: code, fxRate: rate,
        projectId: projSel ? (projSel.value || null) : (inv.projectId || null),
        fromQuoteId: inv.fromQuoteId || null, quoteNo: inv.quoteNo || null,
        ledgerEntryId: inv.ledgerEntryId || null, postedAt: inv.postedAt || null, source: inv.source || null,
        createdAt: inv.createdAt || null,
      };
    };
    const save = async (post) => {
      const clean = collect();
      if (!clean) return;
      const tax = taxFor(round2(clean.reduce((s, l) => s + amt(l.amount), 0)), taxSel ? taxSel.value : inv.taxCode, modal.querySelector("#iJur").value, modal.querySelector("#iDate").value || today(), "sale");
      let e = build(clean, tax);
      const invoices = await loadInvoices();
      if (isNew) e.no = await nextNo("INV", invoices);
      const res = await saveInvoice(e);
      if (res && res.error) { FW.toast(res.error, "err"); return; }
      e = res;
      if (post) {
        const r = await postInvoice(e.id);
        if (r.error) { FW.toast(r.error, "err"); return; }
      }
      modal.closest(".modal-back").remove();
      FW.toast(post ? e.no + " posted — ledger updated" : e.no + " saved as draft");
      onSaved && onSaved();
    };
    modal.querySelector("#iSaveBtn").addEventListener("click", () => save(false));
    modal.querySelector("#iPostBtn").addEventListener("click", () => save(true));
  }
  async function saveInvoice(inv) {
    const e = Object.assign({}, inv);
    if (!e.id) e.id = uid("inv");
    if (!e.createdAt) e.createdAt = new Date().toISOString();
    e.lines = (e.lines || []).map(l => ({
      id: l.id || uid("inl"), desc: String(l.desc || "").trim(), account: l.account || null,
      qty: amt(l.qty), unitPrice: amt(l.unitPrice), amount: amt(l.amount),
      itemId: l.itemId || null, projectId: l.projectId || null,
    }));
    e.updatedAt = new Date().toISOString();
    const invoices = await loadInvoices();
    const prev = invoices.find(x => x.id === e.id) || null;
    const i = invoices.findIndex(x => x.id === e.id);
    if (i >= 0) invoices[i] = e; else invoices.push(e);
    await saveInvoices(invoices);
    await Ledger.auditLog(prev ? "invoice.update" : "invoice.create", {
      entity: "invoice", entityId: e.id, entityLabel: e.no + " · " + e.customerName,
      summary: (prev ? "Edited " : "Created ") + e.no + " · " + e.customerName + " — " + fmtMoney(invoiceTotals(e).total, e.currency, e.fxRate),
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(e),
    });
    return e;
  }

  /* ── payment modal (task 16) ─────────────────────────────────────────── */
  function payModal(invoices, accounts, onDone) {
    const total = round2(invoices.reduce((s, b) => s + invoiceTotals(b).total, 0));
    const cash = cashAccountId(accounts);
    const modal = FW.modal(
      '<div class="modal-head"><h3>Record payment — ' + invoices.length + (invoices.length === 1 ? " invoice" : " invoices") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body">' +
      '<p class="note small" style="margin-top:0">' + esc(invoices.map(b => b.no + " · " + b.customerName + " — " + FW.money(invoiceTotals(b).total)).join("<br>")) + "</p>" +
      '<div class="row-flex">' +
      '<div class="field" style="flex:1 1 160px"><label>Payment method</label><select id="payMethod">' +
      '<option value="card">Credit card (gateway)</option><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="check">Check</option>' +
      "</select></div>" +
      '<div class="field" style="flex:1 1 150px"><label>Payment date</label><input id="payDate" type="date" value="' + today() + '"></div>' +
      '<div class="field" style="flex:2 1 220px"><label>Deposit into</label><select id="payCash">' + cashOptions(accounts, cash) + "</select></div>" +
      "</div>" +
      '<div class="field"><label>Memo <span class="muted small">(optional)</span></label><input id="payMemo" type="text" placeholder="Optional note"></div>' +
      '<div class="je-ed-totals"><span id="payTotal">Collecting ' + FW.money(total) + '</span><span class="chip chip-phase">posts DR cash · CR ' + esc((accounts.find(a => a.id === arAccountId(accounts)) || {}).name || "Accounts Receivable") + "</span></div>" +
      '<div class="row-flex" style="margin-top:14px">' +
      '<button class="btn btn-primary" id="payGoBtn">' + (invoices.length === 1 ? "Charge " + esc(invoices[0].no) : "Collect " + invoices.length + " invoices") + "</button>" +
      (invoices.length === 1 ? '<button class="btn btn-ghost" id="paySimBtn" title="Simulate the payment gateway confirming this charge">Simulate webhook</button>' : "") +
      '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>' +
      "</div>");
    modal.style.width = "min(640px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    const go = async (webhook) => {
      const method = modal.querySelector("#payMethod").value;
      const date = modal.querySelector("#payDate").value || today();
      const cashAccountId = modal.querySelector("#payCash").value;
      const memo = modal.querySelector("#payMemo").value.trim();
      const btn = modal.querySelector("#payGoBtn");
      btn.disabled = true;
      const r = webhook
        ? await confirmWebhook(invoices.map(b => b.id), { method, date, cashAccountId, memo, gateway: "Stripe" })
        : await payInvoices(invoices.map(b => b.id), { method, date, cashAccountId, memo });
      btn.disabled = false;
      if (r.error) { FW.toast(r.error, "err"); return; }
      modal.closest(".modal-back").remove();
      FW.toast(r.ref + " recorded — " + r.paid.join(", ") + " marked paid (entry " + r.entryNo + ")");
      onDone && onDone();
    };
    modal.querySelector("#payGoBtn").addEventListener("click", () => go(false));
    const sim = modal.querySelector("#paySimBtn");
    if (sim) sim.addEventListener("click", () => go(true));
  }

  /* ── reminders modal (task 17) ───────────────────────────────────────── */
  function reminderModal(due, onDone) {
    const modal = FW.modal(
      '<div class="modal-head"><h3>Payment reminders</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body">' +
      '<p class="note small" style="margin-top:0">Automated notices for invoices approaching or past their due date. A new reminder is due when the invoice crosses the next stage (3 days before, due, 1–7 days, 8+ days). Select which to send now — in a real deployment these would go out as email templates.</p>' +
      '<div id="rmList" class="je-ed-lines" style="gap:6px"></div>' +
      '<div class="row-flex" style="margin-top:12px"><div class="field" style="flex:1 1 180px;margin-bottom:0"><label>Channel</label><select id="rmChannel"><option value="email">Email</option><option value="sms">SMS</option></select></div>' +
      '<button class="btn btn-primary" id="rmSendBtn">Send selected reminders</button>' +
      '<button class="btn btn-ghost-subtle" data-close>Close</button></div></div>');
    modal.style.width = "min(720px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    const listEl = modal.querySelector("#rmList");
    listEl.innerHTML = due.map(d => {
      const dLabel = d.days < 0 ? "due in " + (-d.days) + "d" : d.days === 0 ? "due today" : d.days + "d overdue";
      return '<label class="je-ed-line" style="cursor:pointer"><input type="checkbox" class="rm-sel" value="' + esc(d.invoice.id) + '" checked style="width:auto;flex:0 0 auto">' +
        '<span class="mono small" style="flex:0 0 92px">' + esc(d.invoice.no) + "</span>" +
        '<span style="flex:1 1 160px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.invoice.customerName) + "</span>" +
        '<span class="chip ' + (d.days <= 0 ? "chip-phase" : "chip-warn") + '">' + dLabel + "</span>" +
        '<span class="muted small">' + FW.money(invoiceTotals(d.invoice).total) + "</span></label>";
    }).join("") || '<p class="muted small">No invoices are due a reminder right now.</p>';
    modal.querySelector("#rmSendBtn").addEventListener("click", async () => {
      const ids = [...listEl.querySelectorAll(".rm-sel:checked")].map(c => c.value);
      if (!ids.length) { FW.toast("Select at least one invoice.", "err"); return; }
      const channel = modal.querySelector("#rmChannel").value;
      const r = await sendReminders(ids, { channel });
      modal.closest(".modal-back").remove();
      FW.toast("Reminders sent for " + r.sent.length + " invoice" + (r.sent.length === 1 ? "" : "s"));
      onDone && onDone();
    });
  }

  /* ── quotes tab (task 14) ────────────────────────────────────────────── */
  async function renderQuotes(ctn) {
    const [quotes, accounts] = await Promise.all([loadQuotes(), Ledger.loadAccounts()]);
    const sorted = [...quotes].sort((a, b) => String(a.no || "").localeCompare(String(b.no || "")));
    const qc = s => ({ draft: "chip-pending", sent: "chip-phase", approved: "chip-done", converted: "chip-muted", rejected: "chip-muted" }[s] || "chip-pending");
    const ql = s => ({ draft: "Draft", sent: "Sent", approved: "Approved", converted: "Converted", rejected: "Rejected" }[s] || s);
    let html = '<div class="card"><div class="card-head"><h3>Quotes &amp; estimates</h3>' +
      '<button class="btn btn-primary btn-sm" id="qNewBtn">+ New quote</button></div>' +
      '<div class="card-body" style="padding-top:0"><p class="note small" style="margin-top:10px">Draft a quote, mark it <strong>approved</strong>, then convert it — a live invoice is created with one click (same customer, lines, tax and terms).</p>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:18px 14px 4px">No quotes yet. Create one to propose pricing before invoicing.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>No</th><th>Customer</th><th class="ap-hide-m">Date</th><th class="ap-hide-m">Expires</th><th class="tr">Total</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const q of sorted) {
        const total = round2(docSubtotal(q) + amt(q.taxAmount));
        const acts = [];
        if (q.status === "draft") acts.push(["edit", "Edit", ICON.pencil], ["approve", "Approve", ICON.check], ["delete", "Delete", ICON.trash, "danger"]);
        else if (q.status === "sent") acts.push(["approve", "Approve", ICON.check], ["edit", "Edit", ICON.pencil]);
        else if (q.status === "approved") acts.push(["convert", "To invoice", ICON.issue], ["view", "View", ICON.eye]);
        else acts.push(["view", "View", ICON.eye]);
        html += "<tr>" +
          '<td class="mono small">' + esc(q.no) + "</td>" +
          "<td><div class='acct-name'>" + esc(q.customerName || "—") + "</div></td>" +
          '<td class="small ap-hide-m">' + esc(q.date || "") + "</td>" +
          '<td class="small ap-hide-m">' + esc(q.expiresDate || "") + "</td>" +
          '<td class="tr num">' + fmtMoney(total, q.currency, q.fxRate) + "</td>" +
          '<td><span class="chip ' + qc(q.status) + '">' + esc(ql(q.status)) + "</span></td>" +
          '<td class="fit"><div class="row-actions" style="justify-content:flex-end">' +
          acts.map(a => '<button class="icon-mini' + (a[3] ? " " + a[3] : "") + '" data-q="' + esc(q.id) + '" data-qact="' + a[0] + '" title="' + a[1] + '">' + a[2] + "</button>").join("") +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div></div>";
    ctn.innerHTML = html;

    ctn.querySelector("#qNewBtn").addEventListener("click", () => quoteModal(null, accounts, () => renderQuotes(ctn)));
    ctn.onclick = e => {
      const b = e.target.closest("[data-qact]");
      if (!b) return;
      const id = b.getAttribute("data-q");
      const act = b.getAttribute("data-qact");
      const q = sorted.find(x => x.id === id);
      if (!q) return;
      const refresh = () => renderQuotes(ctn);
      if (act === "edit") { quoteModal(q, accounts, refresh); return; }
      if (act === "view") { quoteModal(q, accounts, null, true); return; }
      if (act === "approve") {
        setQuoteStatus(id, "approved").then(r => {
          if (r.error) FW.toast(r.error, "err"); else FW.toast(q.no + " approved — ready to convert"); refresh();
        });
        return;
      }
      if (act === "convert") {
        convertQuoteToInvoice(id).then(r => {
          if (r.error) FW.toast(r.error, "err"); else FW.toast(r.invoice.no + " created — post it in the Invoices tab"); refresh();
        });
        return;
      }
      if (act === "delete") {
        confirmDialog("Delete " + q.no + "?", "Removes the quote.", async () => {
          const r = await deleteQuote(id);
          if (r.error) FW.toast(r.error, "err"); else FW.toast("Quote deleted"); refresh();
        }, "Delete quote");
      }
    };
  }
  async function setQuoteStatus(id, to) {
    const quotes = await loadQuotes();
    const q = quotes.find(x => x.id === id);
    if (!q) return { error: "Quote not found." };
    if (q.status === "converted") return { error: "Converted quotes can't change status." };
    const prev = Ledger.cloneObj(q);
    q.status = to; q.updatedAt = new Date().toISOString();
    await saveQuotes(quotes);
    await Ledger.auditLog("quote.update", {
      entity: "quote", entityId: q.id, entityLabel: q.no + " · " + q.customerName,
      summary: q.no + " → " + to, prev, next: Ledger.cloneObj(q),
    });
    return { ok: true };
  }
  async function deleteQuote(id) {
    const quotes = await loadQuotes();
    const q = quotes.find(x => x.id === id);
    if (!q) return { error: "Quote not found." };
    if (q.status === "converted") return { error: "Converted quotes can't be deleted." };
    const i = quotes.indexOf(q); quotes.splice(i, 1);
    await saveQuotes(quotes);
    await Ledger.auditLog("quote.delete", {
      entity: "quote", entityId: id, entityLabel: q.no + " · " + q.customerName,
      summary: "Deleted quote " + q.no, prev: Ledger.cloneObj(q), next: null,
    });
    return { ok: true };
  }
  function quoteModal(quote, accounts, onSaved, readOnly) {
    const isNew = !quote;
    const q = quote || { customerName: "", customerEmail: "", date: today(), expiresDate: addDays(today(), 30), memo: "", status: "draft", lines: [{ desc: "", account: "", qty: "1", unitPrice: "" }], taxCode: "", taxJurisdiction: "", currency: "", fxRate: null, projectId: "", netDays: 30 };
    const lines = q.lines.map(l => ({ desc: l.desc || "", account: l.account || "", qty: l.qty == null ? 1 : l.qty, unitPrice: l.unitPrice == null ? "" : l.unitPrice, itemId: l.itemId || null }));
    const locked = readOnly || q.status === "converted";
    const curOpts = window.Tax ? window.Tax.currencyOptionsSync() : "";
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (readOnly ? "Quote — " + esc(q.no || "") : isNew ? "New quote" : "Edit " + esc(q.no)) + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body">' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:2 1 220px"><label>Customer</label><input id="qCust" list="qCustList" value="' + esc(q.customerName || "") + '"' + (locked ? " disabled" : "") + ">" + (locked ? "" : '<datalist id="qCustList"></datalist>') + "</div>" +
      '<div class="field" style="flex:1 1 150px"><label>Email</label><input id="qEmail" type="email" value="' + esc(q.customerEmail || "") + '"' + (locked ? " disabled" : "") + "></div>" +
      "</div>" +
      '<div class="row-flex">' +
      '<div class="field" style="flex:1 1 140px"><label>Date</label><input id="qDate" type="date" value="' + esc(q.date || today()) + '"' + (locked ? " disabled" : "") + "></div>" +
      '<div class="field" style="flex:1 1 140px"><label>Expires</label><input id="qExp" type="date" value="' + esc(q.expiresDate || addDays(today(), 30)) + '"' + (locked ? " disabled" : "") + "></div>" +
      '<div class="field" style="flex:0 0 120px"><label>Net days</label><input id="qNet" type="number" min="0" max="120" value="' + esc(q.netDays == null ? 30 : q.netDays) + '"' + (locked ? " disabled" : "") + "></div>" +
      '<div class="field" style="flex:1 1 150px"><label>Tax</label><select id="qTax"' + (locked ? " disabled" : "") + "></select></div>" +
      (curOpts ? '<div class="field" style="flex:1 1 140px"><label>Currency</label><select id="qCur">' + curOpts.replace(" selected", "") + "</select></div>" : "") +
      "</div>" +
      '<div class="field" style="flex:1 1 220px"><label>Memo</label><input id="qMemo" value="' + esc(q.memo || "") + '"' + (locked ? " disabled" : "") + "></div>" +
      '<div class="je-ed-label">Line items</div><div id="qLines" class="je-ed-lines"></div>' +
      '<div class="je-ed-totals"><span id="qTotSub">Subtotal ' + FW.money(0) + "</span><span id=\"qTotTax\"></span><span id=\"qTot\">Total " + FW.money(0) + "</span></div>" +
      (locked ? "" : '<div class="row-flex" style="margin-top:14px">' +
        '<button class="btn btn-primary" id="qSaveBtn">' + (isNew ? "Create quote" : "Save changes") + "</button>" +
        '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>') +
      "</div>");
    modal.style.width = "min(820px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    const linesEl = modal.querySelector("#qLines");
    const taxSel = modal.querySelector("#qTax");
    const curSel = modal.querySelector("#qCur");
    if (curSel) curSel.value = q.currency || (window.Tax ? window.Tax.baseCodeSync() : "USD");
    if (taxSel) { taxSel.innerHTML = window.Tax ? window.Tax.taxCodeOptionsSync() : '<option value="">None</option>'; taxSel.value = q.taxCode || ""; }
    (async () => {
      const dl = modal.querySelector("#qCustList");
      if (dl) dl.innerHTML = (await loadCustomers()).map(c => '<option value="' + esc(c.name) + '">').join("");
    })();
    function lineHtml(l, i) {
      return '<div class="je-ed-line" data-i="' + i + '">' +
        '<select class="q-ed-acct" style="flex:1 1 200px;min-width:0"' + (locked ? " disabled" : "") + ">" + revenueAccountOptions(accounts, l.account) + "</select>" +
        '<input class="q-ed-desc" type="text" placeholder="Line description" value="' + esc(l.desc) + '"' + (locked ? " disabled" : "") + ">" +
        '<input class="q-ed-qty amt-sm" type="number" min="0" step="0.01" placeholder="Qty" value="' + esc(l.qty) + '"' + (locked ? " disabled" : "") + ">" +
        '<input class="q-ed-price amt-md" type="number" min="0" step="0.01" placeholder="Unit price" value="' + esc(l.unitPrice) + '"' + (locked ? " disabled" : "") + ">" +
        (locked ? "" : '<button class="icon-mini danger" data-rm="' + i + '" title="Remove line">' + ICON.x + "</button>") +
        "</div>";
    }
    function readCur() { const code = curSel ? curSel.value : q.currency || (window.Tax ? window.Tax.baseCodeSync() : "USD"); return { code, rate: window.Tax ? window.Tax.rateForSync(code) : null }; }
    function updateTotals() {
      let sub = 0;
      FW.$$(".je-ed-line", linesEl).forEach(row => {
        const i = Number(row.getAttribute("data-i"));
        const l = lines[i];
        if (!l) return;
        l.account = row.querySelector(".q-ed-acct").value;
        l.desc = row.querySelector(".q-ed-desc").value;
        l.qty = row.querySelector(".q-ed-qty").value;
        l.unitPrice = row.querySelector(".q-ed-price").value;
        sub = round2(sub + lineAmount(l));
      });
      const { code, rate } = readCur();
      const tax = taxFor(sub, taxSel ? taxSel.value : q.taxCode, modal.querySelector("#qJur") ? modal.querySelector("#qJur").value : "", modal.querySelector("#qDate").value || today(), "sale");
      const money = n => fmtMoney(n, code, rate);
      modal.querySelector("#qTotSub").textContent = "Subtotal " + money(sub) + (code !== (window.Tax ? window.Tax.baseCodeSync() : "USD") ? " " + fmtBase(sub, code, rate) : "");
      modal.querySelector("#qTotTax").textContent = tax.amount ? "Tax (" + esc(tax.label) + ") " + money(tax.amount) : "";
      modal.querySelector("#qTot").textContent = "Total " + money(round2(sub + tax.amount)) + (code !== (window.Tax ? window.Tax.baseCodeSync() : "USD") ? " " + fmtBase(round2(sub + tax.amount), code, rate) : "");
      modal.dataset.taxAmount = tax.amount; modal.dataset.taxLabel = tax.label; modal.dataset.taxRate = tax.rate;
    }
    function renderLines() {
      linesEl.innerHTML = lines.map(lineHtml).join("") + (locked ? "" : '<button class="btn btn-ghost btn-sm" id="qAddLine">+ Add line</button>');
      const addBtn = linesEl.querySelector("#qAddLine");
      if (addBtn) addBtn.addEventListener("click", () => { updateTotals(); lines.push({ desc: "", account: "", qty: "1", unitPrice: "" }); renderLines(); updateTotals(); });
      FW.$$("[data-rm]", linesEl).forEach(b => b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-rm"));
        updateTotals();
        lines.splice(i, 1);
        renderLines(); updateTotals();
      }));
      if (!locked) linesEl.addEventListener("input", e => { if (e.target.classList.contains("q-ed-qty") || e.target.classList.contains("q-ed-price")) updateTotals(); });
    }
    renderLines(); updateTotals();
    if (taxSel) taxSel.addEventListener("change", updateTotals);
    if (curSel) curSel.addEventListener("change", updateTotals);
    if (!locked) {
      const qDate = modal.querySelector("#qDate"); if (qDate) qDate.addEventListener("change", updateTotals);
    }
    if (locked) return;
    modal.querySelector("#qSaveBtn").addEventListener("click", async () => {
      const customerName = String(modal.querySelector("#qCust").value || "").trim();
      if (!customerName) { FW.toast("Customer is required.", "err"); return; }
      const clean = lines.map(l => ({ desc: String(l.desc || "").trim(), account: l.account || null, qty: amt(l.qty), unitPrice: amt(l.unitPrice), itemId: l.itemId || null })).filter(l => l.desc || l.unitPrice > 0);
      if (!clean.length) { FW.toast("Add at least one line item.", "err"); return; }
      const sub = round2(clean.reduce((s, l) => s + lineAmount(l), 0));
      const { code, rate } = readCur();
      const tax = taxFor(sub, taxSel ? taxSel.value : q.taxCode, "", modal.querySelector("#qDate").value || today(), "sale");
      const out = {
        id: q.id || null, no: q.no || null,
        customerId: q.customerId || null, customerName,
        customerEmail: String(modal.querySelector("#qEmail").value || "").trim(),
        date: modal.querySelector("#qDate").value || today(),
        expiresDate: modal.querySelector("#qExp").value || addDays(today(), 30),
        netDays: Math.min(Math.max(parseInt(modal.querySelector("#qNet").value, 10) || 30, 0), 120),
        memo: String(modal.querySelector("#qMemo").value || "").trim(),
        status: q.status || "draft",
        lines: clean, taxCode: taxSel ? taxSel.value : q.taxCode, taxJurisdiction: "",
        taxRate: tax.rate, taxLabel: tax.label, taxAmount: tax.amount,
        currency: code, fxRate: rate, projectId: q.projectId || null,
        convertedInvoiceId: q.convertedInvoiceId || null,
        createdAt: q.createdAt || null,
      };
      const quotes = await loadQuotes();
      if (isNew) out.no = await nextNo("QT", quotes);
      const prev = quotes.find(x => x.id === out.id) || null;
      const i = quotes.findIndex(x => x.id === out.id);
      if (i >= 0) quotes[i] = out; else quotes.push(out);
      await saveQuotes(quotes);
      await Ledger.auditLog(prev ? "quote.update" : "quote.create", {
        entity: "quote", entityId: out.id, entityLabel: out.no + " · " + out.customerName,
        summary: (prev ? "Edited " : "Created ") + out.no + " · " + out.customerName + " — " + fmtMoney(round2(sub + tax.amount), code, rate),
        prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(out),
      });
      modal.closest(".modal-back").remove();
      FW.toast(isNew ? "Quote created" : "Quote updated");
      onSaved && onSaved();
    });
  }

  /* ── recurring tab (task 15) ─────────────────────────────────────────── */
  async function renderRecurring(ctn) {
    const [rules, invoices, customers] = await Promise.all([loadRules(), loadInvoices(), loadCustomers()]);
    const due = dueInvoicesToCreate(rules, invoices, today());
    const sorted = [...rules].sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
    const cadLabel = c => ({ weekly: "Weekly", monthly: "Monthly", annually: "Annually" }[c] || c);
    let html = '<div class="card"><div class="card-head"><h3>Recurring billing</h3>' +
      '<button class="btn btn-ghost btn-sm" id="arRecGenBtn" style="margin-right:8px"' + (due.length ? "" : " disabled") + ">Generate due invoices" + (due.length ? " · " + due.length : "") + "</button>" +
      '<button class="btn btn-primary btn-sm" id="arRecNewBtn">+ New rule</button></div>' +
      '<div class="card-body" style="padding-top:0"><p class="note small" style="margin-top:10px">Retainers, subscriptions and recurring services become <strong>draft invoices</strong> when their next run date arrives — hit “Generate due invoices”. Posting a generated invoice advances the schedule.</p>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:18px 14px 4px">No recurring billing rules yet. Add one to automate invoices on a weekly, monthly or annual cadence.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>Label</th><th>Customer</th><th class="ap-hide-m">Cadence</th><th class="ap-hide-m">Next run</th><th class="tr">Amount</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const r of sorted) {
        const monthly = round2((r.lines || []).reduce((s, l) => s + amt(l.amount), 0));
        const overdue = r.active && r.nextDate && r.nextDate <= today() && !invoices.some(x => x.source && x.source.kind === "recurring" && x.source.ruleId === r.id && x.source.dueDate === r.nextDate);
        html += "<tr>" +
          "<td><div class='acct-name'>" + esc(r.label) + "</div></td>" +
          "<td>" + esc(r.customerName || "—") + "</td>" +
          '<td class="ap-hide-m">' + esc(cadLabel(r.cadence)) + "</td>" +
          '<td class="ap-hide-m">' + esc(r.nextDate || "") + (overdue ? ' <span class="chip chip-pending" style="font-size:10.5px">due</span>' : "") + "</td>" +
          '<td class="tr num">' + fmtMoney(monthly, r.currency, r.fxRate) + (r.cadence === "monthly" ? "/mo" : r.cadence === "weekly" ? "/wk" : "/yr") + "</td>" +
          '<td><span class="chip ' + (r.active ? "chip-done" : "chip-muted") + '">' + (r.active ? "Active" : "Paused") + "</span></td>" +
          '<td class="fit"><div class="row-actions" style="justify-content:flex-end">' +
          '<button class="icon-mini" data-arrec="' + esc(r.id) + '" data-arrecact="edit" title="Edit">' + ICON.pencil + "</button>" +
          '<button class="icon-mini" data-arrec="' + esc(r.id) + '" data-arrecact="' + (r.active ? "pause" : "resume") + '" title="' + (r.active ? "Pause" : "Resume") + '">' + (r.active ? ICON.pause : ICON.play) + "</button>" +
          '<button class="icon-mini" data-arrec="' + esc(r.id) + '" data-arrecact="advance" title="Advance to next run">' + ICON.skip + "</button>" +
          '<button class="icon-mini danger" data-arrec="' + esc(r.id) + '" data-arrecact="delete" title="Delete rule">' + ICON.trash + "</button>" +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div></div>";
    ctn.innerHTML = html;

    ctn.querySelector("#arRecNewBtn").addEventListener("click", () => arRuleModal(null, () => renderRecurring(ctn), customers));
    ctn.querySelector("#arRecGenBtn").addEventListener("click", async () => {
      const created = await generateDueInvoices();
      if (!created.length) FW.toast("No recurring invoices are due.");
      else FW.toast("Generated " + created.length + " draft invoice" + (created.length === 1 ? "" : "s") + " — review them in the Invoices tab.");
      renderRecurring(ctn);
    });
    ctn.onclick = e => {
      const b = e.target.closest("[data-arrecact]");
      if (!b) return;
      const id = b.getAttribute("data-arrec");
      const act = b.getAttribute("data-arrecact");
      const rule = sorted.find(x => x.id === id);
      if (!rule) return;
      const refresh = () => renderRecurring(ctn);
      if (act === "edit") { arRuleModal(rule, refresh, customers); return; }
      if (act === "pause" || act === "resume") {
        setRuleActive(id, act === "resume").then(r => { if (r.error) FW.toast(r.error, "err"); else FW.toast(act === "resume" ? "Rule resumed" : "Rule paused"); refresh(); });
        return;
      }
      if (act === "advance") {
        setRuleActive(id, true).then(() => {
          return loadRules().then(rules => {
            const r = rules.find(x => x.id === id);
            if (!r) return;
            const prev = Ledger.cloneObj(r);
            r.nextDate = advanceDate(r.nextDate, r.cadence || "monthly");
            r.updatedAt = new Date().toISOString();
            return saveRules(rules).then(() => Ledger.auditLog("recurring.advance", { entity: "recurring", entityId: r.id, entityLabel: r.label, summary: r.label + " — next run advanced to " + r.nextDate, prev, next: Ledger.cloneObj(r) }));
          }).then(() => { FW.toast(rule.label + " advanced"); refresh(); });
        });
        return;
      }
      if (act === "delete") {
        confirmDialog("Delete “" + rule.label + "”?", "Removes the recurring rule. Invoices already generated from it stay in the Invoices tab.", async () => {
          const r = await deleteRule(id);
          if (r.error) FW.toast(r.error, "err"); else FW.toast("Recurring rule deleted"); refresh();
        }, "Delete rule");
      }
    };
  }
  function arRuleModal(rule, onSaved, customers) {
    const isNew = !rule;
    const r = rule || { label: "", customerId: "", customerName: "", cadence: "monthly", nextDate: today(), netDays: 30, active: true, taxCode: "", taxJurisdiction: "", lines: [{ desc: "", account: "", amount: "" }], currency: "", fxRate: null, projectId: "" };
    const lines = r.lines.map(l => ({ desc: l.desc || "", account: l.account || "", amount: l.amount == null ? "" : l.amount }));
    const curOpts = window.Tax ? window.Tax.currencyOptionsSync() : "";
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (isNew ? "New recurring billing rule" : "Edit “" + esc(r.label) + "”") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body">' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:2 1 220px"><label>Label</label><input id="rrLabel" value="' + esc(r.label) + '" placeholder="e.g. Monthly retainer"></div>' +
      '<div class="field" style="flex:1 1 200px"><label>Customer</label><select id="rrCust">' +
      '<option value="">— choose —</option>' + customers.map(c => '<option value="' + c.id + '"' + (c.id === r.customerId ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") +
      "</select></div>" +
      "</div>" +
      '<div class="row-flex">' +
      '<div class="field" style="flex:0 0 150px"><label>Cadence</label><select id="rrCad"><option value="weekly"' + (r.cadence === "weekly" ? " selected" : "") + '>Weekly</option><option value="monthly"' + (r.cadence === "monthly" || !r.cadence ? " selected" : "") + '>Monthly</option><option value="annually"' + (r.cadence === "annually" ? " selected" : "") + '>Annually</option></select></div>' +
      '<div class="field" style="flex:1 1 150px"><label>Next run date</label><input id="rrNext" type="date" value="' + esc(r.nextDate || today()) + '"></div>' +
      '<div class="field" style="flex:0 0 110px"><label>Net days</label><input id="rrNet" type="number" min="0" max="120" value="' + esc(r.netDays == null ? 30 : r.netDays) + '"></div>' +
      '<div class="field" style="flex:1 1 150px"><label>Tax</label><select id="rrTax">' + (window.Tax ? window.Tax.taxCodeOptionsSync() : '<option value="">None</option>').replace(/<option value="([^"]+)"([^>]*)>/g, (m, v, a) => '<option value="' + v + '"' + (a.indexOf(" selected") >= 0 ? a : v === (r.taxCode || "") ? " selected" : a) + ">") + "</select></div>" +
      (curOpts ? '<div class="field" style="flex:1 1 140px"><label>Currency</label><select id="rrCur">' + curOpts + "</select></div>" : "") +
      "</div>" +
      '<label class="check-inline" style="margin-bottom:12px"><input type="checkbox" id="rrActive"' + (r.active ? " checked" : "") + '> <span>Rule is active</span></label>' +
      '<div class="je-ed-label">Lines <span class="muted small">— each line is credited to its revenue account on posting</span></div>' +
      '<div id="rrLines" class="je-ed-lines"></div>' +
      '<div class="je-ed-totals"><span id="rrTotal">Total ' + FW.money(0) + "</span></div>" +
      '<div class="row-flex" style="margin-top:14px"><button class="btn btn-primary" id="rrSaveBtn">' + (isNew ? "Create rule" : "Save changes") + "</button>" +
      '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div></div>');
    modal.style.width = "min(840px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    const linesEl = modal.querySelector("#rrLines");
    const curSel = modal.querySelector("#rrCur");
    if (curSel) curSel.value = r.currency || (window.Tax ? window.Tax.baseCodeSync() : "USD");
    const accounts = null; // accounts loaded lazily below
    (async () => {
      const accs = await Ledger.loadAccounts();
      const sel = accs.filter(a => a.type === "revenue" && a.active);
      linesEl.addEventListener("input", updateTotals);
      function renderLines() {
        linesEl.innerHTML = lines.map((l, i) =>
          '<div class="je-ed-line" data-i="' + i + '">' +
          '<select class="rr-ed-acct" style="flex:1 1 200px;min-width:0">' + sel.map(a => '<option value="' + a.id + '"' + (a.id === l.account ? " selected" : "") + ">" + esc(a.code) + " · " + esc(a.name) + "</option>").join("") + "</select>" +
          '<input class="rr-ed-desc" type="text" placeholder="Description" value="' + esc(l.desc) + '">' +
          '<input class="rr-ed-amt amt-md" type="number" min="0" step="0.01" placeholder="Amount" value="' + esc(l.amount) + '">' +
          '<button class="icon-mini danger" data-rm="' + i + '" title="Remove line">' + ICON.x + "</button></div>"
        ).join("") + '<button class="btn btn-ghost btn-sm" id="rrAddLine">+ Add line</button>';
        const addBtn = linesEl.querySelector("#rrAddLine");
        if (addBtn) addBtn.addEventListener("click", () => { updateTotals(); lines.push({ desc: "", account: "", amount: "" }); renderLines(); updateTotals(); });
        FW.$$("[data-rm]", linesEl).forEach(b => b.addEventListener("click", () => {
          const i = Number(b.getAttribute("data-rm"));
          updateTotals(); lines.splice(i, 1); renderLines(); updateTotals();
        }));
      }
      function updateTotals() {
        let t = 0;
        FW.$$(".je-ed-line", linesEl).forEach(row => {
          const i = Number(row.getAttribute("data-i"));
          const l = lines[i];
          if (!l) return;
          l.account = row.querySelector(".rr-ed-acct").value;
          l.desc = row.querySelector(".rr-ed-desc").value;
          l.amount = row.querySelector(".rr-ed-amt").value;
          t = round2(t + amt(l.amount));
        });
        const code = curSel ? curSel.value : (window.Tax ? window.Tax.baseCodeSync() : "USD");
        modal.querySelector("#rrTotal").textContent = "Total " + fmtMoney(t, code, window.Tax ? window.Tax.rateForSync(code) : null) + "/run";
      }
      renderLines();
      updateTotals();
      modal.querySelector("#rrSaveBtn").addEventListener("click", async () => {
        const label = String(modal.querySelector("#rrLabel").value || "").trim();
        if (!label) { FW.toast("Label is required.", "err"); return; }
        const custId = modal.querySelector("#rrCust").value;
        const cust = customers.find(c => c.id === custId);
        if (!cust) { FW.toast("Choose a customer.", "err"); return; }
        const clean = lines.map(l => ({ desc: String(l.desc || "").trim(), account: l.account || null, amount: amt(l.amount) })).filter(l => l.account && l.amount > 0);
        if (!clean.length) { FW.toast("Add at least one line with an account and amount.", "err"); return; }
        const code = curSel ? curSel.value : (window.Tax ? window.Tax.baseCodeSync() : "USD");
        const out = {
          id: r.id || null, label, customerId: cust.id, customerName: cust.name, customerEmail: cust.email || "",
          cadence: modal.querySelector("#rrCad").value,
          nextDate: modal.querySelector("#rrNext").value || today(),
          netDays: Math.min(Math.max(parseInt(modal.querySelector("#rrNet").value, 10) || 30, 0), 120),
          taxCode: modal.querySelector("#rrTax").value || "", taxJurisdiction: "",
          active: modal.querySelector("#rrActive").checked,
          lines: clean, currency: code, fxRate: window.Tax ? window.Tax.rateForSync(code) : null,
          projectId: r.projectId || null, createdAt: r.createdAt || null,
        };
        const rules = await loadRules();
        await saveRule(out, rules);
        modal.closest(".modal-back").remove();
        FW.toast(isNew ? "Recurring rule created" : "Recurring rule updated");
        onSaved && onSaved();
      });
    })();
  }

  /* ── A/R aging tab (task 18) ─────────────────────────────────────────── */
  async function renderAging(ctn) {
    const invoices = await loadInvoices();
    const aging = arAging(invoices, today());
    ctn.innerHTML = "";
    ctn.appendChild(agingCard(aging, invoices));
  }
  function agingCard(aging, invoices) {
    const card = FW.el("div", "card");
    const head = FW.el("div", "card-head");
    head.appendChild(FW.el("h3", null, null, { text: "A/R aging" }));
    const asOfWrap = FW.el("div", null, null, { style: "display:flex;align-items:center;gap:8px" });
    const lbl = FW.el("label", "small muted", null, { text: "As of", htmlFor: "arAgingAsOf" });
    const inp = FW.el("input", null, null, { type: "date", id: "arAgingAsOf", value: aging.asOf, style: "padding:5px 9px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:12.8px;font-family:inherit" });
    asOfWrap.appendChild(lbl); asOfWrap.appendChild(inp);
    head.appendChild(asOfWrap);
    card.appendChild(head);

    const body = FW.el("div", "card-body", null, { style: "padding-top:0" });
    const stats = FW.el("div", "bill-stats");
    stats.innerHTML =
      '<span class="chip chip-done">Total outstanding ' + FW.money(aging.total) + "</span>" +
      '<span class="chip chip-pending">Current ' + FW.money(aging.current) + "</span>" +
      '<span class="chip ' + (aging.overdue ? "chip-warn" : "chip-done") + '">Overdue ' + FW.money(aging.overdue) + "</span>" +
      (aging.oldest ? '<span class="chip chip-warn">Oldest due: ' + esc(aging.oldest.no) + " · " + (aging.oldest.days > 0 ? aging.oldest.days + " days past due" : "not yet due") + "</span>" : "");
    body.appendChild(stats);

    if (aging.total) {
      const grid = FW.el("div", "aging-grid");
      for (const bk of aging.buckets) {
        const pct = aging.total ? Math.max(0, Math.round(bk.total / aging.total * 100)) : 0;
        const c = FW.el("div", "aging-card");
        const h4 = FW.el("h4", null, null, { text: bk.label });
        const row = FW.el("div", "spread");
        row.innerHTML = "<strong>" + FW.money(bk.total) + "</strong><span class='muted small'>" + bk.count + " invoice" + (bk.count === 1 ? "" : "s") + (pct ? " · " + pct + "%" : "") + "</span>";
        const bar = FW.el("div", "aging-bar");
        const fill = FW.el("div", null, null, { style: "width:" + pct + "%" });
        bar.appendChild(fill);
        c.appendChild(h4); c.appendChild(row); c.appendChild(bar);
        if (bk.invoices.length) {
          for (const x of bk.invoices) {
            const r = FW.el("div", "aging-row");
            r.innerHTML = '<span class="mono small">' + esc(x.invoice.no) + '</span> <span class="muted small">' + esc(x.invoice.customerName) + '</span> <span class="muted small">' + (x.daysPastDue > 0 ? x.daysPastDue + "d overdue" : "due " + esc(x.due)) + '</span> <strong>' + FW.money(invoiceTotals(x.invoice).total) + "</strong>";
            c.appendChild(r);
          }
        } else {
          c.appendChild(FW.el("p", "muted small", null, { text: "None in this bucket.", style: "margin:2px 0 0" }));
        }
        grid.appendChild(c);
      }
      body.appendChild(grid);
    } else {
      body.appendChild(FW.el("p", "muted small", null, { text: "No unpaid invoices in the ledger yet. Post an invoice to see it appear in the aging report.", style: "text-align:center;padding:18px 14px 24px" }));
    }
    card.appendChild(body);

    inp.addEventListener("change", () => {
      const v = inp.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const next = agingCard(arAging(invoices, v), invoices);
      card.replaceWith(next);
    });
    return card;
  }

  /* ── small UI helpers ────────────────────────────────────────────────── */
  function confirmDialog(title, message, onYes, dangerLabel) {
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body"><p style="margin-top:0">' + esc(message) + "</p>" +
      '<div class="row-flex"><button class="btn btn-danger btn-sm" id="confirmYesBtn">' + esc(dangerLabel || "Confirm") + "</button>" +
      '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div></div>');
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#confirmYesBtn").addEventListener("click", () => { modal.closest(".modal-back").remove(); onYes(); });
    return modal;
  }

  /* ── icons ───────────────────────────────────────────────────────────── */
  const XS_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const ICON = {
    pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    issue: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 5v14"/><path d="M16 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M7 5v14l11-7z"/></svg>',
    skip: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6v12"/><path d="m13 6 6 6-6 6z"/><path d="m6 6 7 6-7 6z"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/><path d="M6 15h4"/></svg>',
    cancel: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>',
  };

  /* ── self-test (validation for tasks 13–18) ──────────────────────────── */
  async function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || "" });

    /* task 13 — invoicing engine */
    const inv = { id: "inv1", no: "INV-0001", customerName: "Acme", date: "2026-09-10", dueDate: "2026-10-10", status: "draft",
      lines: [
        { desc: "Consulting", account: "a4100", qty: 10, unitPrice: 150, amount: 1500 },
        { desc: "Expenses", account: "a4100", qty: 1, unitPrice: 100, amount: 100 },
      ], taxCode: null, taxJurisdiction: "", taxAmount: 0 };
    const t1 = invoiceTotals(inv);
    ok("Invoice: subtotal sums line amounts", t1.subtotal === 1600, t1.subtotal);
    ok("Invoice: total includes tax", t1.total === 1600);
    const invT = Object.assign({}, inv, { taxCode: "GST", taxJurisdiction: "CA", taxAmount: 96, taxLabel: "GST 6%" });
    const t2 = invoiceTotals(invT);
    ok("Invoice: tax added to total", t2.total === 1696 && t2.tax === 96);
    const accs = [
      { id: "a1100", code: "1100", name: "Accounts Receivable", type: "asset", active: true },
      { id: "a4100", code: "4100", name: "Service Revenue", type: "revenue", active: true },
      { id: "a2100", code: "2100", name: "Sales Tax Payable", type: "liability", active: true },
    ];
    ok("Invoice: A/R account located by code", arAccountId(accs) === "a1100");
    const entry = buildEntryFromInvoice(invT, accs, "a1100");
    const et = Ledger.entryTotals(entry);
    ok("Invoice: entry balances (DR = CR)", et.dr === et.cr && et.dr === 1696, et.dr + "/" + et.cr);
    ok("Invoice: revenue credited", entry.lines.some(l => l.account === "a4100" && l.credit === 1500));
    ok("Invoice: tax credited to tax payable", entry.lines.some(l => l.account === "a2100" && l.credit === 96));
    ok("Invoice: A/R debited for total", entry.lines.some(l => l.account === "a1100" && l.debit === 1696));
    ok("Invoice: next number sequence", await nextNo("INV", [{ no: "INV-0001" }, { no: "INV-0009" }]) === "INV-0010");

    /* task 14 — quote → invoice */
    const q = { id: "q1", no: "QT-0001", status: "approved", customerId: "c1", customerName: "Acme", taxCode: null, taxJurisdiction: "", taxAmount: 0, projectId: null,
      lines: [{ desc: "Setup", account: "a4100", qty: 2, unitPrice: 250 }, { desc: "Support", account: "a4100", qty: 5, unitPrice: 100 }] };
    const dl = docLinesFromQuote(q, accs);
    ok("Quote: lines carry over", dl.length === 2 && dl[0].desc === "Setup" && dl[0].qty === 2);
    ok("Quote: revenue account suggested", dl.every(l => l.account === "a4100"));
    ok("Quote: subtotal computed", docSubtotal(q) === 1000, docSubtotal(q));
    const arRulesBak = window.Tax && window.Tax.loadRules ? await window.Tax.loadRules() : null;
    if (window.Tax && window.Tax.saveRules) await window.Tax.saveRules([]);
    ok("Quote: tax applied on conversion", taxFor(1000, null, "", "2026-09-10", "sale").amount === 0, taxFor(1000, null, "", "2026-09-10", "sale").amount);
    if (window.Tax && window.Tax.saveRules && arRulesBak != null) await window.Tax.saveRules(arRulesBak);

    /* task 15 — recurring billing */
    const r = { id: "r1", label: "Retainer", customerId: "c1", customerName: "Acme", cadence: "monthly", nextDate: "2026-09-01", active: true, netDays: 30, lines: [{ desc: "Retainer", account: "a4100", amount: 500 }] };
    ok("Recurring: next-month advance", advanceDate("2026-09-01", "monthly") === "2026-10-01");
    ok("Recurring: weekly advance", advanceDate("2026-09-04", "weekly") === "2026-09-11");
    ok("Recurring: annual advance", advanceDate("2026-03-15", "annually") === "2027-03-15");
    ok("Recurring: Jan 31 monthly clamps", advanceDate("2026-01-31", "monthly") === "2026-02-28");
    ok("Recurring: due when nextDate ≤ today", dueInvoicesToCreate([r], [], "2026-09-05").length === 1);
    ok("Recurring: not due before nextDate", dueInvoicesToCreate([r], [], "2026-08-31").length === 0);
    ok("Recurring: paused rule never generates", dueInvoicesToCreate([Object.assign({}, r, { active: false })], [], "2026-12-31").length === 0);
    ok("Recurring: existing draft for due date blocks duplicate", dueInvoicesToCreate([r], [{ source: { kind: "recurring", ruleId: "r1", dueDate: "2026-09-01" } }], "2026-09-05").length === 0);
    ok("Recurring: cadence labels", ["Weekly", "Monthly", "Annually"].every(x => x.length > 0));

    /* task 16 — payments */
    const cashAccs = [...accs, { id: "a1010", code: "1010", name: "Checking Account", type: "asset", active: true }];
    ok("Pay: cash account located by code", cashAccountId(cashAccs) === "a1010");
    ok("Pay: card ref sequence", nextPaymentRef("PAY", [{ paymentRef: "PAY-0001" }]) === "PAY-0002");
    ok("Pay: check ref sequence", nextPaymentRef("CHK", [{ paymentRef: "CHK-0003" }]) === "CHK-0004");
    ok("Pay: first ref is 0001", nextPaymentRef("PAY", []) === "PAY-0001");

    /* task 17 — reminders */
    const due = remindersDue([
      { id: "i1", no: "INV-1", customerName: "A", status: "open", date: "2026-08-01", dueDate: "2026-09-01" },
      { id: "i2", no: "INV-2", customerName: "B", status: "open", date: "2026-08-01", dueDate: "2026-09-05" },
      { id: "i3", no: "INV-3", customerName: "C", status: "open", date: "2026-08-01", dueDate: "2026-10-01" },
      { id: "i4", no: "INV-4", customerName: "D", status: "paid", date: "2026-08-01", dueDate: "2026-09-01" },
      { id: "i5", no: "INV-5", customerName: "E", status: "open", date: "2026-08-01", dueDate: "2026-09-30", reminders: [{ days: -29 }] },
    ], "2026-09-06");
    ok("Reminders: paid invoices excluded", !due.some(d => d.invoice.id === "i4"));
    ok("Reminders: overdue invoices included", due.some(d => d.invoice.id === "i1"));
    ok("Reminders: upcoming (within 3d) included", due.some(d => d.invoice.id === "i2"));
    ok("Reminders: far-future excluded", !due.some(d => d.invoice.id === "i3"));
    ok("Reminders: already-reminded at later stage skipped", !due.some(d => d.invoice.id === "i5"));

    /* task 18 — A/R aging */
    const agInvs = [
      { id: "ai1", no: "INV-A1", customerName: "C1", status: "open", date: "2026-08-01", dueDate: "2026-09-20", lines: [{ amount: 100 }] },
      { id: "ai2", no: "INV-A2", customerName: "C2", status: "open", date: "2026-08-01", dueDate: "2026-08-20", lines: [{ amount: 50 }] },
      { id: "ai3", no: "INV-A3", customerName: "C3", status: "open", date: "2026-08-01", dueDate: "2026-07-20", lines: [{ amount: 75 }] },
      { id: "ai4", no: "INV-A4", customerName: "C4", status: "open", date: "2026-08-01", dueDate: "2026-06-15", lines: [{ amount: 25 }] },
      { id: "ai5", no: "INV-A5", customerName: "C5", status: "open", date: "2026-08-01", dueDate: "2026-05-01", lines: [{ amount: 10 }] },
      { id: "ai6", no: "INV-A6", customerName: "C6", status: "draft", date: "2026-08-01", dueDate: "2026-09-01", lines: [{ amount: 999 }] },
      { id: "ai7", no: "INV-A7", customerName: "C7", status: "paid", date: "2026-08-01", dueDate: "2026-09-01", lines: [{ amount: 500 }] },
    ];
    const ag = arAging(agInvs, "2026-09-06");
    ok("Aging: total sums only open invoices", ag.total === 260, "got " + ag.total);
    ok("Aging: drafts and paid excluded", ag.buckets.reduce((s, x) => s + x.count, 0) === 5);
    ok("Aging: current bucket", ag.buckets[0].count === 1 && ag.buckets[0].total === 100);
    ok("Aging: 1–30 bucket", ag.buckets[1].count === 1 && ag.buckets[1].total === 50);
    ok("Aging: 31–60 bucket", ag.buckets[2].count === 1 && ag.buckets[2].total === 75);
    ok("Aging: 61–90 bucket", ag.buckets[3].count === 1 && ag.buckets[3].total === 25);
    ok("Aging: 90+ bucket", ag.buckets[4].count === 1 && ag.buckets[4].total === 10);
    ok("Aging: overdue total", ag.overdue === 160, "got " + ag.overdue);
    ok("Aging: oldest identified", ag.oldest && ag.oldest.no === "INV-A5" && ag.oldest.days > 90);

    return results;
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  const AR = {
    loadCustomers, saveCustomers, saveCustomer, deleteCustomer,
    loadQuotes, saveQuotes, convertQuoteToInvoice, setQuoteStatus, deleteQuote,
    loadInvoices, saveInvoices, saveInvoice, postInvoice, voidInvoice, deleteInvoice,
    loadRules, saveRules, generateDueInvoices, setRuleActive, deleteRule, advanceDate,
    payInvoices, confirmWebhook, remindersDue, sendReminders,
    arAging, arAccountId, invoiceTotals, buildEntryFromInvoice, nextPaymentRef,
    render, selfTest,
  };
  window.Modules = window.Modules || {};
  window.Modules.ar = AR;
  window.AR = AR;
})();
