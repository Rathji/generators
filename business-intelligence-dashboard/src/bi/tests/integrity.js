/* ============================================================
   BI validation tests — roadmap task 31 (data integrity).
   Run via: await BI.runTests("integrity")  (page_eval harness).

   Validated:
     - all seven checks pass on the real fixture cache + facts
     - the fact-store check fails when the store is empty
     - a report referencing an unknown metric is flagged
     - indicator() maps results to ok/err with counts
     - render() builds the health panel; refresh() drives the badge
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const S = BI.store;

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

  BI.tests.integrity = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });

      if (BI.facts.records.length === 0) {
        await BI.bus.init({ manifestUrl: "src/bi/fixtures/manifest.json", cadenceMs: 21600000, stalenessMs: 108000000 });
      }

      /* ---------- A: all checks pass on real data ---------- */
      {
        const r = BI.integrity.run();
        push("A: run returns the full check set", r.checks.length === 7, r.checks.length + " checks");
        push("A: all seven checks pass", r.ok && r.failed.length === 0, r.failed.map((f) => f.name).join("; "));
        push("A: every check has a name + pass flag", r.checks.every((c) => c.name && typeof c.pass === "boolean"));
      }

      /* ---------- B: indicator mapping ---------- */
      {
        const ind = BI.integrity.indicator();
        push("B: indicator reports ok + counts", ind.ok === true && ind.passed === 7 && ind.total === 7, JSON.stringify(ind));
        push("B: indicator worst is ok", ind.worst === "ok");
      }

      /* ---------- C: empty fact store fails the population check ---------- */
      {
        const saved = BI.facts.records;
        BI.facts.load([]);
        const r = BI.integrity.run();
        push("C: empty fact store flagged", !r.ok && r.failed.some((f) => f.name.indexOf("Fact store") === 0), r.failed.map((f) => f.name).join("; "));
        const ind = BI.integrity.indicator();
        push("C: indicator reflects the failure", ind.ok === false && ind.passed === 6 && ind.failed.length === 1, JSON.stringify(ind));
        BI.facts.load(saved);
        push("C: facts restored", BI.facts.records.length === saved.length);
      }

      /* ---------- D: unknown-metric report is flagged ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tIT1.", ceilingBytes: 65536 });
        await S.create({ id: "rep-bad", kind: "report", label: "Bad", data: { measure: "not-a-metric", chartType: "timeSeries", sourceTool: "the-ledger", dateRange: { type: "all" } } });
        const r = BI.integrity.run();
        push("D: bad report referenced in check 2", !r.ok && r.failed.some((f) => f.name.indexOf("Every report resolves") === 0), r.failed.map((f) => f.name).join("; "));
        S.init();
      }

      /* ---------- E: render builds the panel ---------- */
      {
        const ctn = document.createElement("div");
        const r = BI.integrity.render(ctn);
        push("E: render returns the run result", r && Array.isArray(r.checks));
        push("E: panel has heading + list", !!ctn.querySelector(".bi-integrity") && !!ctn.querySelector(".bi-integrity-list"));
        push("E: panel lists all checks", ctn.querySelectorAll(".bi-integrity-list li").length === 7);
      }

      /* ---------- F: refresh drives the badge ---------- */
      {
        const saved = BI.facts.records;
        BI.facts.load([]);
        const ind = BI.integrity.refresh();
        const badge = BI.$("#biHealthBadge");
        push("F: refresh returns the indicator", ind.ok === false);
        push("F: badge visible when checks fail", !!badge && !badge.hidden && badge.textContent.length > 0, badge && badge.textContent);
        BI.facts.load(saved);
        BI.integrity.refresh();
        push("F: badge hidden when checks pass", !!badge && badge.hidden);
      }

      return results;
    },
  };
})();
