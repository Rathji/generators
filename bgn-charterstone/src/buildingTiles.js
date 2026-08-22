// src/buildingTiles.js — building-tile content data & schema (Task 23).
// A building tile is the constructed-building content record: construction
// cost (resources + influence), worker slots, action cost/benefit (the
// bottom-left cost and upper-right benefit printed on the tile), the owner
// benefit (gained by the owner when another player uses the building), VP
// value, and an optional crate number (which crate sits on the building's
// constructed card — see src/cards.js cbldg-* and Task 21). The fields
// `cost`/`benefit` are engine-compatible, so tiles merge directly into the
// engine's defs (DEFAULT_ENGINE_DEFS in src/buildings.js). Phase 9 transcribes
// the full printed set; this module ships the schema validator plus a small
// validated content set for Phases 5+.
//
// Tile schema (validated by validateBuildingTiles):
//   id                    — unique string id
//   name                  — display name
//   constructionCost      — non-empty items map (resources, coins allowed)
//   constructionInfluenceCost — influence tokens to construct (default 3)
//   workerSlots           — positive integer
//   cost                  — action cost items map (may be {})
//   benefit               — items map (non-empty) or function / {preflight, apply}
//   ownerBenefit          — items map (may be {})
//   vp                    — non-negative integer (end-game value)
//   crateNumber           — null, or positive integer

import { ITEMS } from "./economy.js";

export const BUILDING_TILE_KEYS = [
  "id", "name", "constructionCost", "constructionInfluenceCost",
  "workerSlots", "cost", "benefit", "ownerBenefit", "vp", "crateNumber",
];

const ITEM_SET = new Set(ITEMS);

function isItemsMap(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  if (entries.length === 0) return true;
  return entries.every(([k, n]) => ITEM_SET.has(k) && Number.isInteger(n) && n >= 0);
}

export function validateBuildingTiles(tiles) {
  const list = Array.isArray(tiles) ? tiles : Object.values(tiles);
  const errors = [];
  const seen = new Set();
  list.forEach((t, i) => {
    const at = "tile #" + (i + 1);
    if (!t || typeof t !== "object") {
      errors.push(at + ": not an object");
      return;
    }
    const who = "tile '" + (t.id ?? "?") + "'";
    if (typeof t.id !== "string" || !t.id) errors.push(at + ": missing/empty id");
    else if (seen.has(t.id)) errors.push(at + ": duplicate id '" + t.id + "'");
    if (t.id) seen.add(t.id);
    if (typeof t.name !== "string" || !t.name.trim()) errors.push(who + ": missing name");
    if (!isItemsMap(t.constructionCost) || !Object.keys(t.constructionCost ?? {}).length) {
      errors.push(who + ": constructionCost must be a non-empty items map");
    }
    if (!Number.isInteger(t.constructionInfluenceCost) || t.constructionInfluenceCost < 0) {
      errors.push(who + ": constructionInfluenceCost must be a non-negative integer");
    }
    if (!Number.isInteger(t.workerSlots) || t.workerSlots < 1) {
      errors.push(who + ": workerSlots must be a positive integer");
    }
    if (!isItemsMap(t.cost)) errors.push(who + ": cost must be an items map");
    const b = t.benefit;
    const benefitOk = typeof b === "function" ||
      (b && typeof b === "object" && (
        (isItemsMap(b.items) && Object.keys(b.items).length > 0) ||
        (typeof b.preflight === "function" && typeof b.apply === "function")
      ));
    if (!benefitOk) errors.push(who + ": benefit must be an items map or {preflight, apply}");
    if (!isItemsMap(t.ownerBenefit)) errors.push(who + ": ownerBenefit must be an items map");
    if (!Number.isInteger(t.vp) || t.vp < 0) errors.push(who + ": vp must be a non-negative integer");
    if (t.crateNumber != null && (!Number.isInteger(t.crateNumber) || t.crateNumber < 1)) {
      errors.push(who + ": crateNumber must be null or a positive integer");
    }
  });
  return { ok: errors.length === 0, errors, count: list.length };
}

export const DEFAULT_BUILDING_TILES = {
  mine: {
    id: "mine", name: "Mine",
    constructionCost: { coal: 1, wood: 1, grain: 1, pumpkin: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { metal: 1 } }, ownerBenefit: { coins: 1 },
    vp: 3, crateNumber: 1,
  },
  mill: {
    id: "mill", name: "Mill",
    constructionCost: { wood: 2, clay: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { grain: 1 } }, ownerBenefit: {},
    vp: 2, crateNumber: null,
  },
  lumber: {
    id: "lumber", name: "Lumber Yard",
    constructionCost: { wood: 1, pumpkin: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { wood: 1 } }, ownerBenefit: { coins: 1 },
    vp: 2, crateNumber: null,
  },
  quarry: {
    id: "quarry", name: "Quarry",
    constructionCost: { coal: 1, wood: 1, grain: 1, pumpkin: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: { clay: 2, coins: 1 }, benefit: { items: { metal: 1 } }, ownerBenefit: { coins: 1 },
    vp: 3, crateNumber: null,
  },
  smithy: {
    id: "smithy", name: "Smithy",
    constructionCost: { coal: 1, metal: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { coins: 3 } }, ownerBenefit: {},
    vp: 2, crateNumber: null,
  },
  grainery: {
    id: "grainery", name: "Grainery",
    constructionCost: { grain: 1, wood: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: { grain: 1 }, benefit: { items: { coins: 2 } }, ownerBenefit: {},
    vp: 2, crateNumber: 2,
  },
  bakery: {
    id: "bakery", name: "Bakery",
    constructionCost: { pumpkin: 1, grain: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { coins: 2 } }, ownerBenefit: {},
    vp: 2, crateNumber: 3,
  },
  forge: {
    id: "forge", name: "Forge",
    constructionCost: { coal: 2, metal: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: { metal: 1 }, benefit: { items: { coins: 3 } }, ownerBenefit: { coins: 1 },
    vp: 3, crateNumber: 4,
  },
  orchard: {
    id: "orchard", name: "Orchard",
    constructionCost: { wood: 1, clay: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { pumpkin: 1 } }, ownerBenefit: {},
    vp: 2, crateNumber: 5,
  },
  windmill: {
    id: "windmill", name: "Windmill",
    constructionCost: { wood: 2, clay: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { coins: 3 } }, ownerBenefit: { coins: 1 },
    vp: 3, crateNumber: 6,
  },
  well: {
    id: "well", name: "Well",
    constructionCost: { coal: 1, wood: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { metal: 1 } }, ownerBenefit: { coins: 1 },
    vp: 2, crateNumber: 7,
  },
  stable: {
    id: "stable", name: "Stable",
    constructionCost: { clay: 2, grain: 1 }, constructionInfluenceCost: 3,
    workerSlots: 1, cost: {}, benefit: { items: { wood: 1 } }, ownerBenefit: {},
    vp: 2, crateNumber: 8,
  },
};
