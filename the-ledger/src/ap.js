/* ============================================================================
   THE LEDGER — ap.js
   Accounts Payable module (Phase 2, tasks 7–12):
     7. Purchase orders — vendor details + line-item descriptions, with a
        lifecycle (draft → ordered → received) and conversion into bills.
     8. Vendor bill entry — record bills from vendors, matching line items to
        existing POs (or creating fresh expense lines), and post the bill to
        the ledger as DR expenses / CR Accounts Payable.
     9. Recurring expense automation — recurring rules generate draft bills
        when their next due date arrives; posting a draft advances the rule
        to the following month.
    10. Line-item matching engine — validate a bill against its PO, flagging
        quantity over-billing, unit-price and amount variances, unmatched
        lines and unbilled PO lines.
    11. Payment disbursement (ACH/check) — pay open bills: generates a
        payment reference (CHK/ACH-####), marks bills paid, and posts the
        DR Accounts Payable / CR cash entry to the ledger.
    12. A/P aging — buckets unpaid open bills by days past due
        (current, 1–30, 31–60, 61–90, 90+).
   Data persists per-browser via FW.store (kv-plugin folder "ledgerly"):
     key "pos"       → array of purchase-order objects
     key "bills"     → array of vendor bill objects
     key "recurring" → array of recurring-expense rule objects
   Audit records reuse the ledger's "audit" key (entity purchase_order/bill/
   recurring/payment). Posting bills and payments delegates to window.Ledger
   so balances, trial balance and period closing all stay consistent.
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;
  const Ledger = window.Ledger;
  const K = { pos: "pos", bills: "bills", recurring: "recurring" };

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function parseDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function addDays(s, n) { const p = parseDate(s); if (!p) return s; const d = new Date(p.y, p.m - 1, p.d + n); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function nextMonthDate(s) {
    const p = parseDate(s); if (!p) return s;
    let y = p.y, m = p.m + 1;
    if (m > 12) { m = 1; y++; }
    const d = Math.min(p.d, daysInMonth(y, m));
    return y + "-" + pad2(m) + "-" + pad2(d);
  }
  async function nextNo(prefix, list) {
    let max = 0;
    const re = new RegExp("^" + prefix + "-(\\d+)$");
    for (const x of list) { const m = re.exec(x.no || ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return prefix + "-" + String(max + 1).padStart(4, "0");
  }

  /* ── persistence ─────────────────────────────────────────────────────── */
  async function loadPOs() { const v = await FW.store.get(K.pos, null); return Array.isArray(v) ? v : []; }
  async function savePOs(list) { await FW.store.set(K.pos, list); }
  async function loadBills() { const v = await FW.store.get(K.bills, null); return Array.isArray(v) ? v : []; }
  async function saveBills(list) { await FW.store.set(K.bills, list); }
  async function loadRecurring() { const v = await FW.store.get(K.recurring, null); return Array.isArray(v) ? v : []; }
  async function saveRecurring(list) { await FW.store.set(K.recurring, list); }

  /* ── purchase-order engine ───────────────────────────────────────────── */
  const PO_STATES = ["draft", "ordered", "received", "partially_billed", "billed", "cancelled"];
  const PO_TRANSITIONS = {
    draft: ["ordered", "cancelled"],
    ordered: ["received", "cancelled"],
    received: [],
    partially_billed: ["received"],
    billed: [],
    cancelled: [],
  };
  const poStatusLabel = s => ({ draft: "Draft", ordered: "Ordered", received: "Received", partially_billed: "Partially billed", billed: "Billed", cancelled: "Cancelled" }[s] || s);
  const poStatusChip = s => ({
    draft: "chip-pending", ordered: "chip-phase", received: "chip-done", partially_billed: "chip-warn", billed: "chip-done", cancelled: "chip-muted",
  }[s] || "chip-pending");
  function poCanTransition(from, to) { return (PO_TRANSITIONS[from] || []).includes(to); }

  function poLineAmount(qty, unitPrice) { return round2(amt(qty) * amt(unitPrice)); }
  function poTotal(po) { return round2((po.lines || []).reduce((s, l) => s + poLineAmount(l.qty, l.unitPrice), 0)); }
  /* qty of each PO line that has been billed so far (summed over all bills) */
  function matchedBilledQty(po, bills) {
    const byLine = {};
    for (const l of po.lines || []) byLine[l.id] = 0;
    for (const b of bills) for (const bl of (b.lines || [])) {
      if (bl.match && bl.match.poId === po.id && byLine[bl.match.poLineId] != null)
        byLine[bl.match.poLineId] = round2(byLine[bl.match.poLineId] + amt(bl.qty));
    }
    return byLine;
  }
  function poStatusFromBilling(po, billedByLine) {
    const lines = po.lines || [];
    if (!lines.length) return po.status;
    const all = lines.every(l => (billedByLine[l.id] || 0) >= amt(l.qty) - 0.005);
    const some = lines.some(l => (billedByLine[l.id] || 0) >= 0.005);
    if (all) return "billed";
    if (some) return "partially_billed";
    return po.status;
  }

  async function savePO(po, list) {
    const p = Object.assign({}, po);
    if (!p.id) p.id = uid("po");
    if (!p.createdAt) p.createdAt = new Date().toISOString();
    if (!p.status) p.status = "draft";
    p.lines = (p.lines || []).map(l => ({
      id: l.id || uid("pol"),
      desc: String(l.desc || "").trim(),
      qty: amt(l.qty), unitPrice: amt(l.unitPrice),
      received: amt(l.received == null ? 0 : l.received),
    }));
    p.updatedAt = new Date().toISOString();
    const prev = list.find(x => x.id === p.id) || null;
    const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = p; else list.push(p);
    await savePOs(list);
    const label = p.no + " · " + p.vendor;
    await Ledger.auditLog(prev ? "po.update" : "po.create", {
      entity: "purchase_order", entityId: p.id, entityLabel: label,
      summary: (prev ? "Edited " : "Created ") + p.no + " · " + p.vendor + " — " + FW.money(poTotal(p)),
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(p),
    });
    return p;
  }

  async function setPOStatus(id, to) {
    const pos = await loadPOs();
    const po = pos.find(x => x.id === id);
    if (!po) return { error: "Purchase order not found." };
    if (po.status === to) return { ok: true };
    if (to === "ordered" && po.status !== "draft") return { error: "Only draft purchase orders can be issued." };
    if (to === "received" && !["ordered", "partially_billed"].includes(po.status)) return { error: "A purchase order must be ordered before it can be marked received." };
    if (to === "cancelled" && !["draft", "ordered"].includes(po.status)) return { error: "Only draft or ordered purchase orders can be cancelled." };
    const prev = Ledger.cloneObj(po);
    po.status = to;
    if (to === "received") for (const l of po.lines || []) l.received = amt(l.qty);
    po.updatedAt = new Date().toISOString();
    await savePOs(pos);
    await Ledger.auditLog("po.status", {
      entity: "purchase_order", entityId: po.id, entityLabel: po.no + " · " + po.vendor,
      summary: po.no + " → " + poStatusLabel(to),
      prev, next: Ledger.cloneObj(po),
    });
    return { ok: true };
  }

  async function deletePO(id) {
    const pos = await loadPOs();
    const bills = await loadBills();
    const po = pos.find(x => x.id === id);
    if (!po) return { error: "Purchase order not found." };
    if (!["draft", "cancelled"].includes(po.status)) return { error: "Only draft or cancelled purchase orders can be deleted." };
    if (bills.some(b => b.poId === id)) return { error: "This PO has linked bills — delete those first." };
    const i = pos.indexOf(po); pos.splice(i, 1);
    await savePOs(pos);
    await Ledger.auditLog("po.delete", {
      entity: "purchase_order", entityId: id, entityLabel: po.no + " · " + po.vendor,
      summary: "Deleted " + po.no + " · " + po.vendor,
      prev: Ledger.cloneObj(po), next: null,
    });
    return { ok: true };
  }

  function suggestAccountFor(desc, accounts) {
    const d = String(desc || "").toLowerCase();
    const map = [
      [/rent|lease/i, "5100"], [/electric|gas|water|internet|phone|utility/i, "5200"],
      [/suppl|paper|office/i, "5300"], [/market|advert|promo/i, "5400"],
      [/insur/i, "5500"], [/payroll|salary|wage|bonus/i, "5600"],
      [/legal|accounting|consult|attorney|professional/i, "5700"],
      [/travel|flight|hotel|mileage/i, "5800"], [/software|subscription|saas|hosting/i, "5950"],
    ];
    for (const [re, code] of map) { const a = accounts.find(x => x.code === code); if (re.test(d) && a) return a.id; }
    const misc = accounts.find(x => x.code === "5950");
    return misc ? misc.id : null;
  }

  async function convertPOtoBill(poId) {
    const pos = await loadPOs();
    const bills = await loadBills();
    const accounts = await Ledger.loadAccounts();
    const po = pos.find(x => x.id === poId);
    if (!po) return { error: "Purchase order not found." };
    if (po.status === "cancelled") return { error: "A cancelled purchase order can't be converted into a bill." };
    if (po.status === "billed") return { error: po.no + " is already fully billed." };
    const billed = matchedBilledQty(po, bills);
    const remaining = (po.lines || []).filter(l => amt(l.qty) - (billed[l.id] || 0) > 0.005);
    if (!remaining.length) return { error: po.no + " has no unbilled lines left." };
    const bill = {
      id: uid("bill"), no: await nextNo("BILL", bills),
      vendor: po.vendor, vendorEmail: po.vendorEmail || "",
      billNumber: "", billDate: today(), dueDate: addDays(today(), 30),
      memo: "From " + po.no,
      status: "draft", poId: po.id, poNo: po.no,
      lines: remaining.map(l => {
        const qty = round2(amt(l.qty) - (billed[l.id] || 0));
        return { id: uid("bl"), desc: l.desc, account: suggestAccountFor(l.desc, accounts), qty, unitPrice: amt(l.unitPrice), amount: poLineAmount(qty, l.unitPrice), match: { poId: po.id, poLineId: l.id } };
      }),
      ledgerEntryId: null, postedAt: null, source: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    bills.push(bill);
    await saveBills(bills);
    const prev = Ledger.cloneObj(po);
    const nb = matchedBilledQty(po, bills);
    po.status = poStatusFromBilling(po, nb);
    po.updatedAt = new Date().toISOString();
    await savePOs(pos);
    await Ledger.auditLog("po.bill", {
      entity: "purchase_order", entityId: po.id, entityLabel: po.no + " · " + po.vendor,
      summary: "Created " + bill.no + " from " + po.no + " — " + FW.money(billTotal(bill)),
      prev, next: Ledger.cloneObj(po),
    });
    await Ledger.auditLog("bill.create", {
      entity: "bill", entityId: bill.id, entityLabel: bill.no + " · " + bill.vendor,
      summary: "Created " + bill.no + " from " + po.no,
      prev: null, next: Ledger.cloneObj(bill),
    });
    return { ok: true, bill };
  }

  /* ── vendor-bill engine ──────────────────────────────────────────────── */
  function billTotal(bill) { return round2((bill.lines || []).reduce((s, l) => s + amt(l.amount), 0)); }
  function billStatusLabel(s) { return s === "open" ? "In ledger · unpaid" : s === "paid" ? "Paid" : "Draft"; }
  function apAccountId(accounts) {
    let a = accounts.find(x => x.code === "2000" && x.type === "liability");
    if (!a) a = accounts.find(x => x.type === "liability" && /payable/i.test(x.name || ""));
    if (!a) a = accounts.find(x => x.type === "liability");
    return a ? a.id : null;
  }
  function debitAccountOptions(accounts, cur) {
    return accounts
      .filter(a => (a.type === "asset" || a.type === "expense") && (a.active || a.id === cur))
      .map(a => '<option value="' + a.id + '"' + (a.id === cur ? " selected" : "") + ">" + esc(a.code) + " · " + esc(a.name) + (a.active ? "" : " (inactive)") + "</option>").join("");
  }
  function buildEntryFromBill(bill, accounts, apId) {
    const lines = (bill.lines || []).filter(l => l.account && amt(l.amount) > 0).map(l => ({
      account: l.account, desc: l.desc || bill.vendor, debit: amt(l.amount), credit: 0,
    }));
    lines.push({
      account: apId,
      desc: "Accounts payable — " + bill.vendor + (bill.billNumber ? " (#" + bill.billNumber + ")" : ""),
      debit: 0, credit: billTotal(bill),
    });
    return {
      date: bill.billDate,
      reference: bill.no + (bill.billNumber ? " · " + bill.billNumber : ""),
      memo: "Vendor bill " + bill.no + " — " + bill.vendor,
      status: "draft", lines,
      projectId: bill.projectId || null,
    };
  }

  async function recomputePO(poId) {
    const pos = await loadPOs();
    const bills = await loadBills();
    const po = pos.find(x => x.id === poId);
    if (!po) return;
    const st = poStatusFromBilling(po, matchedBilledQty(po, bills));
    if (st !== po.status) {
      const prev = Ledger.cloneObj(po);
      po.status = st; po.updatedAt = new Date().toISOString();
      await savePOs(pos);
      await Ledger.auditLog("po.status", {
        entity: "purchase_order", entityId: po.id, entityLabel: po.no + " · " + po.vendor,
        summary: po.no + " → " + poStatusLabel(st) + " (bill matching)",
        prev, next: Ledger.cloneObj(po),
      });
    }
  }

  async function saveBill(bill, list) {
    const b = Object.assign({}, bill);
    if (!b.id) b.id = uid("bill");
    if (!b.createdAt) b.createdAt = new Date().toISOString();
    b.lines = (b.lines || []).map(l => ({
      id: l.id || uid("bl"),
      desc: String(l.desc || "").trim(),
      account: l.account || null,
      qty: amt(l.qty == null ? 1 : l.qty), unitPrice: amt(l.unitPrice), amount: amt(l.amount),
      match: l.match || null,
    }));
    b.updatedAt = new Date().toISOString();
    const prev = list.find(x => x.id === b.id) || null;
    const i = list.findIndex(x => x.id === b.id);
    if (i >= 0) list[i] = b; else list.push(b);
    await saveBills(list);
    const poIds = new Set();
    if (b.poId) poIds.add(b.poId);
    for (const l of b.lines) if (l.match && l.match.poId) poIds.add(l.match.poId);
    for (const pid of poIds) await recomputePO(pid);
    const label = b.no + " · " + b.vendor;
    await Ledger.auditLog(prev ? "bill.update" : "bill.create", {
      entity: "bill", entityId: b.id, entityLabel: label,
      summary: (prev ? "Edited " : "Created ") + b.no + " · " + b.vendor + " — " + FW.money(billTotal(b)),
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(b),
    });
    return b;
  }

  async function postBill(id) {
    const bills = await loadBills();
    const b = bills.find(x => x.id === id);
    if (!b) return { error: "Bill not found." };
    if (b.status !== "draft") return { error: "Only draft bills can be posted." };
    const usable = (b.lines || []).filter(l => l.account && amt(l.amount) > 0);
    if (!usable.length) return { error: "Add at least one line with an account and amount before posting." };
    const total = billTotal(b);
    if (total <= 0) return { error: "Bill total must be greater than zero." };
    const accounts = await Ledger.loadAccounts();
    const ap = apAccountId(accounts);
    if (!ap) return { error: "No Accounts Payable account found in the chart of accounts." };
    for (const l of usable) if (!accounts.find(a => a.id === l.account)) return { error: "A bill line references an unknown account." };
    const entry = buildEntryFromBill(b, accounts, ap);
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
    const prev = Ledger.cloneObj(b);
    b.status = "open";
    b.ledgerEntryId = res.id;
    b.postedAt = new Date().toISOString();
    b.updatedAt = new Date().toISOString();
    await saveBills(bills);
    await Ledger.auditLog("bill.post", {
      entity: "bill", entityId: b.id, entityLabel: b.no + " · " + b.vendor,
      summary: "Posted " + b.no + " — " + FW.money(total) + " to accounts payable (entry " + entry.no + ")",
      prev, next: Ledger.cloneObj(b),
    });
    if (b.source && b.source.kind === "recurring") {
      const rules = await loadRecurring();
      const rule = rules.find(x => x.id === b.source.ruleId);
      if (rule) {
        const rprev = Ledger.cloneObj(rule);
        rule.nextDate = nextMonthDate(rule.nextDate);
        rule.updatedAt = new Date().toISOString();
        await saveRecurring(rules);
        await Ledger.auditLog("recurring.advance", {
          entity: "recurring", entityId: rule.id, entityLabel: rule.label,
          summary: rule.label + " — next run advanced to " + rule.nextDate,
          prev: rprev, next: Ledger.cloneObj(rule),
        });
      }
    }
    return { ok: true, entryId: res.id, entryNo: entry.no };
  }

  async function deleteBill(id) {
    const bills = await loadBills();
    const b = bills.find(x => x.id === id);
    if (!b) return { error: "Bill not found." };
    if (b.status !== "draft") return { error: "Posted bills are recorded in the ledger and can't be deleted — void them via a payment instead." };
    const i = bills.indexOf(b); bills.splice(i, 1);
    await saveBills(bills);
    if (b.poId) await recomputePO(b.poId);
    await Ledger.auditLog("bill.delete", {
      entity: "bill", entityId: b.id, entityLabel: b.no + " · " + b.vendor,
      summary: "Deleted draft bill " + b.no + " · " + b.vendor,
      prev: Ledger.cloneObj(b), next: null,
    });
    return { ok: true };
  }

  /* ── payment engine (task 11) ────────────────────────────────────────── */
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
  function nextPaymentRef(method, bills) {
    const prefix = method === "check" ? "CHK" : "ACH";
    let max = 0;
    const re = new RegExp("^" + prefix + "-(\\d+)$");
    for (const b of bills) { const m = re.exec(b.paymentRef || ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return prefix + "-" + String(max + 1).padStart(4, "0");
  }
  async function payBills(ids, opts) {
    const o = opts || {};
    const method = o.method === "check" ? "check" : "ach";
    const bills = await loadBills();
    const targets = bills.filter(x => ids.includes(x.id));
    if (!targets.length) return { error: "No bills selected." };
    if (targets.some(x => x.status !== "open")) return { error: "Only bills that are in the ledger and unpaid can be paid." };
    const total = round2(targets.reduce((s, x) => s + billTotal(x), 0));
    if (total <= 0) return { error: "Payment total must be greater than zero." };
    const accounts = await Ledger.loadAccounts();
    const ap = apAccountId(accounts);
    if (!ap) return { error: "No Accounts Payable account found in the chart of accounts." };
    const cash = o.cashAccountId || cashAccountId(accounts);
    if (!cash) return { error: "No cash/bank account found to pay from." };
    if (cash === ap) return { error: "Payment account can't be the same as Accounts Payable." };
    for (const id of [ap, cash]) if (!accounts.find(a => a.id === id)) return { error: "A payment account is not in the chart of accounts." };
    const ref = o.reference || await nextPaymentRef(method, bills);
    const entry = {
      date: o.date || today(),
      reference: ref + (targets.length === 1 ? " · " + targets[0].no : " · " + targets.length + " bills"),
      memo: o.memo || "Payment " + ref + (targets.length === 1 ? " — " + targets[0].vendor : " — " + targets.length + " vendor bills"),
      status: "draft",
      lines: [
        { account: ap, desc: "Accounts payable — payment " + ref, debit: total, credit: 0 },
        { account: cash, desc: (method === "check" ? "Check " : "ACH transfer ") + ref, debit: 0, credit: total },
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
    for (const b of targets) {
      const prev = Ledger.cloneObj(b);
      b.status = "paid";
      b.paymentRef = ref;
      b.paymentMethod = method;
      b.paymentDate = o.date || today();
      b.paymentEntryId = res.id;
      b.paidAt = now;
      b.updatedAt = now;
      await Ledger.auditLog("bill.pay", {
        entity: "payment", entityId: b.id, entityLabel: b.no + " · " + b.vendor,
        summary: b.no + " paid via " + (method === "check" ? "check" : "ACH") + " " + ref + " — " + FW.money(billTotal(b)) + " (entry " + entry.no + ")",
        prev, next: Ledger.cloneObj(b),
      });
    }
    await saveBills(bills);
    return { ok: true, entryId: res.id, entryNo: entry.no, ref, total, paid: targets.map(x => x.no) };
  }

  /* ── line-item matching engine (task 10) ─────────────────────────────── */
  function matchBillToPO(bill, po, bills) {
    const byLine = matchedBilledQty(po, bills.filter(x => x.id !== bill.id));
    const poLines = (po.lines || []).map(l => ({
      id: l.id, desc: l.desc, qty: amt(l.qty), unitPrice: amt(l.unitPrice),
      billed: byLine[l.id] || 0, remaining: round2(amt(l.qty) - (byLine[l.id] || 0)),
    }));
    const lines = [], issues = [];
    for (const bl of (bill.lines || [])) {
      if (!bl.match || bl.match.poId !== po.id) {
        lines.push({ billLineId: bl.id, desc: bl.desc || "(untitled line)", poLineId: null, status: "unmatched", billQty: amt(bl.qty), billUnitPrice: amt(bl.unitPrice), billAmount: amt(bl.amount), message: "Not matched to a PO line — recorded as a new expense." });
        if (amt(bl.amount) > 0) issues.push({ severity: "info", message: "Line “" + (bl.desc || "untitled") + "” is not matched to any PO line." });
        continue;
      }
      const pl = poLines.find(x => x.id === bl.match.poLineId);
      if (!pl) {
        lines.push({ billLineId: bl.id, desc: bl.desc || "(untitled line)", poLineId: bl.match.poLineId, status: "error", billQty: amt(bl.qty), billUnitPrice: amt(bl.unitPrice), billAmount: amt(bl.amount), message: "Bill references a PO line that no longer exists." });
        issues.push({ severity: "error", message: "Bill line references a missing PO line." });
        continue;
      }
      const qty = amt(bl.qty), price = amt(bl.unitPrice), amount = amt(bl.amount);
      const expected = round2(qty * pl.unitPrice);
      const over = qty > pl.remaining + 0.005;
      const priceDiff = Math.abs(price - pl.unitPrice) > 0.005;
      const amtDiff = Math.abs(amount - expected) > 0.005;
      let status = "exact", message = "Qty and price agree with the PO.";
      if (over) { status = "overbilled"; message = "Bills " + qty + " but only " + pl.remaining + " remain unbilled on the PO."; }
      else if (priceDiff) { status = "price_diff"; message = "Unit price " + FW.money(price) + " differs from the PO price " + FW.money(pl.unitPrice) + "."; }
      else if (amtDiff) { status = "amt_diff"; message = "Amount " + FW.money(amount) + " differs from the expected " + FW.money(expected) + "."; }
      if (status !== "exact") issues.push({ severity: status === "overbilled" ? "error" : "warn", message: "Line “" + (bl.desc || "untitled") + "”: " + message });
      lines.push({ billLineId: bl.id, desc: bl.desc || "(untitled line)", poLineId: pl.id, poQty: pl.qty, poUnitPrice: pl.unitPrice, poAmount: round2(pl.qty * pl.unitPrice), billedSoFar: pl.billed, remaining: pl.remaining, billQty: qty, billUnitPrice: price, billAmount: amount, expectedAmount: expected, status, message });
    }
    for (const pl of poLines) {
      if (pl.remaining > 0.005) issues.push({ severity: "info", message: "PO line “" + (pl.desc || "untitled") + "” still has " + pl.remaining + " units unbilled." });
    }
    const hasWarn = issues.some(i => i.severity === "warn" || i.severity === "error");
    return {
      billId: bill.id, billNo: bill.no, poId: po.id, poNo: po.no,
      overall: hasWarn ? "variance" : "exact", lines, issues,
      totalDiff: round2(billTotal(bill) - (po.lines || []).reduce((s, l) => s + poLineAmount(l.qty, l.unitPrice), 0)),
    };
  }
  function billMatchFlags(bill, pos, bills) {
    const po = (pos || []).find(x => x.id === bill.poId);
    if (!po) return null;
    const m = matchBillToPO(bill, po, bills);
    return { poNo: po.no, overall: m.overall, issueCount: m.issues.length, errors: m.issues.filter(i => i.severity === "error").length, warns: m.issues.filter(i => i.severity === "warn").length, infos: m.issues.filter(i => i.severity === "info").length };
  }

  /* ── A/P aging engine (task 12) ──────────────────────────────────────── */
  function daysBetween(a, b) {
    const pa = parseDate(a), pb = parseDate(b);
    if (!pa || !pb) return 0;
    const da = new Date(pa.y, pa.m - 1, pa.d), db = new Date(pb.y, pb.m - 1, pb.d);
    return Math.round((da - db) / 86400000);
  }
  function apAging(bills, asOf) {
    const a = asOf || today();
    const buckets = [
      { key: "current", label: "Current", min: -Infinity, max: 0 },
      { key: "b1", label: "1–30 days", min: 1, max: 30 },
      { key: "b2", label: "31–60 days", min: 31, max: 60 },
      { key: "b3", label: "61–90 days", min: 61, max: 90 },
      { key: "b4", label: "90+ days", min: 91, max: Infinity },
    ];
    for (const bk of buckets) bk.bills = [];
    for (const b of (bills || [])) {
      if (b.status !== "open") continue;
      const due = b.dueDate || b.billDate || a;
      const dpd = daysBetween(a, due);
      const bk = buckets.find(x => dpd >= x.min && dpd <= x.max) || buckets[0];
      bk.bills.push({ bill: b, daysPastDue: dpd, due });
    }
    for (const bk of buckets) {
      bk.total = round2(bk.bills.reduce((s, x) => s + billTotal(x.bill), 0));
      bk.count = bk.bills.length;
    }
    const total = round2(buckets.reduce((s, x) => s + x.total, 0));
    return {
      asOf: a, total,
      current: buckets[0].total,
      overdue: round2(buckets.slice(1).reduce((s, x) => s + x.total, 0)),
      buckets,
      oldest: (() => {
        const due = (bills || []).filter(x => x.status === "open").map(x => ({ no: x.no, due: x.dueDate || x.billDate || a })).sort((x, y) => String(x.due).localeCompare(String(y.due)))[0];
        return due ? { no: due.no, days: daysBetween(a, due.due) } : null;
      })(),
    };
  }

  /* ── recurring-expense engine (task 9) ───────────────────────────────── */
  function buildRecurringBill(rule, due) {
    return {
      id: uid("bill"), no: null,
      vendor: rule.vendor, vendorEmail: rule.vendorEmail || "",
      billNumber: "", billDate: due, dueDate: addDays(due, rule.netDays || 30),
      memo: "Recurring: " + rule.label,
      status: "draft", poId: null, poNo: null,
      lines: (rule.lines || []).map(l => ({ id: uid("bl"), desc: l.desc, account: l.account, qty: 1, unitPrice: amt(l.amount), amount: amt(l.amount), match: null })),
      ledgerEntryId: null, postedAt: null,
      source: { kind: "recurring", ruleId: rule.id, dueDate: due },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }
  /* pure decision: which (rule, dueDate) pairs still need a draft bill */
  function dueBillsToCreate(rules, bills, todayStr) {
    const out = [];
    for (const rule of rules) {
      if (!rule.active) continue;
      if (String(rule.nextDate || "") > todayStr) continue;
      const exists = bills.some(b => b.source && b.source.kind === "recurring" && b.source.ruleId === rule.id && b.source.dueDate === rule.nextDate);
      if (exists) continue;
      out.push({ rule, due: rule.nextDate });
    }
    return out;
  }
  async function generateDueBills() {
    const rules = await loadRecurring();
    const bills = await loadBills();
    const due = dueBillsToCreate(rules, bills, today());
    const created = [];
    for (const d of due) {
      const b = buildRecurringBill(d.rule, d.due);
      b.no = await nextNo("BILL", bills);
      bills.push(b);
      created.push(b);
      await Ledger.auditLog("recurring.generate", {
        entity: "recurring", entityId: d.rule.id, entityLabel: d.rule.label,
        summary: "Generated " + b.no + " (" + b.vendor + ") for " + d.due,
        prev: null, next: Ledger.cloneObj(b),
      });
    }
    if (created.length) await saveBills(bills);
    return created;
  }
  async function saveRule(rule, list) {
    const r = Object.assign({}, rule);
    if (!r.id) r.id = uid("rec");
    if (!r.createdAt) r.createdAt = new Date().toISOString();
    if (!r.active) r.active = true;
    r.lines = (r.lines || []).map(l => ({ desc: String(l.desc || "").trim(), account: l.account || null, amount: amt(l.amount) }));
    r.updatedAt = new Date().toISOString();
    const prev = list.find(x => x.id === r.id) || null;
    const i = list.findIndex(x => x.id === r.id);
    if (i >= 0) list[i] = r; else list.push(r);
    await saveRecurring(list);
    await Ledger.auditLog(prev ? "recurring.update" : "recurring.create", {
      entity: "recurring", entityId: r.id, entityLabel: r.label,
      summary: (prev ? "Edited " : "Created ") + "recurring expense “" + r.label + "” (" + r.vendor + ")",
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(r),
    });
    return r;
  }
  async function setRuleActive(id, active) {
    const rules = await loadRecurring();
    const r = rules.find(x => x.id === id);
    if (!r) return { error: "Recurring rule not found." };
    const prev = Ledger.cloneObj(r);
    r.active = !!active; r.updatedAt = new Date().toISOString();
    await saveRecurring(rules);
    await Ledger.auditLog(r.active ? "recurring.resume" : "recurring.pause", {
      entity: "recurring", entityId: r.id, entityLabel: r.label,
      summary: (r.active ? "Resumed" : "Paused") + " recurring expense “" + r.label + "”",
      prev, next: Ledger.cloneObj(r),
    });
    return { ok: true };
  }
  async function advanceRule(id) {
    const rules = await loadRecurring();
    const r = rules.find(x => x.id === id);
    if (!r) return { error: "Recurring rule not found." };
    const prev = Ledger.cloneObj(r);
    r.nextDate = nextMonthDate(r.nextDate);
    r.updatedAt = new Date().toISOString();
    await saveRecurring(rules);
    await Ledger.auditLog("recurring.advance", {
      entity: "recurring", entityId: r.id, entityLabel: r.label,
      summary: r.label + " — next run advanced to " + r.nextDate,
      prev, next: Ledger.cloneObj(r),
    });
    return { ok: true };
  }
  async function deleteRule(id) {
    const rules = await loadRecurring();
    const r = rules.find(x => x.id === id);
    if (!r) return { error: "Recurring rule not found." };
    const i = rules.indexOf(r); rules.splice(i, 1);
    await saveRecurring(rules);
    await Ledger.auditLog("recurring.delete", {
      entity: "recurring", entityId: id, entityLabel: r.label,
      summary: "Deleted recurring expense “" + r.label + "”",
      prev: Ledger.cloneObj(r), next: null,
    });
    return { ok: true };
  }

  /* ── small UI helpers ────────────────────────────────────────────────── */
  function confirmDialog(title, message, onYes, dangerLabel) {
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body"><p style="margin-top:0">' + esc(message) + "</p>" +
      '<div class="row-flex"><button class="btn btn-danger btn-sm" id="confirmYesBtn">' + esc(dangerLabel || "Confirm") + "</button>" +
      '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div></div>');
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#confirmYesBtn").addEventListener("click", () => { modal.closest(".modal-back").remove(); onYes(); });
    return modal;
  }

  /* ── module renderer ─────────────────────────────────────────────────── */
  async function render(m) {
    m.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 2 — Accounts Payable"));
    head.appendChild(FW.el("h1", null, null, { text: "Accounts Payable" }));
    head.appendChild(FW.el("p", "lede", "Pay what you owe: purchase orders with a full lifecycle, vendor bill entry (matching line items to POs), recurring expenses, payments by ACH or check, and A/P aging that keeps track of what is overdue."));
    m.appendChild(head);

    const tabs = FW.el("div", "ledger-tabs");
    tabs.innerHTML =
      '<button class="ledger-tab active" data-tab="pos">Purchase orders</button>' +
      '<button class="ledger-tab" data-tab="bills">Bills</button>' +
      '<button class="ledger-tab" data-tab="recurring">Recurring</button>' +
      '<button class="ledger-tab" data-tab="aging">Aging</button>';
    m.appendChild(tabs);

    const ctn = FW.el("div", "ledger-tab-ctn");
    m.appendChild(ctn);

    const switchTab = name => {
      FW.$$(".ledger-tab", tabs).forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === name));
      if (name === "bills") renderBills(ctn);
      else if (name === "recurring") renderRecurring(ctn);
      else if (name === "aging") renderAging(ctn);
      else renderPOs(ctn);
    };
    tabs.addEventListener("click", e => {
      const b = e.target.closest(".ledger-tab");
      if (b) switchTab(b.getAttribute("data-tab"));
    });

    switchTab("pos");

    const note = FW.el("p", "note small");
    note.style.cssText = "margin-top:18px";
    note.innerHTML = "<strong>Phase 2 is complete (tasks 7–12)</strong> — purchase orders, vendor bill entry with PO line matching, recurring expense automation, the line-item matching engine (flags qty/price/amount variances), payment disbursement via ACH or check (DR Accounts Payable / CR cash), and the A/P aging report. <strong>Next up:</strong> Phase 3 — Accounts Receivable.";
    m.appendChild(note);
  }

  /* ── Purchase orders tab ─────────────────────────────────────────────── */
  async function renderPOs(ctn) {
    const pos = await loadPOs();
    const sorted = [...pos].sort((a, b) => String(a.no || "").localeCompare(String(b.no || "")));
    const actions = po => {
      const a = [];
      if (po.status === "draft") a.push(["issue", "Issue"], ["edit", "Edit"], ["bill", "To bill"], ["cancel", "Cancel"], ["delete", "Delete"]);
      if (po.status === "ordered") a.push(["receive", "Receive"], ["bill", "To bill"], ["cancel", "Cancel"], ["view", "View"]);
      if (po.status === "received" || po.status === "partially_billed") a.push(["receive", "Receive"], ["bill", "To bill"], ["view", "View"]);
      if (po.status === "billed") a.push(["view", "View"]);
      if (po.status === "cancelled") a.push(["delete", "Delete"], ["view", "View"]);
      return a;
    };

    let html = '<div class="card"><div class="card-head"><h3>Purchase orders</h3>' +
      '<button class="btn btn-primary btn-sm" id="poNewBtn">+ New purchase order</button></div>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No purchase orders yet. Create a PO to record what you have ordered from a vendor — then issue it, receive the goods, and convert it into a bill.</p>';
    } else {
      html += '<table class="tbl"><thead><tr>' +
        "<th>No</th><th>Vendor</th><th class='ap-hide-m'>PO date</th><th class='ap-hide-m'>Expected</th><th class='tr'>Lines</th><th class='tr'>Total</th><th>Status</th><th class='fit'></th></tr></thead><tbody>";
      for (const po of sorted) {
        html += "<tr>" +
          '<td class="mono small">' + esc(po.no) + "</td>" +
          "<td><div class='acct-name'>" + esc(po.vendor) + "</div><div class='muted small'>" + esc(po.vendorEmail || "") + "</div></td>" +
          '<td class="small ap-hide-m">' + esc(po.poDate || "") + "</td>" +
          '<td class="small ap-hide-m">' + esc(po.expectedDate || "—") + "</td>" +
          '<td class="tr num">' + (po.lines || []).length + "</td>" +
          '<td class="tr num">' + FW.money(poTotal(po)) + "</td>" +
          '<td><span class="chip ' + poStatusChip(po.status) + '">' + esc(poStatusLabel(po.status)) + "</span></td>" +
          '<td class="fit"><div class="row-actions" style="justify-content:flex-end">' +
          actions(po).map(([k, lab]) => '<button class="icon-mini" data-po="' + esc(po.id) + '" data-poact="' + k + '" title="' + esc(lab) + '">' + (ICON_ACT[k] || "") + "</button>").join("") +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#poNewBtn").addEventListener("click", () => poModal(null, sorted, () => renderPOs(ctn)));
    ctn.onclick = async e => {
      const b = e.target.closest("[data-poact]");
      if (!b) return;
      const id = b.getAttribute("data-po");
      const act = b.getAttribute("data-poact");
      const po = sorted.find(x => x.id === id);
      if (!po) return;
      const refresh = () => renderPOs(ctn);
      if (act === "edit") { poModal(po, sorted, refresh, false); return; }
      if (act === "view") { poModal(po, sorted, null, true); return; }
      if (act === "bill") {
        const r = await convertPOtoBill(id);
        if (r.error) FW.toast(r.error, "err");
        else { FW.toast("Draft bill " + r.bill.no + " created — post it in the Bills tab."); refresh(); }
        return;
      }
      if (act === "issue") {
        const r = await setPOStatus(id, "ordered");
        if (r.error) FW.toast(r.error, "err"); else FW.toast(po.no + " issued"); refresh();
        return;
      }
      if (act === "receive") {
        const r = await setPOStatus(id, "received");
        if (r.error) FW.toast(r.error, "err"); else FW.toast(po.no + " marked received"); refresh();
        return;
      }
      if (act === "cancel") {
        confirmDialog("Cancel " + po.no + "?", "This marks the purchase order as cancelled. It can't be converted into a bill afterwards.", async () => {
          const r = await setPOStatus(id, "cancelled");
          if (r.error) FW.toast(r.error, "err"); else FW.toast(po.no + " cancelled"); refresh();
        }, "Cancel PO");
        return;
      }
      if (act === "delete") {
        confirmDialog("Delete " + po.no + "?", "This permanently removes the purchase order.", async () => {
          const r = await deletePO(id);
          if (r.error) FW.toast(r.error, "err"); else FW.toast("Purchase order deleted"); refresh();
        }, "Delete PO");
      }
    };
  }

  function poModal(po, list, onSaved, readOnly) {
    const isNew = !po;
    const p = po || { vendor: "", vendorEmail: "", poDate: today(), expectedDate: "", notes: "", status: "draft", lines: [{ id: "", desc: "", qty: "1", unitPrice: "", received: 0 }] };
    const lines = p.lines.map(l => ({ id: l.id || "", desc: l.desc || "", qty: l.qty == null ? "" : l.qty, unitPrice: l.unitPrice == null ? "" : l.unitPrice }));
    const lock = readOnly || p.status !== "draft";

    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (isNew ? "New purchase order" : "Edit " + esc(p.no)) + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body">' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:2 1 240px"><label>Vendor</label><input id="poVendor" type="text" placeholder="Vendor name" value="' + esc(p.vendor) + '"' + (lock ? " disabled" : "") + ' required></div>' +
      '<div class="field" style="flex:1 1 200px"><label>Vendor email</label><input id="poEmail" type="email" placeholder="Optional" value="' + esc(p.vendorEmail || "") + '"' + (lock ? " disabled" : "") + '></div>' +
      "</div>" +
      '<div class="row-flex">' +
      '<div class="field" style="flex:1 1 150px"><label>PO date</label><input id="poDate" type="date" value="' + esc(p.poDate || today()) + '"' + (lock ? " disabled" : "") + '></div>' +
      '<div class="field" style="flex:1 1 150px"><label>Expected by</label><input id="poExp" type="date" value="' + esc(p.expectedDate || "") + '"' + (lock ? " disabled" : "") + '></div>' +
      '<div class="field" style="flex:2 1 220px"><label>Notes</label><input id="poNotes" type="text" placeholder="Optional" value="' + esc(p.notes || "") + '"' + (lock ? " disabled" : "") + '></div>' +
      "</div>" +
      (isNew || !lock ? "" : '<p class="note small" style="margin-top:0">This PO is no longer a draft — vendor details, dates and line items are locked. You can still issue, receive or convert it.</p>') +
      '<div class="je-ed-label">Line items <span class="muted small">— qty × unit price; remaining qty becomes the bill when converted</span></div>' +
      '<div id="poLines" class="je-ed-lines"></div>' +
      '<div class="je-ed-totals"><span id="poTotal">Total ' + FW.money(0) + "</span></div>" +
      (lock ? "" : '<div class="row-flex" style="margin-top:14px">' +
        '<button class="btn btn-primary" id="poSaveBtn">' + (isNew ? "Create PO" : "Save changes") + "</button>" +
        '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>') +
      "</div>");
    modal.style.width = "min(820px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));

    const linesEl = modal.querySelector("#poLines");
    const totalEl = modal.querySelector("#poTotal");

    function lineHtml(l, i) {
      return '<div class="je-ed-line" data-i="' + i + '">' +
        '<input class="po-ed-desc" type="text" placeholder="Item description" value="' + esc(l.desc) + '"' + (lock ? " disabled" : "") + ">" +
        '<input class="po-ed-qty amt-sm" type="number" min="0" step="0.01" placeholder="Qty" value="' + esc(l.qty) + '"' + (lock ? " disabled" : "") + ">" +
        '<input class="po-ed-price amt-md" type="number" min="0" step="0.01" placeholder="Unit price" value="' + esc(l.unitPrice) + '"' + (lock ? " disabled" : "") + ">" +
        '<input class="po-ed-amt amt-md" type="number" min="0" step="0.01" placeholder="Amount" readonly value="' + esc(poLineAmount(l.qty, l.unitPrice)) + '">' +
        (lock ? "" : '<button class="icon-mini danger" data-rm="' + i + '" title="Remove line">' + ICON.x + "</button>") +
        "</div>";
    }
    function renderLines() {
      linesEl.innerHTML = lines.map(lineHtml).join("") + (lock ? "" : '<button class="btn btn-ghost btn-sm" id="poAddLine">+ Add line</button>');
      const addBtn = linesEl.querySelector("#poAddLine");
      if (addBtn) addBtn.addEventListener("click", () => { updateTotals(); lines.push({ id: "", desc: "", qty: "1", unitPrice: "" }); renderLines(); updateTotals(); });
      FW.$$("[data-rm]", linesEl).forEach(b => b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-rm"));
        updateTotals();
        lines.splice(i, 1);
        renderLines(); updateTotals();
      }));
    }
    function updateTotals() {
      let t = 0;
      FW.$$(".je-ed-line", linesEl).forEach(row => {
        const i = Number(row.getAttribute("data-i"));
        const l = lines[i];
        if (!l) return;
        l.desc = row.querySelector(".po-ed-desc").value;
        l.qty = row.querySelector(".po-ed-qty").value;
        l.unitPrice = row.querySelector(".po-ed-price").value;
        row.querySelector(".po-ed-amt").value = poLineAmount(l.qty, l.unitPrice);
        t = round2(t + poLineAmount(l.qty, l.unitPrice));
      });
      totalEl.textContent = "Total " + FW.money(t);
    }
    linesEl.addEventListener("input", e => {
      if (e.target.classList.contains("po-ed-qty") || e.target.classList.contains("po-ed-price")) updateTotals();
    });
    renderLines();
    updateTotals();

    if (lock) return;

    modal.querySelector("#poSaveBtn").addEventListener("click", async () => {
      updateTotals();
      const vendor = String(modal.querySelector("#poVendor").value || "").trim();
      if (!vendor) { FW.toast("Vendor is required.", "err"); return; }
      const clean = lines.map(l => ({ id: l.id, desc: l.desc.trim(), qty: amt(l.qty), unitPrice: amt(l.unitPrice) })).filter(l => l.desc || l.qty > 0 || l.unitPrice > 0);
      if (!clean.length) { FW.toast("Add at least one line item.", "err"); return; }
      const out = {
        id: p.id || null,
        no: p.no || null,
        vendor, vendorEmail: String(modal.querySelector("#poEmail").value || "").trim(),
        poDate: modal.querySelector("#poDate").value || today(),
        expectedDate: modal.querySelector("#poExp").value || "",
        notes: String(modal.querySelector("#poNotes").value || "").trim(),
        status: p.status || "draft",
        lines: clean.map(l => {
          const prev = p.lines.find(x => x.id === l.id);
          return { id: l.id || uid("pol"), desc: l.desc, qty: l.qty, unitPrice: l.unitPrice, received: prev ? amt(prev.received) : 0 };
        }),
        createdAt: p.createdAt || null,
      };
      const list2 = await loadPOs();
      if (isNew) out.no = await nextNo("PO", list2);
      const res = await savePO(out, list2);
      modal.closest(".modal-back").remove();
      FW.toast(isNew ? "Purchase order created" : "Purchase order updated");
      onSaved && onSaved();
    });
  }

  /* ── Bills tab ───────────────────────────────────────────────────────── */
  async function renderBills(ctn) {
    const [bills, pos, rules, accounts] = await Promise.all([loadBills(), loadPOs(), loadRecurring(), Ledger.loadAccounts()]);
    const apName = (accounts.find(a => a.id === apAccountId(accounts)) || {}).name || "Accounts Payable";
    const sorted = [...bills].sort((a, b) => String(a.no || "").localeCompare(String(b.no || "")));
    const due = dueBillsToCreate(rules, bills, today());
    const openTotal = round2(bills.filter(x => x.status === "open").reduce((s, x) => s + billTotal(x), 0));
    const paidCount = bills.filter(x => x.status === "paid").length;
    const aging = apAging(bills, today());

    let html = '<div class="card"><div class="card-head"><h3>Vendor bills</h3>' +
      '<button class="btn btn-ghost btn-sm" id="billPaySelBtn" disabled style="margin-right:8px">Pay selected (0)</button>' +
      '<button class="btn btn-primary btn-sm" id="billNewBtn">+ New bill</button></div>';
    html += '<div class="bill-stats">' +
      '<span class="chip chip-done">Open ' + FW.money(openTotal) + "</span>" +
      '<span class="chip ' + (aging.overdue ? "chip-warn" : "chip-done") + '">Overdue ' + FW.money(aging.overdue) + "</span>" +
      '<span class="chip chip-muted">' + paidCount + " paid</span>" +
      "</div>";
    if (due.length) {
      html += '<div class="note" style="margin:0 14px 6px;border-style:dashed"><span class="chip chip-phase">' + due.length + " due</span> <strong>Recurring expense" + (due.length === 1 ? "" : "s") + " due:</strong> " +
        esc(due.map(d => d.rule.label).join(", ")) + ' — open the <strong>Recurring</strong> tab and hit “Generate due drafts”.</div>';
    }
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No vendor bills yet. Create a bill from a PO (Purchase orders tab → “To bill”) or enter one directly here. Posting a bill records it in the ledger as debit expenses / credit ' + esc(apName) + ".</p>";
    } else {
      html += '<table class="tbl"><thead><tr>' +
        '<th class="fit"></th>' +
        "<th>No</th><th>Vendor</th><th class='ap-hide-m'>Bill date</th><th class='ap-hide-m'>Due date</th><th class='tr'>Total</th><th>Status</th><th class='fit'></th></tr></thead><tbody>";
      for (const b of sorted) {
        const stChip = b.status === "open" ? "chip-done" : b.status === "paid" ? "chip-phase" : "chip-pending";
        const mf = b.poId ? billMatchFlags(b, pos, bills) : null;
        const selCell = b.status === "open"
          ? '<td class="fit"><input type="checkbox" class="bill-sel" data-bill="' + esc(b.id) + '" title="Select for payment"></td>'
          : '<td class="fit"></td>';
        const acts = [];
        if (b.status === "draft") { acts.push(["edit", "Edit", ICON.pencil], ["post", "Post to ledger", ICON.check]); if (b.poId) acts.push(["match", "Review PO matching", ICON.compare]); acts.push(["delete", "Delete draft", ICON.trash, "danger"]); }
        else if (b.status === "open") { acts.push(["pay", "Record payment", ICON.card]); if (b.poId) acts.push(["match", "Review PO matching", ICON.compare]); acts.push(["view", "View", ICON.eye]); }
        else acts.push(["view", "View", ICON.eye]);
        html += "<tr>" + selCell +
          '<td class="mono small">' + esc(b.no) + "</td>" +
          "<td><div class='acct-name'>" + esc(b.vendor) + "</div>" +
          (b.poNo ? '<div class="small"><span class="tag tag-inactive" style="margin-left:0">from ' + esc(b.poNo) + "</span>" +
            (mf && mf.overall === "variance" ? ' <span class="chip chip-warn" style="font-size:10px;margin-left:6px">' + (mf.errors ? mf.errors + " error" + (mf.errors > 1 ? "s" : "") : mf.warns + " variance") + "</span>" : "") + "</div>" : "") +
          (b.source && b.source.kind === "recurring" ? '<div class="small"><span class="tag tag-inactive" style="margin-left:0">recurring · ' + esc(b.source.dueDate) + "</span></div>" : "") +
          (b.status === "paid" ? '<div class="small muted">' + esc(b.paymentRef || "") + " · " + esc(b.paymentMethod === "check" ? "check" : "ACH") + (b.paymentDate ? " · " + esc(b.paymentDate) : "") + "</div>" : "") +
          "</td>" +
          '<td class="small ap-hide-m">' + esc(b.billDate || "") + "</td>" +
          '<td class="small ap-hide-m">' + esc(b.dueDate || "") + "</td>" +
          '<td class="tr num">' + FW.money(billTotal(b)) + "</td>" +
          '<td><span class="chip ' + stChip + '">' + esc(billStatusLabel(b.status)) + "</span></td>" +
          '<td class="fit"><div class="row-actions" style="justify-content:flex-end">' +
          acts.map(a => '<button class="icon-mini' + (a[3] ? " " + a[3] : "") + '" data-bill="' + esc(b.id) + '" data-billact="' + a[0] + '" title="' + a[1] + '">' + a[2] + "</button>").join("") +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#billNewBtn").addEventListener("click", () => billModal(null, accounts, () => renderBills(ctn)));
    ctn.querySelector("#billPaySelBtn").addEventListener("click", () => {
      const ids = [...ctn.querySelectorAll(".bill-sel:checked")].map(c => c.getAttribute("data-bill"));
      if (!ids.length) { FW.toast("Select at least one open bill to pay.", "err"); return; }
      payModal(bills.filter(x => ids.includes(x.id)), accounts, () => renderBills(ctn));
    });
    ctn.addEventListener("change", e => {
      if (e.target.classList && e.target.classList.contains("bill-sel")) {
        const n = ctn.querySelectorAll(".bill-sel:checked").length;
        const btn = ctn.querySelector("#billPaySelBtn");
        if (btn) { btn.disabled = !n; btn.textContent = "Pay selected (" + n + ")"; }
      }
    });
    ctn.onclick = e => {
      const b = e.target.closest("[data-billact]");
      if (!b) return;
      const id = b.getAttribute("data-bill");
      const act = b.getAttribute("data-billact");
      const bill = sorted.find(x => x.id === id);
      if (!bill) return;
      const refresh = () => renderBills(ctn);
      if (act === "edit") { billModal(bill, accounts, refresh); return; }
      if (act === "pay") { payModal([bill], accounts, refresh); return; }
      if (act === "match") { matchModal(bill, pos, bills); return; }
      if (act === "post") {
        postBill(id).then(r => {
          if (r.error) FW.toast(r.error, "err");
          else FW.toast(bill.no + " posted — ledger entry " + r.entryNo + " recorded");
          refresh();
        });
        return;
      }
      if (act === "delete") {
        confirmDialog("Delete " + bill.no + "?", "This removes the draft bill. Nothing has been posted to the ledger yet.", async () => {
          const r = await deleteBill(id);
          if (r.error) FW.toast(r.error, "err"); else FW.toast("Draft bill deleted"); refresh();
        }, "Delete bill");
        return;
      }
      if (act === "view") billModal(bill, accounts, null, true);
    };
  }

  /* ── payment modal (task 11) ─────────────────────────────────────────── */
  function payModal(bills, accounts, onDone) {
    const total = round2(bills.reduce((s, b) => s + billTotal(b), 0));
    const cash = cashAccountId(accounts);
    const modal = FW.modal(
      '<div class="modal-head"><h3>Record payment — ' + bills.length + (bills.length === 1 ? " bill" : " bills") + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body">' +
      '<p class="note small" style="margin-top:0">' + esc(bills.map(b => b.no + " · " + b.vendor + " — " + FW.money(billTotal(b))).join("<br>")) + "</p>" +
      '<div class="row-flex">' +
      '<div class="field" style="flex:1 1 150px"><label>Payment method</label><select id="pMethod"><option value="ach">ACH transfer</option><option value="check">Check</option></select></div>' +
      '<div class="field" style="flex:1 1 150px"><label>Payment date</label><input id="pDate" type="date" value="' + today() + '"></div>' +
      '<div class="field" style="flex:2 1 220px"><label>Pay from account</label><select id="pCash">' + cashOptions(accounts, cash) + "</select></div>" +
      "</div>" +
      '<div class="field"><label>Memo <span class="muted small">(optional)</span></label><input id="pMemo" type="text" placeholder="Optional note for the ledger entry"></div>' +
      '<div class="je-ed-totals"><span id="pTotal">Paying ' + FW.money(total) + '</span><span class="chip chip-phase">posts DR ' + esc((accounts.find(a => a.id === apAccountId(accounts)) || {}).name || "Accounts Payable") + " · CR cash</span></div>" +
      '<div class="row-flex" style="margin-top:14px">' +
      '<button class="btn btn-primary" id="pGoBtn">' + (bills.length === 1 ? "Pay " + esc(bills[0].no) : "Pay " + bills.length + " bills") + "</button>" +
      '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>' +
      "</div>");
    modal.style.width = "min(600px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#pGoBtn").addEventListener("click", async () => {
      const method = modal.querySelector("#pMethod").value;
      const date = modal.querySelector("#pDate").value || today();
      const cashAccountId = modal.querySelector("#pCash").value;
      const memo = modal.querySelector("#pMemo").value.trim();
      const btn = modal.querySelector("#pGoBtn");
      btn.disabled = true;
      const r = await payBills(bills.map(b => b.id), { method, date, cashAccountId, memo });
      btn.disabled = false;
      if (r.error) { FW.toast(r.error, "err"); return; }
      modal.closest(".modal-back").remove();
      FW.toast(r.ref + " recorded — " + r.paid.join(", ") + " marked paid (entry " + r.entryNo + ")");
      onDone && onDone();
    });
  }

  /* ── line-item matching modal (task 10) ──────────────────────────────── */
  const MATCH_STATUS = {
    exact: ["chip-done", "Matches PO"],
    price_diff: ["chip-warn", "Price differs"],
    amt_diff: ["chip-warn", "Amount differs"],
    overbilled: ["chip-warn", "Overbilled"],
    unmatched: ["chip-muted", "Unmatched"],
    error: ["chip-warn", "Error"],
  };
  function matchModal(bill, pos, bills) {
    const po = (pos || []).find(x => x.id === bill.poId);
    if (!po) { FW.toast("This bill is not linked to a purchase order.", "err"); return; }
    const m = matchBillToPO(bill, po, bills);
    const rows = m.lines.map(l => {
      const sm = MATCH_STATUS[l.status] || ["chip-muted", l.status];
      return "<tr>" +
        "<td>" + esc(l.desc) + "</td>" +
        '<td class="tr num">' + (l.poQty == null ? "—" : l.poQty) + "</td>" +
        '<td class="tr num">' + l.billQty + "</td>" +
        '<td class="tr num ap-hide-m">' + (l.poUnitPrice == null ? "—" : FW.money(l.poUnitPrice)) + "</td>" +
        '<td class="tr num ap-hide-m">' + (l.billUnitPrice == null ? "—" : FW.money(l.billUnitPrice)) + "</td>" +
        '<td class="tr num">' + FW.money(l.billAmount) + "</td>" +
        '<td><span class="chip ' + sm[0] + '" title="' + esc(l.message) + '">' + sm[1] + "</span></td>" +
        "</tr>";
    }).join("");
    const modal = FW.modal(
      '<div class="modal-head"><h3>PO matching — ' + esc(bill.no) + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body">' +
      '<p class="note small" style="margin-top:0">Validating <strong>' + esc(bill.no) + "</strong> (" + esc(bill.vendor) + ", " + FW.money(billTotal(bill)) + ') against <strong>' + esc(po.no) + "</strong> (" + esc(po.vendor) + ", " + FW.money(poTotal(po)) + ").</p>" +
      '<div class="je-ed-label">Line comparison <span class="muted small">— PO columns are per the purchase order; Bill columns are what this vendor billed</span></div>' +
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Line</th><th class="tr">PO qty</th><th class="tr">Bill qty</th><th class="tr ap-hide-m">PO price</th><th class="tr ap-hide-m">Bill price</th><th class="tr">Bill amt</th><th>Status</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div class="bill-stats" style="padding:12px 0 0">' +
      '<span class="chip ' + (m.overall === "exact" ? "chip-done" : "chip-warn") + '">' + (m.overall === "exact" ? "All matched lines agree with the PO" : "Variance — review the flagged lines") + "</span>" +
      '<span class="chip chip-muted">Bill vs PO total: ' + (m.totalDiff >= 0 ? "+" : "") + FW.money(m.totalDiff) + "</span>" +
      "</div>" +
      (m.issues.length ? '<ul style="margin:4px 0 0;padding-left:18px;font-size:12.6px;color:var(--text-muted)">' + m.issues.map(i => "<li>" + esc(i.message) + "</li>").join("") + "</ul>" : "") +
      '<div class="row-flex" style="margin-top:14px"><button class="btn btn-ghost-subtle" data-close>Close</button></div>' +
      "</div>");
    modal.style.width = "min(880px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
  }

  /* ── A/P aging tab (task 12) ─────────────────────────────────────────── */
  async function renderAging(ctn) {
    const bills = await loadBills();
    const aging = apAging(bills, today());
    ctn.innerHTML = "";
    ctn.appendChild(agingCard(aging, bills));
  }

  function agingCard(aging, bills) {
    const card = FW.el("div", "card");
    const head = FW.el("div", "card-head");
    head.appendChild(FW.el("h3", null, null, { text: "A/P aging" }));
    const asOfWrap = FW.el("div", null, null, { style: "display:flex;align-items:center;gap:8px" });
    const lbl = FW.el("label", "small muted", null, { text: "As of", htmlFor: "agingAsOf" });
    const inp = FW.el("input", null, null, { type: "date", id: "agingAsOf", value: aging.asOf, style: "padding:5px 9px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:12.8px;font-family:inherit" });
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
        row.innerHTML = "<strong>" + FW.money(bk.total) + "</strong><span class='muted small'>" + bk.count + " bill" + (bk.count === 1 ? "" : "s") + (pct ? " · " + pct + "%" : "") + "</span>";
        const bar = FW.el("div", "aging-bar");
        const fill = FW.el("div", null, null, { style: "width:" + pct + "%" });
        bar.appendChild(fill);
        c.appendChild(h4); c.appendChild(row); c.appendChild(bar);
        if (bk.bills.length) {
          for (const x of bk.bills) {
            const r = FW.el("div", "aging-row");
            r.innerHTML = '<span class="mono small">' + esc(x.bill.no) + '</span> <span class="muted small">' + esc(x.bill.vendor) + '</span> <span class="muted small">' + (x.daysPastDue > 0 ? x.daysPastDue + "d overdue" : "due " + esc(x.due)) + '</span> <strong>' + FW.money(billTotal(x.bill)) + "</strong>";
            c.appendChild(r);
          }
        } else {
          c.appendChild(FW.el("p", "muted small", null, { text: "None in this bucket.", style: "margin:2px 0 0" }));
        }
        grid.appendChild(c);
      }
      body.appendChild(grid);
    } else {
      body.appendChild(FW.el("p", "muted small", null, { text: "No unpaid bills in the ledger yet. Post a bill to see it appear in the aging report.", style: "text-align:center;padding:18px 14px 24px" }));
    }
    card.appendChild(body);

    inp.addEventListener("change", () => {
      const v = inp.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const next = agingCard(apAging(bills, v), bills);
      card.replaceWith(next);
    });
    return card;
  }


  function billModal(bill, accounts, onSaved, readOnly) {
    const isNew = !bill;
    const b = bill || { vendor: "", vendorEmail: "", billNumber: "", billDate: today(), dueDate: addDays(today(), 30), memo: "", status: "draft", poId: null, poNo: null, projectId: null, lines: [{ id: "", desc: "", account: "", qty: "1", unitPrice: "", amount: "" }] };
    const lines = b.lines.map(l => ({ desc: l.desc || "", account: l.account || "", qty: l.qty == null ? 1 : l.qty, unitPrice: l.unitPrice == null ? "" : l.unitPrice, amount: l.amount == null ? "" : l.amount, match: l.match || null }));
    const locked = readOnly || b.status !== "draft";
    const ap = apAccountId(accounts);

    const poOpts = async () => {
      const pos = await loadPOs();
      const bills = await loadBills();
      return pos.filter(x => x.status !== "cancelled" && x.status !== "billed")
        .map(x => {
          const billed = matchedBilledQty(x, bills);
          const rem = (x.lines || []).filter(l => amt(l.qty) - (billed[l.id] || 0) > 0.005).length;
          return { po: x, rem };
        })
        .filter(x => x.rem > 0);
    };

    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (readOnly ? "Vendor bill — " + esc(b.no || "") : isNew ? "New vendor bill" : "Edit " + esc(b.no)) + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body">' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:2 1 240px"><label>Vendor</label><input id="bVendor" type="text" placeholder="Vendor name" value="' + esc(b.vendor) + '"' + (locked ? " disabled" : "") + '></div>' +
      '<div class="field" style="flex:1 1 160px"><label>Bill #</label><input id="bNum" type="text" placeholder="Vendor bill number" value="' + esc(b.billNumber || "") + '"' + (locked ? " disabled" : "") + '></div>' +
      "</div>" +
      '<div class="row-flex">' +
      '<div class="field" style="flex:1 1 150px"><label>Bill date</label><input id="bDate" type="date" value="' + esc(b.billDate || today()) + '"' + (locked ? " disabled" : "") + '></div>' +
      '<div class="field" style="flex:1 1 150px"><label>Due date</label><input id="bDue" type="date" value="' + esc(b.dueDate || addDays(today(), 30)) + '"' + (locked ? " disabled" : "") + '></div>' +
      '<div class="field" style="flex:2 1 220px"><label>Memo</label><input id="bMemo" type="text" placeholder="Optional" value="' + esc(b.memo || "") + '"' + (locked ? " disabled" : "") + '></div>' +
      "</div>" +
      (readOnly ? "" : '<div class="row-flex" style="align-items:flex-end">' +
        '<div class="field" style="flex:1 1 260px;margin-bottom:0"><label>Match line items to a PO <span class="muted small">(optional)</span></label>' +
        '<select id="bPoSel"><option value="">— no PO —</option></select></div>' +
        '<div class="field" style="flex:1 1 220px;margin-bottom:0"><label>Project <span class="muted small">(optional)</span></label>' +
        '<select id="bProj"><option value="">— no project —</option></select></div>' +
        '<button class="btn btn-ghost btn-sm" id="bPoLoad" style="margin-bottom:1px">Load PO lines</button></div>') +
      '<div class="je-ed-label">Line items <span class="muted small">— each line picks an expense (or asset) account; the total is credited to ' + esc((accounts.find(a => a.id === ap) || {}).name || "Accounts Payable") + " on posting</span></div>" +
      '<div id="bLines" class="je-ed-lines"></div>' +
      '<div class="je-ed-totals"><span id="bTotal">Total ' + FW.money(0) + '</span><span id="bUnacc" class="chip chip-pending"></span></div>' +
      (locked ? "" : '<div class="row-flex" style="margin-top:14px">' +
        '<button class="btn btn-primary" id="bPostBtn">Save &amp; post to ledger</button>' +
        '<button class="btn btn-ghost" id="bSaveBtn">Save draft</button>' +
        '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>') +
      "</div>");
    modal.style.width = "min(880px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b2 => b2.addEventListener("click", () => modal.closest(".modal-back").remove()));

    const linesEl = modal.querySelector("#bLines");
    const totalEl = modal.querySelector("#bTotal");
    const unaccEl = modal.querySelector("#bUnacc");
    const poSel = modal.querySelector("#bPoSel");
    const poLoad = modal.querySelector("#bPoLoad");
    const projSel = modal.querySelector("#bProj");
    if (projSel && window.Projects) window.Projects.projectOptions(b.projectId || "").then(opts => { projSel.innerHTML = '<option value="">— no project —</option>' + opts; });

    (async () => {
      const opts = await poOpts();
      if (poSel) {
        poSel.innerHTML = '<option value="">— no PO —</option>' + opts.map(o =>
          '<option value="' + o.po.id + '"' + (o.po.id === b.poId ? " selected" : "") + ">" + esc(o.po.no) + " · " + esc(o.po.vendor) + " (" + o.rem + " line" + (o.rem === 1 ? "" : "s") + " unbilled)</option>").join("");
        poLoad.addEventListener("click", async () => {
          const pid = poSel.value;
          if (!pid) return;
          const o = opts.find(x => x.po.id === pid);
          if (!o) return;
          const pos = await loadPOs();
          const bills = await loadBills();
          const po = pos.find(x => x.id === pid);
          const billed = matchedBilledQty(po, bills);
          lines.length = 0;
          for (const l of (po.lines || [])) {
            const qty = round2(amt(l.qty) - (billed[l.id] || 0));
            if (qty <= 0.005) continue;
            lines.push({ desc: l.desc, account: suggestAccountFor(l.desc, accounts), qty, unitPrice: amt(l.unitPrice), amount: poLineAmount(qty, l.unitPrice), match: { poId: po.id, poLineId: l.id } });
          }
          modal.querySelector("#bVendor").value = po.vendor;
          modal.querySelector("#bMemo").value = "From " + po.no;
          renderLines();
          updateTotals();
          FW.toast("Loaded " + lines.length + " unbilled line" + (lines.length === 1 ? "" : "s") + " from " + po.no);
        });
      }
    })();

    function lineHtml(l, i) {
      return '<div class="je-ed-line" data-i="' + i + '">' +
        '<select class="b-ed-acct" style="flex:1 1 220px;min-width:0"' + (locked ? " disabled" : "") + ">" + debitAccountOptions(accounts, l.account) + "</select>" +
        '<input class="b-ed-desc" type="text" placeholder="Line description" value="' + esc(l.desc) + '"' + (locked ? " disabled" : "") + ">" +
        '<input class="b-ed-qty amt-sm" type="number" min="0" step="0.01" placeholder="Qty" value="' + esc(l.qty) + '"' + (locked ? " disabled" : "") + ">" +
        '<input class="b-ed-price amt-md" type="number" min="0" step="0.01" placeholder="Unit price" value="' + esc(l.unitPrice) + '"' + (locked ? " disabled" : "") + ">" +
        '<input class="b-ed-amt amt-md" type="number" min="0" step="0.01" placeholder="Amount" value="' + esc(l.amount) + '"' + (locked ? " disabled" : "") + ">" +
        (l.match ? '<span class="tag tag-inactive" title="Matches ' + esc((l.match.poNo) || "") + '">PO</span>' : "") +
        (locked ? "" : '<button class="icon-mini danger" data-rm="' + i + '" title="Remove line">' + ICON.x + "</button>") +
        "</div>";
    }
    function renderLines() {
      linesEl.innerHTML = lines.map(lineHtml).join("") + (locked ? "" : '<button class="btn btn-ghost btn-sm" id="bAddLine">+ Add line</button>');
      const addBtn = linesEl.querySelector("#bAddLine");
      if (addBtn) addBtn.addEventListener("click", () => { updateTotals(); lines.push({ desc: "", account: "", qty: "1", unitPrice: "", amount: "", match: null }); renderLines(); updateTotals(); });
      FW.$$("[data-rm]", linesEl).forEach(b2 => b2.addEventListener("click", () => {
        const i = Number(b2.getAttribute("data-rm"));
        updateTotals();
        lines.splice(i, 1);
        renderLines(); updateTotals();
      }));
    }
    function updateTotals() {
      let t = 0, unacc = 0;
      FW.$$(".je-ed-line", linesEl).forEach(row => {
        const i = Number(row.getAttribute("data-i"));
        const l = lines[i];
        if (!l) return;
        l.account = row.querySelector(".b-ed-acct").value;
        l.desc = row.querySelector(".b-ed-desc").value;
        l.qty = row.querySelector(".b-ed-qty").value;
        l.unitPrice = row.querySelector(".b-ed-price").value;
        l.amount = row.querySelector(".b-ed-amt").value;
        const a = amt(l.amount);
        t = round2(t + a);
        if (!l.account) unacc++;
      });
      totalEl.textContent = "Total " + FW.money(t);
      if (unaccEl) {
        unaccEl.textContent = unacc ? unacc + " line" + (unacc === 1 ? "" : "s") + " need an account" : "all lines accounted";
        unaccEl.className = "chip " + (unacc ? "chip-pending" : "chip-done");
      }
    }
    linesEl.addEventListener("input", e => {
      if (e.target.classList.contains("b-ed-qty") || e.target.classList.contains("b-ed-price")) {
        const row = e.target.closest(".je-ed-line");
        const i = Number(row.getAttribute("data-i"));
        const l = lines[i];
        if (l) row.querySelector(".b-ed-amt").value = poLineAmount(l.qty, l.unitPrice);
      }
      updateTotals();
    });
    renderLines();
    updateTotals();

    if (locked) return;

    const collect = () => {
      updateTotals();
      const out = [];
      for (const l of lines) {
        const a = amt(l.amount);
        if (!String(l.desc).trim() && !a) continue;
        out.push({ id: l.id || uid("bl"), desc: String(l.desc || "").trim(), account: l.account || null, qty: amt(l.qty || 1), unitPrice: amt(l.unitPrice), amount: a, match: l.match || null });
      }
      if (!out.length) { FW.toast("Add at least one line item.", "err"); return null; }
      return out;
    };
    const build = linesOut => {
      const poId = poSel ? poSel.value || null : b.poId;
      return {
        id: b.id || null,
        no: b.no || null,
        vendor: modal.querySelector("#bVendor").value.trim(),
        vendorEmail: b.vendorEmail || "",
        billNumber: modal.querySelector("#bNum").value.trim(),
        billDate: modal.querySelector("#bDate").value || today(),
        dueDate: modal.querySelector("#bDue").value || addDays(today(), 30),
        memo: modal.querySelector("#bMemo").value.trim(),
        status: b.status || "draft",
        poId, poNo: b.poNo || null,
        projectId: projSel ? (projSel.value || null) : (b.projectId || null),
        lines: linesOut,
        source: b.source || null,
        ledgerEntryId: b.ledgerEntryId || null,
        postedAt: b.postedAt || null,
        createdAt: b.createdAt || null,
      };
    };

    const saveAndClose = async (post) => {
      const out = collect();
      if (!out) return;
      const vendor = modal.querySelector("#bVendor").value.trim();
      if (!vendor) { FW.toast("Vendor is required.", "err"); return; }
      const bill = build(out);
      let list = await loadBills();
      if (isNew) bill.no = await nextNo("BILL", list);
      else {
        const prev = list.find(x => x.id === b.id);
        if (prev && prev.status !== "draft") { FW.toast("Posted bills can't be edited.", "err"); return; }
      }
      if (bill.poId && !bill.poNo) {
        const pos = await loadPOs();
        const po = pos.find(x => x.id === bill.poId);
        if (po) bill.poNo = po.no;
      }
      const res = await saveBill(bill, list);
      if (res && res.error) { FW.toast(res.error, "err"); return; }
      if (post) {
        const r = await postBill(res.id);
        if (r.error) { FW.toast(r.error, "err"); onSaved && onSaved(); return; }
        modal.closest(".modal-back").remove();
        FW.toast(res.no + " posted — ledger entry " + r.entryNo + " recorded");
      } else {
        modal.closest(".modal-back").remove();
        FW.toast(isNew ? "Draft bill created" : "Draft bill updated");
      }
      onSaved && onSaved();
    };

    modal.querySelector("#bSaveBtn").addEventListener("click", () => saveAndClose(false));
    modal.querySelector("#bPostBtn").addEventListener("click", () => saveAndClose(true));
  }

  /* ── Recurring tab ───────────────────────────────────────────────────── */
  async function renderRecurring(ctn) {
    const [rules, bills, accounts] = await Promise.all([loadRecurring(), loadBills(), Ledger.loadAccounts()]);
    const due = dueBillsToCreate(rules, bills, today());
    const sorted = [...rules].sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));

    let html = '<div class="card"><div class="card-head"><h3>Recurring expenses</h3>' +
      '<button class="btn btn-ghost btn-sm" id="recGenBtn" style="margin-right:8px"' + (due.length ? "" : " disabled") + ">Generate due drafts" + (due.length ? " · " + due.length : "") + "</button>" +
      '<button class="btn btn-primary btn-sm" id="recNewBtn">+ New rule</button></div>' +
      '<div class="card-body" style="padding-top:0"><p class="note small" style="margin-top:10px">Fixed monthly costs (rent, software, insurance…) become <strong>draft bills</strong> when their next due date arrives — hit “Generate due drafts”. Posting a generated bill records it in the ledger and advances the schedule to next month; deleting the draft keeps the rule untouched so it can be generated again.</p>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:18px 14px 4px">No recurring expense rules yet. Add one to automate a fixed monthly bill.</p>';
    } else {
      html += '<table class="tbl"><thead><tr>' +
        "<th>Label</th><th>Vendor</th><th class='ap-hide-m'>Next due</th><th class='tr'>Amount</th><th>Status</th><th class='fit'></th></tr></thead><tbody>";
      for (const r of sorted) {
        const monthly = round2((r.lines || []).reduce((s, l) => s + amt(l.amount), 0));
        const overdue = r.active && r.nextDate && r.nextDate <= today() && !bills.some(b => b.source && b.source.kind === "recurring" && b.source.ruleId === r.id && b.source.dueDate === r.nextDate);
        html += "<tr>" +
          "<td><div class='acct-name'>" + esc(r.label) + "</div>" +
          (r.lines && r.lines.length > 1 ? '<div class="muted small">' + r.lines.length + " lines</div>" : "") + "</td>" +
          "<td>" + esc(r.vendor) + "</td>" +
          '<td class="ap-hide-m">' + esc(r.nextDate || "") + (overdue ? ' <span class="chip chip-pending" style="font-size:10.5px">due</span>' : "") + "</td>" +
          '<td class="tr num">' + FW.money(monthly) + "/mo</td>" +
          '<td><span class="chip ' + (r.active ? "chip-done" : "chip-muted") + '">' + (r.active ? "Active" : "Paused") + "</span></td>" +
          '<td class="fit"><div class="row-actions" style="justify-content:flex-end">' +
          '<button class="icon-mini" data-rec="' + esc(r.id) + '" data-recact="edit" title="Edit">' + ICON.pencil + "</button>" +
          '<button class="icon-mini" data-rec="' + esc(r.id) + '" data-recact="' + (r.active ? "pause" : "resume") + '" title="' + (r.active ? "Pause" : "Resume") + '">' + (r.active ? ICON.pause : ICON.play) + "</button>" +
          '<button class="icon-mini" data-rec="' + esc(r.id) + '" data-recact="advance" title="Advance to next month">' + ICON.skip + "</button>" +
          '<button class="icon-mini danger" data-rec="' + esc(r.id) + '" data-recact="delete" title="Delete rule">' + ICON.trash + "</button>" +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#recNewBtn").addEventListener("click", () => ruleModal(null, () => renderRecurring(ctn), accounts));
    ctn.querySelector("#recGenBtn").addEventListener("click", async () => {
      const created = await generateDueBills();
      if (!created.length) FW.toast("No recurring bills are due.");
      else FW.toast("Generated " + created.length + " draft bill" + (created.length === 1 ? "" : "s") + " — review them in the Bills tab.");
      renderRecurring(ctn);
    });
    ctn.onclick = e => {
      const b = e.target.closest("[data-recact]");
      if (!b) return;
      const id = b.getAttribute("data-rec");
      const act = b.getAttribute("data-recact");
      const rule = sorted.find(x => x.id === id);
      if (!rule) return;
      const refresh = () => renderRecurring(ctn);
      if (act === "edit") { ruleModal(rule, refresh, accounts); return; }
      if (act === "pause" || act === "resume") {
        setRuleActive(id, act === "resume").then(r => {
          if (r.error) FW.toast(r.error, "err"); else FW.toast(act === "resume" ? "Recurring rule resumed" : "Recurring rule paused");
          refresh();
        });
        return;
      }
      if (act === "advance") {
        advanceRule(id).then(r => {
          if (r.error) FW.toast(r.error, "err"); else FW.toast(rule.label + " advanced to next month");
          refresh();
        });
        return;
      }
      if (act === "delete") {
        confirmDialog("Delete “" + rule.label + "”?", "Removes the recurring rule. Bills already generated from it stay in the Bills tab.", async () => {
          const r = await deleteRule(id);
          if (r.error) FW.toast(r.error, "err"); else FW.toast("Recurring rule deleted");
          refresh();
        }, "Delete rule");
      }
    };
  }

  function ruleModal(rule, onSaved, accounts) {
    const isNew = !rule;
    const r = rule || { label: "", vendor: "", dayOfMonth: 1, netDays: 30, nextDate: today(), active: true, notes: "", lines: [{ desc: "", account: "", amount: "" }] };
    const lines = r.lines.map(l => ({ desc: l.desc || "", account: l.account || "", amount: l.amount == null ? "" : l.amount }));
    const day = r.dayOfMonth || 1;

    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (isNew ? "New recurring expense" : "Edit “" + esc(r.label) + "”") + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body">' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:2 1 240px"><label>Label</label><input id="rLabel" type="text" placeholder="e.g. Monthly office rent" value="' + esc(r.label) + '" required></div>' +
      '<div class="field" style="flex:1 1 200px"><label>Vendor</label><input id="rVendor" type="text" placeholder="e.g. Acme Realty" value="' + esc(r.vendor) + '"></div>' +
      "</div>" +
      '<div class="row-flex">' +
      '<div class="field" style="flex:0 0 120px"><label>Day of month</label><input id="rDay" type="number" min="1" max="31" step="1" value="' + esc(day) + '"></div>' +
      '<div class="field" style="flex:0 0 120px"><label>Net days</label><input id="rNet" type="number" min="0" max="120" step="1" value="' + esc(r.netDays == null ? 30 : r.netDays) + '"><div class="hint">bill due after</div></div>' +
      '<div class="field" style="flex:1 1 180px"><label>Next due date</label><input id="rNext" type="date" value="' + esc(r.nextDate || today()) + '"></div>' +
      '<div class="field" style="flex:1 1 140px;margin-bottom:13px"><label>&nbsp;</label><button class="btn btn-ghost btn-sm" id="rSetDay" type="button" style="width:100%">Set to next ' + esc(day) + "th</button></div>" +
      "</div>" +
      '<label class="check-inline" style="margin-bottom:12px"><input type="checkbox" id="rActive"' + (r.active ? " checked" : "") + '> <span>Rule is active</span></label>' +
      '<div class="je-ed-label">Lines <span class="muted small">— each line is debited to its account on posting</span></div>' +
      '<div id="rLines" class="je-ed-lines"></div>' +
      '<div class="je-ed-totals"><span id="rTotal">Total ' + FW.money(0) + "</span></div>" +
      '<div class="row-flex" style="margin-top:14px"><button class="btn btn-primary" id="rSaveBtn">' + (isNew ? "Create rule" : "Save changes") + "</button>" +
      '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>' +
      "</div>");
    modal.style.width = "min(820px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));

    const linesEl = modal.querySelector("#rLines");
    const totalEl = modal.querySelector("#rTotal");

    function lineHtml(l, i) {
      return '<div class="je-ed-line" data-i="' + i + '">' +
        '<select class="r-ed-acct" style="flex:1 1 220px;min-width:0">' + (accounts.length ? debitAccountOptions(accounts, l.account) : "") + "</select>" +
        '<input class="r-ed-desc" type="text" placeholder="Description" value="' + esc(l.desc) + '">' +
        '<input class="r-ed-amt amt-md" type="number" min="0" step="0.01" placeholder="Amount" value="' + esc(l.amount) + '">' +
        '<button class="icon-mini danger" data-rm="' + i + '" title="Remove line">' + ICON.x + "</button>" +
        "</div>";
    }
    function renderLines() {
      linesEl.innerHTML = lines.map(lineHtml).join("") + '<button class="btn btn-ghost btn-sm" id="rAddLine">+ Add line</button>';
      const addBtn = linesEl.querySelector("#rAddLine");
      if (addBtn) addBtn.addEventListener("click", () => { updateTotals(); lines.push({ desc: "", account: "", amount: "" }); renderLines(); updateTotals(); });
      FW.$$("[data-rm]", linesEl).forEach(b => b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-rm"));
        updateTotals();
        lines.splice(i, 1);
        renderLines(); updateTotals();
      }));
    }
    function updateTotals() {
      let t = 0;
      FW.$$(".je-ed-line", linesEl).forEach(row => {
        const i = Number(row.getAttribute("data-i"));
        const l = lines[i];
        if (!l) return;
        l.account = row.querySelector(".r-ed-acct").value;
        l.desc = row.querySelector(".r-ed-desc").value;
        l.amount = row.querySelector(".r-ed-amt").value;
        t = round2(t + amt(l.amount));
      });
      totalEl.textContent = "Total " + FW.money(t) + "/mo";
    }
    linesEl.addEventListener("input", updateTotals);
    renderLines();
    updateTotals();

    const nextDateForDay = (dv) => {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      let cand = new Date(y, m, Math.min(dv, daysInMonth(y, m + 1)));
      if (cand < new Date(y, m, now.getDate())) cand = new Date(y, m + 1, Math.min(dv, daysInMonth(y, m + 2)));
      return cand.getFullYear() + "-" + pad2(cand.getMonth() + 1) + "-" + pad2(cand.getDate());
    };
    modal.querySelector("#rSetDay").addEventListener("click", () => {
      const dv = Math.min(Math.max(parseInt(modal.querySelector("#rDay").value, 10) || 1, 1), 31);
      modal.querySelector("#rNext").value = nextDateForDay(dv);
    });

    modal.querySelector("#rSaveBtn").addEventListener("click", async () => {
      const label = String(modal.querySelector("#rLabel").value || "").trim();
      if (!label) { FW.toast("Label is required.", "err"); return; }
      const clean = lines.map(l => ({ desc: String(l.desc || "").trim(), account: l.account || null, amount: amt(l.amount) })).filter(l => l.account && l.amount > 0);
      if (!clean.length) { FW.toast("Add at least one line with an account and amount.", "err"); return; }
      const out = {
        id: r.id || null,
        label,
        vendor: String(modal.querySelector("#rVendor").value || "").trim(),
        dayOfMonth: Math.min(Math.max(parseInt(modal.querySelector("#rDay").value, 10) || 1, 1), 31),
        netDays: Math.min(Math.max(parseInt(modal.querySelector("#rNet").value, 10) || 30, 0), 120),
        nextDate: modal.querySelector("#rNext").value || today(),
        active: modal.querySelector("#rActive").checked,
        notes: r.notes || "",
        lines: clean,
        createdAt: r.createdAt || null,
      };
      const list = await loadRecurring();
      await saveRule(out, list);
      modal.closest(".modal-back").remove();
      FW.toast(isNew ? "Recurring rule created" : "Recurring rule updated");
      onSaved && onSaved();
    });
  }

  /* ── icons ───────────────────────────────────────────────────────────── */
  const ICON = {
    pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    issue: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    receive: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    bill: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v4h4"/><path d="M9 13h6M9 17h6"/></svg>',
    cancel: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 5v14"/><path d="M16 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M7 5v14l11-7z"/></svg>',
    skip: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6v12"/><path d="m13 6 6 6-6 6z"/><path d="m6 6 7 6-7 6z"/></svg>',
    compare: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M21 3 14 10"/><path d="M3 21l7-7"/><path d="M16 21h5v-5"/><path d="M8 21H3v-5"/><path d="m14 14 7 7"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/><path d="M6 15h4"/></svg>',
  };
  const ICON_ACT = { issue: ICON.issue, edit: ICON.pencil, bill: ICON.bill, cancel: ICON.cancel, delete: ICON.trash, receive: ICON.receive, view: ICON.eye, post: ICON.check, pause: ICON.pause, resume: ICON.play, advance: ICON.skip };

  /* ── self-test (validation for tasks 7–12) ───────────────────────────── */
  async function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || "" });

    /* task 7 — purchase orders */
    const po = { id: "po1", no: "PO-0001", status: "draft", lines: [
      { id: "l1", desc: "Widgets", qty: 10, unitPrice: 12.5, received: 0 },
      { id: "l2", desc: "Gadgets", qty: 3, unitPrice: 40, received: 0 },
    ] };
    ok("PO: line amount = qty × unit price", poLineAmount(10, 12.5) === 125);
    ok("PO: total sums line amounts", poTotal(po) === 245, "got " + poTotal(po));
    ok("PO: draft can be issued", poCanTransition("draft", "ordered"));
    ok("PO: draft can be cancelled", poCanTransition("draft", "cancelled"));
    ok("PO: ordered can be received", poCanTransition("ordered", "received"));
    ok("PO: billed is terminal", !poCanTransition("billed", "received") && !poCanTransition("billed", "cancelled"));
    ok("PO: cancelled can't be issued", !poCanTransition("cancelled", "ordered"));
    ok("PO: status preserved when no billing", poStatusFromBilling(po, { l1: 0, l2: 0 }) === "draft");
    ok("PO: partial billing detected", poStatusFromBilling(po, { l1: 10, l2: 0 }) === "partially_billed");
    ok("PO: full billing detected", poStatusFromBilling(po, { l1: 10, l2: 3 }) === "billed");
    const billedMap = matchedBilledQty(po, [
      { lines: [{ match: { poId: "po1", poLineId: "l1" }, qty: 4 }, { match: { poId: "po1", poLineId: "l2" }, qty: 3 }] },
      { lines: [{ match: { poId: "po1", poLineId: "l1" }, qty: 6 }] },
      { lines: [{ match: { poId: "other", poLineId: "l1" }, qty: 99 }] },
    ]);
    ok("PO: billed qty summed across bills only", billedMap.l1 === 10 && billedMap.l2 === 3);
    const accs = [
      { id: "a5100", code: "5100", name: "Rent", type: "expense", active: true },
      { id: "a5950", code: "5950", name: "Misc", type: "expense", active: true },
    ];
    ok("PO: rent description suggests rent account", suggestAccountFor("Monthly office rent", accs) === "a5100");
    ok("PO: unknown description falls back to misc", suggestAccountFor("random thing", accs) === "a5950");

    /* task 8 — vendor bills */
    const bill = {
      id: "b1", no: "BILL-0001", vendor: "Acme", billDate: "2026-09-10", billNumber: "INV-9",
      status: "draft",
      lines: [
        { desc: "Widgets", account: "a5100", qty: 10, unitPrice: 12.5, amount: 125, match: { poId: "po1", poLineId: "l1" } },
        { desc: "Freight", account: "a5950", qty: 1, unitPrice: 20, amount: 20, match: null },
      ],
    };
    ok("Bill: total sums line amounts", billTotal(bill) === 145, "got " + billTotal(bill));
    const fullAccs = [...accs, { id: "a2000", code: "2000", name: "Accounts Payable", type: "liability", active: true }];
    ok("Bill: A/P account located by code", apAccountId(fullAccs) === "a2000");
    const entry = buildEntryFromBill(bill, fullAccs, "a2000");
    const t = Ledger.entryTotals(entry);
    ok("Bill: posted entry balances (DR = CR)", t.dr === t.cr && t.dr === 145, t.dr + "/" + t.cr);
    ok("Bill: each line debited to its account", entry.lines.filter(l => l.debit > 0).length === 2);
    ok("Bill: A/P credited for the total", entry.lines.some(l => l.account === "a2000" && l.credit === 145));
    ok("Bill: entry carries vendor + bill number in memo", /Acme/.test(entry.memo) && /INV-9/.test(entry.reference));
    ok("Bill: lines without account excluded from entry", buildEntryFromBill({ ...bill, lines: bill.lines.map(l => ({ ...l, account: null })) }, fullAccs, "a2000").lines.length === 1);

    /* task 9 — recurring expenses */
    const rule = {
      id: "r1", label: "Rent", vendor: "Acme Realty", dayOfMonth: 1, netDays: 30,
      nextDate: "2026-09-01", active: true,
      lines: [{ desc: "Office rent", account: "a5100", amount: 2000 }],
    };
    const rb = buildRecurringBill(rule, "2026-09-01");
    ok("Recurring: generated bill is a draft with source link", rb.status === "draft" && rb.source.kind === "recurring" && rb.source.ruleId === "r1" && rb.source.dueDate === "2026-09-01");
    ok("Recurring: bill lines match rule template", rb.lines.length === 1 && rb.lines[0].amount === 2000 && rb.lines[0].account === "a5100");
    ok("Recurring: due date = due + net days", rb.dueDate === "2026-10-01", rb.dueDate);
    ok("Recurring: due when nextDate ≤ today", dueBillsToCreate([rule], [], "2026-09-05").length === 1);
    ok("Recurring: not due before nextDate", dueBillsToCreate([rule], [], "2026-08-31").length === 0);
    ok("Recurring: paused rule never generates", dueBillsToCreate([{ ...rule, active: false }], [], "2026-12-31").length === 0);
    ok("Recurring: existing draft for due date blocks duplicate", dueBillsToCreate([rule], [{ source: { kind: "recurring", ruleId: "r1", dueDate: "2026-09-01" } }], "2026-09-05").length === 0);
    ok("Recurring: draft for another date doesn't block", dueBillsToCreate([rule], [{ source: { kind: "recurring", ruleId: "r1", dueDate: "2026-08-01" } }], "2026-09-05").length === 1);
    ok("Recurring: next-month advance", nextMonthDate("2026-09-06") === "2026-10-06");
    ok("Recurring: year rollover advances", nextMonthDate("2026-12-15") === "2027-01-15");
    ok("Recurring: Jan 31 clamps to Feb 28", nextMonthDate("2026-01-31") === "2026-02-28", nextMonthDate("2026-01-31"));
    ok("Recurring: Jan 31 clamps to Feb 29 in leap year", nextMonthDate("2024-01-31") === "2024-02-29");

    /* task 10 — line-item matching engine */
    const poM = {
      id: "pom", no: "PO-0009", vendor: "Paper Co", status: "ordered",
      lines: [
        { id: "pl1", desc: "Paper", qty: 100, unitPrice: 2, received: 0 },
        { id: "pl2", desc: "Ink", qty: 10, unitPrice: 25, received: 0 },
      ],
    };
    const mkBill = (over) => ({
      id: "bm1", no: "BILL-0009", vendor: "Paper Co", status: "draft", poId: "pom",
      lines: [{ id: "bl1", desc: "Paper", qty: 100, unitPrice: 2, amount: 200, match: { poId: "pom", poLineId: "pl1" }, ...over }],
    });
    let mm = matchBillToPO(mkBill({}), poM, []);
    ok("Match: exact bill line agrees with PO", mm.lines[0].status === "exact");
    ok("Match: no variance when everything agrees", mm.overall === "exact");
    ok("Match: still-unbilled PO line is reported", mm.issues.some(i => /unbilled/i.test(i.message)));
    mm = matchBillToPO(mkBill({ unitPrice: 2.5, amount: 250 }), poM, []);
    ok("Match: unit-price variance flagged", mm.lines[0].status === "price_diff");
    ok("Match: price variance makes overall variance", mm.overall === "variance");
    mm = matchBillToPO(mkBill({ qty: 200, amount: 400 }), poM, []);
    ok("Match: over-billed qty flagged as an error", mm.lines[0].status === "overbilled" && mm.issues.some(i => i.severity === "error"));
    mm = matchBillToPO(mkBill({ match: null, desc: "Extra charge", qty: 1, unitPrice: 5, amount: 5 }), poM, []);
    ok("Match: unmatched bill line reported", mm.lines[0].status === "unmatched");
    const fl = billMatchFlags(mkBill({ unitPrice: 2.5, amount: 250 }), [poM], []);
    ok("Match: flags report variance + warn count", fl && fl.overall === "variance" && fl.warns === 1);

    /* task 11 — payment disbursement */
    const cashAccs = [...fullAccs, { id: "a1010", code: "1010", name: "Checking Account", type: "asset", active: true }];
    ok("Pay: cash account located by code", cashAccountId(cashAccs) === "a1010");
    ok("Pay: check ref advances its own sequence", nextPaymentRef("check", [{ paymentRef: "CHK-0001" }, { paymentRef: "ACH-0007" }]) === "CHK-0002");
    ok("Pay: ACH uses its own prefix", nextPaymentRef("ach", []) === "ACH-0001");
    ok("Pay: first check ref is CHK-0001", nextPaymentRef("check", []) === "CHK-0001");

    /* task 11 — payment posting through the ledger (integration) */
    const liveAccs = await Ledger.loadAccounts();
    const apId = apAccountId(liveAccs);
    const hasCash = liveAccs.some(a => a.id === "a1010");
    if (apId && hasCash) {
      const kvBills0 = await loadBills();
      const tempBill = {
        id: "tmp_pay", no: "BILL-TMP", vendor: "Temp Vendor", status: "open",
        billDate: "2026-09-01", dueDate: "2026-10-01",
        lines: [{ id: "tl1", desc: "Temp", account: "a5100", qty: 1, unitPrice: 123.45, amount: 123.45 }],
        ledgerEntryId: null, postedAt: null, source: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      kvBills0.push(tempBill); await saveBills(kvBills0);
      const pr = await payBills([tempBill.id], { method: "check", date: "2026-09-06", cashAccountId: "a1010" });
      ok("Pay: posting succeeds", pr.ok === true, pr.error || "");
      ok("Pay: generates a CHK reference", /^CHK-\d+$/.test(pr.ref || ""), pr.ref);
      const paid = (await loadBills()).find(x => x.id === tempBill.id);
      ok("Pay: bill marked paid with ref, method, date", paid && paid.status === "paid" && paid.paymentRef === pr.ref && paid.paymentMethod === "check" && paid.paymentDate === "2026-09-06");
      const pe = (await Ledger.loadEntries()).find(e => e.id === pr.entryId);
      const pt = pe ? Ledger.entryTotals(pe) : null;
      ok("Pay: entry posted, balanced, DR A/P / CR cash", pe && pe.status === "posted" && pt && pt.dr === pt.cr && pt.dr === 123.45 && pe.lines.some(l => l.account === apId && l.debit === 123.45) && pe.lines.some(l => l.account === "a1010" && l.credit === 123.45));
      ok("Pay: already-paid bills are rejected", (await payBills([tempBill.id], { method: "ach", date: "2026-09-06" })).error);
      await saveBills((await loadBills()).filter(x => x.id !== tempBill.id));
      await Ledger.saveEntries((await Ledger.loadEntries()).filter(e => e.id !== pr.entryId));
    } else {
      ok("Pay: integration skipped (missing A/P or cash account)", true);
    }

    /* task 12 — A/P aging */
    const agingBills = [
      { id: "ag1", no: "BILL-A1", vendor: "V1", status: "open", dueDate: "2026-09-20", billDate: "2026-08-01", lines: [{ desc: "x", account: "a5100", qty: 1, unitPrice: 100, amount: 100 }] },
      { id: "ag2", no: "BILL-A2", vendor: "V2", status: "open", dueDate: "2026-08-20", billDate: "2026-08-01", lines: [{ desc: "x", account: "a5100", qty: 1, unitPrice: 50, amount: 50 }] },
      { id: "ag3", no: "BILL-A3", vendor: "V3", status: "open", dueDate: "2026-07-20", billDate: "2026-08-01", lines: [{ desc: "x", account: "a5100", qty: 1, unitPrice: 75, amount: 75 }] },
      { id: "ag4", no: "BILL-A4", vendor: "V4", status: "open", dueDate: "2026-06-15", billDate: "2026-08-01", lines: [{ desc: "x", account: "a5100", qty: 1, unitPrice: 25, amount: 25 }] },
      { id: "ag5", no: "BILL-A5", vendor: "V5", status: "open", dueDate: "2026-05-01", billDate: "2026-08-01", lines: [{ desc: "x", account: "a5100", qty: 1, unitPrice: 10, amount: 10 }] },
      { id: "ag6", no: "BILL-A6", vendor: "V6", status: "draft", dueDate: "2026-09-01", billDate: "2026-08-01", lines: [{ desc: "x", account: "a5100", qty: 1, unitPrice: 999, amount: 999 }] },
      { id: "ag7", no: "BILL-A7", vendor: "V7", status: "paid", dueDate: "2026-09-01", billDate: "2026-08-01", lines: [{ desc: "x", account: "a5100", qty: 1, unitPrice: 500, amount: 500 }] },
    ];
    const ag = apAging(agingBills, "2026-09-06");
    ok("Aging: total sums only open bills", ag.total === 260, "got " + ag.total);
    ok("Aging: drafts and paid bills excluded", ag.buckets.reduce((s, x) => s + x.count, 0) === 5);
    ok("Aging: current bucket holds not-yet-due", ag.buckets[0].count === 1 && ag.buckets[0].total === 100);
    ok("Aging: 1–30 bucket", ag.buckets[1].count === 1 && ag.buckets[1].total === 50);
    ok("Aging: 31–60 bucket", ag.buckets[2].count === 1 && ag.buckets[2].total === 75);
    ok("Aging: 61–90 bucket", ag.buckets[3].count === 1 && ag.buckets[3].total === 25);
    ok("Aging: 90+ bucket", ag.buckets[4].count === 1 && ag.buckets[4].total === 10);
    ok("Aging: overdue total excludes current", ag.overdue === 160, "got " + ag.overdue);
    ok("Aging: oldest bill identified", ag.oldest && ag.oldest.no === "BILL-A5" && ag.oldest.days > 90);
    ok("Aging: daysBetween math", daysBetween("2026-09-06", "2026-09-01") === 5);

    return results;
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  window.AP = {
    loadPOs, savePOs, loadBills, saveBills, loadRecurring, saveRecurring,
    poTotal, poLineAmount, poCanTransition, poStatusLabel, poStatusChip,
    matchedBilledQty, poStatusFromBilling, savePO, setPOStatus, deletePO, convertPOtoBill,
    billTotal, apAccountId, suggestAccountFor, buildEntryFromBill,
    saveBill, postBill, deleteBill, recomputePO,
    buildRecurringBill, dueBillsToCreate, generateDueBills,
    saveRule, setRuleActive, advanceRule, deleteRule,
    nextMonthDate, addDays, nextNo,
    cashAccountId, cashOptions, nextPaymentRef, payBills,
    matchBillToPO, billMatchFlags, daysBetween, apAging,
    render, selfTest,
  };
})();
