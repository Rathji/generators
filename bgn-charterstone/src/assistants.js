// src/assistants.js — assistant registry (Task 27).
// Unnamed assistant cards may be given a name by their owner (written on the
// card). Names are stored per card id (each advancement card is unique, so a
// card is held by exactly one player). Assistant EFFECT bonuses (e.g. "gain 1
// coin on construction") live on the card content (src/cards.js `effect`) and
// are applied by the engine when the owner performs the triggering core
// function — this module tracks only the naming state.

import { CARD_TYPES } from "./cards.js";

export function createAssistants(config = {}) {
  const cards = config.cards ?? {};
  const names = new Map();   // cardId -> chosen name

  const track = {
    name(cardId, name) {
      const card = cards[cardId];
      if (!card) return { ok: false, reason: "no_such_card", cardId };
      if (card.type !== CARD_TYPES.ASSISTANT) return { ok: false, reason: "not_assistant", cardId };
      if (card.unnamed !== true) return { ok: false, reason: "not_unnamed", cardId };
      if (typeof name !== "string" || !name.trim()) return { ok: false, reason: "invalid_name", cardId };
      names.set(cardId, name.trim());
      return { ok: true, cardId, name: name.trim() };
    },
    nameOf(cardId) {
      return names.get(cardId) ?? null;
    },
    isNamed(cardId) {
      return names.has(cardId);
    },
    named() {
      return [...names.entries()].map(([cardId, name]) => ({ cardId, name }));
    },

    toJSON() {
      return { kind: "assistants", names: track.named() };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("assistants: bad fromJSON payload");
      names.clear();
      for (const n of data.names ?? []) names.set(n.cardId, n.name);
      return track;
    },
  };
  return track;
}
