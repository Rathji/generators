// Task #118: Environment Object System — coordinate-based interactables with
// flavor text and optional one-time effects (item, gold, flag, dialogue).
// Objects sit on walkable tiles and are resolved on interaction; once-only
// effects are tracked by per-object flags.

import { ENVIRONMENT_OBJECTS } from "../data/environment-objects.js";
import { ITEMS } from "../data/items.js";

export class EnvironmentObjectSystem {
  constructor(objects = ENVIRONMENT_OBJECTS, opts = {}) {
    this.objects = objects;
    this.state = opts.state ?? null;
    this.inventory = opts.inventory ?? null;
    this.party = opts.party ?? null;
    this.maps = opts.maps ?? null;
    this.handlers = opts.handlers ?? {};
    this.invalid = [];
    this._validate();
  }

  all() {
    return [...this.objects];
  }

  objectById(id) {
    return this.objects.find((o) => o.id === id) ?? null;
  }

  objectsFor(mapId) {
    return this.objects.filter((o) => o.mapId === mapId);
  }

  objectAt(mapId, x, y) {
    return this.objects.find((o) => o.mapId === mapId && o.x === x && o.y === y) ?? null;
  }

  isUsed(obj) {
    if (!obj || !obj.flag || !this.state) return false;
    return !!this.state.getFlag(obj.flag);
  }

  isAvailable(obj) {
    if (!obj) return false;
    if (obj.require?.flag && !(this.state && this.state.getFlag(obj.require.flag))) return false;
    if (obj.once && this.isUsed(obj)) return false;
    return true;
  }

  // Interact with an object at a position. Returns {ok, object, flavor, ...}.
  interact(mapId, x, y) {
    const obj = this.objectAt(mapId, x, y);
    if (!obj) return { ok: false, error: "nothing here", object: null };
    if (obj.require?.flag && !(this.state && this.state.getFlag(obj.require.flag))) {
      return { ok: false, error: "locked", object: obj, locked: true };
    }
    if (obj.once && this.isUsed(obj)) {
      return { ok: false, error: "already used", object: obj, used: true };
    }
    const out = { ok: true, object: obj, label: obj.label, flavor: obj.flavor ?? "" };
    const eff = obj.effect;
    if (eff) {
      switch (eff.type) {
        case "item": {
          const ok = this.inventory ? this.inventory.add(eff.itemId, eff.count ?? 1) : true;
          if (ok) out.granted = { itemId: eff.itemId, count: eff.count ?? 1 };
          else out.overflow = true;
          break;
        }
        case "gold":
          if (this.party) {
            this.party.addGold(eff.amount ?? 0);
            out.gold = eff.amount ?? 0;
          }
          break;
        case "flag":
          if (this.state) this.state.setFlag(eff.flag, eff.value ?? true);
          out.flag = eff.flag;
          break;
        case "dialogue":
          if (this.handlers.dialogue) this.handlers.dialogue(eff.dialogueId);
          out.dialogue = eff.dialogueId;
          break;
        case "heal":
          if (this.party) for (const m of this.party.members) m.heal(eff.amount ?? 50);
          out.healed = eff.amount ?? 50;
          break;
        default:
          out.error = "unknown effect: " + eff.type;
          return { ...out, ok: false };
      }
    }
    if (obj.once && obj.flag && this.state) this.state.setFlag(obj.flag, true);
    return out;
  }

  _validate() {
    this.invalid = [];
    const seen = new Set();
    for (const o of this.objects) {
      if (seen.has(o.id)) this.invalid.push({ id: o.id, reason: "duplicate id" });
      seen.add(o.id);
      if (!o.label) this.invalid.push({ id: o.id, reason: "missing label" });
      if (o.once && !o.flag) this.invalid.push({ id: o.id, reason: "once without flag" });
      if (o.effect?.type === "item" && !ITEMS[o.effect.itemId]) {
        this.invalid.push({ id: o.id, reason: "unknown item: " + o.effect.itemId });
      }
      const def = this.maps?.get?.(o.mapId);
      if (def) {
        const ch = def.rows?.[o.y]?.[o.x];
        if (ch === undefined) this.invalid.push({ id: o.id, reason: "out of bounds" });
        else if (def.solid?.[ch]) this.invalid.push({ id: o.id, reason: "solid tile" });
      } else if (this.maps) {
        this.invalid.push({ id: o.id, mapId: o.mapId, reason: "no such map" });
      }
    }
    return this;
  }

  get invalidPlacements() {
    return [...this.invalid];
  }

  isValid() {
    return this.invalid.length === 0;
  }
}
