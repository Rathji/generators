// Task #74: Overworld Event Triggers — coordinate-based world events (boss
// battles, narrative dialogue, travel unlocks). Events are gated by flag
// requirements, fire on step or interact, and may be one-shot via done flags.

import { matchCondition } from "./dialogue.js";

export class WorldEventSystem {
  constructor(events = [], opts = {}) {
    this.events = events;
    this.world = opts.world ?? null;
    this.state = opts.state ?? null;
  }

  bindWorld(world) {
    this.world = world;
    return this;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  all() {
    return this.events;
  }

  eventById(id) {
    return this.events.find((e) => e.id === id) ?? null;
  }

  eventAt(mapId, x, y, on = null) {
    return this.events.find((e) => e.mapId === mapId && e.x === x && e.y === y && (on == null || e.on === on)) ?? null;
  }

  checkStep(mapId, x, y) {
    return this.eventAt(mapId, x, y, "step");
  }

  checkInteract(mapId, x, y) {
    return this.eventAt(mapId, x, y, "interact");
  }

  // Requirement met? `require` uses dialogue-style conditions (flag/item/
  // notFlag) evaluated against the bound world.
  isReady(def) {
    if (!def.require) return true;
    return matchCondition(def.require, this.world);
  }

  isDone(def) {
    if (!def.once || !def.doneFlag) return false;
    return !!(this.world && typeof this.world.getFlag === "function" && this.world.getFlag(def.doneFlag));
  }

  pending(mapId, x, y, on = null) {
    const def = this.eventAt(mapId, x, y, on);
    if (!def) return null;
    if (this.isDone(def)) return null;
    if (!this.isReady(def)) return null;
    return def;
  }

  // Fire the event's action through the supplied handlers. Returns the event
  // descriptor plus the resolved result.
  trigger(def, handlers = {}) {
    const out = { eventId: def.id, event: def.event };
    const act = def.event;
    switch (act.type) {
      case "dialogue":
        if (handlers.dialogue) handlers.dialogue(act.dialogueId, def);
        out.result = act.dialogueId;
        break;
      case "bossBattle":
        if (handlers.bossBattle) {
          handlers.bossBattle(act, def);
          out.started = true;
        }
        out.result = act.group;
        break;
      case "trialBattle": {
        let res = null;
        if (handlers.trialBattle) res = handlers.trialBattle(act, def);
        out.started = !!(res && res.ok);
        out.result = res ? (res.id ?? act) : null;
        break;
      }
      // Task #184: touching a waystone lights it (and reports flavor).
      case "waystone":
        if (handlers.waystone) {
          handlers.waystone(act, def);
          out.lit = true;
        }
        out.result = act.waystoneId ?? null;
        break;
      // Task #195: the Echo of Creation — the New Game+ ultimate boss, risen
      // from the hollow at the hall's edge.
      case "echoBattle": {
        let res = null;
        if (handlers.echoBattle) res = handlers.echoBattle(act, def);
        out.started = !!(res && res.ok);
        out.result = res ? (res.id ?? act) : null;
        break;
      }
      case "grantTravel":
        if (handlers.grantTravel) {
          handlers.grantTravel(act, def);
          out.granted = true;
        }
        out.result = act.mode;
        break;
      case "setFlag":
        if (handlers.setFlag) handlers.setFlag(act.flag, act.value, def);
        else if (this.state) this.state.setFlag(act.flag, act.value ?? true);
        out.result = act.flag;
        break;
      default:
        if (handlers.generic) handlers.generic(act, def);
        out.result = act;
    }
    if (def.once && def.doneFlag) {
      this.markDone(def);
    }
    return out;
  }

  markDone(def) {
    if (this.state?.setFlag) this.state.setFlag(def.doneFlag, true);
  }
}
