// src/psa/workflow.js — the business-rule chains that keep records consistent:
// SOW approval seeds a project, template application builds a work plan,
// scope-change approval moves budget/schedule, timesheet approvals stamp actors,
// and invoice generation locks what it bills. The round-trip fixture suite
// exercises these end to end.

import store from "./store.js";
import { toast, todayIso } from "./core.js";
import { unbilledItems, invoiceableItems, invoiceTotals, defaultCurrency } from "./derive.js";

export function uid(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

// ---- SOW approval (task 9) ----

export async function approveSow(sow, actor) {
  const now = new Date().toISOString();
  const next = Object.assign({}, sow, {
    status: "approved",
    approvedAt: now,
    approvedBy: actor || "local",
    revision: (sow.revision || 0) + 1,
  });
  await store.saveRecord("sows", next);
  const seeded = await seedProjectFromSow(next, actor);
  return { sow: next, project: seeded };
}

export async function seedProjectFromSow(sow, actor) {
  const existing = store.getAllRecords("projects").find((p) => p.sowId === sow.id);
  if (existing) return existing;
  const project = {
    id: uid("proj"),
    clientId: sow.clientId,
    sowId: sow.id,
    name: sow.name,
    code: (sow.number || sow.id).toUpperCase(),
    status: "planning",
    billingMethod: sow.pricingModel === "fixed" ? "fixed" : sow.pricingModel === "milestone" ? "milestone" : "tm",
    plannedStart: sow.startDate || todayIso(),
    plannedEnd: sow.endDate || null,
    budgetHours: Number(sow.budgetHours) || 0,
    budgetCost: 0,
    budgetValue: Number(sow.budgetValue) || 0,
    taxRate: sow.taxRate || 0,
    milestones: (sow.milestones || []).map((m, i) => ({
      id: "ms-" + (i + 1),
      title: typeof m === "string" ? m : m.title,
      value: typeof m === "string" ? 0 : Number(m.value) || 0,
      dueDate: typeof m === "string" ? null : (m.dueDate || null),
      status: "pending",
    })),
    scope: sow.scope || "",
    createdAt: new Date().toISOString(),
    createdBy: actor || "local",
  };
  await store.saveRecord("projects", project);
  return project;
}

// ---- project templates (task 13) ----

export async function createProjectFromTemplate(template, opts = {}) {
  const project = {
    id: uid("proj"),
    clientId: opts.clientId || null,
    sowId: opts.sowId || null,
    name: opts.name || template.name,
    code: opts.code || template.name.toUpperCase().replace(/\s+/g, "-").slice(0, 20),
    status: "planning",
    billingMethod: template.billingMethod || "tm",
    plannedStart: opts.start || todayIso(),
    plannedEnd: template.durationDays ? addDaysIso(opts.start || todayIso(), template.durationDays) : null,
    budgetHours: Number(template.budgetHours) || 0,
    budgetCost: 0,
    budgetValue: Number(template.budgetValue) || 0,
    phases: (template.phases || []).map((p, i) => ({ id: "ph-" + (i + 1), name: p, order: i, status: "pending" })),
    milestones: (template.milestones || []).map((m, i) => ({
      id: "ms-" + (i + 1), title: m.title || "Milestone " + (i + 1), value: Number(m.value) || 0, dueDate: m.dueDate || null, status: "pending",
    })),
    createdAt: new Date().toISOString(),
    createdFromTemplate: template.id,
  };
  await store.saveRecord("projects", project);
  for (const t of template.tasks || []) {
    const task = {
      id: uid("task"),
      projectId: project.id,
      name: t.name,
      role: t.role || null,
      requiredSkills: t.requiredSkills || [],
      effortHours: Number(t.effortHours) || 0,
      plannedStart: addDaysIso(project.plannedStart, Number(t.startOffset) || 0),
      plannedEnd: null,
      dependsOn: [],
      status: "notstarted",
      phase: t.phase || null,
      order: t.order || 0,
    };
    await store.saveRecord("workplans", task);
  }
  return project;
}

function addDaysIso(iso, days) {
  const dt = new Date(iso + "T00:00:00");
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// ---- scope changes (task 14) ----

export async function applyScopeChange(change, actor) {
  if (change.status !== "approved") throw new Error("Only approved changes can be applied.");
  const project = store.getRecord("projects", change.projectId);
  if (!project) throw new Error("Project not found.");
  const next = Object.assign({}, project, {
    budgetHours: Math.max(0, (Number(project.budgetHours) || 0) + (Number(change.impactHours) || 0)),
    budgetValue: Math.max(0, (Number(project.budgetValue) || 0) + (Number(change.impactValue) || 0)),
    plannedEnd: change.impactEndDate || project.plannedEnd,
  });
  if (next.budgetCost != null && Number.isFinite(next.budgetCost)) {
    next.budgetCost = Math.max(0, (Number(project.budgetCost) || 0) + (Number(change.impactCost) || 0));
  }
  await store.saveRecord("projects", next);
  if (change.sowId) {
    const sow = store.getRecord("sows", change.sowId);
    if (sow) {
      const history = sow.revisionHistory || [];
      history.push({
        at: new Date().toISOString(),
        by: actor || "local",
        changeId: change.id,
        impactHours: Number(change.impactHours) || 0,
        impactValue: Number(change.impactValue) || 0,
        note: change.title || "Scope change",
      });
      await store.saveRecord("sows", Object.assign({}, sow, {
        revision: (sow.revision || 0) + 1,
        revisionHistory: history,
        budgetHours: Math.max(0, (Number(sow.budgetHours) || 0) + (Number(change.impactHours) || 0)),
        budgetValue: Math.max(0, (Number(sow.budgetValue) || 0) + (Number(change.impactValue) || 0)),
      }));
    }
  }
  return next;
}

// ---- timesheet approvals (task 21) ----

export async function setTimesheetStatus(entry, status, actor, comment) {
  const now = new Date().toISOString();
  const next = Object.assign({}, entry, { status });
  if (status === "submitted") { next.submittedAt = next.submittedAt || now; next.submittedBy = actor || "local"; }
  if (status === "approved") { next.approvedAt = now; next.approvedBy = actor || "local"; next.approveComment = comment || next.approveComment; }
  if (status === "rejected") { next.rejectedAt = now; next.rejectedBy = actor || "local"; next.approveComment = comment || ""; }
  if (status === "returned") { next.returnedAt = now; next.returnedBy = actor || "local"; next.approveComment = comment || ""; }
  await store.saveRecord("timesheets", next);
  return next;
}

export async function submitTimesheet(entry, actor) {
  return setTimesheetStatus(entry, "submitted", actor);
}

// ---- invoice generation (task 27) ----

export async function createInvoice(project, opts = {}) {
  const invItems = invoiceableItems(project);
  if (opts.items) {
    invItems.items = opts.items;
    invItems.type = project.billingMethod || "tm";
  }
  if (!invItems.items.length) {
    throw new Error(invItems.note || "Nothing to invoice for this project yet (no approved billable time/expenses or completed milestones).");
  }
  const totals = invoiceTotals(project, invItems.items);
  const seq = store.getAllRecords("billing").filter((b) => b.kind === "invoice").length + 1;
  const now = new Date().toISOString();
  const invoice = {
    id: uid("inv"),
    kind: "invoice",
    number: "INV-" + String(seq).padStart(4, "0"),
    projectId: project.id,
    clientId: project.clientId,
    billingMethod: invItems.type,
    amountType: invItems.type === "fixed" ? "fixed" : invItems.type === "milestone" ? "milestone" : "tm",
    currency: defaultCurrency(),
    date: opts.date || todayIso(),
    dueDate: opts.dueDate || null,
    lineItems: invItems.items.map((it, i) => ({
      id: "li-" + (i + 1),
      desc: it.desc,
      qty: it.qty,
      rate: it.rate,
      amount: it.amount,
      refs: it.ref ? [it.ref] : (it.milestoneId ? [{ type: "milestone", id: it.milestoneId }] : []),
    })),
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    status: opts.status || "draft",
    payments: [],
    createdAt: now,
    updatedAt: now,
  };
  await store.saveRecord("billing", invoice);
  for (const li of invoice.lineItems) {
    for (const ref of li.refs || []) {
      if (ref.type === "expense") {
        const e = store.getRecord("expenses", ref.id);
        if (e) {
          await store.saveRecord("expenses", Object.assign({}, e, { status: "posted", locked: true, postedToInvoiceId: invoice.id, postedAt: now }));
        }
      }
      if (ref.type === "timesheet") {
        const t = store.getRecord("timesheets", ref.id);
        if (t) await store.saveRecord("timesheets", Object.assign({}, t, { invoicedAt: now, invoiceId: invoice.id }));
      }
    }
  }
  return invoice;
}

// ---- credit notes (task 28) ----

export async function createCreditNote(invoice, amount, reason, actor) {
  const outstanding = Number(invoice.total) - (invoice.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const requested = Number(amount) || 0;
  if (requested <= 0 || requested > outstanding) throw new Error("Credit note amount must be positive and no more than the outstanding balance.");
  const amt = requested;
  const seq = store.getAllRecords("billing").filter((b) => b.kind === "creditnote").length + 1;
  const cn = {
    id: uid("cn"),
    kind: "creditnote",
    number: "CN-" + String(seq).padStart(4, "0"),
    invoiceId: invoice.id,
    projectId: invoice.projectId,
    clientId: invoice.clientId,
    amount: amt,
    reason: reason || "Correction",
    date: todayIso(),
    status: "applied",
    appliedAt: new Date().toISOString(),
    appliedBy: actor || "local",
    createdAt: new Date().toISOString(),
  };
  await store.saveRecord("billing", cn);
  return cn;
}
