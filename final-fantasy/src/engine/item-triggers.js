// Task #44: Key Item Trigger Mapping — inventory items unlock world events
// (entry to a castle, opening a chamber, etc.) and can be consumed on use.

import { matchCondition } from "./dialogue.js";

export class ItemTriggerSystem {
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

  find(id) {
    return this.triggers.find((t) => t.id === id) ?? null;
  }

  byItem(itemId) {
    return this.triggers.filter((t) => t.item === itemId);
  }

  pending(itemId) {
    return this.byItem(itemId).filter((t) => !this._done(t));
  }

  all() {
    return [...this.triggers];
  }

  _done(def) {
    if (!def.once) return false;
    const flag = def.flag ?? def.flags?.[0];
    if (!flag) return false;
    return !!(this.world && typeof this.world.getFlag === "function" && this.world.getFlag(flag));
  }

  // Dry-run check: does the party hold the key item and meet conditions?
  canTrigger(id, ctx = {}) {
    const def = this.find(id);
    if (!def) return { ok: false, error: "unknown trigger", trigger: null };
    const world = ctx.world ?? this.world;
    const inv = ctx.inventory;
    if (inv && !inv.has(def.item)) return { ok: false, error: "missing item", trigger: def, requires: def.item };
    if (!matchCondition(def.condition ?? null, world)) return { ok: false, error: "condition unmet", trigger: def };
    if (this._done(def)) return { ok: false, error: "already triggered", trigger: def };
    return { ok: true, trigger: def };
  }

  // Fire the trigger: optionally consume the key item, set flags, run handler.
  trigger(id, ctx = {}) {
    const check = this.canTrigger(id, ctx);
    if (!check.ok) return check;
    const def = check.trigger;
    const world = ctx.world ?? this.world;
    const results = {
      triggered: def.id,
      item: def.item,
      consumed: false,
      flags: [],
      events: [],
    };
    if (def.consume && ctx.inventory) {
      const n = def.consume === true ? 1 : def.consume;
      results.consumed = ctx.inventory.remove(def.item, n);
    }
    for (const f of def.flags ?? []) {
      if (ctx.state && typeof ctx.state.setFlag === "function") ctx.state.setFlag(f, true);
      if (world && typeof world.setFlag === "function") world.setFlag(f, true);
      results.flags.push(f);
    }
    if (def.event) results.events.push(def.event);
    if (ctx.handlers?.event) ctx.handlers.event(def, results, ctx);
    return results;
  }

  // Convenience for gate-like checks: is the item's effect already unlocked?
  isUnlocked(id, ctx = {}) {
    return this.canTrigger(id, ctx).ok;
  }
}
