// src/howToPlay.test.js — Phase 15 how-to-play guide validation (Task 70).
// Run in-page via ?test=howtoplay, or via window.__loadHowToPlayTests().
// Task 70: every guide section links to its ACTIVE Chronicle entry — i.e.
// each section's chronicleEntryIds must resolve to a real entry in the
// in-app Chronicle (the same source the rule-sticker flags reference).

import { createChronicle } from "./chronicle.js";
import { HOW_TO_PLAY_VERSION, HOW_TO_PLAY_SECTIONS, createHowToPlayGuide, createHowToPlayModal } from "./howToPlay.js";

export function runHowToPlayTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  const chronicle = createChronicle();

  // ── structure ──
  ok("guide exposes version + the four core sections",
    HOW_TO_PLAY_VERSION === 1 &&
    HOW_TO_PLAY_SECTIONS.map(s => s.id).join(",") === "turns,commons,tracks,legacy");

  // ── every section links to its ACTIVE Chronicle entry ──
  const guide = createHowToPlayGuide({ chronicle });
  ok("guide has a section per HOW_TO_PLAY_SECTIONS", guide.sections.length === HOW_TO_PLAY_SECTIONS.length);
  for (const sec of guide.sections) {
    const src = HOW_TO_PLAY_SECTIONS.find(s => s.id === sec.id);
    ok("section '" + sec.id + "' links to every chronicleEntryId and resolves each",
      src.chronicleEntryIds.length > 0 &&
      src.chronicleEntryIds.every(id => !!chronicle.entry(id)) &&
      sec.missingEntries.length === 0 &&
      sec.chronicleEntries.length === src.chronicleEntryIds.length,
      "resolved " + sec.chronicleEntries.length + "/" + src.chronicleEntryIds.length);
    ok("section '" + sec.id + "' resolved entries carry real Chronicle text",
      sec.chronicleEntries.every(e => !!e.id && typeof e.title === "string" && typeof e.text === "string" && e.text.length > 0));
  }
  const allLinked = new Set(HOW_TO_PLAY_SECTIONS.flatMap(s => s.chronicleEntryIds));
  ok("every linked Chronicle entry exists in the active ruleset",
    [...allLinked].every(id => !!chronicle.entry(id)));
  ok("the guide's Chronicle links are a subset of the real Chronicle sections",
    [...allLinked].every(id => chronicle.sections().some(sec => sec.entries.some(e => e.id === id))));

  // ── modal UI renders sections + links ──
  const div = document.createElement("div");
  div.id = "htpTestHost";
  document.body.appendChild(div);
  const modal = createHowToPlayModal({ container: div, chronicle });
  const tabs = div.querySelectorAll(".cs-howto-tab");
  ok("modal renders a tab per section", tabs.length === HOW_TO_PLAY_SECTIONS.length);
  ok("modal renders Chronicle entry cards", div.querySelectorAll(".cs-howto-entry").length >= 4);
  ok("first tab is active", (div.querySelector(".cs-howto-tab.on") || {}).textContent === "🎲 Turn Structure");
  modal.goTo(2);
  ok("switching tabs re-renders that section's links", (div.querySelector(".cs-howto-tab.on") || {}).textContent === "📏 The Tracks");
  ok("the tracks section links its Chronicle entries", div.querySelectorAll(".cs-howto-entry").length >= 4);
  modal.close();
  ok("modal closes cleanly", !div.querySelector(".cs-howto"));
  div.remove();

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "howtoplay", pass, fail, results };
}
