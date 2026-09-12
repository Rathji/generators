export const GRID = { cols: 16, rows: 10, cell: 62 };

export const SPEEDS = [1, 2, 3];

export const DIFFICULTIES = {
  easy: { key: "easy", name: "Easy", hp: 0.8, bounty: 1.15, lives: 25, score: 0.8, spawn: 1.15 },
  normal: { key: "normal", name: "Normal", hp: 1, bounty: 1, lives: 20, score: 1, spawn: 1 },
  hard: { key: "hard", name: "Hard", hp: 1.35, bounty: 0.9, lives: 15, score: 1.35, spawn: 0.85 },
};

export const TOWERS = [
  {
    id: "blaster",
    name: "Blaster Emplacement",
    short: "Blaster",
    icon: "🔫",
    color: "#7dd3fc",
    glow: "#38bdf8",
    desc: "Cheap rapid-fire turret. Shreds unarmoured troops. Ground only.",
    attack: "blaster",
    air: false,
    tiers: [
      { cost: 60, damage: 8, range: 92, fireRate: 3.0, pSpeed: 520 },
      { cost: 55, damage: 13, range: 102, fireRate: 3.3, pSpeed: 540 },
      { cost: 95, damage: 19, range: 112, fireRate: 3.7, pSpeed: 560 },
      { cost: 175, damage: 27, range: 124, fireRate: 4.2, pSpeed: 600 },
    ],
  },
  {
    id: "laser",
    name: "Laser Turret",
    short: "Laser",
    icon: "🔺",
    color: "#f472b6",
    glow: "#ec4899",
    desc: "Precision single-target beam. Strong against armour, hits air.",
    attack: "laser",
    air: true,
    tiers: [
      { cost: 110, damage: 30, range: 120, fireRate: 1.1, pSpeed: 900 },
      { cost: 90, damage: 46, range: 132, fireRate: 1.2, pSpeed: 960 },
      { cost: 155, damage: 68, range: 145, fireRate: 1.35, pSpeed: 1020 },
      { cost: 265, damage: 96, range: 160, fireRate: 1.5, pSpeed: 1100 },
    ],
  },
  {
    id: "missile",
    name: "Missile Launcher",
    short: "Missile",
    icon: "🚀",
    color: "#fbbf24",
    glow: "#f59e0b",
    desc: "Slow heavy rockets with splash damage. Hits air.",
    attack: "missile",
    air: true,
    tiers: [
      { cost: 180, damage: 40, range: 150, fireRate: 0.55, pSpeed: 260, splash: 46 },
      { cost: 150, damage: 60, range: 162, fireRate: 0.6, pSpeed: 270, splash: 52 },
      { cost: 240, damage: 88, range: 175, fireRate: 0.68, pSpeed: 285, splash: 58 },
      { cost: 400, damage: 124, range: 190, fireRate: 0.78, pSpeed: 300, splash: 66 },
    ],
  },
  {
    id: "ion",
    name: "Ion Cannon",
    short: "Ion",
    icon: "⚛",
    color: "#a78bfa",
    glow: "#8b5cf6",
    desc: "Chain lightning that strips shields and stuns droids. Hits air.",
    attack: "ion",
    air: true,
    tiers: [
      { cost: 150, damage: 22, range: 130, fireRate: 0.9, pSpeed: 720, chain: 2, stun: 0.7, shieldMul: 3 },
      { cost: 130, damage: 34, range: 142, fireRate: 0.95, pSpeed: 760, chain: 3, stun: 0.9, shieldMul: 3.4 },
      { cost: 210, damage: 50, range: 154, fireRate: 1.05, pSpeed: 800, chain: 4, stun: 1.1, shieldMul: 3.8 },
      { cost: 360, damage: 72, range: 168, fireRate: 1.15, pSpeed: 860, chain: 5, stun: 1.4, shieldMul: 4.5 },
    ],
  },
];

