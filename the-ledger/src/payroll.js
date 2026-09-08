/* ============================================================================
   THE LEDGER — payroll.js
   Simple Payroll & Workforce Management (Phase 6, tasks 29–33):
    29. Employee profile management — full name, unique employee ID, hourly or
        salary rate, and per-employee withholding percentages (federal, state,
        other).
    30. Timesheet entry & submission — hours per employee per pay period with
        a draft → submitted → approved workflow.
    31. Payroll calculation engine — gross pay from approved hours × rate
        (hourly) or the flat period rate (salary), minus statutory
        withholdings, to determine net pay.
    32. Payslip generation — a read-only document per employee per run showing
        gross, each deduction, net and the pay period.
    33. Payroll ledger integration — posting a run debits the payroll expense
        account (5600) for gross, credits cash for net, and credits liability
        accounts for each withholding (federal 2210, state 2220, other 2200).
   Data persists per-browser via FW.store (kv-plugin folder "ledgerly"):
     key "pay_employees"  → array of employee objects
     key "pay_timesheets" → array of timesheet objects
     key "pay_runs"       → array of pay-run objects
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;
  const Ledger = window.Ledger;
  const K = { employees: "pay_employees", timesheets: "pay_timesheets", runs: "pay_runs" };

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function parseDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  async function nextNo(prefix, list) {
    let max = 0;
    const re = new RegExp("^" + prefix + "-(\\d+)$");
    for (const x of list) { const m = re.exec(x.no || ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return prefix + "-" + String(max + 1).padStart(4, "0");
  }
  function thisWeek() {
    const d = new Date();
    const day = d.getDay() || 7; // Monday = 1 … Sunday = 7
    const mon = new Date(d); mon.setDate(d.getDate() - day + 1);
    const sun = new Date(d); sun.setDate(d.getDate() - day + 7);
    const f = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
    return { start: f(mon), end: f(sun) };
  }

  /* ── persistence ─────────────────────────────────────────────────────── */
  async function loadEmployees() { const v = await FW.store.get(K.employees, null); return Array.isArray(v) ? v : []; }
  async function saveEmployees(list) { await FW.store.set(K.employees, list); }
  async function loadTimesheets() { const v = await FW.store.get(K.timesheets, null); return Array.isArray(v) ? v : []; }
  async function saveTimesheets(list) { await FW.store.set(K.timesheets, list); }
  async function loadRuns() { const v = await FW.store.get(K.runs, null); return Array.isArray(v) ? v : []; }
  async function saveRuns(list) { await FW.store.set(K.runs, list); }

  /* ── employees (task 29) ─────────────────────────────────────────────── */
  async function saveEmployee(e, list) {
    const x = Object.assign({}, e);
    if (!x.id) x.id = uid("emp");
    if (!x.no) x.no = await nextNo("EMP", list);
    if (!x.createdAt) x.createdAt = new Date().toISOString();
    x.updatedAt = new Date().toISOString();
    x.name = String(x.name || "").trim();
    if (!x.name) return { error: "Employee name is required." };
    x.payType = x.payType === "salary" ? "salary" : "hourly";
    x.rate = amt(x.rate);
    if (x.rate <= 0) return { error: "Pay rate must be greater than zero." };
    x.withholding = {
      federal: Math.min(Math.max(amt(x.withholding && x.withholding.federal), 0), 100),
      state: Math.min(Math.max(amt(x.withholding && x.withholding.state), 0), 100),
      other: Math.min(Math.max(amt(x.withholding && x.withholding.other), 0), 100),
    };
    const prev = list.find(y => y.id === x.id) || null;
    const i = list.findIndex(y => y.id === x.id);
    if (i >= 0) list[i] = x; else list.push(x);
    await saveEmployees(list);
    await Ledger.auditLog(prev ? "employee.update" : "employee.create", {
      entity: "employee", entityId: x.id, entityLabel: x.no + " · " + x.name,
      summary: (prev ? "Edited " : "Created ") + "employee " + x.name + " — " + x.payType + " @ " + FW.money(x.rate) + (x.payType === "hourly" ? "/hr" : "/period"),
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(x),
    });
    return x;
  }
  async function setEmployeeActive(id, active) {
    const list = await loadEmployees();
    const e = list.find(x => x.id === id);
    if (!e) return { error: "Employee not found." };
    const prev = Ledger.cloneObj(e);
    e.active = !!active;
    e.updatedAt = new Date().toISOString();
    await saveEmployees(list);
    await Ledger.auditLog("employee.update", {
      entity: "employee", entityId: e.id, entityLabel: e.no + " · " + e.name,
      summary: e.name + " " + (active ? "rehired" : "terminated") + " (payroll " + (active ? "active" : "inactive") + ")",
      prev, next: Ledger.cloneObj(e),
    });
    return { ok: true };
  }
  async function deleteEmployee(id) {
    const list = await loadEmployees();
    const e = list.find(x => x.id === id);
    if (!e) return { error: "Employee not found." };
    const [ts, runs] = await Promise.all([loadTimesheets(), loadRuns()]);
    if (ts.some(t => t.employeeId === id) || runs.some(r => r.lines.some(l => l.employeeId === id)))
      return { error: "This employee has timesheets or pay runs — set them inactive instead of deleting." };
    const i = list.indexOf(e); list.splice(i, 1);
    await saveEmployees(list);
    await Ledger.auditLog("employee.delete", {
      entity: "employee", entityId: id, entityLabel: e.no + " · " + e.name,
      summary: "Deleted employee " + e.name, prev: Ledger.cloneObj(e), next: null,
    });
    return { ok: true };
  }

  /* ── timesheets (task 30) ────────────────────────────────────────────── */
  async function saveTimesheet(t, list) {
    const x = Object.assign({}, t);
    if (!x.id) x.id = uid("ts");
    if (!x.no) x.no = await nextNo("TS", list);
    if (!x.createdAt) x.createdAt = new Date().toISOString();
    x.updatedAt = new Date().toISOString();
    x.hours = Math.max(amt(x.hours), 0);
    if (!x.employeeId) return { error: "Pick an employee." };
    if (!x.periodStart || !x.periodEnd) return { error: "Period start and end are required." };
    if (String(x.periodEnd) < String(x.periodStart)) return { error: "Period end must be after start." };
    const prev = list.find(y => y.id === x.id) || null;
    const i = list.findIndex(y => y.id === x.id);
    if (i >= 0) list[i] = x; else list.push(x);
    await saveTimesheets(list);
    await Ledger.auditLog(prev ? "timesheet.update" : "timesheet.create", {
      entity: "timesheet", entityId: x.id, entityLabel: x.no + " · " + x.periodStart + " → " + x.periodEnd,
      summary: (prev ? "Edited " : "Created ") + "timesheet " + x.no + " — " + x.hours + "h",
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(x),
    });
    return x;
  }
  async function setTimesheetStatus(id, status) {
    const list = await loadTimesheets();
    const t = list.find(x => x.id === id);
    if (!t) return { error: "Timesheet not found." };
    const prev = Ledger.cloneObj(t);
    if (status === "submitted") {
      if (t.status !== "draft") return { error: "Only drafts can be submitted." };
      t.status = "submitted"; t.submittedAt = new Date().toISOString();
    } else if (status === "approved") {
      if (t.status !== "submitted") return { error: "Only submitted timesheets can be approved." };
      t.status = "approved"; t.approvedAt = new Date().toISOString();
    } else return { error: "Unknown status." };
    t.updatedAt = new Date().toISOString();
    await saveTimesheets(list);
    await Ledger.auditLog(status === "approved" ? "timesheet.approve" : "timesheet.submit", {
      entity: "timesheet", entityId: t.id, entityLabel: t.no + " · " + t.periodStart + " → " + t.periodEnd,
      summary: "Timesheet " + t.no + " " + status + " — " + t.hours + "h",
      prev, next: Ledger.cloneObj(t),
    });
    return { ok: true };
  }
  async function deleteTimesheet(id) {
    const list = await loadTimesheets();
    const t = list.find(x => x.id === id);
    if (!t) return { error: "Timesheet not found." };
    if (t.status !== "draft") return { error: "Only draft timesheets can be deleted." };
    const i = list.indexOf(t); list.splice(i, 1);
    await saveTimesheets(list);
    await Ledger.auditLog("timesheet.delete", {
      entity: "timesheet", entityId: id, entityLabel: t.no,
      summary: "Deleted timesheet " + t.no, prev: Ledger.cloneObj(t), next: null,
    });
    return { ok: true };
  }

  /* ── payroll engine (task 31) ────────────────────────────────────────── */
  function computeLines(periodStart, periodEnd, employees, timesheets) {
    const inRange = timesheets.filter(t => t.status === "approved" && t.periodStart <= periodEnd && t.periodEnd >= periodStart);
    const hoursBy = {};
    for (const t of inRange) hoursBy[t.employeeId] = round2((hoursBy[t.employeeId] || 0) + t.hours);
    const lines = [];
    for (const e of employees) {
      if (e.active === false) continue;
      const hours = round2(hoursBy[e.id] || 0);
      const gross = e.payType === "salary" ? round2(e.rate) : round2(hours * e.rate);
      if (gross <= 0 && e.payType === "hourly") continue;
      const w = e.withholding || {};
      const fed = round2(gross * amt(w.federal) / 100);
      const state = round2(gross * amt(w.state) / 100);
      const other = round2(gross * amt(w.other) / 100);
      lines.push({ employeeId: e.id, name: e.name, payType: e.payType, hours, gross, fed, state, other, net: round2(gross - fed - state - other) });
    }
    return lines;
  }
  function runTotals(lines) {
    const t = { gross: 0, fed: 0, state: 0, other: 0, net: 0 };
    for (const l of lines) {
      t.gross = round2(t.gross + amt(l.gross));
      t.fed = round2(t.fed + amt(l.fed));
      t.state = round2(t.state + amt(l.state));
      t.other = round2(t.other + amt(l.other));
      t.net = round2(t.net + amt(l.net));
    }
    return t;
  }

  /* ── pay runs ────────────────────────────────────────────────────────── */
  async function saveRun(run, list) {
    const x = Object.assign({}, run);
    if (!x.id) x.id = uid("pr");
    if (!x.no) x.no = await nextNo("PR", list);
    if (!x.createdAt) x.createdAt = new Date().toISOString();
    x.updatedAt = new Date().toISOString();
    x.totals = runTotals(x.lines || []);
    const prev = list.find(y => y.id === x.id) || null;
    const i = list.findIndex(y => y.id === x.id);
    if (i >= 0) list[i] = x; else list.push(x);
    await saveRuns(list);
    await Ledger.auditLog(prev ? "payrun.update" : "payrun.create", {
      entity: "payrun", entityId: x.id, entityLabel: x.no + " · " + x.periodStart + " → " + x.periodEnd,
      summary: (prev ? "Updated " : "Created ") + "pay run " + x.no + " — " + FW.money(x.totals.gross) + " gross / " + FW.money(x.totals.net) + " net",
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(x),
    });
    return x;
  }
  async function deleteRun(id) {
    const list = await loadRuns();
    const r = list.find(x => x.id === id);
    if (!r) return { error: "Pay run not found." };
    if (r.status === "posted") return { error: "Posted pay runs can't be deleted — the ledger entry stays." };
    const i = list.indexOf(r); list.splice(i, 1);
    await saveRuns(list);
    await Ledger.auditLog("payrun.delete", {
      entity: "payrun", entityId: id, entityLabel: r.no,
      summary: "Deleted pay run " + r.no, prev: Ledger.cloneObj(r), next: null,
    });
    return { ok: true };
  }

  /* ── ledger integration (task 33) ────────────────────────────────────── */
  function payrollExpenseId(accounts) {
    let a = accounts.find(x => x.code === "5600" && x.type === "expense");
    if (!a) a = accounts.find(x => x.type === "expense" && /payroll|wage|salary/i.test(x.name || ""));
    if (!a) a = accounts.find(x => x.type === "expense");
    return a ? a.id : null;
  }
  function cashAccountId(accounts) {
    let a = accounts.find(x => x.code === "1010" && x.type === "asset");
    if (!a) a = accounts.find(x => x.type === "asset" && /check|bank|cash/i.test(x.name || ""));
    if (!a) a = accounts.find(x => x.type === "asset");
    return a ? a.id : null;
  }
  function liabilityId(accounts, code, nameRe) {
    let a = accounts.find(x => x.code === code && x.type === "liability");
    if (!a) a = accounts.find(x => x.type === "liability" && nameRe.test(x.name || ""));
    return a ? a.id : null;
  }
  function buildEntryFromRun(run, accounts, exp, cash) {
    const t = runTotals(run.lines || []);
    const lines = [{ account: exp, desc: "Payroll gross — " + run.no + " (" + run.periodStart + " → " + run.periodEnd + ")", debit: t.gross, credit: 0 }];
    const parts = [
      { key: "fed", amount: t.fed, desc: "Federal withholding", code: "2210", re: /federal/i },
      { key: "state", amount: t.state, desc: "State withholding", code: "2220", re: /state/i },
      { key: "other", amount: t.other, desc: "Other withholding", code: "2200", re: /other|payroll liab/i },
    ];
    const usedLiability = {};
    for (const p of parts) {
      if (p.amount <= 0) continue;
      const accId = liabilityId(accounts, p.code, p.re) || (accounts.find(x => x.type === "liability") || {}).id || null;
      usedLiability[p.key] = !!accId;
      if (accId) lines.push({ account: accId, desc: p.desc + " — " + run.no, debit: 0, credit: p.amount });
      else lines.push({ account: exp, desc: p.desc + " (no liability account — expensed)", debit: 0, credit: p.amount });
    }
    lines.push({ account: cash, desc: "Net pay — " + run.no, debit: 0, credit: t.net });
    return { run, totals: t, lines, usedLiability };
  }
  async function postRun(id) {
    const runs = await loadRuns();
    const r = runs.find(x => x.id === id);
    if (!r) return { error: "Pay run not found." };
    if (r.status === "posted") return { error: "Pay run is already posted." };
    const accounts = await Ledger.loadAccounts();
    const exp = payrollExpenseId(accounts), cash = cashAccountId(accounts);
    if (!exp || !cash) return { error: "Need a payroll expense account and a cash/bank account in the chart of accounts." };
    const built = buildEntryFromRun(r, accounts, exp, cash);
    if (built.totals.net < 0) return { error: "Net pay can't be negative." };
    const entry = {
      date: r.date || today(),
      reference: r.no + " · " + (r.periodStart + " → " + r.periodEnd),
      memo: "Payroll " + r.no + " — " + built.totals.gross + " gross / " + built.totals.net + " net",
      status: "draft", lines: built.lines,
    };
    const entries = await Ledger.loadEntries();
    entry.no = await Ledger.nextEntryNo(entries);
    const res = await Ledger.saveEntry(entry, accounts);
    if (res && res.error) return { error: res.error };
    const posted = await Ledger.postEntry(res.id);
    if (posted.error) {
      const ents = await Ledger.loadEntries();
      const i = ents.findIndex(x => x.id === res.id);
      if (i >= 0) { ents.splice(i, 1); await Ledger.saveEntries(ents); }
      return { error: posted.error };
    }
    const prev = Ledger.cloneObj(r);
    r.status = "posted";
    r.ledgerEntryId = res.id;
    r.entryNo = entry.no;
    r.postedAt = new Date().toISOString();
    r.updatedAt = new Date().toISOString();
    await saveRuns(runs);
    const liabNote = built.usedLiability.fed && built.usedLiability.state && built.usedLiability.other ? "" : " (some withholdings expensed — add 2210/2220/2200 liability accounts)";
    await Ledger.auditLog("payrun.post", {
      entity: "payrun", entityId: r.id, entityLabel: r.no,
      summary: "Posted pay run " + r.no + " — entry " + entry.no + " (" + built.totals.gross + " gross, " + built.totals.net + " net)" + liabNote,
      prev, next: Ledger.cloneObj(r),
    });
    return { ok: true, entryId: res.id, entryNo: entry.no, totals: built.totals, usedLiability: built.usedLiability };
  }

  /* ── payslips (task 32) ──────────────────────────────────────────────── */
  async function payslips(employeeId) {
    const runs = await loadRuns();
    const out = [];
    for (const r of runs) {
      if (r.status !== "posted") continue;
      const l = (r.lines || []).find(x => x.employeeId === employeeId);
      if (!l) continue;
      out.push({ run: r, line: l });
    }
    return out.sort((a, b) => String(b.run.date || "").localeCompare(String(a.run.date || "")));
  }

  /* ── module renderer ─────────────────────────────────────────────────── */
  async function render(m) {
    m.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 6 — Payroll"));
    head.appendChild(FW.el("h1", null, null, { text: "Payroll" }));
    head.appendChild(FW.el("p", "lede", "Employees with hourly or salary rates and withholding percentages, a draft → submitted → approved timesheet workflow, pay runs that compute gross → withholdings → net, read-only payslips, and posting that debits payroll expense and credits cash plus withholding liabilities."));
    m.appendChild(head);

    const tabs = FW.el("div", "ledger-tabs");
    tabs.innerHTML =
      '<button class="ledger-tab active" data-tab="employees">Employees</button>' +
      '<button class="ledger-tab" data-tab="timesheets">Timesheets</button>' +
      '<button class="ledger-tab" data-tab="runs">Pay runs</button>' +
      '<button class="ledger-tab" data-tab="payslips">Payslips</button>';
    m.appendChild(tabs);

    const ctn = FW.el("div", "ledger-tab-ctn");
    m.appendChild(ctn);

    const switchTab = name => {
      FW.$$(".ledger-tab", tabs).forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === name));
      if (name === "timesheets") renderTimesheets(ctn);
      else if (name === "runs") renderRuns(ctn);
      else if (name === "payslips") renderPayslips(ctn);
      else renderEmployees(ctn);
    };
    tabs.addEventListener("click", e => {
      const b = e.target.closest(".ledger-tab");
      if (b) switchTab(b.getAttribute("data-tab"));
    });

    switchTab("employees");

    const note = FW.el("p", "note small");
    note.style.cssText = "margin-top:18px";
    note.innerHTML = "<strong>Phase 6 is complete (tasks 29–33)</strong> — employee profiles, timesheets with approval, the pay calculation engine, read-only payslips, and ledger posting (DR 5600 gross / CR cash net / CR 2210 federal / CR 2220 state / CR 2200 other).";
    m.appendChild(note);
  }

  /* ── employees tab ───────────────────────────────────────────────────── */
  async function renderEmployees(ctn) {
    const list = await loadEmployees();
    let html = '<div class="card"><div class="card-head"><h3>Employees</h3>' +
      '<button class="btn btn-primary btn-sm" id="emNewBtn">+ New employee</button></div>';
    if (!list.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No employees yet. Add employees, then record timesheets, build pay runs and post them to the ledger.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>ID</th><th>Name</th><th>Pay type</th><th class="num">Rate</th><th class="num">Fed %</th><th class="num">State %</th><th class="num">Other %</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const e of [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
        const w = e.withholding || {};
        html += "<tr>" +
          '<td class="acct-code">' + esc(e.no || "—") + "</td>" +
          "<td>" + esc(e.name) + (e.email ? '<div class="muted small">' + esc(e.email) + "</div>" : "") + "</td>" +
          "<td>" + esc(e.payType === "salary" ? "Salary" : "Hourly") + "</td>" +
          '<td class="num">' + FW.money(amt(e.rate)) + (e.payType === "hourly" ? '<div class="muted small">/hr</div>' : '<div class="muted small">/period</div>') + "</td>" +
          '<td class="num">' + amt(w.federal) + "%</td>" +
          '<td class="num">' + amt(w.state) + "%</td>" +
          '<td class="num">' + amt(w.other) + "%</td>" +
          '<td><span class="chip ' + (e.active !== false ? "chip-done" : "chip-pending") + '">' + (e.active !== false ? "active" : "inactive") + "</span></td>" +
          '<td class="fit"><div class="row-flex" style="gap:6px;justify-content:flex-end">' +
          '<button class="icon-btn" data-act="edit" data-id="' + esc(e.id) + '" title="Edit">' + ICON.pencil + "</button>" +
          '<button class="icon-btn" data-act="toggle" data-id="' + esc(e.id) + '" title="' + (e.active !== false ? "Deactivate" : "Activate") + '">' + (e.active !== false ? ICON.pause : ICON.play) + "</button>" +
          '<button class="icon-btn" data-act="del" data-id="' + esc(e.id) + '" title="Delete">' + ICON.trash + "</button>" +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#emNewBtn").addEventListener("click", () => openEmployeeModal(null));
    ctn.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const id = b.getAttribute("data-id");
      const act = b.getAttribute("data-act");
      if (act === "edit") openEmployeeModal(id);
      else if (act === "toggle") {
        const em = list.find(x => x.id === id);
        if (!em) return;
        setEmployeeActive(id, em.active === false).then(() => { FW.toast(em.name + " " + (em.active === false ? "rehired" : "terminated")); renderEmployees(ctn); });
      } else if (act === "del") {
        confirmDialog("Delete this employee?", "Employees with timesheets or pay runs must be deactivated instead of deleted.", () => deleteEmployee(id).then(r => {
          if (r && r.error) FW.toast(r.error, "err");
          else { FW.toast("Employee deleted"); renderEmployees(ctn); }
        }), "Delete employee");
      }
    });
  }

  function openEmployeeModal(id) {
    (async () => {
      const list = await loadEmployees();
      const e = id ? list.find(x => x.id === id) : null;
      const w = (e && e.withholding) || {};
      const modal = FW.modal(
        '<div class="modal-head"><h3>' + (e ? "Edit employee" : "New employee") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
        '<div class="modal-body"><div class="row-flex">' +
        '<div class="field" style="flex:1 1 190px"><label>Full name</label><input id="emName" placeholder="e.g. Jane Doe" value="' + esc(e ? e.name || "" : "") + '"></div>' +
        '<div class="field" style="flex:1 1 190px"><label>Email</label><input id="emEmail" placeholder="jane@example.com" value="' + esc(e ? e.email || "" : "") + '"></div>' +
        '<div class="field" style="flex:0 0 120px"><label>Pay type</label><select id="emType"><option value="hourly"' + (e ? (e.payType === "salary" ? "" : " selected") : " selected") + ">Hourly</option><option value=\"salary\"" + (e && e.payType === "salary" ? " selected" : "") + ">Salary</option></select></div>" +
        '<div class="field" style="flex:0 0 120px"><label id="emRateLbl">Rate /hr</label><input id="emRate" type="number" min="0" step="any" value="' + (e ? e.rate : "") + '"></div>' +
        "</div><div class=\"row-flex\">" +
        '<div class="field" style="flex:0 0 100px"><label>Fed %</label><input id="emFed" type="number" min="0" max="100" step="any" value="' + (e ? w.federal : 0) + '"></div>' +
        '<div class="field" style="flex:0 0 100px"><label>State %</label><input id="emState" type="number" min="0" max="100" step="any" value="' + (e ? w.state : 0) + '"></div>' +
        '<div class="field" style="flex:0 0 100px"><label>Other %</label><input id="emOther" type="number" min="0" max="100" step="any" value="' + (e ? w.other : 0) + '"></div>' +
        '<div class="field" style="flex:0 0 110px"><label>Active</label><select id="emActive"><option value="1"' + (e ? (e.active !== false ? " selected" : "") : " selected") + ">Yes</option><option value=\"0\"" + (e && e.active === false ? " selected" : "") + ">No</option></select></div>" +
        "</div></div>" +
        '<div class="modal-foot"><button class="btn btn-primary btn-sm" id="emSaveBtn">Save employee</button>' +
        '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div>');
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
      modal.querySelector("#emType").addEventListener("change", e2 => {
        modal.querySelector("#emRateLbl").textContent = e2.target.value === "salary" ? "Rate /period" : "Rate /hr";
      });
      modal.querySelector("#emSaveBtn").addEventListener("click", async () => {
        const out = await saveEmployee({
          id: e ? e.id : null,
          name: modal.querySelector("#emName").value,
          email: modal.querySelector("#emEmail").value,
          payType: modal.querySelector("#emType").value,
          rate: amt(modal.querySelector("#emRate").value),
          withholding: {
            federal: amt(modal.querySelector("#emFed").value),
            state: amt(modal.querySelector("#emState").value),
            other: amt(modal.querySelector("#emOther").value),
          },
          active: modal.querySelector("#emActive").value === "1",
          createdAt: e ? e.createdAt : null,
        }, await loadEmployees());
        if (out && out.error) { FW.toast(out.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast(e ? "Employee updated" : "Employee created (" + out.no + ")");
        renderEmployees(document.querySelector(".ledger-tab-ctn"));
      });
    })();
  }

  /* ── timesheets tab ──────────────────────────────────────────────────── */
  async function renderTimesheets(ctn) {
    const [list, emps] = await Promise.all([loadTimesheets(), loadEmployees()]);
    const byId = {};
    for (const e of emps) byId[e.id] = e;
    const sorted = [...list].sort((a, b) => String(b.periodStart || "").localeCompare(String(a.periodStart || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    let html = '<div class="card"><div class="card-head"><h3>Timesheets</h3>' +
      '<button class="btn btn-primary btn-sm" id="tsNewBtn">+ New timesheet</button></div>' +
      '<p class="muted small" style="margin:0;padding:0 16px 10px">Hours flow <strong>draft → submitted → approved</strong>. Only approved hours are picked up by pay runs.</p>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No timesheets yet. Record hours per employee per period, then submit and approve them so a pay run can pick them up.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>No</th><th>Employee</th><th>Period</th><th class="num">Hours</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const t of sorted) {
        const em = byId[t.employeeId] || {};
        html += "<tr>" +
          '<td class="acct-code">' + esc(t.no || "—") + "</td>" +
          "<td>" + esc(em.name || "—") + "</td>" +
          "<td>" + esc(t.periodStart) + " → " + esc(t.periodEnd) + "</td>" +
          '<td class="num"><strong>' + t.hours + "</strong></td>" +
          '<td><span class="chip ' + ({ draft: "chip-pending", submitted: "chip-phase", approved: "chip-done" }[t.status] || "chip-pending") + '">' + esc(t.status) + "</span></td>" +
          '<td class="fit"><div class="row-flex" style="gap:6px;justify-content:flex-end">' +
          (t.status === "draft" ? '<button class="icon-btn" data-act="edit" data-id="' + esc(t.id) + '" title="Edit">' + ICON.pencil + "</button>" +
            '<button class="icon-btn" data-act="submit" data-id="' + esc(t.id) + '" title="Submit for approval">' + ICON.send + "</button>" +
            '<button class="icon-btn" data-act="del" data-id="' + esc(t.id) + '" title="Delete">' + ICON.trash + "</button>" : "") +
          (t.status === "submitted" ? '<button class="icon-btn" data-act="approve" data-id="' + esc(t.id) + '" title="Approve">' + ICON.check + "</button>" : "") +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#tsNewBtn").addEventListener("click", () => openTimesheetModal(null));
    ctn.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const id = b.getAttribute("data-id");
      const act = b.getAttribute("data-act");
      if (act === "edit") openTimesheetModal(id);
      else if (act === "submit") setTimesheetStatus(id, "submitted").then(r => { if (r.error) FW.toast(r.error, "err"); else FW.toast("Timesheet submitted"); renderTimesheets(ctn); });
      else if (act === "approve") setTimesheetStatus(id, "approved").then(r => { if (r.error) FW.toast(r.error, "err"); else FW.toast("Timesheet approved"); renderTimesheets(ctn); });
      else if (act === "del") {
        confirmDialog("Delete this timesheet?", "Only draft timesheets can be deleted.", () => deleteTimesheet(id).then(r => {
          if (r && r.error) FW.toast(r.error, "err");
          else { FW.toast("Timesheet deleted"); renderTimesheets(ctn); }
        }), "Delete timesheet");
      }
    });
  }

  function openTimesheetModal(id) {
    (async () => {
      const list = await loadTimesheets();
      const emps = await loadEmployees();
      const t = id ? list.find(x => x.id === id) : null;
      const wk = thisWeek();
      const opts = emps.filter(e => e.active !== false).map(e => '<option value="' + esc(e.id) + '"' + (t && t.employeeId === e.id ? " selected" : "") + ">" + esc(e.name) + " (" + esc(e.no || "") + ")</option>").join("");
      const modal = FW.modal(
        '<div class="modal-head"><h3>' + (t ? "Edit timesheet" : "New timesheet") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
        '<div class="modal-body"><div class="row-flex">' +
        '<div class="field" style="flex:1 1 220px"><label>Employee</label><select id="tsEmp">' + (opts || '<option value="">— no active employees —</option>') + "</select></div>" +
        '<div class="field" style="flex:0 0 140px"><label>Period start</label><input type="date" id="tsFrom" value="' + (t ? t.periodStart : wk.start) + '"></div>' +
        '<div class="field" style="flex:0 0 140px"><label>Period end</label><input type="date" id="tsTo" value="' + (t ? t.periodEnd : wk.end) + '"></div>' +
        '<div class="field" style="flex:0 0 100px"><label>Hours</label><input id="tsHours" type="number" min="0" step="0.01" value="' + (t ? t.hours : "") + '"></div>' +
        "</div></div>" +
        '<div class="modal-foot"><button class="btn btn-primary btn-sm" id="tsSaveBtn">Save timesheet</button>' +
        '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div>');
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
      modal.querySelector("#tsSaveBtn").addEventListener("click", async () => {
        const out = await saveTimesheet({
          id: t ? t.id : null,
          employeeId: modal.querySelector("#tsEmp").value,
          periodStart: modal.querySelector("#tsFrom").value,
          periodEnd: modal.querySelector("#tsTo").value,
          hours: amt(modal.querySelector("#tsHours").value),
          status: t ? t.status : "draft",
          createdAt: t ? t.createdAt : null,
        }, await loadTimesheets());
        if (out && out.error) { FW.toast(out.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast(t ? "Timesheet updated" : "Timesheet created");
        renderTimesheets(document.querySelector(".ledger-tab-ctn"));
      });
    })();
  }

  /* ── pay runs tab ────────────────────────────────────────────────────── */
  async function renderRuns(ctn) {
    const runs = await loadRuns();
    const sorted = [...runs].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    let html = '<div class="card"><div class="card-head"><h3>Pay runs</h3>' +
      '<button class="btn btn-primary btn-sm" id="prNewBtn">+ New pay run</button></div>' +
      '<p class="muted small" style="margin:0;padding:0 16px 10px">A run covers a pay period: approved timesheet hours × hourly rate (or the flat salary rate) minus withholdings. Save it as a draft to review, then post it to the ledger.</p>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No pay runs yet. Create one, generate the pay lines, and post it.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>No</th><th>Period</th><th>Pay date</th><th class="num">Employees</th><th class="num">Gross</th><th class="num">Net</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const r of sorted) {
        html += "<tr>" +
          '<td class="acct-code">' + esc(r.no || "—") + "</td>" +
          "<td>" + esc(r.periodStart) + " → " + esc(r.periodEnd) + "</td>" +
          "<td>" + esc(r.date || "—") + "</td>" +
          '<td class="num">' + (r.lines || []).length + "</td>" +
          '<td class="num">' + FW.money(r.totals ? r.totals.gross : 0) + "</td>" +
          '<td class="num"><strong>' + FW.money(r.totals ? r.totals.net : 0) + "</strong></td>" +
          '<td><span class="chip ' + (r.status === "posted" ? "chip-done" : "chip-pending") + '">' + esc(r.status || "draft") + "</span>" + (r.entryNo ? '<div class="muted small">' + esc(r.entryNo) + "</div>" : "") + "</td>" +
          '<td class="fit"><div class="row-flex" style="gap:6px;justify-content:flex-end">' +
          (r.status === "draft" ? '<button class="icon-btn" data-act="edit" data-id="' + esc(r.id) + '" title="Edit run">' + ICON.pencil + "</button>" +
            '<button class="icon-btn" data-act="post" data-id="' + esc(r.id) + '" title="Post to ledger">' + ICON.check + "</button>" +
            '<button class="icon-btn" data-act="del" data-id="' + esc(r.id) + '" title="Delete draft">' + ICON.trash + "</button>" :
            '<button class="icon-btn" data-act="view" data-id="' + esc(r.id) + '" title="View run">' + ICON.eye + "</button>") +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#prNewBtn").addEventListener("click", () => openRunModal(null));
    ctn.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const id = b.getAttribute("data-id");
      const act = b.getAttribute("data-act");
      if (act === "edit") openRunModal(id);
      else if (act === "view") openRunModal(id, true);
      else if (act === "post") {
        confirmDialog("Post this pay run to the ledger?", "This debits payroll expense for gross, credits cash for net and credits withholding liability accounts. The run becomes read-only.", () => postRun(id).then(r => {
          if (r && r.error) FW.toast(r.error, "err");
          else { FW.toast("Pay run posted — entry " + r.entryNo); renderRuns(ctn); }
        }), "Post run");
      } else if (act === "del") {
        confirmDialog("Delete this draft pay run?", "Posted runs can't be deleted.", () => deleteRun(id).then(r => {
          if (r && r.error) FW.toast(r.error, "err");
          else { FW.toast("Pay run deleted"); renderRuns(ctn); }
        }), "Delete run");
      }
    });
  }

  function openRunModal(id, readonly) {
    (async () => {
      const runs = await loadRuns();
      const r = id ? runs.find(x => x.id === id) : null;
      const wk = thisWeek();
      let html = '<div class="modal-head"><h3>' + (r ? (readonly ? "Pay run " + esc(r.no) : "Edit pay run " + esc(r.no)) : "New pay run") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>";
      html += '<div class="modal-body"><div class="row-flex">' +
        '<div class="field" style="flex:0 0 140px"><label>Period start</label><input type="date" id="prFrom" value="' + (r ? r.periodStart : wk.start) + '"' + (readonly ? " disabled" : "") + '></div>' +
        '<div class="field" style="flex:0 0 140px"><label>Period end</label><input type="date" id="prTo" value="' + (r ? r.periodEnd : wk.end) + '"' + (readonly ? " disabled" : "") + '></div>' +
        '<div class="field" style="flex:0 0 140px"><label>Pay date</label><input type="date" id="prDate" value="' + (r ? r.date : today()) + '"' + (readonly ? " disabled" : "") + '></div>' +
        (r && r.status === "posted" ? '<span class="chip chip-done" style="align-self:flex-end;margin-bottom:8px">posted · ' + esc(r.entryNo || "") + "</span>" : "") +
        "</div>";
      if (!readonly) html += '<button class="btn btn-ghost btn-sm" id="prGenBtn" style="margin-bottom:10px">Generate lines from approved timesheets</button>';
      html += '<div id="prLines"></div><div id="prTot" class="muted small"></div></div>';
      html += '<div class="modal-foot">';
      if (!readonly) html += '<button class="btn btn-primary btn-sm" id="prSaveBtn">Save draft</button>';
      html += '<button class="btn btn-ghost btn-sm" data-close>' + (readonly ? "Close" : "Cancel") + "</button></div>";
      const modal = FW.modal(html);
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
      const linesEl = modal.querySelector("#prLines");
      const totEl = modal.querySelector("#prTot");
      let lines = [];
      const emps = await loadEmployees();
      const byId = {};
      for (const e of emps) byId[e.id] = e;
      function renderLines() {
        linesEl.innerHTML = '<table class="tbl"><thead><tr><th>Employee</th><th class="num">Hours</th><th class="num">Gross</th><th class="num">Fed</th><th class="num">State</th><th class="num">Other</th><th class="num">Net</th>' + (readonly ? "" : '<th class="fit"></th>') + "</tr></thead><tbody>" +
          lines.map((l, i) => {
            const w = byId[l.employeeId] ? byId[l.employeeId].withholding : {};
            return "<tr>" +
              "<td>" + esc(l.name) + "</td>" +
              '<td class="num">' + (readonly ? l.hours : '<input class="pr-hrs" data-i="' + i + '" type="number" min="0" step="0.01" value="' + l.hours + '" style="width:70px;text-align:right">') + "</td>" +
              '<td class="num">' + (readonly ? FW.money(l.gross) : '<input class="pr-grs" data-i="' + i + '" type="number" min="0" step="0.01" value="' + l.gross + '" style="width:90px;text-align:right">') + "</td>" +
              '<td class="num">' + FW.money(l.fed) + "</td>" +
              '<td class="num">' + FW.money(l.state) + "</td>" +
              '<td class="num">' + FW.money(l.other) + "</td>" +
              '<td class="num"><strong>' + FW.money(l.net) + "</strong></td>" +
              (readonly ? "" : '<td class="fit"><button class="icon-mini danger" data-rm="' + i + '" title="Remove">' + ICON.x + "</button></td>") +
              "</tr>";
          }).join("") + "</tbody></table>";
        updateTotals();
      }
      function updateTotals() {
        if (readonly) {
          const t = runTotals(lines);
          totEl.textContent = "Gross " + FW.money(t.gross) + " · withholdings " + FW.money(t.fed + t.state + t.other) + " · net " + FW.money(t.net);
          return;
        }
        lines.forEach(l => {
          const row = linesEl.querySelector('[data-i="' + lines.indexOf(l) + '"]');
        });
        let g = 0;
        for (const l of lines) g = round2(g + amt(l.gross));
        let net = 0;
        for (const l of lines) net = round2(net + amt(l.net));
        totEl.textContent = "Gross " + FW.money(g) + " · net " + FW.money(net) + " — click Save draft to lock it in";
      }
      linesEl.addEventListener("input", e => {
        const inp = e.target.closest("input[data-i]");
        if (!inp) return;
        const i = Number(inp.getAttribute("data-i"));
        const l = lines[i];
        if (!l) return;
        const em = byId[l.employeeId] || { withholding: {} };
        const w = em.withholding || {};
        if (inp.classList.contains("pr-grs")) {
          l.gross = amt(inp.value);
          if (em.payType !== "salary") l.hours = amt(inp.value) / (amt(em.rate) || 1);
        } else {
          l.hours = amt(inp.value);
          if (em.payType !== "salary") l.gross = round2(l.hours * amt(em.rate));
        }
        l.fed = round2(l.gross * amt(w.federal) / 100);
        l.state = round2(l.gross * amt(w.state) / 100);
        l.other = round2(l.gross * amt(w.other) / 100);
        l.net = round2(l.gross - l.fed - l.state - l.other);
        renderLines();
      });
      linesEl.addEventListener("click", e => {
        const b = e.target.closest("[data-rm]");
        if (!b || readonly) return;
        lines.splice(Number(b.getAttribute("data-rm")), 1);
        renderLines();
      });
      if (r) {
        lines = (r.lines || []).map(l => Object.assign({}, l));
        renderLines();
      } else {
        renderLines();
      }
      const genBtn = modal.querySelector("#prGenBtn");
      if (genBtn) genBtn.addEventListener("click", async () => {
        const from = modal.querySelector("#prFrom").value, to = modal.querySelector("#prTo").value;
        const [emps2, tss] = await Promise.all([loadEmployees(), loadTimesheets()]);
        lines = computeLines(from, to, emps2, tss);
        if (!lines.length) { FW.toast("No approved hours or salary employees in this period.", "err"); return; }
        renderLines();
        FW.toast("Generated " + lines.length + " pay line" + (lines.length === 1 ? "" : "s"));
      });
      const saveBtn = modal.querySelector("#prSaveBtn");
      if (saveBtn) saveBtn.addEventListener("click", async () => {
        lines.forEach(l => {
          const em = byId[l.employeeId] || { withholding: {} };
          const w = em.withholding || {};
          l.fed = round2(amt(l.gross) * amt(w.federal) / 100);
          l.state = round2(amt(l.gross) * amt(w.state) / 100);
          l.other = round2(amt(l.gross) * amt(w.other) / 100);
          l.net = round2(amt(l.gross) - l.fed - l.state - l.other);
        });
        if (!lines.length) { FW.toast("Add at least one pay line.", "err"); return; }
        const out = await saveRun({
          id: r ? r.id : null,
          periodStart: modal.querySelector("#prFrom").value,
          periodEnd: modal.querySelector("#prTo").value,
          date: modal.querySelector("#prDate").value,
          status: "draft",
          lines,
          createdAt: r ? r.createdAt : null,
        }, await loadRuns());
        if (out && out.error) { FW.toast(out.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast(r ? "Pay run updated" : "Pay run saved as draft");
        renderRuns(document.querySelector(".ledger-tab-ctn"));
      });
    })();
  }

  /* ── payslips tab ────────────────────────────────────────────────────── */
  async function renderPayslips(ctn) {
    const emps = await loadEmployees();
    const opts = '<option value="">— choose an employee —</option>' + emps.map(e => '<option value="' + esc(e.id) + '">' + esc(e.name) + " (" + esc(e.no || "") + ")</option>").join("");
    let html = '<div class="card"><div class="card-head"><h3>Payslips</h3></div>' +
      '<div class="card-body"><div class="field" style="max-width:320px"><label>Employee</label><select id="psEmp">' + opts + "</select></div>" +
      '<div id="psBody" style="margin-top:12px"></div></div></div>';
    ctn.innerHTML = html;
    const body = ctn.querySelector("#psBody");
    ctn.querySelector("#psEmp").addEventListener("change", async e => {
      const id = e.target.value;
      if (!id) { body.innerHTML = ""; return; }
      const em = emps.find(x => x.id === id);
      const slips = await payslips(id);
      let out = "";
      if (!slips.length) {
        out = '<p class="muted small" style="text-align:center;padding:20px 14px">No posted payslips for ' + esc(em ? em.name : "") + " yet.</p>";
      } else {
        out = '<table class="tbl"><thead><tr><th>Run</th><th>Period</th><th>Pay date</th><th class="num">Hours</th><th class="num">Gross</th><th class="num">Fed</th><th class="num">State</th><th class="num">Other</th><th class="num">Net</th></tr></thead><tbody>';
        for (const s of slips) {
          const l = s.line;
          out += "<tr><td class=\"acct-code\">" + esc(s.run.no) + "</td><td>" + esc(s.run.periodStart) + " → " + esc(s.run.periodEnd) + "</td><td>" + esc(s.run.date) + "</td>" +
            '<td class="num">' + l.hours + "</td><td class=\"num\">" + FW.money(l.gross) + "</td><td class=\"num\">" + FW.money(l.fed) + "</td><td class=\"num\">" + FW.money(l.state) + "</td><td class=\"num\">" + FW.money(l.other) + '</td><td class="num"><strong>' + FW.money(l.net) + "</strong></td></tr>";
        }
        out += "</tbody></table>";
        out += '<p class="muted small" style="margin-top:10px">Payslips are read-only and generated from posted pay runs.</p>';
      }
      body.innerHTML = out;
    });
  }

  /* ── icons ───────────────────────────────────────────────────────────── */
  const XS_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const ICON = {
    pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 5v14"/><path d="M16 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M7 5v14l11-7z"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  };
  function confirmDialog(title, message, onYes, dangerLabel) {
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body"><p style="margin-top:0">' + esc(message) + "</p>" +
      '<div class="row-flex"><button class="btn btn-danger btn-sm" id="confirmYesBtn">' + esc(dangerLabel || "Confirm") + "</button>" +
      '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div></div>');
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#confirmYesBtn").addEventListener("click", () => { modal.closest(".modal-back").remove(); onYes(); });
    return modal;
  }

  /* ── self-test (validation for tasks 29–33) ──────────────────────────── */
  async function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || "" });

    /* task 29 — employee profiles */
    const e1 = { id: "e1", name: "Alice", payType: "hourly", rate: 20, withholding: { federal: 15, state: 5, other: 3 }, active: true };
    const e2 = { id: "e2", name: "Bob", payType: "salary", rate: 2000, withholding: { federal: 20, state: 5, other: 0 }, active: true };
    ok("Employees: hourly gross = hours × rate", computeLines("2026-09-01", "2026-09-07", [e1], [{ employeeId: "e1", status: "approved", periodStart: "2026-09-01", periodEnd: "2026-09-07", hours: 40 }])[0].gross === 800);
    ok("Employees: salary gross = flat period rate", computeLines("2026-09-01", "2026-09-07", [e2], [])[0].gross === 2000);
    ok("Employees: inactive employees excluded", computeLines("2026-09-01", "2026-09-07", [{ ...e1, active: false }], []).length === 0);

    /* task 30 — timesheet workflow */
    ok("Timesheets: unapproved hours excluded", computeLines("2026-09-01", "2026-09-07", [e1], [{ employeeId: "e1", status: "draft", periodStart: "2026-09-01", periodEnd: "2026-09-07", hours: 40 }]).length === 0);
    ok("Timesheets: out-of-period hours excluded", computeLines("2026-09-01", "2026-09-07", [e1], [{ employeeId: "e1", status: "approved", periodStart: "2026-08-01", periodEnd: "2026-08-07", hours: 40 }]).length === 0);
    ok("Timesheets: overlapping approved hours summed", computeLines("2026-09-01", "2026-09-07", [e1], [
      { employeeId: "e1", status: "approved", periodStart: "2026-09-01", periodEnd: "2026-09-07", hours: 20 },
      { employeeId: "e1", status: "approved", periodStart: "2026-09-01", periodEnd: "2026-09-07", hours: 22 },
    ])[0].hours === 42);

    /* task 31 — calculation engine */
    const line = computeLines("2026-09-01", "2026-09-07", [e1], [{ employeeId: "e1", status: "approved", periodStart: "2026-09-01", periodEnd: "2026-09-07", hours: 40 }])[0];
    ok("Engine: gross = 40 × 20", line.gross === 800);
    ok("Engine: federal 15% of gross", line.fed === 120);
    ok("Engine: state 5% of gross", line.state === 40);
    ok("Engine: other 3% of gross", line.other === 24);
    ok("Engine: net = gross − all withholdings", line.net === 616, "net=" + line.net);
    const t = runTotals([line, { gross: 2000, fed: 400, state: 100, other: 0, net: 1500 }]);
    ok("Engine: run totals sum lines", t.gross === 2800 && t.net === 2116, JSON.stringify(t));

    /* task 32 — payslip data */
    const slipsSrc = [
      { status: "posted", no: "PR-1", date: "2026-09-07", periodStart: "2026-09-01", periodEnd: "2026-09-07", lines: [{ employeeId: "e1", gross: 800, net: 616 }] },
      { status: "posted", no: "PR-2", date: "2026-09-14", periodStart: "2026-09-08", periodEnd: "2026-09-14", lines: [{ employeeId: "e1", gross: 900, net: 700 }] },
      { status: "draft", no: "PR-3", date: "2026-09-21", periodStart: "2026-09-15", periodEnd: "2026-09-21", lines: [{ employeeId: "e1", gross: 500, net: 400 }] },
    ];
    const savedRuns = await loadRuns();
    await saveRuns(slipsSrc);
    const slips = await payslips("e1");
    ok("Payslips: only posted runs appear", slips.length === 2, "got " + slips.length);
    await saveRuns(savedRuns);

    /* task 33 — ledger integration */
    const accs = [
      { id: "a1010", code: "1010", name: "Checking Account", type: "asset" },
      { id: "a2200", code: "2200", name: "Payroll Liabilities", type: "liability" },
      { id: "a2210", code: "2210", name: "Federal Withholding Payable", type: "liability" },
      { id: "a2220", code: "2220", name: "State Withholding Payable", type: "liability" },
      { id: "a5600", code: "5600", name: "Payroll Expense", type: "expense" },
    ];
    const run = { no: "PR-9", periodStart: "2026-09-01", periodEnd: "2026-09-07", date: "2026-09-07", lines: [line] };
    const built = buildEntryFromRun(run, accs, "a5600", "a1010");
    const eTot = Ledger.entryTotals({ lines: built.lines });
    ok("Post: entry is balanced", eTot.dr === eTot.cr && eTot.dr === 800, eTot.dr + "/" + eTot.cr);
    ok("Post: payroll expense debited for gross", built.lines.some(l => l.account === "a5600" && l.debit === 800));
    ok("Post: cash credited for net", built.lines.some(l => l.account === "a1010" && l.credit === 616));
    ok("Post: federal liability credited", built.lines.some(l => l.account === "a2210" && l.credit === 120));
    ok("Post: state liability credited", built.lines.some(l => l.account === "a2220" && l.credit === 40));
    const builtNoLiab = buildEntryFromRun({ ...run, lines: [line] }, [accs[0], accs[4]], "a5600", "a1010");
    const t2 = Ledger.entryTotals({ lines: builtNoLiab.lines });
    ok("Post: falls back to expensing withholdings when no liability account", t2.dr === t2.cr && t2.dr === 800 && builtNoLiab.lines.filter(l => l.account === "a5600" && l.credit > 0).length === 3, JSON.stringify(builtNoLiab.lines.map(l => l.account + ":" + l.debit + "/" + l.credit)));

    return results;
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  const X = {
    loadEmployees, saveEmployees, loadTimesheets, saveTimesheets, loadRuns, saveRuns,
    saveEmployee, setEmployeeActive, deleteEmployee,
    saveTimesheet, setTimesheetStatus, deleteTimesheet,
    computeLines, runTotals,
    saveRun, deleteRun, postRun, buildEntryFromRun, payslips,
    render, selfTest,
  };
  window.Modules = window.Modules || {};
  window.Modules.payroll = X;
  window.Payroll = X;
})();
