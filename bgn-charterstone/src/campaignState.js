// src/campaignState.js — Phase 11 campaign meta-progression model (Tasks 53-54).
// The campaign spans 12 games. Across them we track, per player, wins (games
// won), glory (10 per win, per the end-of-campaign scoring table) and worker
// capacity carried into the next game; plus the legacy accumulators that every
// next game's setup must include (constructed buildings, applied stickers,
// unlocked crates, archived cards) and the story cards revealed so far.
//
// finishGame(campaign, result) runs the transition from game N to N+1: it
// validates the result, records the winner, merges the finished game's legacy
// snapshot into the campaign accumulators, and advances the game number.
// beginNextGame(campaign, baseConfig) turns those accumulators into a
// createGameState config for game N+1 (board already holding the built
// buildings, chronicle flags from the applied rule stickers, crates/archive
// pre-populated, story pool seeded, capacity carried into the player configs).

import { CAMPAIGN_GAME_COUNT } from "./campaign.js";
import { createLegacyState, setupNextGame, LEGACY_VERSION } from "./legacy.js";
import { createStoryPool } from "./indexGuide.js";
import { DEFAULT_BUILDING_TILES } from "./buildingTiles.js";
import { DEFAULT_CARDS, CARD_TYPES } from "./cards.js";
import { CHARTER_COLORS } from "./player.js";

export const GLORY_PER_WIN = 10;
export const CAMPAIGN_STATE_VERSION = 1;

// End-of-campaign scoring point values (Icon Guide "END OF CAMPAIGN
// SCORING"). The printed table gives RANGES (capacity 1-3, used personas 5-7,
// victories 6-8); we fix the top of each range as the provisional point value.
// The glory category grants 10 VP to the player (or tied players) with the
// most glory; building value is each constructed building's printed tile VP.
export const CAMPAIGN_SCORE_VALUES = Object.freeze({
  capacityPerSpace: 3,
  personaVp: 7,
  victoryVp: 8,
  gloryLeaderVp: 10,
});

export function createCampaignState(config = {}) {
  const players = (config.players ?? []).map(p => ({
    id: p.id,
    charterId: p.charterId ?? null,
    color: p.color ?? "#aaa",
    wins: 0,
    glory: 0,
    capacity: 0,
    usedPersonas: [],
    grantedCard: null,
  }));
  return {
    id: config.id ?? "campaign-" + Math.random().toString(36).slice(2, 8),
    version: CAMPAIGN_STATE_VERSION,
    gameNumber: config.gameNumber ?? 1,
    campaignComplete: false,
    players,
    gameResults: [],
    constructedBuildings: [],
    stickers: [],
    crates: [],
    archive: [],
    storyUnlocks: [],
  };
}

export function playerRecord(campaign, playerId) {
  return campaign.players.find(p => p.id === playerId) ?? null;
}

function pushUnique(list, value) {
  if (list.includes(value)) return false;
  list.push(value);
  return true;
}

export function finishGame(campaign, result = {}) {
  if (campaign.campaignComplete) return { ok: false, reason: "campaign_complete" };
  if (campaign.gameNumber < 1 || campaign.gameNumber > CAMPAIGN_GAME_COUNT) {
    return { ok: false, reason: "invalid_game_number", gameNumber: campaign.gameNumber };
  }
  const winner = playerRecord(campaign, result.winnerId);
  if (!winner) return { ok: false, reason: "no_such_winner", winnerId: result.winnerId };

  winner.wins += 1;
  winner.glory += GLORY_PER_WIN;

  const capacities = result.playerCapacities ?? {};
  for (const p of campaign.players) {
    const cap = capacities[p.id];
    if (typeof cap === "number" && cap >= 0 && cap > p.capacity) p.capacity = cap;
  }
  const personas = result.usedPersonas ?? {};
  for (const p of campaign.players) {
    for (const pid of personas[p.id] ?? []) pushUnique(p.usedPersonas, pid);
  }

  const legacy = result.legacy ?? {};
  for (const b of legacy.constructedBuildings ?? []) {
    const key = b.q + "," + b.r;
    if (!campaign.constructedBuildings.some(x => x.q === b.q && x.r === b.r)) {
      campaign.constructedBuildings.push({ buildingId: b.buildingId, ownerId: b.ownerId, q: b.q, r: b.r, key });
    }
  }
  for (const id of legacy.stickers ?? []) pushUnique(campaign.stickers, id);
  for (const c of legacy.crates ?? []) {
    if (!campaign.crates.some(x => x.cardId === c.cardId)) {
      campaign.crates.push({ playerId: c.playerId, cardId: c.cardId, crateNumber: c.crateNumber });
    }
  }
  for (const id of legacy.archive ?? []) pushUnique(campaign.archive, id);
  for (const id of result.revealedStories ?? []) pushUnique(campaign.storyUnlocks, id);

  campaign.gameResults.push({ gameNumber: campaign.gameNumber, winnerId: result.winnerId, at: Date.now() });
  const finished = campaign.gameNumber;
  campaign.gameNumber += 1;
  if (campaign.gameNumber > CAMPAIGN_GAME_COUNT) campaign.campaignComplete = true;
  return { ok: true, gameNumber: finished, nextGameNumber: campaign.gameNumber, campaignComplete: campaign.campaignComplete };
}

