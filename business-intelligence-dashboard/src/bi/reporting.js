/* ============================================================
   BI reporting — report definitions, period handling &
   comparison, filters & saved views, and report templates.

   A report is a saved object (canonical store doc, kind "report"):
     { id, name, description, measure | measures[],
       dimension, periodGrouping, comparePrevious, filters[],
       dateRange, chartType, format, sourceTool }

   Reusable across dashboards, exports and embeddable widgets.
   Saving any report as a template (meta.template) lets you
   instantiate it against new filters; dashboards can be
   duplicated in one action.

   Date ranges anchor to the bus's "report as-of" date (the latest
   published data), so reports stay meaningful whenever they are
   opened. Previous-period comparison measures the same window
   immediately before the selected range.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const reports = (BI.reports = {});

  /* ---------- date ranges ---------- */
  function addMonths(iso, n) {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 10);
  }
  function asOf() {
    if (BI.bus && BI.bus.tools && BI.bus.tools.length) {
      let best = null;
      for (const b of BI.bus.cachedBundles()) {
        const a = (b.asOf || b.publishedAt || "").slice(0, 10);
        if (a && (!best || a > best)) best = a;
      }
      if (best) return best;
    }
    let max = null;
    for (const r of BI.facts.records) if (r.period && (!max || r.period > max)) max = r.period;
    return max || new Date().toISOString().slice(0, 10);
  }
  reports.asOf = asOf;

  reports.dateRangeBounds = function (dr) {
    dr = dr || { type: "all" };
    if (dr.type === "custom" && dr.from && dr.to) return { from: dr.from, to: dr.to };
    if (dr.type === "all") return { from: null, to: null };
    const now = dr.anchor || asOf();
    const y = Number(now.slice(0, 4));
    switch (dr.type) {
      case "last3m": return { from: addMonths(now, -2).slice(0, 7) + "-01", to: now };
      case "last6m": return { from: addMonths(now, -5).slice(0, 7) + "-01", to: now };
      case "last12m": return { from: addMonths(now, -11).slice(0, 7) + "-01", to: now };
      case "thisYear": return { from: y + "-01-01", to: now };
      case "lastYear": return { from: (y - 1) + "-01-01", to: (y - 1) + "-12-31" };
      default: return { from: null, to: null };
    }
  };

  /* previous equivalent window (null for unbounded ranges) */
  reports.previousBounds = function (bounds) {
    if (!bounds || !bounds.from || !bounds.to) return null;
    const ms = (i) => new Date(i + "T00:00:00Z").getTime();
    const len = ms(bounds.to) - ms(bounds.from);
    const prevTo = new Date(ms(bounds.from) - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(ms(prevTo) - len).toISOString().slice(0, 10);
    return { from: prevFrom, to: prevTo };
  };

  /* ---------- definition helpers ---------- */
  function norm(report) {
    const r = Object.assign({}, report);
    if (!r.periodGrouping) r.periodGrouping = "month";
    if (!r.dateRange) r.dateRange = { type: "all" };
    if (!r.measure && !r.measures) r.measure = "revenue";
    if (!r.sourceTool) r.sourceTool = BI.catalog.get(r.measure || (r.measures && r.measures[0])).tool;
    if (!r.chartType) r.chartType = BI.viz.recommend(r);
    if (r.comparePrevious == null) r.comparePrevious = true;
    return r;
  }
  reports.norm = norm;

  reports.dimensionFor = function (report, measure) {
    if (report.dimension) return report.dimension;
    const def = BI.catalog.get(measure);
    return def && def.defaultDimension ? def.defaultDimension : "";
  };

  /* ---------- querying ---------- */
  reports.query = function (report, overrides) {
    const r = norm(report);
    const q = BI.facts.query(r, overrides);
    const bounds = BI.reports.dateRangeBounds(overrides && overrides.dateRange ? overrides.dateRange : r.dateRange);
    q.bounds = bounds;
    if (r.comparePrevious && !overrides || (overrides && overrides.comparePrevious !== false)) {
      q.comparison = reports.compare(r, overrides);
    }
    q.report = r;
    return q;
  };

  /* current vs previous window (sum of primary measure, honoring aggregation) */
  reports.compare = function (report, overrides) {
    overrides = overrides || {};
    const r = norm(report);
    const primary = Array.isArray(r.measures) ? r.measures[0] : r.measure;
    const metric = BI.catalog.get(primary);
    const bounds = BI.reports.dateRangeBounds(overrides.dateRange || r.dateRange);
    const prevB = BI.reports.previousBounds(bounds);
    const opts = BI.facts.reportFilterOpts(r, overrides);
    const ratio = metric && metric.agg === "ratio" && metric.ratio;
    const meas = ratio ? [primary, ...(metric.ratio.numerator ? [metric.ratio.numerator] : []), ...(metric.ratio.denominator || [])] : [primary];
    const val = (from, to) => {
      const recs = BI.facts.filter(meas, Object.assign({}, opts, { from, to }));
      return ratio ? BI.facts.ratioValue(metric, recs) : BI.facts.aggregate(recs.map((x) => x.value), metric);
    };
    const current = val(bounds.from, bounds.to);
    if (!prevB) return { current, previous: null, ...BI.catalog.fmtDelta(current, null), bounds, prevBounds: null };
    const previous = val(prevB.from, prevB.to);
    return { current, previous, ...BI.catalog.fmtDelta(current, previous), bounds, prevBounds: prevB };
  };

  /* ---------- CSV (task 27) ---------- */
  reports.toCSV = function (report, overrides) {
    const r = norm(report);
    const recs = BI.facts.recordsFor(r, overrides);
    const head = ["tool", "bundleType", "period", "dimension", "measure", "value"];
    const rows = [head.join(",")];
    for (const rec of recs) {
      rows.push([rec.tool, rec.bundleType, rec.period, rec.dimension, rec.measure, rec.value].map((c) => {
        const s = String(c == null ? "" : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(","));
    }
    return rows.join("\n");
  };
  reports.downloadCSV = function (report, overrides) {
    const csv = reports.toCSV(report, overrides);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (report.id || report.name || "report").replace(/[^a-z0-9-]+/gi, "-") + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return csv;
  };

  /* ---------- saved views (named filter sets) ---------- */
  reports.views = function () {
    return BI.store.list().filter((e) => e.kind === "view").map((e) => BI.store.get(e.id));
  };
  reports.saveView = async function (view) {
    const id = view.id || "view-" + Date.now().toString(36);
    return BI.store.create({ id, kind: "view", label: view.name, data: { name: view.name, filters: view.filters || [], dateRange: view.dateRange || null } });
  };

  /* ---------- templates ---------- */
  reports.templates = function () {
    return BI.store.list()
      .filter((e) => e.kind === "report")
      .map((e) => BI.store.get(e.id))
      .filter((d) => d && d.meta && d.meta.template);
  };
  reports.saveTemplate = async function (report) {
    const id = report.id || "tpl-" + Date.now().toString(36);
    return BI.store.create({
      id, kind: "report", label: report.name,
      meta: { template: true, from: report.meta && report.meta.from },
      data: norm({ ...report, id, meta: { template: true } }),
    });
  };
  reports.instantiate = function (templateDoc, overrides) {
    const t = templateDoc.data || templateDoc;
    const r = norm({ ...t });
    if (overrides && overrides.filters) r.filters = overrides.filters;
    if (overrides && overrides.dateRange) r.dateRange = overrides.dateRange;
    return r;
  };
  reports.duplicateDashboard = async function (dashDoc, newName) {
    const d = dashDoc.data;
    const id = "dash-" + Date.now().toString(36);
    return BI.store.create({
      id, kind: "dashboard", label: newName || (dashDoc.label || "Dashboard") + " copy",
      data: { ...d, id, name: newName || d.name, layout: (d.layout || []).map((c) => ({ ...c, id: "c-" + Math.random().toString(36).slice(2, 8) })) },
    });
  };

  /* ============ built-in preset reports ============ */
  const P = (id, name, def) => ({ id, name, ...norm(def) });

  reports.presets = [
    /* executive KPIs */
    P("kpi-cash", "Cash position", { measure: "cash", dateRange: { type: "last6m" }, chartType: "kpi", sourceTool: "the-ledger" }),
    P("kpi-receivables", "Receivables", { measure: "receivables", chartType: "kpi", sourceTool: "the-ledger" }),
    P("kpi-payables", "Payables", { measure: "payables", chartType: "kpi", sourceTool: "the-ledger" }),
    P("kpi-revenue", "Revenue (3m)", { measure: "revenue", dateRange: { type: "last3m" }, chartType: "kpi", sourceTool: "the-ledger" }),
    P("kpi-pipeline", "Pipeline value", { measure: "pipelineValue", dateRange: { type: "all" }, chartType: "kpi", sourceTool: "crm" }),
    P("kpi-forecast", "Weighted forecast", { measure: "weightedForecast", dateRange: { type: "all" }, chartType: "kpi", sourceTool: "crm" }),
    P("kpi-utilization", "Utilization", { measure: "utilization", dateRange: { type: "last3m" }, chartType: "kpi", sourceTool: "psa" }),
    P("kpi-atrisk", "At-risk projects", { measure: "atRiskProjects", dateRange: { type: "all" }, chartType: "kpi", sourceTool: "project-master" }),
    P("kpi-lowstock", "Inventory lows", { measure: "inventoryLow", dateRange: { type: "all" }, chartType: "kpi", sourceTool: "erp" }),
    P("kpi-stalekb", "Stale KB articles", { measure: "staleCount", dateRange: { type: "all" }, chartType: "kpi", sourceTool: "kb-sop" }),

    /* financial */
    P("fin-revenue", "Revenue by period", { measure: "revenue", periodGrouping: "month", dateRange: { type: "last12m" }, chartType: "timeSeries", sourceTool: "the-ledger" }),
    P("fin-expenses", "Expenses by period", { measure: "expenses", periodGrouping: "month", dateRange: { type: "last12m" }, chartType: "timeSeries", sourceTool: "the-ledger" }),
    P("fin-rev-vs-exp", "Revenue vs expenses", { measures: ["revenue", "expenses"], periodGrouping: "month", dateRange: { type: "last12m" }, chartType: "timeSeries", sourceTool: "the-ledger" }),
    P("fin-cashflow", "Cash-flow trend", { measure: "cash", periodGrouping: "month", dateRange: { type: "last12m" }, chartType: "timeSeries", sourceTool: "the-ledger" }),
    P("fin-receivables-aging", "Receivables aging", { measure: "receivables", dimension: "bucket", chartType: "bar", sourceTool: "the-ledger" }),
    P("fin-payables-aging", "Payables aging", { measure: "payables", dimension: "bucket", chartType: "bar", sourceTool: "the-ledger" }),
    P("fin-pnl", "Profit & loss summary", { measures: ["revenue", "expenses", "grossProfit", "netProfit"], chartType: "table", sourceTool: "the-ledger" }),

    /* sales & CRM */
    P("crm-pipeline-stage", "Pipeline by stage", { measure: "pipelineValue", dimension: "stage", chartType: "donut", sourceTool: "crm" }),
    P("crm-pipeline-owner", "Pipeline by owner", { measure: "pipelineValue", dimension: "owner", chartType: "bar", sourceTool: "crm" }),
    P("crm-forecast-month", "Weighted forecast by close period", { measure: "weightedForecast", periodGrouping: "month", dateRange: { type: "all" }, chartType: "timeSeries", sourceTool: "crm" }),
    P("crm-winrate-owner", "Win rate by owner", { measure: "winRate", dimension: "owner", chartType: "bar", sourceTool: "crm" }),
    P("crm-wins-owner", "Won deals by owner", { measure: "wins", dimension: "owner", chartType: "bar", sourceTool: "crm" }),
    P("crm-top-customers", "Top customers by revenue", { measure: "revenue", dimension: "customer", chartType: "bar", sourceTool: "crm" }),
    P("crm-activities", "Sales activities", { measure: "activities", dimension: "owner", chartType: "bar", sourceTool: "crm" }),

    /* delivery & capacity */
    P("psa-utilization-person", "Utilization by person", { measure: "utilization", dimension: "person", dateRange: { type: "last3m" }, chartType: "bar", sourceTool: "psa" }),
    P("psa-utilization-trend", "Utilization trend", { measure: "utilization", periodGrouping: "month", dateRange: { type: "last3m" }, chartType: "timeSeries", sourceTool: "psa" }),
    P("psa-budget-actual", "Budget vs actual by project", { measure: "budgetVsActual", dimension: "project", chartType: "bar", sourceTool: "psa" }),
    P("psa-unbilled", "Unbilled hours by project", { measure: "unbilledHours", dimension: "project", chartType: "bar", sourceTool: "psa" }),
    P("psa-margin", "Project margin", { measure: "projectMargin", dimension: "project", chartType: "bar", sourceTool: "psa" }),
    P("pm-milestones", "Milestones completed", { measure: "milestonesCompleted", dimension: "project", chartType: "bar", sourceTool: "project-master" }),
    P("pm-workload", "Open workload by status", { measure: "openWorkload", dimension: "status", chartType: "donut", sourceTool: "project-master" }),
    P("pm-atrisk", "At-risk projects", { measure: "atRiskProjects", dimension: "project", chartType: "bar", sourceTool: "project-master" }),

    /* operations & health */
    P("erp-inventory-lows", "Inventory lows", { measure: "inventoryLow", dimension: "item", chartType: "bar", sourceTool: "erp" }),
    P("erp-purchase-spend", "Purchase spend", { measure: "purchaseSpend", periodGrouping: "month", dateRange: { type: "last12m" }, chartType: "timeSeries", sourceTool: "erp" }),
    P("kb-coverage", "KB coverage by category", { measure: "articleCount", dimension: "category", chartType: "bar", sourceTool: "kb-sop" }),
    P("kb-stale", "Stale KB articles by category", { measure: "staleCount", dimension: "category", chartType: "bar", sourceTool: "kb-sop" }),
    P("ideas-stage", "Ideas by stage", { measure: "ideaCount", dimension: "stage", chartType: "donut", sourceTool: "idea-incubator" }),
    P("ideas-month", "Ideas submitted by month", { measure: "ideaCount", periodGrouping: "month", dateRange: { type: "last12m" }, chartType: "timeSeries", sourceTool: "idea-incubator" }),
  ];

  reports.preset = function (id) { return reports.presets.find((p) => p.id === id) || null; };

  /* all reports a module can list: presets + stored report docs */
  reports.all = function () {
    const stored = BI.store.list()
      .filter((e) => e.kind === "report")
      .map((e) => BI.store.get(e.id))
      .filter((d) => d)
      .map((d) => ({ id: d.id, name: d.label, saved: true, doc: d, ...norm(d.data) }));
    return [...reports.presets.map((p) => ({ id: p.id, name: p.name, preset: true, ...p })), ...stored];
  };
  reports.get = function (id) {
    const p = reports.preset(id);
    if (p) return p;
    const d = BI.store.get(id);
    return d && d.kind === "report" ? { id: d.id, name: d.label, saved: true, doc: d, ...norm(d.data) } : null;
  };
})();
