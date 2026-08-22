// Task #103: WorldStateSystem — the Crystal Bridges and the sealed gates of
// the eastern sea. Bridges turn their water tiles into land once their
// crystal flag is set (fed to TerrainRules via `terrainOverride`, so movement
// and the world-map terrain both honor them); gates block passage until a
// number of crystals are restored. Pure logic (no DOM) — unit-testable.

import { WORLD_BRIDGES, WORLD_GATES } from "../data/world-state.js";

const CRYSTAL_FLAGS = ["crystal_fire", "crystal_water", "crystal_earth", "crystal_wind"];

export class WorldStateSystem {
  constructor(bridges = WORLD_BRIDGES, gates = WORLD_GATES, opts = {}) {
    this.bridges = bridges;
    this.gates = gates;
    this.state = opts.state ?? null;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  // One `require` condition: { flag } or { flags: [...] } (all) or
  // { crystals: N } (at least N crystals restored).
  requireMet(cond) {
    if (!cond) return true;
    if (!this.state) return false;
    if (cond.flag) return !!this.state.getFlag(cond.flag);
    if (cond.flags) return cond.flags.every((f) => !!this.state.getFlag(f));
    if (cond.crystals != null) {
      return CRYSTAL_FLAGS.filter((f) => this.state.getFlag(f)).length >= cond.crystals;
    }
    return true;
  }

  bridgeById(id) {
    return this.bridges.find((b) => b.id === id) ?? null;
  }

  gateById(id) {
    return this.gates.find((g) => g.id === id) ?? null;
  }

  isBridgeOpen(id) {
    const b = this.bridgeById(id);
    return !!b && this.requireMet(b.require);
  }

  isGateOpen(id) {
    const g = this.gateById(id);
    return !!g && this.requireMet(g.require);
  }

  openBridges() {
    return this.bridges.filter((b) => this.isBridgeOpen(b.id));
  }

  pendingBridges() {
    return this.bridges.filter((b) => !this.isBridgeOpen(b.id));
  }

  openGates() {
    return this.gates.filter((g) => this.isGateOpen(g.id));
  }

  pendingGates() {
    return this.gates.filter((g) => !this.isGateOpen(g.id));
  }

  bridgeAt(mapId, x, y) {
    return (
      this.bridges.find(
        (b) => b.mapId === mapId && b.tiles.some((t) => t.x === x && t.y === y)
      ) ?? null
    );
  }

  // Is this tile made walkable by an OPEN bridge?
  isBridged(mapId, x, y) {
    const b = this.bridgeAt(mapId, x, y);
    return !!b && this.isBridgeOpen(b.id);
  }

  // Terrain override for TerrainRules: returns "land" for an open bridge
  // tile, null everywhere else (so sealed bridges stay water).
  terrainOverride(mapId, x, y, type) {
    if (mapId && this.isBridged(mapId, x, y)) return "land";
    return null;
  }

  gateAt(mapId, x, y) {
    return this.gates.find((g) => g.mapId === mapId && g.x === x && g.y === y) ?? null;
  }

  // A gate here that is still sealed (blocks passage).
  sealedGateAt(mapId, x, y) {
    const g = this.gateAt(mapId, x, y);
    return g && !this.isGateOpen(g.id) ? g : null;
  }

  status() {
    return {
      bridges: this.bridges.map((b) => ({
        id: b.id,
        name: b.name,
        open: this.isBridgeOpen(b.id),
        label: b.label,
      })),
      gates: this.gates.map((g) => ({
        id: g.id,
        name: g.name,
        open: this.isGateOpen(g.id),
        label: g.label,
      })),
    };
  }

  describe() {
    const bridges = this.openBridges();
    const gates = this.pendingGates();
    let s = "Crystal Bridges: ";
    s += bridges.length ? bridges.map((b) => b.name).join(", ") : "none yet";
    s += ". Sealed gates: ";
    s += gates.length ? gates.map((g) => g.name).join(", ") : "none";
    return s;
  }
}
