// src/modules/search.js — the Search station (search & relationship
// navigation; roadmap task 45).
//
// Two halves, one screen. The left side is fast full-text search across EVERY
// record in every client's documentation set, narrowed by the same filters the
// task names (record type, information model, provenance, client, lifecycle
// status and an expiry window). The right side is the traversal view: select a
// result and its typed links are drawn as a radial graph plus labelled groups,
// each neighbour one click away — so you can walk from an application to its
// server, its credentials, its vendor and its documentation without knowing
// where any of it lives.
//
// The index is built once per visit from the sets the service has already
// loaded (framework/search.js does the flattening and graph walking); this
// module only renders and re-renders from the returned objects.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel } from "./shared.js";
import { openAssetProfile } from "./asset-profile.js";
import { INFORMATION_MODELS, PROVENANCE } from "../framework/classification.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";
import { LIFECYCLE_STATES } from "../framework/lifecycle.js";
import { assetTypeIndex } from "../framework/flexible.js";
import {
  buildCombinedIndex,
  searchRecords,
  recordNeighbors,
  relationshipGraph,
  summarizeRecord,
  ATTENTION_STATES,
} from "../framework/search.js";

const DESC =
  "Search every record in every client, filter by classification, client, type, lifecycle status and expiry window, then follow the typed links between records to find what depends on what.";

const EXPIRY_WINDOWS = [
  { value: "0", label: "Already expired" },
  { value: "30", label: "Expiring within 30 days" },
  { value: "90", label: "Expiring within 90 days" },
  { value: "180", label: "Expiring within 180 days" },
];

const MODEL_OPTIONS = INFORMATION_MODELS.map((m) => ({ value: m.id, label: m.label }));
const PROV_OPTIONS = PROVENANCE.map((p) => ({ value: p.id, label: p.label }));
const LIFE_OPTIONS = [{ value: "attention", label: "Needs attention" }, ...LIFECYCLE_STATES.map((s) => ({ value: s.id, label: s.label }))];

const typeIcon = (t) => icons[(RECORD_TYPE_META[t] || {}).icon] || icons.box;
const typeLabel = (t) => (RECORD_TYPE_META[t] || {}).label || t;

export default {
  id: "search",
  label: "Search",
  desc: DESC,
  icon: icons.search,
  render(ctx) {
    const startQuery = (window.__kb && window.__kb.pendingSearch) || "";
    if (window.__kb) window.__kb.pendingSearch = null;
    renderSearch(ctx, startQuery);
  },
};

