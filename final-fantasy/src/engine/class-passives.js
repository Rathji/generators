// Task #132: Class-Specific Passive Ability System — permanent class traits.
// `adjustStats` applies percentage stat modifiers on top of a character's
// effective stats (warrior HP, monk STR, mage MP), and `itemFindForParty`
// feeds the combat reward resolver's bonus loot chance (thief).

import { CLASSES } from "../data/classes.js";
import { CLASS_PASSIVES } from "../data/class-passives.js";

const KNOWN_STATS = ["atk", "hp", "mp", "str", "int", "agi", "def", "mdef", "maxHp", "maxMp"];

export class ClassPassiveSystem {
  constructor(opts = {}) {
    this.passives = opts.passives ?? CLASS_PASSIVES;
    this.classes = opts.classes ?? CLASSES;
  }

  passive(classId) {
    return this.passives[classId] ?? null;
  }

  hasPassive(classId) {
    return !!this.passive(classId);
  }

  describe(classId) {
    const p = this.passive(classId);
    if (!p) return null;
    return {
      classId,
      className: this.classes[classId]?.name ?? classId,
      name: p.name,
      summary: p.summary ?? "",
      statMods: p.statMods ?? {},
      itemFind: p.itemFind ?? 0,
    };
  }

  // Bonus loot chance contributed by one character's class.
  itemFind(classId) {
    return this.passive(classId)?.itemFind ?? 0;
  }

  // Total bonus loot chance across the whole party (e.g. one thief = 0.15).
  itemFindForParty(party) {
    return (party?.members ?? []).reduce((sum, m) => sum + this.itemFind(m?.classId), 0);
  }

  // Apply percentage stat modifiers to an effective-stats object.
  adjustStats(character, stats) {
    const p = this.passive(character?.classId);
    if (!p || !p.statMods) return stats;
    const out = { ...stats };
    for (const [stat, pct] of Object.entries(p.statMods)) {
      out[stat] = Math.round((stats[stat] ?? 0) * pct);
    }
    return out;
  }

  audit() {
    const errors = [];
    for (const [classId, def] of Object.entries(this.passives)) {
      if (!this.classes[classId]) errors.push({ class: classId, error: "unknown class" });
      if (!def.name) errors.push({ class: classId, error: "missing name" });
      if (def.statMods) {
        for (const stat of Object.keys(def.statMods)) {
          if (!KNOWN_STATS.includes(stat)) errors.push({ class: classId, error: "unknown stat: " + stat });
          if ((def.statMods[stat] ?? 1) < 1) errors.push({ class: classId, error: "mod must be >= 1x: " + stat });
        }
      }
      if ((def.itemFind ?? 0) < 0 || (def.itemFind ?? 0) > 1) {
        errors.push({ class: classId, error: "itemFind out of range" });
      }
    }
    return { ok: errors.length === 0, errors };
  }
}
