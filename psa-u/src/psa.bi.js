/* ============================================================================
   PSA-U — data export & BI handoff (Phase 11 · Task 53)

   A clean, schema-stable, fact/dimension-shaped extract for the separate
   BI/reporting tool, handed over through the pipeline's shared versioned
   envelope. The point is a stable contract: the BI tool reads a documented
   shape and never has to understand psa-u's record layout, and psa-u can evolve
   its internal records without breaking the BI tool.

     • SCHEMA      — a versioned descriptor: every dimension and fact with its
                     column names and types. B.SCHEMA_VERSION pins the contract;
                     B.schema() returns the descriptor so a consumer can check
                     it before reading an extract.
     • DIMENSIONS  — small conformed tables (company, member, board, status,
                     priority, work_type, month) keyed by stable *_key values.
     • FACTS       — ticket, time, expense, invoice, payment, opportunity,
                     agreement, purchase_order. Each row is additive and
                     references dimensions by key; measures are plain numbers.
     • ENVELOPE    — { schema:"psa-envelope", schemaVersion, kind, version,
                     producer, generatedAt, provider, counts, dimensions, facts }.
                     ERP.envelope() is the shared wrapper any module can use.
     • HANDOFF     — B.publish() uploads the extract JSON through the upload
                     plugin (once loaded) and records a "biHandoff"; the URL is
                     what the BI tool (or a Phase 12 connector) consumes.

   Nothing here writes back into psa-u — the extract is a one-way projection.
   ============================================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const B = (ERP.bi = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("the BI export requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function nOrNull(v) { const n = Number(v); return isFinite(n) ? n : null; }
  function date(v) { const s = v == null ? "" : String(v); return s ? s.slice(0, 10) : null; }
  function monthOf(v) { const s = date(v); return s ? s.slice(0, 7) : null; }
  const key = (prefix, id) => (id == null || id === "" ? null : prefix + String(id));

  B.SCHEMA_VERSION = "1.0.0";

  const T = { str: "string", num: "number", bool: "boolean", date: "date" };
  function f(name, type) { return { name: name, type: type }; }

  B.SCHEMA = {
    version: B.SCHEMA_VERSION,
    dimensions: {
      company: [f("company_key", T.str), f("name", T.str), f("status", T.str), f("type", T.str), f("city", T.str), f("region", T.str), f("country", T.str), f("account_manager_key", T.str), f("created_at", T.date)],
      member: [f("member_key", T.str), f("name", T.str), f("functional_role", T.str), f("team_key", T.str), f("active", T.bool), f("dispatchable", T.bool)],
      board: [f("board_key", T.str), f("label", T.str)],
      status: [f("status_key", T.str), f("label", T.str), f("closed", T.bool)],
      priority: [f("priority_key", T.str), f("label", T.str)],
      work_type: [f("work_type_key", T.str), f("label", T.str), f("billable", T.bool)],
      month: [f("month_key", T.str), f("year", T.num), f("month", T.num)],
    },
    facts: {
      ticket: [f("ticket_key", T.str), f("number", T.str), f("company_key", T.str), f("board_key", T.str), f("status_key", T.str), f("priority_key", T.str), f("source", T.str), f("type", T.str), f("subtype", T.str), f("item", T.str), f("owner_key", T.str), f("created_date", T.date), f("closed_date", T.date), f("age_days", T.num), f("open", T.bool), f("first_response_minutes", T.num), f("resolution_minutes", T.num), f("sla_breached", T.bool)],
      time: [f("time_key", T.str), f("date", T.date), f("month_key", T.str), f("company_key", T.str), f("member_key", T.str), f("ticket_key", T.str), f("project_key", T.str), f("work_type_key", T.str), f("charge_code_key", T.str), f("billable", T.bool), f("minutes", T.num), f("billable_minutes", T.num), f("rate", T.num), f("amount", T.num), f("status", T.str), f("invoiced", T.bool)],
      expense: [f("expense_key", T.str), f("date", T.date), f("month_key", T.str), f("company_key", T.str), f("member_key", T.str), f("ticket_key", T.str), f("category_key", T.str), f("amount", T.num), f("billable_amount", T.num), f("billable", T.bool), f("status", T.str)],
      invoice: [f("invoice_key", T.str), f("number", T.str), f("company_key", T.str), f("status", T.str), f("issue_date", T.date), f("due_date", T.date), f("month_key", T.str), f("subtotal", T.num), f("tax", T.num), f("total", T.num), f("paid", T.num), f("balance", T.num), f("payment_status", T.str)],
      payment: [f("payment_key", T.str), f("number", T.str), f("company_key", T.str), f("invoice_key", T.str), f("date", T.date), f("month_key", T.str), f("amount", T.num), f("method", T.str), f("status", T.str), f("kind", T.str)],
      opportunity: [f("opportunity_key", T.str), f("number", T.str), f("company_key", T.str), f("name", T.str), f("stage_key", T.str), f("status", T.str), f("value", T.num), f("weighted_value", T.num), f("probability", T.num), f("expected_close", T.date), f("month_key", T.str), f("owner_key", T.str), f("source", T.str), f("created_date", T.date)],
      agreement: [f("agreement_key", T.str), f("number", T.str), f("company_key", T.str), f("name", T.str), f("type", T.str), f("status", T.str), f("billing_cycle", T.str), f("start_date", T.date), f("end_date", T.date), f("included_hours", T.num)],
      purchase_order: [f("po_key", T.str), f("number", T.str), f("vendor_key", T.str), f("company_key", T.str), f("status", T.str), f("order_date", T.date), f("expected_date", T.date), f("subtotal", T.num), f("total", T.num)],
    },
  };

  B.schema = function () {
    return {
      version: B.SCHEMA_VERSION,
      envelope: { schema: B.ENVELOPE_SCHEMA || "psa-envelope", schemaVersion: 1 },
      dimensions: Object.keys(B.SCHEMA.dimensions).map((k) => ({ name: k, columns: B.SCHEMA.dimensions[k].slice() })),
      facts: Object.keys(B.SCHEMA.facts).map((k) => ({ name: k, columns: B.SCHEMA.facts[k].slice() })),
    };
  };
  B.factNames = () => Object.keys(B.SCHEMA.facts);
  B.dimensionNames = () => Object.keys(B.SCHEMA.dimensions);
  B.factColumns = (name) => (B.SCHEMA.facts[name] || []).slice();

  /* ─────────────────────────── shared envelope ─────────────────────────── */

  B.ENVELOPE_SCHEMA = "psa-envelope";
  B.ENVELOPE_VERSION = 1;

  B.envelope = function (kind, body, meta) {
    return Object.assign({
      schema: B.ENVELOPE_SCHEMA,
      schemaVersion: B.ENVELOPE_VERSION,
      kind: kind,
      version: B.SCHEMA_VERSION,
      producer: "psa-u",
      generatedAt: nowIso(),
    }, meta || {}, body || {});
  };
  /* the pipeline's shared wrapper, available to any module */
  ERP.envelope = B.envelope;

  /* ─────────────────────────── dimensions ─────────────────────────── */

  B.dimensions = async function (pid) {
    const safe = (p) => Promise.resolve(p).catch(() => []);
    const [companies, members, teams, boards, tax] = await Promise.all([
      safe(ERP.companies.list()),
      safe(ERP.members.members()),
      safe(ERP.members.teams()),
      safe(ERP.tickets.boards(pid)),
      safe(ERP.taxonomy.list(pid)),
    ]);
    const dims = { company: [], member: [], board: [], status: [], priority: [], work_type: [], month: [] };
    (companies || []).forEach((c) => dims.company.push({
      company_key: key("C", c.id), name: c.name || "", status: c.status || "", type: c.type || "",
      city: c.city || "", region: c.region || "", country: c.country || "",
      account_manager_key: key("M", c.accountManagerId != null ? c.accountManagerId : c.managerId), created_at: date(c.createdAt),
    }));
    (members || []).forEach((m) => dims.member.push({
      member_key: key("M", m.id), name: m.name || "", functional_role: m.functionalRole || "",
      team_key: key("T", m.teamId), active: m.active !== false, dispatchable: m.dispatchable !== false,
    }));
    (teams || []).forEach((t) => { /* teams fold into member.team_key; not a separate dim */ });
    (boards || []).forEach((bd) => dims.board.push({ board_key: String(bd.code), label: bd.label || bd.code }));
    (tax || []).forEach((r) => {
      const k = String(r.code);
      if (r.category === "ticketStatus") dims.status.push({ status_key: k, label: r.label || k, closed: r.closed === true });
      else if (r.category === "priority") dims.priority.push({ priority_key: k, label: r.label || k });
      else if (r.category === "workType") dims.work_type.push({ work_type_key: k, label: r.label || k, billable: r.billable !== false });
    });
    return dims;
  };

  /* ─────────────────────────── facts ─────────────────────────── */

  B.facts = async function (pid, opts) {
    opts = opts || {};
    const closed = new Set((await ERP.tickets.closedCodes(pid).catch(() => [])).map(String));
    const today = ui.today();
    const facts = { ticket: [], time: [], expense: [], invoice: [], payment: [], opportunity: [], agreement: [], purchase_order: [] };

    /* tickets */
    const tickets = await ERP.tickets.listAll({});
    tickets.forEach((tk) => {
      const st = tk.sla ? ERP.sla.state(tk) : null;
      const closedHere = closed.has(String(tk.status));
      facts.ticket.push({
        ticket_key: key("TK", tk.companyId + "-" + tk.id), number: String(tk.number || ""),
        company_key: key("C", tk.companyId), board_key: String(tk.board || ""),
        status_key: String(tk.status || ""), priority_key: String(tk.priority || ""),
        source: String(tk.source || ""), type: String(tk.type || ""), subtype: String(tk.subtype || ""), item: String(tk.item || ""),
        owner_key: key("M", tk.ownerId), created_date: date(tk.createdAt), closed_date: date(tk.closedAt),
        age_days: tk.createdAt ? Math.max(0, ui.diffDays(String(tk.createdAt).slice(0, 10), today)) : null,
        open: !closedHere,
        first_response_minutes: tk.sla && tk.sla.responseMet && tk.createdAt ? Math.round((tk.sla.responseMet - Date.parse(tk.createdAt)) / 60000) : null,
        resolution_minutes: tk.sla && tk.sla.resolutionMet && tk.createdAt ? Math.round((tk.sla.resolutionMet - Date.parse(tk.createdAt)) / 60000) : null,
        sla_breached: !!(st && st.applies && st.breached),
      });
    });

    /* time */
    const entries = await ERP.time.entries(pid, {});
    entries.forEach((e) => {
      const billable = !!e.billable && !e.writtenOff;
      const rate = e.rate && isFinite(Number(e.rate.amount)) ? Number(e.rate.amount) : 0;
      facts.time.push({
        time_key: key("TE", e.id), date: date(e.date), month_key: monthOf(e.date),
        company_key: key("C", e.companyId), member_key: key("M", e.memberId),
        ticket_key: e.ticketId != null ? key("TK", e.companyId + "-" + e.ticketId) : null,
        project_key: e.projectId != null ? key("PJ", e.projectId) : null,
        work_type_key: String(e.workType || ""), charge_code_key: String(e.chargeCode || ""),
        billable: billable, minutes: num(e.minutes), billable_minutes: billable ? num(e.minutes) : 0,
        rate: round2(rate), amount: billable ? round2((num(e.minutes) / 60) * rate) : 0,
        status: String(e.status || ""), invoiced: e.invoiceId != null,
      });
    });

    /* expenses */
    const expenses = await ERP.expenses.list(pid, {});
    expenses.forEach((x) => facts.expense.push({
      expense_key: key("EX", x.id), date: date(x.date), month_key: monthOf(x.date),
      company_key: key("C", x.companyId), member_key: key("M", x.memberId),
      ticket_key: x.ticketId != null ? key("TK", x.companyId + "-" + x.ticketId) : null,
      category_key: String(x.category || ""), amount: round2(num(x.amount)),
      billable_amount: round2(ERP.expenses.billableAmount(x)), billable: !!x.billable && !x.writtenOff,
      status: String(x.status || ""),
    }));

    /* invoices */
    const invoices = await ERP.billing.all(pid, {});
    invoices.forEach((i) => facts.invoice.push({
      invoice_key: key("INV", i.id), number: String(i.number || ""), company_key: key("C", i.companyId),
      status: String(i.status || ""), issue_date: date(i.issueDate), due_date: date(i.dueDate), month_key: monthOf(i.issueDate),
      subtotal: round2(num(i.subtotal)), tax: round2(num(i.taxTotal)), total: round2(num(i.total)),
      paid: round2(num(i.amountPaid)), balance: round2(num(i.balance)), payment_status: String(i.paymentStatus || ""),
    }));

    /* payments & credits */
    const payments = await ERP.payments.all(pid, {});
    payments.forEach((p) => facts.payment.push({
      payment_key: key("PMT", p.id), number: String(p.number || ""), company_key: key("C", p.companyId),
      invoice_key: p.invoiceId != null ? key("INV", p.invoiceId) : null, date: date(p.date), month_key: monthOf(p.date),
      amount: round2(num(p.amount)), method: String(p.method || ""), status: String(p.status || ""), kind: String(p.kind || "payment"),
    }));
    const credits = await ERP.payments.credits(pid, {}).catch(() => []);
    credits.forEach((c) => facts.payment.push({
      payment_key: key("CR", c.id), number: String(c.number || ""), company_key: key("C", c.companyId),
      invoice_key: null, date: date(c.date), month_key: monthOf(c.date), amount: round2(num(c.amount)),
      method: "credit", status: String(c.status || ""), kind: "credit",
    }));

    /* opportunities */
    const opps = await ERP.sales.list(pid, {});
    const stages = await ERP.sales.stages(pid).catch(() => []);
    opps.forEach((o) => facts.opportunity.push({
      opportunity_key: key("OPP", o.id), number: String(o.number || ""), company_key: key("C", o.companyId),
      name: String(o.name || ""), stage_key: String(o.stage || ""), status: String(o.status || ""),
      value: round2(num(o.value)), weighted_value: round2(ERP.sales.weightedValue(stages, o)),
      probability: ERP.sales.probOf(stages, o), expected_close: date(o.expectedClose), month_key: monthOf(o.expectedClose),
      owner_key: key("M", o.ownerId), source: String(o.source || ""), created_date: date(o.createdAt),
    }));

    /* agreements */
    const agreements = await ERP.agreements.list(pid, {});
    agreements.forEach((a) => facts.agreement.push({
      agreement_key: key("AGR", a.id), number: String(a.number || ""), company_key: key("C", a.companyId),
      name: String(a.name || ""), type: String(a.type || ""), status: String(a.status || ""),
      billing_cycle: String(a.billingCycle || ""), start_date: date(a.startDate), end_date: date(a.endDate),
      included_hours: num(a.includedHours),
    }));

    /* purchase orders */
    const pos = await ERP.procurement.list(pid, {});
    pos.forEach((p) => facts.purchase_order.push({
      po_key: key("PO", p.id), number: String(p.number || ""), vendor_key: key("V", p.vendorId),
      company_key: key("C", p.companyId), status: String(p.status || ""),
      order_date: date(p.orderDate), expected_date: date(p.expectedDate),
      subtotal: round2(num(p.subtotal)), total: round2(num(p.total)),
    }));

    return facts;
  };

  /* ─────────────────────────── extract ─────────────────────────── */

  B.extract = async function (pid, opts) {
    opts = opts || {};
    const p = await ten().provider();
    const [dimensions, facts] = await Promise.all([B.dimensions(pid), B.facts(pid, opts)]);
    const counts = {};
    Object.keys(facts).forEach((k) => { counts[k] = facts[k].length; });
    Object.keys(dimensions).forEach((k) => { counts["dim_" + k] = dimensions[k].length; });
    return B.envelope("bi.extract", { dimensions: dimensions, facts: facts, counts: counts }, {
      provider: p ? { id: p.id, name: p.name } : null,
    });
  };

  /* Flatten one fact (or dimension) to CSV using the documented schema order. */
  B.toCsv = function (extract, name, kind) {
    const cols = (kind === "dimension" ? B.SCHEMA.dimensions[name] : B.SCHEMA.facts[name]) || [];
    const rows = (kind === "dimension" ? extract.dimensions[name] : extract.facts[name]) || [];
    const header = cols.map((c) => c.name).join(",");
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const body = rows.map((r) => cols.map((c) => esc(r[c.name])).join(",")).join("\n");
    return header + (body ? "\n" + body : "") + "\n";
  };

  B.downloadJson = function (extract, name) {
    try {
      const blob = new Blob([JSON.stringify(extract, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name || "psa-bi-extract.json"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { ok: true };
    } catch (e) { return { error: "download_failed", message: (e && e.message) || String(e) }; }
  };

  /* ─────────────────────────── handoff ─────────────────────────── */

  B.newHandoff = function (over) {
    return Object.assign({
      kind: "biHandoff", id: null, name: "BI extract", generatedAt: null,
      url: null, version: B.SCHEMA_VERSION, counts: {}, bytes: 0,
      createdAt: null, updatedAt: null,
    }, over || {});
  };

  B.handoffs = async function (pid) {
    const list = await ten().records("provider", pid, "biHandoff");
    return list.slice().sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
  };

  B.publish = async function (pid, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("reports.export")) return { error: "forbidden" };
    const extract = opts.extract || await B.extract(pid, opts);
    const json = JSON.stringify(extract, null, 2);
    const up = window.root && root.uploadPlugin;
    if (!up) return { error: "upload_unavailable", message: "The upload plugin is not loaded, so the extract can't be published.", extract: extract };
    let res;
    try { res = await up(json, { expires: Date.now() + 1000 * 60 * 60 * 24 * 90 }); }
    catch (e) { return { error: "upload_failed", message: (e && e.message) || String(e), extract: extract }; }
    if (!res || res.error || !res.url) return { error: (res && res.error) || "upload_failed", message: "The extract could not be published.", extract: extract };
    const rec = B.newHandoff({
      name: opts.name || ("BI extract " + ui.today()), generatedAt: extract.generatedAt,
      url: res.url, version: B.SCHEMA_VERSION, counts: extract.counts, bytes: json.length,
      createdAt: nowIso(), updatedAt: nowIso(),
    });
    rec.id = ten().nextId(await ten().records("provider", pid));
    await ten().upsert("provider", pid, rec);
    return { record: rec, extract: extract, url: res.url };
  };

  B.removeHandoff = async function (pid, id) {
    if (!ERP.security.enforce("reports.export")) return { error: "forbidden" };
    await ten().remove("provider", pid, (r) => r.kind === "biHandoff" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* ─────────────────────────── station tab ─────────────────────────── */

  B.renderExport = async function (panel, pid, refresh) {
    const host = panel.__host || panel;
    const state = host.__bi || (host.__bi = { fact: "ticket", extract: null, preview: null });
    if (!state.extract) state.extract = await B.extract(pid, {});
    const extract = state.extract;
    if (!state.fact || B.factNames().indexOf(state.fact) === -1) state.fact = "ticket";
    const cols = B.factColumns(state.fact);
    const rows = (extract.facts[state.fact] || []).slice(0, 100);

    const factOptions = B.factNames().map((k) => ({ value: k, label: k + " (" + (extract.counts[k] || 0) + ")" }));
    const dimTable = ui.table([{ key: "name", label: "Dimension" }, { key: "count", label: "Rows", align: "right" }],
      B.dimensionNames().map((k) => ({ name: k, count: extract.counts["dim_" + k] || 0 })));
    const factTable = ui.table([{ key: "name", label: "Fact" }, { key: "count", label: "Rows", align: "right" }],
      B.factNames().map((k) => ({ name: k, count: extract.counts[k] || 0 })));

    const previewCols = cols.map((c) => ({ key: c.name, label: c.name, align: c.type === "number" ? "right" : "", render: (r) => renderCell(c, r) }));

    const schemaTable = ui.table([{ key: "name", label: "Column" }, { key: "type", label: "Type" }], cols);

    const handoffs = await B.handoffs(pid);
    const handoffTable = ui.table([
      { key: "name", label: "Extract" },
      { key: "generatedAt", label: "Generated", render: (r) => ui.dateTime(r.generatedAt) },
      { key: "version", label: "Schema" },
      { key: "bytes", label: "Bytes", align: "right" },
      { key: "url", label: "Link", render: (r) => (r.url ? '<a href="' + ui.esc(r.url) + '" target="_blank" rel="noopener">open</a>' : "—") },
      { key: "actions", label: "", render: (r) => ui.btn("Delete", { small: true, danger: true, act: "bi-del", arg: r.id, icon: null }) },
    ], handoffs, { emptyText: "No published extracts yet." });

    panel.innerHTML =
      ui.pageHead("BI export", "A schema-stable fact/dimension extract for the reporting tool, through the shared envelope.", "") +
      '<div class="erp-toolbar">' +
        ui.btn("Rebuild extract", { small: true, act: "bi-build", icon: null }) +
        ui.btn("Download JSON", { small: true, act: "bi-json", icon: null }) +
        ui.btn("Download fact CSV", { small: true, act: "bi-csv", icon: null }) +
        '<label class="erp-inline-field">Fact <select name="bi_fact">' + factOptions.map((o) => '<option value="' + ui.esc(o.value) + '"' + (o.value === state.fact ? " selected" : "") + ">" + ui.esc(o.label) + "</option>").join("") + "</select></label>" +
        ui.btn("Publish to BI", { small: true, primary: true, act: "bi-publish", icon: null }) +
      "</div>" +
      ui.summary([
        { label: "Envelope", value: ui.esc(extract.schema) + " v" + extract.schemaVersion },
        { label: "Schema version", value: ui.esc(extract.version) },
        { label: "Generated", value: ui.esc(ui.dateTime(extract.generatedAt)) },
        { label: "Dimension rows", value: ui.fmt(B.dimensionNames().reduce((nn, k) => nn + (extract.counts["dim_" + k] || 0), 0), 0) },
        { label: "Fact rows", value: ui.fmt(B.factNames().reduce((nn, k) => nn + (extract.counts[k] || 0), 0), 0) },
      ]) +
      '<div class="erp-dash-cols">' + ui.card("Dimensions", dimTable) + ui.card("Facts", factTable) + "</div>" +
      ui.card("Fact preview · " + state.fact + " (schema columns)", ui.table(previewCols, rows, { emptyText: "No rows in this fact." }), { actions: ui.btn("Schema", { small: true, act: "bi-schema-toggle", icon: null }) }) +
      '<div id="biSchema" hidden>' + ui.card("Schema · " + state.fact, schemaTable) + "</div>" +
      ui.card("Published handoffs", handoffTable);

    panel.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act"), arg = t.getAttribute("data-arg");
      if (act === "bi-build") { state.extract = await B.extract(pid, {}); ERP.toast("Extract rebuilt.", "success"); refresh(); }
      else if (act === "bi-json") { B.downloadJson(state.extract, "psa-bi-extract-" + ui.today() + ".json"); }
      else if (act === "bi-csv") { ERP.reports.downloadCsv("psa-" + state.fact + "-" + ui.today() + ".csv", B.toCsv(state.extract, state.fact)); }
      else if (act === "bi-schema-toggle") { const s = panel.querySelector("#biSchema"); if (s) s.hidden = !s.hidden; }
      else if (act === "bi-publish") {
        const out = await B.publish(pid, { extract: state.extract });
        if (out.error) { ERP.toast("Publish failed: " + (out.message || out.error), "error"); return; }
        ERP.toast("Extract published.", "success"); refresh();
      } else if (act === "bi-del") {
        const ok = await ui.confirm({ title: "Delete handoff", message: "Remove this published extract record? The uploaded file itself is not deleted.", danger: true, okLabel: "Delete" });
        if (!ok) return;
        await B.removeHandoff(pid, arg); refresh();
      }
    });
    panel.addEventListener("change", async (e) => {
      if (e.target && e.target.name === "bi_fact") { state.fact = e.target.value; refresh(); }
    });
  };

  function renderCell(col, row) {
    const v = row[col.name];
    if (v == null || v === "") return "—";
    if (col.type === T.num) return ui.fmt(v, Number.isInteger(v) ? 0 : 2);
    if (col.type === T.bool) return v ? "true" : "false";
    return ui.esc(v);
  }
})();
