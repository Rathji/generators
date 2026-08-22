// Task #5: Stat & Experience Calculator — level curves, base/growth stats,
// equipment-modified effective stats.

export function xpToReach(level) {
  if (!Number.isFinite(level) || level <= 1) return 0;
  return Math.floor(((level - 1) * level) / 2) * 100;
}

export function levelForXp(xp) {
  let level = 1;
  while (xpToReach(level + 1) <= xp) level++;
  return level;
}

export function getBaseStats(classDef, level) {
  const lv = Math.max(1, Math.floor(level));
  return {
    maxHp: classDef.baseHp + classDef.hpPerLevel * (lv - 1),
    maxMp: classDef.baseMp + classDef.mpPerLevel * (lv - 1),
    str: classDef.baseStr + classDef.strPerLevel * (lv - 1),
    int: classDef.baseInt + classDef.intPerLevel * (lv - 1),
    agi: classDef.baseAgi + classDef.agiPerLevel * (lv - 1),
    def: classDef.baseDef + classDef.defPerLevel * (lv - 1),
    mdef: classDef.baseMdef + classDef.mdefPerLevel * (lv - 1),
  };
}

let _extraItemMods = null;
export function setExtraItemMods(fn) {
  _extraItemMods = fn ?? null;
}

// Task #128: layer temporary buff/debuff stat deltas onto effective stats.
let _extraBuffMods = null;
export function setExtraBuffMods(fn) {
  _extraBuffMods = fn ?? null;
}

// Task #132: final per-character stat hook (class passive modifiers).
let _extraStatHook = null;
export function setExtraStatHook(fn) {
  _extraStatHook = fn ?? null;
}

// Task #145: broken-gear hook — returns a Set of item ids whose stat mods
// should be suppressed (broken equipment stays equipped but grants nothing).
let _brokenItems = null;
export function setBrokenItems(fn) {
  _brokenItems = fn ?? null;
}

export function getEquipmentMods(equipment, itemDb, broken = null) {
  const mods = { atk: 0, hp: 0, mp: 0, str: 0, int: 0, agi: 0, def: 0, mdef: 0 };
  for (const itemId of Object.values(equipment)) {
    if (!itemId) continue;
    if (broken && broken.has(itemId)) continue; // Task #145
    const item = itemDb[itemId];
    if (!item || !item.mods) continue;
    for (const key in item.mods) mods[key] = (mods[key] || 0) + item.mods[key];
    // Task #176: enchantment mods (e.g. enchanted gear) layered on top.
    if (_extraItemMods) {
      const extra = _extraItemMods(itemId);
      if (extra) for (const key in extra) mods[key] = (mods[key] || 0) + extra[key];
    }
  }
  return mods;
}

export function getEffectiveStats(char, classDef, itemDb) {
  const base = getBaseStats(classDef, char.level);
  const broken = _brokenItems ? _brokenItems(char) : null;
  const mods = getEquipmentMods(char.equipment, itemDb, broken);
  const stats = {
    maxHp: base.maxHp + (mods.hp || 0),
    maxMp: base.maxMp + (mods.mp || 0),
    str: base.str + (mods.str || 0),
    int: base.int + (mods.int || 0),
    agi: base.agi + (mods.agi || 0),
    def: base.def + (mods.def || 0),
    mdef: base.mdef + (mods.mdef || 0),
    atk: mods.atk || 0,
  };
  // Task #128: temporary buff/debuff stat modifiers (Haste +AGI, etc).
  const buffMods = _extraBuffMods ? _extraBuffMods(char) : null;
  if (buffMods) {
    for (const key in buffMods) stats[key] = (stats[key] || 0) + buffMods[key];
  }
  // Task #132: class passive stat modifiers (warrior HP, mage MP, ...).
  return _extraStatHook ? _extraStatHook(stats, char) : stats;
}

export function canLevelUp(char, classDef) {
  return levelForXp(char.xp) > char.level;
}

export function applyLevelUp(char, classDef) {
  // Effective stat view (class-passive modifiers applied) so level-up HP/MP
  // growth and clamping match the max the character actually displays.
  const eff = (level) => {
    const s = getBaseStats(classDef, level);
    return _extraStatHook ? _extraStatHook({ ...s, atk: 0 }, char) : s;
  };
  const before = eff(char.level);
  char.level += 1;
  const after = eff(char.level);
  char.hp = Math.min(char.hp + (after.maxHp - before.maxHp), after.maxHp);
  char.mp = Math.min(char.mp + (after.maxMp - before.maxMp), after.maxMp);
  return {
    level: char.level,
    gained: {
      hp: after.maxHp - before.maxHp,
      mp: after.maxMp - before.maxMp,
      str: after.str - before.str,
      int: after.int - before.int,
      agi: after.agi - before.agi,
      def: after.def - before.def,
      mdef: after.mdef - before.mdef,
    },
  };
}

export function levelUpAll(char, classDef, maxLevel = 99) {
  const ups = [];
  while (canLevelUp(char, classDef) && char.level < maxLevel) {
    ups.push(applyLevelUp(char, classDef));
  }
  return ups;
}
