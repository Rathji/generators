// ============================================================================
//  Project U — aggregated activity feed (Phase 5, tasks 21-23)
//  Renders the stream of latest items from every -U member as a colour-coded,
//  filterable, day-grouped list. Each row carries the originating member's
//  registry accent (task 23) so Quote-U, PSA-U, CRM-U, IT-U and Template-U are
//  distinguishable at a glance. The component is presentation-only: it is fed
//  by an activity source (real or simulated) and reports back through
//  `onUpdate` so a parent can keep its quick-stats row in sync.
// ============================================================================

import { h, svgIcon, mount } from "../framework/dom.js";
import { cx, formatRelativeTime, titleCase } from "../framework/utils.js";
import { getMember, memberUrl } from "../framework/members.js";
import { ACTIVITY_KINDS, filterActivity, groupActivityByDay, materializeActivity, sortActivity } from "../framework/activity.js";
import { skeletonFeed } from "./skeleton.js";

export function kindMeta(kind) {
  return ACTIVITY_KINDS[kind] || { label: titleCase(kind), icon: "info" };
}

export function activityItemEl(item) {
  const member = getMember(item.memberId);
  const kind = kindMeta(item.kind);
  const accent = member ? member.accent : "var(--pu-primary)";

  const el = h(
    "article",
    {
      class: cx("pu-feed-item", item.priority === "high" && "is-urgent"),
      role: "listitem",
      dataset: { member: item.memberId, kind: item.kind, status: item.status, metric: item.metric || "" },
    },
    h("span", { class: "pu-feed-icon" }, svgIcon(kind.icon, { size: 16 })),
    h(
      "div",
      { class: "pu-feed-body" },
      h(
        "div",
        { class: "pu-feed-head" },
        h("span", { class: "pu-feed-source" }, member ? member.name : item.memberId),
        h("span", { class: "pu-feed-kind" }, kind.label),
        h("span", { class: cx("pu-badge", `pu-badge--${item.tone || "neutral"}`) }, item.statusLabel || titleCase(item.status)),
        item.priority === "high" ? h("span", { class: "pu-badge pu-badge--danger" }, "Priority") : null
      ),
      h("h4", { class: "pu-feed-title" }, item.title),
      item.summary ? h("p", { class: "pu-feed-summary" }, item.summary) : null,
      h(
        "div",
        { class: "pu-feed-meta" },
        h("span", { class: "pu-feed-actor" }, svgIcon("users", { size: 12 }), item.actor),
        h("span", { class: "pu-feed-time" }, svgIcon("clock", { size: 12 }), item.at ? formatRelativeTime(item.at) : "just now")
      )
    ),
    member
      ? h(
          "a",
          {
            class: "pu-feed-open",
            href: memberUrl(member),
            target: "_blank",
            rel: "noopener noreferrer",
            title: `Open ${member.name} in a new tab`,
            "aria-label": `Open ${member.name} in a new tab`,
          },
          svgIcon("external", { size: 14 })
        )
      : null
  );
  el.style.setProperty("--pu-feed-accent", accent);
  return el;
}

