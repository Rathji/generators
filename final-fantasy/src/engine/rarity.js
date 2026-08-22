// Task #45: Item Rarity/Tiering System — classification determining item
// value and effectiveness, plus rarity-aware buy/sell pricing.

import { ITEMS } from "../data/items.js";
import { RARITY, RARITY_ORDER, DEFAULT_RARITY } from "../data/rarity.js";

export function rarityOfItem(item) {
  return RARITY[item?.rarity] ?? RARITY[DEFAULT_RARITY];
}

export function rarityRank(item) {
  return rarityOfItem(item).rank;
}

export function priceWithRarity(item, base = null) {
  const price = base ?? item?.price ?? 0;
  return Math.floor(price * rarityOfItem(item).buyMult);
}

export function sellPriceWithRarity(item, base = null) {
  const r = rarityOfItem(item);
  return Math.floor(priceWithRarity(item, base) * r.sellMult);
}

export class ItemRaritySystem {
  constructor(itemDb = ITEMS, config = RARITY) {
    this.itemDb = itemDb;
    this.config = config;
    this.order = RARITY_ORDER;
  }

  rarityOf(itemOrId) {
    const item = typeof itemOrId === "string" ? this.itemDb[itemOrId] : itemOrId;
    return this.config[item?.rarity] ?? this.config[DEFAULT_RARITY];
  }

  rankOf(itemOrId) {
    return this.rarityOf(itemOrId).rank;
  }

  isAtLeast(itemOrId, tier) {
    return this.rankOf(itemOrId) >= this.rank(tier);
  }

  rank(tier) {
    return this.config[tier]?.rank ?? 0;
  }

  // Rarity-adjusted buy price for a single unit.
  buyPrice(itemOrId, base = null) {
    const item = typeof itemOrId === "string" ? this.itemDb[itemOrId] : itemOrId;
    if (!item) return null;
    return Math.floor((base ?? item.price ?? 0) * this.rarityOf(item).buyMult);
  }

  // Rarity-adjusted sell-back price for a single unit.
  sellPrice(itemOrId, base = null) {
    const item = typeof itemOrId === "string" ? this.itemDb[itemOrId] : itemOrId;
    if (!item) return null;
    return Math.floor(this.buyPrice(item, base) * this.rarityOf(item).sellMult);
  }

  describe(itemOrId) {
    const item = typeof itemOrId === "string" ? this.itemDb[itemOrId] : itemOrId;
    if (!item) return null;
    const r = this.rarityOf(item);
    return { tier: r.id, label: r.label, rank: r.rank, color: r.color };
  }

  // Sort item ids by rarity (ascending by default).
  sortedByIds(ids, ascending = true) {
    const dir = ascending ? 1 : -1;
    return [...ids].sort((a, b) => {
      const r = this.rankOf(a) - this.rankOf(b);
      return r !== 0 ? r * dir : (this.itemDb[a]?.price ?? 0) - (this.itemDb[b]?.price ?? 0);
    });
  }

  all() {
    return this.order.map((tier) => ({ ...this.config[tier], items: this.itemsOfTier(tier) }));
  }

  itemsOfTier(tier) {
    return Object.keys(this.itemDb).filter((id) => this.itemDb[id].rarity === tier || this.rarityOf(id).id === tier);
  }
}
