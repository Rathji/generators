/* ============================================================
   Module: Reports — list presets + saved report definitions,
   build/edit reports (metric, dimension, period grouping, date
   range, filters, chart type), preview the full card with
   drill-down, export CSV (task 27), copy embed snippets (task 30),
   save-as-template (task 26) and duplicate dashboards.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const state = { detail: null, q: "" };

  function reportList(q) {
    let all = BI.reports.all();
    if (q) {
      const s = q.toLowerCase();
      all = all.filter((r) => (r.name || "").toLowerCase().indexOf(s) >= 0 || (r.id || "").toLowerCase().indexOf(s) >= 0);
    }
    return all;
  }

  BI.register({
    id: "reports",
    async load(ctx) {
      if (state.detail && !BI.reports.get(state.detail)) state.detail = null;
      return { reports: reportList(state.q), q: state.q, detail: state.detail ? BI.reports.get(state.detail) : null, templates: BI.reports.templates() };
    },

  });

  function render(ctx, data) {
    const el = ctx.el;
      el.innerHTML = "";
      const canEdit = BI.realtime.can("create_report");
      el.appendChild(BI.ui.pageHead({
        title: "Reports",
        description: "Reusable report definitions — chosen metric, dimension, filters and date range — shared across dashboards, exports and embeds.",
        actions: canEdit ? [{ label: "New report", kind: "primary", onClick: () => openForm(ctx, null) }] : [],
      }));

      const body = document.createElement("div");
      body.className = "bi-module-body";

      if (data.detail) {
        body.appendChild(renderDetail(ctx, data.detail));
        el.appendChild(body);
        return;
      }

      const search = BI.ui.textInput(data.q, "Search reports…");
      search.className = "bi-input bi-input--search";
      search.addEventListener("input", async () => { state.q = search.value; render(ctx, await ctx.module.load(ctx)); });
      body.appendChild(search);

      if (!data.reports.length) {
        body.appendChild(BI.ui.state({
          type: "empty",
          title: "No reports match",
          message: data.q ? "Try a different search." : "Built-in presets plus every report you save will appear here.",
        }));
      } else {
        const list = document.createElement("div");
        list.className = "bi-report-list";
        for (const rep of data.reports) {
          const tool = BI.catalog.tool(rep.sourceTool);
          const row = document.createElement("div");
          row.className = "bi-report-row";
          const main = document.createElement("div");
          main.className = "bi-report-main";
          main.innerHTML = "<strong>" + BI.esc(rep.name) + "</strong><small>" + BI.esc(rep.id) + (rep.saved ? " · saved" : rep.preset ? " · preset" : "") + "</small>";
          row.appendChild(main);
          const badges = document.createElement("div");
          badges.className = "bi-report-badges";
          badges.appendChild(BI.ui.badge(tool.name));
          badges.appendChild(BI.ui.badge(rep.chartType || "auto", "ok"));
          if (rep.dimension) badges.appendChild(BI.ui.badge("by " + rep.dimension));
          row.appendChild(badges);
          const acts = document.createElement("div");
          acts.className = "bi-report-acts";
          const open = document.createElement("button");
          open.type = "button"; open.className = "bi-btn bi-btn-ghost bi-btn--sm"; open.textContent = "Open";
          open.addEventListener("click", async () => { state.detail = rep.id; render(ctx, await ctx.module.load(ctx)); });
          acts.appendChild(open);
          if (canEdit) {
            const edit = document.createElement("button");
            edit.type = "button"; edit.className = "bi-iconbtn bi-iconbtn--sm"; edit.innerHTML = BI.icon("edit", 14); edit.title = "Edit";
            edit.addEventListener("click", () => { state.detail = rep.id; openForm(ctx, rep); });
            acts.appendChild(edit);
            if (rep.saved) {
              const del = document.createElement("button");
              del.type = "button"; del.className = "bi-iconbtn bi-iconbtn--sm danger"; del.innerHTML = BI.icon("trash", 14); del.title = "Delete";
              del.addEventListener("click", () => BI.ui.confirm({ title: "Delete report", message: "Delete '" + rep.name + "'?", confirmLabel: "Delete", danger: true }, async (yes) => {
                if (!yes) return;
                const res = await BI.store.remove(rep.id);
                if (res.ok) { BI.ui.toast("Report deleted", "success"); render(ctx, await ctx.module.load(ctx)); if (BI.integrity) BI.integrity.refresh(); }
              }));
              acts.appendChild(del);
            }
          }
          row.appendChild(acts);
          list.appendChild(row);
        }
        body.appendChild(list);
      }

      el.appendChild(body);
  }

  BI.modules.reports.render = render;

  /* ---------- full-card detail view ---------- */
  function renderDetail(ctx, rep) {
    const wrap = document.createElement("div");
    wrap.className = "bi-module-body";
    const toolBar = document.createElement("div");
    toolBar.className = "bi-detail-bar";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "bi-btn bi-btn-ghost bi-btn--sm";
    back.textContent = "← All reports";
    back.addEventListener("click", async () => { state.detail = null; render(ctx, await ctx.module.load(ctx)); });
    toolBar.appendChild(back);
    const acts = document.createElement("div");
    acts.className = "bi-detail-acts";
    const csv = document.createElement("button");
    csv.type = "button"; csv.className = "bi-btn bi-btn-ghost bi-btn--sm"; csv.textContent = "Export CSV";
    csv.addEventListener("click", () => BI.reports.downloadCSV(rep));
    acts.appendChild(csv);
    const embed = document.createElement("button");
    embed.type = "button"; embed.className = "bi-btn bi-btn-ghost bi-btn--sm"; embed.textContent = "Copy embed";
    embed.addEventListener("click", () => {
      const snip = BI.embed.snippet(rep.id, { width: "100%", height: 360 });
      const ta = document.createElement("textarea"); ta.value = snip; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) { /* noop */ }
      ta.remove(); BI.ui.toast("Embed snippet copied");
    });
    acts.appendChild(embed);
    const tpl = document.createElement("button");
    tpl.type = "button"; tpl.className = "bi-btn bi-btn-ghost bi-btn--sm"; tpl.textContent = "Save as template";
    tpl.addEventListener("click", async () => { await BI.reports.saveTemplate(rep); BI.ui.toast("Template saved", "success"); });
    acts.appendChild(tpl);
    if (BI.realtime.can("edit_dashboard")) {
      const addTo = document.createElement("button");
      addTo.type = "button"; addTo.className = "bi-btn bi-btn-ghost bi-btn--sm"; addTo.textContent = "Add to dashboard";
      addTo.addEventListener("click", () => pickDashboard(ctx, rep));
      acts.appendChild(addTo);
    }
    toolBar.appendChild(acts);
    wrap.appendChild(toolBar);

    const cardCtn = document.createElement("div");
    wrap.appendChild(cardCtn);
    const trail = [];
    const renderCard = (overrides, t) => {
      cardCtn.innerHTML = "";
      cardCtn.appendChild(BI.cards.card({
        report: rep,
        overrides: overrides || {},
        cardTitle: rep.name,
        trail: t || [],
        onBack: () => renderCard(null, []),
        onDrill: (label, o) => renderCard(o, (t || []).concat(label)),
        actions: [],
      }));
    };
    renderCard(null, []);
    return wrap;
  }

  function pickDashboard(ctx, rep) {
    const dbs = BI.store.list().filter((e) => e.kind === "dashboard");
    if (!dbs.length) { BI.ui.toast("No dashboards yet — build one first", "warn"); return; }
    const sel = BI.ui.select(dbs.map((d) => ({ value: d.id, label: d.label || d.id })));
    const bodyEl = document.createElement("div");
    bodyEl.appendChild(BI.ui.field("Add to dashboard", sel));
    BI.ui.modal({
      title: "Add '" + rep.name + "' to a dashboard",
      bodyEl,
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (e, close) => close() },
        {
          label: "Add card", kind: "primary", onClick: async (e, close) => {
            const doc = BI.store.get(sel.value);
            if (!doc) { close(); return; }
            const cards = (doc.data && doc.data.cards) || [];
            cards.push({ id: "c-" + Math.random().toString(36).slice(2, 8), reportId: rep.id, chartType: null, width: "half" });
            const res = await BI.store.update(doc.id, { name: doc.data.name, cards }, { label: doc.label });
            if (res.ok) { BI.ui.toast("Added to " + doc.label, "success"); if (BI.realtime && BI.realtime.announceDoc) BI.realtime.announceDoc({ id: doc.id, kind: "dashboard", version: res.envelope && res.envelope.version }); }
            else BI.ui.toast((res.error && res.error.message) || "Could not update", "error");
            close();
          },
        },
      ],
    });
  }

  /* ---------- create / edit form ---------- */
  function openForm(ctx, rep) {
    const editing = !!rep && !!rep.saved;
    const measures = BI.catalog.metricIds().map((m) => ({ value: m, label: BI.catalog.get(m).label + " (" + m + ")" }));
    const dims = BI.facts.dimensionNames();
    const primarySel = BI.ui.select(measures, rep && rep.measure ? rep.measure : (rep && rep.measures && rep.measures[0]) || "revenue");
    const secondarySel = BI.ui.select([{ value: "", label: "(none)" }, ...measures], (rep && rep.measures && rep.measures[1]) || "");
    const dimSel = BI.ui.select([{ value: "", label: "(none — group over time)" }, ...dims.map((d) => ({ value: d, label: d }))], rep && rep.dimension ? rep.dimension : "");
    const groupSel = BI.ui.select(BI.catalog.periodGroupings.map((g) => ({ value: g, label: g })), (rep && rep.periodGrouping) || "month");
    const rangeSel = BI.ui.select(BI.catalog.dateRanges.map((r) => ({ value: r, label: r })), (rep && rep.dateRange && rep.dateRange.type) || "all");
    const chartSel = BI.ui.select([{ value: "", label: "auto" }, ...BI.catalog.chartTypes.map((c) => ({ value: c, label: c })), { value: "table", label: "table" }], (rep && rep.chartType) || "");
    const cmpCb = BI.ui.checkbox("Compare vs previous period", rep ? rep.comparePrevious !== false : true);
    const nameInput = BI.ui.textInput(rep && rep.name ? rep.name : "", "Report name");

    const filtersCtn = document.createElement("div");
    filtersCtn.className = "bi-builder-list";
    const filters = (rep && rep.filters) ? rep.filters.map((f) => Object.assign({}, f)) : [];

    function refreshFilters() {
      filtersCtn.innerHTML = "";
      if (!filters.length) {
        filtersCtn.appendChild(BI.ui.state({ type: "empty", title: "No filters", message: "Filters narrow a report to specific dimension values (project, owner, category…)." }));
        return;
      }
      filters.forEach((f, i) => {
        const row = document.createElement("div");
        row.className = "bi-builder-row";
        const dSel = BI.ui.select(dims.map((d) => ({ value: d, label: d })), f.name);
        const vSel = BI.ui.select(BI.facts.dimensionValues(f.name).map((v) => ({ value: v, label: v })), f.value != null ? f.value : "");
        dSel.addEventListener("change", () => { f.name = dSel.value; f.value = null; refreshFilters(); });
        const rm = document.createElement("button");
        rm.type = "button"; rm.className = "bi-iconbtn bi-iconbtn--sm danger"; rm.innerHTML = BI.icon("trash", 14); rm.title = "Remove filter";
        rm.addEventListener("click", () => { filters.splice(i, 1); refreshFilters(); });
        row.appendChild(dSel); row.appendChild(vSel); row.appendChild(rm);
        filtersCtn.appendChild(row);
      });
    }
    const addF = document.createElement("button");
    addF.type = "button"; addF.className = "bi-btn bi-btn-ghost bi-btn--sm"; addF.textContent = "+ Add filter";
    addF.addEventListener("click", () => { filters.push({ field: "dimension", name: dims[0] || "", value: null }); refreshFilters(); });

    const bodyEl = document.createElement("div");
    bodyEl.appendChild(BI.ui.field("Name", nameInput));
    bodyEl.appendChild(BI.ui.field("Primary metric", primarySel));
    bodyEl.appendChild(BI.ui.field("Secondary metric (multi-series)", secondarySel));
    bodyEl.appendChild(BI.ui.field("Group by dimension", dimSel));
    bodyEl.appendChild(BI.ui.field("Period grouping", groupSel));
    bodyEl.appendChild(BI.ui.field("Date range", rangeSel));
    bodyEl.appendChild(BI.ui.field("Chart type", chartSel));
    bodyEl.appendChild(cmpCb);
    bodyEl.appendChild(BI.ui.field("Filters", addF));
    bodyEl.appendChild(filtersCtn);
    refreshFilters();

    const collect = () => {
      const m2 = secondarySel.value;
      return {
        name: nameInput.value.trim() || "Untitled report",
        measure: m2 ? undefined : primarySel.value,
        measures: m2 ? [primarySel.value, m2] : undefined,
        dimension: dimSel.value || null,
        periodGrouping: groupSel.value,
        dateRange: { type: rangeSel.value },
        chartType: chartSel.value || null,
        comparePrevious: cmpCb._cb.checked,
        filters: filters.filter((f) => f.name),
        sourceTool: BI.catalog.get(primarySel.value).tool,
      };
    };

    BI.ui.modal({
      title: editing ? "Edit report" : "New report",
      bodyEl,
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (e, close) => close() },
        { label: "Save as template", kind: "ghost", onClick: async (e, close) => { const r = collect(); await BI.reports.saveTemplate(r); BI.ui.toast("Template saved", "success"); close(); } },
        {
          label: editing ? "Save changes" : "Save report", kind: "primary", onClick: async (e, close) => {
            const r = collect();
            let res;
            if (editing) {
              res = await BI.store.update(rep.id, r, { label: r.name });
            } else {
              const id = "rpt-" + r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "rpt-" + Date.now().toString(36);
              res = BI.store.exists(id)
                ? await BI.store.update(id, r, { label: r.name })
                : await BI.store.create({ id, kind: "report", label: r.name, data: r });
            }
            if (res.ok) {
              BI.ui.toast("Report saved", "success");
              if (BI.realtime && BI.realtime.announceDoc) BI.realtime.announceDoc({ id: res.envelope && res.envelope.id, kind: "report", version: res.envelope && res.envelope.version });
              state.detail = res.envelope && res.envelope.id;
              close();
              render(ctx, await ctx.module.load(ctx));
              if (BI.integrity) BI.integrity.refresh();
            } else {
              BI.ui.toast((res.error && res.error.message) || "Could not save", "error");
            }
          },
        },
      ],
    });
  }
})();
