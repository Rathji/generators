// src/modules/article.js — the article reader (hidden module, route #/article/<id>).
// Clean reading view with breadcrumbs, generated TOC, structured SOP steps with
// an interactive checklist, attachments, process links, related articles,
// backlinks, review history, feedback, follow/"updated since seen", status
// quick-actions, a copyable permalink, and a printable step-by-step output.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, errorState } from "../framework/states.js";
import { renderMarkdown, titleLookup } from "../framework/markdown.js";
import { esc } from "../framework/dom.js";
import {
  viewPanel,
  relTime,
  fmtDate,
  statusBadge,
  docTypePill,
  breadcrumbs,
  catPathStr,
  confirmDialog,
  copyText,
} from "./shared.js";

const STAT = ["draft", "in_review", "published", "archived"];

async function load(ctx) {
  const articles = await ctx.content.listArticles().catch(() => []);
  const tree = await ctx.content.getCategoryTree().catch(() => []);
  return { articles, tree };
}

function renderSopSteps(ctx, article, blocks, interactive) {
  return h(
    "section",
    { class: "kb-sop" },
    h(
      "div",
      { class: "kb-section-title" },
      h("span", { class: "kb-section-icon", html: icons.shield }),
      h("h2", null, "Procedure — step by step"),
    ),
    h(
      "ol",
      { class: "kb-sop-steps" },
      blocks.map((b, i) => {
        const step = h("li", { class: "kb-sop-step" });
        step.append(h("span", { class: "kb-sop-step-num" }, String(i + 1)));
        const content = h("div", { class: "kb-sop-step-body" });
        content.append(h("p", { class: "kb-sop-step-text" }, b.step));
        if (b.ownerRole) content.append(h("p", { class: "kb-sop-step-owner" }, "Owner / role: " + b.ownerRole));
        if (b.expectedOutcome)
          content.append(h("p", { class: "kb-sop-step-outcome" }, h("strong", null, "Expected outcome: "), b.expectedOutcome));
        if (b.safety)
          content.append(h("p", { class: "kb-sop-step-safety" }, h("strong", null, "Safety / compliance: "), b.safety));
        if (b.notes) content.append(h("p", { class: "kb-sop-step-notes" }, b.notes));
        if (Array.isArray(b.checklist) && b.checklist.length) {
          const list = h("ul", { class: "kb-check-list" });
          b.checklist.forEach((item, j) => {
            const label = h("label", { class: "kb-check" });
            const cb = h("input", { type: "checkbox", id: `kbck-${article.id}-${i}-${j}` });
            if (!interactive) cb.disabled = true;
            cb.addEventListener("change", () => {
              ctx.content.setChecklistState(article.id, i, j, cb.checked);
            });
            label.append(cb, h("span", null, item));
            list.append(h("li", null, label));
          });
          content.append(list);
        }
        step.append(content);
        return step;
      }),
    ),
  );
}

function renderFeedback(ctx, rec, onRerender) {
  const wrap = h("section", { class: "kb-feedback" });
  const count = (rec.feedback || []).filter((f) => f.helpful).length;
  const bad = (rec.feedback || []).filter((f) => !f.helpful).length;
  const section = h(
    "div",
    { class: "kb-section-title" },
    h("span", { class: "kb-section-icon", html: icons.chat }),
    h("h2", null, "Was this helpful?"),
  );
  const form = h("form", { class: "kb-feedback-form", onSubmit: (e) => e.preventDefault() });
  const text = h("textarea", {
    class: "kb-input kb-feedback-input",
    rows: 2,
    placeholder: "Optional feedback for the owner…",
    id: "kbFeedbackText",
  });
  const row = h("div", { class: "kb-feedback-actions" });
  const helpfulBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbFbHelpful" }, "👍 Helpful");
  const notBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbFbNot" }, "👎 Not helpful");
  row.append(helpfulBtn, notBtn);
  form.append(text, row);
  wrap.append(section, form);
  if (count || bad) wrap.append(h("p", { class: "kb-feedback-summary" }, `${count} helpful · ${bad} not helpful`));
  const submit = async (helpful) => {
    const comment = wrap.querySelector("#kbFeedbackText").value;
    try {
      await ctx.content.rateArticle(rec.id, { helpful, comment, by: (await ctx.content.getIdentity()) || "reader" });
      ctx.toast("Thanks for the feedback", "success");
      onRerender();
    } catch (e) {
      ctx.toast(String((e && e.message) || e), "error", 5200);
    }
  };
  helpfulBtn.addEventListener("click", () => submit(true));
  notBtn.addEventListener("click", () => submit(false));
  return wrap;
}

