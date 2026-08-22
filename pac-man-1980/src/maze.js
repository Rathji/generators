// src/maze.js — Phase 2 (tasks 5-7): tile grid, walkability, wall/dot/pellet/door rendering.

export const TILE = 16;
export const COLS = 28;
export const ROWS = 31;
export const ARENA_W = COLS * TILE;
export const ARENA_H = ROWS * TILE;

export const WALL = "#";
export const DOT = ".";
export const POWER = "o";
export const EMPTY = "~";
export const DOOR = "D";
export const PAC = "P";
export const FRUIT = "F";
export const GHOST = "G";

const WALL_COLOR = "#2121ff";
const DOOR_COLOR = "#ffb8ff";

export class Maze {
  constructor(mapRows) {
    this.grid = [];
    this.wall = [];
    this.dots = [];
    this.power = [];
    this.doors = [];
    this.pacStart = [13, 17];
    this.fruitSlot = [14, 17];
    this.ghostStarts = [];

    for (let y = 0; y < ROWS; y++) {
      const row = mapRows[y] || "";
      this.grid[y] = [];
      this.wall[y] = [];
      for (let x = 0; x < COLS; x++) {
        const ch = row[x] || WALL;
        this.grid[y][x] = ch;
        this.wall[y][x] = ch === WALL;
        if (ch === DOT) this.dots.push([x, y]);
        else if (ch === POWER) this.power.push([x, y]);
        else if (ch === DOOR) this.doors.push([x, y]);
        else if (ch === PAC) this.pacStart = [x, y];
        else if (ch === FRUIT) this.fruitSlot = [x, y];
        else if (ch === GHOST) this.ghostStarts.push([x, y]);
      }
    }
    this.dotsLeft = this.dots.length + this.power.length;
  }

  cell(x, y) {
    if (y < 0 || y >= ROWS) return WALL;
    if (this.grid[y][0] !== WALL && this.grid[y][COLS - 1] !== WALL) {
      if (x < 0) x += COLS;
      if (x >= COLS) x -= COLS;
    } else if (x < 0 || x >= COLS) {
      return WALL;
    }
    return this.grid[y][x];
  }

  isWall(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
    return this.wall[y][x];
  }

  canPac(x, y) {
    const c = this.cell(x, y);
    return c !== WALL && c !== DOOR;
  }

  canGhost(x, y) {
    const c = this.cell(x, y);
    return c !== WALL;
  }

  eatDot(x, y) {
    const c = this.cell(x, y);
    if (c === DOT || c === POWER) {
      let gx = x;
      if (gx < 0) gx += COLS;
      if (gx >= COLS) gx -= COLS;
      this.grid[y][gx] = EMPTY;
      this.dotsLeft--;
      return c === POWER ? 2 : 1;
    }
    return 0;
  }

  render(ctx, time) {
    ctx.fillStyle = "#07070b";
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    this.renderWalls(ctx);
    this.renderDots(ctx, time);
    this.renderDoor(ctx);
  }

  renderWalls(ctx) {
    ctx.fillStyle = WALL_COLOR;
    const inset = 2;
    const r = 4;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!this.wall[y][x]) continue;
        const bx = x * TILE;
        const by = y * TILE;
        ctx.beginPath();
        ctx.roundRect(bx + inset, by + inset, TILE - inset * 2, TILE - inset * 2, r);
        ctx.fill();
      }
    }
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!this.wall[y][x]) continue;
        const bx = x * TILE;
        const by = y * TILE;
        const gap = TILE - inset * 2;
        const fill = (gx, gy, w, h) => ctx.fillRect(gx, gy, w, h);
        if (y > 0 && this.wall[y - 1][x]) fill(bx + inset, by - inset * 2, gap, inset * 2);
        if (y < ROWS - 1 && this.wall[y + 1][x]) fill(bx + inset, by + TILE - inset * 2, gap, inset * 2);
        if (x > 0 && this.wall[y][x - 1]) fill(bx - inset * 2, by + inset, inset * 2, gap);
        if (x < COLS - 1 && this.wall[y][x + 1]) fill(bx + TILE - inset * 2, by + inset, inset * 2, gap);
      }
    }
  }

  renderDots(ctx, time) {
    for (const [x, y] of this.dots) {
      if (this.grid[y][x] !== DOT) continue;
      ctx.fillStyle = "#ffd9a0";
      ctx.beginPath();
      ctx.arc(x * TILE + 8, y * TILE + 8, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    const pulse = 0.75 + 0.25 * Math.sin(time * 6);
    for (const [x, y] of this.power) {
      if (this.grid[y][x] !== POWER) continue;
      ctx.fillStyle = "#ffd9a0";
      ctx.beginPath();
      ctx.arc(x * TILE + 8, y * TILE + 8, 5 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderDoor(ctx) {
    if (!this.doors.length) return;
    const minX = Math.min(...this.doors.map(d => d[0]));
    const maxX = Math.max(...this.doors.map(d => d[0]));
    const y = this.doors[0][1];
    const x0 = minX * TILE;
    const w = (maxX - minX + 1) * TILE;
    ctx.fillStyle = DOOR_COLOR;
    ctx.beginPath();
    ctx.roundRect(x0, y * TILE + 5, w, 5, 3);
    ctx.fill();
  }
}