export const ENEMIES = {
  trooper: { id: "trooper", name: "Stormtrooper", hp: 60, speed: 50, armor: 0, shield: 0, bounty: 8, radius: 10, body: "#eef1f5", accent: "#15181d", faction: "empire", shape: "trooper" },
  scout: { id: "scout", name: "Scout Trooper", hp: 46, speed: 92, armor: 0, shield: 0, bounty: 8, radius: 9, body: "#dfe6ee", accent: "#26303a", faction: "empire", shape: "scout" },
  droid: { id: "droid", name: "Battle Droid", hp: 44, speed: 62, armor: 1, shield: 0, bounty: 6, radius: 9, body: "#c9a878", accent: "#5a4630", faction: "separatist", shape: "droid" },
  droideka: { id: "droideka", name: "Droideka", hp: 130, speed: 42, armor: 3, shield: 180, bounty: 22, radius: 13, body: "#b08a5a", accent: "#7d3f2b", faction: "separatist", shape: "droideka" },
  superdroid: { id: "superdroid", name: "Super Battle Droid", hp: 180, speed: 46, armor: 4, shield: 0, bounty: 16, radius: 12, body: "#8d95a0", accent: "#d24b2f", faction: "separatist", shape: "superdroid" },
  atst: { id: "atst", name: "AT-ST", hp: 300, speed: 40, armor: 5, shield: 0, bounty: 26, radius: 15, body: "#9aa6b2", accent: "#39424d", faction: "empire", shape: "atst" },
  atat: { id: "atat", name: "AT-AT", hp: 1500, speed: 24, armor: 9, shield: 0, bounty: 95, radius: 23, body: "#adb6c0", accent: "#4a545f", faction: "empire", shape: "atat", heavy: true },
  tie: { id: "tie", name: "TIE Fighter", hp: 95, speed: 108, armor: 1, shield: 40, bounty: 13, radius: 10, body: "#3f474f", accent: "#9fe8ff", faction: "empire", shape: "tie", flying: true },
  interceptor: { id: "interceptor", name: "TIE Interceptor", hp: 140, speed: 124, armor: 1, shield: 60, bounty: 18, radius: 10, body: "#454e57", accent: "#ffb3c1", faction: "empire", shape: "interceptor", flying: true },
  vader: { id: "vader", name: "Darth Vader", hp: 4200, speed: 30, armor: 12, shield: 900, bounty: 320, radius: 24, body: "#3a3d47", accent: "#ff3b4e", faction: "empire", shape: "sith", boss: true, ability: "forceChoke" },
  royalguard: { id: "royalguard", name: "Royal Guard", hp: 2600, speed: 46, armor: 14, shield: 0, bounty: 240, radius: 20, body: "#8f1220", accent: "#f2c14e", faction: "empire", shape: "guard", boss: true },
  darktrooper: { id: "darktrooper", name: "Dark Trooper", hp: 2200, speed: 42, armor: 16, shield: 400, bounty: 240, radius: 19, body: "#5b6470", accent: "#ff5a3c", faction: "empire", shape: "darktrooper", boss: true },
  palpatine: { id: "palpatine", name: "Emperor Palpatine", hp: 8000, speed: 22, armor: 18, shield: 2500, bounty: 600, radius: 26, body: "#3b3e50", accent: "#c084fc", faction: "empire", shape: "sith", boss: true, ability: "lightning" },
};

