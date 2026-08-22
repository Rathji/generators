// Task #121: Boundary System — resolves invisible-wall rectangles against
// positions and audits that every boundary lies inside its map.

import { BOUNDARIES } from "../data/boundaries.js";

export class BoundarySystem {
  constructor(boundaries = BOUNDARIES, opts = {}) {
    this.boundaries = boundaries;
    this.maps = opts.maps ?? null;
  }

  defsFor(mapId) {
    return this.boundaries[mapId] ?? [];
  }

  blockedBy(mapId, x, y) {
    return this.defsFor(mapId).find(
      (b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
    ) ?? null;
  }

  isBlocked(mapId, x, y) {
    return !!this.blockedBy(mapId, x, y);
  }

  audit() {
    const errors = [];
    for (const [mapId, rects] of Object.entries(this.boundaries)) {
      const def = this.maps?.get?.(mapId);
      for (const b of rects) {
        if (!b.id || !b.label) errors.push({ mapId, id: b.id, error: "missing id/label" });
        const nums = [b.x0, b.y0, b.x1, b.y1];
        if (!nums.every(Number.isInteger)) errors.push({ mapId, id: b.id, error: "non-integer rect" });
        else if (b.x0 > b.x1 || b.y0 > b.y1) errors.push({ mapId, id: b.id, error: "inverted rect" });
        if (def) {
          const h = def.rows?.length ?? 0;
          const w = def.rows?.[0]?.length ?? 0;
          if (b.x0 < 0 || b.y0 < 0 || b.x1 >= w || b.y1 >= h) {
            errors.push({ mapId, id: b.id, error: "rect out of map bounds" });
          }
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }
}
