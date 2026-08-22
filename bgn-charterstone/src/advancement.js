// src/advancement.js — advancement mat (Phase 4 scaffold, full contract Task 25).
// The mat shows `matSize` face-up advancement cards. Gaining a face-up card
// removes it and refills that slot from the deck (seeding the deck from the
// reshuffled discard pile when it is empty). The gained card goes to the
// player's hand — it does NOT enter the discard. Cards removed from the game
// (spent/archived) never re-enter. Task 25 adds deck-emptied re-seed edge
// cases; this module already implements the seed-from-discard behaviour.

export const ADVANCEMENT_MAT_SIZE = 5;

export function createAdvancement(config = {}) {
  const matSize = config.matSize ?? ADVANCEMENT_MAT_SIZE;
  if (!Number.isInteger(matSize) || matSize < 1) {
    throw new Error("advancement: matSize must be a positive integer");
  }
  const deck = [...(config.deck ?? [])];
  const discard = [];
  const rng = config.rng ?? Math.random;
  const mat = new Array(matSize).fill(null);
  const archive = config.archive ?? null;

  // Task 36: archived components can never re-enter the game — they are
  // excluded from deck re-seeds, mat refills, gains, and deck additions.
  function excluded(cardId) {
    return archive ? archive.has(cardId) : false;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function seedFromDiscard() {
    if (deck.length > 0 || discard.length === 0) return;
    deck.push(...shuffle(discard.splice(0)).filter(id => !excluded(id)));
  }
  function seedMat() {
    for (let i = 0; i < matSize; i++) {
      if (mat[i] !== null) continue;
      while (deck.length > 0) {
        const id = deck.shift();
        if (!excluded(id)) {
          mat[i] = id;
          break;
        }
      }
    }
  }
  seedMat();

  const adv = {
    matSize,

    mat() {
      return [...mat];
    },
    onMat(cardId) {
      return mat.includes(cardId);
    },
    slotOf(cardId) {
      return mat.indexOf(cardId);
    },
    deckCount() {
      return deck.length;
    },
    discardCount() {
      return discard.length;
    },

    gainCard(playerId, matCardId) {
      const slot = mat.indexOf(matCardId);
      if (slot === -1) return { ok: false, reason: "no_such_mat_card", cardId: matCardId };
      if (excluded(matCardId)) return { ok: false, reason: "archived", cardId: matCardId };
      mat[slot] = null;
      seedFromDiscard();
      let replacedFrom = null;
      while (deck.length > 0) {
        const id = deck.shift();
        if (!excluded(id)) {
          replacedFrom = id;
          break;
        }
      }
      mat[slot] = replacedFrom;
      return { ok: true, cardId: matCardId, replacedFrom, playerId };
    },
    addToDeck(cardIds) {
      for (const id of cardIds) {
        if (!excluded(id)) deck.push(id);
      }
      return deck.length;
    },
    discard(cardId) {
      discard.push(cardId);
      return discard.length;
    },
    seedIfEmpty() {
      seedFromDiscard();
      seedMat();
      return deck.length;
    },

    toJSON() {
      return { kind: "advancement", matSize, deck: [...deck], discard: [...discard], mat: [...mat] };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("advancement: bad fromJSON payload");
      deck.length = 0;
      deck.push(...(data.deck ?? []).filter(id => !excluded(id)));
      discard.length = 0;
      discard.push(...(data.discard ?? []).filter(id => !excluded(id)));
      mat.fill(null);
      for (let i = 0; i < Math.min(matSize, (data.mat ?? []).length); i++) {
        mat[i] = excluded(data.mat[i]) ? null : data.mat[i];
      }
      return adv;
    },
  };
  return adv;
}
