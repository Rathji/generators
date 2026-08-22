// src/engine.test.js — Tasks 11-14 validation suite for src/engine.js.
// Run in-page via ?test=engine, or programmatically via window.__loadEngineTests().
// Task 11: worker placement + bumping. Task 12: cost/benefit resolution.
// Task 13: worker retrieval. Task 14: turn legality (multi-action, out-of-turn,
// post-end). Also covers worker-state serialization through the container.

import { createGameState, restoreGameState } from "./serialization.js";
import { COMMONS_BUILDING_DEFS } from "./buildings.js";
import { createProgressTrack } from "./progress.js";

export function runEngineTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const NEUTRAL_COMMONS = {};
  for (const id of Object.keys(COMMONS_BUILDING_DEFS)) {
    NEUTRAL_COMMONS[id] = { id, name: COMMONS_BUILDING_DEFS[id].name, cost: {}, benefit: null, slots: 1, commons: true, phase: 4 };
  }
  const TEST_DEFS = {
    ...NEUTRAL_COMMONS,
    quarry:   { id: "quarry",   name: "Quarry",   cost: { clay: 2, coins: 1 }, benefit: { items: { metal: 1 } }, slots: 1 },
    woodshop: { id: "woodshop", name: "Woodshop", cost: { wood: 1 }, benefit: { items: { coins: 2 } }, slots: 1 },
    mine:     { id: "mine",     name: "Mine",     cost: {}, benefit: { items: { metal: 1 } }, slots: 1 },
    smithy:   { id: "smithy",   name: "Smithy",   cost: {}, benefit: { items: { coins: 3 } }, slots: 1 },
  };

  function makeGame(overrides = {}) {
    const g = createGameState({
      players: [
        { id: "A", charterId: 0, startingCoins: 4 },
        { id: "B", charterId: 1, startingCoins: 4 },
      ],
      firstPlayer: "A",
      buildingDefs: TEST_DEFS,
      ...overrides,
    });
    const c0 = g.board.legalConstructionCellsForCharter(0);
    const c1 = g.board.legalConstructionCellsForCharter(1);
    g.board.placeBuilding(c0[0], "quarry", "A");
    g.board.placeBuilding(c1[0], "mine", "B");
    g.board.placeBuilding(c0[1], "woodshop", "A");
    g.board.placeBuilding(c1[1], "smithy", "B");
    const commons = {};
    for (const b of g.board.commonsBuildings()) commons[b.buildingId] = b.cell;
    g.cells = { q: c0[0], w: c0[1], m: c1[0], s: c1[1] };
    g.commons = commons;
    return g;
  }

  // ── Task 11: worker placement & bumping ──
  const g11 = makeGame();
  const treas = g11.commons.treasury;
  const r1 = g11.engine.placeWorker("A", treas);
  ok("placing a worker succeeds and places it on the building",
    r1.ok && g11.engine.workersOn(treas) === "A" && g11.board.workerCells().length === 1);
  ok("the placed worker leaves the personal supply", g11.player("A").workers === 1);
  ok("a successful placement ends the turn", g11.turns.currentPlayerId === "B");

  const grand = g11.commons.grandstand;
  const r2 = g11.engine.placeWorker("B", treas);
  ok("placing onto an occupied building bumps the occupant and succeeds",
    r2.ok && r2.bumped === "A" && g11.engine.workersOn(treas) === "B");
  ok("the bumped worker returns to its owner's supply", g11.player("A").workers === 2);
  ok("the placer's own worker leaves their supply", g11.player("B").workers === 1);

  const r3 = g11.engine.placeWorker("A", grand);
  ok("a worker can be placed on a different building on the next turn",
    r3.ok && g11.engine.workersOn(grand) === "A");

  const gNo = makeGame({ players: [
    { id: "A", charterId: 0, workers: 0 },
    { id: "B", charterId: 1 },
  ] });
  const noWorkers = gNo.engine.placeWorker("A", gNo.commons.treasury);
  ok("placing with 0 workers in supply is rejected", !noWorkers.ok && noWorkers.reason === "no_workers");
  ok("a workerless player's only legal action is retrieve",
    gNo.engine.legalActions("A").join(",") === "retrieve");

  const gNoBldg = makeGame();
  const noBldg = gNoBldg.engine.placeWorker("A", "0,0");
  ok("placing on a cell without a building is rejected", !noBldg.ok && noBldg.reason === "no_building");

  // ── Task 12: cost & benefit resolution ──
  const g12 = makeGame();
  g12.economy.gain("A", { clay: 1 });
  const blocked = g12.engine.placeWorker("A", g12.cells.q);
  ok("a 2-clay+1-coin building blocks placement at 1 clay",
    !blocked.ok && blocked.reason === "cannot_afford_cost" && blocked.cost.clay === 2);
  ok("the blocked placement consumes nothing",
    g12.player("A").workers === 2 && g12.engine.workersOn(g12.cells.q) === null &&
    g12.turns.currentPlayerId === "A" && g12.economy.amountOf("A", "coins") === 4);

  const g12b = makeGame();
  g12b.economy.gain("A", { clay: 2 });
  const paid = g12b.engine.placeWorker("A", g12b.cells.q);
  ok("an affordable placement pays exactly the cost and gains the benefit",
    paid.ok && g12b.economy.amountOf("A", "clay") === 0 && g12b.economy.amountOf("A", "coins") === 3 &&
    g12b.economy.generalItems().clay === 12 && g12b.economy.generalItems().coins === 29 &&
    g12b.economy.amountOf("A", "metal") === 1);

  const g12c = makeGame();
  g12c.economy.gain("A", { wood: 1 });
  const partial = g12c.engine.placeWorker("A", g12c.cells.w, { take: { coins: 1 } });
  ok("part of the benefit can be gained",
    partial.ok && partial.benefit.granted.coins === 1 && g12c.economy.amountOf("A", "coins") === 5);

  const g12d = makeGame();
  g12d.economy.gain("A", { metal: 12 });
  const short = g12d.engine.placeWorker("A", g12d.cells.m);
  ok("benefit gain never exceeds the finite supply",
    short.ok && short.benefit.hasShortfall && short.benefit.granted.metal === 0 &&
    g12d.economy.amountOf("A", "metal") === 12);

  // ── Task 13: worker retrieval ──
  const g13 = makeGame();
  g13.engine.placeWorker("A", g13.commons.treasury);   // turn 1
  g13.engine.placeWorker("B", g13.commons.market);     // turn 2
  g13.engine.placeWorker("A", g13.commons.grandstand); // turn 3
  g13.engine.placeWorker("B", g13.commons.charterstone); // turn 4
  ok("after 2 placements the player has 2 workers on the board",
    g13.board.workerCellsOf("A").length === 2 && g13.player("A").workers === 0);
  const ret = g13.engine.retrieveWorkers("A"); // turn 5
  ok("retrieving after 2 placements returns exactly 2 workers",
    ret.ok && ret.retrieved === 2 && g13.player("A").workers === 2);
  ok("retrieval clears the board of that player's workers", g13.board.workerCellsOf("A").length === 0);
  ok("retrieval ends the turn", g13.turns.currentPlayerId === "B");

  // ── Task 14: turn legality ──
  const g14 = makeGame();
  g14.engine.placeWorker("A", g14.commons.treasury);
  const second = g14.engine.placeWorker("A", g14.commons.market);
  ok("a second action in one turn is rejected", !second.ok && second.reason === "not_your_turn");
  const secondRet = g14.engine.retrieveWorkers("A");
  ok("a second (different) action in one turn is also rejected", !secondRet.ok && secondRet.reason === "not_your_turn");

  const g14b = makeGame();
  const outOfTurn = g14b.engine.placeWorker("B", g14b.commons.treasury);
  ok("out-of-turn moves are rejected", !outOfTurn.ok && outOfTurn.reason === "not_your_turn");
  const outRet = g14b.engine.retrieveWorkers("B");
  ok("out-of-turn retrieves are rejected", !outRet.ok && outRet.reason === "not_your_turn");

  const g14c = makeGame({
    progress: createProgressTrack({ spaces: [null, null, "end"], playerCount: 2 }),
  });
  g14c.progress.advance("construct");
  const postEnd = g14c.engine.placeWorker("A", g14c.commons.treasury);
  ok("post-end placements are refused", !postEnd.ok && postEnd.reason === "game_ended");
  const postEndRet = g14c.engine.retrieveWorkers("A");
  ok("post-end retrieves are refused", !postEndRet.ok && postEndRet.reason === "game_ended");
  ok("no actions are legal after the end trigger", g14c.engine.legalActions("A").length === 0);

  const g14d = makeGame();
  ok("a capable player sees exactly the two turn actions",
    g14d.engine.legalActions("A").join(",") === "place,retrieve");
  g14d.engine.placeWorker("A", g14d.commons.treasury);
  ok("the next player sees exactly the two turn actions too",
    g14d.engine.legalActions("B").join(",") === "place,retrieve");

  // ── worker state serialization ──
  const gSer = makeGame();
  gSer.engine.placeWorker("A", gSer.commons.treasury);   // turn 1
  gSer.engine.placeWorker("B", gSer.commons.market);     // turn 2
  gSer.economy.gain("A", { clay: 2 });
  gSer.engine.placeWorker("A", gSer.cells.q);            // turn 3 (cost paid)
  const dataSer = JSON.parse(gSer.serialize());
  const gSer2 = restoreGameState(dataSer, { buildingDefs: TEST_DEFS });
  ok("worker placement survives serialize→restore identically",
    gSer2.engine.workersOn(gSer.commons.treasury.key) === "A" &&
    gSer2.engine.workersOn(gSer.commons.market.key) === "B" &&
    gSer2.engine.workersOn(gSer.cells.q.key) === "A" &&
    gSer2.board.workerCellsOf("A").length === 2 && gSer2.board.workerCellsOf("B").length === 1);
  const grand2 = gSer2.board.commonsBuildings().find(b => b.buildingId === "grandstand").cell;
  ok("a restored engine is fully live (retrieve + resume)",
    gSer2.engine.retrieveWorkers("B").ok && gSer2.player("B").workers === 2 &&
    gSer2.engine.retrieveWorkers("A").ok && gSer2.player("A").workers === 2 &&
    gSer2.engine.placeWorker("B", grand2).ok);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "engine", pass, fail, results };
}
