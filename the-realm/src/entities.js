export const CLASSES = {
  warrior: {
    name: 'Warrior', color: '#d4543a', colorDark: '#a23a26',
    desc: 'A stalwart fighter. High health and crushing melee blows. The first into any fray.',
    str: 11, dex: 7, int: 4, spi: 5, hpMul: 1.35, speed: 2.7,
    startWeapon: 'shortsword', startArmor: 'cloth',
    ability: { name: 'Power Strike', icon: '⚡', cost: 12, type: 'melee', mult: 2.1, desc: 'A mighty blow dealing double weapon damage.' }
  },
  rogue: {
    name: 'Rogue', color: '#2e8f86', colorDark: '#1f6b63',
    desc: 'A quick shadow. Fast attacks, deadly from behind, and able to poison the unwary.',
    str: 7, dex: 13, int: 6, spi: 5, hpMul: 1.0, speed: 3.3,
    startWeapon: 'dagger', startArmor: 'cloth', backstab: true,
    ability: { name: 'Poison Blade', icon: '☠', cost: 14, type: 'melee', dot: 9, dotTicks: 5, desc: 'Poisons the target, dealing damage over time.' }
  },
  wizard: {
    name: 'Wizard', color: '#6d4fa8', colorDark: '#50368a',
    desc: 'A master of the arcane. Frail, but scorches foes with firebolts from afar.',
    str: 4, dex: 6, int: 13, spi: 8, hpMul: 0.75, speed: 2.4,
    startWeapon: 'staff', startArmor: 'cloth',
    ability: { name: 'Firebolt', icon: '🔥', cost: 10, type: 'ranged', range: 8, dmg: 12, dmgPerInt: 1.8, castTime: 0.45, desc: 'Hurls a bolt of flame. The wizard\u2019s bread and butter.' }
  },
  cleric: {
    name: 'Cleric', color: '#e8d287', colorDark: '#c0a64f',
    desc: 'A servant of the gods. Sturdy with mace in hand, and blessed with healing light.',
    str: 8, dex: 5, int: 8, spi: 11, hpMul: 1.15, speed: 2.5,
    startWeapon: 'mace', startArmor: 'cloth',
    ability: { name: 'Heal', icon: '✚', cost: 15, type: 'self', heal: 55, healPerSpi: 3.5, castTime: 0.5, desc: 'Mends your wounds with holy light.' }
  },
  monk: {
    name: 'Monk', color: '#c8742f', colorDark: '#a05a1e',
    desc: 'A disciplined brawler. Strikes with blazing fists and calms his mind to endure.',
    str: 9, dex: 11, int: 5, spi: 7, hpMul: 1.1, speed: 3.0,
    startWeapon: 'fists', startArmor: 'cloth',
    ability: { name: 'Meditate', icon: '🧘', cost: 12, type: 'self', regen: 14, desc: 'Centers the mind: rapid health and mana regeneration for a time.' }
  },
  druid: {
    name: 'Druid', color: '#3d9a55', colorDark: '#2c7540',
    desc: 'A child of the wilds. Hardy with club and fang, entangling foes in living roots.',
    str: 8, dex: 7, int: 7, spi: 9, hpMul: 1.05, speed: 2.8,
    startWeapon: 'club', startArmor: 'cloth',
    ability: { name: 'Entangle', icon: '🌿', cost: 12, type: 'ranged', range: 5, root: 3.5, dot: 5, dotTicks: 4, desc: 'Roots the target in place, rending it with thorns.' }
  },
};

