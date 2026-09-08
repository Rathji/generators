// src/tests/shell.test.js — validation tests for Phase 1 Task 1
// (module shell & navigation). Run in the live page:
//   await import("./src/tests/shell.test.js").then((m) => m.run())
//
// Covers: module nav completeness, default/unknown routing, per-module
// titles + hash + active state, the seeded category tree (incl. nesting),
// consistent empty/loading/error state components, router error fallback,
// the mobile drawer toggle, and the quick-search shortcut.

import { runTests, assert, assertEq } from "./harness.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const click = (el) => {
  (typeof el === "string" ? $(el) : el).dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

async function ready() {
  await waitFor(() => window.__kb && $("#moduleNav .kb-nav-item") && $("#kbMain .kb-view-title"));
}

async function waitFor(fn, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = fn();
      if (v) return v;
    } catch {}
    await tick();
  }
  throw new Error("waitFor timed out");
}

export async function run() {
  await ready();
  const app = window.__kb;
  return runTests([
    {
      name: "module nav lists all 6 modules in order",
      fn: async () => {
        const items = $$("#moduleNav .kb-nav-item");
        assertEq(items.length, 6, "nav item count");
        assertEq(items[0].dataset.id, "home", "first item");
        assertEq(
          items.map((i) => i.dataset.id).join(","),
          "home,browse,search,review,stale,reports",
          "nav order",
        );
      },
    },
    {
      name: "home renders by default with active nav + module cards",
      fn: async () => {
        location.hash = "#/home";
        await waitFor(
          () =>
            $("#moduleNav .kb-nav-item.active") &&
            $("#moduleNav .kb-nav-item.active").dataset.id === "home" &&
            $(".kb-view-title") &&
            $(".kb-view-title").textContent.trim() === "Welcome to Company KB",
        );
        assertEq(app.kb.appShortTitle, "Company KB", "kb config read");
        assertEq($("#kbMain .kb-view-title").textContent.trim(), "Welcome to Company KB", "home title");
        assertEq($$("#kbMain .kb-module-card").length, 5, "module cards");
      },
    },
    {
      name: "each module navigates and renders its title + hash + active state",
      fn: async () => {
        const cases = [
          ["browse", "Browse"],
          ["search", "Search"],
          ["review", "Review Queue"],
          ["stale", "Stale Content"],
          ["reports", "Reports"],
          ["home", "Welcome to Company KB"],
        ];
        for (const [id, title] of cases) {
          location.hash = "#/" + id;
          await waitFor(
            () =>
              location.hash === "#/" + id &&
              $("#moduleNav .kb-nav-item.active") &&
              $("#moduleNav .kb-nav-item.active").dataset.id === id &&
              $(".kb-view-title") &&
              $(".kb-view-title").textContent.trim() === title,
          );
          assertEq($("#kbMain .kb-view-title").textContent.trim(), title, "title for " + id);
        }
      },
    },
    {
      name: "unknown route falls back to home",
      fn: async () => {
        location.hash = "#/does-not-exist";
        await waitFor(
          () =>
            $("#moduleNav .kb-nav-item.active") &&
            $("#moduleNav .kb-nav-item.active").dataset.id === "home" &&
            $(".kb-view-title") &&
            $(".kb-view-title").textContent.trim() === "Welcome to Company KB",
        );
        assertEq($("#kbMain .kb-view-title").textContent.trim(), "Welcome to Company KB");
      },
    },
    {
      name: "category tree renders seeded categories with nesting",
      fn: async () => {
        await waitFor(() => $("#categoryNav > .kb-cat-tree > .kb-cat-node > .kb-cat-item"));
        const items = $$("#categoryNav > .kb-cat-tree > .kb-cat-node > .kb-cat-item");
        assertEq(items.length, 5, "top-level categories");
        assertEq(
          items.map((i) => i.dataset.id).join(","),
          "operations,people,it,finance,compliance",
          "category ids",
        );
        const compliance = items.find((i) => i.dataset.id === "compliance");
        const nested = compliance.closest(".kb-cat-node").querySelectorAll(":scope > .kb-cat-tree > .kb-cat-node > .kb-cat-item");
        assertEq(nested.length, 2, "compliance subcategories");
        assertEq(
          Array.from(nested).map((i) => i.dataset.id).join(","),
          "safety,data-privacy",
          "subcategory ids",
        );
      },
    },
    {
      name: "empty / loading / error state components render consistently",
      fn: async () => {
        const mount = document.createElement("div");
        document.body.append(mount);

        const load = app.states.loading({ label: "Checking…" });
        assert(load.classList.contains("kb-state-loading"), "loading variant class");
        assert(load.querySelector(".spinner"), "spinner present");
        assertEq(load.querySelector(".kb-state-title").textContent, "Checking…");

        const empty = app.states.empty({ title: "Nothing here" });
        assert(empty.classList.contains("kb-state"), "empty state card");
        assertEq(empty.querySelector(".kb-state-title").textContent, "Nothing here");

        let retried = false;
        const err = app.states.error({ title: "Oops", onRetry: () => (retried = true) });
        assert(err.classList.contains("kb-state-error"), "error variant class");
        click(err.querySelector(".kb-btn"));
        assert(retried, "retry button wired to onRetry");

        mount.remove();
      },
    },
    {
      name: "router shows error state when a module throws",
      fn: async () => {
        const r = app.router;
        r.registry.set("boom", { id: "boom", label: "Boom", render() { throw new Error("kaboom"); } });
        r.navigate("boom");
        await waitFor(() => $("#kbMain .kb-state-error"));
        assert(
          $("#kbMain .kb-state-title").textContent.toLowerCase().includes("couldn"),
          "error title mentions failure",
        );
        r.registry.delete("boom");
        location.hash = "#/home";
        await waitFor(() => $("#moduleNav .kb-nav-item.active") && $("#moduleNav .kb-nav-item.active").dataset.id === "home");
      },
    },
    {
      name: "drawer toggles open/close and closes after nav select",
      fn: async () => {
        const sb = $("#kbSidebar");
        const backdrop = $("#kbBackdrop");
        assert(!sb.classList.contains("open"), "starts closed");
        click("#menuBtn");
        assert(sb.classList.contains("open"), "opens on hamburger");
        assert(backdrop.hidden === false, "backdrop visible when open");
        click("#menuBtn");
        assert(!sb.classList.contains("open"), "closes on second click");
        click("#menuBtn");
        assert(sb.classList.contains("open"), "reopens");
        click('#moduleNav a[data-id="browse"]');
        await waitFor(() => !sb.classList.contains("open"));
      },
    },
    {
      name: "quick search Enter navigates to Search module",
      fn: async () => {
        const qs = $("#quickSearchInput");
        qs.value = "onboarding";
        qs.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await waitFor(
          () => location.hash === "#/search" && $("#kbMain .kb-view-title") && $("#kbMain .kb-view-title").textContent.trim() === "Search",
        );
        qs.value = "";
      },
    },
  ]);
}
