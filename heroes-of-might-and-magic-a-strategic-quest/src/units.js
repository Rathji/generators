// src/units.js — Unit roster, stats, and army capacity rules (Roadmap task 7/9).

export const MAX_ARMY_SLOTS = 5;
export const MAX_UNITS_PER_SLOT = 999;

export const UNITS = [
  { id: "peasant", name: "Peasant", atk: 1, def: 1, hp: 2, cost: 25, speed: 2 },
  { id: "archer", name: "Archer", atk: 4, def: 2, hp: 4, cost: 150, speed: 4 },
  { id: "pikeman", name: "Pikeman", atk: 3, def: 5, hp: 5, cost: 100, speed: 3 },
  { id: "swordsman", name: "Swordsman", atk: 6, def: 6, hp: 10, cost: 300, speed: 5 },
  { id: "cavalry", name: "Cavalry", atk: 8, def: 7, hp: 16, cost: 500, speed: 9 },
  { id: "goblin", name: "Goblin", atk: 2, def: 1, hp: 3, cost: 40, speed: 5 },
  { id: "wolf", name: "Wolf", atk: 5, def: 3, hp: 6, cost: 200, speed: 8 },
  { id: "orc", name: "Orc", atk: 4, def: 3, hp: 7, cost: 180, speed: 5 },
  { id: "ogre", name: "Ogre", atk: 6, def: 5, hp: 12, cost: 350, speed: 4 },
  { id: "troll", name: "Troll", atk: 7, def: 7, hp: 20, cost: 500, speed: 5 },
  { id: "sprite", name: "Sprite", atk: 2, def: 2, hp: 3, cost: 60, speed: 7 },
  { id: "dwarf", name: "Dwarf", atk: 4, def: 5, hp: 8, cost: 180, speed: 3 },
  { id: "elf", name: "Elf", atk: 5, def: 4, hp: 8, cost: 250, speed: 5 },
  { id: "unicorn", name: "Unicorn", atk: 9, def: 8, hp: 20, cost: 600, speed: 9 },
  { id: "dragon", name: "Dragon", atk: 12, def: 12, hp: 35, cost: 2000, speed: 11 }
];

export const UNIT_BY_ID = Object.fromEntries(UNITS.map(u => [u.id, u]));
