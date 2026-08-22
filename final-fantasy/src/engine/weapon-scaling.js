// Task #69: Weapon Damage Scaling — weapon types plug into the physical
// damage formula: (STR × type multiplier) + weapon base power.

import { ITEMS } from "../data/items.js";

// Per-weapon-type STR scaling: how much of the wielder's STR contributes,
// plus a fallback base power. `powerStat: "int"` lets staffs scale off INT.
export const WEAPON_TYPE_MODS = {
  dagger: { str: 0.8, power: 3, crit: 0.04 },
  sword: { str: 1.0, power: 8, crit: 0.02 },
  knuckles: { str: 1.2, power: 5, crit: 0.06 },
  staff: { str: 0.7, power: 2, powerStat: "int" },
  bow: { str: 0.9, power: 6, crit: 0.05 },
  unarmed: { str: 0.9, power: 1, crit: 0.01 },
};

function weaponType(item) {
  if (!item || item.type !== "weapon") return "unarmed";
  const name = (item.name ?? "").toLowerCase();
  if (name.includes("dagger") || name.includes("knife")) return "dagger";
  if (name.includes("knuckles")) return "knuckles";
  if (name.includes("staff") || name.includes("rod") || name.includes("wand")) return "staff";
  if (name.includes("bow") || name.includes("arrow")) return "bow";
  return "sword";
}

export class WeaponScalingSystem {
  constructor(opts = {}) {
    this.itemDb = opts.itemDb ?? ITEMS;
    this.mods = opts.mods ?? WEAPON_TYPE_MODS;
  }

  weapon(character) {
    return this.itemDb[character?.equipment?.weapon] ?? null;
  }

  type(character) {
    return weaponType(this.weapon(character));
  }

  typeMod(character) {
    return this.mods[this.type(character)] ?? this.mods.unarmed;
  }

  // Base weapon power from the weapon's own atk mod, else the type fallback.
  power(character) {
    const w = this.weapon(character);
    if (w?.mods?.atk) return w.mods.atk;
    return this.typeMod(character).power ?? 0;
  }

  // Effective attack for the physical formula. Weaponless combatants
  // (and enemies) use their raw STR + ATK so nothing changes for them.
  effectiveAttack(character) {
    const stats = typeof character?.getStats === "function" ? character.getStats() : character;
    if (!character?.equipment?.weapon) return (stats.str ?? 0) + (stats.atk ?? 0);
    const mod = this.typeMod(character);
    const powerStat = mod.powerStat === "int" ? stats.int : stats.str;
    return Math.floor(powerStat * (mod.str ?? 1)) + (stats.atk ?? 0);
  }

  // Full physical formula: attack power vs defender DEF.
  formula(attacker, defender) {
    const atk = this.effectiveAttack(attacker);
    const dStats = typeof defender?.getStats === "function" ? defender.getStats() : defender;
    const def = dStats?.def ?? 0;
    return { atk, def, base: Math.max(1, atk - def), type: this.type(attacker) };
  }

  // Crit bonus from the weapon type (used by CriticalHitSystem).
  critBonus(character) {
    return this.typeMod(character).crit ?? 0;
  }
}
