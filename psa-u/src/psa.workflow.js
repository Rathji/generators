/* ============================================================
   PSA-U — workflow / rules engine (Phase 2 · Task 12)
   A general event-driven rules engine shared by the service desk
   and, later, agreements, projects and invoices. A rule pairs an
   event trigger with conditions and a list of actions:

     on  <event>            e.g. ticket.created, ticket.breached, *
     when <conditions>      field / operator / value, ANDed together
     do   <actions>         assign, set status/priority/board, add a
                            note, notify, escalate, create a task,
                            add a tag

   The engine also owns inbound ROUTING: rules that match a new
   ticket and decide which board, owner, team and priority it lands
   on (Task 9). Every firing is written to an auditable rule log,
   and any rule can be dry-run against the live open tickets so an
   administrator can preview what it would do without changing
   anything.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const W = (ERP.workflow = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("workflow requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  const esc = (s) => (ERP.ui ? ERP.ui.esc(s) : String(s == null ? "" : s));

  W.EVENTS = [
    "ticket.created", "ticket.updated", "ticket.status_changed", "ticket.assigned",
    "ticket.note_added", "ticket.customer_update", "ticket.breached", "ticket.at_risk",
    "ticket.ageing", "ticket.merged",
    "time.entered", "timesheet.submitted", "timesheet.approved", "timesheet.rejected",
    "expense.submitted", "expense.approved", "expense.rejected",
    "agreement.activated", "agreement.renewed", "agreement.expired",
    "agreement.terminated", "agreement.charge_posted",
    "invoice.created", "invoice.posted", "invoice.paid", "invoice.partially_paid",
    "invoice.void", "payment.received", "credit.issued",
    "project.created", "project.activated", "project.status_changed", "project.completed",
    "project.on_hold", "project.milestone_ready", "project.milestone_invoiced",
    "opportunity.created", "opportunity.stage_changed", "opportunity.won", "opportunity.lost",
    "quote.created", "quote.sent", "quote.accepted", "quote.declined", "quote.expired", "quote.converted",
    "lead.created", "lead.converted", "activity.logged",
    "catalog.item_created", "catalog.item_updated", "catalog.rules_updated", "margin.overridden",
    "purchase_order.created", "purchase_order.submitted", "purchase_order.approved",
    "purchase_order.rejected", "purchase_order.ordered", "purchase_order.partially_received",
    "purchase_order.received", "purchase_order.cancelled", "purchase_order.closed",
    "receipt.posted", "stock.adjusted", "stock.low",
    "kb.article_created", "kb.article_updated", "kb.article_published", "kb.article_archived", "kb.ticket_drafted",
    "configuration.created", "configuration.updated", "configuration.drift",
    "alert.received", "alert.repeated", "alert.ticket_created", "alert.resolved",
    "approval.requested", "approval.approved", "approval.rejected", "approval.expired", "approval.cancelled", "approval.reminder",
    "portal.ticket_submitted", "portal.comment_added", "portal.approval_decided",
  ];

  /* ─────────────────────────── condition model ─────────────────────────── */

  W.CONDITION_FIELDS = [
    { id: "event", label: "Event", type: "text" },
    { id: "ticket.board", label: "Ticket · board", type: "text" },
    { id: "ticket.status", label: "Ticket · status", type: "text" },
    { id: "ticket.priority", label: "Ticket · priority", type: "text" },
    { id: "ticket.type", label: "Ticket · type", type: "text" },
    { id: "ticket.subtype", label: "Ticket · subtype", type: "text" },
    { id: "ticket.item", label: "Ticket · item", type: "text" },
    { id: "ticket.source", label: "Ticket · source", type: "text" },
    { id: "ticket.summary", label: "Ticket · summary", type: "text" },
    { id: "ticket.ownerId", label: "Ticket · owner id", type: "text" },
    { id: "ticket.teamId", label: "Ticket · team id", type: "text" },
    { id: "ticket.tags", label: "Ticket · tags", type: "text" },
    { id: "ticket.checklistOpen", label: "Ticket · open checklist items", type: "number" },
    { id: "company.status", label: "Client · status", type: "text" },
    { id: "company.type", label: "Client · type", type: "text" },
    { id: "company.name", label: "Client · name", type: "text" },
    { id: "sla.breached", label: "SLA · breached", type: "bool" },
    { id: "sla.atRisk", label: "SLA · at risk", type: "bool" },
    { id: "sla.target", label: "SLA · clock", type: "text" },
    { id: "changes.status.to", label: "Changed · status →", type: "text" },
    { id: "changes.priority.to", label: "Changed · priority →", type: "text" },
    { id: "changes.ownerId.to", label: "Changed · owner →", type: "text" },
    { id: "time.memberId", label: "Time · member id", type: "text" },
    { id: "time.minutes", label: "Time · minutes", type: "number" },
    { id: "time.billable", label: "Time · billable", type: "bool" },
    { id: "time.workType", label: "Time · work type", type: "text" },
    { id: "time.chargeRole", label: "Time · charge role", type: "text" },
    { id: "timesheet.memberId", label: "Timesheet · member id", type: "text" },
    { id: "expense.category", label: "Expense · category", type: "text" },
    { id: "expense.amount", label: "Expense · amount", type: "number" },
    { id: "expense.billable", label: "Expense · billable", type: "bool" },
    { id: "project.status", label: "Project · status", type: "text" },
    { id: "project.type", label: "Project · type", type: "text" },
    { id: "project.name", label: "Project · name", type: "text" },
    { id: "project.ownerId", label: "Project · owner id", type: "text" },
    { id: "project.billingMethod", label: "Project · billing method", type: "text" },
    { id: "project.progress", label: "Project · progress %", type: "number" },
    { id: "project.milestone", label: "Project · milestone name", type: "text" },
    { id: "opportunity.stage", label: "Opportunity · stage", type: "text" },
    { id: "opportunity.name", label: "Opportunity · name", type: "text" },
    { id: "opportunity.value", label: "Opportunity · value", type: "number" },
    { id: "opportunity.status", label: "Opportunity · status", type: "text" },
    { id: "opportunity.ownerId", label: "Opportunity · owner id", type: "text" },
    { id: "quote.status", label: "Quote · status", type: "text" },
    { id: "quote.total", label: "Quote · total", type: "number" },
    { id: "lead.status", label: "Lead · status", type: "text" },
    { id: "activity.type", label: "Activity · type", type: "text" },
    { id: "item.type", label: "Catalog item · type", type: "text" },
    { id: "item.classId", label: "Catalog item · class", type: "text" },
    { id: "item.trackInventory", label: "Catalog item · tracks stock", type: "bool" },
    { id: "purchaseOrder.status", label: "Purchase order · status", type: "text" },
    { id: "purchaseOrder.total", label: "Purchase order · total", type: "number" },
    { id: "purchaseOrder.vendorId", label: "Purchase order · vendor id", type: "text" },
    { id: "receipt.dropShip", label: "Receipt · drop-ship", type: "bool" },
    { id: "onHand", label: "Stock · on hand", type: "number" },
    { id: "article.visibility", label: "Article · visibility", type: "text" },
    { id: "article.status", label: "Article · status", type: "text" },
    { id: "article.categoryId", label: "Article · category id", type: "text" },
    { id: "configuration.type", label: "Configuration · type", type: "text" },
    { id: "configuration.status", label: "Configuration · status", type: "text" },
    { id: "configuration.companyId", label: "Configuration · client id", type: "text" },
    { id: "alert.severity", label: "Alert · severity", type: "text" },
    { id: "alert.alertType", label: "Alert · type", type: "text" },
    { id: "alert.status", label: "Alert · status", type: "text" },
    { id: "alert.companyId", label: "Alert · client id", type: "text" },
    { id: "alert.configId", label: "Alert · configuration id", type: "text" },
    { id: "approval.refType", label: "Approval · for", type: "text" },
    { id: "approval.status", label: "Approval · status", type: "text" },
    { id: "approval.approverType", label: "Approval · approver type", type: "text" },
    { id: "approval.amount", label: "Approval · amount", type: "number" },
  ];

  W.OPERATORS = [
    { id: "eq", label: "is" },
    { id: "ne", label: "is not" },
    { id: "contains", label: "contains" },
    { id: "not_contains", label: "does not contain" },
    { id: "starts_with", label: "starts with" },
    { id: "in", label: "is one of (comma list)" },
    { id: "not_in", label: "is not one of (comma list)" },
    { id: "gt", label: "greater than" },
    { id: "lt", label: "less than" },
    { id: "is_true", label: "is true", unary: true },
    { id: "is_false", label: "is false", unary: true },
    { id: "is_empty", label: "is empty", unary: true },
    { id: "is_not_empty", label: "is not empty", unary: true },
  ];

  W.ACTION_TYPES = [
    { id: "assign_owner", label: "Assign to a member" },
    { id: "assign_team", label: "Assign to a team" },
    { id: "set_status", label: "Set status" },
    { id: "set_priority", label: "Set priority" },
    { id: "set_board", label: "Move to a board" },
    { id: "add_note", label: "Add a note" },
    { id: "notify", label: "Send a notification" },
    { id: "escalate", label: "Escalate (reassign / raise priority)" },
    { id: "create_task", label: "Create a follow-up task" },
    { id: "add_tag", label: "Add a tag" },
  ];

  W.field = function (ctx, path) {
    const parts = String(path || "").split(".");
    let o = ctx;
    for (const p of parts) { if (o == null) return undefined; o = o[p]; }
    return o;
  };

  function str(v) {
    if (v == null) return "";
    if (Array.isArray(v)) return v.join(",");
    return String(v);
  }

  W.testCondition = function (c, ctx) {
    if (!c || !c.field) return true;
    const raw = W.field(ctx, c.field);
    const s = str(raw);
    const cv = c.value == null ? "" : String(c.value);
    const sl = s.toLowerCase(), cl = cv.toLowerCase();
    switch (c.op) {
      case "eq": return sl === cl;
      case "ne": return sl !== cl;
      case "contains": return sl.indexOf(cl) !== -1;
      case "not_contains": return sl.indexOf(cl) === -1;
      case "starts_with": return sl.indexOf(cl) === 0;
      case "in": return cl.split(",").map((x) => x.trim()).filter(Boolean).indexOf(sl) !== -1;
      case "not_in": return cl.split(",").map((x) => x.trim()).filter(Boolean).indexOf(sl) === -1;
      case "gt": return Number(raw) > Number(cv);
      case "lt": return Number(raw) < Number(cv);
      case "is_true": return raw === true || sl === "true" || sl === "1";
      case "is_false": return raw === false || sl === "false" || raw == null || sl === "0";
      case "is_empty": return s === "";
      case "is_not_empty": return s !== "";
      default: return true;
    }
  };

  W.matchConditions = function (conditions, ctx) {
    return (conditions || []).every((c) => W.testCondition(c, ctx));
  };

  W.conditionText = function (c) {
    const f = (W.CONDITION_FIELDS.find((x) => x.id === c.field) || {}).label || c.field;
    const o = (W.OPERATORS.find((x) => x.id === c.op) || {}).label || c.op;
    return f + " " + o + (o && c.value != null && c.value !== "" ? " " + c.value : "");
  };
  W.conditionsText = function (conditions) {
    if (!conditions || !conditions.length) return "always";
    return conditions.map(W.conditionText).join(" AND ");
  };
  W.actionText = function (a) {
    const v = a.memberId != null && a.memberId !== "" ? a.memberId
      : a.teamId != null && a.teamId !== "" ? a.teamId
      : a.status || a.priority || a.board || a.tag || a.summary || a.recipients || "";
    return ((W.ACTION_TYPES.find((x) => x.id === a.type) || {}).label || a.type) + (v !== "" ? " → " + v : "");
  };

  /* ─────────────────────────── record access ─────────────────────────── */

  async function nextId(pid) { return ten().nextId(await ten().records("provider", pid)); }
  async function put(pid, rec) {
    if (!isFinite(rec.id)) rec.id = await nextId(pid);
    return ten().upsert("provider", pid, rec);
  }

  W.newRule = (over) => Object.assign({
    kind: "workflowRule", name: "", event: "ticket.created", conditions: [], actions: [],
    stop: false, active: true, order: 100,
  }, over || {});
  W.newRoute = (over) => Object.assign({
    kind: "routingRule", name: "", conditions: [], board: null, priority: null,
    ownerId: null, teamId: null, active: true, order: 100,
  }, over || {});

  W.rules = async (pid) => (await ten().records("provider", pid, "workflowRule")).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.id - b.id));
  W.rule = async (pid, id) => (await W.rules(pid)).find((r) => String(r.id) === String(id)) || null;
  W.saveRule = async (pid, rec) => {
    const r = W.newRule(rec);
    if (!r.name) return { error: "name_required" };
    return put(pid, r);
  };
  W.removeRule = (pid, id) => ten().remove("provider", pid, (r) => r.kind === "workflowRule" && String(r.id) === String(id));

  W.routes = async (pid) => (await ten().records("provider", pid, "routingRule")).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.id - b.id));
  W.saveRoute = async (pid, rec) => {
    const r = W.newRoute(rec);
    if (!r.name) return { error: "name_required" };
    return put(pid, r);
  };
  W.removeRoute = (pid, id) => ten().remove("provider", pid, (r) => r.kind === "routingRule" && String(r.id) === String(id));

  /* First matching routing rule wins. Returns the board/priority/owner/team
     to apply to a brand-new ticket, or null. */
  W.route = async function (pid, ctx) {
    const routes = await W.routes(pid);
    for (const r of routes) {
      if (r.active === false) continue;
      if (W.matchConditions(r.conditions || [], ctx)) {
        return { rule: r, board: r.board || null, priority: r.priority || null, ownerId: r.ownerId != null && r.ownerId !== "" ? r.ownerId : null, teamId: r.teamId != null && r.teamId !== "" ? r.teamId : null };
      }
    }
    return null;
  };

  function matchEventPattern(pattern, event) {
    if (!pattern || pattern === "*") return true;
    if (pattern === event) return true;
    if (pattern.slice(-2) === ".*") return event.indexOf(pattern.slice(0, -1)) === 0;
    return false;
  }
  W.matchEvent = matchEventPattern;

  /* ─────────────────────────── applying actions ─────────────────────────── */

  function toId(v) { return v == null || v === "" ? null : (isFinite(v) ? Number(v) : v); }

  async function applyAction(pid, rule, a, ctx, opts, markDirty) {
    const t = ctx.ticket;
    const dry = !!opts.dryRun;
    switch (a.type) {
      case "set_status":
        if (t) { t.status = a.status; markDirty(); }
        return { type: a.type, value: a.status };
      case "set_priority":
        if (t) { t.priority = a.priority; markDirty(); }
        return { type: a.type, value: a.priority };
      case "set_board":
        if (t) { t.board = a.board; markDirty(); }
        return { type: a.type, value: a.board };
      case "assign_owner":
        if (t) { t.ownerId = toId(a.memberId); markDirty(); }
        return { type: a.type, value: toId(a.memberId) };
      case "assign_team":
        if (t) { t.teamId = toId(a.teamId); markDirty(); }
        return { type: a.type, value: toId(a.teamId) };
      case "add_tag":
        if (t && a.tag) {
          t.tags = (t.tags || []).concat([a.tag]).filter((v, i, arr) => arr.indexOf(v) === i);
          markDirty();
        }
        return { type: a.type, value: a.tag };
      case "escalate":
        if (t) {
          if (a.assignTo != null && a.assignTo !== "") t.ownerId = toId(a.assignTo);
          if (a.priority) t.priority = a.priority;
          markDirty();
          if (a.note && !dry && ERP.tickets && t.id != null) {
            await ERP.tickets.addNote(t.companyId, t.id, { body: a.note, internal: true, author: "Escalation rule: " + rule.name });
          }
        }
        return { type: a.type, value: toId(a.assignTo) };
      case "add_note":
        if (!dry && t && t.id != null && ERP.tickets) {
          await ERP.tickets.addNote(t.companyId, t.id, { body: a.body || "", internal: a.internal !== false, author: "Workflow: " + rule.name });
        }
        return { type: a.type, value: a.internal !== false ? "internal" : "customer" };
      case "notify":
        if (!dry && ERP.notify) {
          await ERP.notify.dispatchNow(ctx, {
            recipients: a.recipients, channel: a.channel, subject: a.subject, body: a.body,
            dedupeMinutes: a.dedupeMinutes == null ? 0 : a.dedupeMinutes, name: rule.name,
          });
        }
        return { type: a.type, value: a.recipients };
      case "create_task": {
        const companyId = t && t.companyId != null ? t.companyId : (ctx.company ? ctx.company.id : null);
        if (!dry && companyId != null && ERP.tickets) {
          const due = a.dueInDays != null && a.dueInDays !== "" ? new Date(Date.now() + Number(a.dueInDays) * 86400000).toISOString() : null;
          const seed = ERP.tickets.newTicket({
            companyId: companyId,
            summary: a.summary || ("Follow-up: " + (t && t.summary ? t.summary : rule.name)),
            detail: "Created by the workflow rule \"" + rule.name + "\" from " + (t ? t.number || ("#" + t.id) : "an event") + ".",
            board: a.board || (t && t.board) || null,
            priority: a.priority || (t && t.priority) || null,
            ownerId: a.ownerId != null && a.ownerId !== "" ? a.ownerId : (t ? t.ownerId : null),
            parentId: t ? t.id : null,
          });
          await ERP.tickets.save(companyId, seed, { system: true });
        }
        return { type: a.type, value: a.summary };
      }
      default:
        return { type: a.type, value: null, skipped: true };
    }
  }

  let depth = 0;
  const MAX_DEPTH = 3;

  async function logFire(pid, rule, event, ctx, actions, dryRun) {
    return put(pid, {
      kind: "workflowLog", ruleId: rule.id, ruleName: rule.name, event: event,
      ticketId: ctx.ticket ? ctx.ticket.id : null,
      ticketNumber: ctx.ticket ? ctx.ticket.number : null,
      companyId: ctx.ticket ? ctx.ticket.companyId : (ctx.company ? ctx.company.id : null),
      actions: actions, dryRun: !!dryRun, at: nowIso(),
    });
  }

  async function applyRule(pid, rule, event, ctx, opts) {
    const results = [];
    let dirty = false;
    for (const a of rule.actions || []) {
      const res = await applyAction(pid, rule, a, ctx, opts, () => { dirty = true; });
      results.push(res);
    }
    const t = ctx.ticket;
    if (dirty && t && t.id != null && t.companyId != null && !opts.dryRun && ERP.tickets) {
      await ERP.tickets.save(t.companyId, t, { system: true, fromRule: true });
    }
    if (!opts.dryRun) await logFire(pid, rule, event, ctx, results, false);
    return { ruleId: rule.id, ruleName: rule.name, actions: results, stopped: !!rule.stop };
  }

  /* Run every matching rule for an event; does NOT notify (see emit). */
  W.run = async function (event, ctx, opts) {
    opts = opts || {};
    const pid = opts.pid != null ? opts.pid : await ten().providerId();
    if (pid == null) return { event: event, fired: [], dryRun: !!opts.dryRun };
    const rules = (await W.rules(pid)).filter((r) => r.active !== false && matchEventPattern(r.event, event));
    const fired = [];
    for (const r of rules) {
      if (!W.matchConditions(r.conditions || [], ctx)) continue;
      fired.push(await applyRule(pid, r, event, ctx, opts));
      if (r.stop) break;
    }
    return { event: event, fired: fired, dryRun: !!opts.dryRun, count: fired.length };
  };

  /* Public event entry point. Runs the rules then hands the event to the
     notification engine. A small depth guard stops a rule that changes a
     ticket from re-triggering itself forever. */
  W.emit = async function (event, ctx) {
    if (depth >= MAX_DEPTH) return { event: event, fired: [], skipped: "recursion_guard" };
    depth++;
    try {
      const res = await W.run(event, ctx);
      if (ERP.notify) { try { await ERP.notify.emit(event, ctx); } catch (e) {} }
      /* Publish the domain event onto the pipeline bus (Phase 12 · Task 55).
         Guarded so a bus failure never breaks the domain action that emitted it. */
      if (ERP.pipeline) { try { await ERP.pipeline.publish(event, ctx); } catch (e) {} }
      return res;
    } finally {
      depth--;
    }
  };

  W.log = async function (pid, limit) {
    const list = (await ten().records("provider", pid, "workflowLog")).slice().reverse();
    return limit ? list.slice(0, limit) : list;
  };
  W.clearLog = (pid) => ten().remove("provider", pid, (r) => r.kind === "workflowLog");

  /* Dry-run: which currently-open tickets a rule would match, and what it
     would do — nothing is mutated and nothing is logged. */
  W.dryRun = async function (ruleId, opts) {
    opts = opts || {};
    const pid = opts.pid != null ? opts.pid : await ten().providerId();
    const rule = await W.rule(pid, ruleId);
    if (!rule) return { error: "not_found" };
    const tickets = await ERP.tickets.listAll({ open: true, companyId: opts.companyId });
    const matches = [];
    for (const t of tickets) {
      const ctx = await ERP.tickets.eventContext(rule.event, t, null, {}, null);
      if (!W.matchConditions(rule.conditions || [], ctx)) continue;
      matches.push({
        ticketId: t.id, number: t.number, summary: t.summary, companyId: t.companyId, companyName: t.__companyName,
        actions: (rule.actions || []).map(W.actionText),
      });
    }
    return { rule: rule, matches: matches, dryRun: true };
  };

  /* ─────────────────────────── condition / action editors ─────────────────────────── */

  function condRow(c) {
    c = c || {};
    return '<div class="erp-cond-row" data-cond-row>' +
      '<select data-cond-field>' + W.CONDITION_FIELDS.map((f) => '<option value="' + esc(f.id) + '"' + (f.id === c.field ? " selected" : "") + ">" + esc(f.label) + "</option>").join("") + "</select>" +
      '<select data-cond-op>' + W.OPERATORS.map((o) => '<option value="' + esc(o.id) + '"' + (o.id === c.op ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select>" +
      '<input type="text" data-cond-value value="' + esc(c.value == null ? "" : c.value) + '" placeholder="value">' +
      '<button type="button" class="icon-btn" data-wf-del-cond aria-label="Remove condition">&times;</button>' +
      "</div>";
  }

  W.conditionsHtml = function (conditions) {
    const rows = (conditions || []).map(condRow).join("");
    return '<div class="field"><label>Conditions</label>' +
      '<div class="erp-cond-list" data-cond-list>' + rows + "</div>" +
      '<button type="button" class="btn btn-ghost btn-sm" data-wf-add-cond>Add condition</button>' +
      '<div class="hint">Every condition must match. Leave empty for "always".</div></div>';
  };

  W.readConditions = function (scope) {
    return Array.from((scope || document).querySelectorAll("[data-cond-row]")).map((r) => ({
      field: (r.querySelector("[data-cond-field]") || {}).value,
      op: (r.querySelector("[data-cond-op]") || {}).value,
      value: (r.querySelector("[data-cond-value]") || {}).value,
    })).filter((c) => c.field && c.op);
  };

  W.wireConditions = function (root) {
    const list = root.querySelector("[data-cond-list]");
    if (list && !list.__wfWired) {
      list.__wfWired = true;
      list.addEventListener("click", (e) => {
        const b = e.target.closest("[data-wf-del-cond]");
        if (b) { const row = b.closest("[data-cond-row]"); if (row) row.remove(); }
      });
    }
    const add = root.querySelector("[data-wf-add-cond]");
    if (add && !add.__wfWired) {
      add.__wfWired = true;
      add.addEventListener("click", () => { if (list) list.insertAdjacentHTML("beforeend", condRow({ op: "eq" })); });
    }
  };

  function select(name, opts, val, blank) {
    return '<select name="' + esc(name) + '">' + (blank ? '<option value="">' + esc(blank) + "</option>" : "") +
      (opts || []).map((o) => '<option value="' + esc(o.value) + '"' + (String(o.value) === String(val == null ? "" : val) ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select>";
  }

  W.actionParamsHtml = function (type, a, o) {
    a = a || {}; o = o || {};
    const memberOpts = o.members || [], teamOpts = o.teams || [];
    switch (type) {
      case "assign_owner": return '<span class="erp-act-label">to</span>' + select("memberId", memberOpts, a.memberId, "— choose member —");
      case "assign_team": return '<span class="erp-act-label">to</span>' + select("teamId", teamOpts, a.teamId, "— choose team —");
      case "set_status": return '<span class="erp-act-label">status</span>' + select("status", o.statuses || [], a.status, "— status —");
      case "set_priority": return '<span class="erp-act-label">priority</span>' + select("priority", o.priorities || [], a.priority, "— priority —");
      case "set_board": return '<span class="erp-act-label">board</span>' + select("board", o.boards || [], a.board, "— board —");
      case "add_tag": return '<input type="text" name="tag" placeholder="tag" value="' + esc(a.tag || "") + '">';
      case "add_note": return '<textarea name="body" rows="2" placeholder="Note text…">' + esc(a.body || "") + "</textarea>" +
        '<label class="erp-check"><input type="checkbox" name="internal"' + (a.internal !== false ? " checked" : "") + "> internal only</label>";
      case "notify": return '<input type="text" name="recipients" placeholder="owner, team, account_manager" value="' + esc(a.recipients == null ? "" : (Array.isArray(a.recipients) ? a.recipients.join(", ") : a.recipients)) + '">' +
        select("channel", [{ value: "inapp", label: "In-app" }, { value: "email", label: "E-mail" }, { value: "both", label: "Both" }], a.channel || "inapp") +
        '<input type="text" name="subject" placeholder="Subject" value="' + esc(a.subject || "") + '">' +
        '<textarea name="body" rows="2" placeholder="Message…">' + esc(a.body || "") + "</textarea>";
      case "escalate": return select("assignTo", memberOpts, a.assignTo, "— keep owner —") + select("priority", o.priorities || [], a.priority, "— keep priority —") +
        '<input type="text" name="note" placeholder="Escalation note" value="' + esc(a.note || "") + '">';
      case "create_task": return '<input type="text" name="summary" placeholder="Task summary" value="' + esc(a.summary || "") + '">' +
        select("board", o.boards || [], a.board, "— board —") + select("priority", o.priorities || [], a.priority, "— priority —") +
        '<input type="number" name="dueInDays" placeholder="due (days)" value="' + esc(a.dueInDays == null ? "" : a.dueInDays) + '">';
      default: return "";
    }
  };

  function actionRow(a, o) {
    a = a || {};
    const type = a.type || "add_note";
    return '<div class="erp-act-row" data-act-row>' +
      '<select data-act-type>' + W.ACTION_TYPES.map((t) => '<option value="' + esc(t.id) + '"' + (t.id === type ? " selected" : "") + ">" + esc(t.label) + "</option>").join("") + "</select>" +
      '<span class="erp-act-params" data-act-params>' + W.actionParamsHtml(type, a, o) + "</span>" +
      '<button type="button" class="icon-btn" data-wf-del-act aria-label="Remove action">&times;</button>' +
      "</div>";
  }

  W.actionsHtml = function (actions, o) {
    const rows = (actions || []).map((a) => actionRow(a, o)).join("");
    return '<div class="field"><label>Actions</label>' +
      '<div class="erp-act-list" data-act-list>' + rows + "</div>" +
      '<button type="button" class="btn btn-ghost btn-sm" data-wf-add-act>Add action</button>' +
      '<div class="hint">Actions run top to bottom; ticket changes are saved once per rule.</div></div>';
  };

  W.readActions = function (scope) {
    return Array.from((scope || document).querySelectorAll("[data-act-row]")).map((r) => {
      const out = { type: (r.querySelector("[data-act-type]") || {}).value };
      r.querySelectorAll("[name]").forEach((i) => {
        if (i.type === "checkbox") out[i.name] = i.checked;
        else if (i.type === "number") out[i.name] = i.value === "" ? null : Number(i.value);
        else out[i.name] = i.value;
      });
      if (out.recipients != null) out.recipients = String(out.recipients).split(",").map((s) => s.trim()).filter(Boolean);
      return out;
    }).filter((a) => a.type);
  };

  W.wireActions = function (root, o) {
    const list = root.querySelector("[data-act-list]");
    if (list && !list.__wfWired) {
      list.__wfWired = true;
      list.addEventListener("click", (e) => {
        const b = e.target.closest("[data-wf-del-act]");
        if (b) { const row = b.closest("[data-act-row]"); if (row) row.remove(); }
      });
      list.addEventListener("change", (e) => {
        const sel = e.target.closest("[data-act-type]");
        if (!sel) return;
        const row = sel.closest("[data-act-row]");
        const p = row && row.querySelector("[data-act-params]");
        if (p) p.innerHTML = W.actionParamsHtml(sel.value, {}, o);
      });
    }
    const add = root.querySelector("[data-wf-add-act]");
    if (add && !add.__wfWired && list) {
      add.__wfWired = true;
      add.addEventListener("click", () => list.insertAdjacentHTML("beforeend", actionRow({ type: "add_note" }, o)));
    }
  };

  /* ─────────────────────────── option lists ─────────────────────────── */

  async function editorOptions(pid) {
    const [members, teams, boards, statuses, priorities] = await Promise.all([
      ERP.members.members(),
      ERP.members.teams(),
      ERP.taxonomy.optionList(pid, "board"),
      ERP.taxonomy.optionList(pid, "ticketStatus"),
      ERP.taxonomy.optionList(pid, "priority"),
    ]);
    return {
      members: members.map((m) => ({ value: m.id, label: m.name })),
      teams: teams.map((t) => ({ value: t.id, label: t.name })),
      boards: boards, statuses: statuses, priorities: priorities,
    };
  }

  /* ─────────────────────────── seeding ─────────────────────────── */

  W.ensureSeed = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    const hasRules = (await W.rules(pid)).length, hasRoutes = (await W.routes(pid)).length;
    if (hasRules || hasRoutes) return { skipped: "already_seeded" };
    await W.saveRule(pid, W.newRule({
      name: "P1 incidents jump the queue", event: "ticket.created", order: 10,
      conditions: [{ field: "ticket.priority", op: "eq", value: "p1" }],
      actions: [
        { type: "set_status", status: "in-progress" },
        { type: "notify", recipients: "owner, account_manager", channel: "both", subject: "P1 raised: {ticket.number}", body: "{company.name} — {ticket.summary}" },
      ],
    }));
    await W.saveRule(pid, W.newRule({
      name: "Log a note when a ticket is merged", event: "ticket.merged", order: 90,
      conditions: [], actions: [{ type: "notify", recipients: "owner", channel: "inapp", subject: "Merge: {ticket.number}", body: "{ticket.summary}" }],
    }));
    await W.saveRoute(pid, W.newRoute({
      name: "Priority 1 → managed services", order: 10,
      conditions: [{ field: "ticket.priority", op: "eq", value: "p1" }], board: "managed",
    }));
    await W.saveRoute(pid, W.newRoute({
      name: "Everything else → service desk", order: 100, conditions: [], board: "service-desk",
    }));
    return { seeded: true };
  };

  /* ─────────────────────────── configuration UI ─────────────────────────── */

  async function openRuleModal(pid, rec, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("workflow.edit")) return;
    const o = await editorOptions(pid);
    const r = rec || W.newRule();
    const fields =
      ui.text("name", "Rule name", r.name) +
      ui.select("event", "Trigger event", [{ value: "*", label: "Any event" }].concat(W.EVENTS).map((e) => ({ value: e, label: e })), r.event) +
      W.conditionsHtml(r.conditions) +
      W.actionsHtml(r.actions, o) +
      '<div class="erp-form-row">' + ui.number("order", "Order", r.order) + "</div>" +
      ui.check("stop", "Stop processing further rules once this one fires", r.stop) +
      ui.check("active", "Active", r.active !== false);
    const modal = ui.modal({
      title: rec ? "Edit workflow rule" : "New workflow rule",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "wf-cancel" }) + " " + ui.btn(rec ? "Save rule" : "Create rule", { small: true, primary: true, act: "wf-save" }),
    });
    W.wireConditions(modal);
    W.wireActions(modal, o);
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=wf-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=wf-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "event", "order", "stop", "active"]);
      if (!v.name) { ERP.toast("A rule name is required.", "error"); return; }
      btn.disabled = true;
      const res = await W.saveRule(pid, Object.assign({}, r, v, { conditions: W.readConditions(form), actions: W.readActions(form) }));
      ui.closeModal();
      ERP.toast(res.error ? "Could not save." : "Rule saved.", res.error ? "error" : "success");
      refresh();
    };
  }

  async function openRouteModal(pid, rec, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("routing.edit")) return;
    const o = await editorOptions(pid);
    const r = rec || W.newRoute();
    const fields =
      ui.text("name", "Routing rule name", r.name) +
      W.conditionsHtml(r.conditions) +
      '<div class="erp-form-row">' +
        ui.select("board", "Send to board", [{ value: "", label: "— unchanged —" }].concat(o.boards), r.board) +
        ui.select("priority", "Set priority", [{ value: "", label: "— unchanged —" }].concat(o.priorities), r.priority) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("ownerId", "Assign to member", [{ value: "", label: "— unchanged —" }].concat(o.members), r.ownerId) +
        ui.select("teamId", "Assign to team", [{ value: "", label: "— unchanged —" }].concat(o.teams), r.teamId) +
      "</div>" +
      ui.number("order", "Order", r.order) +
      ui.check("active", "Active", r.active !== false);
    const modal = ui.modal({
      title: rec ? "Edit routing rule" : "New routing rule",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "rt-cancel" }) + " " + ui.btn(rec ? "Save" : "Create", { small: true, primary: true, act: "rt-save" }),
    });
    W.wireConditions(modal);
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=rt-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=rt-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "board", "priority", "ownerId", "teamId", "order", "active"]);
      if (!v.name) { ERP.toast("A rule name is required.", "error"); return; }
      btn.disabled = true;
      const res = await W.saveRoute(pid, Object.assign({}, r, v, {
        conditions: W.readConditions(form),
        board: v.board || null, priority: v.priority || null,
        ownerId: v.ownerId === "" ? null : v.ownerId, teamId: v.teamId === "" ? null : v.teamId,
      }));
      ui.closeModal();
      ERP.toast(res.error ? "Could not save." : "Routing rule saved.", res.error ? "error" : "success");
      refresh();
    };
  }

  async function openDryRunModal(pid, rule, refresh) {
    const ui = ERP.ui;
    const res = await W.dryRun(rule.id, { pid: pid });
    const rows = (res.matches || []).map((m) => ({
      ticket: "<b>#" + ui.esc(m.number || m.ticketId) + "</b><div class=\"erp-sub\">" + ui.esc(m.companyName || "") + "</div>",
      summary: ui.esc(m.summary || "—"),
      actions: ui.esc((m.actions || []).join("; ") || "—"),
    }));
    ui.modal({
      title: "Dry run · " + rule.name,
      size: "lg",
      body:
        ui.alert("Preview only — nothing is changed and nothing is logged.", "info") +
        '<p class="erp-sub">Trigger <b>' + ui.esc(rule.event) + "</b> · " + ui.esc(W.conditionsText(rule.conditions)) + "</p>" +
        ui.table([
          { key: "ticket", label: "Ticket" },
          { key: "summary", label: "Summary" },
          { key: "actions", label: "Would run" },
        ], rows, { emptyText: "No open tickets currently match this rule." }),
      foot: ui.btn("Close", { small: true, act: "wf-dr-close" }),
    });
    const m = document.getElementById("uiModal");
    m.querySelector("[data-act=wf-dr-close]").onclick = () => ui.closeModal();
  }

  async function renderRules(panel, pid, refresh) {
    const ui = ERP.ui;
    const rules = await W.rules(pid);
    const canEdit = ERP.security.can("workflow.edit");
    const rows = rules.map((r) => ({
      order: ui.esc(r.order),
      name: "<b>" + ui.esc(r.name) + "</b>" + (r.active === false ? " " + ui.badge("inactive", "muted") : ""),
      event: ui.badge(r.event, "info"),
      when: ui.esc(W.conditionsText(r.conditions)),
      actions: ui.esc((r.actions || []).map(W.actionText).join("; ") || "—"),
      actionsCell: (ui.btn("Dry run", { small: true, act: "wf-dry", arg: r.id }) + " " +
        (canEdit ? ui.btn("Edit", { small: true, act: "wf-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "wf-del", arg: r.id }) : "")),
    }));
    panel.innerHTML = ui.table([
      { key: "order", label: "Order" },
      { key: "name", label: "Rule" },
      { key: "event", label: "On" },
      { key: "when", label: "When" },
      { key: "actions", label: "Do" },
      { key: "actionsCell", label: "", align: "right" },
    ], rows, { emptyText: "No workflow rules yet." });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "wf-dry") return openDryRunModal(pid, rules.find((r) => String(r.id) === String(arg)), refresh);
      if (act === "wf-edit") return openRuleModal(pid, rules.find((r) => String(r.id) === String(arg)), refresh);
      if (act === "wf-del" && await ui.confirm({ title: "Delete rule?", message: "The rule stops firing immediately.", danger: true, okLabel: "Delete" })) {
        await W.removeRule(pid, arg); ERP.toast("Rule deleted.", "success"); refresh();
      }
    });
  }

  async function renderRoutes(panel, pid, refresh) {
    const ui = ERP.ui;
    const routes = await W.routes(pid);
    const canEdit = ERP.security.can("routing.edit");
    const [members, teams] = await Promise.all([ERP.members.members(), ERP.members.teams()]);
    const nameOf = (ids, list) => { const x = (list || []).find((m) => String(m.id) === String(ids)); return x ? x.name : (ids == null || ids === "" ? "—" : String(ids)); };
    const rows = routes.map((r) => ({
      order: ui.esc(r.order),
      name: "<b>" + ui.esc(r.name) + "</b>" + (r.active === false ? " " + ui.badge("inactive", "muted") : ""),
      when: ui.esc(W.conditionsText(r.conditions)),
      board: ui.esc(r.board || "—"),
      priority: ui.esc(r.priority || "—"),
      owner: ui.esc(r.ownerId != null && r.ownerId !== "" ? nameOf(r.ownerId, members) : "—"),
      team: ui.esc(r.teamId != null && r.teamId !== "" ? nameOf(r.teamId, teams) : "—"),
      actions: canEdit ? ui.btn("Edit", { small: true, act: "rt-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "rt-del", arg: r.id }) : "",
    }));
    panel.innerHTML =
      ui.alert("Routing runs when a ticket is created: the first matching rule sets its board, priority, owner and team. Rules are evaluated in order.", "info") +
      ui.table([
        { key: "order", label: "Order" },
        { key: "name", label: "Rule" },
        { key: "when", label: "When" },
        { key: "board", label: "Board" },
        { key: "priority", label: "Priority" },
        { key: "owner", label: "Owner" },
        { key: "team", label: "Team" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No routing rules yet — inbound tickets keep the board they were logged against." });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "rt-edit") return openRouteModal(pid, routes.find((r) => String(r.id) === String(arg)), refresh);
      if (act === "rt-del" && await ui.confirm({ title: "Delete routing rule?", danger: true, okLabel: "Delete" })) {
        await W.removeRoute(pid, arg); ERP.toast("Routing rule deleted.", "success"); refresh();
      }
    });
  }

  async function renderLog(panel, pid, refresh) {
    const ui = ERP.ui;
    const logs = await W.log(pid, 60);
    const rows = logs.map((l) => ({
      when: ui.dateTime(l.at),
      event: ui.badge(l.event, "info"),
      rule: ui.esc(l.ruleName),
      ticket: l.ticketNumber ? "#" + ui.esc(l.ticketNumber) : (l.ticketId != null ? "#" + ui.esc(l.ticketId) : "—"),
      actions: ui.esc((l.actions || []).map((a) => a.type + (a.value != null && a.value !== "" ? "=" + a.value : "")).join(", ") || "—"),
    }));
    panel.innerHTML =
      '<div class="erp-btn-row">' + ui.btn("Clear log", { act: "wl-clear" }) + "</div>" +
      ui.table([
        { key: "when", label: "When" },
        { key: "event", label: "Event" },
        { key: "rule", label: "Rule" },
        { key: "ticket", label: "Ticket" },
        { key: "actions", label: "Actions" },
      ], rows, { emptyText: "No rules have fired yet." });
    ui.bind(panel, "click", "[data-act=wl-clear]", async () => {
      await W.clearLog(pid); ERP.toast("Rule log cleared.", "success"); refresh();
    });
  }

  W.renderConfig = async function (panel, refresh, view) {
    const ui = ERP.ui;
    const pid = await ten().providerId();
    if (pid == null) { panel.innerHTML = ui.alert("Create a service provider first.", "warn"); return; }
    const v = view || panel.__wfView || "rules";
    panel.__wfView = v;
    const defs = [
      { id: "rules", label: "Rules" },
      { id: "routing", label: "Routing" },
      { id: "log", label: "Firing log" },
    ];
    const addBtn =
      v === "rules" ? ui.btn("Add rule", { primary: true, act: "wf-new" }) :
      v === "routing" ? ui.btn("Add routing rule", { primary: true, act: "rt-new" }) : "";
    panel.innerHTML =
      '<div class="tabs erp-tabs" role="tablist">' +
        defs.map((d) => '<button class="tab' + (d.id === v ? " active" : "") + '" data-wf-view="' + d.id + '">' + ui.esc(d.label) + "</button>").join("") +
      "</div>" + (addBtn ? '<div class="erp-btn-row" style="margin:12px 0">' + addBtn + "</div>" : "") +
      '<div data-wf-panel></div>';
    ui.bind(panel, "click", "[data-wf-view]", (el) => {
      panel.__wfView = el.getAttribute("data-wf-view");
      W.renderConfig(panel, refresh, panel.__wfView);
    });
    ui.bind(panel, "click", "[data-act=wf-new]", () => openRuleModal(pid, null, refresh));
    ui.bind(panel, "click", "[data-act=rt-new]", () => openRouteModal(pid, null, refresh));
    const host = panel.querySelector("[data-wf-panel]");
    if (v === "rules") await renderRules(host, pid, refresh);
    else if (v === "routing") await renderRoutes(host, pid, refresh);
    else await renderLog(host, pid, refresh);
  };
})();
