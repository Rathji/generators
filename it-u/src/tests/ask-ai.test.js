// src/tests/ask-ai.test.js — validation tests for the "Ask AI" assistant.
//   await import("./src/tests/ask-ai.test.js").then((m) => m.run())
//
// Covers: every station, every station detail view and every Settings section
// card has an authored context (the same key scheme the help catalog uses);
// there are no dead context keys; every digest resolves to real, bounded,
// non-error content; the prompt builder assembles the system/context/
// conversation/task shape and trims the oldest turns when over budget; and the
// DOM wiring injects an "Ask AI" button into a view title row / section head and
// opens a panel with its context chip, log, composer and Clear/Close actions.

import { runTests, assert, assertEq } from "./harness.js";
import { buildScreenContext, contextKeys, hasContext, SETTINGS_CARDS } from "../framework/ai-context.js";
import { askButton, attachAsk, attachSectionAsk, openAsk, buildPrompt } from "../framework/ai.js";
import modules from "../modules/index.js";

const stationIds = () => modules.map((m) => m.id);
const detailIds = () => modules.filter((m) => typeof m.renderDetail === "function").map((m) => m.id + ":detail");
const settingsKeys = () => SETTINGS_CARDS.map((c) => "settings:" + c);
const reachable = () => [...stationIds(), ...detailIds(), ...settingsKeys()];

// A live service context (the app exposes it for tests/debug). Screen digests
// read the current repository through it.
const ctx = () => (typeof window !== "undefined" && window.__kb) || null;

// Discover one real `sub` id per detail screen, using the live services the app
// itself uses. Returns null when the data needed is not available.
async function detailSub(key) {
  const c = ctx();
  if (!c) return null;
  try {
    if (key === "assets:detail") {
      const types = await c.assetTypes.list();
      return (types && types[0] && types[0].id) || null;
    }
    if (key === "library:detail") {
      const { LIBRARY_ARTICLES } = await import("../framework/library.js");
      return (LIBRARY_ARTICLES[0] && LIBRARY_ARTICLES[0].id) || null;
    }
    const sets = await c.docs.summaries({ includeArchived: true });
    return (sets && sets[0] && sets[0].id) || null;
  } catch {
    return null;
  }
}

function isErrorDigest(digest) {
  return /Could not assemble/.test(String(digest || ""));
}

function makeTitleRow() {
  const row = document.createElement("div");
  row.className = "kb-view-title-row";
  const h1 = document.createElement("h1");
  h1.className = "kb-view-title";
  h1.textContent = "Test";
  row.append(h1);
  const view = document.createElement("div");
  view.className = "kb-view";
  view.append(row);
  return view;
}

