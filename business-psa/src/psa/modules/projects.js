import { registerModule, moduleShell, h, el, icon, tabs, toast, modal, moneyFmt, dateFmt, dateShort, pctFmt, numFmt, addDays, todayIso, downloadFile, confirmModal, daysBetween } from "../core.js";
import { renderCrud, openForm } from "../crud.js";
import store from "../store.js";
import { collectionStatusEl } from "../store-ui.js";
import { snapshot, byId, projectActuals, budgetVsActual, healthOf, profitability, unbilledTotals, projectPaymentState } from "../derive.js";
import { createProjectFromTemplate, applyScopeChange } from "../workflow.js";
import { publishProjectState } from "../pipeline.js";
import hub from "../hub.js";

const TABS = [
  { id: "projects", label: "Projects", href: "projects" },
  { id: "workplans", label: "Work plans", href: "projects/workplans" },
  { id: "schedule", label: "Schedule", href: "projects/schedule" },
  { id: "templates", label: "Templates", href: "projects/templates" },
  { id: "changes", label: "Scope changes", href: "projects/changes" },
];

function clientName(id) {
  const c = store.getRecord("clients", id);
  return c ? c.name : "—";
}
function clientOpts() { return store.getAllRecords("clients").map((c) => ({ value: c.id, label: c.name })); }
function projectOpts() { return store.getAllRecords("projects").map((p) => ({ value: p.id, label: p.name })); }
function resourceOpts() { return store.getAllRecords("resources").map((r) => ({ value: r.id, label: r.name })); }
function sowOpts() { return store.getAllRecords("sows").map((s) => ({ value: s.id, label: s.name })); }

function healthBadge(p, D) {
  const hh = healthOf(p, D);
  if (hh.kind === "ok") return '<span class="badge badge-ok">On track</span>';
  if (hh.kind === "warn") return '<span class="badge badge-warn">At risk</span>';
  if (hh.kind === "danger") return '<span class="badge badge-err">Over budget</span>';
  return '<span class="badge badge-muted">Closed</span>';
}

const projectFields = [
  { key: "name", label: "Project name", type: "text", required: true, placeholder: "Acme data migration" },
  { key: "clientId", label: "Client", type: "select", options: clientOpts, required: true },
  { key: "sowId", label: "Statement of work", type: "select", options: sowOpts },
  { key: "code", label: "Code", type: "text", placeholder: "ACME-MIG" },
  { key: "status", label: "Status", type: "select", options: ["planning", "active", "paused", "closed"].map((s) => ({ value: s, label: s })), default: "planning" },
  { key: "billingMethod", label: "Billing method", type: "select", options: ["tm", "fixed", "milestone"].map((s) => ({ value: s, label: s === "tm" ? "Time & materials" : s === "fixed" ? "Fixed fee" : "Milestone" })), default: "tm" },
  { key: "plannedStart", label: "Planned start", type: "date" },
  { key: "plannedEnd", label: "Planned end", type: "date" },
  { key: "budgetHours", label: "Budget (hours)", type: "number", default: 0 },
  { key: "budgetCost", label: "Budget (internal cost)", type: "money", default: 0 },
  { key: "budgetValue", label: "Budget (billable value)", type: "money", default: 0 },
  { key: "taxRate", label: "Tax rate (%)", type: "number", default: 0 },
  { key: "phases", label: "Phases (name per line)", type: "lines" },
  { key: "milestones", label: "Milestones (title | value | dueDate)", type: "lines" },
  { key: "scope", label: "Scope", type: "textarea" },
];

function parseLinesRecord(rec) {
  rec.phases = (rec.phases || []).map((l, i) => Array.isArray(l) ? { id: "ph-" + (i + 1), name: l[0] || "Phase " + (i + 1), order: i, status: "pending" } : l);
  const oldMs = (store.getRecord("projects", rec.id) || {}).milestones || [];
  rec.milestones = (rec.milestones || []).map((l, i) => {
    const arr = Array.isArray(l) ? l : [];
    const prev = oldMs[i] || {};
    return { id: prev.id || "ms-" + (i + 1), title: arr[0] || "Milestone " + (i + 1), value: Number(arr[1]) || 0, dueDate: arr[2] || null, status: prev.status || "pending", completedAt: prev.completedAt || null };
  });
  if (!rec.createdAt) rec.createdAt = new Date().toISOString();
}

