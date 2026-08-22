// Task #71: Accessory Slot System — a third equipment slot that grants
// passive stat buffs and, for certain accessories, status immunity
// (e.g. the Ribbon blocks poison/sleep/paralysis/stone).

import { ITEMS } from "../data/items.js";

export const ACCESSORY_SLOT = "accessory";

export const ACCESSORY_MOD_KEYS = ["atk", "mAtk", "def", "mdef", "int", "str", "agi", "hp", "mp"];

export class AccessorySystem {
  constructor(itemDb = ITEMS) {
    this.itemDb = itemDb;
  }

  // The equipped accessory item, or null.
  accessory(char) {
    const itemId = char?.equipment?.[ACCESSORY_SLOT] ?? null;
    return itemId ? (this.itemDb[itemId] ?? null) : null;
  }

  canEquip(char, itemOrId) {
    const item = typeof itemOrId === "string" ? this.itemDb[itemOrId] : itemOrId;
    if (!item) return false;
    if (item.type !== "accessory" && item.slot !== ACCESSORY_SLOT) return false;
    if (Array.isArray(item.classes) && !item.classes.includes(char.classId)) return false;
    return true;
  }

  // Flat stat buffs from the equipped accessory.
  mods(char) {
    const acc = this.accessory(char);
    const out = {};
    if (!acc?.mods) return out;
    for (const key of ACCESSORY_MOD_KEYS) {
      if (typeof acc.mods[key] === "number") out[key] = acc.mods[key];
    }
    return out;
  }

  // Status ids the character's accessory makes them immune to.
  statusImmunities(char) {
    const acc = this.accessory(char);
    if (!acc) return [];
    if (Array.isArray(acc.statusImmune)) return acc.statusImmune;
    if (acc.statusImmune) return [acc.statusImmune];
    return [];
  }

  immunityFor(char, statusId) {
    return this.statusImmunities(char).includes(statusId);
  }

  describe(char) {
    const acc = this.accessory(char);
    if (!acc) return "No accessory equipped.";
    const bits = [];
    for (const key of ACCESSORY_MOD_KEYS) {
      if (typeof acc.mods?.[key] === "number") bits.push((acc.mods[key] >= 0 ? "+" : "") + acc.mods[key] + " " + key.toUpperCase());
    }
    for (const s of this.statusImmunities(char)) bits.push("Immune to " + s);
    return (acc.name ?? acc.id) + (bits.length ? " — " + bits.join(", ") : "");
  }
}
