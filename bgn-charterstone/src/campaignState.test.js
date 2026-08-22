// src/campaignState.test.js — Phase 11 campaign meta-progression validation (Tasks 53-54).
// Run in-page via ?test=campaignstate, or programmatically via window.__loadCampaignStateTests().
// Task 53: the campaign state model tracks game # (1-12), per-player wins/glory
// and capacity, applied stickers, constructed buildings, unlocked crates, the
// active ruleset (via applied rule stickers) and story unlocks. Task 54: the
// between-games sequence (winner glory, legacy changes, next-game setup) means
// game N+1's setup includes every change made in game N.

import { createGameState } from "./serialization.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS } from "./cards.js";
import { CARD_TYPES } from "./cards.js";
import { DEFAULT_BUILDING_TILES } from "./buildingTiles.js";
import { CHARTER_COLORS } from "./player.js";
import { STARTING_SETUP } from "./indexGuide.js";
import { collectLegacyState } from "./legacy.js";
import {
  GLORY_PER_WIN, CAMPAIGN_STATE_VERSION, CAMPAIGN_SCORE_VALUES,
  createCampaignState, playerRecord, finishGame, beginNextGame, legacySnapshot, playerStats,
  addPlayerToCampaign, dropPlayerFromCampaign, applyGrantedCards, scoreCampaign,
  campaignStateToJSON, campaignStateFromJSON,
} from "./campaignState.js";
import { CAMPAIGN_GAME_COUNT } from "./campaign.js";

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function baseGameConfig(campaign, extra = {}) {
  return {
    players: [
      { id: "P1", charterId: 0, startingCoins: 4 },
      { id: "P2", charterId: 1, startingCoins: 4 },
    ],
    firstPlayer: "P1",
    rng: lcg(7),
    advancementConfig: { deck: [...STARTING_SETUP.advancementDeck] },
    objectivesConfig: [...STARTING_SETUP.objectives],
    cards: DEFAULT_CARDS,
    buildingDefs: DEFAULT_ENGINE_DEFS,
    ...extra,
  };
}

