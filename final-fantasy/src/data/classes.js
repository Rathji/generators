export const CLASSES = {
  warrior: {
    id: "warrior", name: "Warrior",
    baseHp: 40, baseMp: 0, baseStr: 12, baseInt: 4, baseAgi: 6, baseDef: 8, baseMdef: 2,
    hpPerLevel: 9, mpPerLevel: 0, strPerLevel: 4, intPerLevel: 1, agiPerLevel: 2, defPerLevel: 3, mdefPerLevel: 0,
    spells: [],
  },
  thief: {
    id: "thief", name: "Thief",
    baseHp: 32, baseMp: 0, baseStr: 8, baseInt: 5, baseAgi: 14, baseDef: 4, baseMdef: 3,
    hpPerLevel: 7, mpPerLevel: 0, strPerLevel: 3, intPerLevel: 1, agiPerLevel: 5, defPerLevel: 1, mdefPerLevel: 0,
    spells: [],
  },
  monk: {
    id: "monk", name: "Monk",
    baseHp: 44, baseMp: 0, baseStr: 14, baseInt: 3, baseAgi: 10, baseDef: 5, baseMdef: 3,
    hpPerLevel: 10, mpPerLevel: 0, strPerLevel: 5, intPerLevel: 0, agiPerLevel: 3, defPerLevel: 3, mdefPerLevel: 1,
    spells: [],
  },
  redMage: {
    id: "redMage", name: "Red Mage",
    baseHp: 30, baseMp: 10, baseStr: 9, baseInt: 8, baseAgi: 7, baseDef: 4, baseMdef: 5,
    hpPerLevel: 6, mpPerLevel: 4, strPerLevel: 2, intPerLevel: 3, agiPerLevel: 2, defPerLevel: 1, mdefPerLevel: 1,
    spells: [{ lvl: 1, spell: "fire" }, { lvl: 1, spell: "cure" }, { lvl: 3, spell: "blizzard" }, { lvl: 4, spell: "sleep" }, { lvl: 5, spell: "thunder" }, { lvl: 6, spell: "cura" }, { lvl: 7, spell: "hold" }],
  },
  whiteMage: {
    id: "whiteMage", name: "White Mage",
    baseHp: 26, baseMp: 14, baseStr: 5, baseInt: 9, baseAgi: 7, baseDef: 3, baseMdef: 8,
    hpPerLevel: 5, mpPerLevel: 5, strPerLevel: 1, intPerLevel: 4, agiPerLevel: 2, defPerLevel: 1, mdefPerLevel: 2,
    spells: [{ lvl: 1, spell: "cure" }, { lvl: 2, spell: "dia" }, { lvl: 4, spell: "cura" }, { lvl: 5, spell: "esuna" }, { lvl: 7, spell: "curaga" }],
  },
  blackMage: {
    id: "blackMage", name: "Black Mage",
    baseHp: 24, baseMp: 16, baseStr: 4, baseInt: 12, baseAgi: 6, baseDef: 2, baseMdef: 5,
    hpPerLevel: 4, mpPerLevel: 6, strPerLevel: 1, intPerLevel: 5, agiPerLevel: 1, defPerLevel: 1, mdefPerLevel: 1,
    spells: [{ lvl: 1, spell: "fire" }, { lvl: 2, spell: "blizzard" }, { lvl: 3, spell: "sleep" }, { lvl: 4, spell: "thunder" }, { lvl: 5, spell: "poison" }, { lvl: 6, spell: "fira" }, { lvl: 7, spell: "hold" }, { lvl: 8, spell: "nuke" }],
  },
};

export const CLASS_IDS = Object.freeze(Object.keys(CLASSES));

export function getSpellsForLevel(classDef, level) {
  return classDef.spells.filter((s) => s.lvl <= level).map((s) => s.spell);
}
