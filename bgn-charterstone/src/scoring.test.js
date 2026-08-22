// src/scoring.test.js — Phase 7 objectives/progress/end-game validation (Tasks 30-33).
// Run in-page via ?test=scoring, or programmatically via window.__loadScoringTests().
// Task 30: general objective scoring — 1 influence token (static placement),
//          5 VP, +1 progress; a second score of the same objective is rejected.
// Task 31: progress-advance triggers — construction/crate/objective advances
//          plus the forced 0-influence advance at turn start; a turn that
//          constructs and scores advances the token exactly 2.
// Task 32: end-of-game sequence — reaching the final space finishes the round
//          (each other player takes exactly one more turn), then scoring runs.
// Task 33: end-game scoring tally — reputation + objectives + buildings +
//          crates, ties broken by reputation tokens then constructed buildings.

import { createGameState, restoreGameState } from "./serialization.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS } from "./cards.js";
import { createProgressTrack } from "./progress.js";
import { scoreEndGame, OBJECTIVE_VP, CRATE_VP } from "./scoring.js";

export function runScoringTests() {
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
      advancementConfig: { deck: ["asst-1", "asst-2", "asst-3", "bldg-mine", "bldg-mill", "bldg-lumber"] },
      objectivesConfig: ["obj-1", "obj-2", "obj-3"],
      ...overrides,
    });
    const commons = {};
    for (const b of g.board.commonsBuildings()) commons[b.buildingId] = b.cell;
    g.commons = commons;
    g.cellA0 = g.board.legalConstructionCellsForCharter(0)[0];
    g.cellB0 = g.board.legalConstructionCellsForCharter(1)[0];
    return g;
  }
  function zeppelinCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "zeppelin").cell;
  }
  function grandstandCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "grandstand").cell;
  }

  // ── Task 30: general objective scoring ──
  const g30 = makeGame();
  g30.objectives.markCompleted("obj-1", "A");
  const s1 = g30.engine.scoreObjective("A", "obj-1");
  ok("scoring a completed objective costs 1 influence, grants 5 VP, and advances progress 1",
    s1.ok && s1.vp === OBJECTIVE_VP && s1.vp === 5 &&
    g30.player("A").vp === 5 && g30.progress.position === 3 &&
    g30.influence.availableOf("A") === 11 && g30.influence.placedOn("A", "objective:obj-1") === 1 &&
    g30.objectives.hasScored("obj-1", "A"));
  const s2 = g30.engine.scoreObjective("A", "obj-1");
  ok("the same player's second score on one objective is rejected",
    !s2.ok && s2.reason === "already_scored" && g30.player("A").vp === 5 && g30.progress.position === 3);
  const s3 = g30.engine.scoreObjective("B", "obj-1");
  ok("another player may score the same completed objective",
    s3.ok && g30.player("B").vp === 5 && g30.objectives.hasScored("obj-1", "B"));
  const g30b = makeGame();
  const sB = g30b.engine.scoreObjective("A", "obj-1");
  ok("scoring an incomplete objective is rejected",
    !sB.ok && sB.reason === "objective_not_completed" && g30b.player("A").vp === 0);
  const g30c = makeGame();
  g30c.objectives.markCompleted("obj-1", "A");
  g30c.influence.spend("A", 12);
  const sC = g30c.engine.scoreObjective("A", "obj-1");
  ok("scoring without an influence token is rejected",
    !sC.ok && sC.reason === "no_influence" && g30c.player("A").vp === 0);

  // ── Task 31: progress-advance triggers ──
  const g31 = makeGame();
  const startPos = g31.progress.position;
  g31.player("A").gainCard("bldg-mine");
  g31.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const c1 = g31.engine.placeWorker("A", zeppelinCell(g31), { cardId: "bldg-mine", constructionCell: g31.cellA0 });
  ok("construction advances the progress token 1",
    c1.ok && g31.progress.position === startPos + 1);
  g31.engine.retrieveWorkers("B");
  g31.objectives.markCompleted("obj-1", "A");
  const c2 = g31.engine.placeWorker("A", grandstandCell(g31), { objectiveId: "obj-1" });
  ok("a turn that constructs and scores advances the token exactly 2",
    c2.ok && g31.progress.position === startPos + 2 &&
    g31.progress.history().filter(h => h.reason === "construct").length === 1 &&
    g31.progress.history().filter(h => h.reason === "objective").length === 1);

  const gF = makeGame();
  gF.influence.spend("A", 12);
  const posBefore = gF.progress.position;
  gF.economy.gain("A", { clay: 1 });
  const f1 = gF.engine.placeWorker("A", gF.commons.treasury, { resource: "clay" });
  ok("a player who begins their turn with 0 influence must advance the token 1 before acting",
    f1.ok && f1.forcedAdvance && f1.forcedAdvance.ok === true &&
    f1.forcedAdvance.trigger === "noInfluence" && gF.progress.position === posBefore + 1 &&
    gF.progress.history()[0].reason === "noInfluence");
  gF.engine.retrieveWorkers("B");
  const f2 = gF.engine.retrieveWorkers("A");
  ok("the forced advance fires again on the retrieve turn while influence stays 0",
    f2.ok && f2.forcedAdvance && f2.forcedAdvance.ok && gF.progress.position === posBefore + 2);

  const gP = makeGame();
  gP.economy.gain("A", { clay: 1 });
  const p1 = gP.engine.placeWorker("A", gP.commons.treasury, { resource: "clay" });
  ok("a player with influence faces no forced advance",
    p1.ok && p1.forcedAdvance === null && gP.progress.position === 2);

  // ── Task 32: end-of-game sequence ──
  const g32 = makeGame({ progress: createProgressTrack({ spaces: [null, null, "end"], playerCount: 2 }) });
  g32.player("A").gainCard("bldg-mine");
  g32.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const e1 = g32.engine.placeWorker("A", zeppelinCell(g32), { cardId: "bldg-mine", constructionCell: g32.cellA0 });
  ok("reaching the final space triggers the end", e1.ok && g32.progress.endReached());
  ok("the round is not finished yet, so the next player may still act",
    !g32.turns.allCountsEqual() && g32.engine.legalActions("B").join(",") === "place,retrieve");
  g32.economy.gain("B", { clay: 1 });
  const e2 = g32.engine.placeWorker("B", g32.commons.treasury, { resource: "clay" });
  ok("the other player takes exactly one more turn before the game blocks",
    e2.ok && g32.turns.allCountsEqual() && g32.turns.currentPlayerId === "A");
  const e3 = g32.engine.placeWorker("A", g32.commons.treasury, { resource: "clay" });
  ok("once the round is equal, further placements are refused",
    !e3.ok && e3.reason === "game_ended" && g32.engine.legalActions("A").length === 0);
  const end = g32.engine.endGame();
  ok("end-game scoring runs after the round finishes", end.ok && Array.isArray(end.standings));

  const g32b = makeGame({ progress: createProgressTrack({ spaces: [null, null, "end"], playerCount: 2 }) });
  ok("endGame is refused while the game is still running", !g32b.engine.endGame().ok);

  // ── Task 33: end-game scoring tally ──
  const g33 = makeGame();
  g33.reputation.place("A"); g33.reputation.place("A"); g33.reputation.place("A");
  g33.reputation.place("B");
  g33.objectives.markCompleted("obj-1", "A");
  g33.engine.scoreObjective("A", "obj-1");
  g33.engine.scoreObjective("B", "obj-1");
  g33.board.placeBuilding(g33.cellA0, "mine", "A");
  g33.board.placeBuilding(g33.cellB0, "lumber", "B");
  g33.crates.unlock("A", "cbldg-1", 1);
  const st33 = scoreEndGame(g33);
  const A33 = st33.find(s => s.playerId === "A");
  const B33 = st33.find(s => s.playerId === "B");
  ok("a scripted end-state produces the expected final order",
    st33[0].playerId === "A" && A33.total === 23 && A33.rank === 1 &&
    st33[1].playerId === "B" && B33.total === 14 && B33.rank === 2);
  ok("the tally reports each scoring source separately",
    A33.reputationVp === 10 && A33.objectiveVp === OBJECTIVE_VP &&
    A33.buildingVp === 3 && A33.crateVp === CRATE_VP &&
    B33.reputationVp === 7 && B33.objectiveVp === OBJECTIVE_VP &&
    B33.buildingVp === 2 && B33.crateVp === 0);

  const gT = makeGame();
  gT.reputation.place("A"); gT.reputation.place("B");
  gT.objectives.markCompleted("obj-1", "A");
  gT.engine.scoreObjective("A", "obj-1");
  gT.engine.scoreObjective("B", "obj-1");
  gT.board.placeBuilding(gT.cellA0, "mine", "A");
  gT.board.placeBuilding(gT.board.legalConstructionCellsForCharter(0)[1], "lumber", "A");
  gT.crates.unlock("B", "cbldg-1", 1);
  const stT = scoreEndGame(gT);
  const AT = stT.find(s => s.playerId === "A");
  const BT = stT.find(s => s.playerId === "B");
  ok("ties break by reputation tokens then constructed buildings",
    AT.total === BT.total && AT.total === 20 &&
    AT.constructedBuildings === 2 && BT.constructedBuildings === 0 &&
    AT.rank === 1 && BT.rank === 2);

  const g33r = restoreGameState(JSON.parse(g33.serialize()));
  ok("end-game scoring is identical after serialize→restore",
    JSON.stringify(scoreEndGame(g33r).map(s => s.total)) === JSON.stringify(scoreEndGame(g33).map(s => s.total)));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "scoring", pass, fail, results };
}
