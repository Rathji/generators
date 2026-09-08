/* ============================================================
   BI metric catalog — every known metric, its display name,
   unit/format, default chart type, which tool+bundle owns it,
   and how it aggregates. All reports share these labels/formatting.

   Aggregation tells the query engine how to combine values:
     sum    — counts and money (default)
     average— percentages / rates (utilization, margin)
     last   — balance-style measures (cash: latest value wins)
     ratio  — computed from component measures (winRate = wins/(wins+losses))
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const CURRENCY = { unit: "currency", symbol: "$", decimals: 0 };
  const PERCENT = { unit: "percent", decimals: 1 };
  const COUNT = { unit: "count", decimals: 0 };
  const HOURS = { unit: "hours", decimals: 1 };

  const METRICS = {
    /* ---- the-ledger ---- */
    revenue: { label: "Revenue", format: CURRENCY, defaultChart: "timeSeries", better: "higher", tool: "the-ledger", bundleType: "ledger", agg: "sum" },
    expenses: { label: "Expenses", format: CURRENCY, defaultChart: "timeSeries", better: "lower", tool: "the-ledger", bundleType: "ledger", agg: "sum" },
    grossProfit: { label: "Gross profit", format: CURRENCY, defaultChart: "timeSeries", better: "higher", tool: "the-ledger", bundleType: "ledger", agg: "sum" },
    operatingExpenses: { label: "Operating expenses", format: CURRENCY, defaultChart: "timeSeries", better: "lower", tool: "the-ledger", bundleType: "ledger", agg: "sum" },
    netProfit: { label: "Net profit", format: CURRENCY, defaultChart: "timeSeries", better: "higher", tool: "the-ledger", bundleType: "ledger", agg: "sum" },
    cash: { label: "Cash position", format: CURRENCY, defaultChart: "timeSeries", better: "higher", tool: "the-ledger", bundleType: "ledger", agg: "last" },
    receivables: { label: "Receivables", format: CURRENCY, defaultChart: "bar", better: "lower", tool: "the-ledger", bundleType: "ledger", agg: "sum" },
    payables: { label: "Payables", format: CURRENCY, defaultChart: "bar", better: "lower", tool: "the-ledger", bundleType: "ledger", agg: "sum" },

    /* ---- crm ---- */
    pipelineValue: { label: "Pipeline value", format: CURRENCY, defaultChart: "donut", better: "higher", tool: "crm", bundleType: "crm", agg: "sum" },
    weightedForecast: { label: "Weighted forecast", format: CURRENCY, defaultChart: "timeSeries", better: "higher", tool: "crm", bundleType: "crm", agg: "sum" },
    wins: { label: "Deals won", format: COUNT, defaultChart: "bar", better: "higher", tool: "crm", bundleType: "crm", agg: "sum" },
    losses: { label: "Deals lost", format: COUNT, defaultChart: "bar", better: "lower", tool: "crm", bundleType: "crm", agg: "sum" },
    winRate: { label: "Win rate", format: PERCENT, defaultChart: "bar", better: "higher", tool: "crm", bundleType: "crm", agg: "ratio", ratio: { numerator: "wins", denominator: ["wins", "losses"] } },
    activities: { label: "Sales activities", format: COUNT, defaultChart: "bar", better: "higher", tool: "crm", bundleType: "crm", agg: "sum" },

    /* ---- psa ---- */
    utilization: { label: "Utilization", format: PERCENT, defaultChart: "timeSeries", better: "higher", tool: "psa", bundleType: "psa", agg: "average" },
    budgetVsActual: { label: "Budget vs actual", format: CURRENCY, defaultChart: "bar", better: "lower", tool: "psa", bundleType: "psa", agg: "sum" },
    unbilledHours: { label: "Unbilled hours", format: HOURS, defaultChart: "bar", better: "lower", tool: "psa", bundleType: "psa", agg: "sum" },
    projectMargin: { label: "Project margin", format: PERCENT, defaultChart: "bar", better: "higher", tool: "psa", bundleType: "psa", agg: "average" },

    /* ---- project-master ---- */
    milestonesCompleted: { label: "Milestones completed", format: COUNT, defaultChart: "bar", better: "higher", tool: "project-master", bundleType: "projects", agg: "sum" },
    openWorkload: { label: "Open workload", format: COUNT, defaultChart: "donut", better: "lower", tool: "project-master", bundleType: "projects", agg: "sum" },
    atRiskProjects: { label: "At-risk projects", format: COUNT, defaultChart: "bar", better: "lower", tool: "project-master", bundleType: "projects", agg: "sum" },

    /* ---- erp ---- */
    inventoryLow: { label: "Inventory lows", format: COUNT, defaultChart: "bar", better: "lower", tool: "erp", bundleType: "erp", agg: "sum" },
    purchaseSpend: { label: "Purchase spend", format: CURRENCY, defaultChart: "timeSeries", better: "lower", tool: "erp", bundleType: "erp", agg: "sum" },

    /* ---- kb-sop ---- */
    articleCount: { label: "Articles", format: COUNT, defaultChart: "bar", better: "higher", tool: "kb-sop", bundleType: "kb", agg: "sum" },
    staleCount: { label: "Stale articles", format: COUNT, defaultChart: "bar", better: "lower", tool: "kb-sop", bundleType: "kb", agg: "sum" },

    /* ---- idea-incubator ---- */
    ideaCount: { label: "Ideas", format: COUNT, defaultChart: "donut", better: "higher", tool: "idea-incubator", bundleType: "ideas", agg: "sum" },
  };

  const TOOLS = {
    "the-ledger": { name: "The Ledger", short: "Ledger" },
    crm: { name: "CRM", short: "CRM" },
    psa: { name: "PSA", short: "PSA" },
    "project-master": { name: "Project Master", short: "Projects" },
    erp: { name: "ERP", short: "ERP" },
    "kb-sop": { name: "KB / SOP", short: "KB" },
    "idea-incubator": { name: "Idea Incubator", short: "Ideas" },
  };

  const CHART_TYPES = ["timeSeries", "bar", "line", "pie", "donut", "histogram", "kpi", "table"];
  const PERIOD_GROUPINGS = ["day", "week", "month", "quarter", "year"];
  const DATE_RANGES = ["last3m", "last6m", "last12m", "thisYear", "lastYear", "all"];

  BI.catalog = {
    metrics: METRICS,
    tools: TOOLS,
    chartTypes: CHART_TYPES,
    periodGroupings: PERIOD_GROUPINGS,
    dateRanges: DATE_RANGES,

    get(id) { return METRICS[id] || null; },
    tool(id) { return TOOLS[id] || { name: id, short: id }; },
    metricIds() { return Object.keys(METRICS); },
    metricsForTool(tool) { return this.metricIds().filter((m) => METRICS[m].tool === tool); },
    measureOf(metric) { return METRICS[metric] ? METRICS[metric].bundleType : null; },

    /* ---- formatting ---- */
    fmt(metric, value, decimals) {
      if (value == null || !isFinite(value)) return "—";
      const def = METRICS[metric];
      const f = def && def.format ? def.format : COUNT;
      const d = decimals != null ? decimals : f.decimals;
      if (f.unit === "currency") {
        const sym = f.symbol || "$";
        const neg = value < 0;
        return (neg ? "-" : "") + sym + Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
      }
      if (f.unit === "percent") return value.toFixed(d) + "%";
      if (f.unit === "hours") return value.toLocaleString(undefined, { maximumFractionDigits: d }) + "h";
      return value.toLocaleString(undefined, { maximumFractionDigits: d });
    },

    fmtDelta(current, previous) {
      if (previous == null || previous === 0) return { abs: null, pct: null };
      const abs = current - previous;
      const pct = (abs / Math.abs(previous)) * 100;
      return { abs, pct };
    },
  };
})();
