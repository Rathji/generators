// Hazard-zone data (Task #147) — lava/acid zones that deal damage over time
// while the party stands on them, unless gear-protected. Coordinates must be
// walkable tiles. Lava sits on the Ember Sanctum's `V` magma-vent tiles;
// the Marsh Cave's acid seeps across the low path.

export const HAZARD_ZONES = [
  {
    id: "ember_lava",
    mapId: "ember_sanctum",
    name: "Lava vent",
    tiles: [{ x: 13, y: 2 }, { x: 2, y: 8 }],
    damage: 9,
    element: "fire",
    protectedBy: "Magma Heart",
    line: "The floor burns beneath your feet!",
  },
  {
    id: "ember_lava_b2",
    mapId: "ember_sanctum_b2",
    name: "Magma pool",
    tiles: [{ x: 3, y: 3 }, { x: 11, y: 5 }],
    damage: 11,
    element: "fire",
    protectedBy: "Magma Heart",
    line: "Molten rock sears the air around you!",
  },
  {
    id: "ember_lava_core",
    mapId: "ember_sanctum_core",
    name: "Molten core",
    tiles: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 12, y: 3 }, { x: 3, y: 5 }],
    damage: 14,
    element: "fire",
    protectedBy: "Magma Heart",
    line: "The heart of the mountain blazes — every step is agony!",
  },
  {
    id: "marsh_acid",
    mapId: "marsh_cave",
    name: "Acid seep",
    tiles: [{ x: 10, y: 1 }, { x: 11, y: 1 }, { x: 12, y: 1 }],
    damage: 7,
    element: null,
    status: { id: "poison", chance: 0.35, turns: 3 },
    protectedBy: "sturdy boots",
    line: "Corrosive marsh acid eats at your boots!",
  },
  // Task #174: the Ice Cave's deepest frost vents — the "+" ice floors of
  // the crystal chamber radiate a cold that bites through to the bone
  // unless the party wears a Frost Cloak.
  {
    id: "ice_cave_frost",
    mapId: "ice_cave_b2",
    name: "Frost vent",
    tiles: [{ x: 4, y: 1 }, { x: 5, y: 1 }, { x: 4, y: 5 }, { x: 10, y: 5 }],
    damage: 8,
    element: "ice",
    protectedBy: "Frost Cloak",
    line: "The deep cold seeps through your boots — the floor burns like winter!",
  },
  // Task #176-#185: Southern Jungles & Western Highlands hazards — the
  // Sunken Hall's spore vents poison the air; the storm-peak's gale blasts
  // fling the unwary unless they wear the Gale Cloak.
  {
    id: "ruins_spore_trap",
    mapId: "ancient_ruins_b2",
    name: "Spore vent",
    tiles: [{ x: 5, y: 7 }, { x: 9, y: 7 }],
    damage: 7,
    element: null,
    status: { id: "poison", chance: 0.35, turns: 3 },
    protectedBy: "sturdy boots",
    line: "A vent hisses old moss-spores into the air — your lungs burn!",
  },
  {
    id: "peak_gale",
    mapId: "highland_peak",
    name: "Gale gust",
    tiles: [{ x: 7, y: 5 }, { x: 4, y: 11 }],
    damage: 9,
    element: "wind",
    protectedBy: "Gale Cloak",
    line: "A roaring gust tears across the peak, whipping your cloak to shreds!",
  },
  {
    id: "summit_gale",
    mapId: "highland_peak_b2",
    name: "Storm gust",
    tiles: [{ x: 4, y: 1 }, { x: 12, y: 1 }, { x: 3, y: 5 }, { x: 13, y: 5 }],
    damage: 12,
    element: "wind",
    protectedBy: "Gale Cloak",
    line: "The storm's breath howls over the summit — only the Gale Cloak steadies you!",
  },
];