// ---------------------------------------------------------------------------
// station
// ---------------------------------------------------------------------------
function renderSearch(ctx, startQuery) {
  const state = {
    query: startQuery,
    filters: { collection: "", informationModel: "", provenance: "", lifecycle: "", expiryDays: "", client: "" },
    selectedKey: null,
    history: [],
    sets: [],
    index: null,
    typeIndex: new Map(),
  };

  const resultsEl = h("div", { class: "kb-search-results", id: "kbSearchResults" }, loadingState({ label: "Building the search index…" }));
  const traversalEl = h("div", { class: "kb-search-traversal", id: "kbSearchTraversal" });
  const countEl = h("span", { class: "kb-search-count", id: "kbSearchCount" }, "");

  const queryInput = h("input", { class: "kb-input kb-search-input", type: "search", placeholder: "Search records — name, field, IP, serial, vendor…", id: "kbSearchInput" });
  queryInput.value = startQuery;
  const clearBtn = h("button", { class: "kb-icon-btn kb-search-clear", type: "button", title: "Clear", hidden: !startQuery }, "✕");

  const filtersRow = h("div", { class: "kb-search-filters", id: "kbSearchFilters" });
  const toolbar = h(
    "div",
    { class: "kb-search-toolbar" },
    h("span", { class: "kb-search-input-wrap" }, h("span", { class: "kb-search-input-icon", html: icons.search }), queryInput, clearBtn),
    filtersRow,
  );

  const body = h("div", { class: "kb-search" }, toolbar, h("div", { class: "kb-search-body" }, h("div", { class: "kb-search-col" }, h("div", { class: "kb-search-col-head" }, h("h2", { class: "kb-subhead", id: "kbSearchHead" }, "Results"), countEl), resultsEl), traversalEl));

  const resetBtn = h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Reset filters");
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Search", desc: DESC, actions: resetBtn, body }));

  // -- filter controls ------------------------------------------------------
  const collectionSel = selectEl("All record types", Object.keys(RECORD_TYPE_META).map((t) => ({ value: t, label: RECORD_TYPE_META[t].label })));
  const modelSel = selectEl("All information models", MODEL_OPTIONS);
  const provSel = selectEl("All provenance", PROV_OPTIONS);
  const lifeSel = selectEl("Any lifecycle status", LIFE_OPTIONS);
  const expirySel = selectEl("Any expiry window", EXPIRY_WINDOWS);
  const clientSel = selectEl("All clients", []);
  for (const [key, sel] of [["collection", collectionSel], ["informationModel", modelSel], ["provenance", provSel], ["lifecycle", lifeSel], ["expiryDays", expirySel], ["client", clientSel]]) {
    sel.addEventListener("change", () => {
      state.filters[key] = sel.value;
      recompute();
    });
  }
  filtersRow.append(
    filterWrap("Type", collectionSel),
    filterWrap("Model", modelSel),
    filterWrap("Provenance", provSel),
    filterWrap("Lifecycle", lifeSel),
    filterWrap("Expiry", expirySel),
    filterWrap("Client", clientSel),
  );

  // -- input ----------------------------------------------------------------
  let debounce = null;
  queryInput.addEventListener("input", () => {
    clearBtn.hidden = !queryInput.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.query = queryInput.value;
      recompute();
    }, 170);
  });
  queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(debounce);
      state.query = queryInput.value;
      recompute();
    }
  });
  clearBtn.addEventListener("click", () => {
    queryInput.value = "";
    clearBtn.hidden = true;
    state.query = "";
    queryInput.focus();
    recompute();
  });
  resetBtn.addEventListener("click", () => {
    state.filters = { collection: "", informationModel: "", provenance: "", lifecycle: "", expiryDays: "", client: "" };
    for (const sel of [collectionSel, modelSel, provSel, lifeSel, expirySel, clientSel]) sel.value = "";
    recompute();
  });

  // -- load -----------------------------------------------------------------
  load();

  async function load() {
    try {
      const { sets, typeIndex, index } = await loadCombinedIndex(ctx);
      state.typeIndex = typeIndex;
      state.sets = sets;
      state.index = index;
      clientSel.replaceChildren(h("option", { value: "" }, "All clients"));
      for (const s of sets) clientSel.append(h("option", { value: s.id }, s.name || s.id));
      if (!sets.length) {
        clear(resultsEl);
        resultsEl.append(
          emptyState({
            icon: icons.search,
            title: "No documentation yet",
            description: "Create a client documentation set in Organizations, then its records become searchable here.",
            action: h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => ctx.navigate("organizations") }, "Go to Organizations"),
          }),
        );
        clear(traversalEl);
        traversalEl.append(traversalPlaceholder());
        countEl.textContent = "";
        return;
      }
      recompute();
      applyPendingPick();
    } catch (e) {
      clear(resultsEl);
      resultsEl.append(errorState({ title: "Couldn’t build the search index", description: String((e && e.message) || e), onRetry: () => load() }));
    }
  }

  // A quick-find jump handed to us by the header: select the record the user
  // picked from the palette.
  function applyPendingPick() {
    if (!window.__kb || !window.__kb.pendingPick) return;
    const pick = window.__kb.pendingPick;
    window.__kb.pendingPick = null;
    if (!pick || !pick.ref || !state.index) return;
    const key = pick.ref.type + ":" + pick.ref.id;
    const entry = state.index.entries.find((e) => e.key === key);
    if (entry) selectEntry(entry, { push: false });
  }

  const setForEntry = (entry) => state.sets.find((s) => s.id === (entry.client && entry.client.id)) || null;

  function recompute() {    if (!state.index) return;
    const res = searchRecords(state.index, state.query, state.filters);
    // Keep the selected record as long as it still exists in the index; the
    // query filters the results list, not the traversal view.
    if (state.selectedKey && !state.index.entries.some((e) => e.key === state.selectedKey)) {
      state.selectedKey = null;
    }
    renderResults(res);
    renderTraversal();
  }

  // -- results list ---------------------------------------------------------
  function renderResults(res) {
    clear(resultsEl);
    countEl.textContent = res.total + (res.total === 1 ? " record" : " records");
    if (!res.terms.length && !anyFilter(state.filters)) {
      resultsEl.append(h("p", { class: "kb-muted kb-search-hint" }, "Type to search across " + state.index.entries.length + " records in " + state.sets.length + " client set" + (state.sets.length === 1 ? "" : "s") + ". "));
    }
    if (!res.total) {
      resultsEl.append(
        emptyState({
          icon: icons.search,
          title: state.query ? 'No records match "' + state.query + '"' : "No records match these filters",
          description: "Broaden the search terms or clear a filter to see more.",
        }),
      );
      return;
    }
    const shown = res.results.slice(0, 120);
    const list = h("div", { class: "kb-search-list" });
    for (const entry of shown) list.append(resultRow(entry));
    resultsEl.append(list);
    if (res.results.length > shown.length) {
      resultsEl.append(h("p", { class: "kb-muted kb-search-more" }, "Showing the first " + shown.length + " of " + res.results.length + " matches — narrow the search to see more."));
    }
  }

  function resultRow(entry) {
    const selected = entry.key === state.selectedKey;
    const badge = entry.lifecycle && entry.lifecycle !== "none" ? lifecycleBadge(entry) : null;
    return h(
      "button",
      {
        class: "kb-search-result" + (selected ? " kb-search-result--active" : ""),
        type: "button",
        dataset: { key: entry.key },
        onClick: () => selectEntry(entry, { push: false }),
      },
      h("span", { class: "kb-search-result-icon", html: typeIcon(entry.type) }),
      h(
        "span",
        { class: "kb-search-result-main" },
        h("span", { class: "kb-search-result-name" }, entry.name),
        h("span", { class: "kb-search-result-meta" }, typeLabel(entry.type) + " · " + (entry.client ? entry.client.name : "—") + " · " + entry.modelLabel),
        h("span", { class: "kb-search-result-detail" }, summarizeRecord(entry.record, setForEntry(entry), { assetTypes: [...state.typeIndex.values()] }) || entry.text.slice(0, 110)),
      ),
      badge,
    );
  }

  // -- traversal ------------------------------------------------------------
  function selectEntry(entry, { push = true } = {}) {
    state.selectedKey = entry.key;
    if (push) state.history.push(entry.key);
    else state.history = [entry.key];
    recompute();
    const el = document.querySelector(".kb-search-result--active");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }

  function renderTraversal() {
    clear(traversalEl);
    const entry = state.selectedKey ? state.index.entries.find((e) => e.key === state.selectedKey) : null;
    if (!entry) {
      traversalEl.append(traversalPlaceholder());
      return;
    }
    const set = setForEntry(entry);
    const groups = recordNeighbors(set, entry.ref);
    const graph = relationshipGraph(set, entry.ref, { depth: 1 });

    const head = h(
      "div",
      { class: "kb-search-detail-head" },
      h("span", { class: "kb-search-result-icon", html: typeIcon(entry.type) }),
      h(
        "div",
        { class: "kb-search-detail-id" },
        h("h2", { class: "kb-search-detail-name" }, entry.name),
        h("div", { class: "kb-search-detail-meta" }, typeLabel(entry.type) + " · " + (entry.client ? entry.client.name : "—")),
      ),
    );

    const badges = h(
      "div",
      { class: "kb-chips kb-search-badges" },
      h("span", { class: "kb-badge kb-badge-model--" + (entry.informationModel || "none") }, entry.modelLabel),
      h("span", { class: "kb-badge kb-badge-prov--" + (entry.provenance || "none") }, entry.provenanceLabel),
      entry.lifecycle && entry.lifecycle !== "none" ? lifecycleBadge(entry) : null,
    );

    const detail = summarizeRecord(entry.record, set, { assetTypes: [...state.typeIndex.values()] });
    const actions = h(
      "div",
      { class: "kb-search-detail-actions" },
      entry.client
        ? h("a", { class: "kb-btn kb-btn-ghost kb-btn-sm", href: "#/organizations/" + entry.client.id }, "Open in client")
        : null,
      entry.type === "flexibleAssets" && entry.client
        ? h(
            "button",
            {
              class: "kb-btn kb-btn-ghost kb-btn-sm",
              type: "button",
              onClick: () => openAssetProfile(ctx, { setId: entry.client.id, record: entry.record, type: state.typeIndex.get(entry.record.assetTypeId) || null, reload: () => {} }),
            },
            "Open asset profile",
          )
        : null,
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => { state.selectedKey = null; state.history = []; recompute(); } }, "Close"),
    );

    const section = h(
      "div",
      { class: "kb-card kb-search-detail" },
      head,
      badges,
      detail ? h("p", { class: "kb-search-detail-line" }, detail) : null,
      actions,
    );
    traversalEl.append(section);

    // Selection history (a walk through the graph).
    if (state.history.length > 1) {
      const trail = h("div", { class: "kb-search-trail" }, h("span", { class: "kb-search-trail-label" }, "Trail:"), ...state.history.map((key, i) => {
        const e = state.index.entries.find((x) => x.key === key);
        return h("button", { class: "kb-search-trail-node" + (i === state.history.length - 1 ? " kb-search-trail-node--current" : ""), type: "button", onClick: () => { state.history = state.history.slice(0, i + 1); state.selectedKey = key; recompute(); } }, e ? e.name : key);
      }));
      traversalEl.append(trail);
    }

    // Radial graph of the direct neighbors.
    if (graph.nodes.length > 1) traversalEl.append(graphPanel(graph, (ref) => {
      const e = state.index.entries.find((x) => x.key === ref.type + ":" + ref.id);
      if (e) selectEntry(e, { push: true });
      else ctx.toast("That linked record is not in a loaded documentation set.", "warning");
    }));

    // Grouped neighbor chips.
    const neighbors = h("div", { class: "kb-card kb-search-neighbors" }, h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.link }), h("h2", { class: "kb-section-name" }, "Linked records"), h("span", { class: "kb-count-pill" }, String(groups.reduce((n, g) => n + g.items.length, 0)))));
    if (!groups.length) {
      neighbors.append(h("p", { class: "kb-muted" }, "This record has no links yet. Link it to the records it depends on from its client's documentation set."));
    } else {
      for (const group of groups) {
        neighbors.append(
          h(
            "div",
            { class: "kb-search-neighbor-group" },
            h("div", { class: "kb-search-neighbor-head" }, h("span", { class: "kb-search-neighbor-kind" }, (group.direction === "out" ? "→ " : "← ") + group.label), h("span", { class: "kb-count-pill" }, String(group.items.length))),
            h("div", { class: "kb-chips" }, ...group.items.map((item) => neighborChip(item))),
          ),
        );
      }
    }
    traversalEl.append(neighbors);
  }

  function neighborChip(item) {
    const e = state.index.entries.find((x) => x.key === item.ref.type + ":" + item.ref.id);
    if (e) {
      return h("button", { class: "kb-search-chip", type: "button", dataset: { key: e.key }, onClick: () => selectEntry(e, { push: true }) }, h("span", { class: "kb-search-chip-icon", html: typeIcon(e.type) }), e.name);
    }
    return h("span", { class: "kb-search-chip kb-search-chip--missing", title: "This linked record is not in a loaded set" }, h("span", { class: "kb-search-chip-icon", html: typeIcon(item.type) }), item.name);
  }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
