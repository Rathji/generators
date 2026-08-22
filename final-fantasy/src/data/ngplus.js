// Task #191: New Game+ — the Cycle of the Shattered Age. Once the Keeper of
// Time falls, the Remembrance Sage can wind the world back and begin the age
// anew: the party keeps its strength and gold (and all non-key items), the
// story flags reset so the tale replays, the waystones/trials/bestiary stay
// lit, and every foe of the realm grows stronger with each cycle.
//
// The 2nd cycle also tears open the Echo Gate — a hollow at the edge of the
// Hall of Trials where the Echo of Creation (the age before the crystals)
// waits for any party bold enough to have lived the world twice.

export const NGPLUS = {
  maxCycles: 3,
  // Stat growth per cycle beyond the first (×1.35 for mobs, ×1.5 for bosses).
  enemyGrowth: 0.35,
  bossGrowth: 0.5,
  // Loot growth for cycle 2+.
  xpMultiplier: 1.25,
  goldMultiplier: 1.25,
  // Where a fresh cycle begins.
  cycleStart: { mapId: "cornelia", x: 7, y: 5, facing: "S" },
  // Loyalty rewards handed out when each cycle begins.
  loyaltyRewards: [
    { cycle: 2, gold: 1000, xp: 300, item: "cycleEmblem", count: 1 },
    { cycle: 3, gold: 2000, xp: 500, item: "shatteredRelic", count: 1 },
  ],
  // The Echo of Creation — the age before the crystals, slain only on the
  // second cycle onward.
  echo: {
    bossId: "echoOfCreation",
    group: "echo_creation",
    unlockCycle: 2,
    intro: "The hollow at the hall's edge drinks the light — the Echo of Creation stirs from before the first age!",
    victoryLine: "The Echo of Creation unravels into a silence older than the stars.",
  },
  // Defeating the Echo grants the blade of a broken age.
  echoReward: { item: "shatteredBlade", count: 1, gold: 5000, xp: 1500 },
  // Flags kept across a cycle reset (prefix-matched).
  preserveFlagPrefixes: ["waystone_", "trial_", "bestiary_", "any_trial_cleared", "keeper_tokens", "ngplus_", "rpg_" ],
  // Key items (`type: "key"`) are stripped on a new cycle — the story's
  // gates must be opened anew.
  stripItemTypes: ["key"],
};
