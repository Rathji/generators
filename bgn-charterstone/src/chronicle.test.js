// src/chronicle.test.js — Phase 9 foundational-Chronicle validation (Task 38).
// Run in-page via ?test=chronicle, or programmatically via window.__loadChronicleTests().
// Task 38: the starting rulebook (setup, personal/general supply, turn actions,
// The Commons, tracks, crates) is encoded as structured ruleset data with a
// version field, and every mechanic referenced by a rules task has a matching
// data entry.

import { createChronicle, CHRONICLE_VERSION, CHRONICLE_MECHANICS, CHRONICLE_SECTIONS } from "./chronicle.js";
import { createGameState, restoreGameState } from "./serialization.js";

const REQUIRED_MECHANICS = [
  "charter", "charterstone-die", "first-player",
  "supply", "personal-supply", "general-supply", "coins", "resources", "economy", "player",
  "worker", "capacity", "influence", "influence-placement", "vp",
  "turn", "round", "place", "retrieve", "bump", "cost", "benefit",
  "progress", "reputation", "quota", "crate", "objective", "score", "income", "end-game",
  "treasury", "market", "grandstand", "zeppelin", "charterstone-building", "cloud-port",
  "advancement-mat", "advancement-card", "deck", "discard",
  "assistant", "persona", "archive", "building-tile",
  "construct", "construction-cost", "commodity", "legacy", "sticker", "index-guide",
];

export function runChronicleTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  // ── structure ──
  const c = createChronicle();
  ok("the chronicle carries a version field", c.version === CHRONICLE_VERSION && Number.isInteger(c.version));
  ok("sections cover the starting rulebook's subjects",
    ["setup", "supply", "turns", "commons", "tracks", "cards", "crates", "endgame"]
      .every(id => !!c.section(id)));
  ok("every section has titled entries with mechanics terms",
    c.sections().every(s => s.entries.length > 0 && s.entries.every(e =>
      typeof e.id === "string" && typeof e.title === "string" && typeof e.text === "string" &&
      Array.isArray(e.mechanics) && e.mechanics.length > 0)));

  // ── Task 38: every mechanic referenced by a rules task has a matching entry ──
  const covered = new Set(c.mechanics());
  const missing = REQUIRED_MECHANICS.filter(m => !covered.has(m));
  ok("every mechanic referenced by a rules task has a matching data entry",
    missing.length === 0, missing.join(", "));

  // ── query/search ──
  ok("entries and mechanics are queryable",
    !!c.entry("commons-zeppelin") && c.search("Zeppelin").length > 0 && c.search("quota").length > 0);
  ok("mechanics() is the union of all entry mechanics",
    c.mechanics().length === CHRONICLE_MECHANICS.length &&
    new Set(c.mechanics()).size === CHRONICLE_MECHANICS.length);

  // ── rule flags & enabled actions (shared with Task 35) ──
  const c2 = createChronicle();
  ok("rule flags default to inactive",
    c2.flag("incomeEnabled") === false && c2.flag("dropPlayers") === false);
  ok("flipping a rule flag changes the enabled actions",
    c2.enabledActions().join(",") === "place,retrieve" &&
    c2.setFlag("dropPlayers", true) === true &&
    c2.enabledActions().join(",") === "place,retrieve,dropPlayer");
  ok("unknown rule flags are rejected",
    (() => { try { c2.setFlag("nope", true); return false; } catch (e) { return true; } })());

  // ── versioned JSON round-trip ──
  c.setFlag("incomeEnabled", true);
  const cJSON = c.toJSON();
  const c3 = createChronicle();
  c3.fromJSON(cJSON);
  ok("the chronicle round-trips its version, flags and actions",
    c3.version === c.version && c3.flag("incomeEnabled") === true &&
    c3.enabledActions().join(",") === c.enabledActions().join(","));

  // ── container wiring ──
  const g = createGameState({ players: [
    { id: "A", charterId: 0 }, { id: "B", charterId: 1 },
  ], firstPlayer: "A", chronicle: c3 });
  ok("the container wires the chronicle and honours its income flag",
    g.chronicle === c3 && g.progress.isIncomeEnabled() === true);
  const gs = restoreGameState(JSON.parse(g.serialize()));
  ok("the chronicle survives serialize→restore through the container",
    gs.chronicle.flag("incomeEnabled") === true && gs.chronicle.version === CHRONICLE_VERSION);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "chronicle", pass, fail, results };
}
