// src/legacy.js — legacy persistence across the campaign (Task 37).
// Charterstone is a legacy game: constructed buildings, applied stickers,
// unlocked crates, and the Archive tuckbox persist into the next game's
// setup. collectLegacyState(state) extracts them from a finished game into a
// plain, JSON-safe record; setupNextGame(legacy, baseConfig) turns that record
// into a createGameState config whose board already holds the built
// buildings, whose chronicle flags reflect the applied rule stickers, whose
// sticker book records them, and whose crates/archive are pre-populated —
// so "next game's setup" includes every legacy change. The full campaign
// state model (wins, glory, capacity, 12-game transitions) is Task 53; this
// module is the durable component snapshot it builds on.

import { createBoard } from "./board.js";
import { createCrates } from "./crates.js";
import { createArchive } from "./archive.js";
import { createChronicle } from "./chronicle.js";
import { createStickerBook } from "./stickers.js";

export const LEGACY_VERSION = 1;

export function collectLegacyState(state) {
  return {
    kind: "charterstone-legacy",
    version: LEGACY_VERSION,
    constructedBuildings: state.board.constructedBuildings().map(b => ({
      buildingId: b.buildingId,
      ownerId: b.ownerId,
      q: b.cell.q,
      r: b.cell.r,
    })),
    stickers: state.stickerBook ? state.stickerBook.applied() : [],
    crates: state.crates ? state.crates.unlocked().map(u => ({
      playerId: u.playerId,
      cardId: u.cardId,
      crateNumber: u.crateNumber,
    })) : [],
    archive: state.archive ? state.archive.all() : [],
  };
}

export function createLegacyState(data = {}) {
  if (!data || typeof data !== "object") throw new Error("legacy: bad payload");
  return {
    kind: "charterstone-legacy",
    version: data.version ?? LEGACY_VERSION,
    constructedBuildings: [...(data.constructedBuildings ?? [])].map(b => ({
      buildingId: b.buildingId,
      ownerId: b.ownerId,
      q: b.q,
      r: b.r,
    })),
    stickers: [...(data.stickers ?? [])],
    crates: [...(data.crates ?? [])].map(c => ({
      playerId: c.playerId,
      cardId: c.cardId,
      crateNumber: c.crateNumber,
    })),
    archive: [...(data.archive ?? [])],
  };
}

export function setupNextGame(legacy, baseConfig = {}) {
  const cfg = { ...baseConfig };
  const board = createBoard();
  for (const b of legacy.constructedBuildings) {
    const cell = board.cell(b.q, b.r);
    if (!cell || cell.type !== "destination" || cell.buildingId) continue;
    board.placeBuilding(cell, b.buildingId, b.ownerId);
  }
  cfg.board = board;
  const chronicle = baseConfig.chronicle ?? createChronicle();
  const stickerBook = baseConfig.stickerBook ?? createStickerBook({ chronicle });
  for (const id of legacy.stickers) stickerBook.apply(id);
  cfg.chronicle = chronicle;
  cfg.stickerBook = stickerBook;
  const crates = baseConfig.crates ?? createCrates();
  for (const c of legacy.crates) crates.unlock(c.playerId, c.cardId, c.crateNumber);
  cfg.crates = crates;
  const archive = baseConfig.archive ?? createArchive();
  for (const id of legacy.archive) archive.add(id);
  cfg.archive = archive;
  return cfg;
}
