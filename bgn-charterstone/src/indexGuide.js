// src/indexGuide.js — crate contents, the box catalog & the Index Guide
// (Tasks 34 & 42). Each numbered crate maps to the exact components the
// printed Index Guide says to extract. The starting rulebook mirrored at
// scratch/rules/rules-jina.txt deliberately does not print per-crate contents
// (the Index tuckbox is a spoiler-protected lookup table), so the table below
// is PROVISIONAL content keyed to the box catalog in the Icon Guide: its
// component totals (assistant x8, friend x12, item x12, guest x12, treasure
// x15, guidepost x1, companion x6, persona x8, objective x8, story x18,
// resources 12 each, coin x36, influence 12 per charter, perils x6 of each of
// 6 kinds, minions x6 of each of 6 kinds) are transcribed as BOX_CATALOG and
// the crate table is laid out so that crates + STARTING_SETUP sum EXACTLY to
// it — enforced by the Task 42 catalog test (src/indexGuide.test.js). The
// bulk sets (resources/coins/influence) start in the supply; perils/minions
// are campaign content (src/campaign.js).
//
// Component routing when a crate is unlocked (applyCrateContents):
//   - advancement-type cardIds (unconstructed/constructed building, assistant,
//     special) enter the advancement deck (re-shuffling the discard per the
//     "new cards are unlocked" rule),
//   - objective cardIds enter the objective pool (future reveal candidates),
//   - personas enter the unlocking player's Charter Chest (persona pool),
//   - stories enter the story pool (campaign narrative),
//   - stickers enter the sticker pool (applied by Task 35).

import { CARD_TYPES } from "./cards.js";
import { RESOURCE_TYPES } from "./economy.js";

// ── Box catalog (Icon Guide: the box's full component inventory) ──
export const BOX_CATALOG = {
  cards: {
    assistants: 8,
    friends: 12,
    items: 12,
    guests: 12,
    treasures: 15,
    guideposts: 1,
    companions: 6,
    personas: 8,
    objectives: 8,
    stories: 18,
  },
  perils: { bandit: 6, "fuel-shortage": 6, disrepair: 6, vermin: 6, blight: 6, famine: 6 },
  minions: { chef: 6, golem: 6, cat: 6, butler: 6, robot: 6, ghost: 6 },
  resources: Object.fromEntries(RESOURCE_TYPES.map(r => [r, 12])),
  coins: 36,
  influencePerCharter: 12,
};

// Components already in use at Game 1 (before any crate is unlocked). The 3
// starting objectives are revealed at random from the objective deck, but the
// OTHER FIVE live in crates; this list is the arithmetic anchor for the
// catalog test.
export const STARTING_SETUP = {
  advancementDeck: ["asst-1", "asst-2", "asst-3", "bldg-mine", "bldg-mill", "bldg-lumber"],
  personas: ["persona-1", "persona-2"],
  objectives: ["obj-1", "obj-2", "obj-3"],
  stories: ["story-1"],
};

// Story cards: campaign narrative content unlocked with crates (story-1 starts
// in the box). Titles/text are PROVISIONAL campaign flavor.
export const STORY_CARDS = {
  "story-1": { id: "story-1", number: 1, title: "Arrival", desc: "The Founder greets you at the gates of Greengully." },
  "story-2": { id: "story-2", number: 2, title: "The Empty Charter", desc: "A charter plot stands ready, waiting for its first builder." },
  "story-3": { id: "story-3", number: 3, title: "First Construction", desc: "The village takes its first shape under the Forever King's eye." },
  "story-4": { id: "story-4", number: 4, title: "The Zeppelin Lands", desc: "New supplies arrive from the Eternal City." },
  "story-5": { id: "story-5", number: 5, title: "Trading Post", desc: "Word of your village spreads along the old roads." },
  "story-6": { id: "story-6", number: 6, title: "The Guidepost", desc: "A weathered sign points toward something unseen." },
  "story-7": { id: "story-7", number: 7, title: "A Visitor in the Night", desc: "A stranger arrives with news that changes everything." },
  "story-8": { id: "story-8", number: 8, title: "The Marshal's Call", desc: "The village must answer a summons from the capital." },
  "story-9": { id: "story-9", number: 9, title: "Sky Island Sighting", desc: "An island drifts into view above the valley." },
  "story-10": { id: "story-10", number: 10, title: "Perils of the Forest", desc: "Danger stalks the wilds beyond the charter plots." },
  "story-11": { id: "story-11", number: 11, title: "The Minions Arrive", desc: "Strange servants begin appearing in the village." },
  "story-12": { id: "story-12", number: 12, title: "The King's Favor", desc: "The Forever King takes note of your prosperity." },
  "story-13": { id: "story-13", number: 13, title: "The Alliance", desc: "Rival charters find common cause." },
  "story-14": { id: "story-14", number: 14, title: "The Dragon's Shadow", desc: "A shadow falls over Greengully from the sky island." },
  "story-15": { id: "story-15", number: 15, title: "The Rebuilding", desc: "Out of hardship, the village rises stronger." },
  "story-16": { id: "story-16", number: 16, title: "The Final March", desc: "The last year of the campaign begins." },
  "story-17": { id: "story-17", number: 17, title: "The Truce", desc: "Old rivalries give way to a shared future." },
  "story-18": { id: "story-18", number: 18, title: "The Forever King", desc: "The campaign ends — and the kingdom remembers." },
};

