// src/cards.js — card registry & card types (Phase 4 scaffold, Tasks 26-29,
// 40-42). A card is a plain content record keyed by id. Types follow the
// printed Charterstone decks: constructed building cards (building already
// built on the board, some carry a crate), unconstructed building cards
// (build via the Zeppelin), assistant, persona, objective, and special cards.
// Phase 9 (Tasks 40-42) transcribes the full content set: the objective deck
// with executable condition predicates (Task 40), and persona/special cards
// with deterministic pure-effect `ability` functions (Task 41, evaluated by
// src/effects.js). validateCards (Task 26) enforces the per-type schemas and
// cardLegalChannels maps each type to its legal game channels. Held-card
// state lives on the player (src/player.js, `cards` array); objectives
// additionally get per-game completion/scoring state via src/objectives.js.
//
// NOTE: the printed starting rulebook mirrors only The Commons — the card
// texts, persona/special effects, and the friend/item/guest/treasure sets are
// PROVISIONAL content keyed to the box catalog (icon guide: assistant x8,
// friend x12, item x12, guest x12, treasure x15, guidepost x1, companion x6,
// persona x8, objective x8). Task 42 reconciles the crate table against that
// catalog; the shapes below are final.

import { ITEMS } from "./economy.js";
import { effects } from "./effects.js";

export const CARD_TYPES = Object.freeze({
  CONSTRUCTED_BUILDING: "constructedBuilding",
  UNCONSTRUCTED_BUILDING: "unconstructedBuilding",
  ASSISTANT: "assistant",
  PERSONA: "persona",
  OBJECTIVE: "objective",
  SPECIAL: "special",
});

export const ASSISTANT_TRIGGERS = Object.freeze(["place", "construct", "scoreObjective"]);

// Subtypes of the SPECIAL type (friend/item/guest/treasure/guidepost/companion).
export const SPECIAL_SUBTYPES = Object.freeze({
  FRIEND: "friend",
  ITEM: "item",
  GUEST: "guest",
  TREASURE: "treasure",
  GUIDEPOST: "guidepost",
  COMPANION: "companion",
});

const TYPE_VALUES = new Set(Object.values(CARD_TYPES));
const SUBTYPE_VALUES = new Set(Object.values(SPECIAL_SUBTYPES));

const ITEM_SET = new Set(ITEMS);

function isItemsMap(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  if (entries.length === 0) return true;
  return entries.every(([k, n]) => ITEM_SET.has(k) && Number.isInteger(n) && n >= 0);
}

export function validateCards(cards) {
  const list = Array.isArray(cards) ? cards : Object.values(cards);
  const errors = [];
  const seen = new Set();
  list.forEach((c, i) => {
    const at = "card #" + (i + 1);
    if (!c || typeof c !== "object") {
      errors.push(at + ": not an object");
      return;
    }
    const who = "card '" + (c.id ?? "?") + "'";
    if (typeof c.id !== "string" || !c.id) errors.push(at + ": missing/empty id");
    else if (seen.has(c.id)) errors.push(at + ": duplicate id '" + c.id + "'");
    if (c.id) seen.add(c.id);
    if (!TYPE_VALUES.has(c.type)) errors.push(who + ": unknown type '" + c.type + "'");
    if (typeof c.name !== "string" || !c.name.trim()) errors.push(who + ": missing name");
    if (c.type === CARD_TYPES.CONSTRUCTED_BUILDING) {
      if (typeof c.buildingId !== "string" || !c.buildingId) errors.push(who + ": constructedBuilding needs buildingId");
      if (c.crateNumber != null && (!Number.isInteger(c.crateNumber) || c.crateNumber < 1)) {
        errors.push(who + ": crateNumber must be null or a positive integer");
      }
    }
    if (c.type === CARD_TYPES.UNCONSTRUCTED_BUILDING) {
      if (typeof c.buildingId !== "string" || !c.buildingId) errors.push(who + ": unconstructedBuilding needs buildingId");
      if (!isItemsMap(c.constructionCost) || !Object.keys(c.constructionCost ?? {}).length) {
        errors.push(who + ": constructionCost must be a non-empty items map");
      }
    }
    if (c.type === CARD_TYPES.OBJECTIVE && typeof c.condition !== "function") {
      errors.push(who + ": objective needs a condition function");
    }
    if ((c.type === CARD_TYPES.PERSONA || c.type === CARD_TYPES.SPECIAL) && typeof c.ability !== "function") {
      errors.push(who + ": " + (c.type === CARD_TYPES.PERSONA ? "persona" : "special") + " needs an ability function");
    }
    if (c.type === CARD_TYPES.SPECIAL && c.subtype != null && !SUBTYPE_VALUES.has(c.subtype)) {
      errors.push(who + ": unknown special subtype '" + c.subtype + "'");
    }
    if (c.effect != null) {
      if (typeof c.effect !== "object" || Array.isArray(c.effect)) {
        errors.push(who + ": effect must be an object of trigger → items map");
      } else {
        for (const [trigger, bonus] of Object.entries(c.effect)) {
          if (!isItemsMap(bonus)) errors.push(who + ": effect['" + trigger + "'] must be an items map");
        }
      }
    }
    if (c.unnamed != null && typeof c.unnamed !== "boolean") errors.push(who + ": unnamed must be a boolean");
  });
  return { ok: errors.length === 0, errors, count: list.length };
}

