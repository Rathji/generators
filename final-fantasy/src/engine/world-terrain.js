// Task #76: World Map Terrain Constraints — movement cost and accessibility
// per terrain type (Mountain, Forest, Plain, Water). Land travel on forest
// is slower; mountains are impassable on foot; water needs a ship. Builds on
// TerrainRules (Tasks #35/#36) with an explicit cost table.

import { TRAVEL_MODES, TERRAIN_TYPES } from "./terrain.js";

// Movement cost per terrain for each travel mode. Infinity = impassable.
// Task #141: ice is walkable frozen land on foot (cost 1) and free for the
// airship, but a ship cannot sail over it (ice is land, not water).
export const TERRAIN_COSTS = Object.freeze({
  land: Object.freeze({ land: 1, forest: 2, water: Infinity, mountain: Infinity, ice: 1 }),
  ship: Object.freeze({ land: Infinity, forest: Infinity, water: 1, mountain: Infinity, ice: Infinity }),
  air: Object.freeze({ land: 1, forest: 1, water: 1, mountain: 1, ice: 1 }),
});

export const TERRAIN_LABELS = Object.freeze({
  land: "Plain",
  forest: "Forest",
  water: "Water",
  mountain: "Mountain",
  ice: "Ice",
});

export class WorldMapTerrainSystem {
  constructor(rules, opts = {}) {
    this.rules = rules;
    this.costs = opts.costs ?? TERRAIN_COSTS;
  }

  terrainAt(x, y) {
    return this.rules.terrainAt(x, y);
  }

  isTraversable(x, y, mode = TRAVEL_MODES.LAND) {
    if (!this.rules.inBounds(x, y)) return false;
    return Number.isFinite(this.moveCost(x, y, mode));
  }

  // Cost of entering one tile in the given travel mode.
  moveCost(x, y, mode = TRAVEL_MODES.LAND) {
    if (!this.rules.inBounds(x, y)) return Infinity;
    const t = this.rules.terrainAt(x, y);
    const c = this.costs[mode]?.[t];
    if (Number.isFinite(c)) return c;
    // Task #111: ships may dock at coastal land (cost 1), mirroring the
    // TerrainRules dock rule so pathing/reachability agree with movement.
    if (mode === TRAVEL_MODES.SHIP && (t === TERRAIN_TYPES.LAND || t === TERRAIN_TYPES.ICE) && this.rules.canTraverse(mode, x, y)) return 1;
    return Infinity;
  }

  // Total cost to move along a straight cardinal path of `steps` tiles.
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

  // Effective step speed (1 / cost) — e.g. forest halves land speed.
  speedModifier(x, y, mode = TRAVEL_MODES.LAND) {
    const c = this.moveCost(x, y, mode);
    return Number.isFinite(c) ? 1 / c : 0;
  }

  terrainLabel(x, y) {
    const t = this.rules.terrainAt(x, y);
    return TERRAIN_LABELS[t] ?? t;
  }

  describeTile(x, y, mode = TRAVEL_MODES.LAND) {
    const c = this.moveCost(x, y, mode);
    return {
      x,
      y,
      terrain: this.rules.terrainAt(x, y),
      label: this.terrainLabel(x, y),
      cost: c,
      traversable: Number.isFinite(c),
      speed: this.speedModifier(x, y, mode),
    };
  }

  // Constraint audit: every terrain type must have a cost entry per mode.
  static validateCostTable(costs = TERRAIN_COSTS) {
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
