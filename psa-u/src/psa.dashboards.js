/* ============================================================================
   PSA-U — operational dashboards (Phase 11 · Task 52)

   The KPIs a managed-services practice is bought for, every one derived live
   from the records the other modules own (no stored copies, no stale rollups):

     • SLA compliance   — response/resolution targets met vs applicable, open
                          breaches and at-risk work, split by board and priority.
     • Ticket backlog   — open tickets aged into current / 1-30 / 31-60 / 61-90
                          / 90+ buckets, by board and by priority.
     • Utilisation      — each technician's captured hours against their
                          business-hours capacity for the period, with billable
                          hours and billable value.
     • Response time    — average first-response and resolution time overall and
                          by priority/board.
     • Agreement margin — revenue vs cost of servicing, from the agreement cost
                          engine.
     • Billing backlog  — unbilled WIP (time + expenses + posted agreement
                          charges not yet invoiced) and the AR position.
     • Revenue trend    — invoiced vs received, by month.

   Every figure is computed by a named method (D.sla, D.backlog, ...) so it can
   be tested and driven programmatically; D.drill(kind, key) returns the records
   behind a figure for drill-down. D.render() draws the Dashboards tab of the
   Reports station.
   ============================================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const D = (ERP.dashboards = {});

  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function pct(n, d) { const x = num(n); const y = num(d); return y > 0 ? Math.round((x / y) * 1000) / 10 : null; }
  function dayMs(dateStr) { return Date.parse(dateStr + "T00:00:00"); }
  function monthStart(today) { return String(today || ui.today()).slice(0, 8) + "01"; }
  function monthKey(dateStr) { return String(dateStr || "").slice(0, 7); }
  function monthsBetween(from, to) {
    const out = [];
    let d = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    while (d <= end && out.length < 120) {
      out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return out;
  }
  function shiftMonth(key, n) {
    const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1 + n;
    const d = new Date(y, m, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  async function ticketsWithCtx(pid, opts) {
    opts = opts || {};
    const all = await ERP.tickets.listAll(opts.companyId ? { companyId: opts.companyId } : {});
    const closed = new Set((await ERP.tickets.closedCodes(pid).catch(() => [])).map(String));
    const boards = await ERP.tickets.boards(pid).catch(() => []);
    const boardLabel = {};
    boards.forEach((b) => { boardLabel[String(b.code)] = b.label || b.code; });
    const today = opts.asOf || ui.today();
    return { all, closed, boardLabel, today };
  }

  /* ─────────────────────────── SLA compliance ─────────────────────────── */

  D.sla = async function (pid, opts) {
    opts = opts || {};
    const { all, closed, boardLabel, today } = await ticketsWithCtx(pid, opts);
    const now = opts.nowMs || Date.now();
    const t = { applicable: 0, responded: 0, responseMet: 0, resolved: 0, resolutionMet: 0, open: 0, atRisk: 0, breached: 0, met: 0, total: all.length };
    const byBoard = {}, byPriority = {};
    const respTimes = [], resoTimes = [];
    const breaches = [], atRiskList = [];
    const bucket = (map, key, label) => (map[key] = map[key] || { key: key, label: label || key || "—", count: 0, applicable: 0, responded: 0, responseMet: 0, resolved: 0, resolutionMet: 0, open: 0, atRisk: 0, breached: 0, met: 0, respSum: 0, respN: 0, resoSum: 0, resoN: 0 });

    all.forEach((tk) => {
      const sla = tk.sla;
      const isOpen = !closed.has(String(tk.status));
      const b = bucket(byBoard, tk.board, boardLabel[String(tk.board)] || tk.board);
      const p = bucket(byPriority, tk.priority, tk.priority);
      [b, p].forEach((x) => { x.count += 1; });
      t.total = t.total;
      if (!sla || (sla.responseDueMs == null && sla.resolutionDueMs == null)) return;
      t.applicable += 1; b.applicable += 1; p.applicable += 1;
      const cMs = Date.parse(tk.createdAt) || null;
      if (sla.responseMet != null) {
        t.responded += 1; b.responded += 1; p.responded += 1;
        const inSla = sla.responseDueMs == null || sla.responseMet <= sla.responseDueMs;
        if (inSla) { t.responseMet += 1; b.responseMet += 1; p.responseMet += 1; }
        if (cMs) { respTimes.push(sla.responseMet - cMs); b.respSum += sla.responseMet - cMs; b.respN += 1; p.respSum += sla.responseMet - cMs; p.respN += 1; }
      }
      if (sla.resolutionMet != null) {
        t.resolved += 1; b.resolved += 1; p.resolved += 1;
        const inSla = sla.resolutionDueMs == null || sla.resolutionMet <= sla.resolutionDueMs;
        if (inSla) { t.resolutionMet += 1; b.resolutionMet += 1; p.resolutionMet += 1; }
        if (cMs) { resoTimes.push(sla.resolutionMet - cMs); b.resoSum += sla.resolutionMet - cMs; b.resoN += 1; p.resoSum += sla.resolutionMet - cMs; p.resoN += 1; }
      }
      if (isOpen) {
        t.open += 1; b.open += 1; p.open += 1;
        const st = ERP.sla.state(tk, now);
        if (st && st.applies && st.breached) { t.breached += 1; b.breached += 1; p.breached += 1; breaches.push(tk); }
        else if (st && st.applies && st.atRisk) { t.atRisk += 1; b.atRisk += 1; p.atRisk += 1; atRiskList.push(tk); }
      }
      const metHere = (sla.responseMet != null && (sla.responseDueMs == null || sla.responseMet <= sla.responseDueMs)) ||
        (sla.resolutionMet != null && (sla.resolutionDueMs == null || sla.resolutionMet <= sla.resolutionDueMs));
      if (metHere) { t.met += 1; b.met += 1; p.met += 1; }
    });

    const finish = (x) => {
      const targets = x.responded + x.resolved;
      x.compliancePct = targets ? Math.round((x.responseMet + x.resolutionMet) / targets * 1000) / 10 : null;
      x.avgResponseMs = x.respN ? Math.round(x.respSum / x.respN) : null;
      x.avgResolutionMs = x.resoN ? Math.round(x.resoSum / x.resoN) : null;
      delete x.respSum; delete x.respN; delete x.resoSum; delete x.resoN;
      return x;
    };
    t.compliancePct = (t.responded + t.resolved) ? Math.round((t.responseMet + t.resolutionMet) / (t.responded + t.resolved) * 1000) / 10 : null;
    t.avgResponseMs = respTimes.length ? Math.round(respTimes.reduce((a, b) => a + b, 0) / respTimes.length) : null;
    t.avgResolutionMs = resoTimes.length ? Math.round(resoTimes.reduce((a, b) => a + b, 0) / resoTimes.length) : null;
    return {
      asOf: today, totals: t,
      byBoard: Object.keys(byBoard).map((k) => finish(byBoard[k])).sort((a, b) => b.count - a.count),
      byPriority: Object.keys(byPriority).map((k) => finish(byPriority[k])).sort((a, b) => String(a.key).localeCompare(String(b.key))),
      breaches: breaches, atRisk: atRiskList,
    };
  };

  /* ─────────────────────────── ticket backlog & aging ─────────────────────────── */

  D.backlog = async function (pid, opts) {
    opts = opts || {};
    const { all, closed, boardLabel, today } = await ticketsWithCtx(pid, opts);
    const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];
    const open = all.filter((tk) => !closed.has(String(tk.status)));
    const blank = () => ({ current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0, count: 0 });
    const add = (x, days) => {
      const b = ui.ageBucket(days);
      x[b] += 1; x.total += 1; x.count += 1;
    };
    const byBoard = {}, byPriority = {}, byOwner = {};
    let unassigned = 0;
    const aged = open.map((tk) => {
      const days = tk.createdAt ? Math.max(0, ui.diffDays(String(tk.createdAt).slice(0, 10), today)) : 0;
      return { ticket: tk, days: days, bucket: ui.ageBucket(days) };
    });
    aged.forEach((a) => {
      const tk = a.ticket;
      const bk = String(tk.board || "");
      const pk = String(tk.priority || "");
      const ok = String(tk.ownerId == null || tk.ownerId === "" ? "__unassigned" : tk.ownerId);
      byBoard[bk] = byBoard[bk] || Object.assign({ board: bk, label: boardLabel[bk] || bk || "—" }, blank());
      byPriority[pk] = byPriority[pk] || Object.assign({ priority: pk, label: pk || "—" }, blank());
      byOwner[ok] = byOwner[ok] || Object.assign({ ownerId: tk.ownerId, label: tk.__ownerName || "Unassigned" }, blank());
      add(byBoard[bk], a.days); add(byPriority[pk], a.days); add(byOwner[ok], a.days);
      if (ok === "__unassigned") unassigned += 1;
    });
    const totals = Object.assign(blank(), { unassigned: unassigned, open: open.length });
    aged.forEach((a) => add(totals, a.days));
    delete totals.count; totals.count = open.length;
    return {
      asOf: today, buckets: BUCKETS,
      byBoard: Object.keys(byBoard).map((k) => byBoard[k]).sort((a, b) => b.count - a.count),
      byPriority: Object.keys(byPriority).map((k) => byPriority[k]).sort((a, b) => String(a.priority).localeCompare(String(b.priority))),
      byOwner: Object.keys(byOwner).map((k) => byOwner[k]).sort((a, b) => b.count - a.count),
      oldest: aged.slice().sort((a, b) => b.days - a.days).slice(0, 10),
      unassigned: unassigned, totals: totals, open: open.length,
    };
  };

  /* ─────────────────────────── utilisation ─────────────────────────── */

  D.utilization = async function (pid, opts) {
    opts = opts || {};
    const from = opts.from || monthStart(ui.today());
    const to = opts.to || ui.today();
    const entries = (await ERP.time.entries(pid, {})).filter((e) => String(e.date) >= from && String(e.date) <= to);
    const members = (await ERP.members.members()).filter((m) => m.active !== false);
    const fromMs = dayMs(from), toMs = dayMs(to) + 86399999;
    const byMember = {};
    entries.forEach((e) => {
      const k = String(e.memberId);
      const row = byMember[k] = byMember[k] || { memberId: e.memberId, minutes: 0, billableMinutes: 0, billableValue: 0, entries: 0 };
      const mins = num(e.minutes);
      const billable = !!e.billable && !e.writtenOff;
      const rate = e.rate && isFinite(Number(e.rate.amount)) ? Number(e.rate.amount) : 0;
      row.minutes += mins; row.entries += 1;
      if (billable) { row.billableMinutes += mins; row.billableValue = round2(row.billableValue + (mins / 60) * rate); }
    });
    const rows = [];
    for (const m of members) {
      const e = byMember[String(m.id)] || { minutes: 0, billableMinutes: 0, billableValue: 0, entries: 0 };
      let capacityMinutes = null;
      if (m.calendarId != null && ERP.sla && ERP.sla.calendar) {
        const cal = await ERP.sla.calendar(m.calendarId).catch(() => null);
        if (cal) capacityMinutes = ERP.sla.businessMinutesBetween(cal, fromMs, toMs);
      }
      rows.push({
        memberId: m.id, name: m.name, role: m.functionalRole || "",
        minutes: e.minutes, hours: round2(e.minutes / 60), entries: e.entries,
        billableMinutes: e.billableMinutes, billableHours: round2(e.billableMinutes / 60),
        billableValue: round2(e.billableValue), capacityMinutes: capacityMinutes,
        capacityHours: capacityMinutes == null ? null : round2(capacityMinutes / 60),
        utilPct: capacityMinutes ? Math.round(e.minutes / capacityMinutes * 1000) / 10 : null,
        billableUtilPct: capacityMinutes ? Math.round(e.billableMinutes / capacityMinutes * 1000) / 10 : null,
      });
    }
    rows.sort((a, b) => num(b.billableValue) - num(a.billableValue));
    const withCap = rows.filter((r) => r.capacityMinutes);
    const totals = {
      minutes: rows.reduce((n, r) => n + r.minutes, 0),
      billableMinutes: rows.reduce((n, r) => n + r.billableMinutes, 0),
      billableValue: round2(rows.reduce((n, r) => n + r.billableValue, 0)),
      capacityMinutes: withCap.reduce((n, r) => n + r.capacityMinutes, 0),
      members: rows.length,
      from: from, to: to,
    };
    totals.hours = round2(totals.minutes / 60);
    totals.billableHours = round2(totals.billableMinutes / 60);
    totals.utilPct = totals.capacityMinutes ? Math.round(totals.minutes / totals.capacityMinutes * 1000) / 10 : null;
    totals.billableUtilPct = totals.capacityMinutes ? Math.round(totals.billableMinutes / totals.capacityMinutes * 1000) / 10 : null;
    return { from: from, to: to, rows: rows, totals: totals };
  };

  /* ─────────────────────────── agreement margin & billing ─────────────────────────── */

  D.agreements = async function (pid, opts) {
    const p = await ERP.agreements.profitability(pid, opts || {});
    return { from: p.from, to: p.to, rows: p.rows, totals: p.totals };
  };

  D.billing = async function (pid, opts) {
    opts = opts || {};
    const [backlog, aging, summary] = await Promise.all([
      ERP.ar.backlog(pid, opts).catch(() => ({ rows: [], totals: {} })),
      ERP.ar.arAging(pid, opts).catch(() => ({ rows: [], totals: {} })),
      ERP.ar.summary(pid, opts).catch(() => ({ totals: {}, counts: {} })),
    ]);
    return { asOf: backlog.asOf || ui.today(), backlog: backlog, aging: aging, summary: summary };
  };

  /* ─────────────────────────── revenue trend ─────────────────────────── */

  D.revenueTrend = async function (pid, opts) {
    opts = opts || {};
    const months = opts.months || 12;
    const thisMonth = monthKey(ui.today());
    const keys = [];
    for (let i = months - 1; i >= 0; i--) keys.push(shiftMonth(thisMonth, -i));
    const map = {};
    keys.forEach((k) => { map[k] = { month: k, invoiced: 0, received: 0, invoices: 0, payments: 0 }; });
    const invoices = await ERP.billing.all(pid, opts.companyId ? { companyId: opts.companyId } : {});
    invoices.forEach((i) => {
      if (i.status !== "posted") return;
      const k = monthKey(i.issueDate);
      if (!map[k]) return;
      map[k].invoiced = round2(map[k].invoiced + num(i.total));
      map[k].invoices += 1;
    });
    const payments = await ERP.payments.all(pid, opts.companyId ? { companyId: opts.companyId } : {});
    payments.forEach((p) => {
      if (p.status === "void" || p.kind === "credit") return;
      const k = monthKey(p.date);
      if (!map[k]) return;
      map[k].received = round2(map[k].received + num(p.amount));
      map[k].payments += 1;
    });
    const rows = keys.map((k) => map[k]);
    const totals = {
      invoiced: round2(rows.reduce((n, r) => n + r.invoiced, 0)),
      received: round2(rows.reduce((n, r) => n + r.received, 0)),
      invoices: rows.reduce((n, r) => n + r.invoices, 0),
    };
    return { rows: rows, totals: totals };
  };

  /* ─────────────────────────── combined overview ─────────────────────────── */

  D.overview = async function (pid, opts) {
    opts = opts || {};
    const [sla, backlog, util, agreements, billing, revenue] = await Promise.all([
      D.sla(pid, opts), D.backlog(pid, opts), D.utilization(pid, opts),
      D.agreements(pid, opts).catch(() => ({ totals: {} })), D.billing(pid, opts), D.revenueTrend(pid, opts),
    ]);
    const thisMonth = revenue.rows[revenue.rows.length - 1] || { invoiced: 0, received: 0 };
    const pipeline = await ERP.sales.summary(pid, {}).catch(() => ({}));
    return {
      asOf: ui.today(),
      kpis: {
        slaCompliancePct: sla.totals.compliancePct,
        slaBreached: sla.totals.breached,
        slaAtRisk: sla.totals.atRisk,
        openTickets: backlog.open,
        unassigned: backlog.unassigned,
        oldestDays: backlog.oldest.length ? backlog.oldest[0].days : 0,
        utilPct: util.totals.utilPct,
        billableHours: util.totals.billableHours,
        billableValue: util.totals.billableValue,
        unbilledWip: billing.backlog.totals.total || 0,
        arOutstanding: billing.summary.totals.outstanding || 0,
        arOverdue: (billing.aging.totals.total || 0) - (billing.aging.totals.current || 0),
        agreementMargin: agreements.totals.margin || 0,
        agreementMarginPct: agreements.totals.marginPct || 0,
        revenueThisMonth: thisMonth.invoiced || 0,
        collectedThisMonth: thisMonth.received || 0,
        pipelineWeighted: pipeline.weighted || 0,
      },
      sla: sla, backlog: backlog, utilization: util,
      agreements: { totals: agreements.totals }, billing: billing, revenue: revenue,
    };
  };

  /* ─────────────────────────── drill-down ─────────────────────────── */

  D.drill = async function (pid, kind, key, opts) {
    opts = opts || {};
    const { all, closed, boardLabel } = await ticketsWithCtx(pid, opts);
    const now = Date.now();
    if (kind === "sla-breach" || kind === "sla-atrisk") {
      const want = kind === "sla-breach" ? "breached" : "atRisk";
      const rows = all.filter((tk) => {
        if (closed.has(String(tk.status))) return false;
        const st = tk.sla ? ERP.sla.state(tk, now) : null;
        return st && st.applies && st[want];
      }).map(ticketRow);
      return { title: want === "breached" ? "SLA breaches" : "At-risk tickets", rows: rows, columns: ticketCols() };
    }
    if (kind === "backlog-bucket") {
      const rows = all.filter((tk) => {
        if (closed.has(String(tk.status))) return false;
        const days = tk.createdAt ? Math.max(0, ui.diffDays(String(tk.createdAt).slice(0, 10), ui.today())) : 0;
        return ui.ageBucket(days) === key;
      }).map(ticketRow);
      return { title: "Tickets aged " + key, rows: rows, columns: ticketCols() };
    }
    if (kind === "backlog-board") {
      const rows = all.filter((tk) => !closed.has(String(tk.status)) && String(tk.board || "") === String(key || "")).map(ticketRow);
      return { title: "Open tickets · " + (boardLabel[key] || key), rows: rows, columns: ticketCols() };
    }
    if (kind === "util-member") {
      const from = opts.from || monthStart(ui.today());
      const to = opts.to || ui.today();
      const entries = (await ERP.time.entries(pid, { memberId: key })).filter((e) => String(e.date) >= from && String(e.date) <= to);
      const rows = entries.map((e) => ({
        date: e.date, minutes: num(e.minutes), hours: round2(num(e.minutes) / 60),
        billable: !!e.billable && !e.writtenOff,
        amount: e.billable && e.rate ? round2((num(e.minutes) / 60) * num(e.rate.amount)) : 0,
        status: ERP.time.statusLabel(e.status),
      }));
      return { title: "Time entries", rows: rows, columns: [
        { key: "date", label: "Date" }, { key: "hours", label: "Hours", align: "right" },
        { key: "billable", label: "Billable" }, { key: "amount", label: "Value", align: "right" },
        { key: "status", label: "Status" },
      ] };
    }
    if (kind === "agreement") {
      const p = await ERP.agreements.profitability(pid, Object.assign({}, opts));
      const row = p.rows.find((r) => String(r.agreementId) === String(key));
      return { title: "Agreement cost", rows: row ? [row] : [], columns: [
        { key: "agreementName", label: "Agreement" }, { key: "companyName", label: "Client" },
        { key: "revenue", label: "Revenue", align: "right" }, { key: "laborCost", label: "Labour cost", align: "right" },
        { key: "expenseCost", label: "Expense cost", align: "right" }, { key: "margin", label: "Margin", align: "right" },
        { key: "marginPct", label: "Margin %", align: "right" },
      ] };
    }
    return { title: "No detail", rows: [], columns: [] };
  };

  function ticketCols() {
    return [
      { key: "number", label: "#" }, { key: "summary", label: "Summary" }, { key: "companyName", label: "Client" },
      { key: "boardLabel", label: "Board" }, { key: "priorityLabel", label: "Priority" }, { key: "statusLabel", label: "Status" },
      { key: "ageDays", label: "Age", align: "right" }, { key: "slaState", label: "SLA" },
    ];
  }
  function ticketRow(tk) {
    const closed = new Set();
    const st = tk.sla ? ERP.sla.state(tk) : null;
    return {
      number: tk.number, summary: tk.summary || "", companyName: tk.__companyName || "",
      boardLabel: tk.board, priorityLabel: tk.priority, statusLabel: tk.status,
      ageDays: tk.createdAt ? Math.max(0, ui.diffDays(String(tk.createdAt).slice(0, 10), ui.today())) : 0,
      slaState: st && st.applies ? ERP.sla.stateLabel(st) : "—",
    };
  }

  /* ─────────────────────────── rendering ─────────────────────────── */

  function fmtMs(ms) {
    if (ms == null) return "—";
    const h = ms / 3600000;
    if (h < 1) return Math.round(ms / 60000) + " min";
    if (h < 48) return round2(h) + " h";
    return round2(h / 24) + " d";
  }
  function pctLabel(v) { return v == null ? "—" : v + "%"; }

  function kpiCard(label, value, sub, tone) {
    return '<div class="erp-kpi' + (tone ? " tone-" + tone : "") + '"><span class="erp-kpi-label">' + ui.esc(label) + '</span><span class="erp-kpi-value">' + value + "</span>" + (sub ? '<span class="erp-kpi-hint">' + sub + "</span>" : "") + "</div>";
  }

  D.render = async function (panel, pid, refresh) {
    const host = panel.__host || panel;
    const state = host.__dash || (host.__dash = { from: monthStart(ui.today()), to: ui.today(), drill: null });
    if (!state.from) state.from = monthStart(ui.today());
    if (!state.to) state.to = ui.today();
    const ov = await D.overview(pid, { from: state.from, to: state.to });
    const k = ov.kpis;

    const kpis = '<div class="erp-kpi-grid">' +
      kpiCard("SLA compliance", pctLabel(k.slaCompliancePct), k.slaBreached + " breached · " + k.slaAtRisk + " at risk", k.slaBreached ? "danger" : "success") +
      kpiCard("Open tickets", ui.fmt(k.openTickets, 0), k.unassigned + " unassigned · oldest " + k.oldestDays + "d") +
      kpiCard("Utilisation", pctLabel(k.utilPct), k.billableHours + " billable h") +
      kpiCard("Unbilled WIP", ERP.security.money(k.unbilledWip), "approved work not yet invoiced") +
      kpiCard("AR outstanding", ERP.security.money(k.arOutstanding), ERP.security.money(k.arOverdue) + " overdue", k.arOverdue > 0 ? "warn" : "") +
      kpiCard("Agreement margin", ERP.security.money(k.agreementMargin), pctLabel(k.agreementMarginPct) + " margin") +
      kpiCard("Revenue this month", ERP.security.money(k.revenueThisMonth), ERP.security.money(k.collectedThisMonth) + " collected") +
      kpiCard("Pipeline (weighted)", ERP.security.money(k.pipelineWeighted), "open opportunities") +
      "</div>";

    /* charts */
    const backlogChart = ERP.reports.chartBox("bar", {
      labels: ov.backlog.byPriority.map((r) => r.label),
      series: [{ name: "Open", values: ov.backlog.byPriority.map((r) => r.count) }],
    }, { height: 240, title: "Backlog by priority", decimals: 0, theme: null }, null);
    const revenueChart = ERP.reports.chartBox("line", {
      labels: ov.revenue.rows.map((r) => r.month),
      series: [
        { name: "Invoiced", data: ov.revenue.rows.map((r) => r.invoiced) },
        { name: "Received", data: ov.revenue.rows.map((r) => r.received) },
      ],
    }, { height: 240, title: "Revenue trend", theme: null }, null);
    const slaChart = ERP.reports.chartBox("donut", ov.sla.byBoard.filter((b) => b.applicable).slice(0, 8).map((b) => ({ label: b.label, value: b.count })), { height: 240, title: "Tickets by board", theme: null }, null);

    const slaTable = ui.table([
      { key: "label", label: "Board" },
      { key: "count", label: "Tickets", align: "right" },
      { key: "compliancePct", label: "SLA %", align: "right", render: (r) => pctLabel(r.compliancePct) },
      { key: "breached", label: "Breached", align: "right", render: (r) => (r.breached ? ui.badge(String(r.breached), "danger") : "0") },
      { key: "atRisk", label: "At risk", align: "right" },
      { key: "avgResponseMs", label: "Avg 1st response", align: "right", render: (r) => fmtMs(r.avgResponseMs) },
      { key: "avgResolutionMs", label: "Avg resolution", align: "right", render: (r) => fmtMs(r.avgResolutionMs) },
      { key: "drill", label: "", render: (r) => ui.btn("Open", { small: true, act: "dash-drill", arg: "backlog-board|" + r.key, icon: null }) },
    ], ov.sla.byBoard, { emptyText: "No SLA-bearing tickets yet." });

    const backlogTable = ui.table([
      { key: "label", label: "Board" },
      { key: "current", label: "Current", align: "right" },
      { key: "1-30", label: "1–30", align: "right" },
      { key: "31-60", label: "31–60", align: "right" },
      { key: "61-90", label: "61–90", align: "right" },
      { key: "90+", label: "90+", align: "right" },
      { key: "count", label: "Total", align: "right" },
    ], ov.backlog.byBoard, { emptyText: "No open tickets." });

    const utilTable = ui.table([
      { key: "name", label: "Technician" },
      { key: "hours", label: "Hours", align: "right" },
      { key: "billableHours", label: "Billable h", align: "right" },
      { key: "capacityHours", label: "Capacity h", align: "right", render: (r) => (r.capacityHours == null ? "—" : ui.fmt(r.capacityHours, 1)) },
      { key: "utilPct", label: "Util %", align: "right", render: (r) => pctLabel(r.utilPct) },
      { key: "billableUtilPct", label: "Billable %", align: "right", render: (r) => pctLabel(r.billableUtilPct) },
      { key: "billableValue", label: "Value", align: "right", render: (r) => ERP.security.money(r.billableValue) },
      { key: "drill", label: "", render: (r) => ui.btn("Open", { small: true, act: "dash-drill", arg: "util-member|" + r.memberId, icon: null }) },
    ], ov.utilization.rows, { emptyText: "No time captured in this period." });

    const agr = await D.agreements(pid, { from: state.from, to: state.to }).catch(() => ({ rows: [], totals: {} }));
    const agrTable = ui.table([
      { key: "agreementName", label: "Agreement" },
      { key: "companyName", label: "Client" },
      { key: "revenue", label: "Revenue", align: "right", render: (r) => ERP.security.money(r.revenue, r.currency) },
      { key: "costTotal", label: "Cost", align: "right", render: (r) => ERP.security.money(r.costTotal, r.currency) },
      { key: "margin", label: "Margin", align: "right", render: (r) => ERP.security.money(r.margin, r.currency) },
      { key: "marginPct", label: "Margin %", align: "right", render: (r) => r.marginPct + "%" },
      { key: "drill", label: "", render: (r) => ui.btn("Open", { small: true, act: "dash-drill", arg: "agreement|" + r.agreementId, icon: null }) },
    ], (agr.rows || []).slice(0, 12), { emptyText: "No agreement charges yet." });

    const drill = state.drill ? '<div id="dashDrill">' + (host.__dashDrillHtml || "") + "</div>" : '<div id="dashDrill"></div>';

    panel.innerHTML =
      ui.pageHead("Operational dashboards", "Live service-desk and business KPIs — click through any row to the records behind it.", "") +
      '<div class="erp-toolbar"><label class="erp-inline-field">From <input type="date" name="dash_from" value="' + ui.esc(state.from) + '"></label>' +
      '<label class="erp-inline-field">To <input type="date" name="dash_to" value="' + ui.esc(state.to) + '"></label>' +
      ui.btn("Refresh", { small: true, act: "dash-refresh", icon: null }) + "</div>" +
      kpis +
      '<div class="erp-dash-cols">' + ui.card("Revenue trend", revenueChart) + ui.card("Tickets by board", slaChart) + "</div>" +
      ui.card("SLA compliance by board", slaTable) +
      '<div class="erp-dash-cols">' + ui.card("Backlog by priority", backlogChart) + ui.card("Ticket aging by board", backlogTable) + "</div>" +
      ui.card("Technician utilisation", utilTable) +
      ui.card("Agreement profitability", agrTable) +
      drill;

    panel.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act"), arg = t.getAttribute("data-arg") || "";
      if (act === "dash-refresh") {
        state.from = panel.querySelector('[name="dash_from"]').value || state.from;
        state.to = panel.querySelector('[name="dash_to"]').value || state.to;
        refresh();
      } else if (act === "dash-drill") {
        const [kind, key] = arg.split("|");
        const d = await D.drill(pid, kind, key, { from: state.from, to: state.to });
        const cols = d.columns.map((c) => Object.assign({}, c, { align: c.align || "", render: c.render || ((r) => renderPlain(c, r)) }));
        const html = ui.card(d.title, ui.table(cols, d.rows, { emptyText: "Nothing to show." }), { actions: ui.btn("Close", { small: true, act: "dash-drill-close", icon: null }) });
        host.__dashDrillHtml = html;
        state.drill = true;
        let box = panel.querySelector("#dashDrill");
        if (!box) { box = document.createElement("div"); box.id = "dashDrill"; panel.appendChild(box); }
        box.innerHTML = html;
      } else if (act === "dash-drill-close") {
        state.drill = false; host.__dashDrillHtml = "";
        const box = panel.querySelector("#dashDrill"); if (box) box.innerHTML = "";
      }
    });
  };

  function renderPlain(col, row) {
    const v = row[col.key];
    if (v == null || v === "") return "—";
    if (typeof v === "number") return ui.fmt(v, 2);
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return ui.esc(v);
  }
})();
