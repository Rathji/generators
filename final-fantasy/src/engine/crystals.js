// Task #102: Four Crystal Trigger System — reads the crystal flags, reports
// per-crystal + world-wide visual state as each crystal is restored, and
// notifies subscribers when a crystal is newly restored so the world can
// react (bridges, gates, HUD, music, narrative).

import { CRYSTALS } from "../data/crystals.js";

export class CrystalSystem {
  constructor(defs = CRYSTALS, opts = {}) {
    this.defs = defs;
    this.state = opts.state ?? null;
    this._listeners = [];
    this._prev = null;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  byId(id) {
    return this.defs.find((d) => d.id === id) ?? null;
  }

  isRestored(id) {
    const d = this.byId(id);
    return !!d && !!this.state && !!this.state.getFlag(d.flag);
  }

  restored() {
    return this.defs.filter((d) => this.isRestored(d.id)).map((d) => d.id);
  }

  missing() {
    return this.defs.map((d) => d.id).filter((id) => !this.isRestored(id));
  }

  count() {
    return this.restored().length;
  }

  allRestored() {
    return this.count() === this.defs.length;
  }

  // Per-crystal + world-wide visual descriptors for renderers/HUD.
  visuals() {
    const crystals = this.defs.map((d) => {
      const restored = this.isRestored(d.id);
      return {
        id: d.id,
        name: d.name,
        element: d.element,
        color: d.color,
        restored,
        glow: restored ? 1 : 0,
        shard: d.line,
      };
    });
    const count = crystals.filter((c) => c.restored).length;
    return {
      crystals,
      restored: count,
      total: this.defs.length,
      allRestored: count === this.defs.length,
      worldTint: 0.15 + 0.85 * (count / Math.max(1, this.defs.length)),
    };
  }

  // Compact HUD string, e.g. "◆◇◇◇ 1/4".
  hudLine() {
    return this.defs.map((d) => (this.isRestored(d.id) ? "◆" : "◇")).join("") + " " + this.count() + "/" + this.defs.length;
  }

  onRestored(cb) {
    this._listeners.push(cb);
    return this;
  }

  // Diff the flag state since the last check; fire listeners for any crystal
  // newly restored. Returns the newly-restored defs.
  check() {
    const now = this.restored();
    const prev = this._prev ?? [];
    this._prev = now;
    const fresh = now.filter((id) => !prev.includes(id)).map((id) => this.byId(id));
    for (const d of fresh) {
      for (const cb of this._listeners) cb(d, this);
    }
    return fresh;
  }
}
