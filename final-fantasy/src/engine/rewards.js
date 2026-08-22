// Task #33: Combat Reward Resolver — post-battle XP + gold calculation and
// distribution to the party, plus loot-table rolls.

export class CombatRewardResolver {
  constructor(opts = {}) {
    this.party = opts.party ?? null;
    this.inventory = opts.inventory ?? null;
    this.enemySystem = opts.enemySystem ?? null;
    this.rng = opts.random ?? Math.random;
    this.xpBonus = opts.xpBonus ?? 1;
    this.goldBonus = opts.goldBonus ?? 1;
    this.balance = opts.balance ?? null;
    // Task #132: optional item-find bonus — fn(enemy) => extra loot chance
    // (wired to the Thief class passive for the party).
    this.itemFind = opts.itemFind ?? null;
  }

  totals(enemies) {
    let xp = 0;
    let gold = 0;
    for (const e of enemies) {
      xp += e.xp ?? 0;
      gold += e.gold ?? 0;
    }
    const xpMult = this.balance ? this.balance.xpMultiplier : 1;
    const goldMult = this.balance ? this.balance.goldMultiplier : 1;
    return {
      xp: Math.round(xp * this.xpBonus * xpMult),
      gold: Math.round(gold * this.goldBonus * goldMult),
    };
  }

  // Roll every enemy's loot table. Returns item ids (may contain dupes).
  rollLoot(enemies) {
    const loot = [];
    for (const e of enemies) {
      if (this.enemySystem) {
        loot.push(...this.enemySystem.lootFor(e, this.rng));
      } else if (Array.isArray(e.loot)) {
        for (const entry of e.loot) {
          if (this.rng() < entry.chance) loot.push(entry.itemId);
        }
      }
      // Task #132: a party with the Thief's Treasure Hunter passive re-rolls
      // the enemy's table for a bonus drop.
      if (this.itemFind && this.rng() < this.itemFind(e)) {
        if (this.enemySystem) loot.push(...this.enemySystem.lootFor(e, this.rng));
        else if (Array.isArray(e.loot)) {
          for (const entry of e.loot) if (this.rng() < entry.chance) loot.push(entry.itemId);
        }
      }
    }
    return loot;
  }

  // Compute and apply all rewards. `loot` goes into the inventory when
  // capacity allows; overflow is reported in `overflow`.
  resolve(enemies, opts = {}) {
    const totals = this.totals(enemies);
    const levelUps = this.party ? this.party.grantXp(totals.xp) : [];
    const gold = this.party ? this.party.addGold(totals.gold) : totals.gold;
    const rolled = this.rollLoot(enemies);
    const added = [];
    const overflow = [];
    if (this.inventory) {
      for (const id of rolled) {
        if (this.inventory.add(id, 1)) added.push(id);
        else overflow.push(id);
      }
    } else {
      added.push(...rolled);
    }
    return {
      xp: totals.xp,
      gold: totals.gold,
      goldNow: gold,
      loot: added,
      overflow,
      levelUps,
    };
  }

  summarize(result) {
    return (
      "+" + result.xp + " XP" +
      (result.gold ? ", +" + result.gold + " gold" : "") +
      (result.loot.length ? ", found: " + result.loot.join(", ") : "") +
      (result.levelUps.length ? " (" + result.levelUps.map((u) => u.member.name + " -> Lv" + u.level).join(", ") + ")" : "")
    );
  }
}
