// src/reputation.js — reputation track (Task 8) and end-game scoring (Task 9).
// The track is a row of spaces numbered firstSpace..maxSpace (default 10, the
// printed track). Placing reputation costs 1 influence token (the token is
// placed statically): the first token each game lands on the space showing the
// player count, and further tokens go on the next open space closer to the
// ocean. With no open space, a token cannot be placed. End-game scoring gives
// 10/7/4 VP to the 1st/2nd/3rd-highest token counts; players with 0 tokens do
// not qualify, and ties share their tier.

export const REPUTATION_MAX_SPACE = 10;
export const REPUTATION_AWARDS = Object.freeze([10, 7, 4]);

export function createReputationTrack(config = {}) {
  const playerCount = config.playerCount ?? 2;
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 6) {
    throw new Error("reputation: playerCount must be an integer 1-6");
  }
  const maxSpace = config.maxSpace ?? REPUTATION_MAX_SPACE;
  if (!Number.isInteger(maxSpace) || maxSpace < playerCount) {
    throw new Error("reputation: maxSpace must be an integer >= playerCount");
  }
  const influence = config.influence ?? null;
  const playerIds = [...(config.playerIds ?? [])];
  const placements = [];
  const firstSpace = playerCount;

  const track = {
    playerCount,
    maxSpace,
    firstSpace,
    get length() {
      return maxSpace - firstSpace + 1;
    },
    playerIds() {
      return [...playerIds];
    },

    nextOpenSpace() {
      for (let s = firstSpace; s <= maxSpace; s++) {
        if (!placements.some(p => p.space === s)) return s;
      }
      return null;
    },
    isFull() {
      return track.nextOpenSpace() === null;
    },
    occupied() {
      return placements.map(p => ({ playerId: p.playerId, space: p.space })).sort((a, b) => a.space - b.space);
    },
    tokensOf(playerId) {
      return placements.filter(p => p.playerId === playerId).length;
    },
    counts() {
      const out = {};
      for (const id of playerIds) out[id] = 0;
      for (const p of placements) out[p.playerId] = (out[p.playerId] ?? 0) + 1;
      return out;
    },

    place(playerId) {
      const space = track.nextOpenSpace();
      if (space === null) return { ok: false, reason: "track_full", playerId };
      if (influence) {
        const res = influence.place(playerId, "reputation:" + space);
        if (!res.ok) return res;
      }
      placements.push({ playerId, space });
      return { ok: true, playerId, space, count: track.tokensOf(playerId) };
    },

    toJSON() {
      return {
        kind: "reputation",
        playerCount,
        maxSpace,
        firstSpace,
        playerIds: [...playerIds],
        placements: track.occupied(),
      };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("reputation: bad fromJSON payload");
      placements.length = 0;
      for (const p of data.placements ?? []) placements.push({ playerId: p.playerId, space: p.space });
      return track;
    },
  };
  return track;
}

export function scoreReputation(input) {
  const entries = Array.isArray(input)
    ? input.map(e => ({ playerId: e.playerId, tokens: e.tokens }))
    : Object.entries(input).map(([playerId, tokens]) => ({ playerId, tokens }));
  const qualifying = entries.filter(e => e.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const tierVp = new Map();
  let tier = 0;
  for (const e of qualifying) {
    if (!tierVp.has(e.tokens)) {
      tierVp.set(e.tokens, tier < REPUTATION_AWARDS.length ? REPUTATION_AWARDS[tier] : 0);
      tier++;
    }
  }
  return entries.map(e => ({
    playerId: e.playerId,
    tokens: e.tokens,
    vp: e.tokens > 0 ? (tierVp.get(e.tokens) ?? 0) : 0,
  }));
}
