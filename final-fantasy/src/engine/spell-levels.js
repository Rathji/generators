// Task #66: Spell Leveling Requirements — higher-tier spells lock behind
// character level thresholds. Class spells use their class spell table;
// scroll/teacher spells default to no lock unless overridden.

import { SPELLS } from "../data/spells.js";
import { CLASSES } from "../data/classes.js";

export class SpellLevelingSystem {
  constructor(opts = {}) {
    this.spellLevels = opts.spellLevels ?? {}; // explicit per-spell overrides
  }

  // Minimum level required to cast a spell for the given character's class.
  requiredLevel(character, spellId) {
    if (!SPELLS[spellId]) return Infinity;
    if (typeof this.spellLevels[spellId] === "number") return this.spellLevels[spellId];
    const cls = character?.class ?? (character?.classId ? CLASSES[character.classId] : null);
    if (cls && Array.isArray(cls.spells)) {
      const entry = cls.spells.find((s) => s.spell === spellId);
      if (entry) return entry.lvl;
    }
    return 1;
  }

  isGated(character, spellId) {
    return this.requiredLevel(character, spellId) > 1;
  }

  canUse(character, spellId) {
    if (!SPELLS[spellId]) return false;
    return (character?.level ?? 1) >= this.requiredLevel(character, spellId);
  }

  // A spell the character knows but is still too low-level to cast
  // (e.g. learned early from a scroll or teacher).
  lockedByLevel(character, spellId) {
    return !!character?.knowsSpell?.(spellId) && !this.canUse(character, spellId);
  }

  lockedSpells(character) {
    return (character?.getSpells?.() ?? []).filter((s) => this.lockedByLevel(character, s));
  }

  describe(character, spellId) {
    const req = this.requiredLevel(character, spellId);
    return {
      spellId,
      name: SPELLS[spellId]?.name ?? spellId,
      requiredLevel: req,
      level: character?.level ?? 1,
      canUse: this.canUse(character, spellId),
    };
  }
}
