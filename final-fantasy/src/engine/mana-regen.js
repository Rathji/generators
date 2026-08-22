// Task #68: Mana Regeneration Logic — MP recovery rules: in-combat regen for
// casters, item-based recovery (ethers), and inn-based full recovery.

import { CLASSES } from "../data/classes.js";
import { ITEMS } from "../data/items.js";

export class ManaRegenSystem {
  constructor(opts = {}) {
    this.itemAmounts = opts.itemAmounts ?? { ether: 10, hiEther: 30 };
  }

  // MP restored per combat round, scaled by how magical the class is
  // (non-casters regen nothing).
  regenRate(character) {
    if (!character) return 0;
    const cls = character.class ?? (character.classId ? CLASSES[character.classId] : null);
    if (!cls || !cls.mpPerLevel) return 0;
    return 1 + Math.floor(cls.mpPerLevel / 3);
  }

  regen(character) {
    const rate = this.regenRate(character);
    if (rate <= 0) return { ok: false, restored: 0, rate: 0 };
    const before = character.mp ?? 0;
    if (typeof character.restoreMp === "function") character.restoreMp(rate);
    else character.mp = Math.min(character.maxMp ?? Infinity, before + rate);
    return { ok: true, restored: (character.mp ?? 0) - before, rate };
  }

  // Regen the whole party between combat rounds.
  tick(party) {
    const out = [];
    for (const m of party) {
      if (!((m?.hp ?? 0) > 0)) continue;
      const r = this.regen(m);
      if (r.ok && r.restored > 0) out.push({ id: m.id ?? m.name, restored: r.restored, rate: r.rate });
    }
    return out;
  }

  // How much MP an item restores (ethers and any healMp consumable).
  itemAmount(itemId) {
    if (typeof this.itemAmounts[itemId] === "number") return this.itemAmounts[itemId];
    const item = ITEMS[itemId];
    if (item?.effect?.kind === "healMp") return item.effect.amount ?? 0;
    return null;
  }

  // Inn rest: fully restore every member's MP; reports total restored.
  innRecovery(party) {
    let restored = 0;
    let members = 0;
    for (const m of party) {
      const max = typeof m.getStats === "function" ? m.getStats().maxMp : (m.maxMp ?? 0);
      if (!max) continue;
      const before = m.mp ?? 0;
      if (typeof m.restoreMp === "function") m.restoreMp(max);
      else m.mp = max;
      restored += (m.mp ?? 0) - before;
      members++;
    }
    return { ok: true, restored, members };
  }
}
