// Task #153: Narrative Pacing Gates — "Wait" conditions that keep the party
// from reaching a final area until mid-game flags are checked. Unlike key
// gates (GateSystem) these are pure flag pacing checks: denied passage
// yields a "Wait" line; once the flags are met the way is open.

import { TileMap } from "./grid.js";

export class PacingGateSystem {
  constructor(gates = [], opts = {}) {
    this.gates = gates;
    this.state = opts.state ?? null;
  }

  all() {
    return [...this.gates];
  }

  gateById(id) {
    return this.gates.find((g) => g.id === id) ?? null;
  }

  gateAt(mapId, x, y) {
    return this.gates.find((g) => g.mapId === mapId && g.x === x && g.y === y) ?? null;
  }

  unlocked(gate) {
    if (!gate) return true;
    return (gate.require?.flags ?? []).every((f) => !!this.state && this.state.getFlag(f));
  }

  canPass(mapId, x, y) {
    const gate = this.gateAt(mapId, x, y);
    if (!gate) return { allowed: true, gate: null, reason: null };
    const ok = this.unlocked(gate);
    return {
      allowed: ok,
      gate,
      reason: ok ? null : (gate.deny ?? "Wait — the way is not yet open."),
      unlockFlag: gate.unlockFlag ?? null,
    };
  }

  pending() {
    return this.gates.filter((g) => !this.unlocked(g));
  }

  openGates() {
    return this.gates.filter((g) => this.unlocked(g));
  }

  // Gates sit on walkable tiles of their map.
  audit(registry) {
    const errors = [];
    for (const g of this.gates) {
      const def = registry?.get?.(g.mapId);
      if (!def) {
        errors.push({ id: g.id, error: "no such map: " + g.mapId });
        continue;
      }
      if (!TileMap.fromAscii(def.rows, { tiles: def.tiles, solid: def.solid }).canStand(g.x, g.y)) {
        errors.push({ id: g.id, error: "gate tile not walkable at " + g.x + "," + g.y });
      }
    }
    return errors;
  }
}
