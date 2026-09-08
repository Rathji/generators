/* ============================================================
   Module: Schedules — refresh cadence overview per source, plus
   scheduled deliveries (recurring CSV exports and snapshot
   publishing). Schedules are store docs (kind "schedule"):
     data = { name, kind: "export"|"snapshot", reportId?,
              cadenceMs, format, enabled }
   The last-run time is tracked in localStorage (bi.sched.lastRun.<id>)
   and the app-level interval (app.js) calls BI.schedules.check()
   to fire anything due — so schedules keep working without a
   page reload.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const sched = (BI.schedules = {});
  const LS = "bi.sched.lastRun.";

  function lastRun(id) { const v = localStorage.getItem(LS + id); return v ? new Date(v).getTime() : null; }
  function markRun(id, at) { localStorage.setItem(LS + id, new Date(at || Date.now()).toISOString()); }

  sched.list = function () {
    return BI.store.list()
      .filter((e) => e.kind === "schedule")
      .map((e) => BI.store.get(e.id))
      .filter((d) => d)
      .map((d) => ({ id: d.id, label: d.label, doc: d, ...(d.data || {}) }));
  };

  sched.dueMs = function (s) {
    const lr = lastRun(s.id);
    if (lr == null) return 0;
    const next = lr + (Number(s.cadenceMs) || 0);
    return next - Date.now();
  };

  /* Run one schedule now. Returns {ok, ran, result}. */
  sched.run = async function (s) {
    if (s.kind === "snapshot") {
      if (!BI.snapshot) return { ok: false, ran: false, error: "snapshot module missing" };
      const res = await BI.snapshot.publish();
      if (!res.ok) return { ok: false, ran: true, error: res.error && res.error.code };
      markRun(s.id);
      return { ok: true, ran: true, result: "snapshot @" + res.url };
    }
    if (s.kind === "export") {
      const rep = s.reportId ? BI.reports.get(s.reportId) : null;
      if (!rep) return { ok: false, ran: true, error: "unknown report " + s.reportId };
      BI.reports.downloadCSV(rep);
      markRun(s.id);
      return { ok: true, ran: true, result: "csv:" + rep.id };
    }
    return { ok: false, ran: true, error: "unknown kind " + s.kind };
  };

  /* Fire every enabled schedule that is due (called by the app interval). */
  sched.check = async function () {
    const out = [];
    for (const s of sched.list()) {
      if (!s.enabled) continue;
      if (sched.dueMs(s) > 0) continue;
      const r = await sched.run(s);
      out.push({ id: s.id, name: s.label, ...r });
    }
    return out;
  };

  function fmtMs(ms) {
    if (ms == null) return "—";
    const m = Math.round(ms / 60000);
    if (m < 60) return m + " min";
    const h = Math.round(ms / 3600000);
    if (h < 48) return h + " h";
    return Math.round(ms / 86400000) + " d";
  }
  function fmtWhen(ms) {
    if (ms <= 0) return "due now";
    if (ms < 3600000) return "in " + Math.round(ms / 60000) + " min";
    if (ms < 86400000) return "in " + Math.round(ms / 3600000) + " h";
    return "in " + Math.round(ms / 86400000) + " d";
  }

  BI.register({
    id: "schedules",
    async load(ctx) {
      const scheds = sched.list().map((s) => ({ ...s, lastRun: lastRun(s.id), dueMs: s.enabled ? sched.dueMs(s) : null }));
      return {
        scheds,
        sources: (BI.bus.tools || []).map((t) => ({
          id: t.id,
          name: t.name,
          cadenceMs: BI.config.bus ? BI.config.bus.cadenceMs : 21600000,
          stalenessMs: BI.config.bus ? BI.config.bus.stalenessMs : 108000000,
          bundles: (t.bundles || []).map((b) => ({ type: b.type, status: BI.bus.healthOf(t.id, b.type).status })),
        })),
        snapshot: BI.snapshot ? BI.snapshot.status() : null,
      };
    },

  });

  function render(ctx, data) {
    const el = ctx.el;
      el.innerHTML = "";
      const canEdit = BI.realtime.can("create_report");
      el.appendChild(BI.ui.pageHead({
        title: "Schedules",
        description: "Refresh cadences per source and recurring deliveries — CSV exports and snapshot publishing.",
        actions: canEdit ? [{ label: "New schedule", kind: "primary", onClick: () => openForm(ctx) }] : [],
      }));

      const body = document.createElement("div");
      body.className = "bi-module-body";

      /* cadence overview */
      const cad = BI.ui.card({ header: "Refresh cadence per source", body: document.createElement("div") });
      const grid = document.createElement("div");
      grid.className = "bi-summary-grid";
      for (const s of data.sources) {
        const cell = document.createElement("div");
        cell.className = "bi-summary-cell";
        const worst = s.bundles.some((b) => b.status === "error") ? "err" : s.bundles.some((b) => b.status === "stale" || b.status === "gap") ? "warn" : "ok";
        cell.innerHTML = "<small>" + BI.esc(s.name) + "</small><span>" + fmtMs(s.cadenceMs) + "</span>";
        cell.appendChild(BI.ui.badge(worst === "ok" ? "fresh" : worst === "err" ? "error" : "attention", worst === "ok" ? "ok" : "warn"));
        grid.appendChild(cell);
      }
      cad.querySelector(".bi-card-b").appendChild(grid);
      body.appendChild(cad);

      /* snapshot status */
      if (data.snapshot) {
        const sn = BI.ui.card({ header: "Snapshot bundle", body: document.createElement("div") });
        const b = sn.querySelector(".bi-card-b");
        const meta = document.createElement("div");
        meta.className = "bi-source-meta";
        meta.innerHTML = "status: <b>" + (data.snapshot.published ? "published " + data.snapshot.ageLabel : "never published") + "</b> · edit count: <b>" + data.snapshot.editCount + "</b>" +
          (data.snapshot.url ? " · <a href=\"" + BI.esc(data.snapshot.url) + "\" target=\"_blank\" rel=\"noopener\">view</a>" : "");
        b.appendChild(meta);
        const act = document.createElement("button");
        act.type = "button"; act.className = "bi-btn bi-btn-ghost bi-btn--sm";
        act.textContent = "Publish now";
        act.addEventListener("click", async () => {
          act.disabled = true; act.textContent = "…";
          const res = await BI.snapshot.publish();
          act.disabled = false; act.textContent = "Publish now";
          if (res.ok) { BI.ui.toast("Snapshot published", "success"); render(ctx, await ctx.module.load(ctx)); }
          else BI.ui.toast((res.error && res.error.message) || "Publish failed", "error");
        });
        b.appendChild(act);
        body.appendChild(sn);
      }

      /* schedule list */
      if (!data.scheds.length) {
        body.appendChild(BI.ui.state({
          type: "empty",
          title: "No schedules yet",
          message: canEdit ? "Add a recurring CSV export or a snapshot publish." : "An admin or analyst can add schedules.",
        }));
      } else {
        const list = document.createElement("div");
        list.className = "bi-report-list";
        for (const s of data.scheds) {
          const row = document.createElement("div");
          row.className = "bi-report-row";
          const main = document.createElement("div");
          main.className = "bi-report-main";
          const repName = s.kind === "export" && s.reportId ? (BI.reports.get(s.reportId) || {}).name || s.reportId : s.kind === "snapshot" ? "Snapshot publish" : s.kind;
          main.innerHTML = "<strong>" + BI.esc(s.name) + "</strong><small>" + BI.esc(repName) + " · every " + fmtMs(s.cadenceMs) + " · last run " + (s.lastRun ? new Date(s.lastRun).toLocaleString() : "never") + "</small>";
          row.appendChild(main);
          const badges = document.createElement("div");
          badges.className = "bi-report-badges";
          badges.appendChild(BI.ui.badge(s.enabled ? "enabled" : "paused", s.enabled ? "ok" : ""));
          badges.appendChild(BI.ui.badge(s.enabled ? fmtWhen(s.dueMs) : ""));
          row.appendChild(badges);
          const acts = document.createElement("div");
          acts.className = "bi-report-acts";
          const run = document.createElement("button");
          run.type = "button"; run.className = "bi-btn bi-btn-ghost bi-btn--sm"; run.textContent = "Run now";
          run.addEventListener("click", async () => {
            run.disabled = true; run.textContent = "…";
            const r = await sched.run(s);
            run.disabled = false; run.textContent = "Run now";
            if (r.ok) BI.ui.toast("Ran '" + s.name + "'", "success");
            else BI.ui.toast((r.error || "Run failed"), "error");
            render(ctx, await ctx.module.load(ctx));
          });
          acts.appendChild(run);
          if (canEdit) {
            const tog = document.createElement("button");
            tog.type = "button"; tog.className = "bi-iconbtn bi-iconbtn--sm"; tog.innerHTML = BI.icon(s.enabled ? "error" : "check", 14); tog.title = s.enabled ? "Pause" : "Enable";
            tog.addEventListener("click", async () => {
              await BI.store.update(s.id, { ...s, enabled: !s.enabled }, { label: s.label });
              render(ctx, await ctx.module.load(ctx));
            });
            acts.appendChild(tog);
            const del = document.createElement("button");
            del.type = "button"; del.className = "bi-iconbtn bi-iconbtn--sm danger"; del.innerHTML = BI.icon("trash", 14); del.title = "Delete";
            del.addEventListener("click", () => BI.ui.confirm({ title: "Delete schedule", message: "Delete '" + s.name + "'?", confirmLabel: "Delete", danger: true }, async (yes) => {
              if (!yes) return;
              await BI.store.remove(s.id);
              render(ctx, await ctx.module.load(ctx));
            }));
            acts.appendChild(del);
          }
          row.appendChild(acts);
          list.appendChild(row);
        }
        body.appendChild(list);
      }

      el.appendChild(body);
  }

  BI.modules.schedules.render = render;

  function openForm(ctx) {
    const nameInput = BI.ui.textInput("", "Schedule name");
    const kindSel = BI.ui.select([{ value: "export", label: "Recurring CSV export" }, { value: "snapshot", label: "Snapshot publish" }], "export");
    const repSel = BI.ui.select([{ value: "", label: "Choose a report…" }, ...BI.reports.all().map((r) => ({ value: r.id, label: r.name }))]);
    const cadenceSel = BI.ui.select([
      { value: "3600000", label: "Hourly" },
      { value: "21600000", label: "Every 6 hours" },
      { value: "86400000", label: "Daily" },
      { value: "604800000", label: "Weekly" },
      { value: "2592000000", label: "Monthly" },
    ], "86400000");
    const bodyEl = document.createElement("div");
    bodyEl.appendChild(BI.ui.field("Name", nameInput));
    bodyEl.appendChild(BI.ui.field("Type", kindSel));
    const repField = BI.ui.field("Report to export", repSel);
    bodyEl.appendChild(repField);
    bodyEl.appendChild(BI.ui.field("Every", cadenceSel));
    kindSel.addEventListener("change", () => { repField.hidden = kindSel.value !== "export"; });
    BI.ui.modal({
      title: "New schedule",
      bodyEl,
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (e, close) => close() },
        {
          label: "Save schedule", kind: "primary", onClick: async (e, close) => {
            if (kindSel.value === "export" && !repSel.value) { BI.ui.toast("Pick a report to export", "warn"); return; }
            const data = {
              name: nameInput.value.trim() || "Untitled schedule",
              kind: kindSel.value,
              reportId: kindSel.value === "export" ? repSel.value : null,
              cadenceMs: Number(cadenceSel.value),
              format: "csv",
              enabled: true,
            };
            const id = "sched-" + Date.now().toString(36);
            const res = await BI.store.create({ id, kind: "schedule", label: data.name, data });
            if (res.ok) { BI.ui.toast("Schedule saved", "success"); if (BI.realtime && BI.realtime.announceDoc) BI.realtime.announceDoc({ id, kind: "schedule", version: res.envelope && res.envelope.version }); close(); render(ctx, await ctx.module.load(ctx)); }
            else BI.ui.toast((res.error && res.error.message) || "Could not save", "error");
          },
        },
      ],
    });
  }
})();
