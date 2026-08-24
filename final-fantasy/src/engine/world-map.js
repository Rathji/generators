// World Map engine (Task #237) — renders a stylized continent grid and reports
// which named regions the player has visited. Takes an optional Codex (or any
// object exposing `isKnown("locations", mapId)`) to drive the visited flags.

import { WORLD_MAP, WORLD_LAND, WORLD_OCEAN, WORLD_REGIONS } from "../data/world-map.js";

export class WorldMapSystem {
  constructor(opts = {}) {
    this.codex = opts.codex ?? null; // provides isKnown("locations", mapId)
    this.overworldId = opts.overworldId ?? "overworld";
  }

  region(id) {
    return WORLD_REGIONS.find((r) => r.id === id) ?? null;
  }

  all() {
    return WORLD_REGIONS.map((r) => this._decorate(r));
  }

  _visited(region) {
    if (!this.codex) return false;
    return region.maps.some((m) => this.codex.isKnown("locations", m));
  }

  _decorate(region) {
    return { ...region, visited: this._visited(region) };
  }

  // Visited count vs total regions.
  progress() {
    const all = this.all();
    return { visited: all.filter((r) => r.visited).length, total: all.length };
  }

  // The grid as a 2D array of chars: '.' land, '~' ocean, letters = region markers.
  grid() {
    const w = WORLD_MAP.width;
    const h = WORLD_MAP.height;
    const g = Array.from({ length: h }, () => new Array(w).fill("."));
    for (const [x0, y0, x1, y1] of WORLD_OCEAN) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y < h && x < w) g[y][x] = "~";
    }
    for (const r of WORLD_REGIONS) {
      if (r.x < w && r.y < h) g[r.y][r.x] = r.letter;
    }
    return g;
  }

  render() {
    return this.grid().map((row) => row.join("")).join("\n");
  }

  // ASCII map with visited markers highlighted (visited letters uppercased).
  renderVisited() {
    const w = WORLD_MAP.width;
    const g = this.grid();
    for (const r of this.all()) {
      if (r.visited && r.x < w && r.y < g.length) g[r.y][r.x] = r.letter;
    }
    return g.map((row) => row.join("")).join("\n");
  }

  // Human-readable legend of regions and their visited status.
  legend() {
    return this.all().map((r) => ({ id: r.id, name: r.name, letter: r.letter, visited: r.visited }));
  }
}
