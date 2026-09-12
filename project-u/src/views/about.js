// ============================================================================
//  View — About & user guide
//  Plain-language explanations of what Project-U is and how to use each screen.
// ============================================================================

import { h } from "../framework/dom.js";
import { PU } from "../framework/pu.js";
import { pageHeader, card, grid, badge, codeBlock } from "./helpers.js";
import { listMembers, memberUrl } from "../framework/members.js";

const SCREENS = [
  {
    id: "home",
    title: "Home",
    text: "The launcher: a card for every Project U generator. Click a card to open it in a new tab, or use the copy button to grab a shareable link. Pin the ones you use most, and the Recently used row keeps your last few launches one click away. The card you launched last is marked “In focus”. A compact “What's happening” card previews the latest suite-wide activity.",
  },
  {
    id: "activity",
    title: "Activity",
    text: "A live stream of events from across the suite — quotes, tickets, renewals, documentation changes and framework releases. The stats row up top highlights what needs attention (open quotes, pending tickets, renewals due, draft invoices), and every event is colour-coded by its generator. Filter by generator or type to focus in.",
  },
  { id: "settings", title: "Settings", text: "Switch theme and colour mode, rebrand the palette and naming, edit your account details, manage pins and recent history, enable or disable optional sections, and manage stored preferences." },
  { id: "tests", title: "Tests", text: "Runs the hub's validation suite in the browser and reports pass/fail with timings and error messages." },
  { id: "about", title: "About", text: "This page — what everything does and where the developer documentation lives." },
];

