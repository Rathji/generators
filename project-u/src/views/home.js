// ============================================================================
//  View — Home / launcher grid (Phase 2, tasks 6-9)
//  The front door. A responsive grid of launcher cards generated straight from
//  the Member Registry: each card carries the member's icon, name, one-line
//  description and accent colour, deep-links to its registered top-level URL,
//  and reflects the launcher's "in focus" (last launched) state.
// ============================================================================

import { h, svgIcon } from "../framework/dom.js";
import { PU } from "../framework/pu.js";
import { cx, formatRelativeTime } from "../framework/utils.js";
import { listMembers } from "../framework/members.js";
import { summarizeActivity } from "../framework/activity.js";
import { activityItemEl } from "../components/activity-feed.js";
import { skeletonLaunchGrid } from "../components/skeleton.js";
import { pageHeader, card, badge, banner, grid } from "./helpers.js";

// The launcher reads its members from an async directory (`app.roster`). Until
// it answers we show skeleton cards; if it fails we fall back to the bundled
// registry that ships with the generator, so the hub is never blank
// (Phase 6, tasks 27-28). When no roster is wired up (tests, embeds) the
// bundled list is used directly.
function directoryState(app) {
  const roster = app.roster || null;
  if (!roster) return { status: "ready", members: listMembers(), error: null };
  if (roster.loaded) return { status: "ready", members: roster.members, error: null };
  if (roster.error) return { status: "error", members: listMembers(), error: roster.error };
  return { status: "loading", members: [], error: null };
}

function tagChip(text) {
  return h("span", { class: "pu-launch-tag" }, text);
}

function memberCard(member, ctx) {
  const { app } = ctx;
  const active = app.state.activeMemberId === member.id;
  const pinned = app.preferences.isPinned(member.id);
  const url = app.memberLink(member);
  const markActive = () => app.markActiveMember(member);
  const launchFromCard = () => {
    const result = app.launchMember(member);
    if (!result.ok) app.toaster.error(`Could not open ${member.name}.`);
  };

  const nameLink = h(
    "a",
    {
      class: "pu-launch-name",
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      title: `Open ${member.name} in a new tab`,
      onclick: markActive,
    },
    member.name
  );

  const pinBtn = h(
    "button",
    {
      class: cx("pu-launch-pin", pinned && "is-pinned"),
      type: "button",
      title: pinned ? `Unpin ${member.name}` : `Pin ${member.name} to the top`,
      "aria-label": pinned ? `Unpin ${member.name} from the top of the launcher` : `Pin ${member.name} to the top of the launcher`,
      "aria-pressed": pinned ? "true" : "false",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nowPinned = app.togglePin(member);
        if (nowPinned) app.toaster.success(`${member.name} pinned to the top.`, { duration: 1800 });
        else app.toaster.info(`${member.name} unpinned.`, { duration: 1600 });
      },
    },
    svgIcon("pin", { size: 15 })
  );

  const openBtn = h(
    "a",
    { class: "pu-launch-open", href: url, target: "_blank", rel: "noopener noreferrer", onclick: markActive },
    "Launch",
    svgIcon("external", { size: 14 })
  );

  const copyBtn = h(
    "button",
    {
      class: "pu-launch-copy",
      type: "button",
      title: `Copy a shareable link to ${member.name}`,
      "aria-label": `Copy a shareable link to ${member.name}`,
      onclick: async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const result = await app.copyMemberLink(member);
        if (result.ok) app.toaster.success(`${member.name} link copied.`, { duration: 2000 });
        else app.toaster.error(`Could not copy the link to ${member.name}.`);
      },
    },
    svgIcon("copy", { size: 15 })
  );

  const el = h(
    "article",
    {
      class: cx("pu-launch", active && "is-active", pinned && "is-pinned"),
      dataset: { member: member.id, pinned: pinned ? "true" : "false" },
      "aria-current": active ? "true" : null,
      onclick: (event) => {
        if (event.target.closest("a, button")) return;
        launchFromCard();
      },
    },
    h(
      "header",
      { class: "pu-launch-head" },
      h("span", { class: "pu-launch-icon" }, svgIcon(member.icon, { size: 20 })),
      h("span", { class: "pu-launch-titles" }, nameLink, h("span", { class: "pu-launch-cat" }, member.category)),
      h(
        "span",
        { class: "pu-launch-flags" },
        active ? h("span", { class: "pu-launch-current" }, badge("In focus", "success", { icon: "check" })) : null,
        pinBtn
      )
    ),
    h("p", { class: "pu-launch-desc" }, member.description),
    member.tags && member.tags.length
      ? h("span", { class: "pu-launch-tags" }, member.tags.slice(0, 4).map(tagChip))
      : null,
    h("footer", { class: "pu-launch-foot" }, openBtn, copyBtn)
  );
  el.style.setProperty("--pu-launch-accent", member.accent);
  return el;
}

