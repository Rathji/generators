// src/tests/shell.test.js — validation tests for roadmap task 1
// (app shell & navigation). Run in the live page:
//   await import("./src/tests/shell.test.js").then((m) => m.run())
//
// Covers: the 14-station navigation completeness + order, the default and
// unknown-route fallback, per-station routing (title + hash + active state),
// the consistent empty/loading/error states on every station, the router error
// fallback, the mobile drawer toggle, the quick-search shortcut and the
// Settings header shortcut.

import { runTests, assert, assertEq } from "./harness.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const click = (el) => {
  (typeof el === "string" ? $(el) : el).dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const STATIONS = ["organizations", "assets", "documents", "trackers", "services", "library", "deployments", "integrations", "import", "search", "linter", "exports", "settings", "status"];
const TITLES = {
  organizations: "Organizations",
  assets: "Assets",
  documents: "Documents",
  trackers: "Trackers",
  services: "Services",
  library: "Library",
  deployments: "Deployments",
  integrations: "Integrations",
  import: "Import",
  search: "Search",
  linter: "Linter",
  exports: "Exports",
  settings: "Settings",
  status: "Status",
};

const activeStation = () => {
  const a = $("#moduleNav .kb-nav-item.active");
  return a && a.dataset.id;
};
const viewTitle = () => {
  const t = $(".kb-view-title");
  return t && t.textContent.trim();
};

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

async function ready() {
  await waitFor(() => window.__kb && $("#moduleNav .kb-nav-item") && $("#kbMain .kb-view-title"));
}

