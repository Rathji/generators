/* ============================================================
   BI report card renderer — shared by the dashboards module,
   the Reports module previews and the embed route. Builds a
   complete card element: header (report name, source tool badge,
   staleness badge, actions), chart/KPI/table body, drill chips
   (task 20) and a breadcrumb trail back to the top level.

   Staleness: if the report's source tool is stale, the card
   always shows a staleness badge (integrity check 4 relies on
   this — no card renders stale data silently).
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const cards = (BI.cards = {});

  /* staleness info for a report: {stale, toolName, bundles:[{type,status}]} */
  cards.staleness = function (report) {
    const toolId = report.sourceTool;
    const tool = (BI.bus.tools || []).find((t) => t.id === toolId);
    if (!tool) return { known: false };
    const bundles = (tool.bundles || []).map((b) => ({ type: b.type, status: BI.bus.healthOf(toolId, b.type).status, stale: BI.bus.isStale(toolId, b.type) }));
    const stale = bundles.some((b) => b.stale);
    return { known: true, stale, toolId, toolName: tool.name, bundles };
  };

  /* Build a complete card element. opts:
       report, overrides, cardTitle, chartType, trail:[labels],
       onDrill(label, overrides), actions:[{label,onClick}], menu:true */
  cards.card = function (opts) {
    const report = opts.report;
    const el = document.createElement("div");
    el.className = "bi-card bi-report-card" + (opts.className ? " " + opts.className : "");

    const q = BI.reports.query(report, opts.overrides);
    const cat = BI.catalog;
    const primary = Array.isArray(report.measures) ? report.measures[0] : report.measure;
    const metric = cat.get(primary);

    /* header */
    const head = document.createElement("div");
    head.className = "bi-card-h";
    const titleWrap = document.createElement("div");
    titleWrap.className = "bi-card-title-wrap";
    const t = document.createElement("div");
    t.className = "bi-card-title";
    t.textContent = opts.cardTitle || report.name || report.id;
    titleWrap.appendChild(t);
    const meta = document.createElement("div");
    meta.className = "bi-card-meta";
    const toolName = BI.catalog.tool(report.sourceTool).name;
    meta.appendChild(BI.ui.badge(toolName));
    if (metric) meta.appendChild(BI.ui.badge(metric.label, "ok"));
    const staleness = cards.staleness(report);
    if (staleness.known && staleness.stale) {
      const sb = BI.ui.badge("stale data", "warn");
      sb.title = "This source hasn't published fresh data in a while.";
      meta.appendChild(sb);
    }
    titleWrap.appendChild(meta);
    head.appendChild(titleWrap);

    /* breadcrumb trail */
    if (opts.trail && opts.trail.length) {
      const cr = document.createElement("div");
      cr.className = "bi-card-trail";
      const back = document.createElement("button");
      back.type = "button";
      back.className = "bi-chip bi-chip--back";
      back.textContent = "← " + opts.trail[opts.trail.length - 1];
      back.addEventListener("click", () => opts.onBack && opts.onBack());
      cr.appendChild(back);
      head.appendChild(cr);
    }

    if (opts.actions && opts.actions.length) {
      const acts = document.createElement("div");
      acts.className = "bi-card-actions";
      for (const a of opts.actions) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bi-iconbtn bi-iconbtn--sm" + (a.kind === "danger" ? " danger" : "");
        b.innerHTML = BI.icon(a.icon || "edit", 15);
        b.title = a.label;
        b.setAttribute("aria-label", a.label);
        b.addEventListener("click", () => a.onClick && a.onClick());
        acts.appendChild(b);
      }
      head.appendChild(acts);
    }
    el.appendChild(head);

    /* body */
    const body = document.createElement("div");
    body.className = "bi-card-b";
    if (!q.records.length && !q.total && !(q.cats && q.cats.length) && !(q.series && q.series.labels && q.series.labels.length)) {
      body.appendChild(BI.ui.state({ type: "empty", title: "No data in range", message: BI.errors.describe("no_data").text }));
    } else {
      const html = BI.viz.render(report, q, { cardTitle: opts.cardTitle || report.name, chartType: opts.chartType });
      const htmlWrap = document.createElement("div");
      htmlWrap.innerHTML = html;
      body.appendChild(htmlWrap);
    }
    el.appendChild(body);

    /* drill chips */
    const chips = BI.viz.drillChips(report, q);
    if (chips.length && opts.onDrill) {
      const chipRow = document.createElement("div");
      chipRow.className = "bi-chip-row";
      const lbl = document.createElement("span");
      lbl.className = "bi-chip-label";
      lbl.textContent = "Drill";
      chipRow.appendChild(lbl);
      for (const c of chips) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bi-chip";
        b.textContent = c.label;
        b.addEventListener("click", () => opts.onDrill(c.label, c.overrides));
        chipRow.appendChild(b);
      }
      body.appendChild(chipRow);
    }

    return el;
  };
})();
