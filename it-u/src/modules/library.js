// src/modules/library.js — the Library station (roadmap task 35).
//
// The in-application library of service processes and operational topics. Its
// articles are written so a technician can follow them as-is, or adapt them to
// this provider's context — and every article declares which shipped asset
// templates it supports and which document type it reads as, so the library is
// cross-linked from the assets and procedures it belongs to.
//
// The station is a browse surface over the static catalog in
// framework/library.js: a search box, topic shelves, and article cards. Opening
// an article (`#/library/<id>`) renders it as a document, links the assets and
// document types it supports, and offers to add it to a client's documentation
// set as a real document — where it can be edited freely.
//
// The same article is also surfaced from an asset's profile (libraryForAssetType)
// and from a document's editor (libraryForDocType); this station is where you
// read and search the whole thing.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState } from "../framework/states.js";
import { viewPanel, openModal } from "./shared.js";
import { renderMarkdown } from "../framework/markdown.js";
import { DOCUMENT_GROUPS, documentsOfGroup, documentType } from "../framework/document.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { openDocumentEditor } from "./document-view.js";
import {
  LIBRARY_TOPICS,
  LIBRARY_ARTICLES,
  LIBRARY_AUDIENCES,
  libraryTopic,
  libraryTopicLabel,
  libraryArticle,
  libraryAudience,
  libraryArticles,
  relatedLibraryArticles,
  libraryStats,
  articleDocumentType,
  articleToDocumentInput,
} from "../framework/library.js";

const DESC =
  "Service processes and operational topics your team can follow as written or adapt to a client — cross-linked from the assets and procedures each article supports.";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const topicIcon = (id) => icons[(libraryTopic(id) || {}).icon] || icons.browse;
const audienceLabel = (id) => (libraryAudience(id) || {}).label || id;

export default {
  id: "library",
  label: "Library",
  desc: DESC,
  icon: icons.browse,
  render(ctx) {
    renderList(ctx);
  },
  renderDetail(ctx, sub) {
    renderDetail(ctx, decodeURIComponent(sub));
  },
};

// ---------------------------------------------------------------------------
// list view — search across the shelves, then the article cards
// ---------------------------------------------------------------------------
function renderList(ctx) {
  const body = h("div", { class: "kb-docset-body" });
  const stats = libraryStats();

  body.append(
    h(
      "div",
      { class: "kb-library-summary" },
      h("span", { class: "kb-chip" }, stats.articles + " article" + (stats.articles === 1 ? "" : "s")),
      h("span", { class: "kb-chip" }, stats.topics + " topics"),
      h("span", { class: "kb-chip kb-chip-empty" }, stats.assetTypeLinks + " asset links · " + stats.docTypeLinks + " document links"),
    ),
  );

  const searchInput = h("input", {
    class: "kb-input",
    type: "search",
    id: "kbLibrarySearchInput",
    placeholder: "Search the library — process, topic or tag…",
    autocomplete: "off",
  });
  body.append(
    h(
      "div",
      { class: "kb-library-toolbar" },
      h("span", { class: "kb-library-toolbar-icon", html: icons.search }),
      searchInput,
    ),
  );

  let topic = "all";
  const tabs = h("div", { class: "kb-tabs", role: "tablist" });
  const results = h("div", { class: "kb-library-results" });

  function renderTabs() {
    clear(tabs);
    const shelves = [{ id: "all", label: "All", icon: "layers" }, ...LIBRARY_TOPICS];
    for (const t of shelves) {
      const count = t.id === "all" ? stats.articles : stats.byTopic[t.id] || 0;
      tabs.append(
        h(
          "button",
          {
            class: "kb-tab" + (topic === t.id ? " active" : ""),
            type: "button",
            role: "tab",
            dataset: { topic: t.id },
            onClick: () => {
              topic = t.id;
              renderTabs();
              renderResults();
            },
          },
          t.label,
          h("span", { class: "kb-tab-count" }, String(count)),
        ),
      );
    }
  }

  function renderResults() {
    const list = libraryArticles({ topic: topic === "all" ? undefined : topic, query: searchInput.value });
    clear(results);
    if (!list.length) {
      results.append(
        emptyState({
          icon: icons.browse,
          title: "No articles match",
          description: "Try a different topic, or clear the search to see the whole library.",
          action: h(
            "button",
            {
              class: "kb-btn kb-btn-ghost",
              type: "button",
              onClick: () => {
                searchInput.value = "";
                topic = "all";
                renderTabs();
                renderResults();
              },
            },
            "Clear filters",
          ),
        }),
      );
      return;
    }
    results.append(
      h("div", { class: "kb-library-count" }, list.length + " article" + (list.length === 1 ? "" : "s") + (topic === "all" ? "" : " · " + libraryTopicLabel(topic))),
    );
    const grid = h("div", { class: "kb-library-grid" });
    for (const a of list) grid.append(articleCard(a));
    results.append(grid);
  }

  searchInput.addEventListener("input", renderResults);

  body.append(tabs, results);
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Library", desc: DESC, body }));
  renderTabs();
  renderResults();
}

