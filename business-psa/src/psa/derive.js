// src/psa/derive.js — the "master core": every derived number in the PSA is
// computed here from raw records + rate cards. Nothing is hand-entered twice:
// actuals, profitability, utilization, health, forecast, unbilled and
// invoice-able quantities all flow from these functions so budget comparisons,
// billing and reporting stay consistent.

import store from "./store.js";
import { todayIso, daysBetween, isoDay, addDays } from "./core.js";

const W = 40;

export function snapshot() {
  const s = {
    clients: store.getAllRecords("clients"),
    catalog: store.getAllRecords("catalog"),
    ratecards: store.getAllRecords("ratecards"),
    sows: store.getAllRecords("sows"),
    projects: store.getAllRecords("projects"),
    workplans: store.getAllRecords("workplans"),
    scopechanges: store.getAllRecords("scopechanges"),
    resources: store.getAllRecords("resources"),
    allocations: store.getAllRecords("allocations"),
    timesheets: store.getAllRecords("timesheets"),
    expenses: store.getAllRecords("expenses"),
    billing: store.getAllRecords("billing"),
    opportunities: store.getAllRecords("opportunities"),
    archive: store.getAllRecords("archive"),
  };
  s.clientsById = byId(s.clients);
  s.projectsById = byId(s.projects);
  s.resourcesById = byId(s.resources);
  s.sowsById = byId(s.sows);
  return s;
}

export const byId = (list) => {
  const m = {};
  for (const r of list) m[r.id] = r;
  return m;
};

export const clientOf = (d, project) => (project ? d.clientsById[project.clientId] : null);
export const projectOf = (d, projectId) => d.projectsById[projectId] || null;
export const resourceOf = (d, resourceId) => d.resourcesById[resourceId] || null;
export const sowOf = (d, sowId) => d.sowsById[sowId] || null;

export function defaultCurrency() {
  return (window.root && window.root.psa && window.root.psa.defaultCurrency) || "USD";
}

export function appSettings() {
  const s = (window.__psaSettings || {});
  return {
    overAllocTolerance: s.overAllocTolerance == null ? 0 : Number(s.overAllocTolerance),
    targetUtilization: s.targetUtilization == null ? 0.8 : Number(s.targetUtilization),
    weekHours: s.weekHours == null ? W : Number(s.weekHours),
    currency: s.currency || defaultCurrency(),
  };
}

export function weekStartIso(iso, weekStartsOn = 1) {
  const dt = new Date((iso || todayIso()) + "T00:00:00");
  const d = (dt.getDay() - weekStartsOn + 7) % 7;
  dt.setDate(dt.getDate() - d);
  return isoDay(dt);
}

export function weekEndIso(iso, weekStartsOn = 1) {
  return addDays(weekStartIso(iso, weekStartsOn), 6);
}

export function weeksBetween(startIso, endIso, weekStartsOn = 1) {
  const out = [];
  let ws = weekStartIso(startIso, weekStartsOn);
  const endWs = weekStartIso(endIso, weekStartsOn);
  while (ws <= endWs) {
    out.push(ws);
    ws = addDays(ws, 7);
  }
  return out;
}

// ---- rate resolution (single source of truth for quoting + invoicing) ----

export function effectiveRate({ project, client, role, date, d }) {
  const D = d || snapshot();
  date = date || todayIso();
  const cards = D.ratecards.filter((c) => c.active !== false);
  const findCard = (type, refId) => cards.find((c) => c.scope && c.scope.type === type && c.scope.refId === refId);
  const projectCard = project ? findCard("project", project.id) : null;
  const clientCard = client ? findCard("client", client.id) : null;
  const globalCard = cards.find((c) => c.scope && c.scope.type === "global");
  const card = projectCard || clientCard || globalCard;
  const fallback = { rate: null, source: "no rate card", discount: 0, currency: (card && card.currency) || defaultCurrency() };
  if (!card) return fallback;
  const lines = (card.lines || []).filter((l) => !l.role || l.role === "" || l.role === "*" || l.role === role);
  let best = null;
  for (const l of lines) {
    if (l.effectiveFrom && l.effectiveFrom > date) continue;
    if (l.effectiveTo && l.effectiveTo < date) continue;
    if (!best || (l.effectiveFrom || "") >= (best.effectiveFrom || "")) best = l;
  }
  if (!best) return { rate: null, source: card.name, discount: card.discount || 0, currency: card.currency || defaultCurrency() };
  const discount = best.discount != null ? best.discount : card.discount || 0;
  return {
    rate: best.rate * (1 - discount / 100),
    source: card.name + (best.label ? " · " + best.label : ""),
    discount,
    currency: card.currency || defaultCurrency(),
    line: best,
  };
}