function renderReviewHistory(ctx, article) {
  const wrap = h("section", { class: "kb-history" });
  wrap.append(
    h(
      "div",
      { class: "kb-section-title" },
      h("span", { class: "kb-section-icon", html: icons.history }),
      h("h2", null, "Version history"),
    ),
    h(
      "div",
      { class: "kb-history-list" },
      (article.versions || []).slice().reverse().map((v) =>
        h(
          "div",
          { class: "kb-history-item" },
          h("span", { class: "kb-badge kb-badge-version" }, "v" + v.n),
          h("div", { class: "kb-history-body" },
            h("p", { class: "kb-history-summary" }, v.summary || "—"),
            h("p", { class: "kb-history-meta" }, (v.by || "system") + " · " + fmtDate(v.at) + (v.status ? " · " + v.status : "")),
          ),
        ),
      ),
    ),
  );
  return wrap;
}

export default {
  id: "article",
  label: "Article",
  desc: "Article reader",
  icon: icons.article,
  hidden: true,
  render(ctx) {
    ctx.container.append(
      errorState({
        title: "No article selected",
        description: "Open an article from Browse or Search to read it here.",
        onRetry: () => ctx.go("#/browse"),
      }),
    );
  },
  async renderDetail(ctx, id) {
    ctx.container.append(loadingState({ label: "Loading article…" }));
    const rec = await ctx.content.getArticle(id).catch(() => null);
    if (!rec) {
      ctx.container.replaceChildren(
        errorState({
          title: "Article not found",
          description: "It may have been deleted, or the link is stale.",
          onRetry: () => ctx.go("#/browse"),
        }),
      );
      return;
    }
    const { articles, tree } = await load(ctx);
    const live = ctx.content.liveContent(rec);
    let data = live.data;
    let showingPending = false;

    const rerender = () => ctx.go("#/article/" + id);
    const identity = (await ctx.content.getIdentity().catch(() => "")) || "";
    const require = async (action, msg) => (ctx.hub ? ctx.hub.require(action, rec.categoryId, { msg }) : true);

    if (rec.status === "published") ctx.content.bumpView(id).catch(() => {});
    const follows = await ctx.content.getFollows().catch(() => ({}));
    const following = !!follows[id];
    const seen = await ctx.content.seenAt(id).catch(() => 0);
    ctx.content.markSeen(id).catch(() => {});
    const updatedSinceSeen = rec.updated && rec.updated.at && rec.updated.at > seen;
    const isMinePendingRevision = rec.status === "in_review" && !!rec.publishedVersion;

    const bodyHtml = (d) =>
      renderMarkdown(d.body, titleLookup(articles)).html;
    const toc = (d) => renderMarkdown(d.body, titleLookup(articles)).toc;

    const actionBar = h("div", { class: "kb-article-actions" });
    const mkBtn = (label, icon, cls = "kb-btn-ghost", cb, dis = false) =>
      h("button", { class: "kb-btn " + cls + " kb-btn-sm", type: "button", disabled: dis || null, onClick: cb }, label);
    actionBar.append(
      mkBtn("Edit", null, "kb-btn-primary", async () => {
        if (!(await require("edit", "Your role doesn't allow editing this category"))) return;
        ctx.go("#/editor/" + id);
      }),
      mkBtn("Print", icons.print, "kb-btn-ghost", () => printArticle(ctx, rec, data)),
      mkBtn("Copy link", icons.link, "kb-btn-ghost", () =>
        copyText(`https://perchance.org/${window.generatorName || ""}#/article/${id}`, ctx.toast),
      ),
      mkBtn(following ? "Following ✓" : "Follow", icons.star, "kb-btn-ghost", async () => {
        await ctx.content.setFollow(id, !following).catch(() => {});
        rerender();
      }),
    );
    if (rec.status === "draft")
      actionBar.append(
        mkBtn("Submit for review", null, "kb-btn-primary", async () => {
          if (!(await require("submit", "Your role doesn't allow submitting for review"))) return;
          try {
            await ctx.content.submitForReview(id, identity);
            ctx.toast("Submitted for review", "success");
            rerender();
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        }),
      );
    else if (rec.status === "in_review")
      actionBar.append(
        mkBtn("Approve", null, "kb-btn-primary", async () => {
          if (!(await require("approve", "Your role doesn't allow approving"))) return;
          try {
            await ctx.content.approveArticle(id, identity, "");
            ctx.toast("Approved and published", "success");
            rerender();
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        }),
        mkBtn("Return…", null, "kb-btn-danger", async () => {
          if (!(await require("return", "Your role doesn't allow returning articles"))) return;
          const comment = await promptComment();
          if (comment === null) return;
          try {
            await ctx.content.returnArticle(id, identity, comment);
            ctx.toast("Returned to draft", "success");
            rerender();
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        }),
      );
    else if (rec.status === "published")
      actionBar.append(
        mkBtn("Archive", null, "kb-btn-danger", async () => {
          if (!(await require("archive", "Your role doesn't allow archiving"))) return;
          if (!(await confirmDialog({ title: "Archive this article?", message: "It will move to the read-only archive and no longer be listed as live content.", confirmLabel: "Archive", danger: true }))) return;
          try {
            await ctx.content.archiveArticle(id, identity);
            ctx.toast("Archived", "success");
            rerender();
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        }),
      );
    else if (rec.status === "archived")
      actionBar.append(
        mkBtn("Restore", null, "kb-btn-primary", async () => {
          if (!(await require("restore", "Your role doesn't allow restoring"))) return;
          try {
            await ctx.content.restoreArticle(id, identity);
            ctx.toast("Restored as draft", "success");
            rerender();
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        }),
      );

    const metaRow = h(
      "div",
      { class: "kb-article-meta" },
      h("span", { class: "kb-article-meta-item", html: icons.article }, "Owner: " + esc(rec.owner || "unassigned")),
      h("span", { class: "kb-article-meta-item", html: icons.history }, "Updated " + relTime(rec.updated && rec.updated.at)),
      h("span", { class: "kb-article-meta-item", html: icons.eye }, (rec.views || 0) + " views"),
      h("span", { class: "kb-article-meta-item", html: icons.hash }, "v" + (rec.publishedVersion || (rec.versions || []).length)),
      rec.reviewIntervalDays
        ? h("span", { class: "kb-article-meta-item", html: icons.stale }, "Review every " + rec.reviewIntervalDays + " days")
        : null,
    );

    const banner = h("div", { class: "kb-article-banner" });
    if (isMinePendingRevision) {
      banner.append(
        h(
          "div",
          { class: "kb-banner kb-banner-warn" },
          h("strong", null, "A revision is pending review. "),
          "Readers see the last approved version. ",
          h(
            "button",
            { class: "kb-banner-link", type: "button" },
            showingPending ? "Show approved version" : "Preview pending version",
          ),
        ),
      );
    } else if (updatedSinceSeen && rec.status === "published") {
      banner.append(
        h("div", { class: "kb-banner kb-banner-info" }, h("strong", null, "Updated since you last viewed this. "), "Review the latest content below."),
      );
    } else if (rec.status === "archived") {
      banner.append(
        h("div", { class: "kb-banner kb-banner-warn" }, h("strong", null, "Archived. "), "This article is read-only and not listed as live content."),
      );
    }

    // live concurrent updates (Phase 9, task 40) — offer a refresh when another
    // session publishes a newer version while this article is open.
    if (ctx.hub && rec.status !== "archived") {
      const liveVersion = Math.max(0, ...(rec.versions || []).map((v) => v.n));
      const off = ctx.hub.watchArticle(id, rec.categoryId, () => ctx.content.getArticle(id), (evt) => {
        if ((evt.version || 0) <= liveVersion) return;
        if (evt.by && evt.by === identity) return;
        banner.append(
          h("div", { class: "kb-banner kb-banner-info kb-banner-live" },
            h("strong", null, "Updated by " + (evt.by || "someone") + " just now. "),
            h("button", { class: "kb-banner-link", type: "button", onClick: rerender }, "Refresh"),
          ),
        );
      });
      ctx.onUnmount(off);
    }

    // structured SOP blocks (live content data carries `blocks`)
    const sopSection =
      rec.docType === "sop" && Array.isArray(data.blocks) && data.blocks.length
        ? renderSopSteps(ctx, rec, data.blocks, rec.status !== "archived")
        : null;

    // attachments
    const attSection =
      Array.isArray(rec.attachments) && rec.attachments.length
        ? h(
            "section",
            { class: "kb-attachments" },
            h("div", { class: "kb-section-title" }, h("span", { class: "kb-section-icon", html: icons.download }), h("h2", null, "Attachments")),
            h(
              "ul",
              { class: "kb-attachment-list" },
              rec.attachments.map((at) =>
                h(
                  "li",
                  null,
                  h("a", { class: "kb-attachment", href: at.url, target: "_blank", rel: "noopener" },
                    h("span", { class: "kb-attachment-icon", html: at.type && at.type.startsWith("image/") ? icons.article : icons.download }),
                    h("span", null, at.name || "attachment"),
                  ),
                ),
              ),
            ),
          )
        : null;

    // process refs
    const procSection =
      Array.isArray(rec.processRefs) && rec.processRefs.length
        ? h(
            "section",
            { class: "kb-procrefs" },
            h("div", { class: "kb-section-title" }, h("span", { class: "kb-section-icon", html: icons.link }), h("h2", null, "Related business objects")),
            h(
              "ul",
              { class: "kb-procref-list" },
              rec.processRefs.map((p) =>
                h(
                  "li",
                  { class: "kb-procref" },
                  h("span", { class: "kb-procref-tool" }, p.tool),
                  p.url
                    ? h("a", { href: p.url, target: "_blank", rel: "noopener" }, p.label || p.id)
                    : h("span", null, p.label || p.id),
                ),
              ),
            ),
          )
        : null;

    // related + backlinks
    const related = ctx.content.relatedArticles(id, { articles });
    const backlinks = ctx.content.backlinks(id, { articles });
    const relatedSection =
      related.length
        ? h(
            "section",
            { class: "kb-related" },
            h("div", { class: "kb-section-title" }, h("span", { class: "kb-section-icon", html: icons.link }), h("h2", null, "Related articles")),
            h(
              "ul",
              { class: "kb-link-list" },
              related.map((a) => h("li", null, h("a", { href: "#/article/" + a.id }, a.title))),
            ),
          )
        : null;
    const backSection =
      backlinks.length
        ? h(
            "section",
            { class: "kb-backlinks" },
            h("div", { class: "kb-section-title" }, h("span", { class: "kb-section-icon", html: icons.link }), h("h2", null, "Linked from")),
            h(
              "ul",
              { class: "kb-link-list" },
              backlinks.map((a) => h("li", null, h("a", { href: "#/article/" + a.id }, a.title))),
            ),
          )
        : null;

    const reviewHist = renderReviewHistory(ctx, rec);
    const feedback = renderFeedback(ctx, rec, rerender);
    const histBtn = banner.querySelector(".kb-banner-link");
    if (histBtn)
      histBtn.addEventListener("click", () => {
        showingPending = !showingPending;
        data = showingPending ? rec : live.data;
        const bodyBox = mainBody.querySelector(".kb-article-body");
        const sopBox = mainBody.querySelector(".kb-sop");
        if (bodyBox) bodyBox.innerHTML = bodyHtml(data);
        if (sopBox && sopBox.parentNode) {
          const next = data.blocks && data.blocks.length ? renderSopSteps(ctx, rec, data.blocks, rec.status !== "archived") : null;
          sopBox.replaceWith(next || document.createComment(""));
        }
        histBtn.textContent = showingPending ? "Show approved version" : "Preview pending version";
      });

    const mainBody = h(
      "div",
      { class: "kb-article-layout" },
      h(
        "div",
        { class: "kb-article-main" },
        banner,
        h("div", { class: "kb-article-body kb-prose", id: "kbArticleBody" }),
        sopSection,
        attSection,
        procSection,
        relatedSection,
        backSection,
        reviewHist,
        feedback,
      ),
    );
    mainBody.querySelector("#kbArticleBody").innerHTML = bodyHtml(data);

    // TOC sidebar
    const tocList = toc(data);
    if (tocList.length > 1) {
      mainBody.append(
        h(
          "aside",
          { class: "kb-article-toc" },
          h("div", { class: "kb-toc-label" }, "On this page"),
          h(
            "nav",
            { class: "kb-toc" },
            tocList.map((t) =>
              h(
                "a",
                { class: "kb-toc-" + t.level, href: "#" + t.id, onClick: (e) => { e.preventDefault(); const el = document.getElementById(t.id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } },
                t.text,
              ),
            ),
          ),
        ),
      );
    }

    const panel = viewPanel({
      crumb: breadcrumbs(["Knowledge base", catPathStr(tree, rec.categoryId), rec.title]).innerHTML,
      title: rec.title || "Untitled",
      desc: rec.summary || "",
      body: h(
        "div",
        { class: "kb-article-wrap" },
        h("div", { class: "kb-article-titlebar" }, statusBadge(rec.status), docTypePill(rec.docType), h("span", { class: "kb-article-id" }, rec.id)),
        metaRow,
        actionBar,
        mainBody,
      ),
    });

    ctx.container.replaceChildren(panel);

    async function promptComment() {
      const { promptPanel } = await import("./shared.js");
      return promptPanel({ title: "Return with comment", placeholder: "Tell the author what needs to change…", confirmLabel: "Return article" });
    }
  },
};

function printArticle(ctx, rec, data) {
  const w = window.open("", "_blank");
  if (!w) {
    ctx.toast("Allow pop-ups to print", "warning");
    return;
  }
  const sopHtml = (Array.isArray(data.blocks) && data.blocks.length)
    ? `<h2>Procedure</h2><ol>${data.blocks.map((b, i) => `<li><strong>${esc(b.step)}</strong>${b.ownerRole ? `<br><em>Owner/role:</em> ${esc(b.ownerRole)}` : ""}${b.expectedOutcome ? `<br><em>Expected outcome:</em> ${esc(b.expectedOutcome)}` : ""}${b.safety ? `<br><em>Safety/compliance:</em> ${esc(b.safety)}` : ""}${b.notes ? `<br>${esc(b.notes)}` : ""}${Array.isArray(b.checklist) && b.checklist.length ? `<ul>${b.checklist.map((c) => `<li>☐ ${esc(c)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ol>` : "";
  const tocHtml = (renderMarkdown(data.body).toc.length > 1)
    ? `<div class="toc"><h3>Contents</h3>${renderMarkdown(data.body).toc.map((t) => `<div class="toc-${t.level}">${esc(t.text)}</div>`).join("")}</div>`
    : "";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(rec.title)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.6}
  h1{font-size:28px;margin-bottom:2px} .meta{color:#666;font-size:13px;margin-bottom:24px}
  h2{border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:28px}
  pre{background:#f5f5f5;padding:12px;overflow:auto;font-size:13px}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:6px 10px;font-size:14px}
  blockquote{border-left:3px solid #999;margin-left:0;padding-left:14px;color:#444}
  .toc{background:#f8f8f8;padding:12px 16px;margin-bottom:20px;font-size:14px}
  .toc-2{padding-left:0}.toc-3{padding-left:16px}.toc-4{padding-left:32px}
  a{color:#1a4fa0} img{max-width:100%} code{background:#f2f2f2;padding:1px 4px;border-radius:3px}
  @media print{body{margin:0}}
</style></head><body>
  <h1>${esc(rec.title)}</h1>
  <div class="meta">${esc((rec.owner ? "Owner: " + rec.owner + " · " : ""))}Updated ${esc(relTime(rec.updated && rec.updated.at))} · v${rec.publishedVersion || (rec.versions || []).length}${rec.reviewIntervalDays ? " · Review every " + rec.reviewIntervalDays + " days" : ""}</div>
  ${rec.summary ? `<p><em>${esc(rec.summary)}</em></p>` : ""}
  ${tocHtml}
  ${renderMarkdown(data.body).html}
  ${sopHtml}
  <hr><p style="font-size:12px;color:#888">Printed from ${esc("https://perchance.org/" + (window.generatorName || "") + "#/article/" + rec.id)}</p>
</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}