export async function run() {
  return runTests([
    {
      name: "every station has an authored context",
      fn: async () => {
        for (const id of stationIds()) assert(hasContext(id), "no context for station “" + id + "”");
      },
    },
    {
      name: "every station with a detail view has a detail context",
      fn: async () => {
        for (const id of detailIds()) assert(hasContext(id), "no context for detail “" + id + "”");
      },
    },
    {
      name: "every Settings section card has a context",
      fn: async () => {
        for (const k of settingsKeys()) assert(hasContext(k), "no context for “" + k + "”");
      },
    },
    {
      name: "there are no dead context keys",
      fn: async () => {
        const want = new Set(reachable());
        const dead = contextKeys().filter((k) => !want.has(k));
        assertEq(dead.length, 0, "dead keys: " + dead.join(", "));
        assertEq(contextKeys().length, want.size, "context registry matches reachable screens");
      },
    },
    {
      name: "every station and Settings digest builds, is bounded, and is non-error",
      fn: async () => {
        const keys = [...stationIds(), ...settingsKeys()];
        for (const key of keys) {
          const r = await buildScreenContext(key, { ctx: ctx() });
          assert(r && typeof r.title === "string" && r.title.length > 0, key + " title");
          assert(typeof r.digest === "string" && r.digest.length > 0, key + " digest empty");
          assert(!isErrorDigest(r.digest), key + " digest: " + r.digest.slice(0, 160));
          assert(r.digest.length <= 9500, key + " digest too long (" + r.digest.length + ")");
          assert(Array.isArray(r.suggestions) && r.suggestions.length > 0, key + " suggestions");
        }
      },
    },
    {
      name: "every detail digest builds for a real record, and degrades gracefully for an unknown one",
      fn: async () => {
        for (const key of detailIds()) {
          const sub = await detailSub(key);
          const real = await buildScreenContext(key, { ctx: ctx(), sub });
          assert(real && typeof real.digest === "string" && real.digest.length > 0, key + " (real sub) digest");
          assert(!isErrorDigest(real.digest), key + " (real sub) digest: " + real.digest.slice(0, 160));
          const missing = await buildScreenContext(key, { ctx: ctx(), sub: "__does-not-exist__" });
          assert(missing && typeof missing.digest === "string" && missing.digest.length > 0, key + " (unknown sub) digest");
          assert(!isErrorDigest(missing.digest), key + " (unknown sub) digest: " + missing.digest.slice(0, 160));
        }
      },
    },
    {
      name: "buildPrompt assembles the system/context/conversation/task shape",
      fn: async () => {
        const context = { title: "Acme Corp", subtitle: "8 records", digest: "NAME: Acme Corp\nRECORDS: 8" };
        const prompt = buildPrompt(context, [{ role: "user", text: "How many records?" }], null);
        assert(/CONTEXT · Acme Corp · 8 records/.test(prompt), "context heading");
        assert(prompt.includes("NAME: Acme Corp\nRECORDS: 8"), "digest included verbatim");
        assert(prompt.includes("=== CONVERSATION ==="), "conversation heading");
        assert(prompt.includes("USER: How many records?"), "user turn included");
        assert(/TASK:/.test(prompt), "task instruction at the end");
      },
    },
    {
      name: "buildPrompt trims the oldest turns when over budget",
      fn: async () => {
        const context = { title: "Big", subtitle: "", digest: "x".repeat(400) };
        const meta = { idealMaxContextTokens: 120, countTokens: (s) => Math.ceil(String(s).length / 4) };
        const turns = [
          { role: "user", text: "old question " + "a".repeat(400) },
          { role: "assistant", text: "old answer " + "b".repeat(400) },
          { role: "user", text: "newest question" },
        ];
        const prompt = buildPrompt(context, turns, meta);
        assert(prompt.includes("newest question"), "newest turn kept");
        assert(prompt.includes("Earlier messages omitted"), "omission note present");
      },
    },
    {
      name: "askButton and attachAsk inject a button into a view title row",
      fn: async () => {
        const btn = askButton("organizations");
        assertEq(btn.dataset.ask, "organizations", "button carries the key");
        const view = makeTitleRow();
        document.body.append(view);
        try {
          assertEq(attachAsk(view, "organizations"), true, "attaches");
          const found = view.querySelector(".kb-view-title-row .kb-ask-btn");
          assert(found, "button present");
          assertEq(found.dataset.ask, "organizations", "injected key");
          assertEq(attachAsk(view, "nope"), false, "unknown key attaches nothing");
          assertEq(attachAsk(view, "organizations"), true, "idempotent");
          assertEq(view.querySelectorAll(".kb-ask-btn").length, 1, "only one button");
          assertEq(attachAsk(document.createElement("div"), "organizations"), false, "no title row → false");
        } finally {
          view.remove();
        }
      },
    },
    {
      name: "attachSectionAsk injects a button into matching section heads",
      fn: async () => {
        const body = document.createElement("div");
        for (const cardId of ["backup", "templates", "unknown-card"]) {
          const card = document.createElement("section");
          card.className = "kb-card kb-settings-card";
          card.dataset.card = cardId;
          const head = document.createElement("div");
          head.className = "kb-section-head";
          const name = document.createElement("h2");
          name.className = "kb-section-name";
          name.textContent = cardId;
          head.append(name);
          card.append(head);
          body.append(card);
        }
        document.body.append(body);
        try {
          assertEq(attachSectionAsk(body), 2, "two known cards get a button");
          assertEq(body.querySelector('[data-card="backup"] .kb-ask-btn').dataset.ask, "settings:backup", "backup key");
          assertEq(body.querySelector('[data-card="unknown-card"] .kb-ask-btn'), null, "unknown card gets nothing");
          assertEq(attachSectionAsk(body), 0, "idempotent");
        } finally {
          body.remove();
        }
      },
    },
    {
      name: "openAsk renders a scoped panel with context, composer and actions",
      fn: async () => {
        const res = openAsk("library", { sub: "client-onboarding" });
        try {
          const overlay = document.querySelector(".kb-modal-overlay");
          assert(overlay, "modal appended");
          const panel = overlay.querySelector(".kb-ask");
          assert(panel, "panel present");
          assert(panel.querySelector(".kb-ask-context"), "context chip present");
          assert(panel.querySelector(".kb-ask-log"), "transcript log present");
          assert(panel.querySelector(".kb-ask-input"), "composer input present");
          assert(panel.querySelector(".kb-ask-send"), "send button present");
          const actions = [...overlay.querySelectorAll(".kb-modal-actions .kb-btn")].map((b) => b.textContent.trim());
          assert(actions.includes("Clear"), "Clear action");
          assert(actions.includes("Close"), "Close action");
        } finally {
          res && res.close && res.close();
        }
        assertEq(document.querySelector(".kb-modal-overlay"), null, "modal removed");
      },
    },
  ]);
}