// ── The Index Guide: every numbered crate's components ──
// Each crate: { cardIds, personas, stories, stickers }. Crates 1-8 are carried
// by constructed building cards (see content.test.js invariants); crates 9-12
// are standalone. The table sums exactly to BOX_CATALOG minus STARTING_SETUP
// (verified by the Task 42 catalog test).
export const CRATE_CONTENTS = {
  1:  { cardIds: ["asst-4", "spc-friend-2", "spc-treasure-2"], personas: ["persona-3"], stories: ["story-2"], stickers: [] },
  2:  { cardIds: ["bldg-quarry", "bldg-grainery", "spc-friend-3", "spc-item-2", "spc-guest-2"], personas: ["persona-4"], stories: ["story-3"], stickers: [] },
  3:  { cardIds: ["asst-5", "bldg-bakery", "spc-friend-4", "spc-item-3", "spc-guest-3", "spc-treasure-3"], personas: [], stories: ["story-4"], stickers: ["rule-advanced-actions"] },
  4:  { cardIds: ["bldg-smithy", "bldg-forge", "obj-4", "spc-friend-5", "spc-item-4", "spc-guest-4", "spc-treasure-4"], personas: ["persona-5"], stories: ["story-5"], stickers: [] },
  5:  { cardIds: ["obj-6", "bldg-orchard", "spc-friend-6", "spc-item-5", "spc-guest-5", "spc-treasure-5"], personas: ["persona-6"], stories: ["story-6"], stickers: [] },
  6:  { cardIds: ["bldg-windmill", "obj-5", "spc-friend-1", "spc-item-6", "spc-guest-6", "spc-treasure-6", "spc-companion-2", "spc-guidepost-1"], personas: [], stories: ["story-7"], stickers: ["rule-guideposts"] },
  7:  { cardIds: ["asst-6", "bldg-well", "spc-friend-7", "spc-item-7", "spc-guest-7", "spc-treasure-7", "spc-companion-3"], personas: ["persona-7"], stories: ["story-8"], stickers: [] },
  8:  { cardIds: ["obj-7", "bldg-stable", "spc-friend-8", "spc-item-8", "spc-guest-8", "spc-treasure-8", "spc-companion-4"], personas: ["persona-8"], stories: ["story-9"], stickers: [] },
  9:  { cardIds: ["asst-7", "spc-friend-9", "spc-item-9", "spc-guest-9", "spc-treasure-9", "spc-treasure-10", "spc-companion-5"], personas: [], stories: ["story-10"], stickers: ["rule-minions"] },
  10: { cardIds: ["spc-item-1", "spc-guest-1", "spc-friend-10", "spc-treasure-11", "spc-treasure-12", "spc-companion-6"], personas: [], stories: ["story-11"], stickers: [] },
  11: { cardIds: ["asst-8", "spc-treasure-1", "spc-friend-11", "spc-item-10", "spc-guest-10", "spc-treasure-13", "spc-treasure-14"], personas: [], stories: ["story-12"], stickers: [] },
  12: { cardIds: ["obj-8", "spc-companion-1", "spc-friend-12", "spc-item-11", "spc-guest-11", "spc-guest-12", "spc-treasure-15", "spc-item-12"], personas: [], stories: ["story-13", "story-14", "story-15", "story-16", "story-17", "story-18"], stickers: ["rule-campaign-end"] },
};

export function crateContents(crateNumber) {
  const c = CRATE_CONTENTS[crateNumber];
  return c ? { cardIds: [...c.cardIds], personas: [...c.personas], stories: [...c.stories], stickers: [...c.stickers] } : null;
}

