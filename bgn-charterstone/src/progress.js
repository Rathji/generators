// src/progress.js — progress-track model (Task 5).
// The progress token is each game's timer: it starts on the space matching the
// player count and advances 1 per construction, crate unlock, objective score,
// or forced 0-influence turn start. Landing on a reputation space grants 1
// reputation; landing on an income space triggers income for all — but income
// stays locked (ignored) until the campaign unlocks it. The final space ends
// the game (round-finishing is the engine's job, Task 32). The default track
// layout is provisional; Phase 9 content data replaces it.

export const TRACK_REASONS = Object.freeze({
  CONSTRUCT: "construct",
  CRATE: "crate",
  OBJECTIVE: "objective",
  NO_INFLUENCE: "noInfluence",
});

export const TRACK_ICONS = Object.freeze({ REPUTATION: "reputation", INCOME: "income", END: "end" });

const DEFAULT_SPACES = [
  null, null, null, null, null, "reputation", null, null, null, "income",
  null, "reputation", null, null, null, "income", null, "reputation", null, null,
];

export function createProgressTrack(config = {}) {
  const rawSpaces = config.spaces ?? DEFAULT_SPACES;
  if (!Array.isArray(rawSpaces) || rawSpaces.length < 2) {
    throw new Error("progress: track must be an array of at least 2 spaces");
  }
  const spaces = rawSpaces.map(s => (s && typeof s === "object" ? { icon: s.icon ?? null } : { icon: s ?? null }));
  spaces[spaces.length - 1].icon = TRACK_ICONS.END;
  for (const sp of spaces) {
    if (sp.icon !== null && sp.icon !== TRACK_ICONS.REPUTATION && sp.icon !== TRACK_ICONS.INCOME && sp.icon !== TRACK_ICONS.END) {
      throw new Error("progress: unknown space icon '" + sp.icon + "'");
    }
  }

  const length = spaces.length;
  const startSpace = config.startSpace ?? config.playerCount ?? 2;
  if (!Number.isInteger(startSpace) || startSpace < 1 || startSpace > length) {
    throw new Error("progress: start space must be an integer within the track");
  }
  let position = startSpace;
  let incomeEnabled = !!config.incomeEnabled;
  const history = [];

  const track = {
    length,
    startSpace,
    get position() {
      return position;
    },

    spaces() {
      return spaces.map(s => ({ icon: s.icon }));
    },
    spaceAt(n) {
      const s = spaces[n - 1];
      return s ? { icon: s.icon } : null;
    },
    endReached() {
      return position === length;
    },
    isIncomeEnabled() {
      return incomeEnabled;
    },
    setIncomeEnabled(enabled) {
      incomeEnabled = !!enabled;
      return incomeEnabled;
    },

    advance(reason) {
      if (reason !== TRACK_REASONS.CONSTRUCT && reason !== TRACK_REASONS.CRATE &&
          reason !== TRACK_REASONS.OBJECTIVE && reason !== TRACK_REASONS.NO_INFLUENCE) {
        return { ok: false, reason: "illegal_reason", trigger: reason };
      }
      if (track.endReached()) {
        return { ok: false, reason: "track_already_ended" };
      }
      const from = position;
      position += 1;
      const landed = spaces[position - 1];
      const icon = landed.icon === TRACK_ICONS.END ? null : landed.icon;
      const endReached = track.endReached();
      history.push({ reason, from, to: position, endReached });
      return {
        ok: true,
        trigger: reason,
        from,
        position,
        icon,
        endReached,
        reputationGained: landed.icon === TRACK_ICONS.REPUTATION,
        incomeTriggered: landed.icon === TRACK_ICONS.INCOME && incomeEnabled,
        incomeIgnored: landed.icon === TRACK_ICONS.INCOME && !incomeEnabled,
      };
    },

    history() {
      return history.map(h => ({ ...h }));
    },

    toJSON() {
      return {
        kind: "progress",
        length,
        startSpace,
        spaces: spaces.map(s => s.icon),
        position,
        incomeEnabled,
        history: track.history(),
      };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("progress: bad fromJSON payload");
      position = data.position;
      incomeEnabled = !!data.incomeEnabled;
      history.length = 0;
      for (const h of data.history ?? []) history.push({ ...h });
      return track;
    },
  };
  return track;
}
