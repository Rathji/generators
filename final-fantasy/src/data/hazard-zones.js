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
];