export function render(outlet, ctx) {
  const { app } = ctx;
  const tools = listMembers({ includeFramework: false });
  const framework = listMembers({ kind: "framework" });

  outlet.replaceChildren(
    pageHeader({
      title: "About & user guide",
      subtitle: `${PU.family} — one front door to the whole suite.`,
      icon: "book",
    }),

    grid(
      [
        card({
          title: "What this is",
          body: h(
            "div",
            { class: "pu-prose" },
            h("p", {}, "Project-U is the central dashboard hub for the Project U family of small-business generators. Instead of remembering a dozen separate tools, you start here: launch any member generator, search across the suite and see what needs attention."),
            h("p", {}, "It is built on the same shared framework as every member tool, so the header, navigation, theme and components behave exactly as you expect from one -U generator to the next.")
          ),
        }),
        card({
          title: "Getting around",
          body: h(
            "div",
            { class: "pu-prose" },
            h("ul", { class: "pu-list" }, [
              h("li", {}, "Press ⌘K (Mac) or Ctrl+K anywhere — or click the search box in the header — to open the command palette and jump to any generator, section or action."),
              h("li", {}, "Use the sidebar (or the menu button on a phone) to move between sections."),
              h("li", {}, "Switch the active business with the workspace selector in the header."),
              h("li", {}, "The sun/moon button switches light and dark mode instantly, and remembers your choice."),
              h("li", {}, "Every section has a deep link — e.g. share the URL ending in #/settings."),
              h("li", {}, "Press the pin button on any launcher card to float the generators you use most to the top; your pins and recent history are remembered in this browser."),
              h("li", {}, "Open the Activity section to see a suite-wide stream of latest events, roll-ups of what needs attention, and a per-generator breakdown."),
            ]),
            h(
              "div",
              { class: "pu-btn-row pu-btn-row--wrap" },
              h("button", { class: "pu-btn pu-btn--secondary pu-btn--sm", type: "button", onclick: () => app.navigate("settings") }, "Open Settings"),
              h("button", { class: "pu-btn pu-btn--ghost pu-btn--sm", type: "button", onclick: () => app.navigate("tests") }, "Open Tests")
            )
          ),
        }),
      ],
      { cols: 2 }
    ),

    card({
      title: "Sections",
      subtitle: "What each screen is for.",
      body: h(
        "div",
        { class: "pu-def-list" },
        SCREENS.map((screen) =>
          h(
            "div",
            { class: "pu-def-row" },
            h("div", { class: "pu-def-term" }, h("a", { href: app.router.href(screen.id), class: "pu-def-link" }, screen.title)),
            h("div", { class: "pu-def-desc" }, screen.text)
          )
        )
      ),
    }),

    card({
      title: "Command palette",
      subtitle: "Search the whole hub from the keyboard.",
      body: h(
        "div",
        { class: "pu-prose" },
        h("p", {}, "Press ⌘K (Mac) or Ctrl+K — or click the header search box — to open the palette. It searches every member generator, every enabled section and a few quick actions at once."),
        h("ul", { class: "pu-list" }, [
          h("li", {}, h("strong", {}, "↑ / ↓"), " move the highlight, ", h("strong", {}, "Enter"), " runs it."),
          h("li", {}, h("strong", {}, "Enter"), " on a generator opens it in a new tab (and marks it “In focus”); ", h("strong", {}, "Alt+Enter"), " copies its shareable link instead."),
          h("li", {}, "Sections jump straight to the screen; actions like “Switch to dark mode” run instantly."),
          h("li", {}, h("strong", {}, "Esc"), " closes the palette and returns focus to where you were."),
        ])
      ),
    }),

    card({
      title: "Activity feed",
      subtitle: "What's happening across the whole suite, in one place.",
      body: h(
        "div",
        { class: "pu-prose" },
        h("p", {}, "The Activity section aggregates a stream of latest items from every member generator — new and sent quotes, open and pending tickets, renewals coming due, draft invoices, documentation and credential changes, and framework releases."),
        h("ul", { class: "pu-list" }, [
          h("li", {}, "The ", h("strong", {}, "stats row"), " at the top rolls the stream up into counts (open quotes, pending tickets, renewals due, draft invoices) plus a “Needs attention” tally of high-priority items."),
          h("li", {}, "Every event is ", h("strong", {}, "colour-coded by its generator"), " — the same accent colours used on the launcher cards — and grouped under Today / Yesterday / Earlier this week."),
          h("li", {}, "Filter by generator with the chips, or by type with the dropdown; ", h("strong", {}, "Refresh"), " re-pulls the latest."),
          h("li", {}, "Each event links straight through to its generator with the arrow button on the right."),
        ]),
        h("p", { class: "pu-muted" }, "In this build the feed is served by a deterministic simulated API (src/framework/activity.js), so the data is illustrative — swap in a real endpoint later without changing the UI."),
        h("button", { class: "pu-btn pu-btn--secondary pu-btn--sm", type: "button", onclick: () => app.navigate("activity") }, "Open Activity")
      ),
    }),

    card({
      title: "Loading, empty & error states",
      subtitle: "What the hub shows while it waits — and when something goes wrong.",
      body: h(
        "div",
        { class: "pu-prose" },
        h("ul", { class: "pu-list" }, [
          h("li", {}, "While the member directory loads the launcher shows ", h("strong", {}, "skeleton cards"), "; the Activity screen shows skeleton stats and stream rows until its data arrives. Skeletons are placeholders — nothing to click, they simply say “loading”."),
          h("li", {}, "If the ", h("strong", {}, "member directory"), " can't be reached the launcher falls back to the registry built into this generator and shows a warning with a ", h("strong", {}, "Try again"), " button, so it is never blank."),
          h("li", {}, "If the ", h("strong", {}, "activity stream"), " fails on first load the feed shows an error with a ", h("strong", {}, "Try again"), " button; if only a later refresh fails it keeps the events already on screen and shows a smaller inline warning with a ", h("strong", {}, "Retry"), "."),
          h("li", {}, "Empty states are explicit — “No activity to show yet”, “No generator in focus yet”, “No matching records” — so a blank area always tells you why it is blank."),
          h("li", {}, "A filtered Activity view can be ", h("strong", {}, "shared as a deep link"), " — e.g. ", h("code", {}, "#/activity?member=quote-u&kind=quote"), " — and offers a ", h("strong", {}, "Clear filter"), " action."),
          h("li", {}, "Short ", h("strong", {}, "toast notifications"), " (bottom of the screen) confirm launches, copies, pins and setting changes."),
        ])
      ),
    }),

    card({
      title: "Pins, recents & preferences",
      subtitle: "Make the hub remember how you work.",
      body: h(
        "div",
        { class: "pu-prose" },
        h("p", {}, "The pin button in the top-right of every launcher card floats that generator to the top of the grid — and to the top of the command palette. A pinned card is outlined in its own accent colour."),
        h("ul", { class: "pu-list" }, [
          h("li", {}, "The ", h("strong", {}, "Recently used"), " row under the launcher keeps your last few launches, newest first, with a one-click return link."),
          h("li", {}, "Both pins and history are saved locally in this browser, so they are still there after a reload."),
          h("li", {}, "Open ", h("strong", {}, "Settings → Preferences"), " to edit your account details, change how many recent items are kept, turn pin-first ordering on or off, and clear pins or history."),
        ])
      ),
    }),

    card({
      title: "The Project U suite",
      subtitle: "Every member generator the hub can launch.",
      body: h(
        "div",
        { class: "pu-def-list" },
        tools.map((member) =>
          h(
            "div",
            { class: "pu-def-row" },
            h("div", { class: "pu-def-term" }, h("a", { href: memberUrl(member), class: "pu-def-link", target: "_blank", rel: "noopener" }, member.name)),
            h("div", { class: "pu-def-desc" }, member.description)
          )
        )
      ),
    }),

    grid(
      [
        card({
          title: "Changing the look",
          body: h(
            "ol",
            { class: "pu-steps" },
            [
              "Open Settings → Appearance and pick a palette. Navy is the Project U default and is a light-mode theme.",
              "Use “Switch to dark mode” (or the header button) for the Midnight dark palette.",
              "To rebrand, edit the colours, title, tagline and logo in Settings → Branding, then press Apply.",
              "Colour changes are applied as theme tokens, so they propagate everywhere automatically.",
            ].map((step, index) => h("li", {}, h("span", { class: "pu-step-num" }, String(index + 1)), h("span", {}, step)))
          ),
        }),
        card({
          title: "For developers",
          body: h(
            "div",
            { class: "pu-prose" },
            h("p", {}, "The framework API is exposed on window.PU (utilities, store, bus, storage, theme, router, registry, member registry, launcher, commands, activity and state). Documentation lives next to the source:"),
            codeBlock("src/README.md"),
            h(
              "div",
              { class: "pu-btn-row pu-btn-row--wrap" },
              badge("window.PU", "info"),
              badge(`v${PU.version}`, "neutral"),
              framework.length ? badge(framework.map((m) => m.name).join(", "), "neutral") : null
            )
          ),
        }),
      ],
      { cols: 2 }
    )
  );
}