const projectColumns = [
  { key: "name", label: "Project", render: (r) => "<strong>" + h(r.name) + "</strong>" + (r.code ? "<div class='cell-sub'>" + h(r.code) + "</div>" : "") },
  { key: "clientId", label: "Client", render: (r) => h(clientName(r.clientId)) },
  { key: "status", label: "Status", render: (r) => '<span class="badge badge-' + (r.status === "closed" ? "muted" : r.status === "active" ? "ok" : r.status === "paused" ? "warn" : "accent") + '">' + h(r.status) + "</span>" },
  { key: "health", label: "Health", render: (r) => healthBadge(r, null) },
  { key: "budget", label: "Budget burn", render: (r) => {
      const b = budgetVsActual(r, null);
      const pct = Math.min(1, Math.max(0, b.pctSpentCost || 0));
      return '<div class="burn"><div class="burn-bar" style="width:' + Math.round(pct * 100) + '%"></div><span>' + pctFmt(b.pctSpentCost) + "</span></div>";
    } },
  { key: "plannedEnd", label: "Ends", render: (r) => h(dateShort(r.plannedEnd)) },
];

function projectDetailActions(rec, ctx) {
  const D = snapshot();
  const acts = [];
  if (rec.status !== "closed") {
    acts.push({ label: "Close project", kind: "btn-ghost", onClick: async () => {
        confirmModal({ title: "Close project?", message: "Closing marks the project complete and stops health tracking. Time/expense still roll up for reporting.", confirmLabel: "Close project", onConfirm: async () => {
            const auth = await hub.requireAction("project.close", "closed project " + rec.name);
            if (!auth.ok) return;
            await store.saveRecord("projects", Object.assign({}, rec, { status: "closed", closedAt: new Date().toISOString() }));
            hub.recordAudit("project.close", "closed project " + rec.name, auth.actor).catch(() => {});
            toast("Project closed");
            ctx.refresh();
          } });
      } });
  }
  acts.push({ label: "Health snapshot", icon: "reports", onClick: () => openHealthSnapshot(rec) });
  acts.push({ label: "Publish to pipeline", icon: "box", onClick: async () => {
      const auth = await hub.requireAction("pipeline.publish", "published project state " + rec.name);
      if (!auth.ok) return;
      try { const m = await publishProjectState(rec.id); hub.recordAudit("pipeline.publish", "published project state " + rec.name, auth.actor).catch(() => {}); toast("Project state published as bundle " + m.name.slice(0, 18) + "…"); }
      catch (e) { toast(e.message || "Publish failed", "err"); }
    } });
  acts.push({ label: "Open schedule", onClick: () => { location.hash = "#/projects/schedule"; } });
  return acts;
}

function projectDerive(rec) {
  const D = snapshot();
  const bva = budgetVsActual(rec, D);
  const pr = profitability(rec, D);
  const unb = unbilledTotals(rec, D);
  const pay = projectPaymentState(rec, D);
  const bar = (pct, cls) => '<div class="burn"><div class="burn-bar ' + cls + '" style="width:' + Math.round(Math.min(1, pct) * 100) + '%"></div></div>';
  const hh = healthOf(rec, D);
  return { html:
    '<div class="derive-grid">' +
    stat("Health", healthBadge(rec, D)) +
    stat("Hours", numFmt(bva.actuals.hours) + " / " + numFmt(bva.budgetHours) + " (spent " + pctFmt(bva.pctSpentHours) + ")", bar(bva.pctSpentHours, bva.overBudgetHours ? "err" : "")) +
    stat("Cost", moneyFmt(bva.actuals.cost, rec.currency || "USD") + " / " + moneyFmt(bva.budgetCost, rec.currency || "USD"), bar(bva.pctSpentCost, bva.overBudgetHours ? "err" : "")) +
    stat("Forecast EAC", moneyFmt(bva.eacCost, rec.currency || "USD") + " (cost)", "") +
    stat("Revenue", moneyFmt(pr.revenue, rec.currency || "USD") + " · " + "Profit " + moneyFmt(pr.profit, rec.currency || "USD") + " · margin " + (pr.margin == null ? "—" : pctFmt(pr.margin)), "") +
    stat("Unbilled", numFmt(unb.hours) + "h · " + moneyFmt(unb.revenue, rec.currency || "USD"), "") +
    stat("Billing", pay.count + " invoice" + (pay.count === 1 ? "" : "s") + " · outstanding " + moneyFmt(pay.outstanding, rec.currency || "USD"), "") +
    stat("Schedule", rec.plannedEnd ? (hh.behindDays > 0 ? "behind by " + hh.behindDays + "d" : "on schedule") : "no end date", "") +
    "</div>"
  };
  function stat(label, value, extra) { return "<div class='derive-stat'><div class='derive-label'>" + label + "</div><div class='derive-value'>" + value + "</div>" + (extra || "") + "</div>"; }
}

