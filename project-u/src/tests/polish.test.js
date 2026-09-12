// ============================================================================
//  Validation tests — integration & UX polish (Phase 6, tasks 26-29)
//  Covers the skeleton primitives, the async member directory (loading + error
//  fallback), the feed's loading/error states, the deep-linkable activity view
//  and the "front door" guarantees shared by the launcher and palette.
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import { createActivitySource, generateActivity, materializeActivity, summarizeActivity } from "../framework/activity.js";
import { MEMBERS, createMemberSource, listMembers, memberUrl } from "../framework/members.js";
import { createActivityFeed } from "../components/activity-feed.js";
import { skeletonFeed, skeletonLaunchGrid, skeletonStatTiles, skeletonSourceRows, skeletonBlock } from "../components/skeleton.js";
import { createRouter } from "../framework/router.js";
import * as activityView from "../views/activity.js";
import * as homeView from "../views/home.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeApp({ activity = null, roster = null } = {}) {
  return {
    activity,
    roster,
    branding: { get: () => ({ appTitle: "Project-U", tagline: "Hub", version: "0.1.0" }) },
    theme: { get: () => ({ label: "Navy", mode: "light" }) },
    state: {
      activeWorkspace: () => ({ id: "w1", name: "Workspace", kind: "business", plan: "pro" }),
      get: () => ({ user: { name: "A M", role: "Owner", email: "a@b.co", initials: "AM" } }),
      getWorkspaces: () => [{ id: "w1", name: "Workspace" }],
      activeMemberId: null,
    },
    registry: { list: () => [{ id: "home" }, { id: "activity" }, { id: "settings" }] },
    preferences: {
      pinned: [],
      recents: [],
      maxRecents: 5,
      orderMembers: (members) => members,
      isPinned: () => false,
      togglePin: () => false,
      clearRecents() {},
    },
    toaster: { success() {}, info() {}, error() {}, warning() {} },
    navigate() {},
    memberLink: (member) => memberUrl(member),
    recentMembers: () => [],
    orderMembers: (members) => members,
    launchMember: () => ({ ok: true }),
    markActiveMember: () => ({}),
    clearActiveMember() {},
    copyMemberLink: async () => ({ ok: true }),
  };
}

// A source whose fetch never settles until the test says so — lets us observe
// the loading/skeleton window deterministically.
function deferredSource() {
  let settle;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { fetch: () => promise, resolve: (items) => settle(items), all: () => [] };
}

