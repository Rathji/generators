// Grid data structures + tile collision.
// Tasks #1 (movement) & #2 (layers) — see backlog.pjs.

export const DIRS = Object.freeze({
  N: Object.freeze({ dx: 0, dy: -1 }),
  S: Object.freeze({ dx: 0, dy: 1 }),
  E: Object.freeze({ dx: 1, dy: 0 }),
  W: Object.freeze({ dx: -1, dy: 0 }),
});

export const CARDINAL_DIRS = Object.freeze(["N", "S", "E", "W"]);

// A tile grid with a collision layer (1 = solid) and two tile-id layers:
// `ground` (drawn first) and `overhead` (drawn on top of entities).
// Out-of-bounds is always treated as solid.
export class TileMap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.collision = new Uint8Array(width * height);
    this.ground = new Uint8Array(width * height);
    this.overhead = new Uint8Array(width * height);
  }

  get tiles() {
    return this.ground;
  }

  // Build from ASCII art. opts.solid maps a char -> solid boolean
  // (default: "#" is solid). opts.tiles maps a char -> ground tile id
  // (default 0). opts.overhead is an optional second ASCII grid; its tile
  // ids come from opts.overheadTiles (char -> tile id).
  static fromAscii(rows, opts = {}) {
    const tilesSpec = opts.tiles ?? {};
    const solidSpec = opts.solid ?? { "#": true };
    const overheadTilesSpec = opts.overheadTiles ?? {};
    const height = rows.length;
    const width = Math.max(0, ...rows.map((r) => r.length));
    const map = new TileMap(width, height);
    for (let y = 0; y < height; y++) {
      const row = rows[y];
      for (let x = 0; x < width; x++) {
        const ch = x < row.length ? row[x] : " ";
        const i = y * width + x;
        map.ground[i] = tilesSpec[ch] ?? 0;
        map.collision[i] = solidSpec[ch] ? 1 : 0;
      }
    }
    if (opts.overhead) {
      const oh = opts.overhead;
      for (let y = 0; y < Math.min(height, oh.length); y++) {
        const row = oh[y];
        for (let x = 0; x < Math.min(width, row.length); x++) {
          map.overhead[y * width + x] = overheadTilesSpec[row[x]] ?? 0;
        }
      }
    }
    return map;
  }

  idx(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  isSolid(x, y) {
    return !this.inBounds(x, y) || this.collision[this.idx(x, y)] === 1;
  }

  canStand(x, y) {
    return this.inBounds(x, y) && this.collision[this.idx(x, y)] !== 1;
  }

  setSolid(x, y, solid = true) {
    if (this.inBounds(x, y)) this.collision[this.idx(x, y)] = solid ? 1 : 0;
  }

  getTile(x, y) {
    return this.inBounds(x, y) ? this.ground[this.idx(x, y)] : 0;
  }

  getOverhead(x, y) {
    return this.inBounds(x, y) ? this.overhead[this.idx(x, y)] : 0;
  }
}
