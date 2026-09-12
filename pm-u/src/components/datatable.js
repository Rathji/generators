// ============================================================================
//  Project U — data table framework (Phase 2, task 8)
//  Responsive, sortable, searchable, paginated table for typical business data
//  sets. At phone widths it reflows into labelled stacked rows (no horizontal
//  scroll), and the header controls expose proper ARIA sort state.
// ============================================================================

import { h, svgIcon, clear } from "../framework/dom.js";
import { sortBy, formatNumber, cx } from "../framework/utils.js";

export function createDataTable(options = {}) {
  const {
    columns = [],
    rows = [],
    pageSize = 8,
    pageSizeOptions = [8, 15, 30],
    searchable = true,
    searchPlaceholder = "Search…",
    sortable = true,
    emptyMessage = "No records to display.",
    caption = "",
    onRowClick = null,
    getRowId = null,
    title = "",
  } = options;

  let data = [...rows];
  const state = { query: "", sort: { key: null, dir: "asc" }, page: 1, pageSize };

  const tbody = h("tbody");
  const thead = h("thead");
  const table = h("table", { class: "pu-table" }, caption ? h("caption", { class: "pu-sr-only" }, caption) : null, thead, tbody);
  const scroll = h("div", { class: "pu-table-scroll" }, table);
  const summary = h("div", { class: "pu-table-summary" });
  const pager = h("div", { class: "pu-pager" });

  const searchInput = searchable
    ? h("input", {
        class: "pu-input pu-input--sm",
        type: "search",
        placeholder: searchPlaceholder,
        "aria-label": caption ? `Search ${caption}` : "Search table",
        oninput: (event) => {
          state.query = event.target.value.trim().toLowerCase();
          state.page = 1;
          render();
        },
      })
    : null;

  const toolbar =
    title || searchable
      ? h(
          "div",
          { class: "pu-table-toolbar" },
          title ? h("h3", { class: "pu-table-title" }, title) : h("span", {}),
          searchInput
        )
      : null;

  const root = h("div", { class: "pu-datatable" }, toolbar, scroll, h("div", { class: "pu-table-foot" }, summary, pager));

  function cellText(row, column) {
    const raw = column.value ? column.value(row) : row[column.key];
    if (raw == null) return "";
    return String(raw);
  }

  function filtered() {
    if (!state.query) return data;
    return data.filter((row) =>
      columns.some((column) => cellText(row, column).toLowerCase().includes(state.query))
    );
  }

  function sorted(list) {
    const { key, dir } = state.sort;
    if (!key) return list;
    const column = columns.find((c) => c.key === key);
    if (!column) return list;
    const getValue = column.sortValue || ((row) => row[key]);
    return sortBy(list, getValue, dir);
  }

  function pageCount(total) {
    return Math.max(1, Math.ceil(total / state.pageSize));
  }

  function renderHead() {
    clear(thead);
    const tr = h("tr");
    for (const column of columns) {
      const isSortable = sortable && column.sortable !== false;
      const isActive = state.sort.key === column.key;
      const th = h("th", {
        scope: "col",
        class: cx("pu-th", column.align && `pu-th--${column.align}`, column.hideOnMobile && "pu-hide-mobile"),
        style: column.width ? { width: column.width } : null,
        "aria-sort": isActive ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none",
      });
      if (isSortable) {
        const btn = h(
          "button",
          {
            class: cx("pu-th-sort", isActive && "is-active"),
            type: "button",
            onclick: () => {
              if (isActive) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
              else state.sort = { key: column.key, dir: "asc" };
              state.page = 1;
              render();
            },
            "aria-label": `Sort by ${column.label}`,
          },
          h("span", {}, column.label),
          svgIcon(isActive && state.sort.dir === "asc" ? "chevronUp" : "chevronDown", {
            size: 14,
            className: cx("pu-sort-icon", isActive && "is-active"),
          })
        );
        th.appendChild(btn);
      } else {
        th.appendChild(h("span", { class: "pu-th-label" }, column.label));
      }
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }

  function renderBody(list) {
    clear(tbody);
    if (!list.length) {
      tbody.appendChild(h("tr", { class: "pu-tr-empty" }, h("td", { colspan: columns.length }, emptyMessage)));
      return;
    }
    for (const row of list) {
      const tr = h("tr", {
        class: cx("pu-tr", onRowClick && "is-clickable"),
        dataset: getRowId ? { rowId: String(getRowId(row)) } : undefined,
        tabindex: onRowClick ? "0" : undefined,
        onclick: onRowClick ? () => onRowClick(row) : undefined,
        onkeydown: onRowClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onRowClick(row);
              }
            }
          : undefined,
      });
      for (const column of columns) {
        const raw = column.value ? column.value(row) : row[column.key];
        const formatted = column.format ? column.format(raw, row) : raw;
        const td = h("td", {
          class: cx("pu-td", column.align && `pu-td--${column.align}`, column.hideOnMobile && "pu-hide-mobile", column.cellClass),
          "data-label": column.label,
        });
        if (formatted instanceof Node) td.appendChild(formatted);
        else td.textContent = formatted == null ? "—" : String(formatted);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function renderFoot(total) {
    const pages = pageCount(total);
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = total ? (state.page - 1) * state.pageSize + 1 : 0;
    const end = Math.min(state.page * state.pageSize, total);
    summary.textContent = total
      ? `Showing ${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(total)}`
      : "No matching records";

    clear(pager);
    const prev = h(
      "button",
      { class: "pu-pager-btn", type: "button", "aria-label": "Previous page", disabled: state.page <= 1 || undefined, onclick: () => { state.page--; render(); } },
      "Prev"
    );
    const next = h(
      "button",
      { class: "pu-pager-btn", type: "button", "aria-label": "Next page", disabled: state.page >= pages || undefined, onclick: () => { state.page++; render(); } },
      "Next"
    );
    pager.appendChild(prev);
    pager.appendChild(h("span", { class: "pu-pager-status", "aria-live": "polite" }, `Page ${state.page} of ${pages}`));
    pager.appendChild(next);
  }

  function render() {
    renderHead();
    const list = sorted(filtered());
    const start = (state.page - 1) * state.pageSize;
    renderBody(list.slice(start, start + state.pageSize));
    renderFoot(list.length);
  }

  render();

  return {
    el: root,
    state,
    setRows(next) {
      data = [...(next || [])];
      state.page = 1;
      render();
      return this;
    },
    getRows() {
      return [...data];
    },
    setQuery(query) {
      state.query = String(query || "").toLowerCase();
      state.page = 1;
      if (searchInput) searchInput.value = query || "";
      render();
      return this;
    },
    sort(key, dir = "asc") {
      state.sort = { key, dir };
      render();
      return this;
    },
    refresh: render,
    destroy() {
      root.remove();
    },
  };
}
