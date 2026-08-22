// Task #138: NpcScheduleSystem — resolves where an NPC should be at a given
// hour of the game clock. Consumed by NpcPlacementSystem.resolveState, so
// rendered positions (and interaction lookups) automatically follow the
// clock. Schedules are consulted AFTER quest states and never override them.

import { NPC_SCHEDULES } from "../data/npc-schedules.js";

export class NpcScheduleSystem {
  constructor(schedules = NPC_SCHEDULES, clock = null) {
    this.schedules = schedules;
    this.clock = clock ?? null;
  }

  bindClock(clock) {
    this.clock = clock;
    return this;
  }

  def(npcId) {
    return this.schedules[npcId] ?? null;
  }

  // Position for an NPC at `hour`. `list` may override the global data (an
  // inline `npc.schedule` array takes precedence). Returns
  // { x, y, facing, active, from, to } or null when the NPC has no schedule
  // window covering the hour (they stay at their base placement).
  positionFor(npcId, hour = this.clock?.hour ?? 8, list = null) {
    const windows = list ?? this.def(npcId);
    if (!windows || !windows.length) return null;
    for (const w of windows) {
      if (hour >= w.from && hour < w.to) {
        return {
          x: w.x,
          y: w.y,
          facing: w.facing ?? null,
          active: w.active ?? true,
          from: w.from,
          to: w.to,
        };
      }
    }
    return null;
  }

  // Audit: every window must be a sane hour range with in-bounds coords and
  // a real NPC placement on its map.
  audit(placements = null, registry = null) {
    const report = [];
    const lookup = placements?.allNpcs ? placements.allNpcs() : null;
    for (const [npcId, windows] of Object.entries(this.schedules)) {
      const npc = lookup?.find((n) => n.id === npcId);
      if (placements && !npc) report.push({ npcId, error: "npc not placed" });
      for (const [i, w] of windows.entries()) {
        if (typeof w.from !== "number" || typeof w.to !== "number" || w.from < 0 || w.to > 24 || w.from >= w.to) {
          report.push({ npcId, index: i, error: "invalid hour window" });
        }
        if (typeof w.x !== "number" || typeof w.y !== "number") {
          report.push({ npcId, index: i, error: "missing coordinates" });
        }
        if (npc && registry) {
          const def = registry.get?.(npc.mapId);
          const h = def?.rows?.length ?? 0;
          const wd = def?.rows?.[0]?.length ?? 0;
          if (def && (w.x < 0 || w.y < 0 || w.x >= wd || w.y >= h)) {
            report.push({ npcId, index: i, error: "out of bounds", x: w.x, y: w.y });
          }
        }
      }
    }
    return report;
  }
}