export function createPersonaPool(config = {}) {
  const players = [...(config.players ?? [])];
  const pools = new Map(players.map(id => [id, []]));
  const pool = {
    players() {
      return [...players];
    },
    add(playerId, personaId) {
      if (!pools.has(playerId)) return { ok: false, reason: "no_such_player", playerId };
      pools.get(playerId).push(personaId);
      return { ok: true, playerId, personaId };
    },
    of(playerId) {
      return [...(pools.get(playerId) ?? [])];
    },
    all() {
      const out = {};
      for (const id of players) out[id] = [...(pools.get(id) ?? [])];
      return out;
    },
    toJSON() {
      const data = {};
      for (const [id, list] of pools.entries()) data[id] = [...list];
      return { kind: "personaPool", players: [...players], pools: data };
    },
    fromJSON(d) {
      if (!d || typeof d !== "object") throw new Error("personaPool: bad fromJSON payload");
      pools.clear();
      for (const id of d.players ?? []) pools.set(id, []);
      for (const [id, list] of Object.entries(d.pools ?? {})) {
        if (pools.has(id)) pools.set(id, [...list]);
      }
      return pool;
    },
  };
  return pool;
}

export function createStickerPool() {
  const stickers = [];
  return {
    add(id) {
      if (typeof id !== "string" || !id) throw new Error("stickerPool: id must be a non-empty string");
      if (!stickers.includes(id)) stickers.push(id);
      return stickers.length;
    },
    has(id) {
      return stickers.includes(id);
    },
    all() {
      return [...stickers];
    },
    toJSON() {
      return { kind: "stickerPool", stickers: [...stickers] };
    },
    fromJSON(d) {
      if (!d || typeof d !== "object") throw new Error("stickerPool: bad fromJSON payload");
      stickers.length = 0;
      stickers.push(...(d.stickers ?? []));
      return stickers;
    },
  };
}

export function createObjectivePool() {
  const pool = [];
  return {
    add(id) {
      if (typeof id !== "string" || !id) throw new Error("objectivePool: id must be a non-empty string");
      if (!pool.includes(id)) pool.push(id);
      return pool.length;
    },
    all() {
      return [...pool];
    },
    toJSON() {
      return { kind: "objectivePool", cards: [...pool] };
    },
    fromJSON(d) {
      if (!d || typeof d !== "object") throw new Error("objectivePool: bad fromJSON payload");
      pool.length = 0;
      pool.push(...(d.cards ?? []));
      return pool;
    },
  };
}

export function createStoryPool() {
  const pool = [];
  return {
    add(id) {
      if (typeof id !== "string" || !id) throw new Error("storyPool: id must be a non-empty string");
      if (!pool.includes(id)) pool.push(id);
      return pool.length;
    },
    all() {
      return [...pool];
    },
    has(id) {
      return pool.includes(id);
    },
    toJSON() {
      return { kind: "storyPool", stories: [...pool] };
    },
    fromJSON(d) {
      if (!d || typeof d !== "object") throw new Error("storyPool: bad fromJSON payload");
      pool.length = 0;
      pool.push(...(d.stories ?? []));
      return pool;
    },
  };
}

export function applyCrateContents(state, crateNumber, playerId) {
  const contents = crateContents(crateNumber);
  if (!contents) return { ok: false, reason: "no_such_crate", crateNumber };
  const added = { deck: [], objectives: [], personas: [], stories: [], stickers: [] };
  for (const cardId of contents.cardIds) {
    const card = state.cards ? state.cards[cardId] : null;
    if (!card) continue;
    if (card.type === CARD_TYPES.OBJECTIVE) {
      if (state.objectivePool) state.objectivePool.add(cardId);
      added.objectives.push(cardId);
    } else {
      if (state.advancement) state.advancement.addToDeck([cardId]);
      added.deck.push(cardId);
    }
  }
  for (const personaId of contents.personas) {
    if (state.personas) state.personas.add(playerId, personaId);
    added.personas.push(personaId);
  }
  for (const storyId of contents.stories) {
    if (state.storyPool) state.storyPool.add(storyId);
    added.stories.push(storyId);
  }
  for (const stickerId of contents.stickers) {
    if (state.stickerPool) state.stickerPool.add(stickerId);
    added.stickers.push(stickerId);
  }
  if (state.advancement) state.advancement.seedIfEmpty();
  return { ok: true, crateNumber, playerId, added };
}
