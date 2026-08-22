// Task #137: Overworld Fog-of-War Reveal — the overworld starts completely
// shrouded and reveals only as the player explores. The explored set rides
// on the shared FogOfWar (mapId "overworld") and is additionally persisted
// to a world flag as a raw "x,y|x,y" string, so progress survives map
// transitions and save/load. Leaving the overworld does NOT erase the map —
// the fog is restored from the flag whenever the party returns.

export class WorldMapFogSystem {
  constructor(fog, opts = {}) {
    this.fog = fog;
    this.mapId = opts.mapId ?? "overworld";
    this.radius = opts.radius ?? 2;
    this.state = opts.state ?? null;
    this.flag = opts.flag ?? "ow_fog_explored";
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  // Reveal a radius around (x, y) and persist the growing explored set.
  reveal(x, y) {
    this.fog.discoverRadius(this.mapId, x, y, this.radius);
    this._persist();
    return this;
  }

  isRevealed(x, y) {
    return this.fog.isDiscovered(this.mapId, x, y);
  }

  count() {
    return this.fog.count(this.mapId);
  }

  // Fraction of a map's passable tiles that has been explored (0..1).
  // Only in-bounds, non-solid tiles count, so the value never exceeds 1.
  coverage(mapDef) {
    if (!mapDef) return 0;
    const w = Math.max(0, ...(mapDef.rows ?? []).map((r) => r.length));
    const h = mapDef.rows?.length ?? 0;
    let walkable = 0;
    let explored = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mapDef.solid?.[mapDef.rows[y][x]]) continue;
        walkable++;
        if (this.isRevealed(x, y)) explored++;
      }
    }
    return walkable === 0 ? 0 : explored / walkable;
  }

  _persist() {
    if (!this.state) return;
    const list = this.fog.discoveredTiles(this.mapId).map((t) => t.x + "," + t.y);
    this.state.flags[this.flag] = list.join("|");
  }

  // Rebuild the overworld explored set from the persisted flag (used on
  // arrival at the overworld after resetAll).
  restore() {
    this.fog.reset(this.mapId);
    const raw = this.state ? this.state.flags[this.flag] : null;
    if (typeof raw === "string" && raw) {
      for (const pair of raw.split("|")) {
        const [x, y] = pair.split(",").map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) this.fog.discover(this.mapId, x, y);
      }
    }
    return this;
  }

  reset() {
    this.fog.reset(this.mapId);
    if (this.state) delete this.state.flags[this.flag];
    return this;
  }
}
