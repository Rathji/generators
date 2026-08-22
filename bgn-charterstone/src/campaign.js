// src/campaign.js — the 12-game campaign unlock schedule (Task 43).
// The printed schedule is Chronicle-protected (the starting rulebook lists the
// income icon as "ignore until unlocked" and the Icon Guide lists perils,
// minions, and sky-island components without dates), so this schedule is
// PROVISIONAL: the unlocks below are keyed to the Icon Guide's spoiler
// categories and to the rule flags the starting book explicitly gates
// (income → rule-income; add/drop players → rule-drop-players), with the
// content sets (guideposts, sky island, perils, minions) arriving mid- and
// late-campaign. Every scheduled unlock is a component list; applyGameUnlocks
// grants exactly that list into the correct pools (rule stickers APPLY to the
// sticker book — flipping chronicle flags — while content stickers and cards
// enter their pools), which the Task 43 tests verify. The bulk peril/minion
// card counts (6 kinds x6 each) reconcile against BOX_CATALOG (Task 42).
//
// The end-of-campaign scoring categories come from the Icon Guide's
// "END OF CAMPAIGN SCORING" block.

import { BOX_CATALOG } from "./indexGuide.js";
import { STICKER_DEFS, STICKER_TYPES } from "./stickers.js";

export const CAMPAIGN_GAME_COUNT = 12;

// Peril cards: 6 kinds, 6 copies each (bandit, fuel shortage, disrepair,
// vermin, blight, famine).
export const PERIL_DEFS = {
  bandit: { id: "peril-bandit", name: "Bandit", count: 6 },
  "fuel-shortage": { id: "peril-fuel-shortage", name: "Fuel Shortage", count: 6 },
  disrepair: { id: "peril-disrepair", name: "Disrepair", count: 6 },
  vermin: { id: "peril-vermin", name: "Vermin", count: 6 },
  blight: { id: "peril-blight", name: "Blight", count: 6 },
  famine: { id: "peril-famine", name: "Famine", count: 6 },
};

// Minion cards: 6 kinds, 6 copies each (chef, golem, cat, butler, robot, ghost).
export const MINION_DEFS = {
  chef: { id: "minion-chef", name: "Chef", count: 6 },
  golem: { id: "minion-golem", name: "Golem", count: 6 },
  cat: { id: "minion-cat", name: "Cat", count: 6 },
  butler: { id: "minion-butler", name: "Butler", count: 6 },
  robot: { id: "minion-robot", name: "Robot", count: 6 },
  ghost: { id: "minion-ghost", name: "Ghost", count: 6 },
};

export function perilIds() {
  return Object.values(PERIL_DEFS).flatMap(d => Array.from({ length: d.count }, () => d.id));
}
export function minionIds() {
  return Object.values(MINION_DEFS).flatMap(d => Array.from({ length: d.count }, () => d.id));
}

// End-of-campaign scoring categories (Icon Guide "END OF CAMPAIGN SCORING").
export const CAMPAIGN_END_SCORING = [
  { id: "capacity", name: "Capacity", vp: "1-3", desc: "Each filled capacity space on your charter scores 1-3 VP." },
  { id: "used-personas", name: "Used Personas", vp: "5-7", desc: "Personas kept for the whole campaign score 5-7 VP each." },
  { id: "victories", name: "Victories", vp: "6-8", desc: "Each game you won scores 6-8 VP." },
  { id: "glory", name: "Glory", vp: "10", desc: "The player with the most Glory gains 10 VP." },
  { id: "building-value", name: "Building Value", vp: "per building", desc: "Each constructed building in your charter scores its printed value." },
];

// The unlock schedule: game number → components granted when that game begins.
// Games without an entry unlock nothing extra. `stickers` may contain rule
// stickers (applied permanently → chronicle flags flip) or content stickers
// (added to the sticker pool). `cards` enter the advancement deck.
export const CAMPAIGN_UNLOCKS = {
  2: { stickers: ["rule-income"], cards: [] },
  4: { stickers: ["rule-drop-players"], cards: [] },
  6: { stickers: ["content-guideposts"], cards: [] },
  8: { stickers: ["content-sky-island"], cards: [] },
  9: { stickers: ["content-perils"], cards: [] },
  11: { stickers: ["content-minions"], cards: [] },
};

export function unlockForGame(gameNumber) {
  const base = CAMPAIGN_UNLOCKS[gameNumber] ?? { stickers: [], cards: [] };
  return { game: gameNumber, stickers: [...base.stickers], cards: [...base.cards] };
}

export function applyGameUnlocks(state, gameNumber) {
  const u = unlockForGame(gameNumber);
  const added = { stickers: [], cards: [] };
  for (const stickerId of u.stickers) {
    const def = STICKER_DEFS[stickerId];
    let applied = false;
    if (def && def.type === STICKER_TYPES.RULE && state.stickerBook) {
      applied = state.stickerBook.apply(stickerId).ok;
    } else if (state.stickerPool) {
      state.stickerPool.add(stickerId);
    }
    added.stickers.push({ id: stickerId, applied });
  }
  for (const cardId of u.cards) {
    if (state.advancement) state.advancement.addToDeck([cardId]);
    added.cards.push(cardId);
  }
  if (state.advancement) state.advancement.seedIfEmpty();
  return { ok: true, game: u.game, stickers: u.stickers, cards: u.cards, added };
}

// Reconciles the campaign content defs against the box catalog (perils 6x6,
// minions 6x6). Returns { ok, details } for the catalog cross-check test.
export function reconcileCatalog() {
  const perils = Object.fromEntries(Object.entries(PERIL_DEFS).map(([k, d]) => [k, d.count]));
  const minions = Object.fromEntries(Object.entries(MINION_DEFS).map(([k, d]) => [k, d.count]));
  const perilsMatch = JSON.stringify(perils) === JSON.stringify(BOX_CATALOG.perils);
  const minionsMatch = JSON.stringify(minions) === JSON.stringify(BOX_CATALOG.minions);
  return { ok: perilsMatch && minionsMatch, perils, minions };
}
