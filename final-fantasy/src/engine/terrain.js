// Tasks #35/#36: Terrain rules — water restricts land entities, ships
// traverse water only, and the airship (air mode) ignores terrain entirely.
// Movement scaling for the world map lives in movement.js (Task #34).

export const TRAVEL_MODES = Object.freeze({
  LAND: "land",
  SHIP: "ship",
  AIR: "air",
});

export const TERRAIN_TYPES = Object.freeze({
  LAND: "land",
  WATER: "water",
  MOUNTAIN: "mountain",
  FOREST: "forest",
  ICE: "ice",
});

export const TRAVEL_MODE_NAMES = Object.freeze({
  land: "Land",
  ship: "Ship",
  air: "Airship",
});

// Classifies the tiles of one map def (`def.terrain` maps a char -> terrain
// type, e.g. { "~": "water", "^": "mountain" }) and answers travel queries.
export class TerrainRules {
  constructor(def, opts = {}) {
    this.rows = def.rows;
    this.terrain = def.terrain ?? {};
    this.defaultTerrain = opts.defaultTerrain ?? TERRAIN_TYPES.LAND;
    // Task #103: optional live override (x, y, baseType) -> type | null, used
    // by the Crystal Bridge system to turn bridged water tiles into land.
    this.terrainOverride = opts.terrainOverride ?? null;
    this.width = Math.max(0, ...this.rows.map((r) => r.length));
    this.height = this.rows.length;
    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        const ch = x < this.rows[y].length ? this.rows[y][x] : " ";
        row.push(this.terrain[ch] ?? this.defaultTerrain);
      }
      this.grid.push(row);
    }
  }

  terrainAt(x, y) {
    const base = (this.grid[y] && this.grid[y][x]) ?? this.defaultTerrain;
    if (this.terrainOverride) {
      const o = this.terrainOverride(x, y, base);
      if (o) return o;
    }
    return base;
  }

  isWater(x, y) {
    return this.terrainAt(x, y) === TERRAIN_TYPES.WATER;
  }

  isMountain(x, y) {
    return this.terrainAt(x, y) === TERRAIN_TYPES.MOUNTAIN;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  // Which terrains may a given travel mode enter?
  modeAllowed(mode) {
    switch (mode) {
      case TRAVEL_MODES.AIR:
        return new Set(Object.values(TERRAIN_TYPES));
      case TRAVEL_MODES.SHIP:
        return new Set([TERRAIN_TYPES.WATER]);
      default:
        return new Set([TERRAIN_TYPES.LAND, TERRAIN_TYPES.ICE]);
    }
  }

  // True when any orthogonally-adjacent tile is water (a dockable coast).
  touchesWater(x, y) {
    const deltas = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dy] of deltas) {
      const nx = x + dx, ny = y + dy;
      if (this.inBounds(nx, ny) && this.terrainAt(nx, ny) === TERRAIN_TYPES.WATER) return true;
    }
    return false;
  }

  canTraverse(mode, x, y) {
    if (!this.inBounds(x, y)) return false;
    if (this.modeAllowed(mode).has(this.terrainAt(x, y))) return true;
    // Task #111: ships may dock/launch at any land tile that touches water —
    // without this a ship could never disembark, and the ship arc is dead.
    // Task #141: ice coasts (the Glacier Isle) dock the same way.
    if (mode === TRAVEL_MODES.SHIP && (this.terrainAt(x, y) === TERRAIN_TYPES.LAND || this.terrainAt(x, y) === TERRAIN_TYPES.ICE)) {
      return this.touchesWater(x, y);
    }
    return false;
  }
}

export function terrainRulesFor(def) {
  return new TerrainRules(def);
}