function selectEl(allLabel, options) {
  const sel = h("select", { class: "kb-input kb-input-sm kb-search-select" });
  sel.append(h("option", { value: "" }, allLabel));
  for (const o of options || []) sel.append(h("option", { value: o.value }, o.label));
  return sel;
}

function filterWrap(label, control) {
  return h("label", { class: "kb-search-filter" }, h("span", { class: "kb-search-filter-label" }, label), control);
}

function anyFilter(f) {
  return Object.values(f).some((v) => v !== "" && v != null);
}

function lifecycleBadge(entry) {
  const def = LIFECYCLE_STATES.find((s) => s.id === entry.lifecycle);
  const phrase = entry.expiryDays == null ? "" : entry.expiryDays < 0 ? Math.abs(entry.expiryDays) + "d ago" : "in " + entry.expiryDays + "d";
  return h("span", { class: "kb-badge kb-lifecycle-badge kb-lifecycle-badge--" + (def ? def.tone : "muted") }, (def ? def.label : entry.lifecycle) + (phrase ? " · " + phrase : ""));
}

function traversalPlaceholder() {
  return h(
    "div",
    { class: "kb-search-traversal-empty" },
    h("span", { class: "kb-search-traversal-empty-icon", html: icons.link }),
    h("h3", null, "Select a record"),
    h("p", { class: "kb-muted" }, "Its classification, expiry status and every linked record appear here — click a neighbour to follow the link."),
  );
}