function projectDetailSections(rec, ctx) {
  return [
    (r) => {
      const D = snapshot();
      const entries = D.timesheets.filter((t) => t.projectId === r.id);
      const exps = D.expenses.filter((e) => e.projectId === r.id);
      const tasks = D.workplans.filter((t) => t.projectId === r.id);
      const wrap = el("div", "psa-derive");
      wrap.innerHTML = "<h5>Work plan</h5><p class='dim'>" + tasks.length + " task" + (tasks.length === 1 ? "" : "s") + ", " + tasks.filter((t) => t.status === "done").length + " done.</p>" +
        "<h5>Logged time</h5><p class='dim'>" + entries.length + " entr" + (entries.length === 1 ? "y" : "ies") + " (" + numFmt(entries.reduce((s, t) => s + (t.hours || 0), 0)) + "h)</p>" +
        "<h5>Expenses</h5><p class='dim'>" + exps.length + " (" + moneyFmt(exps.reduce((s, e) => s + (e.amount || 0), 0), r.currency || "USD") + ")</p>";
      return wrap;
    }
  ];
}

function openHealthSnapshot(rec) {
  const D = snapshot();
  const bva = budgetVsActual(rec, D);
  const hh = healthOf(rec, D);
  const unb = unbilledTotals(rec, D);
  const pay = projectPaymentState(rec, D);
  const changes = D.scopechanges.filter((c) => c.projectId === rec.id);
  const body = el("div", "psa-health");
  const firm = (window.__psa && window.__psa.firmName) || "PSA";
  body.innerHTML =
    '<div class="health-head"><div><h2>' + h(rec.name) + "</h2><p>" + h(clientName(rec.clientId)) + " · " + h(rec.code || "") + " · generated " + new Date().toLocaleString() + "</p></div><span class='health-badge'>" + healthBadge(rec, D) + "</span></div>" +
    '<div class="derive-grid">' +
    '<div class="derive-stat"><div class="derive-label">Budget burn (cost)</div><div class="derive-value">' + pctFmt(bva.pctSpentCost) + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Hours</div><div class="derive-value">' + numFmt(bva.actuals.hours) + " / " + numFmt(bva.budgetHours) + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Cost</div><div class="derive-value">' + moneyFmt(bva.actuals.cost, rec.currency || "USD") + " / " + moneyFmt(bva.budgetCost, rec.currency || "USD") + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Forecast cost</div><div class="derive-value">' + moneyFmt(bva.eacCost, rec.currency || "USD") + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Schedule</div><div class="derive-value">' + (rec.plannedEnd ? (hh.behindDays > 0 ? "Behind by " + hh.behindDays + " days" : "On schedule") : "No end date") + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Logged time</div><div class="derive-value">' + numFmt(bva.actuals.hours) + "h</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Unbilled</div><div class="derive-value">' + numFmt(unb.hours) + "h · " + moneyFmt(unb.revenue, rec.currency || "USD") + "</div></div>" +
    '<div class="derive-stat"><div class="derive-label">Outstanding</div><div class="derive-value">' + moneyFmt(pay.outstanding, rec.currency || "USD") + "</div></div>" +
    "</div>";
  if (changes.length) {
    body.innerHTML += "<h5>Open scope changes / risks</h5><ul class='health-list'>" + changes.filter((c) => c.status === "open").map((c) => "<li>" + h(c.title) + " — " + (c.impactHours || 0) + "h / " + (c.impactValue || 0) + " value</li>").join("") + "</ul>";
  }
  modal({
    title: "Project health snapshot",
    body,
    wide: true,
    actions: [
      { label: "Print / PDF", icon: "reports", onClick: () => {
          const w = window.open("", "_blank");
          if (!w) { toast("Allow pop-ups to print", "err"); return; }
          w.document.write("<html><head><title>" + h(rec.name) + " — health snapshot</title><style>body{font-family:Inter,sans-serif;padding:30px;color:#111}.badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px}.badge-ok{background:#dcfce7;color:#15803d}.badge-warn{background:#fef3c7;color:#b45309}.badge-err{background:#fee2e2;color:#b91c1c}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left}h2{margin:0}</style></head><body>" + body.innerHTML + "<p style='color:#888;margin-top:20px'>" + firm + " · generated " + new Date().toLocaleString() + "</p></body></html>");
          w.document.close();
          w.focus();
          setTimeout(() => w.print(), 400);
        } }
    ]
  });
}

