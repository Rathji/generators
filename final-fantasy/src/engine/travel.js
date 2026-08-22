// Task #75: Ship/Airship Access Logic — requirement checks for obtaining and
// using the ship and airship. A travel mode is locked until its flag (or key
// item) is obtained; access is granted through world events or quests.

export const TRAVEL_ACCESS = {
  ship: {
    name: "Ship",
    mode: "ship",
    require: { type: "flag", flag: "ship_obtained" },
    obtain: { type: "flag", flag: "ship_obtained" },
    deniedDialogue: "The ship is docked, but you have no one to sail it. Ask the harbor master in Pravog.",
    hint: "Obtain passage from the Pravog harbor master.",
  },
  air: {
    name: "Airship",
    mode: "air",
    require: { type: "item", itemId: "airshipEngine" },
    obtain: { type: "flag", flag: "airship_obtained" },
    deniedDialogue: "The airship's engine is missing. The Gnome inventor in Elfheim may know where it went.",
    hint: "Recover the airship engine and clear the Elfheim gate.",
  },
};

export class TravelAccessSystem {
  constructor(defs = TRAVEL_ACCESS, opts = {}) {
    this.defs = defs;
    this.state = opts.state ?? null;
    this.world = opts.world ?? null;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  bindWorld(world) {
    this.world = world;
    return this;
  }

  def(mode) {
    return this.defs[mode] ?? null;
  }

  modes() {
    return Object.keys(this.defs);
  }

  // Whether the unlock requirement is satisfied.
  requirementMet(def) {
    if (!def?.require) return true;
    if (def.require.type === "flag") return !!(this.state && this.state.getFlag(def.require.flag));
    if (def.require.type === "item") return !!(this.world && typeof this.world.hasItem === "function" && this.world.hasItem(def.require.itemId));
    return true;
  }

  canUse(mode) {
    const def = this.def(mode);
    if (!def) return false;
    return this.requirementMet(def);
  }

  // What is missing, for UI/denied prompts.
  requirement(mode) {
    const def = this.def(mode);
    return def ? { ...def.require, name: def.name, deniedDialogue: def.deniedDialogue, hint: def.hint } : null;
  }

  // Unlock a mode (set its obtain flag).
  grant(mode) {
    const def = this.def(mode);
    if (!def) return { ok: false, error: "unknown travel mode" };
    if (def.obtain?.type === "flag" && this.state) this.state.setFlag(def.obtain.flag, true);
    return { ok: true, mode, name: def.name };
  }

  // Human-readable status line for the HUD.
  status() {
    return this.modes().map((m) => {
      const def = this.def(m);
      return { mode: m, name: def.name, unlocked: this.canUse(m) };
    });
  }
}
