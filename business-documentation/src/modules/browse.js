// src/modules/browse.js — browse all articles with facets (category, tag,
// document type, status) and sorting (recently updated / reviewed / popular),
// plus an archive view. Category clicks in the sidebar pre-filter this view.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, emptyState } from "../framework/states.js";
import { viewPanel, articleRow, catPathStr, flattenTree, docTypePill } from "./shared.js";

export default {
  id: "browse",
  label: "Browse",
  desc: "Explore and filter every article",
  icon: icons.browse,
  async render(ctx) {
    ctx.container.append(loadingState({ label: "Loading articles…" }));

    let articles = await ctx.content.listArticles().catch(() => []);
    let tree = await ctx.content.getCategoryTree().catch(() => []);

    const pendingCat = window.__kb && window.__kb.pendingCategory;
    if (pendingCat) {
      window.__kb.pendingCategory = null;
    }
    const activeCat = pendingCat || "";

    // ---- filter bar -------------------------------------------------------
    const searchIn = h("input", { class: "kb-input", id: "brSearch", type: "search", placeholder: "Filter by title or tag…", value: "" });
    const catSel = h("select", { class: "kb-input", id: "brCat" }, h("option", { value: "", selected: !activeCat ? true : null }, "All categories"));
    for (const f of flattenTree(tree)) catSel.append(h("option", { value: f.id, selected: f.id === activeCat ? true : null }, "—".repeat(f.depth) + (f.depth ? " " : "") + f.label));
    const typeSel = h("select", { class: "kb-input", id: "brType" }, h("option", { value: "" }, "All types"), ...["sop", "policy", "how-to", "reference", "faq"].map((t) => h("option", { value: t }, t.toUpperCase())));
    const statusSel = h("select", { class: "kb-input", id: "brStatus" },
      h("option", { value: "active" }, "Active (not archived)"),
      h("option", { value: "draft" }, "Drafts"),
      h("option", { value: "in_review" }, "In review"),
      h("option", { value: "published" }, "Published"),
      h("option", { value: "archived" }, "Archived"),
    );
    const sortSel = h("select", { class: "kb-input", id: "brSort" },
      h("option", { value: "updated" }, "Sort: recently updated"),
      h("option", { value: "reviewed" }, "Sort: recently reviewed"),
      h("option", { value: "popular" }, "Sort: most viewed"),
    );

    const newBtn = h("a", { class: "kb-btn kb-btn-primary kb-btn-sm", href: "#/editor/new", title: "Create a new article" }, "+ New article");
    const countEl = h("span", { class: "kb-result-count", id: "brCount" });

    // Phase 9 (task 38): a signed-in viewer (no write role anywhere) sees only
    // published content — status filter and the create button are hidden.
    const enforced = !!(ctx.hub && ctx.hub.connected && ctx.hub.authenticated);
    const pureViewer = enforced && !ctx.hub.isAdmin && !ctx.hub.canWrite;
    if (pureViewer) {
      statusSel.value = "published";
      statusSel.hidden = true;
      newBtn.hidden = true;
    }

    const resultsEl = h("div", { class: "kb-article-list", id: "brResults" });

    const renderList = () => {
      const q = searchIn.value.trim().toLowerCase();
      const cat = catSel.value;
      const type = typeSel.value;
      const status = statusSel.value;
      const sort = sortSel.value;
      let list = articles.slice();
      if (cat) {
        const ids = descendantIds(cat);
        list = list.filter((a) => ids.includes(a.categoryId));
      }
      if (type) list = list.filter((a) => a.docType === type);
      if (status === "active") list = list.filter((a) => a.status !== "archived");
      else if (status) list = list.filter((a) => a.status === status);
      if (q) {
        list = list.filter((a) =>
          (a.title || "").toLowerCase().includes(q) ||
          (a.tags || []).join(" ").includes(q) ||
          String(a.summary || "").toLowerCase().includes(q),
        );
      }
      if (sort === "updated") list.sort((x, y) => (y.updated && y.updated.at) - (x.updated && x.updated.at));
      else if (sort === "reviewed") list.sort((x, y) => (y.reviewedAt || 0) - (x.reviewedAt || 0));
      else list.sort((x, y) => (y.views || 0) - (x.views || 0));

      countEl.textContent = list.length + " article" + (list.length === 1 ? "" : "s");
      resultsEl.replaceChildren();
      if (!list.length) {
        resultsEl.append(emptyState({ title: "No articles match", description: "Try widening your filters, or create a new article.", icon: icons.browse }));
        return;
      }
      for (const a of list) {
        resultsEl.append(
          articleRow(ctx, a, {
            version: a.publishedVersion || (a.versions || []).length,
            body: h("div", { class: "kb-row-cat" }, catPathStr(tree, a.categoryId) + (a.tags && a.tags.length ? " · " + a.tags.map((t) => "#" + t).join(" ") : "")),
          }),
        );
      }
    };
    const descendantIds = (id) => {
      const out = [];
      const collect = (nn) => { out.push(nn.id); for (const c of nn.children || []) collect(c); };
      const walk = (ns) => { for (const n of ns) { if (n.id === id) collect(n); else if (n.children) walk(n.children); } };
      walk(tree);
      return out;
    };

    for (const el of [searchIn, catSel, typeSel, statusSel, sortSel]) el.addEventListener("change", renderList);
    searchIn.addEventListener("input", renderList);
    renderList();

    const filterBar = h(
      "div",
      { class: "kb-filterbar" },
      h("div", { class: "kb-filterbar-main" }, searchIn),
      h("div", { class: "kb-filterbar-row" }, catSel, typeSel, statusSel, sortSel, newBtn),
    );

    const panel = viewPanel({
      crumb: "Knowledge base / Browse",
      title: "Browse",
      desc: "Every article in the knowledge base, filterable and sortable.",
      body: h("div", { class: "kb-browse-body" }, filterBar, h("div", { class: "kb-results-head" }, countEl), resultsEl),
    });
    ctx.container.replaceChildren(panel);
  },
};
