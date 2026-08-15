export const RESOURCES = [
  { id: 'gold', name: 'Gold', color: '#e8c04a', icon: 'gold' },
  { id: 'wood', name: 'Wood', color: '#a9713b', icon: 'wood' },
  { id: 'ore', name: 'Ore', color: '#8f929b', icon: 'ore' },
  { id: 'gems', name: 'Gems', color: '#4fd6c8', icon: 'gems' },
  { id: 'crystal', name: 'Crystal', color: '#c76cf0', icon: 'crystal' },
  { id: 'sulfur', name: 'Sulfur', color: '#e0d23c', icon: 'sulfur' },
  { id: 'mercury', name: 'Mercury', color: '#e0604a', icon: 'mercury' },
];

export const RES_BY_ID = Object.fromEntries(RESOURCES.map(r => [r.id, r]));

// ---------------- Factions ----------------
export const FACTIONS = {
  castle: { name: 'Castle', color: '#4a7fd6', desc: 'Human kingdom. Balanced, well-armored troops.' },
  rampart: { name: 'Rampart', color: '#5aa05a', desc: 'Forest realm. Swift elves and mighty dragons.' },
  necropolis: { name: 'Necropolis', color: '#8a5fc4', desc: 'Undead horde. Tireless horrors.' },
  stronghold: { name: 'Stronghold', color: '#c6483e', desc: 'Orc tribes. Brute force and heavy hitters.' },
};

// ---------------- Creatures ----------------
// atk, def, dmg:[min,max], hp, speed, cost:{gold}, growth, special[]
// special: 'ranged' | 'fly' | 'noRetaliation' | 'charge' | 'doubleAttack' | 'regenerate' | 'ignoreDefense' | 'heals'
const C = (id, faction, tier, name, atk, def, dmg, hp, speed, cost, growth, upgrade = null, special = []) =>
  ({ id, faction, tier, name, atk, def, dmg, hp, speed, cost: { gold: cost }, growth, upgrade, special });

