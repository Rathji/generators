// src/serialization.js — game-state serialization & persistence (Task 6).
// A game state container ties together the existing modules (board, economy,
// players, turns, progress) plus an event log. It serializes to a plain
// JSON-safe object (every sub-module has toJSON()/fromJSON()) and restores
// into a fully live engine via restoreGameState. saveGameStateToKv /
// loadGameStateFromKv persist per-game and per-campaign state through the
// kv-plugin, keyed so each campaign game and the standalone "current game"
// survive page reloads. Later phases (decks, reputation/quota tracks, campaign
// meta) plug in by adding toJSON/fromJSON to their modules and extending the
// container's toJSON.

import { createBoard } from "./board.js";
import { createEconomy, restoreEconomy } from "./economy.js";
import { createPlayer, restorePlayer } from "./player.js";
import { createTurnMachine } from "./turns.js";
import { createProgressTrack } from "./progress.js";
import { createInfluencePool } from "./influence.js";
import { createReputationTrack } from "./reputation.js";
import { createQuotaTrack } from "./quota.js";
import { createGameEngine } from "./engine.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_BUILDING_TILES } from "./buildingTiles.js";
import { DEFAULT_CARDS, CARD_TYPES } from "./cards.js";
import { createAdvancement } from "./advancement.js";
import { createObjectives } from "./objectives.js";
import { createCrates } from "./crates.js";
import { createArchive } from "./archive.js";
import { createAssistants } from "./assistants.js";
import { createPersonaPool, createStickerPool, createObjectivePool, createStoryPool } from "./indexGuide.js";
import { createChronicle } from "./chronicle.js";
import { createStickerBook } from "./stickers.js";

export const SERIALIZATION_VERSION = 1;
export const KV_FOLDER = "charterstone";

function parsePayload(jsonOrData) {
  const data = typeof jsonOrData === "string" ? JSON.parse(jsonOrData) : jsonOrData;
  if (!data || typeof data !== "object" || data.kind !== "charterstone-game") {
    throw new Error("serialization: payload is not a charterstone game state");
  }
  return data;
}

function revealObjectiveIds(cards, rng, count) {
  const pool = Object.values(cards).filter(c => c && c.type === CARD_TYPES.OBJECTIVE);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }
  return shuffled.slice(0, count).map(c => c.id);
}

