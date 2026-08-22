// src/influence.js — influence tokens (Task 7).
// Each player has exactly 12 influence tokens per game (LIMITED). Placing a
// token on a card/track/space is STATIC: it cannot be moved or removed until
// game end. Paying influence as a cost DISCARDS the token to the general
// supply, from which influence-granting buildings/cards REGAIN spent tokens.
// Token conservation: total = inHand + placed + supply (spent tokens are in
// the general supply). Per-player `spent` is a lifetime counter (how many the
// player has discarded), kept for reporting; supply is derived from what is
// not in any hand or on any placement.

export const TOKENS_PER_PLAYER = 12;

export function createInfluencePool(config = {}) {
  const tokensPerPlayer = config.tokensPerPlayer ?? TOKENS_PER_PLAYER;
  if (!Number.isInteger(tokensPerPlayer) || tokensPerPlayer < 1) {
    throw new Error("influence: tokensPerPlayer must be a positive integer");
  }
  const ids = config.playerIds ?? [];
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || !id) throw new Error("influence: player id required");
    if (seen.has(id)) throw new Error("influence: duplicate player ids");
    seen.add(id);
  }
  const players = new Map();
  for (const id of ids) players.set(id, { available: tokensPerPlayer, spent: 0, placed: new Map() });
  const totalTokens = tokensPerPlayer * players.size;

  function storeOf(id) {
    const s = players.get(id);
    if (!s) throw new Error("influence: unknown player '" + id + "'");
    return s;
  }
  function placedTotalOf(store) {
    let t = 0;
    for (const n of store.placed.values()) t += n;
    return t;
  }

  const pool = {
    tokensPerPlayer,
    playerIds() {
      return [...players.keys()];
    },
    hasPlayer(id) {
      return players.has(id);
    },
    availableOf(id) {
      return storeOf(id).available;
    },
    spentCount(id) {
      return storeOf(id).spent;
    },
    placedTotal(id) {
      return placedTotalOf(storeOf(id));
    },
    placedOn(id, target) {
      return storeOf(id).placed.get(target) ?? 0;
    },
    placements(id) {
      const out = [];
      for (const [target, count] of storeOf(id).placed.entries()) out.push({ target, count });
      return out;
    },
    supply() {
      let inUse = 0;
      for (const s of players.values()) inUse += s.available + placedTotalOf(s);
      return totalTokens - inUse;
    },
    totals() {
      let inHand = 0;
      let placed = 0;
      for (const s of players.values()) {
        inHand += s.available;
        placed += placedTotalOf(s);
      }
      return { total: totalTokens, inHand, placed, supply: totalTokens - inHand - placed };
    },

    place(id, target) {
      const s = storeOf(id);
      if (typeof target !== "string" || !target) throw new Error("influence: target must be a non-empty string");
      if (s.available < 1) return { ok: false, reason: "no_influence", target };
      s.available -= 1;
      s.placed.set(target, (s.placed.get(target) ?? 0) + 1);
      return { ok: true, target, available: s.available };
    },
    spend(id, n = 1) {
      if (!Number.isInteger(n) || n < 0) throw new Error("influence: n must be a non-negative integer");
      const s = storeOf(id);
      if (n > s.available) return { ok: false, reason: "insufficient", missing: n - s.available };
      s.available -= n;
      s.spent += n;
      return { ok: true, n, available: s.available };
    },
    gain(id, n = 1) {
      if (!Number.isInteger(n) || n < 0) throw new Error("influence: n must be a non-negative integer");
      const s = storeOf(id);
      const room = tokensPerPlayer - s.available;
      const granted = Math.min(n, room, pool.supply());
      s.available += granted;
      return { ok: true, granted, shortfall: n - granted, hasShortfall: n - granted > 0 };
    },

    toJSON() {
      const playersData = {};
      for (const [id, s] of players.entries()) {
        const placed = {};
        for (const [t, c] of s.placed.entries()) placed[t] = c;
        playersData[id] = { available: s.available, spent: s.spent, placed };
      }
      return { kind: "influence", tokensPerPlayer, players: playersData };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("influence: bad fromJSON payload");
      for (const [id, s] of Object.entries(data.players ?? {})) {
        const store = players.get(id);
        if (!store) throw new Error("influence: saved state references unknown player '" + id + "'");
        store.available = s.available;
        store.spent = s.spent;
        store.placed.clear();
        for (const [t, c] of Object.entries(s.placed ?? {})) store.placed.set(t, c);
      }
      return pool;
    },
  };
  return pool;
}