// ---- actuals roll-up (task 23) ----

export function timeCost(entry, D) {
  const r = D.resourcesById[entry.resourceId];
  return (entry.hours || 0) * (r && r.costRate ? Number(r.costRate) : 0);
}

export function timeRevenue(entry, D) {
  if (!entry.billable) return 0;
  const project = D.projectsById[entry.projectId] || null;
  const client = project ? D.clientsById[project.clientId] : null;
  const r = D.resourcesById[entry.resourceId] || null;
  const role = r && Array.isArray(r.roles) && r.roles.length ? r.roles[0] : null;
  const er = effectiveRate({ project, client, role, date: entry.date, d: D });
  return (entry.hours || 0) * (er.rate || 0);
}

export function projectActuals(projectId, D) {
  const d = D || snapshot();
  const entries = d.timesheets.filter((t) => t.projectId === projectId);
  const exps = d.expenses.filter((e) => e.projectId === projectId);
  const hours = entries.reduce((s, e) => s + (e.hours || 0), 0);
  const billableHours = entries.filter((e) => e.billable).reduce((s, e) => s + (e.hours || 0), 0);
  const approvedHours = entries.filter((e) => e.billable && (e.status === "approved" || e.approvedAt)).reduce((s, e) => s + (e.hours || 0), 0);
  const cost = entries.reduce((s, e) => s + timeCost(e, d), 0);
  const revenue = entries.reduce((s, e) => s + timeRevenue(e, d), 0);
  const expenseTotal = exps.reduce((s, e) => s + (e.amount || 0), 0);
  const billableExpense = exps.filter((e) => e.billable).reduce((s, e) => s + (e.amount || 0), 0);
  return { hours, billableHours, approvedHours, cost, revenue, expenseTotal, billableExpense, expenseCount: exps.length, entryCount: entries.length };
}

export function projectRevenue(project, actuals, D) {
  const d = D || snapshot();
  const method = project.billingMethod || "tm";
  if (method === "fixed") {
    return Number(project.budgetValue) || 0;
  }
  if (method === "milestone") {
    const done = (project.milestones || []).filter((m) => m.status === "done").reduce((s, m) => s + (Number(m.value) || 0), 0);
    return done;
  }
  return actuals.revenue + actuals.billableExpense;
}

export function projectCost(project, actuals) {
  return actuals.cost + actuals.expenseTotal;
}

export function profitability(project, d) {
  const D = d || snapshot();
  const actuals = projectActuals(project.id, D);
  const revenue = projectRevenue(project, actuals, D);
  const cost = projectCost(project, actuals);
  const profit = revenue - cost;
  return {
    revenue, cost, profit,
    margin: revenue > 0 ? profit / revenue : null,
    actuals,
  };
}

// ---- budget vs actual vs forecast (task 24) ----

export function plannedHoursRemaining(project, D) {
  const d = D || snapshot();
  return d.workplans
    .filter((t) => t.projectId === project.id && t.status !== "done")
    .reduce((s, t) => s + (Number(t.effortHours) || 0), 0);
}

