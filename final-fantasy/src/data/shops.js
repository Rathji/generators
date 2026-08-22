// Shop definitions (Task #22) — fixed price lists per shop. Prices come
// from the item database; `priceMod` scales buy prices, `sellRatio` scales
// sell-back value.

export const SHOPS = {
  cornelia_weapon: {
    id: "cornelia_weapon",
    name: "Cornelia Weaponsmith",
    priceMod: 1,
    sellRatio: 0.5,
    stock: ["dagger", "ironSword", "mythrilSword", "cloth", "leather", "chain"],
  },
  cornelia_item: {
    id: "cornelia_item",
    name: "Cornelia Item Shop",
    priceMod: 1,
    sellRatio: 0.5,
    stock: ["potion", "hiPotion", "ether", "antidote", "cottage", "fireScroll", "aeroScroll"],
  },
  // Task #112: Windfall Isle merchant — seaside provisions.
  windfall_merchant: {
    id: "windfall_merchant",
    name: "Windfall Merchant",
    priceMod: 1,
    sellRatio: 0.55,
    stock: ["potion", "hiPotion", "ether", "antidote", "soft", "cottage"],
  },
  // Task #131: Dwarfholm smithy — dwarven arms and provisions.
  dwarfholm_smith: {
    id: "dwarfholm_smith",
    name: "Dwarven Smithy",
    priceMod: 1,
    sellRatio: 0.55,
    stock: ["ironSword", "mythrilSword", "knuckles", "cloth", "leather", "chain", "hiPotion", "soft", "goldNeedle", "ether", "cottage"],
  },
  // Task #142: Glacierport provisions — cold-weather supplies and arms.
  glacierport_supply: {
    id: "glacierport_supply",
    name: "Glacierport Provisions",
    priceMod: 1,
    sellRatio: 0.55,
    stock: ["ironSword", "knuckles", "staff", "cloth", "leather", "chain", "potion", "hiPotion", "ether", "soft", "goldNeedle", "cottage"],
  },
};
