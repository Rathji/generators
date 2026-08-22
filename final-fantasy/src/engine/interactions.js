// Task #13: Interaction Trigger System — coordinate-based triggers that
// fire dialogue, battles, or scene transitions on interact/step.

import { matchCondition } from "./dialogue.js";

export class TriggerSystem {
  constructor(world = null) {
    this.triggers = [];
    this.world = world;
  }

  bindWorld(world) {
    this.world = world;
    return this;
  }

  add(def) {
    this.triggers.push(def);
    return this;
  }

  getTrigger(mapId, x, y, on = null) {
    return (
      this.triggers.find(
        (t) => t.mapId === mapId && t.x === x && t.y === y && (on == null || t.on === on)
      ) ?? null
    );
  }

  checkInteract(mapId, x, y) {
    return this.getTrigger(mapId, x, y, "interact");
  }

  checkStep(mapId, x, y) {
    return this.getTrigger(mapId, x, y, "step");
  }

  isActive(def) {
    if (!def || !def.condition) return true;
    return matchCondition(def.condition, this.world);
  }

  // Resolve the action of a trigger. Handlers (dialogue/transition/battle/
  // generic) may perform side effects; without them the action returns a
  // structured result describing what should happen.
  execute(def, ctx = {}, handlers = {}) {
    if (!def) return null;
    if (!this.isActive(def)) return { triggerId: def.id, skipped: true };
    const action = def.action;
    const out = { triggerId: def.id, action };
    switch (action.type) {
      case "dialogue":
        if (handlers.dialogue) {
          handlers.dialogue(action.dialogueId, ctx);
          return out;
        }
        out.result = action.dialogueId;
        return out;
      case "transition":
        if (handlers.transition) {
          handlers.transition(action, ctx);
          return out;
        }
        out.result = { mapId: action.mapId, x: action.x, y: action.y, facing: action.facing ?? "S" };
        return out;
      case "battle":
        if (handlers.battle) {
          handlers.battle(action.group, ctx);
          return out;
        }
        out.result = action.group;
        return out;
      default:
        if (handlers.generic) {
          handlers.generic(action, ctx);
          return out;
        }
        out.result = action;
        return out;
    }
  }
}