function projectModuleRender(view, route) {
  const active = route.parts[0] || "projects";
  const sec = moduleShell("projects");
  view.appendChild(sec);
  sec.appendChild(tabs(active, TABS));
  if (active === "projects" || !["projects", "workplans", "schedule", "templates", "changes"].includes(active)) {
    return renderCrud(sec, {
      collection: "projects",
      moduleId: "projects",
      title: "Projects",
      subtitle: "Work tied to clients and approved statements of work — phases, milestones, budgets, health.",
      singular: "Project",
      newLabel: "Add project",
      columns: projectColumns,
      fields: projectFields,
      searchKeys: ["name", "code", "scope"],
      sortBy: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
      onBeforeSave: parseLinesRecord,
      derive: projectDerive,
      detailActions: projectDetailActions,
      detailSections: projectDetailSections,
      emptyState: { title: "No projects yet", message: "Add a project directly or approve a SOW to seed one automatically.", action: { label: "Add project" } },
    });
  }
  if (active === "workplans") {
    return renderWorkplans(sec);
  }
  if (active === "schedule") {
    return renderSchedule(sec);
  }
  if (active === "templates") {
    return renderTemplates(sec);
  }
  if (active === "changes") {
    return renderChanges(sec);
  }
  return Promise.resolve();
}

// ---- work plans ----

function workplanFields() {
  return [
    { key: "projectId", label: "Project", type: "select", options: projectOpts, required: true },
    { key: "name", label: "Task name", type: "text", required: true },
    { key: "role", label: "Role", type: "text", placeholder: "Consultant" },
    { key: "requiredSkills", label: "Required skills", type: "tags" },
    { key: "effortHours", label: "Effort (hours)", type: "number", default: 0 },
    { key: "plannedStart", label: "Planned start", type: "date" },
    { key: "plannedEnd", label: "Planned end", type: "date" },
    { key: "dependsOn", label: "Depends on", type: "multiselect", options: (fv) => {
        const pid = fv.projectId;
        return store.getAllRecords("workplans").filter((t) => t.projectId === pid).map((t) => ({ value: t.id, label: t.name }));
      } },
    { key: "assigneeId", label: "Assignee", type: "select", options: resourceOpts },
    { key: "phase", label: "Phase", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["notstarted", "inprogress", "blocked", "done"].map((s) => ({ value: s, label: s })), default: "notstarted" },
  ];
}

async function renderWorkplans(sec) {
  const host = el("div", "psa-list");
  sec.appendChild(host);
  await renderCrud(host, {
    collection: "workplans",
    moduleId: "projects",
    title: "Work plans",
    subtitle: "Task breakdown per project — the plan both scheduling and timesheets reference.",
    singular: "Task",
    newLabel: "Add task",
    columns: [
      { key: "name", label: "Task", render: (r) => "<strong>" + h(r.name) + "</strong>" + (r.phase ? "<div class='cell-sub'>" + h(r.phase) + "</div>" : "") },
      { key: "projectId", label: "Project", render: (r) => { const p = store.getRecord("projects", r.projectId); return h(p ? p.name : "—"); } },
      { key: "role", label: "Role" },
      { key: "assigneeId", label: "Assignee", render: (r) => { const x = store.getRecord("resources", r.assigneeId); return h(x ? x.name : "—"); } },
      { key: "effortHours", label: "Effort", render: (r) => h(String(r.effortHours) + "h") },
      { key: "plannedEnd", label: "Due", render: (r) => h(dateShort(r.plannedEnd)) },
      { key: "status", label: "Status", render: (r) => '<span class="badge badge-' + (r.status === "done" ? "ok" : r.status === "blocked" ? "err" : r.status === "inprogress" ? "accent" : "muted") + '">' + h(r.status) + "</span>" },
    ],
    fields: workplanFields(),
    searchKeys: ["name", "role", "phase"],
    sortBy: (a, b) => (a.projectId || "").localeCompare(b.projectId || "") || (a.plannedStart || "").localeCompare(b.plannedStart || ""),
    prefilter: {
      allLabel: "All projects",
      options: store.getAllRecords("projects").sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name })),
      filter: (r, value) => r.projectId === value,
    },
    emptyState: { title: "No tasks yet", message: "Break the project into tasks with estimates and dependencies.", action: { label: "Add task" } },
  });
}

