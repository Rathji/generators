// Task #70: Armor Defense Mitigation — armor reduces incoming physical
// damage: flat DEF reduction first, then a chance for the armor's block
// percentage to halve the remainder.

import { ITEMS } from "../data/items.js";

export class ArmorMitigationSystem {
  constructor(opts = {}) {
    this.itemDb = opts.itemDb ?? ITEMS;
    this.softCap = opts.softCap ?? 0.75;
  }

  armor(character) {
    return this.itemDb[character?.equipment?.armor] ?? null;
  }

  // Effective DEF (base + armor mods, via getStats).
  defense(defender) {
    const stats = typeof defender?.getStats === "function" ? defender.getStats() : defender;
    return stats?.def ?? 0;
  }

  // Flat reduction from DEF — the classic FF formula (base − DEF).
  flatReduction(defender) {
    return Math.floor(this.defense(defender));
  }

  // Block percentage from the equipped armor (mods.block overrides the
  // derived value; heavier armor blocks more up to a soft cap).
  blockPct(defender) {
    const a = this.armor(defender);
    if (!a) return 0;
    if (typeof a.mods?.block === "number") return Math.min(1, Math.max(0, a.mods.block));
    return Math.min(this.softCap, (a.mods?.def ?? 0) * 0.01);
  }

  // Full mitigation pipeline: flat reduction, then a block roll that halves.
  apply(baseDamage, defender, rng = Math.random) {
    const flat = this.flatReduction(defender);
    let damage = Math.max(1, baseDamage - flat);
    const blockPct = this.blockPct(defender);
    const blocked = blockPct > 0 && rng() < blockPct;
    if (blocked) damage = Math.max(1, Math.round(damage * 0.5));
    return { damage, def: flat, flat, blocked, blockPct };
  }

  // Block roll only (no flat step) for damage already reduced by DEF.
  applyBlock(baseDamage, defender, rng = Math.random) {
    const blockPct = this.blockPct(defender);
    const blocked = blockPct > 0 && rng() < blockPct;
    const damage = blocked ? Math.max(1, Math.round(baseDamage * 0.5)) : Math.max(1, Math.round(baseDamage));
    return { damage, blocked, blockPct };
  }
}
