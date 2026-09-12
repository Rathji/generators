/* ============================================================
   PSA-U — payments, credits & adjustments (Phase 6 · Task 31)

   Money coming back against an invoice. This engine owns:

     • payments   — a payment recorded against a posted invoice
                    (amount, date, method, reference), applied to the
                    invoice and re-deriving its balance and payment
                    status; partial payments are first-class and an
                    over-payment is kept as a client credit.
     • credits    — a credit note raised for a client, either
                    applied immediately to an invoice or held on
                    account until applied.
     • adjustments— a signed adjustment against an invoice (a
                    correction), and a write-off (debt given up),
                    both with a reason and an audit trail.

   Every write goes through `ERP.billing.recalc`, so the invoice's
   balance, payment status and the company balance always agree with
   the ledger. A voided payment or credit is reversed, never
   deleted, so the audit trail survives. Storage: payments and
   credit notes live in the CLIENT COMPANY document (kinds "payment"
   and "creditNote"), so a client's ledger travels with the client.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const P = (ERP.payments = {});
  const B = () => ERP.billing;

  function ten() {
    if (!ERP.tenancy) throw new Error("payments requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function maskedMoney(v, cur) { return ERP.security.canSeeFinancials() ? ui.money(v, cur) : "•••"; }

  async function putCompany(companyId, rec) {
    if (rec.id == null || rec.id === "" || !isFinite(rec.id)) rec.id = ten().nextId(await ten().records("company", companyId));
    rec.companyId = companyId;
    return ten().upsert("company", companyId, rec);
  }

  function audit(action, target, summary) {
    if (!ERP.master || typeof ERP.master.audit !== "function") return;
    try { ERP.master.audit({ action: action, targetType: target ? target.kind : "payment", targetId: target ? target.id : null, summary: summary || "" }); } catch (e) {}
  }
  async function emit(pid, event, companyId, extra) {
    if (!ERP.workflow) return;
    try {
      const company = companyId != null ? await ERP.companies.get(companyId) : null;
      await ERP.workflow.emit(event, Object.assign({ event: event, company: company, actor: actor() }, extra || {}));
    } catch (e) {}
  }

  /* ─────────────────────────── constants ─────────────────────────── */

  P.METHODS = [
    { id: "bank_transfer", label: "Bank transfer" },
    { id: "card", label: "Card" },
    { id: "cash", label: "Cash" },
    { id: "cheque", label: "Cheque" },
    { id: "online", label: "Online" },
    { id: "other", label: "Other" },
  ];
  P.methodLabel = (id) => (P.METHODS.find((m) => m.id === id) || {}).label || id || "—";

  P.PAYMENT_STATUSES = [
    { id: "applied", label: "Applied", tone: "success" },
    { id: "void", label: "Void", tone: "danger" },
  ];
  P.paymentStatusLabel = (id) => (P.PAYMENT_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  P.paymentStatusTone = (id) => (P.PAYMENT_STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  P.newPayment = (over) => Object.assign({
    kind: "payment", id: null, providerId: null, companyId: null, invoiceId: null,
    number: "", amount: 0, currency: "", date: "", method: "bank_transfer", reference: "",
    notes: "", status: "applied", idempotencyKey: null,
    appliedAt: null, appliedBy: null, voidedAt: null, voidedBy: null, voidReason: "",
    createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  P.newCredit = (over) => Object.assign({
    kind: "creditNote", id: null, providerId: null, companyId: null, invoiceId: null,
    number: "", amount: 0, currency: "", date: "", reason: "", type: "credit",
    status: "issued", appliedInvoiceId: null, appliedAt: null, appliedBy: null,
    voidedAt: null, voidedBy: null, voidReason: "",
    createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  /* ─────────────────────────── reads ─────────────────────────── */

  async function entriesOf(companyId, kind) {
    try { return await ten().records("company", companyId, kind); } catch (e) { return []; }
  }

  P.forCompany = function (companyId, kind) { return entriesOf(companyId, kind || "payment"); };

  P.all = async function (pid, query) {
    query = query || {};
    const companies = await ERP.companies.list();
    const out = [];
    for (const e of companies) {
      if (query.companyId != null && query.companyId !== "" && String(e.id) !== String(query.companyId)) continue;
      for (const p of await entriesOf(e.id, "payment")) {
        if (query.status && String(p.status) !== String(query.status)) continue;
        if (query.invoiceId != null && String(p.invoiceId) !== String(query.invoiceId)) continue;
        if (query.from && String(p.date) < String(query.from)) continue;
        if (query.to && String(p.date) > String(query.to)) continue;
        out.push(Object.assign({}, p, { __companyName: e.name }));
      }
    }
    out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (Number(b.id) - Number(a.id)));
    return out;
  };

  P.get = async function (companyId, id) {
    if (companyId == null || id == null) return null;
    return (await entriesOf(companyId, "payment")).find((p) => String(p.id) === String(id)) || null;
  };

  P.locate = async function (pid, paymentId) {
    const companies = await ERP.companies.list();
    for (const e of companies) {
      const found = (await entriesOf(e.id, "payment")).find((p) => String(p.id) === String(paymentId));
      if (found) return { payment: found, companyId: e.id, company: await ERP.companies.get(e.id) };
    }
    return null;
  };

  P.forInvoice = async function (companyId, invoiceId) {
    return (await entriesOf(companyId, "payment")).filter((p) => String(p.invoiceId) === String(invoiceId));
  };

  P.credits = async function (pid, query) {
    query = query || {};
    const companies = await ERP.companies.list();
    const out = [];
    for (const e of companies) {
      if (query.companyId != null && query.companyId !== "" && String(e.id) !== String(query.companyId)) continue;
      for (const c of await entriesOf(e.id, "creditNote")) {
        if (query.status && String(c.status) !== String(query.status)) continue;
        if (query.unapplied && c.appliedInvoiceId != null) continue;
        out.push(Object.assign({}, c, { __companyName: e.name }));
      }
    }
    out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (Number(b.id) - Number(a.id)));
    return out;
  };

  P.credit = async function (pid, creditId) {
    const companies = await ERP.companies.list();
    for (const e of companies) {
      const found = (await entriesOf(e.id, "creditNote")).find((c) => String(c.id) === String(creditId));
      if (found) return { credit: found, companyId: e.id };
    }
    return null;
  };

  async function nextNumber(companyId, kind) {
    const list = await entriesOf(companyId, kind);
    let max = 0;
    for (const r of list) {
      const m = /(\d+)\s*$/.exec(String(r.number || ""));
      if (m) max = Math.max(max, Number(m[1]));
    }
    const prefix = kind === "payment" ? "PMT" : "CN";
    return prefix + "-" + String(max + 1).padStart(4, "0");
  }

  /* ─────────────────────────── invoice recompute ─────────────────────────── */

  async function resaveInvoice(companyId, inv) {
    ERP.billing.recalc(inv);
    inv.updatedAt = nowIso();
    await putCompany(companyId, inv);
    return inv;
  }

  /* ─────────────────────────── payments ─────────────────────────── */

  P.record = async function (pid, payload) {
    payload = payload || {};
    if (!ERP.security.enforce("payments.edit", { companyId: payload.companyId })) return { error: "forbidden" };
    const companyId = payload.companyId;
    const invoiceId = payload.invoiceId;
    if (companyId == null || companyId === "") return { error: "company_required" };
    if (invoiceId == null) return { error: "invoice_required" };
    const amount = round2(num(payload.amount));
    if (!(amount > 0)) return { error: "amount_invalid", message: "Enter a payment amount greater than zero." };

    if (payload.idempotencyKey) {
      const existing = (await entriesOf(companyId, "payment")).find((p) => p.idempotencyKey && String(p.idempotencyKey) === String(payload.idempotencyKey));
      if (existing) return { record: existing, existing: true, invoice: await ERP.billing.get(companyId, existing.invoiceId) };
    }

    const inv = await ERP.billing.get(companyId, invoiceId);
    if (!inv) return { error: "not_found" };
    if (inv.status === "void") return { error: "void", message: "This invoice is void." };
    if (inv.status !== "posted") return { error: "not_posted", message: "Record payments against a posted invoice." };

    const method = payload.method || "bank_transfer";
    const rec = P.newPayment({
      providerId: pid, companyId: companyId, invoiceId: invoiceId,
      number: payload.number || await nextNumber(companyId, "payment"),
      amount: amount, currency: payload.currency || inv.currency, date: payload.date || ui.today(),
      method: method, reference: payload.reference || "", notes: payload.notes || "",
      idempotencyKey: payload.idempotencyKey || null,
      status: "applied", appliedAt: nowIso(), appliedBy: actorName(),
      createdAt: nowIso(), createdBy: actor().memberId || null,
    });
    await putCompany(companyId, rec);

    inv.payments = (inv.payments || []).concat([{
      id: rec.id, paymentId: rec.id, date: rec.date, amount: rec.amount, method: rec.method,
      reference: rec.reference, by: actorName(), at: nowIso(), status: "applied",
    }]);
    await resaveInvoice(companyId, inv);

    audit("payment_recorded", rec, "Payment " + rec.number + " of " + maskedMoney(rec.amount, rec.currency) + " for invoice " + (inv.number || "#" + inv.id) + ".");
    await emit(pid, "payment.received", companyId, { payment: rec, invoice: inv });
    await emit(pid, inv.paymentStatus === "paid" || inv.paymentStatus === "overpaid" ? "invoice.paid" : "invoice.partially_paid", companyId, { payment: rec, invoice: inv });
    return { record: rec, invoice: inv };
  };

  P.voidPayment = async function (pid, paymentId, reason) {
    if (!ERP.security.enforce("payments.void")) return { error: "forbidden" };
    const loc = await P.locate(pid, paymentId);
    if (!loc) return { error: "not_found" };
    const pay = loc.payment;
    if (pay.status === "void") return { record: pay, already: true, invoice: await ERP.billing.get(loc.companyId, pay.invoiceId) };
    const rec = Object.assign({}, pay, { status: "void", voidedAt: nowIso(), voidedBy: actorName(), voidReason: reason || "", updatedAt: nowIso() });
    await putCompany(loc.companyId, rec);
    const inv = await ERP.billing.get(loc.companyId, pay.invoiceId);
    if (inv) {
      inv.payments = (inv.payments || []).map((p) => String(p.paymentId) === String(pay.id) ? Object.assign({}, p, { status: "void" }) : p);
      await resaveInvoice(loc.companyId, inv);
    }
    audit("payment_voided", rec, "Payment " + pay.number + " voided — " + (reason || "no reason given") + ".");
    return { record: rec, invoice: inv };
  };

  /* ─────────────────────────── credits ─────────────────────────── */

  async function applyCreditToInvoice(companyId, credit, inv) {
    inv.creditNotes = (inv.creditNotes || []).concat([{
      id: credit.id, creditId: credit.id, amount: credit.amount, reason: credit.reason || "",
      by: actorName(), at: nowIso(), status: "applied",
    }]);
    await resaveInvoice(companyId, inv);
    return inv;
  }

  P.issueCredit = async function (pid, payload) {
    payload = payload || {};
    if (!ERP.security.enforce("payments.edit", { companyId: payload.companyId })) return { error: "forbidden" };
    const companyId = payload.companyId;
    if (companyId == null || companyId === "") return { error: "company_required" };
    const amount = round2(num(payload.amount));
    if (!(amount > 0)) return { error: "amount_invalid", message: "Enter a credit amount greater than zero." };

    if (payload.idempotencyKey) {
      const existing = (await entriesOf(companyId, "creditNote")).find((c) => c.idempotencyKey && String(c.idempotencyKey) === String(payload.idempotencyKey));
      if (existing) return { record: existing, existing: true };
    }

    let inv = null;
    if (payload.invoiceId != null) {
      inv = await ERP.billing.get(companyId, payload.invoiceId);
      if (!inv) return { error: "not_found" };
      if (inv.status === "void") return { error: "void" };
    }
    const rec = P.newCredit({
      providerId: pid, companyId: companyId, invoiceId: payload.invoiceId != null ? payload.invoiceId : null,
      number: payload.number || await nextNumber(companyId, "creditNote"),
      amount: amount, currency: payload.currency || (inv && inv.currency) || "", date: payload.date || ui.today(),
      reason: payload.reason || "", type: payload.type || "credit", status: "issued",
      idempotencyKey: payload.idempotencyKey || null,
      createdAt: nowIso(), createdBy: actor().memberId || null,
      appliedInvoiceId: inv ? inv.id : null, appliedAt: inv ? nowIso() : null, appliedBy: inv ? actorName() : null,
    });
    await putCompany(companyId, rec);
    if (inv) {
      inv = await applyCreditToInvoice(companyId, rec, inv);
      rec.status = "applied";
      await putCompany(companyId, rec);
    }
    audit("credit_issued", rec, "Credit " + rec.number + " of " + maskedMoney(rec.amount, rec.currency) + (inv ? " applied to invoice " + (inv.number || "#" + inv.id) : " held on account") + ".");
    await emit(pid, "credit.issued", companyId, { credit: rec, invoice: inv });
    return { record: rec, invoice: inv };
  };

  P.applyCredit = async function (pid, creditId, invoiceId) {
    if (!ERP.security.enforce("payments.edit")) return { error: "forbidden" };
    const loc = await P.credit(pid, creditId);
    if (!loc) return { error: "not_found" };
    const credit = loc.credit;
    if (credit.status === "void") return { error: "void" };
    if (credit.appliedInvoiceId != null) return { error: "already_applied", message: "This credit is already applied." };
    const inv = await ERP.billing.get(loc.companyId, invoiceId);
    if (!inv) return { error: "not_found" };
    if (inv.status !== "posted") return { error: "not_posted", message: "Apply credits to a posted invoice." };
    const rec = Object.assign({}, credit, { status: "applied", appliedInvoiceId: inv.id, appliedAt: nowIso(), appliedBy: actorName(), updatedAt: nowIso() });
    await putCompany(loc.companyId, rec);
    await applyCreditToInvoice(loc.companyId, rec, inv);
    audit("credit_applied", rec, "Credit " + rec.number + " applied to invoice " + (inv.number || "#" + inv.id) + ".");
    return { record: rec, invoice: inv };
  };

  P.voidCredit = async function (pid, creditId, reason) {
    if (!ERP.security.enforce("payments.void")) return { error: "forbidden" };
    const loc = await P.credit(pid, creditId);
    if (!loc) return { error: "not_found" };
    const credit = loc.credit;
    if (credit.status === "void") return { record: credit, already: true };
    const rec = Object.assign({}, credit, { status: "void", voidedAt: nowIso(), voidedBy: actorName(), voidReason: reason || "", updatedAt: nowIso() });
    await putCompany(loc.companyId, rec);
    if (credit.appliedInvoiceId != null) {
      const inv = await ERP.billing.get(loc.companyId, credit.appliedInvoiceId);
      if (inv) {
        inv.creditNotes = (inv.creditNotes || []).map((c) => String(c.creditId) === String(credit.id) ? Object.assign({}, c, { status: "void" }) : c);
        await resaveInvoice(loc.companyId, inv);
      }
    }
    audit("credit_voided", rec, "Credit " + credit.number + " voided — " + (reason || "no reason given") + ".");
    return { record: rec };
  };

  /* ─────────────────────────── adjustments & write-offs ─────────────────────────── */

  P.adjust = async function (pid, invoiceId, amount, reason) {
    if (!ERP.security.enforce("payments.edit")) return { error: "forbidden" };
    const loc = await ERP.billing.locate(pid, invoiceId);
    if (!loc) return { error: "not_found" };
    const inv = loc.invoice;
    if (inv.status !== "posted") return { error: "not_posted", message: "Adjustments apply to a posted invoice." };
    const amt = round2(num(amount));
    if (amt === 0) return { error: "amount_invalid" };
    inv.adjustmentsList = (inv.adjustmentsList || []).concat([{ id: Date.now(), type: "adjustment", amount: amt, reason: reason || "", by: actorName(), at: nowIso(), status: "applied" }]);
    await resaveInvoice(loc.companyId, inv);
    audit("invoice_adjusted", inv, "Invoice " + (inv.number || "#" + inv.id) + " adjusted by " + maskedMoney(amt, inv.currency) + " — " + (reason || "no reason"));
    return { invoice: inv };
  };

  P.writeOff = async function (pid, invoiceId, amount, reason) {
    if (!ERP.security.enforce("payments.edit")) return { error: "forbidden" };
    const loc = await ERP.billing.locate(pid, invoiceId);
    if (!loc) return { error: "not_found" };
    const inv = loc.invoice;
    if (inv.status !== "posted") return { error: "not_posted", message: "Write-offs apply to a posted invoice." };
    const amt = round2(num(amount));
    if (!(amt > 0)) return { error: "amount_invalid" };
    const capped = Math.min(amt, num(inv.balance));
    inv.adjustmentsList = (inv.adjustmentsList || []).concat([{ id: Date.now(), type: "writeoff", amount: capped, reason: reason || "", by: actorName(), at: nowIso(), status: "applied" }]);
    await resaveInvoice(loc.companyId, inv);
    audit("invoice_written_off", inv, "Wrote off " + maskedMoney(capped, inv.currency) + " of invoice " + (inv.number || "#" + inv.id) + " — " + (reason || "no reason"));
    return { invoice: inv, writtenOff: capped };
  };

  /* ─────────────────────────── balances ─────────────────────────── */

  P.companyBalance = async function (pid, companyId) {
    const invoices = await ERP.billing.forCompany(companyId);
    const open = invoices.filter((i) => i.status === "posted" && num(i.balance) > 0.005);
    const unapplied = (await entriesOf(companyId, "creditNote")).filter((c) => c.status === "issued" && c.appliedInvoiceId == null && c.status !== "void");
    return {
      balance: round2(open.reduce((n, i) => n + num(i.balance), 0)),
      openInvoices: open.length,
      creditOnAccount: round2(unapplied.reduce((n, c) => n + num(c.amount), 0)),
    };
  };

  P.balances = async function (pid) {
    const companies = await ERP.companies.list();
    const rows = [];
    for (const e of companies) {
      const b = await P.companyBalance(pid, e.id);
      if (b.openInvoices || b.creditOnAccount) rows.push(Object.assign({ companyId: e.id, companyName: e.name }, b));
    }
    return rows;
  };

  /* ═══════════════════════════ station tab ═══════════════════════════ */

  P.render = async function (panel, pid) {
    const host = panel.__host || panel;
    const state = host.__bill || (host.__bill = { companyId: "" });
    const companies = await ERP.companies.optionList();
    if ((!state.companyId || !companies.some((c) => String(c.value) === String(state.companyId))) && companies.length) state.companyId = companies[0].value;
    const canEdit = ERP.security.can("payments.edit");
    const canVoid = ERP.security.can("payments.void");

    const payments = (await P.all(pid, { companyId: state.companyId })).filter(() => true);
    const credits = await P.credits(pid, { companyId: state.companyId });
    const invoices = (await ERP.billing.all(pid, { companyId: state.companyId })).filter((i) => i.status === "posted");
    const balances = await P.balances(pid);
    const balTotal = round2(balances.reduce((n, b) => n + num(b.balance), 0));
    const onAccount = round2(balances.reduce((n, b) => n + num(b.creditOnAccount), 0));

    const payRows = payments.map((p) => {
      const inv = invoices.find((i) => String(i.id) === String(p.invoiceId));
      return {
        number: ui.esc(p.number || ""),
        client: ui.esc(p.__companyName || ""),
        date: ui.esc(p.date || ""),
        invoice: ui.esc(inv ? (inv.number || "#" + inv.id) : "#" + p.invoiceId),
        method: ui.esc(P.methodLabel(p.method)),
        reference: ui.esc(p.reference || "—"),
        amount: maskedMoney(p.amount, p.currency),
        status: ui.badge(P.paymentStatusLabel(p.status), P.paymentStatusTone(p.status)),
        actions: canVoid && p.status === "applied" ? ui.btn("Void", { small: true, danger: true, act: "pm-void", arg: p.id }) : "",
      };
    });
    const creditRows = credits.map((c) => ({
      number: ui.esc(c.number || ""),
      client: ui.esc(c.__companyName || ""),
      date: ui.esc(c.date || ""),
      amount: maskedMoney(c.amount, c.currency),
      reason: ui.esc(c.reason || "—"),
      applied: c.appliedInvoiceId != null ? ui.badge("applied to #" + c.appliedInvoiceId, "success") : ui.badge("on account", "info"),
      status: ui.badge(c.status === "void" ? "Void" : "Issued", c.status === "void" ? "danger" : "success"),
      actions: canEdit && c.status === "issued" && c.appliedInvoiceId == null
        ? ui.btn("Apply", { small: true, primary: true, act: "pm-apply", arg: c.id }) + (canVoid ? " " + ui.btn("Void", { small: true, danger: true, act: "pm-voidcredit", arg: c.id }) : "")
        : (canVoid && c.status === "issued" ? ui.btn("Void", { small: true, danger: true, act: "pm-voidcredit", arg: c.id }) : ""),
    }));
    const balRows = balances.map((b) => ({
      client: ui.esc(b.companyName),
      open: String(b.openInvoices),
      balance: maskedMoney(b.balance),
      credit: maskedMoney(b.creditOnAccount),
    }));

    panel.innerHTML =
      ui.summary([
        { label: "Open balance", value: maskedMoney(balTotal) },
        { label: "Credit on account", value: maskedMoney(onAccount) },
        { label: "Payments", value: String(payments.length) },
        { label: "Credits", value: String(credits.length) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("pm-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        '<span class="erp-db-hint">Payments, credits and adjustments post against posted invoices</span>' +
        (canEdit ? ui.btn("Record payment", { primary: true, act: "pm-record" }) + " " + ui.btn("Issue credit", { act: "pm-credit" }) : "") +
      "</div>" +
      ui.card("Payments", ui.table([
        { key: "number", label: "Number" },
        { key: "client", label: "Client" },
        { key: "date", label: "Date" },
        { key: "invoice", label: "Invoice" },
        { key: "method", label: "Method" },
        { key: "reference", label: "Reference" },
        { key: "amount", label: "Amount", align: "right" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], payRows, { emptyText: "No payments recorded." })) +
      ui.card("Credits & adjustments", ui.table([
        { key: "number", label: "Number" },
        { key: "client", label: "Client" },
        { key: "date", label: "Date" },
        { key: "amount", label: "Amount", align: "right" },
        { key: "reason", label: "Reason" },
        { key: "applied", label: "Applied" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], creditRows, { emptyText: "No credits issued." })) +
      ui.card("Balances by client", ui.table([
        { key: "client", label: "Client" },
        { key: "open", label: "Open invoices", align: "right" },
        { key: "balance", label: "Balance", align: "right" },
        { key: "credit", label: "Credit on account", align: "right" },
      ], balRows, { emptyText: "No open balances." }));

    const bind = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; P.render(panel, pid); }); };
    bind('[name="pm-client"]', "companyId");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "pm-record") return openPaymentModal(pid, state.companyId, () => P.render(panel, pid));
      if (act === "pm-credit") return openCreditModal(pid, state.companyId, () => P.render(panel, pid));
      if (act === "pm-void") {
        if (!(await ui.confirm({ title: "Void this payment?", message: "The invoice balance is restored. The record is kept for audit.", danger: true, okLabel: "Void" }))) return;
        const res = await P.voidPayment(pid, arg, "Voided from the register");
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Payment voided.", "success"); return P.render(panel, pid);
      }
      if (act === "pm-voidcredit") {
        if (!(await ui.confirm({ title: "Void this credit?", message: "If it was applied, the invoice balance is restored.", danger: true, okLabel: "Void" }))) return;
        const res = await P.voidCredit(pid, arg, "Voided from the register");
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Credit voided.", "success"); return P.render(panel, pid);
      }
      if (act === "pm-apply") return openApplyCreditModal(pid, arg, () => P.render(panel, pid));
    });
  };

  async function openPaymentModal(pid, companyId, refresh) {
    if (!ERP.security.enforce("payments.edit", { companyId: companyId })) return;
    const companies = await ERP.companies.optionList();
    const invoices = (await ERP.billing.all(pid, { companyId: companyId })).filter((i) => i.status === "posted" && num(i.balance) > 0.005);
    if (!invoices.length) return ERP.toast("No open posted invoices for this client.", "warn");
    const options = invoices.map((i) => ({ value: i.id, label: (i.number || "#" + i.id) + " · " + ui.money(i.balance, i.currency) + " due" }));
    const fields =
      '<div class="erp-form-row">' +
        ui.select("companyId", "Client", companies, companyId) +
        ui.select("invoiceId", "Invoice", options, invoices[0].id) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("amount", "Amount", invoices[0].balance, { min: 0, step: 0.01 }) +
        ui.dateInput("date", "Date", ui.today()) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("method", "Method", P.METHODS.map((m) => ({ value: m.id, label: m.label })), "bank_transfer") +
        ui.text("reference", "Reference", "") +
      "</div>" +
      ui.textarea("notes", "Notes", "", 2);
    const modal = ui.modal({
      title: "Record payment", size: "lg", body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "pmm-cancel" }) + " " + ui.btn("Record payment", { small: true, primary: true, act: "pmm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pmm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pmm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["companyId", "invoiceId", "amount", "date", "method", "reference", "notes"]);
      btn.disabled = true;
      const res = await P.record(pid, v);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal();
      ERP.toast("Payment recorded — invoice balance " + ui.money(res.invoice.balance, res.invoice.currency) + ".", "success");
      refresh();
    };
  }

  async function openCreditModal(pid, companyId, refresh) {
    if (!ERP.security.enforce("payments.edit", { companyId: companyId })) return;
    const companies = await ERP.companies.optionList();
    const invoices = (await ERP.billing.all(pid, { companyId: companyId })).filter((i) => i.status === "posted");
    const options = [{ value: "", label: "Hold on account" }].concat(invoices.map((i) => ({ value: i.id, label: (i.number || "#" + i.id) + " · " + ui.money(i.balance, i.currency) + " due" })));
    const fields =
      '<div class="erp-form-row">' +
        ui.select("companyId", "Client", companies, companyId) +
        ui.select("invoiceId", "Apply to", options, "") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("amount", "Amount", 0, { min: 0, step: 0.01 }) +
        ui.dateInput("date", "Date", ui.today()) +
      "</div>" +
      ui.text("reason", "Reason", "");
    const modal = ui.modal({
      title: "Issue credit", size: "lg",
      body: ui.form(fields) + '<p class="erp-modal-note">Leave the invoice blank to hold the credit on the client account until it is applied.</p>',
      foot: ui.btn("Cancel", { small: true, act: "pcm-cancel" }) + " " + ui.btn("Issue credit", { small: true, primary: true, act: "pcm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pcm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pcm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["companyId", "invoiceId", "amount", "date", "reason"]);
      btn.disabled = true;
      const res = await P.issueCredit(pid, { companyId: v.companyId, invoiceId: v.invoiceId === "" ? null : v.invoiceId, amount: v.amount, date: v.date, reason: v.reason });
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Credit " + (res.record.number || "") + " issued.", "success"); refresh();
    };
  }

  async function openApplyCreditModal(pid, creditId, refresh) {
    const loc = await P.credit(pid, creditId);
    if (!loc) return;
    const invoices = (await ERP.billing.all(pid, { companyId: loc.companyId })).filter((i) => i.status === "posted" && num(i.balance) > 0.005);
    if (!invoices.length) return ERP.toast("No open posted invoices to apply this credit to.", "warn");
    const modal = ui.modal({
      title: "Apply credit " + (loc.credit.number || ""),
      body: ui.form(ui.select("invoiceId", "Invoice", invoices.map((i) => ({ value: i.id, label: (i.number || "#" + i.id) + " · " + ui.money(i.balance, i.currency) + " due" })), invoices[0].id)),
      foot: ui.btn("Cancel", { small: true, act: "pam-cancel" }) + " " + ui.btn("Apply credit", { small: true, primary: true, act: "pam-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pam-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pam-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["invoiceId"]);
      btn.disabled = true;
      const res = await P.applyCredit(pid, creditId, v.invoiceId);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Credit applied.", "success"); refresh();
    };
  }
})();
