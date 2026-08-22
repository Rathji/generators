// Task #143: GearSetBonusSystem — detects when a character wears a gear
// combination from one of the sets and layers the hidden stat bonuses onto
// their effective stats. The system's `statMods(char)` output is composed
// into the stats pipeline via setExtraStatHook in main.js (applied after
// class-passive modifiers, before the value is consumed).

import { GEAR_SETS } from "../data/gear-sets.js";
import { ITEMS } from "../data/items.js";

export class GearSetBonusSystem {
  constructor(defs = GEAR_SETS, itemDb = ITEMS) {
    this.defs = defs;
    this.itemDb = itemDb;
  }

  all() {
    return [...this.defs];
  }

  set(id) {
    return this.defs.find((s) => s.id === id) ?? null;
  }

  // The set pieces a character actually wears.
  setPieces(set, char) {
    const worn = new Set(Object.values(char?.equipment ?? {}).filter(Boolean));
    return set.pieces.filter((p) => worn.has(p));
  }

  // Sets the character has any piece of.
  equipped(char) {
    const worn = new Set(Object.values(char?.equipment ?? {}).filter(Boolean));
    return this.all().filter((s) => s.pieces.some((p) => worn.has(p)));
  }

  // Active bonuses for a character — every tier whose piece-count is met.
  activeBonuses(char) {
    const out = [];
    for (const set of this.all()) {
      const owned = this.setPieces(set, char).length;
      for (const bonus of set.bonuses) {
        if (owned >= bonus.count) out.push({ set, tier: bonus.count, mods: bonus.mods, owned });
      }
    }
    return out;
  }

  // Summed flat mods from every active bonus.
  statMods(char) {
    const mods = {};
    for (const b of this.activeBonuses(char)) {
      for (const k in b.mods) mods[k] = (mods[k] ?? 0) + b.mods[k];
    }
    return mods;
  }

  // Compose the set mods onto a stats object (returns a new object).
  applyMods(char, stats) {
    const m = this.statMods(char);
    const out = { ...stats };
    for (const k in m) out[k] = (out[k] ?? 0) + m[k];
    return out;
  }

  describe(char) {
    return this.activeBonuses(char).map((b) => {
      const mods = Object.entries(b.mods)
        .map(([k, v]) => "+" + v + " " + k.toUpperCase())
        .join(", ");
      return b.set.name + " (" + b.owned + "/" + b.set.pieces.length + "): " + mods;
    });
  }

  // Audit: every set must reference real items and have ascending tiers.
  audit(itemDb = this.itemDb) {
    const report = [];
    for (const set of this.all()) {
      for (const p of set.pieces) {
        if (!itemDb[p]) report.push({ set: set.id, error: "unknown piece " + p });
      }
      const tiers = [...set.bonuses].sort((a, b) => a.count - b.count);
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].count <= tiers[i - 1].count) report.push({ set: set.id, error: "tiers not ascending" });
      }
      for (const b of set.bonuses) {
        if (b.count < 1 || b.count > set.pieces.length) report.push({ set: set.id, error: "bad tier count " + b.count });
      }
    }
    return report;
  }
}
