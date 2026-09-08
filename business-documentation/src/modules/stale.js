// src/modules/stale.js — scheduled-review queue (task 16): published articles
// past their review date, with days overdue, "reviewed — no change" and
// "send through the workflow" actions.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, emptyState } from "../framework/states.js";
import { viewPanel, articleRow, fmtDate, catPathStr } from "./shared.js";

export default {
  id: "stale",
  label: "Stale Content",
  desc: "Articles due for scheduled review",
  icon: icons.stale,
  async render(ctx) {
    ctx.container.append(loadingState({ label: "Checking review schedules…" }));
    const articles = await ctx.content.listArticles().catch(() => []);
    const tree = await ctx.content.getCategoryTree().catch(() => []);
    const identity = (await ctx.content.getIdentity().catch(() => "")) || "";

    const stale = ctx.content.staleArticles(articles).sort((a, b) => ctx.content.daysOverdue(b) - ctx.content.daysOverdue(a));
    const rerender = () => ctx.go("#/stale");
    const require = async (action, catId, msg) => (ctx.hub ? ctx.hub.require(action, catId, { msg }) : true);
    const listEl = h("div", { class: "kb-article-list" });

    for (const a of stale) {
      const overdue = ctx.content.daysOverdue(a);
      const interval = a.reviewIntervalDays || 365;
      const reviewed = a.reviewedAt || (a.versions && a.versions[0] && a.versions[0].at) || 0;
      const markBtn = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button" }, "Reviewed — no change");
      markBtn.addEventListener("click", async () => {
        if (!(await require("review", a.categoryId, "Your role doesn't allow reviewing"))) return;
        markBtn.disabled = true;
        try {
          await ctx.content.markReviewed(a.id, identity);
          ctx.toast("Review date refreshed", "success");
          rerender();
        } catch (e) {
          ctx.toast(String((e && e.message) || e), "error", 5200);
          markBtn.disabled = false;
        }
      });
      const reflowBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Send through workflow");
      reflowBtn.addEventListener("click", async () => {
        if (!(await require("review", a.categoryId, "Your role doesn't allow reviewing"))) return;
        reflowBtn.disabled = true;
        try {
          await ctx.content.sendForReReview(a.id, identity);
          ctx.toast("Sent to the review queue", "success");
          rerender();
        } catch (e) {
          ctx.toast(String((e && e.message) || e), "error", 5200);
          reflowBtn.disabled = false;
        }
      });
      listEl.append(
        articleRow(ctx, a, {
          version: a.publishedVersion || (a.versions || []).length,
          body: h("div", { class: "kb-row-cat" },
            catPathStr(tree, a.categoryId),
            h("span", { class: "kb-overdue kb-overdue-" + (overdue > 90 ? "severe" : overdue > 30 ? "high" : "mid") }, "Overdue by " + overdue + " day" + (overdue === 1 ? "" : "s")),
          ),
          metaRight: h("span", { class: "kb-stale-meta" }, "Last reviewed " + fmtDate(reviewed) + " · interval " + interval + " days"),
          actions: h("div", { class: "kb-row-actions" }, markBtn, reflowBtn),
        }),
      );
    }

    const panel = viewPanel({
      crumb: "Knowledge base / Stale Content",
      title: "Stale Content",
      desc: stale.length ? stale.length + " published article" + (stale.length === 1 ? "" : "s") + " past their review date." : "Every published article is within its review schedule.",
      body: stale.length
        ? listEl
        : emptyState({
            title: "No stale content",
            description: "Each article can carry a review interval. When one comes due, it will show up here with the days overdue.",
            icon: icons.stale,
          }),
    });
    ctx.container.replaceChildren(panel);
  },
};