export function budgetVsActual(project, d) {
  const D = d || snapshot();
  const actuals = projectActuals(project.id, D);
  const budgetHours = Number(project.budgetHours) || 0;
  const budgetCost = Number(project.budgetCost) || 0;
  const today = todayIso();
  const start = project.plannedStart || today;
  const elapsedDays = Math.max(0, daysBetween(start, today));
  const remainingHours = plannedHoursRemaining(project, D);
  let etcHours = remainingHours;
  if (elapsedDays > 0 && actuals.hours > 0 && remainingHours > 0) {
    const plannedDaily = budgetHours > 0 ? budgetHours / Math.max(1, daysBetween(start, project.plannedEnd || today)) : 0;
    const burnDaily = actuals.hours / elapsedDays;
    const factor = plannedDaily > 0 ? Math.min(3, Math.max(0.3, burnDaily / plannedDaily)) : 1;
    etcHours = remainingHours * factor;
  }
  const avgCostRate = actuals.hours > 0 ? actuals.cost / actuals.hours : 0;
  const etcCost = etcHours * avgCostRate;
  const eacHours = actuals.hours + etcHours;
  const eacCost = actuals.cost + etcCost;
  const pctSpentHours = budgetHours > 0 ? actuals.hours / budgetHours : 0;
  const pctSpentCost = budgetCost > 0 ? actuals.cost / budgetCost : 0;
  return {
    budgetHours, budgetCost,
    actuals,
    remainingHours: Math.max(0, budgetHours - actuals.hours),
    pctSpentHours,
    pctSpentCost,
    etcHours, etcCost, eacHours, eacCost,
    overBudgetHours: budgetHours > 0 && actuals.hours > budgetHours * 1.05,
    lowBurn: elapsedDays > 5 && budgetHours > 0 && actuals.hours < (budgetHours * elapsedDays) / Math.max(1, daysBetween(start, project.plannedEnd || today)) * 0.5,
    elapsedDays,
  };
}

// ---- project health (task 10/32) ----

export function healthOf(project, d) {
  const D = d || snapshot();
  if (project.status === "closed") return { status: "closed", label: "Closed", kind: "muted" };
  const bva = budgetVsActual(project, D);
  const today = todayIso();
  const behindDays = project.plannedEnd ? daysBetween(project.plannedEnd, today) : 0;
  const burn = Math.max(bva.pctSpentCost, bva.pctSpentHours);
  if (burn >= 1.2 || behindDays >= 30) return { status: "over-budget", label: "Over budget", kind: "danger", behindDays, burn };
  if (burn >= 1.05 || behindDays >= 14) return { status: "at-risk", label: "At risk", kind: "warn", behindDays, burn };
  return { status: "on-track", label: "On track", kind: "ok", behindDays, burn };
}

// ---- utilization & capacity (tasks 17, 18, 19) ----

export function availableHoursForWeek(resource, ws) {
  const s = appSettings();
  let avail = s.weekHours;
  for (const a of resource.availability || []) {
    if (a.start && a.start > ws) continue;
    if (a.end && a.end < ws) continue;
    if (a.type === "vacation") avail = 0;
    else if (a.type === "parttime") avail = Number(a.hoursPerWeek) || avail;
    else if (a.type === "unavailable") avail = 0;
  }
  return avail;
}

export function bookedHoursForWeek(resourceId, ws, D) {
  const d = D || snapshot();
  const we = weekEndIso(ws);
  return d.allocations
    .filter((a) => a.resourceId === resourceId && a.startDate <= we && a.endDate >= ws)
    .reduce((s, a) => s + (Number(a.hoursPerWeek) || 0), 0);
}

export function actualHoursForWeek(resourceId, ws, D) {
  const d = D || snapshot();
  const we = weekEndIso(ws);
  return d.timesheets
    .filter((t) => t.resourceId === resourceId && t.date >= ws && t.date <= we)
    .reduce((s, t) => s + (Number(t.hours) || 0), 0);
}

export function billableHoursForWeek(resourceId, ws, D) {
  const d = D || snapshot();
  const we = weekEndIso(ws);
  return d.timesheets
    .filter((t) => t.resourceId === resourceId && t.billable && t.date >= ws && t.date <= we)
    .reduce((s, t) => s + (Number(t.hours) || 0), 0);
}

