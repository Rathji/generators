// src/modules/search.js — full-text search across titles, summaries, tags and
// body text, ranked by relevance + recency, with result snippets, facets, a
// no-results state that suggests alternate terms, and matching snippets.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, emptyState } from "../framework/states.js";
import { viewPanel, articleRow, catPathStr, flattenTree } from "./shared.js";

export default {
  id: "search",
  label: "Search",
  desc: "Full-text search across the KB",
  icon: icons.search,
  async render(ctx) {
    ctx.container.append(loadingState({ label: "Loading search…" }));
    const articles = await ctx.content.listArticles().catch(() => []);
    const snippets = await ctx.content.listSnippets().catch(() => []);
    const tree = await ctx.content.getCategoryTree().catch(() => []);

    const q = (window.__kb && window.__kb.pendingSearch) || "";
    if (window.__kb) window.__kb.pendingSearch = null;

    const input = h("input", { id: "searchInput", type: "search", placeholder: "Search titles, tags, and body text…", "aria-label": "Search the knowledge base", value: q, autocomplete: "off" });
    const form = h(
      "form",
      { class: "kb-search-form", role: "search", onSubmit: (e) => e.preventDefault() },
      h("div", { class: "kb-search-box" }, h("span", { class: "kb-hs-icon", html: icons.search }), input),
    );
    const typeSel = h("select", { class: "kb-input" }, h("option", { value: "" }, "All types"), ...["sop", "policy", "how-to", "reference", "faq"].map((t) => h("option", { value: t }, t.toUpperCase())));
    const statusSel = h("select", { class: "kb-input" }, h("option", { value: "" }, "All statuses"), h("option", { value: "published" }, "Published"), h("option", { value: "draft" }, "Drafts"), h("option", { value: "in_review" }, "In review"));
    // Phase 9 (task 38): a signed-in viewer sees only published results.
    const pureViewer = !!(ctx.hub && ctx.hub.connected && ctx.hub.authenticated) && !ctx.hub.isAdmin && !ctx.hub.canWrite;
    if (pureViewer) { statusSel.value = "published"; statusSel.hidden = true; }
    const catSel = h("select", { class: "kb-input" }, h("option", { value: "" }, "All categories"));
    for (const f of flattenTree(tree)) catSel.append(h("option", { value: f.id }, "—".repeat(f.depth) + (f.depth ? " " : "") + f.label));
    const filterRow = h("div", { class: "kb-filterbar-row" }, typeSel, statusSel, catSel);

    const resultsEl = h("div", { id: "srResults" });
    const countEl = h("span", { class: "kb-result-count" });

    let timer = null;
    const run = async () => {
      const query = input.value.trim();
      clearTimeout(timer);
      if (!query) {
        resultsEl.replaceChildren(emptyState({ title: "Type to search", description: "Search across titles, summaries, tags and body text — results are ranked by relevance and recency.", icon: icons.search }));
        countEl.textContent = "";
        return;
      }
      resultsEl.replaceChildren(loadingState({ label: "Searching…" }));
      const res = await ctx.content.searchArticles(query, {
        articles,
        docType: typeSel.value || "",
        status: statusSel.value || "",
        categoryId: catSel.value || "",
        categoryTree: tree,
        sort: "updated",
      });
      resultsEl.replaceChildren();
      countEl.textContent = res.length + " result" + (res.length === 1 ? "" : "s");
      if (!res.length) {
        const sugg = suggestions(query);
        resultsEl.append(
          emptyState({
            title: "No results for “" + query + "”",
            description: "Try a different spelling, fewer words, or a broader term.",
            icon: icons.search,
            action: sugg.length
              ? h("div", { class: "kb-suggestions" }, h("span", { class: "kb-suggestion-label" }, "Did you mean:"), sugg.map((s) => h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => { input.value = s; run(); } }, s)))
              : null,
          }),
        );
        return;
      }
      for (const r of res) {
        resultsEl.append(
          articleRow(ctx, r.article, {
            version: r.article.publishedVersion || (r.article.versions || []).length,
            snippet: `<span class="kb-snippet">${highlight(ctx.content.snippetFor(r.article, query), query)}</span>`,
            body: h("div", { class: "kb-row-cat" }, catPathStr(tree, r.article.categoryId)),
          }),
        );
      }
    };
    const suggestions = (query) => {
      const out = [];
      const add = (s) => { if (s && s !== query && !out.includes(s) && out.length < 3) out.push(s); };
      add(query.replace(/s$/, ""));
      add(query.replace(/ing$/, "e"));
      if (query.includes("  ")) add(query.replace(/\s+/, " "));
      if (out.length === 0 && articles.length) add(articles[0].tags && articles[0].tags[0]);
      return out;
    };

    let lastSnippetSearch = "";
    const snippetBox = h("div", { class: "kb-snippet-results" });
    const showSnippets = async () => {
      const query = input.value.trim().toLowerCase();
      if (!query) { snippetBox.replaceChildren(); return; }
      if (query === lastSnippetSearch) return;
      lastSnippetSearch = query;
      const match = snippets.filter((s) => (s.title || "").toLowerCase().includes(query) || (s.text || "").toLowerCase().includes(query)).slice(0, 4);
      snippetBox.replaceChildren();
      if (!match.length) return;
      snippetBox.append(h("div", { class: "kb-section-title" }, h("h3", null, "Reusable snippets")));
      for (const s of match) {
        snippetBox.append(h("div", { class: "kb-snippet-card" }, h("strong", null, s.title || s.id), h("p", null, (s.text || "").slice(0, 160))));
      }
    };

    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 220); showSnippets(); });
    for (const el of [typeSel, statusSel, catSel]) el.addEventListener("change", run);

    // wire the header quick-search to this page
    const qs = document.getElementById("quickSearchInput");
    if (qs) {
      qs.value = q;
      const push = (ev) => { if (ev.key === "Enter") input.focus(); };
      qs.removeEventListener("keydown", push);
      qs.addEventListener("keydown", push);
    }

    run();

    const panel = viewPanel({
      crumb: "Knowledge base / Search",
      title: "Search",
      desc: "Find articles by title, summary, tags or body text, ranked by relevance.",
      body: h("div", { class: "kb-search-body" }, form, filterRow, h("div", { class: "kb-results-head" }, countEl), snippetBox, resultsEl),
    });
    ctx.container.replaceChildren(panel);
    if (q) setTimeout(() => input.focus(), 0);
  },
};

function highlight(text, query) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  let out = String(text || "");
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    out = out.replace(re, "<mark>$1</mark>");
  }
  return out;
}