export function createGameState(config = {}) {
  const playerConfigs = (config.players ?? []).map(p => ({ id: p.id, charterId: p.charterId }));
  const economy = config.economy ?? createEconomy(config.economyConfig ?? {});
  const board = config.board ?? createBoard(config.boardConfig ?? {});
  const chronicle = config.chronicle ?? createChronicle(config.chronicleConfig ?? {});
  const archive = config.archive ?? createArchive(config.archiveConfig ?? {});
  const players = config.playerObjs ?? (config.players ?? []).map(p => createPlayer({ ...p, economy, archive }));
  const playerIds = players.map(p => p.id);
  const influence = config.influence ?? createInfluencePool({ playerIds });
  const turns = config.turns ?? createTurnMachine({ players: playerConfigs, rng: config.rng, firstPlayer: config.firstPlayer });
  const reputation = config.reputation ?? createReputationTrack({ playerCount: players.length, playerIds, influence });
  const progress = config.progress ?? createProgressTrack({ playerCount: players.length, incomeEnabled: config.incomeEnabled ?? chronicle.flag("incomeEnabled") });
  const quota = config.quota ?? createQuotaTrack({
    influence,
    economy,
    reputation,
    playerOf: id => players.find(p => p.id === id) ?? null,
  });
  const cards = config.cards ?? DEFAULT_CARDS;
  const buildingTiles = config.buildingTiles ?? DEFAULT_BUILDING_TILES;
  const assistants = config.assistants ?? createAssistants({ cards });
  const stickerBook = config.stickerBook ?? createStickerBook({ chronicle });
  const advancement = config.advancement ?? createAdvancement({ ...(config.advancementConfig ?? {}), archive });
  const objectives = config.objectives ?? createObjectives({
    objectives: config.objectivesConfig ?? revealObjectiveIds(cards, config.rng ?? Math.random, config.revealCount ?? 3),
    players: playerIds,
  });
  const crates = config.crates ?? createCrates();
  const personas = config.personas ?? createPersonaPool({ players: playerIds });
  const stickerPool = config.stickerPool ?? createStickerPool();
  const objectivePool = config.objectivePool ?? createObjectivePool();
  const storyPool = config.storyPool ?? createStoryPool();
  const gameNumber = config.gameNumber ?? null;
  const campaignId = config.campaignId ?? null;
  const log = (config.log ?? []).map(e => ({ ...e }));

  const state = {
    gameNumber,
    campaignId,
    economy,
    board,
    turns,
    progress,
    influence,
    reputation,
    quota,
    cards,
    buildingTiles,
    assistants,
    advancement,
    objectives,
    crates,
    archive,
    personas,
    stickerPool,
    objectivePool,
    storyPool,
    chronicle,
    stickerBook,
    get players() {
      return [...players];
    },
    get playerCount() {
      return players.length;
    },

    player(id) {
      return players.find(p => p.id === id) ?? null;
    },
    playerIds() {
      return players.map(p => p.id);
    },
    addLogEntry(entry) {
      const e = {
        turn: turns.turnsTaken(),
        playerId: turns.currentPlayerId,
        event: entry.event ?? "event",
        detail: entry.detail ?? {},
        at: Date.now(),
      };
      log.push(e);
      return e;
    },
    log() {
      return log.map(e => ({ ...e }));
    },

    toJSON() {
      return {
        kind: "charterstone-game",
        version: SERIALIZATION_VERSION,
        gameNumber,
        campaignId,
        board: board.toJSON(),
        economy: economy.toJSON(),
        players: players.map(p => p.toJSON()),
        turns: turns.toJSON(),
        progress: progress.toJSON(),
        influence: influence.toJSON(),
        reputation: reputation.toJSON(),
        quota: quota.toJSON(),
        advancement: advancement.toJSON(),
        objectives: objectives.toJSON(),
        crates: crates.toJSON(),
        archive: archive.toJSON(),
        assistants: assistants.toJSON(),
        personas: personas.toJSON(),
        stickerPool: stickerPool.toJSON(),
        objectivePool: objectivePool.toJSON(),
        storyPool: storyPool.toJSON(),
        chronicle: chronicle.toJSON(),
        stickerBook: stickerBook.toJSON(),
        log: state.log(),
      };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("serialization: bad fromJSON payload");
      board.fromJSON(data.board);
      economy.fromJSON(data.economy);
      turns.fromJSON(data.turns);
      progress.fromJSON(data.progress);
      if (data.influence) influence.fromJSON(data.influence);
      if (data.reputation) reputation.fromJSON(data.reputation);
      if (data.quota) quota.fromJSON(data.quota);
      if (data.advancement) advancement.fromJSON(data.advancement);
      if (data.objectives) objectives.fromJSON(data.objectives);
      if (data.crates) crates.fromJSON(data.crates);
      if (data.archive) archive.fromJSON(data.archive);
      if (data.assistants) assistants.fromJSON(data.assistants);
      if (data.personas) personas.fromJSON(data.personas);
      if (data.stickerPool) stickerPool.fromJSON(data.stickerPool);
      if (data.objectivePool) objectivePool.fromJSON(data.objectivePool);
      if (data.storyPool) storyPool.fromJSON(data.storyPool);
      if (data.chronicle) chronicle.fromJSON(data.chronicle);
      if (data.stickerBook) stickerBook.fromJSON(data.stickerBook);
      log.length = 0;
      for (const e of data.log ?? []) log.push({ ...e });
      return state;
    },
    serialize() {
      return JSON.stringify(state.toJSON());
    },
    deserialize(jsonOrData) {
      state.fromJSON(parsePayload(jsonOrData));
      return state;
    },
  };
  state.engine = config.engine ?? createGameEngine(state, { buildingDefs: config.buildingDefs ?? DEFAULT_ENGINE_DEFS });
  return state;
}

export function serializeGameState(state) {
  return state.serialize();
}

