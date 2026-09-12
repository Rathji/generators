/* ============================================================
   PSA-U — approval workflows (Phase 10 · Task 50)

   One place where "someone has to sign off on this" is modelled.
   A quote a client must accept, a purchase order that clears a
   threshold, an invoice a manager must release, a change request a
   ticket raises — they are all approval requests:

     • approvalRequest — a reference (type + id + number), an
                         approver (internal role/member, or a client
                         contact), a due date, reminders, a decision
                         with its note, and an audit trail.

   Routing. `route` decides who should approve: client approvals go
   to a portal contact of the client company; internal approvals go
   to a member in the required role (the account manager for the
   client, else a manager/owner).

   Expiry & reminders. `sweep` expires requests past their due date
   and records reminders, emitting `approval.*` events so the
   notification and workflow engines can act.

   The decision hooks the rest of the app. Each request carries a
   `then` action; approving runs it (send/accept a quote, approve a
   purchase order, post an invoice, note a ticket), rejecting runs
   its counterpart. So "approve" is not a status change that leaves
   the work undone — it performs the release. And `canProceed` lets
   any flow halt behind a pending decision.

   Storage: provider-document records (kind "approvalRequest") plus
   an "approvalSettings" record. Client decisions arrive through the
   Phase-10 client portal. No record here is required at runtime.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const AP = (ERP.approvals = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("approvals requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const recs = (pid, kind) => ten().records("provider", pid, kind);

  /* ─────────────────────────── vocabulary ─────────────────────────── */

  AP.REF_TYPES = [
    { id: "quote", label: "Quote", client: true },
    { id: "ticket", label: "Ticket", client: true },
    { id: "change_request", label: "Change request", client: true },
    { id: "purchase_order", label: "Purchase order", client: false },
    { id: "invoice", label: "Invoice", client: false },
  ];
  AP.STATUSES = [
    { id: "pending", label: "Pending", tone: "warn" },
    { id: "approved", label: "Approved", tone: "success" },
    { id: "rejected", label: "Rejected", tone: "danger" },
    { id: "expired", label: "Expired", tone: "muted" },
    { id: "cancelled", label: "Cancelled", tone: "muted" },
  ];
  AP.refLabel = (id) => (AP.REF_TYPES.find((r) => r.id === id) || {}).label || id || "—";
  AP.refIsClient = (id) => !!(AP.REF_TYPES.find((r) => r.id === id) || {}).client;
  AP.statusLabel = (id) => (AP.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  AP.statusTone = (id) => (AP.STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  AP.DEFAULT_SETTINGS = { enabled: true, defaultDueDays: 5, reminderEveryDays: 2 };

  /* ─────────────────────────── factories & settings ─────────────────────────── */

  AP.newRequest = (over) => Object.assign({
    kind: "approvalRequest", id: null, providerId: null, number: "",
    refType: "quote", refId: null, refNumber: "", title: "",
    companyId: null, amount: null, currency: "",
    approverType: "internal", approverId: null, approverContactId: null, approverRole: "manager", approverName: "",
    status: "pending", requestedBy: "", requestedAt: null, dueAt: null,
    reminders: [], reminderCount: 0, lastReminderAt: null,
    decidedAt: null, decidedBy: "", decidedByType: "", decisionNote: "",
    cancelReason: "", then: null, thenResult: null, audit: [], value: null,
  }, over || {});

  AP.settings = async function (pid) {
    const rec = (await recs(pid, "approvalSettings"))[0];
    return Object.assign({}, AP.DEFAULT_SETTINGS, rec || {});
  };
  AP.saveSettings = async function (pid, patch) {
    if (!ERP.security.enforce("approvals.manage")) return { error: "forbidden" };
    const rec = Object.assign({ kind: "approvalSettings", id: "settings", providerId: pid }, await AP.settings(pid), patch || {});
    await ten().upsert("provider", pid, rec);
    return { record: rec };
  };

  async function nextNumber(pid) {
    let max = 0;
    (await recs(pid, "approvalRequest")).forEach((r) => { const m = /(\d+)\s*$/.exec(String(r.number || "")); if (m) max = Math.max(max, Number(m[1])); });
    return "APR-" + String(max + 1).padStart(4, "0");
  }

  function emit(pid, event, ctx) {
    if (!ERP.workflow) return Promise.resolve();
    try { return ERP.workflow.emit(event, Object.assign({ providerId: pid }, ctx || {})); } catch (e) { return Promise.resolve(); }
  }

  /* ─────────────────────────── routing ─────────────────────────── */

  AP.route = async function (pid, rec) {
    const client = AP.refIsClient(rec.refType);
    if (client) {
      const contacts = rec.companyId != null ? await ERP.companies.contacts(rec.companyId) : [];
      const portalContacts = contacts.filter((c) => c.portalAccess !== false && c.status !== "inactive");
      const pick = portalContacts.find((c) => /primary|decision|owner/i.test(String(c.role || ""))) || portalContacts[0] || contacts[0] || null;
      return { approverType: "client", approverContactId: pick ? pick.id : null, approverId: null, approverRole: "", approverName: pick ? pick.name : "" };
    }
    // internal: the client's account manager, else a manager/owner
    let member = null;
    if (rec.companyId != null && ERP.companies.get) {
      const co = await ERP.companies.get(rec.companyId);
      if (co && co.accountManagerId != null) member = await ERP.members.memberById(co.accountManagerId);
    }
    if (!member && ERP.members) {
      const list = await ERP.members.members();
      member = list.find((m) => m.functionalRole === "manager") || list.find((m) => m.functionalRole === "owner") || null;
    }
    return { approverType: "internal", approverId: member ? member.id : null, approverContactId: null, approverRole: rec.approverRole || "manager", approverName: member ? member.name : "" };
  };

  AP.THEN_ACTIONS = {
    send_quote: async (pid, req, decision, opts) => {
      if (!ERP.sales || req.companyId == null) return { error: "unavailable" };
      return ERP.sales.setQuoteStatus(pid, req.companyId, req.refId, "sent", { override: true, overrideReason: "Approved via approval workflow" });
    },
    accept_quote: async (pid, req, decision, opts) => {
      if (!ERP.sales || req.companyId == null) return { error: "unavailable" };
      return ERP.sales.setQuoteStatus(pid, req.companyId, req.refId, "accepted", { override: true, overrideReason: "Approved via approval workflow" });
    },
    approve_po: async (pid, req) => {
      if (!ERP.procurement) return { error: "unavailable" };
      return ERP.procurement.approve(pid, req.refId, { note: req.decisionNote, override: true, overrideReason: req.decisionNote });
    },
    post_invoice: async (pid, req) => {
      if (!ERP.billing) return { error: "unavailable" };
      return ERP.billing.post(pid, req.refId, { viaApproval: true });
    },
    note_ticket: async (pid, req) => {
      if (!ERP.tickets || req.companyId == null) return { error: "unavailable" };
      return ERP.tickets.addNote(req.companyId, req.refId, { body: "Approval decision: " + AP.statusLabel(req.status) + (req.decisionNote ? " — " + req.decisionNote : ""), internal: false, system: true });
    },
  };
  AP.REJECT_ACTIONS = {
    purchase_order: async (pid, req) => (ERP.procurement ? ERP.procurement.reject(pid, req.refId, req.decisionNote) : { error: "unavailable" }),
  };

  function defaultThen(refType, approverType) {
    if (refType === "quote") return approverType === "client" ? "accept_quote" : "send_quote";
    if (refType === "purchase_order") return "approve_po";
    if (refType === "invoice") return "post_invoice";
    if (refType === "ticket" || refType === "change_request") return "note_ticket";
    return null;
  }

  async function applyThen(pid, req, decision) {
    const fnName = decision === "approved" ? req.then : (AP.REJECT_ACTIONS[req.refType] ? req.refType : null);
    let fn = null;
    if (decision === "approved" && fnName && AP.THEN_ACTIONS[fnName]) fn = AP.THEN_ACTIONS[fnName];
    if (decision === "rejected" && AP.REJECT_ACTIONS[req.refType]) fn = AP.REJECT_ACTIONS[req.refType];
    if (!fn) return { applied: false, action: fnName || null };
    try {
      const res = await fn(pid, req, decision);
      return { applied: !(res && res.error), action: fnName, error: res && res.error ? res.error : null, result: res && res.record ? { id: res.record.id, status: res.record.status } : null };
    } catch (e) { return { applied: false, action: fnName, error: (e && e.message) || String(e) }; }
  }

  /* ─────────────────────────── lifecycle ─────────────────────────── */

  async function persist(pid, rec) {
    await ten().upsert("provider", pid, rec);
    return rec;
  }
  function audit(req, entry) {
    req.audit = (req.audit || []).concat([Object.assign({ at: nowIso(), by: actorName() }, entry)]);
  }

  AP.request = async function (pid, rec) {
    if (!ERP.security.enforce("approvals.request")) return { error: "forbidden" };
    const settings = await AP.settings(pid);
    if (settings.enabled === false) return { error: "disabled" };
    const out = Object.assign(AP.newRequest(), rec);
    if (out.refId == null) return { error: "ref_required", message: "An approval needs something to approve." };
    if (!out.title) out.title = AP.refLabel(out.refType) + " " + (out.refNumber || "#" + out.refId);
    const routed = await AP.route(pid, out);
    out.approverType = rec.approverType || routed.approverType;
    if (out.approverType === "client") { if (!rec.approverContactId) { out.approverContactId = routed.approverContactId; out.approverName = routed.approverName; } }
    else { if (!rec.approverId) { out.approverId = routed.approverId; out.approverName = routed.approverName; } out.approverRole = rec.approverRole || routed.approverRole; }
    if (!out.then) out.then = defaultThen(out.refType, out.approverType);
    const now = nowIso();
    out.providerId = pid;
    out.id = ten().nextId(await recs(pid, "approvalRequest"));
    out.number = await nextNumber(pid);
    out.requestedBy = rec.requestedBy || actorName();
    out.requestedAt = now;
    if (!out.dueAt) {
      const d = new Date(); d.setDate(d.getDate() + (Number(settings.defaultDueDays) || 5));
      out.dueAt = d.toISOString();
    }
    out.status = "pending";
    audit(out, { type: "requested", text: "Requested from " + (out.approverName || out.approverType) });
    await persist(pid, out);
    await emit(pid, "approval.requested", { approval: out });
    return { record: out, created: true };
  };

  AP.decide = async function (pid, id, opts) {
    opts = opts || {};
    const req = await AP.get(pid, id);
    if (!req) return { error: "not_found" };
    if (req.status !== "pending") return { error: "not_pending", message: "This request has already been decided." };
    const byType = opts.byType || "internal";
    if (byType === "internal" && !ERP.security.enforce("approvals.decide")) return { error: "forbidden" };
    const approved = opts.decision === "approved";
    req.status = approved ? "approved" : "rejected";
    req.decidedAt = nowIso();
    req.decidedByType = byType;
    req.decidedBy = opts.by || (byType === "client" ? (req.approverName || "Client contact") : actorName());
    req.decisionNote = opts.note || "";
    audit(req, { type: req.status, text: (approved ? "Approved" : "Rejected") + (req.decisionNote ? ": " + req.decisionNote : ""), by: req.decidedBy });
    const action = await applyThen(pid, req, req.status);
    req.thenResult = action;
    audit(req, { type: "action", text: action.applied ? ("Ran " + action.action) : ("No release action" + (action.error ? " (" + action.error + ")" : "")), by: "system" });
    await persist(pid, req);
    await emit(pid, approved ? "approval.approved" : "approval.rejected", { approval: req });
    return { record: req, action: action };
  };

  AP.cancel = async function (pid, id, reason) {
    if (!ERP.security.enforce("approvals.request")) return { error: "forbidden" };
    const req = await AP.get(pid, id);
    if (!req) return { error: "not_found" };
    if (req.status !== "pending") return { error: "not_pending" };
    req.status = "cancelled"; req.cancelReason = reason || "";
    audit(req, { type: "cancelled", text: reason || "Cancelled" });
    await persist(pid, req);
    await emit(pid, "approval.cancelled", { approval: req });
    return { record: req };
  };

  AP.sweep = async function (pid, opts) {
    opts = opts || {};
    const settings = await AP.settings(pid);
    const now = opts.now || Date.now();
    let expired = 0, reminded = 0;
    for (const r of await recs(pid, "approvalRequest")) {
      if (r.status !== "pending") continue;
      if (r.dueAt && Date.parse(r.dueAt) <= now) {
        const req = clone(r); req.status = "expired";
        audit(req, { type: "expired", text: "Expired after its due date", by: "system" });
        await persist(pid, req);
        await emit(pid, "approval.expired", { approval: req });
        expired += 1;
        continue;
      }
      const every = (Number(settings.reminderEveryDays) || 0) * 86400000;
      if (every > 0) {
        const last = r.lastReminderAt ? Date.parse(r.lastReminderAt) : Date.parse(r.requestedAt || 0);
        if (now - last >= every) {
          const req = clone(r);
          const n = (Number(req.reminderCount) || 0) + 1;
          req.reminderCount = n; req.lastReminderAt = new Date(now).toISOString();
          req.reminders = (req.reminders || []).concat([{ level: n, at: req.lastReminderAt, to: req.approverName || req.approverType }]);
          audit(req, { type: "reminder", text: "Reminder #" + n + " sent to " + (req.approverName || req.approverType), by: "system" });
          await persist(pid, req);
          await emit(pid, "approval.reminder", { approval: req });
          reminded += 1;
        }
      }
    }
    return { expired: expired, reminded: reminded };
  };

  /* ─────────────────────────── queries ─────────────────────────── */

  AP.requests = async function (pid, query) {
    query = query || {};
    let list = (await recs(pid, "approvalRequest")).slice();
    if (query.status) list = list.filter((r) => r.status === query.status);
    if (query.refType) list = list.filter((r) => r.refType === query.refType);
    if (query.companyId) list = list.filter((r) => String(r.companyId) === String(query.companyId));
    if (query.approverId) list = list.filter((r) => String(r.approverId) === String(query.approverId));
    if (query.approverContactId) list = list.filter((r) => String(r.approverContactId) === String(query.approverContactId));
    if (query.approverType) list = list.filter((r) => r.approverType === query.approverType);
    if (query.refId) list = list.filter((r) => String(r.refId) === String(query.refId));
    if (query.openOnly) list = list.filter((r) => r.status === "pending");
    list.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
    return list;
  };
  AP.get = async (pid, id) => (await recs(pid, "approvalRequest")).find((r) => String(r.id) === String(id)) || null;
  AP.pending = (pid, query) => AP.requests(pid, Object.assign({}, query || {}, { status: "pending" }));
  AP.forCompany = (pid, companyId, query) => AP.requests(pid, Object.assign({}, query || {}, { companyId: companyId }));
  AP.forContact = (pid, contactId, query) => AP.requests(pid, Object.assign({}, query || {}, { approverContactId: contactId }));

  /* The open request blocking (or a prior rejection of) a reference. */
  AP.gateFor = async function (pid, refType, refId) {
    const list = await AP.requests(pid, { refType: refType, refId: refId });
    return list.find((r) => r.status === "pending") || null;
  };
  AP.canProceed = async function (pid, refType, refId) {
    return !(await AP.gateFor(pid, refType, refId));
  };

  AP.stats = async function (pid) {
    const list = await recs(pid, "approvalRequest");
    const now = Date.now();
    const decided = list.filter((r) => r.decidedAt && r.requestedAt);
    const avgH = decided.length ? decided.reduce((n, r) => n + (Date.parse(r.decidedAt) - Date.parse(r.requestedAt)) / 3600000, 0) / decided.length : 0;
    return {
      total: list.length,
      pending: list.filter((r) => r.status === "pending").length,
      overdue: list.filter((r) => r.status === "pending" && r.dueAt && Date.parse(r.dueAt) <= now).length,
      clientPending: list.filter((r) => r.status === "pending" && r.approverType === "client").length,
      approved: list.filter((r) => r.status === "approved").length,
      rejected: list.filter((r) => r.status === "rejected").length,
      avgHours: Math.round(avgH * 10) / 10,
    };
  };

  /* ─────────────────────────── convenience creators ─────────────────────────── */

  AP.forQuote = async function (pid, companyId, quote, opts) {
    opts = opts || {};
    const q = typeof quote === "object" ? quote : await ERP.sales.getQuote(companyId, quote);
    if (!q) return { error: "quote_not_found" };
    return AP.request(pid, Object.assign({
      refType: "quote", refId: q.id, refNumber: q.number, title: q.title || ("Quote " + q.number),
      companyId: companyId, amount: q.total, currency: q.currency,
      approverType: opts.approverType || "client", then: opts.then,
    }, opts.over || {}));
  };

  AP.forPO = async function (pid, po, opts) {
    opts = opts || {};
    const p = typeof po === "object" ? po : await ERP.procurement.get(pid, po);
    if (!p) return { error: "po_not_found" };
    const existing = await AP.gateFor(pid, "purchase_order", p.id);
    if (existing && !opts.over) return { record: existing, existing: true };
    return AP.request(pid, Object.assign({
      refType: "purchase_order", refId: p.id, refNumber: p.number, title: "Purchase order " + p.number,
      companyId: p.companyId != null ? p.companyId : null, amount: p.total, approverType: "internal", then: "approve_po",
    }, opts.over || {}));
  };

  AP.forInvoice = async function (pid, companyId, invoice, opts) {
    opts = opts || {};
    const inv = typeof invoice === "object" ? invoice : await ERP.billing.get(companyId, invoice);
    if (!inv) return { error: "invoice_not_found" };
    return AP.request(pid, Object.assign({
      refType: "invoice", refId: inv.id, refNumber: inv.number, title: "Invoice " + inv.number,
      companyId: companyId, amount: inv.total, currency: inv.currency, approverType: "internal", then: "post_invoice",
    }, opts.over || {}));
  };

  AP.forTicket = async function (pid, companyId, ticket, opts) {
    opts = opts || {};
    const t = typeof ticket === "object" ? ticket : await ERP.tickets.get(companyId, ticket);
    if (!t) return { error: "ticket_not_found" };
    return AP.request(pid, Object.assign({
      refType: opts.refType || "ticket", refId: t.id, refNumber: t.number, title: t.summary || ("Ticket " + t.number),
      companyId: companyId, approverType: "client", then: "note_ticket",
    }, opts.over || {}));
  };

  AP.ensure = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    if (!(await recs(pid, "approvalSettings")).length) {
      await ten().upsert("provider", pid, Object.assign({ kind: "approvalSettings", id: "settings", providerId: pid }, AP.DEFAULT_SETTINGS));
      return { settings: 1 };
    }
    return { settings: 0 };
  };

  /* ═══════════════════════════ internal station tab ═══════════════════════════ */

  function esc(s) { return ui.esc(s); }

  AP.renderApprovals = async function (panel, pid, refresh) {
    if (!ERP.security.enforce("approvals.view")) { panel.innerHTML = ui.alert("Your role cannot view approvals.", "warn"); return; }
    const state = panel.__aprState || (panel.__aprState = { status: "pending", refType: "" });
    if (!state.status) state.status = "pending";
    const [list, stats, settings, companies] = await Promise.all([AP.requests(pid, state), AP.stats(pid), AP.settings(pid), ERP.companies.optionList()]);
    const coName = {}; companies.forEach((c) => { coName[String(c.value)] = c.label; });
    const canDecide = ERP.security.can("approvals.decide");
    const now = Date.now();
    const rows = list.map((r) => {
      const overdue = r.status === "pending" && r.dueAt && Date.parse(r.dueAt) <= now;
      return {
        number: esc(r.number),
        ref: ui.badge(AP.refLabel(r.refType), "muted") + " " + esc(r.refNumber || ("#" + r.refId)),
        title: esc(r.title),
        client: esc(r.companyId != null ? (coName[String(r.companyId)] || "—") : "—"),
        amount: r.amount != null ? esc(ui.money(r.amount, r.currency)) : "—",
        approver: esc(r.approverName || (r.approverType === "client" ? "Client contact" : r.approverRole)) + " " + ui.badge(r.approverType === "client" ? "client" : "internal", r.approverType === "client" ? "info" : "muted"),
        due: r.dueAt ? esc(ui.date(r.dueAt)) + (overdue ? " " + ui.badge("overdue", "danger") : "") : "—",
        status: ui.badge(AP.statusLabel(r.status), AP.statusTone(r.status)),
        actions: r.status === "pending"
          ? (r.approverType === "client"
            ? ui.btn("Cancel", { small: true, act: "ap-cancel", arg: r.id })
            : (canDecide ? ui.btn("Approve", { small: true, primary: true, act: "ap-approve", arg: r.id }) + " " + ui.btn("Reject", { small: true, danger: true, act: "ap-reject", arg: r.id }) : ""))
          : ui.btn("Open", { small: true, act: "ap-open", arg: r.id }),
      };
    });

    panel.innerHTML =
      '<div class="erp-summary">' +
        '<div class="erp-summary-item"><span>Pending</span><b>' + stats.pending + "</b></div>" +
        '<div class="erp-summary-item"><span>Awaiting a client</span><b>' + stats.clientPending + "</b></div>" +
        '<div class="erp-summary-item"><span>Overdue</span><b>' + stats.overdue + "</b></div>" +
        '<div class="erp-summary-item"><span>Avg decision</span><b>' + stats.avgHours + "h</b></div>" +
      "</div>" +
      '<div class="erp-toolbar">' +
        ui.select("ap-status", "", [{ value: "pending", label: "Pending" }, { value: "", label: "All statuses" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "expired", label: "Expired" }, { value: "cancelled", label: "Cancelled" }], state.status, null, "Filter by status") +
        ui.select("ap-ref", "", [{ value: "", label: "Any type" }].concat(AP.REF_TYPES.map((r) => ({ value: r.id, label: r.label }))), state.refType, null, "Filter by request type") +
        ui.btn("Run reminders & expiry", { small: true, act: "ap-sweep" }) +
      "</div>" +
      ui.table([
        { key: "number", label: "Ref" }, { key: "ref", label: "For" }, { key: "title", label: "Title" }, { key: "client", label: "Client" },
        { key: "amount", label: "Amount", align: "right" }, { key: "approver", label: "Approver" }, { key: "due", label: "Due" },
        { key: "status", label: "Status" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No approval requests match these filters." }) +
      '<div class="erp-sep"></div>' +
      ui.card("Approval settings", ui.form(
        '<div class="erp-form-row">' +
          ui.check("enabled", "Approvals enabled", settings.enabled !== false) +
          ui.number("defaultDueDays", "Default due (days)", settings.defaultDueDays, { min: 0, step: 1 }) +
          ui.number("reminderEveryDays", "Remind every (days)", settings.reminderEveryDays, { min: 0, step: 1 }) +
        "</div>",
        ERP.security.can("approvals.manage") ? ui.btn("Save settings", { small: true, primary: true, act: "ap-save" }) : ui.alert("Only an owner or manager may change approval settings.", "warn")
      ));
    const sel = (s, k) => { const el = panel.querySelector(s); if (el) el.addEventListener("change", () => { state[k] = el.value; refresh(); }); };
    sel("[name=ap-status]", "status"); sel("[name=ap-ref]", "refType");
    const save = panel.querySelector("[data-act=ap-save]");
    if (save) save.onclick = async () => {
      const v = ui.collect(panel.querySelector("[data-ui-form]"), ["enabled", "defaultDueDays", "reminderEveryDays"]);
      const r = await AP.saveSettings(pid, v); if (r.error) return ERP.toast(r.message || r.error, "error");
      ERP.toast("Approval settings saved.", "success"); refresh();
    };
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ap-approve") return openDecisionModal(pid, arg, "approved", refresh);
      if (act === "ap-reject") return openDecisionModal(pid, arg, "rejected", refresh);
      if (act === "ap-open") return openRequest(pid, arg, refresh);
      if (act === "ap-cancel") {
        const ok = await ui.confirm({ title: "Cancel request", message: "Withdraw this approval request?", danger: true });
        if (!ok) return;
        const r = await AP.cancel(pid, arg, "Withdrawn");
        if (r.error) return ERP.toast(r.message || r.error, "error");
        ERP.toast("Request cancelled.", "success"); refresh();
      }
      if (act === "ap-sweep") {
        const r = await AP.sweep(pid);
        ERP.toast("Expired " + r.expired + ", reminded " + r.reminded + ".", "success"); refresh();
      }
    });
  };

  async function openDecisionModal(pid, id, decision, refresh) {
    const req = await AP.get(pid, id);
    if (!req) return;
    const m = ui.modal({
      title: (decision === "approved" ? "Approve " : "Reject ") + (req.refNumber || req.title),
      body: ui.form(ui.textarea("note", decision === "approved" ? "Note (optional)" : "Reason", "", 3)) +
        ui.alert("Approving will " + (req.then || "release") + " automatically.", "info"),
      foot: ui.btn("Cancel", { small: true, act: "apd-cancel" }) + " " + ui.btn(decision === "approved" ? "Approve" : "Reject", { small: true, primary: decision === "approved", danger: decision !== "approved", act: "apd-save" }),
    });
    const f = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=apd-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=apd-save]").onclick = async () => {
      const v = ui.collect(f, ["note"]);
      const r = await AP.decide(pid, id, { decision: decision, note: v.note });
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ui.closeModal();
      const a = r.action || {};
      ERP.toast(decision === "approved" ? ("Approved" + (a.applied ? " · " + a.action + " applied" : "")) : "Rejected.", "success");
      refresh();
    };
  }

  async function openRequest(pid, id, refresh) {
    const req = await AP.get(pid, id);
    if (!req) return;
    const auditRows = (req.audit || []).map((a) => ({ at: esc(ui.dateTime(a.at)), by: esc(a.by || "—"), type: esc(a.type), text: esc(a.text || "") }));
    ui.modal({
      title: req.number + " · " + req.title,
      size: "lg",
      body:
        '<div class="erp-defs">' +
          "<dt>For</dt><dd>" + esc(AP.refLabel(req.refType) + " " + (req.refNumber || "#" + req.refId)) + "</dd>" +
          "<dt>Client</dt><dd>" + esc(req.companyId != null ? String(req.companyId) : "—") + "</dd>" +
          "<dt>Amount</dt><dd>" + esc(req.amount != null ? ui.money(req.amount, req.currency) : "—") + "</dd>" +
          "<dt>Approver</dt><dd>" + esc((req.approverName || req.approverRole || "—") + " (" + req.approverType + ")") + "</dd>" +
          "<dt>Requested</dt><dd>" + esc(ui.dateTime(req.requestedAt)) + " by " + esc(req.requestedBy) + "</dd>" +
          "<dt>Due</dt><dd>" + esc(req.dueAt ? ui.dateTime(req.dueAt) : "—") + "</dd>" +
          "<dt>Status</dt><dd>" + ui.badge(AP.statusLabel(req.status), AP.statusTone(req.status)) + "</dd>" +
          (req.decisionNote ? "<dt>Decision note</dt><dd>" + esc(req.decisionNote) + "</dd>" : "") +
          (req.thenResult ? "<dt>Release</dt><dd>" + esc((req.thenResult.applied ? "Ran " : "No action ") + (req.thenResult.action || "")) + "</dd>" : "") +
        "</div><div class='erp-sep'></div><h4>Audit trail</h4>" +
        ui.table([{ key: "at", label: "When" }, { key: "type", label: "Event" }, { key: "text", label: "Detail" }, { key: "by", label: "By" }], auditRows, { emptyText: "No audit entries." }),
      foot: ui.btn("Close", { small: true, act: "apo-close" }),
    }).querySelector("[data-act=apo-close]").onclick = () => ui.closeModal();
  }

  AP.openDecisionModal = openDecisionModal;
  AP.openRequest = openRequest;
})();
