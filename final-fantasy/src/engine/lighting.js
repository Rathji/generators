// Task #148: Dynamic Lighting/Darkness Zones — maps that are dark. Without
// a light source the party can't see the tiles at all; with one they see a
// `lightRadius` around themselves. Light sources: the lantern item, the
// Light spell (white mage), or the Luminary blade.

export class LightingSystem {
  constructor(defs = [], opts = {}) {
    this.defs = defs; // [{mapId, lightRadius}]
    this.party = opts.party ?? null;
    this.inventory = opts.inventory ?? null;
    this.lightItems = opts.lightItems ?? ["lantern"];
    this.lightSpell = opts.lightSpell ?? "light";
    this.lightWeapons = opts.lightWeapons ?? ["luminary"];
    // Optional manual light flag (e.g. a torch the demo can strike) — raw
    // boolean on the state so it persists.
    this.state = opts.state ?? null;
    this.torchFlag = opts.torchFlag ?? "light_torch";
  }

  darkDefFor(mapId) {
    return this.defs.find((d) => d.mapId === mapId) ?? null;
  }

  isDark(mapId) {
    return this.darkDefFor(mapId) !== null;
  }

  // The party currently carries light of some kind.
  hasLight() {
    if (this.torchFlag && this.state && this.state.getFlag(this.torchFlag)) return true;
    if (this.inventory && this.lightItems.some((id) => this.inventory.has(id))) return true;
    if (this.party) {
      if (this.party.members.some((m) => typeof m.knowsSpell === "function" && m.knowsSpell(this.lightSpell))) {
        return true;
      }
      if (
        this.lightWeapons.length &&
        this.party.members.some((m) => m.equipment?.weapon && this.lightWeapons.includes(m.equipment.weapon))
      ) {
        return true;
      }
    }
    return false;
  }

  lightRadius(mapId) {
    return this.darkDefFor(mapId)?.lightRadius ?? 2;
  }

  // Can the party see tile (x, y) while standing at (px, py)?
  canSee(mapId, x, y, px, py) {
    const def = this.darkDefFor(mapId);
    if (!def) return true;
    if (!this.hasLight()) return false;
    if (!def.lightRadius) return true; // full vision once lit
    return Math.abs(x - px) + Math.abs(y - py) <= def.lightRadius;
  }

  // Which tiles around (px, py) are currently visible (for rendering).
  visibleTiles(mapId, px, py, width, height) {
    const out = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (this.canSee(mapId, x, y, px, py)) out.push({ x, y });
      }
    }
    return out;
  }

  describe(mapId) {
    const def = this.darkDefFor(mapId);
    if (!def) return "Lit — the way is clear.";
    if (!this.hasLight()) {
      return "Pitch darkness. " + (def.name ?? "This place") + " swallows every torch — you need a light to see.";
    }
    return "Light pierces the dark of " + (def.name ?? "this place") + " (" + this.lightRadius(mapId) + " tiles).";
  }

  // Manual torch toggle for the demo (no item consumed).
  toggleTorch() {
    if (this.state) this.state.setFlag(this.torchFlag, !this.state.getFlag(this.torchFlag));
    return this.state ? this.state.getFlag(this.torchFlag) : false;
  }

  audit(registry) {
    const errors = [];
    for (const d of this.defs) {
      if (!registry?.get?.(d.mapId)) errors.push({ mapId: d.mapId, error: "no such map" });
    }
    return errors;
  }
}
