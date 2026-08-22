// Task #136: Terrain-Based Movement Speed Modifiers — different terrain
// types cost different movement budget per tile, so plain grass is fastest,
// forests and ice slow a walker down, and mountains are slower still.
// Passability is UNCHANGED: a tile a travel mode cannot enter is never made
// traversable here (cost tables delegate to TerrainRules.canTraverse), so
// nothing that was blocked before becomes walkable.
//
// Grass (plain land) cost 1, forest cost 2, ice cost 2, mountain cost 4,
// water is impassable on foot. Ships cost 1 per water tile. The airship
// costs 1 everywhere.

import { TRAVEL_MODES, TERRAIN_TYPES } from "./terrain.js";

// Movement cost per terrain for each travel mode. Infinity = impassable.
export const TERRAIN_SPEED = Object.freeze({
  land: Object.freeze({ land: 1, forest: 2, mountain: 4, water: Infinity, ice: 2 }),
  ship: Object.freeze({ water: 1, land: Infinity, forest: Infinity, mountain: Infinity, ice: Infinity }),
  air: Object.freeze({ land: 1, forest: 1, mountain: 1, water: 1, ice: 1 }),
});

export const SPEED_LABELS = Object.freeze({
  1: "fast",
  0.5: "slow",
  0.25: "very slow",
});

export class TerrainSpeedSystem {
  constructor(rules, opts = {}) {
    this.rules = rules;
    this.costs = opts.costs ?? TERRAIN_SPEED;
  }

  terrainAt(x, y) {
    return this.rules.terrainAt(x, y);
  }

  // Cost of entering one tile in the given travel mode. Delegates passability
  // to the underlying TerrainRules so speed never unlocks new terrain.
  moveCost(x, y, mode = TRAVEL_MODES.LAND) {
    if (!this.rules.inBounds(x, y)) return Infinity;
    if (!this.rules.canTraverse(mode, x, y)) return Infinity;
    const t = this.rules.terrainAt(x, y);
    const c = this.costs[mode]?.[t];
    if (Number.isFinite(c)) return c;
    // Any mode-allowed terrain without an explicit cost defaults to 1.
    return 1;
  }

  // Effective step speed (1 / cost) — 1 on grass, 0.5 in forest/ice,
  // 0.25 on mountains, 0 on impassable tiles.
  speedAt(x, y, mode = TRAVEL_MODES.LAND) {
    const c = this.moveCost(x, y, mode);
    return Number.isFinite(c) ? 1 / c : 0;
  }

  speedLabel(x, y, mode = TRAVEL_MODES.LAND) {
    return SPEED_LABELS[this.speedAt(x, y, mode)] ?? "impassable";
  }

  // Total cost along a straight cardinal path of `steps` tiles.
  pathCost(fromX, fromY, dir, steps, mode = TRAVEL_MODES.LAND) {
    const deltas = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
    const [dx, dy] = deltas[dir] ?? [0, 0];
    let total = 0;
    for (let i = 1; i <= steps; i++) {
      const c = this.moveCost(fromX + dx * i, fromY + dy * i, mode);
      if (!Number.isFinite(c)) return Infinity;
      total += c;
    }
    return total;
  }

  describeTile(x, y, mode = TRAVEL_MODES.LAND) {
    return {
      x,
      y,
      terrain: this.rules.terrainAt(x, y),
      cost: this.moveCost(x, y, mode),
      traversable: Number.isFinite(this.moveCost(x, y, mode)),
      speed: this.speedAt(x, y, mode),
    };
  }

  // Constraint audit: every terrain type must have a cost entry per mode.
  static validateCostTable(costs = TERRAIN_SPEED) {
    const report = [];
    for (const [mode, table] of Object.entries(costs)) {
      for (const terrain of Object.values(TERRAIN_TYPES)) {
        if (typeof table[terrain] !== "number") {
          report.push({ mode, terrain, error: "missing cost" });
        }
      }
    }
    return report;
  }
}
