// Task #110/#111: gear tier progression data — ordered upgrade chains for
// weapons (Iron -> Steel -> Mythril -> legend) and armor (cloth -> leather ->
// plate -> rune). Chains are listed weakest-first; each step's stats must
// never decrease (the GearTierSystem audit enforces this against items.js).

export const WEAPON_TIERS = {
  // The classic sword line — from a humble dagger to the broken-age's edge.
  sword: [
    "dagger",
    "ironSword",
    "mythrilSword",
    "windBlade",
    "infernoBrand",
    "frozenBlade",
    "luminary",
    "eternalBlade",
    "timeweaver",
    "masamune",
    "shatteredBlade",
  ],
  // The dwarven forge line — smith-crafted blades, tempered by rune and storm.
  forged: ["runeSabre", "wyrmEdge", "voidBrand"],
  // Class alternates that sit outside the sword line.
  spear: ["tritonHarpoon"],
  mystic: ["staff"],
  brawler: ["knuckles"],
};

export const ARMOR_TIERS = {
  // The heavy line — from padded cloth to rune-etched plate.
  heavy: ["cloth", "leather", "chain", "plate", "runePlate", "chronoMail"],
  // The dwarven forge line — cast cuirass, tide chain, rime and frost.
  forged: ["runeCuirass", "tideMail", "rimeMail"],
  // The mage line — robes that drink cold and quicken the cast.
  mage: ["robe", "frostCloak"],
};
