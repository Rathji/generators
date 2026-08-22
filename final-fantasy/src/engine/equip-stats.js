// Task #43: Equipment Stat Modifier Logic — gear mods (flat and percentage)
// compose into combat-ready derived stats like Attack, Magic, Defense, Speed.

import { ITEMS } from "../data/items.js";
import { getBaseStats } from "./stats.js";

export const FLAT_MOD_KEYS = ["atk", "mAtk", "def", "mdef", "int", "str", "agi", "hp", "mp"];
export const PCT_MOD_KEYS = ["strPct", "intPct", "agiPct", "defPct", "mdefPct", "hpPct", "mpPct", "atkPct", "mAtkPct"];

// Sum of flat stat mods across every equipped slot.
export function equipmentFlatMods(char, itemDb = ITEMS) {
  const mods = {};
  for (const itemId of Object.values(char.equipment ?? {})) {
    if (!itemId) continue;
    const item = itemDb[itemId];
    if (!item?.mods) continue;
    for (const key of FLAT_MOD_KEYS) {
      if (typeof item.mods[key] === "number") mods[key] = (mods[key] ?? 0) + item.mods[key];
    }
  }
  return mods;
}

// Sum of percentage mods (e.g. "strPct": 0.1 -> +10% STR) across equipment.
export function equipmentPctMods(char, itemDb = ITEMS) {
  const mods = {};
  for (const itemId of Object.values(char.equipment ?? {})) {
    if (!itemId) continue;
    const item = itemDb[itemId];
    if (!item?.mods) continue;
    for (const key of PCT_MOD_KEYS) {
      if (typeof item.mods[key] === "number") mods[key] = (mods[key] ?? 0) + item.mods[key];
    }
  }
  return mods;
}

export class EquipmentStatSystem {
  constructor(itemDb = ITEMS) {
    this.itemDb = itemDb;
  }

  flatMods(char) {
    return equipmentFlatMods(char, this.itemDb);
  }

  pctMods(char) {
    return equipmentPctMods(char, this.itemDb);
  }

  // Level-only stats (no gear), the base the mods act upon.
  base(char) {
    return getBaseStats(char.class ?? { id: char.classId }, char.level ?? 1);
  }

  // Equipped mods per slot, for display.
  modsSummary(char) {
    const out = [];
    for (const [slot, itemId] of Object.entries(char.equipment ?? {})) {
      if (!itemId) continue;
      const item = this.itemDb[itemId];
      if (!item) continue;
      out.push({ slot, itemId, name: item.name, mods: item.mods ?? {} });
    }
    return out;
  }

  // Combat-ready derived stats: gear mods applied over level-base stats.
  derive(char) {
    const base = this.base(char);
    const flat = this.flatMods(char);
    const pct = this.pctMods(char);
    const withPct = (stat, p) => Math.floor((stat ?? 0) * (1 + (pct[p + "Pct"] ?? 0)));
    const str = withPct(base.str, "str") + (flat.str ?? 0);
    const int = withPct(base.int, "int") + (flat.int ?? 0);
    const agi = withPct(base.agi, "agi") + (flat.agi ?? 0);
    const def = withPct(base.def, "def") + (flat.def ?? 0);
    const mdef = withPct(base.mdef, "mdef") + (flat.mdef ?? 0);
    const maxHp = withPct(base.maxHp, "hp") + (flat.hp ?? 0);
    const maxMp = withPct(base.maxMp, "mp") + (flat.mp ?? 0);
    return {
      str,
      int,
      agi,
      def,
      mdef,
      maxHp,
      maxMp,
      attack: Math.floor((base.str * (1 + (pct.strPct ?? 0))) + (flat.atk ?? 0)),
      magicAttack: Math.floor((base.int * (1 + (pct.intPct ?? 0))) + (flat.mAtk ?? 0)),
      defense: def,
      magicDefense: mdef,
      speed: agi,
    };
  }

  // Human-readable modifier lines, e.g. "Iron Sword: +8 ATK".
  describe(char) {
    return this.modsSummary(char).map((m) => {
      const parts = Object.entries(m.mods)
        .map(([k, v]) => (k.endsWith("Pct") ? "+" + Math.round(v * 100) + "% " + k.slice(0, -3).toUpperCase() : (v >= 0 ? "+" : "") + v + " " + k.toUpperCase()))
        .join(", ");
      return m.name + ": " + parts;
    });
  }

  totalMods(char) {
    const flat = this.flatMods(char);
    const pct = this.pctMods(char);
    return { flat, pct, count: this.modsSummary(char).length };
  }
}
