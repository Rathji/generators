// Task #134: Overworld Shortcut System — map tiles that, once their
// requirement (a story flag or key item) is met, instantly transport the
// player to a destination, skipping a now-redundant path (town gate, lower
// dungeon floor, tunnel road, etc). Pure logic over state + inventory.

import { SHORTCUTS } from "../data/shortcuts.js";

export class ShortcutSystem {
  constructor(defs = SHORTCUTS, opts = {}) {
    this.defs = defs;
    this.state = opts.state ?? null; // GameState (for flag requirements)
    this.hasItem = opts.hasItem ?? null; // (itemId) => boolean
  }

  all() {
    return this.defs;
  }

  defsFor(mapId) {
    return this.defs.filter((s) => s.mapId === mapId);
  }

  at(mapId, x, y) {
    return this.defs.find((s) => s.mapId === mapId && s.x === x && s.y === y) ?? null;
  }

  requirementMet(s) {
    if (!s.require) return true;
    if (s.require.flag) return this.state?.hasFlag?.(s.require.flag) === true;
    if (s.require.item) return this.hasItem ? this.hasItem(s.require.item) === true : false;
    return true;
  }

  // The shortcut that is BOTH at this tile AND currently open.
  active(mapId, x, y) {
    const s = this.at(mapId, x, y);
    return s && this.requirementMet(s) ? s : null;
  }

  use(mapId, x, y) {
    const s = this.active(mapId, x, y);
    if (!s) return { ok: false };
    return { ok: true, shortcut: s, to: s.to };
  }

  describe(mapId, x, y) {
    const s = this.at(mapId, x, y);
    if (!s) return null;
    const open = this.requirementMet(s);
    const req = s.require?.flag ? "flag:" + s.require.flag : s.require?.item ? "item:" + s.require.item : "none";
    return {
      id: s.id,
      name: s.name,
      open,
      flavor: s.flavor,
      requirement: req,
      to: s.to,
    };
  }

  audit(maps = null) {
    const errors = [];
    for (const s of this.defs) {
      if (!s.id) errors.push({ shortcut: s, error: "missing id" });
      if (maps && !maps.get(s.mapId)) errors.push({ shortcut: s.id, error: "unknown map: " + s.mapId });
      if (maps && !maps.get(s.to?.mapId)) errors.push({ shortcut: s.id, error: "unknown destination: " + s.to?.mapId });
      if (!s.to) errors.push({ shortcut: s.id, error: "missing destination" });
      if (!s.require?.flag && !s.require?.item) errors.push({ shortcut: s.id, error: "missing requirement" });
      if (typeof s.x !== "number" || typeof s.y !== "number") errors.push({ shortcut: s.id, error: "invalid tile" });
    }
    return { ok: errors.length === 0, errors };
  }
}
