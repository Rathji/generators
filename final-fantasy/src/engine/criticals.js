// Task #62: Critical Hit Logic — probability-based damage multiplier driven
// by the attacker's agility (quick fighters land more criticals) plus any
// crit bonus from the equipped weapon.

import { ITEMS } from "../data/items.js";

export const CRIT_MULTIPLIER = 2;
export const CRIT_CAP = 0.5;

export class CriticalHitSystem {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.multiplier = opts.multiplier ?? CRIT_MULTIPLIER;
    this.items = opts.items ?? ITEMS;
  }

  statsOf(c) {
    return typeof c.getStats === "function" ? c.getStats() : c;
  }

  // Crit chance bonus from the equipped weapon's `crit` mod.
  weaponBonus(attacker) {
    const weapon = attacker?.equipment?.weapon;
    if (!weapon) return 0;
    const item = this.items[weapon];
    return item?.mods?.crit ?? 0;
  }

  // Base critical chance: small level factor + agility contribution + weapon.
  critChance(attacker) {
    const stats = this.statsOf(attacker);
    const agi = stats.agi ?? 0;
    const lvl = Math.max(1, attacker?.level ?? 1);
    const levelFactor = Math.min(0.1, lvl / 64);
    const chance = levelFactor + agi * 0.002 + this.weaponBonus(attacker);
    return Math.min(CRIT_CAP, Math.max(0, chance));
  }

  // Roll a critical for a given attacker/target pair.
  roll(attacker, target, opts = {}) {
    const chance = opts.chance ?? this.critChance(attacker);
    const critical = this.rng() < chance;
    return {
      critical,
      chance,
      multiplier: critical ? (opts.multiplier ?? this.multiplier) : 1,
    };
  }

  // Apply the roll to a base damage figure (before defense/armor mitigation).
  apply(baseDamage, attacker, target, opts = {}) {
    const roll = this.roll(attacker, target, opts);
    return {
      ...roll,
      damage: Math.max(1, Math.round(baseDamage * roll.multiplier)),
    };
  }
}
