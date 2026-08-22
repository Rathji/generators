// src/commons.test.js — Phase 4 validation suite (Tasks 15-19).
// Run in-page via ?test=commons, or programmatically via window.__loadCommonsTests().
// Task 15: the six Commons buildings resolve their own effects and cannot be
// removed. Task 16: Treasury. Task 17: Market. Task 18: Grandstand. Task 19:
// Zeppelin construction. Also covers the Charterstone crate unlock mechanism
// and the Cloud Port quota sale through the real engine (both Task 15 effects;
// crate CONTENT extraction is Task 20/34).

import { createGameState, restoreGameState } from "./serialization.js";
import { COMMONS_BUILDING_DEFS } from "./buildings.js";
import { DEFAULT_CARDS } from "./cards.js";

export function runCommonsTests() {
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
      buildingDefs: COMMONS_BUILDING_DEFS,
      cards: DEFAULT_CARDS,
      advancementConfig: {
        deck: ["asst-1", "asst-2", "asst-3", "bldg-mine", "bldg-mill", "bldg-lumber"],
      },
      objectivesConfig: ["obj-1", "obj-2", "obj-3"],
      ...overrides,
    });
    const commons = {};
    for (const b of g.board.commonsBuildings()) commons[b.buildingId] = b.cell;
    g.commons = commons;
    g.cellA0 = g.board.legalConstructionCellsForCharter(0)[0];
    return g;
  }

  // ── Task 15: The Commons building set ──
  const g15 = makeGame();
  ok("all six Commons buildings occupy their fixed cells",
    g15.board.commonsBuildings().length === 6 &&
    ["zeppelin", "charterstone", "grandstand", "treasury", "market", "cloudport"]
      .every(id => g15.commons[id] && g15.board.buildingAt(g15.commons[id]) === id));
  ok("Commons cells are not constructable",
    g15.board.commonsBuildings().every(b => !g15.board.isConstructable(b.cell)));
  ok("Commons buildings cannot be removed",
    throws(() => g15.board.removeBuilding(g15.commons.treasury)));
  ok("all six defs carry their printed identity (name, slots, commons flag)",
    Object.keys(COMMONS_BUILDING_DEFS).length === 6 &&
    Object.values(COMMONS_BUILDING_DEFS).every(d => d && d.name && d.slots >= 1 && d.commons === true) &&
    COMMONS_BUILDING_DEFS.zeppelin.influenceCost === 3 && COMMONS_BUILDING_DEFS.charterstone.influenceCost === 2);

  // ── Task 16: Treasury ──
  const g16 = makeGame();
  g16.economy.gain("A", { clay: 1 });
  const r16 = g16.engine.placeWorker("A", g16.commons.treasury, { resource: "clay" });
  ok("Treasury: paying clay yields exactly $1 and consumes exactly 1 clay",
    r16.ok && r16.cost.clay === 1 && r16.benefit.granted.coins === 1 &&
    g16.economy.amountOf("A", "clay") === 0 && g16.economy.amountOf("A", "coins") === 5 &&
    g16.economy.generalItems().clay === 12 && g16.economy.generalItems().coins === 27 &&
    g16.turns.currentPlayerId === "B");
  const g16b = makeGame();
  const bad16 = g16b.engine.placeWorker("A", g16b.commons.treasury, { resource: "coins" });
  ok("Treasury rejects an invalid resource without consuming anything",
    !bad16.ok && bad16.reason === "invalid_resource" &&
    g16b.player("A").workers === 2 && g16b.turns.currentPlayerId === "A" && g16b.player("A").coins() === 4);
  const g16c = makeGame();
  const poor = g16c.engine.placeWorker("A", g16c.commons.treasury, { resource: "wood" });
  ok("Treasury rejects payment the player cannot afford",
    !poor.ok && poor.reason === "cannot_afford_cost");

  // ── Task 17: Market ──
  const g17 = makeGame();
  g17.economy.gain("A", { clay: 1 });
  const matCard = g17.advancement.mat()[0];
  const deckBefore = g17.advancement.deckCount();
  const r17 = g17.engine.placeWorker("A", g17.commons.market, { resource: "clay", matCardId: matCard });
  ok("Market: gaining an assistant card removes it from the mat and tops it with the deck's next card",
    r17.ok && g17.player("A").hasCard(matCard) && !g17.advancement.onMat(matCard) &&
    g17.advancement.mat()[0] === "bldg-lumber" && g17.advancement.deckCount() === deckBefore - 1);
  ok("Market: the cost (1 resource + $1) was paid exactly",
    r17.ok && g17.economy.amountOf("A", "clay") === 0 && g17.economy.amountOf("A", "coins") === 3);
  const g17b = makeGame();
  g17b.economy.gain("A", { clay: 1 });
  const bad17 = g17b.engine.placeWorker("A", g17b.commons.market, { resource: "clay", matCardId: "asst-9" });
  ok("Market rejects a mat card that is not on the mat",
    !bad17.ok && bad17.reason === "no_such_mat_card" &&
    g17b.player("A").workers === 2 && g17b.turns.currentPlayerId === "A");

  // ── Task 18: Grandstand ──
  const g18 = makeGame();
  g18.objectives.markCompleted("obj-1", "A");
  const r18 = g18.engine.placeWorker("A", g18.commons.grandstand, { objectiveId: "obj-1" });
  ok("Grandstand scores a completed unscored objective: 5VP, +1 progress, influence placed",
    r18.ok && g18.player("A").vp === 5 && g18.progress.position === 3 &&
    g18.objectives.hasScored("obj-1", "A") && g18.influence.availableOf("A") === 11 &&
    g18.influence.placedOn("A", "objective:obj-1") === 1);
  const g18b = makeGame();
  g18b.objectives.markCompleted("obj-1", "A");
  g18b.engine.placeWorker("A", g18b.commons.grandstand, { objectiveId: "obj-1" });
  g18b.engine.retrieveWorkers("B");
  const r18b = g18b.engine.placeWorker("A", g18b.commons.grandstand, { objectiveId: "obj-1" });
  ok("Grandstand rejects re-scoring a scored objective",
    !r18b.ok && r18b.reason === "already_scored" && g18b.turns.currentPlayerId === "A");
  const g18c = makeGame();
  const r18c = g18c.engine.placeWorker("A", g18c.commons.grandstand, { objectiveId: "obj-2" });
  ok("Grandstand rejects scoring an incomplete objective",
    !r18c.ok && r18c.reason === "objective_not_completed");
  const g18d = makeGame();
  const r18d = g18d.engine.placeWorker("A", g18d.commons.grandstand, { objectiveId: "obj-99" });
  ok("Grandstand rejects an unknown objective", !r18d.ok && r18d.reason === "no_such_objective");

  // ── Task 19: Zeppelin (construction) ──
  const g19 = makeGame();
  const p19 = g19.player("A");
  p19.gainCard("bldg-mine");
  g19.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const r19 = g19.engine.placeWorker("A", g19.commons.zeppelin, { cardId: "bldg-mine", constructionCell: g19.cellA0 });
  ok("Zeppelin: construction succeeds — card removed, building in charter, 4 resources + 3 influence spent, 5VP, +1 progress",
    r19.ok && r19.benefit.buildingId === "mine" && r19.influenceCost === 3 &&
    g19.board.buildingAt(g19.cellA0) === "mine" && g19.board.ownerAt(g19.cellA0) === "A" &&
    !p19.hasCard("bldg-mine") &&
    g19.economy.amountOf("A", "coal") === 0 && g19.economy.amountOf("A", "wood") === 0 &&
    g19.economy.amountOf("A", "grain") === 0 && g19.economy.amountOf("A", "pumpkin") === 0 &&
    g19.influence.availableOf("A") === 9 && p19.vp === 5 && g19.progress.position === 3);
  const g19h = makeGame();
  ok("engine exposes the player's legal construction cells",
    g19h.engine.legalConstructionCellsForPlayer("B").length === 3 &&
    g19h.engine.isLegalConstructionCellForPlayer("A", g19h.cellA0) === true &&
    g19h.engine.isLegalConstructionCellForPlayer("B", g19h.cellA0) === false);

  const g19b = makeGame();
  g19b.player("A").gainCard("bldg-mine");
  g19b.economy.gain("A", { coal: 1, wood: 1, grain: 1 });
  const r19b = g19b.engine.placeWorker("A", g19b.commons.zeppelin, { cardId: "bldg-mine", constructionCell: g19b.cellA0 });
  ok("Zeppelin rejects construction with insufficient resources",
    !r19b.ok && r19b.reason === "cannot_afford_cost" && g19b.player("A").workers === 2 && g19b.turns.currentPlayerId === "A");

  const g19c = makeGame();
  g19c.player("A").gainCard("bldg-mine");
  g19c.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  g19c.influence.spend("A", 10);
  const r19c = g19c.engine.placeWorker("A", g19c.commons.zeppelin, { cardId: "bldg-mine", constructionCell: g19c.cellA0 });
  ok("Zeppelin rejects construction with insufficient influence",
    !r19c.ok && r19c.reason === "cannot_afford_influence" && r19c.influenceCost === 3 && g19c.turns.currentPlayerId === "A");

  const g19d = makeGame();
  g19d.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const r19d = g19d.engine.placeWorker("A", g19d.commons.zeppelin, { cardId: "bldg-mine", constructionCell: g19d.cellA0 });
  ok("Zeppelin rejects a card not in hand", !r19d.ok && r19d.reason === "card_not_in_hand");

  const g19e = makeGame();
  g19e.player("A").gainCard("bldg-mine");
  g19e.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const legalKeys = new Set(g19e.engine.legalConstructionCellsForPlayer("A").map(c => c.key));
  const illegalCell = g19e.board.destinationCells().find(c => !legalKeys.has(c.key));
  const r19e = g19e.engine.placeWorker("A", g19e.commons.zeppelin, { cardId: "bldg-mine", constructionCell: illegalCell });
  ok("Zeppelin rejects a construction cell outside the legal adjacency set",
    !!illegalCell && !r19e.ok && r19e.reason === "illegal_construction_cell" &&
    g19e.board.constructedBuildings().length === 0);

  const g19f = makeGame();
  g19f.player("A").gainCard("asst-1");
  g19f.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const r19f = g19f.engine.placeWorker("A", g19f.commons.zeppelin, { cardId: "asst-1", constructionCell: g19f.cellA0 });
  ok("Zeppelin rejects a non-building card", !r19f.ok && r19f.reason === "not_constructable");

  const g19g = makeGame();
  const r19g = g19g.engine.placeWorker("A", g19g.commons.zeppelin, { cardId: "nope-9", constructionCell: g19g.cellA0 });
  ok("Zeppelin rejects an unknown card", !r19g.ok && r19g.reason === "no_such_card");

  // ── Charterstone (crate-unlock mechanism, Task 15 effect; contents = Task 20/34) ──
  const g20 = makeGame();
  const p20 = g20.player("A");
  p20.gainCard("cbldg-1");
  const r20 = g20.engine.placeWorker("A", g20.commons.charterstone, { cardId: "cbldg-1" });
  ok("Charterstone unlocks a crate: $4 + 2 influence, 5VP, +1 progress, card archived",
    r20.ok && r20.influenceCost === 2 && g20.crates.isUnlocked("cbldg-1") && g20.crates.crateOf("cbldg-1") === 1 &&
    g20.economy.amountOf("A", "coins") === 0 && g20.influence.availableOf("A") === 10 &&
    p20.vp === 5 && g20.progress.position === 3 && !p20.hasCard("cbldg-1") &&
    g20.archive.has("cbldg-1"));

  const g20b = makeGame();
  g20b.player("A").gainCard("cbldg-1");
  g20b.influence.spend("A", 11);
  const r20b = g20b.engine.placeWorker("A", g20b.commons.charterstone, { cardId: "cbldg-1" });
  ok("Charterstone rejects unlocking with <2 influence",
    !r20b.ok && r20b.reason === "cannot_afford_influence" && r20b.influenceCost === 2);

  const g20c = makeGame();
  g20c.player("A").gainCard("cbldg-2");
  const r20c = g20c.engine.placeWorker("A", g20c.commons.charterstone, { cardId: "cbldg-2" });
  ok("Charterstone rejects a crateless constructed card", !r20c.ok && r20c.reason === "no_crate");

  const g20d = makeGame();
  const r20d = g20d.engine.placeWorker("A", g20d.commons.charterstone, { cardId: "cbldg-1" });
  ok("Charterstone rejects a card not in hand", !r20d.ok && r20d.reason === "card_not_in_hand");

  // ── Cloud Port (quota sale through the real engine) ──
  const gcp = makeGame();
  gcp.economy.gain("A", { grain: 2 });
  const rcp = gcp.engine.placeWorker("A", gcp.commons.cloudport, { quotaSpaceId: "q2" });
  ok("Cloud Port: selling on the +1-reputation space awards 3VP, 1 reputation, consumes the exact commodity and closes the space",
    rcp.ok && rcp.benefit.ok && rcp.benefit.vpGained === 3 && rcp.benefit.reputationGained === 1 &&
    gcp.player("A").vp === 3 && gcp.reputation.tokensOf("A") === 1 &&
    gcp.economy.amountOf("A", "grain") === 0 && gcp.quota.occupant("q2") === "A" &&
    gcp.influence.availableOf("A") === 10);

  const gcp2 = makeGame();
  gcp2.economy.gain("A", { grain: 2 });
  gcp2.engine.placeWorker("A", gcp2.commons.cloudport, { quotaSpaceId: "q2" });
  gcp2.engine.retrieveWorkers("B");
  const rcp2 = gcp2.engine.placeWorker("A", gcp2.commons.cloudport, { quotaSpaceId: "q2" });
  ok("Cloud Port rejects a closed space", !rcp2.ok && rcp2.reason === "space_closed");

  const gcp3 = makeGame();
  gcp3.economy.gain("A", { grain: 1 });
  const rcp3 = gcp3.engine.placeWorker("A", gcp3.commons.cloudport, { quotaSpaceId: "q2" });
  ok("Cloud Port rejects an insufficient commodity", !rcp3.ok && rcp3.reason === "cannot_afford_cost");

  const gcp4 = makeGame();
  const rcp4 = gcp4.engine.placeWorker("A", gcp4.commons.cloudport, { quotaSpaceId: "q99" });
  ok("Cloud Port rejects an unknown space", !rcp4.ok && rcp4.reason === "no_such_space");

  // ── legalActions respects the new affordability rules ──
  const ga = makeGame();
  ga.influence.spend("A", 11);
  ok("legalActions keeps place available when at least one building is affordable",
    ga.engine.legalActions("A").join(",") === "place,retrieve");

  // ── serialization round-trip through all four new modules ──
  const gs = makeGame();
  const pA = gs.player("A");
  pA.gainCard("cbldg-1");
  pA.gainCard("bldg-mine");
  gs.objectives.markCompleted("obj-1", "A");
  gs.economy.gain("A", { clay: 1, coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  gs.economy.gain("B", { grain: 2 });
  gs.engine.placeWorker("A", gs.commons.treasury, { resource: "clay" });                 // turn→B
  gs.engine.placeWorker("B", gs.commons.cloudport, { quotaSpaceId: "q2" });               // turn→A
  gs.engine.placeWorker("A", gs.commons.grandstand, { objectiveId: "obj-1" });            // turn→B
  gs.engine.retrieveWorkers("B");                                                         // turn→A
  gs.engine.retrieveWorkers("A");                                                         // turn→B
  gs.engine.retrieveWorkers("B");                                                         // turn→A
  gs.engine.placeWorker("A", gs.commons.zeppelin, { cardId: "bldg-mine", constructionCell: gs.cellA0 }); // turn→B
  gs.engine.retrieveWorkers("B");                                                         // turn→A
  gs.engine.placeWorker("A", gs.commons.charterstone, { cardId: "cbldg-1" });             // turn→B
  const dataS = JSON.parse(gs.serialize());
  const gs2 = restoreGameState(dataS);
  ok("the four Commons-phase modules survive serialize→restore",
    JSON.stringify(gs2.advancement.toJSON()) === JSON.stringify(gs.advancement.toJSON()) &&
    JSON.stringify(gs2.objectives.toJSON()) === JSON.stringify(gs.objectives.toJSON()) &&
    JSON.stringify(gs2.crates.toJSON()) === JSON.stringify(gs.crates.toJSON()) &&
    JSON.stringify(gs2.archive.toJSON()) === JSON.stringify(gs.archive.toJSON()));
  ok("restored state keeps cards, board, crates and VP identical",
    gs2.player("A").hasCard("cbldg-1") === gs.player("A").hasCard("cbldg-1") &&
    gs2.board.buildingAt(gs.cellA0.key) === "mine" &&
    gs2.crates.isUnlocked("cbldg-1") === gs.crates.isUnlocked("cbldg-1") &&
    gs2.archive.has("cbldg-1") === gs.archive.has("cbldg-1") &&
    gs2.player("A").vp === gs.player("A").vp && gs2.influence.availableOf("A") === gs.influence.availableOf("A"));
  const resumed = (() => {
    gs2.economy.gain("B", { wood: 1 });
    const m = gs2.advancement.mat().find(id => id);
    const marketCell = gs2.board.commonsBuildings().find(b => b.buildingId === "market").cell;
    return gs2.engine.placeWorker("B", marketCell, { resource: "wood", matCardId: m });
  })();
  ok("the restored game remains fully playable (Market gain works on the restored state)",
    resumed.ok && gs2.player("B").hasCard(resumed.benefit.cardId));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "commons", pass, fail, results };
}
