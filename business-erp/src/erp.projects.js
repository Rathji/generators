/* ============================================================
   BUSINESS ERP — Projects, time & service delivery (Tasks 24–27)
   - Projects (24): linked to a party and optionally a sales
     order, with milestones (statuses, planned dates) and
     whole-project profitability vs budget.
   - Tasks & timesheets (25): tasks under projects/milestones with
     assignees and states; time entries (date, hours, billable
     flag, rate); running billable-time vs budget totals.
   - Expenses & progress billing (26): project expenses (optionally
     linked to a supplier bill) and progress invoices generated from
     completed milestones or logged billable time through the same
     invoice mechanics as sales (same doc, same numbering, same
     guarded ledger hook).
   - Project state ports (27): publish a project/billing-event
     bundle for the earlier pipeline (download/copy); ingest
     project-master seeds (CRM erp-project-seeds) and the-ledger
     receipts (erp-ledger-receipts) back into the project timeline.
   Data lives in the projects document (splitByYear: false);
   progress invoices live in the sales document (so they appear in
   Sales → Invoices and feed AR/aging).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const store = ERP.store;
  const master = ERP.master;
  const P = (ERP.projects = {});
  const esc = ui.esc;

  const PJ = {
    planned: { label: "Planned", tone: "muted" },
    active: { label: "Active", tone: "info" },
    on_hold: { label: "On hold", tone: "warn" },
    completed: { label: "Completed", tone: "success" },
    cancelled: { label: "Cancelled", tone: "danger" },
  };
  const MS = {
    planned: { label: "Planned", tone: "muted" },
    in_progress: { label: "In progress", tone: "info" },
    completed: { label: "Completed", tone: "success" },
    cancelled: { label: "Cancelled", tone: "danger" },
  };
  const TK = {
    todo: { label: "To do", tone: "muted" },
    in_progress: { label: "In progress", tone: "info" },
    done: { label: "Done", tone: "success" },
  };
  const EXP_CATS = ["Materials", "Travel", "Subcontract", "Software", "Equipment", "Other"];
  const TERM_DAYS = { immediate: 0, net15: 15, net30: 30, net60: 60, net90: 90 };

  /* ─────────────────────────── data helpers ─────────────────────────── */

  let cache = null;
  async function docs() {
    if (cache) return cache;
    const r = await store.loadDoc("projects");
    cache = (r.records || []).slice();
    return cache;
  }
  P.records = docs;
  P.invalidate = () => { cache = null; };

  async function save(list) {
    const r = await store.saveDoc("projects", list || []);
    cache = (list || []).slice();
    return r;
  }

  P.byKind = function (list, kind) { return (list || []).filter((r) => (r.kind || "") === kind); };

  function activityRec(rec, type, summary) {
    const act = rec.activity || (rec.activity = []);
    act.push({ id: Date.now(), ts: new Date().toISOString(), type: type || "note", summary: summary || "", by: ERP.role || "owner" });
  }
  function lineTotals(l) {
    l = l || {};
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    const sub = qty * price;
    const tax = sub * (Number(l.taxRate) || 0) / 100;
    return { sub, tax, total: sub + tax };
  }
  function computeTotals(lines) {
    let subtotal = 0, taxTotal = 0;
    for (const l of (lines || [])) { const t = lineTotals(l); subtotal += t.sub; taxTotal += t.tax; }
    return { subtotal, taxTotal, total: subtotal + taxTotal };
  }
  async function postInvoice(inv) {
    if (ERP.finance && typeof ERP.finance.postSalesInvoice === "function") return await ERP.finance.postSalesInvoice(inv);
    return null;
  }
  function liveOf(list, rec) {
    return (list || []).find((r) => String(r.id) === String(rec.id)) || rec;
  }

  /* ─────────────────────────── Projects (24) ─────────────────────────── */

  P.createProject = async function (data) {
    const allDocs = await docs();
    const partyId = data.partyId != null && data.partyId !== "" ? Number(data.partyId) : null;
    const title = String(data.title || "").trim();
    if (!title) throw new Error("A project title is required.");
    const project = {
      id: master.nextId(allDocs), kind: "project",
      title,
      projNum: await master.allocateNumber("project"),
      partyId, orderId: data.orderId != null ? Number(data.orderId) : null,
      orderNum: data.orderNum || null,
      status: data.status || "planned",
      budget: Number(data.budget) || 0,
      currency: data.currency || "USD",
      startDate: data.startDate || ui.today(),
      endDate: data.endDate || "",
      description: String(data.description || "").trim(),
      source: data.source || "manual",
      tags: (data.tags || []).slice(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    project.activity = [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "Project created" + (data.source === "opportunity:" ? " from a won opportunity." : "."), by: ERP.role || "owner" }];
    allDocs.push(project);
    await save(allDocs);
    await master.audit({ action: "create_project", targetType: "project", targetId: project.id, summary: "Created project \"" + project.title + "\" (" + project.projNum + ")." });
    return project;
  };

  P.updateProject = async function (project, fields) {
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    for (const k of ["title", "partyId", "orderId", "orderNum", "budget", "currency", "startDate", "endDate", "description", "tags"]) {
      if (fields[k] !== undefined) p[k] = fields[k];
    }
    if (p.title !== undefined) p.title = String(p.title || "").trim();
    if (!p.title) throw new Error("A project title is required.");
    p.updatedAt = new Date().toISOString(); p.updatedBy = ERP.role || "owner";
    activityRec(p, "edit", "Project details updated.");
    await save(allDocs);
    await master.audit({ action: "update_project", targetType: "project", targetId: p.id, summary: "Updated project \"" + p.title + "\"." });
    return p;
  };

  P.setProjectStatus = async function (project, status) {
    if (!PJ[status]) throw new Error("Unknown project status.");
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const from = p.status;
    if (from === status) return p;
    p.status = status;
    p.updatedAt = new Date().toISOString(); p.updatedBy = ERP.role || "owner";
    activityRec(p, "status", "Status changed from " + ((PJ[from] || {}).label || from) + " to " + ((PJ[status] || {}).label || status) + ".");
    await save(allDocs);
    await master.audit({ action: "set_project_status", targetType: "project", targetId: p.id, summary: p.projNum + " → " + status });
    return p;
  };

  /* ─────────────────────────── Milestones (24) ─────────────────────────── */

  P.addMilestone = async function (project, data) {
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const m = {
      id: master.nextId(allDocs), kind: "milestone", projectId: p.id,
      title: String(data.title || "").trim(),
      value: Number(data.value) || 0,
      status: data.status || "planned",
      plannedDate: data.plannedDate || "", dueDate: data.dueDate || "",
      description: String(data.description || "").trim(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    if (!m.title) throw new Error("A milestone title is required.");
    allDocs.push(m);
    activityRec(p, "milestone", "Milestone \"" + m.title + "\" added.");
    await save(allDocs);
    await master.audit({ action: "add_milestone", targetType: "project", targetId: p.id, summary: "Milestone \"" + m.title + "\" on " + p.projNum });
    return m;
  };

  P.updateMilestone = async function (project, mRec, fields) {
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const m = liveOf(allDocs, mRec);
    for (const k of ["title", "value", "plannedDate", "dueDate", "description"]) {
      if (fields[k] !== undefined) m[k] = fields[k];
    }
    if (m.title !== undefined) m.title = String(m.title || "").trim();
    m.updatedAt = new Date().toISOString(); m.updatedBy = ERP.role || "owner";
    activityRec(p, "milestone", "Milestone \"" + m.title + "\" updated.");
    await save(allDocs);
    return m;
  };

  P.setMilestoneStatus = async function (project, mRec, status) {
    if (!MS[status]) throw new Error("Unknown milestone status.");
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const m = liveOf(allDocs, mRec);
    if (m.status === status) return m;
    m.status = status;
    m.updatedAt = new Date().toISOString(); m.updatedBy = ERP.role || "owner";
    if (status === "completed") { m.completedAt = new Date().toISOString(); activityRec(p, "milestone", "Milestone \"" + m.title + "\" completed."); }
    else if (m.completedAt && status !== "completed") delete m.completedAt;
    await save(allDocs);
    await master.audit({ action: "set_milestone_status", targetType: "project", targetId: p.id, summary: "Milestone \"" + m.title + "\" → " + status });
    return m;
  };

  /* ─────────────────────────── Tasks (25) ─────────────────────────── */

  P.addTask = async function (project, data) {
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const t = {
      id: master.nextId(allDocs), kind: "task", projectId: p.id,
      milestoneId: data.milestoneId != null ? Number(data.milestoneId) : null,
      title: String(data.title || "").trim(),
      assignee: String(data.assignee || "").trim(),
      status: data.status || "todo",
      dueDate: data.dueDate || "",
      estimatedHours: Number(data.estimatedHours) || 0,
      description: String(data.description || "").trim(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    if (!t.title) throw new Error("A task title is required.");
    allDocs.push(t);
    activityRec(p, "task", "Task \"" + t.title + "\" added.");
    await save(allDocs);
    await master.audit({ action: "add_task", targetType: "project", targetId: p.id, summary: "Task \"" + t.title + "\" on " + p.projNum });
    return t;
  };

  P.updateTask = async function (project, tRec, fields) {
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const t = liveOf(allDocs, tRec);
    for (const k of ["title", "milestoneId", "assignee", "dueDate", "estimatedHours", "description"]) {
      if (fields[k] !== undefined) t[k] = fields[k];
    }
    if (t.title !== undefined) t.title = String(t.title || "").trim();
    t.updatedAt = new Date().toISOString(); t.updatedBy = ERP.role || "owner";
    activityRec(p, "task", "Task \"" + t.title + "\" updated.");
    await save(allDocs);
    return t;
  };

  P.setTaskStatus = async function (project, tRec, status) {
    if (!TK[status]) throw new Error("Unknown task status.");
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const t = liveOf(allDocs, tRec);
    if (t.status === status) return t;
    t.status = status;
    t.updatedAt = new Date().toISOString(); t.updatedBy = ERP.role || "owner";
    activityRec(p, "task", "Task \"" + t.title + "\" marked " + ((TK[status] || {}).label || status) + ".");
    await save(allDocs);
    return t;
  };

  /* ─────────────────────────── Timesheets (25) ─────────────────────────── */

  P.addTimeEntry = async function (data) {
    const allDocs = await docs();
    const p = liveOf(allDocs, { id: Number(data.projectId) });
    if (!p || p.kind !== "project") throw new Error("Choose a project.");
    const te = {
      id: master.nextId(allDocs), kind: "timeEntry", projectId: p.id,
      taskId: data.taskId != null ? Number(data.taskId) : null,
      date: data.date || ui.today(),
      hours: Number(data.hours) || 0,
      billable: !!data.billable,
      rate: Number(data.rate) || 0,
      cost: Number(data.cost) || 0,
      note: String(data.note || "").trim(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    if (!isFinite(te.hours) || te.hours <= 0) throw new Error("Enter hours greater than zero.");
    if (te.billable && te.rate <= 0) throw new Error("A billable rate is required for billable time.");
    allDocs.push(te);
    activityRec(p, "time", "Logged " + ui.fmt(te.hours) + "h" + (te.billable ? " billable" : "") + (te.note ? " — " + te.note : "") + ".");
    await save(allDocs);
    await master.audit({ action: "add_time", targetType: "project", targetId: p.id, summary: ui.fmt(te.hours) + "h logged on " + p.projNum });
    return te;
  };

  P.deleteTimeEntry = async function (teRec) {
    const allDocs = await docs();
    const te = liveOf(allDocs, teRec);
    if (te.kind !== "timeEntry") throw new Error("Not a time entry.");
    if (te.invoiceId) throw new Error("Cannot delete time already invoiced.");
    const idx = allDocs.findIndex((r) => String(r.id) === String(te.id));
    allDocs.splice(idx, 1);
    const p = liveOf(allDocs, { id: te.projectId });
    if (p && p.kind === "project") activityRec(p, "time", "Time entry deleted.");
    await save(allDocs);
    return true;
  };

  /* ─────────────────────────── Expenses (26) ─────────────────────────── */

  P.addExpense = async function (data) {
    const allDocs = await docs();
    const p = liveOf(allDocs, { id: Number(data.projectId) });
    if (!p || p.kind !== "project") throw new Error("Choose a project.");
    const ex = {
      id: master.nextId(allDocs), kind: "expense", projectId: p.id,
      date: data.date || ui.today(),
      category: data.category || "Other",
      amount: Number(data.amount) || 0,
      currency: data.currency || p.currency || "USD",
      vendor: String(data.vendor || "").trim(),
      billId: data.billId != null ? Number(data.billId) : null,
      billNum: data.billNum || null,
      note: String(data.note || "").trim(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    if (!isFinite(ex.amount) || ex.amount <= 0) throw new Error("Enter an expense amount greater than zero.");
    allDocs.push(ex);
    activityRec(p, "expense", "Expense " + ui.money(ex.amount, ex.currency) + (ex.category ? " (" + ex.category + ")" : "") + " recorded.");
    await save(allDocs);
    await master.audit({ action: "add_expense", targetType: "project", targetId: p.id, summary: "Expense " + ui.money(ex.amount, ex.currency) + " on " + p.projNum });
    return ex;
  };

  P.deleteExpense = async function (exRec) {
    const allDocs = await docs();
    const ex = liveOf(allDocs, exRec);
    if (ex.kind !== "expense") throw new Error("Not an expense.");
    const idx = allDocs.findIndex((r) => String(r.id) === String(ex.id));
    allDocs.splice(idx, 1);
    const p = liveOf(allDocs, { id: ex.projectId });
    if (p && p.kind === "project") activityRec(p, "expense", "Expense deleted.");
    await save(allDocs);
    return true;
  };

  /* ─────────────────────────── Metrics (24, 25) ─────────────────────────── */

  /* Whole-project profitability vs budget.
     billed   = sum of progress invoices against the project (sales doc)
     unbilled = billable time not yet invoiced (hours × rate)
     cost     = expenses + labour (hours × loaded cost)
     profit   = billed − cost */
  P.projectMetrics = async function (project) {
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const ms = P.byKind(allDocs, "milestone").filter((m) => String(m.projectId) === String(p.id));
    const tasks = P.byKind(allDocs, "task").filter((t) => String(t.projectId) === String(p.id));
    const time = P.byKind(allDocs, "timeEntry").filter((t) => String(t.projectId) === String(p.id));
    const expenses = P.byKind(allDocs, "expense").filter((e) => String(e.projectId) === String(p.id));

    let unbilledValue = 0, unbilledHours = 0, billableHours = 0, billableValue = 0, laborCost = 0, expenseCost = 0;
    for (const te of time) {
      const hrs = Number(te.hours) || 0;
      laborCost += hrs * (Number(te.cost) || 0);
      if (te.billable) {
        billableHours += hrs;
        billableValue += hrs * (Number(te.rate) || 0);
        if (!te.invoiceId) { unbilledHours += hrs; unbilledValue += hrs * (Number(te.rate) || 0); }
      }
    }
    for (const ex of expenses) expenseCost += Number(ex.amount) || 0;

    const invDocs = await store.loadDoc("sales");
    const projInvoices = (invDocs.records || []).filter((r) => r.kind === "invoice" && r.source === "project" && String(r.projectId) === String(p.id));
    const invoicedTotal = projInvoices.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const billedTotal = invoicedTotal;

    const budget = Number(p.budget) || 0;
    const completedMs = ms.filter((m) => m.status === "completed").length;
    const totalMs = ms.length;
    const doneTasks = tasks.filter((t) => t.status === "done").length;
    const totalTasks = tasks.length;

    return {
      budget, billed: billedTotal, unbilled: unbilledValue, unbilledHours, remaining: Math.max(0, budget - billedTotal),
      pct: budget > 0 ? billedTotal / budget : 0,
      cost: expenseCost + laborCost, expenseCost, laborCost,
      profit: billedTotal - expenseCost - laborCost,
      billableHours, billableValue, hours: time.reduce((s, t) => s + (Number(t.hours) || 0), 0),
      milestones: { done: completedMs, total: totalMs },
      tasks: { done: doneTasks, total: totalTasks },
      invoices: projInvoices,
    };
  };

  P.projectTimeTotals = async function (project) {
    const m = await P.projectMetrics(project);
    return { hours: m.hours, billableHours: m.billableHours, billableValue: m.billableValue, unbilledHours: m.unbilledHours, unbilledValue: m.unbilled, laborCost: m.laborCost, billed: m.billed };
  };

  /* ─────────────────────────── Progress billing (26) ─────────────────────────── */

  /* Generate a progress invoice from completed milestones or logged billable
     time. The invoice is written to the SALES doc (kind "invoice", source
     "project") so it flows through the same invoice mechanics as sales —
     same numbering, same due-date logic, same guarded ledger posting. */
  P.progressInvoice = async function (project, opts) {
    opts = opts || {};
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    if (p.status === "cancelled") throw new Error("Cannot invoice a cancelled project.");

    const ms = P.byKind(allDocs, "milestone").filter((m) => String(m.projectId) === String(p.id));
    const time = P.byKind(allDocs, "timeEntry").filter((t) => String(t.projectId) === String(p.id));

    let lines = [];
    let pickedTime = [];
    const chosen = new Set((opts.ids || []).map(String));
    if (opts.mode === "milestones") {
      const picked = ms.filter((m) => m.status === "completed" && chosen.has(String(m.id)));
      if (!picked.length) throw new Error("Choose at least one completed milestone to bill.");
      for (const m of picked) {
        if (m.invoiceId) throw new Error("Milestone \"" + m.title + "\" has already been invoiced.");
        const val = Number(m.value) || 0;
        if (val <= 0) throw new Error("Milestone \"" + m.title + "\" has no billing value.");
        lines.push({ itemId: null, description: "Milestone: " + m.title, qty: 1, unitPrice: val, discountPct: 0, taxCode: "NONE", taxRate: 0, uom: "", milestoneId: m.id });
      }
    } else if (opts.mode === "time") {
      const picked = time.filter((t) => t.billable && chosen.has(String(t.id)));
      pickedTime = picked;
      if (!picked.length) throw new Error("Choose at least one billable time entry to bill.");
      const byTask = {};
      for (const te of picked) {
        if (te.invoiceId) throw new Error("Time entry from " + ui.date(te.date) + " has already been invoiced.");
        const key = te.taskId != null ? String(te.taskId) : "untracked";
        byTask[key] = byTask[key] || { desc: null, hours: 0, value: 0 };
        byTask[key].hours += Number(te.hours) || 0;
        byTask[key].value += (Number(te.hours) || 0) * (Number(te.rate) || 0);
      }
      const taskTitles = {};
      for (const t of P.byKind(allDocs, "task")) taskTitles[String(t.id)] = t.title;
      for (const key of Object.keys(byTask)) {
        const g = byTask[key];
        const desc = key === "untracked" ? "Billable time (project work)" : "Time — " + (taskTitles[key] || "Task");
        lines.push({ itemId: null, description: desc, qty: g.hours, unitPrice: g.value / g.hours, discountPct: 0, taxCode: "NONE", taxRate: 0, uom: "h", taskId: key === "untracked" ? null : Number(key) });
      }
    } else {
      throw new Error("Choose a billing mode (milestones or time).");
    }

    const totals = computeTotals(lines);
    const party = p.partyId != null ? await master.party(p.partyId) : null;
    const days = TERM_DAYS[((party && party.paymentTerms) || "net30")] != null ? TERM_DAYS[((party && party.paymentTerms) || "net30")] : 30;

    const salesRes = await store.loadDoc("sales");
    const salesDocs = (salesRes.records || []).slice();
    const inv = {
      id: master.nextId(salesDocs), kind: "invoice",
      num: await master.allocateNumber("invoice"),
      source: "project", projectId: p.id, projectNum: p.projNum,
      partyId: p.partyId, date: opts.date || ui.today(),
      dueDate: ui.addDays(opts.date || ui.today(), days),
      lines, currency: p.currency || "USD", notes: "Progress invoice for " + p.projNum + " — " + p.title,
      status: "posted", subtotal: totals.subtotal, discount: 0, taxTotal: totals.taxTotal, total: totals.total,
      amountPaid: 0, amountCredited: 0, ledgerEntries: null,
      activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "Progress invoice for " + p.projNum + ".", by: ERP.role || "owner" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    salesDocs.push(inv);
    const journal = await postInvoice(inv);
    if (journal) inv.ledgerEntries = { journalId: journal.id, num: journal.num };
    await store.saveDoc("sales", salesDocs);
    if (ERP.sales && typeof ERP.sales.invalidate === "function") ERP.sales.invalidate();

    const stamp = { invoiceId: inv.id, invoiceNum: inv.num };
    for (const l of lines) {
      if (l.milestoneId != null) {
        const m = liveOf(allDocs, { id: l.milestoneId });
        if (m && m.kind === "milestone") { m.invoiceId = inv.id; m.invoiceNum = inv.num; m.invoicedAt = new Date().toISOString(); }
      }
      if (l.taskId != null) {
        for (const te of pickedTime) if (String(te.taskId) === String(l.taskId) && !te.invoiceId) Object.assign(te, stamp);
      }
    }
    activityRec(p, "billing", "Progress invoice " + inv.num + " (" + ui.money(inv.total, inv.currency) + ") issued.");
    await save(allDocs);
    await master.audit({ action: "progress_invoice", targetType: "project", targetId: p.id, summary: "Progress invoice " + inv.num + " (" + ui.money(inv.total, inv.currency) + ") for " + p.projNum });
    return inv;
  };

  /* ─────────────────────────── Timeline (27) ─────────────────────────── */

  /* Chronological project timeline: local activity plus linked invoice
     events from the sales doc (issue, payment). */
  P.projectTimeline = async function (project) {
    const allDocs = await docs();
    const p = liveOf(allDocs, project);
    const events = (p.activity || []).slice();
    const invRes = await store.loadDoc("sales");
    for (const r of (invRes.records || [])) {
      if (r.kind === "invoice" && r.source === "project" && String(r.projectId) === String(p.id)) {
        events.push({ ts: r.createdAt, type: "invoice", summary: "Invoice " + r.num + " issued — " + ui.money(r.total, r.currency || p.currency) });
        if (r.amountPaid > 0) events.push({ ts: r.createdAt, type: "payment", summary: "Payment of " + ui.money(r.amountPaid, r.currency || p.currency) + " received on " + r.num });
      }
    }
    events.sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));
    return events;
  };

  /* ─────────────────────────── Ports (27) ─────────────────────────── */

  /* Publish a full project/billing-event bundle for the earlier pipeline. */
  P.exportBundle = async function () {
    const allDocs = await docs();
    const projects = P.byKind(allDocs, "project").map((p) => Object.assign({}, p));
    const byProject = (kind) => P.byKind(allDocs, kind).reduce((o, r) => { (o[String(r.projectId)] = o[String(r.projectId)] || []).push(r); return o; }, {});
    return {
      schema: "erp-project-bundles", version: 1,
      exportedAt: new Date().toISOString(),
      projects: projects.map((p) => Object.assign({}, p, {
        milestones: byProject("milestone")[String(p.id)] || [],
        tasks: byProject("task")[String(p.id)] || [],
        timeEntries: byProject("timeEntry")[String(p.id)] || [],
        expenses: byProject("expense")[String(p.id)] || [],
      })),
      summary: { projects: projects.length, milestoneCount: P.byKind(allDocs, "milestone").length, taskCount: P.byKind(allDocs, "task").length },
    };
  };

  /* Ingest a bundle: CRM project-seeds (erp-project-seeds), a full
     project bundle (erp-project-bundles) or the-ledger receipts
     (erp-ledger-receipts). Returns a summary of what changed. */
  P.ingestBundle = async function (bundle) {
    if (!bundle || typeof bundle !== "object") throw new Error("That does not look like a project bundle.");
    const schema = bundle.schema || "";
    const allDocs = await docs();
    let created = 0, updated = 0, events = 0;

    if (schema === "erp-project-seeds") {
      for (const seed of (bundle.projects || [])) {
        const key = seed.source || ("seed:" + (seed.title || "").toLowerCase().replace(/\s+/g, "-"));
        const existing = allDocs.find((r) => r.kind === "project" && r.source === key);
        let p;
        if (existing) { p = existing; updated++; }
        else {
          p = await P.createProject({
            title: seed.title || "Project", partyId: seed.partyId != null ? seed.partyId : null,
            budget: seed.value || 0, currency: seed.currency || "USD",
            startDate: ui.today(), tags: seed.tags || [], source: key,
            description: seed.partyName ? "Client: " + seed.partyName : "",
          });
          created++;
        }
        activityRec(p, "port", "Imported from project-seeds bundle.");
        events++;
      }
    } else if (schema === "erp-project-bundles") {
      const srcProjects = bundle.projects || [];
      for (const src of srcProjects) {
        const ssrc = String(src.source || "");
        const key = (ssrc && ssrc !== "manual") ? ssrc : ("bundle:" + (src.projNum || ("id-" + String(src.id))));
        let p = allDocs.find((r) => r.kind === "project" && r.source === key)
          || (src.projNum ? allDocs.find((r) => r.kind === "project" && r.projNum === src.projNum) : null);
        if (p) updated++;
        else {
          p = await P.createProject({
            title: src.title, partyId: src.partyId != null ? src.partyId : null,
            budget: src.budget || 0, currency: src.currency || "USD",
            startDate: src.startDate || ui.today(), endDate: src.endDate || "",
            description: src.description || "", tags: src.tags || [], source: key,
          });
          created++;
        }
        for (const m of (src.milestones || [])) {
          if (!allDocs.some((r) => r.kind === "milestone" && String(r.projectId) === String(p.id) && r.title === m.title)) {
            await P.addMilestone(p, { title: m.title, value: m.value || 0, plannedDate: m.plannedDate || "", dueDate: m.dueDate || "", description: m.description || "" });
            events++;
          }
        }
        for (const t of (src.tasks || [])) {
          if (!allDocs.some((r) => r.kind === "task" && String(r.projectId) === String(p.id) && r.title === t.title)) {
            await P.addTask(p, { title: t.title, assignee: t.assignee || "", estimatedHours: t.estimatedHours || 0, dueDate: t.dueDate || "", description: t.description || "" });
            events++;
          }
        }
      }
    } else if (schema === "erp-ledger-receipts") {
      for (const ev of (bundle.events || [])) {
        const p = ev.projectId != null ? liveOf(allDocs, { id: ev.projectId }) : null;
        if (p && p.kind === "project") {
          activityRec(p, ev.type || "ledger", ev.summary || "Ledger event ingested.");
          events++;
        }
      }
    } else {
      throw new Error("Unrecognised bundle schema: " + esc(schema || "(none)"));
    }

    await save(allDocs);
    await master.audit({ action: "ingest_project_bundle", targetType: "projects", targetId: 0, summary: "Ingested " + schema + " — " + created + " created, " + updated + " matched, " + events + " events." });
    return { schema, created, updated, events };
  };

  /* ─────────────────────────── UI ─────────────────────────── */

  function projectRowHtml(p, metrics, partiesMap) {
    const m = metrics || {};
    const msDone = m.milestones ? m.milestones.done : 0, msTotal = m.milestones ? m.milestones.total : 0;
    const pct = Math.round((m.pct || 0) * 100);
    return "<tr>" +
      "<td><b>" + esc(p.title) + "</b>" + (p.projNum ? "<div class=\"erp-sub\">" + esc(p.projNum) + "</div>" : "") + "</td>" +
      "<td>" + esc(partiesMap[String(p.partyId)] || "—") + "</td>" +
      "<td>" + ui.statusBadge(p.status, PJ) + "</td>" +
      "<td>" + ui.money(p.budget, p.currency) + "</td>" +
      "<td>" + ui.money(m.billed || 0, p.currency) + "</td>" +
      "<td>" + (msTotal ? ui.fmt(msDone) + " / " + ui.fmt(msTotal) + " ms" : "—") + "</td>" +
      "<td><div class=\"erp-progress\" style=\"width:110px\"><span style=\"width:" + pct + "%\"></span></div><span class=\"erp-sub\">" + pct + "% billed</span></td>" +
      "<td class=\"erp-row-actions\">" + ui.btn("Open", { small: true, act: "pj-open", arg: String(p.id) }) + "</td>" +
      "</tr>";
  }

  function openProjectModal(project, state, refresh) {
    const { allDocs, partiesMap, partiesAll, catalog, taxes, cur } = state;
    const p = liveOf(allDocs, project);
    const ms = P.byKind(allDocs, "milestone").filter((m) => String(m.projectId) === String(p.id));
    const tasks = P.byKind(allDocs, "task").filter((t) => String(t.projectId) === String(p.id));
    const time = P.byKind(allDocs, "timeEntry").filter((t) => String(t.projectId) === String(p.id));
    const expenses = P.byKind(allDocs, "expense").filter((e) => String(e.projectId) === String(p.id));

    const m = ui.modal({ title: p.projNum + " — " + p.title, size: "lg", body: "<div data-pj-modal></div>" });
    const ctn = m.querySelector("[data-pj-modal]");
    let tab = "overview";

    const partyOptions = partiesAll.map((pt) => ({ value: pt.id, label: pt.name + " (" + pt.type + ")" }));

    const render = async () => {
      const metrics = await P.projectMetrics(p);
      const timeTotals = metrics;
      const tabs = [
        { id: "overview", label: "Overview" },
        { id: "milestones", label: "Milestones", badge: String(metrics.milestones.total) },
        { id: "tasks", label: "Tasks", badge: String(metrics.tasks.total) },
        { id: "time", label: "Timesheets", badge: String(time.length) },
        { id: "expenses", label: "Expenses", badge: String(expenses.length) },
        { id: "billing", label: "Billing", badge: String(metrics.invoices.length) },
      ];
      const tt = ui.tabs(tabs, tab);
      ctn.innerHTML = tt.html;
      ctn.querySelectorAll("[data-panel]").forEach((panelEl) => panelEl.classList.toggle("active", panelEl.getAttribute("data-panel") === tab));

      if (tab === "overview") {
        const statusSelect = ui.select("status", "Status", Object.keys(PJ).map((k) => ({ value: k, label: PJ[k].label })), p.status);
        const pct = Math.round((metrics.pct || 0) * 100);
        panel(ctn, "overview").innerHTML =
          ui.summary([
            { label: "Budget", value: ui.money(metrics.budget, p.currency) },
            { label: "Billed", value: ui.money(metrics.billed, p.currency) },
            { label: "Unbilled time", value: ui.money(metrics.unbilled, p.currency) },
            { label: "Expenses", value: ui.money(metrics.expenseCost, p.currency) },
            { label: "Labour cost", value: ui.money(metrics.laborCost, p.currency) },
            { label: "Profit", value: ui.money(metrics.profit, p.currency) },
          ]) +
          '<div class="erp-progress" style="width:100%;max-width:420px;margin:10px 0"><span style="width:' + pct + '%"></span></div>' +
          '<p class="erp-sub">' + pct + "% of budget billed — " + ui.money(metrics.remaining, p.currency) + " remaining.</p>" +
          ui.form(
            ui.field("Status", statusSelect) +
            ui.text("title", "Title", p.title) +
            ui.select("partyId", "Client", partyOptions, p.partyId) +
            ui.number("budget", "Budget", p.budget, { min: 0 }) +
            ui.text("currency", "Currency", p.currency) +
            ui.dateInput("startDate", "Start date", p.startDate) +
            ui.dateInput("endDate", "End date", p.endDate) +
            ui.textarea("description", "Description", p.description, 3),
            ui.btn("Save changes", { primary: true, act: "pj-save" })
          );
        const sel = ctn.querySelector("[data-act=pj-save]");
        if (sel) sel.onclick = async () => {
          const f = ui.collect(ctn, ["status", "title", "partyId", "budget", "currency", "startDate", "endDate", "description"]);
          try {
            await P.setProjectStatus(p, f.status);
            await P.updateProject(p, { title: f.title, partyId: f.partyId, budget: f.budget, currency: f.currency, startDate: f.startDate, endDate: f.endDate, description: f.description });
            ui.closeModal();
            ui.toast("Project saved.");
            refresh();
          } catch (e) { alert(e.message); }
        };
      } else if (tab === "milestones") {
        panel(ctn, "milestones").innerHTML =
          ui.form(
            ui.field("", '<div class="erp-inline-form">' +
              ui.text("m-title", "Milestone", "") +
              ui.number("m-value", "Value", 0, { min: 0 }) +
              ui.dateInput("m-planned", "Planned", "") +
              ui.dateInput("m-due", "Due", "") +
              ui.btn("Add milestone", { primary: true, act: "ms-add" }) + "</div>")
          ) +
          '<div class="erp-table-wrap">' + ui.table(
            [
              { key: "title", label: "Milestone", render: (r) => "<b>" + esc(r.title) + "</b>" + (r.value ? "<div class=\"erp-sub\">" + ui.money(r.value, p.currency) + "</div>" : "") },
              { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, MS) },
              { key: "plannedDate", label: "Planned", render: (r) => r.plannedDate ? ui.date(r.plannedDate) : "—" },
              { key: "dueDate", label: "Due", render: (r) => r.dueDate ? ui.date(r.dueDate) : "—" },
              { key: "billed", label: "Invoiced", render: (r) => r.invoiceId ? ui.money(r.value, p.currency) : "—" },
              { key: "actions", label: "", render: (r) =>
                  (r.status === "completed" ? "" : ui.btn("Complete", { small: true, act: "ms-complete", arg: String(r.id) })) +
                  (r.status === "completed" ? ui.btn("Reopen", { small: true, act: "ms-reopen", arg: String(r.id) }) : "") },
            ],
            ms, { emptyText: "No milestones yet — add one above." }
          ) + "</div>";
        const sel = ctn.querySelector("[data-act=ms-add]");
        if (sel) sel.onclick = async () => {
          const f = ui.collect(ctn, ["m-title", "m-value", "m-planned", "m-due"]);
          try {
            await P.addMilestone(p, { title: f["m-title"], value: f["m-value"], plannedDate: f["m-planned"], dueDate: f["m-due"] });
            openProjectModal(p, state, refresh);
          } catch (e) { alert(e.message); }
        };
      } else if (tab === "tasks") {
        panel(ctn, "tasks").innerHTML =
          ui.form(
            ui.field("", '<div class="erp-inline-form">' +
              ui.text("t-title", "Task", "") +
              ui.select("t-milestone", "Milestone", [{ value: "", label: "— none —" }].concat(ms.map((mm) => ({ value: mm.id, label: mm.title }))), "") +
              ui.text("t-assignee", "Assignee", "") +
              ui.number("t-est", "Est. h", 0, { min: 0 }) +
              ui.dateInput("t-due", "Due", "") +
              ui.btn("Add task", { primary: true, act: "tk-add" }) + "</div>")
          ) +
          '<div class="erp-table-wrap">' + ui.table(
            [
              { key: "title", label: "Task", render: (r) => "<b>" + esc(r.title) + "</b>" },
              { key: "milestone", label: "Milestone", render: (r) => {
                  const mm = ms.find((x) => String(x.id) === String(r.milestoneId));
                  return mm ? esc(mm.title) : "—";
                } },
              { key: "assignee", label: "Assignee", render: (r) => esc(r.assignee || "—") },
              { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, TK) },
              { key: "dueDate", label: "Due", render: (r) => r.dueDate ? ui.date(r.dueDate) : "—" },
              { key: "est", label: "Est. h", render: (r) => r.estimatedHours ? ui.fmt(r.estimatedHours) : "—" },
              { key: "actions", label: "", render: (r) =>
                  (r.status !== "done" ? ui.btn("Done", { small: true, act: "tk-done", arg: String(r.id) }) : ui.btn("Reopen", { small: true, act: "tk-reopen", arg: String(r.id) })) },
            ],
            tasks, { emptyText: "No tasks yet — add one above." }
          ) + "</div>";
        const sel = ctn.querySelector("[data-act=tk-add]");
        if (sel) sel.onclick = async () => {
          const f = ui.collect(ctn, ["t-title", "t-milestone", "t-assignee", "t-est", "t-due"]);
          try {
            await P.addTask(p, { title: f["t-title"], milestoneId: f["t-milestone"], assignee: f["t-assignee"], estimatedHours: f["t-est"], dueDate: f["t-due"] });
            openProjectModal(p, state, refresh);
          } catch (e) { alert(e.message); }
        };
      } else if (tab === "time") {
        const taskOptions = [{ value: "", label: "— none —" }].concat(tasks.map((tt) => ({ value: tt.id, label: tt.title })));
        panel(ctn, "time").innerHTML =
          ui.summary([
            { label: "Hours", value: ui.fmt(metrics.hours) + "h" },
            { label: "Billable", value: ui.fmt(metrics.billableHours) + "h" },
            { label: "Billable value", value: ui.money(metrics.billableValue, p.currency) },
            { label: "Unbilled", value: ui.money(metrics.unbilled, p.currency) },
          ]) +
          ui.form(
            ui.field("", '<div class="erp-inline-form">' +
              ui.dateInput("te-date", "Date", ui.today()) +
              ui.select("te-task", "Task", taskOptions, "") +
              ui.number("te-hours", "Hours", 1, { min: 0, step: 0.25 }) +
              ui.check("te-billable", "Billable", true) +
              ui.number("te-rate", "Rate", 0, { min: 0 }) +
              ui.number("te-cost", "Loaded cost", 0, { min: 0 }) +
              ui.text("te-note", "Note", "") +
              ui.btn("Log time", { primary: true, act: "te-add" }) + "</div>")
          ) +
          '<div class="erp-table-wrap">' + ui.table(
            [
              { key: "date", label: "Date", render: (r) => ui.date(r.date) },
              { key: "task", label: "Task", render: (r) => {
                  const tt2 = tasks.find((x) => String(x.id) === String(r.taskId));
                  return tt2 ? esc(tt2.title) : "—";
                } },
              { key: "hours", label: "Hours", render: (r) => ui.fmt(r.hours) },
              { key: "billable", label: "Billable", render: (r) => (r.billable ? ui.badge("Yes", "success") : ui.badge("No", "muted")) },
              { key: "value", label: "Value", render: (r) => (r.billable ? ui.money((Number(r.hours) || 0) * (Number(r.rate) || 0), p.currency) : "—") },
              { key: "invoice", label: "Invoiced", render: (r) => (r.invoiceId ? ui.badge(r.invoiceNum || "Invoiced", "info") : "—") },
              { key: "note", label: "Note", render: (r) => esc(r.note || "—") },
              { key: "actions", label: "", render: (r) => (r.invoiceId ? "" : ui.btn("×", { small: true, act: "te-del", arg: String(r.id), title: "Delete entry" })) },
            ],
            time.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))), { emptyText: "No time logged yet." }
          ) + "</div>";
        const sel = ctn.querySelector("[data-act=te-add]");
        if (sel) sel.onclick = async () => {
          const f = ui.collect(ctn, ["te-date", "te-task", "te-hours", "te-billable", "te-rate", "te-cost", "te-note"]);
          try {
            await P.addTimeEntry({ projectId: p.id, taskId: f["te-task"], date: f["te-date"], hours: f["te-hours"], billable: f["te-billable"], rate: f["te-rate"], cost: f["te-cost"], note: f["te-note"] });
            openProjectModal(p, state, refresh);
          } catch (e) { alert(e.message); }
        };
      } else if (tab === "expenses") {
        panel(ctn, "expenses").innerHTML =
          ui.form(
            ui.field("", '<div class="erp-inline-form">' +
              ui.dateInput("ex-date", "Date", ui.today()) +
              ui.select("ex-cat", "Category", EXP_CATS, "Other") +
              ui.number("ex-amount", "Amount", 0, { min: 0 }) +
              ui.text("ex-vendor", "Vendor", "") +
              ui.text("ex-note", "Note", "") +
              ui.btn("Add expense", { primary: true, act: "ex-add" }) + "</div>")
          ) +
          '<div class="erp-table-wrap">' + ui.table(
            [
              { key: "date", label: "Date", render: (r) => ui.date(r.date) },
              { key: "category", label: "Category", render: (r) => esc(r.category) },
              { key: "vendor", label: "Vendor", render: (r) => esc(r.vendor || "—") },
              { key: "amount", label: "Amount", render: (r) => ui.money(r.amount, r.currency || p.currency) },
              { key: "bill", label: "Supplier bill", render: (r) => (r.billNum ? esc(r.billNum) : "—") },
              { key: "note", label: "Note", render: (r) => esc(r.note || "—") },
              { key: "actions", label: "", render: (r) => ui.btn("×", { small: true, act: "ex-del", arg: String(r.id), title: "Delete expense" }) },
            ],
            expenses.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))), { emptyText: "No expenses recorded yet." }
          ) + "</div>";
        const sel = ctn.querySelector("[data-act=ex-add]");
        if (sel) sel.onclick = async () => {
          const f = ui.collect(ctn, ["ex-date", "ex-cat", "ex-amount", "ex-vendor", "ex-note"]);
          try {
            await P.addExpense({ projectId: p.id, date: f["ex-date"], category: f["ex-cat"], amount: f["ex-amount"], vendor: f["ex-vendor"], note: f["ex-note"] });
            openProjectModal(p, state, refresh);
          } catch (e) { alert(e.message); }
        };
      } else if (tab === "billing") {
        const completedUninvoiced = ms.filter((mm) => mm.status === "completed" && !mm.invoiceId && (Number(mm.value) || 0) > 0);
        const billableUninvoiced = time.filter((tt) => tt.billable && !tt.invoiceId);
        const unbilledTotal = completedUninvoiced.reduce((s, mm) => s + (Number(mm.value) || 0), 0) + billableUninvoiced.reduce((s, tt) => s + (Number(tt.hours) || 0) * (Number(tt.rate) || 0), 0);
        const msOptions = completedUninvoiced.map((mm) => ({ value: mm.id, label: mm.title + " — " + ui.money(mm.value, p.currency) }));
        const teOptions = billableUninvoiced.map((tt) => ({ value: tt.id, label: ui.date(tt.date) + " · " + ui.fmt(tt.hours) + "h — " + ui.money((Number(tt.hours) || 0) * (Number(tt.rate) || 0), p.currency) }));
        panel(ctn, "billing").innerHTML =
          ui.summary([
            { label: "Budget", value: ui.money(metrics.budget, p.currency) },
            { label: "Billed", value: ui.money(metrics.billed, p.currency) },
            { label: "Unbilled", value: ui.money(unbilledTotal, p.currency) },
            { label: "Balance to bill", value: ui.money(Math.max(0, (Number(p.budget) || 0) - metrics.billed), p.currency) },
          ]) +
          '<div class="erp-form-row">' +
            ui.card("Bill completed milestones", (completedUninvoiced.length ? "" : '<p class="erp-alert">No completed, unbilled milestones with a value.</p>') +
              msOptions.map((o) => '<label class="erp-check-label"><input type="checkbox" data-bill-ms value="' + o.value + '"> ' + esc(o.label) + "</label>").join("") +
              (msOptions.length ? '<div class="erp-btn-row">' + ui.btn("Invoice selected milestones", { primary: true, act: "bill-ms" }) + "</div>" : "")) +
            ui.card("Bill logged time", (billableUninvoiced.length ? "" : '<p class="erp-alert">No unbilled billable time entries.</p>') +
              teOptions.map((o) => '<label class="erp-check-label"><input type="checkbox" data-bill-te value="' + o.value + '"> ' + esc(o.label) + "</label>").join("") +
              (teOptions.length ? '<div class="erp-btn-row">' + ui.btn("Invoice selected time", { primary: true, act: "bill-te" }) + "</div>" : "")) +
          "</div>" +
          '<div class="erp-table-wrap">' + ui.table(
            [
              { key: "num", label: "Invoice", render: (r) => "<b>" + esc(r.num) + "</b>" + "<div class=\"erp-sub\">" + ui.date(r.date) + " · due " + ui.date(r.dueDate) + "</div>" },
              { key: "total", label: "Total", render: (r) => ui.money(r.total, r.currency || p.currency) },
              { key: "paid", label: "Paid", render: (r) => ui.money(r.amountPaid || 0, r.currency || p.currency) },
              { key: "status", label: "Status", render: (r) => (r.amountPaid >= r.total - 0.0001 ? ui.badge("Paid", "success") : ui.badge("Open", "info")) },
            ],
            metrics.invoices.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))), { emptyText: "No progress invoices yet." }
          ) + "</div>";
        const doBill = async (mode) => {
          const ids = Array.from(ctn.querySelectorAll(mode === "milestones" ? "[data-bill-ms]:checked" : "[data-bill-te]:checked")).map((cb) => Number(cb.value));
          if (!ids.length) { alert("Select at least one item to invoice."); return; }
          try {
            const inv = await P.progressInvoice(p, { mode: mode === "milestones" ? "milestones" : "time", ids });
            ui.closeModal();
            ui.toast("Invoice " + inv.num + " issued (" + ui.money(inv.total, inv.currency) + ").");
            refresh();
          } catch (e) { alert(e.message); }
        };
        const msBtn = ctn.querySelector("[data-act=bill-ms]");
        if (msBtn) msBtn.onclick = () => doBill("milestones");
        const teBtn = ctn.querySelector("[data-act=bill-te]");
        if (teBtn) teBtn.onclick = () => doBill("time");
      }
    };

    const panel = (root, id) => root.querySelector('[data-panel="' + id + '"]');

    ui.bind(ctn, "click", "[data-tab]", async (tEl) => { tab = tEl.getAttribute("data-tab"); render(); });
    ui.bind(ctn, "click", "[data-act]", async (t, e, act, arg) => {
      const rec = allDocs.find((r) => String(r.id) === String(arg));
      try {
        if (act === "ms-complete") { await P.setMilestoneStatus(p, rec, "completed"); }
        else if (act === "ms-reopen") { await P.setMilestoneStatus(p, rec, "planned"); }
        else if (act === "tk-done") { await P.setTaskStatus(p, rec, "done"); }
        else if (act === "tk-reopen") { await P.setTaskStatus(p, rec, "todo"); }
        else if (act === "te-del") { await P.deleteTimeEntry(rec); }
        else if (act === "ex-del") { await P.deleteExpense(rec); }
        else return;
        render();
      } catch (err) { alert(err.message); }
    });

    render();
  }

  function renderProjects(panel, state, refresh) {
    const { allDocs, partiesMap, cur } = state;
    const projects = P.byKind(allDocs, "project").slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    panel.innerHTML =
      '<div class="erp-btn-row" style="margin-bottom:10px">' + ui.btn("New project", { primary: true, act: "pj-new" }) + "</div>" +
      '<div class="erp-table-wrap">' + ui.table(
        [
          { key: "title", label: "Project" },
          { key: "party", label: "Client" },
          { key: "status", label: "Status" },
          { key: "budget", label: "Budget", render: (r) => ui.money(r.budget, r.currency || cur) },
          { key: "billed", label: "Billed" },
          { key: "milestones", label: "Milestones" },
          { key: "progress", label: "Progress" },
          { key: "actions", label: "" },
        ],
        [], { emptyText: "" }
      ) + "</div>";
    // render rows async
    (async () => {
      const rowsEl = panel.querySelector(".erp-table-wrap tbody");
      if (!rowsEl) return;
      let html = "";
      for (const p of projects) {
        const metrics = await P.projectMetrics(p);
        html += projectRowHtml(p, metrics, partiesMap);
      }
      rowsEl.innerHTML = html || '<tr><td colspan="8" class="erp-empty">No projects yet.</td></tr>';
    })();
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "pj-new") openProjectForm(state, refresh);
      else if (act === "pj-open") {
        const p = allDocs.find((r) => String(r.id) === String(arg));
        if (p) openProjectModal(p, state, refresh);
      }
    });
  }

  function openProjectForm(state, refresh) {
    const { partiesAll, cur } = state;
    const m = ui.modal({
      title: "New project", size: "lg",
      body: ui.form(
        ui.field("Client", ui.select("partyId", "", [{ value: "", label: "— none —" }].concat(partiesAll.map((pt) => ({ value: pt.id, label: pt.name + " (" + pt.type + ")" }))), "")),
        ui.text("title", "Title", ""),
        ui.number("budget", "Budget", 0, { min: 0 }),
        ui.text("currency", "Currency", cur),
        ui.dateInput("startDate", "Start date", ui.today()),
        ui.dateInput("endDate", "End date", ""),
        ui.textarea("description", "Description", "", 3),
        ui.field("Status", ui.select("status", "", Object.keys(PJ).map((k) => ({ value: k, label: PJ[k].label })), "planned")),
        ui.btn("Create project", { primary: true, act: "pj-create" })
      ),
    });
    m.querySelector("[data-act=pj-create]").onclick = async () => {
      const f = ui.collect(m, ["partyId", "title", "budget", "currency", "startDate", "endDate", "description", "status"]);
      try {
        const p = await P.createProject({
          partyId: f.partyId, title: f.title, budget: f.budget, currency: f.currency,
          startDate: f.startDate, endDate: f.endDate, description: f.description, status: f.status,
        });
        ui.closeModal();
        ui.toast("Project " + p.projNum + " created.");
        refresh();
      } catch (e) { alert(e.message); }
    };
  }

  function renderTasks(panel, state, refresh) {
    const { allDocs, partiesMap } = state;
    const projects = P.byKind(allDocs, "project");
    const projMap = {};
    projects.forEach((pp) => { projMap[String(pp.id)] = pp; });
    const tasks = P.byKind(allDocs, "task").slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const filterProj = panel.__fProj || "";
    const filterStatus = panel.__fStatus || "";
    const filterAssignee = panel.__fAssignee || "";
    const shown = tasks.filter((t) =>
      (!filterProj || String(t.projectId) === filterProj) &&
      (!filterStatus || t.status === filterStatus) &&
      (!filterAssignee || (t.assignee || "") === filterAssignee)
    );
    const assignees = Array.from(new Set(tasks.map((t) => t.assignee).filter(Boolean)));
    panel.innerHTML =
      '<div class="erp-inline-form erp-filters">' +
        ui.select("f-proj", "", [{ value: "", label: "All projects" }].concat(projects.map((pp) => ({ value: pp.id, label: pp.title }))), filterProj) +
        ui.select("f-status", "", [{ value: "", label: "All statuses" }].concat(Object.keys(TK).map((k) => ({ value: k, label: TK[k].label }))), filterStatus) +
        ui.select("f-assignee", "", [{ value: "", label: "All assignees" }].concat(assignees.map((a) => ({ value: a, label: a }))), filterAssignee) +
      "</div>" +
      '<div class="erp-table-wrap">' + ui.table(
        [
          { key: "title", label: "Task", render: (r) => "<b>" + esc(r.title) + "</b>" },
          { key: "project", label: "Project", render: (r) => {
              const pp = projMap[String(r.projectId)];
              return pp ? "<b>" + esc(pp.title) + "</b>" + (pp.projNum ? "<div class=\"erp-sub\">" + esc(pp.projNum) + "</div>" : "") : "—";
            } },
          { key: "assignee", label: "Assignee", render: (r) => esc(r.assignee || "—") },
          { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, TK) },
          { key: "dueDate", label: "Due", render: (r) => r.dueDate ? ui.date(r.dueDate) + (ui.diffDays(ui.today(), r.dueDate) < 0 && r.status !== "done" ? " " + ui.badge("overdue", "danger") : "") : "—" },
          { key: "actions", label: "", render: (r) => {
              const pp = projMap[String(r.projectId)];
              return (r.status !== "done" ? ui.btn("Mark done", { small: true, act: "tk-done", arg: String(r.id) }) : ui.btn("Reopen", { small: true, act: "tk-reopen", arg: String(r.id) })) +
                (pp ? ui.btn("Open project", { small: true, act: "tk-open", arg: String(pp.id) }) : "");
            } },
        ],
        shown, { emptyText: "No tasks match." }
      ) + "</div>";
    panel.querySelector("[name=f-proj]").addEventListener("change", (e) => { panel.__fProj = e.target.value; renderTasks(panel, state, refresh); });
    panel.querySelector("[name=f-status]").addEventListener("change", (e) => { panel.__fStatus = e.target.value; renderTasks(panel, state, refresh); });
    panel.querySelector("[name=f-assignee]").addEventListener("change", (e) => { panel.__fAssignee = e.target.value; renderTasks(panel, state, refresh); });
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      const rec = allDocs.find((r) => String(r.id) === String(arg));
      try {
        if (act === "tk-done") { const p = projMap[String(rec.projectId)]; if (p) await P.setTaskStatus(p, rec, "done"); }
        else if (act === "tk-reopen") { const p = projMap[String(rec.projectId)]; if (p) await P.setTaskStatus(p, rec, "todo"); }
        else if (act === "tk-open") { const p = allDocs.find((r) => String(r.id) === String(arg)); if (p) openProjectModal(p, state, refresh); return; }
        else return;
        renderTasks(panel, state, refresh);
      } catch (e) { alert(e.message); }
    });
  }

  function renderTimesheets(panel, state, refresh) {
    const { allDocs, cur } = state;
    const projects = P.byKind(allDocs, "project");
    const projMap = {};
    projects.forEach((pp) => { projMap[String(pp.id)] = pp; });
    const time = P.byKind(allDocs, "timeEntry").slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const filterProj = panel.__fProj2 || "";
    const shown = time.filter((t) => !filterProj || String(t.projectId) === filterProj);
    let hours = 0, billableHours = 0, billableValue = 0, unbilledValue = 0;
    for (const t of shown) {
      hours += Number(t.hours) || 0;
      if (t.billable) {
        billableHours += Number(t.hours) || 0;
        const v = (Number(t.hours) || 0) * (Number(t.rate) || 0);
        billableValue += v;
        if (!t.invoiceId) unbilledValue += v;
      }
    }
    panel.innerHTML =
      ui.summary([
        { label: "Hours", value: ui.fmt(hours) + "h" },
        { label: "Billable hours", value: ui.fmt(billableHours) + "h" },
        { label: "Billable value", value: ui.money(billableValue, cur) },
        { label: "Unbilled", value: ui.money(unbilledValue, cur) },
      ]) +
      '<div class="erp-inline-form erp-filters">' +
        ui.select("f-proj2", "", [{ value: "", label: "All projects" }].concat(projects.map((pp) => ({ value: pp.id, label: pp.title }))), filterProj) +
      "</div>" +
      '<div class="erp-table-wrap">' + ui.table(
        [
          { key: "date", label: "Date", render: (r) => ui.date(r.date) },
          { key: "project", label: "Project", render: (r) => {
              const pp = projMap[String(r.projectId)];
              return pp ? esc(pp.title) : "—";
            } },
          { key: "task", label: "Task", render: (r) => {
              const pp = projMap[String(r.projectId)];
              const task = pp ? allDocs.find((x) => x.kind === "task" && String(x.id) === String(r.taskId)) : null;
              return task ? esc(task.title) : "—";
            } },
          { key: "hours", label: "Hours", render: (r) => ui.fmt(r.hours) },
          { key: "billable", label: "Billable", render: (r) => (r.billable ? ui.badge("Yes", "success") : ui.badge("No", "muted")) },
          { key: "value", label: "Value", render: (r) => (r.billable ? ui.money((Number(r.hours) || 0) * (Number(r.rate) || 0), (projMap[String(r.projectId)] || {}).currency || cur) : "—") },
          { key: "invoice", label: "Invoiced", render: (r) => (r.invoiceId ? ui.badge(r.invoiceNum || "Invoiced", "info") : "—") },
        ],
        shown, { emptyText: "No time entries yet." }
      ) + "</div>";
    const sel = panel.querySelector("[name=f-proj2]");
    if (sel) sel.addEventListener("change", (e) => { panel.__fProj2 = e.target.value; renderTimesheets(panel, state, refresh); });
  }

  function renderPorts(panel, state, refresh) {
    const bundle = { schema: "erp-project-bundles", version: 1, exportedAt: new Date().toISOString() };
    P.exportBundle().then((b) => { bundle.projects = b.projects; bundle.summary = b.summary; panel.__bundleJson = JSON.stringify(b, null, 2); const pre = panel.querySelector("[data-bundle-preview]"); if (pre) pre.textContent = b.summary.projects + " project(s), " + b.summary.milestoneCount + " milestone(s), " + b.summary.taskCount + " task(s)."; });
    panel.innerHTML =
      ui.grid([
        ui.card("Ingest a bundle",
          '<p class="erp-alert">Paste JSON from the <b>project-master</b> (erp-project-seeds, e.g. exported from CRM won opportunities), a full <b>erp-project-bundles</b> export, or <b>the-ledger</b> receipts (erp-ledger-receipts). Projects are matched by their source id, never duplicated.</p>' +
          '<textarea class="erp-code-input" data-ingest-json rows="8" placeholder=\'{ "schema": "erp-project-seeds", "projects": [ … ] }\'></textarea>' +
          '<div class="erp-btn-row">' + ui.btn("Preview", { act: "port-preview" }) + ui.btn("Import", { primary: true, act: "port-import" }) + "</div>" +
          "<div data-port-result></div>"),
        ui.card("Publish project bundle",
          '<p class="erp-alert">Export the full project/billing-event state (projects, milestones, tasks, time, expenses) as JSON for the earlier pipeline.</p>' +
          '<div class="erp-btn-row">' + ui.btn("Download bundle.json", { act: "port-download" }) + ui.btn("Copy to clipboard", { act: "port-copy" }) + "</div>" +
          '<p class="erp-sub" data-bundle-preview>Building preview…</p>'),
      ]);
    ui.bind(panel, "click", "[data-act]", async (t, e, act) => {
      const resultCtn = panel.querySelector("[data-port-result]");
      if (act === "port-preview") {
        let parsed;
        try { parsed = JSON.parse(panel.querySelector("[data-ingest-json]").value.trim()); }
        catch (err) { resultCtn.innerHTML = ui.alert("Could not parse that JSON: " + err.message, "error"); return; }
        const schema = parsed.schema || "(none)";
        if (schema === "erp-project-seeds") resultCtn.innerHTML = ui.alert("Project seeds: " + (parsed.projects || []).length + " project(s) ready to import.", "info");
        else if (schema === "erp-project-bundles") resultCtn.innerHTML = ui.alert("Project bundle: " + (parsed.projects || []).length + " project(s) ready to import.", "info");
        else if (schema === "erp-ledger-receipts") resultCtn.innerHTML = ui.alert("Ledger receipts: " + (parsed.events || []).length + " event(s) ready to append to project timelines.", "info");
        else resultCtn.innerHTML = ui.alert("Unrecognised schema \"" + esc(schema) + "\".", "error");
      } else if (act === "port-import") {
        let parsed;
        try { parsed = JSON.parse(panel.querySelector("[data-ingest-json]").value.trim()); }
        catch (err) { resultCtn.innerHTML = ui.alert("Could not parse that JSON: " + err.message, "error"); return; }
        t.disabled = true; t.textContent = "Importing…";
        try {
          const res = await P.ingestBundle(parsed);
          resultCtn.innerHTML = ui.alert("Imported " + res.schema + " — " + res.created + " project(s) created, " + res.updated + " matched, " + res.events + " event(s) appended.", "success");
          refresh();
        } catch (err) {
          resultCtn.innerHTML = ui.alert(err.message, "error");
        }
        t.disabled = false; t.textContent = "Import";
      } else if (act === "port-download") {
        const json = await P.exportBundle();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "erp-project-bundle.json";
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      } else if (act === "port-copy") {
        const json = await P.exportBundle();
        try {
          await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
          resultCtn.innerHTML = ui.alert("Bundle copied to clipboard.", "success");
        } catch (err) {
          resultCtn.innerHTML = ui.alert("Copy failed — select the text area manually.", "error");
        }
      }
    });
  }

  /* ─────────────────────────── module renderer ─────────────────────────── */

  P.renderPanel = async function (ctx) {
    const el = ctx.el;
    let state;
    try {
      const allDocs = await docs();
      const partiesAll = await master.parties();
      const catalog = await master.catalog();
      const taxes = await master.taxes();
      const cur = await master.currency();
      const partiesMap = {};
      partiesAll.forEach((p) => { partiesMap[String(p.id)] = p.name; });
      state = { allDocs, partiesAll, partiesMap, catalog, taxes, cur, el };
    } catch (e) {
      ctx.error({ title: "Could not load Projects data", message: (e && e.message) || String(e) });
      return;
    }

    const tabDefs = [
      { id: "projects", label: "Projects", badge: String(P.byKind(state.allDocs, "project").length) },
      { id: "tasks", label: "Tasks", badge: String(P.byKind(state.allDocs, "task").length) },
      { id: "timesheets", label: "Timesheets", badge: String(P.byKind(state.allDocs, "timeEntry").length) },
      { id: "ports", label: "Ports" },
    ];
    const active = el.__tab || "projects";
    const t = ui.tabs(tabDefs, active);
    el.innerHTML = ui.pageHead("Projects", "Projects, tasks, time and progress billing.", "") + t.html;

    const panels = {};
    el.querySelectorAll("[data-panel]").forEach((p) => { panels[p.getAttribute("data-panel")] = p; });
    el.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === active));

    ui.bind(el, "click", "[data-tab]", async (tEl) => {
      el.__tab = tEl.getAttribute("data-tab");
      ui.showTab(el, el.__tab);
      await renderPanel(el.__tab);
    });

    const refresh = async () => {
      P.invalidate();
      state.allDocs = await docs();
      state.partiesAll = await master.parties();
      state.partiesMap = {};
      state.partiesAll.forEach((p) => { state.partiesMap[String(p.id)] = p.name; });
      state.cur = await master.currency();
      await renderPanel(el.__tab || "projects");
    };

    const renderPanel = async (id) => {
      const p = panels[id];
      if (!p) return;
      if (id === "projects") await renderProjects(p, state, refresh);
      else if (id === "tasks") await renderTasks(p, state, refresh);
      else if (id === "timesheets") await renderTimesheets(p, state, refresh);
      else if (id === "ports") await renderPorts(p, state, refresh);
    };

    await renderPanel(active);
  };

  P.render = P.renderPanel;
})();