export function legacySnapshot(campaign) {
  return createLegacyState({
    constructedBuildings: campaign.constructedBuildings,
    stickers: campaign.stickers,
    crates: campaign.crates,
    archive: campaign.archive,
  });
}

export function beginNextGame(campaign, baseConfig = {}) {
  if (campaign.campaignComplete || campaign.gameNumber < 1 || campaign.gameNumber > CAMPAIGN_GAME_COUNT) return null;
  const cfg = setupNextGame(legacySnapshot(campaign), baseConfig);
  cfg.gameNumber = campaign.gameNumber;
  cfg.campaignId = campaign.id;
  if (!cfg.storyPool) cfg.storyPool = createStoryPool();
  for (const s of campaign.storyUnlocks) cfg.storyPool.add(s);
  if (Array.isArray(cfg.players)) {
    cfg.players = cfg.players.map(p => {
      const rec = playerRecord(campaign, p.id);
      return rec ? { ...p, capacity: rec.capacity } : p;
    });
  }
  return cfg;
}

// Task 78: campaign-complete mode. After game 12 the village persists as a
// replayable, NON-legacy worker-placement game on the final board: the replay
// uses the final board + applied stickers + unlocked crates + archive, but
// never advances the campaign (no further unlocks) and can be started again
// from the same final village any number of times.
export function createReplayGame(campaign, baseConfig = {}) {
  if (!campaign.campaignComplete) {
    return { ok: false, reason: "campaign_not_complete", gameNumber: campaign.gameNumber };
  }
  const cfg = setupNextGame(legacySnapshot(campaign), baseConfig);
  cfg.gameNumber = Math.min(campaign.gameNumber, CAMPAIGN_GAME_COUNT);
  cfg.campaignId = campaign.id;
  cfg.replay = true;
  return { ok: true, config: cfg, gameNumber: cfg.gameNumber };
}

export function playerStats(campaign) {
  return campaign.players.map(p => ({ ...p }));
}

// ── Task 57: add / drop players mid-campaign ──
// A new player joins an inactive charter: they take that charter's color, an
// equitable (average, floored) share of the glory and capacity the others have
// built up, and 1 random constructed or unconstructed building card from the
// card set (excluding archived cards), recorded on the new player's record as
// `grantedCard` so the next game's setup can put it in their hand.
export function addPlayerToCampaign(campaign, config = {}) {
  if (campaign.campaignComplete) return { ok: false, reason: "campaign_complete" };
  if (campaign.gameNumber < 1 || campaign.gameNumber > CAMPAIGN_GAME_COUNT) {
    return { ok: false, reason: "invalid_game_number", gameNumber: campaign.gameNumber };
  }
  const id = config.id;
  if (typeof id !== "string" || !id) return { ok: false, reason: "id_required" };
  if (campaign.players.some(p => p.id === id)) return { ok: false, reason: "duplicate_player", id };
  const charterId = config.charterId;
  if (!Number.isInteger(charterId) || charterId < 0 || charterId > 5) {
    return { ok: false, reason: "invalid_charter", charterId };
  }
  if (campaign.players.some(p => p.charterId === charterId)) {
    return { ok: false, reason: "charter_in_use", charterId };
  }
  const others = campaign.players;
  const equity = others.length > 0
    ? Math.floor(others.reduce((s, p) => s + p.glory, 0) / others.length)
    : 0;
  const capacity = others.length > 0
    ? Math.floor(others.reduce((s, p) => s + p.capacity, 0) / others.length)
    : 0;
  const cardPool = (config.cardPool ?? Object.values(DEFAULT_CARDS)).filter(card =>
    (card.type === CARD_TYPES.UNCONSTRUCTED_BUILDING || card.type === CARD_TYPES.CONSTRUCTED_BUILDING) &&
    !campaign.archive.includes(card.id));
  const rng = config.rng ?? Math.random;
  const card = cardPool.length > 0
    ? cardPool[Math.floor(rng() * cardPool.length)]
    : null;
  const player = {
    id,
    charterId,
    color: config.color ?? CHARTER_COLORS[charterId] ?? "#aaa",
    wins: 0,
    glory: equity,
    capacity,
    usedPersonas: [],
    grantedCard: card ? card.id : null,
  };
  campaign.players.push(player);
  return { ok: true, player, glory: equity, capacity, card: card ? card.id : null };
}

export function dropPlayerFromCampaign(campaign, playerId) {
  const i = campaign.players.findIndex(p => p.id === playerId);
  if (i === -1) return { ok: false, reason: "no_such_player", playerId };
  campaign.players.splice(i, 1);
  return { ok: true, playerId, charterFreed: true };
}

