// src/psa/modules/billing.js — invoices, unbilled work and credit notes.
// Invoices are usually generated from a project (approved billable time,
// expenses or completed milestones) via workflow.createInvoice; they can also
// be entered by hand. Publishing to the ledger sends the invoice bundle to
// the shared pipeline; receipts ingested back from the ledger update payment
// status automatically.

import { registerModule, moduleShell, h, el, icon, tabs, toast, modal, confirmModal, moneyFmt, dateFmt, dateShort, numFmt, todayIso } from "../core.js";
import { renderCrud } from "../crud.js";
import store from "../store.js";
import { collectionStatusEl } from "../store-ui.js";
import { snapshot, unbilledTotals, invoiceableItems, invoiceTotals, outstandingOf, projectPaymentState } from "../derive.js";
import { createInvoice, createCreditNote } from "../workflow.js";
import { publishInvoice } from "../pipeline.js";
import hub from "../hub.js";

const TABS = [
  { id: "invoices", label: "Invoices", href: "billing" },
  { id: "unbilled", label: "Unbilled", href: "billing/unbilled" },
  { id: "creditnotes", label: "Credit notes", href: "billing/creditnotes" },
];

function clientOpts() { return store.getAllRecords("clients").map((c) => ({ value: c.id, label: c.name })); }
function projectOpts() { return store.getAllRecords("projects").map((p) => ({ value: p.id, label: p.name })); }
const currencyOpts = ["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => ({ value: c, label: c }));
const invoiceStatuses = ["draft", "sent", "partial", "paid", "void"].map((s) => ({ value: s, label: s }));

const invoiceFields = [
  { key: "projectId", label: "Project", type: "select", options: projectOpts, required: true },
  { key: "clientId", label: "Client", type: "select", options: clientOpts, required: true },
  { key: "number", label: "Invoice number", type: "text", placeholder: "INV-0001 (auto if left blank)" },
  { key: "date", label: "Invoice date", type: "date", defaultToday: true },
  { key: "dueDate", label: "Due date", type: "date" },
  { key: "currency", label: "Currency", type: "select", options: currencyOpts, default: "USD" },
  { key: "status", label: "Status", type: "select", options: invoiceStatuses, default: "draft" },
  { key: "note", label: "Note", type: "textarea" },
];

const invoiceColumns = [
  { key: "number", label: "Invoice", render: (r) => "<strong>" + h(r.number || r.id) + "</strong>" + (r.note ? "<div class='cell-sub'>" + h(r.note) + "</div>" : "") },
  { key: "projectId", label: "Project", render: (r) => { const p = store.getRecord("projects", r.projectId); return h(p ? p.name : "—"); } },
  { key: "clientId", label: "Client", render: (r) => { const c = store.getRecord("clients", r.clientId); return h(c ? c.name : "—"); } },
  { key: "date", label: "Date", render: (r) => h(dateFmt(r.date)) },
  { key: "total", label: "Total", render: (r) => "<strong>" + moneyFmt(r.total, r.currency) + "</strong>" },
  { key: "outstanding", label: "Outstanding", render: (r) => {
      const o = outstandingOf(r, r.payments);
      if (o <= 0.005) return '<span class="badge badge-ok">Paid</span>';
      return "<strong class='outstanding'>" + moneyFmt(o, r.currency) + "</strong>";
    } },
  { key: "status", label: "Status", render: (r) => {
      const map = { draft: "muted", sent: "warn", partial: "accent", paid: "ok", void: "err" };
      return '<span class="badge badge-' + (map[r.status] || "muted") + '\">' + h(r.status) + (r.ledgerBundleId ? " · published" : "") + "</span>";
    } },
];

function invoiceLineText(li) {
  return [li.desc, li.qty, li.rate].join(" | ");
}

function invoiceDerive(rec) {
  const project = store.getRecord("projects", rec.projectId);
  const out = outstandingOf(rec, rec.payments);
  const items = rec.lineItems || [];
  let html = '<div class="derive-grid">' +
    '<div class="derive-stat"><div class="derive-label">Subtotal</div><div class="derive-value">' + moneyFmt(rec.subtotal || 0, rec.currency) + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Tax</div><div class="derive-value">' + moneyFmt(rec.tax || 0, rec.currency) + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Total</div><div class="derive-value">' + moneyFmt(rec.total || 0, rec.currency) + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Paid</div><div class="derive-value">' + moneyFmt((Number(rec.total) || 0) - out, rec.currency) + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Outstanding</div><div class="derive-value">' + moneyFmt(out, rec.currency) + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Line items</div><div class="derive-value">' + items.length + "</div></div>" +
    "</div>";
  if (project) {
    const pay = projectPaymentState(project);
    html += "<p class='dim' style='margin-top:10px'>Project-wide: " + pay.count + " invoice(s) · " + moneyFmt(pay.invoiced, rec.currency) + " invoiced · " + moneyFmt(pay.outstanding, rec.currency) + " outstanding</p>";
  }
  return { html };
}

function invoiceDetailSections(rec) {
  return [
    (r) => {
      const wrap = el("div", "psa-derive");
      const items = r.lineItems || [];
      let html = "<h5>Line items</h5>";
      if (!items.length) html += "<p class='dim'>No line items.</p>";
      else {
        html += '<div class="psa-table-wrap"><table class="psa-table"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>' +
          items.map((li) => "<tr><td>" + h(li.desc) + "</td><td class='num'>" + numFmt(li.qty, 2) + "</td><td class='num'>" + moneyFmt(li.rate, r.currency) + "</td><td class='num'>" + moneyFmt(li.amount, r.currency) + "</td></tr>").join("") +
          "</tbody></table></div>";
      }
      html += "<h5>Payments</h5>";
      const payments = r.payments || [];
      if (!payments.length) html += "<p class='dim'>No payments recorded yet.</p>";
      else {
        html += '<div class="psa-table-wrap"><table class="psa-table"><thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>' +
          payments.map((p) => "<tr><td>" + h(dateFmt(p.date)) + "</td><td>" + h(p.method || "—") + "</td><td class='num'>" + moneyFmt(p.amount, r.currency) + "</td></tr>").join("") +
          "</tbody></table></div>";
      }
      wrap.innerHTML = html;
      return wrap;
    }
  ];
}

function invoiceDetailActions(rec, ctx) {
  const acts = [];
  const out = outstandingOf(rec, rec.payments);
  if (rec.status === "void") return [{ label: "Voided", kind: "btn-ghost", onClick: () => {} }];
  if (rec.status === "draft") {
    acts.push({ label: "Mark sent", icon: "arrow", onClick: async () => {
        const auth = await hub.requireAction("invoice.mark_sent", "marked " + (rec.number || rec.id) + " sent");
        if (!auth.ok) return;
        await store.saveRecord("billing", Object.assign({}, rec, { status: "sent", sentAt: new Date().toISOString() }));
        hub.recordAudit("invoice.mark_sent", "marked " + (rec.number || rec.id) + " sent", auth.actor).catch(() => {});
        toast("Invoice marked sent"); ctx.refresh();
      } });
  }
  if (out > 0.005) {
    acts.push({ label: "Record payment", icon: "check", kind: "btn-primary", onClick: async () => {
        const auth = await hub.requireAction("invoice.record_payment", "payment on " + (rec.number || rec.id));
        if (!auth.ok) return;
        recordPaymentModal(rec, ctx, auth.actor || "local");
      } });
  }
  acts.push({ label: "Publish to ledger", icon: "box", onClick: async () => {
      const auth = await hub.requireAction("pipeline.publish", "published invoice " + (rec.number || rec.id));
      if (!auth.ok) return;
      try {
        const m = await publishInvoice(rec.id);
        hub.recordAudit("pipeline.publish", "published invoice " + (rec.number || rec.id), auth.actor).catch(() => {});
        toast("Invoice published to the ledger (" + m.name.slice(0, 18) + "…)");
        ctx.refresh();
      } catch (e) { toast(e.message || "Publish failed", "err"); }
    } });
  if (out > 0.005) {
    acts.push({ label: "Create credit note", kind: "btn-danger", onClick: async () => {
        const auth = await hub.requireAction("creditnote.issue", "credit note against " + (rec.number || rec.id));
        if (!auth.ok) return;
        creditNoteModal(rec, ctx, auth.actor || "local");
      } });
  }
  if (!(rec.payments || []).length) {
    acts.push({ label: "Void invoice", kind: "btn-ghost", onClick: () => {
        confirmModal({ title: "Void this invoice?", message: "Voiding removes it from unbilled/outstanding calculations. It stays in the ledger of record for audit.", confirmLabel: "Void", danger: true, onConfirm: async () => {
            const auth = await hub.requireAction("invoice.void", "voided " + (rec.number || rec.id));
            if (!auth.ok) return;
            await store.saveRecord("billing", Object.assign({}, rec, { status: "void", voidedAt: new Date().toISOString() }));
            hub.recordAudit("invoice.void", "voided " + (rec.number || rec.id), auth.actor).catch(() => {});
            toast("Invoice voided"); ctx.refresh();
          } });
      } });
  }
  return acts;
}

function recordPaymentModal(inv, ctx, actor) {
  const out = outstandingOf(inv, inv.payments);
  const amt = el("input", "psa-input", ""); amt.type = "number"; amt.value = out; amt.step = "any"; amt.min = 0;
  const dt = el("input", "psa-input", ""); dt.type = "date"; dt.value = todayIso();
  const method = el("select", "psa-input", "");
  for (const m of ["bank", "card", "check", "cash", "other"]) { const o = el("option", "", h(m)); method.appendChild(o); }
  const form = el("div", "psa-form");
  form.appendChild(el("label", "psa-field-label", "Amount")); form.appendChild(amt);
  form.appendChild(el("label", "psa-field-label", "Payment date")); form.appendChild(dt);
  form.appendChild(el("label", "psa-field-label", "Method")); form.appendChild(method);
  modal({
    title: "Record payment — " + (inv.number || inv.id),
    body: form,
    actions: [
      { label: "Cancel" },
      { label: "Record payment", kind: "btn-primary", onClick: async (btn) => {
          const amount = Number(amt.value) || 0;
          if (amount <= 0) { toast("Enter a positive amount", "err"); return; }
          if (amount > out + 0.005) { toast("Amount exceeds the outstanding balance (" + moneyFmt(out, inv.currency) + ")", "err"); return; }
          btn.disabled = true;
          const payments = (inv.payments || []).concat([{ id: "pay-" + Math.random().toString(36).slice(2, 10), date: dt.value, amount, method: method.value, recordedAt: new Date().toISOString() }]);
          const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const next = Object.assign({}, inv, { payments });
          next.status = paid >= (Number(inv.total) || 0) - 0.005 ? "paid" : "partial";
          await store.saveRecord("billing", next);
          hub.recordAudit("invoice.record_payment", "payment of " + moneyFmt(amount, inv.currency) + " on " + (inv.number || inv.id), actor).catch(() => {});
          toast("Payment recorded — " + moneyFmt(amount, inv.currency));
          btn.closest(".psa-modal-overlay").remove();
          ctx.refresh();
        } }
    ]
  });
}

function creditNoteModal(inv, ctx, actor) {
  const out = outstandingOf(inv, inv.payments);
  const amt = el("input", "psa-input", ""); amt.type = "number"; amt.value = out; amt.step = "any"; amt.min = 0;
  const reason = el("input", "psa-input", ""); reason.placeholder = "Required — e.g. incorrect rate, scope removed…";
  const form = el("div", "psa-form");
  form.appendChild(el("label", "psa-field-label", "Amount (max " + moneyFmt(out, inv.currency) + ")")); form.appendChild(amt);
  form.appendChild(el("label", "psa-field-label", "Reason")); form.appendChild(reason);
  modal({
    title: "Credit note against " + (inv.number || inv.id),
    body: form,
    actions: [
      { label: "Cancel" },
      { label: "Issue credit note", kind: "btn-primary", onClick: async (btn) => {
          if (!reason.value.trim()) { toast("A reason is required for a credit note", "err"); return; }
          btn.disabled = true;
          try {
            await createCreditNote(inv, Number(amt.value) || 0, reason.value.trim(), "local");
            hub.recordAudit("creditnote.issue", "credit note " + moneyFmt(Number(amt.value) || 0, inv.currency) + " against " + (inv.number || inv.id) + " — " + reason.value.trim(), actor).catch(() => {});
            toast("Credit note issued");
            btn.closest(".psa-modal-overlay").remove();
            ctx.refresh();
          } catch (e) { toast(e.message || "Could not issue credit note", "err"); btn.disabled = false; }
        } }
    ]
  });
}

function generateInvoiceModal(refreshAll) {
  const projSel = el("select", "psa-input", "");
  projSel.appendChild(el("option", "", h("Select a project…")));
  for (const p of store.getAllRecords("projects").filter((p) => p.status !== "closed").sort((a, b) => a.name.localeCompare(b.name))) {
    const o = el("option", "", h(p.name));
    o.value = p.id;
    projSel.appendChild(o);
  }
  const dt = el("input", "psa-input", ""); dt.type = "date"; dt.value = todayIso();
  const status = el("select", "psa-input", "");
  for (const s of ["draft", "sent"]) { const o = el("option", "", h(s)); status.appendChild(o); }
  const preview = el("p", "psa-preview-note", h("Select a project to preview what will be invoiced."));
  const form = el("div", "psa-form");
  form.appendChild(el("label", "psa-field-label", "Project")); form.appendChild(projSel);
  form.appendChild(el("label", "psa-field-label", "Invoice date")); form.appendChild(dt);
  form.appendChild(el("label", "psa-field-label", "Status")); form.appendChild(status);
  form.appendChild(preview);
  projSel.addEventListener("change", () => {
    const p = store.getRecord("projects", projSel.value);
    if (!p) { preview.textContent = "Select a project to preview what will be invoiced."; return; }
    const invItems = invoiceableItems(p);
    const totals = invoiceTotals(p, invItems.items);
    preview.textContent = invItems.note || (invItems.type === "tm" ? invItems.items.length + " line item(s) — " : "") + moneyFmt(totals.total, p.currency || "USD") + " (incl. tax)";
    preview.innerHTML = "<strong>" + (invItems.note ? "No invoiceable items — " + h(invItems.note) : h(invItems.items.length + " line item" + (invItems.items.length === 1 ? "" : "s"))) + "</strong><br><span class='dim'>" + moneyFmt(totals.subtotal, p.currency || "USD") + " + " + moneyFmt(totals.tax, p.currency || "USD") + " tax</span>";
  });
  modal({
    title: "Generate invoice from project",
    body: form,
    wide: true,
    actions: [
      { label: "Cancel" },
      { label: "Generate invoice", kind: "btn-primary", onClick: async (btn) => {
          const p = store.getRecord("projects", projSel.value);
          if (!p) { toast("Choose a project", "err"); return; }
          btn.disabled = true;
          try {
            const auth = await hub.requireAction("invoice.create", "generated invoice for " + p.name);
            if (!auth.ok) { btn.disabled = false; return; }
            const inv = await createInvoice(p, { date: dt.value, status: status.value });
            hub.recordAudit("invoice.create", "generated " + (inv.number || inv.id) + " for " + p.name, auth.actor).catch(() => {});
            toast("Invoice " + (inv.number || inv.id) + " generated");
            btn.closest(".psa-modal-overlay").remove();
            refreshAll();
          } catch (e) { toast(e.message || "Could not generate invoice", "err"); btn.disabled = false; }
        } }
    ]
  });
}

let refreshInvoices = () => {};
let refreshCreditNotes = () => {};

async function renderInvoicesTab(sec) {
  const host = el("div", "psa-list");
  sec.appendChild(host);
  await renderCrud(host, {
    collection: "billing",
    moduleId: "billing",
    title: "Invoices",
    subtitle: "Generated from approved billable time, expenses or completed milestones — or entered by hand. Published invoices flow to the ledger and payments come back as receipts.",
    singular: "Invoice",
    newLabel: "Manual invoice",
    toolbar: [{ label: "Generate from project…", icon: "plus", kind: "btn-primary", onClick: () => generateInvoiceModal(refreshInvoices) }],
    columns: invoiceColumns,
    fields: invoiceFields,
    searchKeys: ["number", "note"],
    sortBy: (a, b) => (b.date || "").localeCompare(a.date || ""),
    filter: (r) => r.kind === "invoice",
    derive: invoiceDerive,
    detailActions: invoiceDetailActions,
    detailSections: invoiceDetailSections,
    onReady: (rf) => { refreshInvoices = rf; },
    afterOpen: (form, getValue, rec) => {
      const ta = el("textarea", "psa-input", "");
      ta.dataset.field = "lineItemsText";
      ta.rows = 5;
      ta.value = (rec && rec.lineItems || []).map(invoiceLineText).join("\n");
      ta.placeholder = "desc | qty | rate";
      const row = el("div", "psa-field");
      row.appendChild(el("label", "psa-field-label", "Line items (desc | qty | rate)"));
      row.appendChild(ta);
      form.appendChild(row);
    },
    onBeforeSave: (v, rec) => {
      v.kind = "invoice";
      const ta = document.querySelector('.psa-modal-overlay:last-of-type [data-field="lineItemsText"]');
      const lines = ta ? ta.value.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => s.split("|").map((x) => x.trim())) : [];
      const project = store.getRecord("projects", v.projectId);
      const oldItems = (rec && rec.lineItems) || [];
      v.lineItems = lines.map((l) => {
        const desc = l[0] || ""; const qty = Number(l[1]) || 0; const rate = Number(l[2]) || 0;
        const old = oldItems.find((o) => o.desc === desc);
        return { id: (old && old.id) || "li-" + Math.random().toString(36).slice(2, 8), desc, qty, rate, amount: qty * rate, refs: (old && old.refs) || [] };
      });
      const sub = v.lineItems.reduce((s, x) => s + (x.amount || 0), 0);
      const tax = sub * ((project && project.taxRate) ? Number(project.taxRate) : 0) / 100;
      v.subtotal = sub; v.tax = tax; v.total = sub + tax;
      if (!v.currency) v.currency = (project && project.currency) || "USD";
      if (!v.number || v.number === "INV-") {
        const seq = store.getAllRecords("billing").filter((b) => b.kind === "invoice").length + 1;
        v.number = "INV-" + String(seq).padStart(4, "0");
      }
      if (!v.payments) v.payments = [];
    },
    emptyState: { title: "No invoices yet", message: "Generate an invoice from a project (approved billable time, expenses or milestones) or enter one manually.", action: { label: "Generate invoice", onClick: () => generateInvoiceModal(refreshInvoices) } },
  });
}