export function cardLegalChannels(card) {
  if (!card) return [];
  switch (card.type) {
    case CARD_TYPES.CONSTRUCTED_BUILDING:
      return card.crateNumber ? ["crate_unlock"] : [];
    case CARD_TYPES.UNCONSTRUCTED_BUILDING:
      return ["construct"];
    case CARD_TYPES.ASSISTANT:
      return ["assist"];
    case CARD_TYPES.PERSONA:
      return ["persona"];
    case CARD_TYPES.OBJECTIVE:
      return ["score"];
    case CARD_TYPES.SPECIAL:
      return ["special"];
    default:
      return [];
  }
}

// Compact helpers for the 58 special cards (all deterministic pure-effect
// `ability` functions built from the factories in src/effects.js).
const spc = (id, subtype, name, ability, desc) =>
  ({ id, name, type: CARD_TYPES.SPECIAL, subtype, ability, desc });
const friend = (id, name, ability, desc) => spc(id, SPECIAL_SUBTYPES.FRIEND, name, ability, desc);
const item = (id, name, ability, desc) => spc(id, SPECIAL_SUBTYPES.ITEM, name, ability, desc);
const guest = (id, name, ability, desc) => spc(id, SPECIAL_SUBTYPES.GUEST, name, ability, desc);
const treasure = (id, name, ability, desc) => spc(id, SPECIAL_SUBTYPES.TREASURE, name, ability, desc);
const companion = (id, name, ability, desc) => spc(id, SPECIAL_SUBTYPES.COMPANION, name, ability, desc);
const guidepostCard = (id, name, ability, desc) => spc(id, SPECIAL_SUBTYPES.GUIDEPOST, name, ability, desc);

