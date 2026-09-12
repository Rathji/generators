/* ============================================================
   PSA-U — projects: templates, phases & tasks, scheduling,
   budgets vs actuals and project billing (Phase 7 · Tasks 34–37)

   A project is the delivery container that sits alongside tickets
   and agreements. This engine owns:

     • projects   — a client project with a phase → task work
                    breakdown, dates, owners, estimates and a
                    billing method (time & materials, fixed fee or
                    milestone) (Task 34).
     • templates  — a reusable work breakdown (phases, tasks and
                    their estimate) that can spawn a project in one
                    step; a template task may carry a ticket-template
                    reference, so instantiating it also raises the
                    tickets that piece of work needs (Task 35).
     • schedule   — every open task across the practice in one
                    list, ordered by due date, with owners, overdue
                    and unassigned task counts and a workload view
                    per member (Task 36).
     • budget     — estimated hours / cost / revenue against the
                    labour and expense cost actually booked, a
                    projected cost at the current completion rate,
                    and the over-budget / hours-over / trending-over
                    flags that let a manager intervene (Task 36).
     • billing    — milestones. Each milestone can be tied to a
                    phase (released automatically when that phase
                    completes) or a fixed project fee (released when
                    the project completes). Phase 6's invoice
                    assembly picks released milestones up as a
                    "project" source line and the posted invoice
                    stamps the milestone as invoiced, so a re-run
                    never bills it twice (Task 37).

   Storage: a project lives in the CLIENT COMPANY's document
   (kind "project") so it syncs, versions and backs up with the
   rest of that client's work; milestones are embedded in the
   project but their ids are prefixed with the project id, so a
   milestone id is unique across the whole company and billing can
   address one directly. Templates live in the PROVIDER document
   (kind "projectTemplate").

   Timesheet and expense records pick the project/task up through
   the `projectId` + `taskId` fields the Time & Expense station
   gained in this phase; budget/actuals reads them straight back.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const P = (ERP.projects = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("projects requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const maskedMoney = (v, cur) => (ERP.security.canSeeFinancials() ? ui.money(v, cur) : "•••");
  const companyRecords = (cid, kind) => ten().records("company", cid, kind);
  const membersList = () => (ERP.members ? ERP.members.members() : Promise.resolve([]));
  const invoiceRecords = (cid) => companyRecords(cid, "invoice");
  function memberName(members, id) { const m = (members || []).find((x) => String(x.id) === String(id)); return m ? m.name : (id != null && id !== "" ? "#" + id : "—"); }

  /* ─────────────────────────── constants ─────────────────────────── */

  P.PROJECT_STATUSES = [
    { id: "draft", label: "Draft", tone: "muted" },
    { id: "active", label: "Active", tone: "success" },
    { id: "on_hold", label: "On hold", tone: "warn" },
    { id: "completed", label: "Completed", tone: "info" },
    { id: "cancelled", label: "Cancelled", tone: "danger" },
  ];
  P.statusLabel = (id) => (P.PROJECT_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  P.statusTone = (id) => (P.PROJECT_STATUSES.find((s) => s.id === id) || {}).tone || "muted";
  P.OPEN_STATUSES = ["draft", "active", "on_hold"];

  P.WORK_STATUSES = [
    { id: "pending", label: "To do", tone: "muted" },
    { id: "in_progress", label: "In progress", tone: "info" },
    { id: "blocked", label: "Blocked", tone: "danger" },
    { id: "complete", label: "Done", tone: "success" },
  ];
  P.workStatusLabel = (id) => (P.WORK_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  P.workStatusTone = (id) => (P.WORK_STATUSES.find((s) => s.id === id) || {}).tone || "muted";
  P.phaseStatusLabel = P.workStatusLabel;
  P.phaseStatusTone = P.workStatusTone;
  P.taskStatusLabel = P.workStatusLabel;
  P.taskStatusTone = P.workStatusTone;

  P.BILLING_METHODS = [
    { id: "tm", label: "Time & materials" },
    { id: "fixed", label: "Fixed fee" },
    { id: "milestone", label: "Milestone" },
  ];
  P.billingLabel = (id) => (P.BILLING_METHODS.find((m) => m.id === id) || {}).label || id || "—";

  P.MILESTONE_STATUSES = [
    { id: "pending", label: "Pending", tone: "muted" },
    { id: "ready", label: "Ready to bill", tone: "info" },
    { id: "invoiced", label: "Invoiced", tone: "success" },
    { id: "void", label: "Void", tone: "danger" },
  ];
  P.milestoneStatusLabel = (id) => (P.MILESTONE_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  P.milestoneStatusTone = (id) => (P.MILESTONE_STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  /* ─────────────────────────── record model ─────────────────────────── */

  P.newProject = (over) => Object.assign({
    kind: "project", id: null, providerId: null, companyId: null, number: "", name: "",
    description: "", type: "", status: "draft", templateId: null,
    ownerId: null, managerId: null, startDate: "", dueDate: "", completedAt: null,
    forceCompleted: false, onHoldReason: "", cancelledReason: "",
    billingMethod: "tm", fixedFee: 0, estimatedHours: 0, hourlyRate: 0, hourlyCost: 0,
    phases: [], milestones: [], notes: "", progress: 0,
    createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  P.newPhase = (over) => Object.assign({
    id: null, name: "", description: "", status: "pending", ownerId: null,
    startDate: "", dueDate: "", estimatedHours: 0, budget: 0, billable: true, tasks: [], progress: 0,
  }, over || {});

  P.newTask = (over) => Object.assign({
    id: null, name: "", description: "", status: "pending", ownerId: null,
    startDate: "", dueDate: "", estimatedHours: 0, dependsOn: [], order: 0,
    ticketId: null, ticketTemplateId: null, checklist: [], completedAt: null,
  }, over || {});

  P.newMilestone = (over) => Object.assign({
    id: null, name: "", amount: 0, dueDate: "", phaseId: null, status: "pending",
    invoiceId: null, invoicedAt: null, readyAt: null, auto: false, releasedBy: null, note: "",
  }, over || {});

  P.newTemplate = (over) => Object.assign({
    kind: "projectTemplate", id: null, providerId: null, name: "", description: "",
    type: "", billingMethod: "tm", fixedFee: 0, estimatedHours: 0, hourlyRate: 0,
    phases: [], active: true, createdAt: null, updatedAt: null,
  }, over || {});

  P.newTemplatePhase = (over) => Object.assign({ id: null, name: "", description: "", estimatedHours: 0, billable: true, tasks: [] }, over || {});
  P.newTemplateTask = (over) => Object.assign({ id: null, name: "", description: "", estimatedHours: 0, ownerId: null, ticketTemplateId: null, checklist: [] }, over || {});

  /* Unique-within-container child ids. A milestone id is prefixed with its
     project id, so it is unique across the client's whole document. */
  function nextSeq(container) {
    let max = 0;
    const bump = (id) => { const m = /(\d+)\s*$/.exec(String(id || "")); if (m) max = Math.max(max, Number(m[1])); };
    (container.phases || []).forEach((ph) => { bump(ph.id); (ph.tasks || []).forEach((t) => bump(t.id)); });
    (container.milestones || []).forEach((m) => bump(m.id));
    return max + 1;
  }

  function normalise(p) {
    p.phases = (Array.isArray(p.phases) ? p.phases : []).map((ph) => Object.assign(P.newPhase(), ph, {
      tasks: (Array.isArray(ph.tasks) ? ph.tasks : []).map((t) => Object.assign(P.newTask(), t)),
    }));
    p.milestones = (Array.isArray(p.milestones) ? p.milestones : []).map((m) => Object.assign(P.newMilestone(), m));
    p.estimatedHours = num(p.estimatedHours);
    p.fixedFee = num(p.fixedFee);
    p.hourlyRate = num(p.hourlyRate);
    p.hourlyCost = num(p.hourlyCost);
    p.billingMethod = p.billingMethod || "tm";
    p.status = p.status || "draft";
    p.progress = num(p.progress);
    let seq = nextSeq(p);
    const assign = (rec, tag) => { if (rec.id == null || rec.id === "") { rec.id = String(p.id) + "-" + tag + seq; seq += 1; } };
    p.phases.forEach((ph) => { assign(ph, "p"); ph.tasks.forEach((t) => assign(t, "t")); });
    p.milestones.forEach((m) => assign(m, "m"));
    return p;
  }

  /* ─────────────────────────── rollups ─────────────────────────── */

  function phaseProgress(phase) {
    const tasks = phase.tasks || [];
    if (!tasks.length) return phase.status === "complete" ? 100 : 0;
    return Math.round(tasks.filter((t) => t.status === "complete").length / tasks.length * 100);
  }

  function derivePhaseStatus(phase) {
    if (phase.status === "blocked") return "blocked";
    const tasks = phase.tasks || [];
    if (!tasks.length) return phase.status === "complete" ? "complete" : (phase.status || "pending");
    if (tasks.every((t) => t.status === "complete")) return "complete";
    if (tasks.some((t) => t.status === "in_progress" || t.status === "complete" || t.status === "blocked")) return "in_progress";
    return "pending";
  }

  /* Pure: derive phase + project status/progress from the task states and
     auto-release the milestones whose phase (or the whole fixed-fee project)
     has just completed. Returns a new project object. */
  P.rollup = function (project) {
    const p = Object.assign({}, project);
    p.phases = (project.phases || []).map((ph) => Object.assign({}, ph, { tasks: (ph.tasks || []).slice() }));
    p.phases.forEach((ph) => { ph.status = derivePhaseStatus(ph); ph.progress = phaseProgress(ph); });
    const allTasks = [].concat.apply([], p.phases.map((ph) => ph.tasks));
    if (allTasks.length) p.progress = Math.round(allTasks.filter((t) => t.status === "complete").length / allTasks.length * 100);
    else p.progress = p.phases.length ? Math.round(p.phases.filter((ph) => ph.status === "complete").length / p.phases.length * 100) : (p.status === "completed" ? 100 : 0);

    const explicit = p.status === "cancelled" || p.status === "on_hold";
    if (p.forceCompleted) {
      p.status = "completed";
      p.completedAt = p.completedAt || nowIso();
    } else if (!explicit) {
      const allDone = p.phases.length > 0 && p.phases.every((ph) => ph.status === "complete");
      if (allDone) { p.status = "completed"; p.completedAt = p.completedAt || nowIso(); }
      else if (p.status === "completed") { p.status = "active"; p.completedAt = null; }
      else if (p.status === "draft" && p.progress > 0) p.status = "active";
    }

    const phaseById = {};
    p.phases.forEach((ph) => { phaseById[String(ph.id)] = ph; });
    p.milestones.forEach((m) => {
      if (m.status !== "pending") return;
      const ph = m.phaseId != null ? phaseById[String(m.phaseId)] : null;
      if (ph && ph.status === "complete") { m.status = "ready"; m.readyAt = m.readyAt || nowIso(); }
      else if (m.auto && p.status === "completed") { m.status = "ready"; m.readyAt = m.readyAt || nowIso(); }
    });
    return p;
  };
  const rollup = P.rollup;

  function ensureFixedMilestone(p) {
    if (p.billingMethod !== "fixed") return;
    if (num(p.fixedFee) <= 0) return;
    if ((p.milestones || []).length) return;
    p.milestones = [Object.assign(P.newMilestone(), {
      name: (p.name || "Project") + " — project fee",
      amount: num(p.fixedFee), dueDate: p.dueDate || p.startDate, auto: true, note: "Generated from the project fixed fee.",
    })];
  }

  /* ─────────────────────────── reads ─────────────────────────── */

  P.all = async function (companyId) { try { return await companyRecords(companyId, "project"); } catch (e) { return []; } };

  P.list = async function (pid, query) {
    query = query || {};
    const out = [];
    const companies = await ERP.companies.list();
    for (const e of companies) {
      if (query.companyId != null && query.companyId !== "" && String(e.id) !== String(query.companyId)) continue;
      let recs = [];
      try { recs = await companyRecords(e.id, "project"); } catch (err) { recs = []; }
      for (const p of recs) {
        if (query.status && String(p.status) !== String(query.status)) continue;
        if (query.statusIn && query.statusIn.map(String).indexOf(String(p.status)) === -1) continue;
        if (query.method && String(p.billingMethod) !== String(query.method)) continue;
        out.push(Object.assign({}, p, { __companyName: e.name }));
      }
    }
    out.sort((a, b) => String(a.__companyName || "").localeCompare(String(b.__companyName || "")) || (Number(b.id) - Number(a.id)));
    return out;
  };

  P.get = async function (companyId, id) {
    if (companyId == null || id == null) return null;
    return (await P.all(companyId)).find((p) => String(p.id) === String(id)) || null;
  };

  P.forCompany = (companyId) => P.all(companyId);

  P.locate = async function (pid, projectId) {
    if (projectId == null) return null;
    const companies = await ERP.companies.list();
    for (const e of companies) {
      const found = (await companyRecords(e.id, "project")).find((p) => String(p.id) === String(projectId));
      if (found) return { project: found, companyId: e.id, company: await ERP.companies.get(e.id) };
    }
    return null;
  };

  P.tasksOf = function (project) {
    const out = [];
    (project.phases || []).forEach((ph) => (ph.tasks || []).forEach((t) => out.push({ phase: ph, task: t })));
    return out;
  };

  P.findTask = function (project, taskId) {
    for (const ph of project.phases || []) {
      const t = (ph.tasks || []).find((x) => String(x.id) === String(taskId));
      if (t) return { phase: ph, task: t };
    }
    return null;
  };

  P.findMilestone = function (project, milestoneId) {
    return (project.milestones || []).find((m) => String(m.id) === String(milestoneId)) || null;
  };

  P.nextNumber = async function (pid) {
    let max = 0;
    const companies = await ERP.companies.list();
    for (const e of companies) {
      for (const p of await companyRecords(e.id, "project")) {
        const m = /(\d+)\s*$/.exec(String(p.number || ""));
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return "PRJ-" + String(max + 1).padStart(4, "0");
  };
  async function nextNumber(pid) { return P.nextNumber(pid); }

  async function load(companyId, id) { return P.get(companyId, id); }

  /* ─────────────────────────── emit ─────────────────────────── */

  async function emit(pid, event, project, extra) {
    if (!ERP.workflow) return;
    try {
      const company = project && project.companyId != null ? await ERP.companies.get(project.companyId) : null;
      await ERP.workflow.emit(event, Object.assign({ event: event, project: project, company: company, actor: actor() }, extra || {}));
    } catch (e) {}
  }

  /* ─────────────────────────── writes ─────────────────────────── */

  /* Create tickets for any template task carrying a ticket-template reference.
     Only run at instantiation, so tickets are never raised twice. */
  async function createTaskTickets(pid, project) {
    if (!ERP.tickets || !ERP.templates || typeof ERP.templates.apply !== "function") return;
    for (const ph of project.phases || []) {
      for (const t of ph.tasks || []) {
        if (!t.ticketTemplateId || t.ticketId) continue;
        try {
          const seed = await ERP.templates.apply(pid, t.ticketTemplateId, { summary: t.name, ownerId: t.ownerId || project.ownerId });
          const res = await ERP.tickets.save(project.companyId, seed);
          if (res && res.record) t.ticketId = res.record.id;
        } catch (e) {}
      }
    }
  }

  async function persist(pid, project, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("projects.edit", { companyId: project.companyId })) return { error: "forbidden" };
    const companyId = project.companyId;
    if (companyId == null || companyId === "") return { error: "company_required", message: "Choose the client this project is for." };
    const existing = project.id != null && project.id !== "" ? await load(companyId, project.id) : null;
    if (!existing && (project.id == null || project.id === "")) project.id = ten().nextId(await ten().records("company", companyId));
    const p = normalise(Object.assign(P.newProject(), existing || {}, project));
    if (!String(p.name || "").trim()) return { error: "name_required", message: "Give the project a name." };
    p.name = String(p.name).trim();

    const prevStatus = existing ? existing.status : null;
    const prevReady = ((existing && existing.milestones) || []).filter((m) => m.status === "ready").map((m) => String(m.id));
    if (!existing) {
      p.number = p.number || await nextNumber(pid);
      p.status = "draft";
      p.createdAt = nowIso();
      p.createdBy = p.createdBy != null ? p.createdBy : actor().memberId || null;
    }
    if (opts.instantiate) { try { await createTaskTickets(pid, p); } catch (e) {} }
    ensureFixedMilestone(p);
    normalise(p);
    const rolled = rollup(p);
    rolled.providerId = pid;
    rolled.updatedAt = nowIso();
    await ten().upsert("company", companyId, rolled);

    if (!existing) {
      await emit(pid, "project.created", rolled);
    } else {
      if (prevStatus !== rolled.status) {
        await emit(pid, "project.status_changed", rolled, { from: prevStatus, to: rolled.status });
        if (rolled.status === "completed") await emit(pid, "project.completed", rolled);
        if (rolled.status === "active" && prevStatus === "draft") await emit(pid, "project.activated", rolled);
        if (rolled.status === "on_hold") await emit(pid, "project.on_hold", rolled);
      }
      const readyAfter = (rolled.milestones || []).filter((m) => m.status === "ready").map((m) => String(m.id));
      for (const id of readyAfter.filter((x) => prevReady.indexOf(x) === -1)) {
        await emit(pid, "project.milestone_ready", rolled, { milestone: P.findMilestone(rolled, id) });
      }
    }
    return { record: rolled, created: !existing };
  }

  P.save = async function (pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("projects.edit", { companyId: rec && rec.companyId })) return { error: "forbidden" };
    const companyId = rec && rec.companyId;
    if (companyId == null || companyId === "") return { error: "company_required", message: "Choose the client this project is for." };
    const existing = rec && rec.id != null && rec.id !== "" ? await P.get(companyId, rec.id) : null;
    let p = Object.assign(P.newProject(), existing || {}, rec);
    let instantiate = false;
    if (!existing && p.templateId && !(p.phases || []).length) {
      const tpl = await P.getTemplate(pid, p.templateId);
      if (tpl) { p = applyTemplate(p, tpl); instantiate = true; }
    }
    return persist(pid, p, { instantiate: instantiate });
  };

  P.remove = async function (pid, companyId, id) {
    if (!ERP.security.enforce("projects.edit")) return { error: "forbidden" };
    const p = await P.get(companyId, id);
    if (!p) return { error: "not_found" };
    if ((p.milestones || []).some((m) => m.status === "invoiced")) {
      return { error: "invoiced", message: "This project has billed milestones; cancel it instead of deleting it." };
    }
    await ten().remove("company", companyId, (r) => r.kind === "project" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  P.setStatus = async function (pid, projectId, status, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("projects.edit")) return { error: "forbidden" };
    if (["draft", "active", "on_hold", "completed", "cancelled"].indexOf(status) === -1) return { error: "bad_status" };
    const loc = await P.locate(pid, projectId);
    if (!loc) return { error: "not_found" };
    const p = clone(loc.project);
    p.status = status;
    if (status === "completed") { p.forceCompleted = true; p.completedAt = p.completedAt || nowIso(); }
    else if (status === "active") { p.forceCompleted = false; p.completedAt = null; }
    if (status === "on_hold") p.onHoldReason = opts.reason || p.onHoldReason || "";
    if (status === "cancelled") p.cancelledReason = opts.reason || "";
    return persist(pid, p, { system: true });
  };
  P.activate = (pid, id, opts) => P.setStatus(pid, id, "active", opts);
  P.hold = (pid, id, reason) => P.setStatus(pid, id, "on_hold", { reason: reason });
  P.resume = (pid, id) => P.setStatus(pid, id, "active");
  P.complete = (pid, id) => P.setStatus(pid, id, "completed");
  P.cancel = (pid, id, reason) => P.setStatus(pid, id, "cancelled", { reason: reason });

  /* ─────────────────────────── child mutations ─────────────────────────── */

  async function mutate(pid, projectId, fn) {
    if (!ERP.security.enforce("projects.edit")) return { error: "forbidden" };
    const loc = await P.locate(pid, projectId);
    if (!loc) return { error: "not_found" };
    const p = normalise(clone(loc.project));
    const res = fn(p);
    if (res && res.error) return res;
    return persist(pid, p, { system: true });
  }

  P.addPhase = (pid, projectId, data) => mutate(pid, projectId, (p) => { p.phases.push(Object.assign(P.newPhase(), data)); });
  P.updatePhase = (pid, projectId, phaseId, patch) => mutate(pid, projectId, (p) => {
    const ph = p.phases.find((x) => String(x.id) === String(phaseId));
    if (!ph) return { error: "not_found" };
    Object.assign(ph, patch);
  });
  P.removePhase = (pid, projectId, phaseId) => mutate(pid, projectId, (p) => {
    p.phases = p.phases.filter((x) => String(x.id) !== String(phaseId));
    p.milestones = p.milestones.filter((m) => String(m.phaseId) !== String(phaseId));
  });

  P.addTask = (pid, projectId, phaseId, data) => mutate(pid, projectId, (p) => {
    const ph = p.phases.find((x) => String(x.id) === String(phaseId));
    if (!ph) return { error: "not_found" };
    ph.tasks.push(Object.assign(P.newTask(), data));
  });
  P.updateTask = (pid, projectId, taskId, patch) => mutate(pid, projectId, (p) => {
    const hit = P.findTask(p, taskId);
    if (!hit) return { error: "not_found" };
    Object.assign(hit.task, patch);
    if (patch.status === "complete") hit.task.completedAt = hit.task.completedAt || nowIso();
    else if (patch.status) hit.task.completedAt = null;
  });
  P.setTaskStatus = (pid, projectId, taskId, status) => P.updateTask(pid, projectId, taskId, { status: status });
  P.completeTask = (pid, projectId, taskId) => P.setTaskStatus(pid, projectId, taskId, "complete");
  P.removeTask = (pid, projectId, taskId) => mutate(pid, projectId, (p) => {
    (p.phases || []).forEach((ph) => { ph.tasks = (ph.tasks || []).filter((t) => String(t.id) !== String(taskId)); });
    p.milestones.forEach((m) => { if (m.taskId != null && String(m.taskId) === String(taskId)) m.taskId = null; });
  });
  P.toggleChecklist = (pid, projectId, taskId, index) => mutate(pid, projectId, (p) => {
    const hit = P.findTask(p, taskId);
    if (!hit) return { error: "not_found" };
    const c = (hit.task.checklist || [])[Number(index)];
    if (!c) return { error: "not_found" };
    c.done = !c.done;
  });

  P.addMilestone = (pid, projectId, data) => mutate(pid, projectId, (p) => { p.milestones.push(Object.assign(P.newMilestone(), data)); });
  P.updateMilestone = (pid, projectId, milestoneId, patch) => mutate(pid, projectId, (p) => {
    const m = P.findMilestone(p, milestoneId);
    if (!m) return { error: "not_found" };
    if (m.status === "invoiced" && patch.status && patch.status !== "invoiced") return { error: "invoiced", message: "An invoiced milestone can't be changed; void the invoice first." };
    Object.assign(m, patch);
  });
  P.removeMilestone = (pid, projectId, milestoneId) => mutate(pid, projectId, (p) => {
    const m = P.findMilestone(p, milestoneId);
    if (m && m.status === "invoiced") return { error: "invoiced" };
    p.milestones = p.milestones.filter((x) => String(x.id) !== String(milestoneId));
  });

  /* ─────────────────────────── templates ─────────────────────────── */

  function normaliseTemplate(t) {
    t.phases = (Array.isArray(t.phases) ? t.phases : []).map((ph) => Object.assign(P.newTemplatePhase(), ph, {
      tasks: (Array.isArray(ph.tasks) ? ph.tasks : []).map((x) => Object.assign(P.newTemplateTask(), x)),
    }));
    t.billingMethod = t.billingMethod || "tm";
    t.fixedFee = num(t.fixedFee);
    t.estimatedHours = num(t.estimatedHours);
    t.hourlyRate = num(t.hourlyRate);
    let seq = nextSeq(t);
    const assign = (rec, tag) => { if (rec.id == null || rec.id === "") { rec.id = "tp" + seq + tag; seq += 1; } };
    t.phases.forEach((ph) => { assign(ph, "p"); ph.tasks.forEach((x) => assign(x, "t")); });
    return t;
  }

  async function putProvider(pid, rec) {
    if (rec.id == null || rec.id === "" || !isFinite(rec.id)) rec.id = ten().nextId(await ten().records("provider", pid));
    rec.providerId = pid;
    return ten().upsert("provider", pid, rec);
  }

  P.templates = async (pid) => (await ten().records("provider", pid, "projectTemplate")).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  P.getTemplate = async (pid, id) => (await P.templates(pid)).find((t) => String(t.id) === String(id)) || null;

  P.saveTemplate = async function (pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("projects.edit")) return { error: "forbidden" };
    const existing = rec && rec.id != null && rec.id !== "" ? await P.getTemplate(pid, rec.id) : null;
    const t = normaliseTemplate(Object.assign(P.newTemplate(), existing || {}, rec));
    if (!String(t.name || "").trim()) return { error: "name_required", message: "Give the template a name." };
    t.name = String(t.name).trim();
    if (!existing) { t.createdAt = nowIso(); t.createdBy = actor().memberId || null; }
    t.updatedAt = nowIso();
    await putProvider(pid, t);
    return { record: t, created: !existing };
  };

  P.removeTemplate = async function (pid, id) {
    if (!ERP.security.enforce("projects.edit")) return { error: "forbidden" };
    await ten().remove("provider", pid, (r) => r.kind === "projectTemplate" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  async function mutateTemplate(pid, templateId, fn, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("projects.edit")) return { error: "forbidden" };
    const t = await P.getTemplate(pid, templateId);
    if (!t) return { error: "not_found" };
    const copy = normaliseTemplate(clone(t));
    const res = fn(copy);
    if (res && res.error) return res;
    copy.updatedAt = nowIso();
    await putProvider(pid, copy);
    return { record: copy };
  }

  P.addTemplatePhase = (pid, tid, data) => mutateTemplate(pid, tid, (t) => { t.phases.push(Object.assign(P.newTemplatePhase(), data)); });
  P.updateTemplatePhase = (pid, tid, phaseId, patch) => mutateTemplate(pid, tid, (t) => {
    const ph = t.phases.find((x) => String(x.id) === String(phaseId));
    if (!ph) return { error: "not_found" };
    Object.assign(ph, patch);
  });
  P.removeTemplatePhase = (pid, tid, phaseId) => mutateTemplate(pid, tid, (t) => { t.phases = t.phases.filter((x) => String(x.id) !== String(phaseId)); });
  P.addTemplateTask = (pid, tid, phaseId, data) => mutateTemplate(pid, tid, (t) => {
    const ph = t.phases.find((x) => String(x.id) === String(phaseId));
    if (!ph) return { error: "not_found" };
    ph.tasks.push(Object.assign(P.newTemplateTask(), data));
  });
  P.updateTemplateTask = (pid, tid, taskId, patch) => mutateTemplate(pid, tid, (t) => {
    let hit = null;
    t.phases.forEach((ph) => { const x = ph.tasks.find((y) => String(y.id) === String(taskId)); if (x) hit = x; });
    if (!hit) return { error: "not_found" };
    Object.assign(hit, patch);
  });
  P.removeTemplateTask = (pid, tid, taskId) => mutateTemplate(pid, tid, (t) => {
    (t.phases || []).forEach((ph) => { ph.tasks = ph.tasks.filter((x) => String(x.id) !== String(taskId)); });
  });

  function applyTemplate(project, tpl) {
    project.phases = (tpl.phases || []).map((ph) => Object.assign(P.newPhase(), {
      name: ph.name, description: ph.description || "", estimatedHours: num(ph.estimatedHours), billable: ph.billable !== false,
      tasks: (ph.tasks || []).map((x) => Object.assign(P.newTask(), {
        name: x.name, description: x.description || "", estimatedHours: num(x.estimatedHours),
        ownerId: x.ownerId || null, ticketTemplateId: x.ticketTemplateId || null,
        checklist: (x.checklist || []).map((c) => ({ text: typeof c === "string" ? c : (c.text || c.label || ""), done: false })),
      })),
    }));
    if (!project.description) project.description = tpl.description || "";
    if (!project.type) project.type = tpl.type || "";
    return project;
  }

  P.instantiate = async function (pid, opts) {
    opts = opts || {};
    const tpl = await P.getTemplate(pid, opts.templateId);
    if (!tpl) return { error: "template_required", message: "Choose a project template." };
    const p = P.newProject({
      companyId: opts.companyId, name: opts.name || tpl.name, description: tpl.description,
      type: opts.type || tpl.type, billingMethod: opts.billingMethod || tpl.billingMethod,
      fixedFee: opts.fixedFee != null ? opts.fixedFee : tpl.fixedFee,
      estimatedHours: opts.estimatedHours != null ? opts.estimatedHours : tpl.estimatedHours,
      hourlyRate: opts.hourlyRate != null ? opts.hourlyRate : tpl.hourlyRate,
      hourlyCost: opts.hourlyCost, ownerId: opts.ownerId, managerId: opts.managerId,
      startDate: opts.startDate, dueDate: opts.dueDate, templateId: tpl.id,
    });
    return P.save(pid, p);
  };

  /* Starter templates, seeded once per provider (idempotent by presence). */
  P.seedTemplates = async function (pid) {
    if ((await P.templates(pid)).length) return { seeded: false };
    const seeds = [
      P.newTemplate({
        name: "New client onboarding", type: "", billingMethod: "fixed", fixedFee: 2500, estimatedHours: 24,
        description: "Standard onboarding for a new managed-services client.",
        phases: [
          { name: "Discovery & audit", estimatedHours: 8, tasks: [
            { name: "Kick-off call", estimatedHours: 1 }, { name: "Site survey", estimatedHours: 3 }, { name: "Document current environment", estimatedHours: 4 },
          ] },
          { name: "Deployment", estimatedHours: 12, tasks: [
            { name: "Provision accounts & tooling", estimatedHours: 3 }, { name: "Deploy monitoring agent", estimatedHours: 4 }, { name: "Migrate documentation", estimatedHours: 5 },
          ] },
          { name: "Handover", estimatedHours: 4, tasks: [
            { name: "Training session", estimatedHours: 2 }, { name: "Sign-off & handover pack", estimatedHours: 2 },
          ] },
        ],
      }),
      P.newTemplate({
        name: "Server migration", type: "", billingMethod: "milestone", estimatedHours: 40,
        description: "Plan, migrate and validate a server workload.",
        phases: [
          { name: "Plan", estimatedHours: 10, tasks: [
            { name: "Inventory source & target", estimatedHours: 4 }, { name: "Migration plan & rollback", estimatedHours: 6 },
          ] },
          { name: "Migrate", estimatedHours: 20, tasks: [
            { name: "Provision target", estimatedHours: 6 }, { name: "Cut over data", estimatedHours: 8 }, { name: "Re-point clients", estimatedHours: 6 },
          ] },
          { name: "Validate", estimatedHours: 10, tasks: [
            { name: "Smoke test", estimatedHours: 4 }, { name: "Decommission source", estimatedHours: 3 }, { name: "As-built documentation", estimatedHours: 3 },
          ] },
        ],
      }),
      P.newTemplate({
        name: "Workstation rollout", type: "", billingMethod: "tm", estimatedHours: 16,
        description: "Stage, deploy and verify a batch of workstations.",
        phases: [
          { name: "Stage", estimatedHours: 6, tasks: [{ name: "Image the machines", estimatedHours: 6 }] },
          { name: "Deploy", estimatedHours: 6, tasks: [{ name: "Install & join domain", estimatedHours: 6 }] },
          { name: "Verify", estimatedHours: 4, tasks: [{ name: "Handover & user check", estimatedHours: 4 }] },
        ],
      }),
    ];
    for (const t of seeds) await P.saveTemplate(pid, t, { system: true });
    return { seeded: true, count: seeds.length };
  };

  /* ─────────────────────────── budget & actuals (Task 36) ─────────────────────────── */

  P.estimate = function (project) {
    const tasks = P.tasksOf(project).map((h) => h.task);
    let hours = num(project.estimatedHours);
    if (!hours) hours = tasks.reduce((n, t) => n + num(t.estimatedHours), 0);
    const cost = round2(hours * num(project.hourlyCost));
    let revenue;
    if (project.billingMethod === "fixed") revenue = num(project.fixedFee);
    else if (project.billingMethod === "milestone") revenue = round2((project.milestones || []).filter((m) => m.status !== "void").reduce((n, m) => n + num(m.amount), 0));
    else revenue = round2(hours * num(project.hourlyRate));
    return {
      hours: round2(hours), cost: cost, revenue: revenue,
      margin: round2(revenue - cost), marginPct: revenue > 0 ? Math.round((revenue - cost) / revenue * 100) : null,
      method: project.billingMethod, taskCount: tasks.length,
    };
  };

  P.actuals = async function (pid, project, opts) {
    opts = opts || {};
    const companyId = project.companyId;
    let entries = [], expenses = [];
    try { entries = await ERP.time.entries(pid, { companyId: companyId, fromDate: opts.from || null, toDate: opts.to || null }); } catch (e) {}
    entries = entries.filter((e) => String(e.projectId || "") === String(project.id));
    try { expenses = await ERP.expenses.list(pid, { companyId: companyId, fromDate: opts.from || null, toDate: opts.to || null }); } catch (e) {}
    expenses = expenses.filter((x) => String(x.projectId || "") === String(project.id));

    const members = await membersList();
    const costRate = (memberId) => { const m = members.find((x) => String(x.id) === String(memberId)); return num(m && m.hourlyCost); };
    const taskPhase = {};
    (project.phases || []).forEach((ph) => (ph.tasks || []).forEach((t) => { taskPhase[String(t.id)] = ph.id; }));
    const byTask = {}, byPhase = {};
    const bump = (map, key, minutes, cost, billableMinutes, isExpense) => {
      if (key == null || key === "") return;
      const k = String(key);
      if (!map[k]) map[k] = { minutes: 0, cost: 0, billableMinutes: 0, entries: 0, expenses: 0 };
      map[k].minutes += minutes;
      map[k].cost = round2(map[k].cost + cost);
      map[k].billableMinutes += billableMinutes;
      if (isExpense) map[k].expenses += 1; else map[k].entries += 1;
    };

    let minutes = 0, laborCost = 0, billableMinutes = 0;
    for (const e of entries) {
      const min = num(e.minutes); minutes += min;
      const bill = e.billable && !e.writtenOff ? min : 0; billableMinutes += bill;
      const c = round2(num(min) / 60 * costRate(e.memberId)); laborCost = round2(laborCost + c);
      bump(byTask, e.taskId, min, c, bill, false);
      bump(byPhase, e.taskId ? taskPhase[String(e.taskId)] : null, min, c, bill, false);
    }
    let expenseCost = 0;
    for (const x of expenses) {
      const amt = round2(num(x.amount)); expenseCost = round2(expenseCost + amt);
      bump(byTask, x.taskId, 0, amt, 0, true);
      bump(byPhase, x.taskId ? taskPhase[String(x.taskId)] : null, 0, amt, 0, true);
    }
    (project.phases || []).forEach((ph) => { if (!byPhase[String(ph.id)]) byPhase[String(ph.id)] = { minutes: 0, cost: 0, billableMinutes: 0, entries: 0, expenses: 0 }; });
    return {
      companyId: companyId, projectId: project.id,
      entries: entries.length, expenseCount: expenses.length,
      minutes: minutes, hours: round2(minutes / 60),
      billableMinutes: billableMinutes, billableHours: round2(billableMinutes / 60),
      laborCost: laborCost, expenseCost: expenseCost, cost: round2(laborCost + expenseCost),
      byTask: byTask, byPhase: byPhase, timeEntries: entries, expenses: expenses,
    };
  };

  P.budgetStatus = async function (pid, project, opts) {
    const estimate = P.estimate(project);
    const actual = await P.actuals(pid, project, opts);
    const progress = num(project.progress) / 100;
    const hoursPct = estimate.hours > 0 ? Math.round(actual.hours / estimate.hours * 100) : null;
    const costPct = estimate.cost > 0 ? Math.round(actual.cost / estimate.cost * 100) : null;
    const projectedCost = progress > 0 && progress < 1 ? round2(actual.cost / progress) : actual.cost;
    const projectedHours = progress > 0 && progress < 1 ? round2(actual.hours / progress) : actual.hours;
    const flags = [];
    if (costPct != null && costPct > 100) flags.push("over_budget");
    if (hoursPct != null && hoursPct > 100) flags.push("hours_over");
    if (estimate.cost > 0 && progress > 0 && progress < 1 && projectedCost > estimate.cost * 1.05) flags.push("trending_over");
    if (estimate.revenue > 0 && estimate.cost > 0 && estimate.margin < 0) flags.push("loss_making");
    return {
      estimate: estimate, actual: actual, progress: progress,
      hoursPct: hoursPct, costPct: costPct, projectedCost: projectedCost, projectedHours: projectedHours,
      flags: flags, overBudget: flags.indexOf("over_budget") !== -1,
    };
  };

  P.profitability = async function (pid, opts) {
    opts = opts || {};
    const projects = await P.list(pid, { companyId: opts.companyId, status: opts.status });
    const rows = [];
    const totals = { cost: 0, revenue: 0, billed: 0, draft: 0, margin: 0, budget: 0 };
    for (const pr of projects) {
      const estimate = P.estimate(pr);
      const actual = await P.actuals(pid, pr, opts);
      let billed = 0, draft = 0;
      for (const inv of await invoiceRecords(pr.companyId)) {
        if (inv.status === "void") continue;
        for (const l of inv.lines || []) {
          if (String(l.projectId) !== String(pr.id)) continue;
          if (inv.status === "posted") billed = round2(billed + num(l.amount));
          else draft = round2(draft + num(l.amount));
        }
      }
      const revenue = round2(billed + draft);
      const margin = round2(revenue - actual.cost);
      rows.push({ project: pr, estimate: estimate, actual: actual, billed: billed, draft: draft, revenue: revenue, margin: margin, marginPct: revenue > 0 ? Math.round(margin / revenue * 100) : null });
      totals.cost = round2(totals.cost + actual.cost);
      totals.revenue = round2(totals.revenue + revenue);
      totals.billed = round2(totals.billed + billed);
      totals.draft = round2(totals.draft + draft);
      totals.margin = round2(totals.margin + margin);
      totals.budget = round2(totals.budget + estimate.revenue);
    }
    return { rows: rows, totals: totals };
  };

  /* ─────────────────────────── billing seam (Task 37) ─────────────────────────── */

  P.billableMilestones = async function (pid, companyId, period) {
    period = period || {};
    const out = [];
    for (const pr of await P.all(companyId)) {
      if (String(pr.status) === "cancelled") continue;
      for (const m of pr.milestones || []) {
        if (m.status !== "ready") continue;
        if (num(m.amount) <= 0) continue;
        if (m.dueDate && period.end && String(m.dueDate) > String(period.end)) continue;
        out.push({
          id: m.id, name: m.name, amount: num(m.amount), date: m.dueDate || period.end,
          projectId: pr.id, projectName: pr.name, projectNumber: pr.number, phaseId: m.phaseId, milestone: m,
        });
      }
    }
    return out;
  };

  P.readyMilestones = async function (pid, companyId) {
    const out = [];
    for (const pr of await P.all(companyId)) {
      for (const m of pr.milestones || []) if (m.status === "ready") out.push(Object.assign({}, m, { projectId: pr.id, projectName: pr.name, projectNumber: pr.number }));
    }
    return out;
  };

  async function stampMilestones(companyId, ids, invoiceId, status) {
    const set = (ids || []).map(String);
    if (!set.length) return { count: 0 };
    const list = await ten().records("company", companyId);
    let count = 0;
    const updated = list.map((r) => {
      if (r.kind !== "project") return r;
      let changed = false;
      const milestones = (r.milestones || []).map((m) => {
        if (set.indexOf(String(m.id)) === -1) return m;
        changed = true; count += 1;
        if (invoiceId == null || invoiceId === "") return Object.assign({}, m, { status: status || "ready", invoiceId: null, invoicedAt: null });
        return Object.assign({}, m, { status: status || "invoiced", invoiceId: invoiceId, invoicedAt: nowIso() });
      });
      return changed ? Object.assign({}, r, { milestones: milestones, updatedAt: nowIso() }) : r;
    });
    if (count) await ten().save("company", companyId, updated);
    return { count: count };
  }

  P.markMilestonesInvoiced = async function (companyId, ids, invoiceId) {
    const res = await stampMilestones(companyId, ids, invoiceId, invoiceId == null ? "ready" : "invoiced");
    if (res.count && invoiceId != null) {
      const pid = await ten().providerId();
      if (pid != null) {
        for (const id of (ids || [])) {
          const found = await P.findMilestoneCompany(companyId, id);
          if (found) await emit(pid, "project.milestone_invoiced", found.project, { milestone: found.milestone, invoiceId: invoiceId });
        }
      }
    }
    return res;
  };

  P.findMilestoneCompany = async function (companyId, milestoneId) {
    for (const pr of await P.all(companyId)) {
      const m = (pr.milestones || []).find((x) => String(x.id) === String(milestoneId));
      if (m) return { project: pr, milestone: m };
    }
    return null;
  };

  P.releaseMilestone = async function (pid, projectId, milestoneId, opts) {
    if (!ERP.security.enforce("projects.bill")) return { error: "forbidden" };
    const res = await mutate(pid, projectId, (p) => {
      const m = P.findMilestone(p, milestoneId);
      if (!m) return { error: "not_found" };
      if (m.status === "invoiced") return { error: "invoiced", message: "This milestone is already invoiced." };
      m.status = "ready"; m.readyAt = nowIso(); m.releasedBy = actorName();
    });
    if (res.record) await emit(pid, "project.milestone_ready", res.record, { milestone: P.findMilestone(res.record, milestoneId) });
    return res;
  };

  P.voidMilestone = async function (pid, projectId, milestoneId, note) {
    if (!ERP.security.enforce("projects.bill")) return { error: "forbidden" };
    return mutate(pid, projectId, (p) => {
      const m = P.findMilestone(p, milestoneId);
      if (!m) return { error: "not_found" };
      if (m.status === "invoiced") return { error: "invoiced", message: "An invoiced milestone can't be voided; void the invoice instead." };
      m.status = "void"; m.note = note || m.note || "";
    });
  };

  /* ═══════════════════════════ station ═══════════════════════════
     Five tabs: the project register & work breakdown; reusable
     templates; the cross-project task schedule; budget vs actuals &
     profitability; and the milestone billing register. */

  function blankState() {
    return {
      tab: "projects", companyId: "", status: "", projectId: "", templateId: "",
      ownerId: "", showCompleted: false, includeAllClients: false,
    };
  }

  function bar(pct, tone) {
    const v = Math.max(0, Math.min(100, num(pct)));
    return '<div class="erp-proj-bar' + (tone ? " tone-" + tone : "") + '" title="' + v + '%"><span style="width:' + v + '%"></span></div>';
  }

  function taskStats(project) {
    const tasks = P.tasksOf(project).map((h) => h.task);
    const today = ui.today();
    const done = tasks.filter((t) => t.status === "complete").length;
    const overdue = tasks.filter((t) => t.status !== "complete" && t.dueDate && String(t.dueDate) < today).length;
    const unassigned = tasks.filter((t) => t.status !== "complete" && (t.ownerId == null || t.ownerId === "")).length;
    const remainingHours = round2(tasks.filter((t) => t.status !== "complete").reduce((n, t) => n + num(t.estimatedHours), 0));
    return { total: tasks.length, done: done, open: tasks.length - done, overdue: overdue, unassigned: unassigned, remainingHours: remainingHours };
  }

  let currentHost = null;
  async function renderTab(id) {
    const host = currentHost;
    if (!host) return;
    const old = host.querySelector('[data-panel="' + id + '"]');
    if (!old) return;
    const panel = document.createElement("div");
    panel.className = old.className;
    panel.setAttribute("data-panel", id);
    panel.__host = host;
    old.replaceWith(panel);
    ERP.states.loading(panel, "Loading projects");
    try {
      const pid = await ten().providerId();
      if (id === "projects") await renderProjects(panel, pid);
      else if (id === "templates") await renderTemplates(panel, pid);
      else if (id === "schedule") await renderSchedule(panel, pid);
      else if (id === "budget") await renderBudget(panel, pid);
      else if (id === "billing") await renderBilling(panel, pid);
    } catch (e) {
      console.error("projects tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }
  const st = (panel) => panel.__host.__proj;
  const refreshWith = (panel) => () => renderTab(st(panel).tab);
  const clientOptions = () => ERP.companies.optionList();

  /* ── projects register ── */

  async function renderProjects(panel, pid) {
    const state = st(panel);
    if (state.projectId) return renderProjectDetail(panel, pid, state.projectId);
    const [companies, members] = await Promise.all([clientOptions(), membersList()]);
    const list = await P.list(pid, { companyId: state.companyId, status: state.status });
    const all = await P.list(pid, {});
    const canEdit = ERP.security.can("projects.edit");
    const active = all.filter((p) => p.status === "active");
    let openTasks = 0, overdue = 0, contract = 0;
    all.forEach((p) => { const s = taskStats(p); openTasks += s.open; overdue += s.overdue; contract += P.estimate(p).revenue; });

    const rows = list.map((p) => {
      const s = taskStats(p);
      const est = P.estimate(p);
      const acts = [ui.btn("Open", { small: true, act: "prj-open", arg: p.id })];
      if (canEdit) { acts.push(ui.btn("Edit", { small: true, act: "prj-edit", arg: p.id })); acts.push(ui.btn("Delete", { small: true, danger: true, act: "prj-del", arg: p.id })); }
      const flag = (s.overdue ? ui.badge(s.overdue + " overdue", "danger") : "") + " " + (p.status === "on_hold" ? ui.badge("on hold", "warn") : "");
      return {
        number: ui.esc(p.number || "—"),
        name: ui.esc(p.name) + (p.type ? '<span class="erp-sub">' + ui.esc(p.type) + "</span>" : "") + (flag ? " " + flag : ""),
        client: ui.esc(p.__companyName || ""),
        status: ui.badge(P.statusLabel(p.status), P.statusTone(p.status)),
        method: ui.esc(P.billingLabel(p.billingMethod)),
        owner: ui.esc(memberName(members, p.ownerId)),
        dates: ui.esc(p.startDate || "—") + " → " + ui.esc(p.dueDate || "open"),
        progress: bar(p.progress) + '<span class="erp-sub">' + p.progress + "% · " + s.done + "/" + s.total + " tasks</span>",
        budget: ERP.security.canSeeFinancials() ? ui.money(est.revenue, p.currency) + ' <span class="erp-sub">plan</span>' : "•••",
        actions: acts.join(" "),
      };
    });

    panel.innerHTML =
      ui.summary([
        { label: "Active", value: String(active.length) },
        { label: "Open tasks", value: String(openTasks) },
        { label: "Overdue", value: String(overdue) },
        { label: "Planned value", value: maskedMoney(contract) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("prj-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.select("prj-status", "Status", [{ value: "", label: "Any status" }].concat(P.PROJECT_STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status) +
        '<span class="erp-db-hint">' + (canEdit ? "Open a project to manage its phases, tasks and milestones" : "Read-only for your role") + "</span>" +
        (canEdit ? ui.btn("New project", { primary: true, act: "prj-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "number", label: "Number" },
        { key: "name", label: "Project" },
        { key: "client", label: "Client" },
        { key: "status", label: "Status" },
        { key: "method", label: "Billing" },
        { key: "owner", label: "Owner" },
        { key: "dates", label: "Dates" },
        { key: "progress", label: "Progress", width: "160px" },
        { key: "budget", label: "Plan", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No projects yet. Create one, or start from a template." });

    const bindSel = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("projects"); }); };
    bindSel('[name="prj-client"]', "companyId");
    bindSel('[name="prj-status"]', "status");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "prj-open") { state.projectId = arg; return renderTab("projects"); }
      if (act === "prj-new") return openProjectModal(pid, null, () => renderTab("projects"));
      if (act === "prj-edit") { const loc = await P.locate(pid, arg); if (loc) return openProjectModal(pid, loc.project, () => renderTab("projects")); return; }
      if (act === "prj-del") {
        const loc = await P.locate(pid, arg); if (!loc) return;
        if (!(await ui.confirm({ title: "Delete this project?", message: "Its phases, tasks and milestones are removed. This can't be undone.", danger: true, okLabel: "Delete" }))) return;
        const res = await P.remove(pid, loc.companyId, arg);
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Project deleted.", "success"); renderTab("projects");
      }
    });
  }

  async function renderProjectDetail(panel, pid, projectId) {
    const state = st(panel);
    const loc = await P.locate(pid, projectId);
    if (!loc) { state.projectId = ""; return renderProjects(panel, pid); }
    const project = loc.project;
    const [members, budget] = await Promise.all([membersList(), P.budgetStatus(pid, project, {})]);
    const canEdit = ERP.security.can("projects.edit");
    const canBill = ERP.security.can("projects.bill");
    const est = budget.estimate, act = budget.actual, flags = budget.flags;

    const headActions = [];
    if (canEdit && project.status === "draft") headActions.push(ui.btn("Activate", { small: true, primary: true, act: "prj-activate", arg: project.id }));
    if (canEdit && project.status === "active") headActions.push(ui.btn("Hold", { small: true, act: "prj-hold", arg: project.id }));
    if (canEdit && project.status === "on_hold") headActions.push(ui.btn("Resume", { small: true, primary: true, act: "prj-resume", arg: project.id }));
    if (canEdit && ["active", "on_hold"].indexOf(project.status) !== -1) headActions.push(ui.btn("Complete", { small: true, act: "prj-complete", arg: project.id }));
    if (canEdit) headActions.push(ui.btn("Edit", { small: true, act: "prj-edit", arg: project.id }));
    if (canEdit && project.status !== "cancelled") headActions.push(ui.btn("Cancel", { small: true, danger: true, act: "prj-cancel", arg: project.id }));

    const flagHtml = flags.map((f) => ui.badge({
      over_budget: "Over budget", hours_over: "Hours over", trending_over: "Trending over", loss_making: "Loss making",
    }[f] || f, f === "loss_making" ? "danger" : "warn")).join(" ");

    const phaseHtml = (project.phases || []).map((ph) => phaseCard(project, ph, members, act, est, canEdit)).join("") ||
      ui.alert("No phases yet. Add a phase to break the work down.", "info");

    const msRows = (project.milestones || []).map((m) => {
      const phase = (project.phases || []).find((x) => String(x.id) === String(m.phaseId));
      const acts = [];
      if (canBill && m.status === "pending") acts.push(ui.btn("Release", { small: true, primary: true, act: "prj-ms-release", arg: m.id }));
      if (canBill && m.status === "ready") acts.push(ui.btn("Withdraw", { small: true, act: "prj-ms-withdraw", arg: m.id }));
      if (canEdit && m.status !== "invoiced") acts.push(ui.btn("Edit", { small: true, act: "prj-ms-edit", arg: m.id }));
      if (canEdit && m.status !== "invoiced") acts.push(ui.btn("Remove", { small: true, danger: true, act: "prj-ms-del", arg: m.id }));
      return {
        name: ui.esc(m.name || "—") + (m.auto ? " " + ui.badge("auto", "muted") : ""),
        phase: ui.esc(phase ? phase.name : "—"),
        amount: maskedMoney(num(m.amount)),
        due: ui.esc(m.dueDate || "—"),
        status: ui.badge(P.milestoneStatusLabel(m.status), P.milestoneStatusTone(m.status)) + (m.invoiceId != null ? '<span class="erp-sub">inv #' + ui.esc(m.invoiceId) + "</span>" : ""),
        actions: acts.join(" "),
      };
    });

    panel.innerHTML =
      '<div class="erp-db-toolbar">' +
        ui.btn("← All projects", { small: true, act: "prj-back" }) +
        '<span class="erp-db-hint">' + ui.esc(P.billingLabel(project.billingMethod)) + (project.number ? " · " + ui.esc(project.number) : "") + " · " + ui.esc(loc.company ? loc.company.name : "") + "</span>" +
        headActions.join(" ") +
      "</div>" +
      ui.summary([
        { label: "Status", value: ui.badge(P.statusLabel(project.status), P.statusTone(project.status)) },
        { label: "Progress", value: project.progress + "%" },
        { label: "Hours (act / est)", value: ui.fmt(act.hours, 1) + " / " + ui.fmt(est.hours, 1) },
        { label: "Cost (act / est)", value: maskedMoney(act.cost) + " / " + maskedMoney(est.cost) },
        { label: "Plan value", value: maskedMoney(est.revenue) },
        { label: "Margin", value: maskedMoney(est.margin) + (est.marginPct != null ? '<span class="erp-sub">' + est.marginPct + "%</span>" : "") },
      ]) +
      (flagHtml ? '<div class="erp-proj-flags">' + flagHtml + "</div>" : "") +
      (project.description ? '<p class="erp-proj-desc">' + ui.esc(project.description) + "</p>" : "") +
      '<div class="erp-proj-section-head"><h3>Phases &amp; tasks</h3>' + (canEdit ? ui.btn("Add phase", { small: true, primary: true, act: "prj-phase-new" }) : "") + "</div>" +
      '<div class="erp-proj-phases">' + phaseHtml + "</div>" +
      '<div class="erp-proj-section-head"><h3>Milestones</h3>' + (canEdit ? ui.btn("Add milestone", { small: true, act: "prj-ms-new" }) : "") + "</div>" +
      ui.table([
        { key: "name", label: "Milestone" },
        { key: "phase", label: "Phase" },
        { key: "amount", label: "Amount", align: "right" },
        { key: "due", label: "Due" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], msRows, { emptyText: project.billingMethod === "fixed" ? "A fixed-fee milestone is generated from the fee." : "No milestones. Add one, or tie them to phases so they release on completion." });

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      const refresh = () => renderTab("projects");
      if (act === "prj-back") { state.projectId = ""; return renderTab("projects"); }
      if (act === "prj-edit") return openProjectModal(pid, project, refresh);
      if (act === "prj-activate") { await P.activate(pid, project.id); ERP.toast("Project activated.", "success"); return refresh(); }
      if (act === "prj-hold") return openReasonModal("Put the project on hold", "Reason (optional)", "", async (reason) => { await P.hold(pid, project.id, reason); ERP.toast("Project on hold.", "success"); refresh(); });
      if (act === "prj-resume") { await P.resume(pid, project.id); ERP.toast("Project resumed.", "success"); return refresh(); }
      if (act === "prj-complete") { await P.complete(pid, project.id); ERP.toast("Project completed.", "success"); return refresh(); }
      if (act === "prj-cancel") return openReasonModal("Cancel this project", "Reason (optional)", "", async (reason) => { await P.cancel(pid, project.id, reason); ERP.toast("Project cancelled.", "success"); refresh(); }, true);
      if (act === "prj-phase-new") return openPhaseModal(pid, "project", project, null, refresh);
      if (act === "prj-phase-edit") return openPhaseModal(pid, "project", project, (project.phases || []).find((x) => String(x.id) === String(arg)), refresh);
      if (act === "prj-phase-del") {
        if (!(await ui.confirm({ title: "Remove this phase?", message: "Its tasks are removed with it.", danger: true, okLabel: "Remove" }))) return;
        await P.removePhase(pid, project.id, arg); ERP.toast("Phase removed.", "success"); return refresh();
      }
      if (act === "prj-task-new") return openTaskModal(pid, "project", project, arg, null, refresh);
      if (act === "prj-task-edit") { const hit = P.findTask(project, arg); return openTaskModal(pid, "project", project, hit && hit.phase.id, hit && hit.task, refresh); }
      if (act === "prj-task-done") { await P.setTaskStatus(pid, project.id, arg, "complete"); return refresh(); }
      if (act === "prj-task-start") { await P.setTaskStatus(pid, project.id, arg, "in_progress"); return refresh(); }
      if (act === "prj-task-block") { await P.setTaskStatus(pid, project.id, arg, "blocked"); return refresh(); }
      if (act === "prj-task-reopen") { await P.setTaskStatus(pid, project.id, arg, "pending"); return refresh(); }
      if (act === "prj-task-del") {
        if (!(await ui.confirm({ title: "Remove this task?", danger: true, okLabel: "Remove" }))) return;
        await P.removeTask(pid, project.id, arg); ERP.toast("Task removed.", "success"); return refresh();
      }
      if (act === "prj-chk") { const parts = String(arg).split("|"); await P.toggleChecklist(pid, project.id, parts[0], parts[1]); return refresh(); }
      if (act === "prj-ms-new") return openMilestoneModal(pid, "project", project, null, refresh);
      if (act === "prj-ms-edit") return openMilestoneModal(pid, "project", project, P.findMilestone(project, arg), refresh);
      if (act === "prj-ms-release") { await P.releaseMilestone(pid, project.id, arg); ERP.toast("Milestone released to billing.", "success"); return refresh(); }
      if (act === "prj-ms-withdraw") { await P.updateMilestone(pid, project.id, arg, { status: "pending" }); return refresh(); }
      if (act === "prj-ms-void") { await P.voidMilestone(pid, project.id, arg); return refresh(); }
      if (act === "prj-ms-del") {
        if (!(await ui.confirm({ title: "Remove this milestone?", danger: true, okLabel: "Remove" }))) return;
        const r = await P.removeMilestone(pid, project.id, arg);
        if (r.error) return ERP.toast(r.message || r.error, "error");
        ERP.toast("Milestone removed.", "success"); return refresh();
      }
    });
  }

  function phaseCard(project, ph, members, actual, est, canEdit) {
    const acts = [];
    if (canEdit) { acts.push(ui.btn("Edit", { small: true, act: "prj-phase-edit", arg: ph.id })); acts.push(ui.btn("Remove", { small: true, danger: true, act: "prj-phase-del", arg: ph.id })); }
    const rows = (ph.tasks || []).map((t) => {
      const a = (actual.byTask && actual.byTask[String(t.id)]) || { hours: 0 };
      const buttons = [];
      if (canEdit) {
        if (t.status === "pending") buttons.push(ui.btn("Start", { small: true, act: "prj-task-start", arg: t.id }));
        if (t.status !== "complete") buttons.push(ui.btn("Done", { small: true, primary: true, act: "prj-task-done", arg: t.id }));
        if (t.status === "blocked") buttons.push(ui.btn("Unblock", { small: true, act: "prj-task-reopen", arg: t.id }));
        else if (t.status === "in_progress") buttons.push(ui.btn("Block", { small: true, danger: true, act: "prj-task-block", arg: t.id }));
        if (t.status === "complete") buttons.push(ui.btn("Reopen", { small: true, act: "prj-task-reopen", arg: t.id }));
        buttons.push(ui.btn("Edit", { small: true, act: "prj-task-edit", arg: t.id }));
        buttons.push(ui.btn("✕", { small: true, danger: true, act: "prj-task-del", arg: t.id }));
      }
      const deps = (t.dependsOn || []).map((id) => { const h = P.findTask(project, id); return h ? h.task.name : null; }).filter(Boolean);
      return {
        name: ui.esc(t.name || "—") + (deps.length ? '<span class="erp-sub">after ' + ui.esc(deps.join(", ")) + "</span>" : "") +
          (t.ticketId != null ? '<span class="erp-sub">ticket #' + ui.esc(t.ticketId) + "</span>" : ""),
        status: ui.badge(P.taskStatusLabel(t.status), P.taskStatusTone(t.status)),
        owner: ui.esc(memberName(members, t.ownerId)),
        dates: ui.esc(t.startDate || "—") + " → " + ui.esc(t.dueDate || "open"),
        est: ui.fmt(num(t.estimatedHours), 1),
        act: ui.fmt(round2(num(a.minutes) / 60), 1),
        actions: buttons.join(" "),
      };
    });
    const body =
      ui.table([
        { key: "name", label: "Task" },
        { key: "status", label: "Status" },
        { key: "owner", label: "Owner" },
        { key: "dates", label: "Dates" },
        { key: "est", label: "Est h", align: "right" },
        { key: "act", label: "Act h", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No tasks in this phase yet." }) +
      (canEdit ? '<div class="erp-proj-add-row">' + ui.btn("Add task", { small: true, act: "prj-task-new", arg: ph.id }) + "</div>" : "");
    const title = ui.esc(ph.name || "Phase") + " " + ui.badge(P.phaseStatusLabel(ph.status), P.phaseStatusTone(ph.status));
    return '<section class="erp-card erp-proj-phase"><header class="erp-card-head"><h3>' + title +
      '<span class="erp-sub">' + ui.esc(ph.progress || 0) + "% · " + (ph.tasks || []).length + " tasks" +
      (num(ph.estimatedHours) ? " · " + ui.fmt(num(ph.estimatedHours), 1) + "h" : "") + "</span></h3>" +
      '<div class="erp-card-actions">' + acts.join(" ") + "</div></header>" +
      '<div class="erp-card-body">' + body + "</div></section>";
  }

  /* ── templates tab ── */

  async function renderTemplates(panel, pid) {
    const state = st(panel);
    if (state.templateId) return renderTemplateDetail(panel, pid, state.templateId);
    const canEdit = ERP.security.can("projects.edit");
    const list = await P.templates(pid);
    const rows = list.map((t) => {
      const taskCount = (t.phases || []).reduce((n, ph) => n + (ph.tasks || []).length, 0);
      const est = num(t.estimatedHours) || (t.phases || []).reduce((n, ph) => n + num(ph.estimatedHours), 0);
      const acts = [ui.btn("Open", { small: true, act: "tpl-open", arg: t.id })];
      if (canEdit) { acts.push(ui.btn("Use", { small: true, primary: true, act: "tpl-use", arg: t.id })); acts.push(ui.btn("Delete", { small: true, danger: true, act: "tpl-del", arg: t.id })); }
      return {
        name: ui.esc(t.name) + (t.description ? '<span class="erp-sub">' + ui.esc(t.description) + "</span>" : ""),
        phases: String((t.phases || []).length),
        tasks: String(taskCount),
        method: ui.esc(P.billingLabel(t.billingMethod)),
        hours: ui.fmt(est, 1),
        actions: acts.join(" "),
      };
    });
    panel.innerHTML =
      ui.alert("Templates are reusable work breakdowns. A template task can raise a ticket when the template is used, so onboarding a client creates the project and the tickets it needs.", "info") +
      '<div class="erp-db-toolbar">' +
        '<span class="erp-db-hint">' + list.length + " template(s)</span>" +
        (canEdit ? ui.btn("New template", { primary: true, act: "tpl-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "name", label: "Template" },
        { key: "phases", label: "Phases", align: "right" },
        { key: "tasks", label: "Tasks", align: "right" },
        { key: "method", label: "Billing" },
        { key: "hours", label: "Est h", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No templates yet." });

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "tpl-open") { state.templateId = arg; return renderTab("templates"); }
      if (act === "tpl-new") return openTemplateModal(pid, null, () => renderTab("templates"));
      if (act === "tpl-use") return openInstantiateModal(pid, await P.getTemplate(pid, arg), () => renderTab("templates"));
      if (act === "tpl-del") {
        if (!(await ui.confirm({ title: "Delete this template?", danger: true, okLabel: "Delete" }))) return;
        await P.removeTemplate(pid, arg); ERP.toast("Template deleted.", "success"); return renderTab("templates");
      }
    });
  }

  async function renderTemplateDetail(panel, pid, templateId) {
    const state = st(panel);
    const tpl = await P.getTemplate(pid, templateId);
    if (!tpl) { state.templateId = ""; return renderTemplates(panel, pid); }
    const canEdit = ERP.security.can("projects.edit");
    const phases = (tpl.phases || []).map((ph) => {
      const acts = canEdit ? ui.btn("Edit", { small: true, act: "tplp-edit", arg: ph.id }) + " " + ui.btn("Remove", { small: true, danger: true, act: "tplp-del", arg: ph.id }) : "";
      const rows = (ph.tasks || []).map((t) => ({
        name: ui.esc(t.name || "—") + (t.ticketTemplateId ? '<span class="erp-sub">raises a ticket</span>' : ""),
        hours: ui.fmt(num(t.estimatedHours), 1),
        actions: canEdit ? ui.btn("Edit", { small: true, act: "tplt-edit", arg: t.id }) + " " + ui.btn("✕", { small: true, danger: true, act: "tplt-del", arg: t.id }) : "",
      }));
      return '<section class="erp-card erp-proj-phase"><header class="erp-card-head"><h3>' + ui.esc(ph.name || "Phase") +
        '<span class="erp-sub">' + (ph.tasks || []).length + " tasks" + (num(ph.estimatedHours) ? " · " + ui.fmt(num(ph.estimatedHours), 1) + "h" : "") + "</span></h3>" +
        '<div class="erp-card-actions">' + acts + "</div></header>" +
        '<div class="erp-card-body">' + ui.table([
          { key: "name", label: "Task" }, { key: "hours", label: "Est h", align: "right" }, { key: "actions", label: "", align: "right" },
        ], rows, { emptyText: "No tasks yet." }) +
        (canEdit ? '<div class="erp-proj-add-row">' + ui.btn("Add task", { small: true, act: "tplt-new", arg: ph.id }) + "</div>" : "") +
        "</div></section>";
    }).join("") || ui.alert("No phases yet. Add one to build the breakdown.", "info");

    panel.innerHTML =
      '<div class="erp-db-toolbar">' +
        ui.btn("← All templates", { small: true, act: "tpl-back" }) +
        '<span class="erp-db-hint">' + ui.esc(P.billingLabel(tpl.billingMethod)) + (tpl.fixedFee ? " · " + maskedMoney(num(tpl.fixedFee)) : "") + (num(tpl.estimatedHours) ? " · " + ui.fmt(num(tpl.estimatedHours), 1) + "h" : "") + "</span>" +
        (canEdit ? ui.btn("Edit", { small: true, act: "tpl-edit", arg: tpl.id }) + " " + ui.btn("Use template", { small: true, primary: true, act: "tpl-use", arg: tpl.id }) : "") +
      "</div>" +
      (tpl.description ? '<p class="erp-proj-desc">' + ui.esc(tpl.description) + "</p>" : "") +
      '<div class="erp-proj-section-head"><h3>Work breakdown</h3>' + (canEdit ? ui.btn("Add phase", { small: true, primary: true, act: "tplp-new" }) : "") + "</div>" +
      '<div class="erp-proj-phases">' + phases + "</div>";

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      const refresh = () => renderTab("templates");
      if (act === "tpl-back") { state.templateId = ""; return renderTab("templates"); }
      if (act === "tpl-edit") return openTemplateModal(pid, tpl, refresh);
      if (act === "tpl-use") return openInstantiateModal(pid, tpl, refresh);
      if (act === "tplp-new") return openPhaseModal(pid, "template", tpl, null, refresh);
      if (act === "tplp-edit") return openPhaseModal(pid, "template", tpl, (tpl.phases || []).find((x) => String(x.id) === String(arg)), refresh);
      if (act === "tplp-del") { if (!(await ui.confirm({ title: "Remove this phase?", danger: true, okLabel: "Remove" }))) return; await P.removeTemplatePhase(pid, tpl.id, arg); return refresh(); }
      if (act === "tplt-new") return openTaskModal(pid, "template", tpl, arg, null, refresh);
      if (act === "tplt-edit") { let hit = null, phid = null; (tpl.phases || []).forEach((ph) => (ph.tasks || []).forEach((x) => { if (String(x.id) === String(arg)) { hit = x; phid = ph.id; } })); return openTaskModal(pid, "template", tpl, phid, hit, refresh); }
      if (act === "tplt-del") { await P.removeTemplateTask(pid, tpl.id, arg); return refresh(); }
    });
  }

  /* ── schedule tab ── */

  async function renderSchedule(panel, pid) {
    const state = st(panel);
    const [companies, members] = await Promise.all([clientOptions(), membersList()]);
    const projects = await P.list(pid, { companyId: state.companyId, statusIn: state.showCompleted ? ["draft", "active", "on_hold", "completed"] : ["draft", "active", "on_hold"] });
    const rows = [];
    const today = ui.today();
    const in7 = ui.addDays(today, 7);
    let open = 0, overdue = 0, unassigned = 0, dueSoon = 0, remaining = 0;
    const workload = {};
    for (const pr of projects) {
      for (const h of P.tasksOf(pr)) {
        const t = h.task;
        if (state.ownerId && String(t.ownerId) !== String(state.ownerId)) continue;
        if (t.status === "complete" && !state.showCompleted) continue;
        if (t.status !== "complete") {
          open += 1; remaining = round2(remaining + num(t.estimatedHours));
          if (t.dueDate && String(t.dueDate) < today) overdue += 1;
          if (t.dueDate && String(t.dueDate) >= today && String(t.dueDate) <= in7) dueSoon += 1;
          if (t.ownerId == null || t.ownerId === "") unassigned += 1;
          const ok = String(t.ownerId || "unassigned");
          workload[ok] = workload[ok] || { owner: t.ownerId, tasks: 0, hours: 0, overdue: 0 };
          workload[ok].tasks += 1; workload[ok].hours = round2(workload[ok].hours + num(t.estimatedHours));
          if (t.dueDate && String(t.dueDate) < today) workload[ok].overdue += 1;
        }
        const late = t.status !== "complete" && t.dueDate && String(t.dueDate) < today;
        rows.push({
          project: ui.esc(pr.number || "") + " " + ui.esc(pr.name),
          phase: ui.esc(h.phase.name || ""),
          task: ui.esc(t.name || "—"),
          status: ui.badge(P.taskStatusLabel(t.status), P.taskStatusTone(t.status)),
          owner: ui.esc(memberName(members, t.ownerId)),
          due: (late ? ui.badge(t.dueDate, "danger") : ui.esc(t.dueDate || "—")) + (t.status !== "complete" && t.dueDate && String(t.dueDate) >= today && String(t.dueDate) <= in7 ? " " + ui.badge("soon", "warn") : ""),
          hours: ui.fmt(num(t.estimatedHours), 1),
          actions: ui.btn("Open", { small: true, act: "sch-open", arg: pr.id }) +
            (ERP.security.can("projects.edit") && t.status !== "complete" ? " " + ui.btn("Done", { small: true, primary: true, act: "sch-done", arg: String(pr.id) + "~" + String(t.id) }) : ""),
        });
      }
    }
    rows.sort((a, b) => String(a.due).localeCompare(String(b.due)));

    const wlRows = Object.keys(workload).map((k) => ({
      owner: ui.esc(memberName(members, workload[k].owner)),
      tasks: String(workload[k].tasks),
      hours: ui.fmt(workload[k].hours, 1),
      overdue: workload[k].overdue ? ui.badge(String(workload[k].overdue), "danger") : "—",
    }));

    panel.innerHTML =
      ui.summary([
        { label: "Open tasks", value: String(open) },
        { label: "Overdue", value: String(overdue) },
        { label: "Due ≤7 days", value: String(dueSoon) },
        { label: "Unassigned", value: String(unassigned) },
        { label: "Remaining hours", value: ui.fmt(remaining, 1) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("sch-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.select("sch-owner", "Owner", [{ value: "", label: "Anyone" }].concat(members.map((m) => ({ value: m.id, label: m.name }))), state.ownerId) +
        ui.select("sch-done", "Show completed", [{ value: "", label: "Open work only" }, { value: "yes", label: "Include completed" }], state.showCompleted ? "yes" : "") +
      "</div>" +
      ui.table([
        { key: "project", label: "Project" },
        { key: "phase", label: "Phase" },
        { key: "task", label: "Task" },
        { key: "status", label: "Status" },
        { key: "owner", label: "Owner" },
        { key: "due", label: "Due" },
        { key: "hours", label: "Est h", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No scheduled tasks match." }) +
      ui.card("Workload by owner", ui.table([
        { key: "owner", label: "Owner" }, { key: "tasks", label: "Open tasks", align: "right" },
        { key: "hours", label: "Remaining h", align: "right" }, { key: "overdue", label: "Overdue" },
      ], wlRows, { emptyText: "No open work." }));

    const bindSel = (sel, key, cast) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = cast ? cast(el.value) : el.value; renderTab("schedule"); }); };
    bindSel('[name="sch-client"]', "companyId");
    bindSel('[name="sch-owner"]', "ownerId");
    bindSel('[name="sch-done"]', "showCompleted", (v) => v === "yes");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "sch-open") { state.projectId = arg; state.tab = "projects"; ui.showTab(currentHost, "projects"); return renderTab("projects"); }
      if (act === "sch-done") {
        const parts = String(arg).split("~");
        await P.setTaskStatus(pid, parts[0], parts[1], "complete");
        ERP.toast("Task completed.", "success"); return renderTab("schedule");
      }
    });
  }

  /* ── budget & profitability tab ── */

  async function renderBudget(panel, pid) {
    const state = st(panel);
    const [companies] = await Promise.all([clientOptions()]);
    const prof = await P.profitability(pid, { companyId: state.companyId });
    const single = state.projectId && state.projectId !== "all" ? prof.rows.find((r) => String(r.project.id) === String(state.projectId)) : null;

    const rows = prof.rows.map((r) => {
      const b = { estimate: r.estimate, actual: r.actual, progress: num(r.project.progress) / 100, hoursPct: r.estimate.hours > 0 ? Math.round(r.actual.hours / r.estimate.hours * 100) : null, costPct: r.estimate.cost > 0 ? Math.round(r.actual.cost / r.estimate.cost * 100) : null };
      const flags = [];
      if (b.costPct != null && b.costPct > 100) flags.push("over");
      if (b.hoursPct != null && b.hoursPct > 100) flags.push("hours");
      const acts = ui.btn("Open", { small: true, act: "bud-open", arg: r.project.id });
      return {
        project: ui.esc(r.project.number || "") + " " + ui.esc(r.project.name) + (flags.length ? " " + flags.map((f) => ui.badge(f, "danger")).join(" ") : ""),
        client: ui.esc(r.project.__companyName || ""),
        status: ui.badge(P.statusLabel(r.project.status), P.statusTone(r.project.status)),
        progress: r.project.progress + "%",
        estHours: ui.fmt(r.estimate.hours, 1),
        actHours: ui.fmt(r.actual.hours, 1),
        hoursPct: b.hoursPct == null ? "—" : b.hoursPct + "%",
        estCost: maskedMoney(r.estimate.cost),
        actCost: maskedMoney(r.actual.cost),
        costPct: b.costPct == null ? "—" : b.costPct + "%",
        revenue: maskedMoney(r.revenue),
        margin: maskedMoney(r.margin) + (r.marginPct != null ? '<span class="erp-sub">' + r.marginPct + "%</span>" : ""),
        actions: acts,
      };
    });

    const phaseRows = single ? (single.project.phases || []).map((ph) => {
      const a = (single.actual.byPhase && single.actual.byPhase[String(ph.id)]) || { minutes: 0, cost: 0 };
      return {
        phase: ui.esc(ph.name || ""),
        status: ui.badge(P.phaseStatusLabel(ph.status), P.phaseStatusTone(ph.status)),
        est: ui.fmt(num(ph.estimatedHours), 1),
        act: ui.fmt(round2(num(a.minutes) / 60), 1),
        cost: maskedMoney(a.cost),
      };
    }) : null;

    panel.innerHTML =
      ui.summary([
        { label: "Projects", value: String(prof.rows.length) },
        { label: "Planned value", value: maskedMoney(prof.totals.budget) },
        { label: "Invoiced (draft)", value: maskedMoney(prof.totals.draft) },
        { label: "Invoiced (posted)", value: maskedMoney(prof.totals.billed) },
        { label: "Cost to date", value: maskedMoney(prof.totals.cost) },
        { label: "Margin", value: maskedMoney(prof.totals.margin) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("bud-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.select("bud-project", "Focus", [{ value: "all", label: "All projects" }].concat(prof.rows.map((r) => ({ value: r.project.id, label: (r.project.number || "") + " " + r.project.name }))), state.projectId || "all") +
      "</div>" +
      (single ? ui.card("Per-phase budget — " + single.project.name, ui.table([
        { key: "phase", label: "Phase" }, { key: "status", label: "Status" },
        { key: "est", label: "Est h", align: "right" }, { key: "act", label: "Act h", align: "right" }, { key: "cost", label: "Cost", align: "right" },
      ], phaseRows, { emptyText: "No phases." })) : "") +
      ui.table([
        { key: "project", label: "Project" },
        { key: "client", label: "Client" },
        { key: "status", label: "Status" },
        { key: "progress", label: "Done", align: "right" },
        { key: "estHours", label: "Est h", align: "right" },
        { key: "actHours", label: "Act h", align: "right" },
        { key: "hoursPct", label: "H %", align: "right" },
        { key: "estCost", label: "Est cost", align: "right" },
        { key: "actCost", label: "Act cost", align: "right" },
        { key: "costPct", label: "C %", align: "right" },
        { key: "revenue", label: "Revenue", align: "right" },
        { key: "margin", label: "Margin", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No projects." });

    const bindSel = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("budget"); }); };
    bindSel('[name="bud-client"]', "companyId");
    bindSel('[name="bud-project"]', "projectId");
    ui.bind(panel, "click", "[data-act]", (el, e, act, arg) => {
      if (act === "bud-open") { state.projectId = arg; state.tab = "projects"; ui.showTab(currentHost, "projects"); return renderTab("projects"); }
    });
  }

  /* ── milestone billing tab ── */

  async function renderBilling(panel, pid) {
    const state = st(panel);
    const [companies] = await Promise.all([clientOptions()]);
    const projects = await P.list(pid, { companyId: state.companyId });
    const canBill = ERP.security.can("projects.bill");
    const rows = [];
    let readyVal = 0, invoicedVal = 0, pendingVal = 0;
    for (const pr of projects) {
      for (const m of pr.milestones || []) {
        if (m.status === "ready") readyVal = round2(readyVal + num(m.amount));
        else if (m.status === "invoiced") invoicedVal = round2(invoicedVal + num(m.amount));
        else if (m.status === "pending") pendingVal = round2(pendingVal + num(m.amount));
        const acts = [];
        if (canBill && m.status === "pending") acts.push(ui.btn("Release", { small: true, primary: true, act: "bil-release", arg: String(pr.id) + "~" + String(m.id) }));
        if (canBill && m.status === "ready") acts.push(ui.btn("Withdraw", { small: true, act: "bil-withdraw", arg: String(pr.id) + "~" + String(m.id) }));
        if (canBill && m.status !== "invoiced") acts.push(ui.btn("Void", { small: true, danger: true, act: "bil-void", arg: String(pr.id) + "~" + String(m.id) }));
        rows.push({
          project: ui.esc(pr.number || "") + " " + ui.esc(pr.name),
          client: ui.esc(pr.__companyName || ""),
          milestone: ui.esc(m.name || "—"),
          amount: maskedMoney(num(m.amount)),
          due: ui.esc(m.dueDate || "—"),
          status: ui.badge(P.milestoneStatusLabel(m.status), P.milestoneStatusTone(m.status)) + (m.invoiceId != null ? '<span class="erp-sub">inv #' + ui.esc(m.invoiceId) + "</span>" : ""),
          actions: acts.join(" "),
        });
      }
    }
    panel.innerHTML =
      ui.summary([
        { label: "Ready to bill", value: maskedMoney(readyVal) },
        { label: "Pending", value: maskedMoney(pendingVal) },
        { label: "Invoiced", value: maskedMoney(invoicedVal) },
      ]) +
      ui.alert("Released milestones are picked up by the Billing station's invoice assembly as project lines. Posting the invoice marks them invoiced, so a re-run never bills them twice.", "info") +
      '<div class="erp-db-toolbar">' +
        ui.select("bil-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        '<span class="erp-db-hint">' + (canBill ? "Release a milestone to make it billable" : "Read-only for your role") + "</span>" +
        (canBill && projects.length ? ui.btn("Add milestone", { small: true, act: "bil-new" }) : "") +
        ui.btn("Open billing →", { small: true, act: "bil-go" }) +
      "</div>" +
      ui.table([
        { key: "project", label: "Project" },
        { key: "client", label: "Client" },
        { key: "milestone", label: "Milestone" },
        { key: "amount", label: "Amount", align: "right" },
        { key: "due", label: "Due" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No milestones for this client." });

    const bindSel = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("billing"); }); };
    bindSel('[name="bil-client"]', "companyId");
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "bil-go") { if (ERP.navigate) return ERP.navigate("billing"); window.location.hash = "#/billing"; return; }
      if (act === "bil-new") return openMilestonePickerModal(pid, projects, () => renderTab("billing"));
      const parts = String(arg).split("~");
      if (act === "bil-release") { const r = await P.releaseMilestone(pid, parts[0], parts[1]); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Milestone released.", "success"); return renderTab("billing"); }
      if (act === "bil-withdraw") { await P.updateMilestone(pid, parts[0], parts[1], { status: "pending" }); return renderTab("billing"); }
      if (act === "bil-void") { const r = await P.voidMilestone(pid, parts[0], parts[1]); if (r.error) return ERP.toast(r.message || r.error, "error"); return renderTab("billing"); }
    });
  }

  /* ═══════════════════════════ modals ═══════════════════════════ */

  async function openProjectModal(pid, project, refresh) {
    if (!ERP.security.enforce("projects.edit", { companyId: project ? project.companyId : null })) return;
    const [companies, members, types] = await Promise.all([clientOptions(), membersList(), ERP.taxonomy.optionList(pid, "projectType")]);
    const isNew = !(project && project.id != null);
    const p = project || P.newProject({ startDate: ui.today() });
    const templates = isNew ? await P.templates(pid) : [];
    const fields =
      ui.select("companyId", "Client", [{ value: "", label: "— choose a client —" }].concat(companies), p.companyId) +
      (isNew && templates.length ? ui.select("templateId", "Start from template", [{ value: "", label: "— blank project —" }].concat(templates.map((t) => ({ value: t.id, label: t.name + " (" + (t.phases || []).length + " phases)" }))), p.templateId || "") : "") +
      ui.text("name", "Project name", p.name, "e.g. Acme — network refresh") +
      '<div class="erp-form-row">' +
        ui.select("type", "Type", [{ value: "", label: "— none —" }].concat(types), p.type) +
        ui.select("billingMethod", "Billing method", P.BILLING_METHODS.map((m) => ({ value: m.id, label: m.label })), p.billingMethod) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("ownerId", "Owner", [{ value: "", label: "— unassigned —" }].concat(members.map((m) => ({ value: m.id, label: m.name }))), p.ownerId) +
        ui.select("managerId", "Manager", [{ value: "", label: "— none —" }].concat(members.map((m) => ({ value: m.id, label: m.name }))), p.managerId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("startDate", "Start", p.startDate || ui.today()) +
        ui.dateInput("dueDate", "Due", p.dueDate || "") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("fixedFee", "Fixed fee", p.fixedFee || "", { min: 0, step: 0.01 }) +
        ui.number("estimatedHours", "Estimated hours", p.estimatedHours || "", { min: 0, step: 0.25 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("hourlyRate", "Plan bill rate / h", p.hourlyRate || "", { min: 0, step: 0.01 }) +
        ui.number("hourlyCost", "Plan cost rate / h", p.hourlyCost || "", { min: 0, step: 0.01 }) +
      "</div>" +
      ui.textarea("description", "Description", p.description || "", 2) +
      ui.textarea("notes", "Notes", p.notes || "", 2);
    const modal = ui.modal({
      title: isNew ? "New project" : "Edit project", size: "lg", body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "pm-cancel" }) + " " + ui.btn(isNew ? "Create project" : "Save", { small: true, primary: true, act: "pm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["companyId", "templateId", "name", "type", "billingMethod", "ownerId", "managerId", "startDate", "dueDate", "fixedFee", "estimatedHours", "hourlyRate", "hourlyCost", "description", "notes"]);
      if (!v.companyId) { ERP.toast("Choose a client.", "error"); return; }
      if (!v.name && !v.templateId) { ERP.toast("Give the project a name.", "error"); return; }
      btn.disabled = true;
      const payload = Object.assign({}, project || {}, {
        companyId: v.companyId, name: v.name, type: v.type, billingMethod: v.billingMethod,
        ownerId: v.ownerId === "" ? null : v.ownerId, managerId: v.managerId === "" ? null : v.managerId,
        startDate: v.startDate, dueDate: v.dueDate,
        fixedFee: v.fixedFee, estimatedHours: v.estimatedHours, hourlyRate: v.hourlyRate, hourlyCost: v.hourlyCost,
        description: v.description, notes: v.notes,
      });
      if (isNew && v.templateId) payload.templateId = v.templateId;
      if (isNew && v.templateId && !payload.name) payload.name = (await P.getTemplate(pid, v.templateId) || {}).name || "Project";
      if (project && project.id != null) payload.id = project.id;
      const res = await P.save(pid, payload);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(res.created ? "Project created." : "Project saved.", "success"); refresh();
    };
  }

  async function openInstantiateModal(pid, tpl, refresh) {
    if (!tpl) return;
    if (!ERP.security.enforce("projects.edit")) return;
    const companies = await clientOptions();
    const fields = ui.select("companyId", "Client", [{ value: "", label: "— choose a client —" }].concat(companies), "") +
      ui.text("name", "Project name", tpl.name, "") +
      ui.dateInput("startDate", "Start", ui.today()) +
      ui.dateInput("dueDate", "Due", "");
    const modal = ui.modal({
      title: "Use template — " + tpl.name, size: "lg", body: ui.form(fields) + '<p class="erp-modal-note">' + (tpl.phases || []).length + " phase(s), " + (tpl.phases || []).reduce((n, ph) => n + (ph.tasks || []).length, 0) + " task(s). Template tasks that carry a ticket reference will raise those tickets.</p>",
      foot: ui.btn("Cancel", { small: true, act: "im-cancel" }) + " " + ui.btn("Create project", { small: true, primary: true, act: "im-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=im-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=im-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["companyId", "name", "startDate", "dueDate"]);
      if (!v.companyId) { ERP.toast("Choose a client.", "error"); return; }
      btn.disabled = true;
      const res = await P.instantiate(pid, { templateId: tpl.id, companyId: v.companyId, name: v.name, startDate: v.startDate, dueDate: v.dueDate });
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Project created from template.", "success"); refresh();
    };
  }

  async function openTemplateModal(pid, tpl, refresh) {
    if (!ERP.security.enforce("projects.edit")) return;
    const [types] = await Promise.all([ERP.taxonomy.optionList(pid, "projectType")]);
    const t = tpl || P.newTemplate();
    const fields =
      ui.text("name", "Template name", t.name, "e.g. New client onboarding") +
      '<div class="erp-form-row">' +
        ui.select("type", "Type", [{ value: "", label: "— none —" }].concat(types), t.type) +
        ui.select("billingMethod", "Default billing", P.BILLING_METHODS.map((m) => ({ value: m.id, label: m.label })), t.billingMethod) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("fixedFee", "Fixed fee", t.fixedFee || "", { min: 0, step: 0.01 }) +
        ui.number("estimatedHours", "Estimated hours", t.estimatedHours || "", { min: 0, step: 0.25 }) +
        ui.number("hourlyRate", "Plan bill rate / h", t.hourlyRate || "", { min: 0, step: 0.01 }) +
      "</div>" +
      ui.textarea("description", "Description", t.description || "", 2);
    const modal = ui.modal({
      title: tpl ? "Edit template" : "New template", size: "lg", body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "tm-cancel" }) + " " + ui.btn(tpl ? "Save" : "Create", { small: true, primary: true, act: "tm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=tm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=tm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "type", "billingMethod", "fixedFee", "estimatedHours", "hourlyRate", "description"]);
      btn.disabled = true;
      const payload = Object.assign({}, tpl || {}, v);
      if (tpl && tpl.id != null) payload.id = tpl.id;
      const res = await P.saveTemplate(pid, payload);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(tpl ? "Template saved." : "Template created.", "success"); refresh();
    };
  }

  async function openPhaseModal(pid, kind, container, phase, refresh) {
    if (!ERP.security.enforce("projects.edit", { companyId: kind === "project" ? container.companyId : null })) return;
    const ph = phase || (kind === "project" ? P.newPhase() : P.newTemplatePhase());
    const fields =
      ui.text("name", "Phase name", ph.name, "e.g. Discovery & audit") +
      ui.textarea("description", "Description", ph.description || "", 2) +
      '<div class="erp-form-row">' +
        ui.number("estimatedHours", "Estimated hours", ph.estimatedHours || "", { min: 0, step: 0.25 }) +
        ui.check("billable", "Billable phase", ph.billable !== false) +
      "</div>";
    const modal = ui.modal({
      title: phase ? "Edit phase" : "Add phase", size: "lg", body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "pm-cancel" }) + " " + ui.btn(phase ? "Save" : "Add phase", { small: true, primary: true, act: "pm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "description", "estimatedHours", "billable"]);
      if (!v.name) { ERP.toast("Give the phase a name.", "error"); return; }
      btn.disabled = true;
      const res = kind === "project"
        ? (phase ? await P.updatePhase(pid, container.id, phase.id, v) : await P.addPhase(pid, container.id, v))
        : (phase ? await P.updateTemplatePhase(pid, container.id, phase.id, v) : await P.addTemplatePhase(pid, container.id, v));
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(phase ? "Phase saved." : "Phase added.", "success"); refresh();
    };
  }

  async function openTaskModal(pid, kind, container, phaseId, task, refresh) {
    if (!ERP.security.enforce("projects.edit", { companyId: kind === "project" ? container.companyId : null })) return;
    const members = await membersList();
    const t = task || (kind === "project" ? P.newTask() : P.newTemplateTask());
    const dependOptions = kind === "project"
      ? P.tasksOf(container).filter((h) => String(h.task.id) !== String(t.id)).map((h) => ({ value: h.task.id, label: h.task.name }))
      : [];
    const ticketTemplates = kind === "template" && ERP.templates ? await ERP.templates.templates(pid) : [];
    const fields =
      ui.text("name", "Task name", t.name, "What needs doing") +
      ui.textarea("description", "Description", t.description || "", 2) +
      '<div class="erp-form-row">' +
        ui.select("status", "Status", P.WORK_STATUSES.map((s) => ({ value: s.id, label: s.label })), t.status) +
        ui.number("estimatedHours", "Estimated hours", t.estimatedHours || "", { min: 0, step: 0.25 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("ownerId", "Owner", [{ value: "", label: "— unassigned —" }].concat(members.map((m) => ({ value: m.id, label: m.name }))), t.ownerId) +
        ui.select("dependsOn", "Depends on", [{ value: "", label: "— nothing —" }].concat(dependOptions), (t.dependsOn || [])[0] || "") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("startDate", "Start", t.startDate || "") +
        ui.dateInput("dueDate", "Due", t.dueDate || "") +
      "</div>" +
      (kind === "template" && ticketTemplates.length ? ui.select("ticketTemplateId", "Raise a ticket from", [{ value: "", label: "— none —" }].concat(ticketTemplates.map((x) => ({ value: x.id, label: x.name }))), t.ticketTemplateId) : "");
    const modal = ui.modal({
      title: task ? "Edit task" : "Add task", size: "lg", body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "tm-cancel" }) + " " + ui.btn(task ? "Save" : "Add task", { small: true, primary: true, act: "tm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=tm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=tm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "description", "status", "estimatedHours", "ownerId", "dependsOn", "startDate", "dueDate", "ticketTemplateId"]);
      if (!v.name) { ERP.toast("Give the task a name.", "error"); return; }
      btn.disabled = true;
      const payload = {
        name: v.name, description: v.description, status: v.status, estimatedHours: v.estimatedHours,
        ownerId: v.ownerId === "" ? null : v.ownerId, startDate: v.startDate, dueDate: v.dueDate,
        dependsOn: v.dependsOn ? [v.dependsOn] : [],
      };
      let res;
      if (kind === "project") {
        res = task ? await P.updateTask(pid, container.id, task.id, payload) : await P.addTask(pid, container.id, phaseId, payload);
      } else {
        payload.ticketTemplateId = v.ticketTemplateId || null;
        res = task ? await P.updateTemplateTask(pid, container.id, task.id, payload) : await P.addTemplateTask(pid, container.id, phaseId, payload);
      }
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(task ? "Task saved." : "Task added.", "success"); refresh();
    };
  }

  async function openMilestoneModal(pid, kind, project, milestone, refresh) {
    if (!ERP.security.enforce("projects.edit", { companyId: project ? project.companyId : null })) return;
    const m = milestone || P.newMilestone();
    const phaseOptions = (project.phases || []).map((ph) => ({ value: ph.id, label: ph.name }));
    const fields =
      ui.text("name", "Milestone name", m.name, "e.g. Discovery sign-off") +
      '<div class="erp-form-row">' +
        ui.number("amount", "Amount", m.amount || "", { min: 0, step: 0.01 }) +
        ui.dateInput("dueDate", "Due", m.dueDate || ui.today()) +
      "</div>" +
      ui.select("phaseId", "Releases when phase completes", [{ value: "", label: "— manual release —" }].concat(phaseOptions), m.phaseId) +
      ui.textarea("note", "Note", m.note || "", 2);
    const modal = ui.modal({
      title: milestone ? "Edit milestone" : "Add milestone", size: "lg", body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "mm-cancel" }) + " " + ui.btn(milestone ? "Save" : "Add milestone", { small: true, primary: true, act: "mm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=mm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=mm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "amount", "dueDate", "phaseId", "note"]);
      if (!v.name) { ERP.toast("Give the milestone a name.", "error"); return; }
      btn.disabled = true;
      const payload = { name: v.name, amount: v.amount, dueDate: v.dueDate, phaseId: v.phaseId === "" ? null : v.phaseId, note: v.note };
      const res = milestone ? await P.updateMilestone(pid, project.id, milestone.id, payload) : await P.addMilestone(pid, project.id, payload);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(milestone ? "Milestone saved." : "Milestone added.", "success"); refresh();
    };
  }

  async function openMilestonePickerModal(pid, projects, refresh) {
    if (!ERP.security.enforce("projects.bill")) return;
    const options = projects.map((p) => ({ value: p.id, label: (p.number || "") + " " + p.name }));
    const modal = ui.modal({
      title: "Add milestone", size: "lg",
      body: ui.form(ui.select("projectId", "Project", options, options.length ? options[0].value : "") + ui.text("name", "Milestone name", "", "") + ui.number("amount", "Amount", "", { min: 0, step: 0.01 }) + ui.dateInput("dueDate", "Due", ui.today())),
      foot: ui.btn("Cancel", { small: true, act: "mp-cancel" }) + " " + ui.btn("Add milestone", { small: true, primary: true, act: "mp-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=mp-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=mp-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["projectId", "name", "amount", "dueDate"]);
      if (!v.projectId || !v.name) { ERP.toast("Choose a project and name the milestone.", "error"); return; }
      btn.disabled = true;
      const res = await P.addMilestone(pid, v.projectId, { name: v.name, amount: v.amount, dueDate: v.dueDate });
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Milestone added.", "success"); refresh();
    };
  }

  async function openReasonModal(title, label, value, onConfirm, danger) {
    const modal = ui.modal({
      title: title, body: ui.form(ui.text("reason", label, value || "", "")),
      foot: ui.btn("Cancel", { small: true, act: "rm-cancel" }) + " " + ui.btn("Confirm", { small: true, primary: !danger, danger: !!danger, act: "rm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=rm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=rm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["reason"]);
      btn.disabled = true; ui.closeModal();
      await onConfirm(v.reason || "");
    };
  }

  /* ── station shell ── */

  P.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "projects", title: "Projects", phase: "Phase 7 · Projects",
        message: "Create a service provider and a client company first — then deliver projects here.",
      });
      return;
    }
    try { await P.seedTemplates(pid); } catch (e) {}
    host.__proj = host.__proj || blankState();
    currentHost = host;

    const defs = [
      { id: "projects", label: "Projects" },
      { id: "templates", label: "Templates" },
      { id: "schedule", label: "Schedule" },
      { id: "budget", label: "Budget & profitability" },
      { id: "billing", label: "Milestone billing" },
    ];
    const active = defs.find((d) => d.id === host.__proj.tab) ? host.__proj.tab : "projects";

    host.innerHTML = ui.pageHead("Projects", "Templates, phases & tasks, scheduling, budgets and milestone billing.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__proj.tab = b.getAttribute("data-tab");
      await renderTab(host.__proj.tab);
    }));
    await renderTab(active);
  };
})();
