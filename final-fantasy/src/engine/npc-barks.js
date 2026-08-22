// Task #141: NpcBarkSystem — proximity-based NPC one-liners. `tick(mapId,
// px, py)` finds every bark whose NPC currently stands within `radius` of
// the player (using the live placement system, so schedules and quest
// states move the NPC) and fires it, subject to a per-bark step cooldown
// and/or a once-per-save flag.

import { NPC_BARKS } from "../data/npc-barks.js";

export class NpcBarkSystem {
  constructor(defs = NPC_BARKS, opts = {}) {
    this.defs = defs;
    this.placements = opts.placements ?? null;
    this.state = opts.state ?? null;
    this._cooldowns = new Map();
  }

  bindPlacements(placements) {
    this.placements = placements;
    return this;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  all() {
    return [...this.defs];
  }

  defsFor(mapId) {
    return this.all().filter((b) => b.mapId === mapId);
  }

  flagFor(id) {
    return "npc_bark_" + id;
  }

  hasFiredOnce(id) {
    return !!(this.state && this.state.getFlag(this.flagFor(id)));
  }

  cooldownRemaining(id) {
    return this._cooldowns.get(id) ?? 0;
  }

  // Advance the world by `steps` and fire any barks now in range. Returns
  // the fired bark lines ({id, npc, line}).
  tick(mapId, px, py, steps = 1) {
    const fired = [];
    for (const bark of this.defsFor(mapId)) {
      if (bark.once && this.hasFiredOnce(bark.id)) continue;
      const cd = this._cooldowns.get(bark.id) ?? 0;
      if (cd > 0) {
        this._cooldowns.set(bark.id, cd - steps);
        continue;
      }
      const npc = this.placements?.activeNpcsFor(mapId).find((n) => n.id === bark.npc);
      if (!npc) continue;
      const dx = Math.abs(npc.x - px);
      const dy = Math.abs(npc.y - py);
      if (Math.max(dx, dy) > bark.radius) continue;
      fired.push({ id: bark.id, npcId: bark.npc, npc: npc.name ?? bark.npc, line: bark.line });
      this._cooldowns.set(bark.id, (bark.cooldownSteps ?? 10) - steps);
      if (bark.once) this.state?.setFlag(this.flagFor(bark.id), true);
    }
    return fired;
  }

  // Audit: every bark must reference a real NPC on its map.
  audit(placements = null) {
    const report = [];
    for (const bark of this.all()) {
      if (!placements) continue;
      const list = placements.placements?.[bark.mapId] ?? [];
      if (!list.some((n) => n.id === bark.npc)) {
        report.push({ id: bark.id, error: "npc " + bark.npc + " not placed on " + bark.mapId });
      }
    }
    return report;
  }
}
