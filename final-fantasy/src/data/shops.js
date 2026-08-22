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
  // Task #167: the Pravog armory — coastal-forged arms at the harbor.
  pravog_armory: {
    id: "pravog_armory",
    name: "Pravog Armory",
    priceMod: 1,
    sellRatio: 0.55,
    stock: ["dagger", "ironSword", "knuckles", "cloth", "leather", "chain", "potion", "antidote", "soft"],
  },
  // Task #172: Northwind Provisions — furs, frost salves, and cold-iron arms.
  north_village_supply: {
    id: "north_village_supply",
    name: "Northwind Provisions",
    priceMod: 1,
    sellRatio: 0.55,
    stock: ["ironSword", "knuckles", "staff", "cloth", "leather", "frostCloak", "potion", "hiPotion", "ether", "soft", "goldNeedle", "antidote", "cottage"],
  },
  // Task #176-#185: jungle & highland shops — the jungle herbalist's stock
  // leans on antidotes; the castle armory sells the Gale Cloak that bends the
  // summit's winds.
  jungle_village_supply: {
    id: "jungle_village_supply",
    name: "Jungle Village Supply",
    priceMod: 1,
    sellRatio: 0.55,
    stock: ["dagger", "ironSword", "staff", "cloth", "leather", "potion", "hiPotion", "antidote", "soft", "jungleHerb"],
  },
  highlands_castle_armory: {
    id: "highlands_castle_armory",
    name: "Highlands Castle Armory",
    priceMod: 1,
    sellRatio: 0.55,
    stock: ["ironSword", "mythrilSword", "staff", "chain", "plate", "galeCloak", "potion", "hiPotion", "ether", "soft", "cottage"],
  },
};