// ---- schedule / gantt ----

async function renderSchedule(sec) {
  const projects = store.getAllRecords("projects");
  const header = el("div", "psa-page-head");
  header.appendChild(el("h1", "psa-page-title", h("Schedule")));
  sec.appendChild(header);
  const toolbar = el("div", "psa-crud-toolbar");
  const sel = el("select", "psa-filter-select");
  for (const p of projects.sort((a, b) => a.name.localeCompare(b.name))) {
    const o = el("option", "", h(p.name));
    o.value = p.id;
    sel.appendChild(o);
  }
  toolbar.appendChild(el("span", "psa-filter-label", "Project:"));
  toolbar.appendChild(sel);
  const saveBaseline = el("button", "btn btn-ghost btn-sm", "Save baseline");
  toolbar.appendChild(saveBaseline);
  sec.appendChild(toolbar);
  const host = el("div", "psa-schedule");
  sec.appendChild(host);

  function render() {
    const pid = sel.value;
    const p = store.getRecord("projects", pid);
    host.innerHTML = "";
    if (!p) { host.appendChild(el("p", "dim", h("Select a project to view its schedule."))); return; }
    const tasks = store.getAllRecords("workplans").filter((t) => t.projectId === pid).sort((a, b) => (a.plannedStart || "").localeCompare(b.plannedStart || ""));
    if (!tasks.length) { host.appendChild(el("p", "dim", h("No tasks in the work plan yet — add tasks first."))); return; }
    const weeks = [];
    let start = tasks.reduce((m, t) => m && t.plannedStart < m ? t.plannedStart : m, tasks[0].plannedStart) || todayIso();
    let end = tasks.reduce((m, t) => t.plannedEnd > m ? t.plannedEnd : m, p.plannedEnd || tasks[0].plannedEnd) || addDays(start, 56);
    let ws = start.slice(0, 7) + "-01";
    const d0 = new Date(start + "T00:00:00");
    d0.setDate(d0.getDate() - d0.getDay() + 1);
    ws = d0.toISOString().slice(0, 10);
    let we = new Date(end + "T00:00:00");
    const dayN = Math.max(6, Math.ceil((new Date(end + "T00:00:00") - new Date(ws + "T00:00:00")) / 86400000 / 7));
    for (let i = 0; i < Math.min(dayN + 1, 26); i++) {
      weeks.push(addDays(ws, i * 7));
    }
    const last = addDays(weeks[weeks.length - 1], 6);
    const grid = el("div", "gantt");
    const headRow = el("div", "gantt-row gantt-head");
    headRow.appendChild(el("div", "gantt-label", h("Task")));
    const weeksHead = el("div", "gantt-weeks");
    for (const w of weeks) weeksHead.appendChild(el("div", "gantt-week", h(dateShort(w))));
    headRow.appendChild(weeksHead);
    grid.appendChild(headRow);
    const taskById = byId(tasks);
    for (const t of tasks) {
      const row = el("div", "gantt-row");
      const lab = el("div", "gantt-label");
      const deps = (t.dependsOn || []).map((d) => taskById[d]).filter(Boolean).map((d) => d.name);
      lab.innerHTML = "<span class='gantt-name'>" + h(t.name) + "</span>" + (deps.length ? "<span class='gantt-deps'>↳ " + h(deps.join(", ")) + "</span>" : "");
      row.appendChild(lab);
      const weeksCell = el("div", "gantt-weeks");
      const s = t.plannedStart || ws;
      const e = t.plannedEnd || s;
      for (const w of weeks) {
        const we2 = addDays(w, 6);
        const cell = el("div", "gantt-week");
        if (s <= we2 && e >= w) {
          const bar = el("div", "gantt-bar gantt-" + (t.status === "done" ? "done" : t.status === "blocked" ? "blocked" : t.status === "inprogress" ? "active" : "planned"));
          bar.title = t.name + " (" + s + " → " + e + ")";
          cell.appendChild(bar);
        }
        weeksCell.appendChild(cell);
      }
      row.appendChild(weeksCell);
      grid.appendChild(row);
    }
    host.appendChild(grid);
    if (p.baseline) {
      const varCount = tasks.filter((t) => {
        const b = (p.baseline.tasks || {})[t.id];
        return b && b.end && t.plannedEnd && t.plannedEnd !== b.end;
      }).length;
      host.appendChild(el("p", "psa-baseline-note", h("Baseline saved " + new Date(p.baseline.savedAt).toLocaleString() + " — " + varCount + " task" + (varCount === 1 ? "" : "s") + " moved from baseline.")));
    }
  }

  saveBaseline.addEventListener("click", async () => {
    const pid = sel.value;
    if (!pid) return;
    const tasks = store.getAllRecords("workplans").filter((t) => t.projectId === pid);
    const taskMap = {};
    for (const t of tasks) taskMap[t.id] = { name: t.name, start: t.plannedStart, end: t.plannedEnd, status: t.status };
    const p = store.getRecord("projects", pid);
    await store.saveRecord("projects", Object.assign({}, p, { baseline: { savedAt: new Date().toISOString(), tasks: taskMap } }));
    toast("Baseline saved for this project");
    render();
  });

  sel.addEventListener("change", render);
  if (projects.length) { sel.value = projects[0].id; }
  render();
}

