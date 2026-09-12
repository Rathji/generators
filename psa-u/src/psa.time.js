/* ============================================================
   PSA-U — time entry capture & billing-rate resolution
   (Phase 4 · Tasks 19 & 22)

   Time is what a services business sells, so this engine is the
   ledger the rest of the platform bills from. It covers:

     • entries      — a captured slice of work: who did it, when,
                      how long, for which client/ticket/project (or
                      general internal work), classified by work
                      type, charge role and charge code, with notes
                      and a billable / non-billable flag. Duration
                      is either a start/end pair or a straight
                      number of minutes, so both a stopwatch and a
                      "2h 30m" entry are first-class.
     • timers       — one running stopwatch per member, so a
                      technician can start work on a ticket and stop
                      it later; stopping turns the elapsed time into
                      an ordinary entry.
     • rate         — every entry records WHICH rule produced its
                      billable rate, resolved through a documented
                      precedence (Task 22). Invoice math is therefore
                      explainable after the fact: an entry carries the
                      rate, its source scope, the rule that matched and
                      a human-readable reason.
     • timesheets   — weekly submission/approval lives in
                      psa.timesheets.js; this file owns the entries it
                      groups.
     • expenses     — psa.expenses.js.

   Storage: entries, timers and rate rules live in the ACTIVE
   PROVIDER's document (kind "timeEntry" / "timer" / "rateRule"),
   not in a client company document. Time is inherently
   provider-wide — a weekly timesheet spans clients, approval is a
   management action, and rate rules are negotiated at the
   provider level — so keeping it together makes the day/week grid,
   cross-client totals and the approval queue a single read.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const T = (ERP.time = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("time requires the tenancy service");
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

  /* ─────────────────────────── dates ───────────────────────────
     Everything is stored against a local calendar day (YYYY-MM-DD)
     so that a week is the same week the technician worked, with no
     UTC drift. Helpers here are shared by the timesheet engine. */

  function localDay(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  T.localDay = localDay;

  T.dayOf = function (ms) {
    if (ms == null || ms === "") return "";
    const d = typeof ms === "string" ? new Date(ms) : new Date(Number(ms));
    return isNaN(d.getTime()) ? "" : localDay(d);
  };

  T.parseDay = function (dateStr) {
    const d = new Date(String(dateStr) + "T12:00:00");
    return isNaN(d.getTime()) ? null : d;
  };

  /* Monday of the week containing a date. */
  T.weekStart = function (dateStr) {
    const d = T.parseDay(dateStr || ui.today());
    if (!d) return ui.today();
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return localDay(d);
  };

  T.weekEnd = (start) => ui.addDays(start, 6);
  T.weekDays = function (start) {
    const out = [];
    for (let i = 0; i < 7; i++) out.push(ui.addDays(start, i));
    return out;
  };
  T.inWeek = function (dateStr, start) {
    return dateStr >= start && dateStr <= T.weekEnd(start);
  };

  const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  T.dayLabel = function (dateStr) {
    const d = T.parseDay(dateStr);
    if (!d) return dateStr || "—";
    return WEEKDAY[(d.getDay() + 6) % 7] + " " + d.getDate() + " " + MONTH[d.getMonth()];
  };
  T.weekLabel = function (start) {
    return T.dayLabel(start) + " – " + T.dayLabel(T.weekEnd(start)) + " " + (T.parseDay(start) || new Date()).getFullYear();
  };

  T.minutesLabel = function (mins) {
    const m = Math.max(0, Math.round(Number(mins) || 0));
    const h = Math.floor(m / 60);
    return (h ? h + "h " : "") + (m % 60) + "m";
  };

  /* ─────────────────────────── taxonomy helpers ─────────────────────────── */

  async function tax(pid, category) {
    try { return await ERP.taxonomy.list(pid, category); } catch (e) { return []; }
  }
  async function taxByCode(pid, category, code) {
    return (await tax(pid, category)).find((r) => String(r.code) === String(code)) || null;
  }
  T.taxByCode = taxByCode;

  async function taxonomyMaps(pid) {
    const [work, roles, codes, cats] = await Promise.all([
      tax(pid, "workType"), tax(pid, "chargeRole"), tax(pid, "chargeCode"), tax(pid, "expenseCategory"),
    ]);
    return {
      workType: work, chargeRole: roles, chargeCode: codes, expenseCategory: cats,
      workBy: Object.fromEntries(work.map((r) => [String(r.code), r])),
      roleBy: Object.fromEntries(roles.map((r) => [String(r.code), r])),
      codeBy: Object.fromEntries(codes.map((r) => [String(r.code), r])),
    };
  }
  T.taxonomyMaps = taxonomyMaps;

  function labelOf(rec, code) { return (rec && rec.label) || code || "—"; }
  T.labelOf = labelOf;

  /* Billable an entry unless a work type or charge code says otherwise; an
     explicit truthy/falsey flag from the operator always wins. */
  T.deriveBillable = function (workRec, codeRec, explicit) {
    if (typeof explicit === "boolean") return explicit;
    let b = true;
    if (workRec && workRec.billable === false) b = false;
    if (codeRec && codeRec.billable === false) b = false;
    return b;
  };

  /* ─────────────────────────── rate rules (Task 22) ───────────────────────────
     A rate rule resolves the billable hourly rate for a piece of work. The
     precedence is fixed and documented, most specific first:

       1. agreement     — an override on the client's active agreement
       2. work-role     — a provider rate for a specific work type + charge role
       3. priority      — a rate that applies to tickets of a given priority
       4. client        — a rate negotiated for one client
       5. default       — the charge role's rate, else the member's charge rate

     Every resolution returns the winning rule AND a chain describing each
     rung it considered, so the UI (and an invoice) can explain the number. */

  T.RATE_SCOPES = [
    { id: "agreement", label: "Agreement override", desc: "A rate on the client's active agreement for this work type." },
    { id: "work-role", label: "Work type / role", desc: "A provider-wide rate for a specific work type and charge role." },
    { id: "priority", label: "Ticket priority", desc: "A rate applied to work on tickets of a given priority." },
    { id: "client", label: "Client-specific", desc: "A rate negotiated for one client." },
    { id: "default", label: "Default", desc: "The charge role's rate, else the member's standard charge rate." },
  ];
  T.scopeLabel = (id) => (T.RATE_SCOPES.find((s) => s.id === id) || {}).label || id || "—";

  T.newRateRule = (over) => Object.assign({
    kind: "rateRule", id: null, name: "", scope: "client",
    companyId: null, agreementId: null,
    workType: "", chargeRole: "", priority: "",
    amount: 0, currency: "", active: true, order: 100, notes: "",
    createdAt: null, updatedAt: null,
  }, over || {});

  T.rateRules = async function (pid) {
    const list = await ten().records("provider", pid, "rateRule");
    return list.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));
  };
  T.rateRule = async (pid, id) => (await T.rateRules(pid)).find((r) => String(r.id) === String(id)) || null;

  T.saveRateRule = async function (pid, rec) {
    if (!ERP.security.enforce("rates.edit")) return { error: "forbidden" };
    const r = T.newRateRule(rec);
    if (!r.name) r.name = T.scopeLabel(r.scope) + " rate";
    r.amount = Number(r.amount) || 0;
    r.id = r.id == null || r.id === "" ? null : Number(r.id);
    if (r.id == null || !isFinite(r.id)) r.id = null;
    if (r.id == null) r.createdAt = nowIso();
    r.updatedAt = nowIso();
    await put(pid, r);
    return { record: r };
  };

  T.removeRateRule = async function (pid, id) {
    if (!ERP.security.enforce("rates.edit")) return { error: "forbidden" };
    return ten().remove("provider", pid, (r) => r.kind === "rateRule" && String(r.id) === String(id));
  };

  /* The client's active agreements (Phase 5 will populate these). Kept here so
     the agreement rung of the precedence works the moment agreements land. */
  async function activeAgreements(companyId) {
    if (companyId == null || companyId === "") return [];
    try {
      const recs = await ten().records("company", companyId, "agreement");
      return recs.filter((a) => a.status !== "expired" && a.status !== "terminated" && a.status !== "cancelled");
    } catch (e) { return []; }
  }
  T.activeAgreements = activeAgreements;

  function matchesScope(rule, ctx, agreementIds) {
    if (rule.scope === "agreement") {
      if (rule.agreementId == null || agreementIds.indexOf(String(rule.agreementId)) === -1) return false;
    } else if (rule.scope === "work-role") {
      if (!rule.workType || String(rule.workType) !== String(ctx.workType || "")) return false;
    } else if (rule.scope === "priority") {
      if (!rule.priority || String(rule.priority) !== String(ctx.priority || "")) return false;
    } else if (rule.scope === "client") {
      if (rule.companyId == null || String(rule.companyId) !== String(ctx.companyId)) return false;
    } else if (rule.scope !== "default") {
      return false;
    }
    if (rule.chargeRole && String(rule.chargeRole) !== String(ctx.chargeRole || "")) return false;
    if (rule.scope !== "work-role" && rule.workType && String(rule.workType) !== String(ctx.workType || "")) return false;
    if (rule.scope !== "priority" && rule.priority && String(rule.priority) !== String(ctx.priority || "")) return false;
    if (rule.scope !== "client" && rule.scope !== "agreement" && rule.companyId != null && String(rule.companyId) !== String(ctx.companyId)) return false;
    return true;
  }
  T.matchesScope = matchesScope;

  async function defaultRate(pid, ctx) {
    const maps = await taxonomyMaps(pid);
    const role = maps.roleBy[String(ctx.chargeRole || "")];
    if (role && isFinite(Number(role.rate)) && Number(role.rate) > 0) {
      return { amount: Number(role.rate), reason: "Charge role \"" + labelOf(role, ctx.chargeRole) + "\" default rate" };
    }
    const member = ctx.memberId != null && ctx.memberId !== "" ? await ERP.members.member(ctx.memberId) : null;
    if (member && Number(member.hourlyRate) > 0) {
      return { amount: Number(member.hourlyRate), reason: member.name + "'s standard charge rate" };
    }
    return { amount: 0, reason: "No rate configured — defaulting to zero" };
  }
  T.defaultRate = defaultRate;

  /* Resolve the rate for a piece of work. ctx:
       { companyId, ticketId, ticket, memberId, workType, chargeRole, priority, currency } */
  T.resolve = async function (pid, ctx) {
    ctx = ctx || {};
    const rules = (await T.rateRules(pid)).filter((r) => r.active !== false);
    const agreements = await activeAgreements(ctx.companyId);
    const agreementIds = agreements.map((a) => String(a.id));
    const chain = [];

    for (const scope of T.RATE_SCOPES) {
      if (scope.id === "default") continue;
      const candidates = rules.filter((r) => r.scope === scope.id && matchesScope(r, ctx, agreementIds));
      if (!candidates.length) { chain.push({ scope: scope.id, label: scope.label, applied: false }); continue; }
      const r = candidates[0];
      const amount = Number(r.amount) || 0;
      chain.push({ scope: scope.id, label: scope.label, applied: true, ruleId: r.id, ruleName: r.name, amount: amount, currency: r.currency || "" });
      return {
        amount: amount, currency: r.currency || ctx.currency || "", source: scope.id, label: scope.label,
        ruleId: r.id, ruleName: r.name,
        reason: T.describeRule(r, ctx),
        chain: chain,
      };
    }

    const activeDefault = rules.find((r) => r.scope === "default");
    if (activeDefault) {
      const amount = Number(activeDefault.amount) || 0;
      chain.push({ scope: "default", label: T.scopeLabel("default"), applied: true, ruleId: activeDefault.id, ruleName: activeDefault.name, amount: amount, currency: activeDefault.currency || "" });
      return {
        amount: amount, currency: activeDefault.currency || ctx.currency || "", source: "default", label: T.scopeLabel("default"),
        ruleId: activeDefault.id, ruleName: activeDefault.name,
        reason: "Default rate rule \"" + activeDefault.name + "\"",
        chain: chain,
      };
    }

    const fb = await defaultRate(pid, ctx);
    chain.push({ scope: "default", label: T.scopeLabel("default"), applied: true, ruleId: null, ruleName: "", amount: fb.amount });
    return {
      amount: fb.amount, currency: ctx.currency || "", source: "default", label: T.scopeLabel("default"),
      ruleId: null, ruleName: "", reason: fb.reason, chain: chain,
    };
  };

  T.describeRule = function (rule, ctx) {
    const bits = [];
    if (rule.scope === "agreement") bits.push("agreement #" + rule.agreementId);
    if (rule.scope === "work-role") bits.push("work type \"" + rule.workType + "\"" + (rule.chargeRole ? " + role \"" + rule.chargeRole + "\"" : ""));
    if (rule.scope === "priority") bits.push("priority \"" + rule.priority + "\"");
    if (rule.scope === "client") bits.push("client #" + rule.companyId);
    if (rule.chargeRole && rule.scope !== "work-role") bits.push("role \"" + rule.chargeRole + "\"");
    if (rule.workType && rule.scope !== "work-role") bits.push("work type \"" + rule.workType + "\"");
    if (rule.priority && rule.scope !== "priority") bits.push("priority \"" + rule.priority + "\"");
    return T.scopeLabel(rule.scope) + (bits.length ? " — " + bits.join(", ") : "");
  };

  /* Build the resolver context from live records (ticket → priority + company,
     member → currency), then resolve. */
  T.resolveFor = async function (pid, src) {
    src = src || {};
    let ticket = src.ticket || null;
    if (!ticket && src.ticketId != null && src.companyId != null) {
      try { ticket = await ERP.tickets.get(src.companyId, src.ticketId); } catch (e) {}
    }
    const companyId = src.companyId != null ? src.companyId : (ticket ? ticket.companyId : null);
    let currency = src.currency || "";
    if (!currency && companyId != null) {
      try { const c = await ERP.companies.get(companyId); if (c && c.currency) currency = c.currency; } catch (e) {}
    }
    return T.resolve(pid, {
      companyId: companyId, ticketId: src.ticketId != null ? src.ticketId : (ticket ? ticket.id : null),
      ticket: ticket, memberId: src.memberId,
      workType: src.workType, chargeRole: src.chargeRole,
      priority: src.priority != null ? src.priority : (ticket ? ticket.priority : ""),
      currency: currency,
    });
  };

  /* ─────────────────────────── entries (Task 19) ─────────────────────────── */

  T.STATUSES = [
    { id: "draft", label: "Draft", tone: "muted" },
    { id: "submitted", label: "Submitted", tone: "info" },
    { id: "approved", label: "Approved", tone: "success" },
    { id: "rejected", label: "Rejected", tone: "danger" },
    { id: "locked", label: "Locked", tone: "muted" },
  ];
  T.statusLabel = (id) => (T.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  T.statusTone = (id) => (T.STATUSES.find((s) => s.id === id) || {}).tone || "muted";
  T.EDITABLE_STATUSES = ["draft", "rejected"];

  T.newEntry = (over) => Object.assign({
    kind: "timeEntry", id: null, companyId: null, ticketId: null, projectId: null, taskId: null,
    memberId: null, date: "", startMs: null, endMs: null, minutes: 0,
    workType: "", chargeRole: "", chargeCode: "",
    billable: true, billableOverride: null,
    notes: "", status: "draft", timesheetId: null, rate: null,
    source: "manual", createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  T.entries = async function (pid, query) {
    query = query || {};
    let list = await ten().records("provider", pid, "timeEntry");
    if (query.memberId != null && query.memberId !== "") list = list.filter((r) => String(r.memberId) === String(query.memberId));
    if (query.companyId != null) list = list.filter((r) => String(r.companyId) === String(query.companyId));
    if (query.ticketId != null) list = list.filter((r) => String(r.ticketId) === String(query.ticketId));
    if (query.projectId != null) list = list.filter((r) => String(r.projectId) === String(query.projectId));
    if (query.taskId != null) list = list.filter((r) => String(r.taskId) === String(query.taskId));
    if (query.status) list = list.filter((r) => String(r.status) === String(query.status));
    if (query.statusIn) { const s = query.statusIn.map(String); list = list.filter((r) => s.indexOf(String(r.status)) !== -1); }
    if (query.billable != null) list = list.filter((r) => !!r.billable === !!query.billable);
    if (query.fromDate) list = list.filter((r) => String(r.date) >= String(query.fromDate));
    if (query.toDate) list = list.filter((r) => String(r.date) <= String(query.toDate));
    if (query.weekStart) list = list.filter((r) => T.inWeek(String(r.date), query.weekStart));
    list = list.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (Number(a.startMs || 0) - Number(b.startMs || 0)) || (Number(a.id) - Number(b.id)));
    return list;
  };

  T.entry = async (pid, id) => (await ten().records("provider", pid, "timeEntry")).find((r) => String(r.id) === String(id)) || null;
  T.forTicket = (pid, companyId, ticketId) => T.entries(pid, { companyId: companyId, ticketId: ticketId });
  T.forMember = (pid, memberId, query) => T.entries(pid, Object.assign({ memberId: memberId }, query || {}));

  /* Billing lock (Phase 6): stamp (or release) the invoice a time entry was
     billed on, so a second billing run cannot pick it up again. Writes the
     provider document directly because approved/locked entries are otherwise
     immutable — only billing may do this. */
  T.markInvoiced = async function (pid, ids, invoiceId) {
    const set = (ids || []).map(String);
    if (!set.length) return { count: 0 };
    const list = await ten().records("provider", pid);
    let count = 0;
    const updated = list.map((r) => {
      if (r.kind !== "timeEntry" || set.indexOf(String(r.id)) === -1) return r;
      count += 1;
      return Object.assign({}, r, { invoiceId: invoiceId == null ? null : invoiceId, invoicedAt: invoiceId == null ? null : nowIso(), updatedAt: nowIso() });
    });
    if (count) await ten().save("provider", pid, updated);
    return { count: count };
  };

  T.uninvoiced = async function (pid, query) {
    const list = await T.entries(pid, query);
    return list.filter((e) => e.billable && !e.writtenOff && e.invoiceId == null && ["approved", "locked"].indexOf(String(e.status)) !== -1);
  };

  function normaliseDuration(r) {
    let minutes = r.minutes === null || r.minutes === undefined || r.minutes === "" ? null : Number(r.minutes);
    const startMs = r.startMs === null || r.startMs === undefined || r.startMs === "" ? null : Number(r.startMs);
    const endMs = r.endMs === null || r.endMs === undefined || r.endMs === "" ? null : Number(r.endMs);
    if (endMs != null && startMs != null && endMs > startMs) minutes = Math.round((endMs - startMs) / 60000);
    if (minutes == null && startMs != null && endMs != null) minutes = Math.round((endMs - startMs) / 60000);
    if (minutes != null && !isFinite(minutes)) minutes = null;
    if (minutes != null) {
      minutes = Math.round(minutes);
      if (minutes < 0) minutes = 0;
      if (minutes > 1440) minutes = 1440;
    }
    return { minutes: minutes, startMs: startMs, endMs: startMs != null && minutes != null ? startMs + minutes * 60000 : endMs };
  }
  T.normaliseDuration = normaliseDuration;

  T.save = async function (pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("time.edit", { companyId: rec && rec.companyId })) return { error: "forbidden" };
    const existing = rec && rec.id != null ? await T.entry(pid, rec.id) : null;
    if (existing && ["locked", "approved", "submitted"].indexOf(String(existing.status)) !== -1 && !opts.system) {
      return { error: "locked", message: "This entry is " + T.statusLabel(existing.status).toLowerCase() + " and can no longer be edited." };
    }
    const r = Object.assign(T.newEntry(), existing || {}, rec);
    if (r.memberId == null || r.memberId === "") return { error: "member_required" };
    const dur = normaliseDuration(r);
    if (dur.minutes == null || dur.minutes <= 0) return { error: "duration_required" };
    r.minutes = dur.minutes; r.startMs = dur.startMs; r.endMs = dur.endMs;
    if (!r.date) r.date = r.startMs != null ? T.dayOf(r.startMs) : ui.today();
    if (r.startMs != null) r.date = T.dayOf(r.startMs);
    const maps = await taxonomyMaps(pid);
    const workRec = maps.workBy[String(r.workType || "")] || null;
    const codeRec = maps.codeBy[String(r.chargeCode || "")] || null;
    r.billable = T.deriveBillable(workRec, codeRec, typeof r.billableOverride === "boolean" ? r.billableOverride : null);
    if (!opts.skipRate) {
      r.rate = await T.resolveFor(pid, {
        companyId: r.companyId, ticketId: r.ticketId, memberId: r.memberId,
        workType: r.workType, chargeRole: r.chargeRole, currency: r.currency,
      });
    }
    if (r.id == null || !isFinite(r.id)) {
      r.id = ten().nextId(await ten().records("provider", pid));
      r.createdAt = nowIso();
      r.createdBy = r.createdBy != null ? r.createdBy : actor().memberId || null;
      if (r.status === "approved" || r.status === "locked" || r.status === "submitted") r.status = "draft";
    }
    r.updatedAt = nowIso();
    await put(pid, r);
    if (!opts.silent && !existing) await emit(pid, "time.entered", r);
    return { record: r, created: !existing };
  };

  T.remove = async function (pid, id) {
    if (!ERP.security.enforce("time.delete")) return { error: "forbidden" };
    const e = await T.entry(pid, id);
    if (!e) return { error: "not_found" };
    if (["approved", "locked"].indexOf(String(e.status)) !== -1) return { error: "locked" };
    await ten().remove("provider", pid, (r) => r.kind === "timeEntry" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* Write an entry off: it stays in the ledger for utilisation and audit, but
     stops contributing to the billable value (and shows why). Reversible. */
  T.writeOff = async function (pid, id, note) {
    if (!ERP.security.enforce("time.approve")) return { error: "forbidden" };
    const e = await T.entry(pid, id);
    if (!e) return { error: "not_found" };
    if (e.status === "locked") return { error: "locked" };
    const rec = Object.assign({}, e, {
      billable: false, billableOverride: false,
      writtenOff: { by: actorName(), at: nowIso(), note: note || "" },
      updatedAt: nowIso(),
    });
    await put(pid, rec);
    return { record: rec };
  };

  T.restoreBilling = async function (pid, id) {
    if (!ERP.security.enforce("time.approve")) return { error: "forbidden" };
    const e = await T.entry(pid, id);
    if (!e) return { error: "not_found" };
    if (e.status === "locked") return { error: "locked" };
    const rec = Object.assign({}, e, {
      billableOverride: null, writtenOff: null, updatedAt: nowIso(),
    });
    const maps = await taxonomyMaps(pid);
    rec.billable = T.deriveBillable(maps.workBy[String(rec.workType || "")] || null, maps.codeBy[String(rec.chargeCode || "")] || null, null);
    await put(pid, rec);
    return { record: rec };
  };

  /* ─────────────────────────── totals ───────────────────────────
     Shared with the timesheet and expense roll-ups. Returns minutes,
     billable minutes, the billable value (minutes × resolved rate) and
     the same figures grouped by member and by client. */

  T.totals = function (entries, opts) {
    opts = opts || {};
    const blank = () => ({ minutes: 0, billableMinutes: 0, amount: 0, entries: 0 });
    const out = Object.assign(blank(), { byMember: {}, byClient: {} });
    for (const e of entries || []) {
      const mins = Number(e.minutes) || 0;
      const billable = !!e.billable && !e.writtenOff;
      const rate = e.rate && isFinite(Number(e.rate.amount)) ? Number(e.rate.amount) : 0;
      const amount = billable ? (mins / 60) * rate : 0;
      out.minutes += mins;
      out.entries += 1;
      if (billable) out.billableMinutes += mins;
      if (billable) out.amount += amount;
      const mk = String(e.memberId);
      if (!out.byMember[mk]) out.byMember[mk] = blank();
      out.byMember[mk].minutes += mins;
      out.byMember[mk].entries += 1;
      if (billable) { out.byMember[mk].billableMinutes += mins; out.byMember[mk].amount += amount; }
      const ck = e.companyId == null || e.companyId === "" ? "__internal" : String(e.companyId);
      if (!out.byClient[ck]) out.byClient[ck] = blank();
      out.byClient[ck].minutes += mins;
      out.byClient[ck].entries += 1;
      if (billable) { out.byClient[ck].billableMinutes += mins; out.byClient[ck].amount += amount; }
    }
    out.amount = Math.round(out.amount * 100) / 100;
    return out;
  };

  /* ─────────────────────────── quick timers ─────────────────────────── */

  T.timers = async (pid) => ten().records("provider", pid, "timer");
  T.timerFor = async (pid, memberId) => (await T.timers(pid)).find((t) => String(t.memberId) === String(memberId)) || null;

  T.startTimer = async function (pid, payload) {
    payload = payload || {};
    if (!ERP.security.enforce("time.edit", { companyId: payload.companyId })) return { error: "forbidden" };
    const memberId = payload.memberId != null ? payload.memberId : actor().memberId;
    if (memberId == null || memberId === "") return { error: "member_required" };
    if (await T.timerFor(pid, memberId)) return { error: "already_running" };
    const rec = {
      kind: "timer", id: null, memberId: memberId,
      companyId: payload.companyId == null || payload.companyId === "" ? null : payload.companyId,
      ticketId: payload.ticketId == null || payload.ticketId === "" ? null : payload.ticketId,
      projectId: null,
      workType: payload.workType || "", chargeRole: payload.chargeRole || "", chargeCode: payload.chargeCode || "",
      notes: payload.notes || "", startedMs: Date.now(), startedBy: actorName(),
    };
    await put(pid, rec);
    return { record: rec };
  };

  T.stopTimer = async function (pid, memberId, over) {
    over = over || {};
    const timer = await T.timerFor(pid, memberId != null ? memberId : actor().memberId);
    if (!timer) return { error: "no_timer" };
    const elapsed = Math.max(1, Math.round((Date.now() - Number(timer.startedMs)) / 60000));
    const res = await T.save(pid, T.newEntry({
      companyId: timer.companyId, ticketId: timer.ticketId,
      memberId: timer.memberId,
      date: T.dayOf(timer.startedMs), startMs: Number(timer.startedMs),
      minutes: over.minutes != null ? Number(over.minutes) : elapsed,
      workType: over.workType != null ? over.workType : timer.workType,
      chargeRole: over.chargeRole != null ? over.chargeRole : timer.chargeRole,
      chargeCode: over.chargeCode != null ? over.chargeCode : timer.chargeCode,
      notes: over.notes != null ? over.notes : timer.notes,
      billableOverride: typeof over.billableOverride === "boolean" ? over.billableOverride : null,
      source: "timer",
    }));
    if (res.error) return res;
    await ten().remove("provider", pid, (r) => r.kind === "timer" && String(r.id) === String(timer.id));
    return { record: res.record, timer: timer };
  };

  T.cancelTimer = async function (pid, memberId) {
    return ten().remove("provider", pid, (r) => r.kind === "timer" && String(r.memberId) === String(memberId));
  };

  /* ─────────────────────────── events ─────────────────────────── */

  async function emit(pid, event, entry) {
    if (!ERP.workflow) return;
    try {
      const [ticket, company, member] = await Promise.all([
        entry.ticketId != null && entry.companyId != null ? ERP.tickets.get(entry.companyId, entry.ticketId) : null,
        entry.companyId != null ? ERP.companies.get(entry.companyId) : null,
        entry.memberId != null ? ERP.members.member(entry.memberId) : null,
      ]);
      await ERP.workflow.emit(event, {
        event: event, time: entry, entry: entry, ticket: ticket, company: company, member: member, actor: actor(),
      });
    } catch (e) {}
  }
  T.emit = emit;

  /* ─────────────────────────── seeding ─────────────────────────── */

  T.ensureSeed = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    try { await ERP.taxonomy.ensureCategory(pid, "expenseCategory"); } catch (e) {}
    return { ok: true };
  };

  /* ═══════════════════════════ station ═══════════════════════════
     A four-tab station. Entries and Rates render inline; Timesheets
     and Expenses delegate to their own engines. */

  function blankState() {
    return { weekStart: T.weekStart(ui.today()), memberId: "", tab: "entries" };
  }

  function memberOptions(members) {
    return [{ value: "", label: "Everyone" }].concat(members.map((m) => ({ value: m.id, label: m.name })));
  }

  async function renderEntries(panel, pid, host, refresh) {
    const state = host.__time;
    const canEdit = ERP.security.can("time.edit");
    const [members, companies, maps] = await Promise.all([
      ERP.members.members(), ERP.companies.optionList(), taxonomyMaps(pid),
    ]);
    const memberId = state.memberId;
    const weekStart = state.weekStart;
    const weekEnd = T.weekEnd(weekStart);
    const entries = await T.entries(pid, { memberId: memberId || null, weekStart: weekStart });
    const myMember = memberId || actor().memberId || (members[0] ? members[0].id : null);
    const timer = myMember != null ? await T.timerFor(pid, myMember) : null;
    const names = Object.fromEntries(members.map((m) => [String(m.id), m.name]));
    const clientNames = Object.fromEntries((companies || []).map((c) => [String(c.value), c.label]));
    const totals = T.totals(entries);
    const maskedMoney = (v) => (ERP.security.canSeeFinancials() ? ui.money(v) : "•••");

    const byDay = {};
    T.weekDays(weekStart).forEach((d) => { byDay[d] = []; });
    entries.filter((e) => byDay[e.date]).forEach((e) => byDay[e.date].push(e));

    const timerBar = timer
      ? '<div class="erp-timer running">' +
          '<span class="erp-timer-dot"></span>' +
          '<div class="erp-timer-info"><b>Timer running</b><span>' + ui.esc(names[String(timer.memberId)] || "Member") + " · started " + ui.dateTime(new Date(timer.startedMs).toISOString()) +
          (timer.ticketId != null ? " · ticket #" + ui.esc(timer.ticketId) : "") + "</span></div>" +
          (canEdit ? ui.btn("Stop &amp; log time", { primary: true, act: "tm-stop" }) + " " + ui.btn("Discard", { small: true, danger: true, act: "tm-discard" }) : "") +
        "</div>"
      : canEdit
        ? '<div class="erp-timer">' +
            '<div class="erp-timer-info"><b>Quick timer</b><span>Start a stopwatch against a client or ticket; stop it to turn the elapsed time into an entry.</span></div>' +
            ui.btn("Start timer", { icon: "clock", act: "tm-start" }) +
          "</div>"
        : "";

    const columns = T.weekDays(weekStart).map((day) => {
      const list = byDay[day] || [];
      const dayMin = list.reduce((n, e) => n + (Number(e.minutes) || 0), 0);
      const isToday = day === ui.today();
      const cards = list.length
        ? list.map((e) => {
            const work = maps.workBy[String(e.workType || "")];
            const client = e.companyId != null ? (clientNames[String(e.companyId)] || "#" + e.companyId) : "Internal";
            const locked = ["approved", "locked", "submitted"].indexOf(String(e.status)) !== -1;
            const title = e.ticketId != null ? "Ticket #" + e.ticketId : client;
            return '<button class="erp-time-card' + (e.billable ? "" : " nonbillable") + '" data-act="tm-edit" data-arg="' + ui.esc(e.id) + '" type="button"' + (canEdit && !locked ? "" : " disabled") + ">" +
              '<span class="erp-time-card-top"><b>' + ui.esc(T.minutesLabel(e.minutes)) + '</b>' + (e.billable ? ui.badge("Billable", "success") : ui.badge("Non-billable", "muted")) + "</span>" +
              '<span class="erp-time-card-title">' + ui.esc(title) + "</span>" +
              '<span class="erp-time-card-sub">' + ui.esc(labelOf(work, e.workType) + (e.memberId != null && !memberId ? " · " + (names[String(e.memberId)] || "") : "")) + "</span>" +
              '<span class="erp-time-card-sub">' + ui.badge(T.statusLabel(e.status), T.statusTone(e.status)) + (e.companyId == null ? " " + ui.badge("Internal", "muted") : "") + "</span>" +
              "</button>";
          }).join("")
        : '<div class="erp-time-empty">—</div>';
      return '<div class="erp-time-day' + (isToday ? " today" : "") + '">' +
        '<div class="erp-time-dayhead"><span>' + ui.esc(T.dayLabel(day)) + "</span><b>" + (dayMin ? ui.esc(T.minutesLabel(dayMin)) : "0m") + "</b></div>" +
        '<div class="erp-time-daybody">' + cards + "</div>" +
        (canEdit ? '<button class="erp-time-add" type="button" data-act="tm-new" data-arg="' + ui.esc(day) + '">+ Add</button>' : "") +
        "</div>";
    }).join("");

    panel.innerHTML =
      ui.summary([
        { label: "This week", value: ui.esc(T.minutesLabel(totals.minutes)) },
        { label: "Billable", value: ui.esc(T.minutesLabel(totals.billableMinutes)) },
        { label: "Billable value", value: maskedMoney(totals.amount) },
        { label: "Entries", value: String(totals.entries) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("tm-member", "", memberOptions(members), memberId, null, "Filter by member") +
        ui.btn("‹ Prev", { small: true, act: "tm-prev" }) +
        '<span class="erp-db-daylabel">' + ui.esc(T.weekLabel(weekStart)) + "</span>" +
        ui.btn("Next ›", { small: true, act: "tm-next" }) +
        ui.btn("This week", { small: true, act: "tm-today" }) +
        '<span class="erp-db-hint">' + (canEdit ? "Click a day to add time · click an entry to edit" : "Read-only for your role") + "</span>" +
      "</div>" +
      timerBar +
      '<div class="erp-time-grid">' + columns + "</div>";

    const memberSel = panel.querySelector('[name="tm-member"]');
    if (memberSel) memberSel.addEventListener("change", () => { state.memberId = memberSel.value; refresh(); });

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "tm-prev") { state.weekStart = ui.addDays(state.weekStart, -7); return refresh(); }
      if (act === "tm-next") { state.weekStart = ui.addDays(state.weekStart, 7); return refresh(); }
      if (act === "tm-today") { state.weekStart = T.weekStart(ui.today()); return refresh(); }
      if (act === "tm-new") return openEntryModal(pid, null, refresh, { date: arg, memberId: myMember, weekStart: state.weekStart });
      if (act === "tm-edit") return openEntryModal(pid, await T.entry(pid, arg), refresh);
      if (act === "tm-start") return openTimerModal(pid, null, refresh, { memberId: myMember });
      if (act === "tm-stop") return openTimerModal(pid, timer, refresh, { stop: true });
      if (act === "tm-discard") {
        if (!(await ui.confirm({ title: "Discard the running timer?", message: "The elapsed time will be lost.", danger: true, okLabel: "Discard" }))) return;
        await T.cancelTimer(pid, timer.memberId);
        ERP.toast("Timer discarded.", "success");
        return refresh();
      }
    });
  }

  async function openTimerModal(pid, timer, refresh, defaults) {
    defaults = defaults || {};
    const [members, companies] = await Promise.all([ERP.members.members(), ERP.companies.optionList()]);
    const memberId = defaults.memberId || (timer && timer.memberId) || (members[0] ? members[0].id : "");
    const fields =
      ui.select("memberId", "Member", members.map((m) => ({ value: m.id, label: m.name })), memberId) +
      ui.select("companyId", "Client", [{ value: "", label: "— internal / general —" }].concat(companies), timer && timer.companyId) +
      ui.text("notes", "What are you working on?", timer ? timer.notes : "", "e.g. Replacing switch at HQ");
    const modal = ui.modal({
      title: timer ? "Stop timer" : "Start timer",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "tt-cancel" }) + " " +
        ui.btn(timer ? "Stop &amp; log time" : "Start", { small: true, primary: true, act: "tt-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=tt-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=tt-save]").onclick = async (btn) => {
      btn.disabled = true;
      const v = ui.collect(form, ["memberId", "companyId", "notes"]);
      const res = timer
        ? await T.stopTimer(pid, timer.memberId, { notes: v.notes })
        : await T.startTimer(pid, { memberId: v.memberId, companyId: v.companyId, notes: v.notes });
      if (res.error) { ERP.toast("Could not " + (timer ? "stop" : "start") + " the timer: " + res.error, "error"); btn.disabled = false; return; }
      ui.closeModal();
      ERP.toast(timer ? "Time logged (" + T.minutesLabel(res.record.minutes) + ")." : "Timer started.", "success");
      refresh();
    };
  }

  async function openEntryModal(pid, entry, refresh, defaults) {
    if (!ERP.security.enforce("time.edit", { companyId: entry ? entry.companyId : null })) return;
    defaults = defaults || {};
    const e = entry || T.newEntry(Object.assign({ memberId: defaults.memberId, companyId: defaults.companyId, ticketId: defaults.ticketId, date: defaults.date || ui.today() }, defaults));
    const [members, companies, maps] = await Promise.all([ERP.members.members(), ERP.companies.optionList(), taxonomyMaps(pid)]);
    const companyId = e.companyId != null ? e.companyId : "";
    const tickets = companyId !== "" ? await ERP.tickets.list(companyId, {}) : [];
    let projects = companyId !== "" && ERP.projects ? await ERP.projects.list(pid, { companyId: companyId }) : [];
    const tasksFor = (projectId) => {
      const pr = projects.find((x) => String(x.id) === String(projectId));
      return pr && ERP.projects ? ERP.projects.tasksOf(pr).map((h) => ({ value: h.task.id, label: (h.phase.name ? h.phase.name + " · " : "") + h.task.name })) : [];
    };
    const hasStart = e.startMs != null;
    const liveRate = await T.resolveFor(pid, { companyId: companyId === "" ? null : companyId, ticketId: e.ticketId, memberId: e.memberId, workType: e.workType, chargeRole: e.chargeRole, priority: e.priorityOverride });

    const fields =
      ui.select("memberId", "Member", members.map((m) => ({ value: m.id, label: m.name })), e.memberId) +
      '<div class="erp-form-row">' +
        ui.select("companyId", "Client", [{ value: "", label: "— internal / general work —" }].concat(companies), companyId) +
        ui.select("ticketId", "Ticket", [{ value: "", label: "— none —" }].concat(tickets.map((t) => ({ value: t.id, label: "#" + (t.number || t.id) + " · " + String(t.summary || "").slice(0, 36) }))), e.ticketId) +
      "</div>" +
      (ERP.projects ?
      '<div class="erp-form-row">' +
        ui.select("projectId", "Project", [{ value: "", label: "— none —" }].concat(projects.map((p) => ({ value: p.id, label: (p.number ? p.number + " · " : "") + p.name }))), e.projectId) +
        ui.select("taskId", "Project task", [{ value: "", label: "— none —" }].concat(tasksFor(e.projectId)), e.taskId) +
      "</div>" : "") +
      '<div class="erp-form-row">' +
        ui.dateInput("date", "Date", e.date || ui.today()) +
        ui.select("workType", "Work type", [{ value: "", label: "— none —" }].concat(maps.workType.map((w) => ({ value: w.code, label: w.label }))), e.workType) +
        ui.select("chargeRole", "Charge role", [{ value: "", label: "— none —" }].concat(maps.chargeRole.map((w) => ({ value: w.code, label: w.label }))), e.chargeRole) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("chargeCode", "Charge code", [{ value: "", label: "— none —" }].concat(maps.chargeCode.map((w) => ({ value: w.code, label: w.label }))), e.chargeCode) +
        ui.number("minutes", "Minutes", e.minutes || "", { min: 0, step: 15 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("billableOverride", "Billable", [
          { value: "", label: "Automatic (from work type / charge code)" },
          { value: "yes", label: "Billable" },
          { value: "no", label: "Non-billable" },
        ], e.billableOverride === true ? "yes" : e.billableOverride === false ? "no" : "") +
        ui.select("timed", "Timing", [
          { value: "", label: "Duration only" },
          { value: "yes", label: "Start & end time" },
        ], hasStart ? "yes" : "") +
      "</div>" +
      '<div class="erp-form-row" data-times hidden="' + (hasStart ? "false" : "true") + '">' +
        ui.field("Start", '<input type="time" name="start" value="' + ui.esc(e.startMs != null ? T.timeValue(e.startMs) : "09:00") + '">') +
        ui.field("End", '<input type="time" name="end" value="' + ui.esc(e.endMs != null ? T.timeValue(e.endMs) : "10:00") + '">') +
      "</div>" +
      ui.textarea("notes", "Notes", e.notes || "", 3) +
      '<div class="erp-rate-hint" data-rate></div>';

    const modal = ui.modal({
      title: entry && entry.id != null ? "Edit time entry" : "New time entry",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "te-cancel" }) + " " +
        (entry && entry.id != null ? ui.btn("Delete", { small: true, danger: true, act: "te-del" }) + " " : "") +
        ui.btn(entry && entry.id != null ? "Save" : "Add entry", { small: true, primary: true, act: "te-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const rateBox = form.querySelector("[data-rate]");

    function esc(s) { return ui.esc(s); }
    function renderRate() {
      rateBox.innerHTML = '<b>Resolved rate</b> ' + (ERP.security.canSeeFinancials() ? ui.money(liveRate.amount, liveRate.currency) + "/h" : "•••") +
        ' <span class="erp-sub">' + esc(liveRate.label || liveRate.source) + " — " + esc(liveRate.reason || "") + "</span>";
    }
    async function refreshRate() {
      const v = ui.collect(form, ["companyId", "ticketId", "memberId", "workType", "chargeRole"]);
      const r = await T.resolveFor(pid, { companyId: v.companyId === "" ? null : v.companyId, ticketId: v.ticketId === "" ? null : v.ticketId, memberId: v.memberId, workType: v.workType, chargeRole: v.chargeRole });
      liveRate.amount = r.amount; liveRate.currency = r.currency; liveRate.source = r.source; liveRate.label = r.label; liveRate.reason = r.reason;
      renderRate();
    }
    renderRate();

    const timed = form.querySelector('[name="timed"]');
    const timeRow = form.querySelector("[data-times]");
    timed.addEventListener("change", () => { timeRow.hidden = timed.value !== "yes"; });
    const compSel = form.querySelector('[name="companyId"]');
    function fillProjectOptions() {
      const pSel = form.querySelector('[name="projectId"]');
      if (!pSel) return;
      const cur = pSel.value;
      pSel.innerHTML = '<option value="">— none —</option>' + projects.map((p) => '<option value="' + esc(p.id) + '">' + esc((p.number ? p.number + " · " : "") + p.name) + "</option>").join("");
      pSel.value = projects.some((p) => String(p.id) === String(cur)) ? cur : "";
    }
    function fillTaskOptions() {
      const tSel = form.querySelector('[name="taskId"]');
      if (!tSel) return;
      const pSel = form.querySelector('[name="projectId"]');
      const cur = tSel.value;
      const opts = tasksFor(pSel ? pSel.value : "");
      tSel.innerHTML = '<option value="">— none —</option>' + opts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>").join("");
      tSel.value = opts.some((o) => String(o.value) === String(cur)) ? cur : "";
    }
    compSel.addEventListener("change", async () => {
      const cid = compSel.value;
      const tickets = cid === "" ? [] : await ERP.tickets.list(cid, {});
      const tkSel = form.querySelector('[name="ticketId"]');
      tkSel.innerHTML = '<option value="">— none —</option>' + tickets.map((t) => '<option value="' + esc(t.id) + '">#' + esc(t.number || t.id) + " · " + esc(String(t.summary || "").slice(0, 36)) + "</option>").join("");
      projects = cid !== "" && ERP.projects ? await ERP.projects.list(pid, { companyId: cid }) : [];
      fillProjectOptions();
      fillTaskOptions();
      refreshRate();
    });
    const projSel = form.querySelector('[name="projectId"]');
    if (projSel) projSel.addEventListener("change", fillTaskOptions);
    ["chargeRole", "workType"].forEach((n) => form.querySelector('[name="' + n + '"]').addEventListener("change", refreshRate));

    modal.querySelector("[data-act=te-cancel]").onclick = () => ui.closeModal();
    const delBtn = modal.querySelector("[data-act=te-del]");
    if (delBtn) delBtn.onclick = async () => {
      if (!(await ui.confirm({ title: "Delete this entry?", message: "The time will be permanently removed.", danger: true, okLabel: "Delete" }))) return;
      const res = await T.remove(pid, entry.id);
      if (res.error) { ERP.toast("Could not delete: " + res.error, "error"); return; }
      ui.closeModal(); ERP.toast("Entry deleted.", "success"); refresh();
    };
    modal.querySelector("[data-act=te-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["memberId", "companyId", "ticketId", "projectId", "taskId", "date", "workType", "chargeRole", "chargeCode", "minutes", "billableOverride", "timed", "start", "end", "notes"]);
      if (!v.memberId) { ERP.toast("Choose a member.", "error"); return; }
      const payload = Object.assign({}, entry || {}, {
        memberId: v.memberId,
        companyId: v.companyId === "" ? null : v.companyId,
        ticketId: v.ticketId === "" ? null : v.ticketId,
        projectId: v.projectId === "" || v.projectId == null ? null : v.projectId,
        taskId: v.taskId === "" || v.taskId == null ? null : v.taskId,
        workType: v.workType, chargeRole: v.chargeRole, chargeCode: v.chargeCode,
        billableOverride: v.billableOverride === "" ? null : v.billableOverride === "yes",
        notes: v.notes, status: entry && entry.id != null ? entry.status : "draft",
      });
      if (v.timed === "yes") {
        const startMs = v.date && v.start ? new Date(v.date + "T" + v.start + ":00").getTime() : null;
        const endMs = v.date && v.end ? new Date(v.date + "T" + v.end + ":00").getTime() : null;
        if (!startMs || !endMs) { ERP.toast("Enter a valid start and end time.", "error"); return; }
        payload.startMs = startMs; payload.endMs = endMs; payload.minutes = Math.round((endMs - startMs) / 60000);
      } else {
        payload.startMs = null; payload.endMs = null;
        payload.minutes = v.minutes;
      }
      payload.date = v.date;
      if (!payload.minutes && payload.minutes !== 0) { ERP.toast("Enter the minutes worked, or a start and end time.", "error"); return; }
      if (entry && entry.id != null) { payload.id = entry.id; payload.status = entry.status; }
      btn.disabled = true;
      const res = await T.save(pid, payload);
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Time entry saved.", "success"); refresh();
    };
  }
  T.openEntryModal = openEntryModal;
  T.openTimerModal = openTimerModal;

  async function renderRates(panel, pid) {
    if (!ERP.security.enforce("rates.view")) { panel.innerHTML = ui.alert("Your role cannot view billing rates.", "warn"); return; }
    const [rules, companies, members] = await Promise.all([T.rateRules(pid), ERP.companies.optionList(), ERP.members.members()]);
    const clientName = (id) => { const c = (companies || []).find((x) => String(x.value) === String(id)); return c ? c.label : id != null ? "#" + id : "—"; };
    const memberName = (id) => { const m = members.find((x) => String(x.id) === String(id)); return m ? m.name : id != null ? "#" + id : "—"; };
    const canEdit = ERP.security.can("rates.edit");
    const maps = await taxonomyMaps(pid);

    const rows = rules.map((r) => ({
      scope: ui.badge(T.scopeLabel(r.scope), r.scope === "default" ? "muted" : "info"),
      name: ui.esc(r.name || "—"),
      match: ui.esc([
        r.companyId != null ? "client " + clientName(r.companyId) : "",
        r.workType ? "work " + labelOf(maps.workBy[r.workType], r.workType) : "",
        r.chargeRole ? "role " + labelOf(maps.roleBy[r.chargeRole], r.chargeRole) : "",
        r.priority ? "priority " + r.priority : "",
        r.agreementId != null ? "agreement #" + r.agreementId : "",
      ].filter(Boolean).join(" · ") || "any"),
      amount: ERP.security.canSeeFinancials() ? ui.esc(ui.money(r.amount, r.currency)) + "<span class='erp-sub'>/h</span>" : "•••",
      order: String(r.order),
      actions: canEdit ? ui.btn("Edit", { small: true, act: "rt-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "rt-del", arg: r.id }) : "",
    }));

    const precedence = '<ol class="erp-rate-precedence">' + T.RATE_SCOPES.map((s) =>
      "<li><b>" + ui.esc(s.label) + "</b> — " + ui.esc(s.desc) + "</li>").join("") + "</ol>";

    panel.innerHTML =
      ui.alert("A time entry's rate is resolved by the first matching scope below, in order. Every entry records the rule that produced its rate so the invoice can explain itself.", "info") +
      ui.card("Precedence", precedence + '<div class="erp-rate-hint">The final rung falls back to the charge role\'s configured rate, then the member\'s standard charge rate.</div>') +
      '<div class="erp-btn-row">' + (canEdit ? ui.btn("New rate rule", { primary: true, act: "rt-new" }) : "") + " " + ui.btn("Rate checker", { act: "rt-check" }) + "</div>" +
      ui.table([
        { key: "order", label: "Order" },
        { key: "scope", label: "Scope" },
        { key: "name", label: "Rule" },
        { key: "match", label: "Applies to" },
        { key: "amount", label: "Rate", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No rate rules yet — rates fall back to charge-role defaults. Add one to override." });

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "rt-new") return openRateModal(pid, null, () => renderRates(panel, pid));
      if (act === "rt-edit") return openRateModal(pid, await T.rateRule(pid, arg), () => renderRates(panel, pid));
      if (act === "rt-del") {
        if (!(await ui.confirm({ title: "Delete this rate rule?", message: "Rates will fall through to a lower-precedence rule.", danger: true, okLabel: "Delete" }))) return;
        await T.removeRateRule(pid, arg);
        ERP.toast("Rate rule deleted.", "success");
        return renderRates(panel, pid);
      }
      if (act === "rt-check") return openRateChecker(pid);
    });
  }

  async function openRateModal(pid, rule, refresh) {
    if (!ERP.security.enforce("rates.edit")) return;
    const [companies, maps] = await Promise.all([ERP.companies.optionList(), taxonomyMaps(pid)]);
    const r = rule || T.newRateRule({ order: 100 });
    const scopeOpts = T.RATE_SCOPES.map((s) => ({ value: s.id, label: s.label }));
    const fields =
      ui.text("name", "Rule name", r.name || "", "e.g. Acme managed-services rate") +
      '<div class="erp-form-row">' +
        ui.select("scope", "Scope", scopeOpts, r.scope) +
        ui.number("amount", "Rate per hour", r.amount, { min: 0, step: 5 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("companyId", "Client (for client / agreement rules)", [{ value: "", label: "— any —" }].concat(companies), r.companyId) +
        ui.number("agreementId", "Agreement id (agreement rules)", r.agreementId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("workType", "Work type filter", [{ value: "", label: "— any —" }].concat(maps.workType.map((w) => ({ value: w.code, label: w.label }))), r.workType) +
        ui.select("chargeRole", "Charge role filter", [{ value: "", label: "— any —" }].concat(maps.chargeRole.map((w) => ({ value: w.code, label: w.label }))), r.chargeRole) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("priority", "Priority filter", [{ value: "", label: "— any —" }].concat((await tax(pid, "priority")).map((p) => ({ value: p.code, label: p.label }))), r.priority) +
        ui.number("order", "Order (lower wins)", r.order, { min: 0 }) +
      "</div>" +
      ui.check("active", "Active", r.active !== false);
    const modal = ui.modal({
      title: rule && rule.id != null ? "Edit rate rule" : "New rate rule",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "rm-cancel" }) + " " + ui.btn(rule && rule.id != null ? "Save" : "Create", { small: true, primary: true, act: "rm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=rm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=rm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "scope", "amount", "companyId", "agreementId", "workType", "chargeRole", "priority", "order", "active"]);
      const payload = Object.assign({}, r, {
        name: v.name, scope: v.scope, amount: v.amount,
        companyId: v.companyId === "" ? null : v.companyId,
        agreementId: v.agreementId === "" || v.agreementId == null ? null : v.agreementId,
        workType: v.workType, chargeRole: v.chargeRole, priority: v.priority,
        order: v.order, active: v.active,
      });
      if (rule && rule.id != null) payload.id = rule.id;
      btn.disabled = true;
      const res = await T.saveRateRule(pid, payload);
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Rate rule saved.", "success"); refresh();
    };
  }

  async function openRateChecker(pid) {
    const [companies, maps, priorities] = await Promise.all([ERP.companies.optionList(), taxonomyMaps(pid), tax(pid, "priority")]);
    const fields =
      ui.select("companyId", "Client", [{ value: "", label: "— none —" }].concat(companies), "") +
      ui.select("workType", "Work type", [{ value: "", label: "— none —" }].concat(maps.workType.map((w) => ({ value: w.code, label: w.label }))), "") +
      ui.select("chargeRole", "Charge role", [{ value: "", label: "— none —" }].concat(maps.chargeRole.map((w) => ({ value: w.code, label: w.label }))), "") +
      ui.select("priority", "Ticket priority", [{ value: "", label: "— none —" }].concat(priorities.map((p) => ({ value: p.code, label: p.label }))), "");
    const modal = ui.modal({
      title: "Rate checker",
      size: "lg",
      body: ui.form(fields) + '<div data-out class="erp-rate-result"></div>',
      foot: ui.btn("Close", { small: true, act: "rc-close" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const out = modal.querySelector("[data-out]");
    modal.querySelector("[data-act=rc-close]").onclick = () => ui.closeModal();
    async function run() {
      const v = ui.collect(form, ["companyId", "workType", "chargeRole", "priority"]);
      const res = await T.resolve(pid, {
        companyId: v.companyId === "" ? null : v.companyId,
        workType: v.workType, chargeRole: v.chargeRole, priority: v.priority,
      });
      out.innerHTML = "<b>" + (ERP.security.canSeeFinancials() ? ui.esc(ui.money(res.amount, res.currency)) + "/h" : "•••") + "</b>" +
        ' <span class="erp-sub">chosen by ' + ui.esc(res.label) + " — " + ui.esc(res.reason) + "</span>" +
        "<ol class=\"erp-rate-chain\">" + (res.chain || []).map((c) =>
          "<li class=\"" + (c.applied ? "hit" : "") + "\">" + ui.esc(c.label) + (c.applied ? " ✓ " + ui.esc(c.ruleName || (c.amount != null ? ui.money(c.amount) : "")) : " — no match") + "</li>").join("") + "</ol>";
    }
    ["companyId", "workType", "chargeRole", "priority"].forEach((n) => form.querySelector('[name="' + n + '"]').addEventListener("change", run));
    await run();
  }
  T.openRateModal = openRateModal;
  T.openRateChecker = openRateChecker;

  /* Parsing "HH:MM" from a time input into ms on a date. */
  T.timeValue = function (ms) {
    const d = new Date(Number(ms));
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  };

  T.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "clock", title: "Time & expense", phase: "Phase 4 · Time & expense",
        message: "Create a service provider and a client company first — then capture time here.",
      });
      return;
    }
    try { await T.ensureSeed(pid); } catch (e) {}
    host.__time = host.__time || blankState();

    const defs = [
      { id: "entries", label: "Entries & timers" },
      { id: "timesheets", label: "Timesheets & approval" },
      { id: "expenses", label: "Expenses" },
      { id: "rates", label: "Billing rates" },
    ];
    const active = defs.find((d) => d.id === host.__time.tab) ? host.__time.tab : "entries";

    const renderTab = async (id) => {
      const old = host.querySelector('[data-panel="' + id + '"]');
      if (!old) return;
      const panel = document.createElement("div");
      panel.className = old.className;
      panel.setAttribute("data-panel", id);
      old.replaceWith(panel);
      ERP.states.loading(panel, "Loading " + (defs.find((d) => d.id === id) || {}).label);
      try {
        if (id === "entries") await renderEntries(panel, pid, host, () => renderTab(id));
        else if (id === "timesheets") await ERP.timesheets.renderInto(panel, pid, () => renderTab(id), host);
        else if (id === "expenses") await ERP.expenses.renderInto(panel, pid, () => renderTab(id), host);
        else if (id === "rates") await renderRates(panel, pid);
      } catch (e) {
        console.error("time tab failed", id, e);
        ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
      }
    };

    host.innerHTML = ui.pageHead("Time & expense", "Capture billable time, run timers, approve timesheets and manage expenses.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__time.tab = b.getAttribute("data-tab");
      await renderTab(host.__time.tab);
    }));
    await renderTab(active);
  };
})();
