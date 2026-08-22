// src/legacy.test.js — Phase 8 Archive-exclusion and legacy-persistence
// validation (Tasks 36 & 37). Run in-page via ?test=legacy, or
// programmatically via window.__loadLegacyTests().
// Task 36: archived components (crateless constructed cards, spent cards)
// cannot re-enter the game — excluded from all decks and hands.
// Task 37: constructed buildings, applied stickers, and unlocked crates
// persist in campaign state and appear in the next game's setup.

import { createGameState, restoreGameState } from "./serialization.js";
import { createAdvancement } from "./advancement.js";
import { createArchive } from "./archive.js";
import { collectLegacyState, createLegacyState, setupNextGame, LEGACY_VERSION } from "./legacy.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS } from "./cards.js";

export function runLegacyTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };

  function makeGame(overrides = {}) {
    const g = createGameState({
      players: [
        { id: "A", charterId: 0, startingCoins: 4 },
        { id: "B", charterId: 1, startingCoins: 4 },
      ],
      firstPlayer: "A",
      buildingDefs: DEFAULT_ENGINE_DEFS,
      cards: DEFAULT_CARDS,
      ...overrides,
    });
    g.cellA = g.board.legalConstructionCellsForCharter(0);
    g.cellB = g.board.legalConstructionCellsForCharter(1);
    const commons = {};
    for (const b of g.board.commonsBuildings()) commons[b.buildingId] = b.cell;
    g.commons = commons;
    return g;
  }
  function zeppelinCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "zeppelin").cell;
  }
  function charterstoneCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "charterstone").cell;
  }

  // ── Task 36: the Archive excludes components ──
  const archive = createArchive();
  archive.add("bldg-mine");
  archive.add("cbldg-1");
  const adv = createAdvancement({ deck: ["bldg-mine", "a", "b", "c", "d", "e"], archive });
  ok("archived cards are not seeded onto the mat",
    !adv.mat().includes("bldg-mine") && adv.mat().filter(Boolean).length === 5);
  adv.addToDeck(["cbldg-1", "fresh"]);
  ok("archived cards are not added to the deck",
    adv.toJSON().deck.includes("fresh") && !adv.toJSON().deck.includes("cbldg-1"));

  const adv2 = createAdvancement({ deck: ["x1", "x2", "x3", "x4", "x5"], archive });
  for (const id of adv2.mat()) adv2.discard(id);
  adv2.discard("bldg-mine");
  const gained = [];
  for (const id of adv2.mat()) gained.push(adv2.gainCard("P", id).cardId);
  ok("re-seeding from a discard skips archived cards",
    adv2.mat().filter(Boolean).length === 5 && !adv2.mat().includes("bldg-mine") &&
    adv2.discardCount() === 0 && gained.length === 5);

  ok("fromJSON drops archived cards from deck, discard and mat",
    (() => {
      const arc = createArchive();
      arc.add("cbldg-1");
      const a = createAdvancement({ deck: ["z1", "z2", "z3", "z4", "z5"], archive: arc });
      a.fromJSON({ kind: "advancement", matSize: 5, deck: ["cbldg-1", "z6"], discard: ["cbldg-1", "z7"], mat: ["cbldg-1", "z8", null, null, null] });
      return !a.toJSON().deck.includes("cbldg-1") && !a.toJSON().discard.includes("cbldg-1") && a.toJSON().mat[0] === null;
    })());

  const g = makeGame();
  g.archive.add("asst-1");
  ok("archived cards cannot enter a player's hand",
    throws(() => g.player("A").gainCard("asst-1")));
  ok("non-archived cards still enter a hand normally",
    !throws(() => g.player("A").gainCard("asst-2")) && g.player("A").hasCard("asst-2"));

  // ── Task 37: legacy persistence — a real game builds 3 buildings, unlocks 1 crate ──
  const gE = makeGame();
  gE.player("A").gainCard("bldg-mine");
  gE.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const r1 = gE.engine.placeWorker("A", zeppelinCell(gE), { cardId: "bldg-mine", constructionCell: gE.cellA[0] });
  gE.engine.retrieveWorkers("B");
  gE.player("A").gainCard("bldg-mill");
  gE.economy.gain("A", { wood: 2, clay: 1 });
  const r2 = gE.engine.placeWorker("A", zeppelinCell(gE), { cardId: "bldg-mill", constructionCell: gE.cellA[1] });
  gE.engine.retrieveWorkers("B");
  gE.player("A").gainCard("bldg-lumber");
  gE.economy.gain("A", { wood: 1, pumpkin: 1 });
  const r3 = gE.engine.placeWorker("A", zeppelinCell(gE), { cardId: "bldg-lumber", constructionCell: gE.cellA[2] });
  gE.engine.retrieveWorkers("B");
  gE.economy.gain("A", { coins: 4 });
  const r4 = gE.engine.placeWorker("A", charterstoneCell(gE), { cardId: "cbldg-mine" });
  ok("the scripted game builds 3 buildings and unlocks 1 crate",
    r1.ok && r2.ok && r3.ok && r4.ok &&
    gE.board.constructedBuildings().length === 3 && gE.crates.count() === 1 &&
    gE.crates.isUnlocked("cbldg-mine") && gE.crates.crateOf("cbldg-mine") === 1);

  const legacy = collectLegacyState(gE);
  ok("legacy state collects constructed buildings, stickers and crates",
    legacy.kind === "charterstone-legacy" && legacy.version === LEGACY_VERSION &&
    legacy.constructedBuildings.length === 3 && legacy.crates.length === 1 &&
    legacy.crates[0].cardId === "cbldg-mine" && legacy.crates[0].crateNumber === 1);

  gE.stickerBook.apply("rule-drop-players");
  const legacy2 = collectLegacyState(gE);
  ok("legacy state collects applied stickers", legacy2.stickers.join(",") === "rule-drop-players");

  const cfg = setupNextGame(legacy2, { players: [
    { id: "A", charterId: 0 }, { id: "B", charterId: 1 },
  ], firstPlayer: "B" });
  const next = createGameState(cfg);
  ok("next-game setup includes the 3 constructed buildings at the same cells with owners",
    next.board.constructedBuildings().length === 3 &&
    next.board.constructedBuildings().every(b =>
      legacy2.constructedBuildings.some(lb =>
        lb.q === b.cell.q && lb.r === b.cell.r && lb.buildingId === b.buildingId && lb.ownerId === b.ownerId)));
  ok("next-game setup includes the applied sticker and its rule flag",
    next.stickerBook.isApplied("rule-drop-players") && next.chronicle.flag("dropPlayers") === true &&
    next.chronicle.enabledActions().join(",") === "place,retrieve,dropPlayer");
  ok("next-game setup includes the unlocked crate",
    next.crates.isUnlocked("cbldg-mine") && next.crates.crateOf("cbldg-mine") === 1);
  ok("next-game setup is fully playable (a placement succeeds)",
    (() => {
      next.economy.gain("B", { clay: 1 });
      return next.engine.placeWorker("B", next.board.commonsBuildings().find(x => x.buildingId === "treasury").cell, { resource: "clay" }).ok;
    })());

  const legacyRoundTrip = createLegacyState(JSON.parse(JSON.stringify(legacy2)));
  ok("legacy state round-trips as JSON",
    JSON.stringify(legacyRoundTrip) === JSON.stringify(legacy2));

  const gS = makeGame();
  gS.archive.add("cbldg-2");
  gS.engine.retrieveWorkers("B");
  const gS2 = restoreGameState(JSON.parse(gS.serialize()));
  ok("the archive persists across serialize→restore",
    gS2.archive.has("cbldg-2") && throws(() => gS2.player("A").gainCard("cbldg-2")));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "legacy", pass, fail, results };
}
