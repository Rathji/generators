// Task #143: Equipment Set Bonus data — wearing a combination of gear from
// one set grants hidden stat bonuses. Bonuses are cumulative: owning `count`
// pieces of the set unlocks that tier's mods (e.g. the Wyrm Set grants a
// 2-piece bonus and a 3-piece bonus).

export const GEAR_SETS = [
  {
    id: "iron_set",
    name: "Iron Set",
    pieces: ["ironSword", "chain"],
    bonuses: [{ count: 2, mods: { def: 1 } }],
  },
  {
    id: "frost_set",
    name: "Frost Set",
    pieces: ["frostCloak", "windBlade"],
    bonuses: [{ count: 2, mods: { agi: 2, mdef: 2 } }],
  },
  {
    id: "dwarven_set",
    name: "Dwarven Set",
    pieces: ["runeSabre", "runeCuirass"],
    bonuses: [{ count: 2, mods: { str: 2, def: 3 } }],
  },
  {
    id: "wyrm_set",
    name: "Wyrm Set",
    pieces: ["wyrmEdge", "tideMail", "pearlCharm"],
    bonuses: [
      { count: 2, mods: { agi: 1, def: 2 } },
      { count: 3, mods: { hp: 20, mdef: 3 } },
    ],
  },
  {
    id: "frozen_set",
    name: "Frozen Set",
    pieces: ["frozenBlade", "rimeMail"],
    bonuses: [{ count: 2, mods: { agi: 2, def: 4 } }],
  },
  {
    id: "eternal_set",
    name: "Eternal Set",
    pieces: ["eternalBlade", "chronoMail", "chronoCore"],
    bonuses: [
      { count: 2, mods: { agi: 2, def: 3 } },
      { count: 3, mods: { str: 4, def: 4, mdef: 4 } },
    ],
  },
];
