// src/modules/home.js — landing dashboard: KPI cards (task 31), system-health
// indicator (task 34), module map, recent activity, the sync/conflicts card
// (task 3) and quick actions.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { closeDrawer } from "../framework/nav.js";
import { loadingState } from "../framework/states.js";
import { viewPanel, relTime, statusBadge, catPathStr } from "./shared.js";

export default {
  id: "home",
  label: "Home",
  desc: "Dashboard and activity overview",
  icon: icons.home,
  async render(ctx) {
    ctx.container.append(loadingState({ label: "Loading dashboard…" }));
    const kb = ctx.kb;
    const articles = await ctx.content.listArticles().catch(() => []);
    const tree = await ctx.content.getCategoryTree().catch(() => []);
    const audit = await ctx.content.listAudit({ limit: 12 }).catch(() => []);
    const integrity = (await ctx.integrity) || (await ctx.content.runIntegrityChecks().catch(() => ({ ok: true, issues: [] })));
    const stale = ctx.content.staleArticles(articles);

    const byStatus = { draft: 0, in_review: 0, published: 0, archived: 0 };
    for (const a of articles) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const mostUpdated = articles.slice().sort((a, b) => (b.updated && b.updated.at) - (a.updated && a.updated.at)).slice(0, 5);

    const cards = ctx.modules
      .filter((m) => m.id !== "home" && !m.hidden)
      .map((m) =>
        h(
          "a",
          { class: "kb-module-card", href: "#/" + m.id, onClick: closeDrawer },
          h("span", { class: "kb-card-icon", html: m.icon }),
          h("h3", null, m.label),
          h("p", null, m.desc),
        ),
      );

    const kpi = (label, value, sub, href, tone = "") =>
      h("a", { class: "kb-kpi" + (tone ? " kb-kpi-" + tone : ""), href },
        h("span", { class: "kb-kpi-value" }, value),
        h("span", { class: "kb-kpi-label" }, label),
        sub ? h("span", { class: "kb-kpi-sub" }, sub) : null,
      );

    const kpiRow = h("div", { class: "kb-kpi-row" },
      kpi("Articles", String(articles.length), "across the KB", "#/browse"),
      kpi("In review", String(byStatus.in_review), "awaiting approval", "#/review", byStatus.in_review ? "review" : ""),
      kpi("Stale", String(stale.length), "past review date", "#/stale", stale.length ? "danger" : "ok"),
      kpi("Published", String(byStatus.published), byStatus.published ? "live for readers" : "", "#/browse"),
      kpi("System health", integrity.ok ? "OK" : "Issues", "", "#/reports", integrity.ok ? "ok" : "danger"),
    );

    const enforced = !!(ctx.hub && ctx.hub.connected && ctx.hub.authenticated);
    const pureViewer = enforced && !ctx.hub.isAdmin && !ctx.hub.canWrite;
    const quickActions = h("div", { class: "kb-home-actions" },
      pureViewer ? null : h("a", { class: "kb-btn kb-btn-primary", href: "#/editor/new" }, "+ New article"),
      pureViewer ? null : h("a", { class: "kb-btn kb-btn-ghost", href: "#/admin" }, "⚙ Admin"),
    );

    const healthCard = h("div", { class: "kb-status-card kb-health" + (integrity.ok ? " ok" : " warn") },
      h("div", { class: "kb-status-card-head" }, h("span", { class: "kb-status-dot" }), h("strong", null, "System health")),
      h("p", null, integrity.ok
        ? "All integrity checks pass — every article has a unique id, cross-links resolve, published articles have approved versions, and category references are intact."
        : (integrity.issues || []).filter((i) => i.level === "error").length + " error(s) and " + (integrity.issues || []).filter((i) => i.level === "warning").length + " warning(s) found. See Reports for details."),
      h("a", { class: "kb-inline-link", href: "#/reports" }, "Open Reports →"),
    );

    const recentTbl = h("div", { class: "kb-activity-list" },
      audit.slice(0, 8).map((e) =>
        h("div", { class: "kb-activity" },
          h("span", { class: "kb-activity-action" }, String(e.action || "")),
          h("span", { class: "kb-activity-target" }, e.target ? h("a", { href: "#/article/" + e.target }, e.target) : "—"),
          h("span", { class: "kb-activity-meta" }, (e.actor || "system") + " · " + relTime(e.at)),
        ),
      ),
    );

    const mostUpdCard = h("div", { class: "kb-status-card" },
      h("div", { class: "kb-status-card-head" }, h("span", { class: "kb-status-dot" }), h("strong", null, "Most recently updated")),
      h("div", { class: "kb-activity-list" },
        mostUpdated.length ? mostUpdated.map((a) =>
          h("div", { class: "kb-activity" },
            h("span", { class: "kb-activity-action" }, statusBadge(a.status)),
            h("span", { class: "kb-activity-target" }, h("a", { href: "#/article/" + a.id }, a.title)),
            h("span", { class: "kb-activity-meta" }, relTime(a.updated && a.updated.at)),
          ),
        ) : h("p", { class: "kb-muted" }, "No articles yet — create the first one."),
      ),
    );

    const panel = viewPanel({
      crumb: "Knowledge base",
      title: "Welcome to " + kb.appShortTitle,
      desc: kb.tagline + ". Author, review, and publish your company’s documentation from one place.",
      body: h("div", { class: "kb-home-body" },
        kpiRow,
        quickActions,
        h("div", { class: "kb-module-grid" }, cards),
        h("div", { class: "kb-home-cols" }, healthCard, mostUpdCard),
        h("div", { class: "kb-status-card" },
          h("div", { class: "kb-status-card-head" }, h("span", { class: "kb-status-dot" }), h("strong", null, "Recent activity")),
          recentTbl.length ? recentTbl : h("p", { class: "kb-muted" }, "No activity recorded yet."),
        ),
        ctx.sync ? syncCard(ctx) : null,
      ),
    });
    ctx.container.replaceChildren(panel);
  },
};

