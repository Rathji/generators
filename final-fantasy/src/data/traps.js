// Trap data (Task #146) — hidden tiles that trigger negative effects when
// stepped on. Coordinates must be walkable tiles of their map (the player
// has to reach them). `once` traps spring a single time per save (a flag
// records them); traps without `once` rearm after `cooldownSteps` moves.

export const TRAPS = [
  {
    id: "cave_spike_pit",
    mapId: "caves_of_cornelia",
    x: 4,
    y: 1,
    line: "A spike pit snaps shut beneath you!",
    effect: { kind: "damage", amount: 6 },
    once: true,
  },
  {
    id: "cave_poison_dart",
    mapId: "caves_of_cornelia",
    x: 11,
    y: 8,
    line: "A venomous dart hisses from the wall and finds a seam in your armor!",
    effect: { kind: "status", status: "poison", chance: 0.8, turns: 4 },
    cooldownSteps: 6,
  },
  {
    id: "cave_b2_stun_spore",
    mapId: "caves_of_cornelia_b2",
    x: 7,
    y: 3,
    line: "A puff of numbing spores erupts from the floor!",
    effect: { kind: "status", status: "paralysis", chance: 0.6, turns: 2 },
    cooldownSteps: 8,
  },
  {
    id: "overworld_snare",
    mapId: "overworld",
    x: 4,
    y: 3,
    line: "Bandits' snares wrench your ankles! You lose some gold to the thrashing.",
    effect: { kind: "drainGold", amount: 25 },
    once: true,
  },
];
