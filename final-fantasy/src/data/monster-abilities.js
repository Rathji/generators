// Task #116: Monster Ability Mapping — named combat moves (Tail Whip, Fire
// Breath) assigned to monsters via MONSTER_ABILITY_ASSIGN, with damage/effect
// values in MONSTER_ABILITIES. Abilities ride the EnemyAI decision tree and
// are resolved by MonsterAbilitySystem through CombatResolver.
//
// Elements follow the enemy-data convention (e.g. "thunder" matches the
// weakness lists in enemies.js).

export const MONSTER_ABILITIES = {
  rendingBite: { id: "rendingBite", name: "Rending Bite", kind: "damage", power: 5, element: null, target: "single", flavor: "hurls itself forward with fangs bared." },
  sonarShriek: { id: "sonarShriek", name: "Sonar Shriek", kind: "magic", power: 4, element: null, target: "single", flavor: "emits a piercing shriek." },
  warCry: { id: "warCry", name: "War Cry", kind: "buff", stat: "atk", amount: 3, turns: 3, target: "self", flavor: "lets out a bellowing war cry." },
  putridClaw: { id: "putridClaw", name: "Putrid Claw", kind: "debuff", power: 4, element: null, status: { id: "poison", chance: 0.5 }, target: "single", flavor: "rakes with a rotting claw." },
  haunt: { id: "haunt", name: "Haunt", kind: "magic", power: 6, element: null, target: "single", flavor: "fills the air with a chilling moan." },
  emberBurst: { id: "emberBurst", name: "Ember Burst", kind: "magic", power: 7, element: "fire", target: "single", flavor: "flings a burst of embers." },
  scorch: { id: "scorch", name: "Scorch", kind: "magic", power: 10, element: "fire", target: "single", flavor: "burns with a searing heat." },
  tidalSlam: { id: "tidalSlam", name: "Tidal Slam", kind: "damage", power: 13, element: "water", target: "single", flavor: "slams down with the weight of the tide." },
  rockfall: { id: "rockfall", name: "Rockfall", kind: "magic", power: 9, element: "earth", target: "single", flavor: "rains stone down upon the party." },
  stoneFist: { id: "stoneFist", name: "Stone Fist", kind: "damage", power: 11, element: null, target: "single", flavor: "swings a fist of living stone." },
  steamVent: { id: "steamVent", name: "Steam Vent", kind: "magic", power: 12, element: "fire", target: "single", flavor: "vents a jet of scalding steam." },
  lavaSplash: { id: "lavaSplash", name: "Lava Splash", kind: "magic", power: 8, element: "fire", target: "single", flavor: "splashes molten rock across the floor." },
  gust: { id: "gust", name: "Gust", kind: "magic", power: 6, element: "wind", target: "single", flavor: "whirls into a sudden gust." },
  galeBreath: { id: "galeBreath", name: "Gale Breath", kind: "magic", power: 11, element: "wind", target: "single", flavor: "roars out a gale of biting wind." },
  tidalWave: { id: "tidalWave", name: "Tidal Wave", kind: "magic", power: 14, element: "water", target: "single", flavor: "calls a wall of water down on the party." },
  phantomGaze: { id: "phantomGaze", name: "Phantom Gaze", kind: "magic", power: 10, element: "holy", target: "single", flavor: "fixes the party with a searing gaze." },
  glacierCrash: { id: "glacierCrash", name: "Glacier Crash", kind: "damage", power: 13, element: "ice", target: "single", flavor: "crashes down with a shard of glacier." },
  frozenBreath: { id: "frozenBreath", name: "Frozen Breath", kind: "magic", power: 16, element: "ice", target: "single", flavor: "exhales a cone of frozen breath." },
  gravityWell: { id: "gravityWell", name: "Gravity Well", kind: "magic", power: 15, element: "earth", target: "single", flavor: "warps the air with crushing gravity." },
  forgeHammer: { id: "forgeHammer", name: "Forge Hammer", kind: "damage", power: 19, element: "fire", target: "single", flavor: "brings its great hammer down with the heat of a forge." },
  genesisRay: { id: "genesisRay", name: "Genesis Ray", kind: "magic", power: 22, element: "holy", target: "single", flavor: "unleashes a ray of raw genesis light." },
};

export const MONSTER_ABILITY_ASSIGN = {
  wolf: "rendingBite",
  caveBat: "sonarShriek",
  goblinChief: "warCry",
  zombie: "putridClaw",
  ghost: "haunt",
  flame: "emberBurst",
  fireElemental: "scorch",
  marshGuardian: "tidalSlam",
  earthElemental: "rockfall",
  golem: "stoneFist",
  forgeGolem: "steamVent",
  lavaSlime: "lavaSplash",
  zephyrSprite: "gust",
  skySerpent: "galeBreath",
  tideSerpent: "tidalWave",
  phantomLight: "phantomGaze",
  iceGolem: "glacierCrash",
  frostWyrm: "frozenBreath",
  voidGolem: "gravityWell",
  forgeColossus: "forgeHammer",
  echoOfCreation: "genesisRay",
};
