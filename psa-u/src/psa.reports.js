/* ============================================================================
   PSA-U — report builder & scheduled delivery (Phase 11 · Task 51)

   Reporting over the records the rest of the platform owns, never a second
   copy of the data. A report is a small JSON definition:

     { source, filters:[{field, op, value}], groupBy:[field, ...],
       metrics:[{field, agg}], sort, desc, limit, viz }

   • SOURCES     — one adapter per core entity (tickets, time, expenses,
                   invoices, payments, agreements, opportunities, quotes,
                   projects, purchase orders, configurations, articles,
                   members). Each flattens its records into a stable row shape
                   and declares typed columns, so the builder can offer fields,
                   type-appropriate operators and numeric metrics without any
                   per-source UI code.
   • FILTERS     — a small operator set (eq, ne, contains, in, gt/gte/lt/lte,
                   between, truthy/falsy) applied declaratively.
   • GROUPING    — group rows by one or more fields and reduce with
                   count/sum/avg/min/max/countDistinct.
   • DEFINITIONS — named reports saved in the provider document (kind
                   "reportDef"), runnable on demand or from a schedule.
   • SCHEDULES   — a cadence (daily/weekly/monthly, at an hour), recipients
                   and a format, stored as kind "reportSchedule". `sweep()`
                   delivers every due schedule, producing a "reportDelivery"
                   artifact (the rendered CSV plus a summary) with a link, and
                   advances the schedule's next run. Nothing is emailed by the
                   platform itself; the delivery is the payload a connector
                   (Phase 12) or a human picks up.

   The station controller (R.render) composes four tabs — Dashboards, Builder,
   Schedules, Export — backed by ERP.dashboards and ERP.bi.
   ============================================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const R = (ERP.reports = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("reports require the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function uniq(a) { return Array.from(new Set(a)); }

  R.DOC_KINDS = { def: "reportDef", schedule: "reportSchedule", delivery: "reportDelivery" };

  /* ─────────────────────────── context (name lookups) ─────────────────────────── */

  R.context = async function (pid) {
    const safe = (p) => Promise.resolve(p).catch(() => []);
    const [companies, members, boards, tax] = await Promise.all([
      safe(ERP.companies.list()),
      ERP.members && ERP.members.members ? safe(ERP.members.members()) : [],
      ERP.tickets && ERP.tickets.boards ? safe(ERP.tickets.boards(pid)) : [],
      ERP.taxonomy ? safe(ERP.taxonomy.list(pid)) : [],
    ]);
    const byCat = {};
    (tax || []).forEach((r) => { (byCat[r.category] = byCat[r.category] || {})[String(r.code)] = r; });
    return {
      companies: companies || [],
      members: members || [],
      boards: boards || [],
      tax: tax || [],
      companyName: (id) => { const c = (companies || []).find((x) => String(x.id) === String(id)); return c ? c.name : ""; },
      memberName: (id) => { const m = (members || []).find((x) => String(x.id) === String(id)); return m ? m.name : ""; },
      boardLabel: (code) => { const b = (boards || []).find((x) => String(x.code) === String(code)); return b ? (b.label || b.code) : (code || ""); },
      taxLabel: (cat, code) => { const r = byCat[cat] && byCat[cat][String(code)]; return r ? (r.label || code) : (code || ""); },
      taxRec: (cat, code) => (byCat[cat] && byCat[cat][String(code)]) || null,
    };
  };

  /* ─────────────────────────── column helper ─────────────────────────── */

  function col(key, label, type, over) {
    return Object.assign({ key: key, label: label, type: type || "text" }, over || {});
  }
  function monthOf(dateStr) { return String(dateStr || "").slice(0, 7); }

  /* ─────────────────────────── sources ─────────────────────────── */

  R.SOURCES = [
    {
      id: "tickets", label: "Tickets", icon: "ticket",
      desc: "Every ticket with its board, status, priority, owner and SLA outcome.",
      columns: [
        col("number", "Ticket", "text"),
        col("summary", "Summary", "text"),
        col("companyName", "Client", "text"),
        col("boardLabel", "Board", "text"),
        col("statusLabel", "Status", "text"),
        col("priorityLabel", "Priority", "text"),
        col("ownerName", "Owner", "text"),
        col("source", "Source", "text"),
        col("createdAt", "Created", "date"),
        col("ageDays", "Age (days)", "number", { decimals: 0 }),
        col("closedAt", "Closed", "date"),
        col("open", "Open", "bool"),
        col("responseHours", "First response (h)", "number", { decimals: 1 }),
        col("resolutionHours", "Resolution (h)", "number", { decimals: 1 }),
        col("slaState", "SLA", "text"),
      ],
      async load(pid, cx) {
        const list = await ERP.tickets.listAll({});
        const today = ui.today();
        const closed = await ERP.tickets.closedCodes(pid).catch(() => []);
        const closedSet = new Set((closed || []).map(String));
        return list.map((t) => {
          const isOpen = !closedSet.has(String(t.status));
          const st = ERP.sla && t.sla ? ERP.sla.state(t) : null;
          const cMs = Date.parse(t.createdAt) || null;
          return {
            id: t.id, companyId: t.companyId, number: t.number, summary: t.summary || "",
            companyName: t.__companyName || cx.companyName(t.companyId),
            boardLabel: cx.boardLabel(t.board), statusLabel: cx.taxLabel("ticketStatus", t.status),
            priorityLabel: cx.taxLabel("priority", t.priority), ownerName: t.__ownerName || cx.memberName(t.ownerId),
            source: cx.taxLabel("source", t.source) || t.source || "",
            createdAt: t.createdAt || "", ageDays: t.createdAt ? ui.diffDays(String(t.createdAt).slice(0, 10), today) : "",
            closedAt: t.closedAt || "", open: isOpen,
            responseHours: t.sla && t.sla.responseMet && cMs ? round2((t.sla.responseMet - cMs) / 3600000) : "",
            resolutionHours: t.sla && t.sla.resolutionMet && cMs ? round2((t.sla.resolutionMet - cMs) / 3600000) : "",
            slaState: st && st.applies ? ERP.sla.stateLabel(st) : "No SLA",
          };
        });
      },
    },
    {
      id: "time", label: "Time entries", icon: "clock",
      desc: "Captured time with member, client, work type and billable value.",
      columns: [
        col("date", "Date", "date"),
        col("month", "Month", "text"),
        col("companyName", "Client", "text"),
        col("memberName", "Member", "text"),
        col("workTypeLabel", "Work type", "text"),
        col("minutes", "Minutes", "number", { decimals: 0 }),
        col("hours", "Hours", "number", { decimals: 2 }),
        col("billable", "Billable", "bool"),
        col("amount", "Billable value", "number", { money: true }),
        col("statusLabel", "Status", "text"),
        col("invoiced", "Invoiced", "bool"),
      ],
      async load(pid, cx) {
        const list = await ERP.time.entries(pid, {});
        return list.map((e) => {
          const rate = e.rate && isFinite(Number(e.rate.amount)) ? Number(e.rate.amount) : 0;
          const billable = !!e.billable && !e.writtenOff;
          return {
            id: e.id, companyId: e.companyId, date: e.date || "", month: monthOf(e.date),
            companyName: cx.companyName(e.companyId), memberName: cx.memberName(e.memberId),
            workTypeLabel: cx.taxLabel("workType", e.workType) || e.workType || "",
            minutes: num(e.minutes), hours: round2(num(e.minutes) / 60),
            billable: billable, amount: billable ? round2((num(e.minutes) / 60) * rate) : 0,
            statusLabel: ERP.time.statusLabel(e.status), invoiced: e.invoiceId != null,
            currency: e.currency || "",
          };
        });
      },
    },
    {
      id: "expenses", label: "Expenses", icon: "finance",
      desc: "Expenses with category, billable amount and approval status.",
      columns: [
        col("date", "Date", "date"),
        col("month", "Month", "text"),
        col("companyName", "Client", "text"),
        col("memberName", "Member", "text"),
        col("categoryLabel", "Category", "text"),
        col("amount", "Cost", "number", { money: true }),
        col("billableAmount", "Billable", "number", { money: true }),
        col("billable", "Billable?", "bool"),
        col("statusLabel", "Status", "text"),
      ],
      async load(pid, cx) {
        const list = await ERP.expenses.list(pid, {});
        return list.map((x) => ({
          id: x.id, companyId: x.companyId, date: x.date || "", month: monthOf(x.date),
          companyName: cx.companyName(x.companyId), memberName: cx.memberName(x.memberId),
          categoryLabel: cx.taxLabel("expenseCategory", x.category) || x.category || "",
          amount: round2(num(x.amount)), billableAmount: round2(ERP.expenses.billableAmount(x)),
          billable: !!x.billable && !x.writtenOff, statusLabel: ERP.expenses.statusLabel(x.status),
          currency: x.currency || "",
        }));
      },
    },
    {
      id: "invoices", label: "Invoices", icon: "finance",
      desc: "Invoices with totals, balances and where they are in their life cycle.",
      columns: [
        col("number", "Invoice", "text"),
        col("companyName", "Client", "text"),
        col("statusLabel", "Status", "text"),
        col("issueDate", "Issued", "date"),
        col("dueDate", "Due", "date"),
        col("month", "Month", "text"),
        col("subtotal", "Subtotal", "number", { money: true }),
        col("taxTotal", "Tax", "number", { money: true }),
        col("total", "Total", "number", { money: true }),
        col("amountPaid", "Paid", "number", { money: true }),
        col("balance", "Balance", "number", { money: true }),
        col("daysOverdue", "Days overdue", "number", { decimals: 0 }),
      ],
      async load(pid, cx) {
        const list = await ERP.billing.all(pid, {});
        const today = ui.today();
        return list.map((i) => {
          const overdue = i.status === "posted" && i.balance > 0.005 && i.dueDate ? Math.max(0, ui.diffDays(i.dueDate, today)) : 0;
          return {
            id: i.id, companyId: i.companyId, number: i.number, companyName: i.__companyName || cx.companyName(i.companyId),
            statusLabel: i.status, issueDate: i.issueDate || "", dueDate: i.dueDate || "", month: monthOf(i.issueDate),
            subtotal: round2(num(i.subtotal)), taxTotal: round2(num(i.taxTotal)), total: round2(num(i.total)),
            amountPaid: round2(num(i.amountPaid)), balance: round2(num(i.balance)), daysOverdue: overdue,
            currency: i.currency || "",
          };
        });
      },
    },
    {
      id: "payments", label: "Payments & credits", icon: "finance",
      desc: "Money received and credits issued against clients.",
      columns: [
        col("number", "Reference", "text"),
        col("companyName", "Client", "text"),
        col("date", "Date", "date"),
        col("month", "Month", "text"),
        col("amount", "Amount", "number", { money: true }),
        col("method", "Method", "text"),
        col("status", "Status", "text"),
      ],
      async load(pid, cx) {
        const out = [];
        const pays = await ERP.payments.all(pid, {});
        pays.forEach((p) => out.push({
          id: p.id, companyId: p.companyId, number: p.number, companyName: cx.companyName(p.companyId),
          date: p.date || "", month: monthOf(p.date), amount: round2(num(p.amount)),
          method: p.method || "", status: p.status || "", kind: p.kind, currency: p.currency || "",
        }));
        const credits = await ERP.payments.credits(pid, {}).catch(() => []);
        credits.forEach((c) => out.push({
          id: c.id, companyId: c.companyId, number: c.number, companyName: cx.companyName(c.companyId),
          date: c.date || "", month: monthOf(c.date), amount: round2(num(c.amount)),
          method: "credit", status: c.status || "", kind: c.kind, currency: c.currency || "",
        }));
        return out;
      },
    },
    {
      id: "agreements", label: "Agreements", icon: "agreement",
      desc: "Recurring service agreements with their term and coverage.",
      columns: [
        col("number", "Agreement", "text"),
        col("name", "Name", "text"),
        col("companyName", "Client", "text"),
        col("typeLabel", "Type", "text"),
        col("statusLabel", "Status", "text"),
        col("billingCycle", "Billing cycle", "text"),
        col("startDate", "Start", "date"),
        col("endDate", "End", "date"),
        col("includedHours", "Included hours", "number", { decimals: 1 }),
      ],
      async load(pid, cx) {
        const list = await ERP.agreements.list(pid, {});
        return list.map((a) => ({
          id: a.id, companyId: a.companyId, number: a.number, name: a.name, companyName: a.__companyName || cx.companyName(a.companyId),
          typeLabel: cx.taxLabel("agreementType", a.type) || a.type || "", statusLabel: a.status,
          billingCycle: a.billingCycle || "", startDate: a.startDate || "", endDate: a.endDate || "",
          includedHours: num(a.includedHours), currency: a.currency || "",
        }));
      },
    },
    {
      id: "opportunities", label: "Opportunities", icon: "sales",
      desc: "The sales pipeline with stage, value and weighted forecast.",
      columns: [
        col("number", "Opportunity", "text"),
        col("name", "Name", "text"),
        col("companyName", "Client", "text"),
        col("stageLabel", "Stage", "text"),
        col("status", "Status", "text"),
        col("value", "Value", "number", { money: true }),
        col("weighted", "Weighted", "number", { money: true }),
        col("probability", "Probability %", "number", { decimals: 0 }),
        col("expectedClose", "Expected close", "date"),
        col("month", "Close month", "text"),
        col("ownerName", "Owner", "text"),
      ],
      async load(pid, cx) {
        const list = await ERP.sales.list(pid, {});
        const stages = await ERP.sales.stages(pid).catch(() => []);
        return list.map((o) => ({
          id: o.id, companyId: o.companyId, number: o.number, name: o.name, companyName: o.__companyName || cx.companyName(o.companyId),
          stageLabel: (stages.find((s) => String(s.code) === String(o.stage)) || {}).label || o.stage || "",
          status: o.status, value: round2(num(o.value)), weighted: round2(ERP.sales.weightedValue(stages, o)),
          probability: ERP.sales.probOf(stages, o), expectedClose: o.expectedClose || "", month: monthOf(o.expectedClose),
          ownerName: cx.memberName(o.ownerId), currency: o.currency || "",
        }));
      },
    },
    {
      id: "quotes", label: "Quotes", icon: "sales",
      desc: "Quotes and proposals with value, cost and margin.",
      columns: [
        col("number", "Quote", "text"),
        col("title", "Title", "text"),
        col("companyName", "Client", "text"),
        col("status", "Status", "text"),
        col("issuedDate", "Issued", "date"),
        col("validUntil", "Valid until", "date"),
        col("subtotal", "Subtotal", "number", { money: true }),
        col("costTotal", "Cost", "number", { money: true }),
        col("total", "Total", "number", { money: true }),
        col("marginPct", "Margin %", "number", { decimals: 1 }),
      ],
      async load(pid, cx) {
        const list = await ERP.sales.listQuotes(pid, {});
        return list.map((q) => ({
          id: q.id, companyId: q.companyId, number: q.number, title: q.title, companyName: q.__companyName || cx.companyName(q.companyId),
          status: q.status, issuedDate: q.issuedDate || "", validUntil: q.validUntil || "",
          subtotal: round2(num(q.subtotal)), costTotal: round2(num(q.costTotal)), total: round2(num(q.total)),
          marginPct: q.marginPct == null ? "" : num(q.marginPct), currency: q.currency || "",
        }));
      },
    },
    {
      id: "projects", label: "Projects", icon: "projects",
      desc: "Projects with type, status and schedule.",
      columns: [
        col("number", "Project", "text"),
        col("name", "Name", "text"),
        col("companyName", "Client", "text"),
        col("typeLabel", "Type", "text"),
        col("status", "Status", "text"),
        col("startDate", "Start", "date"),
        col("dueDate", "Due", "date"),
        col("fixedFee", "Fixed fee", "number", { money: true }),
      ],
      async load(pid, cx) {
        const list = await ERP.projects.list(pid, {});
        return list.map((p) => ({
          id: p.id, companyId: p.companyId, number: p.number, name: p.name, companyName: p.__companyName || cx.companyName(p.companyId),
          typeLabel: cx.taxLabel("projectType", p.type) || p.type || "", status: p.status,
          startDate: p.startDate || "", dueDate: p.dueDate || "", fixedFee: round2(num(p.fixedFee)), currency: p.currency || "",
        }));
      },
    },
    {
      id: "purchase_orders", label: "Purchase orders", icon: "purchasing",
      desc: "Purchase orders with vendor, status and value.",
      columns: [
        col("number", "PO", "text"),
        col("vendorName", "Vendor", "text"),
        col("companyName", "Client", "text"),
        col("status", "Status", "text"),
        col("orderDate", "Ordered", "date"),
        col("expectedDate", "Expected", "date"),
        col("subtotal", "Subtotal", "number", { money: true }),
        col("total", "Total", "number", { money: true }),
      ],
      async load(pid, cx) {
        const list = await ERP.procurement.list(pid, {});
        const vendors = await ERP.procurement.vendors(pid).catch(() => []);
        return list.map((p) => {
          const v = vendors.find((x) => String(x.id) === String(p.vendorId));
          return {
            id: p.id, companyId: p.companyId, number: p.number, vendorName: v ? v.name : "",
            companyName: cx.companyName(p.companyId), status: p.status,
            orderDate: p.orderDate || "", expectedDate: p.expectedDate || "",
            subtotal: round2(num(p.subtotal)), total: round2(num(p.total)), currency: p.currency || "",
          };
        });
      },
    },
    {
      id: "configurations", label: "Assets", icon: "inventory",
      desc: "Client configuration / asset records.",
      columns: [
        col("name", "Asset", "text"),
        col("companyName", "Client", "text"),
        col("type", "Type", "text"),
        col("make", "Make", "text"),
        col("model", "Model", "text"),
        col("serialNumber", "Serial", "text"),
        col("status", "Status", "text"),
        col("warrantyEnd", "Warranty end", "date"),
      ],
      async load(pid, cx) {
        const list = await ERP.configurations.allItems(pid).catch(() => []);
        return list.map((a) => ({
          id: a.id, companyId: a.companyId, name: a.name, companyName: cx.companyName(a.companyId),
          type: a.type || "", make: a.make || "", model: a.model || "", serialNumber: a.serialNumber || "",
          status: a.status || "", warrantyEnd: a.warrantyEnd || "",
        }));
      },
    },
    {
      id: "articles", label: "Knowledge articles", icon: "book",
      desc: "Knowledge base articles with visibility and engagement.",
      columns: [
        col("number", "Article", "text"),
        col("title", "Title", "text"),
        col("categoryName", "Category", "text"),
        col("status", "Status", "text"),
        col("visibility", "Visibility", "text"),
        col("views", "Views", "number", { decimals: 0 }),
        col("helpful", "Helpful", "number", { decimals: 0 }),
        col("updatedAt", "Updated", "date"),
      ],
      async load(pid, cx) {
        const list = await ERP.kb.articles(pid, {});
        const cats = await ERP.kb.categories(pid).catch(() => []);
        return list.map((a) => ({
          id: a.id, companyId: null, number: a.number, title: a.title,
          categoryName: (cats.find((c) => String(c.id) === String(a.categoryId)) || {}).name || "",
          status: a.status, visibility: a.visibility, views: num(a.views), helpful: num(a.helpful), updatedAt: a.updatedAt || "",
        }));
      },
    },
    {
      id: "members", label: "Members", icon: "crm",
      desc: "Staff/technician records with role and rates.",
      columns: [
        col("name", "Member", "text"),
        col("roleLabel", "Functional role", "text"),
        col("email", "Email", "text"),
        col("active", "Active", "bool"),
        col("dispatchable", "Dispatchable", "bool"),
        col("hourlyCost", "Hourly cost", "number", { money: true }),
      ],
      async load(pid, cx) {
        const list = await ERP.members.members();
        return list.map((m) => ({
          id: m.id, companyId: null, name: m.name, roleLabel: m.functionalRole || "",
          email: m.email || "", active: m.active !== false, dispatchable: m.dispatchable !== false,
          hourlyCost: round2(num(m.hourlyCost)), currency: m.currency || "",
        }));
      },
    },
  ];

  R.source = function (id) { return R.SOURCES.find((s) => s.id === id) || null; };
  R.columns = function (id) { const s = R.source(id); return s ? s.columns.slice() : []; };
  R.columnMap = function (id) {
    const s = R.source(id); const map = {};
    if (s) s.columns.forEach((c) => { map[c.key] = c; });
    return map;
  };

  /* ─────────────────────────── filters ─────────────────────────── */

  R.ALL_OPS = ["eq", "ne", "contains", "not_contains", "in", "gt", "gte", "lt", "lte", "between", "truthy", "falsy", "is_empty"];
  R.OP_LABELS = {
    eq: "is", ne: "is not", contains: "contains", not_contains: "does not contain",
    in: "is any of", gt: ">", gte: "≥", lt: "<", lte: "≤", between: "between",
    truthy: "is true", falsy: "is false", is_empty: "is empty",
  };
  R.opsFor = function (type) {
    if (type === "number" || type === "date") return ["eq", "ne", "gt", "gte", "lt", "lte", "between", "is_empty"];
    if (type === "bool") return ["truthy", "falsy", "eq"];
    return ["eq", "ne", "contains", "not_contains", "in", "is_empty"];
  };
  R.opNeedsValue = (op) => ["truthy", "falsy", "is_empty"].indexOf(op) === -1;

  function norm(v) { return String(v == null ? "" : v).toLowerCase().trim(); }
  function asNum(v) { const n = Number(v); return isFinite(n) ? n : NaN; }

  R.testFilter = function (row, f) {
    const raw = row[f.field];
    const val = f.value;
    switch (f.op) {
      case "eq": return f.type === "number" || f.type === "date" ? String(raw) === String(val) : norm(raw) === norm(val);
      case "ne": return f.type === "number" || f.type === "date" ? String(raw) !== String(val) : norm(raw) !== norm(val);
      case "contains": return norm(raw).indexOf(norm(val)) !== -1;
      case "not_contains": return norm(raw).indexOf(norm(val)) === -1;
      case "in": { const parts = String(val == null ? "" : val).split(",").map(norm).filter(Boolean); return parts.indexOf(norm(raw)) !== -1; }
      case "gt": return asNum(raw) > asNum(val);
      case "gte": return asNum(raw) >= asNum(val);
      case "lt": return asNum(raw) < asNum(val);
      case "lte": return asNum(raw) <= asNum(val);
      case "between": { const a = asNum(val), b = f.value2 != null && f.value2 !== "" ? asNum(f.value2) : Infinity; const x = asNum(raw); return x >= Math.min(a, b) && x <= Math.max(a, b); }
      case "truthy": return !!raw;
      case "falsy": return !raw;
      case "is_empty": return raw == null || raw === "";
      default: return true;
    }
  };

  R.applyFilters = function (rows, filters) {
    const fs = (filters || []).filter((f) => f && f.field && f.op);
    if (!fs.length) return rows.slice();
    return rows.filter((r) => fs.every((f) => R.testFilter(r, f)));
  };

  /* ─────────────────────────── aggregation ─────────────────────────── */

  R.AGGS = [
    { id: "count", label: "Count" },
    { id: "countDistinct", label: "Distinct count" },
    { id: "sum", label: "Sum" },
    { id: "avg", label: "Average" },
    { id: "min", label: "Minimum" },
    { id: "max", label: "Maximum" },
  ];
  R.aggLabel = (id) => (R.AGGS.find((a) => a.id === id) || {}).label || id;

  R.metricKey = (m) => (m.agg === "count" ? "count" : m.agg + "_" + m.field);
  R.metricLabel = function (m, cols) {
    if (m.agg === "count") return "Count";
    const c = cols[m.field] || {};
    return R.aggLabel(m.agg) + " of " + (c.label || m.field);
  };

  function reduceGroup(rows, m, cols) {
    const c = cols[m.field] || {};
    if (m.agg === "count") return rows.length;
    if (m.agg === "countDistinct") return uniq(rows.map((r) => String(r[m.field]))).length;
    const vals = rows.map((r) => asNum(r[m.field])).filter((n) => isFinite(n));
    if (!vals.length) return "";
    if (m.agg === "sum") return round2(vals.reduce((a, b) => a + b, 0));
    if (m.agg === "avg") return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
    if (m.agg === "min") return Math.min.apply(null, vals);
    if (m.agg === "max") return Math.max.apply(null, vals);
    return "";
  }

  R.groupRows = function (rows, groupBy, metrics, cols) {
    const keys = (groupBy || []).filter(Boolean);
    const ms = (metrics && metrics.length ? metrics : [{ agg: "count", field: "" }]);
    const map = {};
    const order = [];
    rows.forEach((r) => {
      const parts = keys.map((k) => String(r[k] == null ? "" : r[k]));
      const k = parts.join("\u0001");
      if (!map[k]) {
        const g = { __key: k, __rows: [] };
        keys.forEach((f, i) => { g[f] = parts[i]; });
        map[k] = g; order.push(k);
      }
      map[k].__rows.push(r);
    });
    return order.map((k) => {
      const g = map[k];
      const row = {};
      keys.forEach((f) => { row[f] = g[f]; });
      ms.forEach((m) => { row[R.metricKey(m)] = reduceGroup(g.__rows, m, cols); });
      row.__count = g.__rows.length;
      return row;
    });
  };

  /* ─────────────────────────── definitions ─────────────────────────── */

  R.newDef = function (over) {
    return Object.assign({
      kind: R.DOC_KINDS.def, id: null, name: "Untitled report",
      source: "tickets", filters: [],
      groupBy: [], metrics: [{ agg: "count", field: "" }],
      columns: [], sort: "", desc: false, limit: 500, viz: "table",
      note: "", createdAt: null, updatedAt: null,
    }, over || {});
  };

  R.defs = async function (pid) {
    const list = await ten().records("provider", pid, R.DOC_KINDS.def);
    return list.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  };
  R.def = async function (pid, id) {
    return (await ten().records("provider", pid, R.DOC_KINDS.def)).find((d) => String(d.id) === String(id)) || null;
  };

  R.saveDef = async function (pid, def) {
    if (!ERP.security.enforce("reports.build")) return { error: "forbidden" };
    const existing = def && def.id != null ? await R.def(pid, def.id) : null;
    const r = Object.assign(R.newDef(), existing || {}, def || {});
    if (!String(r.name || "").trim()) return { error: "name_required" };
    if (!R.source(r.source)) return { error: "source_required" };
    const cm = R.columnMap(r.source);
    r.filters = (r.filters || []).filter((f) => f && f.field && f.op).map((f) => ({
      field: String(f.field), op: String(f.op), type: (cm[f.field] || {}).type || "text",
      value: f.value == null ? "" : f.value, value2: f.value2 == null ? "" : f.value2,
    }));
    r.groupBy = (r.groupBy || []).filter((k) => cm[k]);
    r.metrics = (r.metrics && r.metrics.length ? r.metrics : [{ agg: "count", field: "" }])
      .filter((m) => m && m.agg && (m.agg === "count" || cm[m.field]))
      .map((m) => ({ agg: String(m.agg), field: String(m.field || "") }));
    r.columns = (r.columns || []).filter((k) => cm[k]);
    r.limit = Math.max(0, Math.min(5000, num(r.limit, 500)));
    if (r.id == null || !isFinite(r.id)) {
      r.id = ten().nextId(await ten().records("provider", pid));
      r.createdAt = nowIso();
    }
    r.updatedAt = nowIso();
    await ten().upsert("provider", pid, r);
    return { record: r, created: !existing };
  };

  R.removeDef = async function (pid, id) {
    if (!ERP.security.enforce("reports.build")) return { error: "forbidden" };
    const d = await R.def(pid, id);
    if (!d) return { error: "not_found" };
    await ten().remove("provider", pid, (r) => r.kind === R.DOC_KINDS.def && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* ─────────────────────────── run ─────────────────────────── */

  R.run = async function (pid, def) {
    const d = Object.assign(R.newDef(), def || {});
    const src = R.source(d.source);
    if (!src) return { error: "source_required", message: "Unknown report source." };
    const cx = await R.context(pid);
    const all = await src.load(pid, cx);
    let rows = R.applyFilters(all, d.filters);
    const cols = R.columnMap(d.source);
    if (d.sort && cols[d.sort]) {
      const c = cols[d.sort];
      const dir = d.desc ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const x = a[d.sort], y = b[d.sort];
        if (c.type === "number") return (asNum(x) - asNum(y)) * dir;
        return String(x == null ? "" : x).localeCompare(String(y == null ? "" : y)) * dir;
      });
    }
    const matched = rows.length;
    if (d.limit && rows.length > d.limit) rows = rows.slice(0, d.limit);

    const grouped = (d.groupBy || []).length > 0;
    let table, columns;
    if (grouped) {
      table = R.groupRows(rows, d.groupBy, d.metrics, cols);
      columns = d.groupBy.map((k) => Object.assign({ key: k, label: k, type: "text" }, cols[k] || {}))
        .concat((d.metrics && d.metrics.length ? d.metrics : [{ agg: "count", field: "" }]).map((m) => ({
          key: R.metricKey(m), label: R.metricLabel(m, cols),
          type: "number", align: "right", decimals: m.agg === "avg" ? 2 : 0,
          money: m.field ? !!(cols[m.field] && cols[m.field].money) && m.agg !== "countDistinct" : false,
        })));
    } else {
      const chosen = (d.columns && d.columns.length ? d.columns : src.columns.map((c) => c.key)).filter((k) => cols[k]);
      columns = chosen.map((k) => Object.assign({}, cols[k]));
      table = rows;
    }

    /* totals over the displayed table for numeric columns */
    const totals = { count: table.length, matched: matched };
    columns.forEach((c) => {
      if (c.type !== "number") return;
      const sum = round2(table.reduce((n, r) => n + num(r[c.key]), 0));
      totals[c.key] = sum;
    });

    /* a chart when a single metric can be plotted against the first group key */
    let chart = null;
    if (grouped && table.length) {
      const metricCol = columns.find((c) => c.key !== (d.groupBy[0]) && c.type === "number");
      const labelKey = d.groupBy[0];
      if (metricCol) {
        chart = { kind: d.viz && d.viz !== "table" ? d.viz : "bar", labels: table.map((r) => String(r[labelKey])), series: [{ name: metricCol.label, values: table.map((r) => num(r[metricCol.key])) }] };
      }
    }

    return {
      def: d, source: { id: src.id, label: src.label }, grouped: grouped, generatedAt: nowIso(),
      columns: columns, table: table, count: table.length, matched: matched, totals: totals, chart: chart,
    };
  };

  R.runSaved = async function (pid, id) {
    const d = await R.def(pid, id);
    if (!d) return { error: "not_found" };
    return await R.run(pid, d);
  };

  /* ─────────────────────────── CSV ─────────────────────────── */

  R.csv = function (rows, columns) {
    const e = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = (columns || []).map((c) => e(c.label != null ? c.label : c.key)).join(",");
    const body = (rows || []).map((r) => (columns || []).map((c) => e(c.csv ? c.csv(r) : r[c.key])).join(",")).join("\n");
    return head + (body ? "\n" + body : "") + "\n";
  };

  R.downloadCsv = function (name, csv) {
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name || "report.csv"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { ok: true, filename: name, csv: csv };
    } catch (err) { return { error: "export_failed", message: (err && err.message) || String(err) }; }
  };

  /* ─────────────────────────── schedules ─────────────────────────── */

  R.CADENCES = [
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
    { id: "monthly", label: "Monthly" },
  ];
  R.FORMATS = [
    { id: "csv", label: "CSV" },
    { id: "html", label: "HTML" },
    { id: "link", label: "Link only" },
  ];

  R.newSchedule = function (over) {
    return Object.assign({
      kind: R.DOC_KINDS.schedule, id: null, name: "", defId: null,
      cadence: "weekly", hour: 7, weekday: 1, dayOfMonth: 1,
      recipients: "", format: "csv", enabled: true,
      nextRunAt: null, lastRunAt: null, runCount: 0,
      createdAt: null, updatedAt: null,
    }, over || {});
  };

  R.schedules = async function (pid) {
    const list = await ten().records("provider", pid, R.DOC_KINDS.schedule);
    return list.slice().sort((a, b) => String(a.nextRunAt || "\uffff").localeCompare(String(b.nextRunAt || "\uffff")));
  };
  R.schedule = async function (pid, id) {
    return (await ten().records("provider", pid, R.DOC_KINDS.schedule)).find((s) => String(s.id) === String(id)) || null;
  };

  /* Next delivery instant for a schedule, at or after `fromMs`. */
  R.nextRunAt = function (s, fromMs) {
    const from = new Date(fromMs == null ? Date.now() : fromMs);
    const hour = Math.max(0, Math.min(23, num(s.hour, 7)));
    const at = (d) => { const x = new Date(d); x.setHours(hour, 0, 0, 0); return x; };
    let cand = at(from);
    if (cand.getTime() < from.getTime()) { cand = new Date(cand); cand.setDate(cand.getDate() + 1); cand = at(cand); }
    if (s.cadence === "weekly") {
      const want = Math.max(0, Math.min(6, num(s.weekday, 1)));
      let guard = 0;
      while (cand.getDay() !== want && guard++ < 8) { cand.setDate(cand.getDate() + 1); }
      if (cand.getTime() < from.getTime()) { cand.setDate(cand.getDate() + 7); }
      return cand.toISOString();
    }
    if (s.cadence === "monthly") {
      const want = Math.max(1, Math.min(28, num(s.dayOfMonth, 1)));
      cand = at(new Date(from.getFullYear(), from.getMonth(), want));
      if (cand.getTime() < from.getTime()) cand = at(new Date(from.getFullYear(), from.getMonth() + 1, want));
      return cand.toISOString();
    }
    return cand.toISOString();
  };

  R.saveSchedule = async function (pid, rec) {
    if (!ERP.security.enforce("reports.schedule")) return { error: "forbidden" };
    const existing = rec && rec.id != null ? await R.schedule(pid, rec.id) : null;
    const s = Object.assign(R.newSchedule(), existing || {}, rec || {});
    if (!s.defId) return { error: "def_required" };
    if (!(await R.def(pid, s.defId))) return { error: "def_not_found" };
    if (!String(s.name || "").trim()) { const d = await R.def(pid, s.defId); s.name = (d && d.name) || "Report schedule"; }
    if (["daily", "weekly", "monthly"].indexOf(s.cadence) === -1) s.cadence = "weekly";
    if (["csv", "html", "link"].indexOf(s.format) === -1) s.format = "csv";
    s.hour = Math.max(0, Math.min(23, num(s.hour, 7)));
    s.weekday = Math.max(0, Math.min(6, num(s.weekday, 1)));
    s.dayOfMonth = Math.max(1, Math.min(28, num(s.dayOfMonth, 1)));
    if (s.id == null || !isFinite(s.id)) {
      s.id = ten().nextId(await ten().records("provider", pid));
      s.createdAt = nowIso();
    }
    if (s.enabled) s.nextRunAt = R.nextRunAt(s, Date.now());
    s.updatedAt = nowIso();
    await ten().upsert("provider", pid, s);
    return { record: s, created: !existing };
  };

  R.removeSchedule = async function (pid, id) {
    if (!ERP.security.enforce("reports.schedule")) return { error: "forbidden" };
    if (!(await R.schedule(pid, id))) return { error: "not_found" };
    await ten().remove("provider", pid, (r) => r.kind === R.DOC_KINDS.schedule && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* Produce one delivery for a schedule and advance it. */
  R.deliver = async function (pid, schedule, opts) {
    opts = opts || {};
    const s = typeof schedule === "object" ? schedule : await R.schedule(pid, schedule);
    if (!s) return { error: "not_found" };
    const d = await R.def(pid, s.defId);
    if (!d) return { error: "def_not_found" };
    const asOf = opts.asOf || nowIso();
    const result = await R.run(pid, d);
    const csv = R.csv(result.table, result.columns);
    const summary = { rows: result.count, matched: result.matched, grouped: result.grouped, source: result.source.label, totals: result.totals };
    const delivery = {
      kind: R.DOC_KINDS.delivery, id: null, scheduleId: s.id, defId: d.id,
      name: s.name || d.name, recipients: s.recipients || "", format: s.format,
      generatedAt: asOf, count: result.count, summary: summary, csv: csv,
      link: null, status: "ready",
    };
    delivery.id = ten().nextId(await ten().records("provider", pid));
    await ten().upsert("provider", pid, delivery);
    const raised = { lastRunAt: asOf, runCount: num(s.runCount) + 1, updatedAt: nowIso() };
    if (s.enabled) raised.nextRunAt = R.nextRunAt(s, Date.parse(asOf) + 60000);
    const updatedSchedule = Object.assign({}, s, raised);
    await ten().upsert("provider", pid, updatedSchedule);
    if (ERP.notify && ERP.notify.emit) {
      try { await ERP.notify.emit("report.delivered", { delivery: delivery, schedule: updatedSchedule, at: asOf }); } catch (e) {}
    }
    return { delivery: delivery, schedule: updatedSchedule };
  };

  /* Deliver every schedule whose next run is due. Idempotent per due instant
     because delivering advances nextRunAt past it. */
  R.sweep = async function (pid, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("reports.schedule")) return { error: "forbidden" };
    const asOf = opts.asOf || nowIso();
    const asMs = Date.parse(asOf);
    const list = await R.schedules(pid);
    const delivered = [];
    for (const s of list) {
      if (!s.enabled) continue;
      const next = s.nextRunAt ? Date.parse(s.nextRunAt) : R.nextRunAt(s, Date.now());
      if (!isFinite(next) || next > asMs) continue;
      const out = await R.deliver(pid, s, { asOf: asOf });
      if (out.delivery) delivered.push(out.delivery);
    }
    return { asOf: asOf, checked: list.length, delivered: delivered, count: delivered.length };
  };

  R.deliveries = async function (pid, opts) {
    opts = opts || {};
    let list = await ten().records("provider", pid, R.DOC_KINDS.delivery);
    if (opts.scheduleId != null) list = list.filter((d) => String(d.scheduleId) === String(opts.scheduleId));
    list = list.slice().sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
    return opts.limit ? list.slice(0, opts.limit) : list;
  };
  R.delivery = async function (pid, id) {
    return (await ten().records("provider", pid, R.DOC_KINDS.delivery)).find((d) => String(d.id) === String(id)) || null;
  };
  R.removeDelivery = async function (pid, id) {
    if (!ERP.security.enforce("reports.build")) return { error: "forbidden" };
    await ten().remove("provider", pid, (r) => r.kind === R.DOC_KINDS.delivery && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* Publish a delivery's payload to a durable URL (Phase 12 connectors or a
     human pick it up here). */
  R.publishDelivery = async function (pid, id) {
    const d = await R.delivery(pid, id);
    if (!d) return { error: "not_found" };
    const up = window.root && root.uploadPlugin;
    if (!up) return { error: "upload_unavailable", message: "The upload plugin is not loaded." };
    try {
      const res = await up(d.csv, { expires: Date.now() + 1000 * 60 * 60 * 24 * 30 });
      if (res && res.url) {
        const updated = Object.assign({}, d, { link: res.url, updatedAt: nowIso() });
        await ten().upsert("provider", pid, updated);
        return { record: updated, url: res.url };
      }
      return { error: (res && res.error) || "upload_failed" };
    } catch (e) { return { error: "upload_failed", message: (e && e.message) || String(e) }; }
  };

  /* ─────────────────────────── shared chart helper ─────────────────────────── */

  R.chart = function (kind, data, opts) {
    try {
      const r = window.root;
      const c = r && r.charts;
      if (!c || typeof c[kind] !== "function") return null;
      const svg = c[kind](data, opts || {});
      if (typeof svg !== "string" || svg.charAt(0) !== "<") return null;
      return svg;
    } catch (e) { return null; }
  };
  R.chartBox = function (kind, data, opts, title) {
    const r = window.root;
    if (!r || !r.charts || typeof r.charts[kind] !== "function") return '<p class="erp-muted-note">Charts need the data-visualization-plugin (imported in main.pjs).</p>';
    const svg = R.chart(kind, data, opts);
    if (!svg) return '<p class="erp-muted-note">Not enough data to chart yet.</p>';
    return '<div class="erp-chart-box">' + (title ? '<h4>' + ui.esc(title) + "</h4>" : "") + svg + "</div>";
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  R.ensure = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    if ((await R.defs(pid)).length) return { skipped: "already_seeded" };
    if (!ERP.security.can("reports.build")) return { skipped: "forbidden" };
    const starters = [
      R.newDef({ name: "Open tickets by board & priority", source: "tickets", filters: [{ field: "open", op: "truthy", type: "bool", value: "" }], groupBy: ["boardLabel", "priorityLabel"], metrics: [{ agg: "count", field: "" }], viz: "bar" }),
      R.newDef({ name: "Billable hours by member (this month)", source: "time", filters: [{ field: "month", op: "eq", type: "text", value: ui.today().slice(0, 7) }], groupBy: ["memberName"], metrics: [{ agg: "sum", field: "hours" }, { agg: "sum", field: "amount" }], sort: "sum_hours", desc: true }),
      R.newDef({ name: "Invoices by status", source: "invoices", groupBy: ["statusLabel"], metrics: [{ agg: "count", field: "" }, { agg: "sum", field: "total" }], viz: "donut" }),
      R.newDef({ name: "Agreement value by client", source: "agreements", filters: [{ field: "statusLabel", op: "eq", type: "text", value: "active" }], groupBy: ["companyName", "statusLabel"], metrics: [{ agg: "count", field: "" }] }),
    ];
    for (const s of starters) {
      const r = await R.saveDef(pid, s);
      if (r.error) return r;
    }
    return { seeded: starters.length };
  };

  /* ─────────────────────────── station UI ─────────────────────────── */

  function blankState() { return { tab: "overview" }; }
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
    ERP.states.loading(panel, "Loading");
    try {
      const pid = await ten().providerId();
      if (id === "overview") await ERP.dashboards.render(panel, pid, () => renderTab("overview"));
      else if (id === "builder") await R.renderBuilder(panel, pid, () => renderTab("builder"));
      else if (id === "schedules") await R.renderSchedules(panel, pid, () => renderTab("schedules"));
      else if (id === "export") await ERP.bi.renderExport(panel, pid, () => renderTab("export"));
    } catch (e) {
      console.error("reports tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }

  R.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "reports", title: "Reporting & analytics", phase: "Phase 11 · Reporting & analytics",
        message: "Create a service provider first — dashboards, reports and the BI extract read from its records.",
      });
      return;
    }
    await R.ensure(pid);
    host.__reports = host.__reports || blankState();
    const deep = host.__tab;
    if (deep && ["overview", "builder", "schedules", "export"].indexOf(deep) !== -1) host.__reports.tab = deep;
    currentHost = host;
    const defs = await R.defs(pid);
    const schedules = await R.schedules(pid);
    const defsTab = [
      { id: "overview", label: "Dashboards" },
      { id: "builder", label: "Report builder", badge: defs.length ? String(defs.length) : "" },
      { id: "schedules", label: "Scheduled delivery", badge: schedules.filter((s) => s.enabled).length ? String(schedules.filter((s) => s.enabled).length) : "" },
      { id: "export", label: "BI export" },
    ];
    const active = defsTab.find((d) => d.id === host.__reports.tab) ? host.__reports.tab : "overview";
    host.innerHTML = ui.pageHead("Reporting & analytics", "Dashboards, the report builder, scheduled delivery and the BI extract.", "") + ui.tabs(defsTab, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__reports.tab = b.getAttribute("data-tab");
      await renderTab(host.__reports.tab);
    }));
    await renderTab(active);
  };

  /* ── builder tab ── */

  let currentBuilderPanel = null;

  function fieldOptions(src) {
    return src.columns.map((c) => ({ value: c.key, label: c.label + " (" + c.type + ")" }));
  }
  function filterOptions(src) {
    return src.columns.map((c) => ({ value: c.key, label: c.label }));
  }

  function filterRowHtml(src, f, i) {
    const cm = R.columnMap(src.id);
    const c = cm[f.field] || src.columns[0];
    const ops = R.opsFor(c.type).map((o) => ({ value: o, label: R.OP_LABELS[o] }));
    const needVal = R.opNeedsValue(f.op);
    return '<div class="erp-filter-row" data-filter="' + i + '">' +
      ui.select("f_field_" + i, "Field", filterOptions(src), f.field) +
      ui.select("f_op_" + i, "Operator", ops, f.op) +
      (needVal ? ui.text("f_value_" + i, "Value", f.value, "") : '<div class="field"><label>Value</label><div class="erp-muted-note">—</div></div>') +
      (f.op === "between" && needVal ? ui.text("f_value2_" + i, "…and", f.value2, "") : "") +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="rpt-del-filter" data-arg="' + i + '">Remove</button>' +
      "</div>";
  }

  function metricRowHtml(src, m, i) {
    const nums = src.columns.filter((c) => c.type === "number");
    const aggs = R.AGGS.map((a) => ({ value: a.id, label: a.label }));
    const fields = [{ value: "", label: "(rows)" }].concat(nums.map((c) => ({ value: c.key, label: c.label })));
    const needsField = m.agg !== "count";
    return '<div class="erp-filter-row" data-metric="' + i + '">' +
      ui.select("m_agg_" + i, "Aggregate", aggs, m.agg) +
      (needsField ? ui.select("m_field_" + i, "of field", fields, m.field) : '<div class="field"><label>of field</label><div class="erp-muted-note">—</div></div>') +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="rpt-del-metric" data-arg="' + i + '">Remove</button>' +
      "</div>";
  }

  function builderResultHtml(result, pid) {
    if (!result || result.error) return "";
    const rows = result.table;
    const cols = result.columns.map((c) => Object.assign({}, c, {
      align: c.type === "number" ? "right" : "",
      render: (r) => cellHtml(c, r),
    }));
    let body;
    if (result.grouped) {
      body = ui.table(cols, rows, { emptyText: "No rows matched these filters." });
    } else {
      const shown = cols.slice(0, 8);
      body = ui.table(shown, rows, { emptyText: "No rows matched these filters." });
    }
    const chart = result.chart ? R.chartBox(result.chart.kind, result.chart, { title: null, theme: null }, null) : "";
    return ui.card("Preview", '<p class="erp-muted-note">' + ui.esc(result.source.label + " · " + rows.length + " row(s)" + (result.grouped ? " (grouped)" : "") + (result.matched !== rows.length ? " of " + result.matched + " matched" : "")) + "</p>" + body + chart, {
      actions: ui.btn("Export CSV", { small: true, act: "rpt-export", icon: null }),
    });
  }

  function cellHtml(col, row) {
    const v = row[col.key];
    if (v === "" || v == null) return '<span class="erp-muted-note">—</span>';
    if (col.type === "number") return col.money ? ERP.security.money(v, row.currency) : ui.fmt(v, col.decimals == null ? 2 : col.decimals);
    if (col.type === "date") return ui.date(v);
    if (col.type === "bool") return v ? ui.badge("Yes", "success") : ui.badge("No", "muted");
    return ui.esc(v);
  }

  function readBuilderForm(host, src) {
    const def = host.__reports.def;
    def.name = host.querySelector('[name="rpt_name"]').value;
    def.source = host.querySelector('[name="rpt_source"]').value;
    def.groupBy = Array.from(host.querySelectorAll('[name="rpt_group"]:checked')).map((i) => i.value);
    def.sort = host.querySelector('[name="rpt_sort"]').value;
    def.desc = host.querySelector('[name="rpt_desc"]').checked;
    def.limit = Number(host.querySelector('[name="rpt_limit"]').value) || 0;
    def.viz = host.querySelector('[name="rpt_viz"]').value;
    def.columns = Array.from(host.querySelectorAll('[name="rpt_col"]:checked')).map((i) => i.value);
    def.filters = [];
    host.querySelectorAll("[data-filter]").forEach((row) => {
      const i = row.getAttribute("data-filter");
      def.filters.push({
        field: row.querySelector('[name="f_field_' + i + '"]').value,
        op: row.querySelector('[name="f_op_' + i + '"]').value,
        value: row.querySelector('[name="f_value_' + i + '"]') ? row.querySelector('[name="f_value_' + i + '"]').value : "",
        value2: row.querySelector('[name="f_value2_' + i + '"]') ? row.querySelector('[name="f_value2_' + i + '"]').value : "",
      });
    });
    def.metrics = [];
    host.querySelectorAll("[data-metric]").forEach((row) => {
      const i = row.getAttribute("data-metric");
      def.metrics.push({
        agg: row.querySelector('[name="m_agg_' + i + '"]').value,
        field: row.querySelector('[name="m_field_' + i + '"]') ? row.querySelector('[name="m_field_' + i + '"]').value : "",
      });
    });
    return def;
  }

  R.renderBuilder = async function (panel, pid, refresh) {
    const host = panel.__host || panel;
    currentBuilderPanel = panel;
    const state = host.__reports || (host.__reports = blankState());
    const defs = await R.defs(pid);
    if (!state.def) state.def = defs.length ? Object.assign(R.newDef(), JSON.parse(JSON.stringify(defs[0]))) : R.newDef();
    const def = state.def;
    const src = R.source(def.source) || R.SOURCES[0];

    const savedCards = defs.length
      ? '<div class="erp-report-grid">' + defs.map((d) => {
          const s = R.source(d.source);
          const grouped = (d.groupBy || []).length;
          return '<div class="erp-report-card">' +
            '<div class="erp-report-card-head"><h4>' + ui.esc(d.name) + "</h4>" + ui.badge(s ? s.label : d.source, "info") + "</div>" +
            '<p class="erp-muted-note">' + ui.esc(d.filters && d.filters.length ? d.filters.length + " filter(s)" : "No filters") + (grouped ? " · grouped by " + ui.esc(d.groupBy.join(", ")) : "") + "</p>" +
            '<div class="erp-btn-row">' +
              ui.btn("Open", { small: true, act: "rpt-open", arg: d.id, icon: null }) +
              ui.btn("Run", { small: true, act: "rpt-run-saved", arg: d.id, primary: true, icon: null }) +
              ui.btn("Delete", { small: true, danger: true, act: "rpt-del-def", arg: d.id, icon: null }) +
            "</div></div>";
        }).join("") + "</div>"
      : '<p class="erp-muted-note">No saved reports yet. Build one below and save it.</p>';

    const filterRows = (def.filters.length ? def.filters : []).map((f, i) => filterRowHtml(src, f, i)).join("");
    const metricRows = (def.metrics.length ? def.metrics : [{ agg: "count", field: "" }]).map((m, i) => metricRowHtml(src, m, i)).join("");

    const groupChoices = src.columns.map((c) => ui.check("rpt_group", c.label, (def.groupBy || []).indexOf(c.key) !== -1).replace('name="rpt_group"', 'name="rpt_group" value="' + ui.esc(c.key) + '"'));
    const colChoices = src.columns.map((c) => ui.check("rpt_col", c.label, (def.columns || []).indexOf(c.key) !== -1).replace('name="rpt_col"', 'name="rpt_col" value="' + ui.esc(c.key) + '"'));

    const form =
      ui.text("rpt_name", "Report name", def.name) +
      ui.select("rpt_source", "Source", R.SOURCES.map((s) => ({ value: s.id, label: s.label })), def.source) +
      '<div class="erp-builder-grid">' +
        '<div class="erp-card"><header class="erp-card-head"><h3>Filters</h3><div class="erp-card-actions">' + ui.btn("Add filter", { small: true, act: "rpt-add-filter", icon: null }) + '</div></header><div class="erp-card-body">' + (filterRows || '<p class="erp-muted-note">No filters — the report covers every record.</p>') + "</div></div>" +
        '<div class="erp-card"><header class="erp-card-head"><h3>Group &amp; aggregate</h3><div class="erp-card-actions">' + ui.btn("Add metric", { small: true, act: "rpt-add-metric", icon: null }) + '</div></header><div class="erp-card-body">' +
          '<div class="field"><label>Group by</label><div class="erp-check-grid">' + groupChoices.join("") + '</div></div>' +
          '<div class="field"><label>Metrics</label>' + metricRows + "</div></div></div>" +
      "</div>" +
      '<div class="erp-builder-grid">' +
        '<div class="erp-card"><header class="erp-card-head"><h3>Columns (flat reports)</h3></header><div class="erp-card-body"><div class="erp-check-grid">' + colChoices.join("") + '</div></div></div>' +
        '<div class="erp-card"><header class="erp-card-head"><h3>Presentation</h3></header><div class="erp-card-body">' +
          ui.select("rpt_sort", "Sort by", [{ value: "", label: "(none)" }].concat(src.columns.map((c) => ({ value: c.key, label: c.label }))), def.sort) +
          ui.check("rpt_desc", "Descending", def.desc) +
          ui.number("rpt_limit", "Row limit", def.limit, { min: 0, step: 50 }) +
          ui.select("rpt_viz", "Chart", [{ value: "table", label: "Table only" }, { value: "bar", label: "Bar" }, { value: "line", label: "Line" }, { value: "pie", label: "Pie" }, { value: "donut", label: "Donut" }], def.viz) +
        "</div></div>" +
      "</div>";

    panel.innerHTML =
      ui.card("Saved reports", savedCards) +
      ui.card(def.id ? "Edit report" : "New report", ui.form(form,
        ui.btn("Run preview", { act: "rpt-preview", primary: true, icon: null }) + " " +
        ui.btn("Save report", { act: "rpt-save", icon: null }) + " " +
        ui.btn("New", { act: "rpt-new", icon: null }) + " " +
        (def.id ? ui.btn("Duplicate", { act: "rpt-dup", icon: null }) : "")
      )) +
      '<div id="rptResult">' + builderResultHtml(state.result, pid) + "</div>";

    bindBuilder(panel, host, pid);
  };

  function bindBuilder(panelEl, host, pid) {
    const src = () => R.source((host.__reports.def.source) || "tickets") || R.SOURCES[0];
    panelEl.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act"), arg = t.getAttribute("data-arg");
      const S = host.__reports;
      if (act === "rpt-add-filter") { readBuilderForm(host, src()); S.def.filters.push({ field: src().columns[0].key, op: "eq", value: "" }); await rerender(host, pid); }
      else if (act === "rpt-del-filter") { readBuilderForm(host, src()); S.def.filters.splice(Number(arg), 1); await rerender(host, pid); }
      else if (act === "rpt-add-metric") { readBuilderForm(host, src()); S.def.metrics.push({ agg: "count", field: "" }); await rerender(host, pid); }
      else if (act === "rpt-del-metric") { readBuilderForm(host, src()); S.def.metrics.splice(Number(arg), 1); if (!S.def.metrics.length) S.def.metrics.push({ agg: "count", field: "" }); await rerender(host, pid); }
      else if (act === "rpt-preview") { readBuilderForm(host, src()); const res = await R.run(pid, S.def); S.result = res; const box = panelEl.querySelector("#rptResult"); if (box) box.innerHTML = builderResultHtml(res, pid); }
      else if (act === "rpt-export") {
        const res = S.result || await R.run(pid, S.def);
        R.downloadCsv((S.def.name || "report").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".csv", R.csv(res.table, res.columns));
        ERP.toast("Report exported.", "success");
      }
      else if (act === "rpt-save") {
        readBuilderForm(host, src());
        const upd = S.def;
        const id = upd.id; delete upd.id;
        const out = await R.saveDef(pid, Object.assign({}, upd, id ? { id: id } : {}));
        if (out.error) { ERP.toast("Could not save: " + out.error, "error"); return; }
        S.def = JSON.parse(JSON.stringify(out.record));
        S.result = await R.run(pid, S.def);
        ERP.toast(out.created ? "Report saved." : "Report updated.", "success");
        await rerender(host, pid);
      }
      else if (act === "rpt-new") { S.def = R.newDef(); S.result = null; await rerender(host, pid); }
      else if (act === "rpt-dup") { const c = JSON.parse(JSON.stringify(S.def)); c.id = null; c.name = c.name + " (copy)"; S.def = c; S.result = null; await rerender(host, pid); }
      else if (act === "rpt-open") { const d = await R.def(pid, arg); if (d) { S.def = Object.assign(R.newDef(), JSON.parse(JSON.stringify(d))); S.result = null; await rerender(host, pid); } }
      else if (act === "rpt-run-saved") { const d = await R.def(pid, arg); if (d) { S.def = Object.assign(R.newDef(), JSON.parse(JSON.stringify(d))); S.result = await R.run(pid, S.def); await rerender(host, pid); } }
      else if (act === "rpt-del-def") {
        const ok = await ui.confirm({ title: "Delete report", message: "Delete this saved report? Scheduled deliveries that use it will stop.", danger: true, okLabel: "Delete" });
        if (!ok) return;
        await R.removeDef(pid, arg);
        const list = await R.defs(pid);
        S.def = list.length ? Object.assign(R.newDef(), JSON.parse(JSON.stringify(list[0]))) : R.newDef();
        S.result = null;
        await rerender(host, pid);
      }
    });
    panelEl.addEventListener("change", async (e) => {
      const sel = e.target.closest('[name="rpt_source"]');
      if (sel) {
        readBuilderFormSafe(host, src());
        host.__reports.def.source = sel.value;
        host.__reports.def.filters = [];
        host.__reports.def.groupBy = [];
        host.__reports.def.metrics = [{ agg: "count", field: "" }];
        host.__reports.def.columns = [];
        host.__reports.def.sort = "";
        host.__reports.def.viz = "table";
        host.__reports.result = null;
        await rerender(host, pid);
      }
      const f = e.target.closest('[name^="f_field_"], [name^="f_op_"]');
      if (f) {
        const S = host.__reports;
        S.def = readBuilderFormSafe(host, src());
      }
    });
  }

  function readBuilderFormSafe(host, src) {
    try { return readBuilderForm(host, src); } catch (e) { return host.__reports.def; }
  }

  async function rerender(host, pid) {
    /* re-render the builder panel in place (same DOM node, fresh content) */
    const panel = currentBuilderPanel && currentBuilderPanel.isConnected ? currentBuilderPanel : host.querySelector('[data-panel="builder"]');
    if (!panel) { await R.renderBuilder(host, pid, () => {}); return; }
    panel.__host = host;
    await R.renderBuilder(panel, pid, () => {});
  }

  /* ── schedules tab ── */

  R.renderSchedules = async function (panel, pid, refresh) {
    const host = panel.__host || panel;
    const [defs, schedules, deliveries] = await Promise.all([R.defs(pid), R.schedules(pid), R.deliveries(pid, { limit: 25 })]);
    const defOptions = defs.map((d) => ({ value: d.id, label: d.name }));
    const cadences = R.CADENCES;
    const formats = R.FORMATS;

    const rows = schedules.map((s) => ({
      name: s.name, def: (defs.find((d) => String(d.id) === String(s.defId)) || {}).name || "(missing report)",
      cadence: s.cadence + (s.cadence === "weekly" ? " · " + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][num(s.weekday)] : s.cadence === "monthly" ? " · day " + num(s.dayOfMonth) : "") + " · " + String(num(s.hour)).padStart(2, "0") + ":00",
      next: s.nextRunAt, last: s.lastRunAt, runs: num(s.runCount),
      enabled: s.enabled !== false,
      id: s.id,
    }));

    const schedTable = ui.table([
      { key: "name", label: "Schedule", render: (r) => ui.esc(r.name) },
      { key: "def", label: "Report" },
      { key: "cadence", label: "Cadence" },
      { key: "next", label: "Next run", render: (r) => ui.dateTime(r.next) },
      { key: "last", label: "Last run", render: (r) => ui.dateTime(r.last) },
      { key: "runs", label: "Runs", align: "right" },
      { key: "enabled", label: "Enabled", render: (r) => (r.enabled ? ui.badge("on", "success") : ui.badge("off", "muted")) },
      { key: "actions", label: "", render: (r) => '<div class="erp-btn-row">' + ui.btn("Run now", { small: true, act: "sch-run", arg: r.id, icon: null }) + ui.btn("Delete", { small: true, danger: true, act: "sch-del", arg: r.id, icon: null }) + "</div>" },
    ], rows, { emptyText: "No schedules yet." });

    const delTable = ui.table([
      { key: "name", label: "Delivery" },
      { key: "generatedAt", label: "Generated", render: (r) => ui.dateTime(r.generatedAt) },
      { key: "count", label: "Rows", align: "right" },
      { key: "recipients", label: "Recipients", render: (r) => ui.esc(r.recipients || "—") },
      { key: "link", label: "Link", render: (r) => (r.link ? '<a href="' + ui.esc(r.link) + '" target="_blank" rel="noopener">open</a>' : ui.badge("not published", "muted")) },
      { key: "actions", label: "", render: (r) => '<div class="erp-btn-row">' + ui.btn("CSV", { small: true, act: "del-csv", arg: r.id, icon: null }) + ui.btn("Publish", { small: true, act: "del-pub", arg: r.id, icon: null }) + "</div>" },
    ], deliveries, { emptyText: "No deliveries yet — run a schedule or sweep the queue." });

    const form =
      ui.select("sch_def", "Report", defOptions, defs[0] ? defs[0].id : "") +
      ui.text("sch_name", "Schedule name", "") +
      ui.select("sch_cadence", "Cadence", cadences, "weekly") +
      ui.number("sch_hour", "Hour (0–23)", 7, { min: 0, max: 23, step: 1 }) +
      ui.number("sch_weekday", "Weekday (0=Sun)", 1, { min: 0, max: 6, step: 1 }) +
      ui.number("sch_day", "Day of month", 1, { min: 1, max: 28, step: 1 }) +
      ui.text("sch_to", "Recipients", "", "comma-separated emails") +
      ui.select("sch_format", "Format", formats, "csv");

    panel.innerHTML =
      ui.pageHead("Scheduled delivery", "Recurring reports, delivered as a durable artifact.", "") +
      ui.grid([
        ui.card("New schedule", defs.length ? ui.form(form, ui.btn("Add schedule", { act: "sch-add", primary: true, icon: null })) : '<p class="erp-muted-note">Save a report first.</p>'),
        ui.card("Delivery queue", '<div class="erp-btn-row">' + ui.btn("Sweep due schedules", { act: "sch-sweep", primary: true, icon: null }) + '</div><p class="erp-muted-note">Sweeping delivers every schedule whose next run has passed and advances it.</p>'),
      ], "cols-2") +
      ui.card("Schedules", schedTable) +
      ui.card("Recent deliveries", delTable);

    const panelEl = panel;
    panelEl.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act"), arg = t.getAttribute("data-arg");
      if (act === "sch-add") {
        const f = panelEl.querySelector("[data-ui-form]");
        const v = ui.collect(f, ["sch_def", "sch_name", "sch_cadence", "sch_hour", "sch_weekday", "sch_day", "sch_to", "sch_format"]);
        const out = await R.saveSchedule(pid, R.newSchedule({
          defId: v.sch_def, name: v.sch_name, cadence: v.sch_cadence, hour: v.sch_hour,
          weekday: v.sch_weekday, dayOfMonth: v.sch_day, recipients: v.sch_to, format: v.sch_format, enabled: true,
        }));
        if (out.error) { ERP.toast("Could not schedule: " + out.error, "error"); return; }
        ERP.toast("Schedule added.", "success"); refresh();
      } else if (act === "sch-run") {
        const out = await R.deliver(pid, arg, {});
        if (out.error) { ERP.toast("Could not deliver: " + out.error, "error"); return; }
        ERP.toast("Delivered " + out.delivery.count + " row(s).", "success"); refresh();
      } else if (act === "sch-del") {
        const ok = await ui.confirm({ title: "Delete schedule", message: "Delete this schedule? Deliveries already produced are kept.", danger: true, okLabel: "Delete" });
        if (!ok) return;
        await R.removeSchedule(pid, arg); refresh();
      } else if (act === "sch-sweep") {
        const out = await R.sweep(pid, {});
        if (out.error) { ERP.toast("Sweep failed: " + out.error, "error"); return; }
        ERP.toast(out.count ? "Delivered " + out.count + " report(s)." : "No schedules were due.", out.count ? "success" : "info");
        refresh();
      } else if (act === "del-csv") {
        const d = await R.delivery(pid, arg);
        if (d) R.downloadCsv((d.name || "delivery").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".csv", d.csv);
      } else if (act === "del-pub") {
        const out = await R.publishDelivery(pid, arg);
        if (out.error) { ERP.toast("Publish failed: " + (out.message || out.error), "error"); return; }
        ERP.toast("Published.", "success"); refresh();
      }
    });
  };
})();
