// Task #8: Equipment & Slot System — weapon/armor slots with class
// restrictions; equipping changes the character's effective stats.

import { ITEMS } from "../data/items.js";

export const SLOTS = ["weapon", "armor", "accessory"];

export class EquipSystem {
  constructor(inventory = null) {
    this.inventory = inventory;
  }

  canEquip(char, item) {
    if (!item) return false;
    if (item.type !== "weapon" && item.type !== "armor" && item.type !== "accessory") return false;
    if (!SLOTS.includes(item.slot)) return false;
    if (Array.isArray(item.classes) && !item.classes.includes(char.classId)) return false;
    return true;
  }

  canEquipId(char, itemId) {
    return this.canEquip(char, ITEMS[itemId]);
  }

  equip(char, itemId) {
    const item = ITEMS[itemId];
    if (!item) return { ok: false, error: "unknown item" };
    if (!this.canEquip(char, item)) return { ok: false, error: "class cannot equip " + item.name };
    if (this.inventory && !this.inventory.has(itemId)) return { ok: false, error: "item not owned" };
    const slot = item.slot;
    const previous = char.equipment[slot];
    if (this.inventory) {
      if (!this.inventory.remove(itemId, 1)) return { ok: false, error: "remove failed" };
      if (previous) this.inventory.add(previous, 1);
    }
    char.equipment[slot] = itemId;
    return { ok: true, slot, unequipped: previous ?? null };
  }

  unequip(char, slot) {
    const itemId = char.equipment[slot];
    if (!itemId) return { ok: false, error: "slot empty" };
    char.equipment[slot] = null;
    if (this.inventory) this.inventory.add(itemId, 1);
    return { ok: true, item: itemId };
  }

  equippedItem(char, slot) {
    const itemId = char.equipment[slot];
    return itemId ? ITEMS[itemId] : null;
  }
}
