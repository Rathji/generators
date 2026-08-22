// src/objectives.js — objective cards & scoring (Phase 4 scaffold, full
// contract Tasks 29-30). `config.objectives` lists the objective card ids
// revealed at game start (3 by the printed rules). Each objective can be
// COMPLETED once per game (a player fulfils its condition, Task 29) and can
// then be SCORED by each player once (a static influence placement on the
// card, 5 VP, +1 progress — resolved by the Grandstand building, Task 18,
// and generally by Task 30). Scoring state is per player per card.
// Cards' condition predicates live in src/cards.js (Task 29 evaluates them).

export function createObjectives(config = {}) {
  const objectiveIds = [...(config.objectives ?? [])];
  const players = [...(config.players ?? [])];
  const completed = new Map();   // cardId -> playerId who completed it
  const scored = new Map();      // playerId -> Set<cardId>

  const track = {
    objectives() {
      return objectiveIds.map(id => ({ cardId: id, completedBy: completed.get(id) ?? null }));
    },
    revealedIds() {
      return [...objectiveIds];
    },
    isRevealed(cardId) {
      return objectiveIds.includes(cardId);
    },
    isCompleted(cardId) {
      return completed.has(cardId);
    },
    completedBy(cardId) {
      return completed.get(cardId) ?? null;
    },
    markCompleted(cardId, playerId) {
      if (!objectiveIds.includes(cardId)) return { ok: false, reason: "no_such_objective", cardId };
      if (completed.has(cardId)) return { ok: false, reason: "already_completed", cardId };
      completed.set(cardId, playerId);
      return { ok: true, cardId, playerId };
    },

    hasScored(cardId, playerId) {
      return (scored.get(playerId) ?? new Set()).has(cardId);
    },
    scoredCount(playerId) {
      return (scored.get(playerId) ?? new Set()).size;
    },
    canScore(cardId, playerId) {
      if (!objectiveIds.includes(cardId)) return { ok: false, reason: "no_such_objective", cardId };
      if (!completed.has(cardId)) return { ok: false, reason: "objective_not_completed", cardId };
      if (track.hasScored(cardId, playerId)) return { ok: false, reason: "already_scored", cardId, playerId };
      return { ok: true, cardId, playerId };
    },
    score(cardId, playerId) {
      const res = track.canScore(cardId, playerId);
      if (!res.ok) return res;
      let s = scored.get(playerId);
      if (!s) {
        s = new Set();
        scored.set(playerId, s);
      }
      s.add(cardId);
      return { ok: true, cardId, playerId, count: s.size };
    },

    toJSON() {
      const scoredData = {};
      for (const [pid, set] of scored.entries()) scoredData[pid] = [...set];
      return {
        kind: "objectives",
        objectives: objectiveIds.map(id => ({ cardId: id, completedBy: completed.get(id) ?? null })),
        scored: scoredData,
      };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("objectives: bad fromJSON payload");
      completed.clear();
      for (const o of data.objectives ?? []) {
        if (o.completedBy != null) completed.set(o.cardId, o.completedBy);
      }
      scored.clear();
      for (const [pid, list] of Object.entries(data.scored ?? {})) scored.set(pid, new Set(list));
      return track;
    },
  };
  return track;
}
