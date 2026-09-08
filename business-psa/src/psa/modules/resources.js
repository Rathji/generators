import { registerModule, moduleShell, h, el, icon, tabs, toast, modal, dateFmt, dateShort, numFmt, pctFmt, addDays, todayIso } from "../core.js";
import { renderCrud, openForm, openDetail } from "../crud.js";
import store from "../store.js";
import { collectionStatusEl } from "../store-ui.js";
import { snapshot, byId, weekStartIso, weekEndIso, capacityHeatmap, availableHoursForWeek, bookedHoursForWeek, taskSuggestions, overloads, skillGaps, appSettings } from "../derive.js";
import { saveSettings } from "../settings.js";

const TABS = [
  { id: "resources", label: "Pool", href: "resources" },
  { id: "allocations", label: "Allocations", href: "resources/allocations" },
  { id: "capacity", label: "Capacity", href: "resources/capacity" },
  { id: "suggestions", label: "Suggestions", href: "resources/suggestions" },
  { id: "conflicts", label: "Conflicts", href: "resources/conflicts" },
];

function resourceOpts() { return store.getAllRecords("resources").map((r) => ({ value: r.id, label: r.name })); }
function projectOpts() { return store.getAllRecords("projects").map((p) => ({ value: p.id, label: p.name })); }

const resourceFields = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "email", label: "Email", type: "email" },
  { key: "roles", label: "Roles", type: "tags", placeholder: "Consultant, Senior, PM" },
  { key: "skills", label: "Skills", type: "tags", placeholder: "SQL, Python, Data migration" },
  { key: "costRate", label: "Default cost rate", type: "money", default: 0 },
  { key: "targetUtilization", label: "Target utilization", type: "number", default: 0.8, step: 0.05, help: "Share of available hours targeted as billable (0.8 = 80%)" },
  { key: "availability", label: "Availability (start | end | type | hoursPerWeek)", type: "lines", placeholder: "2026-01-05 | 2026-01-09 | vacation | \n2026-02-01 | 2026-06-30 | parttime | 24" },
  { key: "active", label: "Active", type: "checkbox", default: true },
];

const resourceColumns = [
  { key: "name", label: "Person", render: (r) => "<strong>" + h(r.name) + "</strong>" + (r.email ? "<div class='cell-sub'>" + h(r.email) + "</div>" : "") },
  { key: "roles", label: "Roles", render: (r) => (r.roles || []).map((x) => '<span class="pill">' + h(x) + "</span>").join(" ") },
  { key: "skills", label: "Skills", render: (r) => (r.skills || []).slice(0, 4).map((x) => '<span class="pill pill-dim">' + h(x) + "</span>").join(" ") },
  { key: "costRate", label: "Cost rate", render: (r) => h((r.costRate || 0).toLocaleString()) },
  { key: "targetUtilization", label: "Target", render: (r) => h(pctFmt(r.targetUtilization)) },
  { key: "active", label: "Status", render: (r) => r.active === false ? '<span class="badge badge-muted">Inactive</span>' : '<span class="badge badge-ok">Active</span>' },
];

function parseResource(rec) {
  rec.availability = (rec.availability || []).map((l) => Array.isArray(l) ? {
    start: l[0] || null, end: l[1] || null, type: l[2] || "unavailable", hoursPerWeek: l[3] ? Number(l[3]) : null,
  } : l);
}

const allocFields = [
  { key: "resourceId", label: "Resource", type: "select", options: resourceOpts, required: true },
  { key: "projectId", label: "Project", type: "select", options: projectOpts, required: true },
  { key: "taskId", label: "Task", type: "select", options: (fv) => store.getAllRecords("workplans").filter((t) => t.projectId === fv.projectId).map((t) => ({ value: t.id, label: t.name })) },
  { key: "role", label: "Role", type: "text" },
  { key: "startDate", label: "Start", type: "date", required: true },
  { key: "endDate", label: "End", type: "date", required: true },
  { key: "hoursPerWeek", label: "Hours / week", type: "number", required: true, default: 40 },
  { key: "percentLoad", label: "Percent load", type: "number", default: 100 },
  { key: "override", label: "Over-allocation override", type: "checkbox", help: "Allow this allocation to exceed the person's available capacity (recorded for audit)." },
  { key: "overrideReason", label: "Override reason", type: "text", depends: (v) => !!v.override },
];

