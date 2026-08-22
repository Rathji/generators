// Grid-entity movement with cardinal-only steps and tile/entity collision.
// Task #1: Grid-Based Movement System — see backlog.pjs.
// Tasks #34-36 additions: multi-tile world-map steps and terrain/travel-mode
// gating (land/ship/air) via an optional TerrainRules instance.
// Task #81 addition: frame-rate independent held movement — enqueue/held
// moves are executed from `update(dtMs)` at a fixed step interval, so the
// on-screen speed does not depend on the tick rate.

import { DIRS } from "./grid.js";
import { TRAVEL_MODES } from "./terrain.js";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export class GridEntity {
  constructor(x, y, opts = {}) {
    this.x = x;
    this.y = y;
    this.facing = opts.facing ?? "N";
    this.id = opts.id ?? null;
    this.travelMode = opts.travelMode ?? TRAVEL_MODES.LAND;
  }

  get pos() {
    return { x: this.x, y: this.y };
  }

  setTravelMode(mode) {
    if (Object.values(TRAVEL_MODES).includes(mode)) this.travelMode = mode;
    return this;
  }
}

// Owns a map and the entities standing on it. Moves are one tile at a time in
// exactly one cardinal direction; any other direction is rejected outright.
export class MovementSystem {
  constructor(map, entities = []) {
    this.map = map;
    this.entities = [];
    this._occupied = new Map(); // "x,y" -> entity
    this.terrain = null; // optional TerrainRules for land/ship/air gating
    this.terrainSpeed = null; // optional TerrainSpeedSystem (Task #136)
    this.scale = 1; // world-map steps per move (Task #34)
    this.walkabilityHook = null; // optional puzzle/door blocker (Task #55)
    // Task #149/#152: optional passability override — a callback returning
    // "open" (walkable even on a solid tile), "block", or null (use the map).
    this.passabilityOverride = null;
    // Task #81: frame-rate independent movement.
    this.stepInterval = 180; // ms per held step
    this._acc = 0;
    this._held = new Map(); // entity -> dir
    this._pending = []; // { entity, dir } queued by enqueueMove
    for (const e of entities) this.addEntity(e);
  }

  setStepInterval(ms) {
    this.stepInterval = Math.max(1, ms);
    return this;
  }

  // Hold-to-move: mark the direction the entity wants to keep walking.
  setHeld(entity, dir) {
    if (!hasOwn(DIRS, dir)) return this;
    this._held.set(entity, dir);
    return this;
  }

  clearHeld(entity) {
    this._held.delete(entity);
    return this;
  }

  isHeld(entity) {
    return this._held.has(entity);
  }

  // Queue an immediate move (executed on the next update() call, or flushed
  // with update(0) via drain()).
  enqueueMove(entity, dir) {
    if (!hasOwn(DIRS, dir)) return false;
    this._pending.push({ entity, dir });
    return true;
  }

  pendingCount() {
    return this._pending.length;
  }

  // Execute any queued moves immediately (used when a key is first pressed).
  drain() {
    const out = [];
    while (this._pending.length) {
      const { entity, dir } = this._pending.shift();
      out.push({ entity, dir, moved: this.move(entity, dir) });
    }
    return out;
  }

  // Advance movement by dtMs. Returns the steps actually taken this tick,
  // which stays constant per unit of simulated time regardless of how the
  // dt is chunked (frame-rate independence).
  update(dtMs) {
    const steps = [];
    if (dtMs < 0) return steps;
    this._acc += dtMs;
    while (this._acc >= this.stepInterval) {
      this._acc -= this.stepInterval;
      for (const [entity, dir] of [...this._held]) {
        steps.push({ entity, dir, moved: this.move(entity, dir) });
      }
      if (this._pending.length) steps.push(...this.drain());
    }
    if (this._held.size === 0 && this._pending.length === 0) this._acc = 0;
    return steps;
  }

  _key(x, y) {
    return x + "," + y;
  }

  addEntity(entity) {
    const k = this._key(entity.x, entity.y);
    if (this._occupied.has(k)) return false; // tile already taken
    this.entities.push(entity);
    this._occupied.set(k, entity);
    return true;
  }

  removeEntity(entity) {
    const i = this.entities.indexOf(entity);
    if (i === -1) return false;
    this.entities.splice(i, 1);
    const k = this._key(entity.x, entity.y);
    if (this._occupied.get(k) === entity) this._occupied.delete(k);
    return true;
  }

  entityAt(x, y) {
    return this._occupied.get(this._key(x, y)) ?? null;
  }

  isOccupied(x, y) {
    return this._occupied.has(this._key(x, y));
  }