export const WEAPONS = {
  fists:      { name: 'Fists',        kind: 'weapon', dmg: [2, 5],   speed: 0.5, icon: '✊', color: '#c8a878' },
  dagger:     { name: 'Dagger',       kind: 'weapon', dmg: [3, 7],   speed: 0.5, icon: '🗡', color: '#cfd3da' },
  club:       { name: 'Club',         kind: 'weapon', dmg: [4, 8],   speed: 0.8, icon: '🪵', color: '#8a6f4d' },
  staff:      { name: 'Staff',        kind: 'weapon', dmg: [2, 6],   speed: 0.8, icon: '🪄', color: '#9a7a4a' },
  shortsword: { name: 'Shortsword',   kind: 'weapon', dmg: [5, 9],   speed: 0.7, icon: '⚔', color: '#cfd3da' },
  mace:       { name: 'Mace',         kind: 'weapon', dmg: [5, 10],  speed: 0.9, icon: '🔨', color: '#9aa0a8' },
  broadsword: { name: 'Broadsword',   kind: 'weapon', dmg: [7, 13],  speed: 0.8, icon: '🗡️', color: '#cfd3da' },
  waraxe:     { name: 'War Axe',      kind: 'weapon', dmg: [9, 16],  speed: 1.0, icon: '🪓', color: '#8f9aa8' },
  longsword:  { name: 'Longsword',    kind: 'weapon', dmg: [11, 18], speed: 0.9, icon: '⚔️', color: '#e8ecf2' },
  greatsword: { name: 'Greatsword',   kind: 'weapon', dmg: [15, 24], speed: 1.2, icon: '⚔️', color: '#e8ecf2' },
};

export const ARMORS = {
  cloth: { name: 'Cloth Robe',  kind: 'armor', armor: 1, icon: '👕' },
  leather: { name: 'Leather',   kind: 'armor', armor: 2, icon: '🦺' },
  chain: { name: 'Chainmail',   kind: 'armor', armor: 4, icon: '🛡️' },
  plate: { name: 'Plate Armor', kind: 'armor', armor: 6, icon: '🛡️' },
  dragon: { name: 'Dragonscale', kind: 'armor', armor: 8, icon: '🐉' },
};

export const FOOD = {
  apple:  { name: 'Apple',        kind: 'food', heal: 12, icon: '🍎' },
  bread:  { name: 'Bread',        kind: 'food', heal: 20, icon: '🍞' },
  cheese: { name: 'Cheese',       kind: 'food', heal: 30, icon: '🧀' },
  meat:   { name: 'Cooked Meat',  kind: 'food', heal: 45, icon: '🍖' },
};

export const ITEMS = { ...WEAPONS, ...ARMORS, ...FOOD };

export const MONSTERS = {
  rat:      { name: 'Rat',          hp: 12,  dmg: [2, 4],   xp: 8,   radius: 0.28, speed: 1.7, aggro: 4.0, gold: [1, 4],  loot: 0.06, shape: 'rat', color: '#8a8178' },
  beetle:   { name: 'Beetle',       hp: 18,  dmg: [3, 6],   xp: 12,  radius: 0.32, speed: 1.5, aggro: 3.5, gold: [2, 6],  loot: 0.07, shape: 'beetle', color: '#4a5d3a' },
  wolf:     { name: 'Wolf',         hp: 28,  dmg: [5, 9],   xp: 22,  radius: 0.34, speed: 2.4, aggro: 6.0, gold: [3, 9],  loot: 0.09, shape: 'wolf', color: '#6b6f76' },
  goblin:   { name: 'Goblin',       hp: 34,  dmg: [6, 10],  xp: 30,  radius: 0.32, speed: 2.0, aggro: 5.5, gold: [4, 12], loot: 0.10, shape: 'goblin', color: '#5f8f3f' },
  spider:   { name: 'Giant Spider', hp: 40,  dmg: [7, 12],  xp: 40,  radius: 0.30, speed: 2.4, aggro: 5.0, gold: [4, 14], loot: 0.10, shape: 'spider', color: '#3a3a4a' },
  skeleton: { name: 'Skeleton',     hp: 45,  dmg: [8, 13],  xp: 45,  radius: 0.32, speed: 2.1, aggro: 5.5, gold: [6, 16], loot: 0.12, shape: 'skeleton', color: '#d8d2c0' },
  orc:      { name: 'Orc',          hp: 60,  dmg: [10, 16], xp: 65,  radius: 0.36, speed: 2.2, aggro: 6.0, gold: [8, 20], loot: 0.14, shape: 'orc', color: '#4a5f2e' },
  shadow:   { name: 'Shadow',       hp: 75,  dmg: [12, 18], xp: 95,  radius: 0.32, speed: 2.6, aggro: 7.0, gold: [10, 22], loot: 0.13, shape: 'shadow', color: '#2a2340' },
  ogre:     { name: 'Ogre',         hp: 90,  dmg: [14, 22], xp: 110, radius: 0.42, speed: 1.9, aggro: 6.5, gold: [12, 30], loot: 0.16, shape: 'ogre', color: '#7d6a5f' },
  troll:    { name: 'Troll',        hp: 130, dmg: [18, 28], xp: 160, radius: 0.44, speed: 1.9, aggro: 7.0, gold: [16, 40], loot: 0.18, shape: 'troll', color: '#3f7d4f' },
  dragon:   { name: 'Dragon',       hp: 220, dmg: [22, 35], xp: 350, radius: 0.50, speed: 2.1, aggro: 8.0, gold: [40, 90], loot: 0.55, shape: 'dragon', color: '#8f2f2f' },
};

