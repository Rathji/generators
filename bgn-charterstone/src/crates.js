// src/crates.js — crate-unlock registry (Phase 4 scaffold, full contract
// Task 34). A crate lives on a constructed building card that shows a crate
// number. Unlocking one (Charterstone building, Task 20) records
// `{playerId, crateNumber}` for that card; the card stays in the player's
// personal supply (Task 21). Crate CONTENTS (the Index Guide component list)
// are added by Task 34 — this module tracks only the unlock state.

export function createCrates(config = {}) {
  const unlocked = new Map();   // cardId -> {playerId, crateNumber}

  const track = {
    unlocked() {
      return [...unlocked.entries()].map(([cardId, u]) => ({ cardId, playerId: u.playerId, crateNumber: u.crateNumber }));
    },
    count() {
      return unlocked.size;
    },
    isUnlocked(cardId) {
      return unlocked.has(cardId);
    },
    crateOf(cardId) {
      const u = unlocked.get(cardId);
      return u ? u.crateNumber : null;
    },
    unlock(playerId, cardId, crateNumber) {
      if (!Number.isInteger(crateNumber) || crateNumber < 1) {
        return { ok: false, reason: "no_crate", cardId };
      }
      if (unlocked.has(cardId)) return { ok: false, reason: "already_unlocked", cardId };
      unlocked.set(cardId, { playerId, crateNumber });
      return { ok: true, cardId, crateNumber, playerId };
    },

    toJSON() {
      return { kind: "crates", crates: track.unlocked() };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("crates: bad fromJSON payload");
      unlocked.clear();
      for (const c of data.crates ?? []) {
        unlocked.set(c.cardId, { playerId: c.playerId, crateNumber: c.crateNumber });
      }
      return track;
    },
  };
  return track;
}
