// src/psa/modules/reports.js — saved report definitions, CSV export / print,
// and a CSV import with preview-and-fix for resources and work plans. All
// numbers come from the master core (derive.js) so reports can't drift from
// what the modules show.

import { registerModule, moduleShell, h, el, icon, tabs, toast, modal, moneyFmt, dateFmt, dateShort, numFmt, pctFmt, todayIso, addDays, parseCsv, toCsv, downloadFile } from "../core.js";
import { renderCrud } from "../crud.js";
import store from "../store.js";
import { collectionStatusEl } from "../store-ui.js";
import { snapshot, weekStartIso, weekEndIso, availableHoursForWeek, bookedHoursForWeek, billableHoursForWeek, profitability, budgetVsActual, healthOf, unbilledTotals, appSettings } from "../derive.js";

const TABS = [
  { id: "library", label: "Report library", href: "reports" },
  { id: "csv", label: "CSV import", href: "reports/csv-import" },
];

const PERIODS = ["week", "month", "quarter", "ytd"].map((p) => ({ value: p, label: p }));

// ---- report runners ----

function periodRange(period) {
  const today = todayIso();
  const ws = weekStartIso(today);
  const we = weekEndIso(today);
  if (period === "week") return [ws, we];
  if (period === "month") return [addDays(ws, -21), we];
  if (period === "quarter") return [addDays(ws, -84), we];
  const y = Number(today.slice(0, 4));
  return [weekStartIso(y + "-01-01"), we];
}

function weeksBetween(startIso, endIso) {
  const out = [];
  let w = weekStartIso(startIso);
  const e = weekStartIso(endIso);
  while (w <= e) { out.push(w); w = addDays(w, 7); }
  return out;
}

function runUtilization(def) {
  const [from, to] = periodRange(def.period);
  const weeks = weeksBetween(from, to);
  const D = snapshot();
  const resources = D.resources.filter((r) => def.includeClosed || r.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const headers = ["Person", "Target hours", "Billable hours", "Utilization", "Booked hours", "Available hours", "Over capacity"];
  const rows = [];
  for (const r of resources) {
    let target = 0, billable = 0, booked = 0, available = 0, over = 0;
    for (const w of weeks) {
      const a = availableHoursForWeek(r, w);
      target += a * (Number(r.targetUtilization) != null && !isNaN(Number(r.targetUtilization)) ? Number(r.targetUtilization) : appSettings().targetUtilization);
      billable += billableHoursForWeek(r.id, w, D);
      booked += bookedHoursForWeek(r.id, w, D);
      available += a;
      const tol = appSettings().overAllocTolerance;
      if (bookedHoursForWeek(r.id, w, D) > a + tol) over++;
    }
    rows.push([r.name, numFmt(target, 0), numFmt(billable, 0), pctFmt(target > 0 ? billable / target : null), numFmt(booked, 0), numFmt(available, 0), over ? over + " week(s)" : "no"]);
  }
  return { headers, rows, title: "Utilization by person — " + def.period + " (" + dateShort(from) + " – " + dateShort(to) + ")" };
}

function runProfitability(def) {
  const D = snapshot();
  const projects = D.projects.filter((p) => def.includeClosed || p.status !== "closed").sort((a, b) => a.name.localeCompare(b.name));
  const headers = ["Project", "Client", "Billing", "Revenue", "Cost", "Profit", "Margin %"];
  const rows = projects.map((p) => {
    const pr = profitability(p, D);
    const c = D.clientsById[p.clientId];
    return [p.name, c ? c.name : "—", p.billingMethod || "tm", moneyFmt(pr.revenue, p.currency || "USD"), moneyFmt(pr.cost, p.currency || "USD"), moneyFmt(pr.profit, p.currency || "USD"), pr.margin == null ? "—" : pctFmt(pr.margin)];
  });
  return { headers, rows, title: "Profitability by project" };
}

function runBudgetVsActual(def) {
  const D = snapshot();
  const projects = D.projects.filter((p) => def.includeClosed || p.status !== "closed").sort((a, b) => a.name.localeCompare(b.name));
  const headers = ["Project", "Budget h", "Actual h", "% spent h", "Budget cost", "Actual cost", "% spent c", "EAC cost", "Health"];
  const rows = projects.map((p) => {
    const b = budgetVsActual(p, D);
    const hh = healthOf(p, D);
    return [p.name, numFmt(b.budgetHours), numFmt(b.actuals.hours), pctFmt(b.pctSpentHours), moneyFmt(b.budgetCost, p.currency || "USD"), moneyFmt(b.actuals.cost, p.currency || "USD"), pctFmt(b.pctSpentCost), moneyFmt(b.eacCost, p.currency || "USD"), hh.label];
  });
  return { headers, rows, title: "Budget vs actual vs forecast by project" };
}

function runTimesheetDetail(def) {
  const [from, to] = periodRange(def.period);
  const D = snapshot();
  const entries = D.timesheets.filter((t) => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.resourceId || "").localeCompare(b.resourceId || ""));
  const headers = ["Person", "Project", "Date", "Hours", "Billable", "Status", "Note"];
  const rows = entries.map((t) => {
    const r = D.resourcesById[t.resourceId];
    const p = D.projectsById[t.projectId];
    return [r ? r.name : "—", p ? p.name : "—", dateFmt(t.date), numFmt(t.hours, 1), t.billable ? "yes" : "no", t.status || "draft", t.note || ""];
  });
  return { headers, rows, title: "Timesheet detail — " + def.period + " (" + dateShort(from) + " – " + dateShort(to) + ")" };
}

