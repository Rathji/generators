// Task #24: Dungeon Fog-of-War/Discovery System — track explored tiles per
// map and expose a mini-map renderer (ASCII + DOM).

export class FogOfWar {
  constructor(opts = {}) {
    this.radius = opts.radius ?? 1;
    this.explored = new Map(); // mapId -> Set("x,y")
  }

  _set(mapId) {
    if (!this.explored.has(mapId)) this.explored.set(mapId, new Set());
    return this.explored.get(mapId);
  }

  discover(mapId, x, y) {
    this._set(mapId).add(x + "," + y);
    return this;
  }

  discoverRadius(mapId, cx, cy, r = this.radius) {
    const set = this._set(mapId);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        set.add(cx + dx + "," + (cy + dy));
      }
    }
    return this;
  }

  isDiscovered(mapId, x, y) {
    const set = this.explored.get(mapId);
    return set ? set.has(x + "," + y) : false;
  }

  discoveredTiles(mapId) {
    const set = this.explored.get(mapId);
    if (!set) return [];
    return [...set].map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    });
  }

  count(mapId) {
    const set = this.explored.get(mapId);
    return set ? set.size : 0;
  }

  reset(mapId) {
    this.explored.delete(mapId);
    return this;
  }

  resetAll() {
    this.explored.clear();
    return this;
  }

  // 2D visibility grid for a map: 1 = explored, 0 = unexplored.
  visibilityGrid(mapId, width, height) {
    const grid = [];
    for (let y = 0; y < height; y++) {
      const row = new Array(width).fill(0);
      grid.push(row);
    }
    const set = this.explored.get(mapId);
    if (!set) return grid;
    for (const key of set) {
      const [x, y] = key.split(",").map(Number);
      if (x >= 0 && x < width && y >= 0 && y < height) grid[y][x] = 1;
    }
    return grid;
  }

  // ASCII mini-map: '#' = unexplored, '.' = explored, '@' = player.
  renderMiniMap(mapId, width, height, px = -1, py = -1) {
    const grid = this.visibilityGrid(mapId, width, height);
    const rows = [];
    for (let y = 0; y < height; y++) {
      let line = "";
      for (let x = 0; x < width; x++) {
        if (x === px && y === py) line += "@";
        else line += grid[y][x] ? "." : "#";
      }
      rows.push(line);
    }
    return rows.join("\n");
  }
}

// Lightweight DOM mini-map panel.
export class MiniMap {
  constructor(container, opts = {}) {
    this.container = container;
    this.cell = opts.cell ?? 10;
    this.fog = opts.fog ?? null;
    this.mapId = opts.mapId ?? null;
    this.width = opts.width ?? 0;
    this.height = opts.height ?? 0;
    this._build();
  }

  _build() {
    this.container.innerHTML = "";
    const canvas = document.createElement("canvas");
    canvas.width = this.width * this.cell;
    canvas.height = this.height * this.cell;
    canvas.style.cssText = "image-rendering: pixelated; border: 1px solid #39456e; background: #000;";
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.container.appendChild(canvas);
  }

  setFog(fog, mapId, width, height) {
    this.fog = fog;
    this.mapId = mapId;
    this.width = width;
    this.height = height;
    this._build();
    return this;
  }

  render(px = -1, py = -1) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width * this.cell, this.height * this.cell);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.width * this.cell, this.height * this.cell);
    if (!this.fog) return this;
    const grid = this.fog.visibilityGrid(this.mapId, this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!grid[y][x]) continue;
        ctx.fillStyle = "#1b2b4a";
        ctx.fillRect(x * this.cell, y * this.cell, this.cell, this.cell);
        ctx.fillStyle = "#3d6a3a";
        ctx.fillRect(x * this.cell + 1, y * this.cell + 1, this.cell - 2, this.cell - 2);
      }
    }
    if (px >= 0 && py >= 0) {
      ctx.fillStyle = "#ffd24a";
      ctx.fillRect(px * this.cell + 1, py * this.cell + 1, this.cell - 2, this.cell - 2);
    }
    return this;
  }
}
