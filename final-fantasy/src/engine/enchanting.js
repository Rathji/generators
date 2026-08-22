// Task #176: enchantments — the Gem Cutter weaves a gem's essence into a
// piece of equipment. One gem + one item + a gold fee; the enchantment is
// permanent and recorded on the item id (`enchanted_<itemId>` = enchantId).
// The decorated item DB merges the enchant's mods so equipment stat systems
// see the boosted gear.

import { ITEMS } from "../data/items.js";

export class EnchantingSystem {
  constructor(enchants = [], opts = {}) {
    this.enchants = enchants;
    this.inventory = opts.inventory ?? null;
    this.party = opts.party ?? null;
    this.state = opts.state ?? null;
  }

  all() {
    return [...this.enchants];
  }

  enchantById(id) {
    return this.enchants.find((e) => e.id === id) ?? null;
  }

  isEnchanted(itemId) {
    return !!this.enchantOf(itemId);
  }

  enchantOf(itemId) {
    if (!this.state) return null;
    const flag = this.state.getFlag("enchanted_" + itemId);
    if (!flag) return null;
    const value = this.state.flags?.["enchanted_" + itemId];
    return value || null;
  }

  // Validation only — no side effects.
  canEnchant(itemId, enchId) {
    const e = this.enchantById(enchId);
    if (!e) return { ok: false, error: "unknown enchantment" };
    const item = ITEMS[itemId];
    if (!item) return { ok: false, error: "unknown item" };
    if (item.type !== "weapon" && item.type !== "armor" && item.type !== "accessory") {
      return { ok: false, error: "not equipment" };
    }
    if (this.isEnchanted(itemId)) return { ok: false, error: "already enchanted" };
    if (!this.inventory?.has(e.gem, 1)) return { ok: false, error: "missing gem" };
    if (e.goldCost > 0 && (!this.party || this.party.gold < e.goldCost)) {
      return { ok: false, error: "not enough gold" };
    }
    return { ok: true };
  }

  // Enchant an equipment item id with the given enchantment.
  enchant(itemId, enchId) {
    const e = this.enchantById(enchId);
    const ready = this.canEnchant(itemId, enchId);
    if (!ready.ok) return { ok: false, error: ready.error };
    this.inventory.remove(e.gem, 1);
    if (e.goldCost > 0 && this.party) this.party.spendGold(e.goldCost);
    this.state?.setFlag("enchanted_" + itemId, enchId);
    return { ok: true, itemId, enchantment: e.id, name: e.name, mods: e.mods, goldCost: e.goldCost };
  }

  // The mod overlay a gear item gains from its enchantment (empty when none).
  enchantMods(itemId) {
    const e = this.enchantById(this.enchantOf(itemId));
    return e?.mods ?? {};
  }

  // A view of the item DB where enchanted gear carries its boosted mods.
  decoratedItemDb() {
    const self = this;
    return new Proxy(ITEMS, {
      get(target, prop) {
        if (typeof prop !== "string") return target[prop];
        const item = target[prop];
        if (!item) return item;
        const extra = self.enchantMods(prop);
        if (!extra || Object.keys(extra).length === 0) return item;
        const mods = { ...(item.mods ?? {}) };
        for (const [key, val] of Object.entries(extra)) mods[key] = (mods[key] ?? 0) + val;
        return { ...item, mods };
      },
    });
  }

  // Human-readable enchantment summary for a gear item.
  describe(itemId) {
    const e = this.enchantById(this.enchantOf(itemId));
    if (!e) return null;
    return e.name + ": " + Object.entries(e.mods).map(([k, v]) => (v >= 0 ? "+" : "") + v + " " + k.toUpperCase()).join(", ");
  }
}
