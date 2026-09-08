/* ============================================================
   Module: Dashboards — a grid of report cards over the fact
   store. Includes the built-in Executive dashboard (one card per
   source tool), stored dashboards, the dashboard builder, per-card
   drill-down with breadcrumbs, and saved-view filters (task 15).

   A dashboard is a store doc (kind "dashboard"):
     data = { name, cards: [ { id, reportId, chartType, width, overrides } ] }
   "executive" is a built-in preset, not a store doc.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  /* ---------- built-in Executive dashboard (task 21) ---------- */
  const EXECUTIVE = {
    id: "executive",
    name: "Executive",
    builtin: true,
    cards: [
      { id: "c-cash", reportId: "kpi-cash", chartType: "kpi", width: "half" },
      { id: "c-receivables", reportId: "kpi-receivables", chartType: "kpi", width: "half" },
      { id: "c-payables", reportId: "kpi-payables", chartType: "kpi", width: "half" },
      { id: "c-revenue", reportId: "kpi-revenue", chartType: "kpi", width: "half" },
      { id: "c-pipeline", reportId: "kpi-pipeline", chartType: "kpi", width: "half" },
      { id: "c-forecast", reportId: "kpi-forecast", chartType: "kpi", width: "half" },
      { id: "c-utilization", reportId: "kpi-utilization", chartType: "kpi", width: "half" },
      { id: "c-atrisk", reportId: "kpi-atrisk", chartType: "kpi", width: "half" },
      { id: "c-lowstock", reportId: "kpi-lowstock", chartType: "kpi", width: "half" },
      { id: "c-stalekb", reportId: "kpi-stalekb", chartType: "kpi", width: "half" },
      { id: "c-ideas", reportId: "ideas-stage", chartType: "donut", width: "full" },
    ],
  };

  /* ---------- module state (survives re-renders within the module) ---------- */
  const state = {
    current: "executive",
    drill: {},       // cardId -> { overrides, trail: [labels] }
    viewId: null,    // active saved view id
  };

  function allDashboards() {
    const stored = BI.store.list()
      .filter((e) => e.kind === "dashboard")
      .map((e) => BI.store.get(e.id))
      .filter((d) => d)
      .map((d) => ({ id: d.id, name: d.label || d.id, stored: true, doc: d, cards: (d.data && d.data.cards) || [] }));
    return [EXECUTIVE, ...stored];
  }

  function currentDashboard() {
    return allDashboards().find((d) => d.id === state.current) || EXECUTIVE;
  }

  function viewOverrides() {
    if (!state.viewId) return {};
    const v = BI.store.get(state.viewId);
    if (!v || v.kind !== "view") return {};
    return { filters: (v.data && v.data.filters) || [], dateRange: (v.data && v.data.dateRange) || null };
  }

  /* merge card overrides + drill overrides + active saved view */
  function mergedOverrides(card) {
    const base = Object.assign({}, card.overrides || {});
    const drill = state.drill[card.id];
    const view = viewOverrides();
    return Object.assign({}, base, view, drill ? drill.overrides : {});
  }

  function trailOf(card) {
    return state.drill[card.id] ? state.drill[card.id].trail.slice() : [];
  }

  BI.register({
    id: "dashboards",
    async load(ctx) {
      if (!state.current || !allDashboards().some((d) => d.id === state.current)) state.current = EXECUTIVE.id;
      return { dashboards: allDashboards(), current: currentDashboard(), views: BI.reports.views() };
    },

  });

  function render(ctx, data) {
    const el = ctx.el;
      el.innerHTML = "";
      const canEdit = BI.realtime.can("edit_dashboard");
      el.appendChild(BI.ui.pageHead({
        title: "Dashboards",
        description: "Curated grids of report cards. Every number traces back to the tool that owns it — this cockpit never stores source-of-truth data.",
        actions: canEdit ? [{ label: "New dashboard", kind: "primary", onClick: () => openBuilder(ctx) }] : [],
      }));

      const body = document.createElement("div");
      body.className = "bi-module-body";

      /* conflict panel (task 3) — if any two-device edits are waiting */
      const conflictCtn = document.createElement("div");
      body.appendChild(conflictCtn);
      BI.store.ui.renderConflictPanel(conflictCtn, { onResolved: () => render(ctx, data) });

      /* dashboard selector + saved views + refresh-all */
      const bar = document.createElement("div");
      bar.className = "bi-dash-bar";
      const tabs = document.createElement("div");
      tabs.className = "bi-tabs";
      for (const d of data.dashboards) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bi-tab" + (d.id === state.current ? " active" : "");
        b.textContent = d.name;
        b.addEventListener("click", async () => { state.current = d.id; render(ctx, await ctx.module.load(ctx)); });
        tabs.appendChild(b);
        if (d.stored && canEdit) {
          const menu = document.createElement("button");
          menu.type = "button";
          menu.className = "bi-tab-menu";
          menu.title = "Dashboard menu";
          menu.innerHTML = BI.icon("chevron", 14);
          menu.addEventListener("click", (e) => { e.stopPropagation(); openDashboardMenu(ctx, d, data); });
          b.parentNode.insertBefore(menu, b.nextSibling);
        }
      }
      bar.appendChild(tabs);
      const barRight = document.createElement("div");
      barRight.className = "bi-dash-bar-right";
      if (data.views.length) {
        const viewSel = BI.ui.select([{ value: "", label: "Saved view: none" }, ...data.views.map((v) => ({ value: v.id, label: v.data && v.data.name }))], state.viewId || "");
        viewSel.className = "bi-select bi-select--sm";
        viewSel.addEventListener("change", async () => {
          state.viewId = viewSel.value || null;
          render(ctx, await ctx.module.load(ctx));
        });
        barRight.appendChild(viewSel);
      }
      if (data.current.stored && canEdit) {
        const dup = document.createElement("button");
        dup.type = "button";
        dup.className = "bi-btn bi-btn-ghost bi-btn--sm";
        dup.textContent = "Duplicate";
        dup.addEventListener("click", async () => {
          await BI.reports.duplicateDashboard(data.current.doc);
          BI.ui.toast("Dashboard duplicated", "success");
          render(ctx, await ctx.module.load(ctx));
        });
        barRight.appendChild(dup);
      }
      bar.appendChild(barRight);
      body.appendChild(bar);

      /* cards grid */
      if (!data.current.cards.length) {
        body.appendChild(BI.ui.state({
          type: "empty",
          title: "This dashboard is empty",
          message: canEdit ? "Add cards with the builder — pick a report, a chart type, and a width." : "An admin or analyst can add cards to this dashboard.",
          actions: canEdit ? [{ label: "Build dashboard", kind: "primary", onClick: () => openBuilder(ctx) }] : [],
        }));
      } else {
        const grid = document.createElement("div");
        grid.className = "bi-dash-grid";
        const drill = state.drill;
        for (const card of data.current.cards) {
          const report = BI.reports.get(card.reportId);
          const cardEl = document.createElement("div");
          cardEl.className = "bi-dash-cell " + (card.width === "full" ? "bi-dash-cell--full" : "bi-dash-cell--half");
          if (!report) {
            cardEl.appendChild(BI.ui.state({
              type: "error",
              title: "Missing report",
              message: "Card '" + card.reportId + "' no longer resolves to a report. Remove it from the dashboard.",
            }));
          } else {
            const actions = [];
            if (canEdit) {
              actions.push({ label: "Edit card", icon: "edit", onClick: () => openCardMenu(ctx, data.current, card) });
            }
            actions.push({ label: "Export CSV", icon: "download", onClick: () => BI.reports.downloadCSV(report, mergedOverrides(card)) });
            actions.push({ label: "Embed", icon: "link", onClick: () => copyEmbed(report) });
            cardEl.appendChild(BI.cards.card({
              report,
              overrides: mergedOverrides(card),
              cardTitle: card.customTitle || report.name,
              chartType: card.chartType,
              trail: trailOf(card),
              onBack: () => {
                delete drill[card.id];
                render(ctx, data);
              },
              onDrill: (label, overrides) => {
                const d = drill[card.id] || { overrides: {}, trail: [] };
                d.overrides = Object.assign({}, d.overrides, overrides);
                d.trail = d.trail.concat(label);
                drill[card.id] = d;
                render(ctx, data);
              },
              actions,
            }));
          }
          grid.appendChild(cardEl);
        }
        body.appendChild(grid);
      }

      el.appendChild(body);
  }

  BI.modules.dashboards.render = render;

  /* ---------- embed snippet copy ---------- */
  function copyEmbed(report) {
    const snip = BI.embed.snippet(report.id, { width: "100%", height: 360 });
    const ta = document.createElement("textarea");
    ta.value = snip;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* noop */ }
    ta.remove();
    BI.ui.toast("Embed snippet copied");
  }

  /* ---------- builder (task 12) ---------- */
  function openBuilder(ctx) {
    const cards = [];
    const listEl = document.createElement("div");
    listEl.className = "bi-builder-list";
    const nameInput = BI.ui.textInput("", "Dashboard name");

    function refreshList() {
      listEl.innerHTML = "";
      if (!cards.length) {
        listEl.appendChild(BI.ui.state({ type: "empty", title: "No cards yet", message: "Add report cards below." }));
        return;
      }
      cards.forEach((c, i) => {
        const row = document.createElement("div");
        row.className = "bi-builder-row";
        const info = document.createElement("div");
        info.className = "bi-builder-info";
        const rep = BI.reports.get(c.reportId);
        info.innerHTML = "<strong>" + BI.esc(rep ? rep.name : c.reportId) + "</strong><small>" + BI.esc(c.chartType || "auto") + " · " + (c.width === "full" ? "full width" : "half width") + "</small>";
        row.appendChild(info);
        const acts = document.createElement("div");
        acts.className = "bi-builder-acts";
        const up = document.createElement("button");
        up.type = "button"; up.className = "bi-iconbtn bi-iconbtn--sm"; up.innerHTML = BI.icon("back", 14); up.title = "Move up";
        up.addEventListener("click", () => { if (i > 0) { const t = cards[i - 1]; cards[i - 1] = cards[i]; cards[i] = t; refreshList(); } });
        const down = document.createElement("button");
        down.type = "button"; down.className = "bi-iconbtn bi-iconbtn--sm"; down.innerHTML = BI.icon("chevron", 14); down.title = "Move down";
        down.addEventListener("click", () => { if (i < cards.length - 1) { const t = cards[i + 1]; cards[i + 1] = cards[i]; cards[i] = t; refreshList(); } });
        const rm = document.createElement("button");
        rm.type = "button"; rm.className = "bi-iconbtn bi-iconbtn--sm danger"; rm.innerHTML = BI.icon("trash", 14); rm.title = "Remove";
        rm.addEventListener("click", () => { cards.splice(i, 1); refreshList(); });
        acts.appendChild(up); acts.appendChild(down); acts.appendChild(rm);
        row.appendChild(acts);
        listEl.appendChild(row);
      });
    }

    const addRow = document.createElement("div");
    addRow.className = "bi-builder-add";
    const repSel = BI.ui.select([{ value: "", label: "Choose a report…" }, ...BI.reports.all().map((r) => ({ value: r.id, label: r.name }))]);
    repSel.className = "bi-select";
    const chartSel = BI.ui.select([{ value: "", label: "Chart: auto" }, ...BI.catalog.chartTypes.map((c) => ({ value: c, label: c })), { value: "table", label: "table" }]);
    chartSel.className = "bi-select bi-select--sm";
    const widthSel = BI.ui.select([{ value: "half", label: "Half width" }, { value: "full", label: "Full width" }], "half");
    widthSel.className = "bi-select bi-select--sm";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "bi-btn bi-btn-ghost bi-btn--sm";
    addBtn.textContent = "Add card";
    addBtn.addEventListener("click", () => {
      if (!repSel.value) return;
      const r = BI.reports.get(repSel.value);
      cards.push({ id: "c-" + Math.random().toString(36).slice(2, 8), reportId: repSel.value, chartType: chartSel.value || (r && r.chartType) || "auto", width: widthSel.value });
      refreshList();
    });
    addRow.appendChild(repSel); addRow.appendChild(chartSel); addRow.appendChild(widthSel); addRow.appendChild(addBtn);

    const bodyEl = document.createElement("div");
    bodyEl.appendChild(BI.ui.field("Name", nameInput));
    bodyEl.appendChild(BI.ui.field("Cards", addRow));
    bodyEl.appendChild(listEl);
    refreshList();

    BI.ui.modal({
      title: "Build dashboard",
      bodyEl,
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (e, close) => close() },
        {
          label: "Save dashboard", kind: "primary", onClick: async (e, close) => {
            if (!nameInput.value.trim()) { BI.ui.toast("Name the dashboard first", "warn"); return; }
            const id = "dash-" + nameInput.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dash-" + Date.now().toString(36);
            const res = BI.store.exists(id)
              ? await BI.store.update(id, { name: nameInput.value.trim(), cards }, { label: nameInput.value.trim() })
              : await BI.store.create({ id, kind: "dashboard", label: nameInput.value.trim(), data: { name: nameInput.value.trim(), cards } });
            if (res.ok) {
              BI.ui.toast("Dashboard saved", "success");
              if (BI.realtime && BI.realtime.announceDoc) BI.realtime.announceDoc({ id, kind: "dashboard", version: res.envelope && res.envelope.version });
              state.current = id;
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

  /* ---------- card edit menu (task 12) ---------- */
  function openCardMenu(ctx, dash, card) {
    const chartSel = BI.ui.select([{ value: "", label: "Chart: auto" }, ...BI.catalog.chartTypes.map((c) => ({ value: c, label: c })), { value: "table", label: "table" }], card.chartType || "");
    const widthSel = BI.ui.select([{ value: "half", label: "Half width" }, { value: "full", label: "Full width" }], card.width || "half");
    const titleInput = BI.ui.textInput(card.customTitle || "", "Custom title (optional)");
    const bodyEl = document.createElement("div");
    bodyEl.appendChild(BI.ui.field("Chart type", chartSel));
    bodyEl.appendChild(BI.ui.field("Width", widthSel));
    bodyEl.appendChild(BI.ui.field("Title", titleInput));
    BI.ui.modal({
      title: "Edit card",
      bodyEl,
      actions: [
        { label: "Remove card", kind: "danger", onClick: async (e, close) => { close(); await updateDash(ctx, dash, dash.cards.filter((c) => c.id !== card.id)); } },
        { label: "Cancel", kind: "ghost", onClick: (e, close) => close() },
        {
          label: "Save", kind: "primary", onClick: async (e, close) => {
            card.chartType = chartSel.value || null;
            card.width = widthSel.value;
            card.customTitle = titleInput.value.trim() || null;
            close();
            await updateDash(ctx, dash, dash.cards);
          },
        },
      ],
    });
  }

  async function updateDash(ctx, dash, cards) {
    const res = await BI.store.update(dash.id, { name: dash.name, cards }, { label: dash.name });
    if (res.ok) {
      BI.ui.toast("Dashboard updated", "success");
      if (BI.realtime && BI.realtime.announceDoc) BI.realtime.announceDoc({ id: dash.id, kind: "dashboard", version: res.envelope && res.envelope.version });
      render(ctx, await ctx.module.load(ctx));
      if (BI.integrity) BI.integrity.refresh();
    } else {
      BI.ui.toast((res.error && res.error.message) || "Could not update", "error");
    }
  }

  /* ---------- dashboard menu (duplicate / delete) ---------- */
  function openDashboardMenu(ctx, dash, data) {
    BI.ui.modal({
      title: dash.name,
      body: "<p class=\"bi-modal-msg\">Manage this dashboard.</p>",
      actions: [
        { label: "Duplicate", kind: "ghost", onClick: async (e, close) => { close(); await BI.reports.duplicateDashboard(dash.doc); BI.ui.toast("Duplicated", "success"); render(ctx, await ctx.module.load(ctx)); } },
        { label: "Delete", kind: "danger", onClick: async (e, close) => { close(); BI.ui.confirm({ title: "Delete dashboard", message: "Delete '" + dash.name + "'? This cannot be undone.", confirmLabel: "Delete", danger: true }, async (yes) => { if (!yes) return; const res = await BI.store.remove(dash.id); if (res.ok) { if (state.current === dash.id) state.current = "executive"; render(ctx, await ctx.module.load(ctx)); } }); } },
        { label: "Close", kind: "ghost", onClick: (e, close) => close() },
      ],
    });
  }
})();
