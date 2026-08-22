// Task #152: World-State Visual Updates — permanent town-texture/tile
// patches driven by major plot flags. Renderers apply `char`/`cls`/`label`
// per active patch; `solid: false` opens a sealed tile (via the
// passability-override hook) and `solid: true` seals one.

import { TileMap } from "./grid.js";

export class WorldVisualSystem {
  constructor(patches = [], opts = {}) {
    this.patches = patches;
    this.state = opts.state ?? null;
  }

  all() {
    return [...this.patches];
  }

  isActive(patch) {
    const req = patch.require?.flag;
    return req ? !!(this.state && this.state.getFlag(req)) : true;
  }

  activePatchesFor(mapId) {
    return this.patches.filter((p) => p.mapId === mapId && this.isActive(p));
  }

  activePatchAt(mapId, x, y) {
    return (
      this.patches.find((p) => p.mapId === mapId && p.x === x && p.y === y && this.isActive(p)) ??
      null
    );
  }

  // Movement hook: "block"/"open" for patches that change collision.
  passabilityOverride(mapId, x, y) {
    const p = this.activePatchAt(mapId, x, y);
    if (!p || typeof p.solid !== "boolean") return null;
    return p.solid ? "block" : "open";
  }

  // Every patch tile must exist on its map.
  audit(registry) {
    const errors = [];
    for (const p of this.patches) {
      const def = registry?.get?.(p.mapId);
      if (!def) {
        errors.push({ id: p.id, error: "no such map: " + p.mapId });
        continue;
      }
      if (!TileMap.fromAscii(def.rows, { tiles: def.tiles, solid: def.solid }).inBounds(p.x, p.y)) {
        errors.push({ id: p.id, error: "out of bounds at " + p.x + "," + p.y });
      }
    }
    return errors;
  }
}
