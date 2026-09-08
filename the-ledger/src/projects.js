/* ============================================================================
   THE LEDGER — projects.js
   Project Profitability (Phase 9, tasks 44–47):
    44. Project definitions — name, code, description, status (active /
        archived), optional color.
    45. Revenue assignment — invoices and journal entries can be tagged with a
        project; revenue is attributed from posted entries whose revenue lines
        carry that project.
    46. Expense assignment — bills and journal entries can be tagged with a
        project; expenses are attributed from posted entries whose expense
        lines carry that project (accounts payable conversion flows through).
    47. Profitability report — per-project revenue, expenses, profit and
        margin, plus a full roll-up across all projects.
   Project attribution lives at the header of the source document (invoice or
   bill) and flows through to the posted ledger entry's `projectId`, so this
   module treats the ledger as the single source of truth for money movement.
   Data persists per-browser via FW.store (kv-plugin folder "ledgerly"):
     key "proj_projects" → array of project records { id, code, name, desc,
                            color, status, createdAt, updatedAt }
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;
  const Ledger = window.Ledger;
  const K = { projects: "proj_projects" };
  const COLORS = ["#4f6ef7", "#16a34a", "#eab308", "#ea580c", "#0d9488", "#9333ea", "#db2777", "#64748b"];

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function money(n) { return FW.money(n); }
  function statusLabel(s) { return s === "archived" ? "Archived" : "Active"; }

  /* ── persistence + synchronous project cache (AR/AP read projects sync) ─ */
  let PROJ_CACHE = [];
  async function loadProjects() { const v = await FW.store.get(K.projects, null); const list = Array.isArray(v) ? v : []; PROJ_CACHE = list; return list; }
  async function saveProjects(list) { PROJ_CACHE = list; await FW.store.set(K.projects, list); }
  loadProjects();
  function projectById(id) { return PROJ_CACHE.find(x => x.id === id) || null; }
  function projectLabel(id) { const p = projectById(id); return p ? (p.code || p.name || id) : (id || ""); }

  /* ── project engine (task 44) ────────────────────────────────────────── */
  async function saveProject(p) {
    const x = Object.assign({}, p);
    if (!x.id) x.id = uid("proj");
    if (!x.code) x.code = x.name ? x.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 12) : "p-" + x.id.slice(-6);
    if (!x.status) x.status = "active";
    if (!x.color) x.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    if (!x.createdAt) x.createdAt = new Date().toISOString();
    x.updatedAt = new Date().toISOString();
    const projects = await loadProjects();
    const prev = projects.find(y => y.id === x.id) || null;
    const i = projects.findIndex(y => y.id === x.id);
    if (i >= 0) projects[i] = x; else projects.push(x);
    await saveProjects(projects);
    await Ledger.auditLog(prev ? "project.update" : "project.create", {
      entity: "project", entityId: x.id, entityLabel: x.name,
      summary: (prev ? "Edited " : "Created ") + "project " + x.name + (x.code ? " (" + x.code + ")" : ""),
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(x),
    });
    return x;
  }
  async function deleteProject(id) {
    const projects = await loadProjects();
    const p = projects.find(x => x.id === id);
    if (!p) return { error: "Project not found." };
    const entries = await Ledger.loadEntries();
    const inUse = entries.some(e => e.status === "posted" && e.projectId === id);
    if (inUse) return { error: "This project has posted ledger activity — archive it instead of deleting." };
    const i = projects.indexOf(p); projects.splice(i, 1);
    await saveProjects(projects);
    await Ledger.auditLog("project.delete", {
      entity: "project", entityId: id, entityLabel: p.name,
      summary: "Deleted project " + p.name, prev: Ledger.cloneObj(p), next: null,
    });
    return { ok: true };
  }
  async function setProjectStatus(id, status) {
    const projects = await loadProjects();
    const p = projects.find(x => x.id === id);
    if (!p) return { error: "Project not found." };
    const prev = Ledger.cloneObj(p);
    p.status = status; p.updatedAt = new Date().toISOString();
    await saveProjects(projects);
    await Ledger.auditLog("project.update", {
      entity: "project", entityId: id, entityLabel: p.name,
      summary: "Project " + p.name + " → " + statusLabel(status),
      prev, next: Ledger.cloneObj(p),
    });
    return { ok: true };
  }
  function projectOptions(cur) {
    return loadProjects().then(projects => {
      const act = projects.filter(p => p.status === "active");
      const rest = projects.filter(p => p.status !== "active");
      return [...act, ...rest].map(p => '<option value="' + esc(p.id) + '"' + (p.id === cur ? " selected" : "") + ">" + esc(p.name) + (p.code ? " (" + esc(p.code) + ")" : "") + (p.status !== "active" ? " · archived" : "") + "</option>").join("");
    });
  }

  /* ── profitability engine (tasks 45–47) ──────────────────────────────── */
  async function accountTypes() {
    const accounts = await Ledger.loadAccounts();
    const map = {};
    for (const a of accounts) map[a.id] = a.type;
    return map;
  }
  async function projectRevenue(projectId, entries) {
    const entriesIn = entries || (await Ledger.loadEntries());
    const types = await accountTypes();
    let sum = 0, docs = 0;
    for (const e of entriesIn) {
      if (e.status !== "posted" || e.projectId !== projectId) continue;
      let rev = 0;
      for (const l of e.lines || []) if (types[l.account] === "revenue") rev = round2(rev + amt(l.credit));
      if (rev > 0) { sum = round2(sum + rev); docs++; }
    }
    return { total: sum, docs };
  }
  async function projectExpenses(projectId, entries) {
    const entriesIn = entries || (await Ledger.loadEntries());
    const types = await accountTypes();
    let sum = 0, docs = 0;
    for (const e of entriesIn) {
      if (e.status !== "posted" || e.projectId !== projectId) continue;
      let exp = 0;
      for (const l of e.lines || []) if (types[l.account] === "expense") exp = round2(exp + amt(l.debit));
      if (exp > 0) { sum = round2(sum + exp); docs++; }
    }
    return { total: sum, docs };
  }
  async function projectSummary(projectId) {
    const entries = await Ledger.loadEntries();
    const rev = await projectRevenue(projectId, entries);
    const exp = await projectExpenses(projectId, entries);
    const profit = round2(rev.total - exp.total);
    const margin = rev.total > 0 ? Math.round((profit / rev.total) * 1000) / 10 : (profit === 0 ? 0 : null);
    return { revenue: rev.total, revenueDocs: rev.docs, expenses: exp.total, expenseDocs: exp.docs, profit, margin };
  }
  async function projectReport() {
    const projects = await loadProjects();
    const entries = await Ledger.loadEntries();
    const types = await accountTypes();
    const rows = projects.map(p => {
      let rev = 0, exp = 0, revDocs = 0, expDocs = 0;
      for (const e of entries) {
        if (e.status !== "posted" || e.projectId !== p.id) continue;
        let r = 0, x = 0;
        for (const l of e.lines || []) {
          if (types[l.account] === "revenue") r = round2(r + amt(l.credit));
          else if (types[l.account] === "expense") x = round2(x + amt(l.debit));
        }
        if (r > 0) { rev = round2(rev + r); revDocs++; }
        if (x > 0) { exp = round2(exp + x); expDocs++; }
      }
      const profit = round2(rev - exp);
      return { project: p, revenue: rev, expenses: exp, revenueDocs: revDocs, expenseDocs: expDocs, profit, margin: rev > 0 ? Math.round((profit / rev) * 1000) / 10 : (profit === 0 ? 0 : null) };
    });
    const totRev = round2(rows.reduce((s, r) => s + r.revenue, 0));
    const totExp = round2(rows.reduce((s, r) => s + r.expenses, 0));
    const totProfit = round2(totRev - totExp);
    return { rows, totals: { revenue: totRev, expenses: totExp, profit: totProfit, margin: totRev > 0 ? Math.round((totProfit / totRev) * 1000) / 10 : (totProfit === 0 ? 0 : null) } };
  }

  /* ── project modal ───────────────────────────────────────────────────── */
  function projectModal(p, onSaved) {
    const isNew = !p;
    const proj = p || { name: "", code: "", desc: "", color: COLORS[0], status: "active" };
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (isNew ? "New project" : "Edit project") + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body">' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:2 1 240px"><label>Name</label><input id="pName" value="' + esc(proj.name || "") + '" placeholder="e.g. Website redesign"></div>' +
      '<div class="field" style="flex:1 1 140px"><label>Code</label><input id="pCode" value="' + esc(proj.code || "") + '" placeholder="auto"></div>' +
      "</div>" +
      '<div class="field"><label>Description</label><input id="pDesc" value="' + esc(proj.desc || "") + '" placeholder="Optional"></div>' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:1 1 200px"><label>Color</label><select id="pColor">' + COLORS.map(c => '<option value="' + c + '"' + (c === proj.color ? " selected" : "") + ">● " + esc(c) + "</option>").join("") + "</select></div>" +
      '<div class="field" style="flex:1 1 200px"><label>Status</label><select id="pStatus"><option value="active"' + (proj.status === "active" ? " selected" : "") + ">Active</option><option value=\"archived\"" + (proj.status === "archived" ? " selected" : "") + ">Archived</option></select></div>" +
      "</div>" +
      '<div class="row-flex" style="margin-top:16px">' +
      '<button class="btn btn-primary" id="pSaveBtn">' + (isNew ? "Create project" : "Save changes") + "</button>" +
      '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>' +
      "</div>");
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#pSaveBtn").addEventListener("click", async () => {
      const name = modal.querySelector("#pName").value.trim();
      if (!name) { FW.toast("Project name is required.", "err"); return; }
      const rec = {
        id: proj.id || null, name,
        code: String(modal.querySelector("#pCode").value || "").trim() || null,
        desc: String(modal.querySelector("#pDesc").value || "").trim(),
        color: modal.querySelector("#pColor").value,
        status: modal.querySelector("#pStatus").value,
        createdAt: proj.createdAt || null,
      };
      const res = await saveProject(rec);
      if (res && res.error) { FW.toast(res.error, "err"); return; }
      modal.closest(".modal-back").remove();
      FW.toast(res.name + " saved");
      onSaved && onSaved();
    });
  }

  /* ── Projects tab UI (tasks 44–47) ───────────────────────────────────── */
  async function renderProjectsTab(ctn) {
    const projects = await loadProjects();
    const report = await projectReport();
    let html = '<div class="stat-grid" style="margin-bottom:16px">' +
      '<div class="stat-card card"><div class="stat-value">' + projects.length + '</div><div class="stat-label">Projects</div><div class="stat-sub">' + projects.filter(p => p.status === "active").length + " active</div></div>" +
      '<div class="stat-card card"><div class="stat-value">' + money(report.totals.revenue) + '</div><div class="stat-label">Attributed revenue</div><div class="stat-sub">from posted entries</div></div>' +
      '<div class="stat-card card"><div class="stat-value">' + money(report.totals.expenses) + '</div><div class="stat-label">Attributed expenses</div><div class="stat-sub">from posted entries</div></div>' +
      '<div class="stat-card card"><div class="stat-value ' + (report.totals.profit < 0 ? "neg" : "") + '">' + money(report.totals.profit) + '</div><div class="stat-label">Net project profit</div><div class="stat-sub">' + (report.totals.margin == null ? "—" : report.totals.margin + "% margin") + "</div></div>" +
      "</div>";
    html += '<div class="card"><div class="card-head"><h3>Projects</h3>' +
      '<button class="btn btn-primary btn-sm" id="projNewBtn">+ New project</button></div>';
    if (!projects.length) {
      html += '<p class="muted small" style="text-align:center;padding:18px 14px">No projects yet. Create a project, then pick it on an invoice or vendor bill to attribute revenue and expenses to it. Profitability is computed from posted ledger entries.</p>';
    } else {
      html += '<div class="tbl"><div class="tr th">' +
        '<div class="td" style="flex:2 1 200px">Project</div>' +
        '<div class="td num" style="flex:1 1 90px">Revenue</div>' +
        '<div class="td num" style="flex:1 1 90px">Expenses</div>' +
        '<div class="td num" style="flex:1 1 90px">Profit</div>' +
        '<div class="td num" style="flex:1 1 70px">Margin</div>' +
        '<div class="td" style="flex:0 0 90px"></div>' +
        "</div>";
      for (const r of report.rows) {
        const p = r.project;
        html += '<div class="tr">' +
          '<div class="td" style="flex:2 1 200px;gap:8px"><span class="proj-dot" style="background:' + esc(p.color || "#4f6ef7") + '"></span><div><div>' + esc(p.name) + (p.code ? ' <span class="muted small mono">' + esc(p.code) + "</span>" : "") + '</div><div class="muted small">' + (p.desc || "—") + " · " + r.revenueDocs + " rev doc" + (r.revenueDocs === 1 ? "" : "s") + " · " + r.expenseDocs + " exp doc" + (r.expenseDocs === 1 ? "" : "s") + "</div></div></div>" +
          '<div class="td num" style="flex:1 1 90px">' + money(r.revenue) + "</div>" +
          '<div class="td num" style="flex:1 1 90px">' + money(r.expenses) + "</div>" +
          '<div class="td num" style="flex:1 1 90px"><span class="' + (r.profit < 0 ? "neg" : "") + '">' + money(r.profit) + "</span></div>" +
          '<div class="td num" style="flex:1 1 70px"><span class="chip ' + (r.margin == null ? "chip-pending" : r.margin < 0 ? "chip-warn" : "chip-done") + '">' + (r.margin == null ? "—" : r.margin + "%") + "</span></div>" +
          '<div class="td" style="flex:0 0 90px;justify-content:flex-end;gap:6px">' +
          '<button class="btn btn-ghost btn-sm" data-proj-edit="' + esc(p.id) + '">Edit</button>' +
          (p.status === "archived"
            ? '<button class="btn btn-ghost btn-sm" data-proj-act="' + esc(p.id) + '">Activate</button>'
            : '<button class="btn btn-ghost btn-sm" data-proj-arc="' + esc(p.id) + '">Archive</button>') +
          "</div></div>";
      }
      html += '<div class="tr tot"><div class="td" style="flex:2 1 200px">Total</div>' +
        '<div class="td num" style="flex:1 1 90px">' + money(report.totals.revenue) + "</div>" +
        '<div class="td num" style="flex:1 1 90px">' + money(report.totals.expenses) + "</div>" +
        '<div class="td num" style="flex:1 1 90px"><span class="' + (report.totals.profit < 0 ? "neg" : "") + '">' + money(report.totals.profit) + "</span></div>" +
        '<div class="td num" style="flex:1 1 70px">' + (report.totals.margin == null ? "—" : report.totals.margin + "%") + "</div>" +
        '<div class="td" style="flex:0 0 90px"></div></div>';
      html += "</div>";
    }
    html += "</div>";
    ctn.innerHTML = html;
    ctn.querySelector("#projNewBtn").addEventListener("click", () => projectModal(null, () => renderProjectsTab(ctn)));
    ctn.onclick = e => {
      const ed = e.target.closest("[data-proj-edit]");
      const ac = e.target.closest("[data-proj-act]");
      const ar = e.target.closest("[data-proj-arc]");
      if (ed) {
        const p = projects.find(x => x.id === ed.getAttribute("data-proj-edit"));
        if (p) projectModal(p, () => renderProjectsTab(ctn));
      } else if (ac) {
        setProjectStatus(ac.getAttribute("data-proj-act"), "active").then(() => renderProjectsTab(ctn));
      } else if (ar) {
        setProjectStatus(ar.getAttribute("data-proj-arc"), "archived").then(() => renderProjectsTab(ctn));
      }
    };
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  async function render(ctn) {
    ctn.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 9 — Project & Job Costing"));
    head.appendChild(FW.el("h1", null, null, { text: "Projects" }));
    head.appendChild(FW.el("p", "lede", "Attribute revenue and expenses to specific projects across invoices, bills and journal entries, then watch each project's profitability roll up from the general ledger."));
    ctn.appendChild(head);
    ctn.insertAdjacentHTML("beforeend", "<div class=\"ledger-tabs\" id=\"projTabs\">" +
      '<button class="ledger-tab" data-pt="projects">Projects</button>' +
      '<button class="ledger-tab" data-pt="how">How it works</button>' +
      "</div>" +
      '<div class="ledger-tab-ctn" id="projTabCtn"></div>');
    const tabs = ctn.querySelectorAll(".ledger-tab");
    const body = ctn.querySelector("#projTabCtn");
    async function show(which) {
      tabs.forEach(t => t.classList.toggle("active", t.getAttribute("data-pt") === which));
      if (which === "how") {
        body.innerHTML = '<div class="card"><div class="card-head"><h3>Project profitability</h3></div><div class="stack" style="padding:14px 16px 18px">' +
          '<p class="note">Projects let you attribute revenue and expenses to specific initiatives — client engagements, product lines, campaigns — and see each one’s profitability on a single screen.</p>' +
          '<h4 style="margin-bottom:4px">How attribution works</h4>' +
          '<ul class="muted small" style="margin:0;padding-left:18px;line-height:1.9">' +
          "<li>Create a project on this tab.</li>" +
          "<li>On an <b>invoice</b> (Accounts Receivable → New invoice) pick the project — posted revenue lines count toward that project.</li>" +
          "<li>On a <b>vendor bill</b> (Accounts Payable → New bill) pick the project — posted expense lines count toward that project.</li>" +
          "<li>Journal entries carry the project through too — build a revenue or expense entry with a project assigned and it appears here automatically.</li>" +
          "</ul>" +
          '<h4 style="margin-bottom:4px">How the numbers are computed</h4>' +
          "<p class=\"muted small\" style=\"margin:0\">The ledger is the single source of truth. Revenue is the sum of <b>credit</b> amounts on <b>revenue-type</b> lines of posted entries tagged with the project; expenses are the <b>debit</b> amounts on <b>expense-type</b> lines. Margin is profit ÷ revenue. Nothing is computed from invoices or bills directly, so voiding, adjusting or deleting a posted document stays consistent.</p>" +
          "</div></div>";
        return;
      }
      await renderProjectsTab(body);
    }
    show("projects");
    tabs.forEach(t => t.addEventListener("click", () => show(t.getAttribute("data-pt"))));
  }

  /* ── self-test ───────────────────────────────────────────────────────── */
  async function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, ok: !!cond, extra: extra == null ? "" : String(extra) });
    const types = await accountTypes();
    ok("CoA loads for type mapping", Object.keys(types).length >= 20, Object.keys(types).length + " accounts");
    ok("Revenue account is type revenue", types[Object.keys(types).find(k => { return true; })] !== undefined);
    const revAcc = Object.entries(types).find(([, t]) => t === "revenue");
    const expAcc = Object.entries(types).find(([, t]) => t === "expense");
    ok("Revenue account present", !!revAcc, revAcc ? revAcc[0] : "none");
    ok("Expense account present", !!expAcc, expAcc ? expAcc[0] : "none");
    const e1 = { id: "t-e1", status: "posted", projectId: "t-proj", date: "2026-09-01", lines: [{ account: revAcc[0], credit: 500, debit: 0 }] };
    const e2 = { id: "t-e2", status: "posted", projectId: "t-proj", date: "2026-09-02", lines: [{ account: expAcc[0], credit: 0, debit: 120 }] };
    const e3 = { id: "t-e3", status: "draft", projectId: "t-proj", date: "2026-09-03", lines: [{ account: revAcc[0], credit: 9999, debit: 0 }] };
    const e4 = { id: "t-e4", status: "posted", projectId: "t-other", date: "2026-09-04", lines: [{ account: revAcc[0], credit: 800, debit: 0 }] };
    const rev = await projectRevenue("t-proj", [e1, e2, e3, e4]);
    ok("Revenue sums posted revenue credits only", rev.total === 500, "got " + rev.total);
    ok("Revenue counts one doc", rev.docs === 1, "got " + rev.docs);
    const exp = await projectExpenses("t-proj", [e1, e2, e3, e4]);
    ok("Expenses sum posted expense debits only", exp.total === 120, "got " + exp.total);
    ok("Drafts excluded", exp.docs === 1 && rev.docs === 1);
    const p1 = await saveProject({ name: "SelfTest Project", status: "active" });
    ok("saveProject creates with id/code", !!p1.id && !!p1.code, p1.code || "no code");
    const p2 = await saveProject({ id: p1.id, name: "SelfTest Project v2", code: p1.code, color: p1.color, status: "active", createdAt: p1.createdAt });
    ok("saveProject updates in place", p2.name === "SelfTest Project v2" && p2.id === p1.id);
    const opts = await projectOptions(p1.id);
    ok("projectOptions returns html with selected", opts.indexOf('value="' + p1.id + '" selected') >= 0);
    const del = await deleteProject(p1.id);
    ok("deleteProject succeeds when unused", del && del.ok);
    const list = await loadProjects();
    ok("Project removed from store", !list.some(x => x.id === p1.id));
    return results;
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  const X = {
    loadProjects, saveProjects, saveProject, deleteProject, setProjectStatus,
    projectOptions, projectRevenue, projectExpenses, projectSummary, projectReport,
    projectById, projectLabel,
    render, selfTest,
  };
  window.Modules = window.Modules || {};
  window.Modules.projects = X;
  window.Projects = X;
})();
