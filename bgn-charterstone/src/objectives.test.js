// src/objectives.test.js — Phase 7 objective-card validation (Task 29).
// Run in-page via ?test=objectives, or programmatically via window.__loadObjectivesTests().
// Task 29: 3 random objectives revealed at game start from the objective deck;
// each objective has an executable completion condition (evaluated by the
// engine's checkObjectives, auto-run after placements); each player may score
// each objective once per game (enforced by the Grandstand / objectives.score).

import { createGameState, restoreGameState } from "./serialization.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS } from "./cards.js";

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function runObjectivesTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  function makeGame(overrides = {}) {
    const g = createGameState({
      players: [
        { id: "A", charterId: 0, startingCoins: 4 },
        { id: "B", charterId: 1, startingCoins: 4 },
      ],
      firstPlayer: "A",
      buildingDefs: DEFAULT_ENGINE_DEFS,
      cards: DEFAULT_CARDS,
      objectivesConfig: ["obj-1", "obj-2", "obj-3"],
      ...overrides,
    });
    g.cellA0 = g.board.legalConstructionCellsForCharter(0)[0];
    g.cellA1 = g.board.legalConstructionCellsForCharter(0)[1];
    return g;
  }
  function grandstandCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "grandstand").cell;
  }
  function zeppelinCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "zeppelin").cell;
  }

  // ── Task 29: reveal ──
  const gR = createGameState({
    players: [{ id: "A", charterId: 0 }, { id: "B", charterId: 1 }],
    rng: lcg(1234),
    firstPlayer: "A",
    cards: DEFAULT_CARDS,
  });
  const revealed = gR.objectives.revealedIds();
  ok("3 random objectives are revealed at game start",
    revealed.length === 3 && new Set(revealed).size === 3 &&
    revealed.every(id => DEFAULT_CARDS[id] && DEFAULT_CARDS[id].type === "objective"));
  const gR2 = restoreGameState(JSON.parse(gR.serialize()));
  ok("revealed objectives survive serialize→restore",
    JSON.stringify(gR2.objectives.revealedIds()) === JSON.stringify(revealed));

  // ── Task 29: executable completion conditions ──
  const g = makeGame();
  g.board.placeBuilding(g.cellA0, "mine", "A");
  const none = g.engine.checkObjectives("A");
  g.board.placeBuilding(g.cellA1, "mill", "A");
  const done = g.engine.checkObjectives("A");
  ok("a 'construct 2 buildings' objective becomes checkable exactly when the player owns 2 constructed buildings",
    none.length === 0 && done.includes("obj-1") && g.objectives.isCompleted("obj-1") &&
    g.objectives.completedBy("obj-1") === "A");

  // ── Task 29: each player scores each objective once ──
  const gS = makeGame();
  gS.objectives.markCompleted("obj-1", "A");
  const r1 = gS.engine.placeWorker("A", grandstandCell(gS), { objectiveId: "obj-1" });
  ok("the first score of a completed objective succeeds",
    r1.ok && gS.player("A").vp === 5 && gS.objectives.hasScored("obj-1", "A"));
  gS.engine.retrieveWorkers("B");
  const r2 = gS.engine.placeWorker("A", grandstandCell(gS), { objectiveId: "obj-1" });
  ok("the same player's second score of one objective is rejected",
    !r2.ok && r2.reason === "already_scored");
  gS.engine.retrieveWorkers("A");
  const r3 = gS.engine.placeWorker("B", grandstandCell(gS), { objectiveId: "obj-1" });
  ok("each player may score each objective once",
    r3.ok && gS.player("B").vp === 5 && gS.objectives.hasScored("obj-1", "B"));
  gS.engine.retrieveWorkers("A");
  const r4 = gS.engine.placeWorker("B", grandstandCell(gS), { objectiveId: "obj-1" });
  ok("the second player's second score is also rejected",
    !r4.ok && r4.reason === "already_scored");

  // ── Task 29: engine auto-checks after placements ──
  const gA = makeGame();
  gA.player("A").gainCard("bldg-mine");
  gA.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const ra1 = gA.engine.placeWorker("A", zeppelinCell(gA), { cardId: "bldg-mine", constructionCell: gA.cellA0 });
  ok("no completion after the first construction",
    ra1.ok && ra1.completedObjectives.length === 0 && !gA.objectives.isCompleted("obj-1"));
  gA.engine.retrieveWorkers("B");
  gA.player("A").gainCard("bldg-lumber");
  gA.economy.gain("A", { wood: 1, pumpkin: 1 });
  const ra2 = gA.engine.placeWorker("A", zeppelinCell(gA), { cardId: "bldg-lumber", constructionCell: gA.cellA1 });
  ok("the engine auto-checks objectives after placements and completes the construct-2 objective",
    ra2.ok && ra2.completedObjectives.includes("obj-1") && gA.objectives.isCompleted("obj-1"));

  // ── Task 40: the full objective deck compiles and evaluates on crafted states ──
  const objectiveCards = Object.values(DEFAULT_CARDS).filter(c => c.type === "objective");
  ok("every objective in the full set ships an executable condition predicate",
    objectiveCards.length === 8 && objectiveCards.every(c => typeof c.condition === "function"));
  const mkCtx = (over = {}) => ({
    state: null,
    playerId: "A",
    constructedBuildingCount: over.buildings ?? 0,
    player: {
      coins: () => over.coins ?? 0,
      resources: () => over.resources ?? {},
      constructedBuildingCount: over.buildings ?? 0,
    },
  });
  const evalObj = (id, ctx) => DEFAULT_CARDS[id].condition(ctx);
  ok("obj-1 'own 2 buildings' — true at 2, false at 1",
    evalObj("obj-1", mkCtx({ buildings: 2 })) === true && evalObj("obj-1", mkCtx({ buildings: 1 })) === false);
  ok("obj-2 'hold 8 coins' — true at 8, false at 7",
    evalObj("obj-2", mkCtx({ coins: 8 })) === true && evalObj("obj-2", mkCtx({ coins: 7 })) === false);
  ok("obj-3 'hold 6 resources' — true at 6, false at 5",
    evalObj("obj-3", mkCtx({ resources: { wood: 3, grain: 3 } })) === true &&
    evalObj("obj-3", mkCtx({ resources: { wood: 3, grain: 2 } })) === false);
  ok("obj-4 'own 3 buildings' — true at 3, false at 2",
    evalObj("obj-4", mkCtx({ buildings: 3 })) === true && evalObj("obj-4", mkCtx({ buildings: 2 })) === false);
  ok("obj-5 'hold 3 resource types' — true at 3, false at 2",
    evalObj("obj-5", mkCtx({ resources: { wood: 1, grain: 1, clay: 1 } })) === true &&
    evalObj("obj-5", mkCtx({ resources: { wood: 1, grain: 1 } })) === false);
  ok("obj-6 'own 4 buildings' — true at 4, false at 3",
    evalObj("obj-6", mkCtx({ buildings: 4 })) === true && evalObj("obj-6", mkCtx({ buildings: 3 })) === false);
  ok("obj-7 'hold 10 coins' — true at 10, false at 9",
    evalObj("obj-7", mkCtx({ coins: 10 })) === true && evalObj("obj-7", mkCtx({ coins: 9 })) === false);
  ok("obj-8 'hold 8 resources' — true at 8, false at 7",
    evalObj("obj-8", mkCtx({ resources: { wood: 4, clay: 4 } })) === true &&
    evalObj("obj-8", mkCtx({ resources: { wood: 4, clay: 3 } })) === false);
  const gFull = makeGame();
  const realCtx = (() => {
    const p = gFull.player("A");
    const pctx = { ...p, constructedBuildingCount: 1 };
    return { state: gFull, playerId: "A", player: pctx, constructedBuildingCount: 1 };
  })();
  ok("every condition evaluates to a boolean on a real engine player context without throwing",
    objectiveCards.every(c => { const v = c.condition(realCtx); return v === true || v === false; }));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "objectives", pass, fail, results };
}