function articleCard(article) {
  const topic = libraryTopic(article.topic);
  const tags = (article.tags || []).slice(0, 4);
  return h(
    "a",
    { class: "kb-library-card", href: "#/library/" + encodeURIComponent(article.id), dataset: { id: article.id, topic: article.topic } },
    h(
      "div",
      { class: "kb-library-card-head" },
      h("span", { class: "kb-library-card-icon", html: topicIcon(article.topic) }),
      h(
        "div",
        { class: "kb-library-card-id" },
        h("span", { class: "kb-library-card-topic" }, topic ? topic.label : article.topic),
        h("span", { class: "kb-library-card-audience" }, audienceLabel(article.audience)),
      ),
    ),
    h("h3", { class: "kb-library-card-title" }, article.title),
    h("p", { class: "kb-library-card-summary" }, article.summary),
    tags.length ? h("div", { class: "kb-library-card-tags" }, tags.map((t) => h("span", { class: "kb-library-tag" }, t))) : null,
    h(
      "div",
      { class: "kb-library-card-foot" },
      h("span", { class: "kb-library-card-links" }, (article.assetTypeIds || []).length + " asset link" + ((article.assetTypeIds || []).length === 1 ? "" : "s")),
      h("span", { class: "kb-library-card-open" }, "Read →"),
    ),
  );
}

// ---------------------------------------------------------------------------
// detail view — the article as a document, plus its cross-links
// ---------------------------------------------------------------------------
function renderDetail(ctx, id) {
  const article = libraryArticle(id);
  const body = h("div", { class: "kb-docset-body" });
  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h("a", { class: "kb-btn kb-btn-ghost", href: "#/library" }, "Back to library"),
  );
  ctx.container.append(viewPanel({ crumb: "IT-U / Library", title: article ? article.title : "Not found", desc: article ? article.summary : "", actions, body }));

  if (!article) {
    body.append(
      emptyState({
        icon: icons.alert,
        title: "Article not found",
        description: "This library article does not exist — it may have been renamed.",
        action: h("a", { class: "kb-btn kb-btn-ghost", href: "#/library" }, "Browse the library"),
      }),
    );
    return;
  }

  actions.append(
    h(
      "button",
      { class: "kb-btn kb-btn-primary", type: "button", id: "kbLibraryAddBtn", onClick: () => addToSetDialog(ctx, article) },
      "Add to a client's set",
    ),
  );

  const topic = libraryTopic(article.topic);
  body.append(
    h(
      "div",
      { class: "kb-library-meta" },
      h("span", { class: "kb-badge kb-badge-model" }, topic ? topic.label : article.topic),
      h("span", { class: "kb-badge kb-badge-custom" }, audienceLabel(article.audience)),
      ...(article.tags || []).map((t) => h("span", { class: "kb-library-tag" }, t)),
    ),
  );

  const md = renderMarkdown(article.body);
  const layout = h(
    "div",
    { class: "kb-library-detail" },
    h("article", { class: "kb-library-article kb-markdown kb-prose", html: md.html || '<p class="kb-muted">This article has no body yet.</p>' }),
    h("aside", { class: "kb-library-aside" }, supportsBlock(article), relatedBlock(article)),
  );
  body.append(layout);
}

