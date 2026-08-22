// src/campaignComplete.test.js — Phase 17 campaign-complete mode (Task 78).
// Run in-page via ?test=campaigncomplete, or via window.__loadCampaignCompleteTests().
// Task 78: after game 12 the village persists as a replayable, NON-legacy
// worker-placement game on the final board. A post-campaign game uses the
// final board with no further unlocks.

import { createCampaignState, finishGame, beginNextGame, createReplayGame, CAMPAIGN_STATE_VERSION } from "./campaignState.js";
import { collectLegacyState } from "./legacy.js";
import { createGameState } from "./serialization.js";
import { createGameEngine } from "./engine.js";

// Construct two real buildings for P1 on a seeded game so the legacy record
// carries valid board coordinates.
function playedLegacy() {
  const players = [{ id: "p1", charterId: 0 }];
  const g = createGameState({ players, firstPlayer: "p1", rng: Math.random });
  g.economy.gain("p1", { coal: 1, wood: 3, grain: 1, pumpkin: 1, clay: 1 });
  g.player("p1").gainCard("bldg-mine");
  g.player("p1").gainCard("bldg-mill");
  const zeppelin = g.board.commonsBuildings().find(b => b.buildingId === "zeppelin").cell;
  const legal = g.engine.legalConstructionCellsForPlayer("p1");
  g.engine.placeWorker("p1", zeppelin, { cardId: "bldg-mine", constructionCell: legal[0].key });
  const legal2 = g.engine.legalConstructionCellsForPlayer("p1");
  g.engine.placeWorker("p1", zeppelin, { cardId: "bldg-mill", constructionCell: legal2[0].key });
  return collectLegacyState(g);
}

export function runCampaignCompleteTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  const legacy = playedLegacy();
  ok("the played legacy carries constructed buildings", legacy.constructedBuildings.length === 2);

  const campaign = createCampaignState({ players: [{ id: "p1", charterId: 0 }, { id: "p2", charterId: 1 }, { id: "p3", charterId: 2 }] });
  ok("campaign starts at game 1", campaign.gameNumber === 1 && CAMPAIGN_STATE_VERSION === 1);
  for (let n = 1; n <= 12; n++) {
    const winnerId = ["p1", "p2", "p3"][n % 3];
    const res = finishGame(campaign, {
      winnerId,
      legacy: n === 1 ? legacy : { stickers: n % 2 === 0 ? ["sticker-rule-" + n] : [] },
      usedPersonas: { [winnerId]: ["persona-" + n] },
    });
    ok("game " + n + " finished", res.ok === true);
  }
  ok("campaign is complete after game 12", campaign.campaignComplete === true && campaign.gameNumber === 13);
  ok("beginNextGame refuses further unlocks after completion", beginNextGame(campaign) === null);

  // ── replay on the final board ──
  const replay = createReplayGame(campaign, {
    players: [{ id: "p1", charterId: 0 }, { id: "p2", charterId: 1 }, { id: "p3", charterId: 2 }],
    firstPlayer: "p1",
    rng: Math.random,
  });
  ok("createReplayGame returns a final-board config", replay.ok === true && replay.gameNumber === 12 && replay.config.replay === true);
  const g = createGameState(replay.config);
  ok("the replay game starts on the final board", g.gameNumber === 12 && g.campaignId === campaign.id);
  const built = g.board.constructedBuildings();
  ok("the replay board contains every legacy-constructed building",
    legacy.constructedBuildings.every(b => built.some(x => x.buildingId === b.buildingId && x.ownerId === b.ownerId && x.cell.q === b.q && x.cell.r === b.r)));
  ok("the replay board's buildings are owned by their builders",
    legacy.constructedBuildings.every(b => built.find(x => x.cell.q === b.q && x.cell.r === b.r)?.ownerId === b.ownerId));
  ok("replay applies the legacy stickers to the chronicle/sticker book",
    legacy.stickers.every(id => g.stickerBook.applied().includes(id)));
  ok("the replay game is fully playable with the engine", (() => {
    try {
      const engine = createGameEngine(g);
      return typeof engine.legalActions("p1") === "object" && Array.isArray(engine.legalActions("p1"));
    } catch (e) { return false; }
  })());

  // ── no further unlocks: the replay never advances the campaign ──
  const resultsBefore = campaign.gameResults.length;
  g.economy.gain("p1", { clay: 1 });
  const playedAgain = g.engine.placeWorker("p1", g.board.commonsBuildings().find(b => b.buildingId === "treasury").cell, { resource: "clay" });
  g.engine.retrieveWorkers("p1");
  ok("a replay turn actually resolves on the final board", playedAgain.ok === true);
  ok("playing the replay does not advance the campaign", campaign.gameResults.length === resultsBefore && campaign.campaignComplete === true);

  // ── replayable: a second replay starts from the same final village ──
  const replay2 = createReplayGame(campaign, { players: [{ id: "p1", charterId: 0 }, { id: "p2", charterId: 1 }, { id: "p3", charterId: 2 }] });
  const g2 = createGameState(replay2.config);
  ok("the campaign can be replayed repeatedly from the same final board",
    replay2.ok === true && replay2.config !== replay.config &&
    g2.board.constructedBuildings().length === legacy.constructedBuildings.length &&
    g2.board.constructedBuildings().every(b => g.board.constructedBuildings().some(x => x.cell.q === b.cell.q && x.cell.r === b.cell.r && x.buildingId === b.buildingId && x.ownerId === b.ownerId)));

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "campaigncomplete", pass, fail, results };
}