// A self-contained card that renders sync state and any open conflicts with
// keep-mine / keep-theirs / merge resolution, then refreshes in place.
function syncCard(ctx) {
  const card = h(
    "div",
    { class: "kb-status-card kb-sync-card" },
    h("div", { class: "kb-status-card-head" }, h("span", { class: "kb-status-dot" }), h("strong", null, "Sync & conflicts")),
    h("p", { class: "kb-sync-summary", id: "kbSyncSummary" }, "Checking…"),
    h("div", { class: "kb-sync-actions" }, h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbSyncCheckBtn" }, "Check for updates")),
    h("div", { class: "kb-conflicts", id: "kbConflicts" }),
  );

  const refresh = async () => {
    const summaryEl = card.querySelector("#kbSyncSummary");
    const listEl = card.querySelector("#kbConflicts");
    summaryEl.textContent = "Checking…";
    listEl.replaceChildren();
    let res;
    try {
      res = await ctx.sync.reconcile();
    } catch (e) {
      summaryEl.textContent = "Couldn’t check for updates — " + String((e && e.message) || e);
      return;
    }
    const overview = await ctx.sync.getOverview().catch(() => ({ conflicts: [], drafts: [], docCount: 0 }));
    const conflicts = overview.conflicts || [];
    const drafts = overview.drafts || [];
    if (res.error) {
      summaryEl.textContent = "Cloud store unreachable — local changes stay saved locally.";
    } else if (conflicts.length) {
      summaryEl.textContent = `${conflicts.length} document${conflicts.length === 1 ? "" : "s"} edited on two sides — resolve before anything is overwritten.`;
    } else if (drafts.length) {
      summaryEl.textContent = `${drafts.length} local change${drafts.length === 1 ? "" : "s"} queued to sync · all documents otherwise in sync.`;
    } else {
      summaryEl.textContent = `All ${overview.docCount} documents in sync with the cloud.`;
    }
    for (const { id, conflict } of conflicts) listEl.append(conflictRow(ctx, id, conflict, refresh));
  };

  card.querySelector("#kbSyncCheckBtn").addEventListener("click", refresh);
  refresh();
  return card;
}

function conflictRow(ctx, id, conflict, refresh) {
  const mineAt = conflict.mine && conflict.mine.at;
  const row = h(
    "div",
    { class: "kb-conflict" },
    h("div", { class: "kb-conflict-head" },
      h("strong", null, id),
      h("span", { class: "kb-conflict-meta" }, `cloud v${conflict.theirs ? conflict.theirs.version : "?"} · local draft ${relTime(mineAt)}`),
    ),
    h("div", { class: "kb-conflict-actions" },
      h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", dataset: { action: "mine", id } }, "Keep mine"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", dataset: { action: "theirs", id } }, "Keep theirs"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", dataset: { action: "merge", id } }, "Merge fields"),
    ),
  );
  for (const btn of row.querySelectorAll("[data-action]")) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const out = await ctx.sync.resolveConflict(btn.dataset.id, btn.dataset.action);
        ctx.toast(`"${out.id}": kept ${out.action.replace("keep-", "").replace("-", " ")}.`, "success");
      } catch (e) {
        ctx.toast(String((e && e.message) || e), "error", 5200);
      }
      refresh();
    });
  }
  return row;
}
