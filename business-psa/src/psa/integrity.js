// src/psa/integrity.js — automated data-integrity checks (task 37). Every check
// produces {severity, module, message, refs}; the summary drives a visible
// system-health indicator on the dashboard and settings, and the checks re-run
// after every write (see main.js onChange hook).

import store from "./store.js";
import { snapshot, byId, unbilledItems, invoiceableItems, appSettings } from "./derive.js";

export function runChecks(D) {
  const d = D || snapshot();
  const issues = [];
  const warn = (module, message, refs = [], severity = "warn") => issues.push({ severity, module, message, refs });

  const projects = byId(d.projects);
  const resources = byId(d.resources);
  const clients = byId(d.clients);
  const sows = byId(d.sows);
  const tasks = byId(d.workplans);

  for (const t of d.timesheets) {
    if (!projects[t.projectId]) warn("timesheets", "Timesheet “" + (t.id || "?") + "” references a project that doesn't exist.", [t.id], "err");
    if (!resources[t.resourceId]) warn("timesheets", "Timesheet “" + (t.id || "?") + "” references a resource that doesn't exist.", [t.id], "err");
    if (t.taskId && !tasks[t.taskId]) warn("timesheets", "Timesheet “" + (t.id || "?") + "” references a work-plan task that doesn't exist.", [t.id], "err");
    if ((t.hours || 0) <= 0 || (t.hours || 0) > 24) warn("timesheets", "Timesheet “" + (t.id || "?") + "” has implausible hours (" + t.hours + ").", [t.id]);
    if (t.billable && t.status === "submitted" && !t.approvedAt) { /* fine, pending approval */ }
    if (t.status === "approved" && !t.approvedAt) warn("timesheets", "Timesheet “" + (t.id || "?") + "” is approved but has no approval timestamp.", [t.id], "err");
  }

  for (const e of d.expenses) {
    if (!projects[e.projectId]) warn("expenses", "Expense “" + (e.id || "?") + "” references a project that doesn't exist.", [e.id], "err");
    if ((e.amount || 0) <= 0) warn("expenses", "Expense “" + (e.id || "?") + "” has a non-positive amount.", [e.id]);
    if (e.locked && e.postedToInvoiceId) {
      const inv = d.billing.find((b) => b.id === e.postedToInvoiceId);
      if (!inv || inv.status === "void") warn("expenses", "Expense “" + (e.id || "?") + "” is locked to an invoice that no longer exists.", [e.id], "err");
    }
  }

  const s = appSettings();
  for (const a of d.allocations) {
    if (!resources[a.resourceId]) warn("allocations", "Allocation “" + (a.id || "?") + "” references a resource that doesn't exist.", [a.id], "err");
    if (!projects[a.projectId]) warn("allocations", "Allocation “" + (a.id || "?") + "” references a project that doesn't exist.", [a.id], "err");
    if (a.taskId && !tasks[a.taskId]) warn("allocations", "Allocation “" + (a.id || "?") + "” references a task that doesn't exist.", [a.id], "err");
    if ((a.hoursPerWeek || 0) > 80) warn("allocations", "Allocation “" + (a.id || "?") + "” exceeds 80 booked hours/week (" + a.hoursPerWeek + ").", [a.id]);
    if ((a.hoursPerWeek || 0) > 40 + s.overAllocTolerance && !a.override) {
      warn("allocations", "Allocation “" + (a.id || "?") + "” exceeds capacity with no recorded override.", [a.id]);
    }
  }

  for (const p of d.projects) {
    if (!clients[p.clientId]) warn("projects", "Project “" + (p.name || p.id) + "” has no valid client.", [p.id], "err");
    if (p.sowId && !sows[p.sowId]) warn("projects", "Project “" + (p.name || p.id) + "” references a SOW that doesn't exist.", [p.id]);
    const bva = (() => { try { return null; } catch (e) { return null; } })();
    if (Number.isNaN(Number(p.budgetHours)) && p.budgetHours != null) warn("projects", "Project “" + (p.name || p.id) + "” has a non-numeric budget.", [p.id]);
    for (const m of p.milestones || []) {
      if (m.status === "done" && !m.completedAt) warn("projects", "Milestone “" + (m.title || m.id) + "” on “" + (p.name || p.id) + "” is done but has no completion date.", [p.id]);
    }
  }

  const invoiced = new Set();
  for (const inv of d.billing) {
    if (inv.kind !== "invoice") continue;
    if (inv.status === "void") continue;
    if (!projects[inv.projectId]) warn("billing", "Invoice “" + (inv.number || inv.id) + "” references a missing project.", [inv.id], "err");
    if (inv.status === "paid" && !(inv.payments || []).length && (inv.payments || []).length === 0 && inv.total > 0) {
      warn("billing", "Invoice “" + (inv.number || inv.id) + "” is marked paid but has no recorded payment.", [inv.id]);
    }
    for (const li of inv.lineItems || []) {
      for (const ref of li.refs || []) {
        invoiced.add(ref.type + ":" + ref.id);
        if (ref.type === "timesheet") {
          const t = d.timesheets.find((x) => x.id === ref.id);
          if (!t) warn("billing", "Invoice “" + (inv.number || inv.id) + "” invoices a timesheet that doesn't exist.", [inv.id, ref.id], "err");
          else if (!t.approvedAt && t.status !== "approved") {
            warn("billing", "Invoice “" + (inv.number || inv.id) + "” is generated from UNapproved time (timesheet " + ref.id + ").", [inv.id, ref.id], "err");
          }
        }
        if (ref.type === "expense") {
          const e = d.expenses.find((x) => x.id === ref.id);
          if (!e) warn("billing", "Invoice “" + (inv.number || inv.id) + "” invoices an expense that doesn't exist.", [inv.id, ref.id], "err");
        }
      }
    }
  }

  for (const p of d.projects) {
    const u = unbilledItems(p, d);
    for (const t of u.time) {
      if (invoiced.has("timesheet:" + t.id)) warn("billing", "Approved time “" + t.id + "” appears both unbilled and invoiced.", [p.id, t.id], "err");
    }
  }

  for (const o of d.opportunities) {
    if (o.convertedToSowId && !sows[o.convertedToSowId]) warn("pipeline", "Opportunity “" + (o.title || o.id) + "” points at a missing SOW.", [o.id]);
  }

  for (const w of d.workplans) {
    if (!projects[w.projectId]) warn("workplans", "Task “" + (w.name || w.id) + "” references a missing project.", [w.id], "err");
  }

  return issues;
}

export function healthSummary(issues) {
  const bySeverity = { ok: 0, warn: 0, err: 0 };
  for (const i of issues) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
  const ok = issues.length === 0 || bySeverity.err === 0;
  return {
    checkedAt: new Date().toISOString(),
    total: issues.length,
    errors: bySeverity.err,
    warnings: bySeverity.warn,
    ok,
    grade: bySeverity.err > 0 ? "errors" : bySeverity.warn > 0 ? "warnings" : "all-clear",
  };
}

export async function runChecksAndCache() {
  const issues = runChecks();
  const summary = healthSummary(issues);
  window.__psaHealth = { issues, summary };
  return { issues, summary };
}
