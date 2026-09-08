// src/psa/tests-features.js — round-trip feature suite (task 38): exercises the
// business chains end to end — rate cards → SOW → approval → seeded project →
// work plan → allocation → timesheet approval → expense → actuals → unbilled →
// invoice → locked source records → credit note — plus rate resolution,
// conflicts, backup/restore idempotency, integrity checks and CSV tooling.
// All fixture records use the "ft-" prefix and are removed afterwards.
//
// No explicit flush() calls here: the store's background sync handles dirty
// shards, and the cloud editable cooldown coalesces the writes.

import store, {
  ready, saveRecord, removeRecord, getAllRecords, getRecord, getDocInfo,
  registerCollection, pendingConflicts, resolveConflict, getSyncState,
} from "./store.js";
import { parseCsv, toCsv, todayIso, addDays } from "./core.js";
import {
  snapshot, effectiveRate, projectActuals, unbilledTotals, profitability,
  healthOf, invoiceableItems, invoiceTotals, taskSuggestions, overloads,
  skillGaps, weekUtilization,
} from "./derive.js";
import {
  approveSow, applyScopeChange, setTimesheetStatus, createInvoice, createCreditNote,
} from "./workflow.js";
import { buildBackup, validateBackup, restoreBackup } from "./backup.js";
import { runChecks, healthSummary } from "./integrity.js";
import { IMPORTERS } from "./modules/reports.js";

function nowIso() {
  return new Date().toISOString();
}

