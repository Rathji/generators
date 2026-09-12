// src/tests/help.test.js — validation tests for the contextual help catalog.
// Run in the live page:
//   await import("./src/tests/help.test.js").then((m) => m.run())
//
// Covers: every station has authored help; every station with a detail view has
// a detail entry; every Settings section card has an entry; there are no dead
// (unreachable) help keys; every entry has the required, non-empty content; the
// "See also" links all resolve; and the DOM wiring actually injects a "?" into a
// view title row / section head and opens a modal.

import { runTests, assert, assertEq } from "./harness.js";
import { HELP, hasHelp, helpKeys, helpButton, openHelp, attachHelp, attachSectionHelp } from "../framework/help.js";
import modules from "../modules/index.js";

const SETTINGS_CARDS = ["appearance", "storage", "conflicts", "capacity", "backup", "templates", "access", "roles", "idp", "activity", "integrity", "playbook"];

const stationIds = () => modules.map((m) => m.id);
const detailIds = () => modules.filter((m) => typeof m.renderDetail === "function").map((m) => m.id + ":detail");
const settingsKeys = () => SETTINGS_CARDS.map((c) => "settings:" + c);

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
      name: "every station has authored help",
      fn: async () => {
        for (const id of stationIds()) assert(hasHelp(id), "no help for station “" + id + "”");
      },
    },
    {
      name: "every station with a detail view has a detail entry",
      fn: async () => {
        for (const id of detailIds()) assert(hasHelp(id), "no help for detail “" + id + "”");
      },
    },
    {
      name: "every Settings section card has an entry",
      fn: async () => {
        for (const k of settingsKeys()) assert(hasHelp(k), "no help for “" + k + "”");
      },
    },
    {
      name: "there are no dead help keys",
      fn: async () => {
        const reachable = new Set([...stationIds(), ...detailIds(), ...settingsKeys()]);
        const dead = helpKeys().filter((k) => !reachable.has(k));
        assertEq(dead.length, 0, "dead keys: " + dead.join(", "));
        assertEq(helpKeys().length, reachable.size, "catalog size matches reachable screens");
      },
    },
    {
      name: "every entry carries the required, non-empty content",
      fn: async () => {
        for (const [key, e] of Object.entries(HELP)) {
          assert(typeof e.title === "string" && e.title.length > 0, key + " title");
          assert(typeof e.tagline === "string" && e.tagline.length > 0, key + " tagline");
          assert(Array.isArray(e.what) && e.what.length > 0, key + " what[]");
          assert(Array.isArray(e.tasks) && e.tasks.length > 0, key + " tasks[]");
          for (const t of e.tasks) {
            assert(t.title && t.title.length > 0, key + " task title");
            assert(Array.isArray(t.steps) && t.steps.length > 0, key + " task “" + t.title + "” steps");
            for (const s of t.steps) assert(typeof s === "string" && s.length > 0, key + " empty step");
          }
          if (e.fields) for (const f of e.fields) assert(f.name && f.desc, key + " field needs name + desc");
          if (e.tips) for (const tip of e.tips) assert(typeof tip === "string" && tip.length > 0, key + " empty tip");
        }
      },
    },
    {
      name: "every “See also” link resolves to a real entry or hash",
      fn: async () => {
        for (const [key, e] of Object.entries(HELP)) {
          for (const s of e.see || []) {
            assert(s.label && s.label.length > 0, key + " see-link label");
            assert(s.key || s.hash, key + " see-link needs a key or hash");
            if (s.key) assert(hasHelp(s.key), key + " → unknown key “" + s.key + "”");
          }
        }
      },
    },
    {
      name: "attachHelp injects a button into a view title row",
      fn: async () => {
        const view = makeTitleRow();
        document.body.append(view);
        try {
          assertEq(attachHelp(view, "organizations"), true, "attaches");
          const btn = view.querySelector(".kb-view-title-row .kb-help-btn");
          assert(btn, "button present");
          assertEq(btn.dataset.help, "organizations", "button carries the key");
          assertEq(attachHelp(view, "nope"), false, "unknown key attaches nothing");
          assertEq(attachHelp(view, "organizations"), true, "idempotent");
          assertEq(view.querySelectorAll(".kb-help-btn").length, 1, "only one button");
          assertEq(attachHelp(document.createElement("div"), "organizations"), false, "no title row → false");
        } finally {
          view.remove();
        }
      },
    },
    {
      name: "attachSectionHelp injects a button into matching section heads",
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
          assertEq(attachSectionHelp(body), 2, "two known cards get help");
          assertEq(body.querySelector('[data-card="backup"] .kb-help-btn').dataset.help, "settings:backup", "backup key");
          assertEq(body.querySelector('[data-card="unknown-card"] .kb-help-btn'), null, "unknown card gets nothing");
          assertEq(attachSectionHelp(body), 0, "idempotent");
        } finally {
          body.remove();
        }
      },
    },
    {
      name: "helpButton and openHelp render a modal with sections",
      fn: async () => {
        const btn = helpButton("assets");
        assertEq(btn.dataset.help, "assets", "button key");
        const res = openHelp("assets");
        try {
          const overlay = document.querySelector(".kb-modal-overlay");
          assert(overlay, "modal appended");
          assertEq(overlay.querySelector(".kb-modal-title").textContent, "Help — Assets", "modal title");
          assertEq(overlay.querySelectorAll(".kb-help-sec-title").length, 4, "four sections");
          assert(overlay.querySelectorAll(".kb-help-task").length >= 1, "task cards rendered");
          assert(overlay.querySelectorAll(".kb-help-see .kb-help-link").length >= 1, "see-also links rendered");
          assert(overlay.querySelector(".kb-modal-actions .kb-btn"), "Got it button");
          assertEq(openHelp("nope"), null, "unknown key → no modal");
        } finally {
          res && res.close();
        }
        assertEq(document.querySelector(".kb-modal-overlay"), null, "modal removed");
      },
    },
  ]);
}