async function renderUnbilledTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Unbilled work")));
  sec.appendChild(head);
  const host = el("div", "psa-list");
  sec.appendChild(host);
  function render() {
    const D = snapshot();
    const projects = D.projects.filter((p) => p.status !== "closed").sort((a, b) => a.name.localeCompare(b.name));
    host.innerHTML = "";
    if (!projects.length) {
      host.appendChild(el("p", "dim", h("No active projects — nothing to invoice yet.")));
      return;
    }
    const headRow = el("div", "psa-row psa-row-head");
    for (const label of ["Project", "Unbilled hours", "Time value", "Expense value", "Total unbilled", ""]) headRow.appendChild(el("div", "psa-cell", h(label)));
    host.appendChild(headRow);
    let totalHours = 0, totalValue = 0;
    for (const p of projects) {
      const u = unbilledTotals(p, D);
      if (u.hours <= 0 && u.expenseValue <= 0) continue;
      totalHours += u.hours; totalValue += u.revenue;
      const row = el("div", "psa-row");
      row.innerHTML = "<div class='psa-cell'><strong>" + h(p.name) + "</strong><div class='cell-sub'>" + h(store.getRecord("clients", p.clientId) ? store.getRecord("clients", p.clientId).name : "—") + " · " + h(p.billingMethod || "tm") + "</div></div>" +
        "<div class='psa-cell'>" + numFmt(u.hours) + "h (" + u.timeCount + " entr" + (u.timeCount === 1 ? "y" : "ies") + ")</div>" +
        "<div class='psa-cell'>" + moneyFmt(u.timeValue, p.currency || "USD") + "</div>" +
        "<div class='psa-cell'>" + moneyFmt(u.expenseValue, p.currency || "USD") + " (" + u.expenseCount + ")</div>" +
        "<div class='psa-cell'><strong>" + moneyFmt(u.revenue, p.currency || "USD") + "</strong></div>";
      const cell = el("div", "psa-cell");
      const btn = el("button", "btn btn-primary btn-sm", "Invoice now");
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const auth = await hub.requireAction("invoice.create", "generated invoice for " + p.name);
          if (!auth.ok) return;
          const inv = await createInvoice(p, {});
          hub.recordAudit("invoice.create", "generated " + (inv.number || inv.id) + " for " + p.name, auth.actor).catch(() => {});
          toast("Invoice " + (inv.number || inv.id) + " generated");
          render();
        } catch (e2) { toast(e2.message || "Nothing to invoice", "err"); }
      });
      cell.appendChild(btn);
      row.appendChild(cell);
      host.appendChild(row);
    }
    const foot = el("div", "psa-row psa-row-total");
    foot.innerHTML = "<div class='psa-cell'>Total unbilled</div><div class='psa-cell'>" + numFmt(totalHours) + "h</div><div class='psa-cell'></div><div class='psa-cell'></div><div class='psa-cell'><strong>" + moneyFmt(totalValue, "USD") + "</strong></div><div class='psa-cell'></div>";
    host.appendChild(foot);
  }
  render();
}

