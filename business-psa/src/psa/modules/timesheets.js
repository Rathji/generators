import { registerModule, moduleShell, h, el, icon, tabs, toast, modal, dateFmt, dateShort, numFmt, todayIso, addDays } from "../core.js";
import { renderCrud, openForm, openDetail } from "../crud.js";
import store from "../store.js";
import { collectionStatusEl } from "../store-ui.js";
import { weekStartIso, weekEndIso, bookedHoursForWeek, actualHoursForWeek, snapshot, byId } from "../derive.js";
import { setTimesheetStatus } from "../workflow.js";
import hub from "../hub.js";

const TABS = [
  { id: "timesheets", label: "Entries", href: "timesheets" },
  { id: "approval", label: "Approval", href: "timesheets/approval" },
];

function resourceOpts() { return store.getAllRecords("resources").map((r) => ({ value: r.id, label: r.name })); }
function projectOpts() { return store.getAllRecords("projects").map((p) => ({ value: p.id, label: p.name })); }

const tsFields = [
  { key: "resourceId", label: "Person", type: "select", options: resourceOpts, required: true },
  { key: "projectId", label: "Project", type: "select", options: projectOpts, required: true },
  { key: "taskId", label: "Task", type: "select", options: (fv) => store.getAllRecords("workplans").filter((t) => t.projectId === fv.projectId).map((t) => ({ value: t.id, label: t.name })) },
  { key: "date", label: "Date", type: "date", required: true, defaultToday: true },
  { key: "hours", label: "Hours", type: "number", required: true, default: 8, step: 0.5 },
  { key: "billable", label: "Billable", type: "checkbox", default: true },
  { key: "note", label: "Note", type: "text", placeholder: "What did you work on?" },
  { key: "status", label: "Status", type: "select", options: ["draft", "submitted", "approved", "rejected", "returned"].map((s) => ({ value: s, label: s })), default: "draft" },
];

