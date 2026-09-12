// src/modules/quickfind.js — the global quick-find palette (roadmap task 51).
//
// A single overlay reachable from anywhere — the header search, Cmd/Ctrl+K, or
// `/` — that searches every record in every client as you type and jumps
// straight to the one you want. It reuses the same combined index and matching
// rules as the Search station (framework/search.js) and understands the field
// query syntax (type:, client:, model:, prov:, life:, due:) via
// framework/field.js, so "vlan client:acme type:configurations" narrows as you
// type. Built for a phone in one hand: full-width tap targets, a big input, and
// arrow-key support when there's a keyboard.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";
import { quickSearch, quickChips, QUICK_QUERY_HELP } from "../framework/field.js";
import { summarizeRecord } from "../framework/search.js";
import { loadCombinedIndex } from "./search.js";

const typeIcon = (t) => icons[(RECORD_TYPE_META[t] || {}).icon] || icons.box;
const typeLabel = (t) => (RECORD_TYPE_META[t] || {}).label || t;

// The index is expensive-ish to build, so keep the last one briefly warm while
// the palette is opened repeatedly.
let cache = { index: null, sets: [], typeIndex: new Map(), at: 0 };
const CACHE_MS = 15000;

async function getIndex(ctx, { force = false } = {}) {
  if (!force && cache.index && Date.now() - cache.at < CACHE_MS) return cache;
  const built = await loadCombinedIndex(ctx);
  cache = { ...built, at: Date.now() };
  return cache;
}

export function invalidateQuickFindCache() {
  cache = { index: null, sets: [], typeIndex: new Map(), at: 0 };
}

// Open the palette. `initialQuery` seeds the input (the header passes its own
// value when the user clicks it).
export function openQuickFind(ctx, { initialQuery = "" } = {}) {
  if (document.querySelector(".kb-quickfind-overlay")) return null;

  const input = h("input", {
    class: "kb-quickfind-input",
    id: "kbQuickFindInput",
    type: "text",
    placeholder: "Find a record — name, IP, serial, vendor…",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Quick find",
  });
  input.value = initialQuery;
  const chipsEl = h("div", { class: "kb-quickfind-chips" });
  const resultsEl = h("div", { class: "kb-quickfind-results", id: "kbQuickFindResults" });
  const helpEl = h(
    "div",
    { class: "kb-quickfind-help" },
    h("span", { class: "kb-quickfind-help-label" }, "Narrow with"),
    ...QUICK_QUERY_HELP.map((x) => h("code", { class: "kb-quickfind-hint" }, x.hint)),
  );
  const countEl = h("span", { class: "kb-quickfind-count" }, "");

  const dialog = h(
    "div",
    { class: "kb-quickfind", role: "dialog", "aria-modal": "true", "aria-label": "Quick find" },
    h("div", { class: "kb-quickfind-head" }, h("span", { class: "kb-quickfind-icon", html: icons.search }), input, h("kbd", { class: "kb-quickfind-esc" }, "Esc")),
    chipsEl,
    resultsEl,
    h("div", { class: "kb-quickfind-foot" }, countEl, helpEl),
  );
  const overlay = h("div", { class: "kb-quickfind-overlay" }, dialog);

  const state = { entries: [], active: 0, built: false };

  function close() {
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
  }

  function renderChips() {
    clear(chipsEl);
    for (const c of quickChips(input.value)) {
      chipsEl.append(h("span", { class: "kb-quickfind-chip" }, h("span", { class: "kb-quickfind-chip-key" }, c.label), c.display));
    }
  }

  function pick(entry) {
    close();
    if (window.__kb) {
      window.__kb.pendingSearch = entry.name || "";
      window.__kb.pendingPick = { setId: entry.client ? entry.client.id : null, ref: entry.ref };
    }
    ctx.navigate("search");
  }

  function renderResults(res) {
    clear(resultsEl);
    state.entries = res.results;
    if (state.active >= state.entries.length) state.active = Math.max(0, state.entries.length - 1);
    countEl.textContent = state.built
      ? res.total === 0
        ? "No matches"
        : res.total + (res.total === 1 ? " match" : " matches")
      : "Indexing…";
    if (!state.built) {
      resultsEl.append(h("div", { class: "kb-quickfind-empty" }, "Building the index…"));
      return;
    }
    if (!state.entries.length) {
      resultsEl.append(
        h(
          "div",
          { class: "kb-quickfind-empty" },
          input.value.trim() ? "Nothing matches — try fewer words or a different filter." : "Start typing to search every client's records.",
        ),
      );
      return;
    }
    state.entries.forEach((entry, i) => resultsEl.append(resultRow(entry, i)));
  }

  function resultRow(entry, i) {
    const set = cache.index && cache.index.bySet ? (cache.index.bySet.get(entry.client && entry.client.id) || {}).set || null : null;
    const detail = summarizeRecord(entry.record, set, { assetTypes: [...cache.typeIndex.values()] }) || "";
    const row = h(
      "button",
      {
        class: "kb-quickfind-row" + (i === state.active ? " kb-quickfind-row--active" : ""),
        type: "button",
        dataset: { key: entry.key },
        onMousemove: () => {
          if (state.active !== i) {
            state.active = i;
            highlight();
          }
        },
        onClick: () => pick(entry),
      },
      h("span", { class: "kb-quickfind-row-icon", html: typeIcon(entry.type) }),
      h(
        "span",
        { class: "kb-quickfind-row-main" },
        h("span", { class: "kb-quickfind-row-name" }, entry.name),
        h("span", { class: "kb-quickfind-row-meta" }, typeLabel(entry.type) + " · " + (entry.client ? entry.client.name : "—") + (detail ? " · " + detail : "")),
      ),
      h("span", { class: "kb-quickfind-row-go", html: icons.arrow }),
    );
    return row;
  }

  function highlight() {
    const rows = resultsEl.querySelectorAll(".kb-quickfind-row");
    rows.forEach((r, i) => r.classList.toggle("kb-quickfind-row--active", i === state.active));
    const active = rows[state.active];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  async function rebuild() {
    renderChips();
    if (!state.built) {
      renderResults({ results: [], total: 0 });
      try {
        await getIndex(ctx);
        state.built = true;
      } catch (e) {
        state.built = true;
        clear(resultsEl);
        resultsEl.append(h("div", { class: "kb-quickfind-empty" }, "Couldn't build the index — " + String((e && e.message) || e)));
        return;
      }
    }
    run();
  }

  function run() {
    if (!cache.index) return;
    state.active = 0;
    renderResults(quickSearch(cache.index, input.value, { limit: 9 }));
  }

  let debounce = null;
  input.addEventListener("input", () => {
    renderChips();
    clearTimeout(debounce);
    debounce = setTimeout(run, 90);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (state.entries.length) {
        state.active = (state.active + 1) % state.entries.length;
        highlight();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (state.entries.length) {
        state.active = (state.active - 1 + state.entries.length) % state.entries.length;
        highlight();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (state.entries[state.active]) pick(state.entries[state.active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown, true);

  document.body.append(overlay);
  rebuild();
  setTimeout(() => input.focus(), 0);
  return { close, input, overlay };
}
