// Task #183: WaystoneSystem — the Waystone Network. Touching a waystone on
// the map activates it (a `waystone_<id>` flag); once lit, the party may
// fast-travel to any other lit waystone. Pure logic (no DOM) so it is fully
// unit-testable; the demo drives it through world events + a travel panel.

import { WAYSTONES } from "../data/waystones.js";

export class WaystoneSystem {
  constructor(defs = WAYSTONES, opts = {}) {
    this.defs = defs;
    this.state = opts.state ?? null;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  all() {
    return [...this.defs];
  }

  byId(id) {
    return this.defs.find((w) => w.id === id) ?? null;
  }

  flagFor(id) {
    return "waystone_" + id;
  }

  isActivated(id) {
    return !!(this.state && this.state.getFlag(this.flagFor(id)));
  }

  // Activate a waystone (idempotent). Reports whether this was the first
  // activation (firstTime) and how many stones are now lit.
  activate(id) {
    const w = this.byId(id);
    if (!w) return { ok: false, error: "unknown waystone" };
    const was = this.isActivated(id);
    this.state?.setFlag(this.flagFor(id), true);
    return { ok: true, id, name: w.name, region: w.region, firstTime: !was, lit: this.countLit() };
  }

  // Activate the waystone that lives on a given map tile, if any.
  activateAt(mapId, x, y) {
    const w = this.defs.find((d) => d.mapId === mapId && d.x === x && d.y === y);
    return w ? this.activate(w.id) : { ok: false, error: "no waystone here" };
  }

  waystoneAt(mapId, x, y) {
    return this.defs.find((d) => d.mapId === mapId && d.x === x && d.y === y) ?? null;
  }

  activated() {
    return this.defs.filter((w) => this.isActivated(w.id));
  }

  countLit() {
    return this.activated().length;
  }

  // Other lit stones reachable from a lit stone.
  destinations(fromId) {
    const from = this.byId(fromId);
    if (!from) return { ok: false, error: "unknown waystone" };
    if (!this.isActivated(fromId)) return { ok: false, error: "waystone not activated" };
    return {
      ok: true,
      from: { id: from.id, name: from.name, region: from.region },
      to: this.activated()
        .filter((w) => w.id !== fromId)
        .map((w) => ({ id: w.id, name: w.name, region: w.region })),
    };
  }

  // The travel payload: where the party should appear.
  travel(fromId, toId) {
    const d = this.destinations(fromId);
    if (!d.ok) return d;
    const hit = d.to.find((w) => w.id === toId);
    if (!hit) return { ok: false, error: "destination not activated" };
    const w = this.byId(toId);
    return {
      ok: true,
      from: fromId,
      id: w.id,
      name: w.name,
      region: w.region,
      to: { mapId: w.mapId, x: w.x, y: w.y, facing: w.facing ?? "S" },
    };
  }

  status() {
    return this.defs.map((w) => ({
      id: w.id,
      name: w.name,
      region: w.region,
      mapId: w.mapId,
      x: w.x,
      y: w.y,
      activated: this.isActivated(w.id),
    }));
  }
}