const tsColumns = [
  { key: "resourceId", label: "Person", render: (r) => { const x = store.getRecord("resources", r.resourceId); return h(x ? x.name : "—"); } },
  { key: "projectId", label: "Project", render: (r) => { const p = store.getRecord("projects", r.projectId); return h(p ? p.name : "—"); } },
  { key: "date", label: "Date", render: (r) => h(dateFmt(r.date)) },
  { key: "hours", label: "Hours", render: (r) => h(String(r.hours)) },
  { key: "billable", label: "Billable", render: (r) => r.billable ? '<span class="badge badge-ok">Billable</span>' : '<span class="badge badge-muted">Non-billable</span>' },
  { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
];

function statusBadge(s) {
  const map = { draft: "muted", submitted: "warn", approved: "ok", rejected: "err", returned: "accent" };
  return '<span class="badge badge-' + (map[s] || "muted") + '">' + h(s) + "</span>";
}

function tsDetailActions(rec, ctx) {
  const acts = [];
  if (rec.status === "draft" || rec.status === "returned") {
    acts.push({ label: "Submit for approval", icon: "arrow", kind: "btn-primary", onClick: async () => {
        const auth = await hub.requireAction("timesheet.submit", "submitted timesheet " + rec.id);
        if (!auth.ok) return;
        await setTimesheetStatus(rec, "submitted", auth.actor || "local");
        hub.recordAudit("timesheet.submit", "submitted timesheet " + rec.id, auth.actor).catch(() => {});
        toast("Timesheet submitted for approval");
        ctx.refresh();
      } });
  }
  if (rec.status === "submitted") {
    acts.push({ label: "Approve", icon: "check", kind: "btn-primary", onClick: async () => {
        const auth = await hub.requireAction("timesheet.approve", "approved timesheet " + rec.id);
        if (!auth.ok) return;
        await setTimesheetStatus(rec, "approved", auth.actor || "local", "Approved");
        hub.recordAudit("timesheet.approve", "approved timesheet " + rec.id, auth.actor).catch(() => {});
        toast("Approved");
        ctx.refresh();
      } });
    acts.push({ label: "Reject", kind: "btn-danger", onClick: async () => {
        const auth = await hub.requireAction("timesheet.reject", "rejected timesheet " + rec.id);
        if (!auth.ok) return;
        const c = await promptComment("Reject this timesheet — why?", "");
        if (c == null) return;
        await setTimesheetStatus(rec, "rejected", auth.actor || "local", c);
        hub.recordAudit("timesheet.reject", "rejected timesheet " + rec.id + " — " + c, auth.actor).catch(() => {});
        toast("Rejected");
        ctx.refresh();
      } });
    acts.push({ label: "Return for correction", onClick: async () => {
        const auth = await hub.requireAction("timesheet.return", "returned timesheet " + rec.id);
        if (!auth.ok) return;
        const c = await promptComment("Return to the consultant — what needs fixing?", "");
        if (c == null) return;
        await setTimesheetStatus(rec, "returned", auth.actor || "local", c);
        hub.recordAudit("timesheet.return", "returned timesheet " + rec.id + " — " + c, auth.actor).catch(() => {});
        toast("Returned for correction");
        ctx.refresh();
      } });
  }
  return acts;
}

function promptComment(title, initial) {
  return new Promise((resolve) => {
    const ta = el("textarea", "psa-input", "");
    ta.rows = 3;
    ta.value = initial;
    const wrap = el("div", "psa-form");
    wrap.appendChild(el("label", "psa-field-label", "Comment (recorded for audit)"));
    wrap.appendChild(ta);
    modal({
      title,
      body: wrap,
      actions: [
        { label: "Cancel", onClick: () => resolve(null) },
        { label: "Confirm", kind: "btn-primary", onClick: (b) => { resolve(ta.value.trim() || "No comment"); b.closest(".psa-modal-overlay").remove(); } }
      ]
    });
  });
}

function weeklySummary() {
  const D = snapshot();
  const ws = weekStartIso(todayIso());
  const we = weekEndIso(ws);
  const resources = D.resources.filter((r) => r.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const card = el("div", "dash-card dash-card-wide psa-week-summary");
  if (!resources.length) { card.appendChild(el("p", "dim", h("No people in the pool yet."))); return card; }
  let html = '<div class="dash-card-head"><span class="dash-card-icon">' + icon("timesheets", 20) + "</span><span class='dash-card-label'>This week (" + dateShort(ws) + " – " + dateShort(we) + ")</span></div>";
  html += '<div class="week-grid">';
  for (const r of resources) {
    const booked = bookedHoursForWeek(r.id, ws, D);
    const actual = actualHoursForWeek(r.id, ws, D);
    const billable = D.timesheets.filter((t) => t.resourceId === r.id && t.billable && t.date >= ws && t.date <= we).reduce((s, t) => s + (t.hours || 0), 0);
    html += '<div class="week-item"><span class="week-name">' + h(r.name) + "</span><span class='week-num'>" + numFmt(actual) + "h logged" + (billable ? " · " + numFmt(billable) + "h billable" : "") + '</span><span class="week-booked ' + (booked > 0 && actual > booked ? "week-over" : "") + '">booked ' + numFmt(booked) + "h</span></div>";
  }
  html += "</div>";
  card.innerHTML = html;
  return card;
}

async function renderEntriesTab(sec) {
  sec.appendChild(weeklySummary());
  const host = el("div", "psa-list");
  sec.appendChild(host);
  const cfg = {
    collection: "timesheets",
    moduleId: "timesheets",
    title: "Timesheets",
    subtitle: "Logged time per person — submit for approval, then managers approve, reject or return.",
    singular: "Entry",
    newLabel: "Log time",
    columns: tsColumns,
    fields: tsFields,
    searchKeys: ["note"],
    sortBy: (a, b) => (b.date || "").localeCompare(a.date || ""),
    detailActions: tsDetailActions,
    prefilter: {
      allLabel: "All people",
      options: store.getAllRecords("resources").sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ value: r.id, label: r.name })),
      filter: (r, value) => r.resourceId === value,
    },
    afterOpen: (form, getValue) => {
      const rSel = form.querySelector('[data-field="resourceId"]');
      const pSel = form.querySelector('[data-field="projectId"]');
      if (!rSel || !pSel) return;
      const prefill = () => {
        const rid = rSel.value;
        if (!rid) return;
        const alloc = store.getAllRecords("allocations").filter((a) => a.resourceId === rid).sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""))[0];
        if (alloc && !pSel.value) {
          pSel.value = alloc.projectId;
          pSel.dispatchEvent(new Event("change", { bubbles: true }));
          const tSel = form.querySelector('[data-field="taskId"]');
          if (tSel && alloc.taskId && [...tSel.options].some((o) => o.value === alloc.taskId)) tSel.value = alloc.taskId;
        }
      };
      rSel.addEventListener("change", prefill);
      setTimeout(prefill, 50);
    },
    emptyState: { title: "No time logged yet", message: "Log your first entry — project and task default from your current allocation.", action: { label: "Log time" } },
  };
  await renderCrud(host, cfg);
}