export const CREATURES = {};
export const ALL_CREATURES = [
  // ------- Castle -------
  C('peasant', 'castle', 1, 'Peasant', 2, 1, [1, 2], 4, 4, 40, 14, 'militia'),
  C('militia', 'castle', 1, 'Militia', 3, 2, [2, 3], 6, 5, 60, 14),
  C('archer', 'castle', 2, 'Archer', 4, 3, [2, 4], 12, 4, 120, 9, 'crossbowman', ['ranged']),
  C('crossbowman', 'castle', 2, 'Crossbowman', 6, 5, [3, 5], 16, 5, 180, 9, null, ['ranged']),
  C('pikeman', 'castle', 3, 'Pikeman', 6, 6, [4, 7], 20, 5, 220, 7, 'halberdier'),
  C('halberdier', 'castle', 3, 'Halberdier', 7, 8, [5, 9], 26, 6, 320, 7),
  C('swordsman', 'castle', 4, 'Swordsman', 8, 8, [6, 9], 35, 5, 500, 4, 'champion'),
  C('champion', 'castle', 4, 'Champion', 10, 11, [8, 12], 50, 6, 700, 4),
  C('cleric', 'castle', 5, 'Cleric', 9, 8, [8, 12], 45, 6, 850, 3, 'bishop', ['heals']),
  C('bishop', 'castle', 5, 'Bishop', 11, 10, [10, 15], 60, 7, 1200, 3, null, ['heals']),
  C('cavalier', 'castle', 6, 'Cavalier', 12, 11, [15, 20], 70, 8, 1700, 2, 'knight', ['charge']),
  C('knight', 'castle', 6, 'Knight', 14, 13, [20, 25], 90, 9, 2500, 2, null, ['charge']),
  C('angel', 'castle', 7, 'Angel', 15, 14, [30, 45], 180, 10, 4000, 1, 'archangel', ['fly']),
  C('archangel', 'castle', 7, 'Archangel', 18, 16, [40, 55], 250, 11, 6000, 1, null, ['fly', 'heals']),

  // ------- Rampart -------
  C('sprite', 'rampart', 1, 'Sprite', 2, 1, [1, 3], 3, 7, 50, 14, 'pixie', ['fly']),
  C('pixie', 'rampart', 1, 'Pixie', 3, 2, [2, 4], 5, 9, 80, 14, null, ['fly']),
  C('elf', 'rampart', 2, 'Elf', 4, 2, [2, 4], 10, 6, 110, 9, 'elfwarrior', ['ranged']),
  C('elfwarrior', 'rampart', 2, 'Elf Warrior', 6, 4, [3, 6], 15, 7, 180, 9, null, ['ranged']),
  C('centaur', 'rampart', 3, 'Centaur', 6, 4, [5, 8], 20, 6, 230, 7, 'centaurlord'),
  C('centaurlord', 'rampart', 3, 'Centaur Lord', 7, 6, [7, 10], 30, 7, 330, 7),
  C('unicorn', 'rampart', 4, 'Unicorn', 8, 9, [7, 11], 35, 6, 550, 4, 'warunicorn'),
  C('warunicorn', 'rampart', 4, 'War Unicorn', 10, 12, [10, 15], 50, 7, 800, 4),
  C('treant', 'rampart', 5, 'Treant', 9, 11, [8, 14], 55, 4, 850, 3, 'ancienttreant'),
  C('ancienttreant', 'rampart', 5, 'Ancient Treant', 10, 14, [10, 16], 70, 4, 1300, 3),
  C('pegasus', 'rampart', 6, 'Pegasus', 12, 11, [12, 18], 75, 8, 1800, 2, 'royalpegasus', ['fly']),
  C('royalpegasus', 'rampart', 6, 'Royal Pegasus', 14, 13, [16, 22], 100, 10, 2800, 2, null, ['fly']),
  C('dragon', 'rampart', 7, 'Dragon', 15, 15, [30, 50], 200, 9, 4200, 1, 'emeralddragon', ['fly']),
  C('emeralddragon', 'rampart', 7, 'Emerald Dragon', 18, 17, [40, 60], 280, 10, 6500, 1, null, ['fly']),

  // ------- Necropolis -------
  C('skeleton', 'necropolis', 1, 'Skeleton', 3, 2, [1, 3], 6, 4, 50, 14, 'skeletonwarrior'),
  C('skeletonwarrior', 'necropolis', 1, 'Skeleton Warrior', 4, 3, [2, 4], 8, 5, 80, 14),
  C('zombie', 'necropolis', 2, 'Zombie', 2, 4, [1, 3], 15, 3, 110, 9, 'plaguezombie'),
  C('plaguezombie', 'necropolis', 2, 'Plague Zombie', 3, 6, [2, 4], 20, 4, 170, 9),
  C('wight', 'necropolis', 3, 'Wight', 6, 5, [4, 7], 18, 5, 220, 7, 'wraith', ['noRetaliation']),
  C('wraith', 'necropolis', 3, 'Wraith', 7, 6, [6, 9], 25, 7, 320, 7, null, ['noRetaliation']),
  C('vampire', 'necropolis', 4, 'Vampire', 8, 6, [7, 11], 35, 5, 550, 4, 'vampirelord', ['noRetaliation']),
  C('vampirelord', 'necropolis', 4, 'Vampire Lord', 9, 8, [9, 14], 45, 6, 850, 4, null, ['noRetaliation', 'regenerate']),
  C('lich', 'necropolis', 5, 'Lich', 9, 9, [10, 14], 45, 6, 850, 3, 'powerlich', ['ranged']),
  C('powerlich', 'necropolis', 5, 'Power Lich', 11, 11, [12, 17], 60, 7, 1300, 3, null, ['ranged']),
  C('blackknight', 'necropolis', 6, 'Black Knight', 12, 11, [15, 22], 70, 7, 1800, 2, 'dreadknight', ['doubleAttack']),
  C('dreadknight', 'necropolis', 6, 'Dread Knight', 14, 13, [20, 30], 90, 8, 2800, 2, null, ['doubleAttack']),
  C('bonedragon', 'necropolis', 7, 'Bone Dragon', 14, 13, [30, 40], 170, 9, 4000, 1, 'ghostdragon', ['fly']),
  C('ghostdragon', 'necropolis', 7, 'Ghost Dragon', 16, 15, [35, 50], 240, 10, 6200, 1, null, ['fly']),

  // ------- Stronghold -------
  C('goblin', 'stronghold', 1, 'Goblin', 2, 1, [1, 3], 5, 5, 40, 14, 'hobgoblin'),
  C('hobgoblin', 'stronghold', 1, 'Hobgoblin', 3, 2, [2, 4], 7, 6, 70, 14),
  C('orc', 'stronghold', 2, 'Orc', 4, 3, [3, 5], 12, 4, 130, 9, 'orcchief', ['ranged']),
  C('orcchief', 'stronghold', 2, 'Orc Chief', 6, 5, [4, 7], 18, 5, 200, 9, null, ['ranged']),
  C('wolfrider', 'stronghold', 3, 'Wolf Rider', 6, 4, [5, 8], 22, 7, 240, 7, 'wolfchief'),
  C('wolfchief', 'stronghold', 3, 'Wolf Chief', 7, 5, [7, 10], 30, 8, 350, 7),
  C('ogre', 'stronghold', 4, 'Ogre', 7, 7, [6, 10], 40, 4, 500, 4, 'ogremage'),
  C('ogremage', 'stronghold', 4, 'Ogre Mage', 8, 8, [8, 12], 55, 5, 750, 4),
  C('troll', 'stronghold', 5, 'Troll', 8, 9, [8, 13], 50, 5, 900, 3, 'wartroll', ['regenerate']),
  C('wartroll', 'stronghold', 5, 'War Troll', 10, 11, [10, 16], 70, 6, 1400, 3, null, ['regenerate']),
  C('cyclops', 'stronghold', 6, 'Cyclops', 12, 10, [18, 25], 80, 7, 1700, 2, 'cyclopsking', ['ranged']),
  C('cyclopsking', 'stronghold', 6, 'Cyclops King', 14, 12, [22, 30], 100, 7, 2600, 2, null, ['ranged']),
  C('behemoth', 'stronghold', 7, 'Behemoth', 15, 13, [30, 40], 160, 6, 4000, 1, 'ancientbehemoth', ['ignoreDefense']),
  C('ancientbehemoth', 'stronghold', 7, 'Ancient Behemoth', 17, 15, [35, 50], 230, 7, 6000, 1, null, ['ignoreDefense']),
];

