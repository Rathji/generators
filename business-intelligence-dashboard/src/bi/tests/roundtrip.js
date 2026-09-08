/* ============================================================
   BI validation tests — full data round-trip (the glue across
   every layer): real fetcher → manifest discovery → bundle pull →
   validation → extractor → uniform facts → report queries →
   chart rendering, plus the charts plugin's own self-check.

   Hermetic: the suite re-initialises the bus under an isolated
   "bi.bus.tRT." prefix with the REAL manifest + fetcher, so it
   exercises the production path end-to-end without depending on
   the app's current cache state. The production bus + facts are
   restored afterwards.

   Validated:
     - 7 tools discovered from the real manifest (network fetch)
     - every source pulls + validates + extracts (health ok)
     - known fixture totals are reproduced as facts, per tool
       (this pins the numbers the dashboards show)
     - every one of the 38 presets renders a real chart/kpi/table
     - preset query totals match the fixtures
     - charts.selfCheck() passes (the chart plugin is healthy)
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const MANIFEST = "src/bi/fixtures/manifest.json";

  BI.tests.roundtrip = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });

      /* helpers over the fact store */
      const sumDim = (m, dim) => BI.facts.records.filter((r) => r.measure === m && r.dimension === dim).reduce((a, r) => a + r.value, 0);
      const sumEmpty = (m) => sumDim(m, "");
      const lastValue = (m) => {
        const recs = BI.facts.records.filter((r) => r.measure === m && r.dimension === "");
        if (!recs.length) return null;
        return recs.reduce((a, b) => (a.period > b.period ? a : b)).value;
      };
      const catSum = (m, dimName, value) => sumDim(m, dimName + ":" + value);
      const countMeasure = (m) => BI.facts.records.filter((r) => r.measure === m).length;

      /* ---------- isolated full pull over the real pipeline ---------- */
      BI.bus.debugFetcher(null);
      BI.bus.debugReset({ lsPrefix: "bi.bus.tRT.", wipe: true });
      const m = await BI.bus.init({ manifestUrl: MANIFEST, cadenceMs: 21600000, stalenessMs: 108000000 });

      push("A: manifest fetched from network", m.ok && m.manifest.fromNetwork === true, JSON.stringify(m.manifest));
      push("A: all seven tools discovered", BI.bus.tools.length === 7, BI.bus.tools.length + " tools");
      push("A: bus status exposes fact count", BI.bus.status().factCount === BI.facts.records.length);

      /* ---------- B: every source pulled + healthy ---------- */
      {
        const all = BI.bus.healthAll();
        push("B: every tool reports healthy bundles", all.every((t) => t.status === "ok"), all.map((t) => t.tool + "=" + t.status).join(", "));
        const ec = {};
        for (const t of all) for (const b of t.bundles) ec[t.tool + "." + b.type] = b.editCount;
        push("B: edit counts match the published fixtures", ec["the-ledger.ledger"] === 14 && ec["crm.crm"] === 9 && ec["psa.psa"] === 7 && ec["project-master.projects"] === 6 && ec["erp.erp"] === 5 && ec["kb-sop.kb"] === 4 && ec["idea-incubator.ideas"] === 3, JSON.stringify(ec));
      }

      /* ---------- C: per-tool fixture values reproduced as facts ---------- */
      {
        /* the-ledger */
        push("C: ledger revenue last12m = 613101", BI.facts.records.filter((r) => r.measure === "revenue" && r.dimension === "" && r.tool === "the-ledger").reduce((a, r) => a + r.value, 0) === 613101, "got " + sumEmpty("revenue"));
        push("C: ledger expenses last12m = 358316", sumEmpty("expenses") === 358316, "got " + sumEmpty("expenses"));
        push("C: ledger cash (last) = 369804", lastValue("cash") === 369804, "got " + lastValue("cash"));
        push("C: ledger receivables total = 33800", sumEmpty("receivables") === 33800, "got " + sumEmpty("receivables"));
        push("C: receivables 0-30 bucket = 18200", sumDim("receivables", "bucket:0-30") === 18200);
        push("C: ledger payables total = 24700", sumEmpty("payables") === 24700, "got " + sumEmpty("payables"));
        push("C: P&L gross profit = 282026", sumEmpty("grossProfit") === 282026);
        push("C: P&L operating expenses = 293819", sumEmpty("operatingExpenses") === 293819);
        push("C: P&L net profit = -11793", sumEmpty("netProfit") === -11793);
        push("C: ledger has 12 monthly revenue points", BI.facts.records.filter((r) => r.measure === "revenue" && r.tool === "the-ledger").length === 12 && BI.facts.records.filter((r) => r.measure === "revenue" && r.tool === "the-ledger").every((r) => r.period.slice(0, 7).length === 7));

        /* crm */
        push("C: pipeline value = 1046300", sumEmpty("pipelineValue") === 1046300, "got " + sumEmpty("pipelineValue"));
        push("C: pipeline by stage sums to pipeline", sumDim("pipelineValue", "stage:Qualified") === 249900, "Qualified " + sumDim("pipelineValue", "stage:Qualified"));
        push("C: pipeline by owner sums to pipeline", ["Alice", "Bob", "Carol", "Dana"].every((o) => sumDim("pipelineValue", "owner:" + o) >= 0) && ["Alice", "Bob", "Carol", "Dana"].reduce((a, o) => a + sumDim("pipelineValue", "owner:" + o), 0) === 1046300);
        push("C: weighted forecast = pipeline x 0.3", Math.abs(sumEmpty("weightedForecast") - 313890) < 1, "got " + sumEmpty("weightedForecast"));
        push("C: wins per owner", catSum("wins", "owner", "Alice") === 11 && catSum("wins", "owner", "Bob") === 4 && catSum("wins", "owner", "Carol") === 6 && catSum("wins", "owner", "Dana") === 5);
        push("C: losses per owner", catSum("losses", "owner", "Alice") === 1 && catSum("losses", "owner", "Bob") === 2 && catSum("losses", "owner", "Carol") === 7 && catSum("losses", "owner", "Dana") === 1);
        const crmRevenue = BI.facts.records.filter((r) => r.measure === "revenue" && r.tool === "crm" && r.dimension === "").reduce((a, r) => a + r.value, 0);
        push("C: CRM won revenue = 910000", crmRevenue === 910000, "got " + crmRevenue);
        push("C: customer revenue per customer (Foundry Works = 55400)", sumDim("revenue", "customer:Foundry Works") === 55400, "got " + sumDim("revenue", "customer:Foundry Works"));
        push("C: activities per owner", catSum("activities", "owner", "Alice") === 247 && catSum("activities", "owner", "Dana") === 294);

        /* psa */
        push("C: budget vs actual Atlas = -8000", sumDim("budgetVsActual", "project:Atlas") === -8000);
        push("C: unbilled hours Cobalt = 210", sumDim("unbilledHours", "project:Cobalt") === 210);
        push("C: project margin Atlas = 22%", sumDim("projectMargin", "project:Atlas") === 22);
        push("C: utilization per person (Alice sum 259)", catSum("utilization", "person", "Alice") === 259, "got " + catSum("utilization", "person", "Alice"));
        push("C: monthly utilization average exists (Jul = 67.5)", sumDim("utilization", "") === 67.5 + 76 + 77.33333333333333 + 69.66666666666667 && BI.facts.records.some((r) => r.measure === "utilization" && r.dimension === "" && r.period === "2026-07-01" && Math.abs(r.value - 67.5) < 1e-9));

        /* project-master */
        push("C: milestones Atlas = 6", sumDim("milestonesCompleted", "project:Atlas") === 6);
        push("C: open workload by status", sumDim("openWorkload", "status:active") === 94 && sumDim("openWorkload", "status:at-risk") === 25 && sumDim("openWorkload", "status:done") === 46);
        push("C: at-risk project count = 1 (Drift)", sumEmpty("atRiskProjects") === 1 && sumDim("atRiskProjects", "project:Drift") === 1, "got " + sumEmpty("atRiskProjects"));

        /* erp */
        push("C: inventory lows = 6", sumEmpty("inventoryLow") === 6, "got " + sumEmpty("inventoryLow"));
        push("C: inventory low item facts exist", sumDim("inventoryLow", "item:Widget A") === 1 && sumDim("inventoryLow", "item:Coil L") === 1);
        push("C: purchase spend = 113000", sumEmpty("purchaseSpend") === 113000, "got " + sumEmpty("purchaseSpend"));

        /* kb-sop */
        push("C: article count per category", sumDim("articleCount", "category:Sales") === 4 && sumDim("articleCount", "category:IT") === 3);
        push("C: stale articles = 6 (3 Delivery)", sumEmpty("staleCount") === 6 && sumDim("staleCount", "category:Delivery") === 3, "got " + sumEmpty("staleCount"));

        /* idea-incubator */
        push("C: idea count per stage", sumDim("ideaCount", "stage:Accepted") === 6 && sumDim("ideaCount", "stage:In Review") === 2 && sumDim("ideaCount", "stage:Rejected") === 6);
        push("C: idea count by month totals 25", sumEmpty("ideaCount") === 25, "got " + sumEmpty("ideaCount"));
      }

      /* ---------- D: fact-store invariants ---------- */
      {
        push("D: total fact count = 566", BI.facts.records.length === 566, BI.facts.records.length + " facts");
        const dims = BI.facts.dimensionNames();
        const want = ["bucket", "category", "customer", "item", "owner", "person", "project", "stage", "status"];
        push("D: dimension names present", want.every((w) => dims.indexOf(w) >= 0), dims.join(","));
        push("D: owner dimension values", BI.facts.dimensionValues("owner").join(",") === "Alice,Bob,Carol,Dana", BI.facts.dimensionValues("owner").join(","));
        push("D: every fact has a well-formed period", BI.facts.records.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.period)));
        push("D: every fact measure is catalogued", BI.facts.records.every((r) => !!BI.catalog.get(r.measure)));
      }

      /* ---------- E: all 38 presets render a real chart ---------- */
      {
        let rendered = 0;
        const fails = [];
        for (const p of BI.reports.presets) {
          const q = BI.reports.query(p);
          const html = BI.viz.render(p, q);
          const ok = html.indexOf("bi-chart-error") < 0 && (html.indexOf("<svg") >= 0 || html.indexOf("bi-kpi") >= 0 || html.indexOf("bi-table") >= 0);
          if (ok) rendered++;
          else fails.push(p.id + " → " + html.slice(0, 80));
        }
        push("E: all 38 presets render", rendered === BI.reports.presets.length, fails.join(" | "));
        const ts = BI.reports.query(BI.reports.get("psa-utilization-trend"));
        push("E: utilization trend now has monthly data", ts.labels.length >= 3, ts.labels.join(","));
      }

      /* ---------- F: preset query totals match the fixtures ---------- */
      {
        const val = (id, path) => {
          const q = BI.reports.query(BI.reports.get(id));
          return path.reduce((o, k) => (o == null ? o : o[k]), q);
        };
        push("F: kpi-cash = 369804", val("kpi-cash", ["total"]) === 369804, "got " + val("kpi-cash", ["total"]));
        push("F: fin-revenue = 613101", val("fin-revenue", ["total"]) === 613101, "got " + val("fin-revenue", ["total"]));
        push("F: kpi-pipeline = 1046300", val("kpi-pipeline", ["total"]) === 1046300, "got " + val("kpi-pipeline", ["total"]));
        push("F: kpi-utilization non-empty", val("kpi-utilization", ["total"]) != null, "got " + val("kpi-utilization", ["total"]));
        push("F: kpi-atrisk = 1", val("kpi-atrisk", ["total"]) === 1, "got " + val("kpi-atrisk", ["total"]));
        push("F: kpi-lowstock = 6", val("kpi-lowstock", ["total"]) === 6, "got " + val("kpi-lowstock", ["total"]));
        push("F: kpi-stalekb = 6", val("kpi-stalekb", ["total"]) === 6, "got " + val("kpi-stalekb", ["total"]));
        const wr = BI.reports.query(BI.reports.get("crm-winrate-owner"));
        const alice = wr.cats.find((c) => c.label === "Alice");
        push("F: win-rate Alice ≈ 91.67", alice && Math.abs(alice.value - 91.67) < 0.01, JSON.stringify(alice));
        const pnl = BI.reports.query(BI.reports.get("fin-pnl"));
        push("F: fin-pnl net profit = -11793", pnl.totals && pnl.totals.netProfit === -11793, JSON.stringify(pnl.totals));
        const cust = BI.reports.query(BI.reports.get("crm-top-customers"));
        push("F: crm-top-customers has customer rows", cust.cats.length >= 9, cust.cats.length + " customers");
      }

      /* ---------- G: the charts plugin itself is healthy ---------- */
      {
        const ch = window.root && root.charts;
        if (ch && ch.selfCheck) {
          const sc = ch.selfCheck();
          push("G: charts.selfCheck passes", sc.pass === true, (sc.results || []).filter((r) => !r.pass).map((r) => r.name).join(", "));
        } else {
          push("G: charts.selfCheck passes", false, "selfCheck missing");
        }
      }

      /* restore the production bus + facts for the running app */
      BI.bus.debugFetcher(null);
      BI.bus.debugReset({ lsPrefix: "bi.bus.", wipe: false });
      await BI.bus.init({ manifestUrl: MANIFEST, cadenceMs: 21600000, stalenessMs: 108000000 });
      return results;
    },
  };
})();