export const MONSTER_ORDER = ['rat', 'beetle', 'wolf', 'goblin', 'spider', 'skeleton', 'orc', 'shadow', 'ogre', 'troll', 'dragon'];
export const TIER_OF = {};
for (let i = 0; i < MONSTER_ORDER.length; i++) TIER_OF[MONSTER_ORDER[i]] = i;

const TIER_WEAPONS = [
  ['dagger', 'club', 'staff'],
  ['dagger', 'club', 'shortsword'],
  ['shortsword', 'mace', 'broadsword'],
  ['broadsword', 'waraxe'],
  ['longsword', 'greatsword'],
];
const TIER_ARMOR = [
  ['cloth'],
  ['leather'],
  ['leather', 'chain'],
  ['chain', 'plate'],
  ['plate', 'dragon'],
];

export function rollLoot(mkey, rnd){
  const m = MONSTERS[mkey];
  const tier = Math.min(TIER_OF[mkey], 4);
  const drops = [];
  if (rnd() < m.loot){
    if (rnd() < 0.55){
      const pool = TIER_WEAPONS[tier];
      drops.push(pool[(rnd() * pool.length) | 0]);
    } else {
      const pool = TIER_ARMOR[tier];
      drops.push(pool[(rnd() * pool.length) | 0]);
    }
  }
  if (rnd() < 0.22){
    const pool = ['apple', 'bread', 'bread', 'cheese', 'meat'];
    drops.push(pool[(rnd() * pool.length) | 0]);
  }
  return drops;
}

export function xpToNext(lvl){ return Math.round(60 * Math.pow(lvl, 1.5)); }

export function computeStats(cls, lvl){
  const cd = CLASSES[cls];
  const str = cd.str + Math.floor((lvl - 1) / 3);
  const dex = cd.dex + Math.floor((lvl - 1) / 4);
  const intv = cd.int + Math.floor((lvl - 1) / 4);
  const spi = cd.spi + Math.floor((lvl - 1) / 4);
  const maxHp = Math.round((56 + lvl * 9 + str * 2.2) * cd.hpMul);
  const maxMp = Math.round((cd.int * 3.5 + cd.spi * 2 + lvl * 2.5));
  return { str, dex, int: intv, spi, maxHp, maxMp, speed: cd.speed };
}

export function rollDamage(weapon, str, rnd){
  const w = WEAPONS[weapon];
  const dmg = w.dmg[0] + rnd() * (w.dmg[1] - w.dmg[0]);
  return Math.max(1, Math.round(dmg + str * 0.5));
}

export function rollHit(dex){
  return Math.min(0.95, Math.max(0.6, 0.86 + dex * 0.01 - 0.06));
}

export function playerBackstabBonus(player, monster){
  if (!CLASSES[player.cls].backstab) return 1;
  const dx = player.x - monster.x, dy = player.y - monster.y;
  const toPlayer = Math.atan2(dy, dx);
  let diff = Math.abs(toPlayer - monster.facing);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff > 1.9 ? 1.5 : 1;
}
