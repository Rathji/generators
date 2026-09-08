// src/modules/review.js — the approval queue (task 13): every in_review article,
// with a line-level diff against the live/published version (task 15), version
// comparison, and approve / return-with-comment actions.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, emptyState } from "../framework/states.js";
import { viewPanel, articleRow, relTime, catPathStr, statusBadge } from "./shared.js";
import { diffLines, renderDiffHtml, diffSummary } from "../framework/diff.js";

export default {
  id: "review",
  label: "Review Queue",
  desc: "Articles awaiting approval",
  icon: icons.review,
  async render(ctx) {
    ctx.container.append(loadingState({ label: "Loading review queue…" }));
    const articles = await ctx.content.listArticles().catch(() => []);
    const tree = await ctx.content.getCategoryTree().catch(() => []);
    const identity = (await ctx.content.getIdentity().catch(() => "")) || "";

    const queue = articles.filter((a) => a.status === "in_review").sort((a, b) => (b.updated && b.updated.at) - (a.updated && a.updated.at));
    const listEl = h("div", { class: "kb-article-list", id: "rvList" });

    const rerender = () => ctx.go("#/review");
    const require = async (action, catId, msg) => (ctx.hub ? ctx.hub.require(action, catId, { msg }) : true);

    for (const a of queue) {
      const versions = (a.versions || []).slice();
      const baseSel = h("select", { class: "kb-input kb-input-sm" });
      const targetSel = h("select", { class: "kb-input kb-input-sm" });
      const opts = versions.map((v) => ({ v, label: "v" + v.n + " · " + (v.summary || "") + " · " + relTime(v.at) }));
      for (const o of opts) {
        baseSel.append(h("option", { value: o.v.n }, "Base: " + o.label));
        targetSel.append(h("option", { value: o.v.n, selected: o.v.n === ctx.content.latestVersionNumber(a) ? true : null }, "Target: " + o.label));
      }
      // default base = published version if present, else the earliest
      const pubN = a.publishedVersion;
      const baseN = versions.find((v) => v.n === pubN) ? pubN : (versions.length ? versions[0].n : 0);
      baseSel.value = String(baseN);

      const diffBox = h("div", { class: "kb-diff-wrap" });
      const renderDiff = () => {
        const baseV = versions.find((v) => v.n === Number(baseSel.value));
        const targetV = versions.find((v) => v.n === Number(targetSel.value)) || { data: { body: a.body } };
        const baseBody = baseV ? baseV.data.body || "" : "";
        const targetBody = targetV ? targetV.data.body || a.body : "";
        const diff = diffLines(baseBody, targetBody);
        const sum = diffSummary(diff);
        diffBox.replaceChildren(
          h("div", { class: "kb-diff-summary" }, "+" + sum.added + " / −" + sum.removed + " lines changed"),
          h("div", { html: renderDiffHtml(diff) }),
        );
      };
      baseSel.addEventListener("change", renderDiff);
      targetSel.addEventListener("change", renderDiff);
      renderDiff();

      const commentInput = h("textarea", { class: "kb-input", rows: 2, placeholder: "Comment for the author (optional)" });
      const approveBtn = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button" }, "Approve & publish");
      const returnBtn = h("button", { class: "kb-btn kb-btn-danger kb-btn-sm", type: "button" }, "Return with comment");
      approveBtn.addEventListener("click", async () => {
        if (!(await require("approve", a.categoryId, "Your role doesn't allow approving"))) return;
        approveBtn.disabled = true;
        try {
          await ctx.content.approveArticle(a.id, identity, commentInput.value.trim());
          ctx.toast("Approved & published", "success");
          rerender();
        } catch (e) {
          ctx.toast(String((e && e.message) || e), "error", 5200);
          approveBtn.disabled = false;
        }
      });
      returnBtn.addEventListener("click", async () => {
        if (!(await require("return", a.categoryId, "Your role doesn't allow returning articles"))) return;
        returnBtn.disabled = true;
        try {
          await ctx.content.returnArticle(a.id, identity, commentInput.value.trim());
          ctx.toast("Returned to draft", "success");
          rerender();
        } catch (e) {
          ctx.toast(String((e && e.message) || e), "error", 5200);
          returnBtn.disabled = false;
        }
      });

      const detail = h(
        "details",
        { class: "kb-review-card" },
        h(
          "summary",
          { class: "kb-review-summary" },
          h("div", { class: "kb-review-titleline" }, h("strong", null, a.title || "Untitled"), statusBadge(a.status)),
          h("span", { class: "kb-review-meta" }, "Submitted by " + ((a.updated && a.updated.by) || "system") + " · " + relTime(a.updated && a.updated.at) + " · " + catPathStr(tree, a.categoryId)),
        ),
        h(
          "div",
          { class: "kb-review-body" },
          h("div", { class: "kb-version-pick" }, baseSel, targetSel),
          diffBox,
          commentInput,
          h("div", { class: "kb-review-actions" }, approveBtn, returnBtn),
        ),
      );
      listEl.append(detail);
    }

    const panel = viewPanel({
      crumb: "Knowledge base / Review",
      title: "Review Queue",
      desc: queue.length ? queue.length + " article" + (queue.length === 1 ? "" : "s") + " awaiting approval." : "Nothing awaiting approval.",
      body: queue.length
        ? listEl
        : emptyState({
            title: "Queue clear",
            description: "When an editor submits a draft for approval, it appears here so a reviewer can approve it or return it with comments.",
            icon: icons.review,
          }),
    });
    ctx.container.replaceChildren(panel);
  },
};