const creditNoteFields = [
  { key: "invoiceId", label: "Invoice", type: "select", options: () => store.getAllRecords("billing").filter((b) => b.kind === "invoice" && b.status !== "void").map((b) => ({ value: b.id, label: (b.number || b.id) + " — " + moneyFmt(b.total, b.currency) })), required: true },
  { key: "amount", label: "Amount", type: "money", required: true },
  { key: "reason", label: "Reason", type: "textarea", required: true, placeholder: "Why this credit note is being issued…" },
  { key: "date", label: "Date", type: "date", defaultToday: true },
  { key: "status", label: "Status", type: "select", options: ["applied", "draft"].map((s) => ({ value: s, label: s })), default: "applied" },
];

const creditNoteColumns = [
  { key: "number", label: "Credit note", render: (r) => "<strong>" + h(r.number || r.id) + "</strong>" },
  { key: "invoiceId", label: "Against", render: (r) => { const i = store.getRecord("billing", r.invoiceId); return h(i ? (i.number || i.id) : "—"); } },
  { key: "amount", label: "Amount", render: (r) => "<strong>" + moneyFmt(r.amount, r.currency || "USD") + "</strong>" },
  { key: "reason", label: "Reason", render: (r) => h(r.reason || "—") },
  { key: "date", label: "Date", render: (r) => h(dateFmt(r.date)) },
  { key: "status", label: "Status", render: (r) => '<span class="badge badge-' + (r.status === "applied" ? "ok" : "muted") + '\">' + h(r.status) + "</span>" },
];