export function weekUtilization(resource, ws, D) {
  const d = D || snapshot();
  const s = appSettings();
  const available = availableHoursForWeek(resource, ws);
  const booked = bookedHoursForWeek(resource.id, ws, d);
  const actual = actualHoursForWeek(resource.id, ws, d);
  const billable = billableHoursForWeek(resource.id, ws, d);
  const target = available * s.targetUtilization;
  const over = booked > available + s.overAllocTolerance;
  return {
    ws, available, booked, actual, billable, target, over,
    utilization: target > 0 ? billable / target : 0,
    bookedUtil: target > 0 ? booked / target : 0,
  };
}

export function capacityHeatmap(resourceId, weeksAhead = 8, D) {
  const d = D || snapshot();
  const resource = d.resourcesById[resourceId];
  if (!resource) return [];
  const ws = weekStartIso(todayIso());
  const out = [];
  for (let i = 0; i < weeksAhead; i++) {
    const w = addDays(ws, i * 7);
    out.push(weekUtilization(resource, w, d));
  }
  return out;
}

export function overloads(D) {
  const d = D || snapshot();
  const s = appSettings();
  const out = [];
  const seen = new Set();
  const ws = weekStartIso(todayIso());
  for (const a of d.allocations) {
    const resource = d.resourcesById[a.resourceId];
    if (!resource) continue;
    const we = weekEndIso(a.endDate);
    for (let w = a.startDate; w <= we; w = addDays(w, 7)) {
      const booked = bookedHoursForWeek(a.resourceId, w, d);
      const available = availableHoursForWeek(resource, w);
      if (booked > available + s.overAllocTolerance) {
        const key = a.id + "@" + w;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ allocation: a, resource, ws: w, booked, available, overBy: booked - available - s.overAllocTolerance });
      }
    }
  }
  return out.sort((a, b) => a.ws.localeCompare(b.ws) || a.resource.name.localeCompare(b.resource.name));
}

export function skillGaps(D) {
  const d = D || snapshot();
  const out = [];
  for (const t of d.workplans) {
    if (!t.assigneeId) continue;
    const r = d.resourcesById[t.assigneeId];
    if (!r) continue;
    const need = t.requiredSkills || [];
    if (!need.length) continue;
    const has = new Set((r.skills || []).map((sk) => (typeof sk === "string" ? sk : sk.name)));
    const missing = need.filter((n) => !has.has(n));
    if (missing.length) out.push({ task: t, resource: r, missing });
  }
  return out;
}

export function taskSuggestions(task, D) {
  const d = D || snapshot();
  const need = task.requiredSkills || [];
  const role = task.role;
  const ws = weekStartIso(task.plannedStart || todayIso());
  const out = [];
  for (const r of d.resources) {
    if (r.active === false) continue;
    const has = new Set((r.skills || []).map((sk) => (typeof sk === "string" ? sk : sk.name)));
    const skillOk = !need.length || need.every((n) => has.has(n));
    const roleOk = !role || (Array.isArray(r.roles) && (r.roles.includes(role) || r.roles.includes("*")));
    if (!skillOk || !roleOk) continue;
    const booked = bookedHoursForWeek(r.id, ws, d);
    const available = availableHoursForWeek(r, ws);
    out.push({ resource: r, booked, available, free: Math.max(0, available - booked), fit: need.length + (roleOk ? 1 : 0) });
  }
  return out.sort((a, b) => b.fit - a.fit || b.free - a.free);
}

// ---- billing (tasks 26, 27, 28) ----

export function unbilledItems(project, d) {
  const D = d || snapshot();
  const invoiced = new Set();
  for (const inv of D.billing) {
    if (inv.kind !== "invoice" || inv.status === "void") continue;
    for (const li of inv.lineItems || []) {
      for (const ref of li.refs || []) invoiced.add(ref.type + ":" + ref.id);
    }
  }
  const approvedTime = D.timesheets.filter((t) =>
    t.projectId === project.id && t.billable && (t.status === "approved" || t.approvedAt) && !invoiced.has("timesheet:" + t.id));
  const approvedExp = D.expenses.filter((e) =>
    e.projectId === project.id && e.billable && e.status !== "draft" && e.status !== "rejected" && !invoiced.has("expense:" + e.id));
  return { time: approvedTime, expenses: approvedExp };
}