const allocColumns = [
  { key: "resourceId", label: "Person", render: (r) => { const x = store.getRecord("resources", r.resourceId); return h(x ? x.name : "—"); } },
  { key: "projectId", label: "Project", render: (r) => { const p = store.getRecord("projects", r.projectId); return h(p ? p.name : "—"); } },
  { key: "role", label: "Role" },
  { key: "hoursPerWeek", label: "Hours/wk", render: (r) => h(String(r.hoursPerWeek)) },
  { key: "range", label: "Range", render: (r) => h(dateShort(r.startDate) + " – " + dateShort(r.endDate)) },
  { key: "status", label: "Status", render: (r) => r.override ? '<span class="badge badge-warn">Override</span>' : '<span class="badge badge-ok">OK</span>' },
];

function allocValidate(v, rec) {
  const D = snapshot();
  const s = appSettings();
  const resource = D.resourcesById[v.resourceId];
  if (!resource) return null;
  const ws = weekStartIso(v.startDate);
  const we = weekEndIso(v.endDate);
  let week = ws;
  const limit = s.weekHours + s.overAllocTolerance;
  while (week <= we) {
    const available = availableHoursForWeek(resource, week);
    const bookedOther = bookedHoursForWeek(resource.id, week, D);
    const own = (rec && rec.id && rec.resourceId === v.resourceId) ? store.getRecord("allocations", rec.id) : null;
    const ownHours = own ? (Number(own.hoursPerWeek) || 0) : 0;
    const newBooked = bookedOther - ownHours + (Number(v.hoursPerWeek) || 0);
    if (!v.override && newBooked > available + s.overAllocTolerance) {
      return v.resourceId === (own && own.resourceId) ? null : (resource.name + " is already booked to " + numFmt(newBooked) + "h in the week of " + dateShort(week) + " (available " + numFmt(available) + "h). Enable the override to force it, or reduce hours.");
    }
    week = addDays(week, 7);
  }
  return null;
}