function runUnbilled(def) {
  const D = snapshot();
  const projects = D.projects.filter((p) => def.includeClosed || p.status !== "closed").sort((a, b) => a.name.localeCompare(b.name));
  const headers = ["Project", "Client", "Unbilled hours", "Time value", "Expense value", "Total unbilled"];
  const rows = projects.map((p) => {
    const u = unbilledTotals(p, D);
    const c = D.clientsById[p.clientId];
    return [p.name, c ? c.name : "—", numFmt(u.hours), moneyFmt(u.timeValue, p.currency || "USD"), moneyFmt(u.expenseValue, p.currency || "USD"), moneyFmt(u.revenue, p.currency || "USD")];
  });
  return { headers, rows, title: "Unbilled work by project" };
}

function runAvailability(def) {
  const D = snapshot();
  const n = Number(def.weeks) || 8;
  const ws = weekStartIso(todayIso());
  const resources = D.resources.filter((r) => def.includeClosed || r.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const headers = ["Person", "Week", "Available", "Booked", "Free", "Booked utilization"];
  const rows = [];
  for (const r of resources) {
    for (let i = 0; i < n; i++) {
      const w = addDays(ws, i * 7);
      const a = availableHoursForWeek(r, w);
      const b = bookedHoursForWeek(r.id, w, D);
      rows.push([r.name, dateShort(w), numFmt(a), numFmt(b), numFmt(Math.max(0, a - b)), pctFmt(a > 0 ? b / a : null)]);
    }
  }
  return { headers, rows, title: "Resource availability — next " + n + " weeks" };
}

const REPORT_KINDS = {
  utilization: { label: "Utilization", run: runUtilization },
  profitability: { label: "Profitability", run: runProfitability },
  budget: { label: "Budget vs actual", run: runBudgetVsActual },
  timesheet: { label: "Timesheet detail", run: runTimesheetDetail },
  unbilled: { label: "Unbilled", run: runUnbilled },
  availability: { label: "Availability", run: runAvailability },
};

const reportFields = [
  { key: "name", label: "Report name", type: "text", required: true, placeholder: "Weekly utilization" },
  { key: "kind", label: "Report type", type: "select", options: Object.keys(REPORT_KINDS).map((k) => ({ value: k, label: REPORT_KINDS[k].label })), required: true, default: "utilization" },
  { key: "period", label: "Period", type: "select", options: PERIODS, default: "week" },
  { key: "weeks", label: "Weeks ahead (availability)", type: "number", default: 8 },
  { key: "includeClosed", label: "Include closed projects", type: "checkbox" },
];

const reportColumns = [
  { key: "name", label: "Report", render: (r) => "<strong>" + h(r.name) + "</strong>" },
  { key: "kind", label: "Type", render: (r) => '<span class="pill pill-accent">' + h((REPORT_KINDS[r.kind] || {}).label || r.kind) + "</span>" },
  { key: "period", label: "Period" },
  { key: "updatedAt", label: "Updated", render: (r) => h(r.updatedAt ? dateFmt(r.updatedAt) : "—") },
];

function runReportModal(def, ctx) {
  let out = null;
  try { out = REPORT_KINDS[def.kind] ? REPORT_KINDS[def.kind].run(def) : null; }
  catch (e) { toast(e.message || "Could not run report", "err"); return; }
  const body = el("div", "psa-report");
  body.appendChild(el("h4", "psa-report-title", h(out.title)));
  const wrap = el("div", "psa-table-wrap");
  wrap.innerHTML = '<table class="psa-table"><thead><tr>' + out.headers.map((x) => "<th>" + h(x) + "</th>").join("") + "</tr></thead><tbody>" +
    (out.rows.length ? out.rows.map((r) => "<tr>" + r.map((c) => "<td>" + h(c) + "</td>").join("") + "</tr>").join("") : "<tr><td colspan='" + out.headers.length + "' class='dim'>No data for this report.</td></tr>") +
    "</tbody></table>";
  body.appendChild(wrap);
  modal({
    title: def.name,
    body,
    wide: true,
    actions: [
      { label: "Export CSV", icon: "box", onClick: () => {
          downloadFile((def.name || "report").toLowerCase().replace(/\s+/g, "-") + ".csv", toCsv([out.headers, ...out.rows]), "text/csv");
          toast("CSV downloaded");
        } },
      { label: "Print / PDF", icon: "reports", onClick: () => {
          const w = window.open("", "_blank");
          if (!w) { toast("Allow pop-ups to print", "err"); return; }
          w.document.write("<html><head><title>" + h(def.name) + "</title><style>body{font-family:Inter,sans-serif;padding:30px;color:#111}h4{margin:0 0 12px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ddd;padding:7px 9px;text-align:left}th{background:#f4f6f9}</style></head><body><h4>" + h(out.title) + "</h4><table><thead><tr>" + out.headers.map((x) => "<th>" + h(x) + "</th>").join("") + "</tr></thead><tbody>" + out.rows.map((r) => "<tr>" + r.map((c) => "<td>" + h(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table></body></html>");
          w.document.close();
          w.focus();
          setTimeout(() => w.print(), 400);
        } }
    ]
  });
}

async function renderLibraryTab(sec) {
  await renderCrud(sec, {
    collection: "reports",
    moduleId: "reports",
    title: "Report library",
    subtitle: "Saved report definitions — utilization, profitability, budget vs actual, timesheet detail, unbilled and availability. Every report exports to CSV and prints.",
    singular: "Report",
    newLabel: "Create report",
    columns: reportColumns,
    fields: reportFields,
    searchKeys: ["name"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    detailActions: (rec, ctx) => [{
      label: "Run report", icon: "reports", kind: "btn-primary", onClick: () => runReportModal(rec, ctx),
    }],
    emptyState: { title: "No saved reports yet", message: "Create a report definition — utilization by person, project profitability, budget vs actual, timesheet detail, unbilled hours or availability — then run it, export to CSV or print.", action: { label: "Create report" } },
  });
}

// ---- CSV import ----

export const IMPORTERS = {
  resources: {
    label: "Resources",
    headers: ["name", "email", "roles", "costRate", "targetUtilization", "active"],
    sample: "name,email,roles,costRate,targetUtilization,active\nAda Lovelace,ada@example.com,Consultant|PM,60,0.8,true\nGrace Hopper,grace@example.com,Senior Consultant,90,0.8,true",
    build(row, errors) {
      const name = (row[0] || "").trim();
      if (!name) { errors.push("Row is missing a name."); return null; }
      const costRate = Number(row[3]);
      const target = row[4] === "" || row[4] == null ? 0.8 : Number(row[4]);
      if (row[4] !== "" && row[4] != null && isNaN(target)) { errors.push("targetUtilization \"" + row[4] + "\" is not a number."); return null; }
      if (row[3] !== "" && row[3] != null && isNaN(costRate)) { errors.push("costRate \"" + row[3] + "\" is not a number."); return null; }
      const roles = String(row[2] || "").split(/[,|;]/).map((s) => s.trim()).filter(Boolean);
      const active = /^(true|yes|1)$/i.test(String(row[5] || "").trim()) || !String(row[5] || "").trim();
      return { name, email: (row[1] || "").trim() || null, roles, costRate: isNaN(costRate) ? 0 : costRate, targetUtilization: target, active, availability: [], createdAt: new Date().toISOString() };
    },
  },
  workplans: {
    label: "Work plans",
    headers: ["projectId", "projectName", "name", "role", "effortHours", "plannedStart", "status"],
    sample: "projectId,projectName,name,role,effortHours,plannedStart,status\n,Acme migration,Discovery workshop,Consultant,16,2026-09-07,notstarted\n,Acme migration,Build ETL pipeline,Senior Consultant,40,2026-09-14,inprogress",
    build(row, errors) {
      const projects = store.getAllRecords("projects");
      const pid = (row[0] || "").trim();
      const pname = (row[1] || "").trim();
      let project = pid ? store.getRecord("projects", pid) : null;
      if (!project && pname) project = projects.find((p) => p.name.toLowerCase() === pname.toLowerCase()) || null;
      if (!project) { errors.push("No project matches \"" + (pid || pname) + "\"."); return null; }
      const name = (row[2] || "").trim();
      if (!name) { errors.push("Row is missing a task name."); return null; }
      const hours = Number(row[4]);
      if (row[4] !== "" && row[4] != null && isNaN(hours)) { errors.push("effortHours \"" + row[4] + "\" is not a number."); return null; }
      const status = ["notstarted", "inprogress", "blocked", "done"].includes((row[6] || "").trim()) ? (row[6] || "").trim() : "notstarted";
      return { projectId: project.id, name, role: (row[3] || "").trim() || null, effortHours: isNaN(hours) ? 0 : hours, plannedStart: (row[5] || "").trim() || null, plannedEnd: null, dependsOn: [], status, requiredSkills: [], createdAt: new Date().toISOString() };
    },
  },
};

function renderImportTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("CSV import")));
  sec.appendChild(head);
  const toolbar = el("div", "psa-crud-toolbar");
  const impSel = el("select", "psa-filter-select");
  for (const key of Object.keys(IMPORTERS)) { const o = el("option", "", h(IMPORTERS[key].label)); o.value = key; impSel.appendChild(o); }
  toolbar.appendChild(el("span", "psa-filter-label", "Import into:"));
  toolbar.appendChild(impSel);
  const example = el("button", "btn btn-ghost btn-sm", "Load example");
  toolbar.appendChild(example);
  sec.appendChild(toolbar);
  const ta = el("textarea", "psa-input psa-csv-input", "");
  ta.rows = 8;
  ta.placeholder = "Paste CSV here — first row is the header…";
  sec.appendChild(ta);
  const btnRow = el("div", "psa-page-actions");
  const parseBtn = el("button", "btn btn-ghost", "Parse & preview");
  const importBtn = el("button", "btn btn-primary", "Import valid rows");
  importBtn.disabled = true;
  btnRow.appendChild(parseBtn); btnRow.appendChild(importBtn);
  sec.appendChild(btnRow);
  const preview = el("div", "psa-csv-preview");
  sec.appendChild(preview);

  let parsed = null; // { headers, rows: [{cells, errors, record}] }

  example.addEventListener("click", () => {
    ta.value = IMPORTERS[impSel.value].sample;
    parseBtn.click();
  });
  impSel.addEventListener("change", () => { ta.value = ""; preview.innerHTML = ""; importBtn.disabled = true; });

  parseBtn.addEventListener("click", () => {
    const def = IMPORTERS[impSel.value];
    const all = parseCsv(ta.value);
    preview.innerHTML = "";
    if (all.length < 2) { preview.appendChild(el("p", "dim", h("Nothing to parse — add a header row and at least one data row."))); importBtn.disabled = true; return; }
    const header = all[0].map((x) => x.trim());
    const rows = all.slice(1).map((cells, i) => {
      const row = header.map((hname, j) => cells[j] == null ? "" : cells[j].trim());
      const errors = [];
      const record = def.build(row, errors, i);
      return { cells: row, errors, record, rowNum: i + 2 };
    });
    parsed = { def, header, rows };
    const okCount = rows.filter((r) => !r.errors.length).length;
    const errCount = rows.length - okCount;
    preview.appendChild(el("p", "psa-preview-summary", h(rows.length + " row(s) — " + okCount + " valid, " + errCount + " with errors")));
    const wrap = el("div", "psa-table-wrap");
    wrap.innerHTML = '<table class="psa-table"><thead><tr>' + header.map((x) => "<th>" + h(x) + "</th>").join("") + "<th>Status</th></tr></thead><tbody>" +
      rows.map((r) => "<tr class='" + (r.errors.length ? "csv-bad" : "csv-ok") + "'>" + r.cells.map((c) => "<td>" + h(c) + "</td>").join("") + "<td>" + (r.errors.length ? "<span class='badge badge-err'>" + h(r.errors.join("; ")) + "</span>" : '<span class="badge badge-ok">OK</span>') + "</td></tr>").join("") +
      "</tbody></table>";
    preview.appendChild(wrap);
    importBtn.disabled = errCount > 0 || okCount === 0;
    if (errCount > 0) preview.appendChild(el("p", "psa-preview-hint", h("Fix the highlighted rows above, then parse again before importing.")));
  });

  importBtn.addEventListener("click", async () => {
    if (!parsed) return;
    const valid = parsed.rows.filter((r) => !r.errors.length && r.record);
    if (!valid.length) return;
    importBtn.disabled = true;
    let count = 0;
    for (const v of valid) {
      const id = (parsed.def === IMPORTERS.workplans ? "wp" : "res") + "-" + Math.random().toString(36).slice(2, 10);
      try { await store.saveRecord(parsed.def === IMPORTERS.workplans ? "workplans" : "resources", Object.assign({ id }, v.record)); count++; }
      catch (e) { toast(e.message || "Import row failed", "err"); }
    }
    toast("Imported " + count + " " + parsed.def.label.toLowerCase() + " record(s)");
    parsed = null;
    preview.innerHTML = "";
    importBtn.disabled = true;
  });
}

registerModule({
  id: "reports",
  label: "Reports",
  icon: "reports",
  async render({ view, route }) {
    const active = route.parts[0] || "reports";
    const sec = moduleShell("reports");
    sec.appendChild(tabs(active, TABS));
    if (active === "reports") await renderLibraryTab(sec);
    else if (active === "csv") renderImportTab(sec);
    else await renderLibraryTab(sec);
    sec.appendChild(await collectionStatusEl("reports"));
    view.appendChild(sec);
  }
});