// Phase 4, task 17 — the last few generators opened, ready for a return visit.
function recentsSection(ctx) {
  const { app } = ctx;
  const entries = app.recentMembers();

  const chips = entries.map((entry) => {
    const member = entry.member;
    const chip = h(
      "a",
      {
        class: "pu-recent",
        href: app.memberLink(member),
        target: "_blank",
        rel: "noopener noreferrer",
        title: `Open ${member.name} in a new tab`,
        dataset: { member: member.id },
        onclick: () => app.markActiveMember(member),
      },
      h("span", { class: "pu-recent-icon" }, svgIcon(member.icon, { size: 16 })),
      h(
        "span",
        { class: "pu-recent-text" },
        h("span", { class: "pu-recent-name" }, member.name),
        h("span", { class: "pu-recent-time" }, entry.at ? formatRelativeTime(entry.at) : "recently")
      )
    );
    chip.style.setProperty("--pu-launch-accent", member.accent);
    return chip;
  });

  return card({
    title: "Recently used",
    subtitle: `Your last ${app.preferences.maxRecents} launches, newest first.`,
    className: "pu-recents",
    actions: entries.length
      ? h(
          "button",
          {
            class: "pu-btn pu-btn--ghost pu-btn--sm",
            type: "button",
            onclick: () => {
              app.preferences.clearRecents();
              app.toaster.info("Recent history cleared.", { duration: 1600 });
            },
          },
          "Clear history"
        )
      : null,
    body: entries.length
      ? h("div", { class: "pu-recent-row" }, chips)
      : h("p", { class: "pu-recent-empty" }, "Generators you launch from the hub appear here for one-click return visits."),
  });
}

// Phase 5 — a compact window onto the aggregated activity feed (task 21).
function activityCard(ctx) {
  const { app } = ctx;
  const items = app.activity.all();
  const summary = summarizeActivity(items);

  return card({
    title: "What's happening",
    subtitle: "The latest events across every Project U member.",
    className: "pu-home-activity",
    actions: h(
      "button",
      { class: "pu-btn pu-btn--ghost pu-btn--sm", type: "button", onclick: () => app.navigate("activity") },
      "View all activity"
    ),
    body: h(
      "div",
      { class: "pu-home-activity-body" },
      summary.highlights.length
        ? h(
            "div",
            { class: "pu-activity-chips" },
            summary.highlights.slice(0, 4).map((metric) =>
              h(
                "span",
                { class: "pu-activity-chip", dataset: { metric: metric.id } },
                h("span", { class: "pu-activity-chip-value" }, String(metric.count)),
                h("span", { class: "pu-activity-chip-label" }, metric.label)
              )
            )
          )
        : null,
      h("div", { class: "pu-feed-list pu-feed-list--compact" }, items.slice(0, 3).map(activityItemEl))
    ),
  });
}

