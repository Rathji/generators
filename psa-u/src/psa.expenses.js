/* ============================================================
   PSA-U — expenses (Phase 4 · Task 21)
   An expense is money a member spent on the provider's behalf:
   travel, parts, subscriptions, shipping. It is recorded against
   the client and ticket it served (or left internal), classified
   by an expense category, and carried with a receipt so the
   charge is defensible.

   Two amounts matter once an expense is approved:

     • what it COST        — the amount on the receipt;
     • what it BILLS for   — the cost plus a markup (percent or
                             flat), which is what a client invoices.

   Lifecycle: draft → submitted → approved → reimbursed, with a
   rejected branch that returns the expense for correction, and a
   locked state once it is safe from further change. Approval and
   reimbursement are enforced permissions (`expenses.approve`), so
   a technician can file expenses but not approve their own.

   Storage: expenses live in the active provider's document
   (kind "expense") alongside time, so the approval queue and the
   client roll-up are a single read across the whole practice.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const X = (ERP.expenses = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("expenses requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  async function put(pid, rec) {
    if (rec.id == null || !isFinite(rec.id)) rec.id = ten().nextId(await ten().records("provider", pid));
    return ten().upsert("provider", pid, rec);
  }

  X.STATUSES = [
    { id: "draft", label: "Draft", tone: "muted" },
    { id: "submitted", label: "Submitted", tone: "info" },
    { id: "approved", label: "Approved", tone: "success" },
    { id: "rejected", label: "Rejected", tone: "danger" },
    { id: "reimbursed", label: "Reimbursed", tone: "success" },
    { id: "locked", label: "Locked", tone: "muted" },
  ];
  X.statusLabel = (id) => (X.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  X.statusTone = (id) => (X.STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  X.MARKUPS = [
    { id: "none", label: "No markup" },
    { id: "percent", label: "Percent markup" },
    { id: "flat", label: "Flat markup" },
  ];
  X.markupLabel = (id) => (X.MARKUPS.find((m) => m.id === id) || {}).label || "No markup";

  X.newExpense = (over) => Object.assign({
    kind: "expense", id: null, companyId: null, ticketId: null, projectId: null, taskId: null, memberId: null,
    date: "", category: "", amount: 0, currency: "", description: "",
    billable: true, billableOverride: null, reimbursable: true,
    markupType: "none", markupValue: 0,
    receipt: null,
    status: "draft",
    submittedAt: null, submittedBy: null,
    approvedAt: null, approvedBy: null,
    rejectedAt: null, rejectedBy: null, rejectionNote: "",
    reimbursedAt: null, reimbursedBy: null, lockedAt: null,
    createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  /* ─────────────────────────── amounts ─────────────────────────── */

  X.billableAmount = function (e) {
    const amount = Number(e && e.amount) || 0;
    if (!e || !e.billable || e.writtenOff) return 0;
    const v = Number(e.markupValue) || 0;
    if (e.markupType === "percent") return Math.round((amount * (1 + v / 100)) * 100) / 100;
    if (e.markupType === "flat") return Math.round((amount + v) * 100) / 100;
    return amount;
  };

  X.markupLabelFor = function (e) {
    const v = Number(e.markupValue) || 0;
    if (e.markupType === "percent") return "+" + v + "%";
    if (e.markupType === "flat") return "+" + ui.money(v);
    return "—";
  };

  /* ─────────────────────────── reads ─────────────────────────── */

  X.all = async function (pid) {
    const list = await ten().records("provider", pid, "expense");
    return list.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (Number(b.id) - Number(a.id)));
  };

  X.list = async function (pid, query) {
    query = query || {};
    let list = await X.all(pid);
    if (query.memberId != null && query.memberId !== "") list = list.filter((r) => String(r.memberId) === String(query.memberId));
    if (query.companyId != null && query.companyId !== "") list = list.filter((r) => String(r.companyId) === String(query.companyId));
    if (query.ticketId != null) list = list.filter((r) => String(r.ticketId) === String(query.ticketId));
    if (query.projectId != null) list = list.filter((r) => String(r.projectId) === String(query.projectId));
    if (query.taskId != null) list = list.filter((r) => String(r.taskId) === String(query.taskId));
    if (query.status) list = list.filter((r) => String(r.status) === String(query.status));
    if (query.statusIn) { const s = query.statusIn.map(String); list = list.filter((r) => s.indexOf(String(r.status)) !== -1); }
    if (query.category) list = list.filter((r) => String(r.category) === String(query.category));
    if (query.billable != null) list = list.filter((r) => !!r.billable === !!query.billable);
    if (query.fromDate) list = list.filter((r) => String(r.date) >= String(query.fromDate));
    if (query.toDate) list = list.filter((r) => String(r.date) <= String(query.toDate));
    return list;
  };

  X.get = async (pid, id) => (await X.all(pid)).find((r) => String(r.id) === String(id)) || null;
  X.forTicket = (pid, companyId, ticketId) => X.list(pid, { companyId: companyId, ticketId: ticketId });
  X.pending = async (pid) => X.list(pid, { status: "submitted" });

  /* Billing lock (Phase 6): stamp (or release) the invoice an expense was
     billed on, so a second billing run cannot bill it again. Unlike time it
     is one record per company document entry, written directly. */
  X.markInvoiced = async function (pid, ids, invoiceId) {
    const set = (ids || []).map(String);
    if (!set.length) return { count: 0 };
    const list = await ten().records("provider", pid);
    let count = 0;
    const updated = list.map((r) => {
      if (r.kind !== "expense" || set.indexOf(String(r.id)) === -1) return r;
      count += 1;
      return Object.assign({}, r, { invoiceId: invoiceId == null ? null : invoiceId, invoicedAt: invoiceId == null ? null : nowIso(), updatedAt: nowIso() });
    });
    if (count) await ten().save("provider", pid, updated);
    return { count: count };
  };

  X.uninvoiced = async function (pid, query) {
    const list = await X.list(pid, query);
    return list.filter((e) => e.billable && !e.writtenOff && e.invoiceId == null && ["approved", "reimbursed"].indexOf(String(e.status)) !== -1);
  };

  X.rollup = function (list) {
    const out = { count: 0, cost: 0, billable: 0, reimbursable: 0, byClient: {}, byCategory: {} };
    for (const e of list || []) {
      const cost = Number(e.amount) || 0;
      const bill = X.billableAmount(e);
      out.count += 1;
      out.cost += cost;
      out.billable += bill;
      if (e.reimbursable !== false && e.status !== "draft" && e.status !== "rejected") out.reimbursable += cost;
      const ck = e.companyId == null || e.companyId === "" ? "__internal" : String(e.companyId);
      if (!out.byClient[ck]) out.byClient[ck] = { count: 0, cost: 0, billable: 0 };
      out.byClient[ck].count += 1; out.byClient[ck].cost += cost; out.byClient[ck].billable += bill;
      const kk = String(e.category || "uncategorised");
      if (!out.byCategory[kk]) out.byCategory[kk] = { count: 0, cost: 0, billable: 0 };
      out.byCategory[kk].count += 1; out.byCategory[kk].cost += cost; out.byCategory[kk].billable += bill;
    }
    out.cost = Math.round(out.cost * 100) / 100;
    out.billable = Math.round(out.billable * 100) / 100;
    out.reimbursable = Math.round(out.reimbursable * 100) / 100;
    return out;
  };

  /* ─────────────────────────── writes ─────────────────────────── */

  X.save = async function (pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("expenses.edit", { companyId: rec && rec.companyId })) return { error: "forbidden" };
    const existing = rec && rec.id != null ? await X.get(pid, rec.id) : null;
    if (existing && ["approved", "reimbursed", "locked", "submitted"].indexOf(String(existing.status)) !== -1 && !opts.system) {
      return { error: "locked", message: "This expense is " + X.statusLabel(existing.status).toLowerCase() + " and can no longer be edited." };
    }
    const r = Object.assign(X.newExpense(), existing || {}, rec);
    r.amount = Number(r.amount) || 0;
    if (r.amount < 0) return { error: "amount_invalid" };
    if (!r.date) r.date = ui.today();
    const maps = await ERP.time.taxonomyMaps(pid);
    const cat = maps.expenseCategory.find((c) => String(c.code) === String(r.category || "")) || null;
    if (typeof r.billableOverride === "boolean") r.billable = r.billableOverride;
    else if (cat && cat.billable === false) r.billable = false;
    else r.billable = true;
    if (r.id == null || !isFinite(r.id)) {
      r.id = ten().nextId(await ten().records("provider", pid));
      r.createdAt = nowIso();
      r.createdBy = r.createdBy != null ? r.createdBy : actor().memberId || null;
      r.status = "draft";
    }
    r.updatedAt = nowIso();
    await put(pid, r);
    return { record: r, created: !existing };
  };

  X.remove = async function (pid, id) {
    if (!ERP.security.enforce("expenses.edit")) return { error: "forbidden" };
    const e = await X.get(pid, id);
    if (!e) return { error: "not_found" };
    if (["approved", "locked", "reimbursed"].indexOf(String(e.status)) !== -1) return { error: "locked" };
    await ten().remove("provider", pid, (r) => r.kind === "expense" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  X.submit = async function (pid, id) {
    if (!ERP.security.enforce("expenses.edit")) return { error: "forbidden" };
    const e = await X.get(pid, id);
    if (!e) return { error: "not_found" };
    if (["submitted", "approved", "reimbursed", "locked"].indexOf(String(e.status)) !== -1) return { error: "already" };
    const now = nowIso();
    const rec = Object.assign({}, e, { status: "submitted", submittedAt: now, submittedBy: actorName(), rejectionNote: "", updatedAt: now });
    await put(pid, rec);
    await emit(pid, "expense.submitted", rec);
    return { record: rec };
  };

  X.approve = async function (pid, id) {
    if (!ERP.security.enforce("expenses.approve")) return { error: "forbidden" };
    const e = await X.get(pid, id);
    if (!e) return { error: "not_found" };
    if (e.status !== "submitted") return { error: "not_submitted", message: "Only a submitted expense can be approved." };
    const now = nowIso();
    const rec = Object.assign({}, e, { status: "approved", approvedAt: now, approvedBy: actorName(), rejectedAt: null, rejectedBy: null, rejectionNote: "", updatedAt: now });
    await put(pid, rec);
    await emit(pid, "expense.approved", rec);
    return { record: rec };
  };

  X.reject = async function (pid, id, comment) {
    if (!ERP.security.enforce("expenses.approve")) return { error: "forbidden" };
    const e = await X.get(pid, id);
    if (!e) return { error: "not_found" };
    if (e.status === "locked") return { error: "locked" };
    const note = String(comment || "").trim();
    if (!note) return { error: "comment_required", message: "A rejection must say why." };
    const now = nowIso();
    const rec = Object.assign({}, e, { status: "rejected", rejectedAt: now, rejectedBy: actorName(), rejectionNote: note, approvedAt: null, approvedBy: null, updatedAt: now });
    await put(pid, rec);
    await emit(pid, "expense.rejected", rec, { comment: note });
    return { record: rec };
  };

  X.reimburse = async function (pid, id) {
    if (!ERP.security.enforce("expenses.approve")) return { error: "forbidden" };
    const e = await X.get(pid, id);
    if (!e) return { error: "not_found" };
    if (e.status !== "approved") return { error: "not_approved", message: "Approve the expense before reimbursing it." };
    const now = nowIso();
    const rec = Object.assign({}, e, { status: "reimbursed", reimbursedAt: now, reimbursedBy: actorName(), updatedAt: now });
    await put(pid, rec);
    return { record: rec };
  };

  X.lock = async function (pid, id) {
    if (!ERP.security.enforce("expenses.approve")) return { error: "forbidden" };
    const e = await X.get(pid, id);
    if (!e) return { error: "not_found" };
    if (["approved", "reimbursed"].indexOf(String(e.status)) === -1) return { error: "not_approved" };
    const rec = Object.assign({}, e, { status: "locked", lockedAt: nowIso(), updatedAt: nowIso() });
    await put(pid, rec);
    return { record: rec };
  };

  X.reopen = async function (pid, id) {
    if (!ERP.security.enforce("expenses.approve")) return { error: "forbidden" };
    const e = await X.get(pid, id);
    if (!e) return { error: "not_found" };
    if (e.status === "locked") return { error: "locked" };
    const rec = Object.assign({}, e, { status: "draft", submittedAt: null, submittedBy: null, updatedAt: nowIso() });
    await put(pid, rec);
    return { record: rec };
  };

  /* Write off the BILLING (the cost still needs reimbursing). */
  X.writeOff = async function (pid, id, note) {
    if (!ERP.security.enforce("expenses.approve")) return { error: "forbidden" };
    const e = await X.get(pid, id);
    if (!e) return { error: "not_found" };
    if (e.status === "locked") return { error: "locked" };
    const rec = Object.assign({}, e, { billable: false, billableOverride: false, writtenOff: { by: actorName(), at: nowIso(), note: note || "" }, updatedAt: nowIso() });
    await put(pid, rec);
    return { record: rec };
  };

  async function emit(pid, event, expense, extra) {
    if (!ERP.workflow) return;
    try {
      const [ticket, company, member] = await Promise.all([
        expense.ticketId != null && expense.companyId != null ? ERP.tickets.get(expense.companyId, expense.ticketId) : null,
        expense.companyId != null ? ERP.companies.get(expense.companyId) : null,
        expense.memberId != null ? ERP.members.member(expense.memberId) : null,
      ]);
      await ERP.workflow.emit(event, Object.assign({
        event: event, expense: expense, ticket: ticket, company: company, member: member, actor: actor(),
      }, extra || {}));
    } catch (e) {}
  }
  X.emit = emit;

  /* ─────────────────────────── expense UI ─────────────────────────── */

  function blankState() { return { memberId: "", companyId: "", status: "" }; }

  async function ticketOptions(companyId) {
    if (companyId == null || companyId === "") return [];
    const list = await ERP.tickets.list(companyId, {});
    return list.map((t) => ({ value: t.id, label: "#" + (t.number || t.id) + " · " + String(t.summary || "").slice(0, 36) }));
  }

  async function openExpenseModal(pid, expense, refresh) {
    if (!ERP.security.enforce("expenses.edit", { companyId: expense ? expense.companyId : null })) return;
    const [members, companies, maps] = await Promise.all([ERP.members.members(), ERP.companies.optionList(), ERP.time.taxonomyMaps(pid)]);
    const e = expense || X.newExpense({ memberId: actor().memberId || (members[0] ? members[0].id : ""), date: ui.today() });
    const tickets = await ticketOptions(e.companyId);
    let projects = e.companyId && ERP.projects ? await ERP.projects.list(pid, { companyId: e.companyId }) : [];
    const tasksFor = (projectId) => {
      const pr = projects.find((x) => String(x.id) === String(projectId));
      return pr && ERP.projects ? ERP.projects.tasksOf(pr).map((h) => ({ value: h.task.id, label: (h.phase.name ? h.phase.name + " · " : "") + h.task.name })) : [];
    };
    const memberId = e.memberId != null ? e.memberId : (members[0] ? members[0].id : null);
    const fields =
      '<div class="erp-form-row">' +
        ui.select("memberId", "Member", members.map((m) => ({ value: m.id, label: m.name })), memberId) +
        ui.dateInput("date", "Date", e.date || ui.today()) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("companyId", "Client", [{ value: "", label: "— internal —" }].concat(companies), e.companyId) +
        ui.select("ticketId", "Ticket", [{ value: "", label: "— none —" }].concat(tickets), e.ticketId) +
      "</div>" +
      (ERP.projects ?
      '<div class="erp-form-row">' +
        ui.select("projectId", "Project", [{ value: "", label: "— none —" }].concat(projects.map((p) => ({ value: p.id, label: (p.number ? p.number + " · " : "") + p.name }))), e.projectId) +
        ui.select("taskId", "Project task", [{ value: "", label: "— none —" }].concat(tasksFor(e.projectId)), e.taskId) +
      "</div>" : "") +
      '<div class="erp-form-row">' +
        ui.select("category", "Category", [{ value: "", label: "— none —" }].concat(maps.expenseCategory.map((c) => ({ value: c.code, label: c.label }))), e.category) +
        ui.number("amount", "Amount", e.amount, { min: 0, step: 0.01 }) +
      "</div>" +
      ui.text("description", "Description", e.description || "", "What was bought and why") +
      '<div class="erp-form-row">' +
        ui.select("billableOverride", "Billable to client", [
          { value: "", label: "Automatic (from category)" },
          { value: "yes", label: "Billable" },
          { value: "no", label: "Not billable" },
        ], e.billableOverride === true ? "yes" : e.billableOverride === false ? "no" : "") +
        ui.check("reimbursable", "Reimburse to member", e.reimbursable !== false) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("markupType", "Markup", X.MARKUPS.map((m) => ({ value: m.id, label: m.label })), e.markupType) +
        ui.number("markupValue", "Markup value", e.markupValue, { min: 0, step: 0.01 }) +
      "</div>" +
      ui.field("Receipt", '<div class="erp-file-row"><input type="file" name="receiptFile" accept="image/*,application/pdf"><input type="text" name="receiptUrl" placeholder="…or paste a receipt URL" value="' + ui.esc(e.receipt && e.receipt.url ? e.receipt.url : "") + '"></div>' +
        (e.receipt && e.receipt.url ? '<div class="hint">Attached: <a href="' + ui.esc(e.receipt.url) + '" target="_blank" rel="noopener">' + ui.esc(e.receipt.name || "receipt") + "</a></div>" : ""));

    const modal = ui.modal({
      title: expense && expense.id != null ? "Edit expense" : "New expense",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "ex-cancel" }) + " " +
        (expense && expense.id != null ? ui.btn("Delete", { small: true, danger: true, act: "ex-del" }) + " " : "") +
        ui.btn(expense && expense.id != null ? "Save" : "Add expense", { small: true, primary: true, act: "ex-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const compSel = form.querySelector('[name="companyId"]');
    function fillProjectOptions() {
      const pSel = form.querySelector('[name="projectId"]');
      if (!pSel) return;
      const cur = pSel.value;
      pSel.innerHTML = '<option value="">— none —</option>' + projects.map((p) => '<option value="' + ui.esc(p.id) + '">' + ui.esc((p.number ? p.number + " · " : "") + p.name) + "</option>").join("");
      pSel.value = projects.some((p) => String(p.id) === String(cur)) ? cur : "";
    }
    function fillTaskOptions() {
      const tSel = form.querySelector('[name="taskId"]');
      if (!tSel) return;
      const pSel = form.querySelector('[name="projectId"]');
      const cur = tSel.value;
      const opts = tasksFor(pSel ? pSel.value : "");
      tSel.innerHTML = '<option value="">— none —</option>' + opts.map((o) => '<option value="' + ui.esc(o.value) + '">' + ui.esc(o.label) + "</option>").join("");
      tSel.value = opts.some((o) => String(o.value) === String(cur)) ? cur : "";
    }
    compSel.addEventListener("change", async () => {
      const cid = compSel.value;
      const list = await ticketOptions(cid);
      const tk = form.querySelector('[name="ticketId"]');
      tk.innerHTML = '<option value="">— none —</option>' + list.map((t) => '<option value="' + ui.esc(t.value) + '">' + ui.esc(t.label) + "</option>").join("");
      projects = cid !== "" && ERP.projects ? await ERP.projects.list(pid, { companyId: cid }) : [];
      fillProjectOptions();
      fillTaskOptions();
    });
    const projSel = form.querySelector('[name="projectId"]');
    if (projSel) projSel.addEventListener("change", fillTaskOptions);
    modal.querySelector("[data-act=ex-cancel]").onclick = () => ui.closeModal();
    const delBtn = modal.querySelector("[data-act=ex-del]");
    if (delBtn) delBtn.onclick = async () => {
      if (!(await ui.confirm({ title: "Delete this expense?", message: "The record will be permanently removed.", danger: true, okLabel: "Delete" }))) return;
      const res = await X.remove(pid, expense.id);
      if (res.error) { ERP.toast("Could not delete: " + res.error, "error"); return; }
      ui.closeModal(); ERP.toast("Expense deleted.", "success"); refresh();
    };
    modal.querySelector("[data-act=ex-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["memberId", "date", "companyId", "ticketId", "projectId", "taskId", "category", "amount", "description", "billableOverride", "reimbursable", "markupType", "markupValue", "receiptUrl"]);
      if (!v.memberId) { ERP.toast("Choose a member.", "error"); return; }
      if (!v.amount || Number(v.amount) <= 0) { ERP.toast("Enter the amount.", "error"); return; }
      btn.disabled = true;
      let receipt = (expense && expense.receipt) || null;
      const fileInput = form.querySelector('[name="receiptFile"]');
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (file) {
        if (!(window.root && root.uploadPlugin)) { ERP.toast("The upload plugin is not loaded, so the receipt can't be attached.", "error"); btn.disabled = false; return; }
        const up = await root.uploadPlugin(file, { expires: Date.now() + 1000 * 60 * 60 * 24 * 365 });
        if (up.error) { ERP.toast("Receipt upload failed: " + up.error, "error"); btn.disabled = false; return; }
        receipt = { url: up.url, name: file.name, size: file.size, uploadedAt: nowIso() };
      } else if (v.receiptUrl && (!receipt || receipt.url !== v.receiptUrl)) {
        receipt = { url: v.receiptUrl, name: "receipt link", size: 0, uploadedAt: nowIso() };
      } else if (!v.receiptUrl && receipt) {
        receipt = null;
      }
      const payload = Object.assign({}, expense || {}, {
        memberId: v.memberId, date: v.date,
        companyId: v.companyId === "" ? null : v.companyId,
        ticketId: v.ticketId === "" ? null : v.ticketId,
        projectId: v.projectId === "" || v.projectId == null ? null : v.projectId,
        taskId: v.taskId === "" || v.taskId == null ? null : v.taskId,
        category: v.category, amount: v.amount, description: v.description,
        billableOverride: v.billableOverride === "" ? null : v.billableOverride === "yes",
        reimbursable: v.reimbursable !== false,
        markupType: v.markupType, markupValue: v.markupValue,
        receipt: receipt,
      });
      if (expense && expense.id != null) payload.id = expense.id;
      const res = await X.save(pid, payload);
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Expense saved.", "success"); refresh();
    };
  }
  X.openExpenseModal = openExpenseModal;

  async function openRejectModal(pid, expense, refresh) {
    const modal = ui.modal({
      title: "Reject expense",
      body: ui.form(ui.textarea("comment", "Reason (sent to the member)", "", 4)),
      foot: ui.btn("Keep it", { small: true, act: "exr-cancel" }) + " " + ui.btn("Reject with comment", { small: true, danger: true, act: "exr-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=exr-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=exr-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["comment"]);
      btn.disabled = true;
      const res = await X.reject(pid, expense.id, v.comment);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Expense returned.", "success"); refresh();
    };
  }

  X.renderInto = async function (panel, pid, refresh, host) {
    if (!ERP.security.enforce("expenses.view")) { panel.innerHTML = ui.alert("Your role cannot view expenses.", "warn"); return; }
    const state = (host.__exp = host.__exp || blankState());
    const canEdit = ERP.security.can("expenses.edit");
    const canApprove = ERP.security.can("expenses.approve");
    const [members, companies, maps] = await Promise.all([ERP.members.members(), ERP.companies.optionList(), ERP.time.taxonomyMaps(pid)]);
    const names = Object.fromEntries(members.map((m) => [String(m.id), m.name]));
    const clientNames = Object.fromEntries((companies || []).map((c) => [String(c.value), c.label]));
    const catLabel = (code) => { const c = maps.expenseCategory.find((x) => String(x.code) === String(code)); return c ? c.label : (code || "—"); };
    const masked = (v) => (ERP.security.canSeeFinancials() ? ui.money(v) : "•••");

    const list = await X.list(pid, { memberId: state.memberId || null, companyId: state.companyId || null, status: state.status || null });
    const roll = X.rollup(list);
    const pending = canApprove ? await X.pending(pid) : [];

    const rows = list.slice(0, 200).map((e) => {
      const editable = ["draft", "rejected"].indexOf(String(e.status)) !== -1;
      const acts = [];
      if (canEdit && editable) acts.push(ui.btn("Edit", { small: true, act: "ex-edit", arg: e.id }));
      if (canEdit && editable) acts.push(ui.btn("Submit", { small: true, primary: true, act: "ex-submit", arg: e.id }));
      if (canEdit && editable) acts.push(ui.btn("Delete", { small: true, danger: true, act: "ex-del", arg: e.id }));
      if (canApprove && e.status === "submitted") acts.push(ui.btn("Approve", { small: true, primary: true, act: "ex-approve", arg: e.id }), ui.btn("Reject", { small: true, danger: true, act: "ex-reject", arg: e.id }));
      if (canApprove && e.status === "approved") acts.push(ui.btn("Reimburse", { small: true, act: "ex-reimburse", arg: e.id }), ui.btn("Lock", { small: true, act: "ex-lock", arg: e.id }));
      if (canApprove && e.status === "rejected") acts.push(ui.btn("Reopen", { small: true, act: "ex-reopen", arg: e.id }));
      return {
        date: ui.esc(e.date),
        member: ui.esc(names[String(e.memberId)] || "#" + e.memberId),
        client: ui.esc(e.companyId == null ? "Internal" : (clientNames[String(e.companyId)] || "#" + e.companyId)),
        category: ui.esc(catLabel(e.category)),
        description: ui.esc(e.description || "—") + (e.receipt && e.receipt.url ? ' <a href="' + ui.esc(e.receipt.url) + '" target="_blank" rel="noopener" title="Receipt">📎</a>' : ""),
        amount: masked(e.amount) + (e.currency ? " " + ui.esc(e.currency) : ""),
        markup: ui.esc(X.markupLabelFor(e)),
        bill: e.billable ? masked(X.billableAmount(e)) : ui.badge("Non-billable", "muted"),
        status: ui.badge(X.statusLabel(e.status), X.statusTone(e.status)) + (e.rejectedAt && e.rejectionNote ? '<div class="erp-sub">' + ui.esc(e.rejectionNote) + "</div>" : ""),
        actions: acts.join(" "),
      };
    });

    const pendingRows = pending.map((e) => ({
      date: ui.esc(e.date),
      member: ui.esc(names[String(e.memberId)] || "#" + e.memberId),
      client: ui.esc(e.companyId == null ? "Internal" : (clientNames[String(e.companyId)] || "#" + e.companyId)),
      amount: masked(e.amount),
      bill: masked(X.billableAmount(e)),
      actions: ui.btn("Approve", { small: true, primary: true, act: "ex-approve", arg: e.id }) + " " + ui.btn("Reject", { small: true, danger: true, act: "ex-reject", arg: e.id }),
    }));

    const clientRows = Object.keys(roll.byClient).map((k) => ({
      client: ui.esc(k === "__internal" ? "Internal" : (clientNames[k] || "#" + k)),
      items: String(roll.byClient[k].count),
      cost: masked(roll.byClient[k].cost),
      bill: masked(roll.byClient[k].billable),
    }));

    panel.innerHTML =
      ui.summary([
        { label: "Expenses", value: String(roll.count) },
        { label: "Cost", value: masked(roll.cost) },
        { label: "Client-billable", value: masked(roll.billable) },
        { label: "To reimburse", value: masked(roll.reimbursable) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("ex-member", "Member", [{ value: "", label: "Everyone" }].concat(members.map((m) => ({ value: m.id, label: m.name }))), state.memberId) +
        ui.select("ex-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.select("ex-status", "Status", [{ value: "", label: "Any status" }].concat(X.STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status) +
        '<span class="erp-db-hint"></span>' +
        (canEdit ? ui.btn("New expense", { primary: true, act: "ex-new" }) : "") +
      "</div>" +
      (canApprove && pending.length
        ? ui.card("Approval queue (" + pending.length + ")", ui.table([
            { key: "date", label: "Date" },
            { key: "member", label: "Member" },
            { key: "client", label: "Client" },
            { key: "amount", label: "Cost", align: "right" },
            { key: "bill", label: "Bills", align: "right" },
            { key: "actions", label: "", align: "right" },
          ], pendingRows, { emptyText: "Nothing awaiting approval." }))
        : "") +
      ui.table([
        { key: "date", label: "Date" },
        { key: "member", label: "Member" },
        { key: "client", label: "Client" },
        { key: "category", label: "Category" },
        { key: "description", label: "Description" },
        { key: "amount", label: "Cost", align: "right" },
        { key: "markup", label: "Markup", align: "right" },
        { key: "bill", label: "Bills", align: "right" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No expenses recorded." }) +
      (clientRows.length ? ui.card("Client-billable roll-up", ui.table([
        { key: "client", label: "Client" },
        { key: "items", label: "Items", align: "right" },
        { key: "cost", label: "Cost", align: "right" },
        { key: "bill", label: "Bills", align: "right" },
      ], clientRows)) : "");

    const bindFilter = (sel, key) => {
      const el = panel.querySelector(sel);
      if (el) el.addEventListener("change", () => { state[key] = el.value; refresh(); });
    };
    bindFilter('[name="ex-member"]', "memberId");
    bindFilter('[name="ex-client"]', "companyId");
    bindFilter('[name="ex-status"]', "status");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ex-new") return openExpenseModal(pid, null, refresh);
      if (act === "ex-edit") return openExpenseModal(pid, await X.get(pid, arg), refresh);
      if (act === "ex-del") {
        if (!(await ui.confirm({ title: "Delete this expense?", message: "The record will be permanently removed.", danger: true, okLabel: "Delete" }))) return;
        const res = await X.remove(pid, arg);
        if (res.error) { ERP.toast(res.error, "error"); return; }
        ERP.toast("Expense deleted.", "success");
        return refresh();
      }
      if (act === "ex-submit") { const r = await X.submit(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Expense submitted.", "success"); return refresh(); }
      if (act === "ex-approve") { const r = await X.approve(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Expense approved.", "success"); return refresh(); }
      if (act === "ex-reject") return openRejectModal(pid, await X.get(pid, arg), refresh);
      if (act === "ex-reimburse") { const r = await X.reimburse(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Expense marked reimbursed.", "success"); return refresh(); }
      if (act === "ex-lock") { const r = await X.lock(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Expense locked.", "success"); return refresh(); }
      if (act === "ex-reopen") { const r = await X.reopen(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Expense reopened.", "success"); return refresh(); }
    });
  };

  X.ensureSeed = async function () { return { skipped: "nothing_to_seed" }; };
})();