export function restoreGameState(jsonOrData, opts = {}) {
  const data = parsePayload(jsonOrData);
  const economy = restoreEconomy(data.economy);
  const board = createBoard({ destinationRings: data.board?.destinationRings ?? [2, 3] });
  board.fromJSON(data.board);
  const chronicle = createChronicle({ flags: data.chronicle?.flags });
  if (data.chronicle) chronicle.fromJSON(data.chronicle);
  const archive = createArchive();
  if (data.archive) archive.fromJSON(data.archive);
  const playerObjs = (data.players ?? []).map(p => restorePlayer(p, economy, archive));
  const playerIds = playerObjs.map(p => p.id);
  const influence = createInfluencePool({ playerIds });
  if (data.influence) influence.fromJSON(data.influence);
  const turns = createTurnMachine({
    players: playerObjs.map(p => ({ id: p.id, charterId: p.charterId })),
    firstPlayer: data.turns?.firstPlayerId,
  });
  turns.fromJSON(data.turns);
  const reputation = createReputationTrack({ playerCount: playerObjs.length, playerIds, influence });
  if (data.reputation) reputation.fromJSON(data.reputation);
  const progress = createProgressTrack({
    spaces: data.progress?.spaces,
    startSpace: data.progress?.startSpace,
    incomeEnabled: data.progress?.incomeEnabled,
  });
  progress.fromJSON(data.progress);
  const quota = createQuotaTrack({
    influence,
    economy,
    reputation,
    playerOf: id => playerObjs.find(p => p.id === id) ?? null,
  });
  if (data.quota) quota.fromJSON(data.quota);
  const advancement = createAdvancement({ matSize: data.advancement?.matSize, archive });
  if (data.advancement) advancement.fromJSON(data.advancement);
  const objectives = createObjectives({
    objectives: (data.objectives?.objectives ?? []).map(o => o.cardId),
    players: playerIds,
  });
  if (data.objectives) objectives.fromJSON(data.objectives);
  const crates = createCrates();
  if (data.crates) crates.fromJSON(data.crates);
  const assistants = createAssistants({ cards: opts.cards ?? DEFAULT_CARDS });
  if (data.assistants) assistants.fromJSON(data.assistants);
  const stickerBook = createStickerBook({ chronicle });
  if (data.stickerBook) stickerBook.fromJSON(data.stickerBook);
  const personas = createPersonaPool({ players: playerIds });
  if (data.personas) personas.fromJSON(data.personas);
  const stickerPool = createStickerPool();
  if (data.stickerPool) stickerPool.fromJSON(data.stickerPool);
  const objectivePool = createObjectivePool();
  if (data.objectivePool) objectivePool.fromJSON(data.objectivePool);
  const storyPool = createStoryPool();
  if (data.storyPool) storyPool.fromJSON(data.storyPool);
  return createGameState({
    gameNumber: data.gameNumber,
    campaignId: data.campaignId,
    economy,
    board,
    playerObjs,
    turns,
    progress,
    influence,
    reputation,
    quota,
    advancement,
    objectives,
    crates,
    archive,
    assistants,
    personas,
    stickerPool,
    objectivePool,
    storyPool,
    chronicle,
    stickerBook,
    cards: opts.cards ?? DEFAULT_CARDS,
    buildingTiles: opts.buildingTiles ?? DEFAULT_BUILDING_TILES,
    buildingDefs: opts.buildingDefs ?? DEFAULT_ENGINE_DEFS,
    log: data.log,
  });
}

export function defaultGameKey(ref) {
  return ref && ref.campaignId ? "game-" + (ref.gameNumber ?? 1) : "game-current";
}

function resolveKv(kv) {
  if (kv) return kv;
  if (typeof window === "undefined") return null;
  if (window.kv) return window.kv;
  if (window.root && window.root.kv) return window.root.kv;
  return null;
}

export async function saveGameStateToKv(state, opts = {}) {
  const kv = resolveKv(opts.kv);
  if (!kv) throw new Error("serialization: kv-plugin is not available");
  const folder = opts.folder ?? KV_FOLDER;
  const key = opts.key ?? defaultGameKey(state);
  await kv[folder].set(key, state.toJSON());
  return key;
}

export async function loadGameStateFromKv(opts = {}) {
  const kv = resolveKv(opts.kv);
  if (!kv) throw new Error("serialization: kv-plugin is not available");
  const folder = opts.folder ?? KV_FOLDER;
  const key = opts.key ?? defaultGameKey(opts);
  const data = await kv[folder].get(key);
  return data ? restoreGameState(data) : null;
}

export async function deleteGameStateFromKv(opts = {}) {
  const kv = resolveKv(opts.kv);
  if (!kv) throw new Error("serialization: kv-plugin is not available");
  const folder = opts.folder ?? KV_FOLDER;
  const key = opts.key ?? defaultGameKey(opts);
  await kv[folder].delete(key);
  return key;
}

export async function saveCampaignMetaToKv(campaignId, meta, opts = {}) {
  const kv = resolveKv(opts.kv);
  if (!kv) throw new Error("serialization: kv-plugin is not available");
  const folder = opts.folder ?? KV_FOLDER;
  const key = opts.key ?? "campaign-" + campaignId;
  await kv[folder].set(key, meta);
  return key;
}

export async function loadCampaignMetaFromKv(campaignId, opts = {}) {
  const kv = resolveKv(opts.kv);
  if (!kv) throw new Error("serialization: kv-plugin is not available");
  const folder = opts.folder ?? KV_FOLDER;
  const key = opts.key ?? "campaign-" + campaignId;
  return (await kv[folder].get(key)) ?? null;
}
