/* ============================================================
   Module: Data Sources — every participating tool from the
   shared pipeline manifest, its published bundle types, freshness
   and health (tasks 6–10). Manual refresh-per-source and
   refresh-all obeying each source's cadence; schema gaps, malformed
   payloads and never-published sources each explain themselves.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  function fmtAge(ms) {
    if (ms == null) return "—";
    if (ms < 60000) return "just now";
    if (ms < 3600000) return Math.round(ms / 60000) + " min ago";
    if (ms < 86400000) return Math.round(ms / 3600000) + " h ago";
    return Math.round(ms / 86400000) + " d ago";
  }

  BI.register({
    id: "dataSources",
    async load(ctx) {
      return {
        tools: (BI.bus.tools || []).map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          bundles: (t.bundles || []).map((b) => {
            const h = BI.bus.healthOf(t.id, b.type);
            return {
              type: b.type,
              name: b.name || b.type,
              url: b.url,
              status: h.status,
              error: h.error,
              lastPull: h.lastPull,
              editCount: h.editCount,
              schemaVersion: h.schemaVersion,
              ageMs: BI.bus.ageMs(t.id, b.type),
              stale: BI.bus.isStale(t.id, b.type),
            };
          }),
          status: BI.bus.toolHealth(t.id).status,
        })),
        status: BI.bus.status(),
      };
    },

  });

  function render(ctx, data) {
    const el = ctx.el;
      el.innerHTML = "";
      const canManage = BI.realtime.can("manage_sources");
      el.appendChild(BI.ui.pageHead({
        title: "Data Sources",
        description: "Every tool publishing to the shared bus. The BI reads each tool's bundles — it never stores source-of-truth data.",
        actions: canManage ? [{ label: "Refresh all", kind: "primary", onClick: () => refreshAll(ctx) }] : [],
      }));

      const body = document.createElement("div");
      body.className = "bi-module-body";

      /* manifest summary */
      const s = data.status;
      const sum = document.createElement("div");
      sum.className = "bi-summary";
      const info = BI.ui.card({
        header: "Bus status",
        body: document.createElement("div"),
      });
      const rows = [
        ["Manifest", BI.esc(s.manifestUrl)],
        ["Tools registered", String((data.tools || []).length)],
        ["Fact records in store", String(s.factCount)],
        ["Refresh cadence", Math.round(s.cadenceMs / 3600000) + " h"],
        ["Staleness threshold", Math.round(s.stalenessMs / 3600000) + " h"],
      ];
      const grid = document.createElement("div");
      grid.className = "bi-summary-grid";
      for (const [k, v] of rows) {
        const cell = document.createElement("div");
        cell.className = "bi-summary-cell";
        cell.innerHTML = "<small>" + BI.esc(k) + "</small><span>" + v + "</span>";
        grid.appendChild(cell);
      }
      info.querySelector(".bi-card-b").appendChild(grid);
      body.appendChild(info);

      if (!data.tools.length) {
        body.appendChild(BI.ui.state({
          type: "error",
          title: "The bus isn't connected",
          message: BI.errors.describe("manifest_unreachable").text,
          hint: "Check the manifest URL in biConfig.bus (main.pjs), then use Refresh all.",
        }));
        el.appendChild(body);
        return;
      }

      for (const t of data.tools) {
        const card = BI.ui.card({ header: t.name + " — " + t.description, body: document.createElement("div") });
        const b = card.querySelector(".bi-card-b");
        for (const bundle of t.bundles) {
          const row = document.createElement("div");
          row.className = "bi-source-row";
          const left = document.createElement("div");
          left.className = "bi-source-main";
          left.innerHTML = "<strong>" + BI.esc(bundle.name) + "</strong><small>" + BI.esc(bundle.type) + " · " + BI.esc(bundle.url) + "</small>";
          row.appendChild(left);
          const badge = BI.ui.badge(bundle.status, bundle.status === "ok" ? "ok" : bundle.status === "error" ? "err" : bundle.status === "gap" ? "warn" : bundle.status === "stale" ? "warn" : "");
          badge.title = statusExplain(bundle);
          row.appendChild(badge);
          const meta = document.createElement("div");
          meta.className = "bi-source-meta";
          meta.innerHTML = "last pull: <b>" + BI.esc(bundle.lastPull ? fmtAge(new Date().getTime() - new Date(bundle.lastPull).getTime()) : "never") + "</b>" +
            " · edit count: <b>" + (bundle.editCount != null ? bundle.editCount : "—") + "</b>" +
            " · schema: <b>v" + (bundle.schemaVersion != null ? bundle.schemaVersion : "—") + "</b>" +
            (bundle.ageMs != null ? " · data age: <b>" + fmtAge(bundle.ageMs) + "</b>" : "");
          row.appendChild(meta);
          if (bundle.status === "error" || bundle.status === "gap") {
            const exp = document.createElement("div");
            exp.className = "bi-source-error";
            const d = BI.errors.describe(bundle.error === "schema_gap" ? "schema_gap" : bundle.error || "unknown");
            exp.textContent = d.text;
            row.appendChild(exp);
          }
          if (canManage) {
            const refresh = document.createElement("button");
            refresh.type = "button";
            refresh.className = "bi-btn bi-btn-ghost bi-btn--sm bi-source-refresh";
            refresh.textContent = "Refresh";
            refresh.addEventListener("click", async () => {
              refresh.disabled = true;
              refresh.textContent = "…";
              const res = await BI.bus.refresh(t.id);
              refresh.disabled = false;
              refresh.textContent = "Refresh";
              if (res.ok) {
                BI.ui.toast(t.name + " refreshed", "success");
                if (BI.integrity) BI.integrity.refresh();
                render(ctx, await ctx.module.load(ctx));
              } else {
                BI.ui.toast((res.error && res.error.message) || "Refresh failed", "error");
              }
            });
            row.appendChild(refresh);
          }
          b.appendChild(row);
        }
        if (t.status === "never") {
          b.appendChild(BI.ui.state({
            type: "empty",
            title: t.name + " hasn't published yet",
            message: "The manifest lists this tool but no bundle has been pulled successfully. Once the tool publishes, it appears here automatically.",
          }));
        }
        body.appendChild(card);
      }

      el.appendChild(body);
  }

  BI.modules.dataSources.render = render;

  function statusExplain(bundle) {
    switch (bundle.status) {
      case "ok": return "Healthy. Data is fresh.";
      case "stale": return "Cached data is older than the staleness threshold. Refresh this source.";
      case "gap": return "Older bundle schema — data is read best-effort.";
      case "error": return "Last pull failed: " + (bundle.error || "unknown") + ".";
      default: return "Never pulled successfully yet.";
    }
  }

  async function refreshAll(ctx) {
    BI.ui.toast("Refreshing all sources…");
    const res = await BI.bus.refreshAll({ force: true });
    if (BI.integrity) BI.integrity.refresh();
    if (BI.realtime && BI.realtime.reportIndex) BI.realtime.reportIndex();
    render(ctx, await ctx.module.load(ctx));
    BI.ui.toast("Refreshed " + res.pulled + " bundle(s), " + res.changed + " changed" + (res.errors ? ", " + res.errors + " failed" : ""), res.errors ? "warn" : "success");
  }
})();