export function unbilledTotals(project, d) {
  const D = d || snapshot();
  const u = unbilledItems(project, D);
  const hours = u.time.reduce((s, t) => s + (t.hours || 0), 0);
  let revenue = u.time.reduce((s, t) => s + timeRevenue(t, D), 0);
  let expenses = u.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  if ((project.billingMethod || "tm") === "fixed") {
    revenue = 0;
    expenses = 0;
  }
  return { hours, revenue: revenue + expenses, expenseValue: expenses, timeValue: revenue, timeCount: u.time.length, expenseCount: u.expenses.length };
}

export function invoiceableItems(project, d) {
  const D = d || snapshot();
  const method = project.billingMethod || "tm";
  if (method === "fixed") {
    const existing = D.billing.find((b) => b.kind === "invoice" && b.projectId === project.id && b.amountType === "fixed" && b.status !== "void");
    if (existing) return { type: "fixed", items: [], note: "A fixed-fee invoice already exists for this project." };
    return { type: "fixed", items: [{ desc: "Fixed fee — " + (project.name || project.id), amount: Number(project.budgetValue) || 0, qty: 1, rate: Number(project.budgetValue) || 0 }], note: "" };
  }
  if (method === "milestone") {
    const invoiced = new Set();
    for (const inv of D.billing) if (inv.kind === "invoice" && inv.status !== "void") for (const li of inv.lineItems || []) for (const ref of li.refs || []) invoiced.add(ref.id);
    const items = (project.milestones || [])
      .filter((m) => m.status === "done" && !invoiced.has(m.id))
      .map((m) => ({ desc: "Milestone: " + (m.title || m.id), amount: Number(m.value) || 0, qty: 1, rate: Number(m.value) || 0, milestoneId: m.id }));
    return { type: "milestone", items, note: "" };
  }
  const u = unbilledItems(project, D);
  const items = [];
  for (const t of u.time) {
    const r = D.resourcesById[t.resourceId];
    const er = effectiveRate({ project, client: D.clientsById[project.clientId], role: r && r.roles && r.roles[0], date: t.date, d: D });
    items.push({ desc: "Consulting — " + (r ? r.name : "Unassigned") + " — " + (t.date || "") + (t.note ? " · " + t.note : ""), qty: t.hours, rate: er.rate || 0, amount: (t.hours || 0) * (er.rate || 0), ref: { type: "timesheet", id: t.id } });
  }
  for (const e of u.expenses) {
    items.push({ desc: "Expense — " + (e.type || "Other") + (e.note ? " · " + e.note : ""), qty: 1, rate: e.amount, amount: e.amount, ref: { type: "expense", id: e.id } });
  }
  return { type: "tm", items, note: "" };
}

export function invoiceTotals(project, items) {
  const subtotal = items.reduce((s, i) => s + (i.amount || 0), 0);
  const tax = subtotal * (project.taxRate || 0) / 100;
  return { subtotal, tax, total: subtotal + tax };
}

