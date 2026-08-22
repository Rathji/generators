// src/buildings.test.js — Phase 5 validation suite (Tasks 20-24).
// Run in-page via ?test=buildings, or programmatically via window.__loadBuildingsTests().
// Task 20: Charterstone crate unlock archives the constructed building card.
// Task 21: building-card lifecycle (crate card retained, crateless card archived).
// Task 22: construction placement legality (first building touches the charter).
// Task 23: building-tile content data validates against the schema.
// Task 24: owner benefit when another player uses your building.

import { createGameState, restoreGameState } from "./serialization.js";
import { DEFAULT_ENGINE_DEFS, COMMONS_BUILDING_DEFS } from "./buildings.js";
import { DEFAULT_BUILDING_TILES, validateBuildingTiles } from "./buildingTiles.js";
import { DEFAULT_CARDS } from "./cards.js";

export function runBuildingsTests() {
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
  function construct(g, playerId, cardId, resources, cell) {
    g.player(playerId).gainCard(cardId);
    g.economy.gain(playerId, resources);
    return g.engine.placeWorker(playerId, zeppelinCell(g), { cardId, constructionCell: cell });
  }

  // ── Task 20: Charterstone archives the constructed card on unlock ──
  const g20 = makeGame();
  g20.player("A").gainCard("cbldg-1");
  const r20 = g20.engine.placeWorker("A", g20.commons.charterstone, { cardId: "cbldg-1" });
  ok("Charterstone unlock archives the constructed building card",
    r20.ok && r20.benefit.archived === true && g20.crates.isUnlocked("cbldg-1") &&
    !g20.player("A").hasCard("cbldg-1") && g20.archive.has("cbldg-1") && g20.archive.count() === 1 &&
    g20.player("A").vp === 5 && g20.progress.position === 3);

  // ── Task 21: building-card lifecycle ──
  const g21a = makeGame();
  const r21a = construct(g21a, "A", "bldg-mine", { coal: 1, wood: 1, grain: 1, pumpkin: 1 }, g21a.cellA0);
  ok("building a crate-bearing building retains a constructed card in the supply",
    r21a.ok && r21a.benefit.leftover === "cbldg-mine" &&
    !g21a.player("A").hasCard("bldg-mine") && g21a.player("A").hasCard("cbldg-mine") &&
    g21a.board.constructedBuildings().length === 1 && g21a.archive.count() === 0);

  const g21b = makeGame();
  const r21b = construct(g21b, "A", "bldg-mill", { wood: 2, clay: 1 }, g21b.cellA0);
  ok("building a crateless building archives its card",
    r21b.ok && r21b.benefit.leftover === "archived" &&
    !g21b.player("A").hasCard("bldg-mill") && g21b.archive.has("bldg-mill") && g21b.archive.count() === 1);

  // ── Task 22: building placement legality ──
  const g22 = makeGame();
  const firstLegal = g22.engine.legalConstructionCellsForPlayer("A");
  const nonAdjacent = g22.board.destinationCells().filter(c => !firstLegal.some(x => x.key === c.key))[0];
  ok("the first building must touch the charter (exactly the 3 charter-adjacent cells)",
    firstLegal.length === 3 && g22.engine.isLegalConstructionCellForPlayer("A", g22.cellA0) &&
    !g22.engine.isLegalConstructionCellForPlayer("A", nonAdjacent));
  g22.board.placeBuilding(g22.cellA0, "mine", "A");
  const afterFirst = g22.engine.legalConstructionCellsForPlayer("A");
  ok("after the first building, cells adjacent to it (off the charter) become legal",
    afterFirst.length === 4 &&
    afterFirst.some(c => c.key === "3,-2") && afterFirst.some(c => c.key === "2,-1") &&
    g22.engine.isLegalConstructionCellForPlayer("A", "3,-2"));
  const g22b = makeGame();
  g22b.board.placeBuilding(g22b.cellA0, "mine", "A");
  const r22 = construct(g22b, "A", "bldg-lumber", { wood: 1, pumpkin: 1 }, g22b.board.cell("3,-2"));
  ok("a construction on a now-legal building-adjacent cell succeeds",
    r22.ok && g22b.board.buildingAt("3,-2") === "lumber" && g22b.board.ownerAt("3,-2") === "A");
  const g22c = makeGame();
  const r22c = construct(g22c, "A", "bldg-lumber", { wood: 1, pumpkin: 1 }, g22c.cellB0);
  ok("a construction on a non-adjacent cell (B's charter area) is rejected",
    !r22c.ok && r22c.reason === "illegal_construction_cell" &&
    g22c.board.constructedBuildings().length === 0 && g22c.player("A").workers === 2);

  // ── Task 23: building-tile content data schema ──
  const v23 = validateBuildingTiles(DEFAULT_BUILDING_TILES);
  ok("every content-data building validates with unique ids and complete fields",
    v23.ok && v23.errors.length === 0 && v23.count === Object.keys(DEFAULT_BUILDING_TILES).length &&
    new Set(Object.values(DEFAULT_BUILDING_TILES).map(t => t.id)).size === Object.keys(DEFAULT_BUILDING_TILES).length);
  ok("duplicate tile ids are rejected",
    !validateBuildingTiles([{ ...DEFAULT_BUILDING_TILES.mine }, { ...DEFAULT_BUILDING_TILES.mine }]).ok);
  ok("invalid tile fields are rejected (vp, constructionCost item, workerSlots)",
    !validateBuildingTiles([{ ...DEFAULT_BUILDING_TILES.mill, vp: -1 }]).ok &&
    !validateBuildingTiles([{ ...DEFAULT_BUILDING_TILES.mill, constructionCost: { gemstone: 1 } }]).ok &&
    !validateBuildingTiles([{ ...DEFAULT_BUILDING_TILES.mill, workerSlots: 0 }]).ok);
  ok("engine defs merge the Commons with the constructed tile set",
    !!DEFAULT_ENGINE_DEFS.treasury && !!DEFAULT_ENGINE_DEFS.zeppelin && !!DEFAULT_ENGINE_DEFS.mine &&
    !!DEFAULT_ENGINE_DEFS.quarry && DEFAULT_ENGINE_DEFS.mine.vp === 3 &&
    DEFAULT_ENGINE_DEFS.quarry.ownerBenefit.coins === 1);

  // ── Task 24: owner benefit ──
  const g24 = makeGame({ firstPlayer: "B" });
  g24.board.placeBuilding(g24.cellA0, "quarry", "A");
  g24.economy.gain("B", { clay: 2 });
  const r24 = g24.engine.placeWorker("B", g24.cellA0, {});
  ok("using an opponent's building credits the owner exactly the printed owner benefit",
    r24.ok && r24.ownerBenefit && r24.ownerBenefit.ownerId === "A" &&
    r24.ownerBenefit.result.granted.coins === 1 &&
    g24.player("A").coins() === 5 && g24.player("B").coins() === 3 &&
    g24.player("B").resources().metal === 1);

  const g24b = makeGame();
  g24b.board.placeBuilding(g24b.cellA0, "quarry", "A");
  g24b.economy.gain("A", { clay: 2 });
  const r24b = g24b.engine.placeWorker("A", g24b.cellA0, {});
  ok("using your own building grants no owner benefit",
    r24b.ok && r24b.ownerBenefit === null && g24b.player("A").coins() === 3);

  // ── serialization: archive + lifecycle state round-trip ──
  const gs = makeGame();
  gs.player("A").gainCard("cbldg-1");
  gs.engine.placeWorker("A", gs.commons.charterstone, { cardId: "cbldg-1" });
  gs.engine.retrieveWorkers("B");
  const gs2 = restoreGameState(JSON.parse(gs.serialize()));
  ok("the archive and crate unlocks survive serialize→restore",
    JSON.stringify(gs2.archive.toJSON()) === JSON.stringify(gs.archive.toJSON()) &&
    gs2.archive.has("cbldg-1") && gs2.crates.isUnlocked("cbldg-1") &&
    gs2.board.commonsBuildings().length === 6);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "buildings", pass, fail, results };
}