// A radial relationship graph. `dom.js` has no SVG namespace support, so the
// nodes and edges are built with createElementNS directly.
function graphPanel(graph, onPick) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "kb-search-graph");
  svg.setAttribute("viewBox", "0 0 360 300");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Relationship graph");

  const cx = 180;
  const cy = 150;
  const radius = 105;
  const neighbors = graph.nodes.filter((n) => !n.isRoot).slice(0, 14);
  const total = Math.max(1, neighbors.length);

  const mk = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const rootRef = graph.root ? graph.root.ref : null;
  const posOf = (ref) => {
    if (rootRef && ref.type === rootRef.type && ref.id === rootRef.id) return { x: cx, y: cy };
    const n = graph.nodes.find((x) => x.ref.type === ref.type && x.ref.id === ref.id);
    const i = neighbors.indexOf(n);
    if (i < 0) return { x: cx, y: cy };
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / total;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  };

  // Edges first, so nodes paint over them.
  for (const edge of graph.edges) {
    const a = posOf(edge.from);
    const b = posOf(edge.to);
    svg.append(mk("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "kb-search-graph-edge" }));
  }

  // Root node.
  if (graph.root) {
    svg.append(mk("circle", { cx, cy, r: 11, class: "kb-search-graph-root" }));
    svg.append(mk("text", { x: cx, y: cy + 26, class: "kb-search-graph-label kb-search-graph-label--root", "text-anchor": "middle" }, truncate(graph.root.name, 18)));
  }

  neighbors.forEach((node) => {
    const i = neighbors.indexOf(node);
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / total;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const g = mk("g", { class: "kb-search-graph-node" });
    g.append(mk("circle", { cx: x, cy: y, r: 8, class: "kb-search-graph-dot--" + node.type }));
    const anchor = x < cx - 6 ? "end" : x > cx + 6 ? "start" : "middle";
    const lx = x < cx - 6 ? x - 13 : x > cx + 6 ? x + 13 : x;
    const ly = anchor === "middle" ? y + (y < cy ? -14 : 20) : y + 4;
    g.append(mk("text", { x: lx, y: ly, class: "kb-search-graph-label", "text-anchor": anchor }, truncate(node.name, 20)));
    g.addEventListener("click", () => onPick(node.ref));
    svg.append(g);
  });

  return h(
    "div",
    { class: "kb-card kb-search-graph-card" },
    h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.link }), h("h2", { class: "kb-section-name" }, "Relationship graph"), h("span", { class: "kb-count-pill" }, String(neighbors.length) + " linked")),
    svg,
    neighbors.length > 14 ? h("p", { class: "kb-muted" }, "Only the first 14 links are drawn; the full list is below.") : null,
  );
}

function truncate(s, n) {
  const str = String(s == null ? "" : s);
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// Load every client's set and build the combined search index. Shared by the
// Search station and the global quick-find palette (task 51). Resolves
// `{ sets, typeIndex, index }`.
export async function loadCombinedIndex(ctx) {
  const summaries = await ctx.docs.summaries({ includeArchived: false });
  const sets = [];
  for (const s of summaries) {
    let set = await ctx.docs.get(s.id).catch(() => null);
    if (!set) {
      // A cold store read can fail transiently; give it one more chance so a
      // client is never silently missing from the search index.
      await new Promise((r) => setTimeout(r, 180));
      set = await ctx.docs.get(s.id).catch(() => null);
    }
    if (set) sets.push(set);
  }
  const types = await ctx.assetTypes.list().catch(() => []);
  const typeIndex = assetTypeIndex(types);
  return { sets, typeIndex, index: buildCombinedIndex(sets, { typeOf: (r) => typeIndex.get(r.assetTypeId) || null }) };
}
