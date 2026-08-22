// A Bard's Tale — party architecture: race/class data (from main.pjs lists),
// stat rolling, derived stats, and party management (max 4 members).

export const STAT_ORDER = ["STR", "INT", "DEX", "CON", "CHA", "LUK"];

let raceCache = null;
let classCache = null;

export function loadRaces() {
  if (raceCache) return raceCache;
  const list = (root && root.race) ? root.race.selectAll : [];
  raceCache = list.map(r => ({
    id: r.id.evaluateItem,
    name: r.raceName.evaluateItem,
    desc: r.desc.evaluateItem,
    mods: {
      STR: Number(r.STR), INT: Number(r.INT), DEX: Number(r.DEX),
      CON: Number(r.CON), CHA: Number(r.CHA), LUK: Number(r.LUK),
    },
    allowedClasses: r.allowedClasses.selectAll.map(c => c.evaluateItem),
  }));
  return raceCache;
}

export function loadClasses() {
  if (classCache) return classCache;
  const list = (root && root["characterClass"]) ? root["characterClass"].selectAll : [];
  classCache = list.map(c => ({
    id: c.id.evaluateItem,
    name: c.className.evaluateItem,
    desc: c.desc.evaluateItem,
    hpBase: Number(c.hpBase),
    acBonus: Number(c.acBonus),
    manaBase: Number(c.manaBase),
    mods: {
      STR: Number(c.STR), INT: Number(c.INT), DEX: Number(c.DEX),
      CON: Number(c.CON), CHA: Number(c.CHA), LUK: Number(c.LUK),
    },
  }));
  return classCache;
}

export function abilityMod(stat) {
  return Math.floor((stat - 10) / 2);
}

export function rollDice(sides, count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
  return total;
}

export function rollStats() {
  const rolls = {};
  for (const s of STAT_ORDER) rolls[s] = rollDice(6, 3);
  return rolls;
}

export function computeDerived(rolls, race, cls) {
  const final = {};
  const mods = {};
  for (const s of STAT_ORDER) {
    const v = Math.max(1, rolls[s] + (race.mods[s] || 0) + (cls.mods[s] || 0));
    final[s] = v;
    mods[s] = abilityMod(v);
  }
  const hp = Math.max(1, cls.hpBase + mods.CON);
  const ac = 10 + mods.DEX + cls.acBonus;
  const mana = Math.max(0, cls.manaBase + mods.INT * 2);
  return { final, mods, hp, ac, mana };
}

export function createCharacter(name, raceId, classId, rolls) {
  const races = loadRaces();
  const classes = loadClasses();
  const race = races.find(r => r.id === raceId);
  const cls = classes.find(c => c.id === classId);
  if (!race || !cls) throw new Error("Unknown race or class: " + raceId + "/" + classId);
  const d = computeDerived(rolls, race, cls);
  return {
    name,
    raceId,
    classId,
    raceName: race.name,
    className: cls.name,
    stats: d.final,
    mods: d.mods,
    maxHp: d.hp,
    hp: d.hp,
    maxMana: d.mana,
    mana: d.mana,
    ac: d.ac,
    level: 1,
    xp: 0,
    equipment: { head: null, body: null, weapon: null, offhand: null, light: null },
    buff: null,
  };
}

// Bonus damage from equipped items (weapons etc.).
export function equipAttackBonus(m) {
  if (!m.equipment) return 0;
  let t = 0;
  for (const k in m.equipment) {
    const it = m.equipment[k];
    if (it) t += it.attackBonus || 0;
  }
  return t;
}

// Bonus armor class from equipped items (armor, shields, helms).
export function equipAcBonus(m) {
  if (!m.equipment) return 0;
  let t = 0;
  for (const k in m.equipment) {
    const it = m.equipment[k];
    if (it) t += it.acBonus || 0;
  }
  return t;
}

export function effectiveAc(m) {
  return m.ac + equipAcBonus(m);
}

export function effectiveAttack(m) {
  return m.mods.STR + equipAttackBonus(m);
}

// A party with a lit light source in any "light" slot defies the dark rooms.
export function hasLightSource(state) {
  return state.party.some(m => m.equipment && m.equipment.light);
}

export function addPartyMember(state, character) {
  if (state.party.length >= 4) return false;
  state.party.push(character);
  return true;
}

export function removePartyMember(state, index) {
  if (index < 0 || index >= state.party.length) return false;
  state.party.splice(index, 1);
  return true;
}

export function partySummary(state) {
  return state.party.map(m => ({
    name: m.name,
    race: m.raceName,
    class: m.className,
    hp: m.hp + "/" + m.maxHp,
    mana: m.mana + "/" + m.maxMana,
    ac: m.ac,
    level: m.level,
  }));
}
