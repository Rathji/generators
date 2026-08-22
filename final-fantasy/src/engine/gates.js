// Task #16: Key Item Gate System — pass/fail checks on map coordinates
// that require key items (or other conditions) before allowing entry.

import { matchCondition } from "./dialogue.js";

export class GateSystem {
  constructor(world = null) {
    this.gates = [];
    this.world = world;
  }

  bindWorld(world) {
    this.world = world;
    return this;
  }

  add(def) {
    this.gates.push(def);
    return this;
  }

  gateAt(mapId, x, y) {
    return this.gates.find((g) => g.mapId === mapId && g.x === x && g.y === y) ?? null;
  }

  canPass(mapId, x, y) {
    const gate = this.gateAt(mapId, x, y);
    if (!gate) return { allowed: true, gate: null, reason: null };
    const ok = matchCondition(gate.require, this.world);
    return {
      allowed: ok,
      gate,
      reason: ok ? null : (gate.deniedDialogue ?? null),
    };
  }
}