for (const c of ALL_CREATURES) CREATURES[c.id] = c;
export const creatureById = id => CREATURES[id];
export const factionCreatures = faction => ALL_CREATURES.filter(c => c.faction === faction && c.upgrade !== null);
export const upgradedById = id => CREATURES[id]?.upgrade ? CREATURES[id].upgrade : null;
export const baseById = id => { let c = CREATURES[id]; while (c && c.upgrade) c = CREATURES[c.upgrade]; return c; };

// ---------------- Buildings ----------------
// townhall chain gives gold/day; growthMult boosts weekly growth.
export const CORE_BUILDINGS = [
  { id: 'townhall', name: 'Town Hall', cost: { gold: 1000, wood: 5 }, income: 500, desc: 'Produces +500 gold/day' },
  { id: 'cityhall', name: 'City Hall', cost: { gold: 2500, ore: 5 }, income: 1000, requires: ['townhall'], desc: 'Produces +1000 gold/day' },
  { id: 'capitol', name: 'Capitol', cost: { gold: 5000, wood: 10, ore: 10 }, income: 2000, requires: ['cityhall'], desc: 'Produces +2000 gold/day' },
  { id: 'mages1', name: 'Mage Guild I', cost: { gold: 1000, wood: 5 }, requires: ['townhall'], spellsLevel: 1, desc: 'Teaches basic spells' },
  { id: 'mages2', name: 'Mage Guild II', cost: { gold: 1500, ore: 5, gems: 2 }, requires: ['mages1'], spellsLevel: 2, desc: 'Teaches stronger spells' },
  { id: 'mages3', name: 'Mage Guild III', cost: { gold: 2000, crystal: 2, mercury: 2 }, requires: ['mages2'], spellsLevel: 3, desc: 'Teaches powerful spells' },
  { id: 'fort', name: 'Fort', cost: { gold: 2000, wood: 10, ore: 10 }, requires: ['townhall'], growthMult: 0.25, desc: '+25% weekly growth' },
  { id: 'citadel', name: 'Citadel', cost: { gold: 4000, wood: 15, ore: 15 }, requires: ['fort'], growthMult: 0.5, desc: '+50% weekly growth' },
  { id: 'castle', name: 'Castle', cost: { gold: 8000, wood: 20, ore: 20 }, requires: ['citadel'], growthMult: 1.0, desc: '+100% weekly growth' },
  { id: 'tavern', name: 'Tavern', cost: { gold: 1500, wood: 5 }, requires: ['townhall'], desc: 'Allows buying new heroes' },
];

