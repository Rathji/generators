// ============================================================================
//  Validation tests — aggregated activity feed (Phase 5, tasks 21-24)
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import {
  createActivitySource,
  filterActivity,
  generateActivity,
  groupActivityByDay,
  materializeActivity,
  sortActivity,
  summarizeActivity,
  ACTIVITY_KINDS,
  ACTIVITY_METRICS,
  DEFAULT_ACTIVITY_COUNT,
} from "../framework/activity.js";
import { createActivityFeed, activityItemEl, kindMeta } from "../components/activity-feed.js";
import { getMember, listMembers, memberUrl } from "../framework/members.js";
import * as activityView from "../views/activity.js";
import * as homeView from "../views/home.js";

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();

function fakeApp(activity) {
  return {
    activity,
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

export function activitySuite() {
  return createSuite("activity · aggregated feed & stats")
    .test("generateActivity is deterministic and respects the requested count", () => {
      const a = generateActivity({ count: 12, seed: 7 });
      const b = generateActivity({ count: 12, seed: 7 });
      assertEqual(a.length, 12);
      assertDeepEqual(a.map((item) => item.id), b.map((item) => item.id));
      assertDeepEqual(a.map((item) => item.title), b.map((item) => item.title));
      assertEqual(generateActivity({ count: 0 }).length, 0);
      assertEqual(generateActivity().length, DEFAULT_ACTIVITY_COUNT);
    })
    .test("every generated item is well-formed and resolves to a registry member", () => {
      const items = generateActivity({ count: 40, seed: 3 });
      const knownKinds = Object.keys(ACTIVITY_KINDS);
      for (const item of items) {
        assert(typeof item.id === "string" && item.id, "id");
        assert(item.title && typeof item.title === "string", "title");
        assert(knownKinds.includes(item.kind), `known kind (${item.kind})`);
        assert(item.status && item.statusLabel, "status + label");
        assert(typeof item.ageMinutes === "number" && item.ageMinutes >= 1, "ageMinutes");
        assert(item.actor, "actor");
        const member = getMember(item.memberId);
        assert(member, `member resolves (${item.memberId})`);
        assert(memberUrl(member).startsWith("https://perchance.org/"), "top-level deep link");
      }
      assertEqual(listMembers().length >= 5, true);
    })
    .test("items are ordered newest-first once materialised, oldest at the bottom", () => {
      const raw = generateActivity({ count: 15, seed: 11 });
      const items = materializeActivity(raw, NOW);
      const ages = items.map((item) => item.ageMinutes);
      for (let i = 1; i < ages.length; i += 1) assert(ages[i] >= ages[i - 1], "generation is oldest-last");
      const sorted = sortActivity(items);
      for (let i = 1; i < sorted.length; i += 1) assert(sorted[i].at <= sorted[i - 1].at, "sortActivity is newest-first");
      assertEqual(items[0].at, NOW - items[0].ageMinutes * 60000);
    })
    .test("filterActivity narrows by member, kind, status, metric and search", () => {
      const items = materializeActivity(generateActivity({ count: 60, seed: 5 }), NOW);
      const quotes = filterActivity(items, { memberId: "quote-u" });
      assert(quotes.length > 0 && quotes.every((item) => item.memberId === "quote-u"));
      const tickets = filterActivity(items, { kind: "ticket" });
      assert(tickets.length > 0 && tickets.every((item) => item.kind === "ticket"));
      const pending = filterActivity(items, { status: "pending" });
      assert(pending.every((item) => item.status === "pending"));
      const openQuotes = filterActivity(items, { metric: "open-quotes" });
      assert(openQuotes.length > 0 && openQuotes.every((item) => item.metric === "open-quotes"));
      const first = items[0];
      const search = filterActivity(items, { search: first.title.split(" ")[1] });
      assert(search.length > 0);
      assertEqual(filterActivity(items, { memberId: "does-not-exist" }).length, 0);
    })
    .test("groupActivityByDay buckets Today / Yesterday / Earlier this week / Older", () => {
      const make = (ageMinutes, id) => ({ id, memberId: "quote-u", kind: "quote", status: "sent", statusLabel: "Sent", tone: "info", title: "x", actor: "a", tags: [], ageMinutes, at: NOW - ageMinutes * 60000 });
      const groups = groupActivityByDay([make(5, "a"), make(60 * 30, "b"), make(60 * 24 * 3, "c"), make(60 * 24 * 30, "d")], NOW);
      assertDeepEqual(groups.map((g) => g.key), ["today", "yesterday", "week", "older"]);
      assertDeepEqual(groups.map((g) => g.items.map((i) => i.id)), [["a"], ["b"], ["c"], ["d"]]);
      assertEqual(groupActivityByDay([], NOW).length, 0);
    })
    .test("summarizeActivity rolls up metrics, members and needs-attention", () => {
      const items = materializeActivity(generateActivity({ count: 60, seed: 5 }), NOW);
      const summary = summarizeActivity(items);
      assertEqual(summary.total, items.length);
      assertEqual(
        Object.values(summary.byMetric).reduce((sum, n) => sum + n, 0),
        items.filter((item) => item.metric).length
      );
      assertEqual(
        Object.values(summary.byMember).reduce((sum, n) => sum + n, 0),
        items.length
      );
      assertEqual(summary.byStatus.pending, filterActivity(items, { status: "pending" }).length);
      assertEqual(summary.needsAttention, items.filter((item) => item.priority === "high" || item.tone === "danger").length);
      assert(summary.latest != null);
      for (const highlight of summary.highlights) {
        assert(ACTIVITY_METRICS[highlight.id], "highlight points at a known metric");
        assertEqual(highlight.count, summary.byMetric[highlight.id]);
      }
    })
    .test("createActivitySource fetches, filters, limits and refreshes", async () => {
      const source = createActivitySource({ latency: 0, count: 20, seed: 9 });
      const first = await source.fetch();
      assertEqual(first.length, 20);
      assert(first[0].at >= first[1].at, "newest first");
      const limited = await source.fetch({ limit: 5 });
      assertEqual(limited.length, 5);
      const quotes = await source.fetch({ memberId: "quote-u" });
      assert(quotes.every((item) => item.memberId === "quote-u"));
      const sizeBefore = source.size;
      const afterRefresh = await source.refresh();
      assert(source.size > sizeBefore, "refresh grows the underlying stream");
      assertEqual(afterRefresh.length, source.size);
      const summary = source.summarize(afterRefresh);
      assertEqual(summary.total, afterRefresh.length);
    })
    .test("the feed component renders, colour-codes and filters by member + kind", () => {
      const source = createActivitySource({ latency: 0, count: 24, seed: 4 });
      const outlet = document.createElement("div");
      const feed = createActivityFeed({ source, items: source.all(), limit: 12 });
      outlet.appendChild(feed.el);

      const items = [...outlet.querySelectorAll(".pu-feed-item")];
      assertEqual(items.length, 12, "respects the display limit");
      const firstItem = items[0];
      assert(firstItem.style.getPropertyValue("--pu-feed-accent"), "carries its member's accent");
      const memberId = firstItem.dataset.member;
      assert(getMember(memberId), "item is wired to a registry member");

      const chips = [...outlet.querySelectorAll(".pu-feed-chip")];
      assert(chips.length >= 2, "there is an All chip plus member chips");
      const chip = chips.find((btn) => btn.textContent.includes(getMember(memberId).name));
      chip.click();
      const filtered = [...outlet.querySelectorAll(".pu-feed-item")];
      assert(filtered.length > 0 && filtered.every((el) => el.dataset.member === memberId));

      const allChip = [...outlet.querySelectorAll(".pu-feed-chip")].find((btn) => btn.textContent.trim().startsWith("All"));
      allChip.click();
      const select = outlet.querySelector(".pu-feed-select");
      select.value = "ticket";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const byKind = [...outlet.querySelectorAll(".pu-feed-item")];
      assert(byKind.length > 0 && byKind.every((el) => el.dataset.kind === "ticket"));
      feed.destroy();
    })
    .test("kindMeta labels known kinds and falls back for unknown ones", () => {
      assertEqual(kindMeta("quote").label, "Quote");
      assertEqual(kindMeta("mystery").label, "Mystery");
      assertEqual(kindMeta("mystery").icon, "info");
      const el = activityItemEl(materializeActivity(generateActivity({ count: 1, seed: 2 }), NOW)[0]);
      assertEqual(el.dataset.member, generateActivity({ count: 1, seed: 2 })[0].memberId);
      assert(el.querySelector(".pu-feed-open"), "each item links back to its generator");
    })
    .test("activity view renders the quick-stats row, stream and source breakdown", async () => {
      const source = createActivitySource({ latency: 0, count: 30, seed: 4 });
      const app = fakeApp(source);
      const outlet = document.createElement("div");
      activityView.render(outlet, { app });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const tiles = [...outlet.querySelectorAll(".pu-stats-row .pu-stat")];
      assert(tiles.length >= 1, "stats row renders tiles");
      assert(
        tiles.some((tile) => tile.textContent.includes("Needs attention")),
        "the stats row leads with needs-attention"
      );

      const summary = summarizeActivity(source.all());
      for (const highlight of summary.highlights) {
        const tile = tiles.find((el) => el.textContent.includes(highlight.label));
        assert(tile, `a tile for ${highlight.label}`);
        assertEqual(tile.querySelector(".pu-stat-value").textContent, String(highlight.count));
      }

      const items = [...outlet.querySelectorAll(".pu-feed-item")];
      assert(items.length > 0, "the stream renders items");
      const rows = [...outlet.querySelectorAll(".pu-source-row")];
      assertEqual(rows.length, new Set(source.all().map((item) => item.memberId)).size);
    })
    .test("home shows a compact What's happening card only when activity is wired up", async () => {
      const source = createActivitySource({ latency: 0, count: 20, seed: 4 });
      const withActivity = document.createElement("div");
      homeView.render(withActivity, { app: fakeApp(source) });
      assert(withActivity.querySelector(".pu-home-activity"), "activity card is present");
      assert(withActivity.querySelectorAll(".pu-home-activity .pu-feed-item").length <= 3, "at most three latest items");
      assert(withActivity.querySelector(".pu-launch"), "the launcher is untouched");

      const withoutActivity = document.createElement("div");
      homeView.render(withoutActivity, { app: fakeApp(null) });
      assert(!withoutActivity.querySelector(".pu-home-activity"), "no card without an activity source");
    });
}
