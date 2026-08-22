// Task #117: Monster XP/Gold Value Table — a consolidated global reward
// table for every monster in ENEMIES, so rewards are auditable as one data
// set and the UI can display "what does this monster give?"

import { ENEMIES } from "./enemies.js";

export const MONSTER_REWARDS = Object.entries(ENEMIES)
  .map(([id, e]) => ({
    id,
    name: e.name,
    xp: e.xp ?? 0,
    gold: e.gold ?? 0,
    boss: e.boss ?? false,
  }))
  .sort((a, b) => a.xp - b.xp || a.gold - b.gold);

export const REWARD_TOTALS = MONSTER_REWARDS.reduce(
  (acc, r) => ({ xp: acc.xp + r.xp, gold: acc.gold + r.gold }),
  { xp: 0, gold: 0 }
);
