// Task #19: Overworld-to-Town Transition Logic — map registry plus a
// transition manager that swaps maps and preserves the return point.

import { TileMap } from "./grid.js";

export class MapManager {
  constructor() {
    this.maps = new Map();
  }

  register(def) {
    this.maps.set(def.id, def);
    return this;
  }

  get(id) {
    return this.maps.get(id) ?? null;
  }

  has(id) {
    return this.maps.has(id);
  }

  buildTileMap(id) {
    const def = this.get(id);
    if (!def) return null;
    return TileMap.fromAscii(def.rows, {
      tiles: def.tiles,
      solid: def.solid,
      overhead: def.overhead,
      overheadTiles: def.overheadTiles,
    });
  }
}

// Task #21 addition: interior/exterior transitions preserve the player's
// coordinates and state across overworld <-> town <-> dungeon swaps via an
// exit-point stack plus per-map remembered positions.

export class TransitionManager {
  constructor(registry) {
    this.registry = registry;
    this.links = [];
    this.current = null;
    this.returnPoint = null;
    this.exitStack = [];
    this.positions = new Map();
  }

  addLink(link) {
    this.links.push(link);
    return this;
  }

  findLink(fromMap, x, y) {
    return this.links.find((l) => l.fromMap === fromMap && l.fromX === x && l.fromY === y) ?? null;
  }

  start(mapId, x, y, facing = "S") {
    if (!this.registry.has(mapId)) return null;
    this.current = { mapId, x, y, facing };
    return this.current;
  }

  moveTo(mapId, x, y, facing = "S") {
    if (!this.registry.has(mapId)) return null;
    const from = this.current ? { ...this.current } : null;
    this.current = { mapId, x, y, facing };
    return { from, to: { ...this.current } };
  }

  // Walk off a transition tile (a door/exit) to the linked map.
  transitionAt(x, y) {
    if (!this.current) return null;
    const link = this.findLink(this.current.mapId, x, y);
    if (!link) return null;
    return this.moveTo(link.toMap, link.toX, link.toY, link.facing ?? "S");
  }

  // Enter a town/interior from the overworld, remembering the return spot.
  enterTown(exitX, exitY, townId, townX, townY) {
    if (!this.current || !this.registry.has(townId)) return null;
    this.returnPoint = { mapId: this.current.mapId, x: exitX, y: exitY };
    return this.moveTo(townId, townX, townY);
  }

  leaveTown() {
    if (!this.returnPoint) return null;
    const rp = this.returnPoint;
    this.returnPoint = null;
    return this.moveTo(rp.mapId, rp.x, rp.y);
  }

  // --- Interior/Exterior preservation (Task #21) ---

  // Remember a map's coordinates/facing for later re-entry.
  rememberPosition(mapId, x, y, facing = "S") {
    this.positions.set(mapId, { mapId, x, y, facing });
    return this;
  }

  lastPosition(mapId) {
    return this.positions.get(mapId) ?? null;
  }

  pushExit(mapId, x, y, facing = "S") {
    this.exitStack.push({ mapId, x, y, facing });
    return this;
  }

  peekExit() {
    return this.exitStack.length ? this.exitStack[this.exitStack.length - 1] : null;
  }

  popExit() {
    return this.exitStack.pop() ?? null;
  }

  get depth() {
    return this.exitStack.length;
  }

  // Generic interior/exterior swap: current location is remembered (both in
  // `positions` for re-entry and on the exit stack) before moving to the new
  // map. Coordinates and facing state are fully preserved.
  transitionTo(toMapId, toX, toY, facing = "S", opts = {}) {
    if (!this.registry.has(toMapId)) return null;
    if (this.current) {
      this.rememberPosition(this.current.mapId, this.current.x, this.current.y, this.current.facing);
      if (opts.remember !== false) {
        this.pushExit(this.current.mapId, this.current.x, this.current.y, this.current.facing);
      }
    }
    return this.moveTo(toMapId, toX, toY, facing);
  }

  // Leave an interior back to the most recent saved exterior position.
  exitInterior() {
    const exit = this.popExit();
    if (!exit) return null;
    const from = this.current ? { ...this.current } : null;
    this.current = { mapId: exit.mapId, x: exit.x, y: exit.y, facing: exit.facing ?? "S" };
    return { from, to: { ...this.current } };
  }

  // Return to a map's last remembered position (used to restore an interior
  // exit tile after re-entering a map). Returns false if none remembered.
  restorePosition(mapId) {
    const pos = this.lastPosition(mapId);
    if (!pos) return false;
    this.current = { mapId: pos.mapId, x: pos.x, y: pos.y, facing: pos.facing ?? "S" };
    return true;
  }
}