async function renderCreditNotesTab(sec) {
  const host = el("div", "psa-list");
  sec.appendChild(host);
  await renderCrud(host, {
    collection: "billing",
    moduleId: "billing",
    title: "Credit notes",
    subtitle: "Full or partial credit against a PSA invoice, always with a required reason. Issuing one reduces the invoice's outstanding balance.",
    singular: "Credit note",
    newLabel: "Manual credit note",
    toolbar: [{ label: "Issue against invoice…", icon: "plus", kind: "btn-primary", onClick: () => issueCreditNoteModal(refreshCreditNotes) }],
    columns: creditNoteColumns,
    fields: creditNoteFields,
    searchKeys: ["number", "reason"],
    sortBy: (a, b) => (b.date || "").localeCompare(a.date || ""),
    filter: (r) => r.kind === "creditnote",
    onReady: (rf) => { refreshCreditNotes = rf; },
    onBeforeSave: (v) => {
      v.kind = "creditnote";
      const inv = store.getRecord("billing", v.invoiceId);
      if (inv) { v.projectId = inv.projectId; v.clientId = inv.clientId; v.currency = inv.currency; }
      if (!v.number) {
        const seq = store.getAllRecords("billing").filter((b) => b.kind === "creditnote").length + 1;
        v.number = "CN-" + String(seq).padStart(4, "0");
      }
    },
    validate: (v) => {
      const inv = store.getRecord("billing", v.invoiceId);
      if (inv) {
        const out = outstandingOf(inv, inv.payments);
        if ((Number(v.amount) || 0) > out + 0.005) return "Amount exceeds the invoice's outstanding balance (" + moneyFmt(out, inv.currency) + ").";
      }
      return null;
    },
    emptyState: { title: "No credit notes yet", message: "Issue a credit note from an invoice (full or partial, with a reason) to correct or reverse billing.", action: { label: "Issue credit note", onClick: () => issueCreditNoteModal(refreshCreditNotes) } },
  });
}