async function renderApprovalTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Timesheet approval")));
  sec.appendChild(head);
  const toolbar = el("div", "psa-crud-toolbar");
  const weekSel = el("input", "psa-input", "");
  weekSel.type = "date";
  weekSel.value = todayIso();
  toolbar.appendChild(el("span", "psa-filter-label", "Week:"));
  toolbar.appendChild(weekSel);
  sec.appendChild(toolbar);
  const host = el("div", "psa-approval");
  sec.appendChild(host);
  function render() {
    const ws = weekStartIso(weekSel.value);
    const we = weekEndIso(weekSel.value);
    const D = snapshot();
    const entries = D.timesheets.filter((t) => t.date >= ws && t.date <= we && t.status === "submitted").sort((a, b) => (a.resourceId || "").localeCompare(b.resourceId || "") || a.date.localeCompare(b.date));
    host.innerHTML = "";
    if (!entries.length) { host.appendChild(el("p", "dim", h("No entries awaiting approval for the week of " + dateShort(ws) + "."))); return; }
    const groups = {};
    for (const e of entries) { (groups[e.resourceId] = groups[e.resourceId] || []).push(e); }
    for (const rid of Object.keys(groups)) {
      const r = store.getRecord("resources", rid);
      const block = el("div", "approval-group");
      block.appendChild(el("h3", "approval-name", h(r ? r.name : "Unknown")));
      for (const e of groups[rid]) {
        const item = el("div", "approval-item");
        const p = store.getRecord("projects", e.projectId);
        item.innerHTML = "<div><strong>" + dateFmt(e.date) + "</strong> — " + h(p ? p.name : "—") + " <span class='dim'>" + numFmt(e.hours) + "h · " + (e.billable ? "billable" : "non-billable") + "</span>" + (e.note ? "<div class='cell-sub'>" + h(e.note) + "</div>" : "") + "</div>";
        const btns = el("div", "approval-btns");
        const ok = el("button", "btn btn-primary btn-sm", "Approve"); ok.addEventListener("click", async () => {
            const auth = await hub.requireAction("timesheet.approve", "approved timesheet " + e.id);
            if (!auth.ok) return;
            await setTimesheetStatus(e, "approved", auth.actor || "local", "Approved");
            hub.recordAudit("timesheet.approve", "approved timesheet " + e.id, auth.actor).catch(() => {});
            toast("Approved " + dateFmt(e.date)); render();
          });
        const ret = el("button", "btn btn-ghost btn-sm", "Return"); ret.addEventListener("click", async () => {
            const auth = await hub.requireAction("timesheet.return", "returned timesheet " + e.id);
            if (!auth.ok) return;
            const c = await promptComment("Return for correction", "");
            if (c == null) return;
            await setTimesheetStatus(e, "returned", auth.actor || "local", c);
            hub.recordAudit("timesheet.return", "returned timesheet " + e.id + " — " + c, auth.actor).catch(() => {});
            toast("Returned"); render();
          });
        const rej = el("button", "btn btn-ghost btn-sm", "Reject"); rej.addEventListener("click", async () => {
            const auth = await hub.requireAction("timesheet.reject", "rejected timesheet " + e.id);
            if (!auth.ok) return;
            const c = await promptComment("Reject — why?", "");
            if (c == null) return;
            await setTimesheetStatus(e, "rejected", auth.actor || "local", c);
            hub.recordAudit("timesheet.reject", "rejected timesheet " + e.id + " — " + c, auth.actor).catch(() => {});
            toast("Rejected"); render();
          });
        btns.appendChild(ok); btns.appendChild(ret); btns.appendChild(rej);
        item.appendChild(btns);
        block.appendChild(item);
      }
      host.appendChild(block);
    }
  }
  weekSel.addEventListener("change", render);
  render();
}

registerModule({
  id: "timesheets",
  label: "Timesheets",
  icon: "timesheets",
  async render({ view, route }) {
    const active = route.parts[0] || "timesheets";
    const sec = moduleShell("timesheets");
    sec.appendChild(tabs(active, TABS));
    if (active === "timesheets") await renderEntriesTab(sec);
    else if (active === "approval") await renderApprovalTab(sec);
    else await renderEntriesTab(sec);
    sec.appendChild(await collectionStatusEl("timesheets"));
    view.appendChild(sec);
  }
});