// ---- templates ----

const templateFields = [
  { key: "name", label: "Template name", type: "text", required: true },
  { key: "description", label: "Description", type: "textarea" },
  { key: "billingMethod", label: "Suggested billing", type: "select", options: ["tm", "fixed", "milestone"].map((s) => ({ value: s, label: s })), default: "tm" },
  { key: "budgetHours", label: "Budget (hours)", type: "number", default: 0 },
  { key: "budgetValue", label: "Budget (value)", type: "money", default: 0 },
  { key: "durationDays", label: "Typical duration (days)", type: "number", default: 30 },
  { key: "phases", label: "Phases (name per line)", type: "lines" },
  { key: "milestones", label: "Milestones (title | value)", type: "lines" },
  { key: "tasks", label: "Tasks (name | role | effortHours | startOffset | skills)", type: "lines" },
];

function parseTemplate(rec) {
  rec.phases = (rec.phases || []).map((l) => Array.isArray(l) ? (l[0] || "Phase") : l);
  rec.milestones = (rec.milestones || []).map((l, i) => Array.isArray(l) ? { title: l[0] || "Milestone " + (i + 1), value: Number(l[1]) || 0, dueDate: l[2] || null } : { title: String(l), value: 0, dueDate: null });
  rec.tasks = (rec.tasks || []).map((l, i) => Array.isArray(l) ? {
    name: l[0] || "Task " + (i + 1), role: l[1] || null, effortHours: Number(l[2]) || 0, startOffset: Number(l[3]) || 0,
    requiredSkills: l[4] ? l[4].split(",").map((s) => s.trim()).filter(Boolean) : [], order: i,
  } : { name: String(l), role: null, effortHours: 0, startOffset: 0, requiredSkills: [], order: i });
}

async function renderTemplates(sec) {
  await renderCrud(sec, {
    collection: "templates",
    moduleId: "projects",
    title: "Project templates",
    subtitle: "Reusable task breakdowns, milestone defaults and billing methods — create a fully populated project from one SOW approval.",
    singular: "Template",
    newLabel: "Add template",
    columns: [
      { key: "name", label: "Template", render: (r) => "<strong>" + h(r.name) + "</strong>" + (r.description ? "<div class='cell-sub'>" + h(r.description) + "</div>" : "") },
      { key: "billingMethod", label: "Billing" },
      { key: "tasks", label: "Tasks", render: (r) => (r.tasks || []).length },
      { key: "budgetHours", label: "Budget", render: (r) => h((r.budgetHours || 0) + "h") },
    ],
    fields: templateFields,
    searchKeys: ["name", "description"],
    onBeforeSave: parseTemplate,
    detailActions: (rec, ctx) => [{
      label: "Create project from template", icon: "box", onClick: async () => {
        const form = el("div", "psa-form");
        const fName = el("input", "psa-input", ""); fName.placeholder = "Project name"; fName.value = rec.name;
        const fClient = el("select", "psa-input", ""); 
        for (const c of store.getAllRecords("clients").sort((a, b) => a.name.localeCompare(b.name))) { const o = el("option", "", h(c.name)); o.value = c.id; fClient.appendChild(o); }
        form.appendChild(el("label", "psa-field-label", "Client")); form.appendChild(fClient);
        form.appendChild(el("label", "psa-field-label", "Project name")); form.appendChild(fName);
        modal({
          title: "Create project from template",
          body: form,
          actions: [
            { label: "Cancel" },
            { label: "Create project", kind: "btn-primary", onClick: async (btn) => {
                btn.disabled = true;
                try {
                  const p = await createProjectFromTemplate(rec, { clientId: fClient.value || null, name: fName.value || rec.name });
                  toast("Project created from template");
                  ctx.close();
                  location.hash = "#/projects/" + p.id;
                } catch (e) { toast(e.message || "Failed", "err"); btn.disabled = false; }
              } }
          ]
        });
      }
    }],
    emptyState: { title: "No templates yet", message: "Capture a reusable task breakdown so new SOW approvals create fully populated projects.", action: { label: "Add template" } },
  });
}