async function renderResourcesTab(sec) {
  await renderCrud(sec, {
    collection: "resources",
    moduleId: "resources",
    title: "Resource pool",
    subtitle: "The people who deliver your work — roles, skills, cost rates, target utilization and availability.",
    singular: "Person",
    newLabel: "Add person",
    columns: resourceColumns,
    fields: resourceFields,
    searchKeys: ["name", "email", "roles", "skills"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    onBeforeSave: parseResource,
    emptyState: { title: "No people yet", message: "Add your team so allocations, timesheets and utilization all reference the same people.", action: { label: "Add person" } },
  });
}

async function renderAllocationsTab(sec) {
  await renderCrud(sec, {
    collection: "allocations",
    moduleId: "resources",
    title: "Allocations",
    subtitle: "Assign people to work-plan tasks with hours per week and date ranges. Over-allocation is blocked unless an override is recorded.",
    singular: "Allocation",
    newLabel: "Add allocation",
    columns: allocColumns,
    fields: allocFields,
    searchKeys: [],
    sortBy: (a, b) => (a.startDate || "").localeCompare(b.startDate || ""),
    validate: allocValidate,
    onBeforeSave: (v) => {
      if (v.override) v.override = true;
      else v.override = false;
      if (!v.override) v.overrideReason = null;
    },
    emptyState: { title: "No allocations yet", message: "Book people onto projects and tasks — capacity and utilization derive from here.", action: { label: "Add allocation" } },
  });
}

async function renderCapacityTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Capacity & utilization")));
  sec.appendChild(head);
  const toolbar = el("div", "psa-crud-toolbar");
  const weeksSel = el("select", "psa-filter-select");
  for (const n of [6, 8, 12]) { const o = el("option", "", h(n + " weeks")); o.value = n; weeksSel.appendChild(o); }
  weeksSel.value = "8";
  toolbar.appendChild(el("span", "psa-filter-label", "Horizon:"));
  toolbar.appendChild(weeksSel);
  const tolBtn = el("button", "btn btn-ghost btn-sm", "Over-allocation tolerance: " + appSettings().overAllocTolerance + "h");
  toolbar.appendChild(tolBtn);
  sec.appendChild(toolbar);
  const host = el("div", "psa-capacity");
  sec.appendChild(host);

  tolBtn.addEventListener("click", () => {
    const inp = el("input", "psa-input", "");
    inp.type = "number"; inp.min = 0; inp.value = appSettings().overAllocTolerance;
    modal({
      title: "Over-allocation tolerance",
      body: el("div", "", (function(){ const w = el("div","psa-form"); w.appendChild(el("label","psa-field-label","Allow this many hours over capacity before blocking:")); w.appendChild(inp); return w; })()),
      actions: [
        { label: "Cancel" },
        { label: "Save", kind: "btn-primary", onClick: async (btn) => {
            btn.disabled = true;
            await saveSettings({ overAllocTolerance: Number(inp.value) || 0 });
            toast("Tolerance saved");
            tolBtn.textContent = "Over-allocation tolerance: " + appSettings().overAllocTolerance + "h";
            btn.closest(".psa-modal-overlay").remove();
            render();
          } }
      ]
    });
  });

  function render() {
    const weeks = Number(weeksSel.value);
    const D = snapshot();
    const resources = D.resources.filter((r) => r.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    host.innerHTML = "";
    if (!resources.length) { host.appendChild(el("p", "dim", h("Add people to the resource pool first."))); return; }
    const ws = weekStartIso(todayIso());
    const weekLabels = [];
    for (let i = 0; i < weeks; i++) weekLabels.push(addDays(ws, i * 7));
    const table = el("div", "gantt heatmap");
    const headRow = el("div", "gantt-row gantt-head");
    headRow.appendChild(el("div", "gantt-label", h("Person")));
    const weeksHead = el("div", "gantt-weeks");
    for (const w of weekLabels) weeksHead.appendChild(el("div", "gantt-week", h(dateShort(w).slice(0, 6))));
    headRow.appendChild(weeksHead);
    table.appendChild(headRow);
    for (const r of resources) {
      const hm = capacityHeatmap(r.id, weeks, D);
      const row = el("div", "gantt-row");
      const lab = el("div", "gantt-label");
      lab.innerHTML = "<span class='gantt-name'>" + h(r.name) + "</span>";
      row.appendChild(lab);
      const cells = el("div", "gantt-weeks");
      for (const u of hm) {
        const cell = el("div", "gantt-week");
        const pct = u.available > 0 ? u.booked / u.available : 0;
        cell.innerHTML = '<div class="util ' + (u.over ? "util-over" : pct > 0.8 ? "util-high" : "") + '" title="' + h(r.name) + " · " + dateFmt(u.ws) + " · booked " + u.booked + "/" + u.available + "h · actual " + u.actual + "h" + '">' + (u.booked ? Math.round(pct * 100) + "%" : "·") + "</div>";
        cells.appendChild(cell);
      }
      row.appendChild(cells);
      table.appendChild(row);
    }
    host.appendChild(table);
    const legend = el("div", "psa-legend");
    legend.innerHTML = '<span class="util util-ok">0–80%</span><span class="util util-high">80–100%</span><span class="util util-over">Over capacity</span>';
    host.appendChild(legend);
  }
  weeksSel.addEventListener("change", render);
  render();
}

async function renderSuggestionsTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Skill-based suggestions")));
  sec.appendChild(head);
  const toolbar = el("div", "psa-crud-toolbar");
  const projSel = el("select", "psa-filter-select");
  projSel.appendChild(el("option", "", h("All projects")));
  projSel.value = "";
  for (const p of store.getAllRecords("projects").sort((a, b) => a.name.localeCompare(b.name))) { const o = el("option", "", h(p.name)); o.value = p.id; projSel.appendChild(o); }
  toolbar.appendChild(el("span", "psa-filter-label", "Project:"));
  toolbar.appendChild(projSel);
  sec.appendChild(toolbar);
  const host = el("div", "psa-suggestions");
  sec.appendChild(host);
  function render() {
    const D = snapshot();
    let tasks = D.workplans.slice();
    if (projSel.value) tasks = tasks.filter((t) => t.projectId === projSel.value);
    host.innerHTML = "";
    if (!tasks.length) { host.appendChild(el("p", "dim", h("No tasks to suggest for — add work-plan tasks first."))); return; }
    for (const t of tasks.slice(0, 30)) {
      const sugg = taskSuggestions(t, D).slice(0, 5);
      const card = el("div", "sugg-card");
      const needs = [t.role, ...(t.requiredSkills || [])].filter(Boolean).map((x) => '<span class="pill pill-accent">' + h(x) + "</span>").join(" ");
      card.innerHTML = '<div class="sugg-head"><strong>' + h(t.name) + "</strong><span class='cell-sub'>" + h((store.getRecord("projects", t.projectId) || {}).name || "—") + "</span></div><div>" + (needs || "<span class='dim'>No role/skills specified</span>") + "</div>";
      const list = el("div", "sugg-list");
      if (!sugg.length) list.appendChild(el("p", "dim", h("No matching resources with free capacity.")));
      for (const s of sugg) {
        const row = el("button", "sugg-row");
        row.innerHTML = "<span><strong>" + h(s.resource.name) + "</strong> <span class='dim'>· " + h((s.resource.roles || []).join(", ")) + "</span></span><span class='sugg-free'>" + s.free + "h free</span>";
        row.addEventListener("click", () => {
          openForm({
            collection: "allocations", moduleId: "resources", singular: "Allocation", fields: allocFields,
            validate: allocValidate,
            onBeforeSave: (v) => { if (!v.override) v.override = false; if (!v.override) v.overrideReason = null; },
          }, () => {}, { resourceId: s.resource.id, projectId: t.projectId, taskId: t.id, role: t.role, startDate: t.plannedStart || todayIso(), endDate: t.plannedEnd || addDays(t.plannedStart || todayIso(), 14), hoursPerWeek: Math.min(40, Math.max(1, s.free || 8)) });
        });
        list.appendChild(row);
      }
      card.appendChild(list);
      host.appendChild(card);
    }
  }
  projSel.addEventListener("change", render);
  render();
}