export function polishSuite() {
  return createSuite("polish · loading, error & front door (phase 6)")
    // ------------------------------------------------------ skeleton primitives
    .test("skeleton primitives mark themselves as a polite status region", () => {
      const feed = skeletonFeed({ count: 3 });
      assertEqual(feed.getAttribute("role"), "status");
      assertEqual(feed.getAttribute("aria-busy"), "true");
      assert(feed.querySelector(".pu-sr-only"), "announces a loading label");
      assertEqual(feed.querySelectorAll(".pu-skel-feed-item").length, 3);
      assertEqual(feed.querySelectorAll(".pu-skel-avatar").length, 3);

      const grid = skeletonLaunchGrid({ count: 4 });
      assertEqual(grid.querySelectorAll(".pu-skel-launch").length, 4);
      assert(grid.querySelector(".pu-skel-launch .pu-skel-launch-icon"), "each card has an icon block");

      const tiles = skeletonStatTiles({ count: 5 });
      assertEqual(tiles.querySelectorAll(".pu-skel-stat").length, 5);
      const rows = skeletonSourceRows({ count: 3 });
      assertEqual(rows.querySelectorAll(".pu-source-row").length, 3);

      const block = skeletonBlock({ width: 80, height: 12 });
      assertEqual(block.style.width, "80px");
      assertEqual(block.style.height, "12px");
      assertEqual(block.getAttribute("aria-hidden"), "true");
    })

    // ---------------------------------------------------- member source (async)
    .test("createMemberSource fetches once, caches, invalidates and reports failure", async () => {
      const source = createMemberSource({ latency: 0 });
      assertEqual(source.loaded, false);
      assertEqual(source.error, null);

      const list = await source.fetch();
      assertEqual(list.length, MEMBERS.length);
      assertEqual(source.loaded, true);
      assertEqual(source.busy, false);
      assertEqual(await source.fetch(), list, "second call is served from cache");

      source.invalidate();
      assertEqual(source.loaded, false);

      const failing = createMemberSource({ latency: 0, failWith: new Error("directory unreachable") });
      let caught = null;
      try {
        await failing.fetch();
      } catch (error) {
        caught = error;
      }
      assert(caught && caught.message === "directory unreachable");
      assertEqual(failing.loaded, false);
      assertEqual(failing.error.message, "directory unreachable");

      const custom = createMemberSource({ loader: () => [MEMBERS[0]] });
      assertEqual((await custom.fetch()).length, 1);

      const empty = createMemberSource({ loader: () => [] });
      let emptyCaught = null;
      try {
        await empty.fetch();
      } catch (error) {
        emptyCaught = error;
      }
      assert(emptyCaught, "an empty directory payload is rejected");
    })

    // ---------------------------------------------------- launcher (home) states
    .test("the launcher shows skeleton cards while the directory loads", () => {
      const outlet = document.createElement("div");
      homeView.render(outlet, { app: fakeApp({ roster: { loaded: false, error: null, members: [], busy: true } }) });

      assertEqual(outlet.querySelectorAll(".pu-skel-launch").length, 6, "six placeholder cards");
      assertEqual(outlet.querySelectorAll(".pu-launch").length, 0, "no real cards yet");
      assert(outlet.querySelector(".pu-launch-count").textContent.includes("Loading"), "announces the wait");
      assert(outlet.querySelector('[role="status"]'), "the grid is a live status region");
    })

    .test("the launcher falls back to the bundled registry when the directory fails", () => {
      let retried = 0;
      const app = fakeApp({ roster: { loaded: false, error: new Error("directory unreachable"), members: [], busy: false } });
      app.reloadRoster = () => {
        retried += 1;
      };
      const outlet = document.createElement("div");
      homeView.render(outlet, { app });

      assertEqual(outlet.querySelectorAll(".pu-launch").length, MEMBERS.length, "the full bundled list still renders");
      const notice = outlet.querySelector(".pu-banner--warning");
      assert(notice, "a warning explains the fallback");
      assert(notice.textContent.includes("bundled member list"));
      const retry = [...outlet.querySelectorAll("button")].find((btn) => btn.textContent.includes("Try again"));
      assert(retry, "a retry control is offered");
      retry.click();
      assertEqual(retried, 1);
    })

    // ------------------------------------------------------- feed states
    .test("the feed shows a skeleton while its source fetches, then the stream", async () => {
      const source = deferredSource();
      const outlet = document.createElement("div");
      const feed = createActivityFeed({ source, items: [] });
      outlet.appendChild(feed.el);

      const pending = feed.refresh();
      assertEqual(feed.busy, true);
      assertEqual(outlet.querySelector(".pu-feed-skeleton").hidden, false, "skeleton is visible");
      assertEqual(outlet.querySelectorAll(".pu-skel-feed-item").length, 5);
      assertEqual(outlet.querySelector(".pu-feed-toolbar").hidden, true, "no empty filter bar while loading");
      assertEqual(outlet.querySelectorAll(".pu-feed-item").length, 0);

      source.resolve(materializeActivity(generateActivity({ count: 8, seed: 3 })));
      await pending;
      assertEqual(feed.busy, false);
      assertEqual(outlet.querySelector(".pu-feed-skeleton").hidden, true, "skeleton is cleared");
      assertEqual(outlet.querySelectorAll(".pu-feed-item").length, 8);
      assertEqual(outlet.querySelector(".pu-feed-toolbar").hidden, false);
      feed.destroy();
    })

    .test("a failed first fetch shows a full error state with a retry control", async () => {
      const outlet = document.createElement("div");
      let reported = null;
      const feed = createActivityFeed({
        source: { fetch: () => Promise.reject(new Error("service offline")) },
        items: [],
        onError: (error) => {
          reported = error;
        },
      });
      outlet.appendChild(feed.el);
      await feed.refresh();

      const block = outlet.querySelector(".pu-feed-error--block");
      assert(block, "block error state");
      assertEqual(block.getAttribute("role"), "alert");
      assert(block.textContent.includes("service offline"));
      assert(block.querySelector(".pu-btn"), "offers Try again");
      assertEqual(feed.error.message, "service offline");
      assert(reported && reported.message === "service offline", "onError is reported to the parent");
      feed.destroy();
    })

    .test("a failed refresh keeps the last good stream and warns inline", async () => {
      const items = materializeActivity(generateActivity({ count: 6, seed: 2 }));
      const outlet = document.createElement("div");
      const feed = createActivityFeed({ source: { fetch: () => Promise.reject(new Error("network")) }, items });
      outlet.appendChild(feed.el);
      assertEqual(outlet.querySelectorAll(".pu-feed-item").length, 6);

      await feed.refresh();
      const inline = outlet.querySelector(".pu-feed-error--inline");
      assert(inline, "inline warning shown");
      assertEqual(outlet.querySelectorAll(".pu-feed-item").length, 6, "previous items are preserved");
      assertEqual(outlet.querySelector(".pu-feed-error--block"), null, "not a blank-slate error");
      feed.destroy();
    })

    // ------------------------------------------------------- activity view states
    .test("the activity view renders skeleton stats and stream while loading", async () => {
      const source = deferredSource();
      const outlet = document.createElement("div");
      activityView.render(outlet, { app: fakeApp({ activity: source }) });

      assertEqual(outlet.querySelectorAll(".pu-skel-stat").length, 5, "skeleton stat tiles");
      assertEqual(outlet.querySelectorAll(".pu-stat").length, 0, "no real tiles yet");
      assert(outlet.querySelector(".pu-skel-feed-item"), "skeleton stream");

      source.resolve(materializeActivity(generateActivity({ count: 24, seed: 4 })));
      await tick();
      await tick();
      assert(outlet.querySelectorAll(".pu-stat").length >= 1, "real tiles replace the skeletons");
      assertEqual(outlet.querySelectorAll(".pu-skel-stat").length, 0);
      assert(outlet.querySelectorAll(".pu-feed-item").length > 0);
    })

    .test("the activity view degrades gracefully when the source is offline", async () => {
      const outlet = document.createElement("div");
      activityView.render(outlet, { app: fakeApp({ activity: { fetch: () => Promise.reject(new Error("offline")) } }) });
      await tick();
      await tick();

      assert(outlet.querySelector(".pu-stats-error"), "stats strip reports the outage");
      assert(outlet.querySelector(".pu-feed-error--block"), "the stream shows a retry state");
      assertEqual(outlet.querySelectorAll(".pu-skel-stat").length, 0, "no skeletons left hanging");
    })

    // ------------------------------------------------- deep links (task 29)
    .test("a query-filtered activity deep link pre-filters the stream", async () => {
      const outlet = document.createElement("div");
      const source = createActivitySource({ latency: 0, count: 48, seed: 11 });
      activityView.render(outlet, { app: fakeApp({ activity: source }), query: { member: "quote-u" } });
      await tick();

      const items = [...outlet.querySelectorAll(".pu-feed-item")];
      assert(items.length > 0, "the filtered stream is not empty");
      assert(items.every((el) => el.dataset.member === "quote-u"), "only Quote-U events");
      const active = [...outlet.querySelectorAll(".pu-feed-chip")].find((chip) => chip.classList.contains("is-active"));
      assert(active && active.textContent.includes("Quote-U"), "the matching chip is active");
      assert(outlet.querySelector(".pu-page-title").textContent.includes("Quote-U"), "the heading names the filter");
      const clear = [...outlet.querySelectorAll("button")].find((btn) => btn.textContent.includes("Clear filter"));
      assert(clear, "a clear-filter control is offered");
    })

    .test("the router parses and rebuilds query deep links for the hub", () => {
      const router = createRouter({ routes: [{ path: "home" }, { path: "activity" }], defaultRoute: "home" });
      const ctx = router.resolve("#/activity?member=quote-u&kind=quote");
      assertEqual(ctx.path, "activity");
      assertDeepEqual(ctx.query, { member: "quote-u", kind: "quote" });
      assertEqual(router.href("activity", { member: "quote-u", kind: "quote" }), "#/activity?member=quote-u&kind=quote");
      assertEqual(router.resolve("#/activity").query.member, undefined);
    })

    .test("every launcher and feed link is a top-level perchance.org URL", () => {
      const source = createActivitySource({ latency: 0, count: 12, seed: 6 });
      const outlet = document.createElement("div");
      homeView.render(outlet, { app: fakeApp({ activity: source, roster: { loaded: true, error: null, members: listMembers(), busy: false } }) });

      const links = [...outlet.querySelectorAll(".pu-launch-open, .pu-launch-name, .pu-recent")];
      assert(links.length > 0);
      for (const link of links) {
        assertEqual(link.target, "_blank");
        assert(link.getAttribute("href").startsWith("https://perchance.org/"), `top-level link (${link.getAttribute("href")})`);
        assert(!link.getAttribute("href").includes(".perchance.org"), "never the iframe subdomain");
      }
    });
}