// ---- scope changes ----

const changeFields = [
  { key: "projectId", label: "Project", type: "select", options: projectOpts, required: true },
  { key: "sowId", label: "SOW", type: "select", options: sowOpts },
  { key: "title", label: "Title", type: "text", required: true },
  { key: "description", label: "Description", type: "textarea" },
  { key: "type", label: "Type", type: "select", options: ["add", "modify", "remove"].map((s) => ({ value: s, label: s })), default: "add" },
  { key: "impactHours", label: "Impact (hours)", type: "number", default: 0 },
  { key: "impactValue", label: "Impact (value)", type: "money", default: 0 },
  { key: "impactCost", label: "Impact (internal cost)", type: "money", default: 0 },
  { key: "impactEndDate", label: "Impact end date", type: "date" },
  { key: "requestedBy", label: "Requested by", type: "text" },
  { key: "status", label: "Status", type: "select", options: ["open", "approved", "rejected"].map((s) => ({ value: s, label: s })), default: "open" },
];

async function renderChanges(sec) {
  await renderCrud(sec, {
    collection: "scopechanges",
    moduleId: "projects",
    title: "Scope changes",
    subtitle: "Change requests linked to a SOW — approving one moves the project's budget and schedule and records a SOW revision.",
    singular: "Change request",
    newLabel: "Add change request",
    columns: [
      { key: "title", label: "Change", render: (r) => "<strong>" + h(r.title) + "</strong>" + (r.projectId ? "<div class='cell-sub'>" + h(store.getRecord("projects", r.projectId) ? store.getRecord("projects", r.projectId).name : "—") + "</div>" : "") },
      { key: "type", label: "Type", render: (r) => '<span class="badge badge-accent">' + h(r.type) + "</span>" },
      { key: "impactHours", label: "Impact", render: (r) => h((r.impactHours || 0) + "h · " + (r.impactValue || 0)) },
      { key: "status", label: "Status", render: (r) => '<span class="badge badge-' + (r.status === "approved" ? "ok" : r.status === "rejected" ? "err" : "warn") + '">' + h(r.status) + "</span>" },
    ],
    fields: changeFields,
    searchKeys: ["title", "description"],
    sortBy: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
    detailActions: (rec, ctx) => rec.status === "open" ? [{
      label: "Approve & apply", icon: "check", kind: "btn-primary", onClick: async () => {
        try {
          await applyScopeChange(Object.assign({}, rec, { status: "approved" }), "local");
          await store.saveRecord("scopechanges", Object.assign({}, rec, { status: "approved", approvedAt: new Date().toISOString(), approvedBy: "local" }));
          toast("Change approved — budget and schedule updated");
          ctx.refresh();
        } catch (e) { toast(e.message || "Could not apply", "err"); }
      }
    }, {
      label: "Reject", kind: "btn-danger", onClick: async () => {
        await store.saveRecord("scopechanges", Object.assign({}, rec, { status: "rejected", rejectedAt: new Date().toISOString() }));
        toast("Change rejected");
        ctx.refresh();
      }
    }] : [],
    emptyState: { title: "No scope changes yet", message: "When scope moves, log a change request so budget, schedule and SOW revisions stay consistent.", action: { label: "Add change request" } },
  });
}

registerModule({
  id: "projects",
  label: "Projects",
  icon: "projects",
  async render({ view, route }) {
    await projectModuleRender(view, route);
    const sec = view.querySelector(".psa-module");
    if (sec) sec.appendChild(await collectionStatusEl("projects"));
  }
});