function supportsBlock(article) {
  const templates = (article.assetTypeIds || []).map((tid) => builtinAssetType(tid)).filter(Boolean);
  const docTypes = (article.docTypes || []).map((d) => documentType(d)).filter(Boolean);
  const section = h(
    "section",
    { class: "kb-card kb-library-side" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.link }),
      h("h2", { class: "kb-section-name" }, "Supports"),
    ),
  );
  if (templates.length) {
    section.append(h("div", { class: "kb-library-side-label" }, "Asset templates"));
    const list = h("div", { class: "kb-library-side-links" });
    for (const t of templates) list.append(h("a", { class: "kb-library-side-link", href: "#/assets/" + encodeURIComponent(t.id) }, t.name));
    section.append(list);
  }
  if (docTypes.length) {
    section.append(h("div", { class: "kb-library-side-label" }, "Reads as"));
    section.append(
      h(
        "div",
        { class: "kb-library-side-chips" },
        docTypes.map((t) => h("span", { class: "kb-library-tag" }, t.label)),
      ),
    );
  }
  if (!templates.length && !docTypes.length) section.append(h("p", { class: "kb-muted kb-library-side-empty" }, "This article is not tied to a specific asset template."));
  return section;
}

function relatedBlock(article) {
  const related = relatedLibraryArticles(article);
  if (!related.length) return null;
  return h(
    "section",
    { class: "kb-card kb-library-side" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.browse }),
      h("h2", { class: "kb-section-name" }, "Related articles"),
    ),
    h(
      "div",
      { class: "kb-library-side-links" },
      related.map((a) => h("a", { class: "kb-library-side-link", href: "#/library/" + encodeURIComponent(a.id) }, a.title)),
    ),
  );
}

// ---------------------------------------------------------------------------
// "Add to a client's set" — adapt the article into a real document
// ---------------------------------------------------------------------------
async function addToSetDialog(ctx, article) {
  const nameInput = h("input", { class: "kb-input", type: "text" });
  nameInput.value = article.title;

  const setSel = h("select", { class: "kb-input", id: "kbLibrarySetSel" });
  const typeSel = h("select", { class: "kb-input", id: "kbLibraryTypeSel" });
  for (const group of DOCUMENT_GROUPS) {
    const og = h("optgroup", { label: group });
    for (const t of documentsOfGroup(group)) og.append(h("option", { value: t.id }, t.label));
    typeSel.append(og);
  }
  typeSel.value = articleDocumentType(article);

  const m = openModal({
    title: "Add to a client's documentation set",
    description:
      "The article is copied into the chosen client's set as a full document — body, type, summary and tags — which you can then adapt to that client without changing the library.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Client documentation set"), setSel),
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Document title"), nameInput),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Document type"), typeSel),
      ),
    ],
  });

  let sets = [];
  try {
    sets = (await ctx.docs.summaries({ includeArchived: false })) || [];
  } catch {
    sets = [];
  }
  if (!sets.length) {
    clear(setSel);
    setSel.append(h("option", { value: "" }, "No documentation sets yet"));
    setSel.disabled = true;
  } else {
    for (const s of sets) setSel.append(h("option", { value: s.id }, s.name));
  }

  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h(
      "button",
      { class: "kb-btn kb-btn-primary", type: "button", id: "kbLibraryAddSaveBtn", disabled: sets.length ? null : true },
      "Add document",
    ),
  );
  m.actions.querySelector("#kbLibraryAddSaveBtn").addEventListener("click", async () => {
    m.clearError();
    const setId = setSel.value;
    if (!setId) {
      m.showError("Create a documentation set first (Organizations station), then add this article to it.");
      return;
    }
    const input = articleToDocumentInput(article, { name: nameInput.value.trim() || article.title, docType: typeSel.value });
    try {
      const res = await ctx.docs.addDocument(setId, input, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      m.close();
      ctx.toast("Added “" + res.record.name + "” to the client's set", "success");
      openDocumentEditor(ctx, { setId, record: res.record, reload: () => {} });
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
  nameInput.focus();
}
