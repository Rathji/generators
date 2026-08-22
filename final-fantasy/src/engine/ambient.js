// Task #52: Town Ambient Logic — non-essential NPCs wander near their home
// tile on a living-town timer, using NpcController for the actual stepping.

import { GridEntity, MovementSystem } from "./movement.js";
import { NpcController } from "./npc.js";

export class AmbientNpcSystem {
  constructor(opts = {}) {
    this.placements = opts.placements ?? null; // NpcPlacementSystem
    this.maps = opts.maps ?? null; // MapManager
    this.random = opts.random ?? Math.random;
    this.active = new Map(); // npcId -> { controller, entity, sys, homeX, homeY, wanderRadius, mapId }
    this.tickCount = 0;
  }

  _isAmbient(npc) {
    return npc.ambient !== false;
  }

  // Build controllers for every ambient NPC on a map (idempotent per npc).
  spawn(mapId) {
    if (!this.placements || !this.maps) return this;
    const def = this.maps.get(mapId);
    if (!def) return this;
    const sys = new MovementSystem(this.maps.buildTileMap(mapId));
    const list = typeof this.placements.activeNpcsFor === "function"
      ? this.placements.activeNpcsFor(mapId)
      : this.placements.npcsFor(mapId);
    for (const n of list) {
      if (!this._isAmbient(n) || this.active.has(n.id)) continue;
      const entity = new GridEntity(n.x, n.y, { id: n.id, facing: n.facing });
      if (!sys.addEntity(entity)) continue;
      const controller = new NpcController(sys, entity, { type: "patrol" }, { random: this.random });
      this.active.set(n.id, {
        controller,
        entity,
        sys,
        homeX: n.x,
        homeY: n.y,
        wanderRadius: n.wanderRadius ?? 2,
        mapId,
      });
    }
    return this;
  }

  _randomPoint(c) {
    const r = c.wanderRadius;
    let x = c.homeX;
    let y = c.homeY;
    let guard = 0;
    do {
      x = c.homeX + Math.floor((this.random() * 2 - 1) * r);
      y = c.homeY + Math.floor((this.random() * 2 - 1) * r);
      guard++;
    } while (guard < 20 && !c.sys.map.canStand(x, y));
    return { x, y };
  }

  // Advance all ambient NPCs one tick. Every few ticks each NPC gets a fresh
  // random waypoint near home, then steps toward it.
  tick() {
    for (const c of this.active.values()) {
      if (!c.controller.waypoints.length || this.random() < 0.06) {
        c.controller.setWaypoints([this._randomPoint(c)]);
      }
      c.controller.update();
    }
    this.tickCount++;
    return this;
  }

  // Run a number of ticks (used by idle loops / tests).
  run(ticks = 1) {
    for (let i = 0; i < ticks; i++) this.tick();
    return this;
  }

  positions() {
    const out = {};
    for (const [id, c] of this.active) {
      out[id] = { x: c.entity.x, y: c.entity.y, facing: c.entity.facing, mapId: c.mapId };
    }
    return out;
  }

  position(npcId) {
    const c = this.active.get(npcId);
    return c ? { x: c.entity.x, y: c.entity.y, facing: c.entity.facing, mapId: c.mapId } : null;
  }

  stepsTaken(npcId) {
    return this.active.get(npcId)?.controller.stepsTaken ?? 0;
  }

  stopAll() {
    this.active.clear();
    return this;
  }

  count() {
    return this.active.size;
  }
}
