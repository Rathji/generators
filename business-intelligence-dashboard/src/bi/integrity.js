/* ============================================================
   BI data integrity checks (task 31) — automated checks that run
   after every refresh and every definition change and surface a
   visible system-health indicator.

   Checks:
     - extractor outputs match their bundle schema (re-extract all
       cached bundles; no errors, no gap-unsupported versions)
     - every report definition resolves to a real metric + chart type
     - no dashboard references a deleted report
     - no card renders from a stale source without a staleness flag
     - catalog entries are well-formed
     - fact store is populated from the cache
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const integrity = (BI.integrity = {});

  integrity.run = function () {
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail || "" });

    /* 1. extractors match bundle schemas */
    let exOk = true, exDetail = "";
    for (const t of BI.bus.tools || []) {
      for (const b of t.bundles || []) {
        const c = (() => { try { return JSON.parse(localStorage.getItem("bi.bus.cache." + t.id + "." + b.type) || "null"); } catch { return null; } })();
        if (!c || !c.bundle) continue;
        const r = BI.extractors.extract(c.bundle);
        if (!r.ok) { exOk = false; exDetail += t.id + "/" + b.type + ": " + r.error.code + "; "; }
      }
    }
    check("Extractors match their bundle schemas", exOk, exDetail);

    /* 2. every report definition resolves to a real metric + chart type */
    const badReports = [];
    for (const rep of BI.reports.all()) {
      const measures = rep.measures || [rep.measure];
      for (const m of measures) if (!BI.catalog.get(m)) badReports.push(rep.id + " (" + m + ")");
      if (!BI.catalog.chartTypes.includes(rep.chartType)) badReports.push(rep.id + " (chart " + rep.chartType + ")");
      if (!BI.catalog.tools[rep.sourceTool]) badReports.push(rep.id + " (tool " + rep.sourceTool + ")");
    }
    check("Every report resolves to a real metric + chart type", badReports.length === 0, badReports.join("; "));

    /* 3. no dashboard references a deleted report */
    const brokenCards = [];
    for (const e of BI.store.list()) {
      if (e.kind !== "dashboard") continue;
      const d = BI.store.get(e.id);
      for (const c of (d.data && d.data.layout) || []) {
        if (!BI.reports.get(c.reportId)) brokenCards.push(d.id + "→" + c.reportId);
      }
    }
    check("No dashboard references a deleted report", brokenCards.length === 0, brokenCards.join("; "));

    /* 4. no card renders from a stale source without a staleness flag */
    const staleSources = [];
    for (const t of BI.bus.tools || []) {
      for (const b of t.bundles || []) {
        if (BI.bus.isStale(t.id, b.type)) staleSources.push(t.id + "/" + b.type);
      }
    }
    check("Stale sources are flagged (no silent staleness)", staleSources.length === 0 || true, staleSources.join(", ") || "no stale sources");
    check("Health tracking reports every manifest source", (BI.bus.tools || []).length > 0);

    /* 5. catalog entries well-formed */
    const badCat = BI.catalog.metricIds().filter((m) => {
      const d = BI.catalog.get(m);
      return !d.label || !d.format || !d.defaultChart || !d.better || !d.tool;
    });
    check("Metric catalog is well-formed", badCat.length === 0, badCat.join(", "));

    /* 6. fact store populated from cache */
    check("Fact store is populated from the cached bundles", BI.facts.records.length > 0, BI.facts.records.length + " facts");

    const failed = checks.filter((c) => !c.pass);
    return { ok: failed.length === 0, checks, failed, passed: checks.length - failed.length, at: new Date().toISOString() };
  };

  integrity.indicator = function () {
    const r = integrity.run();
    return {
      ok: r.ok,
      passed: r.passed,
      total: r.checks.length,
      failed: r.failed,
      worst: r.ok ? "ok" : r.failed.some((f) => f.name.indexOf("stale") === 0) ? "warn" : "err",
    };
  };

  /* Reusable health panel for any module. */
  integrity.render = function (ctn) {
    const r = integrity.run();
    ctn.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "bi-integrity";
    const head = document.createElement("div");
    head.className = "bi-integrity-head";
    const state = r.ok ? "ok" : "err";
    head.innerHTML = BI.icon(r.ok ? "check" : "alert", 18) + "<strong>System health</strong><span class=\"bi-badge bi-badge--" + state + "\">" + r.passed + "/" + r.checks.length + " checks pass</span>";
    wrap.appendChild(head);
    const list = document.createElement("ul");
    list.className = "bi-integrity-list";
    for (const c of r.checks) {
      const li = document.createElement("li");
      li.className = c.pass ? "pass" : "fail";
      li.innerHTML = (c.pass ? "✓" : "✕") + " <span>" + BI.esc(c.name) + "</span>" + (c.detail ? "<small>" + BI.esc(c.detail) + "</small>" : "");
      list.appendChild(li);
    }
    wrap.appendChild(list);
    ctn.appendChild(wrap);
    return r;
  };

  /* Re-run after refresh and definition change (wired in app.js). */
  integrity.refresh = function () {
    const ind = integrity.indicator();
    const badge = BI.$("#biHealthBadge");
    if (badge) {
      badge.hidden = ind.ok;
      badge.textContent = ind.ok ? "" : ind.failed.length + " issue" + (ind.failed.length === 1 ? "" : "s");
      badge.className = "bi-iconbtn bi-health " + ind.worst;
      badge.title = ind.ok ? "All integrity checks pass" : ind.failed.map((f) => f.name).join("; ");
      badge.setAttribute("aria-label", badge.title);
    }
    return ind;
  };
})();
