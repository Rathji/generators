// src/stickers.js — sticker application (Task 35).
// Rule and content stickers apply permanently to the Chronicle/board and
// mutate the active ruleset for the rest of the campaign. Rule stickers carry
// a `ruleFlag`; applying one flips that flag on the active chronicle
// (src/chronicle.js), which in turn changes `chronicle.enabledActions()` —
// e.g. applying "rule-drop-players" unlocks the "dropPlayer" action. Content
// stickers carry components that later phases unpack into pools. The sticker
// def set below is PROVISIONAL (the printed Chronicle/Index Guide defines the
// exact campaign set — Task 43 transcribes the unlock schedule); the shapes
// and mechanics are final.

export const STICKER_TYPES = Object.freeze({ RULE: "rule", CONTENT: "content" });

export const STICKER_DEFS = {
  "rule-income": {
    id: "rule-income", name: "Income", type: STICKER_TYPES.RULE, ruleFlag: "incomeEnabled",
    desc: "Landing on an income space on the progress track triggers income for all players.",
  },
  "rule-drop-players": {
    id: "rule-drop-players", name: "Drop Players", type: STICKER_TYPES.RULE, ruleFlag: "dropPlayers",
    desc: "Players may be added or dropped between games.",
  },
  "rule-advanced-actions": {
    id: "rule-advanced-actions", name: "Advanced Actions", type: STICKER_TYPES.RULE, ruleFlag: "advancedActions",
    desc: "Unlocks the advanced action set (Task 41 crate content, Index Guide crate 3).",
  },
  "rule-guideposts": {
    id: "rule-guideposts", name: "Guideposts", type: STICKER_TYPES.RULE, ruleFlag: "guideposts",
    desc: "Unlocks guidepost cards (Index Guide crate 6).",
  },
  "rule-minions": {
    id: "rule-minions", name: "Minions", type: STICKER_TYPES.RULE, ruleFlag: "minions",
    desc: "Unlocks minion cards (Index Guide crate 9).",
  },
  "rule-campaign-end": {
    id: "rule-campaign-end", name: "Campaign End", type: STICKER_TYPES.RULE, ruleFlag: "campaignEnd",
    desc: "Unlocks end-of-campaign scoring (Index Guide crate 12).",
  },
  "content-sky-island": {
    id: "content-sky-island", name: "Sky Island", type: STICKER_TYPES.CONTENT,
    desc: "Content sticker: unlocks the Sky Island region (campaign components defined in Phase 9/43).",
  },
  "content-guideposts": {
    id: "content-guideposts", name: "Guideposts", type: STICKER_TYPES.CONTENT,
    desc: "Content sticker: unlocks guidepost cards.",
  },
  "content-perils": {
    id: "content-perils", name: "Perils", type: STICKER_TYPES.CONTENT,
    desc: "Content sticker: unlocks peril cards (bandit, fuel shortage, disrepair, vermin, blight, famine).",
  },
  "content-minions": {
    id: "content-minions", name: "Minions", type: STICKER_TYPES.CONTENT,
    desc: "Content sticker: unlocks minion cards (chef, golem, cat, butler, robot, ghost).",
  },
};

export function createStickerBook(config = {}) {
  const chronicle = config.chronicle ?? null;
  const applied = new Set(config.applied ?? []);

  const book = {
    applied() {
      return [...applied];
    },
    isApplied(id) {
      return applied.has(id);
    },
    count() {
      return applied.size;
    },
    apply(id) {
      const def = STICKER_DEFS[id];
      if (!def) return { ok: false, reason: "no_such_sticker", id };
      if (applied.has(id)) return { ok: false, reason: "already_applied", id };
      applied.add(id);
      if (def.ruleFlag && chronicle && typeof chronicle.setFlag === "function") {
        chronicle.setFlag(def.ruleFlag, true);
      }
      return { ok: true, id, type: def.type, ruleFlag: def.ruleFlag ?? null };
    },

    toJSON() {
      return { kind: "stickerBook", applied: book.applied() };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("stickerBook: bad fromJSON payload");
      applied.clear();
      for (const id of data.applied ?? []) book.apply(id);
      return book;
    },
  };
  return book;
}
