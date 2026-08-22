// Task #175: enchantments — the Gem Cutter sets a gem into a piece of
// equipment, weaving the stone's essence permanently through the metal. One
// gem + one piece of gear + a gold fee, one enchantment per piece.

export const ENCHANTS = [
  {
    id: "fire",
    name: "Fire Essence",
    gem: "fireGem",
    goldCost: 400,
    mods: { atk: 3, int: 2 },
    description: "Warm as the Molten Core — its bearers strike with ember-heat.",
  },
  {
    id: "ice",
    name: "Ice Essence",
    gem: "iceGem",
    goldCost: 400,
    mods: { agi: 2, mdef: 2 },
    description: "Cold as the glacier's heart — it steadies the hand and dulls the chill.",
  },
  {
    id: "thunder",
    name: "Thunder Essence",
    gem: "thunderGem",
    goldCost: 450,
    mods: { atk: 4 },
    description: "Crackling with trapped lightning — every blow lands like a bolt.",
  },
  {
    id: "holy",
    name: "Holy Essence",
    gem: "holyGem",
    goldCost: 500,
    mods: { def: 2, mdef: 3 },
    description: "Cut from a fallen crystal's shard — it wards its bearer against the dark.",
  },
  {
    id: "void",
    name: "Void Essence",
    gem: "voidGem",
    goldCost: 600,
    mods: { hp: 30, mdef: 3 },
    description: "Drinking the light around it, it lends the bearer a fragment of the abyss's vigor.",
  },
];
