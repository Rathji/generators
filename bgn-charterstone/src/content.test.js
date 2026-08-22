// src/content.test.js — Phase 9 full-building-card-set validation (Task 39).
// Run in-page via ?test=content, or programmatically via window.__loadContentTests().
// Task 39: all unconstructed/constructed building cards (name, costs, benefit,
// owner benefit, slots, VP, crate) transcribe into content data that validates
// against the building-tile schema with no duplicate ids, stays internally
// consistent (unconstructed card ↔ tile, constructed card ↔ tile ↔ crate),
// and merges into the engine defs.

import { DEFAULT_CARDS, CARD_TYPES, validateCards } from "./cards.js";
import { DEFAULT_BUILDING_TILES, validateBuildingTiles } from "./buildingTiles.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { CRATE_CONTENTS } from "./indexGuide.js";

function deepItems(a, b) {
  const ka = Object.keys(a).sort().join(",");
  const kb = Object.keys(b).sort().join(",");
  if (ka !== kb) return false;
  return ka.split(",").every(k => a[k] === b[k]);
}

export function runContentTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  const cards = Object.values(DEFAULT_CARDS);
  const tiles = Object.values(DEFAULT_BUILDING_TILES);
  const unconstructed = cards.filter(c => c.type === CARD_TYPES.UNCONSTRUCTED_BUILDING);
  const constructed = cards.filter(c => c.type === CARD_TYPES.CONSTRUCTED_BUILDING);

  // ── schema validation, no duplicate ids ──
  const vCards = validateCards(DEFAULT_CARDS);
  ok("the full card set validates against the card schema with no duplicate ids",
    vCards.ok && vCards.errors.length === 0 && vCards.count === cards.length &&
    new Set(cards.map(c => c.id)).size === cards.length);
  const vTiles = validateBuildingTiles(DEFAULT_BUILDING_TILES);
  ok("the full building-tile set validates against the tile schema with no duplicate ids",
    vTiles.ok && vTiles.errors.length === 0 && vTiles.count === tiles.length &&
    new Set(tiles.map(t => t.id)).size === tiles.length);

  // ── unconstructed cards ↔ tiles ──
  ok("every unconstructed building card has a matching tile with identical construction cost",
    unconstructed.every(c =>
      !!DEFAULT_BUILDING_TILES[c.buildingId] &&
      deepItems(c.constructionCost, DEFAULT_BUILDING_TILES[c.buildingId].constructionCost)));
  ok("the full set ships one unconstructed card per building type",
    new Set(unconstructed.map(c => c.buildingId)).size === tiles.length);

  // ── constructed cards ↔ tiles ↔ crates ──
  ok("every constructed building card has a matching tile",
    constructed.every(c => !!DEFAULT_BUILDING_TILES[c.buildingId]));
  ok("every crate-bearing tile has a matching constructed card with the same crate number",
    tiles.filter(t => t.crateNumber != null).every(t => {
      const card = DEFAULT_CARDS["cbldg-" + t.id];
      return !!card && card.type === CARD_TYPES.CONSTRUCTED_BUILDING &&
        card.crateNumber === t.crateNumber;
    }));
  ok("every constructed card's crate number maps to Index Guide contents",
    constructed.filter(c => c.crateNumber != null).every(c => !!CRATE_CONTENTS[c.crateNumber]));
  ok("crateless constructed cards carry no crate number",
    constructed.every(c => c.crateNumber == null || DEFAULT_BUILDING_TILES[c.buildingId].crateNumber == null ||
      c.crateNumber === DEFAULT_BUILDING_TILES[c.buildingId].crateNumber));

  // ── engine integration ──
  ok("all building tiles are engine-compatible defs (slots, cost, benefit, ownerBenefit, vp)",
    tiles.every(t =>
      DEFAULT_ENGINE_DEFS[t.id] && DEFAULT_ENGINE_DEFS[t.id].workerSlots >= 1 &&
      DEFAULT_ENGINE_DEFS[t.id].benefit && DEFAULT_ENGINE_DEFS[t.id].ownerBenefit != null &&
      DEFAULT_ENGINE_DEFS[t.id].vp === t.vp));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "content", pass, fail, results };
}