function launcherSection(ctx, directory) {
  const { app } = ctx;
  const { status, members, error } = directory;
  const active = members.find((member) => member.id === app.state.activeMemberId) || null;
  const pinnedCount = members.filter((member) => app.preferences.isPinned(member.id)).length;
  const loading = status === "loading";

  const bar = h(
    "div",
    { class: "pu-launch-bar" },
    h(
      "div",
      { class: "pu-launch-bar-text" },
      h(
        "span",
        { class: "pu-launch-count" },
        loading ? "Loading the member directory…" : `${members.length} generator${members.length === 1 ? "" : "s"} wired up`
      ),
      h(
        "span",
        { class: "pu-launch-hint" },
        loading
          ? "Fetching the latest registry from the Project U directory."
          : pinnedCount
            ? `${pinnedCount} pinned to the top · cards open in a new tab.`
            : "Cards open in a new tab — use the copy button for a shareable link."
      )
    ),
    loading
      ? h("span", { class: "pu-skel-block pu-launch-focus-skel", "aria-hidden": "true" })
      : active
        ? h(
            "span",
            { class: "pu-launch-focus" },
            h("span", { class: "pu-launch-focus-dot", style: { background: active.accent } }),
            "In focus: ",
            h("strong", {}, active.name),
            h(
              "button",
              {
                class: "pu-launch-focus-clear",
                type: "button",
                title: "Clear the current focus",
                "aria-label": "Clear the current focus",
                onclick: () => app.clearActiveMember(),
              },
              svgIcon("close", { size: 13 })
            )
          )
        : h("span", { class: "pu-launch-focus pu-launch-focus--none" }, "No generator in focus yet — launch one to mark it.")
  );

  const notice =
    status === "error"
      ? banner({
          tone: "warning",
          title: "Showing the bundled member list",
          children: h(
            "span",
            { class: "pu-launch-notice" },
            `Couldn't reach the member directory${error && error.message ? ` (${error.message})` : ""}. The registry built into this generator is shown instead. `,
            h(
              "button",
              { class: "pu-link-btn", type: "button", onclick: () => (app.reloadRoster ? app.reloadRoster() : app.router.render()) },
              "Try again"
            )
          ),
        })
      : null;

  return card({
    title: "Launch a generator",
    subtitle: "Every Project U member, one click away.",
    className: "pu-launcher",
    body: h(
      "div",
      { class: "pu-launcher-body" },
      bar,
      notice,
      loading
        ? skeletonLaunchGrid({ count: 6 })
        : h("div", { class: "pu-launch-grid" }, members.map((member) => memberCard(member, ctx)))
    ),
  });
}

export function render(outlet, ctx) {
  const { app } = ctx;
  const { branding, theme, state, registry, preferences } = app;
  const directory = directoryState(app);
  const members = app.orderMembers(directory.members);
  const active = state.activeWorkspace();
  const user = state.get().user;
  const enabled = registry.list({ enabledOnly: true });

  outlet.replaceChildren(
    pageHeader({
      title: branding.get().appTitle,
      subtitle: branding.get().tagline,
      icon: "home",
      actions: [
        h("button", { class: "pu-btn pu-btn--ghost", type: "button", onclick: () => app.navigate("about") }, "What is this?"),
        h("button", { class: "pu-btn pu-btn--primary", type: "button", onclick: () => app.navigate("settings") }, "Settings"),
      ],
    }),

    banner({
      tone: "info",
      title: `${PU.family} hub`,
      children: active
        ? `You are working in ${active.name} as ${user.name}. Launch any member below; it opens on perchance.org with your project's context.`
        : "No workspace selected yet.",
    }),

    recentsSection(ctx),

    launcherSection(ctx, { ...directory, members }),

    app.activity ? activityCard(ctx) : null,

    grid(
      [
        card({
          title: "Workspace & account",
          subtitle: "The active workspace and signed-in user drive every member tool.",
          body: h(
            "div",
            { class: "pu-stack-2" },
            h(
              "div",
              { class: "pu-context-card" },
              h("span", { class: "pu-context-label" }, "Active workspace"),
              h("span", { class: "pu-context-value" }, active ? active.name : "—"),
              active ? h("span", { class: "pu-context-hint" }, `${active.kind} · ${active.plan} plan`) : null
            ),
            h(
              "div",
              { class: "pu-context-card" },
              h("span", { class: "pu-context-label" }, "Current user"),
              h("span", { class: "pu-context-value" }, user.name),
              h("span", { class: "pu-context-hint" }, `${user.role} · ${user.email}`)
            ),
            h(
              "div",
              { class: "pu-context-card" },
              h("span", { class: "pu-context-label" }, "Workspaces"),
              h(
                "div",
                { class: "pu-btn-row pu-btn-row--wrap" },
                state.getWorkspaces().map((workspace) => badge(workspace.name, workspace.id === (active && active.id) ? "success" : "neutral"))
              )
            )
          ),
        }),
        card({
          title: "Hub at a glance",
          subtitle: "How this hub is configured right now.",
          body: h(
            "ul",
            { class: "pu-list" },
            [
              ["Members registered", directory.status === "loading" ? "—" : `${members.length}`],
              ["Pinned to the top", `${preferences.pinned.length}`],
              ["Recent history", `${preferences.recents.length} of ${preferences.maxRecents}`],
              ["Sections enabled", `${enabled.length}/${registry.list().length}`],
              ["Active theme", `${theme.get().label} (${theme.get().mode})`],
              ["Version", `v${branding.get().version || PU.version}`],
            ].map(([label, value]) => h("li", { class: "pu-list-row" }, h("span", { class: "pu-list-label" }, label), badge(value, "neutral")))
          ),
        }),
      ],
      { cols: 2 }
    )
  );
}