export const PLANETS = [
  {
    id: "tatooine",
    name: "Tatooine",
    subtitle: "Outer Rim • Desert",
    tag: "Twin suns. Hutt space. The Empire is sweeping the dunes.",
    waves: 12,
    palette: {
      sky: "#1a1208", bg: "#c9a56a", bg2: "#b8914f",
      tileA: "#cdaa72", tileB: "#c3a068", grid: "rgba(70,45,14,.15)",
      path: "#8a6438", pathEdge: "#6f4d28", decor: "#7c5a30",
      accent: "#f5b642", lamp: "#ffd27a", fog: "rgba(245,182,66,.05)",
    },
    start: [0, 5],
    waypoints: [[3, 5], [3, 2], [7, 2], [7, 7], [11, 7], [11, 4], [15, 4]],
    decor: "rock",
    pool: [
      { type: "trooper", from: 1 },
      { type: "scout", from: 2 },
      { type: "tie", from: 3 },
      { type: "atst", from: 5 },
      { type: "droid", from: 4 },
      { type: "superdroid", from: 7 },
    ],
    boss: "vader",
    reward: 260,
  },
  {
    id: "hoth",
    name: "Hoth",
    subtitle: "Ice World • Echo Base",
    tag: "Frozen wastes. Walkers inbound. Hold the shield generator.",
    waves: 12,
    palette: {
      sky: "#0c1723", bg: "#dbe7f2", bg2: "#c4d6e6",
      tileA: "#e3edf7", tileB: "#d6e3f0", grid: "rgba(60,110,150,.11)",
      path: "#a9bdd0", pathEdge: "#8ba3ba", decor: "#b9cfdf",
      accent: "#6fd6ff", lamp: "#bfefff", fog: "rgba(160,220,255,.06)",
    },
    start: [0, 2],
    waypoints: [[2, 2], [2, 7], [6, 7], [6, 3], [10, 3], [10, 8], [13, 8], [13, 5], [15, 5]],
    decor: "ice",
    pool: [
      { type: "trooper", from: 1 },
      { type: "droid", from: 1 },
      { type: "atst", from: 3 },
      { type: "superdroid", from: 4 },
      { type: "tie", from: 5 },
      { type: "atat", from: 8 },
    ],
    boss: "atat",
    reward: 340,
  },
  {
    id: "endor",
    name: "Endor",
    subtitle: "Forest Moon • Shield Bunker",
    tag: "Ancient trees. Speeder scouts. The bunker must fall.",
    waves: 12,
    palette: {
      sky: "#0a1508", bg: "#2f5230", bg2: "#28472a",
      tileA: "#356036", tileB: "#2c5230", grid: "rgba(160,210,140,.17)",
      path: "#5b4a2f", pathEdge: "#453823", decor: "#1f3d22",
      accent: "#8bd450", lamp: "#d9ffb0", fog: "rgba(120,200,80,.05)",
    },
    start: [15, 5],
    waypoints: [[12, 5], [12, 8], [8, 8], [8, 3], [4, 3], [4, 6], [1, 6]],
    decor: "tree",
    pool: [
      { type: "scout", from: 1 },
      { type: "trooper", from: 1 },
      { type: "atst", from: 2 },
      { type: "droid", from: 3 },
      { type: "interceptor", from: 4 },
      { type: "superdroid", from: 6 },
      { type: "atat", from: 9 },
    ],
    boss: "royalguard",
    reward: 420,
  },
  {
    id: "deathstar",
    name: "Death Star",
    subtitle: "Deep Space • Battle Station",
    tag: "The station's reactor. Every faction. No retreat.",
    waves: 14,
    palette: {
      sky: "#05070d", bg: "#3a4049", bg2: "#31363e",
      tileA: "#41464f", tileB: "#383d45", grid: "rgba(150,180,220,.13)",
      path: "#565d68", pathEdge: "#2c3038", decor: "#2a2e35",
      accent: "#9fb4d0", lamp: "#cfe6ff", fog: "rgba(120,160,220,.05)",
    },
    start: [0, 7],
    waypoints: [[2, 7], [2, 3], [5, 3], [5, 8], [8, 8], [8, 2], [11, 2], [11, 6], [14, 6], [14, 4], [15, 4]],
    decor: "panel",
    pool: [
      { type: "trooper", from: 1 },
      { type: "droid", from: 1 },
      { type: "superdroid", from: 1 },
      { type: "droideka", from: 2 },
      { type: "atst", from: 3 },
      { type: "tie", from: 4 },
      { type: "interceptor", from: 5 },
      { type: "atat", from: 6 },
    ],
    boss: "palpatine",
    reward: 600,
  },
];

export const ABILITIES = {
  lightning: { id: "lightning", name: "Force Lightning", icon: "⚡", cooldown: 22, radius: 108, damage: 90, stun: 2.4, cost: 0, desc: "Unleash the dark side on every enemy in a radius — heavy damage and stun." },
  push: { id: "push", name: "Force Push", icon: "💫", cooldown: 16, radius: 120, damage: 45, knockback: 74, desc: "Blast enemies backwards along the path and stagger them." },
  orbital: { id: "orbital", name: "Orbital Strike", icon: "☄", cooldown: 34, radius: 96, damage: 340, desc: "Call down a turbolaser barrage on a target zone." },
};

export const HERO = {
  name: "Jedi Knight",
  icon: "🗡",
  cost: 320,
  hp: 520,
  damage: 42,
  range: 118,
  fireRate: 1.7,
  speed: 118,
  ability: { name: "Saber Sweep", icon: "🌀", cooldown: 9, radius: 96, damage: 70, stun: 1.2 },
};

export const THEME = {
  dark: {
    bg: "#05070f", card: "#0d1424", cardSoft: "#080d18", border: "rgba(120,170,255,.16)",
    text: "#dbe8ff", muted: "#7f93b5", accent: "#48b4ff", accent2: "#59e3ff",
  },
  light: {
    bg: "#e9eef7", card: "#ffffff", cardSoft: "#f2f5fb", border: "rgba(20,40,80,.14)",
    text: "#16233b", muted: "#5a6b8c", accent: "#2f7fe0", accent2: "#0aa9d6",
  },
};

export const ACCENTS = [
  { key: "jedi", name: "Jedi Blue", color: "#48b4ff" },
  { key: "rebel", name: "Rebel Orange", color: "#ff8a2b" },
  { key: "sith", name: "Sith Red", color: "#ff3b52" },
  { key: "consular", name: "Consular Green", color: "#57e08a" },
  { key: "mando", name: "Mandalore", color: "#b98cff" },
];