async function renderConflictsTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Conflicts & overloads")));
  sec.appendChild(head);
  const host = el("div", "psa-conflicts");
  sec.appendChild(host);
  function render() {
    const D = snapshot();
    host.innerHTML = "";
    const ov = overloads(D);
    const gaps = skillGaps(D);
    const s = appSettings();
    const secTitle = (t, n, cls) => '<h3 class="conflict-sec ' + cls + '">' + t + ' <span class="badge ' + cls + '">' + n + "</span></h3>";
    if (ov.length) {
      host.innerHTML += secTitle("Over-allocation", ov.length, "badge-err") + '<div class="psa-conflict-list">' +
        ov.map((o) => '<div class="conflict-item"><div><strong>' + h(o.resource.name) + "</strong> — " + h(store.getRecord("projects", o.allocation.projectId) ? store.getRecord("projects", o.allocation.projectId).name : "—") + '<span class="dim"> · week of ' + dateShort(o.ws) + " · booked " + o.booked + "h vs " + o.available + "h (over by " + o.overBy + "h)</span></div><button class='btn btn-ghost btn-sm' data-alloc=" + h(o.allocation.id) + '">Record override</button></div>').join("") +
        "</div>";
    } else {
      host.innerHTML += secTitle("Over-allocation", 0, "badge-ok") + "<p class='dim'>No allocation exceeds available capacity (tolerance " + s.overAllocTolerance + "h).</p>";
    }
    if (gaps.length) {
      host.innerHTML += secTitle("Skill gaps", gaps.length, "badge-warn") + '<div class="psa-conflict-list">' +
        gaps.map((g) => '<div class="conflict-item"><strong>' + h(g.task.name) + "</strong> assigned to " + h(g.resource.name) + " but missing: " + g.missing.map((m) => '<span class="pill pill-dim">' + h(m) + "</span>").join(" ") + "</div>").join("") +
        "</div>";
    } else {
      host.innerHTML += secTitle("Skill gaps", 0, "badge-ok") + "<p class='dim'>Every assignment has the skills its task requires.</p>";
    }
    host.querySelectorAll("[data-alloc]").forEach((b) => b.addEventListener("click", () => {
      const a = store.getRecord("allocations", b.dataset.alloc);
      if (a) openDetail({
        collection: "allocations", moduleId: "resources", singular: "Allocation", fields: allocFields, validate: allocValidate,
        onBeforeSave: (v) => { if (!v.override) v.override = false; if (!v.override) v.overrideReason = null; },
      }, a, render);
    }));
  }
  render();
}

registerModule({
  id: "resources",
  label: "Resources",
  icon: "resources",
  async render({ view, route }) {
    const active = route.parts[0] || "resources";
    const sec = moduleShell("resources");
    sec.appendChild(tabs(active, TABS));
    if (active === "resources") await renderResourcesTab(sec);
    else if (active === "allocations") await renderAllocationsTab(sec);
    else if (active === "capacity") await renderCapacityTab(sec);
    else if (active === "suggestions") await renderSuggestionsTab(sec);
    else if (active === "conflicts") await renderConflictsTab(sec);
    else await renderResourcesTab(sec);
    sec.appendChild(await collectionStatusEl("resources"));
    view.appendChild(sec);
  }
});
