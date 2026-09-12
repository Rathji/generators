// ============================================================================
//  View — Activity (Phase 5, tasks 21-24 · Phase 6, tasks 27-29)
//  The aggregated dashboard: a quick-stats row that rolls up the feed counts
//  (task 24) above the colour-coded, filterable stream of events from every
//  Project U member (tasks 21-23), plus a "by generator" breakdown so it is
//  obvious where the work is coming from.
//
//  The whole page is deep-linkable — `#/activity?member=quote-u&kind=quote`
//  opens the stream pre-filtered — and every region has a skeleton while the
//  source loads and a graceful fallback if it fails (tasks 27-28).
// ============================================================================

import { h, svgIcon, mount } from "../framework/dom.js";
import { pageHeader, card, statTile } from "./helpers.js";
import { getMember } from "../framework/members.js";
import { summarizeActivity } from "../framework/activity.js";
import { createActivityFeed } from "../components/activity-feed.js";
import { skeletonStatTiles, skeletonSourceRows } from "../components/skeleton.js";

function memberName(id) {
  const member = getMember(id);
  return member ? member.name : id;
}

function hasFilter(query) {
  return Boolean(query && (query.member || query.kind));
}

export function render(outlet, ctx = {}) {
  const { app, query = {} } = ctx;
  const source = app.activity || null;
  const queryFilter = { memberId: query.member || null, kind: query.kind || null };
  const deepLinked = hasFilter(query);

  const statsHost = h("div", { class: "pu-activity-stats" });
  const sourcesHost = h("div", { class: "pu-activity-sources" });
  let loaded = false;

  function renderStats(list) {
    const summary = summarizeActivity(list);
    const tiles = [
      statTile({
        label: "Needs attention",
        value: String(summary.needsAttention),
        tone: summary.needsAttention ? "danger" : "success",
        icon: summary.needsAttention ? "warning" : "check",
        hint: summary.needsAttention ? "High priority items in the stream" : "Nothing urgent right now",
      }),
      ...summary.highlights.map((metric) =>
        statTile({ label: metric.label, value: String(metric.count), tone: metric.tone, icon: metric.icon, hint: `from ${memberName(metric.memberId)}` })
      ),
    ];
    mount(statsHost, h("div", { class: "pu-stats-row" }, tiles));
  }

  function renderSources(list) {
    const counts = new Map();
    for (const item of list) counts.set(item.memberId, (counts.get(item.memberId) || 0) + 1);
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map((entry) => entry[1]));

    const rows = entries.map(([id, count]) => {
      const member = getMember(id);
      const accent = member ? member.accent : "var(--pu-primary)";
      return h(
        "div",
        { class: "pu-source-row", dataset: { member: id } },
        h("span", { class: "pu-source-dot", style: { background: accent } }),
        h("span", { class: "pu-source-name" }, member ? member.name : id),
        h("span", { class: "pu-source-bar" }, h("span", { class: "pu-source-bar-fill", style: { width: `${Math.round((count / max) * 100)}%`, background: accent } })),
        h("span", { class: "pu-source-count" }, String(count))
      );
    });

    mount(
      sourcesHost,
      card({
        title: "By generator",
        subtitle: "Where the recent activity is coming from.",
        className: "pu-source-card",
        body: rows.length ? h("div", { class: "pu-source-list" }, rows) : h("p", { class: "pu-muted" }, "No events yet."),
      })
    );
  }

  // Loading placeholders — replaced once the source answers (task 27).
  mount(statsHost, skeletonStatTiles({ count: 5 }));
  mount(
    sourcesHost,
    card({ title: "By generator", subtitle: "Where the recent activity is coming from.", className: "pu-source-card", body: skeletonSourceRows({ count: 4 }) })
  );

  function renderLoadError(error) {
    if (loaded) return;
    mount(
      statsHost,
      h(
        "div",
        { class: "pu-stats-error", role: "alert" },
        svgIcon("warning", { size: 18 }),
        h("div", {}, h("strong", {}, "Live figures are unavailable."), h("span", {}, error && error.message ? error.message : "The activity service did not respond."))
      )
    );
    mount(
      sourcesHost,
      card({
        title: "By generator",
        subtitle: "Where the recent activity is coming from.",
        className: "pu-source-card",
        body: h("p", { class: "pu-muted" }, "Unavailable while the activity stream is offline."),
      })
    );
  }

  const feed = createActivityFeed({
    source,
    items: [],
    limit: 16,
    onUpdate: (all) => {
      loaded = true;
      renderStats(all);
      renderSources(all);
    },
    onError: renderLoadError,
    errorTitle: "We couldn't load the activity stream.",
  });

  if (deepLinked) feed.setFilter(queryFilter);

  const streamCard = card({
    title: "Activity stream",
    subtitle: deepLinked
      ? "Filtered by the link you followed — clear the filter to see everything."
      : "Latest items across the Project U suite — filter by generator or type.",
    className: "pu-activity-stream",
    body: feed.el,
  });

  const headerActions = [
    h("button", { class: "pu-btn pu-btn--ghost", type: "button", onclick: () => app.navigate("home") }, "Back to hub"),
  ];
  if (deepLinked) {
    headerActions.push(h("button", { class: "pu-btn pu-btn--ghost", type: "button", onclick: () => app.navigate("activity") }, svgIcon("close", { size: 14 }), "Clear filter"));
  }
  headerActions.push(h("button", { class: "pu-btn pu-btn--primary", type: "button", onclick: () => feed.refresh() }, svgIcon("refresh", { size: 15 }), "Refresh"));

  outlet.replaceChildren(
    pageHeader({
      title: deepLinked ? `Activity · ${filterLabel(queryFilter)}` : "Activity",
      subtitle: "Everything happening across the Project U suite, newest first.",
      icon: "chart",
      actions: headerActions,
    }),
    statsHost,
    h("div", { class: "pu-activity-layout" }, streamCard, sourcesHost)
  );

  feed.refresh();
}

function filterLabel(filter) {
  const parts = [];
  if (filter.memberId) parts.push(memberName(filter.memberId));
  if (filter.kind) parts.push(filter.kind.charAt(0).toUpperCase() + filter.kind.slice(1));
  return parts.join(" · ");
}
