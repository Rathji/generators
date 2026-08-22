// Task #132: Class-Specific Passive Abilities — permanent traits granted by
// a character's class. `statMods` are percentage multipliers applied to the
// character's effective stats (e.g. 1.2 = +20%); `itemFind` is an additive
// bonus to the chance of a second loot roll after battle (Thief).

export const CLASS_PASSIVES = {
  warrior: {
    id: "warrior",
    name: "Fortitude",
    summary: "+20% base HP. Warriors endure blows that would fell lesser fighters.",
    statMods: { maxHp: 1.2 },
  },
  thief: {
    id: "thief",
    name: "Treasure Hunter",
    summary: "Higher item-find chance from slain enemies.",
    itemFind: 0.15,
  },
  monk: {
    id: "monk",
    name: "Iron Body",
    summary: "+10% base STR. Monks strike with iron-hard fists.",
    statMods: { str: 1.1 },
  },
  redMage: {
    id: "redMage",
    name: "Jack of All Trades",
    summary: "+5% STR and +5% INT. A balanced path between steel and sorcery.",
    statMods: { str: 1.05, int: 1.05 },
  },
  whiteMage: {
    id: "whiteMage",
    name: "Divine Blessing",
    summary: "+10% base MP. The gods favor their healers.",
    statMods: { maxMp: 1.1 },
  },
  blackMage: {
    id: "blackMage",
    name: "Arcane Mastery",
    summary: "+15% base MP. Raw arcane reserves for the most demanding spells.",
    statMods: { maxMp: 1.15 },
  },
};