const DWELLING_COSTS = [
  { gold: 400, wood: 5 },
  { gold: 700, wood: 5, ore: 5 },
  { gold: 1000, wood: 5, ore: 5 },
  { gold: 1600, ore: 10 },
  { gold: 2500, ore: 10, crystal: 2 },
  { gold: 4000, ore: 15, gems: 2 },
  { gold: 8000, ore: 20, crystal: 5 },
];
const DWELLING_UP_COSTS = [
  { gold: 500, wood: 5 },
  { gold: 800, wood: 5, ore: 5 },
  { gold: 1200, wood: 5, ore: 5 },
  { gold: 2000, ore: 10, gems: 2 },
  { gold: 3000, ore: 10, crystal: 3 },
  { gold: 5000, ore: 15, gems: 4 },
  { gold: 9000, ore: 20, crystal: 8 },
];

export function buildingsFor(faction) {
  const out = [];
  for (const b of CORE_BUILDINGS) out.push({ ...b });
  const creatures = factionCreatures(faction);
  creatures.forEach((c, i) => {
    const tier = i + 1;
    out.push({
      id: `dwelling${tier}`, name: `${c.name} Dwelling`, cost: { ...DWELLING_COSTS[i] },
      requires: tier > 1 ? [`dwelling${tier - 1}`] : ['townhall'],
      provides: c.id, tier, desc: `Recruit ${c.name}s. Weekly growth ${c.growth}`,
    });
    if (c.upgrade) {
      const u = CREATURES[c.upgrade];
      out.push({
        id: `dwelling${tier}u`, name: `${u.name} Dwelling`, cost: { ...DWELLING_UP_COSTS[i] },
        requires: [`dwelling${tier}`], providesUpgrade: c.id, tier, desc: `Upgrade ${c.name} -> ${u.name}`,
      });
    }
  });
  return out;
}

// ---------------- Spells ----------------
export const SPELLS = {
  magarrow: { id: 'magarrow', name: 'Magic Arrow', level: 1, mana: 5, target: 'enemy', dmg: (p) => 12 + p * 20, desc: 'Hurls a bolt of magic at one stack' },
  heal: { id: 'heal', name: 'Heal', level: 1, mana: 5, target: 'ally', heal: (p) => 15 + p * 18, desc: 'Restores one friendly stack' },
  haste: { id: 'haste', name: 'Haste', level: 1, mana: 6, target: 'ally', buff: { speed: 2 }, turns: 2, desc: '+2 speed for 2 rounds' },
  slow: { id: 'slow', name: 'Slow', level: 1, mana: 6, target: 'enemy', buff: { speed: -2 }, turns: 2, desc: '-2 speed for 2 rounds' },
  bless: { id: 'bless', name: 'Bless', level: 2, mana: 6, target: 'ally', buff: { dmgMult: 0.25 }, turns: 3, desc: '+25% damage for 3 rounds' },
  curse: { id: 'curse', name: 'Curse', level: 2, mana: 6, target: 'enemy', buff: { dmgMult: -0.25 }, turns: 3, desc: '-25% damage for 3 rounds' },
  shield: { id: 'shield', name: 'Shield', level: 2, mana: 7, target: 'ally', buff: { dmgTaken: -0.2 }, turns: 3, desc: 'Takes 20% less damage for 3 rounds' },
  fireball: { id: 'fireball', name: 'Fireball', level: 3, mana: 9, target: 'enemy', aoe: true, dmg: (p) => 15 + p * 15, desc: 'Blast that hits the target and adjacent stacks' },
};
export const GUILD_SPELLS = [
  ['magarrow', 'heal', 'haste', 'slow'],
  ['bless', 'curse', 'shield'],
  ['fireball'],
];

