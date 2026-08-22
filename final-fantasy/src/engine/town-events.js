// Task #51: Town-Specific Event Triggers — localized world flags fire
// town-unique events (dialogue, battles, item gifts, transitions). Each
// town has its own list; events become ready from flags/conditions and can
// be marked done to run once.

import { matchCondition } from "./dialogue.js";

export class TownEventSystem {
  constructor(defs = {}, opts = {}) {
    this.towns = defs;
    this.state = opts.state ?? null;
    this.world = opts.world ?? null;
    this.handlers = opts.handlers ?? {};
  }

  eventsFor(townId) {
    return [...(this.towns[townId] ?? [])];
  }

  eventById(eventId) {
    for (const list of Object.values(this.towns)) {
      const e = list.find((x) => x.id === eventId);
      if (e) return e;
    }
    return null;
  }

  _ready(def) {
    const t = def.trigger ?? {};
    const st = this.state;
    if (t.flag) {
      if (!st || !st.getFlag(t.flag)) return false;
    }
    if (t.notFlag) {
      if (st && st.getFlag(t.notFlag)) return false;
    }
    if (t.storyPhase) {
      if (!st || st.getStoryPhase() < t.storyPhase) return false;
    }
    if (t.condition) {
      if (!matchCondition(t.condition, this.world)) return false;
    }
    return true;
  }

  _done(def) {
    if (!def.once) return false;
    return !!(this.state && def.onDoneFlag && this.state.getFlag(def.onDoneFlag));
  }

  // Events that are currently ready to fire.
  pending(townId) {
    return this.eventsFor(townId).filter((e) => this._ready(e) && !this._done(e));
  }

  // Fire the next pending event for a town (null when none). Returns the
  // event outcome (or a structured result when no handler is wired).
  check(townId) {
    const ev = this.pending(townId)[0] ?? null;
    if (!ev) return null;
    return this.fire(ev);
  }

  // Fire a specific event by id (for dialogue or interact-triggered flows).
  fireById(eventId) {
    const def = this.eventById(eventId);
    if (!def) return { ok: false, error: "unknown event" };
    if (!this._ready(def)) return { ok: false, error: "not ready" };
    return this.fire(def);
  }

  fire(def) {
    const out = {
      ok: true,
      eventId: def.id,
      town: this._townOf(def),
      type: def.event?.type ?? null,
      result: null,
    };
    const ev = def.event ?? {};
    const ctx = { state: this.state, world: this.world };
    switch (ev.type) {
      case "dialogue": {
        if (this.handlers.dialogue) this.handlers.dialogue(ev.dialogueId, ctx);
        else out.result = ev.dialogueId;
        break;
      }
      case "battle": {
        if (this.handlers.battle) this.handlers.battle(ev.group, ctx);
        else out.result = ev.group;
        break;
      }
      case "transition": {
        if (this.handlers.transition) this.handlers.transition(ev, ctx);
        else out.result = { mapId: ev.mapId, x: ev.x, y: ev.y, facing: ev.facing ?? "S" };
        break;
      }
      case "giveItem": {
        if (this.state?.inventory) this.state.inventory.add(ev.itemId, ev.count ?? 1);
        else if (this.handlers.giveItem) this.handlers.giveItem(ev.itemId, ev.count ?? 1, ctx);
        else out.result = ev.itemId;
        break;
      }
      case "setFlag": {
        if (this.state) this.state.setFlag(ev.flag, ev.value ?? true);
        out.result = ev.flag;
        break;
      }
      case "event": {
        if (this.handlers.event) this.handlers.event(ev.name, ctx);
        out.result = ev.name;
        break;
      }
      default:
        out.ok = false;
        out.result = ev;
    }
    if (def.onDoneFlag && this.state) this.state.setFlag(def.onDoneFlag, true);
    return out;
  }

  _townOf(def) {
    for (const [town, list] of Object.entries(this.towns)) {
      if (list.includes(def)) return town;
    }
    return null;
  }

  // Mark an event done manually (e.g. player completed it by other means).
  complete(eventId) {
    const def = this.eventById(eventId);
    if (!def || !def.onDoneFlag || !this.state) return false;
    this.state.setFlag(def.onDoneFlag, true);
    return true;
  }
}
