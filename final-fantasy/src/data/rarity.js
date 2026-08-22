// Task #45: Item Rarity/Tiering config — tiers with value & shop multipliers.
// Higher tiers mean stronger effectiveness and more expensive buy/sell prices.

export const RARITY = {
  common: { id: "common", rank: 0, color: "#c8d0dc", buyMult: 1.0, sellMult: 0.5, label: "Common" },
  uncommon: { id: "uncommon", rank: 1, color: "#6ec06e", buyMult: 1.2, sellMult: 0.6, label: "Uncommon" },
  rare: { id: "rare", rank: 2, color: "#5aa8e8", buyMult: 1.5, sellMult: 0.7, label: "Rare" },
  epic: { id: "epic", rank: 3, color: "#c07ae0", buyMult: 2.0, sellMult: 0.8, label: "Epic" },
  legendary: { id: "legendary", rank: 4, color: "#e8c85a", buyMult: 3.0, sellMult: 0.9, label: "Legendary" },
};

export const RARITY_ORDER = Object.keys(RARITY);
export const DEFAULT_RARITY = "common";