// ---------------- Skills ----------------
export const SKILLS = {
  offense: { name: 'Offense', desc: 'Increases melee damage dealt', max: 3, eff: l => 1 + l * 0.08 },
  archery: { name: 'Archery', desc: 'Increases ranged damage dealt', max: 3, eff: l => 1 + l * 0.1 },
  armorer: { name: 'Armorer', desc: 'Reduces damage taken', max: 3, eff: l => 1 - l * 0.08 },
  logistics: { name: 'Logistics', desc: 'More movement points per day', max: 3, eff: l => 1 + l * 0.15 },
  sorcery: { name: 'Sorcery', desc: 'Stronger spells', max: 3, eff: l => 1 + l * 0.1 },
  intelligence: { name: 'Intelligence', desc: 'More spell points', max: 3, eff: l => 1 + l * 0.25 },
  luck: { name: 'Luck', desc: 'Chance to deal double damage', max: 3, eff: l => l * 0.05 },
  estates: { name: 'Estates', desc: 'Extra gold per day', max: 3, eff: l => l * 200 },
  pathfinding: { name: 'Pathfinding', desc: 'Cheaper terrain movement', max: 3, eff: l => 1 - l * 0.15 },
};

// ---------------- Terrain ----------------
export const TERRAIN = {
  grass: { name: 'Grass', cost: 100, colors: ['#55823a', '#5d8d40', '#4f7b35'] },
  dirt: { name: 'Dirt', cost: 100, colors: ['#96763f', '#a07f45', '#8c6e3a'] },
  sand: { name: 'Sand', cost: 150, colors: ['#c2a75f', '#cdb268', '#b89d58'] },
  snow: { name: 'Snow', cost: 150, colors: ['#dde3ec', '#e8edf4', '#d2d9e3'] },
  water: { name: 'Water', cost: -1, colors: ['#234f86', '#275793', '#20487d'] },
  rock: { name: 'Mountain', cost: -1, colors: ['#5d5d66', '#666670', '#55555e'] },
  trees: { name: 'Forest', cost: 150, colors: ['#376b29', '#3f752d', '#306224'] },
};
export const TERRAIN_BY_ID = TERRAIN;

// ---------------- Hero names ----------------
export const HERO_NAMES = {
  castle: ['Arielle', 'Valerius', 'Kathleen', 'Edmund', 'Sylvia', 'Rowan'],
  rampart: ['Meriel', 'Corwyn', 'Elowen', 'Thorn', 'Aisling', 'Fenwick'],
  necropolis: ['Morta', 'Vesper', 'Drake', 'Lilith', 'Morbus', 'Nyx'],
  stronghold: ['Gorm', 'Krag', 'Ursa', 'Vanka', 'Brokk', 'Torga'],
};

// ---------------- Misc balance ----------------
export const MOVEMENT_BASE = 1400;
export const XP_PER_LEVEL = 1000;
export const HERO_STATS_BASE = { atk: 2, def: 2, pow: 1, know: 1 };
export const START_ARMY = [
  { id: 'peasant', count: 14 }, { id: 'archer', count: 9 }, { id: 'pikeman', count: 5 },
];
export const HERO_BUY_COST = { gold: 2500 };
export const TOWN_HERO_START_ARMY = [
  { id: 'sprite', count: 10 }, { id: 'elf', count: 6 },
];