function issueCreditNoteModal(refreshAll) {
  const invSel = el("select", "psa-input", "");
  invSel.appendChild(el("option", "", h("Select an invoice…")));
  for (const b of store.getAllRecords("billing").filter((x) => x.kind === "invoice" && x.status !== "void").sort((a, b) => (b.date || "").localeCompare(a.date || ""))) {
    const o = el("option", "", h((b.number || b.id) + " — " + moneyFmt(b.total, b.currency)));
    o.value = b.id;
    invSel.appendChild(o);
  }
  const amt = el("input", "psa-input", ""); amt.type = "number"; amt.step = "any"; amt.min = 0;
  const reason = el("input", "psa-input", ""); reason.placeholder = "Required reason…";
  const form = el("div", "psa-form");
  form.appendChild(el("label", "psa-field-label", "Invoice")); form.appendChild(invSel);
  form.appendChild(el("label", "psa-field-label", "Amount")); form.appendChild(amt);
  form.appendChild(el("label", "psa-field-label", "Reason")); form.appendChild(reason);
  invSel.addEventListener("change", () => {
    const inv = store.getRecord("billing", invSel.value);
    if (inv) amt.value = outstandingOf(inv, inv.payments).toFixed(2);
  });
  modal({
    title: "Issue credit note",
    body: form,
    actions: [
      { label: "Cancel" },
      { label: "Issue", kind: "btn-primary", onClick: async (btn) => {
          if (!reason.value.trim()) { toast("A reason is required", "err"); return; }
          const inv = store.getRecord("billing", invSel.value);
          if (!inv) { toast("Choose an invoice", "err"); return; }
          btn.disabled = true;
          try {
            const auth = await hub.requireAction("creditnote.issue", "credit note against " + (inv.number || inv.id));
            if (!auth.ok) { btn.disabled = false; return; }
            await createCreditNote(inv, Number(amt.value) || 0, reason.value.trim(), auth.actor || "local");
            hub.recordAudit("creditnote.issue", "credit note " + moneyFmt(Number(amt.value) || 0, inv.currency) + " against " + (inv.number || inv.id) + " — " + reason.value.trim(), auth.actor).catch(() => {});
            toast("Credit note issued");
            btn.closest(".psa-modal-overlay").remove();
            if (refreshAll) refreshAll();
          } catch (e) { toast(e.message || "Could not issue", "err"); btn.disabled = false; }
        } }
    ]
  });
}

registerModule({
  id: "billing",
  label: "Billing",
  icon: "billing",
  async render({ view, route }) {
    const active = route.parts[0] || "billing";
    const sec = moduleShell("billing");
    sec.appendChild(tabs(active, TABS));
    if (active === "billing") await renderInvoicesTab(sec);
    else if (active === "unbilled") await renderUnbilledTab(sec);
    else if (active === "creditnotes") await renderCreditNotesTab(sec);
    else await renderInvoicesTab(sec);
    sec.appendChild(await collectionStatusEl("billing"));
    view.appendChild(sec);
  }
});