// The live preview environment can transiently replay/mutate the iframe's
// location.hash while the page is under load, which fights a test that sets the
// hash and waits on it. `goTo` drives the route and waits on the RENDERED state
// (the real functional contract), retrying so a transient hash fight can't fail
// the suite; the hash itself is then re-asserted once it settles.
async function goTo(id, title) {
  for (let attempt = 0; attempt < 5; attempt++) {
    location.hash = "#/" + id;
    try {
      await waitFor(() => activeStation() === id && viewTitle() === title, 8000);
      break;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
  for (let attempt = 0; attempt < 5 && location.hash !== "#/" + id; attempt++) {
    location.hash = "#/" + id;
    await waitFor(() => location.hash === "#/" + id, 4000).catch(() => {});
  }
}

// Retry an action that depends on a hash-driven render, so a transient
// environment hash fight cannot fail the suite.
async function retry(fn, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export async function run() {
  await ready();
  const app = window.__kb;
  return runTests([
    {
      name: "station nav lists all 14 stations in order",
      fn: async () => {
        const items = $$("#moduleNav .kb-nav-item");
        assertEq(items.length, 14, "nav item count");
        assertEq(items.map((i) => i.dataset.id).join(","), STATIONS.join(","), "nav order");
      },
    },
    {
      name: "every station is registered with the router",
      fn: async () => {
        for (const id of STATIONS) assert(app.router.registry.has(id), "missing station registration: " + id);
      },
    },
    {
      name: "the default route is the Organizations station",
      fn: async () => {
        await goTo("organizations", "Organizations");
        assertEq(activeStation(), "organizations", "active nav");
        assertEq(viewTitle(), "Organizations", "view title");
        assert($("#kbMain .kb-docset-body"), "organizations renders its doc-set body");
        await waitFor(() => $("#kbMain .kb-state") || $("#kbMain .kb-docset-grid"));
        assert($("#kbMain .kb-state") || $("#kbMain .kb-docset-grid"), "organizations shows empty state or a doc-set grid");
      },
    },
    {
      name: "each station navigates and renders its title + hash + active state",
      fn: async () => {
        for (const id of STATIONS) {
          await goTo(id, TITLES[id]);
          assertEq(location.hash, "#/" + id, "hash for " + id);
          assertEq(activeStation(), id, "active nav for " + id);
          assertEq(viewTitle(), TITLES[id], "title for " + id);
          // Organizations renders its doc-set body (empty state or grid) rather
          // than the generic station scaffold; every other station shows a state.
          if (id === "organizations") {
            await waitFor(() => $("#kbMain .kb-state") || $("#kbMain .kb-docset-grid"));
            assert($("#kbMain .kb-docset-body"), "organizations body for " + id);
            assert($("#kbMain .kb-state") || $("#kbMain .kb-docset-grid"), "organized view for " + id);
          } else if (id === "assets") {
            await waitFor(() => $("#kbMain .kb-asset-grid") || $("#kbMain .kb-state"));
            assert($("#kbMain .kb-docset-body"), "assets body for " + id);
            assert($("#kbMain .kb-asset-grid") || $("#kbMain .kb-state"), "asset library view for " + id);
          } else if (id === "documents") {
            await waitFor(() => $("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"));
            assert($("#kbMain .kb-docset-body"), "documents body for " + id);
            assert($("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"), "documents view for " + id);
          } else if (id === "library") {
            await waitFor(() => $("#kbMain .kb-library-grid") || $("#kbMain .kb-state"));
            assert($("#kbMain .kb-docset-body"), "library body for " + id);
            assert($("#kbMain .kb-library-grid") || $("#kbMain .kb-state"), "library view for " + id);
          } else if (id === "trackers") {
            await waitFor(() => $("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"));
            assert($("#kbMain .kb-docset-body"), "trackers body for " + id);
            assert($("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"), "trackers view for " + id);
          } else if (id === "integrations") {
            await waitFor(() => $("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"));
            assert($("#kbMain .kb-docset-body"), "integrations body for " + id);
            assert($("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"), "integrations view for " + id);
          } else if (id === "import") {
            await waitFor(() => $("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"));
            assert($("#kbMain .kb-docset-body"), "import body for " + id);
            assert($("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"), "import view for " + id);
          } else if (id === "settings") {
            await waitFor(() => $("#kbMain .kb-settings-body .kb-settings-card") || $("#kbMain .kb-settings-body .kb-state-error"));
            assert($("#kbMain .kb-settings-body"), "settings body for " + id);
          } else if (id === "deployments") {
            await waitFor(() => $("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"));
            assert($("#kbMain .kb-docset-body"), "deployments body for " + id);
            assert($("#kbMain .kb-docset-grid") || $("#kbMain .kb-state"), "deployments view for " + id);
          } else if (id === "search") {
            await waitFor(() => $("#kbMain .kb-search-results .kb-search-list") || $("#kbMain .kb-search-results .kb-state"));
            assert($("#kbMain .kb-search"), "search body for " + id);
            assert($("#kbMain .kb-search-results"), "search results region for " + id);
          } else if (id === "linter") {
            await waitFor(() => $("#kbMain .kb-lint-body .kb-lint-section") || $("#kbMain .kb-lint-body .kb-state"));
            assert($("#kbMain .kb-lint"), "linter body for " + id);
            assert($("#kbMain .kb-lint-body"), "linter findings region for " + id);
          } else if (id === "status") {
            await waitFor(() => $("#kbMain .kb-status-hero") && $("#kbMain .kb-status-grid .kb-status-card"));
            assert($("#kbMain .kb-status-hero"), "status hero for " + id);
            assert($("#kbMain .kb-status-grid .kb-status-card"), "status cards for " + id);
          } else if (id === "exports") {
            await waitFor(() => $("#kbMain .kb-exports"));
            assert($("#kbMain .kb-exports"), "exports panel for " + id);
          } else {
            await waitFor(() => $("#kbMain .kb-state"));
            assert($("#kbMain .kb-state"), "consistent empty state for " + id);
          }
        }
      },
    },
    {
      name: "unknown route falls back to the default station",
      fn: async () => {
        await retry(async () => {
          location.hash = "#/does-not-exist";
          await waitFor(() => activeStation() === "organizations" && viewTitle() === "Organizations", 8000);
        });
        assertEq(viewTitle(), "Organizations", "fallback title");
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
      name: "router shows the error state when a station throws",
      fn: async () => {
        const r = app.router;
        r.registry.set("boom", {
          id: "boom",
          label: "Boom",
          render() {
            throw new Error("kaboom");
          },
        });
        await retry(async () => {
          r.navigate("boom");
          await waitFor(() => $("#kbMain .kb-state-error"), 8000);
        });
        assert($("#kbMain .kb-state-title").textContent.toLowerCase().includes("couldn"), "error title mentions failure");
        r.registry.delete("boom");
        await goTo("organizations", "Organizations");
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
        click('#moduleNav a[data-id="assets"]');
        await waitFor(() => !sb.classList.contains("open"));
      },
    },
    {
      name: "quick search Enter navigates to the Search station",
      fn: async () => {
        const qs = $("#quickSearchInput");
        await retry(async () => {
          qs.value = "acme";
          qs.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          await waitFor(() => viewTitle() === "Search", 8000);
        });
        assertEq(viewTitle(), "Search", "search station rendered");
        qs.value = "";
      },
    },
    {
      name: "the Settings header shortcut navigates to the Settings station",
      fn: async () => {
        await goTo("organizations", "Organizations");
        await retry(async () => {
          click("#kbSettingsBtn");
          await waitFor(() => viewTitle() === "Settings", 8000);
        });
        assertEq(viewTitle(), "Settings", "settings station rendered");
      },
    },
  ]);
}