// Put every player's granted card into their current game's hand. Skips
// players absent from the state and cards that were archived or already held.
export function applyGrantedCards(state, campaign) {
  const out = {};
  for (const rec of campaign.players) {
    if (!rec.grantedCard) continue;
    const p = state.player(rec.id);
    if (!p) continue;
    if (state.archive && state.archive.has(rec.grantedCard)) continue;
    if (p.hasCard(rec.grantedCard)) continue;
    try {
      p.gainCard(rec.grantedCard);
      out[rec.id] = rec.grantedCard;
    } catch (e) {
      out[rec.id] = null;
    }
  }
  return out;
}

// ── Task 58: end-of-campaign scoring ──
// Scores the finished campaign per the end-of-campaign table: capacity (3 VP
// per capacity space), used personas (7 VP each), victories (8 VP per win),
// glory (10 VP to the most-glory player, ties share), and building value (the
// sum of each constructed building's printed tile VP). Standings sort by total
// (desc) → glory → building value; the rank-1 players are the winners.
export function scoreCampaign(campaign, config = {}) {
  if (!campaign.campaignComplete) return { ok: false, reason: "campaign_not_complete" };
  const buildingTiles = config.buildingTiles ?? DEFAULT_BUILDING_TILES;
  const maxGlory = Math.max(0, ...campaign.players.map(p => p.glory));
  const standings = campaign.players.map(p => {
    const buildingValue = campaign.constructedBuildings
      .filter(b => b.ownerId === p.id)
      .reduce((s, b) => s + ((buildingTiles[b.buildingId]?.vp) ?? 0), 0);
    const capacityVp = p.capacity * CAMPAIGN_SCORE_VALUES.capacityPerSpace;
    const personaVp = p.usedPersonas.length * CAMPAIGN_SCORE_VALUES.personaVp;
    const victoryVp = p.wins * CAMPAIGN_SCORE_VALUES.victoryVp;
    const gloryVp = (maxGlory > 0 && p.glory === maxGlory) ? CAMPAIGN_SCORE_VALUES.gloryLeaderVp : 0;
    const total = capacityVp + personaVp + victoryVp + gloryVp + buildingValue;
    return { playerId: p.id, capacityVp, personaVp, victoryVp, gloryVp, buildingValue, total };
  });
  standings.sort((a, b) =>
    b.total - a.total ||
    b.gloryVp - a.gloryVp ||
    b.buildingValue - a.buildingValue ||
    a.playerId.localeCompare(b.playerId));
  let rank = 1;
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 &&
        (standings[i].total !== standings[i - 1].total ||
         standings[i].gloryVp !== standings[i - 1].gloryVp ||
         standings[i].buildingValue !== standings[i - 1].buildingValue)) {
      rank = i + 1;
    }
    standings[i].rank = rank;
  }
  const winnerIds = standings.filter(s => s.rank === 1).map(s => s.playerId);
  return { ok: true, standings, winnerIds };
}

export function campaignStateToJSON(campaign) {
  return {
    kind: "charterstone-campaign-state",
    version: campaign.version ?? CAMPAIGN_STATE_VERSION,
    id: campaign.id,
    gameNumber: campaign.gameNumber,
    campaignComplete: campaign.campaignComplete,
    players: campaign.players.map(p => ({ ...p, usedPersonas: [...p.usedPersonas] })),
    gameResults: campaign.gameResults.map(r => ({ ...r })),
    constructedBuildings: campaign.constructedBuildings.map(b => ({ ...b })),
    stickers: [...campaign.stickers],
    crates: campaign.crates.map(c => ({ ...c })),
    archive: [...campaign.archive],
    storyUnlocks: [...campaign.storyUnlocks],
  };
}

export function campaignStateFromJSON(data) {
  if (!data || typeof data !== "object" || data.kind !== "charterstone-campaign-state") {
    throw new Error("campaignState: bad payload");
  }
  const campaign = createCampaignState({
    id: data.id,
    gameNumber: data.gameNumber,
    players: (data.players ?? []).map(p => ({ id: p.id, color: p.color })),
  });
  campaign.campaignComplete = !!data.campaignComplete;
  campaign.players = (data.players ?? []).map(p => ({
    id: p.id,
    charterId: p.charterId ?? null,
    color: p.color ?? "#aaa",
    wins: p.wins ?? 0,
    glory: p.glory ?? 0,
    capacity: p.capacity ?? 0,
    usedPersonas: [...(p.usedPersonas ?? [])],
    grantedCard: p.grantedCard ?? null,
  }));
  campaign.gameResults = (data.gameResults ?? []).map(r => ({ ...r }));
  campaign.constructedBuildings = (data.constructedBuildings ?? []).map(b => ({ ...b }));
  campaign.stickers = [...(data.stickers ?? [])];
  campaign.crates = (data.crates ?? []).map(c => ({ ...c }));
  campaign.archive = [...(data.archive ?? [])];
  campaign.storyUnlocks = [...(data.storyUnlocks ?? [])];
  campaign.version = data.version ?? CAMPAIGN_STATE_VERSION;
  return campaign;
}