export const DEFAULT_CARDS = {
  "asst-1": { id: "asst-1", type: CARD_TYPES.ASSISTANT, name: "Apprentice", unnamed: true, desc: "You may retrieve your workers once per turn at no cost." },
  "asst-2": { id: "asst-2", type: CARD_TYPES.ASSISTANT, name: "Carpenter", desc: "Whenever you construct a building, gain 1 coin.", effect: { construct: { coins: 1 } } },
  "asst-3": { id: "asst-3", type: CARD_TYPES.ASSISTANT, name: "Merchant", desc: "Whenever you use the Treasury, gain 1 coin.", effect: { treasury: { coins: 1 } } },
  "asst-4": { id: "asst-4", type: CARD_TYPES.ASSISTANT, name: "Guildmaster", desc: "Whenever you construct a building, gain 1 metal.", effect: { construct: { metal: 1 } } },
  "asst-5": { id: "asst-5", type: CARD_TYPES.ASSISTANT, name: "Steward", desc: "Whenever you place a worker, gain 1 coin.", effect: { place: { coins: 1 } } },
  "asst-6": { id: "asst-6", type: CARD_TYPES.ASSISTANT, name: "Trader", desc: "Whenever you use the Market, gain 1 coin.", effect: { market: { coins: 1 } } },
  "asst-7": { id: "asst-7", type: CARD_TYPES.ASSISTANT, name: "Pup", unnamed: true, desc: "Unnamed assistant from crate 9." },
  "asst-8": { id: "asst-8", type: CARD_TYPES.ASSISTANT, name: "Forester", desc: "Whenever you use the Treasury, gain 1 wood.", effect: { treasury: { wood: 1 } } },

  "persona-1": { id: "persona-1", type: CARD_TYPES.PERSONA, name: "The Founder", ability: () => effects.setup({ coins: 1 }), desc: "Your personal supply starts with 1 extra coin each game." },
  "persona-2": { id: "persona-2", type: CARD_TYPES.PERSONA, name: "The Foreman", ability: () => effects.freeOwnedBuildingUse(), desc: "Once per game: use a building you own for free." },
  "persona-3": { id: "persona-3", type: CARD_TYPES.PERSONA, name: "The Prospector", ability: () => effects.income({ coins: 1 }), desc: "Whenever income triggers, gain 1 extra coin." },
  "persona-4": { id: "persona-4", type: CARD_TYPES.PERSONA, name: "The Governor", ability: () => effects.reputation(1), desc: "Once per game: gain 1 reputation." },
  "persona-5": { id: "persona-5", type: CARD_TYPES.PERSONA, name: "The Scholar", ability: () => effects.gainCard(), desc: "Once per game: gain 1 face-up advancement card." },
  "persona-6": { id: "persona-6", type: CARD_TYPES.PERSONA, name: "The Marshall", ability: () => effects.vp(4), desc: "Once per game: gain 4 VP." },
  "persona-7": { id: "persona-7", type: CARD_TYPES.PERSONA, name: "The Dean", ability: () => effects.items({ wood: 1, clay: 1 }), desc: "Once per game: gain 1 wood and 1 clay." },
  "persona-8": { id: "persona-8", type: CARD_TYPES.PERSONA, name: "The Alchemist", ability: () => effects.trade({ coins: 2 }, { any: 1 }), desc: "Once per game: pay 2 coins to gain 1 resource of any type." },

  "cbldg-1": { id: "cbldg-1", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Quarry", buildingId: "quarry", crateNumber: 1, desc: "Constructed building card with crate 1." },
  "cbldg-2": { id: "cbldg-2", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Smithy", buildingId: "smithy", crateNumber: null, desc: "Constructed building card (no crate)." },
  "cbldg-mine": { id: "cbldg-mine", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Mine", buildingId: "mine", crateNumber: 1, desc: "Constructed Mine card with crate 1 — kept in supply when the Mine is built (Task 21)." },
  "cbldg-grainery": { id: "cbldg-grainery", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Grainery", buildingId: "grainery", crateNumber: 2, desc: "Constructed Grainery card with crate 2." },
  "cbldg-bakery": { id: "cbldg-bakery", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Bakery", buildingId: "bakery", crateNumber: 3, desc: "Constructed Bakery card with crate 3." },
  "cbldg-forge": { id: "cbldg-forge", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Forge", buildingId: "forge", crateNumber: 4, desc: "Constructed Forge card with crate 4." },
  "cbldg-orchard": { id: "cbldg-orchard", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Orchard", buildingId: "orchard", crateNumber: 5, desc: "Constructed Orchard card with crate 5." },
  "cbldg-windmill": { id: "cbldg-windmill", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Windmill", buildingId: "windmill", crateNumber: 6, desc: "Constructed Windmill card with crate 6." },
  "cbldg-well": { id: "cbldg-well", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Well", buildingId: "well", crateNumber: 7, desc: "Constructed Well card with crate 7." },
  "cbldg-stable": { id: "cbldg-stable", type: CARD_TYPES.CONSTRUCTED_BUILDING, name: "Stable", buildingId: "stable", crateNumber: 8, desc: "Constructed Stable card with crate 8." },

  "bldg-mine": { id: "bldg-mine", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Mine", buildingId: "mine", constructionCost: { coal: 1, wood: 1, grain: 1, pumpkin: 1 }, desc: "Construct for 1 coal + 1 wood + 1 grain + 1 pumpkin." },
  "bldg-mill": { id: "bldg-mill", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Mill", buildingId: "mill", constructionCost: { wood: 2, clay: 1 }, desc: "Construct for 2 wood + 1 clay." },
  "bldg-lumber": { id: "bldg-lumber", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Lumber Yard", buildingId: "lumber", constructionCost: { wood: 1, pumpkin: 1 }, desc: "Construct for 1 wood + 1 pumpkin." },
  "bldg-quarry": { id: "bldg-quarry", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Quarry", buildingId: "quarry", constructionCost: { coal: 1, wood: 1, grain: 1, pumpkin: 1 }, desc: "Construct for 1 coal + 1 wood + 1 grain + 1 pumpkin." },
  "bldg-smithy": { id: "bldg-smithy", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Smithy", buildingId: "smithy", constructionCost: { coal: 1, metal: 1 }, desc: "Construct for 1 coal + 1 metal." },
  "bldg-grainery": { id: "bldg-grainery", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Grainery", buildingId: "grainery", constructionCost: { grain: 1, wood: 1 }, desc: "Construct for 1 grain + 1 wood." },
  "bldg-bakery": { id: "bldg-bakery", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Bakery", buildingId: "bakery", constructionCost: { pumpkin: 1, grain: 1 }, desc: "Construct for 1 pumpkin + 1 grain." },
  "bldg-forge": { id: "bldg-forge", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Forge", buildingId: "forge", constructionCost: { coal: 2, metal: 1 }, desc: "Construct for 2 coal + 1 metal." },
  "bldg-orchard": { id: "bldg-orchard", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Orchard", buildingId: "orchard", constructionCost: { wood: 1, clay: 1 }, desc: "Construct for 1 wood + 1 clay." },
  "bldg-windmill": { id: "bldg-windmill", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Windmill", buildingId: "windmill", constructionCost: { wood: 2, clay: 1 }, desc: "Construct for 2 wood + 1 clay." },
  "bldg-well": { id: "bldg-well", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Well", buildingId: "well", constructionCost: { coal: 1, wood: 1 }, desc: "Construct for 1 coal + 1 wood." },
  "bldg-stable": { id: "bldg-stable", type: CARD_TYPES.UNCONSTRUCTED_BUILDING, name: "Stable", buildingId: "stable", constructionCost: { clay: 2, grain: 1 }, desc: "Construct for 2 clay + 1 grain." },

  "obj-1": { id: "obj-1", type: CARD_TYPES.OBJECTIVE, name: "Builder", desc: "Own at least 2 constructed buildings.", condition: ctx => (ctx.player?.constructedBuildingCount ?? 0) >= 2 },
  "obj-2": { id: "obj-2", type: CARD_TYPES.OBJECTIVE, name: "Merchant", desc: "Hold at least 8 coins.", condition: ctx => (ctx.player?.coins?.() ?? 0) >= 8 },
  "obj-3": { id: "obj-3", type: CARD_TYPES.OBJECTIVE, name: "Provider", desc: "Hold at least 6 resources in your personal supply.", condition: ctx => (Object.values(ctx.player?.resources?.() ?? {}).reduce((a, b) => a + b, 0)) >= 6 },
  "obj-4": { id: "obj-4", type: CARD_TYPES.OBJECTIVE, name: "Builder II", desc: "Own at least 3 constructed buildings.", condition: ctx => (ctx.player?.constructedBuildingCount ?? 0) >= 3 },
  "obj-5": { id: "obj-5", type: CARD_TYPES.OBJECTIVE, name: "Collector", desc: "Hold at least 3 different resource types.", condition: ctx => { const r = ctx.player?.resources?.() ?? {}; return Object.values(r).filter(n => n > 0).length >= 3; } },
  "obj-6": { id: "obj-6", type: CARD_TYPES.OBJECTIVE, name: "Builder III", desc: "Own at least 4 constructed buildings.", condition: ctx => (ctx.player?.constructedBuildingCount ?? 0) >= 4 },
  "obj-7": { id: "obj-7", type: CARD_TYPES.OBJECTIVE, name: "Treasurer", desc: "Hold at least 10 coins.", condition: ctx => (ctx.player?.coins?.() ?? 0) >= 10 },
  "obj-8": { id: "obj-8", type: CARD_TYPES.OBJECTIVE, name: "Resource Baron", desc: "Hold at least 8 resources in your personal supply.", condition: ctx => (Object.values(ctx.player?.resources?.() ?? {}).reduce((a, b) => a + b, 0)) >= 8 },

  // ── Special cards (provisional content keyed to the box catalog) ──
  // Friends: permanent companions, one-shot use.
  "spc-friend-1": friend("spc-friend-1", "Bram", () => effects.items({ coins: 2 }), "Once per turn: gain 2 coins."),
  "spc-friend-2": friend("spc-friend-2", "Tessa", () => effects.vp(2), "Gain 2 VP."),
  "spc-friend-3": friend("spc-friend-3", "Orin", () => effects.reputation(1), "Gain 1 reputation."),
  "spc-friend-4": friend("spc-friend-4", "Maeve", ctx => effects.items({ wood: (ctx.player?.coins?.() ?? 0) >= 3 ? 2 : 1, clay: 1 }), "Gain 1 clay and 1-2 wood (more when you hold 3+ coins)."),
  "spc-friend-5": friend("spc-friend-5", "Rook", () => effects.vp(3), "Gain 3 VP."),
  "spc-friend-6": friend("spc-friend-6", "Pip", () => effects.items({ grain: 1, pumpkin: 1 }), "Gain 1 grain and 1 pumpkin."),
  "spc-friend-7": friend("spc-friend-7", "Sable", () => effects.retrieveWorkers(), "Retrieve all your workers."),
  "spc-friend-8": friend("spc-friend-8", "Fenn", () => effects.items({ metal: 1, coal: 1 }), "Gain 1 metal and 1 coal."),
  "spc-friend-9": friend("spc-friend-9", "Juniper", () => effects.reputation(1), "Gain 1 reputation."),
  "spc-friend-10": friend("spc-friend-10", "Casper", () => effects.income({ coins: 2 }), "During income, gain 2 extra coins."),
  "spc-friend-11": friend("spc-friend-11", "Elowen", () => effects.items({ coins: 4 }), "Gain 4 coins."),
  "spc-friend-12": friend("spc-friend-12", "Barth", () => effects.vp(4), "Gain 4 VP."),

  // Items: one-time supplies.
  "spc-item-1": item("spc-item-1", "Supply Crate", () => effects.items({ coins: 1 }), "Gain 1 coin."),
  "spc-item-2": item("spc-item-2", "Timber Bundle", () => effects.items({ wood: 1 }), "Gain 1 wood."),
  "spc-item-3": item("spc-item-3", "Clay Vessel", () => effects.items({ clay: 1 }), "Gain 1 clay."),
  "spc-item-4": item("spc-item-4", "Coal Lump", () => effects.items({ coal: 1 }), "Gain 1 coal."),
  "spc-item-5": item("spc-item-5", "Grain Sack", () => effects.items({ grain: 1 }), "Gain 1 grain."),
  "spc-item-6": item("spc-item-6", "Pumpkin Harvest", () => effects.items({ pumpkin: 1 }), "Gain 1 pumpkin."),
  "spc-item-7": item("spc-item-7", "Metal Ingot", () => effects.items({ metal: 1 }), "Gain 1 metal."),
  "spc-item-8": item("spc-item-8", "Coin Purse", () => effects.items({ coins: 2 }), "Gain 2 coins."),
  "spc-item-9": item("spc-item-9", "Lumber Cart", () => effects.items({ wood: 2 }), "Gain 2 wood."),
  "spc-item-10": item("spc-item-10", "Fuel Cache", () => effects.items({ coal: 2 }), "Gain 2 coal."),
  "spc-item-11": item("spc-item-11", "Treasure Chest", () => effects.items({ coins: 3 }), "Gain 3 coins."),
  "spc-item-12": item("spc-item-12", "Brickworks", () => effects.items({ clay: 2 }), "Gain 2 clay."),

  // Guests: one-time visits.
  "spc-guest-1": guest("spc-guest-1", "Wandering Bard", () => effects.vp(2), "Gain 2 VP."),
  "spc-guest-2": guest("spc-guest-2", "Herbalist", () => effects.reputation(1), "Gain 1 reputation."),
  "spc-guest-3": guest("spc-guest-3", "Tinker", () => effects.items({ coins: 2 }), "Gain 2 coins."),
  "spc-guest-4": guest("spc-guest-4", "Farmer's Kin", () => effects.items({ grain: 1, pumpkin: 1 }), "Gain 1 grain and 1 pumpkin."),
  "spc-guest-5": guest("spc-guest-5", "Cartographer", () => effects.vp(3), "Gain 3 VP."),
  "spc-guest-6": guest("spc-guest-6", "Mason", () => effects.items({ wood: 1, clay: 1 }), "Gain 1 wood and 1 clay."),
  "spc-guest-7": guest("spc-guest-7", "Post Rider", () => effects.retrieveWorkers(), "Retrieve all your workers."),
  "spc-guest-8": guest("spc-guest-8", "Metalsmith", () => effects.items({ metal: 1 }), "Gain 1 metal."),
  "spc-guest-9": guest("spc-guest-9", "Minstrel", () => effects.vp(2), "Gain 2 VP."),
  "spc-guest-10": guest("spc-guest-10", "Banker", () => effects.items({ coins: 3 }), "Gain 3 coins."),
  "spc-guest-11": guest("spc-guest-11", "Surveyor", () => effects.reputation(1), "Gain 1 reputation."),
  "spc-guest-12": guest("spc-guest-12", "Ambassador", () => effects.vp(4), "Gain 4 VP."),

  // Treasures: end-game VP.
  "spc-treasure-1": treasure("spc-treasure-1", "Crown of Greengully", () => effects.endGameVp(3), "Gain 3 VP at game end."),
  "spc-treasure-2": treasure("spc-treasure-2", "Silver Chalice", () => effects.endGameVp(2), "Gain 2 VP at game end."),
  "spc-treasure-3": treasure("spc-treasure-3", "Emerald Signet", () => effects.endGameVp(4), "Gain 4 VP at game end."),
  "spc-treasure-4": treasure("spc-treasure-4", "Gilded Quill", () => effects.endGameVp(2), "Gain 2 VP at game end."),
  "spc-treasure-5": treasure("spc-treasure-5", "Royal Compass", () => effects.endGameVp(3), "Gain 3 VP at game end."),
  "spc-treasure-6": treasure("spc-treasure-6", "Jeweled Harp", () => effects.endGameVp(3), "Gain 3 VP at game end."),
  "spc-treasure-7": treasure("spc-treasure-7", "Star Sapphire", () => effects.endGameVp(4), "Gain 4 VP at game end."),
  "spc-treasure-8": treasure("spc-treasure-8", "Bronze Idol", () => effects.endGameVp(2), "Gain 2 VP at game end."),
  "spc-treasure-9": treasure("spc-treasure-9", "Amber Crown", () => effects.endGameVp(3), "Gain 3 VP at game end."),
  "spc-treasure-10": treasure("spc-treasure-10", "Crystal Sphere", () => effects.endGameVp(4), "Gain 4 VP at game end."),
  "spc-treasure-11": treasure("spc-treasure-11", "Onyx Talisman", () => effects.endGameVp(3), "Gain 3 VP at game end."),
  "spc-treasure-12": treasure("spc-treasure-12", "Pearl Diadem", () => effects.endGameVp(2), "Gain 2 VP at game end."),
  "spc-treasure-13": treasure("spc-treasure-13", "Aegis of the Valley", ctx => effects.endGameVp((ctx.player?.constructedBuildingCount ?? 0) >= 4 ? 5 : 3), "Gain 3-5 VP at game end (more when you own 4+ constructed buildings)."),
  "spc-treasure-14": treasure("spc-treasure-14", "Throne Relic", () => effects.endGameVp(4), "Gain 4 VP at game end."),
  "spc-treasure-15": treasure("spc-treasure-15", "The Forever King's Seal", () => effects.endGameVp(5), "Gain 5 VP at game end."),

  // Guidepost (the single guidepost in the box catalog).
  "spc-guidepost-1": guidepostCard("spc-guidepost-1", "Guidepost", () => effects.guidepost(), "Reveals a guidepost destination for the village."),

  // Companions: permanent helpers.
  "spc-companion-1": companion("spc-companion-1", "Ghost of Greengully", () => effects.vp(2), "Gain 2 VP."),
  "spc-companion-2": companion("spc-companion-2", "Old Copperpot", () => effects.items({ coins: 2 }), "Gain 2 coins."),
  "spc-companion-3": companion("spc-companion-3", "Lord Farthing", () => effects.reputation(1), "Gain 1 reputation."),
  "spc-companion-4": companion("spc-companion-4", "Kit the Cat", () => effects.income({ coins: 1 }), "During income, gain 1 extra coin."),
  "spc-companion-5": companion("spc-companion-5", "The Butler", () => effects.vp(3), "Gain 3 VP."),
  "spc-companion-6": companion("spc-companion-6", "Clockwork Golem", () => effects.items({ wood: 1 }), "Gain 1 wood."),
};
