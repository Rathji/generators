/* ============================================================
   BI validation tests — roadmap tasks 22–30 (reporting: date
   ranges, period comparison, CSV export, saved views, report
   templates, dashboard duplication, and the built-in presets).
   Run via: await BI.runTests("reporting")  (page_eval harness).

   Facts come from the real fixtures (deterministic as-of
   2026-09-30). Store-dependent scenarios (views / templates /
   duplication) run against a FakeBackend under an isolated prefix
   and the app store is re-inited afterwards.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const S = BI.store;
  const R = BI.reports;
  const F = BI.facts;

  function FakeBackend() {
    const files = new Map();
    let seq = 0;
    return {
      async create(name, text) {
        if (files.has(name)) return { error: "exists" };
        const editKey = "fk-" + (++seq).toString(16).padStart(6, "0");
        files.set(name, { text, editKey, editCount: 1 });
        return { editKey, editCount: 1 };
      },
      async update(name, text, editKey) {
        const f = files.get(name);
        if (!f) return { error: "not_found" };
        if (!editKey || editKey !== f.editKey) return { error: "invalid_edit_key" };
        if (f.text === text) return { editCount: f.editCount, superseded: true };
        f.text = text; f.editCount += 1;
        return { editCount: f.editCount, superseded: false };
      },
      async read(name) {
        const f = files.get(name);
        return { text: f ? f.text : null };
      },
    };
  }

  const ANCHOR = "2026-09-30";

  BI.tests.reporting = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });

      /* ensure facts are loaded from the real fixtures */
      if (F.records.length === 0) {
        await BI.bus.init({ manifestUrl: "src/bi/fixtures/manifest.json", cadenceMs: 21600000, stalenessMs: 108000000 });
      }
      push("facts loaded for reporting suite", F.records.length > 0, F.records.length + " facts");

      /* ---------- A: date range bounds ---------- */
      {
        const b = (dr) => R.dateRangeBounds(Object.assign({ anchor: ANCHOR }, dr));
        push("A: last3m window", JSON.stringify(b({ type: "last3m" })) === JSON.stringify({ from: "2026-07-01", to: "2026-09-30" }), JSON.stringify(b({ type: "last3m" })));
        push("A: last6m window", JSON.stringify(b({ type: "last6m" })) === JSON.stringify({ from: "2026-04-01", to: "2026-09-30" }), JSON.stringify(b({ type: "last6m" })));
        push("A: last12m window", JSON.stringify(b({ type: "last12m" })) === JSON.stringify({ from: "2025-10-01", to: "2026-09-30" }), JSON.stringify(b({ type: "last12m" })));
        push("A: thisYear window", JSON.stringify(b({ type: "thisYear" })) === JSON.stringify({ from: "2026-01-01", to: "2026-09-30" }), JSON.stringify(b({ type: "thisYear" })));
        push("A: lastYear window", JSON.stringify(b({ type: "lastYear" })) === JSON.stringify({ from: "2025-01-01", to: "2025-12-31" }), JSON.stringify(b({ type: "lastYear" })));
        push("A: all window is unbounded", JSON.stringify(b({ type: "all" })) === JSON.stringify({ from: null, to: null }), JSON.stringify(b({ type: "all" })));
        push("A: custom window passes through", JSON.stringify(b({ type: "custom", from: "2026-01-05", to: "2026-02-09" })) === JSON.stringify({ from: "2026-01-05", to: "2026-02-09" }));
      }

      /* ---------- B: previous window math ---------- */
      {
        const prev = R.previousBounds({ from: "2026-07-01", to: "2026-09-30" });
        push("B: previous window ends the day before the range", prev.to === "2026-06-30", JSON.stringify(prev));
        const lenA = new Date("2026-09-30T00:00:00Z") - new Date("2026-07-01T00:00:00Z");
        const lenB = new Date(prev.to + "T00:00:00Z") - new Date(prev.from + "T00:00:00Z");
        push("B: previous window has the same length", lenA === lenB && prev.from === "2026-03-31", JSON.stringify(prev));
        push("B: unbounded range has no previous window", R.previousBounds({ from: null, to: null }) === null);
      }

      /* ---------- C: asOf anchors to the latest fixture date ---------- */
      {
        push("C: asOf is the latest published date", R.asOf() === ANCHOR, R.asOf());
      }

      /* ---------- D: report normalization ---------- */
      {
        const n = R.norm({ measure: "cash" });
        push("D: norm fills periodGrouping", n.periodGrouping === "month");
        push("D: norm fills dateRange", JSON.stringify(n.dateRange) === JSON.stringify({ type: "all" }));
        push("D: norm infers sourceTool", n.sourceTool === "the-ledger");
        push("D: norm infers chartType", n.chartType === "timeSeries");
        push("D: norm defaults comparePrevious", n.comparePrevious === true);
        const n2 = R.norm({ measures: ["revenue", "expenses"] });
        push("D: multi-measure norm keeps measures", Array.isArray(n2.measures) && n2.measures.length === 2);
      }

      /* ---------- E: query + compare (deterministic fixture totals) ---------- */
      {
        const rep = R.get("fin-revenue"); /* revenue, month, last12m, timeSeries */
        const q = R.query(rep);
        push("E: revenue last12m total (ledger)", q.total === 613101, "got " + q.total);
        push("E: revenue series has 12 monthly points", q.labels.length === 12 && q.series.series[0].data.length === 12);
        push("E: series labels are months", q.labels[0] === "2025-10" && q.labels[11] === "2026-09", q.labels.join(","));
        push("E: no data in previous 12m window → no comparison", q.comparison.previous === null && q.comparison.pct === null, JSON.stringify(q.comparison));

        const kpi = R.query(R.get("kpi-revenue")); /* revenue last3m kpi */
        push("E: kpi revenue last3m total", kpi.total === 177213, "got " + kpi.total);
        push("E: kpi comparison previous quarter", kpi.comparison.previous === 159786, JSON.stringify(kpi.comparison));
        push("E: kpi delta pct is positive growth", kpi.comparison.pct > 10 && kpi.comparison.pct < 11, "pct " + kpi.comparison.pct);

        const cash = R.query(R.get("kpi-cash")); /* cash last6m, agg last */
        push("E: cash last6m uses last value", cash.total === 369804, "got " + cash.total);

        const pipe = R.query(R.get("kpi-pipeline")); /* all, sum */
        push("E: all-range pipeline is the full portfolio", pipe.total === 1046300, "got " + pipe.total);
        push("E: all-range has no prior-period comparison", pipe.comparison.previous === null, JSON.stringify(pipe.comparison));

        const aging = R.query(R.get("fin-receivables-aging")); /* bucket dimension */
        push("E: receivables aging buckets total 33800", aging.total === 33800, "got " + aging.total);
        const b0 = aging.cats.find((c) => c.label === "0-30");
        push("E: aging bucket 0-30 = 18200", b0 && b0.value === 18200, JSON.stringify(b0));

        const wr = R.query(R.get("crm-winrate-owner"));
        const alice = wr.cats.find((c) => c.label === "Alice");
        push("E: win rate by owner is ratio-correct", alice && Math.abs(alice.value - 91.67) < 0.01, JSON.stringify(wr.cats));

        const util = R.query(R.get("psa-utilization-person"));
        const frank = util.cats.find((c) => c.label === "Frank");
        push("E: utilization averages per person (last3m)", frank && Math.abs(frank.value - 73.6667) < 0.001, "Frank " + (frank && frank.value));

        const pnl = R.query(R.get("fin-pnl"));
        push("E: P&L totals row present", pnl.totals && pnl.totals.revenue != null && pnl.totals.netProfit === -11793, JSON.stringify(pnl.totals));
      }

      /* ---------- F: dimension query never mixes kinds ---------- */
      {
        const q = R.query(R.get("crm-pipeline-owner"));
        push("F: pipeline-by-owner cats are owners", q.cats.map((c) => c.label).sort().join(",") === "Alice,Bob,Carol,Dana");
        const tot = q.cats.reduce((a, c) => a + c.value, 0);
        push("F: owner cats sum to the pipeline total", tot === 1046300, "sum " + tot);
      }

      /* ---------- G: CSV export ---------- */
      {
        const csv = R.toCSV(R.get("fin-expenses"));
        const lines = csv.split("\n");
        push("G: CSV has a header", lines[0] === "tool,bundleType,period,dimension,measure,value");
        push("G: CSV includes data rows", lines.length === 13, lines.length + " lines");
        push("G: CSV row carries a value", /,expenses,\d+\.\d*$/.test(lines[1]) || /,expenses,\d+$/.test(lines[1]), lines[1]);
        const extra = { tool: "the-ledger", bundleType: "ledger", period: "2026-09-30", dimension: 'customer:Weird "Co", Inc', measure: "expenses", value: 1 };
        BI.facts.push(extra);
        try {
          const quoted = R.toCSV({ ...R.get("fin-expenses"), dateRange: { type: "custom", from: "2026-09-30", to: "2026-09-30" } });
          push("G: CSV escapes quotes in values", quoted.indexOf('"customer:Weird ""Co"", Inc"') >= 0, quoted.slice(0, 160));
        } finally {
          BI.facts.records.splice(BI.facts.records.indexOf(extra), 1);
        }
      }

      /* ---------- H: saved views ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tRP1.", ceilingBytes: 65536 });
        await R.saveView({ name: "Q3 view", filters: [{ field: "dimension", name: "stage", value: "Qualified" }], dateRange: { type: "last3m" } });
        const views = R.views();
        push("H: saveView persists a view", views.length === 1 && views[0].data.name === "Q3 view");
        push("H: view carries filters + range", views[0].data.filters.length === 1 && views[0].data.dateRange.type === "last3m");
      }

      /* ---------- I: report templates ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tRP2.", ceilingBytes: 65536 });
        await R.saveTemplate({ name: "Template: rev", measure: "revenue", dateRange: { type: "last3m" }, chartType: "bar" });
        const tpls = R.templates();
        push("I: saveTemplate marks meta.template", tpls.length === 1 && tpls[0].meta.template === true, JSON.stringify(tpls.map((t) => t.meta)));
        const inst = R.instantiate(tpls[0], { filters: [{ field: "tool", value: "the-ledger" }] });
        push("I: instantiate applies overrides", inst.filters.length === 1 && inst.measure === "revenue");
        push("I: non-template reports not listed as templates", R.templates().every((t) => t.meta && t.meta.template));
      }

      /* ---------- J: duplicate dashboard ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tRP3.", ceilingBytes: 65536 });
        await S.create({
          id: "dash-1", kind: "dashboard", label: "Orig",
          data: { name: "Orig", layout: [{ id: "c-111", reportId: "kpi-cash" }, { id: "c-222", reportId: "fin-revenue" }] },
        });
        const dash = S.get("dash-1");
        const r = await R.duplicateDashboard(dash, "Copy");
        push("J: duplicate creates a new dashboard", r.ok && r.envelope.data.name === "Copy" && r.envelope.id !== "dash-1", JSON.stringify(r));
        push("J: duplicate re-ids every card", r.envelope.data.layout.every((c) => c.id !== "c-111" && c.id !== "c-222") && r.envelope.data.layout.length === 2);
        push("J: duplicate keeps report references", r.envelope.data.layout.map((c) => c.reportId).sort().join(",") === "fin-revenue,kpi-cash");
      }

      /* ---------- K: presets are well-formed ---------- */
      {
        const ids = new Set();
        let dup = false;
        for (const p of R.presets) { if (ids.has(p.id)) dup = true; ids.add(p.id); }
        push("K: every preset has a unique id", !dup && R.presets.length === 38, R.presets.length + " presets");
        const bad = R.presets.filter((p) => {
          const ms = p.measures || [p.measure];
          return !ms.every((m) => BI.catalog.get(m)) || !BI.catalog.chartTypes.includes(p.chartType) || !BI.catalog.tools[p.sourceTool];
        });
        push("K: every preset resolves measure+chart+tool", bad.length === 0, bad.map((p) => p.id).join(","));
        const cov = new Set(R.presets.map((p) => p.sourceTool));
        push("K: presets cover all seven tools", [...cov].sort().join(",") === "crm,erp,idea-incubator,kb-sop,project-master,psa,the-ledger", [...cov].join(","));
      }

      /* ---------- L: reports.all() exposes presets + stored docs ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tRP4.", ceilingBytes: 65536 });
        await S.create({ id: "my-rep", kind: "report", label: "Mine", data: { measure: "cash", chartType: "kpi", sourceTool: "the-ledger", dateRange: { type: "all" } } });
        const all = R.all();
        push("L: all() includes presets", all.some((r) => r.preset && r.id === "kpi-cash"));
        push("L: all() includes stored docs", all.some((r) => r.saved && r.id === "my-rep"));
        push("L: get() resolves stored docs", R.get("my-rep") && R.get("my-rep").name === "Mine");
        push("L: get() returns null for unknown", R.get("never-heard-of-it") === null);
      }

      S.init();
      return results;
    },
  };
})();
