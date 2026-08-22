// Task #117: Monster Reward Table System — lookups and summaries over the
// global monster XP/gold value table, plus an audit that every enemy has a
// sane reward and bosses out-value regular monsters.

import { MONSTER_REWARDS, REWARD_TOTALS } from "../data/monster-rewards.js";
import { ENEMIES } from "../data/enemies.js";

export class MonsterRewardTable {
  constructor(rewards = MONSTER_REWARDS) {
    this.rewards = rewards;
  }

  entry(id) {
    return this.rewards.find((r) => r.id === id) ?? null;
  }

  all() {
    return [...this.rewards];
  }

  monsters() {
    return this.rewards.length;
  }

  totals() {
    return this.rewards.reduce(
      (acc, r) => ({ xp: acc.xp + r.xp, gold: acc.gold + r.gold }),
      { xp: 0, gold: 0 }
    );
  }

  describe(id) {
    const r = this.entry(id);
    if (!r) return null;
    return r.name + " — " + r.xp + " XP, " + r.gold + " gold" + (r.boss ? " [boss]" : "");
  }

  // Difficulty bands: average rewards of regular vs boss-tier monsters.
  summary() {
    const regular = this.rewards.filter((r) => !r.boss);
    const bosses = this.rewards.filter((r) => r.boss);
    const avg = (list, key) => (list.length ? list.reduce((s, r) => s + r[key], 0) / list.length : 0);
    return {
      total: this.rewards.length,
      regular: regular.length,
      bosses: bosses.length,
      avgXp: avg(regular, "xp"),
      avgGold: avg(regular, "gold"),
      avgBossXp: avg(bosses, "xp"),
      avgBossGold: avg(bosses, "gold"),
      totals: this.totals(),
    };
  }

  audit() {
    const errors = [];
    const seen = new Set();
    for (const r of this.rewards) {
      if (seen.has(r.id)) errors.push({ enemy: r.id, error: "duplicate entry" });
      seen.add(r.id);
      if (!Number.isInteger(r.xp) || r.xp < 0) errors.push({ enemy: r.id, error: "invalid xp: " + r.xp });
      if (!Number.isInteger(r.gold) || r.gold < 0) errors.push({ enemy: r.id, error: "invalid gold: " + r.gold });
      if (!ENEMIES[r.id]) errors.push({ enemy: r.id, error: "no matching enemy template" });
    }
    for (const id of Object.keys(ENEMIES)) {
      if (!seen.has(id)) errors.push({ enemy: id, error: "missing from reward table" });
    }
    const s = this.summary();
    const weakRegular = this.rewards.filter((r) => !r.boss && r.xp < 1);
    for (const r of weakRegular) errors.push({ enemy: r.id, error: "regular monster grants no xp" });
    const weakBoss = this.rewards.filter((r) => r.boss && r.xp < 40);
    for (const r of weakBoss) errors.push({ enemy: r.id, error: "boss grants too little xp: " + r.xp });
    if (s.bosses && s.regular && s.avgBossXp <= s.avgXp) {
      errors.push({ error: "bosses do not out-value regular monsters on average" });
    }
    return { ok: errors.length === 0, errors, summary: s };
  }
}

export { REWARD_TOTALS };
