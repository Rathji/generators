// Task #30: Enemy Stat Templates — data-driven HP/MP/attack/defense plus
// elemental affinities, XP/gold rewards, and loot tables. Group definitions
// (Task #25) reference these templates.

export const ENEMIES = {
  goblin: {
    id: "goblin", name: "Goblin",
    hp: 18, mp: 0, str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1,
    xp: 12, gold: 18,
    elements: { weak: ["fire"] },
    loot: [{ itemId: "goblinFang", chance: 0.4 }],
  },
  imp: {
    id: "imp", name: "Imp",
    hp: 12, mp: 0, str: 5, atk: 3, int: 3, agi: 14, def: 1, mdef: 1,
    xp: 10, gold: 12,
    elements: {},
    loot: [],
  },
  wolf: {
    id: "wolf", name: "Wolf",
    hp: 22, mp: 0, str: 7, atk: 5, int: 1, agi: 9, def: 3, mdef: 1,
    xp: 16, gold: 20,
    elements: { weak: ["ice"] },
    loot: [],
  },
  caveBat: {
    id: "caveBat", name: "Cave Bat",
    hp: 14, mp: 0, str: 4, atk: 3, int: 1, agi: 16, def: 1, mdef: 1,
    xp: 9, gold: 8,
    elements: { weak: ["wind"] },
    loot: [],
  },
  zombie: {
    id: "zombie", name: "Zombie",
    hp: 28, mp: 0, str: 6, atk: 4, int: 1, agi: 3, def: 5, mdef: 4,
    xp: 22, gold: 26,
    elements: { weak: ["fire", "holy"], resist: ["ice"] },
    loot: [],
  },
  skeleton: {
    id: "skeleton", name: "Skeleton",
    hp: 24, mp: 0, str: 7, atk: 5, int: 2, agi: 6, def: 6, mdef: 3,
    xp: 20, gold: 24,
    elements: { weak: ["holy", "fire"], resist: ["ice"] },
    loot: [],
  },
  goblinChief: {
    id: "goblinChief", name: "Goblin Chief",
    hp: 60, mp: 8, str: 10, atk: 8, int: 4, agi: 8, def: 5, mdef: 2,
    xp: 80, gold: 120,
    elements: { resist: ["fire"] },
    loot: [{ itemId: "ironSword", chance: 1 }, { itemId: "goblinFang", chance: 0.5 }],
    ai: { spellChance: 0.35, spells: ["fire"] },
    boss: true,
    phases: [
      { below: 0.5, name: "Enraged", str: 4, atk: 3, agi: 3, ai: { spellChance: 0.7, spells: ["fire"] } },
    ],
  },
  garland: {
    id: "garland", name: "Garland",
    hp: 140, mp: 20, str: 14, atk: 10, int: 8, agi: 10, def: 8, mdef: 4,
    xp: 220, gold: 350,
    elements: { resist: ["fire"] },
    loot: [{ itemId: "mythrilSword", chance: 1 }],
    ai: { spellChance: 0.4, spells: ["fire", "thunder"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Roused", str: 3, atk: 2, agi: 2, ai: { spellChance: 0.5, spells: ["fire", "thunder"] } },
      { below: 0.33, name: "Enraged", str: 5, atk: 4, agi: 4, ai: { spellChance: 0.9, spells: ["fire", "thunder"] } },
    ],
  },
  knight: {
    id: "knight", name: "Knight",
    hp: 36, mp: 0, str: 10, atk: 7, int: 2, agi: 6, def: 9, mdef: 5,
    xp: 30, gold: 42,
    elements: { weak: ["thunder"], resist: ["holy"] },
    loot: [{ itemId: "ironSword", chance: 0.15 }],
  },
  ghost: {
    id: "ghost", name: "Ghost",
    hp: 26, mp: 0, str: 6, atk: 5, int: 6, agi: 12, def: 3, mdef: 8,
    xp: 26, gold: 30,
    elements: { weak: ["holy"], resist: ["ice", "thunder"], immune: ["fire"] },
    loot: [{ itemId: "spiritEssence", chance: 0.3 }],
  },
  flame: {
    id: "flame", name: "Flame",
    hp: 22, mp: 0, str: 7, atk: 6, int: 5, agi: 8, def: 2, mdef: 4,
    xp: 24, gold: 26,
    elements: { weak: ["ice", "water"], immune: ["fire"] },
    loot: [{ itemId: "ashEmber", chance: 0.35 }],
  },
  fireElemental: {
    id: "fireElemental", name: "Fire Elemental",
    hp: 58, mp: 12, str: 9, atk: 8, int: 9, agi: 7, def: 4, mdef: 8,
    xp: 90, gold: 110,
    elements: { weak: ["ice", "water"], immune: ["fire"] },
    loot: [{ itemId: "phoenixDown", chance: 0.5 }, { itemId: "ashEmber", chance: 0.6 }, { itemId: "fireGem", chance: 0.1 }],
    ai: { spellChance: 0.5, spells: ["fire"] },
  },
  marshCrab: {
    id: "marshCrab", name: "Marsh Crab",
    hp: 40, mp: 0, str: 8, atk: 6, int: 2, agi: 7, def: 7, mdef: 3,
    xp: 34, gold: 45,
    elements: { weak: ["thunder"] },
    loot: [],
  },
  swampSlime: {
    id: "swampSlime", name: "Swamp Slime",
    hp: 30, mp: 0, str: 6, atk: 5, int: 3, agi: 5, def: 4, mdef: 5,
    xp: 28, gold: 32,
    elements: { weak: ["fire"] },
    loot: [],
  },
  marshThing: {
    id: "marshThing", name: "Marsh Thing",
    hp: 46, mp: 0, str: 8, atk: 7, int: 4, agi: 4, def: 6, mdef: 6,
    xp: 38, gold: 48,
    elements: { weak: ["fire", "holy"], resist: ["ice"] },
    loot: [],
  },
  willOWisp: {
    id: "willOWisp", name: "Will-o'-Wisp",
    hp: 34, mp: 8, str: 6, atk: 5, int: 7, agi: 12, def: 3, mdef: 8,
    xp: 32, gold: 40,
    elements: { weak: ["water"], resist: ["fire"] },
    loot: [],
    ai: { spellChance: 0.3, spells: ["thunder"] },
  },
  marshGuardian: {
    id: "marshGuardian", name: "Marsh Guardian",
    hp: 220, mp: 30, str: 16, atk: 12, int: 10, agi: 8, def: 10, mdef: 8,
    xp: 320, gold: 480,
    elements: { weak: ["holy"], resist: ["ice"] },
    loot: [{ itemId: "crystalCharm", chance: 1 }],
    ai: { spellChance: 0.5, spells: ["poison"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Corrupted", str: 3, atk: 2, int: 2, ai: { spellChance: 0.6, spells: ["poison", "thunder"] } },
      { below: 0.33, name: "Enraged", str: 5, atk: 4, int: 4, agi: 3, ai: { spellChance: 0.85, spells: ["poison", "thunder", "blizzard"] } },
    ],
  },
  // Task #95: Mount Gulg mine & forge monsters.
  mineRat: {
    id: "mineRat", name: "Mine Rat",
    hp: 26, mp: 0, str: 5, atk: 4, int: 1, agi: 13, def: 2, mdef: 1,
    xp: 20, gold: 22,
    elements: { weak: ["lightning"] },
    loot: [],
  },
  golem: {
    id: "golem", name: "Golem",
    hp: 65, mp: 0, str: 9, atk: 7, int: 2, agi: 3, def: 10, mdef: 5,
    xp: 45, gold: 55,
    elements: { weak: ["water"], resist: ["fire", "earth"] },
    loot: [{ itemId: "goldNeedle", chance: 0.2 }],
  },
  lavaSlime: {
    id: "lavaSlime", name: "Lava Slime",
    hp: 42, mp: 0, str: 7, atk: 6, int: 3, agi: 6, def: 6, mdef: 6,
    xp: 40, gold: 48,
    elements: { weak: ["ice", "water"], immune: ["fire"] },
    loot: [],
  },
  dwarfBrigand: {
    id: "dwarfBrigand", name: "Dwarf Brigand",
    hp: 38, mp: 0, str: 8, atk: 7, int: 2, agi: 7, def: 6, mdef: 3,
    xp: 35, gold: 44,
    elements: { weak: ["lightning"] },
    loot: [],
  },
  forgeSpirit: {
    id: "forgeSpirit", name: "Forge Spirit",
    hp: 36, mp: 14, str: 6, atk: 5, int: 10, agi: 10, def: 4, mdef: 8,
    xp: 42, gold: 50,
    elements: { weak: ["ice", "water"], immune: ["fire"] },
    loot: [],
    ai: { spellChance: 0.5, spells: ["fire"] },
  },
  earthElemental: {
    id: "earthElemental", name: "Earth Elemental",
    hp: 70, mp: 16, str: 10, atk: 9, int: 8, agi: 4, def: 9, mdef: 8,
    xp: 60, gold: 72,
    elements: { weak: ["wind"], resist: ["earth"] },
    loot: [{ itemId: "soft", chance: 0.4 }],
    ai: { spellChance: 0.4, spells: ["quake"] },
  },
  // Task #96: Forge Golem — the third boss, guarding the Earth Crystal in the
  // Mount Gulg forge depths.
  forgeGolem: {
    id: "forgeGolem", name: "Forge Golem",
    hp: 300, mp: 20, str: 18, atk: 14, int: 6, agi: 4, def: 16, mdef: 10,
    xp: 420, gold: 620,
    elements: { weak: ["water"], resist: ["fire", "earth"], immune: ["poison"] },
    loot: [{ itemId: "powerGauntlet", chance: 1 }],
    ai: { spellChance: 0.35, spells: ["quake"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Molten Core", str: 3, atk: 2, def: 2, ai: { spellChance: 0.5, spells: ["quake", "fire"] } },
      { below: 0.33, name: "Rampant", str: 5, atk: 4, def: 3, agi: 2, ai: { spellChance: 0.7, spells: ["quake", "fira"] } },
    ],
  },
  // Task #98: Chaos Shrine fiends — the dark knight's chosen guardians.
  darkImp: {
    id: "darkImp", name: "Dark Imp",
    hp: 30, mp: 6, str: 6, atk: 5, int: 6, agi: 16, def: 3, mdef: 5,
    xp: 32, gold: 36,
    elements: { weak: ["holy"], resist: ["lightning"] },
    loot: [],
    ai: { spellChance: 0.2, spells: ["thunder"] },
  },
  fiendMinion: {
    id: "fiendMinion", name: "Fiend Minion",
    hp: 44, mp: 0, str: 9, atk: 8, int: 3, agi: 8, def: 7, mdef: 4,
    xp: 40, gold: 48,
    elements: { weak: ["holy", "fire"], resist: ["ice"] },
    loot: [],
  },
  chaosWraith: {
    id: "chaosWraith", name: "Chaos Wraith",
    hp: 52, mp: 12, str: 8, atk: 7, int: 9, agi: 12, def: 5, mdef: 10,
    xp: 55, gold: 60,
    elements: { weak: ["holy"], resist: ["ice", "lightning"], immune: ["poison"] },
    loot: [{ itemId: "phoenixDown", chance: 0.3 }],
    ai: { spellChance: 0.35, spells: ["blizzard"] },
  },
  darkKnight: {
    id: "darkKnight", name: "Dark Knight",
    hp: 70, mp: 8, str: 13, atk: 11, int: 4, agi: 6, def: 10, mdef: 6,
    xp: 65, gold: 80,
    elements: { weak: ["holy", "lightning"] },
    loot: [{ itemId: "ironSword", chance: 0.2 }],
    ai: { spellChance: 0.15, spells: ["fire"] },
  },
  sorcererFiend: {
    id: "sorcererFiend", name: "Sorcerer Fiend",
    hp: 55, mp: 24, str: 7, atk: 6, int: 13, agi: 9, def: 5, mdef: 9,
    xp: 75, gold: 90,
    elements: { weak: ["holy"], resist: ["ice", "fire"] },
    loot: [{ itemId: "elixir", chance: 0.15 }],
    ai: { spellChance: 0.6, spells: ["thunder", "blizzard", "hold"] },
  },
  // Task #103: Gnome Tunnels gearworks monsters — clockwork and soot, weaker
  // than Mount Gulg's forge but faster on the gears.
  gearWisp: {
    id: "gearWisp", name: "Gear Wisp",
    hp: 32, mp: 10, str: 6, atk: 5, int: 8, agi: 14, def: 3, mdef: 7,
    xp: 34, gold: 40,
    elements: { weak: ["lightning"], resist: ["wind"] },
    loot: [],
    ai: { spellChance: 0.35, spells: ["aero"] },
  },
  copperHound: {
    id: "copperHound", name: "Copper Hound",
    hp: 44, mp: 0, str: 9, atk: 7, int: 2, agi: 11, def: 6, mdef: 2,
    xp: 40, gold: 48,
    elements: { weak: ["lightning"], resist: ["earth"] },
    loot: [],
  },
  clockworkSentry: {
    id: "clockworkSentry", name: "Clockwork Sentry",
    hp: 40, mp: 0, str: 8, atk: 7, int: 3, agi: 5, def: 10, mdef: 5,
    xp: 44, gold: 52,
    elements: { weak: ["lightning"], immune: ["poison"] },
    loot: [{ itemId: "goldNeedle", chance: 0.2 }],
  },
  rustKnight: {
    id: "rustKnight", name: "Rust Knight",
    hp: 48, mp: 0, str: 11, atk: 9, int: 2, agi: 6, def: 11, mdef: 5,
    xp: 50, gold: 60,
    elements: { weak: ["lightning"], resist: ["holy"] },
    loot: [{ itemId: "ironSword", chance: 0.12 }],
  },
  tunnelTroll: {
    id: "tunnelTroll", name: "Tunnel Troll",
    hp: 58, mp: 0, str: 12, atk: 10, int: 2, agi: 4, def: 8, mdef: 4,
    xp: 55, gold: 66,
    elements: { weak: ["lightning", "fire"], resist: ["ice"] },
    loot: [],
  },
  // Task #117: Pravo Lighthouse monsters — the phantom light's motley: fire,
  // mist, and lost keepers haunting the tower.
  beaconMoth: {
    id: "beaconMoth", name: "Beacon Moth",
    hp: 42, mp: 0, str: 8, atk: 6, int: 3, agi: 16, def: 4, mdef: 4,
    xp: 36, gold: 42,
    elements: { weak: ["ice"], resist: ["wind"] },
    loot: [],
  },
  lampSpirit: {
    id: "lampSpirit", name: "Lamp Spirit",
    hp: 50, mp: 16, str: 7, atk: 6, int: 12, agi: 11, def: 5, mdef: 9,
    xp: 48, gold: 55,
    elements: { weak: ["ice", "water"], immune: ["fire"] },
    loot: [],
    ai: { spellChance: 0.45, spells: ["fire", "thunder"] },
  },
  flameWisp: {
    id: "flameWisp", name: "Flame Wisp",
    hp: 54, mp: 0, str: 9, atk: 8, int: 6, agi: 13, def: 4, mdef: 6,
    xp: 52, gold: 60,
    elements: { weak: ["ice", "water"], immune: ["fire"] },
    loot: [],
  },
  fogWraith: {
    id: "fogWraith", name: "Fog Wraith",
    hp: 58, mp: 0, str: 11, atk: 9, int: 4, agi: 9, def: 7, mdef: 6,
    xp: 56, gold: 66,
    elements: { weak: ["holy", "fire"] },
    loot: [],
  },
  keeperGhost: {
    id: "keeperGhost", name: "Keeper Ghost",
    hp: 66, mp: 12, str: 12, atk: 10, int: 8, agi: 8, def: 8, mdef: 8,
    xp: 64, gold: 76,
    elements: { weak: ["holy"], resist: ["ice"] },
    loot: [{ itemId: "phoenixDown", chance: 0.2 }, { itemId: "spiritEssence", chance: 0.5 }, { itemId: "holyGem", chance: 0.12 }],
    ai: { spellChance: 0.3, spells: ["blizzard"] },
  },
  // Task #115: Tide Serpent — the Sea Shrine's mid-game boss, coiled around
  // the Sunken Sanctum. Drops the Triton Harpoon and the Tide Key (which
  // unlocks the Drowned Vault).
  tideSerpent: {
    id: "tideSerpent", name: "Tide Serpent",
    hp: 320, mp: 40, str: 19, atk: 15, int: 10, agi: 9, def: 12, mdef: 10,
    xp: 460, gold: 700,
    elements: { weak: ["lightning"], resist: ["water", "ice"], immune: ["poison"] },
    loot: [{ itemId: "tritonHarpoon", chance: 1 }, { itemId: "tideKey", chance: 1 }],
    ai: { spellChance: 0.4, spells: ["blizzard", "hold"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Coiling", str: 3, atk: 2, agi: 2, ai: { spellChance: 0.55, spells: ["blizzard", "hold", "quake"] } },
      { below: 0.33, name: "Enraged", str: 5, atk: 4, agi: 3, ai: { spellChance: 0.75, spells: ["blizzaga", "hold", "quake"] } },
    ],
  },
  // Task #117: Phantom Light — the false beacon haunting the Pravo
  // Lighthouse's lamp room. Drops the Starlight Crest.
  phantomLight: {
    id: "phantomLight", name: "Phantom Light",
    hp: 300, mp: 40, str: 17, atk: 14, int: 12, agi: 12, def: 10, mdef: 11,
    xp: 430, gold: 640,
    elements: { weak: ["holy", "ice"], resist: ["fire"], immune: ["poison", "sleep"] },
    loot: [{ itemId: "starlightCrest", chance: 1 }, { itemId: "elixir", chance: 0.5 }],
    ai: { spellChance: 0.45, spells: ["firaga", "blizzard"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Flaring", str: 3, atk: 2, agi: 3, ai: { spellChance: 0.6, spells: ["firaga", "blizzard", "thunder"] } },
      { below: 0.33, name: "Blinding", str: 5, atk: 3, agi: 5, ai: { spellChance: 0.8, spells: ["firaga", "blizzaga", "thundaga"] } },
    ],
  },
  // Task #114: Sea Shrine monsters — coral, brine, and abyss dwellers of
  // Windfall's tide-washed shrine. Mid-game strength (tougher than the gnome
  // tunnels, weaker than the wind shrine), all weak to lightning.
  seaSlime: {
    id: "seaSlime", name: "Sea Slime",
    hp: 48, mp: 0, str: 9, atk: 7, int: 3, agi: 6, def: 6, mdef: 6,
    xp: 42, gold: 50,
    elements: { weak: ["lightning", "fire"], resist: ["water"] },
    loot: [],
  },
  coralCrab: {
    id: "coralCrab", name: "Coral Crab",
    hp: 55, mp: 0, str: 10, atk: 8, int: 2, agi: 8, def: 9, mdef: 4,
    xp: 48, gold: 58,
    elements: { weak: ["lightning"], resist: ["water"] },
    loot: [{ itemId: "goldNeedle", chance: 0.15 }, { itemId: "coralPearl", chance: 0.4 }],
  },
  tideEel: {
    id: "tideEel", name: "Tide Eel",
    hp: 62, mp: 0, str: 11, atk: 9, int: 3, agi: 15, def: 6, mdef: 5,
    xp: 55, gold: 64,
    elements: { weak: ["lightning"], resist: ["water"] },
    loot: [{ itemId: "wyrmScale", chance: 0.35 }],
  },
  brineMage: {
    id: "brineMage", name: "Brine Mage",
    hp: 58, mp: 20, str: 8, atk: 7, int: 13, agi: 9, def: 5, mdef: 10,
    xp: 62, gold: 72,
    elements: { weak: ["lightning", "holy"], resist: ["water"] },
    loot: [{ itemId: "cottage", chance: 0.1 }, { itemId: "coralPearl", chance: 0.3 }],
    ai: { spellChance: 0.5, spells: ["blizzard", "hold"] },
  },
  abyssStalker: {
    id: "abyssStalker", name: "Abyss Stalker",
    hp: 70, mp: 0, str: 13, atk: 11, int: 4, agi: 10, def: 8, mdef: 7,
    xp: 70, gold: 82,
    elements: { weak: ["lightning", "fire"] },
    loot: [],
  },
  // Task #107: Wind Shrine monsters — the sky's own guardians, toughest of
  // the regular monsters: swift, storm-born, and all weak to lightning.
  zephyrSprite: {
    id: "zephyrSprite", name: "Zephyr Sprite",
    hp: 62, mp: 14, str: 8, atk: 7, int: 12, agi: 20, def: 5, mdef: 9,
    xp: 110, gold: 130,
    elements: { weak: ["lightning"], resist: ["wind"] },
    loot: [],
    ai: { spellChance: 0.4, spells: ["aero"] },
  },
  gustHound: {
    id: "gustHound", name: "Gust Hound",
    hp: 68, mp: 0, str: 12, atk: 10, int: 3, agi: 14, def: 7, mdef: 4,
    xp: 95, gold: 110,
    elements: { weak: ["lightning", "ice"], resist: ["wind"] },
    loot: [],
  },
  cloudHarpy: {
    id: "cloudHarpy", name: "Cloud Harpy",
    hp: 72, mp: 0, str: 13, atk: 11, int: 4, agi: 15, def: 8, mdef: 6,
    xp: 115, gold: 135,
    elements: { weak: ["lightning"], resist: ["wind", "earth"] },
    loot: [{ itemId: "phoenixDown", chance: 0.2 }],
  },
  windElemental: {
    id: "windElemental", name: "Wind Elemental",
    hp: 80, mp: 26, str: 10, atk: 9, int: 16, agi: 12, def: 7, mdef: 12,
    xp: 140, gold: 160,
    elements: { weak: ["lightning"], resist: ["earth"], immune: ["wind"] },
    loot: [{ itemId: "aeroScroll", chance: 0.2 }],
    ai: { spellChance: 0.55, spells: ["aero", "fira"] },
  },
  skySerpent: {
    id: "skySerpent", name: "Sky Serpent",
    hp: 88, mp: 0, str: 15, atk: 13, int: 5, agi: 10, def: 9, mdef: 7,
    xp: 130, gold: 150,
    elements: { weak: ["lightning"], resist: ["water", "earth"] },
    loot: [{ itemId: "wyrmScale", chance: 0.4 }],
  },
  // Task #104: Iron Sentinel — the Engine Guardian, a colossal clockwork
  // colossus squatting on the airship engine in the tunnel vaults.
  ironSentinel: {
    id: "ironSentinel", name: "Iron Sentinel",
    hp: 260, mp: 30, str: 17, atk: 13, int: 8, agi: 6, def: 13, mdef: 9,
    xp: 380, gold: 560,
    elements: { weak: ["lightning", "ice"], resist: ["earth", "wind"], immune: ["poison"] },
    loot: [{ itemId: "airshipEngine", chance: 1 }],
    ai: { spellChance: 0.35, spells: ["quake", "thunder"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Overheating", str: 3, atk: 2, agi: 2, ai: { spellChance: 0.5, spells: ["quake", "thunder", "hold"] } },
      { below: 0.33, name: "Rampant", str: 5, atk: 4, agi: 3, ai: { spellChance: 0.7, spells: ["quake", "thundara", "hold"] } },
    ],
  },
  // Task #109: Wind Fiend — the post-game super boss of the Wind Shrine's
  // Sky Altar, beyond even Chaos in might. Immune to status, weak only to
  // lightning. Drops the legendary Wind Blade.
  windFiend: {
    id: "windFiend", name: "Wind Fiend",
    hp: 900, mp: 80, str: 28, atk: 22, int: 24, agi: 16, def: 14, mdef: 16,
    xp: 2000, gold: 3000,
    elements: {
      weak: ["lightning"],
      resist: ["fire", "ice", "earth", "water"],
      immune: ["poison", "sleep", "paralysis", "stone"],
    },
    loot: [{ itemId: "windBlade", chance: 1 }, { itemId: "elixir", chance: 1 }],
    ai: { spellChance: 0.55, spells: ["aero", "firaga", "blizzaga"] },
    boss: true,
    phases: [
      { below: 0.75, name: "Stormcaller", str: 2, agi: 3, ai: { spellChance: 0.6, spells: ["aero", "firaga", "blizzaga", "thundaga"] } },
      { below: 0.5, name: "Tempest", str: 4, atk: 2, agi: 4, ai: { spellChance: 0.7, spells: ["aero", "firaga", "blizzaga", "thundaga"] } },
      { below: 0.25, name: "Typhoon", str: 6, atk: 4, agi: 6, ai: { spellChance: 0.85, spells: ["aero", "firaga", "blizzaga", "thundaga", "nuke"] } },
    ],
  },
  // Task #99: Chaos — the final boss, master of the shrine and keeper of the
  // Wind Crystal.
  chaos: {
    id: "chaos", name: "Chaos",
    hp: 700, mp: 60, str: 24, atk: 18, int: 18, agi: 10, def: 14, mdef: 12,
    xp: 1200, gold: 2000,
    elements: {
      weak: ["holy"],
      resist: ["fire", "ice", "lightning", "earth", "wind", "water"],
      immune: ["poison", "sleep", "paralysis", "stone"],
    },
    loot: [{ itemId: "ribbon", chance: 1 }],
    ai: { spellChance: 0.5, spells: ["firaga", "blizzaga", "thundaga"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Roused", str: 3, atk: 2, int: 2, agi: 2, ai: { spellChance: 0.65, spells: ["firaga", "blizzaga", "thundaga"] } },
      { below: 0.33, name: "Enraged", str: 6, atk: 4, int: 4, agi: 4, ai: { spellChance: 0.85, spells: ["firaga", "blizzaga", "thundaga", "nuke"] } },
    ],
  },
  // Task #123: Ember Sanctum monsters — volcanic dwellers of the north-east
  // peaks, tougher than the sea arc and second only to the fiends. All are
  // weak to ice (melted by frost), and most resist fire.
  cinderBat: {
    id: "cinderBat", name: "Cinder Bat",
    hp: 66, mp: 0, str: 11, atk: 10, int: 3, agi: 18, def: 5, mdef: 5,
    xp: 60, gold: 70,
    elements: { weak: ["ice"], resist: ["fire"] },
    loot: [{ itemId: "ashEmber", chance: 0.3 }],
  },
  magmaSlime: {
    id: "magmaSlime", name: "Magma Slime",
    hp: 78, mp: 0, str: 12, atk: 10, int: 3, agi: 7, def: 10, mdef: 6,
    xp: 72, gold: 85,
    elements: { weak: ["ice"], resist: ["fire"], immune: ["poison"] },
    loot: [],
  },
  emberHound: {
    id: "emberHound", name: "Ember Hound",
    hp: 72, mp: 0, str: 14, atk: 12, int: 2, agi: 11, def: 7, mdef: 5,
    xp: 68, gold: 80,
    elements: { weak: ["ice"], resist: ["fire"] },
    loot: [],
  },
  flameSage: {
    id: "flameSage", name: "Flame Sage",
    hp: 70, mp: 24, str: 9, atk: 8, int: 16, agi: 10, def: 6, mdef: 11,
    xp: 78, gold: 95,
    elements: { weak: ["ice"], resist: ["fire"], immune: ["sleep"] },
    loot: [],
    ai: { spellChance: 0.5, spells: ["fira", "firaga"] },
  },
  basaltGolem: {
    id: "basaltGolem", name: "Basalt Golem",
    hp: 92, mp: 0, str: 15, atk: 13, int: 2, agi: 6, def: 13, mdef: 8,
    xp: 88, gold: 110,
    elements: { weak: ["ice", "holy"], resist: ["fire", "earth"], immune: ["poison", "paralysis"] },
    loot: [],
  },
  // Task #124: Ember Fiend — the queen of the Molten Core, mightier even
  // than the Wind Fiend. Weak only to frost and holy light. Drops the
  // Inferno Brand.
  emberFiend: {
    id: "emberFiend", name: "Ember Fiend",
    hp: 1000, mp: 90, str: 30, atk: 24, int: 26, agi: 18, def: 15, mdef: 17,
    xp: 2400, gold: 3500,
    elements: {
      weak: ["holy", "ice"],
      resist: ["fire", "earth", "water"],
      immune: ["poison", "sleep", "paralysis", "stone"],
    },
    loot: [{ itemId: "infernoBrand", chance: 1 }, { itemId: "elixir", chance: 1 }, { itemId: "phoenixDown", chance: 0.5 }],
    ai: { spellChance: 0.55, spells: ["firaga", "firaga", "nuke"] },
    boss: true,
    phases: [
      { below: 0.75, name: "Smoldering", str: 3, agi: 3, ai: { spellChance: 0.65, spells: ["firaga", "nuke", "blizzaga"] } },
      { below: 0.5, name: "Blazing", str: 5, atk: 3, int: 3, agi: 4, ai: { spellChance: 0.75, spells: ["firaga", "nuke", "blizzaga", "thundaga"] } },
      { below: 0.25, name: "Inferno", str: 7, atk: 4, int: 5, agi: 6, ai: { spellChance: 0.9, spells: ["firaga", "nuke", "blizzaga", "thundaga"] } },
    ],
  },
  // Task #144: Frozen Caverns monsters — the ice-born guardians of the
  // Glacier Isle's depths. Chilled to the bone, they all quail before fire
  // and shrug off frost and brine alike.
  frostBat: {
    id: "frostBat", name: "Frost Bat",
    hp: 64, mp: 0, str: 10, atk: 9, int: 3, agi: 17, def: 5, mdef: 5,
    xp: 58, gold: 68,
    elements: { weak: ["fire"], resist: ["ice"] },
    loot: [{ itemId: "frostShard", chance: 0.4 }],
  },
  snowWolf: {
    id: "snowWolf", name: "Snow Wolf",
    hp: 76, mp: 0, str: 13, atk: 11, int: 2, agi: 12, def: 7, mdef: 5,
    xp: 68, gold: 82,
    elements: { weak: ["fire"], resist: ["ice"] },
    loot: [{ itemId: "frostShard", chance: 0.3 }],
  },
  frostMage: {
    id: "frostMage", name: "Frost Mage",
    hp: 82, mp: 26, str: 9, atk: 8, int: 16, agi: 10, def: 6, mdef: 11,
    xp: 76, gold: 92,
    elements: { weak: ["fire", "holy"], resist: ["ice", "water"] },
    loot: [{ itemId: "cottage", chance: 0.1 }, { itemId: "iceGem", chance: 0.15 }],
    ai: { spellChance: 0.5, spells: ["blizzard", "blizzaga"] },
  },
  iceGolem: {
    id: "iceGolem", name: "Ice Golem",
    hp: 94, mp: 0, str: 14, atk: 12, int: 3, agi: 5, def: 13, mdef: 8,
    xp: 84, gold: 104,
    elements: { weak: ["fire"], resist: ["ice", "water", "earth"], immune: ["stone"] },
    loot: [{ itemId: "frostShard", chance: 0.5 }, { itemId: "iceGem", chance: 0.1 }],
  },
  glacierYeti: {
    id: "glacierYeti", name: "Glacier Yeti",
    hp: 106, mp: 0, str: 16, atk: 14, int: 3, agi: 7, def: 11, mdef: 7,
    xp: 94, gold: 120,
    elements: { weak: ["fire"], resist: ["ice"], immune: ["paralysis"] },
    loot: [],
  },
  // Task #145: Frost Wyrm — the glacier's ancient heart, coiled beneath the
  // Glacier Isle. It wakes only once the Forge Colossus falls and its embers
  // thaw the isle's ice. Weak only to fire and holy light; drops the
  // frost-scaled proof its hoard-guardian has truly fallen.
  frostWyrm: {
    id: "frostWyrm", name: "Frost Wyrm",
    hp: 880, mp: 70, str: 27, atk: 21, int: 22, agi: 12, def: 15, mdef: 13,
    xp: 1800, gold: 2700,
    elements: {
      weak: ["fire", "holy"],
      resist: ["ice", "water", "earth"],
      immune: ["poison", "sleep", "paralysis", "stone"],
    },
    loot: [{ itemId: "frostScale", chance: 1 }, { itemId: "elixir", chance: 0.5 }],
    ai: { spellChance: 0.5, spells: ["blizzaga", "quake"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Frostbitten", str: 3, agi: 2, ai: { spellChance: 0.6, spells: ["blizzaga", "quake", "thundaga"] } },
      { below: 0.33, name: "Glacial", str: 6, atk: 3, int: 3, agi: 3, ai: { spellChance: 0.8, spells: ["blizzaga", "quake", "thundaga", "nuke"] } },
    ],
  },
  // Task #153: Labyrinth of Time monsters — time-torn echoes from the rift
  // beneath the Dark Altar. The realm's toughest regular monsters: warped
  // by the void, all are unmade by the crystals' holy light.
  timeWraith: {
    id: "timeWraith", name: "Time Wraith",
    hp: 110, mp: 0, str: 15, atk: 13, int: 6, agi: 18, def: 8, mdef: 10,
    xp: 100, gold: 130,
    elements: { weak: ["holy", "lightning"], resist: ["fire", "ice"] },
    loot: [{ itemId: "voidShard", chance: 0.35 }],
  },
  riftHound: {
    id: "riftHound", name: "Rift Hound",
    hp: 118, mp: 0, str: 17, atk: 15, int: 2, agi: 13, def: 9, mdef: 6,
    xp: 110, gold: 140,
    elements: { weak: ["holy", "lightning"], resist: ["wind"] },
    loot: [],
  },
  chronoSprite: {
    id: "chronoSprite", name: "Chrono Sprite",
    hp: 112, mp: 30, str: 10, atk: 9, int: 20, agi: 16, def: 7, mdef: 13,
    xp: 115, gold: 150,
    elements: { weak: ["holy", "lightning"], resist: ["fire", "ice"] },
    loot: [{ itemId: "ether", chance: 0.15 }],
    ai: { spellChance: 0.55, spells: ["fira", "blizzaga"] },
  },
  voidGolem: {
    id: "voidGolem", name: "Void Golem",
    hp: 128, mp: 0, str: 18, atk: 16, int: 3, agi: 6, def: 15, mdef: 10,
    xp: 130, gold: 170,
    elements: { weak: ["holy"], resist: ["fire", "ice", "water", "earth"], immune: ["stone"] },
    loot: [{ itemId: "voidShard", chance: 0.5 }, { itemId: "voidGem", chance: 0.15 }],
  },
  hourglassBeast: {
    id: "hourglassBeast", name: "Hourglass Beast",
    hp: 140, mp: 0, str: 20, atk: 17, int: 4, agi: 8, def: 12, mdef: 8,
    xp: 150, gold: 200,
    elements: { weak: ["holy"], resist: ["earth", "water"], immune: ["sleep"] },
    loot: [],
  },
  // Task #154: Chrono, the Keeper of Time — the ultimate fiend coiled at the
  // heart of the Labyrinth of Time, the wound behind every fiend of the
  // age. Beyond even the Ember Fiend; weak only to the crystals' holy
  // light. Drops the eternal blade of legend.
  chrono: {
    id: "chrono", name: "Chrono, the Keeper of Time",
    hp: 1300, mp: 100, str: 32, atk: 26, int: 28, agi: 20, def: 18, mdef: 18,
    xp: 3000, gold: 5000,
    elements: {
      weak: ["holy"],
      resist: ["fire", "ice", "earth", "water", "wind", "lightning"],
      immune: ["poison", "sleep", "paralysis", "stone"],
    },
    loot: [{ itemId: "eternalBlade", chance: 1 }, { itemId: "elixir", chance: 1 }, { itemId: "phoenixDown", chance: 0.5 }],
    ai: { spellChance: 0.6, spells: ["nuke", "thundaga"] },
    boss: true,
    phases: [
      { below: 0.75, name: "Unraveling", str: 3, agi: 2, ai: { spellChance: 0.7, spells: ["nuke", "thundaga", "blizzaga"] } },
      { below: 0.5, name: "Stalling", str: 5, atk: 3, int: 3, agi: 3, ai: { spellChance: 0.8, spells: ["nuke", "thundaga", "blizzaga", "firaga"] } },
      { below: 0.25, name: "Eternity", str: 7, atk: 4, int: 5, agi: 5, ai: { spellChance: 0.9, spells: ["nuke", "thundaga", "blizzaga", "firaga", "quake"] } },
    ],
  },
  // Task #133: Dwarven Forge monsters — the metal-hearted guardians of
  // Dwarfholm's sacred smithy. All are conductors: weak to lightning, and
  // they shrug off the mountain's earth.
  forgeMite: {
    id: "forgeMite", name: "Forge Mite",
    hp: 60, mp: 0, str: 9, atk: 8, int: 2, agi: 16, def: 6, mdef: 4,
    xp: 52, gold: 62,
    elements: { weak: ["lightning"], resist: ["earth"] },
    loot: [],
  },
  hammerBeast: {
    id: "hammerBeast", name: "Hammer Beast",
    hp: 78, mp: 0, str: 13, atk: 12, int: 2, agi: 8, def: 8, mdef: 5,
    xp: 66, gold: 78,
    elements: { weak: ["lightning"], resist: ["earth"] },
    loot: [],
  },
  oreGolem: {
    id: "oreGolem", name: "Ore Golem",
    hp: 84, mp: 0, str: 12, atk: 10, int: 3, agi: 5, def: 12, mdef: 6,
    xp: 70, gold: 84,
    elements: { weak: ["lightning"], resist: ["earth", "fire"], immune: ["poison"] },
    loot: [{ itemId: "runeShard", chance: 0.35 }],
  },
  runeSentinel: {
    id: "runeSentinel", name: "Rune Sentinel",
    hp: 88, mp: 10, str: 11, atk: 9, int: 10, agi: 9, def: 9, mdef: 10,
    xp: 76, gold: 92,
    elements: { weak: ["lightning"], resist: ["fire", "earth"], immune: ["sleep"] },
    loot: [{ itemId: "runeShard", chance: 0.45 }, { itemId: "thunderGem", chance: 0.1 }],
    ai: { spellChance: 0.35, spells: ["thunder", "thundara"] },
  },
  deepTroll: {
    id: "deepTroll", name: "Deep Troll",
    hp: 96, mp: 0, str: 15, atk: 13, int: 3, agi: 6, def: 11, mdef: 6,
    xp: 84, gold: 105,
    elements: { weak: ["lightning", "fire"], resist: ["earth"], immune: ["poison"] },
    loot: [],
  },
  // Task #134: Forge Colossus — the ancient guardian of the Dwarven Forge's
  // adamantite seams, a walking mountain of runed iron. Drops the raw
  // Adamantite Ore the surface blacksmith needs.
  forgeColossus: {
    id: "forgeColossus", name: "Forge Colossus",
    hp: 850, mp: 40, str: 26, atk: 20, int: 12, agi: 7, def: 16, mdef: 11,
    xp: 1600, gold: 2400,
    elements: {
      weak: ["lightning", "holy"],
      resist: ["fire", "earth"],
      immune: ["poison", "sleep", "paralysis", "stone"],
    },
    loot: [{ itemId: "adamantiteOre", chance: 1 }, { itemId: "elixir", chance: 0.5 }],
    ai: { spellChance: 0.4, spells: ["quake", "thundara"] },
    boss: true,
    phases: [
      { below: 0.66, name: "Cracking", str: 4, atk: 3, ai: { spellChance: 0.55, spells: ["quake", "thundara", "thundaga"] } },
      { below: 0.33, name: "Rampaging", str: 7, atk: 5, agi: 3, ai: { spellChance: 0.75, spells: ["quake", "thundaga", "nuke"] } },
    ],
  },
  // Task #191: the Echo of Creation — the hollow at the hall's edge, and the
  // age before the crystals themselves. The mightiest foe in the game: only
  // a party that has lived the world twice (New Game+ cycle 2+) can face it,
  // and the New Game+ scaling makes it worse still.
  echoOfCreation: {
    id: "echoOfCreation", name: "The Echo of Creation",
    hp: 1800, mp: 120, str: 40, atk: 34, int: 34, agi: 26, def: 24, mdef: 24,
    xp: 4000, gold: 6000,
    elements: {
      weak: [],
      resist: ["fire", "ice", "earth", "water", "wind", "lightning", "holy"],
      immune: ["poison", "sleep", "paralysis", "stone"],
    },
    loot: [{ itemId: "shatteredBlade", chance: 1 }, { itemId: "elixir", chance: 1 }, { itemId: "megalixir", chance: 0.5 }],
    ai: { spellChance: 0.7, spells: ["nuke", "quake"] },
    boss: true,
    phases: [
      { below: 0.75, name: "Resonance", str: 4, atk: 3, int: 3, agi: 3, ai: { spellChance: 0.8, spells: ["nuke", "quake", "thundaga"] } },
      { below: 0.5, name: "Harmonic", str: 6, atk: 4, int: 5, agi: 5, ai: { spellChance: 0.9, spells: ["nuke", "quake", "thundaga", "blizzaga"] } },
      { below: 0.25, name: "Genesis", str: 9, atk: 6, int: 7, agi: 6, ai: { spellChance: 0.95, spells: ["nuke", "quake", "thundaga", "blizzaga", "firaga"] } },
    ],
  },
  // Task #170: coastal monsters — the sea-touched beasts that prowl the
  // overworld paths to Pravog's eastern coast.
  seaGull: {
    id: "seaGull", name: "Sea Gull",
    hp: 14, mp: 0, str: 4, atk: 3, int: 1, agi: 13, def: 1, mdef: 1,
    xp: 8, gold: 6,
    elements: { weak: ["fire"] },
    loot: [],
  },
  shoreCrab: {
    id: "shoreCrab", name: "Shore Crab",
    hp: 26, mp: 0, str: 6, atk: 5, int: 2, agi: 6, def: 6, mdef: 2,
    xp: 14, gold: 16,
    elements: { weak: ["lightning"], resist: ["water"] },
    loot: [{ itemId: "coralPearl", chance: 0.25 }],
  },
  reefSerpent: {
    id: "reefSerpent", name: "Reef Serpent",
    hp: 32, mp: 0, str: 8, atk: 6, int: 3, agi: 11, def: 4, mdef: 3,
    xp: 20, gold: 24,
    elements: { weak: ["ice"], resist: ["water"] },
    loot: [{ itemId: "coralPearl", chance: 0.3 }],
  },
  tideRaider: {
    id: "tideRaider", name: "Tide Raider",
    hp: 38, mp: 0, str: 9, atk: 8, int: 3, agi: 8, def: 5, mdef: 3,
    xp: 30, gold: 44,
    elements: { weak: ["fire"] },
    loot: [{ itemId: "potion", chance: 0.4 }, { itemId: "goldNeedle", chance: 0.15 }],
  },
  coastWraith: {
    id: "coastWraith", name: "Coast Wraith",
    hp: 30, mp: 0, str: 7, atk: 7, int: 6, agi: 5, def: 4, mdef: 6,
    xp: 34, gold: 30,
    elements: { weak: ["holy"], resist: ["ice"] },
    loot: [{ itemId: "spiritEssence", chance: 0.35 }],
  },
  // Task #175: Ice Cave monsters — the cold-hearted beasts of the wastes'
  // frozen depths. All favor the cold and fear fire.
  iceBat: {
    id: "iceBat", name: "Ice Bat",
    hp: 16, mp: 0, str: 4, atk: 4, int: 1, agi: 15, def: 2, mdef: 2,
    xp: 14, gold: 12,
    elements: { weak: ["fire"], resist: ["ice"] },
    loot: [],
  },
  crystalWisp: {
    id: "crystalWisp", name: "Crystal Wisp",
    hp: 24, mp: 8, str: 5, atk: 5, int: 8, agi: 9, def: 3, mdef: 7,
    xp: 26, gold: 30,
    elements: { weak: ["fire"], resist: ["ice"], immune: ["stone"] },
    loot: [{ itemId: "frostShard", chance: 0.4 }, { itemId: "iceGem", chance: 0.1 }],
    ai: { spellChance: 0.3, spells: ["blizzard"] },
  },
  frostWraith: {
    id: "frostWraith", name: "Frost Wraith",
    hp: 44, mp: 10, str: 8, atk: 8, int: 7, agi: 7, def: 5, mdef: 8,
    xp: 40, gold: 48,
    elements: { weak: ["fire"], resist: ["ice"] },
    loot: [{ itemId: "spiritEssence", chance: 0.3 }, { itemId: "frostShard", chance: 0.3 }],
    ai: { spellChance: 0.35, spells: ["blizzard"] },
  },
  // Task #180: the Southern Jungles' monsters — the green's tooth and claw,
  // the ruins' insect swarms, and the moss-draped dead beneath the stones.
  jungleBoar: {
    id: "jungleBoar", name: "Jungle Boar",
    hp: 34, mp: 0, str: 7, atk: 6, int: 1, agi: 7, def: 5, mdef: 2,
    xp: 16, gold: 14,
    elements: { weak: ["ice"], resist: ["fire"] },
    loot: [{ itemId: "jungleHerb", chance: 0.3 }],
  },
  jungleViper: {
    id: "jungleViper", name: "Jungle Viper",
    hp: 22, mp: 0, str: 5, atk: 5, int: 1, agi: 14, def: 3, mdef: 2,
    xp: 18, gold: 16,
    elements: { weak: ["ice"], resist: ["earth"] },
    loot: [{ itemId: "venomSack", chance: 0.35 }],
  },
  venomWasp: {
    id: "venomWasp", name: "Venom Wasp",
    hp: 16, mp: 0, str: 4, atk: 4, int: 1, agi: 16, def: 2, mdef: 1,
    xp: 15, gold: 10,
    elements: { weak: ["wind"], resist: ["earth"] },
    loot: [{ itemId: "venomSack", chance: 0.4 }],
  },
  carrionBeetle: {
    id: "carrionBeetle", name: "Carrion Beetle",
    hp: 46, mp: 0, str: 8, atk: 8, int: 1, agi: 4, def: 8, mdef: 2,
    xp: 22, gold: 20,
    elements: { weak: ["wind"], resist: ["earth"] },
    loot: [{ itemId: "beetleShell", chance: 0.5 }],
  },
  vineToad: {
    id: "vineToad", name: "Vine Toad",
    hp: 38, mp: 6, str: 6, atk: 6, int: 4, agi: 5, def: 4, mdef: 4,
    xp: 19, gold: 15,
    elements: { weak: ["fire"], resist: ["ice"] },
    loot: [{ itemId: "mossSpore", chance: 0.35 }],
    ai: { spellChance: 0.25, spells: ["poison"] },
  },
  sporeToad: {
    id: "sporeToad", name: "Spore Toad",
    hp: 30, mp: 8, str: 5, atk: 5, int: 5, agi: 6, def: 3, mdef: 5,
    xp: 24, gold: 22,
    elements: { weak: ["fire"], resist: ["ice"] },
    loot: [{ itemId: "mossSpore", chance: 0.5 }],
    ai: { spellChance: 0.3, spells: ["poison"] },
  },
  mossMummy: {
    id: "mossMummy", name: "Moss Mummy",
    hp: 52, mp: 0, str: 9, atk: 9, int: 1, agi: 3, def: 7, mdef: 6,
    xp: 28, gold: 30,
    elements: { weak: ["fire"], resist: ["ice"], immune: ["poison", "sleep", "stone"] },
    loot: [{ itemId: "spiritEssence", chance: 0.25 }, { itemId: "mossSpore", chance: 0.3 }],
  },
  mossWraith: {
    id: "mossWraith", name: "Moss Wraith",
    hp: 34, mp: 8, str: 7, atk: 7, int: 7, agi: 8, def: 4, mdef: 7,
    xp: 32, gold: 26,
    elements: { weak: ["holy"], resist: ["ice"] },
    loot: [{ itemId: "spiritEssence", chance: 0.3 }],
    ai: { spellChance: 0.3, spells: ["aero"] },
  },
  ruinScarab: {
    id: "ruinScarab", name: "Ruin Scarab",
    hp: 40, mp: 0, str: 7, atk: 7, int: 1, agi: 6, def: 9, mdef: 3,
    xp: 26, gold: 28,
    elements: { weak: ["ice"], resist: ["earth"], immune: ["poison"] },
    loot: [{ itemId: "beetleShell", chance: 0.5 }],
  },
  // Task #185: the Highland Peak's monsters — the wind's birds and the
  // storm-savants that sing the summit's weather.
  highlandWolf: {
    id: "highlandWolf", name: "Highland Wolf",
    hp: 42, mp: 0, str: 8, atk: 8, int: 1, agi: 9, def: 4, mdef: 2,
    xp: 30, gold: 25,
    elements: { weak: ["ice"], resist: ["fire"] },
    loot: [],
  },
  stormHawk: {
    id: "stormHawk", name: "Storm Hawk",
    hp: 36, mp: 0, str: 8, atk: 8, int: 1, agi: 13, def: 3, mdef: 3,
    xp: 34, gold: 30,
    elements: { weak: ["ice"], resist: ["wind"] },
    loot: [{ itemId: "stormFeather", chance: 0.4 }],
  },
  thunderVulture: {
    id: "thunderVulture", name: "Thunder Vulture",
    hp: 46, mp: 0, str: 9, atk: 9, int: 1, agi: 10, def: 5, mdef: 4,
    xp: 38, gold: 34,
    elements: { weak: ["ice"], resist: ["wind"] },
    loot: [{ itemId: "stormFeather", chance: 0.5 }],
  },
  galeWisp: {
    id: "galeWisp", name: "Gale Wisp",
    hp: 28, mp: 10, str: 6, atk: 6, int: 8, agi: 12, def: 3, mdef: 8,
    xp: 40, gold: 36,
    elements: { weak: ["ice"], resist: ["wind"], immune: ["poison"] },
    loot: [{ itemId: "galeEssence", chance: 0.35 }],
    ai: { spellChance: 0.35, spells: ["aero", "thunder"] },
  },
  windWraith: {
    id: "windWraith", name: "Wind Wraith",
    hp: 40, mp: 8, str: 8, atk: 8, int: 7, agi: 8, def: 4, mdef: 8,
    xp: 42, gold: 38,
    elements: { weak: ["holy"], resist: ["wind"] },
    loot: [{ itemId: "spiritEssence", chance: 0.35 }, { itemId: "galeEssence", chance: 0.2 }],
    ai: { spellChance: 0.3, spells: ["aero"] },
  },
  highlandBrigand: {
    id: "highlandBrigand", name: "Highland Brigand",
    hp: 50, mp: 0, str: 10, atk: 10, int: 1, agi: 7, def: 5, mdef: 2,
    xp: 36, gold: 45,
    elements: { weak: ["lightning"] },
    loot: [{ itemId: "potion", chance: 0.3 }, { itemId: "goldNeedle", chance: 0.1 }],
  },
  stormShaman: {
    id: "stormShaman", name: "Storm Shaman",
    hp: 44, mp: 12, str: 7, atk: 7, int: 9, agi: 8, def: 4, mdef: 7,
    xp: 48, gold: 50,
    elements: { weak: ["ice"], resist: ["wind"] },
    loot: [{ itemId: "ether", chance: 0.3 }, { itemId: "galeEssence", chance: 0.3 }],
    ai: { spellChance: 0.4, spells: ["thunder", "aero", "hold"] },
  },
  peakGolem: {
    id: "peakGolem", name: "Peak Golem",
    hp: 90, mp: 0, str: 12, atk: 12, int: 1, agi: 3, def: 10, mdef: 6,
    xp: 60, gold: 70,
    elements: { weak: ["lightning"], resist: ["wind", "ice"], immune: ["poison", "paralysis", "stone"] },
    loot: [{ itemId: "thunderGem", chance: 0.2 }, { itemId: "galeEssence", chance: 0.4 }],
  },
};

export const ENEMY_GROUPS = {
  goblins: [{ id: "goblin", count: 2 }],
  imp_pack: [{ id: "imp", count: 3 }],
  wild_beasts: [{ id: "wolf", count: 1 }, { id: "imp", count: 1 }],
  bandits: [{ id: "goblin", count: 2 }, { id: "imp", count: 1 }],
  cave_dwellers: [{ id: "zombie", count: 2 }],
  cave_pack: [{ id: "caveBat", count: 2 }, { id: "imp", count: 1 }],
  goblin_brigade: [{ id: "goblin", count: 1 }, { id: "goblinChief", count: 1 }],
  garland_ambush: [{ id: "garland", count: 1 }],
  castle_guard: [{ id: "knight", count: 2 }],
  haunted_halls: [{ id: "ghost", count: 2 }, { id: "skeleton", count: 1 }],
  volcanic_spirits: [{ id: "flame", count: 2 }, { id: "fireElemental", count: 1 }],
  fire_swarm: [{ id: "flame", count: 3 }],
  marsh_dwellers: [{ id: "marshThing", count: 2 }],
  swamp_pack: [{ id: "swampSlime", count: 2 }, { id: "marshCrab", count: 1 }],
  crab_claws: [{ id: "marshCrab", count: 2 }, { id: "willOWisp", count: 1 }],
  wisp_swarm: [{ id: "willOWisp", count: 3 }],
  marsh_guardian: [{ id: "marshGuardian", count: 1 }],
  // Task #95: Mount Gulg mine & forge groups.
  mine_pack: [{ id: "mineRat", count: 2 }, { id: "goblin", count: 1 }],
  forge_brigands: [{ id: "dwarfBrigand", count: 2 }],
  lava_pack: [{ id: "lavaSlime", count: 2 }],
  elemental_rustlers: [{ id: "earthElemental", count: 1 }, { id: "forgeSpirit", count: 1 }],
  gulg_guardian: [{ id: "forgeGolem", count: 1 }],
  // Task #98: Chaos Shrine groups.
  dark_minions: [{ id: "darkImp", count: 2 }, { id: "fiendMinion", count: 1 }],
  shadow_pack: [{ id: "chaosWraith", count: 2 }, { id: "darkImp", count: 1 }],
  dark_crusade: [{ id: "darkKnight", count: 2 }],
  fiend_cabal: [{ id: "sorcererFiend", count: 1 }, { id: "fiendMinion", count: 2 }],
  chaos_guard: [{ id: "chaos", count: 1 }],
  // Task #103: Gnome Tunnels groups.
  gear_swarm: [{ id: "gearWisp", count: 2 }, { id: "copperHound", count: 1 }],
  sentry_pack: [{ id: "clockworkSentry", count: 2 }],
  tunnel_trolls: [{ id: "tunnelTroll", count: 1 }, { id: "mineRat", count: 1 }],
  rust_brigade: [{ id: "rustKnight", count: 2 }, { id: "dwarfBrigand", count: 1 }],
  iron_sentinel_guard: [{ id: "ironSentinel", count: 1 }],
  // Task #107: Wind Shrine groups.
  zephyr_pack: [{ id: "zephyrSprite", count: 2 }],
  harpy_flight: [{ id: "cloudHarpy", count: 2 }, { id: "zephyrSprite", count: 1 }],
  sky_serpents: [{ id: "skySerpent", count: 1 }, { id: "gustHound", count: 1 }],
  wind_templars: [{ id: "windElemental", count: 1 }, { id: "cloudHarpy", count: 1 }],
  wind_fiend_guard: [{ id: "windFiend", count: 1 }],
  // Task #114: Sea Shrine groups.
  tide_pack: [{ id: "seaSlime", count: 2 }, { id: "coralCrab", count: 1 }],
  reef_guard: [{ id: "coralCrab", count: 2 }, { id: "brineMage", count: 1 }],
  eel_drift: [{ id: "tideEel", count: 2 }],
  abyss_hunters: [{ id: "abyssStalker", count: 1 }, { id: "tideEel", count: 1 }],
  tide_serpent_guard: [{ id: "tideSerpent", count: 1 }],
  // Task #117: Lighthouse groups.
  phantom_swarm: [{ id: "flameWisp", count: 2 }, { id: "beaconMoth", count: 1 }],
  wisp_drift: [{ id: "lampSpirit", count: 1 }, { id: "flameWisp", count: 1 }],
  wraith_watch: [{ id: "fogWraith", count: 2 }],
  keeper_chorus: [{ id: "keeperGhost", count: 1 }, { id: "fogWraith", count: 1 }],
  phantom_light_guard: [{ id: "phantomLight", count: 1 }],
  // Task #123: Ember Sanctum groups.
  ember_swarm: [{ id: "cinderBat", count: 2 }, { id: "emberHound", count: 1 }],
  lava_crawlers: [{ id: "magmaSlime", count: 2 }, { id: "basaltGolem", count: 1 }],
  cinder_guard: [{ id: "emberHound", count: 2 }, { id: "basaltGolem", count: 1 }],
  pyre_cabal: [{ id: "flameSage", count: 1 }, { id: "cinderBat", count: 1 }, { id: "emberHound", count: 1 }],
  // Task #124: Ember Fiend guard.
  ember_fiend_guard: [{ id: "emberFiend", count: 1 }],
  // Task #133: Dwarven Forge groups.
  forge_drones: [{ id: "forgeMite", count: 2 }, { id: "hammerBeast", count: 1 }],
  hall_guardians: [{ id: "oreGolem", count: 1 }, { id: "runeSentinel", count: 1 }],
  deep_pack: [{ id: "deepTroll", count: 1 }, { id: "hammerBeast", count: 1 }],
  rune_wardens: [{ id: "runeSentinel", count: 2 }],
  // Task #134: Forge Colossus guard.
  forge_colossus_guard: [{ id: "forgeColossus", count: 1 }],
  // Task #144: Frozen Caverns groups.
  frost_swarm: [{ id: "frostBat", count: 2 }, { id: "snowWolf", count: 1 }],
  ice_pack: [{ id: "snowWolf", count: 2 }, { id: "glacierYeti", count: 1 }],
  rime_cabal: [{ id: "frostMage", count: 1 }, { id: "iceGolem", count: 1 }],
  ice_wardens: [{ id: "iceGolem", count: 2 }],
  frost_hunters: [{ id: "glacierYeti", count: 1 }, { id: "frostBat", count: 1 }],
  // Task #145: Frost Wyrm guard.
  frost_wyrm_guard: [{ id: "frostWyrm", count: 1 }],
  // Task #153: Labyrinth of Time groups.
  rift_pack: [{ id: "timeWraith", count: 2 }, { id: "riftHound", count: 1 }],
  chrono_cabal: [{ id: "chronoSprite", count: 1 }, { id: "timeWraith", count: 1 }],
  void_wardens: [{ id: "voidGolem", count: 1 }, { id: "riftHound", count: 1 }],
  sand_hunters: [{ id: "hourglassBeast", count: 1 }, { id: "chronoSprite", count: 1 }],
  rift_swarm: [{ id: "timeWraith", count: 3 }],
  // Task #154: Chrono's guard.
  chrono_guard: [{ id: "chrono", count: 1 }],
  // Task #191: the Echo of Creation — guardian of the cycle's end.
  echo_creation: [{ id: "echoOfCreation", count: 1 }],
  // Task #170: coastal groups — sea birds, crabs, serpents, and raiders.
  gull_flock: [{ id: "seaGull", count: 3 }],
  shore_crabs: [{ id: "shoreCrab", count: 2 }, { id: "marshCrab", count: 1 }],
  reef_serpents: [{ id: "reefSerpent", count: 2 }, { id: "seaGull", count: 1 }],
  tide_raiders: [{ id: "tideRaider", count: 1 }, { id: "shoreCrab", count: 1 }],
  coast_wraiths: [{ id: "coastWraith", count: 2 }, { id: "reefSerpent", count: 1 }],
  // Task #175: Ice Cave groups — the frozen depths' cold-hearted hunters.
  ice_cave_pack: [{ id: "iceBat", count: 2 }, { id: "snowWolf", count: 1 }],
  crystal_swarm: [{ id: "crystalWisp", count: 2 }, { id: "iceBat", count: 1 }],
  wraith_cabal: [{ id: "frostWraith", count: 1 }, { id: "crystalWisp", count: 1 }],
  // Task #180: Southern Jungle groups — beasts, insects, and the ruins' dead.
  jungle_beasts: [{ id: "jungleBoar", count: 2 }, { id: "jungleViper", count: 1 }],
  insect_swarm: [{ id: "venomWasp", count: 3 }],
  vine_drakes: [{ id: "vineToad", count: 2 }, { id: "jungleViper", count: 1 }],
  mushroom_folk: [{ id: "sporeToad", count: 2 }, { id: "mossMummy", count: 1 }],
  ruin_undead: [{ id: "mossMummy", count: 2 }, { id: "mossWraith", count: 1 }],
  scarab_horde: [{ id: "ruinScarab", count: 3 }, { id: "carrionBeetle", count: 1 }],
  moss_creepers: [{ id: "vineToad", count: 1 }, { id: "sporeToad", count: 1 }, { id: "mossWraith", count: 1 }],
  // Task #185: Highland Peak groups — the wind's birds and storm-savants.
  highland_wolves: [{ id: "highlandWolf", count: 2 }],
  cliff_hawks: [{ id: "stormHawk", count: 2 }, { id: "thunderVulture", count: 1 }],
  hill_bandits: [{ id: "highlandBrigand", count: 2 }],
  wind_wraiths: [{ id: "windWraith", count: 2 }, { id: "galeWisp", count: 1 }],
  hawk_flight: [{ id: "stormHawk", count: 2 }, { id: "thunderVulture", count: 2 }],
  gale_wisps: [{ id: "galeWisp", count: 3 }],
  storm_cabal: [{ id: "stormShaman", count: 1 }, { id: "windWraith", count: 1 }, { id: "galeWisp", count: 1 }],
  wind_guardians: [{ id: "peakGolem", count: 2 }],
};