export function createActivityFeed(options = {}) {
  const {
    source = null,
    items = [],
    limit = 40,
    onUpdate = null,
    onError = null,
    showFilters = true,
    showSkeleton = true,
    skeletonCount = 5,
    emptyMessage = "No activity to show yet.",
    errorTitle = "We couldn't load the activity stream.",
    doc = typeof document !== "undefined" ? document : null,
  } = options;

  if (!doc) throw new Error("[pu:feed] requires a document");

  const normalize = (list) => sortActivity((list || []).every((item) => item.at != null) ? list : materializeActivity(list));

  let pool = normalize(items);
  const filter = { memberId: null, kind: null };
  let busy = false;
  let error = null;
  let hasLoaded = pool.length > 0;

  // --------------------------------------------------------------- markup --
  const filtersEl = h("div", { class: "pu-feed-filters" });
  const kindSelect = h("select", {
    class: "pu-feed-select",
    "aria-label": "Filter activity by type",
    onchange: () => {
      filter.kind = kindSelect.value || null;
      renderList();
      emit();
    },
  });
  const countEl = h("span", { class: "pu-feed-count", "aria-live": "polite" });
  const refreshBtn = h(
    "button",
    { class: "pu-btn pu-btn--ghost pu-btn--sm pu-feed-refresh", type: "button", onclick: () => refresh() },
    svgIcon("refresh", { size: 14 }),
    "Refresh"
  );
  const toolbar = h(
    "div",
    { class: "pu-feed-toolbar" },
    filtersEl,
    h("div", { class: "pu-feed-toolbar-right" }, kindSelect, countEl, refreshBtn)
  );
  const statusEl = h("div", { class: "pu-feed-status" });
  const skeletonEl = h("div", { class: "pu-feed-skeleton", hidden: true });
  const listEl = h("div", { class: "pu-feed-list" });

  const el = h("div", { class: "pu-feed" });
  if (showFilters) el.appendChild(toolbar);
  el.appendChild(statusEl);
  el.appendChild(skeletonEl);
  el.appendChild(listEl);

  // -------------------------------------------------------------- filters --
  function memberCounts() {
    const counts = new Map();
    for (const item of pool) counts.set(item.memberId, (counts.get(item.memberId) || 0) + 1);
    return counts;
  }

  function chip(label, memberId, count) {
    const active = filter.memberId === memberId;
    const member = memberId ? getMember(memberId) : null;
    const btn = h(
      "button",
      {
        class: cx("pu-feed-chip", active && "is-active"),
        type: "button",
        "aria-pressed": active ? "true" : "false",
        onclick: () => {
          filter.memberId = memberId;
          renderFilters();
          renderList();
          emit();
        },
      },
      member ? h("span", { class: "pu-feed-chip-dot", style: { background: member.accent } }) : null,
      label,
      h("span", { class: "pu-feed-chip-count" }, String(count))
    );
    if (member) btn.style.setProperty("--pu-feed-accent", member.accent);
    return btn;
  }

  function renderFilters() {
    if (!showFilters) return;
    const counts = memberCounts();
    const ids = [...counts.keys()].sort((a, b) => {
      const ma = getMember(a);
      const mb = getMember(b);
      return String(ma ? ma.name : a).localeCompare(String(mb ? mb.name : b));
    });
    mount(filtersEl, chip("All", null, pool.length), ids.map((id) => {
      const member = getMember(id);
      return chip(member ? member.name : id, id, counts.get(id));
    }));
  }

  function renderKindOptions() {
    const kinds = [...new Set(pool.map((item) => item.kind))].sort((a, b) => kindMeta(a).label.localeCompare(kindMeta(b).label));
    mount(
      kindSelect,
      h("option", { value: "" }, "All types"),
      kinds.map((kind) => h("option", { value: kind, selected: filter.kind === kind || undefined }, kindMeta(kind).label))
    );
    kindSelect.value = filter.kind || "";
  }

  // ----------------------------------------------------------------- list --
  function filteredItems() {
    return sortActivity(filterActivity(pool, filter));
  }

  // A failed fetch with nothing already on screen replaces the list entirely;
  // a failed *refresh* keeps the last good stream and warns inline instead.
  function renderList() {
    if (error && !pool.length) {
      mount(
        listEl,
        h(
          "div",
          { class: "pu-feed-error pu-feed-error--block", role: "alert" },
          h("span", { class: "pu-feed-error-icon" }, svgIcon("warning", { size: 22 })),
          h("h3", { class: "pu-feed-error-title" }, errorTitle),
          h("p", { class: "pu-feed-error-msg" }, error.message || "The activity service did not respond."),
          h(
            "button",
            { class: "pu-btn pu-btn--primary pu-btn--sm", type: "button", onclick: () => refresh() },
            svgIcon("refresh", { size: 14 }),
            "Try again"
          )
        )
      );
      countEl.textContent = "";
      return;
    }

    const filtered = filteredItems();
    const shown = filtered.slice(0, limit);
    countEl.textContent = `${shown.length}${filtered.length > shown.length ? ` of ${filtered.length}` : ""} ${filtered.length === 1 ? "event" : "events"}`;

    if (!shown.length) {
      mount(listEl, h("p", { class: "pu-feed-empty" }, emptyMessage));
      return;
    }

    const groups = groupActivityByDay(shown);
    mount(
      listEl,
      groups.map((group) =>
        h(
          "section",
          { class: "pu-feed-group" },
          h("h3", { class: "pu-feed-group-title" }, group.label, h("span", { class: "pu-feed-group-count" }, String(group.items.length))),
          h("div", { class: "pu-feed-items", role: "list" }, group.items.map(activityItemEl))
        )
      )
    );
  }

  // Parents get the full pool (and the filtered view) whenever it changes —
  // but not on the empty first paint, so a page can show skeletons until the
  // first fetch actually answers.
  function emit() {
    if (onUpdate && (hasLoaded || pool.length)) onUpdate(pool, filteredItems());
  }

  // Inline, non-blocking warning shown when a refresh fails but a previous
  // stream is still displayed.
  function renderStatus() {
    if (error && pool.length) {
      mount(
        statusEl,
        h(
          "div",
          { class: "pu-feed-error pu-feed-error--inline", role: "alert" },
          svgIcon("warning", { size: 16 }),
          h(
            "div",
            { class: "pu-feed-error-text" },
            h("strong", {}, "Couldn't refresh the stream."),
            h("span", {}, error.message || "Showing the last loaded events.")
          ),
          h("button", { class: "pu-btn pu-btn--ghost pu-btn--sm", type: "button", onclick: () => refresh() }, "Retry")
        )
      );
    } else {
      mount(statusEl, null);
    }
  }

  function renderSkeleton() {
    if (!showSkeleton) return;
    mount(skeletonEl, skeletonFeed({ count: skeletonCount }));
  }

  // ---------------------------------------------------------------- public --
  // The filter bar is meaningless until there is something to filter, so it
  // stays hidden during the initial load and the empty/error states.
  function syncToolbar() {
    if (showFilters) toolbar.hidden = !pool.length;
  }

  function render() {
    renderFilters();
    renderKindOptions();
    renderStatus();
    renderList();
    syncToolbar();
    emit();
  }

  function setItems(next) {
    pool = normalize(next);
    error = null;
    render();
  }

  function setFilter(patch = {}) {
    Object.assign(filter, patch);
    renderFilters();
    renderKindOptions();
    renderStatus();
    renderList();
    emit();
  }

  function setBusy(on) {
    busy = on;
    el.classList.toggle("is-busy", on);
    refreshBtn.disabled = on;
    refreshBtn.classList.toggle("is-spinning", on);
    refreshBtn.setAttribute("aria-busy", on ? "true" : "false");
    const waiting = on && !pool.length;
    syncToolbar();
    if (waiting && showSkeleton) {
      renderSkeleton();
      skeletonEl.hidden = false;
      listEl.hidden = true;
    } else {
      skeletonEl.hidden = true;
      listEl.hidden = false;
      mount(skeletonEl, null);
    }
  }

  async function refresh() {
    if (!source || busy) return;
    setBusy(true);
    error = null;
    renderStatus();
    try {
      const next = await source.fetch();
      hasLoaded = true;
      setItems(next);
    } catch (err) {
      hasLoaded = true;
      error = err instanceof Error ? err : new Error(String(err));
      renderStatus();
      renderList();
      if (typeof onError === "function") onError(error);
    } finally {
      setBusy(false);
    }
  }

  render();

  return {
    el,
    refresh,
    setItems,
    setFilter,
    getItems: () => pool,
    getFiltered: filteredItems,
    get filter() {
      return { ...filter };
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    destroy: () => {
      el.remove();
    },
  };
}