  setTerrain(rules) {
    this.terrain = rules;
    return this;
  }

  // Optional callback consulted by isWalkable: return truthy to block a cell
  // (e.g. a puzzle door that is still closed). Task #55.
  setWalkabilityHook(fn) {
    this.walkabilityHook = fn ?? null;
    return this;
  }

  // Task #149/#152: optional passability override — fn(x, y, mode) returns
  // "open" to make a solid tile walkable (a revealed secret wall, an opened
  // gate), "block" to seal a tile, or null to use the map's own collision.
  setPassabilityOverride(fn) {
    this.passabilityOverride = fn ?? null;
    return this;
  }

  setScale(n) {
    this.scale = Math.max(1, Math.floor(n));
    return this;
  }

  // Task #136: optional TerrainSpeedSystem — moveScaled then spends the
  // scale as a movement BUDGET, each tile costing its terrain cost (grass 1,
  // forest/ice 2, mountain 4, ...) so terrain changes travel speed.
  setTerrainSpeed(sys) {
    this.terrainSpeed = sys ?? null;
    return this;
  }

  // Walkable = in-bounds, non-solid tile, traversable terrain (for the
  // entity's travel mode), not blocked by an external hook, AND not blocked
  // by another entity.
  isWalkable(x, y, ignore = null, mode = TRAVEL_MODES.LAND) {
    const ov = this.passabilityOverride ? this.passabilityOverride(x, y, mode) : null;
    if (ov === "block") return false;
    if (ov !== "open" && !this.map.canStand(x, y)) return false;
    if (this.terrain && !this.terrain.canTraverse(mode, x, y)) return false;
    if (this.walkabilityHook && this.walkabilityHook(x, y, mode)) return false;
    const occupant = this.entityAt(x, y);
    return occupant === null || occupant === ignore;
  }

  canMove(entity, dir, steps = 1) {
    if (!hasOwn(DIRS, dir)) return false;
    const { dx, dy } = DIRS[dir];
    const mode = entity.travelMode ?? TRAVEL_MODES.LAND;
    for (let i = 1; i <= steps; i++) {
      if (!this.isWalkable(entity.x + dx * i, entity.y + dy * i, entity, mode)) return false;
    }
    return true;
  }

  // Attempt one step in `dir`. Non-cardinal directions never move anything.
  // A blocked step still turns the entity to face the obstacle.
  move(entity, dir) {
    if (!hasOwn(DIRS, dir)) return false;
    entity.facing = dir;
    if (!this.canMove(entity, dir, 1)) return false;
    const { dx, dy } = DIRS[dir];
    this._occupied.delete(this._key(entity.x, entity.y));
    entity.x += dx;
    entity.y += dy;
    this._occupied.set(this._key(entity.x, entity.y), entity);
    return true;
  }

  // Multi-tile step (Task #34) — every intermediate cell must be clear.
  moveSteps(entity, dir, steps = 1) {
    if (!hasOwn(DIRS, dir)) return false;
    entity.facing = dir;
    if (!this.canMove(entity, dir, steps)) return false;
    const { dx, dy } = DIRS[dir];
    this._occupied.delete(this._key(entity.x, entity.y));
    entity.x += dx * steps;
    entity.y += dy * steps;
    this._occupied.set(this._key(entity.x, entity.y), entity);
    return true;
  }

  // One scaled world-map move (Task #34). With a TerrainSpeedSystem bound
  // (Task #136), `scale` is a movement BUDGET: each tile entered costs its
  // terrain cost, so forest halves overworld speed and mountains slow you
  // further — but only as far as the mode can actually traverse. Partial
  // progress is allowed (a forest move advances 1 tile when the budget is 2);
  // a fully blocked first tile returns false like moveSteps does.
  moveScaled(entity, dir) {
    if (!this.terrainSpeed) return this.moveSteps(entity, dir, this.scale);
    if (!hasOwn(DIRS, dir)) return false;
    entity.facing = dir;
    const { dx, dy } = DIRS[dir];
    const mode = entity.travelMode ?? TRAVEL_MODES.LAND;
    let budget = this.scale;
    let moved = 0;
    while (budget > 0) {
      const nx = entity.x + dx;
      const ny = entity.y + dy;
      if (!this.isWalkable(nx, ny, entity, mode)) break;
      const cost = this.terrainSpeed.moveCost(nx, ny, mode);
      if (!Number.isFinite(cost) || cost > budget) break;
      budget -= cost;
      this._occupied.delete(this._key(entity.x, entity.y));
      entity.x = nx;
      entity.y = ny;
      this._occupied.set(this._key(entity.x, entity.y), entity);
      moved += 1;
    }
    return moved > 0;
  }
}