export function outstandingOf(invoice, payments) {
  const total = Number(invoice.total) || 0;
  const paid = (payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return Math.max(0, total - paid);
}

export function projectPaymentState(project, d) {
  const D = d || snapshot();
  const invoices = D.billing.filter((b) => b.kind === "invoice" && b.projectId === project.id && b.status !== "void");
  const totals = { invoiced: 0, paid: 0, outstanding: 0 };
  for (const inv of invoices) {
    const out = outstandingOf(inv, inv.payments);
    totals.invoiced += Number(inv.total) || 0;
    totals.paid += (Number(inv.total) || 0) - out;
    totals.outstanding += out;
  }
  return { count: invoices.length, ...totals };
}

// ---- dashboard KPIs (task 29) ----

export function dashboardKpis(d) {
  const D = d || snapshot();
  const activeProjects = D.projects.filter((p) => p.status !== "closed");
  const healthCounts = { "on-track": 0, "at-risk": 0, "over-budget": 0, closed: 0 };
  for (const p of D.projects) {
    const h = healthOf(p, D);
    healthCounts[h.status] = (healthCounts[h.status] || 0) + 1;
  }
  let billableHours = 0;
  let targetHours = 0;
  const ws = weekStartIso(todayIso());
  for (const r of D.resources) {
    if (r.active === false) continue;
    const u = weekUtilization(r, ws, D);
    billableHours += u.billable;
    targetHours += u.target;
  }
  let budgetTotal = 0;
  let costTotal = 0;
  for (const p of activeProjects) {
    const bva = budgetVsActual(p, D);
    budgetTotal += bva.budgetCost;
    costTotal += bva.actuals.cost + bva.actuals.expenseTotal;
  }
  let unbilledHours = 0;
  let unbilledValue = 0;
  for (const p of activeProjects) {
    const u = unbilledTotals(p, D);
    unbilledHours += u.hours;
    unbilledValue += u.revenue;
  }
  const openSows = D.sows.filter((s) => s.status === "sent" || s.status === "draft").length;
  const soon = addDays(todayIso(), 30);
  const upcomingInvoices = activeProjects
    .filter((p) => (p.billingMethod || "tm") === "milestone")
    .flatMap((p) => (p.milestones || [])
      .filter((m) => m.status !== "done" && m.dueDate && m.dueDate <= soon && m.dueDate >= todayIso())
      .map((m) => ({ project: p, milestone: m })))
    .sort((a, b) => (a.milestone.dueDate || "").localeCompare(b.milestone.dueDate || ""));
  return {
    healthCounts, billableHours, targetHours,
    utilization: targetHours > 0 ? billableHours / targetHours : null,
    budgetTotal, costTotal, burn: budgetTotal > 0 ? costTotal / budgetTotal : null,
    unbilledHours, unbilledValue, openSows, upcomingInvoices,
    projectCount: D.projects.length, activeCount: activeProjects.length,
    resourceCount: D.resources.filter((r) => r.active !== false).length,
    clientCount: D.clients.filter((c) => c.active !== false).length,
    openSowCount: openSows,
    invoiceCount: D.billing.filter((b) => b.kind === "invoice" && b.status !== "void").length,
  };
}

// ---- profitability by client / resource (task 25) ----

export function profitabilityByClient(d) {
  const D = d || snapshot();
  const map = {};
  for (const p of D.projects) {
    if (p.status === "closed" && !D.clientsById[p.clientId]) continue;
    const pr = profitability(p, D);
    const client = D.clientsById[p.clientId];
    const key = client ? client.id : "none";
    const bucket = (map[key] = map[key] || { client, revenue: 0, cost: 0, profit: 0 });
    bucket.revenue += pr.revenue;
    bucket.cost += pr.cost;
    bucket.profit += pr.profit;
  }
  return Object.values(map).map((b) => ({ ...b, margin: b.revenue > 0 ? b.profit / b.revenue : null }));
}

export function profitabilityByResource(d) {
  const D = d || snapshot();
  const map = {};
  for (const t of D.timesheets) {
    const r = D.resourcesById[t.resourceId];
    if (!r) continue;
    const bucket = (map[r.id] = map[r.id] || { resource: r, revenue: 0, cost: 0, hours: 0 });
    bucket.revenue += timeRevenue(t, D);
    bucket.cost += timeCost(t, D);
    bucket.hours += t.hours || 0;
  }
  for (const e of D.expenses) {
    const r = D.resourcesById[e.resourceId];
    if (!r) continue;
    const bucket = (map[r.id] = map[r.id] || { resource: r, revenue: 0, cost: 0, hours: 0 });
    bucket.cost += Number(e.amount) || 0;
  }
  return Object.values(map).map((b) => ({ ...b, profit: b.revenue - b.cost, margin: b.revenue > 0 ? (b.revenue - b.cost) / b.revenue : null }));
}
