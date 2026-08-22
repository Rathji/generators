// Task #164: Trial of the Keeper — the arena gauntlet engine. Tracks trial
// clears, tokens, sequential unlock, scaled boss encounters, and the vault
// exchange (Task #165). Cleared trials set `trial_<id>_cleared`; Keeper
// Tokens live in the numeric `keeper_tokens` flag; vault purchases are
// one-time per reward via `trial_reward_bought_<rewardId>`.

import { ENEMIES } from "../data/enemies.js";

export class TrialSystem {
  constructor(defs = [], opts = {}) {
    this.trials = defs;
    this.rewards = opts.rewards ?? [];
    this.state = opts.state ?? null;
    this.party = opts.party ?? null;
    this.inventory = opts.inventory ?? null;
    this.enemies = opts.enemySystem ?? null;
  }

  all() {
    return [...this.trials].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  trial(id) {
    return this.trials.find((t) => t.id === id) ?? null;
  }

  clearedFlag(id) {
    return "trial_" + id + "_cleared";
  }

  isCleared(id) {
    return !!this.state?.getFlag(this.clearedFlag(id));
  }

  clearedCount() {
    return this.all().filter((t) => this.isCleared(t.id)).length;
  }

  // Sequential gauntlet: a base trial unlocks once its story foe is defeated
  // AND the trial before it is cleared. The Apex unlocks only when every
  // base trial has fallen.
  isUnlocked(t) {
    if (t.apex) return this.clearedCount() >= this.all().length - 1;
    if (t.unlockFlag && !this.state?.getFlag(t.unlockFlag)) return false;
    if (t.order > 1) {
      const prev = this.all().find((x) => x.order === t.order - 1);
      if (!prev || !this.isCleared(prev.id)) return false;
    }
    return true;
  }

  // The next trial to face, or null when the gauntlet is complete.
  currentTrial() {
    return this.all().find((t) => !this.isCleared(t.id) && this.isUnlocked(t)) ?? null;
  }

  allBaseCleared() {
    return this.all().filter((t) => !t.apex).every((t) => this.isCleared(t.id));
  }

  // Validate + begin a trial. Returns the battle action the caller should
  // hand to the boss-battle flow.
  startTrial(id) {
    const t = this.trial(id);
    if (!t) return { ok: false, error: "unknown trial" };
    if (this.isCleared(id)) return { ok: false, error: "already cleared", id };
    if (!this.isUnlocked(t)) return { ok: false, error: "locked", id };
    return {
      ok: true,
      id,
      trial: t,
      battle: {
        type: "bossBattle",
        group: "trial_" + id,
        bossId: t.bossId,
        scale: t.scale,
        intro: t.intro,
        onWinFlag: this.clearedFlag(id),
      },
    };
  }

  // A fresh, scaled echo of the trial's boss — hp/str/atk/int/agi/def/mdef/xp
  // and gold multiplied by the trial scale, with the Apex's unique hoard.
  scaledBoss(trial) {
    const es = this.enemies;
    const base = es ? es.template(trial.bossId) : ENEMIES[trial.bossId];
    const e = es ? es.createEnemy(trial.bossId) : { ...base };
    const s = trial.scale ?? 1;
    for (const stat of ["hp", "maxHp", "mp", "maxMp", "str", "atk", "int", "agi", "def", "mdef", "xp", "gold"]) {
      if (typeof e[stat] === "number") e[stat] = Math.round(e[stat] * s);
    }
    if (trial.bossName) e.name = trial.bossName;
    if (Array.isArray(trial.loot)) e.loot = trial.loot.map((l) => ({ ...l }));
    return e;
  }

  // Build the encounter object for a trial (what the battle flow consumes).
  buildEncounter(id) {
    const t = this.trial(id);
    if (!t) return null;
    return { groupId: "trial_" + id, enemies: [this.scaledBoss(t)], trial: t };
  }

  // Record a win: set the cleared flag and hand out Keeper Tokens.
  recordWin(id) {
    const t = this.trial(id);
    if (!t) return { ok: false, error: "unknown trial" };
    this.state?.setFlag(this.clearedFlag(id), true);
    this.state?.setFlag("any_trial_cleared", true);
    const gain = t.tokens ?? 0;
    this.state?.setFlag("keeper_tokens", this.tokens() + gain);
    return { ok: true, id, tokens: gain, balance: this.tokens() };
  }

  tokens() {
    return this.state?.flags?.keeper_tokens ?? 0;
  }

  isRewardBought(rewardId) {
    return !!this.state?.getFlag("trial_reward_bought_" + rewardId);
  }

  listRewards() {
    return this.rewards.map((r) => ({ ...r, bought: this.isRewardBought(r.id) }));
  }

  // One-time vault exchange of tokens for a reward item.
  purchase(rewardId) {
    const r = this.rewards.find((x) => x.id === rewardId);
    if (!r) return { ok: false, error: "unknown reward" };
    if (this.isRewardBought(rewardId)) return { ok: false, error: "already bought" };
    if (this.tokens() < r.cost) {
      return { ok: false, error: "not enough tokens", balance: this.tokens(), cost: r.cost };
    }
    if (!this.inventory?.add) return { ok: false, error: "no inventory" };
    if (!this.inventory.add(r.item, r.count ?? 1)) {
      return { ok: false, error: "inventory full" };
    }
    this.state?.setFlag("trial_reward_bought_" + rewardId, true);
    this.state?.setFlag("keeper_tokens", this.tokens() - r.cost);
    return { ok: true, item: r.item, count: r.count ?? 1, cost: r.cost, balance: this.tokens() };
  }

  // Per-trial status: unlocked/cleared/scale/boss, in gauntlet order.
  statusReport() {
    return this.all().map((t) => ({
      id: t.id,
      name: t.name,
      order: t.order,
      bossId: t.bossId,
      scale: t.scale,
      apex: !!t.apex,
      unlocked: this.isUnlocked(t),
      cleared: this.isCleared(t.id),
      tokens: t.tokens,
    }));
  }
}
