/* ============================================================
   BI validation tests — roadmap tasks 17–21 (chart adapter:
   chart-type recommendation, rendering every shape through the
   data-visualization-plugin, KPI cards, the P&L table, drill-down
   chips and theme pass-through).
   Run via: await BI.runTests("viz")  (page_eval harness).
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  BI.tests.viz = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });

      if (BI.facts.records.length === 0) {
        await BI.bus.init({ manifestUrl: "src/bi/fixtures/manifest.json", cadenceMs: 21600000, stalenessMs: 108000000 });
      }
      push("charts plugin present", !!(window.root && root.charts), window.root && root.charts ? Object.keys(root.charts).join(",") : "missing");

      /* ---------- A: chart-type recommendation ---------- */
      {
        push("A: dimension report uses metric default", BI.viz.recommend({ measure: "pipelineValue", dimension: "stage" }) === "donut");
        push("A: multi-measure → timeSeries", BI.viz.recommend({ measures: ["revenue", "expenses"] }) === "timeSeries");
        push("A: no dimension → timeSeries", BI.viz.recommend({ measure: "cash" }) === "timeSeries");
        push("A: ratio metric default respected", BI.viz.recommend({ measure: "winRate", dimension: "owner" }) === "bar");
      }

      /* ---------- B: every chart shape renders ---------- */
      {
        const cases = [
          ["timeSeries", "fin-revenue"],
          ["bar", "fin-receivables-aging"],
          ["line", "fin-cashflow"],
          ["pie", "crm-pipeline-stage"],
          ["donut", "pm-workload"],
          ["histogram", "erp-inventory-lows"],
        ];
        for (const [kind, presetId] of cases) {
          const rep = BI.reports.get(presetId);
          const html = BI.viz.render(rep, BI.reports.query(rep));
          push("B: " + kind + " renders svg", html.indexOf("<svg") >= 0, html.slice(0, 120));
        }
      }

      /* ---------- C: KPI card ---------- */
      {
        const rep = BI.reports.get("kpi-revenue");
        const html = BI.viz.render(rep, BI.reports.query(rep), { chartType: "kpi" });
        push("C: kpi renders value", html.indexOf("bi-kpi-value") >= 0 && html.indexOf("$177") >= 0, html.slice(0, 160));
        push("C: kpi renders delta with arrow", html.indexOf("bi-kpi-delta") >= 0 && (html.indexOf("data-arrow=\"up\"") >= 0), html.match(/bi-kpi-delta[^>]*/));
        const noPrev = BI.viz.render({ id: "x", name: "X", measure: "cash", dateRange: { type: "all" }, chartType: "kpi", sourceTool: "the-ledger" }, BI.reports.query({ id: "x", name: "X", measure: "cash", dateRange: { type: "all" }, chartType: "kpi", sourceTool: "the-ledger" }));
        push("C: kpi without prior period shows none", noPrev.indexOf("no prior period") >= 0 || noPrev.indexOf("bi-kpi-delta none") >= 0);
      }

      /* ---------- D: P&L table ---------- */
      {
        const rep = BI.reports.get("fin-pnl");
        const html = BI.viz.render(rep, BI.reports.query(rep), { chartType: "table" });
        push("D: table renders", html.indexOf("bi-table") >= 0);
        for (const label of ["Revenue", "Expenses", "Gross profit", "Net profit"]) {
          push("D: table row " + label, html.indexOf(label) >= 0);
        }
        push("D: table shows the net-profit value", html.indexOf("11,793") >= 0, html.slice(0, 200));
      }

      /* ---------- E: drill chips ---------- */
      {
        const rep = BI.reports.get("fin-receivables-aging"); /* bucket dimension */
        const q = BI.reports.query(rep);
        const chips = BI.viz.drillChips(rep, q);
        push("E: dimension report yields one chip per category", chips.length === q.cats.length && chips.every((c) => c.overrides.filters));
        push("E: chips carry the dimension filter", chips[0] && chips[0].overrides.filters[0].name === "bucket" && chips[0].overrides.filters[0].value === "0-30", JSON.stringify(chips[0]));

        const ts = BI.reports.get("fin-revenue");
        const tsChips = BI.viz.drillChips(ts, BI.reports.query(ts));
        push("E: time series yields per-period chips", tsChips.length >= 12 && tsChips[0].overrides.dateRange.type === "custom", JSON.stringify(tsChips[0]));
      }

      /* ---------- F: theme pass-through ---------- */
      {
        BI.theme.set("light");
        const light = BI.viz.themeOpts({});
        BI.theme.set("dark");
        const dark = BI.viz.themeOpts({});
        BI.theme.set("light");
        push("F: themeOpts tracks the active theme", light.theme === "light" && dark.theme === "dark");
        push("F: extra options merge through", BI.viz.themeOpts({ title: "T" }).title === "T");
      }

      /* ---------- G: unknown chart type is surfaced, not thrown ---------- */
      {
        const html = BI.viz.render({ id: "z", name: "Z", measure: "cash", chartType: "banana", sourceTool: "the-ledger" }, { labels: [], values: [], series: { series: [] }, totals: {} });
        push("G: unknown chart type shows an error string", html.indexOf("Unknown chart type") >= 0);
      }

      return results;
    },
  };
})();