export function runCampaignStateTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  // ── Task 53: the model ──
  const c0 = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  ok("a fresh campaign starts at game 1", c0.gameNumber === 1 && c0.campaignComplete === false);
  ok("players start with 0 wins, 0 glory, 0 capacity", c0.players.every(p => p.wins === 0 && p.glory === 0 && p.capacity === 0));
  ok("playerRecord resolves players and rejects unknowns", playerRecord(c0, "P1")?.id === "P1" && playerRecord(c0, "X") === null);

  const c1 = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  const r1 = finishGame(c1, {
    winnerId: "P1",
    playerCapacities: { P1: 2, P2: 1 },
    usedPersonas: { P1: ["persona-3"] },
    revealedStories: ["story-2"],
    legacy: {
      constructedBuildings: [{ buildingId: "mine", ownerId: "P1", q: 2, r: 0 }],
      stickers: ["rule-income"],
      crates: [{ playerId: "P1", cardId: "cbldg-1", crateNumber: 1 }],
      archive: ["bldg-mine", "cbldg-1"],
    },
  });
  ok("finishing game 1 advances to game 2", r1.ok && c1.gameNumber === 2 && c1.campaignComplete === false);
  ok("the winner earns a win and glory", playerRecord(c1, "P1").wins === 1 && playerRecord(c1, "P1").glory === GLORY_PER_WIN);
  ok("capacity carries via the max of the transition rules", playerRecord(c1, "P1").capacity === 2 && playerRecord(c1, "P2").capacity === 1);
  ok("used personas are recorded per player", playerRecord(c1, "P1").usedPersonas.join(",") === "persona-3");
  ok("legacy components merge into the campaign accumulators",
    c1.constructedBuildings.length === 1 && c1.constructedBuildings[0].q === 2 && c1.constructedBuildings[0].r === 0 &&
    c1.stickers.join(",") === "rule-income" && c1.crates.length === 1 && c1.crates[0].crateNumber === 1 &&
    c1.archive.length === 2 && c1.storyUnlocks.join(",") === "story-2");
  ok("gameResults records the finished game", c1.gameResults.length === 1 && c1.gameResults[0].winnerId === "P1" && c1.gameResults[0].gameNumber === 1);

  const rBad = finishGame(c1, { winnerId: "Nobody" });
  ok("an unknown winner is rejected without state change", !rBad.ok && rBad.reason === "no_such_winner" && c1.gameNumber === 2);

  const c2 = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  const dupSticker = finishGame(c2, { winnerId: "P1", legacy: { stickers: ["rule-income"] } });
  finishGame(c2, { winnerId: "P2", legacy: { stickers: ["rule-income"], archive: ["bldg-mine"] } });
  ok("duplicate stickers/archive merge uniquely", c2.stickers.join(",") === "rule-income" && c2.archive.join(",") === "bldg-mine");

  // ── a full 12-game simulated campaign ──
  const sim = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  let simulatedGames = 0;
  while (sim.gameNumber <= CAMPAIGN_GAME_COUNT && simulatedGames < 20) {
    const cfg = beginNextGame(sim, baseGameConfig(sim));
    ok("beginNextGame returns a config for every in-campaign game", !!cfg, "game " + sim.gameNumber);
    const g = createGameState(cfg);
    ok("game " + sim.gameNumber + " is playable", g.engine.legalActions("P1").includes("place"));
    const emptyCell = g.board.destinationCells().find(c => !c.buildingId);
    if (emptyCell) g.board.placeBuilding(emptyCell, "mine", "P1");
    g.stickerBook.apply("rule-income");
    g.crates.unlock("P1", "cbldg-1", 1);
    g.archive.add("bldg-mine");
    g.storyPool.add("story-2");
    g.player("P1").addCapacity(1);
    const winnerId = simulatedGames % 2 === 0 ? "P1" : "P2";
    const res = finishGame(sim, {
      winnerId,
      legacy: collectLegacyState(g),
      playerCapacities: { P1: sim.players.find(p => p.id === "P1").capacity + 1, P2: 0 },
      usedPersonas: { P1: ["persona-3"], P2: [] },
      revealedStories: g.storyPool.all(),
    });
    ok("game " + (simulatedGames + 1) + " transition succeeds", res.ok, res.reason ?? "");
    simulatedGames++;
  }
  ok("a 12-game campaign advances to game 13 and completes", sim.gameNumber === CAMPAIGN_GAME_COUNT + 1 && sim.campaignComplete === true);
  ok("12 games were simulated with 12 recorded results", simulatedGames === CAMPAIGN_GAME_COUNT && sim.gameResults.length === CAMPAIGN_GAME_COUNT);
  ok("wins sum to the game count", playerRecord(sim, "P1").wins + playerRecord(sim, "P2").wins === CAMPAIGN_GAME_COUNT);
  ok("glory equals 10 per win", playerRecord(sim, "P1").glory === GLORY_PER_WIN * playerRecord(sim, "P1").wins &&
    playerRecord(sim, "P2").glory === GLORY_PER_WIN * playerRecord(sim, "P2").wins);
  ok("legacy accumulators persist across the whole campaign",
    sim.constructedBuildings.length === 12 && sim.stickers.join(",") === "rule-income" &&
    sim.crates.length === 1 && sim.archive.join(",") === "bldg-mine" &&
    sim.storyUnlocks.join(",") === "story-2");
  ok("capacity grows monotonically with the transition rules", playerRecord(sim, "P1").capacity === CAMPAIGN_GAME_COUNT && playerRecord(sim, "P2").capacity === 0);
  ok("beginNextGame returns null once the campaign is complete", beginNextGame(sim, baseGameConfig(sim)) === null);
  ok("finishing a completed campaign is rejected", !finishGame(sim, { winnerId: "P1" }).ok);

  // ── serialization of the campaign state ──
  const roundTripped = campaignStateFromJSON(campaignStateToJSON(sim));
  ok("campaign state round-trips as JSON",
    roundTripped.gameNumber === sim.gameNumber && roundTripped.campaignComplete === sim.campaignComplete &&
    JSON.stringify(roundTripped.players) === JSON.stringify(sim.players) &&
    roundTripped.constructedBuildings.length === sim.constructedBuildings.length &&
    roundTripped.crates.length === sim.crates.length &&
    roundTripped.storyUnlocks.join(",") === sim.storyUnlocks.join(","));
  ok("campaign serialization rejects bad payloads", (() => {
    try { campaignStateFromJSON({ kind: "nope" }); return false; } catch (e) { return true; }
  })());
  ok("the campaign state is versioned", campaignStateToJSON(sim).version === CAMPAIGN_STATE_VERSION);

  // ── Task 54: the between-games sequence ──
  const camp = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  const g1 = createGameState(baseGameConfig(camp));
  const millCell = g1.engine.legalConstructionCellsForPlayer("P1")[0].key;
  g1.player("P1").gainCard("bldg-mill");
  g1.economy.gain("P1", { ...(DEFAULT_CARDS["bldg-mill"].constructionCost ?? {}) });
  const zeppelin = g1.board.commonsBuildings().find(b => b.buildingId === "zeppelin").cell;
  const rc = g1.engine.placeWorker("P1", zeppelin, { cardId: "bldg-mill", constructionCell: millCell });
  ok("game N: P1 constructs a mill", rc.ok && g1.board.buildingAt(millCell) === "mill" && g1.board.ownerAt(millCell) === "P1" && g1.archive.has("bldg-mill"));
  g1.player("P2").gainCard("cbldg-1");
  const charterstone = g1.board.commonsBuildings().find(b => b.buildingId === "charterstone").cell;
  const ru = g1.engine.placeWorker("P2", charterstone, { cardId: "cbldg-1" });
  ok("game N: P2 unlocks crate 1", ru.ok && g1.crates.isUnlocked("cbldg-1") && !g1.player("P2").hasCard("cbldg-1") && g1.archive.has("cbldg-1"));
  g1.player("P1").addCapacity(2);
  g1.stickerBook.apply("rule-income");
  ok("game N: capacity + rule sticker applied", g1.player("P1").capacity === 2 && g1.chronicle.flag("incomeEnabled") === true);

  const legacy = collectLegacyState(g1);
  const f = finishGame(camp, {
    winnerId: "P1",
    legacy,
    playerCapacities: { P1: g1.player("P1").capacity, P2: g1.player("P2").capacity },
    usedPersonas: { P2: ["persona-3"] },
    revealedStories: g1.storyPool.all(),
  });
  ok("the between-games transition records the winner's glory",
    f.ok && camp.gameNumber === 2 && playerRecord(camp, "P1").wins === 1 && playerRecord(camp, "P1").glory === GLORY_PER_WIN);

  const cfg2 = beginNextGame(camp, baseGameConfig(camp, { firstPlayer: "P2" }));
  const g2 = createGameState(cfg2);
  ok("game N+1 setup includes the constructed building at the same cell with its owner",
    g2.board.buildingAt(millCell) === "mill" && g2.board.ownerAt(millCell) === "P1");
  ok("game N+1 setup includes the applied sticker and its rule flag",
    g2.stickerBook.applied().includes("rule-income") && g2.chronicle.flag("incomeEnabled") === true);
  ok("game N+1 setup includes the unlocked crate", g2.crates.isUnlocked("cbldg-1"));
  ok("game N+1 setup includes the archived cards",
    g2.archive.has("bldg-mill") && g2.archive.has("cbldg-1"));
  ok("game N+1 setup carries the revealed story into the story pool", g2.storyPool.has("story-2"));
  ok("game N+1 setup carries the player's capacity", g2.player("P1").capacity === 2);
  ok("game N+1 is stamped with its game number and campaign id",
    g2.gameNumber === 2 && g2.campaignId === camp.id);
  ok("game N+1 is fully playable", g2.engine.legalActions("P2").includes("place"));

  // ── Task 57: add / drop players mid-campaign ──
  const camp5 = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  for (let i = 1; i <= 4; i++) {
    const w = i % 2 === 1 ? "P1" : "P2";
    finishGame(camp5, { winnerId: w, playerCapacities: { P1: Math.min(i, 2), P2: Math.min(i, 2) } });
  }
  ok("the add/drop campaign sits mid-campaign at game 5", camp5.gameNumber === 5 && !camp5.campaignComplete);
  ok("the incumbent players have equal glory/capacity to share",
    playerRecord(camp5, "P1").glory === GLORY_PER_WIN * 2 && playerRecord(camp5, "P2").glory === GLORY_PER_WIN * 2 &&
    playerRecord(camp5, "P1").capacity === 2 && playerRecord(camp5, "P2").capacity === 2);
  const added = addPlayerToCampaign(camp5, { id: "P3", charterId: 2, rng: lcg(1) });
  ok("a mid-campaign player joins an inactive charter with its color",
    added.ok && added.player.id === "P3" && added.player.charterId === 2 && added.player.color === CHARTER_COLORS[2] && camp5.players.length === 3);
  ok("the new player receives equitable (average, floored) glory and capacity",
    added.glory === 20 && added.capacity === 2 && added.player.glory === 20 && added.player.capacity === 2);
  ok("the new player receives 1 random constructed or unconstructed building card",
    typeof added.card === "string" && Object.values(DEFAULT_CARDS).some(c => c.id === added.card &&
      (c.type === CARD_TYPES.UNCONSTRUCTED_BUILDING || c.type === CARD_TYPES.CONSTRUCTED_BUILDING)) &&
    added.player.grantedCard === added.card);
  ok("duplicate players are rejected", !addPlayerToCampaign(camp5, { id: "P3", charterId: 3 }).ok &&
    addPlayerToCampaign(camp5, { id: "P3", charterId: 3 }).reason === "duplicate_player");
  ok("an in-use charter is rejected", !addPlayerToCampaign(camp5, { id: "P4", charterId: 2 }).ok &&
    addPlayerToCampaign(camp5, { id: "P4", charterId: 2 }).reason === "charter_in_use");
  ok("an out-of-range charter is rejected", !addPlayerToCampaign(camp5, { id: "P4", charterId: 6 }).ok &&
    addPlayerToCampaign(camp5, { id: "P4", charterId: 6 }).reason === "invalid_charter");
  ok("a missing id is rejected", !addPlayerToCampaign(camp5, { charterId: 3 }).ok &&
    addPlayerToCampaign(camp5, { charterId: 3 }).reason === "id_required");

  const cfg5 = beginNextGame(camp5, {
    players: [
      { id: "P1", charterId: 0, startingCoins: 4 },
      { id: "P2", charterId: 1, startingCoins: 4 },
      { id: "P3", charterId: 2, startingCoins: 4 },
    ],
    firstPlayer: "P1",
    rng: lcg(7),
    advancementConfig: { deck: [...STARTING_SETUP.advancementDeck] },
    objectivesConfig: [...STARTING_SETUP.objectives],
    cards: DEFAULT_CARDS,
    buildingDefs: DEFAULT_ENGINE_DEFS,
  });
  const g5 = createGameState(cfg5);
  const granted = applyGrantedCards(g5, camp5);
  ok("the next game's setup puts the granted card in the new player's hand",
    granted.P3 === added.card && g5.player("P3").hasCard(added.card));
  ok("the new player's equitable capacity is carried into the game",
    g5.player("P3").capacity === 2);
  ok("the new player has a legal registered charter", g5.turns.playerCharter("P3") === 2 && g5.turns.players.includes("P3"));
  ok("the game with the new player is playable", g5.engine.legalActions("P1").includes("place"));
  const applyIdempotent = applyGrantedCards(g5, camp5);
  ok("applyGrantedCards is idempotent (no duplicate grant)", applyIdempotent.P3 === undefined && g5.player("P3").hasCard(added.card));

  const dropped = dropPlayerFromCampaign(camp5, "P3");
  ok("dropping a player frees their charter", dropped.ok && dropped.charterFreed && !camp5.players.some(p => p.id === "P3"));
  ok("dropping an unknown player is rejected", !dropPlayerFromCampaign(camp5, "Nobody").ok &&
    dropPlayerFromCampaign(camp5, "Nobody").reason === "no_such_player");
  const readd = addPlayerToCampaign(camp5, { id: "P3", charterId: 2, rng: lcg(3) });
  ok("a freed charter can be claimed again", readd.ok && readd.player.id === "P3" && readd.player.charterId === 2);

  const doneCamp = createCampaignState({ players: [{ id: "P1" }] });
  doneCamp.gameNumber = 13;
  doneCamp.campaignComplete = true;
  ok("adding a player to a completed campaign is rejected",
    !addPlayerToCampaign(doneCamp, { id: "P9", charterId: 3 }).ok &&
    addPlayerToCampaign(doneCamp, { id: "P9", charterId: 3 }).reason === "campaign_complete");

  // ── Task 58: end-of-campaign scoring ──
  const finished = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  finished.gameNumber = 13;
  finished.campaignComplete = true;
  playerRecord(finished, "P1").wins = 2;
  playerRecord(finished, "P1").glory = 20;
  playerRecord(finished, "P1").capacity = 3;
  playerRecord(finished, "P1").usedPersonas = ["persona-3", "persona-5", "persona-7"];
  playerRecord(finished, "P2").wins = 1;
  playerRecord(finished, "P2").glory = 10;
  playerRecord(finished, "P2").capacity = 1;
  playerRecord(finished, "P2").usedPersonas = ["persona-1"];
  finished.constructedBuildings = [
    { buildingId: "mine", ownerId: "P1", q: 0, r: 0, key: "0,0" },
    { buildingId: "mill", ownerId: "P1", q: 1, r: 0, key: "1,0" },
    { buildingId: "quarry", ownerId: "P2", q: 0, r: 1, key: "0,1" },
  ];
  const sc = scoreCampaign(finished, { buildingTiles: DEFAULT_BUILDING_TILES });
  ok("scoring a completed campaign succeeds", sc.ok && sc.standings.length === 2);
  const sP1 = sc.standings.find(s => s.playerId === "P1");
  const sP2 = sc.standings.find(s => s.playerId === "P2");
  ok("capacity scores 3 VP per capacity space", sP1.capacityVp === 3 * CAMPAIGN_SCORE_VALUES.capacityPerSpace && sP1.capacityVp === 9);
  ok("each used persona scores 7 VP", sP1.personaVp === 3 * CAMPAIGN_SCORE_VALUES.personaVp && sP1.personaVp === 21);
  ok("each victory scores 8 VP", sP1.victoryVp === 2 * CAMPAIGN_SCORE_VALUES.victoryVp && sP1.victoryVp === 16);
  ok("glory grants 10 VP to the leader only", sP1.gloryVp === CAMPAIGN_SCORE_VALUES.gloryLeaderVp && sP2.gloryVp === 0);
  ok("building value sums the printed tile VP", sP1.buildingValue === 5 && sP2.buildingValue === 3);
  ok("the totals match the scored table exactly",
    sP1.total === 61 && sP2.total === 21);
  ok("the campaign winner is crowned", sc.winnerIds.join(",") === "P1" && sP1.rank === 1 && sP2.rank === 2);
  ok("the scoring constants match the end-of-campaign table",
    CAMPAIGN_SCORE_VALUES.capacityPerSpace === 3 && CAMPAIGN_SCORE_VALUES.personaVp === 7 &&
    CAMPAIGN_SCORE_VALUES.victoryVp === 8 && CAMPAIGN_SCORE_VALUES.gloryLeaderVp === 10);
  const tied = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  tied.gameNumber = 13;
  tied.campaignComplete = true;
  playerRecord(tied, "P1").glory = 30;
  playerRecord(tied, "P2").glory = 30;
  const scTie = scoreCampaign(tied);
  ok("a tie for the most glory shares the glory VP", scTie.ok && scTie.standings.every(s => s.gloryVp === CAMPAIGN_SCORE_VALUES.gloryLeaderVp));
  ok("an incomplete campaign cannot be scored", !scoreCampaign(createCampaignState({ players: [{ id: "P1" }] })).ok &&
    scoreCampaign(createCampaignState({ players: [{ id: "P1" }] })).reason === "campaign_not_complete");

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "campaignState", pass, fail, results };
}