export async function runFeatureTests() {
  await ready();
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok, detail: ok ? "" : detail });

  const created = {
    clients: [], projects: [], workplans: [], allocations: [], timesheets: [],
    expenses: [], billing: [], catalog: [], ratecards: [], sows: [], resources: [],
    scopechanges: [], conflicts: [],
  };
  let ftCol = null;
  const track = (col, rec) => { created[col].push(rec.id); return rec; };

  try {
    // ---- rate resolution (task 8) ----
    const client = track("clients", { id: "ft-client", name: "Feature Test Co", industry: "Retail", taxId: "FT-123", active: true });
    await store.saveRecord("clients", client);
    const rateGlobal = track("ratecards", {
      id: "ft-rate-global", name: "Standard rate card", active: true,
      scope: { type: "global" }, currency: "USD", discount: 0,
      lines: [{ role: "Consultant", rate: 150 }],
    });
    await store.saveRecord("ratecards", rateGlobal);
    const rateProjectOverride = track("ratecards", {
      id: "ft-rate-proj", name: "Preferred client rate", active: true,
      scope: { type: "project", refId: "ft-proj-pref" }, currency: "USD", discount: 0,
      lines: [{ role: "Consultant", rate: 200 }],
    });
    await store.saveRecord("ratecards", rateProjectOverride);
    const res = track("resources", {
      id: "ft-res-1", name: "Ada Lovelace", roles: ["Consultant"], skills: ["Data"],
      costRate: 60, targetUtilization: 0.8, active: true, availability: [],
    });
    await store.saveRecord("resources", res);
    const sow = track("sows", {
      id: "ft-sow-1", name: "Feature Test SOW", clientId: client.id, status: "approved",
      pricingModel: "tm", budgetHours: 40, budgetValue: 6000, taxRate: 0,
      startDate: todayIso(), endDate: addDays(todayIso(), 60), scope: "Round-trip fixture.",
      milestones: [],
    });

    check("rate resolution: global card applies to a consultant", (() => {
      const er = effectiveRate({ role: "Consultant", d: snapshot() });
      return er.rate === 150 && er.currency === "USD";
    })(), "");

    check("rate resolution: project card overrides the global card", (() => {
      const er = effectiveRate({ project: { id: "ft-proj-pref" }, client, role: "Consultant", d: snapshot() });
      return er.rate === 200;
    })(), "");

    check("rate resolution: no matching line yields null rate (not a crash)", (() => {
      const er = effectiveRate({ role: "Nothing", d: snapshot() });
      return er.rate == null;
    })(), "");

    // ---- SOW approval seeds a project (tasks 9, 10) ----
    const { project } = await approveSow(sow, "ft-actor");
    track("projects", project);
    check("approved SOW seeds a project linked to client + SOW", (() => {
      const p = getRecord("projects", project.id);
      return !!p && p.clientId === client.id && p.sowId === sow.id && p.billingMethod === "tm";
    })(), "");
    check("seeded project carries budget + milestone defaults", project.budgetHours === 40 && project.budgetValue === 6000);
    check("approveSow stamps approval metadata on the SOW", (() => {
      const s = getRecord("sows", sow.id);
      return s.status === "approved" && !!s.approvedAt && s.approvedBy === "ft-actor" && s.revision >= 1;
    })(), "");
    check("re-approving the same SOW does not create a second project", (() => {
      return getAllRecords("projects").filter((p) => p.sowId === sow.id).length === 1;
    })(), "");

    // ---- work plan + allocation (tasks 11, 15, 16) ----
    const task = track("workplans", {
      id: "ft-task-1", projectId: project.id, name: "Discovery workshop", role: "Consultant",
      requiredSkills: ["Data"], effortHours: 16, plannedStart: todayIso(), plannedEnd: addDays(todayIso(), 7),
      dependsOn: [], status: "notstarted",
    });
    await store.saveRecord("workplans", task);
    const alloc = track("allocations", {
      id: "ft-alloc-1", projectId: project.id, resourceId: res.id, taskId: task.id,
      hoursPerWeek: 32, startDate: todayIso(), endDate: addDays(todayIso(), 14), planned: true,
    });
    await store.saveRecord("allocations", alloc);
    check("skill-based suggestions surface the matching free resource", (() => {
      const sugg = taskSuggestions({ requiredSkills: ["Data"], role: "Consultant", plannedStart: todayIso() }, snapshot());
      return sugg.some((s) => s.resource.id === res.id && s.free > 0);
    })(), JSON.stringify(taskSuggestions({ requiredSkills: ["Data"], role: "Consultant", plannedStart: todayIso() }, snapshot()).map((s) => s.resource.id)));
    check("capacity heatmap shows the booked allocation in weekUtilization", (() => {
      const u = weekUtilization(res, todayIso(), snapshot());
      return u.booked === 32 && u.available === 40;
    })(), "");

    // ---- timesheet approval (tasks 20, 21) ----
    const ts = track("timesheets", {
      id: "ft-ts-1", projectId: project.id, resourceId: res.id, taskId: task.id,
      date: todayIso(), hours: 8, billable: true, status: "draft", note: "Workshop day",
    });
    await setTimesheetStatus(ts, "submitted", "ada");
    await setTimesheetStatus(getRecord("timesheets", "ft-ts-1"), "approved", "manager", "Looks good");
    check("submission + approval stamps actors and timestamps", (() => {
      const t = getRecord("timesheets", "ft-ts-1");
      return t.submittedBy === "ada" && t.approvedBy === "manager" && !!t.approvedAt && t.approveComment === "Looks good" && t.status === "approved";
    })(), "");

    // ---- expense capture (task 22) ----
    const exp = track("expenses", {
      id: "ft-exp-1", projectId: project.id, resourceId: res.id, type: "Travel",
      amount: 200, currency: "USD", date: todayIso(), billable: true, status: "submitted", note: "Flight",
    });
    await store.saveRecord("expenses", exp);
    check("expense is editable before posting (not locked)", getRecord("expenses", "ft-exp-1").locked !== true);

    // ---- actuals roll-up (task 23) ----
    const actuals = projectActuals(project.id);
    check("actuals roll up approved billable time", actuals.hours === 8 && actuals.approvedHours === 8, JSON.stringify(actuals));
    check("actuals cost = hours × resource cost rate", actuals.cost === 8 * 60, "cost: " + actuals.cost);
    check("actuals revenue = hours × effective rate", actuals.revenue === 8 * 150, "revenue: " + actuals.revenue);
    check("actuals include the expense", actuals.expenseTotal === 200 && actuals.billableExpense === 200);

    // ---- unbilled + budget + health (tasks 24, 28, 32) ----
    const unb = unbilledTotals(project);
    check("unbilled shows approved-but-not-invoiced time + expenses", unb.hours === 8 && unb.revenue === 1400 && unb.timeCount === 1 && unb.expenseCount === 1, JSON.stringify(unb));
    const health = healthOf(project);
    check("project health is on-track with a small burn", health.status === "on-track", JSON.stringify(health));
    const profit = profitability(project);
    check("profitability derives revenue/cost/margin from actuals", profit.revenue === 1400 && profit.cost === 680 && Math.abs(profit.margin - 720 / 1400) < 1e-9, JSON.stringify(profit));

    // ---- invoice generation + locking (task 27) ----
    const inv = await createInvoice(project, { date: todayIso(), status: "draft" });
    track("billing", inv);
    check("invoice numbered and priced from the rate card", inv.number === "INV-0001" && inv.subtotal === 1400 && inv.total === 1400 && inv.lineItems.length === 2, JSON.stringify({ number: inv.number, subtotal: inv.subtotal, lines: inv.lineItems.length }));
    check("invoice line items carry refs back to time + expense", inv.lineItems.some((li) => li.refs && li.refs.some((r) => r.type === "timesheet" && r.id === "ft-ts-1")) && inv.lineItems.some((li) => li.refs && li.refs.some((r) => r.type === "expense" && r.id === "ft-exp-1")));
    check("invoiced expense is locked to the invoice (audit trail)", (() => {
      const e = getRecord("expenses", "ft-exp-1");
      return e.locked === true && e.postedToInvoiceId === inv.id && e.status === "posted";
    })(), "");
    check("invoiced timesheet is stamped as invoiced", (() => {
      const t = getRecord("timesheets", "ft-ts-1");
      return t.invoiceId === inv.id && !!t.invoicedAt;
    })(), "");
    check("unbilled drops to zero after invoicing", (() => {
      const u = unbilledTotals(project);
      return u.hours === 0 && u.revenue === 0;
    })(), "");
    check("double invoicing the same project has nothing left to bill", (() => {
      const items = invoiceableItems(project);
      return items.items.length === 0;
    })(), "");

    // ---- credit note (task 28) ----
    const cn = await createCreditNote(inv, 500, "Client discount applied", "ft-actor");
    track("billing", cn);
    check("credit note is issued against the invoice with a required reason", cn.kind === "creditnote" && cn.invoiceId === inv.id && cn.reason === "Client discount applied" && cn.amount === 500);
    let cnOverThrew = false;
    try { await createCreditNote(inv, 99999, "Too much"); } catch (e) { cnOverThrew = true; }
    check("credit note cannot exceed the outstanding balance", cnOverThrew, "");

    // ---- scope change (task 14) ----
    const change = track("scopechanges", {
      id: "ft-sc-1", projectId: project.id, sowId: sow.id, title: "Extra milestone",
      status: "approved", impactHours: 10, impactValue: 1500, impactEndDate: addDays(todayIso(), 90),
    });
    const projAfter = await applyScopeChange(change, "ft-actor");
    check("approved scope change moves project budget + schedule", projAfter.budgetHours === 50 && projAfter.budgetValue === 7500 && projAfter.plannedEnd === change.impactEndDate, JSON.stringify({ h: projAfter.budgetHours, v: projAfter.budgetValue }));
    check("scope change records a versioned SOW revision", (() => {
      const s = getRecord("sows", sow.id);
      return s.budgetHours === 50 && s.budgetValue === 7500 && s.revisionHistory && s.revisionHistory.length === 1;
    })(), "");
    let scopeDraftThrew = false;
    try { await applyScopeChange(Object.assign({}, change, { status: "draft" }), "x"); } catch (e) { scopeDraftThrew = true; }
    check("unapproved scope changes are refused", scopeDraftThrew, "");

    // ---- billing methods (task 26) ----
    const fixedProj = track("projects", {
      id: "ft-proj-fixed", clientId: client.id, name: "Fixed Fee Project", status: "planning",
      billingMethod: "fixed", budgetValue: 5000, taxRate: 0, budgetHours: 20,
    });
    check("fixed-fee project invoices the whole fee once", (() => {
      const items = invoiceableItems(fixedProj, snapshot());
      return items.type === "fixed" && items.items.length === 1 && items.items[0].amount === 5000;
    })(), "");
    const fixedInv = await createInvoice(fixedProj, { date: todayIso() });
    track("billing", fixedInv);
    check("fixed-fee invoice has amountType fixed", fixedInv.amountType === "fixed" && fixedInv.total === 5000);
    let fixedTwiceThrew = false;
    try { await createInvoice(fixedProj); } catch (e) { fixedTwiceThrew = true; }
    check("a second fixed-fee invoice is refused (fee already invoiced)", fixedTwiceThrew, "");

    const mileProj = track("projects", {
      id: "ft-proj-mile", clientId: client.id, name: "Milestone Project", status: "planning",
      billingMethod: "milestone", taxRate: 0, budgetHours: 0,
      milestones: [
        { id: "ms-1", title: "Kickoff", value: 1000, status: "done", completedAt: nowIso() },
        { id: "ms-2", title: "Delivery", value: 2000, status: "pending" },
      ],
    });
    check("milestone project invoices only completed milestones", (() => {
      const items = invoiceableItems(mileProj, snapshot());
      return items.type === "milestone" && items.items.length === 1 && items.items[0].amount === 1000;
    })(), "");
    const mileInv = await createInvoice(mileProj, { date: todayIso() });
    track("billing", mileInv);
    check("milestone invoice totals the completed milestone", mileInv.amountType === "milestone" && mileInv.total === 1000);
    check("completed milestone is no longer re-invoiceable", invoiceableItems(mileProj, snapshot()).items.length === 0);

    // ---- conflicts & sync state (task 3) ----
    ftCol = registerCollection({ id: "ftconflict", maxDocBytes: 4000 });
    await saveRecord("ftconflict", { id: "x", v: 1 });
    const shardName = getDocInfo("ftconflict").shards[0].name;
    const conflict = track("conflicts", {
      id: "cf-ft-test-1",
      kind: "conflict",
      shardName,
      colId: "ftconflict",
      localRev: 1,
      remoteRev: 9,
      localRecords: { x: { id: "x", v: 1 } },
      remoteRecords: { x: { id: "x", v: 2 } },
      createdAt: nowIso(),
      status: "pending",
    });
    await store.saveRecord("conflicts", conflict);
    check("crafted conflict shows up in the pending-conflict queue", pendingConflicts().some((c) => c.id === conflict.id), JSON.stringify(pendingConflicts().map((c) => c.id)));
    await resolveConflict(conflict.id, "keep-theirs", { resolvedBy: "ft-actor" });
    check("keep-theirs adopts the remote version of the record", getRecord("ftconflict", "x").v === 2);
    check("resolving clears the conflict from the queue", !pendingConflicts().some((c) => c.id === conflict.id));
    check("resolved conflict records the outcome + actor", (() => {
      const c = getRecord("conflicts", conflict.id);
      return c.status === "resolved" && c.resolution === "keep-theirs" && c.resolvedBy === "ft-actor";
    })(), "");
    check("getSyncState exposes per-document rev/dirty/conflict shape", (() => {
      const st = getSyncState();
      return typeof st.mode === "string" && Array.isArray(st.shards) && st.shards.every((s) => typeof s.name === "string" && typeof s.rev === "number" && typeof s.recordCount === "number");
    })(), "");

    // ---- backup & restore (task 4) ----
    const backupText = JSON.stringify(await buildBackup());
    check("validateBackup accepts a freshly built backup", (() => {
      const v = validateBackup(backupText);
      return v.ok && v.summary.counts.clients >= 1 && v.summary.counts.billing >= 1;
    })(), "");
    check("validateBackup rejects malformed payloads", !validateBackup("not json").ok && !validateBackup(JSON.stringify({ app: "nope" })).ok);
    await removeRecord("clients", "ft-client");
    check("fixture removed before restore (proves restore brings it back)", getRecord("clients", "ft-client") === null);
    const restore1 = await restoreBackup(backupText, { flush: false });
    check("restore from backup restores the removed record", restore1.ok && getRecord("clients", "ft-client") !== null && restore1.results.clients.unchanged === false, JSON.stringify(restore1.results.clients));
    const restore2 = await restoreBackup(backupText, { flush: false });
    check("re-restoring identical content is a safe no-op", restore2.ok && restore2.results.clients.unchanged === true, JSON.stringify(restore2.results.clients));

    // ---- integrity checks (task 37) ----
    const badTs = track("timesheets", { id: "ft-bad-ts", projectId: "ft-no-such-project", resourceId: res.id, date: todayIso(), hours: 8, billable: false, status: "draft" });
    await store.saveRecord("timesheets", badTs);
    const issues = runChecks();
    check("integrity flags a timesheet pointing at a missing project", issues.some((i) => i.severity === "err" && i.module === "timesheets" && i.refs.includes("ft-bad-ts")), JSON.stringify(issues.filter((i) => i.module === "timesheets").map((i) => i.message)));
    check("healthSummary grades errors as failing", (() => {
      const s = healthSummary(issues);
      return s.errors >= 1 && s.ok === false && s.grade === "errors";
    })(), "");
    await removeRecord("timesheets", "ft-bad-ts");
    check("integrity is clean once the broken reference is removed", !runChecks().some((i) => i.refs.includes("ft-bad-ts")));

    // ---- CSV tooling + importers (tasks 30, 31) ----
    const csvText = "name,role,hours\nAda,Consultant,8\nBob,PM,4";
    check("toCsv → parseCsv round-trips content", (() => {
      const rows = parseCsv(toCsv([["name", "role", "hours"], ["Ada", "Consultant", "8"], ["Bob", "PM", "4"]]));
      return rows.length === 3 && rows[1][0] === "Ada" && rows[2][2] === "4";
    })(), JSON.stringify(parseCsv(csvText)));
    check("CSV resources importer builds a valid resource record", (() => {
      const errors = [];
      const rec = IMPORTERS.resources.build(["Grace Hopper", "grace@x.com", "Consultant|PM", "90", "0.8", "true"], errors);
      return errors.length === 0 && rec.name === "Grace Hopper" && rec.roles.length === 2 && rec.costRate === 90 && rec.targetUtilization === 0.8;
    })(), "");
    check("CSV resources importer reports row-level errors", (() => {
      const errors = [];
      const rec = IMPORTERS.resources.build(["", "x@x.com", "", "abc", "", ""], errors);
      return rec === null && errors.length >= 1;
    })(), "");
    check("CSV workplans importer resolves a project by id", (() => {
      const errors = [];
      const rec = IMPORTERS.workplans.build([project.id, project.name, "ETL build", "Consultant", "40", todayIso(), "inprogress"], errors);
      return errors.length === 0 && rec.projectId === project.id && rec.effortHours === 40;
    })(), "");
    check("CSV workplans importer errors on an unknown project", (() => {
      const errors = [];
      const rec = IMPORTERS.workplans.build(["", "No Such Project Name", "Task", "", "1", "", ""], errors);
      return rec === null && errors.length >= 1;
    })(), "");

    // ---- snapshot completeness ----
    check("snapshot covers all master-core collections", (() => {
      const s = snapshot();
      return s.clients && s.ratecards && s.sows && s.projects && s.workplans && s.allocations && s.timesheets && s.expenses && s.billing && s.opportunities && s.archive && s.scopechanges;
    })(), "");
  } finally {
    for (const col of Object.keys(created)) {
      for (const id of created[col]) {
        try { await removeRecord(col, id); } catch (e) {}
      }
    }
    try {
      for (const r of getAllRecords("ftconflict")) await removeRecord("ftconflict", r.id);
    } catch (e) {}
  }

  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
